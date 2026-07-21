import {
  type DocOpenResult,
  decodeJsonPayload,
  decodeLaneFrame,
  encodeJsonFrame,
  encodeLaneFrame,
  LANE_FRAME,
  LaneErr,
  LaneHelloOk,
  LanePutOk,
} from "@vibefield/contracts";
import { FielddRpcError } from "./client";

// The :9411 doc-lane client (B3, design-01 §4 / D27): a ticketed binary WS the
// renderer dials DIRECTLY — main relays nothing, and doc bytes never touch the
// JSON-RPC control plane (EL2). Isomorphic like FielddClient: global WebSocket
// (browser / Node ≥22).
//
// Ops are strictly serialized — the lane protocol is one request/response pair
// at a time per socket, so a single next-frame waiter is the whole correlation
// model. RECONNECT LAW (thinking-b3-docservice §5): the renderer holds truth
// while it lives — re-attach after a drop is PUT-only (lastPut re-syncs the
// daemon); GET happens once, at the initial attach. An op timeout closes the
// socket outright so a stale reply can never pair with the next op's waiter.

/** Structural binary-capable WebSocket (browser + Node undici both satisfy it). */
export interface LaneWsLike {
  binaryType: string;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: unknown) => void): void;
  readyState: number;
}
export type LaneWsCtor = new (url: string) => LaneWsLike;

export type DocLaneStatus = "idle" | "connecting" | "attached" | "reconnecting" | "closed";

export interface DocLaneClientOptions {
  /** Mints a fresh ticket via `doc.open` on the control plane (tickets are one-shot). */
  openLane: () => Promise<DocOpenResult>;
  webSocket?: LaneWsCtor;
  maxBackoffMs?: number;
  /** Per-op reply deadline; on expiry the socket is closed and the op rejects. */
  opTimeoutMs?: number;
  now?: () => number;
}

export interface DocPutMeta {
  engineSchema: number | null;
  savedAt: number;
}

interface FrameWaiter {
  resolve: (frame: { kind: number; payload: Uint8Array }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DocLaneClient {
  status: DocLaneStatus = "idle";
  lastError: FielddRpcError | null = null;
  /** Wall-clock ms of the last acknowledged PUT (SystemSection reads this). */
  lastPutAt: number | null = null;

  private ws: LaneWsLike | null = null;
  private waiter: FrameWaiter | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastPut: { bytes: Uint8Array; meta: DocPutMeta } | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<() => void>();
  private closedByUser = false;
  private attachedOnce = false;

  constructor(private readonly opts: DocLaneClientOptions) {}

  onStatusChange(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Dial + HELLO. Resolves once the daemon acknowledged the lane. */
  attach(): Promise<{ hasDoc: boolean }> {
    return this.enqueue(() => this.doAttach());
  }

  /** Fetch the at-rest envelope, or null when the daemon has none yet. */
  get(): Promise<Uint8Array | null> {
    return this.enqueue(async () => {
      this.requireAttached();
      this.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
      const reply = await this.nextFrame();
      if (reply.kind === LANE_FRAME.DOC) return reply.payload;
      if (reply.kind === LANE_FRAME.ERR) {
        const err = this.toError(reply.payload);
        if (err.kind === "NOT_FOUND") return null;
        throw err;
      }
      throw this.protocolError(reply.kind);
    });
  }

  /** Persist one envelope (PUT_META + PUT → PUT_OK). Retained for re-sync after drops. */
  put(bytes: Uint8Array, meta: DocPutMeta): Promise<void> {
    this.lastPut = { bytes, meta }; // before the attempt — a failed put still re-syncs later
    return this.enqueue(() => this.doPut(bytes, meta));
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
    this.failWaiter(new FielddRpcError("UNAVAILABLE", "doc lane closed"));
    this.setStatus("closed");
  }

  /** Retire the lane: settle every queued op (a doc switch's final flush PUT
   * included), THEN close — so retiring can never truncate the last save. */
  async drain(): Promise<void> {
    await this.chain.catch(() => {});
    this.close();
  }

  // ---- internals ----

  /** Ops are FIFO and never overlap; a failed op never poisons the chain. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.chain.then(op);
    this.chain = run.catch(() => {});
    return run;
  }

  private async doAttach(): Promise<{ hasDoc: boolean }> {
    if (this.closedByUser) throw new FielddRpcError("UNAVAILABLE", "doc lane closed");
    if (this.ws && this.status === "attached")
      throw new FielddRpcError("CONFLICT", "already attached");
    this.setStatus(this.attachedOnce ? "reconnecting" : "connecting");
    const open = await this.opts.openLane(); // fresh one-shot ticket every dial
    const ws = await this.dial(open.laneUrl);
    this.ws = ws;
    this.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open.ticket }));
    const reply = await this.nextFrame();
    if (reply.kind === LANE_FRAME.ERR) throw this.toError(reply.payload);
    if (reply.kind !== LANE_FRAME.HELLO_OK) throw this.protocolError(reply.kind);
    const ok = LaneHelloOk.parse(decodeJsonPayload(reply.payload));
    this.attempts = 0;
    this.attachedOnce = true;
    this.setStatus("attached");
    return { hasDoc: ok.hasDoc };
  }

  private async doPut(bytes: Uint8Array, meta: DocPutMeta): Promise<void> {
    this.requireAttached();
    this.send(
      encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
        engineSchema: meta.engineSchema,
        savedAt: meta.savedAt,
        byteLength: bytes.byteLength,
      }),
    );
    this.send(encodeLaneFrame(LANE_FRAME.PUT, 0, bytes));
    const reply = await this.nextFrame();
    if (reply.kind === LANE_FRAME.ERR) throw this.toError(reply.payload);
    if (reply.kind !== LANE_FRAME.PUT_OK) throw this.protocolError(reply.kind);
    LanePutOk.parse(decodeJsonPayload(reply.payload));
    this.lastPutAt = (this.opts.now ?? Date.now)();
  }

  private dial(url: string): Promise<LaneWsLike> {
    const WS = this.opts.webSocket ?? (globalThis as { WebSocket?: LaneWsCtor }).WebSocket;
    if (!WS) throw new FielddRpcError("UNAVAILABLE", "no WebSocket implementation in this host");
    const ws = new WS(url);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (ev) => {
      if (this.ws === ws) this.onFrame((ev as { data: unknown }).data);
    });
    ws.addEventListener("close", () => this.onClose(ws));
    return new Promise((resolve, reject) => {
      let settled = false;
      ws.addEventListener("open", () => {
        settled = true;
        resolve(ws);
      });
      ws.addEventListener("error", () => {
        if (!settled) reject(new FielddRpcError("UNAVAILABLE", "doc lane dial failed", true));
      });
    });
  }

  private onFrame(data: unknown): void {
    if (typeof data === "string") return; // lane frames are binary-only; ignore strays
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBufferLike);
    let frame: { kind: number; payload: Uint8Array };
    try {
      frame = decodeLaneFrame(bytes);
    } catch {
      return; // tolerant reader: structural garbage never fatal to the client
    }
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      clearTimeout(w.timer);
      w.resolve(frame);
    }
    // frames with no waiter (server-pushed, future kinds) are ignored by design
  }

  private nextFrame(): Promise<{ kind: number; payload: Uint8Array }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        this.ws?.close(); // a late reply must never pair with the NEXT op's waiter
        reject(new FielddRpcError("TIMEOUT", "doc lane reply timed out", true));
      }, this.opts.opTimeoutMs ?? 15_000);
      this.waiter = { resolve, reject, timer };
    });
  }

  private onClose(ws: LaneWsLike): void {
    if (ws !== this.ws) return; // stale socket
    this.ws = null;
    this.failWaiter(new FielddRpcError("UNAVAILABLE", "doc lane dropped", true));
    if (this.closedByUser) return;
    this.scheduleReattach();
  }

  /** Backoff re-attach; on success the last envelope is re-PUT (daemon re-syncs). */
  private scheduleReattach(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = Math.min(500 * 2 ** this.attempts, this.opts.maxBackoffMs ?? 10_000);
    this.attempts += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.enqueue(async () => {
        if (this.closedByUser || this.ws) return;
        await this.doAttach();
        const last = this.lastPut;
        if (last) await this.doPut(last.bytes, last.meta);
      }).catch((e) => {
        this.lastError =
          e instanceof FielddRpcError ? e : new FielddRpcError("INTERNAL", String(e));
        this.scheduleReattach();
      });
    }, delay);
  }

  private requireAttached(): void {
    if (!this.ws || this.status !== "attached")
      throw new FielddRpcError("UNAVAILABLE", "doc lane not attached", true);
  }

  private send(frame: Uint8Array): void {
    const ws = this.ws;
    if (!ws) throw new FielddRpcError("UNAVAILABLE", "doc lane not attached", true);
    ws.send(frame);
  }

  private toError(payload: Uint8Array): FielddRpcError {
    const parsed = LaneErr.safeParse(decodeJsonPayload(payload));
    if (!parsed.success) return new FielddRpcError("INTERNAL", "malformed lane error");
    return new FielddRpcError(parsed.data.kind, parsed.data.message);
  }

  private protocolError(kind: number): FielddRpcError {
    this.ws?.close(); // desynced — force a clean re-attach
    return new FielddRpcError("INTERNAL", `unexpected lane frame kind ${kind}`, true);
  }

  private failWaiter(e: FielddRpcError): void {
    const w = this.waiter;
    if (!w) return;
    this.waiter = null;
    clearTimeout(w.timer);
    w.reject(e);
  }

  private setStatus(s: DocLaneStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn();
  }
}
