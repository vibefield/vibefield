import { EventEmitter } from "node:events";
import { ARTIFACT_SERVE_PREFIX, ServeStatus } from "@vibefield/contracts";
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
    | { kind: "dir"; path: string; fallback?: "/index.html" };
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
            live.delete(serveId);
          } catch (error) {
            if (error instanceof RpcCallError && error.kind === "NOT_FOUND") {
              this.states.delete(serveId);
              this.runtime.delete(serveId);
              live.delete(serveId);
            }
            // Any other failure keeps the tracking record for the next pass.
          }
        }
      }

      for (const [serveId, spec] of this.desired) {
        const existing = live.get(serveId);
        if (existing) {
          this.states.set(serveId, {
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

function serveKey(spec: Pick<ServeSpec, "serveId" | "name">): string {
  return spec.serveId ?? spec.name;
}
