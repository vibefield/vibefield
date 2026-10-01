// DS-1 — PeerLink's DIAL over egress (src/peer-link.ts `egressDial`,
// src/egress.ts `egressWebSocket`). A peer's product door is dialled THROUGH
// the node's own SOCKS5 when the floor has egress — the door's MagicDNS name
// resolved by the proxy, never the OS — and over the OS network when it has
// none. A dial through the node that fails is never retried over the OS
// network: a bad credential fails CLOSED with an honest UNAVAILABLE
// {device, state: "unreachable"}.
//
// DS-1b (2026-10-01, D4) — "has none" is now ONLY `egress-unsupported`: a
// floor that times out, or whose mesh is down, fails the dial closed too.
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { type EgressProxySource, resolveEgressPath } from "../src/egress";
import { RpcCallError } from "../src/native-link";
import { PeerLink } from "../src/peer-link";
import { type FakeSocks5, startFakeSocks5 } from "./socks5-server";

const DOOR_HOST = "device-b.tail1234.ts.net";
const CREDENTIAL = { username: "tsnet", password: "node-proxy-credential" };

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** A peer's product door, as much of it as a dial needs: the hello and one
 * read. Counts the connections that reached it. */
async function door(): Promise<{ port: number; connections: () => number; drop: () => void }> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  let connections = 0;
  wss.on("connection", (ws) => {
    connections += 1;
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { id: number; method: string };
      const result =
        msg.method === "system.hello"
          ? { contractsVersion: "0.1.0", serverKind: "fieldd", grantedScopes: [] }
          : { devices: ["answered by the door"] };
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    });
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  );
  return {
    port: (wss.address() as { port: number }).port,
    connections: () => connections,
    drop: () => {
      for (const client of wss.clients) client.terminate();
    },
  };
}

async function proxyTo(doorPort: number): Promise<FakeSocks5> {
  const proxy = await startFakeSocks5({
    ...CREDENTIAL,
    route: (host, port) =>
      host === DOOR_HOST && port === 9423 ? { host: "127.0.0.1", port: doorPort } : undefined,
  });
  cleanup.push(() => proxy.close());
  return proxy;
}

function capture(): { logger: Logger; events: (name: string) => Array<LogFields | undefined> } {
  const records: Array<{ event: string; attrs: LogFields | undefined }> = [];
  const make = (): Logger => ({
    child: () => make(),
    trace: (event, _m, attrs) => void records.push({ event, attrs }),
    debug: (event, _m, attrs) => void records.push({ event, attrs }),
    info: (event, _m, attrs) => void records.push({ event, attrs }),
    warn: (event, _m, attrs) => void records.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void records.push({ event, attrs }),
    fatal: (event, _m, _e, attrs) => void records.push({ event, attrs }),
    isLevelEnabled: () => true,
  });
  return {
    logger: make(),
    events: (name) => records.filter((r) => r.event === name).map((r) => r.attrs),
  };
}

function link(opts: {
  endpoint: string;
  source: EgressProxySource;
  logger: Logger;
  callTimeoutMs?: number;
}): { peers: PeerLink; asked: () => number } {
  let asked = 0;
  const peers = new PeerLink({
    ownDeviceId: () => "dev-a",
    endpointFor: (id) => (id === "dev-b" ? opts.endpoint : undefined),
    egress: () => {
      asked += 1;
      return resolveEgressPath(opts.source);
    },
    logger: opts.logger,
    callTimeoutMs: opts.callTimeoutMs ?? 8_000,
  });
  cleanup.push(() => peers.dispose());
  return { peers, asked: () => asked };
}

describe("DS-1 — PeerLink dials a peer's door through the node", () => {
  it("rides the node's SOCKS5 when the floor has egress, the door's name resolved by the proxy", async () => {
    const d = await door();
    const proxy = await proxyTo(d.port);
    const log = capture();
    const { peers } = link({
      // a MagicDNS name the OS cannot resolve here: only the proxy can reach it
      endpoint: `http://${DOOR_HOST}:9423`,
      source: { egressProxy: async () => ({ address: proxy.address, ...credential() }) },
      logger: log.logger,
    });
    expect(await peers.request("dev-b", "device.list", {})).toEqual({
      devices: ["answered by the door"],
    });
    expect(proxy.requests).toEqual([
      expect.objectContaining({ atyp: 0x03, host: DOOR_HOST, port: 9423 }),
    ]);
    expect(d.connections()).toBe(1);
    expect(log.events("fieldd.mesh.egress.dial_through_node")).toEqual([{ peer: "dev-b" }]);
    expect(log.events("fieldd.mesh.egress.fallback_os_network")).toEqual([]);
  });

  it("fails CLOSED on a refused credential — UNAVAILABLE unreachable, and no dial over the OS network", async () => {
    const d = await door();
    const proxy = await proxyTo(d.port);
    const log = capture();
    const { peers, asked } = link({
      // the door is reachable over the OS network at this address, so a
      // silent fallback WOULD succeed — the row proves it never happens
      endpoint: `http://127.0.0.1:${d.port}`,
      source: {
        egressProxy: async () => ({
          address: proxy.address,
          username: "tsnet",
          credential: "stale-credential",
        }),
      },
      logger: log.logger,
      callTimeoutMs: 1_500,
    });
    const refused = await peers.request("dev-b", "device.list", {}).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RpcCallError);
    expect(refused).toMatchObject({
      kind: "UNAVAILABLE",
      details: { device: "dev-b", state: "unreachable" },
    });
    expect(proxy.refusedAuth()).toBeGreaterThanOrEqual(1);
    expect(d.connections(), "nothing reached the door by any path").toBe(0);
    expect(asked()).toBeGreaterThanOrEqual(1);
    // said once per link, however many redials the backoff made
    expect(log.events("fieldd.mesh.egress.dial_refused")).toHaveLength(1);
    expect(log.events("fieldd.mesh.egress.fallback_os_network")).toEqual([]);
  });

  it("falls back to today's dial ONLY when the floor cannot carry egress — once per link, at debug", async () => {
    const d = await door();
    const log = capture();
    const { peers, asked } = link({
      endpoint: `http://127.0.0.1:${d.port}`,
      source: {
        egressProxy: async () => {
          throw new RpcCallError("UNAVAILABLE", "egress is unsupported", false, {
            service: "mesh",
            state: "egress-unsupported",
          });
        },
      },
      logger: log.logger,
    });
    expect(await peers.request("dev-b", "device.list", {})).toEqual({
      devices: ["answered by the door"],
    });
    // The door hangs up with no call in flight, so the link stands and its
    // client re-dials by itself — and asks the floor again, once per dial.
    const newLinks: string[] = [];
    peers.on("link-changed", (e: { deviceId: string; state?: string }) => {
      if (e.state === "dialing") newLinks.push(e.deviceId);
    });
    d.drop();
    const deadline = Date.now() + 8_000;
    while (asked() < 2) {
      if (Date.now() > deadline) throw new Error("the link never re-dialled");
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(await peers.request("dev-b", "device.list", {})).toEqual({
      devices: ["answered by the door"],
    });
    expect(newLinks, "the re-dial was the same link, not a new one").toEqual([]);
    // ONE line for the link, though it dialled twice — and at debug: the
    // floor's "no egress" is said once per FLOOR BOOT by FloorEgress
    // (floor-egress.test.ts), not once per link
    expect(log.events("fieldd.mesh.egress.link_direct")).toEqual([
      { peer: "dev-b", state: "egress-unsupported" },
    ]);
    expect(log.events("fieldd.mesh.egress.fallback_os_network")).toEqual([]);
    expect(log.events("fieldd.mesh.egress.dial_through_node")).toEqual([]);
  });

  it("FAILS the dial closed when the floor times out or its mesh is down — the OS network is never taken", async () => {
    for (const [refusal, state] of [
      [
        new RpcCallError("TIMEOUT", "native.mesh.egress.proxy timed out after 2000ms", true),
        "native-timeout",
      ],
      [
        new RpcCallError("UNAVAILABLE", "egress needs a mesh node and none is up", true, {
          service: "mesh",
          state: "mesh-down",
        }),
        "mesh-down",
      ],
    ] as const) {
      const d = await door();
      const log = capture();
      const { peers, asked } = link({
        // the door IS reachable over the OS network at this address, so a
        // fallback would succeed: the row proves none is taken
        endpoint: `http://127.0.0.1:${d.port}`,
        source: {
          egressProxy: async () => {
            throw refusal;
          },
        },
        logger: log.logger,
        callTimeoutMs: 1_500,
      });
      const refused = await peers.request("dev-b", "device.list", {}).catch((e: unknown) => e);
      expect(refused, state).toBeInstanceOf(RpcCallError);
      expect(refused, state).toMatchObject({ kind: "UNAVAILABLE" });
      expect(d.connections(), `${state}: nothing reached the door by any path`).toBe(0);
      expect(asked(), state).toBeGreaterThanOrEqual(1);
      // said once per link, however many redials the backoff made
      const said = log.events("fieldd.mesh.egress.dial_unavailable");
      expect(said, state).toHaveLength(1);
      expect(said[0], state).toMatchObject({ peer: "dev-b", state });
      expect(log.events("fieldd.mesh.egress.link_direct"), state).toEqual([]);
      peers.dispose();
    }
  });

  it("does not report its own close of a dial still in flight as a refusal", async () => {
    // a proxy that accepts and never answers: the dial is mid-handshake when
    // the link is torn down, and `ws` raises an error for that close
    const silent = await startFakeSocks5({
      ...CREDENTIAL,
      route: () => undefined,
      quirk: "silent",
    });
    cleanup.push(() => silent.close());
    const log = capture();
    const { peers, asked } = link({
      endpoint: `http://${DOOR_HOST}:9423`,
      source: { egressProxy: async () => ({ address: silent.address, ...credential() }) },
      logger: log.logger,
    });
    const pending = peers.request("dev-b", "device.list", {}).catch((e: unknown) => e);
    const deadline = Date.now() + 5_000;
    while (silent.connections() === 0 || asked() === 0) {
      if (Date.now() > deadline) throw new Error("the dial never reached the proxy");
      await new Promise((r) => setTimeout(r, 10));
    }
    peers.dispose();
    await pending;
    await new Promise((r) => setTimeout(r, 50));
    expect(log.events("fieldd.mesh.egress.dial_refused")).toEqual([]);
  });

  it("leaves the C5 seam alone: an injected ws-ctor IS the dial, and egress is never asked", async () => {
    const d = await door();
    const { WebSocket } = await import("ws");
    let asked = 0;
    const peers = new PeerLink({
      ownDeviceId: () => "dev-a",
      endpointFor: () => `http://127.0.0.1:${d.port}`,
      webSocket: WebSocket as never,
      egress: async () => {
        asked += 1;
        return { kind: "direct", state: "egress-unsupported" };
      },
    });
    cleanup.push(() => peers.dispose());
    await peers.request("dev-b", "device.list", {});
    expect(asked).toBe(0);
  });
});

function credential(): { username: string; credential: string } {
  return { username: CREDENTIAL.username, credential: CREDENTIAL.password };
}
