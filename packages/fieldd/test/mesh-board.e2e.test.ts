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
//   · the door's refusals: a peer never gets the full projection or the mesh.
// PG-2 (2026-10-31): the board here is the model's `remote` cut (the `desk` cut
// before it), so each row is the owner's model row and its joins, a bare
// terminal's among them, and a run's row arrives once its owner's backend has
// assembled it; the phone reads it at its home at its own floor.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_FIELD,
  AGENT_SESSION_RECORD_FORMAT,
  type AgentRemoteMeshFrame as AgentMeshFrame,
  type AgentRemoteMeshOpen as AgentMeshOpen,
  AgentModelDeskRow,
  AgentModelMeshOpen,
  AgentRemoteRow,
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
 * WhoIs login is injected — with (D1, 2026-10-01) the DIALLING node's id,
 * which the other desktop's registry row correlates to this desktop's slice:
 * the peer kind is the transport's to give. `routes` resolves lazily: the
 * doors exist only once both daemons are up. */
function sidecar(routes: Record<string, () => string>, node: string): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const host = Object.keys(routes).find((name) => url.includes(name));
      const target = host === undefined ? "ws://127.0.0.1:1/" : (routes[host]?.() ?? "");
      super(url.includes(".ts.net") ? target : url, {
        headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": node },
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
    peerWebSocket: sidecar({ [`${peer.host}.tailnet.ts.net`]: route }, `node-${deviceId}`),
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

/** A phone on a desktop's tailnet door: a WhoIs-verified self login, not a daemon. */
async function phoneOn(door: string): Promise<WsRpc> {
  const ws = new WebSocket(door, { headers: { "Tailscale-User-Login": TEST_LOGIN } });
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
  return phone;
}

/** The mesh frames a reader has heard for one subscription, in order. */
function meshFrames(rpc: WsRpc, subId: string): AgentMeshFrame[] {
  return rpc.notifications
    .filter((note) => note.method === "agent.delta" && note.params.subId === subId)
    .map((note) => note.params.payload as AgentMeshFrame);
}

async function openMesh(rpc: WsRpc): Promise<{ subId: string; open: AgentMeshOpen }> {
  const answer = (await rpc.call("agent.subscribe", { projection: "remote", scope: "mesh" })) as {
    subId: string;
    snapshot: AgentMeshOpen;
  };
  return { subId: answer.subId, open: answer.snapshot };
}

/** The board a reader holds for one device, folding the open and its frames. */
function heldBoard(
  open: AgentMeshOpen,
  frames: AgentMeshFrame[],
  device: string,
): Map<string, AgentRemoteRow> {
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
  return rows;
}

/** The keys of the rows a reader holds for one device, sorted. */
function heldRows(open: AgentMeshOpen, frames: AgentMeshFrame[], device: string): string[] {
  return [...heldBoard(open, frames, device).keys()].sort();
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
    // this desktop's own board is in the open itself, first and live; its run's
    // row is there once its backend has assembled it, beside its bare terminal
    expect(meshA.open.devices[0]).toMatchObject({ device: "dev-a", state: "live" });
    await until(
      () => heldRows(meshA.open, meshFrames(onA, meshA.subId), "dev-a").includes(A.run),
      3 * beat,
    );
    expect(heldRows(meshA.open, meshFrames(onA, meshA.subId), "dev-a")).toEqual(
      [A.run, A.pane].sort(),
    );
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
    await until(
      () => heldRows(meshB.open, meshFrames(onB, meshB.subId), "dev-b").includes(B.run),
      3 * beat,
    );
    // the remote row is the owner's model row and its joins, nothing of the
    // fold's beside it — and here, where the run has no reply or cost, nothing
    // invented for it
    const bRow = AgentRemoteRow.parse(
      heldBoard(meshA.open, meshFrames(onA, meshA.subId), "dev-b").get(B.run),
    );
    expect(bRow).toMatchObject({
      runtimeRunId: B.run,
      device: "dev-b",
      nativeSessionId: `${B.run}-native`,
      monitorRow: { kind: "agent", alive: false, tier: "managed", device: { id: "dev-b" } },
    });
    for (const key of ["monitor", "tier", "label", "status", "local"])
      expect(bRow, key).not.toHaveProperty(key);
    expect(bRow.monitorRow).not.toHaveProperty("reply");
    expect(bRow.monitorRow).not.toHaveProperty("cost");
  }, 60_000);

  it("the owner's chain passes through unchanged: a tap on the same upstream sees the frames the reader is relayed", async () => {
    const { A, B } = await bootPair();
    const onA = await windowOn(A.daemon);
    const meshA = await openMesh(onA);
    await until(
      () => heldRows(meshA.open, meshFrames(onA, meshA.subId), "dev-b").includes(B.run),
      5_000,
    );

    // THE TAP: the federated manager shares one upstream per {device, method,
    // params}; attaching with the board's own params re-snapshots it, and from
    // here the tap and the reader hear the SAME frames from B
    const taps: Array<{ payload: unknown; kind: string | undefined }> = [];
    const tap = await A.daemon.federatedSubs.attach(
      "dev-b",
      "agent.subscribe",
      {
        projection: "remote",
        minIntervalMs: AGENT_FIELD.REMOTE_MIN_INTERVAL_MS,
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
    expect(first?.upserts.find((row) => row["runtimeRunId"] === B.run)).toMatchObject({
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
    await until(
      () => heldRows(meshA.open, meshFrames(onA, meshA.subId), "dev-b").includes(B.run),
      5_000,
    );
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
    expect(heldRows(meshA.open, meshFrames(onA, meshA.subId), "dev-b")).toEqual(
      [B.run, B.pane].sort(),
    );
    const late = await openMesh(onA);
    expect(late.open.devices.find((entry) => entry.device === "dev-b")).toMatchObject({
      state: "asleep",
      snapshot: {
        rows: expect.arrayContaining([expect.objectContaining({ runtimeRunId: B.run })]),
      },
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

  it("the door's refusals: a peer never reads the full fold or the mesh; a phone reads the remote cut, and nobody the retired desk", async () => {
    const { A, B } = await bootPair();
    // A's daemon asking B's door, as the peer-fieldd principal it is there
    const full = await A.daemon.peers.request("dev-b", "agent.subscribe", {}).then(
      () => undefined,
      (error: { kind?: string }) => error.kind,
    );
    expect(full).toBe("FORBIDDEN_SCOPE");
    const mesh = await A.daemon.peers
      .request("dev-b", "agent.subscribe", { projection: "remote", scope: "mesh" })
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
    // PG-2 — `desk` retired into `remote`: an ask for it is malformed now
    const desk = (await phone.callErr("agent.subscribe", { projection: "desk" })) as RpcErrorShape;
    expect(desk.data?.kind).toBe("PRECONDITION_FAILED");
    // the remote cut is the phone's Godview (SP-L4 as amended): the owner's model rows, cut for it
    const remote = (await phone.call("agent.subscribe", { projection: "remote" })) as {
      snapshot: { epoch?: string; rows: unknown[] };
    };
    expect(remote.snapshot.epoch?.startsWith(`${B.daemon.bootId}.`)).toBe(true);
    for (const row of remote.snapshot.rows) {
      const parsed = AgentRemoteRow.parse(row);
      expect(parsed, parsed.runtimeRunId).not.toHaveProperty("local");
      expect(parsed.monitorRow.project.seq, parsed.runtimeRunId).toBeUndefined();
    }
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

  // S2 (the landing review, 2026-10-01) — the desk-to-phone refusal held at the
  // door the phone dialled and not past it: routed `{device: "dev-b"}`, A
  // forwarded the ask whole, B saw A's `peer-fieldd` (which may read the desk)
  // and served the reply line, the blocker's question and the cost to a phone.
  // A judges a routed board ask for its CALLER before carrying it now. PG-2:
  // and paces it for its caller — a phone's routed remote carries the phone's
  // floor, which B would otherwise read as a peer window's.
  it("a routed board ask is judged and paced for its caller: the phone's model is refused at its home, its field and remote carried, its remote at the phone's floor", async () => {
    const { A, B } = await bootPair();
    // the phone on its HOME's door (A): a WhoIs-verified self login, not a daemon
    const ws = new WebSocket(A.door, { headers: { "Tailscale-User-Login": TEST_LOGIN } });
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

    const model = await phone.callErr("agent.subscribe", { device: "dev-b", projection: "model" });
    expect(model.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(model.data?.details).toEqual({ projection: "model" });
    // and the retired desk is malformed, whoever asks it
    const desk = await phone.callErr("agent.subscribe", { device: "dev-b", projection: "desk" });
    expect(desk.data?.kind).toBe("PRECONDITION_FAILED");
    // refused HERE: nothing was carried to B, no upstream stands for either
    expect(A.daemon.federatedSubs.size).toBe(0);

    // the content-free field is the phone's, and it is carried as before
    const field = (await phone.call("agent.subscribe", {
      device: "dev-b",
      projection: "field",
    })) as { snapshot: { epoch?: string; rows: Array<{ runtimeRunId: string }> } };
    expect(field.snapshot.rows.map((row) => row.runtimeRunId)).toEqual([B.run]);
    expect(field.snapshot.epoch?.startsWith(`${B.daemon.bootId}.`)).toBe(true);
    expect(A.daemon.federatedSubs.size).toBe(1);

    // the phone's routed remote is carried, B's own cut
    const phoneRemote = (await phone.call("agent.subscribe", {
      device: "dev-b",
      projection: "remote",
    })) as { snapshot: { epoch?: string; rows: unknown[] } };
    expect(phoneRemote.snapshot.epoch?.startsWith(`${B.daemon.bootId}.`)).toBe(true);
    for (const row of phoneRemote.snapshot.rows) AgentRemoteRow.parse(row);
    expect(A.daemon.federatedSubs.size).toBe(2);
    // a window here asks B's remote through A, and B serves it to A's daemon. It
    // is ANOTHER upstream: the phone's ask was carried at the phone's floor, the
    // window's at a window's, so the two never share one (PG-D8)
    const onA = await windowOn(A.daemon);
    const windowRemote = (await onA.call("agent.subscribe", {
      device: "dev-b",
      projection: "remote",
    })) as { snapshot: { epoch?: string; rows: unknown[] } };
    expect(windowRemote.snapshot.epoch?.startsWith(`${B.daemon.bootId}.`)).toBe(true);
    expect(A.daemon.federatedSubs.size).toBe(3);
  }, 60_000);

  // PG-2 (PG-L1, PG-D1 (a), PG-D8 (a)) — the phone's Godview door at its home:
  // every desktop's remote cut as its OWNER cut it (the home relays, DS-D4), on
  // a hub of the phone's own floor; and a window's one door, whose peers ride
  // as their remote cuts beside this desktop's model board.
  it("PG-2 — the phone's mesh door answers each desktop's remote cut as its owner cut it, on a hub at the phone's floor; a window's model door carries peers' remote rows", async () => {
    const { A, B } = await bootPair();
    const ws = new WebSocket(A.door, { headers: { "Tailscale-User-Login": TEST_LOGIN } });
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
    const answer = (await phone.call("agent.subscribe", {
      projection: "remote",
      scope: "mesh",
    })) as {
      subId: string;
      snapshot: AgentMeshOpen;
    };
    expect(answer.snapshot.devices.map((entry) => entry.device)).toEqual(["dev-a", "dev-b"]);
    await until(
      () =>
        heldRows(answer.snapshot, meshFrames(phone, answer.subId), "dev-b").includes(B.run) &&
        heldRows(answer.snapshot, meshFrames(phone, answer.subId), "dev-a").includes(A.run),
      5_000,
    );
    for (const device of ["dev-a", "dev-b"]) {
      for (const row of heldBoard(
        answer.snapshot,
        meshFrames(phone, answer.subId),
        device,
      ).values()) {
        const parsed = AgentRemoteRow.parse(row);
        for (const key of ["label", "status", "blockers", "local"])
          expect(parsed, `${device}/${parsed.runtimeRunId}`).not.toHaveProperty(key);
        // EL7 B1 — no path reaches the phone: a bare terminal's directory is its folder
        expect(JSON.stringify(parsed), parsed.runtimeRunId).not.toContain('"/repo');
      }
    }
    // the phone's hub stands at its own floor: a window's remote mesh is another hub
    expect(A.daemon.meshBoard.size).toBe(1);
    const onA = await windowOn(A.daemon);
    await openMesh(onA);
    expect(A.daemon.meshBoard.size).toBe(2);
    // the window's own door: its model board first, then B's remote cut beside it
    const model = (await onA.call("agent.subscribe", { projection: "model", scope: "mesh" })) as {
      subId: string;
      snapshot: unknown;
    };
    const open = AgentModelMeshOpen.parse(model.snapshot);
    const own = open.devices[0]?.snapshot?.rows.find((row) => row.runtimeRunId === A.run);
    expect(AgentModelDeskRow.parse(own).local?.nativeSessionId).toBe(`${A.run}-native`);
    // a peer's board on the window's door folds as the phone's does: remote rows
    const peerBoard = () =>
      heldBoard(model.snapshot as AgentMeshOpen, meshFrames(onA, model.subId), "dev-b");
    await until(() => peerBoard().has(B.run), 5_000);
    const bRow = peerBoard().get(B.run);
    expect(AgentRemoteRow.parse(bRow)).not.toHaveProperty("label");
    expect(AgentModelDeskRow.safeParse(bRow).success).toBe(false);
  }, 60_000);

  // PG-3b (PG-D6 (a), J2 (a) 2026-11-01) — the phone is a screen of the desktop that owns the row: its report is
  // routed by `device` through its home, carried only while it holds the home's `{remote, mesh}` board, and kept on
  // the owner as a screen of its own under the home's peer connection; the board's close takes it away.
  it("PG-3b — the phone's report reaches the owner through its home, only while it holds the home's mesh board", async () => {
    const { A, B } = await bootPair();
    const phone = await phoneOn(A.door);
    const mesh = await openMesh(phone);
    await until(
      () => heldBoard(mesh.open, meshFrames(phone, mesh.subId), "dev-b").has(B.run),
      5_000,
    );
    const shown = heldBoard(mesh.open, meshFrames(phone, mesh.subId), "dev-b").get(B.run);
    const id = AgentRemoteRow.parse(shown).monitorRow.id;
    // routed by the row's device through the home: carried, and B keeps it as the phone's own screen
    expect(await phone.call("agent.reportShown", { ids: [id], device: "dev-b" })).toEqual({
      reported: true,
    });
    expect(B.daemon.agentScreens.size.carried).toBe(1);
    // the home's own rows: routed to itself, served by its own screen (the remote board is one)
    expect(await phone.call("agent.reportShown", { ids: [A.pane], device: "dev-a" })).toEqual({
      reported: true,
    });
    expect(A.daemon.agentScreens.size.carried).toBe(0);
    // a second reader behind the same home is a second screen, never the first one's
    const ipad = await phoneOn(A.door);
    const ipadMesh = await openMesh(ipad);
    expect(await ipad.call("agent.reportShown", { ids: [], device: "dev-b" })).toEqual({
      reported: true,
    });
    expect(B.daemon.agentScreens.size.carried).toBe(1);
    // a reader with no board at the home is refused there, and nothing reaches B
    const bare = await phoneOn(A.door);
    const refused = await bare.callErr("agent.reportShown", { ids: [id], device: "dev-b" });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(refused.data?.details).toEqual({ state: "no-screen" });
    expect(B.daemon.agentScreens.size.carried).toBe(1);
    // the phone's board closes: the home sends B the empty report, and B's screen for it goes
    await phone.call("system.unsubscribe", { subId: mesh.subId });
    await until(() => B.daemon.agentScreens.size.carried === 0, 5_000);
    const after = await phone.callErr("agent.reportShown", { ids: [id], device: "dev-b" });
    expect(after.data?.details).toEqual({ state: "no-screen" });
    await ipad.call("system.unsubscribe", { subId: ipadMesh.subId });
  }, 60_000);
});
