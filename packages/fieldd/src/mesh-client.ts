import { EventEmitter } from "node:events";
import { ServeStatus } from "@vibefield/contracts";
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
// entries merged by name; a `.snapshot` (subscribe result, reconnect replay, or
// a broadcast-lag re-snapshot notification) replaces runtime state wholesale.

export interface ServeSpec {
  name: string;
  target: { kind: "port"; port: number } | { kind: "dir"; path: string };
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

/** Live runtime status per serve, keyed by name — a faithful mirror of the node's
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
    this.desired = new Map(specs.map((s) => [s.name, s]));
    await this.reconcile();
    return this.serves();
  }

  /** The fused public view: every DESIRED serve, its reconcile outcome fused with
   * live runtime status. Runtime-only entries (present on the node but not
   * desired here) are never surfaced. */
  serves(): ServeState[] {
    return [...this.states.values()].map((rec) => this.fuse(rec));
  }

  reconcile(): Promise<void> {
    const run = this.chain.then(() => this.doReconcile());
    this.chain = run.catch(() => {});
    return run;
  }

  private async doReconcile(): Promise<void> {
    try {
      const listed = (await this.link.request("native.mesh.serve.list", {})) as {
        serves: Array<{ name: string; url?: string }>;
      };
      const live = new Map(listed.serves.map((s) => [s.name, s]));

      for (const [name, spec] of this.desired) {
        const existing = live.get(name);
        if (existing) {
          this.states.set(name, {
            ...spec,
            status: "active",
            ...(existing.url ? { url: existing.url } : {}),
          });
          continue; // keep runtime — the node's live status is the truth
        }
        try {
          const added = (await this.link.request("native.mesh.serve.add", spec)) as {
            url?: string;
          };
          this.states.set(name, {
            ...spec,
            status: "active",
            ...(added.url ? { url: added.url } : {}),
          });
          // a fresh proxy — discard any stale runtime status; the node's started
          // event refreshes it (this is how a stopped serve "flips back")
          this.runtime.delete(name);
        } catch (e) {
          this.states.set(name, {
            ...spec,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      // strays: live entries we once declared but no longer desire
      for (const [name] of live) {
        if (!this.desired.has(name) && this.states.has(name)) {
          try {
            await this.link.request("native.mesh.serve.remove", { name });
          } catch {
            /* next reconcile retries */
          }
          this.states.delete(name);
          this.runtime.delete(name);
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
        for (const [name, spec] of this.desired) {
          const prev = this.states.get(name);
          if (prev?.status !== "active") this.states.set(name, { ...spec, status: "pending" });
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
   * "delta" merges one PARTIAL entry by name. */
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

  /** Merge one entry into the runtime layer by name. Deltas are PARTIAL — a
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
   * starting→pending, stopped/error→error) and carries the runtime url/error;
   * with no runtime signal the reconcile verdict stands. */
  private fuse(rec: ServeState): ServeState {
    const rt = this.runtime.get(rec.name);
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
}

/** Tolerant reader for a serve stream entry — full (snapshot) or partial (delta).
 * `status` is validated against the contract enum; a missing name is the only
 * hard reject. */
function coerceRuntimeEntry(raw: unknown): ({ name: string } & Partial<RuntimeEntry>) | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["name"] !== "string") return null;
  const out: { name: string } & Partial<RuntimeEntry> = { name: o["name"] };
  const st = ServeStatus.safeParse(o["status"]);
  if (st.success) out.status = st.data;
  if (typeof o["url"] === "string") out.url = o["url"];
  if (typeof o["error"] === "string") out.error = o["error"];
  return out;
}
