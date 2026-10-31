// DS-L7 / DS-D15 (2026-09-30) — the forwarding envelope: the pure helpers, and
// one round trip through a REAL PeerLink dialling a REAL ProductApi tailnet
// door (the device-routing harness's door, with a sidecar-simulating ws-ctor
// that injects the WhoIs login and node id the way the peer's sidecar does).
import { readFileSync } from "node:fs";
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
  it("splits the one `forward` member off an object's params and leaves everything else alone", () => {
    const split = splitForwardEnvelope({
      a: 1,
      forward: { onBehalfOf: { x: 1 }, idempotencyKey: "k" },
    });
    expect(split).toMatchObject({
      carried: true,
      malformed: false,
      hasOnBehalfOf: true,
      hasIdempotencyKey: true,
      rawIdempotencyKey: "k",
    });
    expect(split.rest).toEqual({ a: 1 });
    // a method's OWN retry key (surface.open, artifact.publish/update carry
    // one) is a param, never the envelope's — the collision the namespace ends
    const own = splitForwardEnvelope({ a: 1, idempotencyKey: "own", onBehalfOf: "own" });
    expect(own.carried).toBe(false);
    expect(own.rest).toEqual({ a: 1, idempotencyKey: "own", onBehalfOf: "own" });
    // `forward` present but not an object: carried, and unreadable
    const bad = splitForwardEnvelope({ a: 1, forward: "k" });
    expect(bad).toMatchObject({ carried: true, malformed: true, hasIdempotencyKey: false });
    expect(bad.rest).toEqual({ a: 1 });
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
    // F1b — the phone behind a home, by its roster device: kept, and bounded like its siblings
    expect(readOnBehalfOf({ clientKind: "ios", deviceId: "d", clientDeviceId: "p" })).toEqual({
      clientKind: "ios",
      deviceId: "d",
      clientDeviceId: "p",
    });
    expect(
      readOnBehalfOf({ clientKind: "ios", deviceId: "d", clientDeviceId: "" }),
    ).toBeUndefined();
    expect(
      readOnBehalfOf({ clientKind: "ios", deviceId: "d", clientDeviceId: "p".repeat(257) }),
    ).toBeUndefined();
  });

  it("reads a peer's key strictly: the contract's bounds, or a refusal", () => {
    expect(
      readPeerEnvelope(splitForwardEnvelope({ forward: { idempotencyKey: "fk_0123456789" } })),
    ).toEqual({
      ok: true,
      idempotencyKey: "fk_0123456789",
    });
    expect(
      readPeerEnvelope(splitForwardEnvelope({ forward: { idempotencyKey: "short" } })),
    ).toEqual({
      ok: false,
      reason: "malformed idempotencyKey",
    });
    expect(
      readPeerEnvelope(splitForwardEnvelope({ forward: { idempotencyKey: 42 } })),
    ).toMatchObject({
      ok: false,
    });
    expect(readPeerEnvelope(splitForwardEnvelope({ forward: [1] }))).toEqual({
      ok: false,
      reason: "malformed forward",
    });
    // a member `forward` does not know is ignored (a newer peer may add one)
    expect(readPeerEnvelope(splitForwardEnvelope({ forward: { trace: "t-1" } }))).toEqual({
      ok: true,
    });
  });

  it("puts the envelope beside the params, and refuses params that cannot carry it", () => {
    const behalf = { clientKind: "renderer", deviceId: "d" };
    expect(withEnvelope({ a: 1 }, { onBehalfOf: behalf })).toEqual({
      a: 1,
      forward: { onBehalfOf: behalf },
    });
    expect(withEnvelope(undefined, { idempotencyKey: "fk_0123456789" })).toEqual({
      forward: { idempotencyKey: "fk_0123456789" },
    });
    // a method's own `idempotencyKey` rides beside the envelope, untouched
    expect(withEnvelope({ idempotencyKey: "own" }, { idempotencyKey: "fk_0123456789" })).toEqual({
      idempotencyKey: "own",
      forward: { idempotencyKey: "fk_0123456789" },
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

  it("F1b — names the phone behind it by the device its OWN roster correlates the phone's node to, and nothing else", () => {
    const roster = (node: string) =>
      ({ "node-phone": "dev-phone", "node-self": "self" })[node] as string | undefined;
    const self = { deviceId: "self", correlateNodeId: roster };
    const phone = (tailscaleId?: string): CallerContext => ({
      principal: {
        kind: "tailnet",
        login: "me@example.com",
        self: true,
        ...(tailscaleId !== undefined ? { tailscaleId } : {}),
      },
      transport: "ws-tailnet",
      receivedAt: 0,
      connection: { id: "conn_2", helloClientKind: "ios" },
    });
    expect(forwardProvenance(phone("node-phone"), self)).toEqual({
      clientKind: "ios",
      deviceId: "self",
      windowId: "conn_2",
      clientDeviceId: "dev-phone",
    });
    // a node the roster does not know, no node at all, or this daemon's own: no device is named
    for (const ctx of [phone("node-stranger"), phone(), phone("node-self")])
      expect(forwardProvenance(ctx, self)).not.toHaveProperty("clientDeviceId");
    // a window's device is the forwarding daemon's, already `deviceId`
    const window: CallerContext = {
      principal: { kind: "local-token", tokenId: "t", scopes: [] },
      transport: "ws-loopback",
      receivedAt: 0,
      clientKind: "renderer",
    };
    expect(forwardProvenance(window, self)).not.toHaveProperty("clientDeviceId");
  });

  it("F1b — the golden envelope: the home's forwarder writes exactly it, and the owner's door reads it back", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../contracts/fixtures/forward-envelope.phone.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    // the writer: the phone on the home's tailnet door, its node correlated by the home's roster
    const phone: CallerContext = {
      principal: { kind: "tailnet", login: "me@example.com", self: true, tailscaleId: "node-p1" },
      transport: "ws-tailnet",
      receivedAt: 0,
      connection: { id: "conn_7", helloClientKind: "ios" },
    };
    const onBehalfOf = forwardProvenance(phone, {
      deviceId: "dev-desktop-a",
      userId: "u_01J9ABCDEFGHJKMNPQRSTVWXYZ",
      correlateNodeId: (node) => (node === "node-p1" ? "dev-phone-1" : undefined),
    });
    expect(
      withEnvelope(
        { device: "dev-desktop-b" },
        { onBehalfOf, idempotencyKey: "fk_9pQwErTyUiOpAsDfGhJkLzXc" },
      ),
    ).toEqual(fixture);
    // the reader: the owner splits it off and honours every member
    const split = splitForwardEnvelope(fixture);
    expect(split.rest).toEqual({ device: "dev-desktop-b" });
    expect(readPeerEnvelope(split)).toEqual({
      ok: true,
      onBehalfOf,
      idempotencyKey: "fk_9pQwErTyUiOpAsDfGhJkLzXc",
    });
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
      // …whose row is a desktop's: the peer kind is the transport's (D1)
      isDocHost: (deviceId) => deviceId === "dev-a",
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
