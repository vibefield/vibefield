// DS-5c (D3) — UA-P-D5 at the daemon: "a phone never receives a document",
// INBOUND. The unit rows (doc-sync-service.test.ts) prove the gate; this row
// proves the WIRING — that the daemon asks the roster, in the dial keyspace
// lanes are keyed by (`tailscaleId`; feeding the roster ULID here is the T1 §6
// bug class), whether the peer that opened a lane is a desktop that hosts
// documents. Against the mock floor: one self desktop whose slice says
// `docHost`, one self phone that publishes no slice at all.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  encodeMeshDataFrame,
  MESHDATA_FRAME,
  MESHDATA_INBOUND_LANE_ID_BASE,
  MeshDataFrameReader,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap, type FielddConfig } from "../src/index";
import { systemAccount, systemDocId } from "../src/library-doc";
import { computeAckMac } from "../src/pairing";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** The meshdata bridge field-native would be: it accepts fieldd's HELLO and
 * proves the pairing secret (WIN-10), so the daemon's doc sync starts. It counts
 * the HELLOs that reached it and the connections still open. */
async function meshDataBridge(
  dataDir: string,
): Promise<{ hellos: () => number; open: () => number; stop: () => Promise<void> }> {
  const secretHex = "ab".repeat(32);
  const sockets: Socket[] = [];
  let hellos = 0;
  const server = createServer((sock) => {
    sockets.push(sock);
    const reader = new MeshDataFrameReader();
    sock.on("data", (chunk: Buffer) => {
      for (const frame of reader.push(new Uint8Array(chunk))) {
        if (frame.kind !== MESHDATA_FRAME.HELLO) continue;
        hellos += 1;
        const hello = JSON.parse(new TextDecoder().decode(frame.payload)) as {
          bootId: string;
          nonce: string;
        };
        const proof = { serverMac: computeAckMac(secretHex, hello.nonce, hello.bootId) };
        sock.write(
          encodeMeshDataFrame(
            MESHDATA_FRAME.HELLO_OK,
            0,
            new TextEncoder().encode(JSON.stringify(proof)),
          ),
        );
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(nativeEndpoint(dataDir, SOCKETS.MESHDATA), resolve),
  );
  cleanup.push(() => {
    for (const sock of sockets) sock.destroy();
    server.close();
  });
  return {
    hellos: () => hellos,
    open: () => sockets.filter((sock) => !sock.destroyed).length,
    stop: async () => {
      for (const sock of sockets) sock.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("D3 — the daemon refuses a phone's doc lane, inbound (UA-P-D5)", () => {
  it("a lane from the account's phone is refused and closed; the same lane from a docHost desktop is claimed", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-admit-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    writeLinkFixture(dataDir); // a linked account: the account gate has a login to compare
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    mock.meshDeviceId = "dev-a";
    // Both peers are THIS account's — the tailnet's WhoIs says so — so the
    // account gate admits both. Only the desktop publishes a slice.
    mock.meshPeers = [
      {
        id: "node-b",
        deviceId: "dev-b",
        name: "desk-b",
        online: true,
        whois: { login: TEST_LOGIN, deviceName: "desk-b.tailnet.ts.net" },
      },
      {
        id: "node-phone",
        deviceId: "dev-phone",
        name: "phone",
        online: true,
        whois: { login: TEST_LOGIN, deviceName: "phone.tailnet.ts.net" },
      },
    ];
    mock.storeSlices.set("dev-b", {
      deviceId: "dev-b",
      name: "desk-b",
      platform: "darwin",
      headless: false,
      fielddVersion: "0.1.0",
      contractsVersion: CONTRACTS_VERSION,
      capabilities: { terminalHost: true, docHost: true, push: false },
      bootId: "boot-b",
      publishedAt: Date.now(),
    });
    await mock.start();
    cleanup.push(() => mock.stop());
    await meshDataBridge(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    // Doc sync is live and the roster is bound: the library's eager lane
    // toward the desktop was asked for.
    const libraryId = systemDocId("library", systemAccount(TEST_LOGIN, undefined));
    await until(
      () =>
        mock.meshLaneOpens.some(
          (lane) =>
            lane.protocol === "doc-sync" && lane.peer === "node-b" && lane.docId === libraryId,
        ),
      8000,
    );

    const closesBefore = mock.meshCalls.filter((m) => m === "native.mesh.lane.close").length;
    // The phone opens a doc lane toward this desktop…
    const phoneDoc = randomUUID();
    mock.pushDelta("lane.subscribe", {
      kind: "peerOpened",
      laneId: MESHDATA_INBOUND_LANE_ID_BASE + 1,
      peer: "node-phone",
      protocol: "doc-sync",
      docId: phoneDoc,
      inbound: true,
    });
    // …and so does the desktop, for another canvas: the CONTROL. A claimed
    // lane is answered by a return lane — the open this floor is asked for.
    const deskDoc = randomUUID();
    mock.pushDelta("lane.subscribe", {
      kind: "peerOpened",
      laneId: MESHDATA_INBOUND_LANE_ID_BASE + 2,
      peer: "node-b",
      protocol: "doc-sync",
      docId: deskDoc,
      inbound: true,
    });
    await until(
      () => mock.meshLaneOpens.some((lane) => lane.peer === "node-b" && lane.docId === deskDoc),
      8000,
    );
    await new Promise((r) => setTimeout(r, 300));
    // The phone got no return lane — so no VERSION, no checkpoint, no update
    // could ever have left toward it — and its lane was closed.
    expect(mock.meshLaneOpens.filter((lane) => lane.peer === "node-phone")).toEqual([]);
    expect(mock.meshCalls.filter((m) => m === "native.mesh.lane.close").length).toBeGreaterThan(
      closesBefore,
    );
  }, 30_000);
});

// Item 206's boot half — `meshdata-boot-redial` (a), James 2026-11-06 22:56Z: a boot whose first dial of the lane link
// fails is not terminal. The link dials on the back-off, and doc sync and presence start once it has said HELLO_OK and
// mgmt is up. Such a boot is an unhealthy floor's: a healthy one binds MeshData with the mesh on or off.
const LANE_SUBSCRIBE = "native.mesh.lane.subscribe";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const holds = (condition: () => boolean, withinMs: number): Promise<boolean> =>
  until(condition, withinMs).then(
    () => true,
    () => false,
  );

/** A mock floor whose mgmt answers and whose byte socket is not there. */
async function floorWithNoBridge() {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-boot-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  writeLinkFixture(dataDir);
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.meshDeviceId = "dev-a";
  await mock.start();
  cleanup.push(() => mock.stop());
  const laneSubscriptions = (): number =>
    mock.meshCalls.filter((method) => method === LANE_SUBSCRIBE).length;
  return { dataDir, mock, laneSubscriptions };
}

/** fieldd booted on that floor: its dial failed, and the first redial (500 ms) met no bridge either. No spawner, so
 * the floor is adopted and nothing respawns one into this data dir when a row takes mgmt away. */
async function bootWithNoBridge(timings?: FielddConfig["nativeSupervisionTimings"]) {
  const floor = await floorWithNoBridge();
  const daemon = await bootstrap({
    dataDir: floor.dataDir,
    controlPort: 0,
    dataPort: 0,
    ...(timings !== undefined ? { nativeSupervisionTimings: timings } : {}),
  });
  cleanup.push(() => daemon.stop());
  await sleep(700);
  return { ...floor, daemon };
}

describe("item 206's boot half — a boot with no MeshData bridge starts doc sync once both planes are up", () => {
  it("R6: fieldd boots with no bridge, so nothing subscribes to the lane table; the bridge comes, and doc sync and presence subscribe at the back-off's next dial", async () => {
    const { dataDir, laneSubscriptions } = await bootWithNoBridge();
    const before = laneSubscriptions();
    await meshDataBridge(dataDir);
    // 12 s clears the back-off's 10 s cap, wherever in its steps the bridge arrives
    const subscribed = await holds(() => laneSubscriptions() >= 2, 12_000);
    expect({ before, subscribed }).toEqual({ before: 0, subscribed: true });
  }, 30_000);

  it("R9: HELLO_OK lands with mgmt down, as a respawned floor binds MeshData first: nothing is asked of it, nothing is terminal, and both services start when mgmt answers", async () => {
    const { dataDir, mock, daemon, laneSubscriptions } = await bootWithNoBridge();
    const asks = vi.spyOn(daemon.native, "subscribe");
    await mock.stop();
    await until(() => !daemon.native.connected, 5_000, "mgmt went away");
    const bridge = await meshDataBridge(dataDir);
    await until(() => bridge.hellos() >= 1, 12_000, "the link dialed the bridge");
    await sleep(100);
    const waiting = {
      asked: asks.mock.calls.filter(([method]) => method === LANE_SUBSCRIBE).length,
      subscriptions: laneSubscriptions(),
      open: bridge.open(),
    };
    await mock.start();
    const started = await holds(() => laneSubscriptions() >= 2, 12_000);
    expect({ waiting, started, open: bridge.open() }).toEqual({
      waiting: { asked: 0, subscriptions: 0, open: 1 },
      started: true,
      open: 1,
    });
  }, 45_000);

  it("R10: the floor dies with doc sync's subscribe unanswered: nothing is terminal, and the start runs again when it is back", async () => {
    const { dataDir, mock, laneSubscriptions } = await bootWithNoBridge();
    mock.laneSubscribeGate = () => "hold";
    const bridge = await meshDataBridge(dataDir);
    await until(() => laneSubscriptions() >= 1, 12_000, "doc sync asked");
    mock.laneSubscribeGate = null;
    await mock.stop();
    await mock.start();
    // the unanswered ask, then doc sync's and presence's own
    const started = await holds(() => laneSubscriptions() >= 3, 12_000);
    expect({ started, open: bridge.open() }).toEqual({ started: true, open: 1 });
  }, 45_000);

  it("R11: the floor dies with presence's subscribe unanswered: doc sync's is replayed, and presence's start runs again", async () => {
    const { dataDir, mock, laneSubscriptions } = await bootWithNoBridge();
    let asks = 0;
    mock.laneSubscribeGate = () => {
      asks += 1;
      return asks === 2 ? "hold" : undefined;
    };
    const bridge = await meshDataBridge(dataDir);
    await until(() => laneSubscriptions() >= 2, 12_000, "presence asked");
    mock.laneSubscribeGate = null;
    await mock.stop();
    await mock.start();
    // doc sync's and the unanswered ask, then NativeLink's replay of doc sync's and presence's own
    const started = await holds(() => laneSubscriptions() >= 4, 12_000);
    expect({ started, open: bridge.open() }).toEqual({ started: true, open: 1 });
  }, 45_000);

  it("R12: a START the floor answers no, not retryably, stays terminal: the link closes and nothing dials or subscribes again", async () => {
    const { dataDir, mock, laneSubscriptions } = await bootWithNoBridge();
    mock.laneSubscribeGate = () => "refuse";
    const bridge = await meshDataBridge(dataDir);
    await until(() => laneSubscriptions() >= 1, 12_000, "doc sync asked");
    const closed = await holds(() => bridge.open() === 0, 3_000);
    mock.laneSubscribeGate = null;
    // a link still on its back-off would dial within this
    await sleep(1_200);
    expect({ closed, subscriptions: laneSubscriptions(), hellos: bridge.hellos() }).toEqual({
      closed: true,
      subscriptions: 1,
      hellos: 1,
    });
  }, 30_000);

  it("R13: presence answered no costs presence alone, once: doc sync stays, the link stays open, and a reconnect does not start it again", async () => {
    const { dataDir, mock, daemon, laneSubscriptions } = await bootWithNoBridge();
    let asks = 0;
    mock.laneSubscribeGate = () => {
      asks += 1;
      return asks === 2 ? "refuse" : undefined;
    };
    const bridge = await meshDataBridge(dataDir);
    await until(() => laneSubscriptions() >= 2, 12_000, "presence asked");
    await sleep(200);
    const refused = { subscriptions: laneSubscriptions(), open: bridge.open() };
    await mock.stop();
    await until(() => !daemon.native.connected, 5_000, "mgmt went away");
    await mock.start();
    await until(() => laneSubscriptions() >= 3, 12_000, "doc sync's subscription was replayed");
    // NativeLink replays doc sync's; a second `connected` must not run the start again
    await sleep(300);
    expect({ refused, subscriptions: laneSubscriptions(), open: bridge.open() }).toEqual({
      refused: { subscriptions: 2, open: 1 },
      subscriptions: 3,
      open: 1,
    });
  }, 45_000);

  it("R14: mgmt coming back with no bridge starts nothing: the services wait for the link as well", async () => {
    const { mock, daemon, laneSubscriptions } = await bootWithNoBridge();
    await mock.stop();
    await until(() => !daemon.native.connected, 5_000, "mgmt went away");
    await mock.start();
    await until(() => daemon.native.connected, 12_000, "mgmt came back");
    await sleep(200);
    expect(laneSubscriptions()).toBe(0);
  }, 30_000);

  it("R15: a boot that fails past the lane stage, outside `api.listen`'s own rollback, closes the link, so nothing dials on from a boot that is gone", async () => {
    const { dataDir } = await floorWithNoBridge();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));
    cleanup.push(() => {
      blocker.close();
    });
    const blockedPort = (blocker.address() as { port: number }).port;
    // the data port, not the control port: `api.listen`'s failure is caught by its own rollback, which closes the link
    // before it rethrows, so only this one reaches the outer rollback with the link still open
    await expect(bootstrap({ dataDir, controlPort: 0, dataPort: blockedPort })).rejects.toThrow();
    const bridge = await meshDataBridge(dataDir);
    // past the back-off's 10 s cap: a link left dialing reaches the bridge within this
    expect(await holds(() => bridge.hellos() >= 1, 11_000)).toBe(false);
  }, 30_000);

  it("R23: the link goes with doc sync's answer still owed: presence waits for the link, and starts when it is back", async () => {
    const { dataDir, mock, laneSubscriptions } = await bootWithNoBridge();
    mock.laneSubscribeGate = () => "hold";
    const first = await meshDataBridge(dataDir);
    await until(() => laneSubscriptions() >= 1, 12_000, "doc sync asked");
    mock.laneSubscribeGate = null;
    // no bridge to redial, so the wait below cannot race the link coming back
    await first.stop();
    await sleep(100);
    mock.releaseLaneSubscribes();
    await sleep(300);
    const waiting = laneSubscriptions();
    const second = await meshDataBridge(dataDir);
    const started = await holds(() => laneSubscriptions() >= 2, 12_000);
    expect({ waiting, started, open: second.open() }).toEqual({
      waiting: 1,
      started: true,
      open: 1,
    });
  }, 45_000);

  it("R26: a subscribe past its deadline with both planes up is not terminal: the link stays, and the start runs again on the back-off, with nothing reconnecting", async () => {
    const { dataDir, mock, daemon, laneSubscriptions } = await bootWithNoBridge();
    const timedOut = new Promise<void>((resolve) => {
      daemon.native.on("deadline-miss", (miss: { method: string }) => {
        if (miss.method === LANE_SUBSCRIBE) resolve();
      });
    });
    mock.laneSubscribeGate = () => "hold";
    const bridge = await meshDataBridge(dataDir);
    await timedOut;
    await sleep(100);
    const open = bridge.open();
    mock.laneSubscribeGate = null;
    // the ask that timed out, then doc sync's and presence's own
    const started = await holds(() => laneSubscriptions() >= 3, 12_000);
    expect({ open, started, after: bridge.open() }).toEqual({ open: 1, started: true, after: 1 });
  }, 45_000);

  it("R27: HELLO_OK lands with the floor held unresponsive: its door refuses, nothing is terminal, and the start runs on the supervisor's up", async () => {
    // the ladder out of reach, so the floor stays held and paired for the row
    const timings = { WEDGE_REDIAL_MS: 120_000, WEDGE_CONFIRM_MS: 120_000 };
    const { dataDir, mock, daemon, laneSubscriptions } = await bootWithNoBridge(timings);
    mock.silentMethods.add("native.lifecycle.ping");
    await until(() => daemon.nativeSupervisor.state === "unresponsive", 5_000, "the floor held");
    const bridge = await meshDataBridge(dataDir);
    await until(() => bridge.hellos() >= 1, 12_000, "the link dialed the bridge");
    await sleep(100);
    const held = { subscriptions: laneSubscriptions(), open: bridge.open() };
    mock.silentMethods.delete("native.lifecycle.ping");
    const started = await holds(() => laneSubscriptions() >= 2, 12_000);
    expect({ held, started, open: bridge.open() }).toEqual({
      held: { subscriptions: 0, open: 1 },
      started: true,
      open: 1,
    });
  }, 45_000);
});
