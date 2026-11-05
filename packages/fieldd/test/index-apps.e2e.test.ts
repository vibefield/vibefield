// MA-3e (`draft/thinking-mini-apps.md` v0.2 §4, RULED 2026-11-05; the build plan's 3e as the
// lead's RULINGS amend it) — the made apps end to end. TWO REAL fieldd daemons, A and B, each
// with its own mock floor (dev-a / dev-b, each listing the other as a self peer of one login)
// and its own scripted rosettad (test/fixtures/fake-rosettad.mjs, speaking /ws/meta and
// rosetta's library, `GET /api/artifacts`), joined by a ws-ctor that plays both sidecars, as
// index-mesh.e2e.test.ts does. Every hop is real: A's `apps` table walks A's library
// (index-apps.ts), B's replica stands on A's own peer door (`index.apps.catalog.subscribe`,
// index-apps-mesh.ts), and a window on B pages the fold through `index.apps.list` and opens an
// app on A through `artifact.open {device: A}`, which B carries WHOLE to A (D35): A answers
// from its own rule (made-app-service.ts) and audits the act as the window's.
//
// The witnesses (the plan's MA-3, part 1):
//   · an app A's agent made is a row in B's mesh fold within 5 s of A's library holding it,
//     and B's shelf hears a ping; when A sleeps, B keeps A's apps and says A is asleep (DS-L8);
//   · B's open on A answers A's honest `export-unbuilt` (rosetta 0.1.3 has no export door),
//     audited on A as `artifact.made.open` with `onBehalfOf` recorded, never as authority;
//   · EL2: the page's bytes never ride B↔A — what the two daemons' peer sockets carry while A's
//     app replicates and B lists, opens and reads it stays under the size its row declares, and
//     A's rosettad is never asked for the page;
//   · C16: a URL A's listener reported reaches B's window only when its host is A's MagicDNS
//     name as B's roster authenticates it, else it is stripped, never rewritten; only a
//     validated URL is revealed, by the answering home through its own shell, in the URL
//     standard's own spelling (`ShellLinkUrl`), and the answer keeps the listener's;
//   · `artifact.mark` is the home's (`local`): until slice 3h it says `intent-unbuilt`;
//   · the apps table's peer door admits a peer daemon alone, and only once the table speaks;
//   · `index.artifacts {projectKey}` narrows a desktop's library by the fold's own rule (an app
//     from a session rosetta files under no project is kept), and a project on another
//     desktop's library is refused at the home, in words.
// Every row boots daemons: they run on the mini (a9), never under the MacBook's HOLD. Each
// wait is BOUNDED and asserted on (`settle`), so a red row fails on its assertion.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArtifactOpenResult,
  CONTRACTS_VERSION,
  IndexAppsCatalogOpen,
  IndexAppsResult,
  IndexArtifactsResult,
  IndexSessionsResult,
  MADE_APP_OPEN,
  MadeAppOpenRefusal,
  madeAppFoldKey,
  type PlaceFacts,
  type Scope,
  SHELL_PROVIDER_METHODS,
  ShellProviderCallParams,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import type { WsCtor } from "@vibefield/fieldd-client";
import type { ArtifactEntry } from "@vibefield/rosetta-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddConfig, type FielddDaemon, verifyAuditSegment } from "../src/index";
import type { MadeAppExporter } from "../src/made-app-service";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice } from "./peer-roster";
import { helloAs, WsRpc } from "./ws-rpc";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");
/** what a window holds to page the fold and open an app (the window's literal list gains
 * `apps.use` at MA-4a; a minted token here names it) */
const WINDOW_SCOPES: Scope[] = ["apps.use", "index.search"];
/** the path rosetta records for a publication: on ITS desktop, never on any door's answer */
const LIBRARY_PATH = "/Users/someone/work";
/** B's roster calls A this by default (the sidecar's WhoIs `deviceName`) */
const A_NAME = "device-a.tailnet.ts.net";
const B_NAME = "device-b.tailnet.ts.net";
/** the host the mock floor reports for every listener it serves (mock-mgmt.ts' serve.add) */
const MOCK_HOST = "mock.ts.net";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

// ── the scripts ─────────────────────────────────────────────────────────────

/** 64 lowercase hex, as rosetta's identities and blake3 digests are (any stable digest here). */
const hex = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const appIdOf = (name: string): string => hex(`app:${name}`);
const presentationOf = (name: string): string => hex(`presentation:${name}`);
const digestOf = (name: string): string => hex(`page:${name}`);

/** One made app's newest presentation as a desktop's rosetta keeps it — typed as rosetta's OWN
 * `ArtifactEntry`. Its path and its asset's daemon-relative URL are rosetta's alone. */
const appEntry = (
  name: string,
  sessionId: string,
  publishedAt: number,
  byteLen = 120,
): ArtifactEntry => ({
  publication: {
    id: presentationOf(name),
    artifact_id: appIdOf(name),
    session_id: sessionId,
    timeline_id: `tl-${name}`,
    title: `App ${name}`,
    filename: `${name}.html`,
    path: `${LIBRARY_PATH}/${name}.html`,
    url: null,
    native_id: null,
    version: null,
    published_at: publishedAt,
    source_offset: 4_096,
  },
  availability: "captured",
  captured_at: publishedAt - 100,
  recovered_from: null,
  asset: {
    url: `/api/assets/${digestOf(name)}.html`,
    digest: digestOf(name),
    media_type: "text/html; charset=utf-8",
    byte_len: byteLen,
  },
  agent: "claude-code",
  session_title: null,
  project_id: null,
  project_name: null,
  presentations: 1,
});

/** rosetta's SessionRow, as the scripted daemon serves it */
const sessionRow = (id: string, projectId: string, lastAt: number) => ({
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
  updated_at: lastAt,
  activity: { first_at: 1_000, last_at: lastAt },
  stream_state: "indexed",
  role: "primary",
  delegation: null,
});

const RUNTIMES = [{ id: "rt-claude", kind: "claude-code", data_root: "~/.claude", enabled: true }];

/** One place as the place scanner reads it (project-doors-phone.test.ts' `facts`): a folder that is
 * there and is no checkout, so it groups as its own project. */
const placeFacts = (placeId: string, path: string): PlaceFacts => ({
  placeId,
  path,
  aliases: [],
  kind: "project",
  caseless: true,
  exists: true,
  mounted: true,
  git: false,
  remotes: [],
  samples: [],
  hits: [],
  observedAt: 1,
});

interface Library {
  entries: ArtifactEntry[];
  /** the content route's bytes, by publication id */
  content?: Record<string, string>;
  /** answer every list with it (a library that cannot be read yet) */
  status?: number;
}

interface DeskScript {
  sessions: unknown[];
  projects: unknown[];
  library: Library;
}

/** A: one session, one app its agent made */
const SCRIPT_A: DeskScript = {
  sessions: [sessionRow("a1", "p-app-a", 9_000)],
  projects: [{ id: "p-app-a", name: "app", root_paths: ["/work/p-app-a"], git_repo: null }],
  library: { entries: [appEntry("one", "a1", 5_000)] },
};

/** B: its own session and its own app, older than A's */
const SCRIPT_B: DeskScript = {
  sessions: [sessionRow("b1", "p-app-b", 8_000)],
  projects: [{ id: "p-app-b", name: "app", root_paths: ["/work/p-app-b"], git_repo: null }],
  library: { entries: [appEntry("bee", "b1", 4_000)] },
};

/** RO-A1's export as a 0.1.4 rosetta would answer it (the test seam `madeApps.exporter`): the
 * page written into its digest folder, the digest the library names, the shell's hosts. */
const servingExporter = (hosts: string[]): MadeAppExporter => ({
  export: async ({ publicationId, into }) => {
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, "index.html"), "<!doctype html><title>made</title>");
    const name = ["one", "two", "bee"].find((n) => presentationOf(n) === publicationId) ?? "";
    return { written: true, digest: digestOf(name), shellVersion: "test-shell", hosts };
  },
});

// ── the desks ───────────────────────────────────────────────────────────────

interface DeskFiles {
  sessions: string;
  projects: string;
  artifacts: string;
  requests: string;
}

interface Desk {
  name: "a" | "b";
  device: string;
  dataDir: string;
  mock: MockMgmtServer;
  daemon: FielddDaemon;
  files: DeskFiles;
}

/** Wait, bounded, for a condition; the caller ASSERTS on the answer. */
async function settle(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/** The same for a question asked over a door; a refusal is "not yet". */
async function settleAsync(predicate: () => Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function writeLibrary(desk: { files: DeskFiles }, library: Library): void {
  writeFileSync(desk.files.artifacts, JSON.stringify(library));
}

/** A session moves (its agent wrote): the meta stream sends it, and the apps table re-reads. */
function touchSessions(desk: { files: DeskFiles }, sessions: unknown[]): void {
  writeFileSync(desk.files.sessions, JSON.stringify(sessions));
}

/** What a desk's rosettad was asked, in order. */
function requestsOf(desk: { files: DeskFiles }): string[] {
  return readFileSync(desk.files.requests, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(line.indexOf(" ") + 1));
}

/** The sidecar a daemon dials through: a peer's coordinate → that daemon's loopback door with
 * the route secret joined; the WhoIs login and the DIALLING node's id injected (D1). Every
 * socket it opens is kept, so a row can count what the peer link carried (EL2). */
function sidecar(doors: Map<string, string>, node: string, opened: WebSocket[]): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const door = doors.get(new URL(url).hostname);
      // a coordinate with no door behind it is an unreachable peer
      super(door ?? "ws://127.0.0.1:1/", {
        headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": node },
      });
      opened.push(this);
    }
  }
  return SidecarSim as unknown as WsCtor;
}

/** Bytes a client socket has moved both ways, framing included. */
function bytesOf(ws: WebSocket): number {
  const raw = (ws as unknown as { _socket?: { bytesRead: number; bytesWritten: number } })._socket;
  return raw === undefined || raw === null ? 0 : raw.bytesRead + raw.bytesWritten;
}

async function startMock(
  dataDir: string,
  device: string,
  peer: "a" | "b",
  peerName: string,
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
      whois: { login: TEST_LOGIN, deviceName: peerName },
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

async function prepareDesk(
  name: "a" | "b",
  script: DeskScript,
  peerName: string,
): Promise<Omit<Desk, "daemon">> {
  // a SHORT root: the mock mgmt socket must stay inside macOS's sun_path
  const dataDir = mkdtempSync(join(tmpdir(), `vf-ma3${name}-`));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  writeLinkFixture(dataDir, TEST_LOGIN);
  const files: DeskFiles = {
    sessions: join(dataDir, "sessions.json"),
    projects: join(dataDir, "projects.json"),
    artifacts: join(dataDir, "artifacts.json"),
    requests: join(dataDir, "requests.log"),
  };
  writeFileSync(files.sessions, JSON.stringify(script.sessions));
  writeFileSync(files.projects, JSON.stringify(script.projects));
  writeFileSync(files.requests, "");
  writeLibrary({ files }, script.library);
  writeFileSync(join(dataDir, "runtimes.json"), JSON.stringify(RUNTIMES));
  const other = name === "a" ? "b" : "a";
  const mock = await startMock(dataDir, `dev-${name}`, other, peerName);
  return { name, device: `dev-${name}`, dataDir, mock, files };
}

/** One desk's daemon over its scripted rosettad, on fast cadences. `seams.madeApps` is the made-app
 * service's (the exporter); `seams.indexApps` is merged over the apps table's fast defaults. */
async function bootDaemon(
  desk: Omit<Desk, "daemon">,
  ctor: WsCtor,
  seams: Pick<FielddConfig, "madeApps" | "indexApps"> = {},
): Promise<FielddDaemon> {
  const env = {
    FAKE_ROSETTAD_MODE: "ok",
    FAKE_ROSETTAD_SESSIONS: desk.files.sessions,
    FAKE_ROSETTAD_PROJECTS: desk.files.projects,
    FAKE_ROSETTAD_ARTIFACTS: desk.files.artifacts,
    FAKE_ROSETTAD_RUNTIMES: join(desk.dataDir, "runtimes.json"),
    FAKE_ROSETTAD_REQUEST_LOG: desk.files.requests,
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
    indexApps: { rereadDelayMs: 50, rereadMinIntervalMs: 200, ...seams.indexApps },
    ...(seams.madeApps !== undefined ? { madeApps: seams.madeApps } : {}),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return daemon;
}

/** A desk's tailnet door, once its product serve is up. */
async function doorOf(desk: Desk): Promise<string> {
  const up = await settle(
    () => desk.daemon.health().mesh.serves.some((s) => s.name === "product" && s.url !== undefined),
    15_000,
  );
  expect(up, `${desk.name}'s product serve is up`).toBe(true);
  return `ws://127.0.0.1:${desk.daemon.controlPort}/t/${productPathSecret(desk.mock)}`;
}

/** Two desks, joined. `aNameOnB` is the MagicDNS name B's roster gives A; `aMadeApps` A's seams. */
async function bootPair(
  scripts: { a: DeskScript; b: DeskScript },
  opts: { aNameOnB?: string; aMadeApps?: FielddConfig["madeApps"] } = {},
) {
  const doors = new Map<string, string>();
  const opened: WebSocket[] = [];
  // each desk dials through its OWN sidecar: the node it names is its own
  const ctors = { a: sidecar(doors, "node-a", opened), b: sidecar(doors, "node-b", opened) };
  const aName = opts.aNameOnB ?? A_NAME;
  const preA = await prepareDesk("a", scripts.a, B_NAME);
  const preB = await prepareDesk("b", scripts.b, aName);
  const A: Desk = {
    ...preA,
    daemon: await bootDaemon(
      preA,
      ctors.a,
      opts.aMadeApps !== undefined ? { madeApps: opts.aMadeApps } : {},
    ),
  };
  const B: Desk = { ...preB, daemon: await bootDaemon(preB, ctors.b) };
  doors.set(aName, await doorOf(A));
  doors.set(B_NAME, await doorOf(B));
  /** what every socket between the two daemons has carried, both ways */
  const carried = (): number => opened.reduce((sum, ws) => sum + bytesOf(ws), 0);
  return { A, B, carried };
}

async function openRpc(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers !== undefined ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.on("error", () => undefined);
  return new WsRpc(ws);
}

/** A window on a desk, as Electron main mints it: a renderer's token with `scopes`. */
async function windowOn(desk: Desk, scopes: Scope[] = WINDOW_SCOPES): Promise<WsRpc> {
  const shell = await openRpc(`ws://127.0.0.1:${desk.daemon.controlPort}`);
  await helloAs(shell, desk.daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${desk.name}`,
    rendererParticipant: {
      participantId: `renderer:ma3:${desk.name}`,
      incarnation: `renderer:ma3:${desk.name}:document-1`,
    },
  })) as { token: string };
  const rpc = await openRpc(`ws://127.0.0.1:${desk.daemon.controlPort}`);
  await helloAs(rpc, minted.token);
  return rpc;
}

/** The desk's shell, registered as its provider the way Electron main registers: what fieldd asks
 * of the browser arrives here as `shell.provider.call`. */
async function shellOn(desk: Desk): Promise<WsRpc> {
  const shell = await openRpc(`ws://127.0.0.1:${desk.daemon.controlPort}`);
  await helloAs(shell, desk.daemon.shellToken, "shell-main");
  await shell.call("shell.provider.register", { methods: [...SHELL_PROVIDER_METHODS] });
  return shell;
}

function providerCalls(shell: WsRpc): ShellProviderCallParams[] {
  return shell.notifications
    .filter((note) => note.method === "shell.provider.call")
    .map((note) => ShellProviderCallParams.parse(note.params));
}

/** The other desk's daemon, dialling this desk's tailnet door from its own node (D1): a
 * `peer-fieldd` principal, as B's replica is when it asks A. */
async function peerOn(desk: Desk, node: string, deviceId: string): Promise<WsRpc> {
  const rpc = await openRpc(
    `ws://127.0.0.1:${desk.daemon.controlPort}/t/${productPathSecret(desk.mock)}`,
    { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": node },
  );
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "peer-fieldd",
    deviceId,
  });
  return rpc;
}

async function auditRecords(daemon: FielddDaemon): Promise<AuditRecordV1[]> {
  const out: AuditRecordV1[] = [];
  for (const name of readdirSync(daemon.audit.root)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()) {
    out.push(...(await verifyAuditSegment(join(daemon.audit.root, name))).records);
  }
  return out;
}

/** B's roster says A is away (its daemon stopped; the floor says so next). */
function awayOnB(B: Desk, aName: string = A_NAME): void {
  B.mock.meshPeers = [
    {
      id: "node-a",
      deviceId: "dev-a",
      name: "device-a",
      online: false,
      whois: { login: TEST_LOGIN, deviceName: aName },
    },
  ];
  B.mock.pushPeersDelta({ kind: "peerUpdated" });
}

/** B reaches A (B's HISTORY replica, DS-6's and not this slice's, holds A's session) and A's own
 * apps table has spoken: what a routed open needs, without leaning on the apps replica, so a row
 * about the open fails on the open. */
async function reachable(A: Desk, B: Desk): Promise<void> {
  const linked = await settle(
    () => (B.daemon.indexMesh.replica("dev-a")?.sessions.length ?? 0) > 0,
    30_000,
  );
  expect(linked, "B's history replica holds A's session: B reaches A").toBe(true);
  const spoken = await settle(() => A.daemon.indexApps.ready, 30_000);
  expect(spoken, "A's apps table has spoken (its first walk landed)").toBe(true);
}

// ── the rows ────────────────────────────────────────────────────────────────

describe("MA-3e — the made apps across two real daemons", () => {
  it("an app A's agent made is a row in B's mesh fold within 5 s of A's library holding it, and B's shelf hears it; when A sleeps, B keeps A's apps and says A is asleep", async () => {
    const { A, B } = await bootPair({ a: SCRIPT_A, b: SCRIPT_B });
    const held = await settle(() => B.daemon.appsMesh.replica("dev-a")?.length === 1, 30_000);
    expect(held, "B's replica holds A's first app").toBe(true);
    // the page below names B's own app too: B's own first walk has landed
    const ownRead = await settle(() => B.daemon.indexApps.ready, 30_000);
    expect(ownRead, "B's apps table has spoken (its first walk landed)").toBe(true);
    const win = await windowOn(B);
    const sub = (await win.call("index.apps.subscribe", { scope: "mesh" })) as { subId: string };
    const pings = () =>
      win.notifications.filter(
        (note) => note.method === "index.apps.delta" && note.params.subId === sub.subId,
      );
    const listed = async () =>
      IndexAppsResult.parse(await win.call("index.apps.list", { scope: "mesh" }));

    // A's agent presents a second app: A's library holds it, and the session it came from moves
    writeLibrary(A, { entries: [...SCRIPT_A.library.entries, appEntry("two", "a1", 7_000)] });
    touchSessions(A, [sessionRow("a1", "p-app-a", 9_900)]);
    const seen = await settleAsync(
      async () => (await listed()).rows.some((row) => row.title === "App two"),
      5_000,
    );
    expect(seen, "B lists A's second app within 5 s of A's library holding it").toBe(true);

    const page = await listed();
    // one row per app, the newest first, each served by the desktop that holds it
    expect(page.rows.map((row) => [row.title, row.device, row.devices])).toEqual([
      ["App two", "dev-a", ["dev-a"]],
      ["App one", "dev-a", ["dev-a"]],
      ["App bee", "dev-b", ["dev-b"]],
    ]);
    expect(page.rows[0]).toMatchObject({
      appId: appIdOf("two"),
      appKey: `dev-a:${appIdOf("two")}`,
      foldKey: madeAppFoldKey({ device: "dev-a", appId: appIdOf("two"), kind: "claude-code" }),
      presentationId: presentationOf("two"),
      sessionId: "a1",
      filename: "two.html",
      kind: "claude-code",
      digest: digestOf("two"),
      availability: "captured",
      versions: 1,
    });
    // rosetta 0.1.3 has no export door: an app is listed, and not yet openable
    expect(page.rows.map((row) => row.openable)).toEqual([false, false, false]);
    expect(page.sources.find((source) => source.device === "dev-a")).toMatchObject({
      self: false,
      state: "live",
      libraryReady: true,
      rows: 2,
    });
    expect(page.sources.find((source) => source.device === "dev-b")).toMatchObject({
      self: true,
      state: "live",
      libraryReady: true,
    });
    expect(JSON.stringify(page), "no path rides a row").not.toContain(LIBRARY_PATH);
    const pinged = await settle(() => pings().length > 0, 5_000);
    expect(pinged, "B's shelf heard the fold move").toBe(true);
    expect(pings().at(-1)?.params.payload).toMatchObject({ upserts: [], removed: [] });

    // A goes: its daemon stops, then B's roster says it is away
    await A.daemon.stop();
    awayOnB(B);
    const asleep = await settleAsync(
      async () =>
        (await listed()).sources.find((source) => source.device === "dev-a")?.state === "asleep",
      15_000,
    );
    expect(asleep, "B says A is asleep").toBe(true);
    const greyed = await listed();
    expect(
      greyed.rows.map((row) => row.title),
      "asleep is a state, not an absence: A's apps are still listed",
    ).toEqual(["App two", "App one", "App bee"]);
    expect(greyed.sources.find((source) => source.device === "dev-a")).toMatchObject({
      self: false,
      state: "asleep",
      rows: 2,
    });
  }, 120_000);

  it("B's artifact.open {device: A} answers A's honest export-unbuilt, audited on A as the act of B's window; artifact.mark is the home's and says intent-unbuilt until slice 3h", async () => {
    const { A, B } = await bootPair({ a: SCRIPT_A, b: SCRIPT_B });
    await reachable(A, B);
    const appId = appIdOf("one");
    const win = await windowOn(B);

    const answer = await win.attempt("artifact.open", { appId, device: "dev-a" });
    expect(answer.ok, "the open is refused: A's rosetta has no export door yet").toBe(false);
    if (!answer.ok) {
      expect(answer.error.data?.kind).toBe("UNAVAILABLE");
      expect(answer.error.data?.retryable).toBe(false);
      expect(MadeAppOpenRefusal.parse(answer.error.data?.details)).toEqual({
        service: MADE_APP_OPEN.SERVICE,
        state: MADE_APP_OPEN.STATE_EXPORT_UNBUILT,
        device: "dev-a",
      });
    }
    // A audited the act, its attempt before its effect, as B's daemon carrying B's window:
    // recorded, never authority (DS-L7)
    const opens = (await auditRecords(A.daemon)).filter(
      (record) => record.action === "artifact.made.open",
    );
    expect(opens.map((record) => [record.phase, record.outcome ?? null])).toEqual([
      ["attempt", null],
      ["outcome", "failed"],
    ]);
    for (const record of opens) {
      expect(record.target).toEqual({ kind: "made-app", id: appId });
      expect(record.actor).toMatchObject({
        kind: "peer-fieldd",
        onBehalfOf: { clientKind: "renderer", deviceId: "dev-b" },
      });
    }
    expect(opens.at(-1)?.reasonCode).toBe("UNAVAILABLE");
    // B carried the call WHOLE: it audited no open of its own
    expect(
      (await auditRecords(B.daemon)).filter((record) => record.action === "artifact.made.open"),
    ).toEqual([]);
    // A's own window meets the same honest word, naming A
    const local = await (await windowOn(A)).attempt("artifact.open", { appId });
    expect(local.ok, "A's own open is refused the same way").toBe(false);
    if (!local.ok) {
      expect(local.error.data?.details).toEqual({
        service: MADE_APP_OPEN.SERVICE,
        state: MADE_APP_OPEN.STATE_EXPORT_UNBUILT,
        device: "dev-a",
      });
    }

    // keep is the person's intent, the home's to write (slice 3h): until then, said in words
    const foldKey = madeAppFoldKey({ device: "dev-a", appId, kind: "claude-code" });
    const marked = await win.attempt("artifact.mark", { foldKey, kept: true });
    expect(marked.ok, "nothing is kept before slice 3h writes the intent").toBe(false);
    if (!marked.ok) {
      expect(marked.error.data?.kind).toBe("UNAVAILABLE");
      expect(marked.error.data?.retryable).toBe(false);
      expect(marked.error.data?.details).toEqual({
        service: MADE_APP_OPEN.SERVICE,
        state: MADE_APP_OPEN.STATE_INTENT_UNBUILT,
      });
    }
    // PIN (the D36 wall holds it on the skeleton too): the mark is `local`, never routed
    const routed = await win.attempt("artifact.mark", { foldKey, kept: true, device: "dev-a" });
    expect(routed.ok, "a device never routes the mark").toBe(false);
    if (!routed.ok) {
      expect(routed.error.data?.kind).toBe("PRECONDITION_FAILED");
      expect(routed.error.data?.details).toEqual({ method: "artifact.mark", locality: "local" });
    }
  }, 120_000);

  it("EL2: the page's bytes never ride B↔A — what the daemons' peer sockets carry while A's app replicates and B lists, opens and reads it stays under the size its row declares, and A's rosettad is never asked for the page", async () => {
    const PAGE_BYTES = 1024 * 1024;
    const { A, B, carried } = await bootPair({
      a: { ...SCRIPT_A, library: { entries: [] } },
      b: SCRIPT_B,
    });
    await reachable(A, B);
    const before = carried();

    // A's agent presents a page of a mebibyte; its library keeps it
    const html = `<!doctype html><title>big</title>${"x".repeat(PAGE_BYTES)}`;
    writeLibrary(A, {
      entries: [appEntry("big", "a1", 8_000, html.length)],
      content: { [presentationOf("big")]: html },
    });
    touchSessions(A, [sessionRow("a1", "p-app-a", 9_900)]);
    const held = await settle(
      () =>
        B.daemon.appsMesh.replica("dev-a")?.some((row) => row.appId === appIdOf("big")) === true,
      15_000,
    );
    expect(held, "B holds A's row, which names the page's size").toBe(true);
    const row = B.daemon.appsMesh.replica("dev-a")?.find((r) => r.appId === appIdOf("big"));
    expect(row?.byteLen).toBe(html.length);

    const win = await windowOn(B);
    const listed = IndexAppsResult.parse(await win.call("index.apps.list", { scope: "mesh" }));
    expect(listed.rows.map((r) => r.title)).toContain("App big");
    const opened = await win.attempt("artifact.open", { appId: appIdOf("big"), device: "dev-a" });
    expect(opened.ok, "A answers its honest refusal, never the page").toBe(false);
    const versions = IndexArtifactsResult.parse(
      await win.call("index.artifacts", { device: "dev-a", appId: appIdOf("big") }),
    );
    expect(versions.entries.map((e) => [e.device, e.presentationId, e.byteLen])).toEqual([
      ["dev-a", presentationOf("big"), html.length],
    ]);

    const moved = carried() - before;
    expect(moved, "B↔A carried rows and answers, never the page").toBeLessThan(html.length);
    // fieldd never asks rosettad for the page itself (MA-L5): the content route is never on A's log
    expect(
      requestsOf(A).filter((url) => url.includes("/content")),
      "A's rosettad was never asked for the page",
    ).toEqual([]);

    // a project narrows only the library it is asked of: A cannot read B's grouping (DS-L4) and
    // B's hook carries the ask as it came, so B refuses a routed project in words, never a blank
    const narrowed = await win.attempt("index.artifacts", {
      device: "dev-a",
      projectKey: "pk-of-b",
    });
    expect(narrowed.ok, "B refuses a project on A's library before carrying it").toBe(false);
    if (!narrowed.ok) {
      expect(narrowed.error.data?.kind).toBe("PRECONDITION_FAILED");
      expect(narrowed.error.data?.details).toEqual({ method: "index.artifacts" });
    }
  }, 120_000);

  it("C16: a URL A's listener reported, whose host is not A's MagicDNS name as B's roster knows it, is stripped at B — never rewritten — and B reveals nothing; A's own window has it revealed by A's own shell", async () => {
    const { A, B } = await bootPair(
      { a: SCRIPT_A, b: SCRIPT_B },
      { aMadeApps: { exporter: servingExporter(["cdn.example.com"]) } },
    );
    await reachable(A, B);
    const appId = appIdOf("one");

    // A's own window: A serves its app on the URL its listener reported, on A's own name. Here A
    // is both the home and the origin, so A reveals it through its OWN shell, handing the browser
    // the URL standard's own spelling of that URL (the root's slash, never another host), and
    // audits the reveal without the URL
    const shellA = await shellOn(A);
    const openingA = (await windowOn(A)).call("artifact.open", { appId, reveal: true }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    // A is the origin too, so its first serve owes the app's preview (L11). The capture is enqueued at the serving
    // answer (MadeAppService #answer → #maybeCapture), on its own chain beside the reveal, and only once A's table
    // speaks, so it may reach A's shell before the reveal, after it, or not yet. It is left pending here, and the
    // reveal is found by its method.
    const CAPTURE = "shell.webcontents.captureArtifactPreview";
    const openLinkOf = (calls: ShellProviderCallParams[]) =>
      calls.find((call) => call.method === "shell.openLink");
    const revealedA = await settle(() => openLinkOf(providerCalls(shellA)) !== undefined, 15_000);
    expect(revealedA, "A asks its own shell to open what it serves").toBe(true);
    expect(
      providerCalls(shellA)
        .map((call) => call.method)
        .filter((method) => method !== CAPTURE),
      "beside the owed capture, A's shell is asked for the reveal alone, once",
    ).toEqual(["shell.openLink"]);
    const callA = openLinkOf(providerCalls(shellA));
    expect(callA).toMatchObject({ method: "shell.openLink", caller: { clientKind: "fieldd" } });
    await shellA.call("shell.provider.resolve", {
      callId: callA?.callId,
      outcome: { result: { opened: true } },
    });
    const settledA = await openingA;
    expect(settledA.ok, "A's own open answers as usual once the browser has it").toBe(true);
    const local = ArtifactOpenResult.parse(settledA.ok ? settledA.result : {});
    expect(local.state, "A serves its app").toBe("serving");
    expect(local.url, "on the URL its own listener reported").toMatch(
      new RegExp(`^https://${MOCK_HOST.replaceAll(".", "\\.")}:\\d+/?$`),
    );
    expect(
      (callA?.params as { url?: unknown } | undefined)?.url,
      "the browser is handed the standard's spelling of the served URL, exactly",
    ).toBe(new URL(String(local.url)).href);
    expect(local.reach).toEqual(["cdn.example.com"]);
    const revealsA = (await auditRecords(A.daemon)).filter(
      (record) => record.action === "artifact.made.reveal",
    );
    expect(revealsA.map((record) => [record.phase, record.outcome ?? null])).toEqual([
      ["attempt", null],
      ["outcome", "succeeded"],
    ]);
    expect(JSON.stringify(revealsA), "A's reveal record names no URL").not.toContain(MOCK_HOST);

    // B's window asks A through B, and asks B to reveal it in the browser
    const shell = await shellOn(B);
    const win = await windowOn(B);
    const answer = ArtifactOpenResult.parse(
      await win.call("artifact.open", { appId, device: "dev-a", reveal: true }),
    );
    expect(answer.state, "A's answer reached B's window").toBe("serving");
    expect(
      answer.url,
      `A's listener named ${MOCK_HOST}; B's roster calls A ${A_NAME}: the URL is stripped`,
    ).toBeUndefined();
    expect(answer.reach, "the rest of A's answer stands").toEqual(["cdn.example.com"]);
    expect(providerCalls(shell), "nothing validated, so nothing is revealed").toEqual([]);
    const madeRecords = (await auditRecords(B.daemon)).filter((record) =>
      record.action.startsWith("artifact.made."),
    );
    expect(
      madeRecords.filter((record) => record.action === "artifact.made.reveal"),
      "B revealed nothing, so it audited no reveal",
    ).toEqual([]);
    expect(JSON.stringify(madeRecords), "and wrote no URL into its record").not.toContain(
      MOCK_HOST,
    );
  }, 120_000);

  it("C16: a URL on A's own MagicDNS name passes B's check, and B — the answering home — reveals it through its own shell, never A", async () => {
    const { A, B } = await bootPair(
      { a: SCRIPT_A, b: SCRIPT_B },
      { aNameOnB: MOCK_HOST, aMadeApps: { exporter: servingExporter([]) } },
    );
    await reachable(A, B);
    const appId = appIdOf("one");
    const shell = await shellOn(B);
    const win = await windowOn(B);

    const opening = win.call("artifact.open", { appId, device: "dev-a", reveal: true }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const revealed = await settle(() => providerCalls(shell).length > 0, 15_000);
    expect(revealed, "B asks its own shell to open what A served").toBe(true);
    const call = providerCalls(shell)[0];
    expect(call).toMatchObject({
      method: "shell.openLink",
      // an internal door: main sees fieldd, never the window that asked
      caller: { clientKind: "fieldd" },
    });
    // the browser is handed the URL standard's own spelling: the root's slash, as the shell's
    // `ShellLinkUrl` reads a link (the listener reports none)
    const url = (call?.params as { url?: unknown } | undefined)?.url;
    expect(url).toMatch(new RegExp(`^https://${MOCK_HOST.replaceAll(".", "\\.")}:\\d+/$`));
    await shell.call("shell.provider.resolve", {
      callId: call?.callId,
      outcome: { result: { opened: true } },
    });
    const settled = await opening;
    expect(settled.ok, "the open answers as usual once the browser has it").toBe(true);
    const answer = ArtifactOpenResult.parse(settled.ok ? settled.result : {});
    expect(answer.state).toBe("serving");
    expect(answer.url, "the answer keeps the URL A's listener reported").toBeDefined();
    expect(
      new URL(String(answer.url)).href,
      "what B revealed is exactly the URL A answered, in the standard's spelling",
    ).toBe(url);
    // the home audited its reveal, and never the URL
    const homeRecords = (await auditRecords(B.daemon)).filter((record) =>
      record.action.startsWith("artifact.made."),
    );
    expect(
      homeRecords
        .filter((record) => record.action === "artifact.made.reveal")
        .map((record) => [record.phase, record.outcome ?? null]),
    ).toEqual([
      ["attempt", null],
      ["outcome", "succeeded"],
    ]);
    // no spelling of it: not the host, so neither the listener's nor the browser's
    expect(JSON.stringify(homeRecords), "the reveal's record names no URL").not.toContain(
      MOCK_HOST,
    );
    // the origin served and audited the open as B's window's; it revealed nothing itself
    const originRecords = await auditRecords(A.daemon);
    expect(
      originRecords
        .filter((record) => record.action === "artifact.made.open" && record.phase === "outcome")
        .map((record) => record.outcome),
    ).toEqual(["succeeded"]);
    expect(originRecords.filter((record) => record.action === "artifact.made.reveal")).toEqual([]);
  }, 120_000);

  it("the apps table's peer door admits a peer daemon alone, and only once the table speaks: before A's first walk lands a peer hears library-reading, a window is refused, and A's own fold says it is still reading", async () => {
    // A alone, its library not readable yet
    const preA = await prepareDesk(
      "a",
      { ...SCRIPT_A, library: { ...SCRIPT_A.library, status: 503 } },
      B_NAME,
    );
    // a walk that did not land is retried at the re-read floor, doubling up to the walk's cadence:
    // a short cadence keeps that retry within the row's bounded wait
    const A: Desk = {
      ...preA,
      daemon: await bootDaemon(preA, sidecar(new Map(), "node-a", []), {
        indexApps: { resnapshotMs: 1_000 },
      }),
    };
    const caught = await settle(() => A.daemon.indexCatalog.ready, 30_000);
    expect(caught, "A's catalog has read its history").toBe(true);
    expect(A.daemon.indexApps.ready, "A's library refused: the apps table has not spoken").toBe(
      false,
    );

    await doorOf(A); // the peer arrives on A's tailnet door, declared once A's product serve is up
    const peer = await peerOn(A, "node-b", "dev-b");
    const early = await peer.attempt("index.apps.catalog.subscribe", {});
    expect(early.ok, "a peer is told the table has not spoken, never sent an empty one").toBe(
      false,
    );
    if (!early.ok) {
      expect(early.error.data?.kind).toBe("UNAVAILABLE");
      expect(early.error.data?.retryable).toBe(true);
      expect(early.error.data?.details).toEqual({
        service: MADE_APP_OPEN.SERVICE,
        state: MADE_APP_OPEN.STATE_READING,
      });
    }
    const win = await windowOn(A);
    const refused = await win.attempt("index.apps.catalog.subscribe", {});
    expect(refused.ok, "a window is refused the peer door").toBe(false);
    if (!refused.ok) {
      expect(refused.error.data?.kind).toBe("FORBIDDEN_SCOPE");
      expect(refused.error.data?.details).toEqual({ method: "index.apps.catalog.subscribe" });
    }
    const fold = await win.attempt("index.apps.list", {});
    expect(fold.ok, "A's own fold says it is still reading, never an empty shelf").toBe(false);
    if (!fold.ok) {
      expect(fold.error.data?.kind).toBe("UNAVAILABLE");
      expect(fold.error.data?.details).toEqual({
        service: MADE_APP_OPEN.SERVICE,
        state: MADE_APP_OPEN.STATE_READING,
      });
    }

    // the library answers: the first walk lands at its retry, and the door opens
    writeLibrary(A, SCRIPT_A.library);
    const landed = await settle(() => A.daemon.indexApps.ready, 15_000);
    expect(landed, "A's first walk landed once the library answered").toBe(true);
    const opened = await peer.attempt("index.apps.catalog.subscribe", {});
    expect(opened.ok, "the peer is admitted once the table speaks").toBe(true);
    if (opened.ok) {
      const open = IndexAppsCatalogOpen.parse(
        (opened.result as { snapshot?: unknown } | undefined)?.snapshot,
      );
      expect(open).toMatchObject({
        snapshot: {
          libraryReady: true,
          rows: [expect.objectContaining({ appId: appIdOf("one"), device: "dev-a" })],
        },
      });
      expect(JSON.stringify(open), "no path rides a replicated row").not.toContain(LIBRARY_PATH);
    }
  }, 120_000);

  it("index.artifacts {projectKey} narrows A's library by the rule the fold's column reads: an app from a session rosetta files under no project is kept, rosetta's own filter is sent only where it drops nothing, and a peer daemon's project is refused in words", async () => {
    // A: a1 and a2 work in the app's place, and rosetta files a2 under no project (its
    // unassigned bucket); a3 works in another project's place. Each made one app.
    const script: DeskScript = {
      sessions: [
        sessionRow("a1", "p-app-a", 9_000),
        { ...sessionRow("a2", "p-app-a", 8_500), project_id: null },
        sessionRow("a3", "p-other", 8_000),
      ],
      projects: [
        { id: "p-app-a", name: "app", root_paths: ["/work/p-app-a"], git_repo: null },
        { id: "p-other", name: "other", root_paths: ["/work/p-other"], git_repo: null },
      ],
      library: {
        entries: [
          // rosetta's `project_id` on an entry is its ROOT session's
          { ...appEntry("one", "a1", 5_000), project_id: "p-app-a", project_name: "app" },
          { ...appEntry("loose", "a2", 4_500), project_id: null },
          { ...appEntry("far", "a3", 4_000), project_id: "p-other", project_name: "other" },
        ],
      },
    };
    const preA = await prepareDesk("a", script, B_NAME);
    const A: Desk = { ...preA, daemon: await bootDaemon(preA, sidecar(new Map(), "node-a", [])) };
    const spoken = await settle(() => A.daemon.indexApps.ready, 30_000);
    expect(spoken, "A's apps table has spoken (its first walk landed)").toBe(true);
    // the places, through the catalog's own write path (this world runs no files worker)
    A.daemon.indexCatalog.setPlaces(
      new Map([
        ["p-app-a", [placeFacts("pl_app", "/work/p-app-a")]],
        ["p-other", [placeFacts("pl_other", "/work/p-other")]],
      ]),
    );
    A.daemon.projects.regroupNow();

    const win = await windowOn(A);
    const listing = IndexSessionsResult.parse(
      await win.call("index.sessions", { scope: "local", limit: 50 }),
    );
    const keyOf = (sessionId: string): string | undefined =>
      listing.rows.find((row) => row.sessionId === sessionId)?.projectKey;
    const app = keyOf("a1");
    const other = keyOf("a3");
    expect(app, "a1's cwd joins the app's project").toBeDefined();
    expect(keyOf("a2"), "a2, filed under no rosetta project, works in the same place").toBe(app);
    expect(other, "a3's cwd joins the other project").toBeDefined();
    expect(other).not.toBe(app);

    /** the rosetta `project` filters A's library was asked with while `act` ran (an apps walk
     * asks none, so its own reads never count here) */
    const filtersDuring = async (act: () => Promise<void>): Promise<string[]> => {
      const before = requestsOf(A).length;
      await act();
      return requestsOf(A)
        .slice(before)
        .filter((url) => url.startsWith("/api/artifacts"))
        .map((url) => new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("project"))
        .filter((project): project is string => project !== null);
    };
    let appPage: IndexArtifactsResult | undefined;
    const appFilters = await filtersDuring(async () => {
      appPage = IndexArtifactsResult.parse(await win.call("index.artifacts", { projectKey: app }));
    });
    expect(
      appPage?.entries.map((entry) => entry.appId),
      "both apps made in the app's place, a2's included, newest first",
    ).toEqual([appIdOf("one"), appIdOf("loose")]);
    expect(appPage?.entries.map((entry) => entry.projectKey)).toEqual([app, app]);
    expect(appFilters, "rosetta's filter would drop a2's app, so none is sent").toEqual([]);

    let otherPage: IndexArtifactsResult | undefined;
    const otherFilters = await filtersDuring(async () => {
      otherPage = IndexArtifactsResult.parse(
        await win.call("index.artifacts", { projectKey: other }),
      );
    });
    expect(otherPage?.entries.map((entry) => entry.appId)).toEqual([appIdOf("far")]);
    expect(
      otherFilters,
      "one rosetta project files every session that joins it: rosetta filters",
    ).toEqual(["p-other"]);

    // the fold's column reads the same rule: the shelf and the library list the same apps (MA-L10)
    const fold = IndexAppsResult.parse(await win.call("index.apps.list", { projectKey: app }));
    expect(fold.rows.map((row) => row.appId)).toEqual([appIdOf("one"), appIdOf("loose")]);

    // a peer daemon groups its own (DS-L4): its project is refused in words, never a blank
    await doorOf(A);
    const peer = await peerOn(A, "node-b", "dev-b");
    const refused = await peer.attempt("index.artifacts", { projectKey: app });
    expect(refused.ok, "a peer daemon's project narrows nothing here").toBe(false);
    if (!refused.ok) {
      expect(refused.error.data?.kind).toBe("PRECONDITION_FAILED");
      expect(refused.error.data?.details).toEqual({ principal: "peer-fieldd" });
    }
  }, 120_000);
});
