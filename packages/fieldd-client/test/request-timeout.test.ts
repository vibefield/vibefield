// The debts lane (2026-10-12) — a call's bound. `request` settled only on an
// answer or a socket close, and waited for `ready()` without end while the
// client reconnected: a daemon that took a call and never answered it pinned
// whatever waited on that call, for ever. `RequestOptions.timeoutMs` is the
// caller's bound over both waits — past it the call is refused UNAVAILABLE
// {state: "timeout"} (retryable), its pending entry is gone (a late answer
// resolves nothing), a call still waiting for `ready` is never sent, and a
// keyed forward that already LEFT is outcome-unknown with its key, as any cut.
// No caller is bounded unless it asks: the default is today's behaviour.
import { afterEach, describe, expect, it } from "vitest";
import { FielddClient, FielddRpcError, type WsCtor, type WsLike } from "../src/client";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

interface Sent {
  id: number;
  method: string;
  params: Record<string, unknown> | undefined;
}

/** A daemon the test answers by hand: the socket opens when told to, every
 * frame the client sends is kept, and a reply goes back when the test says. */
class Scripted implements WsLike {
  readyState = 0;
  readonly sent: Sent[] = [];
  private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Sent);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code: 1000 });
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }
  reply(id: number, result: unknown): void {
    this.emit("message", { data: JSON.stringify({ jsonrpc: "2.0", id, result }) });
  }
  /** open, and answer the hello — the client is `ready` after a turn */
  async greet(): Promise<void> {
    this.open();
    const hello = this.sent.find((frame) => frame.method === "system.hello");
    if (hello === undefined) throw new Error("no hello was sent");
    this.reply(hello.id, { grantedScopes: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  calls(method: string): Sent[] {
    return this.sent.filter((frame) => frame.method === method);
  }
  private emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

/** The constructor the client dials with, and the socket it dialed last. */
function scriptedDaemon(): {
  ctor: WsCtor;
  socket: () => Scripted;
} {
  let last: Scripted | null = null;
  const ctor = class extends Scripted {
    constructor(url: string) {
      super(url);
      last = this;
    }
  };
  return {
    ctor: ctor as unknown as WsCtor,
    socket: () => {
      if (last === null) throw new Error("the client has not dialed");
      return last;
    },
  };
}

/** How a promise stands after `ms`: its value, its error, or still pending. */
async function after<T>(
  p: Promise<T>,
  ms: number,
): Promise<
  { state: "resolved"; value: T } | { state: "rejected"; error: unknown } | { state: "pending" }
> {
  return Promise.race([
    p.then(
      (value) => ({ state: "resolved" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    ),
    new Promise<{ state: "pending" }>((resolve) =>
      setTimeout(() => resolve({ state: "pending" }), ms),
    ),
  ]);
}

/** A request leaves after `ready()`'s await: one turn, then its frame is sent. */
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

function clientOn(ctor: WsCtor): FielddClient {
  const client = new FielddClient({ url: "ws://127.0.0.1:9", token: "t", webSocket: ctor });
  cleanup.push(() => client.close());
  return client;
}

describe("FielddClient — a call's bound (RequestOptions.timeoutMs)", () => {
  it("a call nobody answers is refused UNAVAILABLE timeout at its bound, and its late answer resolves nothing", async () => {
    const daemon = scriptedDaemon();
    const client = clientOn(daemon.ctor);
    void client.ready();
    await daemon.socket().greet();

    const started = Date.now();
    const call = client.request("terminal.sessions", {}, { timeoutMs: 150 });
    const outcome = await after(call, 2_000);
    expect(outcome.state).toBe("rejected");
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(FielddRpcError);
    expect(error).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "fieldd", state: "timeout", timeoutMs: 150 },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);

    // the answer that comes late has nothing to resolve; the next call is whole
    const [late] = daemon.socket().calls("terminal.sessions");
    daemon.socket().reply(late?.id ?? -1, { sessions: ["late"] });
    const next = client.request("terminal.sessions", {}, { timeoutMs: 1_000 });
    await turn();
    const [, second] = daemon.socket().calls("terminal.sessions");
    daemon.socket().reply(second?.id ?? -1, { sessions: [] });
    await expect(next).resolves.toEqual({ sessions: [] });
  });

  it("an answer inside the bound is the answer, and the bound is spent", async () => {
    const daemon = scriptedDaemon();
    const client = clientOn(daemon.ctor);
    void client.ready();
    await daemon.socket().greet();
    const call = client.request("system.health", {}, { timeoutMs: 200 });
    await turn();
    const [asked] = daemon.socket().calls("system.health");
    daemon.socket().reply(asked?.id ?? -1, { ok: true });
    await expect(call).resolves.toEqual({ ok: true });
    // past where the bound would have fired, nothing fires
    expect((await after(call, 300)).state).toBe("resolved");
  });

  it("a call waiting for ready is refused at its bound and is NEVER sent once the client connects", async () => {
    const daemon = scriptedDaemon();
    const client = clientOn(daemon.ctor);
    const call = client.request("agent.list", {}, { timeoutMs: 100 });
    const outcome = await after(call, 2_000);
    expect(outcome).toMatchObject({
      state: "rejected",
      error: { kind: "UNAVAILABLE", details: { state: "timeout" } },
    });
    // the daemon comes up afterwards: the refused call stays refused
    await daemon.socket().greet();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(daemon.socket().calls("agent.list")).toEqual([]);
    expect(client.status).toBe("ready");
  });

  it("a keyed forward that LEFT and was never answered is outcome-unknown with its key — the retry's key", async () => {
    const daemon = scriptedDaemon();
    const client = clientOn(daemon.ctor);
    void client.ready();
    await daemon.socket().greet();
    const call = client.request(
      "agent.spawn",
      { device: "dev-b", provider: "claude-code", cwd: "/work/app" },
      { timeoutMs: 100 },
    );
    const outcome = await after(call, 2_000);
    const [left] = daemon.socket().calls("agent.spawn");
    const key = (left?.params?.["forward"] as { idempotencyKey?: string } | undefined)
      ?.idempotencyKey;
    expect(key).toMatch(/^wk_/);
    expect(outcome).toMatchObject({
      state: "rejected",
      error: {
        kind: "UNAVAILABLE",
        retryable: true,
        details: { state: "outcome-unknown", idempotencyKey: key },
        forward: { idempotencyKey: key },
      },
    });
  });

  it("no bound unless the caller asks: an unanswered call without timeoutMs is still waiting", async () => {
    const daemon = scriptedDaemon();
    const client = clientOn(daemon.ctor);
    void client.ready();
    await daemon.socket().greet();
    const call = client.request("terminal.sessions", {});
    expect((await after(call, 300)).state).toBe("pending");
    const [asked] = daemon.socket().calls("terminal.sessions");
    daemon.socket().reply(asked?.id ?? -1, { sessions: [] });
    await expect(call).resolves.toEqual({ sessions: [] });
  });
});
