// PG-3b (the 3b review [4], [7]) — the door's two seams for `agent.reportShown`'s forward, held narrow: a hook
// around one method's forward (`wrapForward`), and the daemon's own carry of a read for a client (`forwardFor`). A
// standalone ProductApi with a scripted token and a real ws client (the device-routing harness's pattern).
import type { CallerContext } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { type DeviceForwarder, ProductApi } from "../src/product-api";
import { helloAs, WsRpc } from "./ws-rpc";

const OWN_ID = "dev-self";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function door(forwarder = vi.fn<DeviceForwarder>(async () => ({ reported: true }))) {
  const api = new ProductApi({
    port: 0,
    tokens: {
      verify: (t) =>
        t === "good-token" ? { tokenId: "tk1", scopes: ["agent.observe"], label: "t" } : null,
    },
  });
  api.setDeviceRouting(() => OWN_ID, forwarder);
  api.register("agent.reportShown", () => ({ reported: true }));
  cleanup.push(() => api.close());
  return { api, forwarder };
}

const ctx: CallerContext = {
  principal: { kind: "tailnet", login: "me@example.com", self: true },
  transport: "ws-tailnet",
  receivedAt: 0,
  connection: { id: "conn_phone", helloClientKind: "ios" },
};

describe("PG-3b — the forward hook and the daemon's own carry", () => {
  it("wrapForward takes a call-and-answer read that forwards, once: never a subscription, a local method or a keyed mutation", () => {
    const { api } = door();
    const hook = async (
      _c: CallerContext,
      _d: string,
      _p: unknown,
      carry: () => Promise<unknown>,
    ) => carry();
    expect(() => api.wrapForward("agent.subscribe", hook)).toThrow(/subscription/);
    expect(() => api.wrapForward("agent.lastRun", hook)).toThrow(/local/);
    expect(() => api.wrapForward("agent.interrupt", hook)).toThrow(/keyed/);
    api.wrapForward("agent.reportShown", hook);
    expect(() => api.wrapForward("agent.reportShown", hook)).toThrow(/already/);
  });

  it("forwardFor carries only a method that registered a hook, with the client's provenance", async () => {
    const { api, forwarder } = door();
    // a federated read with no hook is not the daemon's to carry for a client
    expect(() => api.forwardFor(ctx, "dev-other", "agent.recordedLanes", {})).toThrow(/hook/);
    api.wrapForward("agent.reportShown", async (_c, _d, _p, carry) => carry());
    await api.forwardFor(ctx, "dev-other", "agent.reportShown", { ids: [], device: "dev-other" });
    expect(forwarder).toHaveBeenCalledTimes(1);
    expect(forwarder.mock.calls[0]?.[0]).toBe("dev-other");
    expect(forwarder.mock.calls[0]?.[4]).toMatchObject({
      onBehalfOf: { deviceId: OWN_ID, windowId: "conn_phone" },
    });
  });

  it("the hook's carry runs once: a second call is refused and nothing more is carried", async () => {
    const { api, forwarder } = door();
    let second: unknown;
    api.wrapForward("agent.reportShown", async (_c, _d, _p, carry) => {
      const first = await carry();
      second = await carry().then(
        () => "carried twice",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      return first;
    });
    const port = await api.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await helloAs(rpc, "good-token");
    expect(await rpc.call("agent.reportShown", { ids: ["x"], device: "dev-other" })).toEqual({
      reported: true,
    });
    expect(forwarder).toHaveBeenCalledTimes(1);
    expect(second).toMatch(/once/);
  });
});
