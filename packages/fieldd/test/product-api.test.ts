import { MESH_CONTROL_LIMITS, PRODUCT_API_LIMITS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { ProductApi } from "../src/product-api";

describe("ProductApi lifecycle", () => {
  it("rejects listen when close wins the startup race", async () => {
    const api = new ProductApi({
      port: 0,
      tokens: { verify: () => null },
    });

    const listening = api.listen();
    api.close();

    await expect(listening).rejects.toThrow(/closed before/);
  });

  it("sheds a connection instead of extending an over-budget outbound queue", () => {
    const api = new ProductApi({ port: 0, tokens: { verify: () => null } });
    const ws = {
      readyState: 1,
      bufferedAmount: MESH_CONTROL_LIMITS.PRODUCT_QUEUED_BYTES,
      close: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
    } as unknown as WebSocket;

    const sent = (
      api as unknown as { sendBounded(socket: WebSocket, value: unknown): boolean }
    ).sendBounded(ws, { jsonrpc: "2.0", method: "artifact.delta", params: {} });

    expect(sent).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(1013, "client is not keeping up");
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("terminates a connection when an outbound projection cannot be encoded", () => {
    const api = new ProductApi({ port: 0, tokens: { verify: () => null } });
    const ws = {
      readyState: 1,
      bufferedAmount: 0,
      close: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
    } as unknown as WebSocket;

    const sent = (
      api as unknown as { sendBounded(socket: WebSocket, value: unknown): boolean }
    ).sendBounded(ws, { value: 1n });

    expect(sent).toBe(false);
    expect(ws.terminate).toHaveBeenCalledOnce();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("drops one exact plugin-token connection without touching sibling plugin leases", () => {
    const api = new ProductApi({ port: 0, tokens: { verify: () => null } });
    const exact = { terminate: vi.fn() };
    const sibling = { terminate: vi.fn() };
    const liveConns = (
      api as unknown as {
        liveConns: Set<{
          ws: { terminate(): void };
          state: {
            ctx: { principal: { kind: "plugin"; id: string; scopes: []; tokenId: string } };
          };
        }>;
      }
    ).liveConns;
    liveConns.add({
      ws: exact,
      state: {
        ctx: {
          principal: { kind: "plugin", id: "com.example.plugin", scopes: [], tokenId: "tk_exact" },
        },
      },
    });
    liveConns.add({
      ws: sibling,
      state: {
        ctx: {
          principal: {
            kind: "plugin",
            id: "com.example.plugin",
            scopes: [],
            tokenId: "tk_sibling",
          },
        },
      },
    });

    expect(api.dropTokenConnections("tk_exact")).toBe(1);
    expect(exact.terminate).toHaveBeenCalledOnce();
    expect(sibling.terminate).not.toHaveBeenCalled();
  });

  it("starts a subscription only after its reply installs the subId", async () => {
    const api = new ProductApi({ port: 0, tokens: { verify: () => null } });
    const order: string[] = [];
    api.registerSubscription("system.health.subscribe", () => ({
      snapshot: { ok: true },
      dispose: () => undefined,
      start: () => order.push("start"),
    }));
    const internals = api as unknown as {
      subHandlers: Map<string, unknown>;
      execute(
        ws: unknown,
        state: unknown,
        id: number,
        method: string,
        params: unknown,
        handler: undefined,
        subHandler: unknown,
        reply: (value: unknown) => void,
      ): Promise<void>;
    };
    const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
    const state = {
      ctx: {
        principal: { kind: "local-token", tokenId: "tk_window", scopes: [] },
        transport: "ws-loopback",
        receivedAt: 0,
      },
      subs: new Map(),
      pendingSubs: 0,
      abortController: new AbortController(),
    };

    await internals.execute(
      ws,
      state,
      1,
      "system.health.subscribe",
      {},
      undefined,
      internals.subHandlers.get("system.health.subscribe"),
      () => order.push("reply"),
    );

    expect(order).toEqual(["reply", "start"]);
    expect(state.subs.size).toBe(1);
  });

  it("refuses the subscription past the per-connection budget, and keeps the live ones", async () => {
    // EL7 — a subscription is recurring WORK, not a read: the field projection
    // lists and encodes per subscriber per flush, so one socket holding an
    // unbounded map buys the daemon's tick budget. The refusal lands BEFORE the
    // handler runs (`subscribed` stays at its pre-call count) and touches
    // nothing already installed.
    const api = new ProductApi({ port: 0, tokens: { verify: () => null } });
    let subscribed = 0;
    api.registerSubscription("system.health.subscribe", () => {
      subscribed += 1;
      return { snapshot: { ok: true }, dispose: () => undefined };
    });
    const internals = api as unknown as {
      subHandlers: Map<string, unknown>;
      execute(
        ws: unknown,
        state: unknown,
        id: number,
        method: string,
        params: unknown,
        handler: undefined,
        subHandler: unknown,
        reply: (value: unknown) => void,
      ): Promise<void>;
    };
    const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
    const state = {
      ctx: {
        principal: { kind: "local-token", tokenId: "tk_window", scopes: [] },
        transport: "ws-loopback",
        receivedAt: 0,
      },
      subs: new Map<string, () => void>(),
      pendingSubs: 0,
      abortController: new AbortController(),
    };
    const subscribe = async (id: number): Promise<Record<string, unknown>> => {
      let answer: Record<string, unknown> = {};
      await internals.execute(
        ws,
        state,
        id,
        "system.health.subscribe",
        {},
        undefined,
        internals.subHandlers.get("system.health.subscribe"),
        (value) => {
          answer = value as Record<string, unknown>;
        },
      );
      return answer;
    };

    const limit = PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION;
    for (let i = 0; i < limit; i += 1) {
      const answer = await subscribe(i + 1);
      expect(answer["result"], `subscription ${i + 1} of ${limit}`).toBeDefined();
    }
    expect(state.subs.size).toBe(limit);
    expect(subscribed).toBe(limit);

    const refused = await subscribe(limit + 1);
    const error = refused["error"] as {
      data: { kind: string; retryable: boolean; details: unknown };
    };
    expect(error.data.kind).toBe("RESOURCE_EXHAUSTED");
    expect(error.data.retryable).toBe(false);
    expect(error.data.details).toEqual({ resource: "subscriptions", limit });
    // the refusal is an admission decision, not a teardown: nothing already
    // live was disposed, and the handler was never entered for the refused one
    expect(state.subs.size).toBe(limit);
    expect(subscribed).toBe(limit);

    // and a slot freed by an unsubscribe is usable again
    const [firstId, dispose] = [...state.subs.entries()][0]!;
    dispose();
    state.subs.delete(firstId);
    expect((await subscribe(limit + 2))["result"]).toBeDefined();
    expect(state.subs.size).toBe(limit);
  });

  it("reserves the slot at the check: subscribes asked together at the last free slot admit one", async () => {
    // Item 470 (2026-11-16) — the check ran before the handler's await and the
    // install after it, so every subscribe asked while the last slot's handler
    // was out passed the same check, and the connection held more than EL7's
    // bound. Here four are asked before any handler answers.
    const rig = budgetRig();
    const asked = [101, 102, 103, 104].map((id) => rig.subscribe(id));
    expect(rig.control.entered).toBe(1);
    expect(rig.held()).toBe(LIMIT);
    for (const id of [102, 103, 104]) {
      expect(JSON.stringify(rig.answers.get(id))).toBe(refusalWire(id));
    }
    expect(rig.answers.has(101)).toBe(false);

    // the open answers late: at no await point does the connection hold more
    for (const open of rig.opening.splice(0)) {
      open.resolve({ snapshot: { ok: true }, dispose: () => undefined });
      await tick();
      expect(rig.held()).toBeLessThanOrEqual(LIMIT);
    }
    await Promise.all(asked);
    expect(rig.state.subs.size).toBe(LIMIT);
    expect(rig.state.pendingSubs).toBe(0);
    expect(rig.answers.get(101)?.["result"]).toBeDefined();
  });

  it("gives a reserved slot back when the handler throws, late or at once", async () => {
    // Item 470 (2026-11-16) — a reservation that never becomes a subscription
    // must not keep its slot: the next subscribe is admitted.
    const rig = budgetRig();
    const late = rig.subscribe(201);
    // asked while 201's handler is out: refused, as at a full connection
    rig.subscribe(202);
    expect(JSON.stringify(rig.answers.get(202))).toBe(refusalWire(202));
    rig.opening.shift()?.reject(new Error("the producer could not open"));
    await expect(late).rejects.toThrow("the producer could not open");
    expect(rig.state.pendingSubs).toBe(0);
    expect(rig.state.subs.size).toBe(LIMIT - 1);

    // a handler that throws before it answers gives its slot back the same way
    rig.control.mode = "throw";
    await expect(rig.subscribe(203)).rejects.toThrow("the producer refused at once");
    expect(rig.state.pendingSubs).toBe(0);

    // and the slot is usable again
    rig.control.mode = "answer";
    await rig.subscribe(204);
    expect(rig.answers.get(204)?.["result"]).toBeDefined();
    expect(rig.state.subs.size).toBe(LIMIT);
    expect(rig.state.pendingSubs).toBe(0);
  });

  it("reserves a plugin provider's subscription the same way, and gives it back when the provider throws", async () => {
    // Item 470 (2026-11-16) — the third install site: a dynamic method's
    // provider (P4), opened through the router.
    const api = new ProductApi({ port: 0, tokens: { verify: () => null } });
    const opening: Array<Deferred<Install>> = [];
    let entered = 0;
    api.setDynamicRouter({
      kindOf: () => "subscription",
      call: async () => undefined,
      subscribe: () => {
        entered += 1;
        const open = deferred<Install>();
        opening.push(open);
        return open.promise;
      },
    });
    const internals = api as unknown as {
      executeDynamic(
        ws: unknown,
        state: unknown,
        id: number,
        method: string,
        params: unknown,
        reply: (value: unknown) => void,
      ): Promise<void>;
    };
    const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
    const state = connState(LIMIT - 1);
    const answers = new Map<number, Record<string, unknown>>();
    const ask = (id: number): Promise<void> =>
      internals.executeDynamic(ws, state, id, "x.example.watch", {}, (value) => {
        answers.set(id, value as Record<string, unknown>);
      });

    const first = ask(301);
    ask(302);
    ask(303);
    expect(entered).toBe(1);
    expect(JSON.stringify(answers.get(302))).toBe(refusalWire(302));
    expect(JSON.stringify(answers.get(303))).toBe(refusalWire(303));
    expect(state.subs.size + state.pendingSubs).toBe(LIMIT);

    opening.shift()?.reject(new Error("the provider could not open"));
    await expect(first).rejects.toThrow("the provider could not open");
    expect(state.pendingSubs).toBe(0);
    expect(state.subs.size).toBe(LIMIT - 1);

    const next = ask(304);
    expect(entered).toBe(2);
    opening.shift()?.resolve({ snapshot: {}, dispose: () => undefined });
    await next;
    expect(answers.get(304)?.["result"]).toBeDefined();
    expect(state.subs.size).toBe(LIMIT);
    expect(state.pendingSubs).toBe(0);
  });

  it("lets go at once a subscription whose connection closed while its handler was out", async () => {
    // Item 474 (2026-11-16) — the close disposes and clears `subs` while the
    // handler is out; the late install then landed on the cleared map, nothing
    // ever disposed it, and its producer kept working for a dead socket.
    const rig = budgetRig();
    const asked = rig.subscribe(501);
    // the socket's close, as its handler runs it: abort, dispose the live ones, clear
    rig.state.abortController.abort();
    for (const live of rig.state.subs.values()) live();
    rig.state.subs.clear();

    const dispose = vi.fn();
    const start = vi.fn();
    rig.opening.shift()?.resolve({ snapshot: { ok: true }, dispose, start });
    await asked;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(rig.state.subs.size).toBe(0);
    expect(rig.state.pendingSubs).toBe(0);
  });

  it("logs a refused subscription once per burst: the method, the count and the limit, never the params", async () => {
    // Item 467 (2026-11-16) — a budget hit used to leave no trace: the refusal
    // went to the caller alone, so after the fact nobody could tell which feed
    // was refused, or that the window had filled its connection. One line says
    // so at the first refusal; the rest of a storm says nothing until the count
    // has fallen under the limit and filled again.
    const warn = vi.fn();
    const logger = recordingLogger(warn);
    const api = new ProductApi({ port: 0, tokens: { verify: () => null }, logger });
    api.registerSubscription("system.health.subscribe", () => ({
      snapshot: { ok: true },
      dispose: () => undefined,
    }));
    const internals = api as unknown as {
      subHandlers: Map<string, unknown>;
      execute(
        ws: unknown,
        state: unknown,
        id: number,
        method: string,
        params: unknown,
        handler: undefined,
        subHandler: unknown,
        reply: (value: unknown) => void,
      ): Promise<void>;
    };
    const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
    const state = {
      ctx: {
        principal: { kind: "local-token", tokenId: "tk_window", scopes: [] },
        transport: "ws-loopback",
        receivedAt: 0,
      },
      connectionId: "conn_budget",
      subs: new Map<string, () => void>(),
      pendingSubs: 0,
      abortController: new AbortController(),
    };
    const PARAM_WORD = "a-subscriber-param-never-logged";
    const subscribe = async (id: number): Promise<Record<string, unknown>> => {
      let answer: Record<string, unknown> = {};
      await internals.execute(
        ws,
        state,
        id,
        "system.health.subscribe",
        { set: PARAM_WORD },
        undefined,
        internals.subHandlers.get("system.health.subscribe"),
        (value) => {
          answer = value as Record<string, unknown>;
        },
      );
      return answer;
    };

    const limit = PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION;
    for (let i = 0; i < limit; i += 1) await subscribe(i + 1);
    expect(state.subs.size).toBe(limit);
    expect(warn).not.toHaveBeenCalled();

    // the first refusal: one line, and the caller's answer exactly as before
    const refused = await subscribe(limit + 1);
    expect(JSON.stringify(refused)).toBe(
      '{"jsonrpc":"2.0","id":33,"error":{"code":-32010,"message":"this connection holds too many live subscriptions","data":{"kind":"RESOURCE_EXHAUSTED","retryable":false,"details":{"resource":"subscriptions","limit":32}}}}',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("fieldd.product_api.subscription_budget_refused");
    expect(warn.mock.calls[0]?.[2]).toEqual({
      method: "system.health.subscribe",
      count: limit,
      opening: 0,
      limit,
      connectionId: "conn_budget",
      principal: "local-token",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PARAM_WORD);

    // the same burst: refused again, said once
    expect((await subscribe(limit + 2))["error"]).toBeDefined();
    expect((await subscribe(limit + 3))["error"]).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);

    // the count falls under the limit and fills again: the next refusal is a
    // new burst, and is said again
    const [firstId, dispose] = [...state.subs.entries()][0]!;
    dispose();
    state.subs.delete(firstId);
    expect((await subscribe(limit + 4))["result"]).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect((await subscribe(limit + 5))["error"]).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[2]).toMatchObject({
      method: "system.health.subscribe",
      count: limit,
    });
  });

  it("counts a subscription still opening in the logged count, and its burst the same way", async () => {
    // Items 467 and 470 (2026-11-16) — the budget reads installed + opening, so
    // the line says that count, and how many of it are still opening; a burst
    // ends only when a subscribe is admitted, whichever way the slot came free.
    const warn = vi.fn();
    const rig = budgetRig(recordingLogger(warn));
    const first = rig.subscribe(401);
    rig.subscribe(402);
    expect(JSON.stringify(rig.answers.get(402))).toBe(refusalWire(402));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[2]).toMatchObject({ count: LIMIT, opening: 1, limit: LIMIT });
    rig.subscribe(403);
    expect(warn).toHaveBeenCalledTimes(1);

    // the opening one fails and gives its slot back: still the same burst
    rig.opening.shift()?.reject(new Error("the producer could not open"));
    await expect(first).rejects.toThrow("the producer could not open");
    expect(warn).toHaveBeenCalledTimes(1);

    // admitted again, then full: a new burst, said again
    rig.control.mode = "answer";
    await rig.subscribe(404);
    rig.subscribe(405);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[2]).toMatchObject({ count: LIMIT, opening: 0 });
  });
});

// ── item 470's rig ──

const LIMIT = PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION;
const METHOD = "system.health.subscribe";
type Install = { snapshot: unknown; dispose: () => void; start?: () => void };

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** fieldd's refusal of one subscription too many, as the wire carries it today. */
const refusalWire = (id: number): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32010,
      message: "this connection holds too many live subscriptions",
      data: {
        kind: "RESOURCE_EXHAUSTED",
        retryable: false,
        details: { resource: "subscriptions", limit: LIMIT },
      },
    },
  });

/** A connection's state holding `filled` live subscriptions and none opening. */
function connState(filled: number) {
  const subs = new Map<string, () => void>();
  for (let i = 0; i < filled; i += 1) subs.set(`held-${i}`, () => undefined);
  return {
    ctx: {
      principal: { kind: "local-token", tokenId: "tk_window", scopes: [] },
      transport: "ws-loopback",
      receivedAt: 0,
    },
    connectionId: "conn_budget_race",
    subs,
    pendingSubs: 0,
    abortController: new AbortController(),
  };
}

/** Item 467 — a logger whose warnings the row reads. */
function recordingLogger(warn: Logger["warn"]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    fatal: vi.fn(),
    isLevelEnabled: () => true,
  };
  return logger;
}

/** The local install site at one free slot; its handler answers later, at
 * once, or throws, as `control.mode` says. */
function budgetRig(logger?: Logger) {
  const api = new ProductApi({
    port: 0,
    tokens: { verify: () => null },
    ...(logger !== undefined ? { logger } : {}),
  });
  const control = { mode: "later" as "later" | "throw" | "answer", entered: 0 };
  const opening: Array<Deferred<Install>> = [];
  api.registerSubscription(METHOD, () => {
    control.entered += 1;
    if (control.mode === "throw") throw new Error("the producer refused at once");
    if (control.mode === "answer") return { snapshot: { ok: true }, dispose: () => undefined };
    const open = deferred<Install>();
    opening.push(open);
    return open.promise;
  });
  const internals = api as unknown as {
    subHandlers: Map<string, unknown>;
    execute(
      ws: unknown,
      state: unknown,
      id: number,
      method: string,
      params: unknown,
      handler: undefined,
      subHandler: unknown,
      reply: (value: unknown) => void,
    ): Promise<void>;
  };
  const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn() };
  const state = connState(LIMIT - 1);
  const answers = new Map<number, Record<string, unknown>>();
  const handler = internals.subHandlers.get(METHOD);
  const subscribe = (id: number): Promise<void> =>
    internals.execute(ws, state, id, METHOD, {}, undefined, handler, (value) => {
      answers.set(id, value as Record<string, unknown>);
    });
  const held = (): number => state.subs.size + state.pendingSubs;
  return { control, opening, state, answers, subscribe, held };
}
