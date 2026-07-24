import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import {
  LOG_TRANSPORT_LIMITS,
  PLUGIN_LIMITS,
  type PluginManifestV1,
  type PublicEntryState,
  type Scope,
  validatePluginManifest,
} from "@vibefield/contracts";
import { createBoundedLineFramer, createNoopLogger, type Logger } from "@vibefield/logging";
import type { PluginRegistryService } from "./plugin-registry";
import type { ServiceCallerInfo, ServiceRegistry } from "./service-registry";
import type { TokenGrant, TokenService } from "./token-service";

// ServiceHost (plugin spec §14.2/§18, P4): one worker thread per plugin
// service entry, host-owned harness, §10.4 deadlines, the §18.3 crash ladder,
// §18.2 deactivation order. The worker gets a plugin-bound product lease and a
// MINIMAL env (EL7 — daemon secrets never enter plugin runtimes); handlers
// stay worker-side, only metadata and calls cross the port.
//
// The host re-reads + re-validates the plugin's manifest at start (a local
// file the daemon already trusts paths for): PluginRecord is the SANITIZED
// public row and deliberately carries no entry paths — the host is
// daemon-internal and may know them.

/** §15.2 entry-kind eligibility — the core scopes a SERVICE token may carry.
 * Renderer/shell powers (shell.*, terminal.attach, tokens.mint, plugins.*,
 * native.admin, agent.bless) never enter service principals. */
const SERVICE_ELIGIBLE_SCOPES: readonly Scope[] = [
  "services.provide",
  "process.spawn",
  "background",
  "net.outbound",
  "storage.self",
  "mcp.consume",
  "mcp.contribute",
  "canvas.read",
  "canvas.write",
  "doc.read",
  "doc.write",
  "workspace.read",
  "index.read",
  "artifact.publish",
  "agent.observe",
  "approval.respond",
] as const;

export interface ServiceHostConfig {
  registry: ServiceRegistry;
  plugins: PluginRegistryService;
  tokens: TokenService;
  /** the bound product port (workers dial loopback with their lease) */
  controlPort: () => number;
  /** override for the bundled daemon (bin.cjs cannot use import.meta) */
  harnessPath?: string;
  /** test seams — production defaults are the §10.4 PLUGIN_LIMITS */
  deadlines?: { activateMs?: number; deactivateMs?: number };
  /** test seam — production defaults are the §18.3 ladder constants */
  ladder?: { baseMs?: number; maxMs?: number; windowMs?: number; quarantineAt?: number };
  /** LOG-L6 authority seam: production mints service leases through audit. */
  mintServiceLease?: (pluginId: string, scopes: Scope[]) => Promise<TokenGrant>;
  /** LOG-L6 authority seam: crash/stop revocation is audited by safe token ID. */
  revokeServiceLease?: (pluginId: string, tokenId: string, reason: string) => Promise<void>;
  logger?: Logger;
  pluginLog?: (record: PluginServiceLogRecord) => void;
}

export interface PluginServiceLogRecord {
  pluginId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields?: Readonly<Record<string, unknown>>;
  event?: "plugin.log" | "plugin.output";
}

interface Entry {
  state: PublicEntryState;
  worker: Worker | null;
  /** registry unregister fns for this plugin's live providers */
  unregisters: Map<string, () => void>;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  sinks: Map<
    number,
    {
      snapshot(v: unknown): void;
      delta(v: unknown): void;
      end(e?: { kind: string; message: string }): void;
    }
  >;
  crashTimes: number[];
  restartTimer: NodeJS.Timeout | null;
  /** deliberate teardown in progress — an exit is not a crash */
  stopping: boolean;
  generation: number;
  detachOutput: (() => void) | null;
  leaseTokenId: string | null;
  leaseRelease: Promise<void> | null;
}

export class ServiceHost {
  private readonly entries = new Map<string, Entry>();
  private nextCallId = 1;
  private disposed = false;
  private readonly logger: Logger;

  constructor(private readonly cfg: ServiceHostConfig) {
    this.logger = cfg.logger ?? createNoopLogger();
  }

  private entry(pluginId: string): Entry {
    let e = this.entries.get(pluginId);
    if (e === undefined) {
      e = {
        state: "none",
        worker: null,
        unregisters: new Map(),
        pending: new Map(),
        sinks: new Map(),
        crashTimes: [],
        restartTimer: null,
        stopping: false,
        generation: 0,
        detachOutput: null,
        leaseTokenId: null,
        leaseRelease: null,
      };
      this.entries.set(pluginId, e);
    }
    return e;
  }

  state(pluginId: string): PublicEntryState {
    return this.entries.get(pluginId)?.state ?? "none";
  }

  /** start every enabled plugin whose manifest declares entries.service and
   * activation onStartup (§18.6 — restart activates only demanded services) */
  async startEligible(): Promise<void> {
    for (const record of this.cfg.plugins.list()) {
      if (!record.enabled) continue;
      const manifest = await this.readManifest(record.id);
      if (manifest === null || manifest.entries?.service === undefined) continue;
      if (!manifest.activation.includes("onStartup")) continue;
      await this.start(record.id).catch((e) => {
        this.logger.error(
          "fieldd.plugin_service.startup_activation_failed",
          "Plugin service startup activation failed",
          e,
          { pluginId: record.id },
        );
      });
    }
  }

  /** explicit (re)start — clears crash history (user re-enable clears quarantine, §18.3) */
  async restartFresh(pluginId: string): Promise<void> {
    const e = this.entry(pluginId);
    e.crashTimes = [];
    if (e.restartTimer !== null) {
      clearTimeout(e.restartTimer);
      e.restartTimer = null;
    }
    await this.start(pluginId);
  }

  async start(pluginId: string): Promise<void> {
    if (this.disposed) return;
    const e = this.entry(pluginId);
    if (e.worker !== null || e.state === "activating") return; // idempotent
    if (e.state === "quarantined" && e.crashTimes.length > 0) return; // §18.3 — user clear required

    const record = this.cfg.plugins.get(pluginId);
    if (record === undefined || !record.enabled) return;
    const root = this.cfg.plugins.rootPath(pluginId);
    const manifest = await this.readManifest(pluginId);
    const entryRel = manifest?.entries?.service;
    if (root === undefined || manifest === null || entryRel === undefined) return;
    const entryPath = resolve(join(root, entryRel));
    if (!entryPath.startsWith(resolve(root))) {
      this.setState(pluginId, e, "quarantined");
      this.logger.error(
        "fieldd.plugin_service.entry_path_rejected",
        "Plugin service entry escaped its plugin root and was refused",
        undefined,
        { pluginId },
      );
      return;
    }

    const generation = ++e.generation;
    e.stopping = false;
    this.setState(pluginId, e, "activating");

    const scopes = record.grantedCapabilities.filter((c): c is Scope =>
      (SERVICE_ELIGIBLE_SCOPES as readonly string[]).includes(c),
    );
    await e.leaseRelease;
    e.leaseRelease = null;
    let lease: TokenGrant;
    try {
      lease =
        this.cfg.mintServiceLease !== undefined
          ? await this.cfg.mintServiceLease(pluginId, scopes)
          : this.cfg.tokens.mint(scopes, `plugin:${pluginId}:service`, { pluginId });
      e.leaseTokenId = lease.tokenId;
    } catch (error) {
      this.setState(pluginId, e, "degraded");
      throw error;
    }

    const harness =
      this.cfg.harnessPath ?? new URL("./service-worker-harness.mjs", import.meta.url).pathname;
    let worker: Worker;
    try {
      worker = new Worker(harness, {
        workerData: {
          pluginId,
          version: record.version,
          entryPath,
          leaseUrl: `ws://127.0.0.1:${this.cfg.controlPort()}`,
          leaseToken: lease.token,
          scopes: lease.scopes, // presence-gates ctx.settings/storage (§10.2)
          logLimits: {
            recordBytes: LOG_TRANSPORT_LIMITS.PLUGIN_RECORD_BYTES,
            messageBytes: LOG_TRANSPORT_LIMITS.PLUGIN_MESSAGE_BYTES,
            stringBytes: LOG_TRANSPORT_LIMITS.PLUGIN_STRING_BYTES,
            objectDepth: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_DEPTH,
            objectKeys: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_KEYS,
            arrayItems: LOG_TRANSPORT_LIMITS.PLUGIN_ARRAY_ITEMS,
          },
        },
        env: {}, // EL7 — a minimal environment, daemon secrets stripped
        // a CLEAN node CLI for the worker: no inherited loaders/debug flags
        // (vitest's tinypool execArgv otherwise leaks in and wedges module
        // loading; production hygiene wants this anyway)
        execArgv: [],
        // worker stdio flows through the HOST's log surface — a dying worker's
        // last words must never vanish into a parent runner's void (§23)
        stdout: true,
        stderr: true,
      });
    } catch (error) {
      await this.releaseServiceLease(pluginId, e, "worker-construction-failed");
      this.setState(pluginId, e, "degraded");
      throw error;
    }
    e.detachOutput?.();
    e.detachOutput = this.capturePluginOutput(worker, pluginId);
    e.worker = worker;

    const declarations = manifest.contributes?.services ?? [];
    const activateDeadline =
      this.cfg.deadlines?.activateMs ?? PLUGIN_LIMITS.SERVICE_ACTIVATE_DEADLINE_MS;

    await new Promise<void>((resolveActivate, rejectActivate) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        // §10.4 — a hung activation is terminated, honestly failed
        finish(() => {
          void worker.terminate();
          this.setState(pluginId, e, "degraded");
          rejectActivate(new Error(`${pluginId}: activate exceeded ${activateDeadline}ms`));
        });
      }, activateDeadline);

      worker.on("message", (msg: Record<string, unknown>) => {
        if (e.generation !== generation) return; // a stale worker's echo
        switch (msg["t"]) {
          case "activated":
            finish(() => {
              this.setState(pluginId, e, "active");
              this.logger.info(
                "fieldd.plugin_service.activated",
                "Plugin service worker activated",
                { pluginId },
              );
              resolveActivate();
            });
            return;
          case "activate-failed":
            finish(() => {
              void worker.terminate();
              this.setState(pluginId, e, "degraded");
              rejectActivate(
                new Error(
                  `${pluginId}: ${(msg["error"] as { message?: string } | undefined)?.message ?? "activation failed"}`,
                ),
              );
            });
            return;
          case "provide": {
            try {
              const namespace = String(msg["namespace"]);
              const nsDecls = declarations.filter((s) => s.namespace === namespace);
              const unregister = this.cfg.registry.register({
                pluginId,
                namespace,
                declarations: nsDecls.flatMap((s) => s.methods),
                implemented: msg["implemented"] as Array<{
                  name: string;
                  kind: "query" | "mutation" | "subscription";
                }>,
                handlers: this.portHandlers(pluginId, e, namespace),
              });
              e.unregisters.set(namespace, unregister);
            } catch (err) {
              this.logger.error(
                "fieldd.plugin_service.provide_rejected",
                "Plugin service provider registration was refused",
                err,
                { pluginId },
              );
            }
            return;
          }
          case "unprovide": {
            const namespace = String(msg["namespace"]);
            e.unregisters.get(namespace)?.();
            e.unregisters.delete(namespace);
            return;
          }
          case "result": {
            const id = msg["id"] as number;
            const waiter = e.pending.get(id);
            e.pending.delete(id);
            if (waiter === undefined) return;
            if (msg["ok"] === true) waiter.resolve(msg["value"]);
            else {
              const err = msg["error"] as { message?: string } | undefined;
              waiter.reject(new Error(err?.message ?? "provider error"));
            }
            return;
          }
          case "sub-snapshot":
            e.sinks.get(msg["id"] as number)?.snapshot(msg["value"]);
            return;
          case "sub-delta":
            e.sinks.get(msg["id"] as number)?.delta(msg["value"]);
            return;
          case "sub-end": {
            const id = msg["id"] as number;
            e.sinks.get(id)?.end(msg["error"] as { kind: string; message: string } | undefined);
            e.sinks.delete(id);
            return;
          }
          case "log": {
            const level = msg["level"];
            if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
              this.logger.warn(
                "fieldd.plugin_service.log_rejected",
                "Plugin service emitted an invalid log level",
                { pluginId, reason: "level" },
              );
              return;
            }
            const message =
              typeof msg["message"] === "string"
                ? msg["message"]
                : "[plugin emitted a non-string log message]";
            const fields = msg["fields"];
            this.cfg.pluginLog?.({
              pluginId,
              level,
              message,
              ...(fields !== null && typeof fields === "object" && !Array.isArray(fields)
                ? { fields: fields as Record<string, unknown> }
                : {}),
              event: "plugin.log",
            });
            return;
          }
          default:
            return;
        }
      });

      worker.on("error", (err) => {
        if (e.generation !== generation) return;
        this.logger.error(
          "fieldd.plugin_service.worker_failed",
          "Plugin service worker emitted an error",
          err,
          { pluginId },
        );
        finish(() => rejectActivate(err)); // pre-activation error path
      });

      worker.on("exit", (code) => {
        if (e.generation !== generation) return;
        e.detachOutput?.();
        e.detachOutput = null;
        e.worker = null;
        void this.releaseServiceLease(pluginId, e, "worker-exit");
        this.failAllInflight(e, "provider gone");
        this.cfg.registry.withdrawPlugin(pluginId);
        e.unregisters.clear();
        if (e.stopping || this.disposed) return;
        finish(() =>
          rejectActivate(new Error(`${pluginId}: worker exited (${code}) during activation`)),
        );
        this.onCrash(pluginId, e);
      });
    });
  }

  /** §18.3 — degraded → backoff restart; 3 crashes in the window → quarantine */
  private onCrash(pluginId: string, e: Entry): void {
    const now = Date.now();
    const windowMs = this.cfg.ladder?.windowMs ?? 600_000;
    const quarantineAt = this.cfg.ladder?.quarantineAt ?? 3;
    e.crashTimes = [...e.crashTimes.filter((t) => now - t < windowMs), now];
    if (e.crashTimes.length >= quarantineAt) {
      this.setState(pluginId, e, "quarantined");
      this.logger.error(
        "fieldd.plugin_service.quarantined",
        "Plugin service was quarantined after repeated crashes",
        undefined,
        { pluginId, crashCount: e.crashTimes.length },
      );
      return;
    }
    this.setState(pluginId, e, "restarting");
    const baseMs = this.cfg.ladder?.baseMs ?? 1_000;
    const maxMs = this.cfg.ladder?.maxMs ?? 30_000;
    const backoff = Math.min(baseMs * 2 ** (e.crashTimes.length - 1), maxMs);
    e.restartTimer = setTimeout(() => {
      e.restartTimer = null;
      void this.start(pluginId).catch((err) => {
        this.logger.error(
          "fieldd.plugin_service.restart_failed",
          "Plugin service restart failed",
          err,
          { pluginId },
        );
      });
    }, backoff);
  }

  /** §18.2 deactivation: signal → bounded wait → force-terminate → inactive */
  async stop(pluginId: string): Promise<void> {
    const e = this.entries.get(pluginId);
    if (e === undefined) return;
    if (e.restartTimer !== null) {
      clearTimeout(e.restartTimer);
      e.restartTimer = null;
    }
    const worker = e.worker;
    e.stopping = true;
    if (worker !== null) {
      const deadline = this.cfg.deadlines?.deactivateMs ?? PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS;
      await new Promise<void>((done) => {
        const timer = setTimeout(() => done(), deadline);
        worker.once("message", function onMsg(msg: Record<string, unknown>) {
          if (msg["t"] === "deactivated") {
            clearTimeout(timer);
            done();
          }
        });
        worker.postMessage({ t: "deactivate" });
      });
      await worker.terminate();
      e.detachOutput?.();
      e.detachOutput = null;
      e.worker = null;
    }
    await this.releaseServiceLease(pluginId, e, "service-stop");
    this.failAllInflight(e, "provider deactivated");
    this.cfg.registry.withdrawPlugin(pluginId);
    e.unregisters.clear();
    this.setState(pluginId, e, "inactive");
    this.logger.info("fieldd.plugin_service.deactivated", "Plugin service worker deactivated", {
      pluginId,
    });
  }

  async stopAll(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
  }

  private failAllInflight(e: Entry, reason: string): void {
    for (const [, waiter] of e.pending) waiter.reject(new Error(reason));
    e.pending.clear();
    for (const [, sink] of e.sinks) sink.end({ kind: "UNAVAILABLE", message: reason });
    e.sinks.clear();
  }

  private setState(pluginId: string, e: Entry, state: PublicEntryState): void {
    e.state = state;
    this.cfg.plugins.setServiceEntryState(pluginId, state);
  }

  private releaseServiceLease(pluginId: string, e: Entry, reason: string): Promise<void> {
    const tokenId = e.leaseTokenId;
    if (tokenId === null) return e.leaseRelease ?? Promise.resolve();
    e.leaseTokenId = null;
    const release = Promise.resolve(
      this.cfg.revokeServiceLease !== undefined
        ? this.cfg.revokeServiceLease(pluginId, tokenId, reason)
        : this.cfg.tokens.revoke(tokenId),
    )
      .then(() => undefined)
      .catch((error) => {
        this.logger.error(
          "fieldd.plugin_service.lease_revoke_failed",
          "Plugin service lease revocation could not be durably audited",
          error,
          { pluginId, tokenId, reason },
        );
      });
    e.leaseRelease = release;
    return release;
  }

  /** Plugin-owned stdout/stderr must never enter system/fieldd. Consume both
   * streams through the shared bounded framer and route them through the same
   * host-stamped plugins/service boundary as ctx.logger. */
  private capturePluginOutput(worker: Worker, pluginId: string): () => void {
    const detach: Array<() => void> = [];
    const attach = (stream: "stdout" | "stderr", level: "info" | "error"): void => {
      const readable = worker[stream];
      if (readable === null) return;
      let ended = false;
      const framer = createBoundedLineFramer({
        maxBytes: LOG_TRANSPORT_LIMITS.PLUGIN_PARTIAL_LINE_BYTES,
        onLine: (line) => {
          this.cfg.pluginLog?.({
            pluginId,
            level,
            message: line.line,
            fields: { source: stream, truncated: line.truncated },
            event: "plugin.output",
          });
        },
      });
      const onData = (chunk: Buffer | string): void => framer.push(chunk);
      const onEnd = (): void => {
        if (ended) return;
        ended = true;
        framer.flush();
      };
      readable.on("data", onData);
      readable.on("end", onEnd);
      detach.push(() => {
        readable.off("data", onData);
        readable.off("end", onEnd);
        onEnd();
      });
    };
    attach("stdout", "info");
    attach("stderr", "error");
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      for (const stop of detach.splice(0)) stop();
    };
  }

  /** the port bridge the ServiceRegistry invokes — handlers stay worker-side */
  private portHandlers(_pluginId: string, e: Entry, namespace: string) {
    return {
      call: (name: string, params: unknown, caller: ServiceCallerInfo): Promise<unknown> => {
        const worker = e.worker;
        if (worker === null) return Promise.reject(new Error("provider gone"));
        const id = this.nextCallId++;
        return new Promise((resolveCall, rejectCall) => {
          e.pending.set(id, { resolve: resolveCall, reject: rejectCall });
          worker.postMessage({ t: "call", id, namespace, name, params, caller });
        });
      },
      subscribe: async (
        name: string,
        params: unknown,
        caller: ServiceCallerInfo,
        sink: {
          snapshot(v: unknown): void;
          delta(v: unknown): void;
          end(err?: { kind: string; message: string }): void;
        },
      ): Promise<() => void> => {
        const worker = e.worker;
        if (worker === null) throw new Error("provider gone");
        const id = this.nextCallId++;
        e.sinks.set(id, sink);
        worker.postMessage({ t: "subscribe", id, namespace, name, params, caller });
        return () => {
          e.sinks.delete(id);
          e.worker?.postMessage({ t: "unsubscribe", id });
        };
      },
    };
  }

  private async readManifest(pluginId: string): Promise<PluginManifestV1 | null> {
    const root = this.cfg.plugins.rootPath(pluginId);
    if (root === undefined) return null;
    try {
      const raw = JSON.parse(await readFile(join(root, "vibefield.plugin.json"), "utf8"));
      const result = validatePluginManifest(raw);
      return result.ok ? result.manifest : null;
    } catch {
      return null;
    }
  }
}
