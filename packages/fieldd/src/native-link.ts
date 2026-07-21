import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
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
}

type SubEventKind = "snapshot" | "delta";
interface SubEntry {
  method: string;
  params: unknown;
  onEvent: (payload: unknown, kind: SubEventKind) => void;
  subId?: string;
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
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<number, SubEntry>();
  private subRoutes = new Map<string, number>(); // subId -> local sub key
  private nextSubKey = 1;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  connected = false;
  superseded = false;
  closed = false;

  constructor(private readonly opts: NativeLinkOptions) {
    super();
  }

  /** Waits for field-native's pairing file + socket (it creates both), dials, hellos. */
  async connect(): Promise<void> {
    const deadline = Date.now() + (this.opts.waitForDaemonMs ?? 10_000);
    while (!existsSync(this.opts.pairingFile) || !existsSync(this.opts.socketPath)) {
      if (Date.now() > deadline) throw new Error("field-native did not come up (pairing/socket missing)");
      await sleep(100);
    }
    await this.dial();
  }

  private async dial(): Promise<void> {
    const sock = await new Promise<Socket>((resolve, reject) => {
      const s = createConnection(this.opts.socketPath);
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
    this.sock = sock;
    this.buf = "";
    sock.on("data", (d) => {
      if (this.sock === sock) this.onData(d.toString("utf8"));
    });
    sock.on("close", () => this.onSockClose(sock));
    sock.on("error", () => {
      /* close follows */
    });
    try {
      await this.hello();
      this.connected = true;
      this.attempts = 0;
      this.emit("connected");
      await this.replaySubscriptions();
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

  private async hello(): Promise<void> {
    const secretHex = readFileSync(this.opts.pairingFile, "utf8").trim();
    const ts = Math.floor(Date.now() / 1000);
    const mac = computePairingMac(secretHex, this.opts.bootId, ts);
    await this.request("native.lifecycle.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "fieldd",
      credential: { bootId: this.opts.bootId, ts, mac },
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.trim()) this.onLine(line);
    }
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
        | { code?: number; message?: string; data?: { kind?: string; retryable?: boolean; details?: unknown } }
        | undefined;
      if (err) {
        p.reject(
          new RpcCallError(err.data?.kind ?? "INTERNAL", err.message ?? "rpc error", err.data?.retryable ?? false, err.data?.details, err.code),
        );
        return;
      }
      // install the subscription route BEFORE resolving — a delta in the same
      // chunk is processed synchronously right after this line and must route
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
      sub?.onEvent(params.payload, method.endsWith(".snapshot") ? "snapshot" : "delta");
    }
  }

  private onSockClose(sock: Socket): void {
    if (sock !== this.sock) return; // stale socket — already replaced or detached
    this.sock = null;
    this.connected = false;
    this.failPending();
    this.subRoutes.clear();
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
      const res = (await this.rawRequest(sub.method, sub.params, key)) as { snapshot: unknown };
      sub.onEvent(res.snapshot, "snapshot"); // P5: reconnect = fresh snapshot
    }
  }

  async request(method: string, params: unknown): Promise<unknown> {
    return await this.rawRequest(method, params);
  }

  private async rawRequest(method: string, params: unknown, subKey?: number): Promise<unknown> {
    const sock = this.sock;
    if (!sock) throw new RpcCallError("UNAVAILABLE", "not connected", true);
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
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
  ): Promise<{ snapshot: unknown }> {
    const key = this.nextSubKey++;
    const entry: SubEntry = { method, params, onEvent };
    this.subs.set(key, entry);
    const res = (await this.rawRequest(method, params, key)) as { snapshot: unknown };
    return { snapshot: res.snapshot };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sock?.destroy();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
