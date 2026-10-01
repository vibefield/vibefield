import { EventEmitter } from "node:events";
import {
  ARTIFACT_SERVE_PREFIX,
  MeshEgressProxy,
  MeshEgressRouteAddParams,
  MeshEgressRouteBound,
  MeshEgressRouteRef,
  MeshEgressRouteTable,
  ServeConfig,
  ServeStatus,
} from "@vibefield/contracts";
import type { NativeLink } from "./native-link";
import { RpcCallError } from "./native-link";

// MeshClient (design-02 §3.4, C2/C3): fieldd's face of the mesh facade.
// The serve set is DECLARATIVE and owned here — "re-serving is re-creating":
// on every (re)connect to field-native, the desired set is reconciled against
// the node's list (add missing, remove strays we once declared). Store and
// peer calls are thin passthroughs over the mgmt channel; UNAVAILABLE (mesh
// disabled / not yet authed) is a normal answer, surfaced not retried.
//
// C3 adds the RUNTIME STREAM: after a reconcile reaches the node, MeshClient
// subscribes `native.mesh.serve.subscribe` and FUSES the node's live proxy
// status (ProxyEvent: started/stopped/error) into each serve's `status`.
// `serves()` returns that fused view; "serves-changed" fires on any per-serve
// status/url/error transition. The subscription is registered once; NativeLink
// replays it on reconnect (P5 — reconnect = fresh snapshot). Deltas are PARTIAL
// entries merged by serveId; a `.snapshot` (subscribe result, reconnect replay, or
// a broadcast-lag re-snapshot notification) replaces runtime state wholesale.
// Entries are keyed by serveId; legacy native floors omit it, in which case
// name remains the compatibility identity.

export interface ServeSpec {
  /** Engine identity. Omitted by legacy callers, where it defaults to name. */
  serveId?: string;
  name: string;
  /** Tailnet listener independent of the source port. */
  listenPort?: number;
  target:
    | { kind: "port"; port: number; scheme?: "http" | "https" }
    | { kind: "dir"; path: string; fallback?: "/index.html" }
    /** TM-2 — a serve whose whole surface is `routes` below, with NO implicit
     * root route. The terminal-cell listener's shape. */
    | { kind: "routes" };
  /** TM-2 — declared path routes, each a prefix onto ONE loopback port. Only
   * meaningful for `kind: "routes"`; every other kind ignores it. The native
   * side builds these with `stripPrefix` true (a cell door matches `/control`
   * and `/frames` exactly) and refuses an empty list. */
  routes?: Array<{ prefix: string; targetPort: number }>;
  /** App-owned static route mounted ahead of the source root. */
  previewDir?: string;
  allow?: string[];
  /** false = plain HTTP inside WireGuard (the product serve's choice; no
   * MagicDNS-cert dependency). Forwarded verbatim to native.mesh.serve.add. */
  tls?: boolean;
  /** C3 provenance proof (design-01 §4): the secret route path the serve
   * registers so proxied requests prove they came through the sidecar.
   * Forwarded verbatim to native.mesh.serve.add. */
  pathSecret?: string;
}

/** One declared serve's public verdict. `status` is the FUSED truth — the C2
 * reconcile outcome (did we get it into the node's set) refined by the C3 live
 * runtime status (running/starting/stopped/error) from the serve stream:
 *   - pending — declared but not actively serving (mesh down / add pending /
 *     runtime starting or stopped — a stopped-but-desired serve is transitional,
 *     reconcile re-adds it, not failed)
 *   - active  — reconciled and the node reports the proxy running
 *   - error   — the add failed, or the node reports a runtime ProxyEvent::Error */
export interface ServeState extends ServeSpec {
  url?: string;
  status: "active" | "pending" | "error";
  error?: string;
}

/** Raw native inventory. ArtifactService uses listener ports for allocation;
 * source config is intentionally absent because proxy.list does not expose it. */
export interface ObservedServe {
  serveId: string;
  name: string;
  listenPort: number;
  url?: string;
}

/** Live runtime status per serve, keyed by serveId — a faithful mirror of the node's
 * ProxyStatus, mapped to the fused `status` only in `fuse()`. */
interface RuntimeEntry {
  status: ServeStatus;
  url?: string;
  error?: string;
}

/** Node ProxyStatus → the fused serve status. `stopped` maps to pending, not
 * error: a serve we still desire that the node dropped is transitional — reconcile
 * re-adds it — not a failure (thinking-c3 §0.1, accepted). Only a live
 * ProxyEvent::Error is an error. */
const RUNTIME_TO_STATUS: Record<ServeStatus, "active" | "pending" | "error"> = {
  running: "active",
  starting: "pending",
  stopped: "pending",
  error: "error",
};

export class MeshClient extends EventEmitter {
  private desired = new Map<string, ServeSpec>();
  /** the reconcile layer: `status` here is the C2 reconcile outcome only */
  private states = new Map<string, ServeState>();
  /** the runtime layer, fused over `states` by `serves()` */
  private runtime = new Map<string, RuntimeEntry>();
  /** P0-S — the serves THIS client has placed on the node (a `serve.add` that
   * succeeded). `states` cannot answer that: it also holds `pending` records
   * written while the mesh was down. A desired serve the node lists that is not
   * in here is a PREDECESSOR's — see `doReconcile`. */
  private readonly placed = new Set<string>();
  /** registered once; NativeLink replays the subscription across reconnects */
  private serveSubscribed = false;
  /** signature of the last emitted fused view — "serves-changed" fires only on
   * an actual per-serve status/url/error transition, never on a no-op */
  private lastServesSig = "";
  /** reconciles SERIALIZE (never skip): a caller's pass always starts after
   * its own desired-set mutation — a skip-guard here silently no-ops. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly link: NativeLink) {
    super();
    link.on("connected", () => {
      void this.reconcile(); // fresh native boot may have an empty node — replay
    });
  }

  /** Replace the desired serve set and reconcile now. */
  async setServes(specs: ServeSpec[]): Promise<ServeState[]> {
    this.desired = new Map(specs.map((s) => [serveKey(s), s]));
    await this.reconcile();
    return this.serves();
  }

  /** Remove one engine identity directly. ArtifactService uses this for its
   * crash-safe retiringServeIds queue before declaring a replacement config. */
  removeServe(serveId: string): Promise<{ removed: boolean }> {
    return this.enqueue(async () => {
      try {
        await this.link.request("native.mesh.serve.remove", { serveId });
      } catch (error) {
        if (!(error instanceof RpcCallError && error.kind === "NOT_FOUND")) throw error;
      }
      this.desired.delete(serveId);
      this.states.delete(serveId);
      this.runtime.delete(serveId);
      this.placed.delete(serveId);
      this.emitServesChanged();
      return { removed: true };
    });
  }

  /** Read the node's complete serve inventory without changing desired state. */
  async observedServes(): Promise<ObservedServe[]> {
    const listed = (await this.link.request("native.mesh.serve.list", {})) as {
      serves?: unknown;
    };
    if (!Array.isArray(listed.serves)) return [];
    const out: ObservedServe[] = [];
    for (const raw of listed.serves) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      const name = entry["name"];
      const serveId = typeof entry["serveId"] === "string" ? entry["serveId"] : name;
      const listenPort = entry["listenPort"];
      if (
        typeof name !== "string" ||
        typeof serveId !== "string" ||
        typeof listenPort !== "number" ||
        !Number.isInteger(listenPort)
      ) {
        continue;
      }
      out.push({
        serveId,
        name,
        listenPort,
        ...(typeof entry["url"] === "string" ? { url: entry["url"] } : {}),
      });
    }
    return out;
  }

  /** The fused public view: every DESIRED serve, its reconcile outcome fused with
   * live runtime status. Runtime-only entries (present on the node but not
   * desired here) are never surfaced. */
  serves(): ServeState[] {
    const out: ServeState[] = [];
    for (const [serveId, spec] of this.desired) {
      const rec = this.states.get(serveId) ?? { ...spec, status: "pending" as const };
      out.push(this.fuse(rec));
    }
    return out;
  }

  reconcile(): Promise<void> {
    return this.enqueue(() => this.doReconcile());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doReconcile(): Promise<void> {
    try {
      const listed = (await this.link.request("native.mesh.serve.list", {})) as {
        serves: Array<{ serveId?: string; name: string; url?: string; listenPort?: number }>;
      };
      const live = new Map(listed.serves.map((s) => [s.serveId ?? s.name, s]));

      // Remove managed strays before adding replacements. A failure deliberately
      // retains states[id], so the next reconcile really retries it.
      for (const [serveId] of live) {
        // AH-1 owns artifact removals with a durable retiringServeIds queue.
        // A generic best-effort removal here would bypass that checkpoint and
        // make an outliving listener invisible after a crash.
        if (serveId.startsWith(ARTIFACT_SERVE_PREFIX)) continue;
        if (!this.desired.has(serveId) && this.states.has(serveId)) {
          try {
            await this.link.request("native.mesh.serve.remove", { serveId });
            this.states.delete(serveId);
            this.runtime.delete(serveId);
            this.placed.delete(serveId);
            live.delete(serveId);
          } catch (error) {
            if (error instanceof RpcCallError && error.kind === "NOT_FOUND") {
              this.states.delete(serveId);
              this.runtime.delete(serveId);
              this.placed.delete(serveId);
              live.delete(serveId);
            }
            // Any other failure keeps the tracking record for the next pass.
          }
        }
      }

      for (const [serveId, spec] of this.desired) {
        const existing = live.get(serveId);
        // AH-1's artifact serves are adopted as before: their own durable
        // remove-before-add queue owns what a restart left behind.
        if (
          existing !== undefined &&
          (this.placed.has(serveId) || serveId.startsWith(ARTIFACT_SERVE_PREFIX))
        ) {
          this.states.set(serveId, {
            ...spec,
            status: "active",
            ...(existing.url ? { url: existing.url } : {}),
          });
          continue; // keep runtime — the node's live status is the truth
        }
        if (existing !== undefined) {
          // P0-S — a serve this client never placed is a PREDECESSOR's. The
          // floor outlives fieldd, so a fieldd that restarts under it finds its
          // own old `product` serve still listed — aimed at the dead control
          // port, gated by the old per-boot path secret — and adopting it left
          // the phone's door forwarding to nothing until the floor itself
          // restarted (measured 2026-09-24: the target stayed 52522 six seconds
          // after the new fieldd bound 52527). `serve.list` carries no target,
          // secret or allow to compare, so first sight REPLACES: remove, then
          // add. truffle's proxy has no update; the one blink is on a listener
          // whose backend is already gone.
          try {
            await this.link.request("native.mesh.serve.remove", { serveId });
          } catch (error) {
            if (!(error instanceof RpcCallError && error.kind === "NOT_FOUND")) {
              this.states.set(serveId, {
                ...spec,
                status: "error",
                error: `a predecessor's serve could not be replaced: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
              continue; // not placed, so the next reconcile tries again
            }
          }
          this.runtime.delete(serveId);
        }
        try {
          const added = (await this.link.request(
            "native.mesh.serve.add",
            contractValidSpec(spec),
          )) as {
            url?: string;
          };
          this.placed.add(serveId);
          this.states.set(serveId, {
            ...spec,
            status: "active",
            ...(added.url ? { url: added.url } : {}),
          });
          // a fresh proxy — discard any stale runtime status; the node's started
          // event refreshes it (this is how a stopped serve "flips back")
          this.runtime.delete(serveId);
        } catch (e) {
          this.states.set(serveId, {
            ...spec,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      this.emit("reconciled", this.serves());
      // C3: with the node reachable, ensure the serve runtime stream is live so
      // ProxyEvents fuse into serves(). Idempotent — subscribes once, then
      // NativeLink replays it (fresh snapshot) on every reconnect.
      await this.ensureServeSubscription();
      this.emitServesChanged();
    } catch (e) {
      // mesh not up (disabled/auth pending) — mark everything pending, not failed
      if (e instanceof RpcCallError && e.kind === "UNAVAILABLE") {
        for (const [serveId, spec] of this.desired) {
          const prev = this.states.get(serveId);
          if (prev?.status !== "active") this.states.set(serveId, { ...spec, status: "pending" });
        }
        this.emit("unavailable", e.details);
        this.emitServesChanged();
      } else {
        throw e;
      }
    }
  }

  // ---- C3 serve runtime stream (fuse node ProxyEvents into serves()) ----

  /** Subscribe to the serve runtime stream exactly once. UNAVAILABLE (mesh
   * disabled / node not up) is a normal answer — stay unsubscribed and pending;
   * the next successful reconcile retries. Never throws (tolerant): a subscribe
   * failure must not break the reconcile chain. */
  private async ensureServeSubscription(): Promise<void> {
    if (this.serveSubscribed) return;
    try {
      const { snapshot } = await this.link.subscribe(
        "native.mesh.serve.subscribe",
        {},
        (payload, kind) => this.onServeEvent(payload, kind),
      );
      this.serveSubscribed = true;
      this.applyServeSnapshot(snapshot);
      this.emitServesChanged();
    } catch {
      // UNAVAILABLE (mesh disabled) or a transient subscribe failure: stay
      // unsubscribed; serves keep their reconcile verdict, the next pass retries.
    }
  }

  /** Runtime stream handler. kind "snapshot" (subscribe result, reconnect replay,
   * or a broadcast-lag re-snapshot) replaces runtime state wholesale; kind
   * "delta" merges one PARTIAL entry by serveId. */
  private onServeEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (kind === "snapshot") this.applyServeSnapshot(payload);
    else {
      const entry = coerceRuntimeEntry(payload);
      if (entry) this.mergeRuntime(entry);
    }
    this.emitServesChanged();
  }

  /** Wholesale replace: the snapshot is `{ serves: FullEntry[] }` (a bare array is
   * tolerated). Each entry carries live status; entries absent from the snapshot
   * lose their runtime layer and fall back to the reconcile verdict. */
  private applyServeSnapshot(payload: unknown): void {
    this.runtime.clear();
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { serves?: unknown } | null)?.serves)
        ? (payload as { serves: unknown[] }).serves
        : [];
    for (const raw of list) {
      const entry = coerceRuntimeEntry(raw);
      if (entry) this.mergeRuntime(entry);
    }
  }

  /** Merge one entry into the runtime layer by serveId. Deltas are PARTIAL — a
   * stopped entry carries no url, so url is STICKY (last-known carried forward);
   * error is scoped to error runs (cleared on any healthy/transitional status so
   * a later stop never shows a stale message). */
  private mergeRuntime(entry: { name: string } & Partial<RuntimeEntry>): void {
    const existing = this.runtime.get(entry.name);
    const status = entry.status ?? existing?.status ?? "running";
    const url = entry.url ?? existing?.url;
    const error = entry.error ?? (status === "error" ? existing?.error : undefined);
    const value: RuntimeEntry = { status };
    if (url !== undefined) value.url = url;
    if (status === "error" && error !== undefined) value.error = error;
    this.runtime.set(entry.name, value);
  }

  /** Fuse one serve's reconcile record with its live runtime status. Runtime
   * status, when known, refines the reconcile verdict (running→active,
   * starting/stopped→pending, error→error) and carries the runtime url/error;
   * with no runtime signal the reconcile verdict stands. */
  private fuse(rec: ServeState): ServeState {
    const rt = this.runtime.get(serveKey(rec));
    if (rt === undefined) return { ...rec };
    const status = RUNTIME_TO_STATUS[rt.status];
    const out: ServeState = { ...rec, status };
    const url = rt.url ?? rec.url;
    if (url !== undefined) out.url = url;
    else delete out.url;
    if (status === "error") {
      const msg = rt.error ?? rec.error;
      if (msg !== undefined) out.error = msg;
      else delete out.error;
    } else {
      delete out.error;
    }
    return out;
  }

  /** Emit "serves-changed" only on an actual transition of the fused view. */
  private emitServesChanged(): void {
    const states = this.serves();
    const sig = JSON.stringify(states);
    if (sig === this.lastServesSig) return;
    this.lastServesSig = sig;
    this.emit("serves-changed", states);
  }

  // ---- thin passthroughs ----

  async peers(): Promise<unknown[]> {
    const r = (await this.link.request("native.mesh.peers.list", {})) as { peers: unknown[] };
    return r.peers;
  }

  async subscribePeers(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<unknown> {
    const { snapshot } = await this.link.subscribe("native.mesh.peers.subscribe", {}, onEvent);
    return snapshot;
  }

  async openStore(storeId: string): Promise<unknown> {
    return await this.link.request("native.mesh.store.open", { storeId });
  }

  async setSlice(storeId: string, data: unknown): Promise<unknown> {
    return await this.link.request("native.mesh.store.set", { storeId, data });
  }

  async getSlice(storeId: string, deviceId?: string): Promise<unknown> {
    return await this.link.request("native.mesh.store.get", {
      storeId,
      ...(deviceId ? { deviceId } : {}),
    });
  }

  async subscribeStore(
    storeId: string,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<unknown> {
    const { snapshot } = await this.link.subscribe(
      "native.mesh.store.subscribe",
      { storeId },
      onEvent,
    );
    return snapshot;
  }

  async subscribeStoreManaged(
    storeId: string,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }> {
    return await this.link.subscribe("native.mesh.store.subscribe", { storeId }, onEvent);
  }

  // ---- DS-1 egress (design-02 §2.4's egress bullet; shapes in contracts mgmt.ts) ----
  //
  // Thin, but not blind: every answer is held to its contract before a caller
  // sees it, and every ask is held to it before the wire does (the F-H3 law
  // `contractValidSpec` states for serves). A refusal is the floor's
  // `RpcCallError`, untouched — `egress.ts` reads its details, because an
  // UNAVAILABLE here is an ANSWER (`egress-unsupported`, `mesh-down`), not a
  // transport failure to retry.

  /** E1 — the node's own SOCKS5 proxy and its credential. */
  async egressProxy(): Promise<MeshEgressProxy> {
    return egressAnswer(
      MeshEgressProxy,
      "native.mesh.egress.proxy",
      await this.link.request("native.mesh.egress.proxy", {}),
    );
  }

  /** E3 — the node's authenticated HTTP CONNECT proxy. */
  async egressHttpProxy(): Promise<MeshEgressProxy> {
    return egressAnswer(
      MeshEgressProxy,
      "native.mesh.egress.httpProxy",
      await this.link.request("native.mesh.egress.httpProxy", {}),
    );
  }

  /** E2 — bind (or re-answer) a loopback route to a fixed tailnet target. */
  async egressRouteAdd(params: MeshEgressRouteAddParams): Promise<MeshEgressRouteBound> {
    const ask = MeshEgressRouteAddParams.safeParse(params);
    if (!ask.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `egress route does not match MeshEgressRouteAddParams (${issues(ask.error)})`,
        false,
      );
    }
    return egressAnswer(
      MeshEgressRouteBound,
      "native.mesh.egress.route.add",
      await this.link.request("native.mesh.egress.route.add", params),
    );
  }

  /** E2 — drop a route. NOT_FOUND (already gone) is the floor's to say. */
  async egressRouteRemove(id: string): Promise<MeshEgressRouteRef> {
    return egressAnswer(
      MeshEgressRouteRef,
      "native.mesh.egress.route.remove",
      await this.link.request("native.mesh.egress.route.remove", { id }),
    );
  }

  /** E2 — the node's route table. */
  async egressRouteList(): Promise<MeshEgressRouteTable> {
    return egressAnswer(
      MeshEgressRouteTable,
      "native.mesh.egress.route.list",
      await this.link.request("native.mesh.egress.route.list", {}),
    );
  }

  /** E2 — the route table's stream: the snapshot now, then the WHOLE table on
   * every move. An emptied table is the facade's reset (a node teardown or
   * rebuild), and NativeLink replays the subscription on reconnect with a
   * fresh snapshot, so a floor restart reads the same way (P5). A payload
   * outside the contract is dropped, never guessed at. */
  async subscribeEgressRoutes(
    onTable: (table: MeshEgressRouteTable) => void,
  ): Promise<{ snapshot: MeshEgressRouteTable; dispose: () => void }> {
    const { snapshot, dispose } = await this.link.subscribe(
      "native.mesh.egress.route.subscribe",
      {},
      (payload) => {
        const table = MeshEgressRouteTable.safeParse(payload);
        if (table.success) onTable(table.data);
      },
    );
    try {
      return {
        snapshot: egressAnswer(
          MeshEgressRouteTable,
          "native.mesh.egress.route.subscribe",
          snapshot,
        ),
        dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  }
}

/** What `egressAnswer` needs of a contract schema — structural, so fieldd
 * reads zod's `safeParse` without depending on zod itself. */
interface Contract<T> {
  safeParse(raw: unknown): { success: true; data: T } | { success: false; error: ContractIssues };
}
interface ContractIssues {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}

/** Hold a floor's egress answer to its contract. The floor outlives fieldd, so
 * a skewed floor is an ordinary case; a shape outside the contract is an
 * INTERNAL failure with the reason, never a partially trusted value. */
function egressAnswer<T>(schema: Contract<T>, method: string, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new RpcCallError(
    "INTERNAL",
    `${method} answered outside its contract (${issues(parsed.error)})`,
    false,
  );
}

function issues(error: ContractIssues): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

/** Tolerant reader for a serve stream entry — full (snapshot) or partial (delta).
 * `status` is validated against the contract enum; a missing name is the only
 * hard reject. */
function coerceRuntimeEntry(raw: unknown): ({ name: string } & Partial<RuntimeEntry>) | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const serveId = typeof o["serveId"] === "string" ? o["serveId"] : o["name"];
  if (typeof serveId !== "string") return null;
  const out: { name: string } & Partial<RuntimeEntry> = { name: serveId };
  const st = ServeStatus.safeParse(o["status"]);
  if (st.success) out.status = st.data;
  if (typeof o["url"] === "string") out.url = o["url"];
  if (typeof o["error"] === "string") out.error = o["error"];
  return out;
}

/** EL9 / contracts-first (F-H3, 2026-09-14) — the spec as THE CONTRACT
 * describes it, or a throw before a byte reaches the node.
 *
 * `ServeConfig` is what the floor's mgmt handler and the typify'd Rust twin are
 * both built from, and this client used to forward whatever a caller handed it.
 * That is how the terminal listener's `target: {kind: "routes"}` and its
 * `routes` array shipped for a whole slice while the contract still described
 * two target arms and no routes at all: the wire moved and the golden fixture
 * kept pinning a shape nothing on this seam sent. A parse here is what makes
 * that impossible to repeat — a spec the contract cannot describe never
 * reaches the wire, and lands in the serve's `error` state with the reason
 * instead of silently becoming a live proxy.
 *
 * The SPEC is returned, never zod's output: this VALIDATES, it does not
 * reshape. (The schema is `.passthrough()`, so a caller's unknown fields ride
 * along exactly as the tolerant-reader law says they must.) */
function contractValidSpec(spec: ServeSpec): ServeSpec {
  const parsed = ServeConfig.safeParse(spec);
  if (parsed.success) return spec;
  const why = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  throw new Error(`serve "${serveKey(spec)}" does not match ServeConfig (${why})`);
}

function serveKey(spec: Pick<ServeSpec, "serveId" | "name">): string {
  return spec.serveId ?? spec.name;
}
