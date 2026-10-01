// SP-3 (thinking-sync-planes.md §5.4, §6; thinking-desktop-sync-plane.md §6.4;
// design-06 §6, §8) — `index.openTicket`, DECLARED and answered honestly: the
// direct plane's door exists in the registry and at the door, and until DS-7
// mints rosetta's grant (RO-10) at the pin move it answers UNAVAILABLE
// {service: "index", state: "direct-plane-unbuilt"}, retryable false — to a
// window, to the phone, through a peer daemon's forward, and even with the
// index serve live behind its flag (a ticket without a grant is half a ticket,
// and the template never mints one).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACTS_VERSION,
  INDEX_TICKET,
  IndexTicketUnavailableDetails,
  type Scope,
  SOCKETS,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { INDEX_SERVE_ID } from "../src/index-serve";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");
const fakeRosettad = ((_bin: string, args: readonly string[], options: object) =>
  spawn(process.execPath, [FAKE, ...args], {
    ...options,
    env: { ...process.env, FAKE_ROSETTAD_MODE: "ok" },
  })) as unknown as typeof spawn;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-index-ticket-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir, TEST_LOGIN);
  return dataDir;
}

async function startMock(dataDir: string): Promise<MockMgmtServer> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

async function boot(opts: { indexDirectPlane?: boolean } = {}) {
  const dataDir = makeDataDir();
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const mock = await startMock(dataDir);
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    ...(opts.indexDirectPlane === true
      ? {
          indexDirectPlane: true,
          rosettadBin: "/stand-in/rosettad",
          rosettadSpawn: fakeRosettad,
          rosettadHome: home,
        }
      : {}),
  });
  cleanup.push(() => daemon.stop());
  return { daemon, mock };
}

async function open(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** A window on this desktop holding exactly `scopes`. */
async function windowOf(daemon: FielddDaemon, scopes: Scope[]): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(rpc, daemon.tokens.mint(scopes, "sp3-window").token);
  return rpc;
}

/** The product door the way the SIDECAR delivers a tailnet caller: the route
 * secret joined and the WhoIs login injected (the phone's own login = self). */
async function tailnetCaller(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  login: string,
): Promise<WsRpc> {
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
    "Tailscale-User-Login": login,
  });
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
}

/** The one honest answer, whoever asks and by whatever road. */
function expectUnbuilt(err: RpcErrorShape): void {
  expect(err.data?.kind).toBe("UNAVAILABLE");
  expect(err.data?.retryable).toBe(false);
  expect(IndexTicketUnavailableDetails.parse(err.data?.details)).toMatchObject({
    service: INDEX_TICKET.SERVICE,
    state: INDEX_TICKET.STATE_UNBUILT,
  });
}

describe("SP-3 — index.openTicket answers honestly until DS-7", () => {
  it("a window holding index.read is told the direct plane is unbuilt — not 'method not found'", async () => {
    const { daemon } = await boot();
    const win = await windowOf(daemon, ["index.read"]);
    expectUnbuilt(await win.callErr("index.openTicket", { sessionId: "s1" }));
    // its own device is this desktop: the routing key is stripped, same answer
    const selfId = daemon.devices.currentDeviceId();
    expectUnbuilt(await win.callErr("index.openTicket", { sessionId: "s1", device: selfId }));
    // a malformed ask is the caller's to fix, and says so first
    const bad = await win.callErr("index.openTicket", {});
    expect(bad.data?.kind).toBe("PRECONDITION_FAILED");
  }, 30_000);

  it("its scope is index.read, checked before anything else", async () => {
    const { daemon } = await boot();
    const win = await windowOf(daemon, ["doc.read"]);
    const refused = await win.callErr("index.openTicket", { sessionId: "s1" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.data?.details).toEqual({ required: "index.read" });
  }, 30_000);

  it("the phone (a self tailnet principal) is told the same; a guest is told nothing", async () => {
    const { daemon, mock } = await boot();
    const phone = await tailnetCaller(daemon, mock, TEST_LOGIN);
    expectUnbuilt(await phone.callErr("index.openTicket", { sessionId: "s1" }));
    const guest = await tailnetCaller(daemon, mock, "someone-else@example.com");
    const refused = await guest.callErr("index.openTicket", { sessionId: "s1" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);

  it("with rosettad's serve LIVE behind its flag, still unbuilt — there is no grant to put beside the set", async () => {
    const { daemon, mock } = await boot({ indexDirectPlane: true });
    await until(() => mock.meshServes.get(INDEX_SERVE_ID) !== undefined, 15_000);
    const win = await windowOf(daemon, ["index.read"]);
    expectUnbuilt(await win.callErr("index.openTicket", { sessionId: "s1" }));
  }, 30_000);
});

// ---------------------------------------------------------------------------
// A peer daemon's forward of it: two real daemons (the DS-4 e2e harness).

/** The sidecar half of A's dial: a tailnet coordinate for B lands on B's
 * loopback door with the route secret joined, and the WhoIs login plus A's
 * node id are injected — B's roster correlates that node to A's desktop slice,
 * which is what makes the caller a `peer-fieldd` principal (D1). */
function sidecar(loopback: () => string): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const target = url.includes("device-b.tailnet.ts.net") ? loopback() : "ws://127.0.0.1:1/";
      super(url.includes(".ts.net") ? target : url, {
        headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-a" },
      });
    }
  }
  return SidecarSim;
}

describe("SP-3 — index.openTicket through a peer daemon's forward", () => {
  it("A's window asks for a session on B: A forwards it keyed, B answers from its own door, A hands back B's answer", async () => {
    const dirB = makeDataDir();
    const mockB = await startMock(dirB);
    mockB.meshDeviceId = "dev-b";
    mockB.meshPeers = [
      registryPeer({ nodeId: "node-a", deviceId: "dev-a", name: "device-a", login: TEST_LOGIN }),
    ];
    mockB.storeSlices = new Map<string, unknown>([["dev-a", desktopSlice("dev-a", "device-a")]]);
    const B = await bootstrap({ dataDir: dirB, controlPort: 0, dataPort: 0 });
    cleanup.push(() => B.stop());
    await until(() => mockB.meshServes.get("product") !== undefined, 15_000);
    const bEndpoint = `ws://127.0.0.1:${B.controlPort}/t/${productPathSecret(mockB)}`;

    const dirA = makeDataDir();
    const mockA = await startMock(dirA);
    mockA.meshDeviceId = "dev-a";
    mockA.meshPeers = [
      {
        id: "node-b",
        deviceId: "dev-b",
        name: "device-b",
        online: true,
        whois: { login: TEST_LOGIN, deviceName: "device-b.tailnet.ts.net" },
      },
    ];
    const A = await bootstrap({
      dataDir: dirA,
      controlPort: 0,
      dataPort: 0,
      peerWebSocket: sidecar(() => bEndpoint),
    });
    cleanup.push(() => A.stop());
    await until(() => A.devices.get("dev-b") !== undefined, 8_000);
    await until(() => B.devices.isDocHost("dev-a"), 8_000);

    const win = await windowOf(A, ["index.read"]);
    const err = await win.callErr("index.openTicket", { device: "dev-b", sessionId: "s1" });
    // B's own answer, untouched by the hop: a forward that never reached B
    // reads `peer-link`/`mesh` states, never the index's
    expectUnbuilt(err);
    expect(err.message).toMatch(/index\.openTicket/);
  }, 60_000);
});
