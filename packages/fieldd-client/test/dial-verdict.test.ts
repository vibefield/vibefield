// DS-1b (DS wave 2 landing, 2026-10-01) — a dial that FAILED CLOSED before it
// opened is an ANSWER, not a silent reconnect loop. PeerLink dials a peer's
// door through the node's egress; when the floor has no road (mesh down, its
// ask timed out, the mgmt link reconnecting) the stand-in socket reports the
// floor's verdict — `UNAVAILABLE {service: "mesh", state}` — as its error and
// closes 1006. Before this fix the client swallowed the error, scheduled a
// reconnect into the same per-boot answer, and every caller waiting on
// `ready()` sat until PeerLink's deadline read it as "peer call timed out"
// (w2-egress's finding (a)). Now the verdict rejects the waiting callers and
// the client still reconnects on its backoff: the floor may yet come back.
import { afterEach, describe, expect, it } from "vitest";
import { FielddClient, FielddRpcError, type WsCtor, type WsLike } from "../src/client";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const VERDICT = {
  kind: "UNAVAILABLE",
  message:
    "no road to the tailnet through this desktop's node right now (mesh-down); the OS network is not taken instead (DS-L5)",
  retryable: true,
  details: { service: "mesh", state: "mesh-down" },
};

/** A socket that never opens: it reports `verdict` (when given) as its error,
 * then closes 1006 — exactly what egress.ts's stand-in does for a refused dial. */
function failingSocket(verdict: unknown | undefined): { ctor: WsCtor; dials: () => number } {
  let dials = 0;
  class Failing implements WsLike {
    readyState = 0;
    private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    constructor(_url: string) {
      dials += 1;
      setTimeout(() => {
        this.readyState = 3;
        if (verdict !== undefined) this.emit("error", { error: verdict });
        this.emit("close", { code: 1006, reason: "dial failed" });
      }, 0);
    }
    send(): void {}
    close(): void {}
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    private emit(type: string, ev: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
  }
  return { ctor: Failing as unknown as WsCtor, dials: () => dials };
}

async function settledWithin<T>(p: Promise<T>, ms: number): Promise<{ error: unknown }> {
  return Promise.race([
    p.then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    ),
    new Promise<{ error: unknown }>((_, reject) =>
      setTimeout(() => reject(new Error(`did not settle within ${ms} ms`)), ms),
    ),
  ]);
}

describe("FielddClient — a dial's verdict (DS-1b, fail closed)", () => {
  it("rejects the waiting call and ready() with the floor's UNAVAILABLE {service: mesh, state}, then keeps reconnecting", async () => {
    const socket = failingSocket(VERDICT);
    const client = new FielddClient({
      url: "ws://peer.example:9423",
      token: "",
      webSocket: socket.ctor,
      maxBackoffMs: 50,
    });
    cleanup.push(() => client.close());

    const call = settledWithin(client.request("device.list", {}), 1_000);
    const ready = settledWithin(client.ready(), 1_000);
    const [callOutcome, readyOutcome] = await Promise.all([call, ready]);

    for (const outcome of [callOutcome, readyOutcome]) {
      expect(outcome.error).toBeInstanceOf(FielddRpcError);
      const error = outcome.error as FielddRpcError;
      expect(error.kind).toBe("UNAVAILABLE");
      expect(error.retryable).toBe(true);
      expect(error.details).toEqual({ service: "mesh", state: "mesh-down" });
      expect(error.message).toContain("no road");
      expect(error.code).toBeUndefined(); // the floor's verdict, never a remote answer
    }
    // not terminal: the floor may come back on its next boot — the client redials on its backoff
    expect(client.status).not.toBe("failed");
    await new Promise((r) => setTimeout(r, 200));
    expect(socket.dials()).toBeGreaterThan(1);
  });

  it("a close with no verdict is still the transient it always was: the call waits for the next hello", async () => {
    const socket = failingSocket(undefined);
    const client = new FielddClient({
      url: "ws://peer.example:9423",
      token: "",
      webSocket: socket.ctor,
      maxBackoffMs: 50,
    });
    cleanup.push(() => client.close());
    const outcome = await settledWithin(client.request("device.list", {}), 300).catch(
      (e: unknown) => ({ error: e }),
    );
    expect(String((outcome.error as Error).message)).toContain("did not settle");
  });
});
