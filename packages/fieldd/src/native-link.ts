import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { computePairingMac } from "./pairing";

// NativeLink (design-02 §3.3): the ONLY door to field-native. Owns the mgmt
// UDS connection: D8 pairing hello, request/response correlation, subscription
// replay on reconnect (P5 — reconnect = fresh snapshot), SUPERSEDED = fatal.

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
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection(this.opts.socketPath);
      sock.once("connect", () => {
        this.sock = sock;
        sock.on("data", (d) => this.onData(d.toString("utf8")));
        sock.on("close", () => this.onClose());
        sock.on("error", () => {
          /* close follows */
        });
        resolve();
      });
      sock.once("error", reject);
    });
    await this.hello();
    this.connected = true;
    this.attempts = 0;
    this.emit("connected");
    await this.replaySubscriptions();
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
      return; // tolerant: garbage lines are logged upstream, never fatal
    }
    if (msg["id"] !== undefined && msg["id"] !== null) {
      const p = this.pending.get(msg["id"] as number);
      if (!p) return;
      this.pending.delete(msg["id"] as number);
      const err = msg["error"] as { code?: number; message?: string; data?: { kind?: string; retryable?: boolean; details?: unknown } } | undefined;
      if (err) {
        p.reject(new RpcCallError(err.data?.kind ?? "INTERNAL", err.message ?? "rpc error", err.data?.retryable ?? false, err.data?.details, err.code));
      } else {
        p.resolve(msg["result"]);
      }
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
    if (method?.endsWith(".delta") && params?.subId) {
      const key = this.subRoutes.get(params.subId);
      const sub = key === undefined ? undefined : this.subs.get(key);
      sub?.onEvent(params.payload, "delta");
    }
  }

  private onClose(): void {
    this.connected = false;
    this.sock = null;
    for (const [, p] of this.pending) {
      p.reject(new RpcCallError("UNAVAILABLE", "mgmt connection closed", true));
    }
    this.pending.clear();
    this.subRoutes.clear();
    if (this.closed || this.superseded || this.opts.reconnect === false) {
      this.emit("closed");
      return;
    }
    const delay = Math.min(500 * 2 ** this.attempts, 10_000);
    this.attempts += 1;
    this.emit("reconnecting", delay);
    this.reconnectTimer = setTimeout(() => {
      this.dial().catch(() => this.onClose());
    }, delay);
  }

  private async replaySubscriptions(): Promise<void> {
    for (const [key, sub] of this.subs) {
      const res = (await this.request(sub.method, sub.params)) as { subId: string; snapshot: unknown };
      sub.subId = res.subId;
      this.subRoutes.set(res.subId, key);
      sub.onEvent(res.snapshot, "snapshot"); // P5: reconnect = fresh snapshot
    }
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const sock = this.sock;
    if (!sock) throw new RpcCallError("UNAVAILABLE", "not connected", true);
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    const res = (await this.request(method, params)) as { subId: string; snapshot: unknown };
    entry.subId = res.subId;
    this.subRoutes.set(res.subId, key);
    return { snapshot: res.snapshot };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock?.destroy();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
