// DS-3 end-to-end (DS-D4): TWO REAL fieldd daemons, each its own device (A =
// dev-a, B = dev-b — the mocks' `meshDeviceId` set apart, so unlike the C5
// e2e neither has to borrow the other's identity), each listing the other as a
// self DESKTOP (the tailnet's registry names the peer; its device slice says
// `docHost`), joined by sidecar-simulating ws-ctors that route each one's
// tailnet coordinate for the other to the other's real loopback door.
//
// What it witnesses, on the real door, PeerLink, the federated manager and the
// fold:
//   · each desktop's mesh board shows the OTHER's agent within a beat;
//   · the owner's chain passes through unchanged — a tap on the SAME upstream
//     (the federated manager shares it) sees the frames the reader is relayed,
//     epoch, since, revision and row stamps alike, and the epoch is the
//     OWNER'S boot;
//   · a link dropped mid-stream (the peer stops) yields a state change and no
//     rows; the roster calling it offline makes it asleep; its last board stays;
//   · the upstream is reference-counted: the last reader out closes it;
//   · the door's refusals: a peer never gets the full projection or the mesh,
//     a phone never gets the desk.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_FIELD,
  AGENT_SESSION_RECORD_FORMAT,
  type AgentMeshFrame,
  type AgentMeshOpen,
  type AgentSessionRecord,
  CONTRACTS_VERSION,
  LAYOUT,
  SOCKETS,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, SessionRecordStore } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

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

const ENDPOINTS = {
  controlSocket: "/mock/native/run/termctl.sock",
  frameSocket: "/mock/native/run/termframe.sock",
  authToken: "mock-per-boot-token",
};

const observed = (sessionId: string, cellBootId: string) => ({
  generation: 0,
  bootId: "mock-boot",
  terminals: [{ sessionId, pid: 42, cell: { cellInstanceId: 1, cellBootId } }],
  workers: [],
});

/** A run whose record the fold re-lists at boot, because the (mocked) floor
 * still lists its PTY — MF-1f's restart path, the agent-field daemon suite's
 * way of making a fold non-empty without a real floor. */
function writeRun(dataDir: string, runtimeRunId: string, pane: string): void {
  const at = "2026-09-30T12:00:00.000Z";
  const record: AgentSessionRecord = {
    format: AGENT_SESSION_RECORD_FORMAT,
    runtimeRunId,
    runtimeEpoch: 1,
    provider: "scripted",
    cwd: "/repo",
    title: "held open",
    terminalSessionId: pane,
    continuation: {
      providerId: "scripted",
      nativeSessionId: `${runtimeRunId}-native`,
      implementation: "native",
    },
    createdAt: at,
    updatedAt: at,
    exited: { at, exitCode: 0, signal: null, reason: "completed" },
  };
  new SessionRecordStore({
    dir: join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR),
    keyPath: join(dataDir, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
    now: () => new Date(at),
  }).write(record);
}

/** A desktop's device slice, as it publishes itself into `field.devices.v1`:
 * the slice is what says `docHost`, DS-D7's desktop test. */
const desktopSlice = (deviceId: string, name: string) => ({
  deviceId,
  name,
  platform: "darwin",
  headless: false,
  fielddVersion: "0.1.0",
  contractsVersion: CONTRACTS_VERSION,
  capabilities: { terminalHost: true, terminalMesh: true, docHost: true, push: false },
  // a desktop names its product serve; the roster derives the door's
  // coordinate from the tailnet (UA-P-0e), and derives none without this
  productEndpoint: { serve: "product" },
  bootId: `slice-boot-${deviceId}`,
  publishedAt: Date.now(),
});

const registryPeer = (deviceId: string, host: string, online = true) => ({
  id: `node-${deviceId}`,
  deviceId,
  name: host,
  online,
  whois: { login: TEST_LOGIN, deviceName: `${host}.tailnet.ts.net` },
});

/** The sidecar, both halves (UA-P-0d): a TAILNET coordinate is terminated and
 * forwarded to the target's loopback door with its route secret, and the
 * WhoIs login is injected. `routes` resolves lazily: the doors exist only once
 * both daemons are up. */
function sidecar(routes: Record<string, () => string>): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const host = Object.keys(routes).find((name) => url.includes(name));
      const target = host === undefined ? "ws://127.0.0.1:1/" : (routes[host]?.() ?? "");
      super(url.includes(".ts.net") ? target : url, {
        headers: { "Tailscale-User-Login": TEST_LOGIN },
      });
    }
  }
  return SidecarSim;
}

interface Side {
  daemon: FielddDaemon;
  mock: MockMgmtServer;
  run: string;
  pane: string;
  /** this daemon's loopback door with its route secret — what the OTHER dials */
  door: string;
}

async function bootSide(
  deviceId: string,
  peer: { deviceId: string; host: string; name: string },
  route: () => string,
): Promise<Omit<Side, "door">> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ds3-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  const run = `run-${deviceId}`;
  const pane = `pane-${deviceId}`;
  writeRun(dataDir, run, pane);

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.meshDeviceId = deviceId;
  mock.storeSlices = new Map<string, unknown>([
    [peer.deviceId, desktopSlice(peer.deviceId, peer.name)],
  ]);
  mock.meshPeers = [registryPeer(peer.deviceId, peer.host)];
  mock.helloTerminal = ENDPOINTS;
  mock.helloTerminalMesh = true;
  mock.observedState = observed(pane, `cell-${deviceId}-1`);
  await mock.start();
  cleanup.push(() => mock.stop());

  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    peerWebSocket: sidecar({ [`${peer.host}.tailnet.ts.net`]: route }),
  });
  cleanup.push(() => daemon.stop());
  return { daemon, mock, run, pane };
}

async function doorOf(side: Omit<Side, "door">): Promise<string> {
  await until(
    () =>
      side.daemon
        .health()
        .mesh.serves.some((serve) => serve.name === "product" && serve.url !== undefined),
    8_000,
  );
  return `ws://127.0.0.1:${side.daemon.controlPort}/t/${productPathSecret(side.mock)}`;
}

/** Two desktops, each listing the other. */
async function bootPair(): Promise<{ A: Side; B: Side }> {
  let aDoor = "";
  let bDoor = "";
  const a = await bootSide(
    "dev-a",
    { deviceId: "dev-b", host: "device-b", name: "studio" },
    () => bDoor,
  );
  const b = await bootSide(
    "dev-b",
    { deviceId: "dev-a", host: "device-a", name: "laptop" },
    () => aDoor,
  );
  aDoor = await doorOf(a);
  bDoor = await doorOf(b);
  // each roster names the other as an awake desktop, and each fold has its run
  await until(() => a.daemon.devices.get("dev-b")?.capabilities?.docHost === true, 8_000);
  await until(() => b.daemon.devices.get("dev-a")?.capabilities?.docHost === true, 8_000);
  await until(
    () => a.daemon.agents.list().sessions.some((row) => row.runtimeRunId === a.run),
    8_000,
  );
  await until(
    () => b.daemon.agents.list().sessions.some((row) => row.runtimeRunId === b.run),
    8_000,
  );
  return { A: { ...a, door: aDoor }, B: { ...b, door: bDoor } };
}

/** A window on a desktop: the loopback door, a token that may observe agents. */
async function windowOn(daemon: FielddDaemon): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.tokens.mint(["agent.observe"], "ds3-window").token);
  return rpc;
}

/** The mesh frames a reader has heard for one subscription, in order. */
function meshFrames(rpc: WsRpc, subId: string): AgentMeshFrame[] {
  return rpc.notifications
    .filter((note) => note.method === "agent.delta" && note.params.subId === subId)
    .map((note) => note.params.payload as AgentMeshFrame);
}

async function openMesh(rpc: WsRpc): Promise<{ subId: string; open: AgentMeshOpen }> {
  const answer = (await rpc.call("agent.subscribe", { projection: "desk", scope: "mesh" })) as {
    subId: string;
    snapshot: AgentMeshOpen;
  };
  return { subId: answer.subId, open: answer.snapshot };
}

/** The rows a reader holds for one device, folding the open and its frames. */
function heldRows(open: AgentMeshOpen, frames: AgentMeshFrame[], device: string): string[] {
  let rows = new Map(
    (open.devices.find((entry) => entry.device === device)?.snapshot?.rows ?? []).map((row) => [
      row.runtimeRunId,
      row,
    ]),
  );
  for (const frame of frames) {
    if (frame.device !== device) continue;
    if ("snapshot" in frame)
      rows = new Map(frame.snapshot.rows.map((row) => [row.runtimeRunId, row]));
    if ("delta" in frame) {
      for (const row of frame.delta.upserts) rows.set(row.runtimeRunId, row);
      for (const id of frame.delta.removed) rows.delete(id);
    }
  }
  return [...rows.keys()];
}

const stateOf = (
  open: AgentMeshOpen,
  frames: AgentMeshFrame[],
  device: string,
): string | undefined => {
  let state = open.devices.find((entry) => entry.device === device)?.state;
  for (const frame of frames) if (frame.device === device && "state" in frame) state = frame.state;
  return state;
};

describe("DS-3 — the mesh board across two real daemons", () => {
  it("each desktop shows the other's agent within three beats, and its own in the open", async () => {
    const { A, B } = await bootPair();
    const beat = AGENT_FIELD.MESH_HEARTBEAT_MS;

    const onA = await windowOn(A.daemon);
    const meshA = await openMesh(onA);
    // this desktop's own board is in the open itself
    expect(meshA.open.devices[0]).toMatchObject({ device: "dev-a", state: "live" });
    expect(heldRows(meshA.open, [], "dev-a")).toEqual([A.run]);
    // the other desktop is LISTED from the start, and its board arrives on the stream
    expect(meshA.open.devices.map((entry) => entry.device)).toEqual(["dev-a", "dev-b"]);
    await until(
      () => heldRows(meshA.open, meshFrames(onA, meshA.subId), "dev-b").includes(B.run),
      3 * beat,
    );
    expect(stateOf(meshA.open, meshFrames(onA, meshA.subId), "dev-b")).toBe("live");

    const onB = await windowOn(B.daemon);
    const meshB = await openMesh(onB);
    await until(
      () => heldRows(meshB.open, meshFrames(onB, meshB.subId), "dev-a").includes(A.run),
      3 * beat,
    );
    expect(heldRows(meshB.open, [], "dev-b")).toEqual([B.run]);
    // the desk row carries what a person at another desktop reads a run by —
    // and here, where the run has no reply or cost, nothing invented for it
    const bRow = meshFrames(onA, meshA.subId).flatMap((frame) =>
      "snapshot" in frame && frame.device === "dev-b" ? frame.snapshot.rows : [],
    )[0];
    expect(bRow).toMatchObject({ runtimeRunId: B.run, device: "dev-b", tier: "managed" });
    expect(bRow).not.toHaveProperty("monitor");
  }, 60_000);

  it("the owner's chain passes through unchanged: a tap on the same upstream sees the frames the reader is relayed", async () => {
    const { A, B } = await bootPair();
    const onA = await windowOn(A.daemon);
    const meshA = await openMesh(onA);
    await until(() => stateOf(meshA.open, meshFrames(onA, meshA.subId), "dev-b") === "live", 5_000);

    // THE TAP: the federated manager shares one upstream per {device, method,
    // params}; attaching with the board's own params re-snapshots it, and from
    // here the tap and the reader hear the SAME frames from B
    const taps: Array<{ payload: unknown; kind: string | undefined }> = [];
    const tap = await A.daemon.federatedSubs.attach(
      "dev-b",
      "agent.subscribe",
      {
        projection: "desk",
        minIntervalMs: AGENT_FIELD.DESK_MIN_INTERVAL_MS,
        heartbeatMs: AGENT_FIELD.MESH_HEARTBEAT_MS,
      },
      (payload, kind) => taps.push({ payload, kind }),
    );
    cleanup.push(() => tap.dispose());
    const tapped = tap.snapshot as { epoch: string; revision: number };
    // the chain is the OWNER'S: B's boot names it, never A's
    expect(tapped.epoch.startsWith(`${B.daemon.bootId}.`)).toBe(true);
    await until(
      () =>
        meshFrames(onA, meshA.subId).some(
          (frame) =>
            "snapshot" in frame &&
            frame.device === "dev-b" &&
            frame.snapshot.epoch === tapped.epoch,
        ),
      5_000,
    );
    const reset = meshFrames(onA, meshA.subId).find(
      (frame) => "snapshot" in frame && frame.snapshot.epoch === tapped.epoch,
    );
    expect(reset).toEqual({ device: "dev-b", snapshot: tap.snapshot });

    // B's fold moves (its floor re-tags the pane's cell): one delta on B's chain
    B.mock.pushObserved(observed(B.pane, "cell-dev-b-2"));
    const isChange = (payload: unknown): boolean => {
      const delta = payload as { upserts?: unknown[]; removed?: unknown[] };
      return (delta.upserts?.length ?? 0) > 0 || (delta.removed?.length ?? 0) > 0;
    };
    await until(
      () => taps.some((entry) => entry.kind === "delta" && isChange(entry.payload)),
      5_000,
    );
    await until(
      () =>
        meshFrames(onA, meshA.subId).some((frame) => "delta" in frame && frame.device === "dev-b"),
      5_000,
    );
    const sent = (): unknown[] =>
      taps
        .filter((entry) => entry.kind === "delta" && isChange(entry.payload))
        .map((entry) => entry.payload);
    const relayedSinceReset = (): unknown[] => {
      const frames = meshFrames(onA, meshA.subId);
      const at = frames.indexOf(reset as AgentMeshFrame);
      return frames
        .slice(at + 1)
        .flatMap((frame) => ("delta" in frame && frame.device === "dev-b" ? [frame.delta] : []));
    };
    await until(() => relayedSinceReset().length >= sent().length, 5_000);
    const relayed = relayedSinceReset() as Array<{
      epoch: string;
      since: number;
      revision: number;
      upserts: Array<Record<string, unknown>>;
    }>;
    // nothing renumbered, nothing coalesced a second time: frame for frame
    expect(relayed).toEqual(sent());
    const [first] = relayed;
    expect(first).toMatchObject({
      epoch: tapped.epoch,
      since: tapped.revision,
      revision: tapped.revision + 1,
    });
    expect(first?.upserts[0]).toMatchObject({
      runtimeRunId: B.run,
      terminal: { cellBootId: "cell-dev-b-2" },
    });
    // and the heartbeats the tap hears are the owner's, never relayed to a reader
    await until(
      () => taps.some((entry) => entry.kind === "delta" && !isChange(entry.payload)),
      3 * AGENT_FIELD.MESH_HEARTBEAT_MS,
    );
    expect(
      meshFrames(onA, meshA.subId).some(
        (frame) =>
          "delta" in frame && frame.delta.upserts.length === 0 && frame.delta.removed.length === 0,
      ),
    ).toBe(false);
  }, 60_000);

  it("a link dropped mid-stream is a state change with no rows; offline is asleep; the last board stays", async () => {
    const { A, B } = await bootPair();
    const onA = await windowOn(A.daemon);
    const meshA = await openMesh(onA);
    await until(() => stateOf(meshA.open, meshFrames(onA, meshA.subId), "dev-b") === "live", 5_000);
    const heard = meshFrames(onA, meshA.subId).length;

    await B.daemon.stop(); // the peer goes away mid-stream: its door closes under A's link
    const beats = AGENT_FIELD.MESH_STALE_BEATS * AGENT_FIELD.MESH_HEARTBEAT_MS;
    await until(
      () => stateOf(meshA.open, meshFrames(onA, meshA.subId), "dev-b") === "stale",
      beats + 4_000,
    );
    // the tailnet then calls it offline: asleep, still with its board
    A.mock.meshPeers = [registryPeer("dev-b", "device-b", false)];
    A.mock.pushPeersDelta({ kind: "peerUpdated" });
    await until(
      () => stateOf(meshA.open, meshFrames(onA, meshA.subId), "dev-b") === "asleep",
      8_000,
    );

    // DS-L8 — no synthetic rows: after the drop, the only frames about B are its states
    const after = meshFrames(onA, meshA.subId)
      .slice(heard)
      .filter((frame) => frame.device === "dev-b");
    expect(after.every((frame) => "state" in frame)).toBe(true);
    expect(after.map((frame) => ("state" in frame ? frame.state : "?"))).toEqual([
      "stale",
      "asleep",
    ]);
    // the reader still holds B's last board, and a new reader is answered with it
    expect(heldRows(meshA.open, meshFrames(onA, meshA.subId), "dev-b")).toEqual([B.run]);
    const late = await openMesh(onA);
    expect(late.open.devices.find((entry) => entry.device === "dev-b")).toMatchObject({
      state: "asleep",
      snapshot: { rows: [expect.objectContaining({ runtimeRunId: B.run })] },
    });
  }, 60_000);

  it("the upstream is reference-counted: shared by two readers, closed when the last one leaves", async () => {
    const { A } = await bootPair();
    const onA = await windowOn(A.daemon);
    const first = await openMesh(onA);
    const second = await openMesh(onA);
    await until(() => stateOf(first.open, meshFrames(onA, first.subId), "dev-b") === "live", 5_000);
    expect(A.daemon.meshBoard.size).toBe(1);
    expect(A.daemon.federatedSubs.size).toBe(1);
    await onA.call("system.unsubscribe", { subId: first.subId });
    expect(A.daemon.federatedSubs.size).toBe(1);
    await onA.call("system.unsubscribe", { subId: second.subId });
    expect(A.daemon.meshBoard.size).toBe(0);
    expect(A.daemon.federatedSubs.size).toBe(0);
  }, 60_000);

  it("the door's refusals: a peer never reads the full fold or the mesh, a phone never reads the desk", async () => {
    const { A, B } = await bootPair();
    // A's daemon asking B's door, as the peer-fieldd principal it is there
    const full = await A.daemon.peers.request("dev-b", "agent.subscribe", {}).then(
      () => undefined,
      (error: { kind?: string }) => error.kind,
    );
    expect(full).toBe("FORBIDDEN_SCOPE");
    const mesh = await A.daemon.peers
      .request("dev-b", "agent.subscribe", { projection: "desk", scope: "mesh" })
      .then(
        () => undefined,
        (error: { kind?: string }) => error.kind,
      );
    expect(mesh).toBe("FORBIDDEN_SCOPE");

    // a phone on B's door: a WhoIs-verified self login, not a daemon
    const ws = new WebSocket(B.door, { headers: { "Tailscale-User-Login": TEST_LOGIN } });
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const phone = new WsRpc(ws);
    await phone.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "ios",
    });
    const desk = (await phone.callErr("agent.subscribe", { projection: "desk" })) as RpcErrorShape;
    expect(desk.data?.kind).toBe("FORBIDDEN_SCOPE");
    const field = (await phone.call("agent.subscribe", { projection: "field" })) as {
      snapshot: { epoch?: string; rows: Array<{ runtimeRunId: string }> };
    };
    expect(field.snapshot.rows.map((row) => row.runtimeRunId)).toEqual([B.run]);
    expect(field.snapshot.epoch?.startsWith(`${B.daemon.bootId}.`)).toBe(true);

    // and a window asking the mesh for the whole fold is told what the mesh is
    const onA = await windowOn(A.daemon);
    const wrong = await onA.callErr("agent.subscribe", { projection: "full", scope: "mesh" });
    expect(wrong.data?.kind).toBe("PRECONDITION_FAILED");
  }, 60_000);
});
