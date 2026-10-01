// DS-6 end to end (design-06 §5 "History"; DS-D8/D9/D10): TWO REAL fieldd
// daemons, A and B, each with its own mock floor (distinct mesh identities
// dev-a / dev-b, each listing the other as a self peer of one login) and its
// own scripted rosettad (test/fixtures/fake-rosettad.mjs speaking /ws/meta as
// the pin does), joined by a sidecar-simulating ws-ctor that plays both
// sidecars: it resolves a peer's derived tailnet coordinate to that daemon's
// loopback door with the route secret joined on, and injects the WhoIs login.
// So every hop is real: A's follower reads A's rosetta stream into rows, B's
// PeerLink dials A's tailnet door as a peer-fieldd principal (granted the peer
// preset), B's replica stands on A's `index.catalog.subscribe`, and a window
// on B reads the MERGED history through B's doors.
//
// The witnesses (the wave's row for ds-f): B lists A's sessions grouped by
// family with device badges while A is up, and STILL lists them — greyed by
// `sources` — after A's daemon stops and the roster says A is away; a search
// with A asleep says `asleep` in `sources`; the same native session on both
// desktops is one row with two devices; a restarted B lists A's history from
// its persisted replica before A ever answers.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IndexProjectsResult,
  IndexSearchResult,
  IndexSessionsResult,
  SOCKETS,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

const LOGIN = "me@jamesyong42.com";
const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const untilAsync = async (fn: () => Promise<boolean>, ms: number, what: string) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** rosetta's SessionRow, as the scripted daemon serves it */
const row = (
  id: string,
  projectId: string,
  lastAt: number,
  over: Record<string, unknown> = {},
) => ({
  id,
  native_session_id: `nat-${id}`,
  root_session_id: id,
  parent_session_id: null,
  runtime_id: "rt-claude",
  project_id: projectId,
  cwd: `/work/${projectId}`,
  title: `title ${id}`,
  summary: null,
  started_at: 1_000,
  updated_at: 2_000,
  activity: { first_at: 1_000, last_at: lastAt },
  stream_state: "indexed",
  role: "primary",
  delegation: null,
  ...over,
});

const RUNTIMES = [{ id: "rt-claude", kind: "claude-code", data_root: "~/.claude", enabled: true }];

interface DeskScript {
  sessions: unknown[];
  projects: unknown[];
  search?: { hits: unknown[] };
}

/** The sidecar a daemon dials through: a peer's derived coordinate → that
 * daemon's loopback door + route secret; the WhoIs login injected, and (D1,
 * 2026-10-01) the DIALLING node's id — the other desk's roster correlates it
 * to this desk's desktop slice before its door mints the peer kind. */
function sidecar(doors: Map<string, string>, node: string): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const host = new URL(url).hostname;
      const door = doors.get(host);
      // a coordinate with no door behind it is an unreachable peer
      super(door ?? "ws://127.0.0.1:1/", {
        headers: { "Tailscale-User-Login": LOGIN, "Tailscale-Node-Id": node },
      });
    }
  }
  return SidecarSim as unknown as WsCtor;
}

interface Desk {
  name: "a" | "b";
  device: string;
  dataDir: string;
  mock: MockMgmtServer;
  daemon: FielddDaemon;
  files: { sessions: string; projects: string; search: string };
}

async function startMock(
  dataDir: string,
  device: string,
  peer: "a" | "b",
): Promise<MockMgmtServer> {
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.meshDeviceId = device;
  mock.meshPeers = [
    {
      id: `node-${peer}`,
      deviceId: `dev-${peer}`,
      name: `device-${peer}`,
      online: true,
      whois: { login: LOGIN, deviceName: `device-${peer}.tailnet.ts.net` },
    },
  ];
  // D1 — the other desk's slice: it hosts documents, so its node is a peer daemon
  mock.storeSlices = new Map<string, unknown>([
    [`dev-${peer}`, desktopSlice(`dev-${peer}`, `device-${peer}`)],
  ]);
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

async function bootDaemon(desk: Omit<Desk, "daemon">, ctor: WsCtor): Promise<FielddDaemon> {
  const env = {
    FAKE_ROSETTAD_MODE: "ok",
    FAKE_ROSETTAD_SESSIONS: desk.files.sessions,
    FAKE_ROSETTAD_PROJECTS: desk.files.projects,
    FAKE_ROSETTAD_SEARCH: desk.files.search,
    FAKE_ROSETTAD_RUNTIMES: join(desk.dataDir, "runtimes.json"),
  };
  const fakeSpawner = ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: { ...process.env, ...env },
    })) as unknown as typeof spawn;
  const home = join(desk.dataDir, "home");
  mkdirSync(home, { recursive: true });
  const daemon = await bootstrap({
    dataDir: desk.dataDir,
    controlPort: 0,
    dataPort: 0,
    peerWebSocket: ctor,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner,
    rosettadHome: home,
    indexCatalog: { batchMs: 20, digestIntervalMs: 300 },
    indexMesh: {
      staleAfterMs: 1_500,
      retryMinMs: 100,
      retryMaxMs: 500,
      persistIntervalMs: 20,
      replicaMinIntervalMs: 20,
      searchTimeoutMs: 4_000,
      changesMinIntervalMs: 50,
    },
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return daemon;
}

async function prepareDesk(name: "a" | "b", script: DeskScript): Promise<Omit<Desk, "daemon">> {
  // a SHORT root: the mock mgmt socket must stay inside macOS's sun_path
  const dataDir = mkdtempSync(join(tmpdir(), `vf-ds6${name}-`));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  writeLinkFixture(dataDir, LOGIN);
  const files = {
    sessions: join(dataDir, "sessions.json"),
    projects: join(dataDir, "projects.json"),
    search: join(dataDir, "search.json"),
  };
  writeFileSync(files.sessions, JSON.stringify(script.sessions));
  writeFileSync(files.projects, JSON.stringify(script.projects));
  writeFileSync(files.search, JSON.stringify(script.search ?? { hits: [] }));
  writeFileSync(join(dataDir, "runtimes.json"), JSON.stringify(RUNTIMES));
  const other = name === "a" ? "b" : "a";
  const mock = await startMock(dataDir, `dev-${name}`, other);
  return { name, device: `dev-${name}`, dataDir, mock, files };
}

async function doorOf(desk: Desk): Promise<string> {
  await until(
    () => desk.daemon.health().mesh.serves.some((s) => s.name === "product" && s.url !== undefined),
    15_000,
  );
  return `ws://127.0.0.1:${desk.daemon.controlPort}/t/${productPathSecret(desk.mock)}`;
}

async function bootPair(scripts: { a: DeskScript; b: DeskScript }) {
  const doors = new Map<string, string>();
  // each desk dials through its OWN sidecar: the node it names is its own
  const ctors = { a: sidecar(doors, "node-a"), b: sidecar(doors, "node-b") };
  const preA = await prepareDesk("a", scripts.a);
  const preB = await prepareDesk("b", scripts.b);
  const A: Desk = { ...preA, daemon: await bootDaemon(preA, ctors.a) };
  const B: Desk = { ...preB, daemon: await bootDaemon(preB, ctors.b) };
  doors.set("device-a.tailnet.ts.net", await doorOf(A));
  doors.set("device-b.tailnet.ts.net", await doorOf(B));
  return { A, B, doors, ctors };
}

async function windowOn(desk: Desk): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${desk.daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, desk.daemon.shellToken, "shell-main");
  return rpc;
}

/** A's history: one repository (an scp remote), a conversation B holds too */
const SCRIPT_A: DeskScript = {
  sessions: [
    row("a1", "p-app-a", 9_000),
    row("a2", "p-app-a", 4_000),
    row("a-shared", "p-app-a", 5_000, { native_session_id: "nat-shared" }),
  ],
  projects: [{ id: "p-app-a", name: "app", root_paths: ["/a/app"], git_repo: "github.com:o/app" }],
  search: {
    hits: [
      {
        timeline_id: "tl-a1",
        session_id: "a1",
        kind: "agent",
        at: 9_500,
        snippet: "a [needle] on A",
      },
    ],
  },
};

/** B's: the SAME repository over https, the shared conversation, a stray */
const SCRIPT_B: DeskScript = {
  sessions: [
    row("b1", "p-app-b", 8_000),
    row("b-shared", "p-app-b", 7_000, { native_session_id: "nat-shared" }),
    row("b-solo", "p-solo-b", 1_000),
  ],
  projects: [
    { id: "p-app-b", name: "app", root_paths: ["/b/app"], git_repo: "https://github.com/o/app" },
    { id: "p-solo-b", name: "solo", root_paths: ["/b/solo"], git_repo: null },
  ],
  search: {
    hits: [
      {
        timeline_id: "tl-b1",
        session_id: "b1",
        kind: "user",
        at: 8_500,
        snippet: "a [needle] on B",
      },
    ],
  },
};

const FAMILY = "github.com/o/app";

describe("DS-6 — history across two real daemons", () => {
  it("B lists A's history beside its own by family with device badges, keeps it greyed when A goes, and a search says A is asleep", async () => {
    const { A, B } = await bootPair({ a: SCRIPT_A, b: SCRIPT_B });
    await until(() => B.daemon.indexCatalog.ready, 30_000);
    await until(() => B.daemon.indexMesh.replica("dev-a")?.sessions.length === 3, 30_000);
    const win = await windowOn(B);

    // grouped by FAMILY: an scp remote on A and an https one on B agree
    const projects = IndexProjectsResult.parse(
      await win.call("index.projects", { scope: "mesh", family: FAMILY }),
    );
    expect(projects.rows.map((p) => [p.device, p.projectId, p.family])).toEqual([
      ["dev-a", "p-app-a", FAMILY], // its newest activity, 9000
      ["dev-b", "p-app-b", FAMILY], // 8000
    ]);
    const sessions = IndexSessionsResult.parse(
      await win.call("index.sessions", { scope: "mesh", family: FAMILY }),
    );
    expect(sessions.rows.map((s) => [s.sessionId, s.device, s.devices])).toEqual([
      ["a1", "dev-a", ["dev-a"]],
      ["b1", "dev-b", ["dev-b"]],
      // DS-D10: ONE row for the conversation both desktops hold, two badges —
      // the newer member (B's, 7000) speaks for it
      ["b-shared", "dev-b", ["dev-b", "dev-a"]],
      ["a2", "dev-a", ["dev-a"]],
    ]);
    expect(sessions.rows.every((s) => s.family === FAMILY)).toBe(true);
    expect(sessions.sources).toMatchObject([
      { device: "dev-b", self: true, state: "live" },
      { device: "dev-a", self: false, state: "live", rows: 3 },
    ]);

    // the change pings: A's history moves, B's visible page hears it
    const sub = (await win.call("index.changes.subscribe", { scope: "mesh" })) as { subId: string };
    const pings = () =>
      win.notifications.filter(
        (note) => note.method === "index.changes.delta" && note.params.subId === sub.subId,
      );
    writeFileSync(
      A.files.sessions,
      JSON.stringify([...SCRIPT_A.sessions, row("a3", "p-app-a", 9_900)]),
    );
    await until(() => B.daemon.indexMesh.replica("dev-a")?.sessions.length === 4, 15_000);
    await until(() => pings().length > 0, 10_000);
    expect(pings().at(-1)?.params.payload).toMatchObject({ upserts: [], removed: [] });

    // A goes: its daemon stops, then the roster says it is away
    await A.daemon.stop();
    B.mock.meshPeers = [
      {
        id: "node-a",
        deviceId: "dev-a",
        name: "device-a",
        online: false,
        whois: { login: LOGIN, deviceName: "device-a.tailnet.ts.net" },
      },
    ];
    B.mock.pushPeersDelta({ kind: "peerUpdated" });
    await untilAsync(
      async () => {
        const page = IndexSessionsResult.parse(
          await win.call("index.sessions", { scope: "mesh", family: FAMILY }),
        );
        return page.sources?.find((s) => s.device === "dev-a")?.state === "asleep";
      },
      15_000,
      "A asleep in sources",
    );
    // asleep is a STATE, not an absence: A's rows are still listed
    const greyed = IndexSessionsResult.parse(
      await win.call("index.sessions", { scope: "mesh", family: FAMILY }),
    );
    expect(greyed.rows.map((s) => s.sessionId)).toEqual(["a3", "a1", "b1", "b-shared", "a2"]);
    expect(greyed.rows.find((s) => s.sessionId === "b-shared")?.devices).toEqual([
      "dev-b",
      "dev-a",
    ]);
    const sourceA = greyed.sources?.find((s) => s.device === "dev-a");
    expect(sourceA).toMatchObject({ self: false, state: "asleep", rows: 4 });
    expect(sourceA?.asOf).toMatch(/Z$/);

    // search by asking: A cannot be asked, and says so — never "nothing found"
    const search = IndexSearchResult.parse(
      await win.call("index.search", { q: "needle", scope: "mesh" }),
    );
    expect(search.sources).toEqual([
      expect.objectContaining({ device: "dev-b", state: "answered" }),
      expect.objectContaining({ device: "dev-a", state: "asleep", tookMs: 0 }),
    ]);
    expect(search.hits.map((hit) => [hit.device, hit.sessionId])).toEqual([["dev-b", "b1"]]);
  }, 120_000);

  it("both awake: a mesh search asks both and merges BY TIME; the replication door refuses a window", async () => {
    const { B } = await bootPair({ a: SCRIPT_A, b: SCRIPT_B });
    await until(() => B.daemon.indexCatalog.ready, 30_000);
    await until(() => B.daemon.indexMesh.replica("dev-a")?.sessions.length === 3, 30_000);
    const win = await windowOn(B);
    const search = IndexSearchResult.parse(
      await win.call("index.search", { q: "needle", scope: "mesh" }),
    );
    expect(search.hits.map((hit) => [hit.device, hit.sessionId, hit.at])).toEqual([
      ["dev-a", "a1", 9_500],
      ["dev-b", "b1", 8_500],
    ]);
    expect(search.sources?.map((s) => [s.device, s.state])).toEqual([
      ["dev-b", "answered"],
      ["dev-a", "answered"],
    ]);
    expect(search.answered).toBe(true);
    // the local door is unchanged: no `sources`, this desktop's index only
    const local = IndexSearchResult.parse(await win.call("index.search", { q: "needle" }));
    expect(local.sources).toBeUndefined();
    expect(local.hits.map((hit) => hit.sessionId)).toEqual(["b1"]);
    // the peer replication door admits a peer daemon and nothing else
    const refused = await win.callErr("index.catalog.subscribe", { table: "sessions" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    // a `device` on a federating read routes it to its owner
    const routed = IndexProjectsResult.parse(await win.call("index.projects", { device: "dev-a" }));
    expect(routed.rows.map((p) => [p.device, p.projectId])).toEqual([["dev-a", "p-app-a"]]);
  }, 120_000);

  it("a restarted B lists A's history from its persisted replica before A ever answers", async () => {
    const { A, B, ctors } = await bootPair({ a: SCRIPT_A, b: SCRIPT_B });
    await until(() => B.daemon.indexMesh.replica("dev-a")?.sessions.length === 3, 30_000);
    // the replica is on disk (debounced), then both daemons go away
    await new Promise((resolve) => setTimeout(resolve, 300));
    await A.daemon.stop();
    await B.daemon.stop();
    B.mock.meshPeers = [
      {
        id: "node-a",
        deviceId: "dev-a",
        name: "device-a",
        online: false,
        whois: { login: LOGIN, deviceName: "device-a.tailnet.ts.net" },
      },
    ];
    const reborn: Desk = { ...B, daemon: await bootDaemon(B, ctors.b) };
    await until(() => reborn.daemon.indexCatalog.ready, 30_000);
    const win = await windowOn(reborn);
    const page = IndexSessionsResult.parse(
      await win.call("index.sessions", { scope: "mesh", devices: ["dev-a"] }),
    );
    // narrowed to A, A's own copy of the shared conversation speaks for it —
    // and B (which holds it too) is still named
    expect(page.rows.map((s) => [s.sessionId, s.devices])).toEqual([
      ["a1", ["dev-a"]],
      ["a-shared", ["dev-a", "dev-b"]],
      ["a2", ["dev-a"]],
    ]);
    expect(page.sources).toMatchObject([{ device: "dev-a", state: "asleep", rows: 3 }]);
  }, 120_000);
});
