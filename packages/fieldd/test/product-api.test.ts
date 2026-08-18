import { MESH_CONTROL_LIMITS } from "@vibefield/contracts";
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
});
