import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { CONTRACTS_VERSION, MESH_CONTROL_LIMITS, TerminalEndpoints } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { computePairingMac } from "./pairing";

// NativeLink (design-02 §3.3): the ONLY door to field-native. Owns the mgmt
// UDS connection: D8 pairing hello, request/response correlation, subscription
// replay on reconnect (P5 — reconnect = fresh snapshot), SUPERSEDED = fatal.
//
// Concurrency invariants (review-hardened):
// - subId routes are installed SYNCHRONOUSLY while processing the subscribe
//   response line, so a delta in the same socket chunk can never be dropped;
// - reconnect scheduling is idempotent (single timer), and close events from
//   stale sockets are ignored — there is never more than one live dial.

export class RpcCallError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: unknown,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcCallError";
  }
}

export interface NativeLinkOptions {
  socketPath: string;
  pairingFile: string;
  /** fieldd's per-process boot id (stable across reconnects within one boot) */
  bootId: string;
  reconnect?: boolean;
  /** how long to wait for field-native to create socket/pairing on first boot */
  waitForDaemonMs?: number;
  /** Test seam; production uses NATIVE_MGMT_MAX_FRAME_BYTES. */
  maxFrameBytes?: number;
  logger?: Logger;
}

/** Large enough for the bounded 256-origin artifact snapshot, finite enough
 * that a compromised/native-buggy peer cannot grow fieldd without limit. */
export const NATIVE_MGMT_MAX_FRAME_BYTES = MESH_CONTROL_LIMITS.MGMT_FRAME_BYTES;
const NATIVE_MGMT_RETAINED_FRAME_BYTES = 1024 * 1024;

type SubEventKind = "snapshot" | "delta";
interface QueuedSubEvent {
  payload: unknown;
  kind: SubEventKind;
}
interface SubEntry {
  method: string;
  params: unknown;
  onEvent: (payload: unknown, kind: SubEventKind) => void;
  subId?: string;
  /** Hold deltas while a subscribe response's snapshot is being applied. */
  buffering: boolean;
  queued: QueuedSubEvent[];
  activation?: NodeJS.Immediate;
}
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** set for subscribe requests: the local sub key whose route must be
   * installed synchronously when the response line is processed */
  subKey?: number;
}

export class NativeLink extends EventEmitter {
  private sock: Socket | null = null;
  private connectingSock: Socket | null = null;
  private dialPromise: Promise<void> | null = null;
  private frameBuffer = Buffer.alloc(0);
  private frameBytes = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<number, SubEntry>();
  private subRoutes = new Map<string, number>(); // subId -> local sub key
  private nextSubKey = 1;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly logger: Logger;

  connected = false;
  superseded = false;
  closed = false;
  /** NF-D8: the terminal floor's endpoints + per-boot token, re-learned at
   * every re-pair from the hello ack. Absent = the floor is unconfigured or the
   * daemon predates NF-2 (tolerated — readers refuse honestly, never guess).
   * The token lives here and in the tickets minted from it — never logs, env,
   * or disk. */
  terminalEndpoints: TerminalEndpoints | undefined;
  /** GT-2d: the floor's own build label, re-learned at every re-pair. This
   * plane outlives us and is adopted by design, so "which field-native answered"
   * is a real question — undefined means the daemon predates GT-2d, which is
   * itself an answer (it is at least that old). */
  nativeBuild: string | undefined;

  constructor(private readonly opts: NativeLinkOptions) {
    super();
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** Waits for field-native's pairing file + socket (it creates both), dials, hellos. */
  async connect(): Promise<void> {
    this.assertOpen();
    if (this.connected) return;
    const deadline = Date.now() + (this.opts.waitForDaemonMs ?? 10_000);
    let lastTransportFailure: unknown;
    while (Date.now() <= deadline) {
      this.assertOpen();
      if (existsSync(this.opts.pairingFile) && existsSync(this.opts.socketPath)) {
        try {
          await this.dial();
          return;
        } catch (error) {
          if (!isRetryableInitialTransportFailure(error)) throw error;
          lastTransportFailure = error;
        }
      }
      await sleep(100);
    }
    const detail = lastTransportFailure instanceof Error ? `: ${lastTransportFailure.message}` : "";
    throw new Error(`field-native did not come up before the readiness deadline${detail}`, {
      cause: lastTransportFailure,
    });
  }

  /** Coalesces callers so there is never more than one connection attempt. */
  private dial(): Promise<void> {
    if (this.dialPromise) return this.dialPromise;
    let tracked: Promise<void>;
    tracked = this.performDial().finally(() => {
      if (this.dialPromise === tracked) this.dialPromise = null;
    });
    this.dialPromise = tracked;
    return tracked;
  }

  private async performDial(): Promise<void> {
    this.assertOpen();
    const sock = await this.openSocket();
    if (this.closed || this.superseded) {
      sock.destroy();
      this.assertOpen();
    }
    this.sock = sock;
    this.frameBuffer = Buffer.alloc(0);
    this.frameBytes = 0;
    sock.on("data", (d) => {
      if (this.sock === sock) this.onData(d);
    });
    sock.on("close", () => this.onSockClose(sock));
    sock.on("error", () => {
      /* close follows */
    });
    try {
      await this.hello();
      await this.replaySubscriptions();
      this.assertOpen();
      this.connected = true;
      this.attempts = 0;
      this.emit("connected");
    } catch (e) {
      // this socket is unusable: detach it FIRST so its close event is stale,
      // then fail anything in flight — exactly one reconnect gets scheduled
      // by whoever catches this rejection (or by connect()'s caller).
      if (this.sock === sock) {
        this.sock = null;
        this.connected = false;
      }
      sock.destroy();
      this.failPending();
      throw e;
    }
  }

  private async openSocket(): Promise<Socket> {
    return await new Promise<Socket>((resolve, reject) => {
      const sock = createConnection(this.opts.socketPath);
      this.connectingSock = sock;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        sock.off("connect", onConnect);
        sock.off("error", onError);
        sock.off("close", onClose);
        if (this.connectingSock === sock) this.connectingSock = null;
        fn();
      };
      const onConnect = () => finish(() => resolve(sock));
      const onError = (error: Error) => finish(() => reject(error));
      const onClose = () =>
        finish(() =>
          reject(new RpcCallError("UNAVAILABLE", "mgmt connection closed while dialing", true)),
        );
      sock.once("connect", onConnect);
      sock.once("error", onError);
      sock.once("close", onClose);
      if (this.closed || this.superseded) sock.destroy();
    });
  }

  private assertOpen(): void {
    if (this.closed || this.superseded)
      throw new RpcCallError("UNAVAILABLE", "native link is closed", false);
  }

  private async hello(): Promise<void> {
    const secretHex = readFileSync(this.opts.pairingFile, "utf8").trim();
    const ts = Math.floor(Date.now() / 1000);
    const mac = computePairingMac(secretHex, this.opts.bootId, ts);
    const ack = await this.request("native.lifecycle.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "fieldd",
      credential: { bootId: this.opts.bootId, ts, mac },
    });
    // NF-D8: a fresh native boot means fresh endpoints + token; a re-pair to
    // the same boot re-delivers the same ones. The tolerant gate keeps a
    // malformed/absent field as "no floor" rather than a poisoned value.
    const record = (ack ?? {}) as { terminal?: unknown; nativeBuild?: unknown };
    const parsed = TerminalEndpoints.safeParse(record.terminal);
    this.terminalEndpoints = parsed.success ? parsed.data : undefined;
    // GT-2d: read on its own terms, so a floor whose endpoints are malformed
    // still says who it is (and the reverse). Anything but a string is a floor
    // that did not answer the question — the same honest blank a pre-GT-2d
    // daemon leaves, never a guess.
    this.nativeBuild = typeof record.nativeBuild === "string" ? record.nativeBuild : undefined;
    this.emit("terminal-endpoints");
  }

  private onData(chunk: Buffer): void {
    let offset = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      if (!this.appendFrameSegment(segment)) return;
      if (newline === -1) return;

      const text = this.frameBuffer.toString("utf8", 0, this.frameBytes);
      this.frameBytes = 0;
      if (this.frameBuffer.length > NATIVE_MGMT_RETAINED_FRAME_BYTES)
        this.frameBuffer = Buffer.alloc(0);
      if (text.trim()) this.onLine(text);
      offset = newline + 1;
      if (offset >= chunk.length) return;
    }
  }

  private appendFrameSegment(segment: Buffer): boolean {
    const limit = this.opts.maxFrameBytes ?? NATIVE_MGMT_MAX_FRAME_BYTES;
    const required = this.frameBytes + segment.length;
    if (required > limit) {
      this.logger.error(
        "fieldd.native_link.frame_too_large",
        "The native management connection sent an oversized frame",
        { limit },
      );
      this.frameBuffer = Buffer.alloc(0);
      this.frameBytes = 0;
      this.sock?.destroy();
      return false;
    }
    if (segment.length > 0) {
      if (required > this.frameBuffer.length) {
        const capacity = Math.min(
          limit,
          Math.max(required, Math.max(4_096, this.frameBuffer.length * 2)),
        );
        const next = Buffer.allocUnsafe(capacity);
        this.frameBuffer.copy(next, 0, 0, this.frameBytes);
        this.frameBuffer = next;
      }
      segment.copy(this.frameBuffer, this.frameBytes);
      this.frameBytes = required;
    }
    return true;
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // tolerant: garbage lines never fatal
    }
    if (msg["id"] !== undefined && msg["id"] !== null) {
      const p = this.pending.get(msg["id"] as number);
      if (!p) return;
      this.pending.delete(msg["id"] as number);
      const err = msg["error"] as
        | {
            code?: number;
            message?: string;
            data?: { kind?: string; retryable?: boolean; details?: unknown };
          }
        | undefined;
      if (err) {
        p.reject(
          new RpcCallError(
            err.data?.kind ?? "INTERNAL",
            err.message ?? "rpc error",
            err.data?.retryable ?? false,
            err.data?.details,
            err.code,
          ),
        );
        return;
      }
      // install the subscription route BEFORE resolving — a delta in the same
      // chunk is processed synchronously right after this line and must route
      if (p.subKey !== undefined) {
        const subId = (msg["result"] as { subId?: unknown } | undefined)?.subId;
        if (typeof subId !== "string") {
          p.reject(
            new RpcCallError(
              "INTERNAL",
              "subscription response did not include a string subId",
              false,
            ),
          );
          return;
        }
        this.subRoutes.set(subId, p.subKey);
        const sub = this.subs.get(p.subKey);
        if (sub) sub.subId = subId;
      }
      p.resolve(msg["result"]);
      return;
    }
    // notification
    const method = msg["method"] as string | undefined;
    const params = msg["params"] as { subId?: string; payload?: unknown } | undefined;
    if (method === "native.lifecycle.superseded") {
      this.superseded = true;
      this.emit("superseded");
      this.sock?.destroy();
      return;
    }
    if (params?.subId && (method?.endsWith(".delta") || method?.endsWith(".snapshot"))) {
      const key = this.subRoutes.get(params.subId);
      const sub = key === undefined ? undefined : this.subs.get(key);
      if (sub) {
        const event: QueuedSubEvent = {
          payload: params.payload,
          kind: method.endsWith(".snapshot") ? "snapshot" : "delta",
        };
        if (sub.buffering) sub.queued.push(event);
        else sub.onEvent(event.payload, event.kind);
      }
    }
  }

  private onSockClose(sock: Socket): void {
    if (sock !== this.sock) return; // stale socket — already replaced or detached
    this.sock = null;
    this.connected = false;
    this.failPending();
    this.subRoutes.clear();
    this.prepareSubscriptionsForReconnect();
    if (this.closed || this.superseded || this.opts.reconnect === false) {
      this.emit("closed");
      return;
    }
    this.scheduleReconnect();
  }

  /** Idempotent: at most one reconnect timer exists at any moment. */
  private scheduleReconnect(): void {
    if (this.closed || this.superseded || this.opts.reconnect === false) return;
    if (this.reconnectTimer || this.sock) return;
    const delay = Math.min(500 * 2 ** this.attempts, 10_000);
    this.attempts += 1;
    this.emit("reconnecting", delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private failPending(): void {
    for (const [, p] of this.pending) {
      p.reject(new RpcCallError("UNAVAILABLE", "mgmt connection closed", true));
    }
    this.pending.clear();
  }

  private async replaySubscriptions(): Promise<void> {
    for (const [key, sub] of this.subs) {
      this.prepareSubscription(sub);
      try {
        const res = (await this.rawRequest(sub.method, sub.params, key)) as { snapshot: unknown };
        sub.onEvent(res.snapshot, "snapshot"); // P5: reconnect = fresh snapshot
        this.activateSubscription(sub);
      } catch (e) {
        // C3 review finding: one refused replay must never fail the whole dial
        // (a serve.subscribe replayed while the mesh node is down answers
        // UNAVAILABLE — pre-fix that cycled the ENTIRE link forever, health
        // stream included). The sub entry STAYS in the map: the next reconnect
        // retries it; until then its stream is honestly silent (its backend is
        // down anyway). Transport-dead errors still abort: with no socket the
        // remaining replays can't succeed either.
        if (this.closed || this.superseded || this.sock === null) throw e;
        this.logger.warn(
          "fieldd.native_link.subscription_replay_refused",
          "A native subscription replay was refused and retained for the next reconnect",
          { method: sub.method, error: e },
        );
      }
    }
  }

  private prepareSubscription(sub: SubEntry): void {
    if (sub.activation) {
      clearImmediate(sub.activation);
      delete sub.activation;
    }
    sub.buffering = true;
    sub.queued = [];
  }

  private prepareSubscriptionsForReconnect(): void {
    for (const sub of this.subs.values()) this.prepareSubscription(sub);
  }

  private activateSubscription(sub: SubEntry): void {
    delete sub.activation;
    sub.buffering = false;
    const queued = sub.queued;
    sub.queued = [];
    for (const event of queued) sub.onEvent(event.payload, event.kind);
  }

  private removeSubscription(key: number, sub: SubEntry): void {
    if (sub.activation) clearImmediate(sub.activation);
    this.subs.delete(key);
    for (const [subId, routeKey] of this.subRoutes) {
      if (routeKey === key) this.subRoutes.delete(subId);
    }
  }

  async request(method: string, params: unknown): Promise<unknown> {
    return await this.rawRequest(method, params);
  }

  private async rawRequest(method: string, params: unknown, subKey?: number): Promise<unknown> {
    const sock = this.sock;
    if (!sock) throw new RpcCallError("UNAVAILABLE", "not connected", true);
    const id = this.nextId++;
    const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return await new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      if (subKey !== undefined) entry.subKey = subKey;
      this.pending.set(id, entry);
      sock.write(line);
    });
  }

  /** Snapshot-then-delta subscription; survives reconnects (fresh snapshot each time). */
  async subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: SubEventKind) => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }> {
    const key = this.nextSubKey++;
    const entry: SubEntry = { method, params, onEvent, buffering: true, queued: [] };
    this.subs.set(key, entry);
    try {
      const res = (await this.rawRequest(method, params, key)) as { snapshot: unknown };
      // Promise continuations run before setImmediate, so callers can apply the
      // returned snapshot before any same-chunk deltas are released.
      entry.activation = setImmediate(() => {
        if (this.subs.get(key) === entry && !this.closed && !this.superseded)
          this.activateSubscription(entry);
      });
      let disposed = false;
      return {
        snapshot: res.snapshot,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          this.removeSubscription(key, entry);
        },
      };
    } catch (e) {
      this.removeSubscription(key, entry);
      throw e;
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectingSock?.destroy();
    this.connectingSock = null;
    this.prepareSubscriptionsForReconnect();
    this.sock?.destroy();
  }
}

function isRetryableInitialTransportFailure(error: unknown): boolean {
  if (error instanceof RpcCallError) {
    return error.kind === "UNAVAILABLE" && error.retryable;
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOENT" ||
    code === "ENOTSOCK" ||
    code === "EPIPE"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
