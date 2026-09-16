import { once } from "node:events";
import { CONTRACTS_VERSION, TAILNET_SCOPES } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ProductApi } from "../src/product-api";

// UA-4 — the self/guest door at the wire (spec §7.3, UA-D5/D13/D14): the
// stored-login comparison decides self vs guest; a guest gets a polite hello
// (grantedScopes: []) and a typed refusal for EVERYTHING else — registry
// methods, scope:null methods, and the pre-choke built-ins alike; no stored
// login = the pre-capture status quo. Raw ws frames on purpose — this is a
// security door, and the test speaks the exact protocol a sidecar-proxied
// peer would, headers included.

const TOKEN = "tok-0123456789abcdef";
const SECRET = "s3cret-route";
const tokens = {
  verify: (t: string) => (t === TOKEN ? { tokenId: "t1", scopes: [], label: "test" } : null),
};

let api: ProductApi | null = null;
let sockets: WebSocket[] = [];
afterEach(() => {
  for (const ws of sockets) ws.terminate();
  sockets = [];
  api?.close();
  api = null;
});

async function boot(getLinkedLogin?: () => string | null): Promise<number> {
  api = new ProductApi({
    port: 0,
    tokens,
    tailnetPathSecret: SECRET,
    ...(getLinkedLogin !== undefined ? { getLinkedLogin } : {}),
  });
  // a real scope:null handler, echoing its CallerContext — lets a self
  // principal be seen SUCCEEDING and carries the minted principal back out
  api.register("system.health", (ctx) => ({ principal: ctx.principal }));
  // the same echo on a FEDERATING method (D36, enforced at AR-4b): a peer
  // principal is refused every local-only method before its scopes are even
  // read, so a peer is probed through a door that federates
  api.register("device.list", (ctx) => ({ principal: ctx.principal }));
  return api.listen();
}

interface Wire {
  send(frame: unknown): void;
  next(): Promise<Record<string, unknown>>;
}

async function dial(port: number, path: string, headers: Record<string, string>): Promise<Wire> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  sockets.push(ws);
  const queue: Record<string, unknown>[] = [];
  const waiters: ((m: Record<string, unknown>) => void)[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  await once(ws, "open");
  return {
    send: (frame) => ws.send(JSON.stringify(frame)),
    next: () => {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

const hello = (id: number, clientKind: string, extra: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "system.hello",
  params: {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    ...extra,
  },
});

const call = (id: number, method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

const result = (msg: Record<string, unknown>): Record<string, unknown> =>
  msg["result"] as Record<string, unknown>;
const errKind = (msg: Record<string, unknown>): unknown =>
  ((msg["error"] as Record<string, unknown>)?.["data"] as Record<string, unknown>)?.["kind"];

describe("UA-4 — the self/guest door", () => {
  it("a mismatched login is a guest: polite hello, empty grant, typed refusals everywhere", async () => {
    const port = await boot(() => "me@github");
    const wire = await dial(port, `/t/${SECRET}`, { "tailscale-user-login": "colleague@github" });

    wire.send(hello(1, "renderer"));
    const ack = await wire.next();
    expect(result(ack)["grantedScopes"]).toEqual([]);

    // a scope:null registry method — the scope check alone would pass it
    wire.send(call(2, "system.health"));
    expect(errKind(await wire.next())).toBe("FORBIDDEN_SCOPE");
    // the pre-choke built-ins are gated too
    wire.send(call(3, "shell.provider.register", {}));
    expect(errKind(await wire.next())).toBe("FORBIDDEN_SCOPE");
    wire.send(call(4, "system.unsubscribe", { subId: "s1" }));
    expect(errKind(await wire.next())).toBe("FORBIDDEN_SCOPE");
  });

  it("the matching login is self: full preset, self:true, transport node id on the principal", async () => {
    const port = await boot(() => "me@github");
    const wire = await dial(port, `/t/${SECRET}`, {
      "tailscale-user-login": "me@github",
      "tailscale-node-id": "nTKS1234CNTRL",
    });

    wire.send(hello(1, "renderer"));
    expect(result(await wire.next())["grantedScopes"]).toEqual([...TAILNET_SCOPES]);

    wire.send(call(2, "system.health"));
    expect(result(await wire.next())["principal"]).toEqual({
      kind: "tailnet",
      login: "me@github",
      self: true,
      tailscaleId: "nTKS1234CNTRL",
    });
  });

  it("UA-P-0a: NO STORED LOGIN IS A GUEST — the pre-capture full grant is gone", async () => {
    // THE FLIP. This row asserted the opposite: a desktop with no captured
    // login handed the whole preset to any tailnet-verified caller, and the
    // `tailnet` principal arrived without `self` to say so. James ruled the
    // posture derives from the link — unlinked is offline, capturing declares
    // nothing — so the state this row described cannot arise from the product's
    // own paths any more. The answer if something reaches the door anyway is
    // zero scopes: a desktop that does not know which account it is cannot know
    // that this caller is it.
    const port = await boot(() => null);
    const wire = await dial(port, `/t/${SECRET}`, { "tailscale-user-login": "anyone@github" });

    wire.send(hello(1, "renderer"));
    expect(result(await wire.next())["grantedScopes"]).toEqual([]);

    wire.send(call(2, "system.health"));
    expect(errKind(await wire.next())).toBe("FORBIDDEN_SCOPE");
  });

  it("UA-P-0a: and a `tailnet` principal without `self` can no longer arise", async () => {
    // `self` was conditional on a stored login existing, because pre-capture
    // landed in the same branch as a match. It is unconditional now: reaching
    // the self branch AT ALL means the comparison succeeded.
    const port = await boot(() => "me@github");
    const wire = await dial(port, `/t/${SECRET}`, { "tailscale-user-login": "me@github" });

    wire.send(hello(1, "renderer"));
    expect(result(await wire.next())["grantedScopes"]).toEqual([...TAILNET_SCOPES]);
    wire.send(call(2, "system.health"));
    const principal = result(await wire.next())["principal"] as Record<string, unknown>;
    expect(principal["kind"]).toBe("tailnet");
    expect(principal["self"]).toBe(true);
  });

  it("peer-fieldd is not exempt: the comparison, not the clientKind, decides", async () => {
    const port = await boot(() => "me@github");
    const wire = await dial(port, `/t/${SECRET}`, { "tailscale-user-login": "colleague@github" });

    wire.send(hello(1, "peer-fieldd", { deviceId: "01COLLEAGUEDEVICEAAAAAAAAA" }));
    expect(result(await wire.next())["grantedScopes"]).toEqual([]);
    wire.send(call(2, "device.list"));
    expect(errKind(await wire.next())).toBe("FORBIDDEN_SCOPE");
  });

  it("a self peer-fieldd keeps its device identity and grant unchanged", async () => {
    const port = await boot(() => "me@github");
    const wire = await dial(port, `/t/${SECRET}`, { "tailscale-user-login": "me@github" });

    wire.send(hello(1, "peer-fieldd", { deviceId: "01MYOTHERDEVICEAAAAAAAAAAA" }));
    expect(result(await wire.next())["grantedScopes"]).toEqual([...TAILNET_SCOPES]);
    wire.send(call(2, "device.list"));
    expect(result(await wire.next())["principal"]).toEqual({
      kind: "peer-fieldd",
      deviceId: "01MYOTHERDEVICEAAAAAAAAAAA",
    });
    // …and the local-only door is closed to it whatever the preset grants (D36)
    wire.send(call(3, "system.health"));
    expect(errKind(await wire.next())).toBe("FORBIDDEN_SCOPE");
  });

  it("the local token door never meets the comparison", async () => {
    const port = await boot(() => "me@github");
    const wire = await dial(port, "/", {});

    wire.send(hello(1, "shell-main", { credential: TOKEN }));
    expect(result(await wire.next())["grantedScopes"]).toEqual([]);
    wire.send(call(2, "system.health"));
    const principal = result(await wire.next())["principal"] as Record<string, unknown>;
    // the fake token carries no shellMain bit, so the principal is the plain
    // local grant — the point is the DOOR: no comparison, no guest arm
    expect(principal["kind"]).toBe("local-token");
  });
});
