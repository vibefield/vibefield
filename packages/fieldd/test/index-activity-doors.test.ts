// TL (docket v9, RULED 2026-10-09: T1, T2, T4, T5, B-D4, B-D6) — Godview's
// timeline reads the past: `index.activity` (the record's sessions in a window,
// fieldd's door) and `agent.recordedLanes` (the monitor backend's lanes over
// it, the window's door). This is T5's FLOOR: no rosetta route yet, so the
// answer is the catalog's bounds, one band per ended run.
//
// The first block is the reader and the port alone. The rest is ONE real
// daemon over the scripted rosettad (fixtures/fake-rosettad.mjs), reached by a
// window, the phone and a peer daemon; then a daemon with no rosettad at all.
// The rows: the window is the view's day (T2); a session outside it, or a
// delegated thread, is not a lane; an asleep peer is refused honestly, never an
// empty day; nothing pages a transcript (only rosetta reads them); an ended run
// is ONE active band; and a desktop with no index says so in words.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  AgentRecordedLanesResult,
  CONTRACTS_VERSION,
  createAgentCatalogReaders,
  INDEX_ACTIVITY,
  IndexActivityResult,
  type IndexCatalogSession,
  SOCKETS,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import {
  activityFromCatalog,
  activityUnreadWords,
  clipActivity,
  createActivityReader,
  monitorHistoryPort,
} from "../src/index-activity";
import { RpcCallError } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = INDEX_ACTIVITY.MAX_WINDOW_MS;
// NOW-relative: a window is read off the wall clock, so literal dates expire
const NOW = Date.now();

// ── the reader and the port ─────────────────────────────────────────────────

const catalogRow = (
  sessionId: string,
  activity: { firstAt: number; lastAt: number } | null,
  over: Partial<IndexCatalogSession> = {},
): IndexCatalogSession => ({
  device: "dev-self",
  sessionId,
  nativeSessionId: `nat-${sessionId}`,
  kind: "claude-code",
  provider: "claude",
  cwd: "/work/app",
  startedAt: activity?.firstAt ?? NOW - DAY * 2,
  activity,
  streamState: "indexed",
  ...over,
});

function fakeCatalog(rows: IndexCatalogSession[], phase = "live", ready = true) {
  return {
    ready,
    phase: phase as "live",
    sessions: { rows: () => rows } as never,
  };
}

const WINDOW = { sinceMs: NOW - DAY, untilMs: NOW };

describe("the floor's reader: the catalog's bounds, never a transcript", () => {
  const rows = [
    catalogRow("old", { firstAt: NOW - 30 * HOUR, lastAt: NOW - 29 * HOUR }),
    catalogRow("morning", { firstAt: NOW - 8 * HOUR, lastAt: NOW - 7 * HOUR }),
    catalogRow("crossing", { firstAt: NOW - 26 * HOUR, lastAt: NOW - 20 * HOUR }),
    catalogRow("now", { firstAt: NOW - HOUR, lastAt: NOW - MIN }),
    catalogRow("never", null),
  ];

  it("answers the sessions whose recorded bounds touch the window, newest first, at fidelity bounds", () => {
    const answer = activityFromCatalog(fakeCatalog(rows), WINDOW);
    expect(answer.fidelity).toBe("bounds");
    expect(answer.partial).toBe(false);
    expect(answer.sessions.map((s) => s.sessionId)).toEqual(["now", "morning", "crossing"]);
    // a session's bounds are its WHOLE extent, never clipped to the window
    expect(answer.sessions[2]?.activity).toEqual({
      firstAt: NOW - 26 * HOUR,
      lastAt: NOW - 20 * HOUR,
    });
    expect(answer.sessions.every((s) => s.turns === undefined)).toBe(true);
    expect(IndexActivityResult.safeParse(answer).success).toBe(true);
    // narrowed to named sessions
    const named = activityFromCatalog(fakeCatalog(rows), {
      ...WINDOW,
      sessions: ["morning", "old"],
    });
    expect(named.sessions.map((s) => s.sessionId)).toEqual(["morning"]);
  });

  it("says partial while the stream is down (the tables are the last snapshot), and refuses before the first", () => {
    const stale = activityFromCatalog(fakeCatalog(rows, "stale"), WINDOW);
    expect(stale.partial).toBe(true);
    expect(stale.detail).toMatch(/stream is down/);
    let refused: unknown;
    try {
      activityFromCatalog(fakeCatalog(rows, "connecting", false), WINDOW);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(RpcCallError);
    expect(refused).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "index", state: "connecting" },
    });
  });

  it("clips for a tailnet caller and says so; a window's answer is whole", () => {
    const answer = activityFromCatalog(fakeCatalog(rows), WINDOW);
    expect(clipActivity(answer, undefined)).toBe(answer);
    const clipped = clipActivity(answer, 2);
    expect(clipped.sessions).toHaveLength(2);
    expect(clipped.clipped).toBe(true);
    expect(clipActivity(answer, 5).clipped).toBe(false);
  });

  it("the history port hands the backend the record in its words, skipping what it cannot draw", async () => {
    const catalog = createAgentCatalogReaders(AGENT_CATALOG);
    const port = monitorHistoryPort(
      createActivityReader({
        catalog: fakeCatalog([
          ...rows,
          catalogRow(
            "unmapped",
            { firstAt: NOW - HOUR, lastAt: NOW - MIN },
            {
              kind: "no-catalog-row",
              provider: undefined,
            },
          ),
        ]),
      }),
      catalog,
    );
    const answer = await port.read(WINDOW, { silenceMs: INDEX_ACTIVITY.SILENCE_MS });
    expect(answer.fidelity).toBe("bounds");
    expect(answer.sessions.map((s) => s.nativeSessionId)).toEqual([
      "nat-now",
      "nat-morning",
      "nat-crossing",
    ]);
    expect(answer.sessions[0]).toEqual({
      provider: { id: "claude", label: catalog.entry("claude")!.label },
      nativeSessionId: "nat-now",
      startedAt: NOW - HOUR,
      firstAt: NOW - HOUR,
      lastAt: NOW - MIN,
      projectKey: "/work/app",
    });
  });

  it("a refusal reaches the backend as a person's sentence, never a daemon's name or an env var", async () => {
    const catalog = createAgentCatalogReaders(AGENT_CATALOG);
    for (const [phase, words] of [
      ["unconfigured", "No agent index runs on this desktop"],
      ["connecting", "The agent index is starting"],
      ["refused", "The agent index cannot be read"],
    ] as const) {
      const port = monitorHistoryPort(
        createActivityReader({ catalog: fakeCatalog([], phase, false) }),
        catalog,
      );
      await expect(port.read(WINDOW, { silenceMs: INDEX_ACTIVITY.SILENCE_MS })).rejects.toThrow(
        words,
      );
      expect(activityUnreadWords(phase)).toBe(words);
      expect(words).not.toMatch(/rosettad|FIELDD_/);
    }
  });
});

// ── the doors, on a real daemon ─────────────────────────────────────────────

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");

/** rosetta's SessionRow, as the scripted daemon serves it */
const sessionRow = (
  id: string,
  activity: { first_at: number; last_at: number } | null,
  over: Record<string, unknown> = {},
) => ({
  id,
  native_session_id: `nat-${id}`,
  root_session_id: id,
  parent_session_id: null,
  runtime_id: "rt-claude",
  project_id: "p-app",
  cwd: "/work/app",
  title: `title ${id}`,
  summary: null,
  started_at: activity?.first_at ?? 1_000,
  updated_at: activity?.last_at ?? 2_000,
  activity,
  stream_state: "indexed",
  role: "main",
  delegation: null,
  ...over,
});

const SESSIONS = [
  sessionRow("today", { first_at: NOW - 3 * HOUR, last_at: NOW - 2 * HOUR }),
  sessionRow("late", { first_at: NOW - 50 * MIN, last_at: NOW - 10 * MIN }),
  sessionRow("yesterday", { first_at: NOW - 30 * HOUR, last_at: NOW - 29 * HOUR }),
  // a delegated thread: transcript structure, never a lane of its own
  sessionRow(
    "thread",
    { first_at: NOW - 3 * HOUR, last_at: NOW - 2 * HOUR },
    { parent_session_id: "today", root_session_id: "today", role: "subagent" },
  ),
];

let cleanup: Array<() => void | Promise<void>> = [];

/** The peer link's dialer: this world has one desktop awake, so nothing answers. */
class Unreachable extends WebSocket {
  constructor(_url: string) {
    super("ws://127.0.0.1:1/");
  }
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

interface World {
  daemon: FielddDaemon;
  asked(): string[];
  window: WsRpc;
  phone: WsRpc;
  peer: WsRpc;
}
let world: World;

async function tailnet(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  headers: Record<string, string>,
  clientKind: "ios" | "peer-fieldd",
): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, headers);
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    ...(clientKind === "peer-fieldd" ? { deviceId: "dev-c" } : {}),
  });
  return rpc;
}

beforeAll(async () => {
  // a SHORT root: the mock mgmt socket must stay inside macOS's sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-act-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir, TEST_LOGIN);
  const files = {
    sessions: join(dataDir, "sessions.json"),
    projects: join(dataDir, "projects.json"),
    runtimes: join(dataDir, "runtimes.json"),
    log: join(dataDir, "requests.log"),
  };
  writeFileSync(files.sessions, JSON.stringify(SESSIONS));
  writeFileSync(
    files.projects,
    JSON.stringify([{ id: "p-app", name: "app", root_paths: ["/work/app"], git_repo: null }]),
  );
  writeFileSync(
    files.runtimes,
    JSON.stringify([
      { id: "rt-claude", kind: "claude-code", data_root: "~/.claude", enabled: true },
    ]),
  );
  writeFileSync(files.log, "");

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  // the roster vouches for a peer desktop that is asleep (its link never opens)
  mock.meshPeers = [
    registryPeer({ nodeId: "node-c", deviceId: "dev-c", name: "device-c", login: TEST_LOGIN }),
  ];
  mock.storeSlices = new Map<string, unknown>([["dev-c", desktopSlice("dev-c", "device-c")]]);
  await mock.start();
  cleanup.push(() => mock.stop());

  const env = {
    FAKE_ROSETTAD_MODE: "ok",
    FAKE_ROSETTAD_SESSIONS: files.sessions,
    FAKE_ROSETTAD_PROJECTS: files.projects,
    FAKE_ROSETTAD_RUNTIMES: files.runtimes,
    FAKE_ROSETTAD_REQUEST_LOG: files.log,
  };
  const fakeSpawner = ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: { ...process.env, ...env },
    })) as unknown as typeof spawn;
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    peerWebSocket: Unreachable as unknown as WsCtor,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner,
    rosettadHome: home,
    indexCatalog: { batchMs: 20, digestIntervalMs: 300 },
  });
  cleanup.push(() => daemon.stop());

  await until(() => daemon.health().rosettad.phase === "ready", 15_000);
  await until(() => daemon.indexCatalog.ready, 30_000);
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  await until(() => daemon.devices.currentDeviceId() === mock.meshDeviceId, 15_000);
  await until(() => daemon.devices.isDocHost("dev-c"), 15_000);

  const window = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(window, daemon.tokens.mint(["index.read", "index.search"], "act-window").token);
  world = {
    daemon,
    asked: () =>
      readFileSync(files.log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.slice(line.indexOf(" ") + 1)),
    window,
    phone: await tailnet(daemon, mock, { "Tailscale-User-Login": TEST_LOGIN }, "ios"),
    peer: await tailnet(
      daemon,
      mock,
      { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-c" },
      "peer-fieldd",
    ),
  };
}, 90_000);

afterAll(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
}, 30_000);

const day = () => ({ sinceMs: Date.now() - DAY, untilMs: Date.now() });

describe("index.activity — the record's sessions in the view's day (T5's floor)", () => {
  it("answers today's top-level sessions by their bounds, and never reads a transcript to do it", async () => {
    const answer = IndexActivityResult.parse(await world.window.call("index.activity", day()));
    expect(answer.fidelity).toBe("bounds");
    expect(answer.partial).toBe(false);
    expect(answer.sessions.map((s) => s.sessionId)).toEqual(["late", "today"]);
    expect(answer.sessions[1]).toMatchObject({
      nativeSessionId: "nat-today",
      kind: "claude-code",
      provider: "claude",
      cwd: "/work/app",
      activity: { firstAt: NOW - 3 * HOUR, lastAt: NOW - 2 * HOUR },
    });
    // only rosetta reads transcripts: no timeline page, no session read
    expect(world.asked().filter((url) => url.includes("/timeline"))).toEqual([]);
  });

  it("is the view's day and no more; a bad ask is the caller's", async () => {
    const now = Date.now();
    for (const ask of [
      { sinceMs: now - DAY - 1, untilMs: now },
      { sinceMs: now, untilMs: now },
      { untilMs: now },
      { sinceMs: now - HOUR, untilMs: now, silenceMs: 1 },
    ]) {
      const refused = await world.window.callErr("index.activity", ask);
      expect(refused.data?.kind, JSON.stringify(ask)).toBe("PRECONDITION_FAILED");
    }
  });

  it("a peer asleep is refused honestly — never an empty day", async () => {
    // the forwarder dials the asleep desktop and gives up at its own deadline
    // (FORWARDING.FORWARD_TIMEOUT_MS): the refusal names the peer link
    const refused = await world.window.callErr("index.activity", { ...day(), device: "dev-c" });
    expect(refused.data).toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "peer-link", device: "dev-c" },
    });
  }, 30_000);

  it("the phone reads it (its own preset carries the scope); a peer daemon is answered from this desktop's record", async () => {
    const phone = IndexActivityResult.parse(await world.phone.call("index.activity", day()));
    expect(phone.sessions.map((s) => s.sessionId)).toEqual(["late", "today"]);
    expect(phone.clipped).toBe(false);
    const peer = IndexActivityResult.parse(await world.peer.call("index.activity", day()));
    expect(peer.sessions.map((s) => s.sessionId)).toEqual(["late", "today"]);
  });
});

describe("agent.recordedLanes — the backend's lanes over the record (B-D6 (a))", () => {
  it("draws each ended run as ONE active band from its first to its last activity, in birth order", async () => {
    const past = AgentRecordedLanesResult.parse(
      await world.window.call("agent.recordedLanes", day()),
    );
    expect(past.fidelity).toBe("bounds");
    expect(past.state).toBe("complete");
    // the floor: no live row's past (it keeps the hatch until turns arrive)
    expect(past.live).toEqual([]);
    expect(past.ended.map((lane) => lane.id)).toEqual([
      "past:claude:nat-today",
      "past:claude:nat-late",
    ]);
    const [today] = past.ended;
    expect(today).toMatchObject({
      provider: { id: "claude" },
      project: { name: "app" },
      startedAt: NOW - 3 * HOUR,
      endedAt: NOW - 2 * HOUR,
      spans: [{ kind: "active", from: NOW - 3 * HOUR, to: NOW - 2 * HOUR }],
    });
    // the window's own desktop dealt the colour; `self` is the reader's to say
    expect(typeof today?.project.seq).toBe("number");
    expect(today?.device).not.toHaveProperty("self");
    expect(today?.device.id).toBe(world.daemon.devices.currentDeviceId());
    expect(world.asked().filter((url) => url.includes("/timeline"))).toEqual([]);
  });

  it("a peer reads no colour sequence (M16); a bad window is the caller's", async () => {
    const past = AgentRecordedLanesResult.parse(
      await world.peer.call("agent.recordedLanes", day()),
    );
    expect(past.ended.length).toBe(2);
    for (const lane of past.ended) expect(lane.project).not.toHaveProperty("seq");
    const now = Date.now();
    const refused = await world.window.callErr("agent.recordedLanes", {
      sinceMs: now - DAY - 1,
      untilMs: now,
    });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
  });
});

describe("a desktop with no agent index", () => {
  it("refuses index.activity UNAVAILABLE and answers the lanes' past unavailable, in a person's words", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-act0-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    writeLinkFixture(dataDir, TEST_LOGIN);
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    await until(() => daemon.devices.currentDeviceId() === mock.meshDeviceId, 15_000);
    const window = await open(`ws://127.0.0.1:${daemon.controlPort}`);
    await helloAs(window, daemon.tokens.mint(["index.search"], "act0-window").token);
    const refused = await window.callErr("index.activity", day());
    expect(refused.data).toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "index", state: "unconfigured" },
    });
    // the monitor is built with the device roster, which the wait above saw
    const past = AgentRecordedLanesResult.parse(await window.call("agent.recordedLanes", day()));
    expect(past).toMatchObject({
      state: "unavailable",
      detail: "No agent index runs on this desktop",
      live: [],
      ended: [],
    });
  }, 60_000);
});
