// SP-7a (`SP-7a-plan.md` §3 "the e2e"; D1–D3) end to end: TWO REAL fieldd daemons. The phone homes to desktop A and
// reads a spark desktop B keeps. The phone calls `compose.sparks.transcript.openTicket {spark, device: "dev-b"}` on
// A's tailnet door; A carries it whole over PeerLink (F1b's sidecar-simulating ws-ctor, which injects A's node id, so
// B's roster makes A a `peer-fieldd`), naming the phone by the device A's roster correlates its node to; B mints the
// phone a single-use ticket beside its transcript worker's ROUTED SERVE, and the answer comes back through A
// untouched. The test then stands in for the phone's node: it dials the answered serve, mapped onto B's worker (the
// mock floor declares the serve but runs no tailnet listener), with no Origin, and reads the run's lines. A window on
// A asking for B's spark, and A's daemon on its own account, are refused.
//
// What is NOT here: the phone's own node dialling the tailnet (the kit's W1, `SparkTranscriptLiveTests`, against the
// real worker), and W2's byte count (`SP7A_BYTES`).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  LAYOUT,
  SOCKETS,
  type SparkRecord,
  SparkTranscriptOpenTicketResult,
  SparkTranscriptServerFrame,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { SparkTranscripts } from "../src/spark-transcripts";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { SparkStore } from "../src/tool-plane/sparks";
import type { TranscriptHostLaunch } from "../src/transcripts/launch";
import { TRANSCRIPT_SERVE_ID } from "../src/transcripts/serve";
import { productDoorPath, productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { transcriptHostLaunch } from "./transcript-host-bundle";
import { helloAs, until, WsRpc } from "./ws-rpc";

const VELA = "sp-7k2m9q4x";
const RUN = "run-vela-1";
const METHOD = "compose.sparks.transcript.openTicket";

let launch: TranscriptHostLaunch;
beforeAll(async () => {
  launch = await transcriptHostLaunch();
}, 60_000);

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already stopped is fine */
    }
  }
  cleanup = [];
});

function makeDataDir(): string {
  // a SHORT root: the mock mgmt socket must fit macOS's 104-byte sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-sp7a-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  writeLinkFixture(dataDir, TEST_LOGIN);
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  return dataDir;
}

/** B keeps Vela, and Vela's transcript from before this boot: a run, your words, a reply. */
function keepVela(dataDir: string): void {
  const home = mkdtempSync(join(tmpdir(), "vf-sp7a-home-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  const spark: SparkRecord = {
    format: 1,
    id: VELA,
    name: "Vela",
    face: { seed: 7 },
    agent: "scripted",
    profiles: ["native"],
    thinksUnder: "native",
    folder: home,
    createdAt: "2026-11-04T12:00:00.000Z",
    updatedAt: "2026-11-04T12:00:00.000Z",
  };
  new SparkStore({
    dir: join(dataDir, ...LAYOUT.SPARKS_DIR),
    keyPath: join(dataDir, ...LAYOUT.SPARKS_KEY_FILE),
  }).write(spark);
  const store = new SparkTranscripts({
    dir: join(dataDir, ...LAYOUT.SPARK_FILES_DIR),
    keyPath: join(dataDir, ...LAYOUT.SPARK_FILES_KEY_FILE),
  });
  store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
  store.append(VELA, RUN, { kind: "you", via: "chat", text: "carry on" });
  store.append(VELA, RUN, { kind: "reply", messageId: "m-1", text: "On it." });
}

async function startMock(dataDir: string): Promise<MockMgmtServer> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

/** The sidecar half of A's dial to B (the DS-4 harness's): B's tailnet coordinate lands on B's loopback door with the
 * route secret joined, and the WhoIs login and A's NODE id are injected, so B's roster makes A a `peer-fieldd`. */
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

/** Desktop A (the phone's home) and desktop B (the desktop that keeps Vela, its transcript worker running and its
 * routed serve declared); both rosters know the phone by its node. */
async function bootPair(): Promise<{ A: FielddDaemon; B: FielddDaemon; mockA: MockMgmtServer }> {
  const phone = registryPeer({
    nodeId: "node-phone",
    deviceId: "dev-phone",
    name: "phone",
    login: TEST_LOGIN,
  });
  const dirB = makeDataDir();
  keepVela(dirB);
  const mockB = await startMock(dirB);
  mockB.meshDeviceId = "dev-b";
  mockB.meshPeers = [
    registryPeer({ nodeId: "node-a", deviceId: "dev-a", name: "device-a", login: TEST_LOGIN }),
    phone,
  ];
  mockB.storeSlices = new Map<string, unknown>([["dev-a", desktopSlice("dev-a", "device-a")]]);
  const B = await bootstrap({
    dataDir: dirB,
    controlPort: 0,
    dataPort: 0,
    filesHost: false,
    transcriptHost: launch,
  });
  cleanup.push(() => B.stop());
  await until(() => mockB.meshServes.get("product") !== undefined, 15_000, "B's product serve");
  await until(
    () => B.transcripts.supervisor.health().phase === "ready",
    20_000,
    "B's transcript worker",
  );
  await until(
    () => mockB.meshServes.get(TRANSCRIPT_SERVE_ID) !== undefined,
    15_000,
    "B's transcript serve",
  );
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
    phone,
  ];
  const A = await bootstrap({
    dataDir: dirA,
    controlPort: 0,
    dataPort: 0,
    peerWebSocket: sidecar(() => bEndpoint),
  });
  cleanup.push(() => A.stop());
  await until(() => A.devices.get("dev-b") !== undefined, 15_000, "B in A's roster");
  await until(() => A.devices.get("dev-phone") !== undefined, 15_000, "the phone in A's roster");
  await until(() => B.devices.isDocHost("dev-a"), 15_000, "A as a desktop in B's roster");
  return { A, B, mockA };
}

/** The phone on A's product door, the way A's sidecar delivers it: the login and its node. */
async function phoneOn(daemon: FielddDaemon, mock: MockMgmtServer): Promise<WsRpc> {
  await until(() => mock.meshServes.get("product") !== undefined, 15_000, "the product serve");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
    headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-phone" },
  });
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** The phone's node reading `runs` with `ticket`, at `endpoint` mapped onto B's worker: every frame, parsed as the
 * contract (EL9), and no Origin, as a node's dial carries none. */
async function readAt(endpoint: string, ticket: string, runs: string[]) {
  const ws = new WebSocket(endpoint);
  cleanup.push(() => ws.terminate());
  const frames: SparkTranscriptServerFrame[] = [];
  ws.on("message", (data) =>
    frames.push(SparkTranscriptServerFrame.parse(JSON.parse(String(data)))),
  );
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "open", ticket, runs: runs.map((run) => ({ run })) }));
  await until(
    () => frames.some((f) => f.type === "caught-up" || f.type === "refused"),
    15_000,
    "the phone's caught-up or refused frame",
  );
  return frames;
}

describe("SP-7a — the phone's transcript ticket for another desktop's spark, asked through its home", () => {
  it("is minted by THAT desktop at its worker's routed serve, handed back through the home untouched, and reads the run", async () => {
    const { A, B, mockA } = await bootPair();
    const phone = await phoneOn(A, mockA);

    const answer = SparkTranscriptOpenTicketResult.parse(
      await phone.call(METHOD, { spark: VELA, device: "dev-b" }),
    );
    // B's routed serve as the mock floor declared it, never a loopback socket
    expect(answer.endpoint).toBe("ws://mock.ts.net:9426/transcripts");
    expect(answer.runs.map((run) => run.runtimeRunId)).toEqual([RUN]);
    expect(answer.generation).toBe(B.transcripts.supervisor.health().generation);

    // the phone's node dials the serve, which routes to B's worker on its loopback port
    const port = B.transcripts.supervisor.health().port;
    expect(port, "B's worker reports its ready port").not.toBeNull();
    const frames = await readAt(`ws://127.0.0.1:${port}/transcripts`, answer.ticket, [RUN]);
    expect(frames[0]).toMatchObject({ type: "ready" });
    expect(frames.flatMap((f) => (f.type === "line" ? [f.line.kind] : []))).toEqual([
      "run",
      "you",
      "reply",
    ]);
    // single use: the same ticket again is refused
    const again = await readAt(`ws://127.0.0.1:${port}/transcripts`, answer.ticket, [RUN]);
    expect(again.map((f) => f.type)).toEqual(["refused"]);
  }, 90_000);

  it("is refused for anyone but the phone: a window on the home, and the home's daemon on its own account", async () => {
    const { A } = await bootPair();
    const window = await openRpc(A.controlPort);
    await helloAs(window, A.tokens.mint(["sparks.use"], "sp7a-window").token);
    const fromWindow = await window.callErr(METHOD, { spark: VELA, device: "dev-b" });
    expect(fromWindow.data).toMatchObject({
      kind: "FORBIDDEN_SCOPE",
      retryable: false,
      details: { method: METHOD, principal: "local-token", device: "dev-b" },
    });
    // the home's daemon asking on its own account names no phone: the owner refuses it
    await expect(A.peers.request("dev-b", METHOD, { spark: VELA })).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
    });
  }, 90_000);
});
