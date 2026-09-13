import { MESH_CONTROL_LIMITS, PRODUCT_API_LIMITS } from "@vibefield/contracts";
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
});
