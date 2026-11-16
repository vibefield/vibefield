import { EventEmitter } from "node:events";
import {
  AgentSubscribeParams,
  MESH_CONTROL_LIMITS,
  METHODS,
  PRODUCT_API_LIMITS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { refuseBoardAsk } from "../src/agent-field";
import {
  type DeviceSubscriptionForwarder,
  type DynamicRouterLike,
  ProductApi,
  type SubscriptionHandler,
} from "../src/product-api";

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

describe("item 476 — the door admits a subscription by its key, not by a pool", () => {
  // Item 476 (2026-11-16) — one pool of 32 per connection, shared by every feed
  // a window opens, let one view starve another and filled with what a person
  // installs (a plugin's update lane each), while it bounded one connection,
  // not a caller (the bound per caller is item 480's). The door now admits by
  // the ask's KEY (its method and declared identity params, the contract's admission table):
  // a key holds at most its limit on one connection, and unrelated keys never
  // compete. These rows read behaviour only (an answer's `result`, a refusal's
  // `data`), so they read the same against the pool and against the keys.

  it("admits 40 distinct real keys on one connection: unrelated feeds no longer compete", async () => {
    // the pool refused the 33rd whatever it asked for
    const rig = doorRig();
    const asks = ONE_METHODS.map((method): readonly [string, unknown] => [method, {}]);
    for (let n = 0; n < 30; n += 1) {
      asks.push(["plugins.update.subscribe", { pluginId: `com.example.p${n}` }]);
    }
    expect(asks).toHaveLength(40);
    for (const [n, [method, params]] of asks.entries()) {
      const answer = await rig.ask(method, params);
      expect(answer["result"], `ask ${n + 1}: ${method} ${JSON.stringify(params)}`).toBeDefined();
    }
    expect(rig.state.subs.size).toBe(40);
  });

  it("refuses one key's 9th holder with the key's limit, and leaves its 8 live ones and every other key alone", async () => {
    const rig = doorRig();
    const lane = { pluginId: "com.example.one" };
    for (let n = 1; n <= 8; n += 1) {
      const answer = await rig.ask("plugins.update.subscribe", lane);
      expect(answer["result"], `holder ${n}`).toBeDefined();
    }
    const refused = await rig.ask("plugins.update.subscribe", lane);
    expect(refusalOf(refused)).toEqual(roomRefusal(8));
    // an admission decision, not a teardown: the 8 stand, and the handler never
    // ran for the 9th
    expect(rig.state.subs.size).toBe(8);
    expect(rig.entered("plugins.update.subscribe")).toBe(8);
    expect(rig.disposed).toEqual([]);
    // another plugin's lane is a key of its own
    const other = await rig.ask("plugins.update.subscribe", { pluginId: "com.example.two" });
    expect(other["result"]).toBeDefined();
    expect(rig.state.subs.size).toBe(9);
  });

  it("keys a real board by its identity alone: 1,000 asks varying junk, tuning and spelled defaults are one key, refused at the 9th by the door", async () => {
    // The handler is the board's own gate (`refuseBoardAsk`, MF-1h): every
    // variation is one it accepts, checked below, so a refusal here can only be
    // the door's. Tuning is only ever SLOWER than the model board's floor (the
    // fold's 16 ms tick), the heartbeat within its range at the local scope, and
    // the scope is spelled (`local`) or left to its default.
    const rig = doorRig();
    let entered = 0;
    rig.handle("agent.subscribe", (ctx, params) => {
      const refusal = refuseBoardAsk(ctx.principal.kind, AgentSubscribeParams.parse(params));
      if (refusal !== null) throw refusal;
      entered += 1;
      return { snapshot: {}, dispose: () => undefined };
    });
    const variations = Array.from({ length: 1_000 }, (_, n) => boardVariation(n));
    expect(new Set(variations.map((variation) => JSON.stringify(variation))).size).toBe(1_000);
    for (const variation of variations) {
      expect(refuseBoardAsk("local-token", AgentSubscribeParams.parse(variation))).toBeNull();
    }

    for (const [n, variation] of variations.entries()) {
      const answer = await rig.ask("agent.subscribe", variation);
      if (n < 8) expect(answer["result"], `variation ${n}`).toBeDefined();
      else expect(refusalOf(answer), `variation ${n}`).toEqual(roomRefusal(8));
    }
    expect(entered).toBe(8);
    expect(rig.state.subs.size).toBe(8);
  });

  it("holds a bounded method to its bound: diagnostics.subscribe past 4, whatever each asks", async () => {
    const rig = doorRig();
    for (let n = 1; n <= 4; n += 1) {
      const answer = await rig.ask("diagnostics.subscribe", { filter: { minLevel: "warn", n } });
      expect(answer["result"], `subscription ${n}`).toBeDefined();
    }
    const refused = await rig.ask("diagnostics.subscribe", { filter: { minLevel: "warn", n: 5 } });
    expect(refusalOf(refused)).toEqual(roomRefusal(4));
    expect(rig.entered("diagnostics.subscribe")).toBe(4);
  });

  it("holds a bounded method to its bound: index.session.subscribe past 8 distinct sessions", async () => {
    const rig = doorRig();
    for (let n = 1; n <= 8; n += 1) {
      const answer = await rig.ask("index.session.subscribe", { sessionId: `session-${n}` });
      expect(answer["result"], `session ${n}`).toBeDefined();
    }
    const refused = await rig.ask("index.session.subscribe", { sessionId: "session-9" });
    expect(refusalOf(refused)).toEqual(roomRefusal(8));
    expect(rig.entered("index.session.subscribe")).toBe(8);
  });

  it("holds a plugin-provided method to its bound of 32 at the provider's site, beside 20 other keys", async () => {
    // the third install site (P4's router); the pool refused its 13th here, the
    // 20 other keys having taken their slots
    let provided = 0;
    const rig = doorRig({
      router: {
        kindOf: () => "subscription",
        call: async () => undefined,
        subscribe: async () => {
          provided += 1;
          return { snapshot: {}, dispose: () => undefined };
        },
      },
    });
    for (let n = 0; n < 20; n += 1) {
      const answer = await rig.ask("plugins.update.subscribe", { pluginId: `com.example.h${n}` });
      expect(answer["result"], `other key ${n + 1}`).toBeDefined();
    }
    for (let n = 1; n <= 32; n += 1) {
      const answer = await rig.askDynamic("x.example.watch", { query: `q${n}` });
      expect(answer["result"], `provided ${n} of 32`).toBeDefined();
    }
    const refused = await rig.askDynamic("x.example.watch", { query: "q33" });
    expect(refusalOf(refused)).toEqual(roomRefusal(32));
    expect(provided).toBe(32);
    expect(rig.state.subs.size).toBe(52);
  });

  it("admits a development window's twins: direct sites asked twice at once, the model board five at once, and refuses its 9th", async () => {
    // StrictMode's discarded first mount is real to the daemon for a moment: a
    // direct subscriber holds its key twice until its own answer lets the twin
    // go (item 476, the dev window). Profile sets: three direct sites, each
    // twice. The model board: Godview and Peek's Live now twice, and one more
    // while a gap re-opens it. An opening ask is a holder (item 470), so all
    // eleven are asked before any answers.
    const rig = doorRig();
    rig.control.mode = "later";
    const asked: Array<Promise<Answer>> = [];
    for (let n = 0; n < 6; n += 1) asked.push(rig.ask("agents.profileSets.subscribe", {}));
    for (let n = 0; n < 5; n += 1) asked.push(rig.ask("agent.subscribe", { projection: "model" }));
    expect(rig.opening).toHaveLength(11);
    for (const open of rig.opening.splice(0)) {
      open.resolve({ snapshot: {}, dispose: () => undefined });
    }
    const answers = await Promise.all(asked);
    for (const [n, answer] of answers.entries()) {
      expect(answer["result"], `twin ${n + 1}`).toBeDefined();
    }

    rig.control.mode = "answer";
    for (let n = 6; n <= 8; n += 1) {
      const answer = await rig.ask("agent.subscribe", { projection: "model" });
      expect(answer["result"], `model board ${n}`).toBeDefined();
    }
    const refused = await rig.ask("agent.subscribe", { projection: "model" });
    expect(refusalOf(refused)).toEqual(roomRefusal(8));
    expect(rig.state.subs.size).toBe(14);
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

// ── item 476's rig ──

/** One answer the door wrote back, as its client reads it. */
type Answer = Record<string, unknown>;

/** A refusal's `data`, as the wire carries it. */
interface RefusalData {
  kind: string;
  retryable: boolean;
  details?: unknown;
}

/** The refusal's `data` in an answer; undefined for an answer that is not one. */
function refusalOf(answer: Answer | undefined): RefusalData | undefined {
  return (answer?.["error"] as { data?: RefusalData } | undefined)?.data;
}

/** The door's refusal for room, as its `data` says it: the limit that refused, nothing more. */
function roomRefusal(limit: number): RefusalData {
  return {
    kind: "RESOURCE_EXHAUSTED",
    retryable: false,
    details: { resource: "subscriptions", limit },
  };
}

/** Ten of the contract's `one` rows: each method is one key, whatever it is asked. */
const ONE_METHODS = [
  "system.health.subscribe",
  "artifact.subscribe",
  "device.subscribe",
  "plugins.subscribe",
  "services.subscribe",
  "user.link.subscribe",
  "setup.subscribe",
  "process.subscribe",
  "index.status.subscribe",
  "agents.operations.subscribe",
] as const;

/** Slower than the model board's floor (`AGENT_FIELD.FULL_TICK_MS`, 16 ms), or absent. */
const BOARD_INTERVALS = [undefined, 32, 100, 250, 1_000, 60_000] as const;
/** Within `heartbeatMs`'s range (250 ms to 60 s), asked at the local scope, or absent. */
const BOARD_HEARTBEATS = [undefined, 250, 1_000, 30_000] as const;

/** The `n`th spelling of ONE key, `agent.subscribe {projection: "model"}` at the local scope:
 * the scope spelled or left to its default, tuning varied within what the board accepts, and
 * passthrough junk varied freely. */
function boardVariation(n: number): Record<string, unknown> {
  const minIntervalMs = BOARD_INTERVALS[n % BOARD_INTERVALS.length];
  const heartbeatMs = BOARD_HEARTBEATS[Math.floor(n / 2) % BOARD_HEARTBEATS.length];
  return {
    projection: "model",
    ...(n % 2 === 0 ? {} : { scope: "local" }),
    ...(minIntervalMs !== undefined ? { minIntervalMs } : {}),
    ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
    [`junk${n}`]: n,
    note: "x".repeat(n % 13),
    nested: { n, list: [n, String(n)] },
  };
}

/** A window's context, as its hello leaves it. */
const WINDOW = {
  principal: { kind: "local-token", tokenId: "tk_window", scopes: [] },
  transport: "ws-loopback",
  receivedAt: 0,
};

/** Every scope a product method names: the rig's window may ask anything, so a row through
 * the whole door reads the door's admission, never its scope check. */
const EVERY_SCOPE = [...new Set(METHODS.flatMap((def) => (def.scope ? [def.scope] : [])))];

/** A socket the door can hold: what the door writes is read back, and its close is the door's
 * own close handler, run by the event. */
class RigSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  readonly frames: Answer[] = [];
  readonly send = vi.fn((data: string) => {
    this.frames.push(JSON.parse(data) as Answer);
  });
  readonly close = vi.fn();
  readonly terminate = vi.fn();
}

/** What these rows read of a connection's state, as the door built it at the upgrade. */
interface RigState {
  authed: boolean;
  ctx: unknown;
  scopes: string[];
  subs: Map<string, () => void>;
  pendingSubs: number;
}

interface DoorRigOptions {
  logger?: Logger;
  /** P4 — the provider site's router */
  router?: DynamicRouterLike;
  /** C6-5 — the federated proxy; arms routing, this desktop being `dev-self` */
  subForwarder?: DeviceSubscriptionForwarder;
}

/** Item 476 — one connection the door accepted at its own upgrade (`onConnection`), a window's
 * hello set on its state. Stub producers are registered under REAL method names, through
 * `registerSubscription`, which refuses a name the contract's rows do not hold; each answers at
 * once or later, as `control.mode` says. Asks go through the local install site (`execute`),
 * the provider's (`executeDynamic`) or the whole door (`onMessage`: a routed ask, an
 * unsubscribe); `close` is the socket's own close event. */
function doorRig(options: DoorRigOptions = {}) {
  const api = new ProductApi({
    port: 0,
    tokens: { verify: () => null },
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });
  if (options.router !== undefined) api.setDynamicRouter(options.router);
  if (options.subForwarder !== undefined) {
    api.setDeviceRouting(() => "dev-self", vi.fn(), options.subForwarder);
  }
  const internals = api as unknown as {
    subHandlers: Map<string, SubscriptionHandler>;
    liveConns: Set<{ ws: unknown; state: RigState }>;
    onConnection(ws: unknown, req: unknown): void;
    onMessage(ws: unknown, state: unknown, raw: string): Promise<void>;
    execute(
      ws: unknown,
      state: unknown,
      id: number,
      method: string,
      params: unknown,
      handler: undefined,
      subHandler: SubscriptionHandler | undefined,
      reply: (value: unknown) => void,
    ): Promise<void>;
    executeDynamic(
      ws: unknown,
      state: unknown,
      id: number,
      method: string,
      params: unknown,
      reply: (value: unknown) => void,
    ): Promise<void>;
  };
  const ws = new RigSocket();
  internals.onConnection(ws, { headers: {}, url: "/" });
  const conn = [...internals.liveConns].at(-1);
  if (conn === undefined) throw new Error("the door took no connection");
  const { state } = conn;
  // the hello's outcome, as the door's own sets it: a window's grant
  state.authed = true;
  state.ctx = WINDOW;
  state.scopes = [...EVERY_SCOPE];

  const control = { mode: "answer" as "answer" | "later" };
  const counts = new Map<string, number>();
  const disposed: string[] = [];
  const opening: Array<Deferred<Install>> = [];
  let nextId = 1;

  function producer(method: string): SubscriptionHandler {
    return () => {
      counts.set(method, (counts.get(method) ?? 0) + 1);
      if (control.mode === "later") {
        const open = deferred<Install>();
        opening.push(open);
        return open.promise;
      }
      return {
        snapshot: { method },
        dispose: () => {
          disposed.push(method);
        },
      };
    };
  }

  /** The door's reply to one ask at the local install site, with this handler. A handler's
   * throw rejects, as `execute` throws it to `onMessage`'s mapping. */
  async function askWith(
    method: string,
    params: unknown,
    handler: SubscriptionHandler | undefined,
  ): Promise<Answer> {
    const id = nextId++;
    let answer: Answer = {};
    await internals.execute(ws, state, id, method, params, undefined, handler, (value) => {
      answer = value as Answer;
    });
    return answer;
  }

  /** As `askWith`, with the method's registered producer (the rig's own, unless a row set one
   * with `handle`). */
  async function ask(method: string, params: unknown = {}): Promise<Answer> {
    if (!internals.subHandlers.has(method)) api.registerSubscription(method, producer(method));
    return askWith(method, params, internals.subHandlers.get(method));
  }

  /** The door's reply to one ask at the provider's site (`x.` methods). */
  async function askDynamic(method: string, params: unknown): Promise<Answer> {
    const id = nextId++;
    let answer: Answer = {};
    await internals.executeDynamic(ws, state, id, method, params, (value) => {
      answer = value as Answer;
    });
    return answer;
  }

  /** One frame through the whole door (`onMessage`), and the answer it wrote for it. */
  async function call(method: string, params: unknown): Promise<Answer> {
    const id = nextId++;
    await internals.onMessage(ws, state, JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const answer = ws.frames.find((frame) => frame["id"] === id);
    if (answer === undefined) throw new Error(`the door did not answer ${method} (${id})`);
    return answer;
  }

  /** A row's own producer for a real method, in place of the rig's. */
  function handle(method: string, handler: SubscriptionHandler): void {
    api.registerSubscription(method, handler);
  }

  /** How often the rig's producer for this method was entered. */
  function entered(method: string): number {
    return counts.get(method) ?? 0;
  }

  /** The socket closes: the door's own close handler runs. */
  function close(): void {
    ws.emit("close");
  }

  return {
    api,
    ws,
    state,
    control,
    opening,
    disposed,
    ask,
    askWith,
    askDynamic,
    call,
    handle,
    entered,
    close,
  };
}
