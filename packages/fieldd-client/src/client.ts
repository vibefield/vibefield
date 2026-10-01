import {
  type ClientKind,
  CONTRACTS_VERSION,
  PRODUCT_NOTIFICATIONS,
  SystemTick,
} from "@vibefield/contracts";

// @vibefield/fieldd-client — the isomorphic product-plane client (design-03
// A6): runs in the Electron renderer, plugin workers, AND the shell main
// process on the global WebSocket (browser / Node ≥22). No node: imports here.
//
// Carries the NativeLink lessons forward (review 2026-07-21):
// - subId routes install synchronously while the subscribe response is
//   processed, never after an await;
// - reconnect scheduling is idempotent (single timer), stale-socket events are
//   ignored, and every reconnect replays subscriptions with a FRESH snapshot
//   (P5 — reconnect = re-snapshot), carrying the params its owner supplies at
//   that moment (`SubscribeOptions.params` — a resumable subscription's
//   CURRENT cursor, never the one it first attached with);
// - INCOMPATIBLE / UNAUTHORIZED / PRECONDITION_FAILED at hello are terminal:
//   retrying with the same token/version can never succeed;
// - a REPLAY's refusal belongs to its subscription, never to the client (the
//   DS landing review's S3, 2026-10-01): replay runs after hello's verdict, one
//   subscription at a time, and a refused replay ends only that subscription —
//   its owner hears it (`onReplayFailed`) and re-attaches on its own terms —
//   while `ready`, the socket and every other subscription stand. Replay used
//   to run inside hello's try: one refused replay closed the socket, and one
//   refused with a terminal kind failed the whole client (through PeerLink, a
//   peer's restart dropped every subscription standing on the shared link).

export class FielddRpcError extends Error {
  // plain fields, no TS parameter properties: plugin workers import this file
  // under Node's strip-only type erasure, which cannot rewrite ctor sugar (P5)
  readonly kind: string;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly code?: number;

  constructor(kind: string, message: string, retryable = false, details?: unknown, code?: number) {
    super(message);
    this.name = "FielddRpcError";
    this.kind = kind;
    this.retryable = retryable;
    if (details !== undefined) this.details = details;
    if (code !== undefined) this.code = code;
  }
}

/** Structural WebSocket shape (browser + Node undici both satisfy it). */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: unknown) => void): void;
  readyState: number;
}
export type WsCtor = new (url: string) => WsLike;

export type FielddClientStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "closed"
  | "failed";

export interface FielddClientOptions {
  url: string; // e.g. ws://127.0.0.1:9410
  /** empty string = no credential in hello (C5: peer dials ride the tailnet
   * door's WhoIs grant — a token would be wrong there, not just absent) */
  token: string;
  clientKind?: ClientKind;
  /** C5/D32 — the peer-fieldd identity claim, sent in hello (label only;
   * honored solely on a tailnet door — see contracts Hello.deviceId) */
  deviceId?: string;
  /** UA-2 — the EXPECTED user of the daemon being dialed; a configured daemon
   * refuses a mismatch INCOMPATIBLE (restrict-only — see contracts Hello.userId) */
  userId?: string;
  webSocket?: WsCtor; // override for tests / exotic hosts
  maxBackoffMs?: number;
  /** SP-1 / SP-L7 — the door's keepalive: every hello'd connection hears
   * `system.tick {at, intervalMs}` (`PRODUCT_API_LIMITS.TICK_INTERVAL_MS`). A
   * reader that keeps a dead-door deadline resets it here (any inbound frame is
   * liveness; a door silent for 2.5 × intervalMs is dead). A tick whose params
   * do not read is not a tick; without `onTick` the frame is taken quietly. */
  onTick?: (tick: { at: number; intervalMs: number }) => void;
}

export interface Subscription {
  subId: string;
  snapshot: unknown;
  unsubscribe: () => void;
}

/** Per-subscription choices for a replay (S3, 2026-10-01). */
export interface SubscribeOptions {
  /** The params a REPLAY carries, read when it is sent: a reconnect re-sends
   * every standing subscribe, and a resumable subscription asks from where its
   * owner IS — its current cursor — not from where it first attached. The
   * initial subscribe sends the `params` argument. */
  params?: () => unknown;
  /** The daemon REFUSED this subscription's replay: the subscription is over
   * on this client (no route, never replayed again) and its owner decides what
   * follows — its own cursor, its own backoff. Nothing else on the client
   * moves. With no owner, a RETRYABLE refusal is re-asked by the client alone,
   * on the reconnect backoff, and any other refusal ends the subscription. */
  onReplayFailed?: (error: FielddRpcError) => void;
}

type SubEventKind = "snapshot" | "delta";

interface SubEntry {
  method: string;
  params: unknown;
  onEvent: (payload: unknown, kind: SubEventKind) => void;
  subId?: string;
  /** true once a subscribe request for this entry has reached a live socket —
   * only such entries are replayed on reconnect (unsent ones are still owned
   * by their pending subscribe() call). */
  sentOnce?: boolean;
  /** SubscribeOptions.params — read when a replay is sent */
  replayParams?: () => unknown;
  /** SubscribeOptions.onReplayFailed */
  onReplayFailed?: (error: FielddRpcError) => void;
  /** a retryable replay refusal nobody owns: the client's own re-ask of this
   * one subscription, and how many came before it (the backoff) */
  replayRetry?: ReturnType<typeof setTimeout> | undefined;
  replayRetries?: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: FielddRpcError) => void;
  subKey?: number;
  /** Initial subscribe has a waiting caller that cannot receive a replacement handle after a
   * disconnect. Replay already has an established owner and must preserve its entry. */
  dropSubOnFailure?: boolean;
}

export class FielddClient {
  status: FielddClientStatus = "idle";
  grantedScopes: string[] = [];
  lastError: FielddRpcError | null = null;

  private ws: WsLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<number, SubEntry>();
  private subRoutes = new Map<string, number>(); // subId -> local sub key
  private nextSubKey = 1;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<() => void>();
  private notificationListeners = new Map<string, Set<(params: unknown) => void>>();
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private closedByUser = false;
  private credential: string;

  // no TS parameter property: the worker harness imports this file under
  // Node's strip-only type erasure, which cannot rewrite ctor sugar (P5)
  private readonly opts: FielddClientOptions;

  constructor(opts: FielddClientOptions) {
    this.opts = opts;
    this.credential = opts.token;
  }

  /** The dial target — P3b: plugin-bound sibling clients connect to the same
   * daemon this client reached (never a credential, just the address). */
  get url(): string {
    return this.opts.url;
  }

  /** Idempotent: starts (or resumes) connecting. */
  connect(): void {
    if (this.closedByUser || this.status === "failed") return;
    if (this.ws || this.reconnectTimer) return;
    this.dial(false);
  }

  /**
   * Rebinds this exact client to a fresh bearer credential.
   *
   * The authority edge is synchronous: old granted scopes disappear and the old socket detaches
   * before this returns. Established subscriptions remain owned and replay with fresh snapshots
   * after the new hello. Pending unary calls and not-yet-established subscriptions reject against
   * the retired connection. A user-closed client is terminal and cannot be reopened by rotation.
   */
  rotateCredential(credential: string): void {
    if (this.closedByUser || credential === this.credential) return;
    this.credential = credential;
    this.grantedScopes = [];
    this.lastError = null;

    const reconnecting =
      this.ws !== null ||
      this.reconnectTimer !== null ||
      this.status === "connecting" ||
      this.status === "ready" ||
      this.status === "reconnecting" ||
      this.status === "failed";
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "credential rotated");
    this.failPending();
    this.clearReplayRetries();
    this.subRoutes.clear();
    this.attempts = 0;

    if (!reconnecting) return;
    this.setStatus("reconnecting");
    this.dial(true);
  }

  /** Resolves when hello has succeeded; rejects if the client is dead. */
  ready(): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.status === "failed" || this.status === "closed")
      return Promise.reject(
        this.lastError ?? new FielddRpcError("UNAVAILABLE", `client ${this.status}`),
      );
    this.connect();
    return new Promise((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject });
    });
  }

  onStatusChange(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Server-originated control notifications that are not subscriptions.
   * Used by Electron main's static shell provider; listeners survive automatic
   * reconnects on this client and are removed explicitly or on close(). */
  onNotification(method: string, fn: (params: unknown) => void): () => void {
    let listeners = this.notificationListeners.get(method);
    if (listeners === undefined) {
      listeners = new Set();
      this.notificationListeners.set(method, listeners);
    }
    listeners.add(fn);
    return () => {
      listeners?.delete(fn);
      if (listeners?.size === 0) this.notificationListeners.delete(method);
    };
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.ready();
    return await this.sendRequest(method, params);
  }

  /** Snapshot-then-delta subscription; survives reconnects (fresh snapshot each time) —
   * unless the daemon refuses its replay (`SubscribeOptions`). */
  async subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: SubEventKind) => void,
    opts?: SubscribeOptions,
  ): Promise<Subscription> {
    const key = this.nextSubKey++;
    const entry: SubEntry = {
      method,
      params,
      onEvent,
      ...(opts?.params !== undefined ? { replayParams: opts.params } : {}),
      ...(opts?.onReplayFailed !== undefined ? { onReplayFailed: opts.onReplayFailed } : {}),
    };
    this.subs.set(key, entry);
    try {
      await this.ready();
      const res = (await this.sendRequest(method, params, key, true)) as {
        subId: string;
        snapshot: unknown;
      };
      return {
        subId: res.subId,
        snapshot: res.snapshot,
        unsubscribe: () => this.unsubscribeKey(key),
      };
    } catch (e) {
      this.subs.delete(key); // never leave an orphan the caller can't cancel
      throw e;
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.failPending();
    this.clearReplayRetries();
    this.subs.clear();
    this.subRoutes.clear();
    this.notificationListeners.clear();
    this.setStatus("closed");
    this.flushReadyWaiters(new FielddRpcError("UNAVAILABLE", "client closed"));
  }

  // ---- internals ----

  private dial(reconnecting: boolean): void {
    const WS = this.opts.webSocket ?? (globalThis as { WebSocket?: WsCtor }).WebSocket;
    if (!WS) {
      this.fail(new FielddRpcError("UNAVAILABLE", "no WebSocket implementation in this host"));
      return;
    }
    this.setStatus(reconnecting ? "reconnecting" : "connecting");
    const ws = new WS(this.opts.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws === ws) void this.hello(ws);
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws === ws) this.onMessage(String((ev as { data: unknown }).data));
    });
    ws.addEventListener("close", () => this.onClose(ws));
    ws.addEventListener("error", () => {
      /* close follows */
    });
  }

  private async hello(ws: WsLike): Promise<void> {
    try {
      const ack = (await this.sendRequest("system.hello", {
        contractsVersion: CONTRACTS_VERSION,
        minCompatible: CONTRACTS_VERSION,
        clientKind: this.opts.clientKind ?? "renderer",
        ...(this.credential !== "" ? { credential: this.credential } : {}),
        ...(this.opts.deviceId !== undefined ? { deviceId: this.opts.deviceId } : {}),
        ...(this.opts.userId !== undefined ? { userId: this.opts.userId } : {}),
      })) as { grantedScopes?: string[] };
      if (this.ws !== ws) return; // superseded by a newer dial while awaiting
      this.grantedScopes = ack.grantedScopes ?? [];
      this.attempts = 0;
      this.setStatus("ready");
      this.flushReadyWaiters(null);
    } catch (e) {
      if (this.ws !== ws) return;
      const kind = e instanceof FielddRpcError ? e.kind : "INTERNAL";
      if (kind === "INCOMPATIBLE" || kind === "UNAUTHORIZED" || kind === "PRECONDITION_FAILED") {
        // terminal: the same token/version can never succeed — do not retry
        this.fail(e instanceof FielddRpcError ? e : new FielddRpcError(kind, String(e)));
        return;
      }
      ws.close(); // transient — the close event schedules the reconnect
      return;
    }
    // S3 — the hello's verdict stands from here: what a replay meets is its
    // subscription's own (replaySubscriptions never throws)
    await this.replaySubscriptions(ws);
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // tolerant reader: garbage frames never fatal
    }
    const id = msg["id"];
    if (typeof id === "number") {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      const err = msg["error"] as
        | {
            code?: number;
            message?: string;
            data?: { kind?: string; retryable?: boolean; details?: unknown };
          }
        | undefined;
      if (err) {
        p.reject(
          new FielddRpcError(
            err.data?.kind ?? "INTERNAL",
            err.message ?? "rpc error",
            err.data?.retryable ?? false,
            err.data?.details,
            err.code,
          ),
        );
        return;
      }
      // install the subscription route BEFORE resolving (same-frame safety +
      // replay bookkeeping — the NativeLink lesson, kept on principle)
      if (p.subKey !== undefined) {
        const subId = (msg["result"] as { subId?: unknown } | undefined)?.subId;
        if (typeof subId === "string") {
          this.subRoutes.set(subId, p.subKey);
          const sub = this.subs.get(p.subKey);
          if (sub) sub.subId = subId;
        }
      }
      p.resolve(msg["result"]);
      return;
    }
    const method = msg["method"] as string | undefined;
    const params = msg["params"] as { subId?: string; payload?: unknown } | undefined;
    if (params?.subId && (method?.endsWith(".delta") || method?.endsWith(".snapshot"))) {
      const key = this.subRoutes.get(params.subId);
      const sub = key === undefined ? undefined : this.subs.get(key);
      sub?.onEvent(params.payload, method.endsWith(".snapshot") ? "snapshot" : "delta");
      return;
    }
    if (method === PRODUCT_NOTIFICATIONS.TICK && this.opts.onTick !== undefined) {
      const tick = SystemTick.safeParse(msg["params"]);
      if (tick.success) {
        try {
          this.opts.onTick({ at: tick.data.at, intervalMs: tick.data.intervalMs });
        } catch {
          // a consumer's bug never breaks response/subscription routing
        }
      }
    }
    if (method !== undefined) {
      for (const listener of [...(this.notificationListeners.get(method) ?? [])]) {
        try {
          listener(msg["params"]);
        } catch {
          // One consumer cannot break response/subscription routing for peers.
        }
      }
    }
  }

  private onClose(ws: WsLike): void {
    if (ws !== this.ws) return; // stale socket
    this.ws = null;
    this.failPending();
    this.clearReplayRetries(); // the next hello replays every standing subscription
    this.subRoutes.clear();
    if (this.closedByUser || this.status === "failed" || this.status === "closed") return;
    this.scheduleReconnect();
  }

  /** Idempotent: at most one reconnect timer exists at any moment. */
  private scheduleReconnect(): void {
    if (this.closedByUser || this.status === "failed") return;
    if (this.reconnectTimer || this.ws) return;
    const delay = Math.min(500 * 2 ** this.attempts, this.opts.maxBackoffMs ?? 10_000);
    this.attempts += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial(true);
    }, delay);
  }

  /** P5: reconnect = fresh snapshot, one subscription at a time. Each replay
   * is its own (S3): one the daemon refuses ends alone and its owner hears
   * why, or — retryable, with no owner — the client re-asks it alone; the rest
   * still replay and `ready` stands. A socket lost mid-replay stops the pass:
   * the next hello replays whatever is still standing. Never throws. */
  private async replaySubscriptions(ws: WsLike): Promise<void> {
    for (const [key, sub] of [...this.subs]) {
      if (this.ws !== ws) return;
      // unsent: still owned by its pending subscribe() call; gone: unsubscribed meanwhile
      if (!sub.sentOnce || this.subs.get(key) !== sub) continue;
      await this.replayOne(ws, key, sub);
    }
  }

  private async replayOne(ws: WsLike, key: number, sub: SubEntry): Promise<void> {
    let res: { subId?: unknown; snapshot?: unknown };
    try {
      res = (await this.sendRequest(sub.method, this.replayParams(sub), key)) as typeof res;
    } catch (e) {
      // the socket went under the replay, or its owner left: nothing to judge
      if (this.ws !== ws || this.subs.get(key) !== sub) return;
      const error = e instanceof FielddRpcError ? e : new FielddRpcError("INTERNAL", String(e));
      if (sub.onReplayFailed === undefined && error.retryable) {
        this.retryReplay(ws, key, sub);
        return;
      }
      this.subs.delete(key);
      try {
        sub.onReplayFailed?.(error);
      } catch {
        // the owner's recovery is its own — the other subscriptions still replay
      }
      return;
    }
    if (this.subs.get(key) !== sub) {
      // unsubscribed while the replay was in flight: release what it stood up
      if (typeof res.subId === "string") {
        this.subRoutes.delete(res.subId);
        if (this.ws === ws && this.status === "ready")
          void this.sendRequest("system.unsubscribe", { subId: res.subId }).catch(() => {});
      }
      return;
    }
    sub.replayRetries = 0;
    try {
      sub.onEvent(res.snapshot, "snapshot"); // P5: reconnect = fresh snapshot
    } catch {
      // a consumer's failure is its own — it must not stop the replay pass
    }
  }

  /** A RETRYABLE replay refusal no owner decides: the client asks again for
   * this one subscription, on the reconnect backoff, while the socket that
   * refused it stands (a new socket replays it anyway). */
  private retryReplay(ws: WsLike, key: number, sub: SubEntry): void {
    if (sub.replayRetry !== undefined) clearTimeout(sub.replayRetry);
    const attempt = sub.replayRetries ?? 0;
    sub.replayRetries = attempt + 1;
    const delay = Math.min(500 * 2 ** attempt, this.opts.maxBackoffMs ?? 10_000);
    sub.replayRetry = setTimeout(() => {
      sub.replayRetry = undefined;
      if (this.ws !== ws || this.status !== "ready" || this.subs.get(key) !== sub) return;
      void this.replayOne(ws, key, sub);
    }, delay);
  }

  private clearReplayRetries(): void {
    for (const sub of this.subs.values()) {
      if (sub.replayRetry === undefined) continue;
      clearTimeout(sub.replayRetry);
      sub.replayRetry = undefined;
    }
  }

  /** What a replay asks with: its owner's params NOW, else the first ones. */
  private replayParams(sub: SubEntry): unknown {
    if (sub.replayParams === undefined) return sub.params;
    try {
      return sub.replayParams();
    } catch {
      return sub.params; // the supplier's failure is its owner's; the replay still goes
    }
  }

  private unsubscribeKey(key: number): void {
    const entry = this.subs.get(key);
    this.subs.delete(key);
    if (entry?.replayRetry !== undefined) clearTimeout(entry.replayRetry);
    if (entry?.subId) {
      this.subRoutes.delete(entry.subId);
      if (this.status === "ready")
        void this.sendRequest("system.unsubscribe", { subId: entry.subId }).catch(() => {});
    }
  }

  private sendRequest(
    method: string,
    params: unknown,
    subKey?: number,
    dropSubOnFailure = false,
  ): Promise<unknown> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new FielddRpcError("UNAVAILABLE", "not connected", true));
    if (subKey !== undefined) {
      const sub = this.subs.get(subKey);
      if (sub) sub.sentOnce = true;
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject, ...(dropSubOnFailure ? { dropSubOnFailure } : {}) };
      if (subKey !== undefined) entry.subKey = subKey;
      this.pending.set(id, entry);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private failPending(): void {
    for (const [, p] of this.pending) {
      if (p.subKey !== undefined && p.dropSubOnFailure === true) this.subs.delete(p.subKey);
      p.reject(new FielddRpcError("UNAVAILABLE", "connection closed", true));
    }
    this.pending.clear();
  }

  private fail(e: FielddRpcError): void {
    this.lastError = e;
    const ws = this.ws;
    this.ws = null; // detach first — the socket's close event is now stale
    this.setStatus("failed");
    ws?.close();
    this.failPending();
    this.clearReplayRetries();
    this.flushReadyWaiters(e);
  }

  private flushReadyWaiters(err: Error | null): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) err ? w.reject(err) : w.resolve();
  }

  private setStatus(s: FielddClientStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn();
  }
}
