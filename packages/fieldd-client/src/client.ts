import { type ClientKind, CONTRACTS_VERSION } from "@vibefield/contracts";

// @vibefield/fieldd-client — the isomorphic product-plane client (design-03
// A6): runs in the Electron renderer, plugin workers, AND the shell main
// process on the global WebSocket (browser / Node ≥22). No node: imports here.
//
// Carries the NativeLink lessons forward (review 2026-07-21):
// - subId routes install synchronously while the subscribe response is
//   processed, never after an await;
// - reconnect scheduling is idempotent (single timer), stale-socket events are
//   ignored, and every reconnect replays subscriptions with a FRESH snapshot
//   (P5 — reconnect = re-snapshot);
// - INCOMPATIBLE / UNAUTHORIZED / PRECONDITION_FAILED at hello are terminal:
//   retrying with the same token/version can never succeed.

export class FielddRpcError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: unknown,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "FielddRpcError";
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
  webSocket?: WsCtor; // override for tests / exotic hosts
  maxBackoffMs?: number;
}

export interface Subscription {
  subId: string;
  snapshot: unknown;
  unsubscribe: () => void;
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
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: FielddRpcError) => void;
  subKey?: number;
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
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private closedByUser = false;

  constructor(private readonly opts: FielddClientOptions) {}

  /** Idempotent: starts (or resumes) connecting. */
  connect(): void {
    if (this.closedByUser || this.status === "failed") return;
    if (this.ws || this.reconnectTimer) return;
    this.dial();
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

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.ready();
    return await this.sendRequest(method, params);
  }

  /** Snapshot-then-delta subscription; survives reconnects (fresh snapshot each time). */
  async subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: SubEventKind) => void,
  ): Promise<Subscription> {
    const key = this.nextSubKey++;
    const entry: SubEntry = { method, params, onEvent };
    this.subs.set(key, entry);
    try {
      await this.ready();
      const res = (await this.sendRequest(method, params, key)) as {
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
    this.setStatus("closed");
    this.flushReadyWaiters(new FielddRpcError("UNAVAILABLE", "client closed"));
  }

  // ---- internals ----

  private dial(): void {
    const WS = this.opts.webSocket ?? (globalThis as { WebSocket?: WsCtor }).WebSocket;
    if (!WS) {
      this.fail(new FielddRpcError("UNAVAILABLE", "no WebSocket implementation in this host"));
      return;
    }
    this.setStatus(this.attempts === 0 ? "connecting" : "reconnecting");
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
        ...(this.opts.token !== "" ? { credential: this.opts.token } : {}),
        ...(this.opts.deviceId !== undefined ? { deviceId: this.opts.deviceId } : {}),
      })) as { grantedScopes?: string[] };
      if (this.ws !== ws) return; // superseded by a newer dial while awaiting
      this.grantedScopes = ack.grantedScopes ?? [];
      this.attempts = 0;
      this.setStatus("ready");
      this.flushReadyWaiters(null);
      await this.replaySubscriptions();
    } catch (e) {
      if (this.ws !== ws) return;
      const kind = e instanceof FielddRpcError ? e.kind : "INTERNAL";
      if (kind === "INCOMPATIBLE" || kind === "UNAUTHORIZED" || kind === "PRECONDITION_FAILED") {
        // terminal: the same token/version can never succeed — do not retry
        this.fail(e instanceof FielddRpcError ? e : new FielddRpcError(kind, String(e)));
        return;
      }
      ws.close(); // transient — the close event schedules the reconnect
    }
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
    }
  }

  private onClose(ws: WsLike): void {
    if (ws !== this.ws) return; // stale socket
    this.ws = null;
    this.failPending();
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
      this.dial();
    }, delay);
  }

  private async replaySubscriptions(): Promise<void> {
    for (const [key, sub] of this.subs) {
      if (!sub.sentOnce) continue; // still owned by its pending subscribe() call
      const res = (await this.sendRequest(sub.method, sub.params, key)) as { snapshot: unknown };
      sub.onEvent(res.snapshot, "snapshot"); // P5: reconnect = fresh snapshot
    }
  }

  private unsubscribeKey(key: number): void {
    const entry = this.subs.get(key);
    this.subs.delete(key);
    if (entry?.subId) {
      this.subRoutes.delete(entry.subId);
      if (this.status === "ready")
        void this.sendRequest("system.unsubscribe", { subId: entry.subId }).catch(() => {});
    }
  }

  private sendRequest(method: string, params: unknown, subKey?: number): Promise<unknown> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new FielddRpcError("UNAVAILABLE", "not connected", true));
    if (subKey !== undefined) {
      const sub = this.subs.get(subKey);
      if (sub) sub.sentOnce = true;
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      if (subKey !== undefined) entry.subKey = subKey;
      this.pending.set(id, entry);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private failPending(): void {
    for (const [, p] of this.pending) {
      if (p.subKey !== undefined) this.subs.delete(p.subKey); // its caller saw the rejection
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
