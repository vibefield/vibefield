// Minimal JSON-RPC-over-WS test client: routes responses by id so notification
// frames (subscription deltas) never get eaten by a one-shot `once("message")`
// reader. Test-local — not shipped.
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import type WebSocket from "ws";

export interface RpcErrorShape {
  code: number;
  message: string;
  data?: { kind?: string; retryable?: boolean; details?: unknown };
}

export class WsRpc {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error & { rpc?: RpcErrorShape }) => void }
  >();
  notifications: Array<{ method: string; params: { subId?: string; payload?: unknown } }> = [];
  closed = false;

  constructor(private readonly ws: WebSocket) {
    ws.on("close", () => {
      this.closed = true;
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>;
      const id = m["id"];
      if (typeof id === "number" && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        const error = m["error"] as RpcErrorShape | undefined;
        if (error) {
          const e = new Error(error.message) as Error & { rpc?: RpcErrorShape };
          e.rpc = error;
          p.reject(e);
        } else {
          p.resolve(m["result"]);
        }
        return;
      }
      if (typeof m["method"] === "string") {
        this.notifications.push(
          m as unknown as { method: string; params: { subId?: string; payload?: unknown } },
        );
      }
    });
  }

  call(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Calls expecting failure; returns the RPC error object. */
  async callErr(method: string, params: unknown): Promise<RpcErrorShape> {
    try {
      await this.call(method, params);
    } catch (e) {
      const rpc = (e as { rpc?: RpcErrorShape }).rpc;
      if (rpc) return rpc;
      throw e;
    }
    throw new Error(`expected ${method} to fail`);
  }
}

export function until(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() > deadline) return reject(new Error("until: condition timeout"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

export async function helloAs(rpc: WsRpc, token: string, clientKind = "renderer"): Promise<void> {
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    credential: token,
  });
}
