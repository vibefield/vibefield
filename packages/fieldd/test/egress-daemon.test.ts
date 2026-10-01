// DS-1 — the daemon wires egress (src/daemon.ts): its PeerLink asks the floor
// for the node's path on every dial and rides the node's SOCKS5 when there is
// one; its EgressRoutes port aims routes at the roster's AUTHENTICATED tailnet
// name. One real fieldd on the scripted floor; the peer is a door the fake
// proxy reaches by name.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PORTS, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer, mockEgress } from "../src/testing/mock-mgmt";
import { writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { startFakeSocks5 } from "./socks5-server";

const LOGIN = "me@jamesyong42.com";
const PEER_HOST = "device-b.tailnet.ts.net";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function until(fn: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** One real daemon whose roster names `dev-b` at `device-b.tailnet.ts.net`.
 * `floorBootId` scripts the floor's health stream (the generic answer carries
 * no boot, and a daemon that cannot tell the floor's boot caches nothing). */
async function daemonWithPeer(
  opts: { floorBootId?: string } = {},
): Promise<{ A: FielddDaemon; mock: MockMgmtServer }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-ds1-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeLinkFixture(dir, LOGIN);
  mkdirSync(join(dir, "native", "run"), { recursive: true });
  writeFileSync(join(dir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dir, SOCKETS.MGMT));
  if (opts.floorBootId !== undefined) {
    mock.healthSnapshot = { state: "up", bootId: opts.floorBootId, units: [] };
  }
  await mock.start();
  cleanup.push(() => mock.stop());
  mock.meshPeers = [
    {
      id: "node-b",
      deviceId: "dev-b",
      name: "device-b",
      online: true,
      whois: { login: LOGIN, deviceName: PEER_HOST },
    },
  ];
  const A = await bootstrap({ dataDir: dir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => A.stop());
  await until(() => A.devices.get("dev-b")?.tailnetDnsName === PEER_HOST);
  return { A, mock };
}

/** A peer's door: the hello and one read. */
async function door(): Promise<number> {
  return (await droppableDoor()).port;
}

/** The same door, with its connections countable and droppable (each drop
 * makes the link's client dial again). */
async function droppableDoor(): Promise<{
  port: number;
  connections: () => number;
  drop: () => void;
}> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let connections = 0;
  wss.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { id: number; method: string };
      const result =
        msg.method === "system.hello"
          ? { contractsVersion: "0.1.0", serverKind: "fieldd", grantedScopes: [] }
          : { reached: "the peer's door, through the node" };
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

describe("DS-1 — the daemon's dial and routes ride the floor's egress", () => {
  it("asks the floor on a dial, and today (no egress) dials as before", async () => {
    const { A, mock } = await daemonWithPeer();
    // the door's name resolves nowhere here, so this call cannot succeed —
    // what it witnesses is the ASK: the dial consulted the floor first
    void A.peers.request("dev-b", "device.list", {}).catch(() => undefined);
    await until(() => mock.meshCalls.includes("native.mesh.egress.proxy"));
  }, 30_000);

  it("reaches the peer's door through the node's SOCKS5 when the floor has one", async () => {
    const { A, mock } = await daemonWithPeer();
    const doorPort = await door();
    const proxy = await startFakeSocks5({
      username: "tsnet",
      password: "the-node-credential",
      route: (host, port) =>
        host === PEER_HOST && port === PORTS.FIELDD_PRODUCT_SERVE
          ? { host: "127.0.0.1", port: doorPort }
          : undefined,
    });
    cleanup.push(() => proxy.close());
    mock.egress = mockEgress({
      proxy: { address: proxy.address, username: "tsnet", credential: "the-node-credential" },
    });
    expect(await A.peers.request("dev-b", "device.list", {})).toEqual({
      reached: "the peer's door, through the node",
    });
    expect(proxy.requests).toEqual([
      expect.objectContaining({ atyp: 0x03, host: PEER_HOST, port: PORTS.FIELDD_PRODUCT_SERVE }),
    ]);
  }, 30_000);

  it("asks the floor ONCE per floor boot across three dials, and again when the floor boots again (DS-1b)", async () => {
    const { A, mock } = await daemonWithPeer({ floorBootId: "floor-boot-1" });
    const d = await droppableDoor();
    const proxy = await startFakeSocks5({
      username: "tsnet",
      password: "the-node-credential",
      route: (host, port) =>
        host === PEER_HOST && port === PORTS.FIELDD_PRODUCT_SERVE
          ? { host: "127.0.0.1", port: d.port }
          : undefined,
    });
    cleanup.push(() => proxy.close());
    mock.egress = mockEgress({
      proxy: { address: proxy.address, username: "tsnet", credential: "the-node-credential" },
    });
    const asks = () => mock.meshCalls.filter((m) => m === "native.mesh.egress.proxy").length;
    const reached = { reached: "the peer's door, through the node" };
    expect(await A.peers.request("dev-b", "device.list", {})).toEqual(reached);
    for (const dials of [2, 3]) {
      d.drop(); // the link's client dials again by itself
      await until(() => proxy.requests.length === dials && d.connections() === dials);
      expect(await A.peers.request("dev-b", "device.list", {})).toEqual(reached);
    }
    expect(proxy.requests, "three dials, each through the node").toHaveLength(3);
    expect(asks(), "one ask for the floor's boot, not one per dial").toBe(1);

    mock.pushHealth({ state: "up", bootId: "floor-boot-2", units: [] }); // the floor respawned
    await until(() => A.nativeHealth()?.bootId === "floor-boot-2");
    d.drop();
    await until(() => proxy.requests.length === 4);
    expect(await A.peers.request("dev-b", "device.list", {})).toEqual(reached);
    expect(asks(), "a new floor boot is asked again").toBe(2);
  }, 30_000);

  it("exposes the routes port, aimed at the roster's tailnet name", async () => {
    const { A, mock } = await daemonWithPeer();
    const egress = mockEgress();
    mock.egress = egress;
    expect(await A.egressRoutes.ensureRoute("dev-b", PORTS.TERMINAL_CELLS_SERVE)).toEqual({
      listen: "127.0.0.1:53000",
    });
    expect(egress.adds).toEqual([
      { id: "egress-dev-b-9422", target: `${PEER_HOST}:${PORTS.TERMINAL_CELLS_SERVE}` },
    ]);
    await expect(
      A.egressRoutes.ensureRoute("dev-b", PORTS.FIELDD_PRODUCT_SERVE),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  }, 30_000);
});
