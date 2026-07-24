import { EventEmitter } from "node:events";
import {
  type EndpointRecord,
  EndpointRegisterParams,
  EndpointUnregisterParams,
  type ServicesHealthResult,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";

// EndpointService (plugin spec §17.3, P6): a service entry adopts a LOCAL http
// server and fieldd owns its liveness. The record is provenance-first (which
// plugin, which port) and health is MANDATORY — there is no unmonitored
// endpoint, and a dead endpoint stays REGISTERED as unhealthy rather than being
// silently dropped (§17.3 "a dead endpoint is unavailable, not silently
// retained"; the tolerant-honesty law — degraded surfaces are visible, never
// faked-absent). Instantiated directly and folded into services.health (§23.2);
// the product methods (services.registerEndpoint/unregisterEndpoint, §22.2) are
// thin wrappers the daemon binds over register()/unregister().
//
// v1 exposure decision (§17.3, RECORDED HERE): only `app` exposure is real in
// v1 (local, routed through the plugin service / a ticketed direct path). The
// other two planes are REFUSED with honest messages rather than accepted and
// ignored — accepting a flag we don't honor would be a silent lie about reach:
//   - `mesh` needs `artifact.publish` + a replayable mesh serve with WhoIs
//     policy; that machinery lands with the mesh track.
//   - `mcp` needs `mcp.contribute` + endpoint projection into the tool fold;
//     that lands with the MCP projection slice.
// When those planes land, the refusals below become grant checks.

const HEALTH_TIMEOUT_MS = 3_000;
const DEFAULT_MIN_INTERVAL_MS = 1_000;

export interface EndpointServiceConfig {
  logger?: Logger;
  /** test seam: floor for the health-poll period; production default 1_000.
   * The period is max(intervalMs, minIntervalMs) (§17.3) — this raises the
   * floor, it never lowers the plugin-requested interval. */
  minIntervalMs?: number;
  /** test seam: fetch impl; default the Node global fetch */
  fetchImpl?: typeof fetch;
}

interface EndpointRow {
  serviceId: string;
  pluginId: string;
  port: number;
  expose: { app: boolean; mesh: boolean; mcp: boolean };
  healthPath: string;
  periodMs: number;
  health: {
    state: EndpointRecord["health"]["state"];
    lastCheckedAt?: number;
    consecutiveFailures: number;
  };
  timer?: NodeJS.Timeout | undefined;
  /** the in-flight probe's aborter, so teardown never leaves a pending fetch */
  abort?: AbortController | undefined;
  /** guards against overlapping probes when a probe outlives its period */
  probing: boolean;
  /** set on withdrawal so an in-flight probe's result is discarded */
  disposed: boolean;
}

export class EndpointService extends EventEmitter {
  private readonly logger: Logger;
  private readonly minIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly rows = new Map<string, EndpointRow>();
  private generation = 0;

  constructor(cfg: EndpointServiceConfig = {}) {
    super();
    this.logger = (cfg.logger ?? createNoopLogger()).child({ component: "plugin.endpoints" });
    this.minIntervalMs = cfg.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    // bind so an unbound global fetch keeps its own receiver
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** §17.3 register. Throws RpcCallError; on success the endpoint is live and
   * its first health probe is already in flight. The FIRST registration of a
   * serviceId wins — a duplicate is refused, never replaced. */
  register(pluginId: string, params: unknown): EndpointRecord {
    // 1. schema (§17.3) — the tolerant reader already ran in the zod parse
    const parsed = EndpointRegisterParams.safeParse(params);
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "endpoint registration failed its schema",
        false,
        {
          pluginKind: "PLUGIN_SCHEMA_VIOLATION",
          issues: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"} ${i.message}`),
        },
      );
    const req = parsed.data;

    // 2. ownership (§17.3 — endpoints bind to x.<pluginId>.<name>). EXACT prefix;
    // never split a dotted id to derive the owner.
    const prefix = `x.${pluginId}.`;
    if (!req.serviceId.startsWith(prefix))
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        `${req.serviceId} is not ${pluginId}'s to adopt (endpoints bind to ${prefix}*)`,
        false,
        { pluginKind: "PLUGIN_CAPABILITY_DENIED" },
      );

    // 3. duplicate — first wins (§17.3; mirrors the §14.6 provider-collision law)
    if (this.rows.has(req.serviceId))
      throw new RpcCallError("CONFLICT", `${req.serviceId} already adopts a live endpoint`, false, {
        pluginKind: "PLUGIN_INVALID",
      });

    // 4. v1 exposure decision (see file header): app-only; mesh/mcp refused honestly
    if (req.expose.mesh)
      throw new RpcCallError("PRECONDITION_FAILED", "mesh serve lands with the mesh track", false, {
        pluginKind: "PLUGIN_CAPABILITY_DENIED",
      });
    if (req.expose.mcp)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "MCP endpoint projection lands with the MCP projection slice",
        false,
        { pluginKind: "PLUGIN_CAPABILITY_DENIED" },
      );
    if (!req.expose.app)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "an adopted endpoint must expose to the app in v1",
        false,
        { pluginKind: "PLUGIN_INVALID" },
      );

    const row: EndpointRow = {
      serviceId: req.serviceId,
      pluginId,
      port: req.endpoint.port,
      expose: { app: req.expose.app, mesh: req.expose.mesh, mcp: req.expose.mcp },
      healthPath: req.health.path,
      periodMs: Math.max(req.health.intervalMs, this.minIntervalMs),
      health: { state: "unknown", consecutiveFailures: 0 },
      probing: false,
      disposed: false,
    };
    this.rows.set(row.serviceId, row);
    this.logger.info("fieldd.plugin_endpoints.registered", "Plugin endpoint adopted", {
      serviceId: row.serviceId,
      pluginId,
      port: row.port,
    });
    this.bump();
    // §17.3 health is mandatory and starts immediately (§ rule 6 — first probe
    // now, not a period from now); the recurring probe follows.
    this.schedule(row);
    return toRecord(row);
  }

  /** §17.3 unregister. Ownership is validated the same way as register — a
   * plugin can only withdraw within its own namespace. */
  unregister(pluginId: string, params: unknown): { ok: true } {
    const parsed = EndpointUnregisterParams.safeParse(params);
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "endpoint unregistration failed its schema",
        false,
        {
          pluginKind: "PLUGIN_SCHEMA_VIOLATION",
          issues: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"} ${i.message}`),
        },
      );
    const { serviceId } = parsed.data;
    const prefix = `x.${pluginId}.`;
    if (!serviceId.startsWith(prefix))
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        `${serviceId} is not ${pluginId}'s to withdraw (endpoints bind to ${prefix}*)`,
        false,
        { pluginKind: "PLUGIN_CAPABILITY_DENIED" },
      );
    const row = this.rows.get(serviceId);
    if (row === undefined)
      throw new RpcCallError("NOT_FOUND", `no adopted endpoint ${serviceId}`, false, {
        pluginKind: "PLUGIN_PROVIDER_GONE",
      });
    this.stopRow(row);
    this.rows.delete(serviceId);
    this.logger.info("fieldd.plugin_endpoints.unregistered", "Plugin endpoint withdrawn", {
      serviceId,
      pluginId,
    });
    this.bump();
    return { ok: true };
  }

  /** disable/crash/revoke path (§18.2) — drops every endpoint the plugin
   * adopted and stops their timers. Returns how many rows were removed. */
  withdrawPlugin(pluginId: string): number {
    let removed = 0;
    for (const [serviceId, row] of [...this.rows]) {
      if (row.pluginId !== pluginId) continue;
      this.stopRow(row);
      this.rows.delete(serviceId);
      removed += 1;
    }
    if (removed > 0) {
      this.logger.info(
        "fieldd.plugin_endpoints.withdrawn",
        "All endpoints for a plugin were withdrawn",
        { pluginId, removed },
      );
      this.bump();
    }
    return removed;
  }

  /** the §23.2 fold slice for adopted endpoints */
  snapshot(): ServicesHealthResult {
    const endpoints = [...this.rows.values()]
      .sort((a, b) => a.serviceId.localeCompare(b.serviceId))
      .map(toRecord);
    return { generation: this.generation, endpoints };
  }

  get(serviceId: string): EndpointRecord | undefined {
    const row = this.rows.get(serviceId);
    return row === undefined ? undefined : toRecord(row);
  }

  dispose(): void {
    for (const row of this.rows.values()) this.stopRow(row);
    this.rows.clear();
    this.removeAllListeners();
  }

  // --- health loop -------------------------------------------------------------

  private schedule(row: EndpointRow): void {
    const timer = setInterval(() => this.runProbe(row), row.periodMs);
    timer.unref?.();
    row.timer = timer;
    this.runProbe(row); // §17.3 rule 6 — kick the first probe immediately
  }

  private runProbe(row: EndpointRow): void {
    if (row.disposed || row.probing) return; // no overlapping probes
    row.probing = true;
    void this.probe(row).finally(() => {
      row.probing = false;
    });
  }

  /** GET http://127.0.0.1:<port><path>: 2xx is healthy, anything else / throw /
   * timeout is unhealthy. Bodies are irrelevant to health and are released
   * (EL2 — the control plane never carries data bytes). */
  private async probe(row: EndpointRow): Promise<void> {
    const url = `http://127.0.0.1:${row.port}${row.healthPath}`;
    const controller = new AbortController();
    row.abort = controller;
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    timer.unref?.();
    let ok = false;
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal });
      ok = res.status >= 200 && res.status < 300;
      await res.body?.cancel?.().catch(() => undefined);
    } catch {
      ok = false; // connection refused, DNS, abort/timeout — all unhealthy
    } finally {
      clearTimeout(timer);
      row.abort = undefined;
    }
    // withdrawn mid-flight — discard the result rather than resurrect the row
    if (row.disposed || this.rows.get(row.serviceId) !== row) return;
    this.applyProbe(row, ok);
  }

  private applyProbe(row: EndpointRow, ok: boolean): void {
    const prev = row.health.state;
    row.health.lastCheckedAt = Date.now();
    if (ok) {
      row.health.consecutiveFailures = 0;
      row.health.state = "healthy";
    } else {
      row.health.consecutiveFailures += 1;
      row.health.state = "unhealthy";
    }
    // §17.3 rule 9 — a health FLIP is a mutation: it bumps generation and emits.
    // lastCheckedAt/consecutiveFailures still advance every probe (visible via
    // snapshot()), but a steady state does not spam the change stream.
    if (row.health.state !== prev) {
      this.logger.info("fieldd.plugin_endpoints.health_changed", "Plugin endpoint health changed", {
        serviceId: row.serviceId,
        pluginId: row.pluginId,
        from: prev,
        to: row.health.state,
        consecutiveFailures: row.health.consecutiveFailures,
      });
      this.bump();
    }
  }

  private stopRow(row: EndpointRow): void {
    row.disposed = true;
    if (row.timer !== undefined) {
      clearInterval(row.timer);
      row.timer = undefined;
    }
    row.abort?.abort();
  }

  private bump(): void {
    this.generation += 1;
    this.emit("changed", this.snapshot());
  }
}

function toRecord(row: EndpointRow): EndpointRecord {
  return {
    serviceId: row.serviceId,
    pluginId: row.pluginId,
    endpoint: { protocol: "http", port: row.port },
    expose: { app: row.expose.app, mesh: row.expose.mesh, mcp: row.expose.mcp },
    health: {
      state: row.health.state,
      ...(row.health.lastCheckedAt !== undefined
        ? { lastCheckedAt: row.health.lastCheckedAt }
        : {}),
      consecutiveFailures: row.health.consecutiveFailures,
    },
  };
}
