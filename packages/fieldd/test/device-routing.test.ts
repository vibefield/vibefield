// C5 unit-level: the peer-fieldd door branch + the `device?` routing hook on a
// standalone ProductApi (scripted tokens, real ws clients — the tailnet-door
// harness pattern). The two-daemon end-to-end lives in peer-link.e2e tests.
import { CONTRACTS_VERSION, PEER_FIELDD_SCOPES, TAILNET_SCOPES } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { RpcCallError } from "../src/native-link";
import { ProductApi } from "../src/product-api";
import { TEST_LOGIN } from "./link-fixture";

const SECRET = "3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM";
const OWN_ID = "dev-self";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function api(forwarder = vi.fn()) {
  const a = new ProductApi({
    port: 0,
    tokens: {
      verify: (t) =>
        t === "good-token"
          ? { tokenId: "tk1", scopes: ["doc.read", "workspace.read"], label: "t" }
          : null,
    },
    tailnetPathSecret: SECRET,
    // UA-P-0a — these rows are about ROUTING, not about the posture, so the
    // harness says which account this desktop is. Without it the door mints a
    // guest and every row below fails on the grant rather than the routing.
    getLinkedLogin: () => TEST_LOGIN,
  });
  a.setDeviceRouting(() => OWN_ID, forwarder);
  a.register("device.list", (ctx, params) => ({
    principal: ctx.principal,
    params,
    onBehalfOf: ctx.onBehalfOf,
  }));
  a.registerSubscription("device.subscribe", () => ({ snapshot: [], dispose: () => {} }));
  const port = await a.listen();
  cleanup.push(() => a.close());
  return { a, port, forwarder };
}

function dial(port: number, path = "/", headers?: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    ...(headers ? { headers } : {}),
  });
  cleanup.push(() => ws.close());
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function call(ws: WebSocket, id: number, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMsg = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
    ws.once("close", () => reject(new Error("closed before reply")));
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

const hello = (over: Record<string, unknown> = {}) => ({
  contractsVersion: CONTRACTS_VERSION,
  minCompatible: CONTRACTS_VERSION,
  clientKind: "peer-fieldd",
  ...over,
});

describe("the peer-fieldd door branch (C5)", () => {
  it("secret path + claim → {kind:'peer-fieldd', deviceId} with the peer preset", async () => {
    const { port } = await api();
    const ws = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": TEST_LOGIN });
    const ack = (await call(ws, 1, "system.hello", hello({ deviceId: "dev-peer-a" }))) as {
      result: { grantedScopes: string[] };
    };
    // the claim is a label, never an escalation: a self peer daemon gets the
    // PEER preset whatever it claims — the tailnet preset plus `index.search`
    // (DS-D8, search by asking), never anything a local token holds
    expect(ack.result.grantedScopes).toEqual([...PEER_FIELDD_SCOPES]);
    expect(PEER_FIELDD_SCOPES).toEqual([...TAILNET_SCOPES, "index.search"]);
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string; deviceId: string } };
    };
    expect(probe.result.principal).toEqual({ kind: "peer-fieldd", deviceId: "dev-peer-a" });
  });

  it("the claim is IGNORED off the tailnet door — a token hello stays local-token", async () => {
    const { port } = await api();
    const ws = await dial(port, "/");
    await call(
      ws,
      1,
      "system.hello",
      hello({ deviceId: "dev-imposter", credential: "good-token" }),
    );
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string } };
    };
    expect(probe.result.principal.kind).toBe("local-token"); // no identity theater locally
  });

  it("a non-peer clientKind on the tailnet door stays a tailnet principal despite a claim", async () => {
    const { port } = await api();
    const ws = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": TEST_LOGIN });
    await call(ws, 1, "system.hello", hello({ clientKind: "ios", deviceId: "dev-sneaky" }));
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string } };
    };
    expect(probe.result.principal.kind).toBe("tailnet");
  });
});

describe("the device? routing hook (C5/D35)", () => {
  it("a foreign device forwards WHOLE after the local scope check", async () => {
    const forwarder = vi.fn(async () => ({ docs: ["remote-doc"] }));
    const { port } = await api(forwarder);
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const res = (await call(ws, 2, "device.list", { device: "dev-b" })) as {
      result: { docs: string[] };
    };
    expect(res.result.docs).toEqual(["remote-doc"]);
    expect(forwarder).toHaveBeenCalledWith(
      "dev-b",
      "device.list",
      { device: "dev-b" },
      expect.anything(),
      // DS-L7 — who the call is for rides beside it; a read carries no key
      { onBehalfOf: expect.objectContaining({ deviceId: OWN_ID }) },
    );
  });

  it("device = self strips the key and serves locally", async () => {
    const forwarder = vi.fn();
    const { port } = await api(forwarder);
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const res = (await call(ws, 2, "device.list", { device: OWN_ID, extra: 1 })) as {
      result: { params: Record<string, unknown> };
    };
    expect(res.result.params).toEqual({ extra: 1 }); // device stripped, rest intact
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("the local scope gate runs BEFORE forwarding — no laundering", async () => {
    const forwarder = vi.fn();
    const a = new ProductApi({
      port: 0,
      tokens: { verify: () => ({ tokenId: "t", scopes: [], label: "noscope" }) },
    });
    a.setDeviceRouting(() => OWN_ID, forwarder);
    a.register("device.list", () => ({}));
    const port = await a.listen();
    cleanup.push(() => a.close());
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "any" }));
    const res = (await call(ws, 2, "device.list", { device: "dev-b" })) as {
      error: { data: { kind: string } };
    };
    expect(res.error.data.kind).toBe("FORBIDDEN_SCOPE");
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("D36 (AR-4b): a method declared LOCAL is never forwarded to a peer, whatever the device says", async () => {
    // `system.health` is local (its scope is null, so the scope gate is not
    // what stops it): a foreign device on it is refused before the forwarder,
    // and the refusal names the locality rather than a missing scope.
    const forwarder = vi.fn(async () => ({ never: true }));
    const { a, port } = await api(forwarder);
    a.register("system.health", () => ({ ok: true }));
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const res = (await call(ws, 2, "system.health", { device: "dev-b" })) as {
      error: { data: { kind: string; details: Record<string, unknown> } };
    };
    expect(res.error.data.kind).toBe("PRECONDITION_FAILED");
    expect(res.error.data.details).toMatchObject({ method: "system.health", locality: "local" });
    expect(forwarder).not.toHaveBeenCalled();
    // device = self still serves a local method locally
    const self = (await call(ws, 3, "system.health", { device: OWN_ID })) as {
      result: { ok: boolean };
    };
    expect(self.result.ok).toBe(true);
  });

  it("D36 (AR-4b): a peer-fieldd principal cannot call a LOCAL method at all, whatever the tailnet preset grants", async () => {
    // the tailnet preset grants every TAILNET_SCOPE, `agent.spawn` among them —
    // the locality column, not the scope, is what keeps a peer from a door that
    // is this device's alone. DS-2 (2026-09-30): this row used agent.spawn as
    // that door; agent ACTS federate now (executed by the device that owns the
    // floor, reached by routing), so it uses agents.profiles.list — the same
    // scope, machine-scope distribution, local forever.
    const { a, port } = await api();
    a.register("system.health", () => ({ ok: true }));
    let listed = 0;
    a.register("agents.profiles.list", () => {
      listed += 1;
      return {};
    });
    let spawned = 0;
    a.register("agent.spawn", (ctx) => {
      spawned += 1;
      return { principal: ctx.principal };
    });
    const ws = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": TEST_LOGIN });
    await call(ws, 1, "system.hello", hello({ deviceId: "dev-peer-a" }));
    const health = (await call(ws, 2, "system.health", {})) as {
      error: { data: { kind: string; details: Record<string, unknown> } };
    };
    expect(health.error.data.kind).toBe("FORBIDDEN_SCOPE");
    expect(health.error.data.details).toMatchObject({ method: "system.health", locality: "local" });
    const profiles = (await call(ws, 3, "agents.profiles.list", {})) as {
      error: { data: { kind: string; details: Record<string, unknown> } };
    };
    expect(profiles.error.data.kind).toBe("FORBIDDEN_SCOPE");
    expect(profiles.error.data.details).toMatchObject({ locality: "local" });
    expect(listed).toBe(0);
    // a federating method is still the peer's to call
    const probe = (await call(ws, 4, "device.list", {})) as { result: { principal: unknown } };
    expect(probe.result.principal).toEqual({ kind: "peer-fieldd", deviceId: "dev-peer-a" });
    // DS-2 — and so, now, is an agent act: executed here, as the peer daemon
    const spawn = (await call(ws, 5, "agent.spawn", { provider: "scripted" })) as {
      result: { principal: unknown };
    };
    expect(spawn.result.principal).toEqual({ kind: "peer-fieldd", deviceId: "dev-peer-a" });
    expect(spawned).toBe(1);
  });

  it("device on a subscription refuses honestly while the sub half is UN-armed", async () => {
    // C6-5 ships the proxy, but an api armed without a subForwarder (a partial
    // bootstrap) must refuse rather than half-work.
    const { port, forwarder } = await api();
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const res = (await call(ws, 2, "device.subscribe", { device: "dev-b" })) as {
      error: { data: { kind: string } };
    };
    expect(res.error.data.kind).toBe("PRECONDITION_FAILED");
    expect(forwarder).not.toHaveBeenCalled();
  });

  it("forwarder UNAVAILABLE maps back with the device detail intact", async () => {
    const forwarder = vi.fn(async () => {
      throw new RpcCallError("UNAVAILABLE", "peer unreachable: dial failed", true, {
        device: "dev-b",
        state: "unreachable",
      });
    });
    const { port } = await api(forwarder);
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const res = (await call(ws, 2, "device.list", { device: "dev-b" })) as {
      error: { data: { kind: string; details: { device: string; state: string } } };
    };
    expect(res.error.data.kind).toBe("UNAVAILABLE");
    expect(res.error.data.details).toEqual({ device: "dev-b", state: "unreachable" });
  });
});

describe("the device? subscription hop (C6-5/D35)", () => {
  async function apiWithSubForwarder(
    subForwarder: (
      device: string,
      method: string,
      params: unknown,
      ctx: unknown,
      emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
    ) => Promise<{ snapshot: unknown; dispose: () => void; start?: () => void }>,
  ) {
    const a = new ProductApi({
      port: 0,
      tokens: {
        verify: (t) =>
          t === "good-token"
            ? { tokenId: "tk1", scopes: ["doc.read", "workspace.read"], label: "t" }
            : null,
      },
    });
    a.setDeviceRouting(
      () => OWN_ID,
      vi.fn(),
      (device, method, params, ctx, emit) => subForwarder(device, method, params, ctx, emit),
    );
    a.registerSubscription("device.subscribe", () => ({ snapshot: [], dispose: () => {} }));
    const port = await a.listen();
    cleanup.push(() => a.close());
    return port;
  }

  /** Collect notification frames by method (`device.delta` / `device.snapshot`). */
  function collect(ws: WebSocket): Array<{ method: string; payload: unknown; subId: string }> {
    const out: Array<{ method: string; payload: unknown; subId: string }> = [];
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (typeof msg.method === "string" && msg.id === undefined) {
        out.push({ method: msg.method, payload: msg.params?.payload, subId: msg.params?.subId });
      }
    });
    return out;
  }

  it("installs the proxy: peer snapshot returned, kinds preserved on the wire, dispose on unsubscribe", async () => {
    // an object holder — a plain let is control-flow-narrowed to null at the
    // call sites below (the assignment hides inside the forwarder closure)
    const pushed: { fn: ((payload: unknown, kind?: "delta" | "snapshot") => void) | null } = {
      fn: null,
    };
    const dispose = vi.fn();
    const port = await apiWithSubForwarder(async (device, method, params, _ctx, emit) => {
      expect(device).toBe("dev-b");
      expect(method).toBe("device.subscribe");
      expect(params).toEqual({ device: "dev-b" }); // forwarded WHOLE — the peer strips
      pushed.fn = emit;
      return { snapshot: ["peer-roster"], dispose };
    });
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const frames = collect(ws);
    const res = (await call(ws, 2, "device.subscribe", { device: "dev-b" })) as {
      result: { subId: string; snapshot: unknown };
    };
    expect(res.result.snapshot).toEqual(["peer-roster"]);

    pushed.fn?.(["row"], "delta");
    pushed.fn?.(["fresh"], "snapshot"); // a recovery re-snapshot rides the same wire
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect(frames[0]).toMatchObject({ method: "device.delta", payload: ["row"] });
    expect(frames[1]).toMatchObject({ method: "device.snapshot", payload: ["fresh"] });
    expect(frames.every((f) => f.subId === res.result.subId)).toBe(true);

    await call(ws, 3, "system.unsubscribe", { subId: res.result.subId });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("the proxy's start runs after the reply: what it held arrives BEHIND the open answer (2026-10-01)", async () => {
    // a frame emitted before the reply carries a subId the client cannot
    // route yet — the federated manager holds what its upstream sent behind
    // the open answer and hands it over here, at start
    const port = await apiWithSubForwarder(async (_device, _method, _params, _ctx, emit) => ({
      snapshot: ["peer-roster"],
      dispose: () => {},
      start: () => emit(["behind"], "delta"),
    }));
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const order: string[] = [];
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      order.push(typeof msg.method === "string" ? msg.method : `reply:${msg.id}`);
    });
    await call(ws, 2, "device.subscribe", { device: "dev-b" });
    await vi.waitFor(() => expect(order).toEqual(["reply:2", "device.delta"]));
  });

  it("a proxy failure maps back like any peer failure — the caller hears the truth", async () => {
    const port = await apiWithSubForwarder(async () => {
      throw new RpcCallError("UNAVAILABLE", "peer has no published endpoint", true, {
        device: "dev-b",
        state: "offline",
      });
    });
    const ws = await dial(port, "/");
    await call(ws, 1, "system.hello", hello({ credential: "good-token" }));
    const res = (await call(ws, 2, "device.subscribe", { device: "dev-b" })) as {
      error: { data: { kind: string; details: { state: string } } };
    };
    expect(res.error.data.kind).toBe("UNAVAILABLE");
    expect(res.error.data.details.state).toBe("offline");
  });
});

// DS-L7 / DS-D15 (2026-09-30) — the forwarding envelope at the door. A peer's
// `onBehalfOf` is stripped from the params and recorded on the call's context
// (the audit actor reads it there); any other caller carrying either member is
// refused before anything runs; the routing hop builds `onBehalfOf` from the
// CALLING context, never from the call's params.
describe("the forwarding envelope (DS-L7 / DS-D15)", () => {
  const behalf = { clientKind: "renderer", deviceId: "dev-peer-a", windowId: "win-1" };

  it("a peer's envelope is stripped from the params and recorded on the call, beside the node that dialled", async () => {
    const { port } = await api();
    const ws = await dial(port, `/t/${SECRET}`, {
      "Tailscale-User-Login": TEST_LOGIN,
      "Tailscale-Node-Id": "node-peer-a",
    });
    await call(ws, 1, "system.hello", hello({ deviceId: "dev-peer-a" }));
    const res = (await call(ws, 2, "device.list", {
      forward: { onBehalfOf: behalf },
      extra: 1,
    })) as {
      result: { principal: unknown; params: unknown; onBehalfOf: unknown };
    };
    // authorized as the peer daemon — the principal is unchanged by the envelope
    expect(res.result.principal).toEqual({
      kind: "peer-fieldd",
      deviceId: "dev-peer-a",
      tailscaleId: "node-peer-a",
    });
    // recorded as the window behind it; the method never sees the member
    expect(res.result.onBehalfOf).toEqual(behalf);
    expect(res.result.params).toEqual({ extra: 1 });
    // provenance is per CALL: the next call on the same socket carries none
    const bare = (await call(ws, 3, "device.list", {})) as { result: { onBehalfOf?: unknown } };
    expect(bare.result.onBehalfOf).toBeUndefined();
  });

  it("reads a peer's envelope tolerantly: a newer client kind is recorded, an unreadable restatement or key is refused", async () => {
    const { port } = await api();
    const ws = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": TEST_LOGIN });
    await call(ws, 1, "system.hello", hello({ deviceId: "dev-peer-a" }));
    const newer = (await call(ws, 2, "device.list", {
      forward: {
        onBehalfOf: { clientKind: "ios-watch", deviceId: "dev-peer-a", futureField: { x: 1 } },
        futureMember: true,
      },
    })) as { result: { onBehalfOf: unknown } };
    // a kind this build does not know is kept; a member it does not know is not
    expect(newer.result.onBehalfOf).toEqual({ clientKind: "ios-watch", deviceId: "dev-peer-a" });

    const nameless = (await call(ws, 3, "device.list", {
      forward: { onBehalfOf: { clientKind: "renderer" } },
    })) as { error: { data: { kind: string; details: Record<string, unknown> } } };
    expect(nameless.error.data.kind).toBe("PRECONDITION_FAILED");
    expect(nameless.error.data.details).toMatchObject({ reason: "malformed onBehalfOf" });

    const oversized = (await call(ws, 4, "device.list", {
      forward: { onBehalfOf: { clientKind: "renderer", deviceId: "d".repeat(257) } },
    })) as { error: { data: { kind: string } } };
    expect(oversized.error.data.kind).toBe("PRECONDITION_FAILED");

    const shortKey = (await call(ws, 5, "device.list", {
      forward: { idempotencyKey: "short" },
    })) as {
      error: { data: { kind: string; details: Record<string, unknown> } };
    };
    expect(shortKey.error.data.kind).toBe("PRECONDITION_FAILED");
    expect(shortKey.error.data.details).toMatchObject({ reason: "malformed idempotencyKey" });
  });

  it("a caller that is not a peer daemon carrying either member is refused before anything runs", async () => {
    const forwarder = vi.fn(async () => ({ forwarded: true }));
    const { a, port } = await api(forwarder);
    let served = 0;
    a.register("device.get", () => {
      served += 1;
      return {};
    });
    const local = await dial(port, "/");
    await call(
      local,
      1,
      "system.hello",
      hello({ clientKind: "renderer", credential: "good-token" }),
    );
    const cases: Array<[number, string, Record<string, unknown>]> = [
      [2, "device.get", { deviceId: "x", forward: { onBehalfOf: behalf } }],
      [3, "device.get", { deviceId: "x", forward: { idempotencyKey: "k-0123456789" } }],
      // `forward` that is not even an object
      [6, "device.get", { deviceId: "x", forward: "k-0123456789" }],
      // routed: refused before the forwarder, so nothing crosses to the peer
      [4, "device.list", { device: "dev-b", forward: { onBehalfOf: behalf } }],
    ];
    for (const [id, method, params] of cases) {
      const res = (await call(local, id, method, params)) as {
        error: { data: { kind: string; details: Record<string, unknown> } };
      };
      expect(res.error.data.kind, `${method} ${JSON.stringify(params)}`).toBe(
        "PRECONDITION_FAILED",
      );
      expect(res.error.data.details).toMatchObject({
        reason: "forwarding envelope from a non-peer",
      });
    }
    expect(served).toBe(0);
    expect(forwarder).not.toHaveBeenCalled();

    // a method's OWN `idempotencyKey` param (surface.open, artifact.publish/
    // update carry one) is never the envelope's: under `forward` nothing can
    // collide, on a local door or a federating one
    a.register("system.health", (_ctx, params) => ({ params }));
    const own = (await call(local, 5, "system.health", { idempotencyKey: "surface-retry-1" })) as {
      result: { params: unknown };
    };
    expect(own.result.params).toEqual({ idempotencyKey: "surface-retry-1" });
    const federating = (await call(local, 7, "device.get", {
      deviceId: "x",
      idempotencyKey: "own-key-0001",
    })) as { result?: unknown };
    expect(federating.result).toEqual({});
    expect(served).toBe(1);

    // the phone's door is a tailnet principal, not a peer daemon: refused too
    const phone = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": TEST_LOGIN });
    await call(phone, 1, "system.hello", hello({ clientKind: "ios" }));
    const fromPhone = (await call(phone, 2, "device.list", {
      forward: { onBehalfOf: behalf },
    })) as {
      error: { data: { kind: string } };
    };
    expect(fromPhone.error.data.kind).toBe("PRECONDITION_FAILED");
  });

  it("the routing hop says who the call is for from the CALLING context — the window, never the params", async () => {
    const forwarder = vi.fn(async () => ({ ok: true }));
    const a = new ProductApi({
      port: 0,
      tokens: {
        verify: (t) =>
          t === "window-token"
            ? {
                tokenId: "tk-win",
                scopes: ["workspace.read"],
                label: "w",
                rendererParticipant: { participantId: "window-7", incarnation: "gen-1" },
              }
            : t === "cli-token"
              ? { tokenId: "tk-cli", scopes: ["workspace.read"], label: "cli" }
              : null,
      },
      userId: "user-1",
    });
    a.setDeviceRouting(() => OWN_ID, forwarder);
    a.register("device.list", () => ({}));
    const port = await a.listen();
    cleanup.push(() => a.close());

    const win = await dial(port, "/");
    await call(
      win,
      1,
      "system.hello",
      hello({ clientKind: "renderer", credential: "window-token" }),
    );
    await call(win, 2, "device.list", { device: "dev-b" });
    // the renderer participant IS the window (stable for one BrowserWindow)
    expect(forwarder).toHaveBeenLastCalledWith(
      "dev-b",
      "device.list",
      { device: "dev-b" },
      expect.anything(),
      {
        onBehalfOf: {
          clientKind: "renderer",
          deviceId: OWN_ID,
          windowId: "window-7",
          userId: "user-1",
        },
      },
    );

    const cli = await dial(port, "/");
    await call(cli, 1, "system.hello", hello({ clientKind: "debug", credential: "cli-token" }));
    await call(cli, 2, "device.list", { device: "dev-b" });
    // no participant: the connection's own opaque id names it
    const last = forwarder.mock.calls.at(-1) as unknown[];
    expect(last[4]).toEqual({
      onBehalfOf: {
        clientKind: "debug",
        deviceId: OWN_ID,
        windowId: expect.stringMatching(/^conn_/),
        userId: "user-1",
      },
    });
  });
});

// DS-2 — the one envelope member a window may carry: the key of a MUTATION it
// routes to another device (its own, or the one an outcome-unknown answer
// handed back — which is how a retry reads the owner's receipt). A forwarded
// mutation without one gets a fresh key; a read gets none.
describe("the forwarded mutation's key (DS-2)", () => {
  async function writer(forwarder = vi.fn(async () => ({ ok: true }))) {
    const a = new ProductApi({
      port: 0,
      tokens: {
        verify: (t) =>
          t === "writer-token"
            ? { tokenId: "tk-w", scopes: ["doc.read", "doc.write"], label: "w" }
            : null,
      },
    });
    a.setDeviceRouting(() => OWN_ID, forwarder);
    let local = 0;
    a.register("doc.create", () => {
      local += 1;
      return { local: true };
    });
    a.register("doc.list", () => ({ docs: [] }));
    const port = await a.listen();
    cleanup.push(() => a.close());
    const ws = await dial(port, "/");
    await call(
      ws,
      1,
      "system.hello",
      hello({ clientKind: "renderer", credential: "writer-token" }),
    );
    return { ws, forwarder, localCalls: () => local };
  }

  it("every forwarded mutation carries a key: a fresh one, or the caller's own", async () => {
    const { ws, forwarder } = await writer();
    await call(ws, 2, "doc.create", { device: "dev-b", name: "x" });
    const minted = forwarder.mock.calls.at(-1) as unknown[];
    expect(minted[2]).toEqual({ device: "dev-b", name: "x" });
    expect(minted[4]).toMatchObject({ idempotencyKey: expect.stringMatching(/^fk_/) });

    await call(ws, 3, "doc.create", {
      device: "dev-b",
      name: "x",
      forward: { idempotencyKey: "retry-key-0001" },
    });
    const echoed = forwarder.mock.calls.at(-1) as unknown[];
    expect(echoed[2]).toEqual({ device: "dev-b", name: "x" }); // the key left the params
    expect(echoed[4]).toMatchObject({ idempotencyKey: "retry-key-0001" });

    await call(ws, 4, "doc.list", { device: "dev-b" });
    const read = forwarder.mock.calls.at(-1) as unknown[];
    expect(read[4]).not.toHaveProperty("idempotencyKey"); // a read carries none
  });

  it("a key anywhere else has no receipt to bind to and is refused", async () => {
    const { ws, forwarder, localCalls } = await writer();
    const cases: Array<[string, Record<string, unknown>, string]> = [
      // a read, even routed
      ["doc.list", { device: "dev-b", forward: { idempotencyKey: "retry-key-0001" } }, "non-peer"],
      // a mutation this daemon serves itself
      ["doc.create", { name: "x", forward: { idempotencyKey: "retry-key-0001" } }, "non-peer"],
      [
        "doc.create",
        { device: OWN_ID, name: "x", forward: { idempotencyKey: "retry-key-0001" } },
        "non-peer",
      ],
      // an empty envelope names no key to bind
      ["doc.create", { device: "dev-b", name: "x", forward: {} }, "non-peer"],
      // the key beside a restatement: onBehalfOf is never a caller's
      [
        "doc.create",
        {
          device: "dev-b",
          name: "x",
          forward: { idempotencyKey: "retry-key-0001", onBehalfOf: {} },
        },
        "non-peer",
      ],
      // a key the contract would not journal
      [
        "doc.create",
        { device: "dev-b", name: "x", forward: { idempotencyKey: "short" } },
        "malformed",
      ],
    ];
    let id = 10;
    for (const [method, params, why] of cases) {
      const res = (await call(ws, id++, method, params)) as {
        error: { data: { kind: string; details: { reason: string } } };
      };
      expect(res.error.data.kind, `${method} ${JSON.stringify(params)}`).toBe(
        "PRECONDITION_FAILED",
      );
      expect(res.error.data.details.reason).toBe(
        why === "non-peer" ? "forwarding envelope from a non-peer" : "malformed idempotencyKey",
      );
    }
    expect(forwarder).not.toHaveBeenCalled();
    expect(localCalls()).toBe(0);
  });
});
