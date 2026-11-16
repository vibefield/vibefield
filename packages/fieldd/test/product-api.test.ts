import { EventEmitter } from "node:events";
import {
  AgentSubscribeParams,
  MESH_CONTROL_LIMITS,
  METHODS,
  PRODUCT_API_LIMITS,
  resolveSubscriptionAdmission,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { refuseBoardAsk } from "../src/agent-field";
import { RpcCallError } from "../src/native-link";
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
    const state = connState(0);

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
    expectLedger(state);
  });

  it("refuses one key's subscription past its holders, and keeps the live ones", async () => {
    // EL7 — a subscription is recurring WORK, not a read: the field projection
    // lists and encodes per subscriber per flush, so one socket holding an
    // unbounded map buys the daemon's tick budget. The refusal lands BEFORE the
    // handler runs (`subscribed` stays at its pre-call count) and touches
    // nothing already installed. Item 476 (2026-11-16) — the bound is the KEY's
    // holders (a `one` method's key, at the default 8), no longer a pool of 32
    // every feed shared.
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
    const state = connState(0);
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

    const limit = HOLDERS;
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
    expectLedger(state);

    // and a slot freed by an unsubscribe is usable again (the door's own
    // `system.unsubscribe`, which gives the key's count back)
    const [firstId] = [...state.subs.keys()];
    await unsubscribe(api, ws, state, firstId!);
    expect(state.subs.size).toBe(limit - 1);
    expectLedger(state);
    expect((await subscribe(limit + 2))["result"]).toBeDefined();
    expect(state.subs.size).toBe(limit);
    expectLedger(state);
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

    expectLedger(rig.state);

    // the open answers late: at no await point does the connection hold more
    for (const open of rig.opening.splice(0)) {
      open.resolve({ snapshot: { ok: true }, dispose: () => undefined });
      await tick();
      expect(rig.held()).toBeLessThanOrEqual(LIMIT);
      expectLedger(rig.state);
    }
    await Promise.all(asked);
    expect(rig.state.subs.size).toBe(LIMIT);
    expect(rig.state.pendingSubs).toBe(0);
    expect(rig.answers.get(101)?.["result"]).toBeDefined();
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    expectLedger(rig.state);

    // a handler that throws before it answers gives its slot back the same way
    rig.control.mode = "throw";
    await expect(rig.subscribe(203)).rejects.toThrow("the producer refused at once");
    expect(rig.state.pendingSubs).toBe(0);
    expectLedger(rig.state);

    // and the slot is usable again
    rig.control.mode = "answer";
    await rig.subscribe(204);
    expect(rig.answers.get(204)?.["result"]).toBeDefined();
    expect(rig.state.subs.size).toBe(LIMIT);
    expect(rig.state.pendingSubs).toBe(0);
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
  });

  it("reserves a plugin provider's subscription the same way, and gives it back when the provider throws", async () => {
    // Item 470 (2026-11-16) — the third install site: a dynamic method's
    // provider (P4), opened through the router. Item 476 (2026-11-16) — the
    // method is its key, bounded at 32 on the connection: its last free slot.
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
    const state = connState(PROVIDED_BOUND - 1, PROVIDED);
    const answers = new Map<number, Record<string, unknown>>();
    const ask = (id: number): Promise<void> =>
      internals.executeDynamic(ws, state, id, PROVIDED, {}, (value) => {
        answers.set(id, value as Record<string, unknown>);
      });

    const first = ask(301);
    ask(302);
    ask(303);
    expect(entered).toBe(1);
    expect(JSON.stringify(answers.get(302))).toBe(refusalWire(302, PROVIDED_BOUND));
    expect(JSON.stringify(answers.get(303))).toBe(refusalWire(303, PROVIDED_BOUND));
    expect(state.subs.size + state.pendingSubs).toBe(PROVIDED_BOUND);
    expectLedger(state);

    opening.shift()?.reject(new Error("the provider could not open"));
    await expect(first).rejects.toThrow("the provider could not open");
    expect(state.pendingSubs).toBe(0);
    expect(state.subs.size).toBe(PROVIDED_BOUND - 1);
    expectLedger(state);

    const next = ask(304);
    expect(entered).toBe(2);
    opening.shift()?.resolve({ snapshot: {}, dispose: () => undefined });
    await next;
    expect(answers.get(304)?.["result"]).toBeDefined();
    expect(state.subs.size).toBe(PROVIDED_BOUND);
    expect(state.pendingSubs).toBe(0);
    expectLedger(state);
    closeSubscriptions(api, state);
    expectLedgerEmpty(state);
  });

  it("lets go at once a subscription whose connection closed while its handler was out", async () => {
    // Item 474 (2026-11-16) — the close disposes and clears `subs` while the
    // handler is out; the late install then landed on the cleared map, nothing
    // ever disposed it, and its producer kept working for a dead socket.
    const rig = budgetRig();
    const asked = rig.subscribe(501);
    // the socket's close, as its handler runs it: abort, then every live one
    // removed whole (item 476: the opening one keeps its key's count until its
    // own `finally` gives it back)
    rig.close();
    expectLedger(rig.state);

    const dispose = vi.fn();
    const start = vi.fn();
    rig.opening.shift()?.resolve({ snapshot: { ok: true }, dispose, start });
    await asked;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(rig.state.subs.size).toBe(0);
    expect(rig.state.pendingSubs).toBe(0);
    expectLedgerEmpty(rig.state);
  });

  it("logs a refused subscription once per burst: the method, the count and the limit, never the params", async () => {
    // Item 467 (2026-11-16) — a budget hit used to leave no trace: the refusal
    // went to the caller alone, so after the fact nobody could tell which feed
    // was refused, or that the window had filled its connection. One line says
    // so at the first refusal; the rest of a storm says nothing until the count
    // has fallen under the limit and filled again. Item 476 (2026-11-16) — the
    // count and the limit are the key's, and the line names the key's class.
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
    const state = { ...connState(0), connectionId: "conn_budget" };
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

    const limit = HOLDERS;
    for (let i = 0; i < limit; i += 1) await subscribe(i + 1);
    expect(state.subs.size).toBe(limit);
    expect(warn).not.toHaveBeenCalled();

    // the first refusal: one line, and the caller's answer exactly as before,
    // the limit the key's
    const refused = await subscribe(limit + 1);
    expect(JSON.stringify(refused)).toBe(
      '{"jsonrpc":"2.0","id":9,"error":{"code":-32010,"message":"this connection holds too many live subscriptions","data":{"kind":"RESOURCE_EXHAUSTED","retryable":false,"details":{"resource":"subscriptions","limit":8}}}}',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("fieldd.product_api.subscription_budget_refused");
    expect(warn.mock.calls[0]?.[2]).toEqual({
      method: "system.health.subscribe",
      class: "one",
      count: limit,
      opening: 0,
      limit,
      connectionId: "conn_budget",
      principal: "local-token",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PARAM_WORD);
    expectLedger(state);

    // the same burst: refused again, said once
    expect((await subscribe(limit + 2))["error"]).toBeDefined();
    expect((await subscribe(limit + 3))["error"]).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);

    // the count falls under the limit and fills again: the next refusal is a
    // new burst, and is said again
    const [firstId] = [...state.subs.keys()];
    await unsubscribe(api, ws, state, firstId!);
    expect((await subscribe(limit + 4))["result"]).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect((await subscribe(limit + 5))["error"]).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[2]).toMatchObject({
      method: "system.health.subscribe",
      count: limit,
    });
    expectLedger(state);
    closeSubscriptions(api, state);
    expectLedgerEmpty(state);
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
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    expectLedger(rig.state);
    expect(rig.state.heldByKey.size).toBe(40);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    // one key on the ledger, held by the 8
    expectLedger(rig.state);
    expect([...rig.state.heldByKey.values()]).toEqual([8]);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
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
    expectLedger(rig.state);
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
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
  });
});

describe("item 476 — the ledger: every slot given back, nothing held for what does not exist", () => {
  // Item 476 (2026-11-16) — guards, green before the keys and after in what
  // they answer, pinned here to the door's per-key ledger: each key's count
  // (`heldByKey`, installed plus opening) must agree with `subs` and
  // `pendingSubs` at every step, fall at every removal, and leave no entry
  // behind for an ask its handler refused, or the room a key holds would leak.

  it("holds nothing for 1,000 plugin lanes asked for plugins that do not exist: every one NOT_FOUND, the ledger EMPTY", async () => {
    const rig = doorRig();
    rig.handle("plugins.update.subscribe", (_ctx, params) => {
      const pluginId = String((params as { pluginId?: unknown }).pluginId);
      throw new RpcCallError("NOT_FOUND", `no such plugin: ${pluginId}`, false);
    });
    for (let n = 0; n < 1_000; n += 1) {
      const answer = await rig.call("plugins.update.subscribe", {
        pluginId: `com.example.absent${n}`,
      });
      expect(refusalOf(answer)?.kind, `ask ${n}`).toBe("NOT_FOUND");
    }
    expectLedgerEmpty(rig.state);
  });

  it("holds nothing for 1,000 routed asks to desktops that are not there: every one UNAVAILABLE, the ledger EMPTY", async () => {
    const rig = doorRig({
      subForwarder: async (device) => {
        throw new RpcCallError("UNAVAILABLE", "no product endpoint for that desktop", true, {
          service: "peer-link",
          device,
          state: "unknown",
        });
      },
    });
    rig.handle("device.subscribe", () => ({ snapshot: [], dispose: () => undefined }));
    for (let n = 0; n < 1_000; n += 1) {
      const answer = await rig.call("device.subscribe", { device: `dev-unknown-${n}` });
      expect(refusalOf(answer)?.kind, `ask ${n}`).toBe("UNAVAILABLE");
    }
    expectLedgerEmpty(rig.state);
  });

  it("reserves at a key's last holder slot: asks together there admit exactly one (item 470, per key)", async () => {
    const rig = doorRig();
    for (let n = 1; n <= 7; n += 1) await rig.ask("system.health.subscribe");
    rig.control.mode = "later";
    const [first, ...rest] = Array.from({ length: 4 }, () => rig.ask("system.health.subscribe"));
    expect(rig.entered("system.health.subscribe")).toBe(8);
    expect(rig.opening).toHaveLength(1);
    expectLedger(rig.state);
    for (const answer of await Promise.all(rest)) {
      expect(refusalOf(answer)).toEqual(roomRefusal(8));
    }
    // another key is untouched by this one's being full
    rig.control.mode = "answer";
    expect((await rig.ask("services.subscribe"))["result"]).toBeDefined();
    expectLedger(rig.state);

    rig.opening.shift()?.resolve({ snapshot: {}, dispose: () => undefined });
    expect((await first!)["result"]).toBeDefined();
    expect(rig.state.subs.size).toBe(9);
    expect(rig.state.pendingSubs).toBe(0);
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
  });

  it("holds nothing for a connection closed while its asks were opening (item 474, per key)", async () => {
    const rig = doorRig();
    await rig.ask("system.health.subscribe");
    await rig.ask("services.subscribe");
    rig.control.mode = "later";
    const late = [rig.ask("system.health.subscribe"), rig.ask("agents.usage.subscribe")];
    expectLedger(rig.state);

    // the socket's own close: the live ones go whole, the opening ones keep
    // their keys' counts until their own `finally`
    rig.close();
    expect(rig.disposed).toEqual(["system.health.subscribe", "services.subscribe"]);
    expect(rig.state.subs.size).toBe(0);
    expect(rig.state.pendingSubs).toBe(2);
    expectLedger(rig.state);

    const dispose = vi.fn();
    const start = vi.fn();
    for (const open of rig.opening.splice(0)) open.resolve({ snapshot: {}, dispose, start });
    await Promise.all(late);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
    expectLedgerEmpty(rig.state);
  });

  it("keeps a held key's count when its thing goes: a new ask is NOT_FOUND, and the close gives the count back", async () => {
    // Item 476 — fieldd disposes nothing a connection holds when its thing
    // goes; a held subscription stays its key's holder until it is let go or
    // the connection closes, and a NEW ask is refused as it always was.
    const rig = doorRig();
    const things = new Set(["com.example.kept"]);
    rig.handle("plugins.update.subscribe", (_ctx, params) => {
      const pluginId = String((params as { pluginId?: unknown }).pluginId);
      if (!things.has(pluginId)) {
        throw new RpcCallError("NOT_FOUND", `no such plugin: ${pluginId}`, false);
      }
      return { snapshot: {}, dispose: () => undefined };
    });
    const lane = { pluginId: "com.example.kept" };
    const { key } = resolveSubscriptionAdmission("plugins.update.subscribe", lane, {});
    expect((await rig.call("plugins.update.subscribe", lane))["result"]).toBeDefined();
    expect((await rig.call("plugins.update.subscribe", lane))["result"]).toBeDefined();
    expect(rig.state.heldByKey.get(key)).toBe(2);

    things.delete("com.example.kept");
    expect(refusalOf(await rig.call("plugins.update.subscribe", lane))?.kind).toBe("NOT_FOUND");
    expect(rig.state.heldByKey.get(key)).toBe(2);
    expect(rig.state.subs.size).toBe(2);
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
  });

  it("logs one key's refusals once per burst while other keys are admitted around them", async () => {
    // Item 467's flag was per connection and any admission cleared it; under
    // keys other feeds are admitted all the time, so one key refused in a loop
    // would have said a line at every ask. The flag is the key's: it ends when
    // that key is admitted again or falls to zero.
    const warn = vi.fn();
    const rig = doorRig({ logger: recordingLogger(warn) });
    for (let n = 0; n < 8; n += 1) await rig.ask("system.health.subscribe");
    for (let n = 0; n < 5; n += 1) {
      expect(refusalOf(await rig.ask("system.health.subscribe"))).toEqual(roomRefusal(8));
      const other = await rig.ask("plugins.update.subscribe", { pluginId: `com.example.p${n}` });
      expect(other["result"]).toBeDefined();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[2]).toMatchObject({
      method: "system.health.subscribe",
      class: "one",
      count: 8,
      limit: 8,
    });
    // never the key, which can hold what a person reads
    expect(JSON.stringify(warn.mock.calls)).not.toContain("com.example");
    expectLedger(rig.state);

    // the key falls to zero (each let go through the door), and fills again:
    // a new burst, said again
    const { key } = resolveSubscriptionAdmission("system.health.subscribe", {}, {});
    for (const [subId, held] of [...rig.state.subKeys.entries()]) {
      if (held !== key) continue;
      const answer = await rig.call("system.unsubscribe", { subId });
      expect(answer["result"]).toEqual({ removed: true });
    }
    expect(rig.state.heldByKey.has(key)).toBe(false);
    expect(rig.state.refusedLogged.has(key)).toBe(false);
    for (let n = 0; n < 8; n += 1) await rig.ask("system.health.subscribe");
    expect(refusalOf(await rig.ask("system.health.subscribe"))).toEqual(roomRefusal(8));
    expect(warn).toHaveBeenCalledTimes(2);
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
  });

  it("admits a method the table has no row for at the default holders, and says so once", async () => {
    // The census test holds every product subscription row to a declared
    // admission, so only a name no row carries reaches the fallback: one key,
    // the default holders, a line at its first ask. The door never refuses for
    // the missing row itself.
    const warn = vi.fn();
    const rig = doorRig({ logger: recordingLogger(warn) });
    const handler: SubscriptionHandler = () => ({ snapshot: {}, dispose: () => undefined });
    for (let n = 1; n <= 8; n += 1) {
      const answer = await rig.askWith(UNLISTED, { n }, handler);
      expect(answer["result"], `ask ${n}`).toBeDefined();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("fieldd.product_api.subscription_admission_undeclared");
    expect(warn.mock.calls[0]?.[2]).toMatchObject({ method: UNLISTED, limit: 8 });

    const refused = await rig.askWith(UNLISTED, { n: 9 }, handler);
    expect(refusalOf(refused)).toEqual(roomRefusal(8));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toBe("fieldd.product_api.subscription_budget_refused");
    expect(warn.mock.calls[1]?.[2]).toMatchObject({
      method: UNLISTED,
      class: "one",
      limit: 8,
      declared: false,
    });
    expectLedger(rig.state);
    rig.close();
    expectLedgerEmpty(rig.state);
  });
});

// ── item 470's rig ──

/** Item 476 (2026-11-16) — a key's holders on one connection, by default: the
 * bound item 470's rows meet at the key of `METHOD` (a `one` row), where they
 * met the pool of 32 before. */
const HOLDERS = PRODUCT_API_LIMITS.SUBSCRIPTION_HOLDERS_PER_KEY;
const LIMIT = HOLDERS;
const METHOD = "system.health.subscribe";
/** Item 476 — a plugin-provided method, and its bound on one connection (the
 * contract's plugin entry: the method is its key). */
const PROVIDED = "x.example.watch";
const PROVIDED_BOUND = 32;
/** Item 476 — a subscription name no admission row carries (never a product
 * method: `registerSubscription` would refuse it; the rows hand its handler to
 * the install site directly). */
const UNLISTED = "test.unlisted.subscribe";
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

/** fieldd's refusal of one subscription too many, as the wire carries it today
 * (item 476: the limit is the one that refused, a key's holders by default). */
const refusalWire = (id: number, limit: number = LIMIT): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32010,
      message: "this connection holds too many live subscriptions",
      data: {
        kind: "RESOURCE_EXHAUSTED",
        retryable: false,
        details: { resource: "subscriptions", limit },
      },
    },
  });

/** A connection's state holding `filled` live subscriptions of one key (`method`
 * asked with `{}`, keyed as the contract keys it) and none opening, with the
 * door's ledger for them (item 476), authenticated as a window so a row may
 * also drive the whole door (`onMessage`). */
function connState(filled: number, method: string = METHOD): LedgerState {
  const { key } = resolveSubscriptionAdmission(method, {}, {});
  const subs = new Map<string, () => void>();
  const subKeys = new Map<string, string>();
  const heldByKey = new Map<string, number>();
  for (let i = 0; i < filled; i += 1) {
    subs.set(`held-${i}`, () => undefined);
    subKeys.set(`held-${i}`, key);
  }
  if (filled > 0) heldByKey.set(key, filled);
  return {
    authed: true,
    ctx: WINDOW,
    scopes: [],
    connectionId: "conn_budget_race",
    subs,
    subKeys,
    pendingSubs: 0,
    heldByKey,
    refusedLogged: new Set<string>(),
    undeclaredLogged: new Set<string>(),
    abortController: new AbortController(),
  };
}

/** The door's private entry points a row with a hand-built state drives. */
interface DoorInternals {
  onMessage(ws: unknown, state: unknown, raw: string): Promise<void>;
  closeSubscriptions(state: unknown): void;
}

/** Item 476 — the door's own close, for a state a row built by hand: the
 * socket's close aborts first, then lets every live subscription go. */
function closeSubscriptions(api: ProductApi, state: LedgerState): void {
  state.abortController.abort();
  (api as unknown as DoorInternals).closeSubscriptions(state);
}

/** Item 476 — one live subscription let go through the door's own
 * `system.unsubscribe`, as a client lets it go (its key's count given back). */
async function unsubscribe(
  api: ProductApi,
  ws: unknown,
  state: RigState,
  subId: string,
): Promise<void> {
  const frame = { jsonrpc: "2.0", id: 9_999, method: "system.unsubscribe", params: { subId } };
  await (api as unknown as DoorInternals).onMessage(ws, state, JSON.stringify(frame));
}

/** Item 476 — the ledger agrees with itself: every key's count is a live
 * subscription or one still opening, and every live one has its key. */
function expectLedger(state: RigState): void {
  let counted = 0;
  for (const count of state.heldByKey.values()) {
    expect(count).toBeGreaterThan(0);
    counted += count;
  }
  expect(counted).toBe(state.subs.size + state.pendingSubs);
  expect(state.subKeys.size).toBe(state.subs.size);
}

/** Item 476 — nothing held: no subscription, none opening, no key, no flag. */
function expectLedgerEmpty(state: RigState): void {
  expect(state.subs.size).toBe(0);
  expect(state.pendingSubs).toBe(0);
  expect(state.subKeys.size).toBe(0);
  expect(state.heldByKey.size).toBe(0);
  expect(state.refusedLogged.size).toBe(0);
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

/** The local install site at one free slot of `METHOD`'s key; its handler
 * answers later, at once, or throws, as `control.mode` says. */
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
  /** the socket closes (item 476: through the door's own close) */
  const close = (): void => closeSubscriptions(api, state);
  return { control, opening, state, answers, subscribe, held, close };
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

/** What these rows read of a connection's state, as the door built it at the upgrade, the
 * door's per-key ledger with it (item 476). */
interface RigState {
  authed: boolean;
  ctx: unknown;
  scopes: string[];
  subs: Map<string, () => void>;
  subKeys: Map<string, string>;
  pendingSubs: number;
  heldByKey: Map<string, number>;
  refusedLogged: Set<string>;
}

/** A state a row builds by hand (`connState`): the rest of what the install sites read. */
interface LedgerState extends RigState {
  connectionId: string;
  undeclaredLogged: Set<string>;
  abortController: AbortController;
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
