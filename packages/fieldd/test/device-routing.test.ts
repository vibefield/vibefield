// C5 unit-level: the peer-fieldd door branch + the `device?` routing hook on a
// standalone ProductApi (scripted tokens, real ws clients — the tailnet-door
// harness pattern). The two-daemon end-to-end lives in peer-link.e2e tests.
import { CONTRACTS_VERSION, TAILNET_SCOPES } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { RpcCallError } from "../src/native-link";
import { ProductApi } from "../src/product-api";

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
  });
  a.setDeviceRouting(() => OWN_ID, forwarder);
  a.register("device.list", (ctx, params) => ({ principal: ctx.principal, params }));
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
  it("secret path + claim → {kind:'peer-fieldd', deviceId} with the same preset", async () => {
    const { port } = await api();
    const ws = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": "me@jamesyong42.com" });
    const ack = (await call(ws, 1, "system.hello", hello({ deviceId: "dev-peer-a" }))) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual([...TAILNET_SCOPES]); // a label, never an escalation
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
    const ws = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": "me@jamesyong42.com" });
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
    ) => Promise<{ snapshot: unknown; dispose: () => void }>,
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
