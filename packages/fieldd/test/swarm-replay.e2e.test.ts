// PG-9 S4c — the debug swarm through the REAL door: one fieldd booted on a recorded synthetic corpus
// (`FielddConfig.debugSwarmCorpus`, bin.ts's FIELDD_DEBUG_SWARM_CORPUS) serves its runs to a phone on
// its tailnet door through `agent.subscribe {projection: "remote", scope: "mesh"}` — the bytes James's
// device run (M1) measures are this daemon's own, the ProductApi's cap and the tailnet door's gates
// included. Real: fieldd, its door, its monitor backend, its mesh board and remote cut. Scripted: the
// floor (the mock mgmt server, an empty inventory) and the tailnet (the sidecar's login header).
//
// What it witnesses:
//   · the phone's open holds this desktop live with every run the corpus plays, each stamped as THIS
//     desktop's (its device id, never the corpus's `desk-here`);
//   · the corpus plays ONCE and its last frame is held (VF-PM 06:42Z): past the corpus's span the phone
//     holds every run as the last frame left it — its status, its token count — and still does a span
//     later (a looping swarm would have moved on: an idle row needs a quiet one);
//   · the swarm stands BESIDE the agent runtime, never in it: the runtime's own fold stays empty;
//   · this desktop's window reads the same swarm on its model board;
//   · the replay keeps no picture: `agent.lastRun` answers none, and the last run's file a previous boot
//     left is never read as this boot's nor written over.
//
// The corpus is field-app's in-repo n10-2s-s1: a FILE read here, not a module imported (fieldd imports
// nothing of field-app's). Kept where the generator's own tests keep it, so a corpus format change
// reddens this row rather than a stale copy under fieldd.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";
import {
  type AgentRemoteMeshFrame,
  type AgentRemoteMeshOpen,
  AgentRemoteRow,
  CONTRACTS_VERSION,
  LAYOUT,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const CORPUS = join(
  import.meta.dirname,
  "..",
  "..",
  "field-app",
  "test",
  "fixtures",
  "godview-corpora",
  "n10-2s-s1.jsonl.gz",
);
/** this desktop: the mock floor's mesh identity */
const DEVICE = "dev-swarm";

const ENDPOINTS = {
  controlSocket: "/mock/native/run/termctl.sock",
  frameSocket: "/mock/native/run/termframe.sock",
  authToken: "mock-per-boot-token",
};

/** The picture a previous boot left in AGENT_LAST_BOARD_FILE: an agent and a bare shell whose
 * sessions this boot's (empty) floor does not hold — a keeper would offer both as left. */
const PICTURE = `${JSON.stringify({
  v: 1,
  asOf: "2026-11-04T18:00:00.000Z",
  board: {
    revision: 7,
    rows: (
      JSON.parse(
        readFileSync(
          join(
            import.meta.dirname,
            "..",
            "..",
            "contracts",
            "fixtures",
            "agent-last-run.left.json",
          ),
          "utf8",
        ),
      ) as { board: { rows: unknown[] } }
    ).board.rows,
  },
})}\n`;

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

/** The runs the corpus's first fold frame names, read off the file itself. */
function corpusRuns(): string[] {
  const text = gunzipSync(readFileSync(CORPUS)).toString("utf8");
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const value = JSON.parse(line) as { kind?: string; rows?: Array<{ runtimeRunId: string }> };
    if (value.kind === "fold") return (value.rows ?? []).map((row) => row.runtimeRunId).sort();
  }
  return [];
}

/** What the corpus's LAST fold frame leaves each run at, read off the file itself: its status and
 * its cumulative token count (the model row's `tokens.total`; a working run's moves every frame). */
function corpusLastFrame(): Map<string, { status: string; tokens: number }> {
  const text = gunzipSync(readFileSync(CORPUS)).toString("utf8");
  let last: { t: number; rows: Array<Record<string, unknown>> } | undefined;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const value = JSON.parse(line) as {
      kind?: string;
      t?: number;
      rows?: Array<Record<string, unknown>>;
    };
    if (value.kind !== "fold" || value.t === undefined || value.rows === undefined) continue;
    if (last === undefined || value.t >= last.t) last = { t: value.t, rows: value.rows };
  }
  const runs = new Map<string, { status: string; tokens: number }>();
  for (const row of last?.rows ?? []) {
    const mirror = row["monitor"] as { status: string; usage: { cumulativeTokens: number } };
    runs.set(row["runtimeRunId"] as string, {
      status: mirror.status,
      tokens: mirror.usage.cumulativeTokens,
    });
  }
  return runs;
}

interface SwarmDesktop {
  daemon: FielddDaemon;
  dataDir: string;
  /** the product door as the sidecar forwards a tailnet caller to it */
  door: string;
}

async function bootSwarmDesktop(): Promise<SwarmDesktop> {
  expect(existsSync(CORPUS), `the in-repo corpus ${CORPUS}`).toBe(true);
  const dataDir = mkdtempSync(join(tmpdir(), "vf-s4c-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  const picture = join(dataDir, ...LAYOUT.AGENT_LAST_BOARD_FILE);
  mkdirSync(dirname(picture), { recursive: true });
  writeFileSync(picture, PICTURE);

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.meshDeviceId = DEVICE;
  mock.helloTerminal = ENDPOINTS;
  mock.helloTerminalMesh = true;
  mock.observedState = { generation: 0, bootId: "mock-boot", terminals: [], workers: [] };
  await mock.start();
  cleanup.push(() => mock.stop());

  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    agentGateway: { enabled: false },
    debugSwarmCorpus: CORPUS,
  });
  cleanup.push(() => daemon.stop());
  await until(
    () =>
      daemon
        .health()
        .mesh.serves.some((serve) => serve.name === "product" && serve.url !== undefined),
    8_000,
    "the product serve is declared",
  );
  return {
    daemon,
    dataDir,
    door: `ws://127.0.0.1:${daemon.controlPort}/t/${productPathSecret(mock)}`,
  };
}

/** A phone on the tailnet door: a WhoIs-verified self login, not a daemon. */
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

/** A window on the loopback door, with a token that may observe agents. */
async function windowOn(daemon: FielddDaemon): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.tokens.mint(["agent.observe"], "s4c-window").token);
  return rpc;
}

/** Polls until `fn` holds or `ms` passes; the caller asserts on what stands then. */
async function settle(fn: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function meshFrames(rpc: WsRpc, subId: string): AgentRemoteMeshFrame[] {
  return rpc.notifications
    .filter((note) => note.method === "agent.delta" && note.params.subId === subId)
    .map((note) => note.params.payload as AgentRemoteMeshFrame);
}

/** The board a reader holds for one device: the open, then its frames folded in. */
function heldBoard(
  open: AgentRemoteMeshOpen,
  frames: readonly AgentRemoteMeshFrame[],
  device: string,
): Map<string, unknown> {
  let rows = new Map<string, unknown>(
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

describe("PG-9 S4c — a dev desktop's fieldd plays a recorded swarm through the real door", () => {
  it("serves the corpus's runs to a tailnet phone through {remote, mesh}: this desktop's, live, played once and then held at the last frame — and the agent runtime's own fold untouched", async () => {
    const { daemon, door } = await bootSwarmDesktop();
    const runs = corpusRuns();
    expect(runs, "the corpus's runs").toHaveLength(10);
    const phone = await phoneOn(door);
    const { subId, snapshot: open } = (await phone.call("agent.subscribe", {
      projection: "remote",
      scope: "mesh",
    })) as { subId: string; snapshot: AgentRemoteMeshOpen };
    expect(open.devices[0]).toMatchObject({ device: DEVICE, state: "live" });
    const held = () => [...heldBoard(open, meshFrames(phone, subId), DEVICE).keys()].sort();
    await settle(() => held().length === runs.length, 6_000);
    expect(held()).toEqual(runs);
    for (const row of heldBoard(open, meshFrames(phone, subId), DEVICE).values()) {
      const parsed = AgentRemoteRow.parse(row);
      expect(parsed.device, parsed.runtimeRunId).toBe(DEVICE);
      expect(parsed.monitorRow, parsed.runtimeRunId).toMatchObject({
        kind: "agent",
        alive: true,
        device: { id: DEVICE },
      });
    }
    // ONE pass, then the hold: past the corpus's span (2 s from the replay's start at boot) the phone
    // holds every run as the corpus's last frame left it, and a span and a half later still does — a
    // looping swarm's working runs would have reset their token counts and climbed again
    const last = Object.fromEntries(corpusLastFrame());
    const heldState = () =>
      Object.fromEntries(
        [...heldBoard(open, meshFrames(phone, subId), DEVICE)].map(([run, row]) => {
          const model = (row as { monitorRow: { status?: string; tokens?: { total?: number } } })
            .monitorRow;
          return [run, { status: model.status, tokens: model.tokens?.total }];
        }),
      );
    await settle(() => isDeepStrictEqual(heldState(), last), 8_000);
    expect(heldState(), "the corpus's last frame, held").toEqual(last);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(heldState(), "still the last frame, a span and a half later").toEqual(last);
    // beside the runtime, never in it
    expect(daemon.agents.list().sessions).toEqual([]);
  }, 60_000);

  it("this desktop's window reads the same swarm on its model board, and the replay keeps no picture: agent.lastRun answers none, the last run's file is left byte for byte", async () => {
    const { daemon, dataDir } = await bootSwarmDesktop();
    const runs = corpusRuns();
    const window = await windowOn(daemon);
    const sub = (await window.call("agent.subscribe", { projection: "model" })) as {
      subId: string;
      snapshot: { rows: Array<{ runtimeRunId: string }> };
    };
    const held = (): string[] => {
      const rows = new Set(sub.snapshot.rows.map((row) => row.runtimeRunId));
      for (const note of window.notifications) {
        if (note.method !== "agent.delta" || note.params.subId !== sub.subId) continue;
        const payload = note.params.payload as {
          upserts?: Array<{ runtimeRunId: string }>;
          removed?: string[];
        };
        for (const row of payload.upserts ?? []) rows.add(row.runtimeRunId);
        for (const id of payload.removed ?? []) rows.delete(id);
      }
      return [...rows].sort();
    };
    await settle(() => held().length === runs.length, 6_000);
    expect(held(), "the window's model board holds the corpus's runs").toEqual(runs);

    expect(await window.call("agent.lastRun", {})).toEqual({ state: "none" });
    await daemon.stop();
    expect(readFileSync(join(dataDir, ...LAYOUT.AGENT_LAST_BOARD_FILE), "utf8")).toBe(PICTURE);
  }, 60_000);
});
