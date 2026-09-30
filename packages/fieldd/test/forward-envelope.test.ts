// DS-L7 / DS-D15 (2026-09-30) — the forwarding envelope: the pure helpers, and
// one round trip through a REAL PeerLink dialling a REAL ProductApi tailnet
// door (the device-routing harness's door, with a sidecar-simulating ws-ctor
// that injects the WhoIs login and node id the way the peer's sidecar does).
import type { CallerContext } from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  forwardProvenance,
  readOnBehalfOf,
  readPeerEnvelope,
  splitForwardEnvelope,
  withEnvelope,
} from "../src/forward-envelope";
import { PeerLink } from "../src/peer-link";
import { ProductApi } from "../src/product-api";
import { TEST_LOGIN } from "./link-fixture";

const SECRET = "3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

describe("the envelope helpers", () => {
  it("splits both members off an object's params and leaves every other value alone", () => {
    const split = splitForwardEnvelope({ a: 1, onBehalfOf: { x: 1 }, idempotencyKey: "k" });
    expect(split).toMatchObject({ carried: true, hasOnBehalfOf: true, hasIdempotencyKey: true });
    expect(split.rest).toEqual({ a: 1 });
    // a LOCAL door's own retry key (surface.open, artifact.publish/update) is
    // not the envelope's: with readKey off it stays in the method's params
    const own = splitForwardEnvelope({ a: 1, idempotencyKey: "own" }, { readKey: false });
    expect(own.carried).toBe(false);
    expect(own.rest).toEqual({ a: 1, idempotencyKey: "own" });
    const both = splitForwardEnvelope(
      { onBehalfOf: {}, idempotencyKey: "own" },
      { readKey: false },
    );
    expect(both).toMatchObject({ carried: true, hasOnBehalfOf: true, hasIdempotencyKey: false });
    expect(both.rest).toEqual({ idempotencyKey: "own" });
    for (const value of [undefined, null, 3, "s", [1, 2], { a: 1 }]) {
      const none = splitForwardEnvelope(value);
      expect(none.carried).toBe(false);
      expect(none.rest).toBe(value);
    }
  });

  it("reads onBehalfOf tolerantly and bounded", () => {
    expect(readOnBehalfOf({ clientKind: "renderer", deviceId: "d", extra: 1 })).toEqual({
      clientKind: "renderer",
      deviceId: "d",
    });
    expect(readOnBehalfOf({ clientKind: "renderer" })).toBeUndefined();
    expect(readOnBehalfOf({ clientKind: "k".repeat(65), deviceId: "d" })).toBeUndefined();
    expect(readOnBehalfOf({ clientKind: "renderer", deviceId: "d", windowId: 7 })).toBeUndefined();
    expect(readOnBehalfOf("renderer")).toBeUndefined();
  });

  it("reads a peer's key strictly: the contract's bounds, or a refusal", () => {
    expect(readPeerEnvelope(splitForwardEnvelope({ idempotencyKey: "fk_0123456789" }))).toEqual({
      ok: true,
      idempotencyKey: "fk_0123456789",
    });
    expect(readPeerEnvelope(splitForwardEnvelope({ idempotencyKey: "short" }))).toEqual({
      ok: false,
      reason: "malformed idempotencyKey",
    });
    expect(readPeerEnvelope(splitForwardEnvelope({ idempotencyKey: 42 }))).toMatchObject({
      ok: false,
    });
  });

  it("puts the envelope beside the params, and refuses params that cannot carry it", () => {
    const behalf = { clientKind: "renderer", deviceId: "d" };
    expect(withEnvelope({ a: 1 }, { onBehalfOf: behalf })).toEqual({ a: 1, onBehalfOf: behalf });
    expect(withEnvelope(undefined, { idempotencyKey: "fk_0123456789" })).toEqual({
      idempotencyKey: "fk_0123456789",
    });
    expect(withEnvelope({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(withEnvelope({ a: 1 }, {})).toEqual({ a: 1 });
    expect(() => withEnvelope([1], { onBehalfOf: behalf })).toThrow(/must be an object/);
  });

  it("builds who a call is for from the calling context; a relayed call restates its peer", () => {
    const base: CallerContext = {
      principal: { kind: "local-token", tokenId: "t", scopes: [] },
      transport: "ws-loopback",
      receivedAt: 0,
      clientKind: "renderer",
      connection: { id: "conn_1", helloClientKind: "renderer" },
    };
    expect(forwardProvenance(base, { deviceId: "self" })).toEqual({
      clientKind: "renderer",
      deviceId: "self",
      windowId: "conn_1",
    });
    // the phone's door: no gate-read clientKind, the hello's claim is recorded
    const phone: CallerContext = {
      principal: { kind: "tailnet", login: "me@example.com", self: true },
      transport: "ws-tailnet",
      receivedAt: 0,
      connection: { id: "conn_2", helloClientKind: "ios" },
    };
    expect(forwardProvenance(phone, { deviceId: "self", userId: "u" })).toEqual({
      clientKind: "ios",
      deviceId: "self",
      windowId: "conn_2",
      userId: "u",
    });
    const relayed: CallerContext = {
      principal: { kind: "peer-fieldd", deviceId: "dev-a" },
      transport: "ws-tailnet",
      receivedAt: 0,
      onBehalfOf: { clientKind: "renderer", deviceId: "dev-a", windowId: "w" },
    };
    expect(forwardProvenance(relayed, { deviceId: "self" })).toEqual(relayed.onBehalfOf);
  });
});

/** The peer's sidecar, simulated: WhoIs login + the CALLER's node id. */
function sidecar(nodeId: string): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      super(url, { headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": nodeId } });
    }
  }
  return SidecarSim;
}

describe("PeerLink → a peer's door", () => {
  it("the envelope crosses the wire, the door strips it, and the call is recorded as the window behind the node", async () => {
    const seen: Array<{ ctx: CallerContext; params: unknown }> = [];
    const door = new ProductApi({
      port: 0,
      tokens: { verify: () => null },
      tailnetPathSecret: SECRET,
      getLinkedLogin: () => TEST_LOGIN,
      // the node id the sidecar injects maps to the roster's device (T1 §1)
      correlateNodeId: (node) => (node === "node-a" ? "dev-a" : undefined),
    });
    door.register("device.list", (ctx, params) => {
      seen.push({ ctx, params });
      return { devices: [] };
    });
    const port = await door.listen();
    cleanup.push(() => door.close());

    const link = new PeerLink({
      ownDeviceId: () => "dev-a",
      endpointFor: () => `ws://127.0.0.1:${port}/t/${SECRET}`,
      webSocket: sidecar("node-a"),
    });
    cleanup.push(() => link.dispose());

    const behalf = { clientKind: "renderer", deviceId: "dev-a", windowId: "window-7" };
    await link.request("dev-b", "device.list", { filter: "all" }, { onBehalfOf: behalf });
    await link.request("dev-b", "device.list", { filter: "all" });

    expect(seen).toHaveLength(2);
    // transport-derived: the claim and the node agree here, and the node is kept
    expect(seen[0]?.ctx.principal).toEqual({
      kind: "peer-fieldd",
      deviceId: "dev-a",
      tailscaleId: "node-a",
    });
    expect(seen[0]?.ctx.onBehalfOf).toEqual(behalf);
    expect(seen[0]?.params).toEqual({ filter: "all" });
    // no envelope, no provenance — and nothing leaks from the call before it
    expect(seen[1]?.ctx.onBehalfOf).toBeUndefined();
    expect(seen[1]?.params).toEqual({ filter: "all" });
  });
});
