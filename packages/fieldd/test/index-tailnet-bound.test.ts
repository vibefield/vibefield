// SP-D13 (a), James, 2026-10-03 — the phone may search and list its own
// history, BOUNDED. `index.search` joined the tailnet preset, and a `tailnet`
// caller's answer on each history door is at most
// INDEX_TAILNET_LIMITS.MAX_ROWS rows however many it asks for: `index.search`
// (both arms), `index.sessions`' listing, `index.projects`, `index.recent`.
// The clamp is the DOOR's (daemon.ts, through tailnet-rows.ts), so rosettad is
// never asked for more, and the answer stays honest about the cut: a search
// says `clipped`, a listing hands back its `cursor`. A window keeps every
// door's own limit, and a self peer DAEMON is not bounded — it asks on behalf
// of a window on another desktop.
//
// The first block is the rule itself. The rest is ONE real daemon over the
// scripted rosettad (fixtures/fake-rosettad.mjs) holding 510 sessions in 510
// projects and 510 matching hits — more than a window's 500, so "the window
// keeps its 500" is a measurement and not a default — reached the three ways a
// caller arrives: the phone through the sidecar's door (a WhoIs login and no
// token), a window by a local token, and a peer daemon through the same door
// from a node the roster vouches for as a desktop (D1).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACTS_VERSION,
  INDEX_MESH,
  INDEX_TAILNET_LIMITS,
  IndexProjectResult,
  IndexProjectsResult,
  IndexRecentResult,
  IndexSearchResult,
  IndexSessionsResult,
  PEER_FIELDD_SCOPES,
  PRODUCT_API_LIMITS,
  type Principal,
  SOCKETS,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { DEFAULT_SEARCH_LIMIT } from "../src/agent-index";
import { bootstrap, type FielddDaemon } from "../src/index";
import { tailnetRowLimit } from "../src/tailnet-rows";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

const MAX = INDEX_TAILNET_LIMITS.MAX_ROWS;

// ── the rule ────────────────────────────────────────────────────────────────

const PHONE: Principal = { kind: "tailnet", login: TEST_LOGIN, self: true };
const GUEST: Principal = { kind: "tailnet-guest", login: "else@example.com" };
const OTHERS: Principal[] = [
  { kind: "local-token", tokenId: "tk-window", scopes: ["index.search"] },
  { kind: "shell-main", tokenId: "tk-shell", scopes: [] },
  { kind: "plugin", id: "plugin-a", scopes: ["index.search"] },
  { kind: "mcp-agent", sessionId: "mcp-a", scopes: ["index.search"] },
  { kind: "peer-fieldd", deviceId: "dev-c" },
];

describe("tailnetRowLimit — the SP-D13 rule", () => {
  it("bounds a tailnet caller's ask at MAX_ROWS, and its no-ask when the door's default is larger", () => {
    expect(tailnetRowLimit(PHONE, 500, DEFAULT_SEARCH_LIMIT)).toBe(MAX);
    expect(tailnetRowLimit(PHONE, MAX + 1, DEFAULT_SEARCH_LIMIT)).toBe(MAX);
    expect(tailnetRowLimit(PHONE, undefined, DEFAULT_SEARCH_LIMIT)).toBe(MAX);
  });

  it("leaves a smaller ask, and a door default below the bound, as they are", () => {
    expect(tailnetRowLimit(PHONE, 7, DEFAULT_SEARCH_LIMIT)).toBe(7);
    expect(tailnetRowLimit(PHONE, MAX, DEFAULT_SEARCH_LIMIT)).toBe(MAX);
    expect(tailnetRowLimit(PHONE, undefined, 20)).toBe(20);
  });

  it("bounds a guest the same way — no history door admits one, and none could hand it a window's limit", () => {
    expect(tailnetRowLimit(GUEST, 500, DEFAULT_SEARCH_LIMIT)).toBe(MAX);
    expect(tailnetRowLimit(GUEST, undefined, DEFAULT_SEARCH_LIMIT)).toBe(MAX);
  });

  it("passes every other caller's ask through untouched, a missing one included — the peer daemon deliberately", () => {
    for (const principal of OTHERS) {
      expect(tailnetRowLimit(principal, 500, DEFAULT_SEARCH_LIMIT), principal.kind).toBe(500);
      expect(
        tailnetRowLimit(principal, undefined, DEFAULT_SEARCH_LIMIT),
        principal.kind,
      ).toBeUndefined();
    }
  });
});

// ── the doors, on a real daemon ─────────────────────────────────────────────

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");
const ROWS = 510;
const WINDOW_ASK = 500;

/** rosetta's SessionRow, as the scripted daemon serves it: one top-level
 * session per project, each newer than the last */
const sessionRow = (i: number) => ({
  id: `s${i}`,
  native_session_id: `nat-${i}`,
  root_session_id: `s${i}`,
  parent_session_id: null,
  runtime_id: "rt-claude",
  project_id: `p${i}`,
  cwd: `/work/p${i}`,
  title: `title ${i}`,
  summary: null,
  started_at: 1_000,
  updated_at: 2_000 + i,
  activity: { first_at: 1_000, last_at: 10_000 + i },
  stream_state: "indexed",
  role: "primary",
  delegation: null,
});

/** every hit lands in ONE session, so the attribution walk is one lookup and
 * the counts below are the limits', never a walk's that ran out of time */
const hit = (i: number, word: string) => ({
  timeline_id: `t${i}`,
  session_id: "s0",
  kind: "user",
  at: 1_000 + i,
  snippet: `a [${word}] ${i}`,
  score: -1,
});
const RARE = 3;

/** Item 60 — one project's contribution: more rows than one 4 MiB answer holds
 * (about 190 B each here; item 60 measured 350 on rosettad's own) */
const CONTRIBUTION = 30_000;
const contributionRow = (i: number) => ({
  session_id: `c${i}`,
  project_id: "p0",
  commits: 0,
  edits: 0,
  loc: 0,
  messages: 1,
  tokens: 5,
  cost_micro_usd: null,
  billed_micro_usd: 12,
  unpriced_tokens: 0,
  unrecorded_output: 1,
  reported_cost_adjustment_micro_usd: -3,
});

let cleanup: Array<() => void | Promise<void>> = [];

interface World {
  daemon: FielddDaemon;
  mock: MockMgmtServer;
  /** the URLs the scripted rosettad was asked, in order */
  asked(): string[];
  phone: WsRpc;
  window: WsRpc;
  peer: WsRpc;
  phoneScopes: string[];
  peerScopes: string[];
}
let world: World;

/** The peer link's dialer: this world has one desktop, so nothing answers —
 * refused at once, which keeps the replica's retries off the network. */
class Unreachable extends WebSocket {
  constructor(_url: string) {
    super("ws://127.0.0.1:1/");
  }
}

async function open(
  url: string,
  headers?: Record<string, string>,
  maxPayload?: number,
): Promise<WsRpc> {
  const ws = new WebSocket(url, {
    ...(headers ? { headers } : {}),
    ...(maxPayload !== undefined ? { maxPayload } : {}),
  });
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.on("error", () => undefined);
  return new WsRpc(ws);
}

/** The door the way the SIDECAR delivers a tailnet caller: the route secret
 * joined, the WhoIs login (and, for a desktop, its node id) injected. */
async function tailnet(
  headers: Record<string, string>,
  clientKind: "ios" | "peer-fieldd",
  maxPayload?: number,
): Promise<{ rpc: WsRpc; granted: string[] }> {
  const { daemon, mock } = world;
  const rpc = await open(
    `ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`,
    headers,
    maxPayload,
  );
  const ack = (await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    ...(clientKind === "peer-fieldd" ? { deviceId: "dev-c" } : {}),
  })) as { grantedScopes: string[] };
  return { rpc, granted: ack.grantedScopes };
}

const queryOf = (url: string): URLSearchParams =>
  new URLSearchParams(url.slice(url.indexOf("?") + 1));

/** what the daemon asked rosettad while `act` ran, on routes starting `route` */
async function askedDuring(route: string, act: () => Promise<unknown>): Promise<string[]> {
  const before = world.asked().length;
  await act();
  return world
    .asked()
    .slice(before)
    .filter((url) => url.startsWith(route));
}

beforeAll(async () => {
  // a SHORT root: the mock mgmt socket must stay inside macOS's sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-sp13-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  // the desktop has an account: an unlinked one mints guests at the door
  writeLinkFixture(dataDir, TEST_LOGIN);
  const files = {
    sessions: join(dataDir, "sessions.json"),
    search: join(dataDir, "search.json"),
    runtimes: join(dataDir, "runtimes.json"),
    aggregates: join(dataDir, "aggregates.json"),
    log: join(dataDir, "requests.log"),
  };
  writeFileSync(
    files.aggregates,
    JSON.stringify({
      contribution: { rows: Array.from({ length: CONTRIBUTION }, (_, i) => contributionRow(i)) },
    }),
  );
  writeFileSync(
    files.sessions,
    JSON.stringify(Array.from({ length: ROWS }, (_, i) => sessionRow(i))),
  );
  writeFileSync(
    files.search,
    JSON.stringify({
      hits: [
        ...Array.from({ length: ROWS }, (_, i) => hit(i, "needle")),
        ...Array.from({ length: RARE }, (_, i) => hit(ROWS + i, "rare")),
      ],
    }),
  );
  writeFileSync(
    files.runtimes,
    JSON.stringify([
      { id: "rt-claude", kind: "claude-code", data_root: "~/.claude", enabled: true },
    ]),
  );
  writeFileSync(files.log, "");

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  // D1 — the roster vouches for a peer desktop, so a hello from its node is
  // minted `peer-fieldd` (the transport's fact, never the claim's)
  mock.meshPeers = [
    registryPeer({ nodeId: "node-c", deviceId: "dev-c", name: "device-c", login: TEST_LOGIN }),
  ];
  mock.storeSlices = new Map<string, unknown>([["dev-c", desktopSlice("dev-c", "device-c")]]);
  await mock.start();
  cleanup.push(() => mock.stop());

  const env = {
    FAKE_ROSETTAD_MODE: "ok",
    FAKE_ROSETTAD_SESSIONS: files.sessions,
    FAKE_ROSETTAD_SEARCH: files.search,
    FAKE_ROSETTAD_RUNTIMES: files.runtimes,
    FAKE_ROSETTAD_AGGREGATES: files.aggregates,
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

  // the index answers, the catalog has read it, the door is declared, the
  // mesh identity has arrived, and the roster calls dev-c a desktop
  await until(() => daemon.health().rosettad.phase === "ready", 15_000);
  await until(() => daemon.indexCatalog.ready, 30_000);
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  await until(() => daemon.devices.currentDeviceId() === mock.meshDeviceId, 15_000);
  await until(() => daemon.devices.isDocHost("dev-c"), 15_000);

  world = {
    daemon,
    mock,
    asked: () =>
      readFileSync(files.log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.slice(line.indexOf(" ") + 1)),
    phone: undefined as unknown as WsRpc,
    window: undefined as unknown as WsRpc,
    peer: undefined as unknown as WsRpc,
    phoneScopes: [],
    peerScopes: [],
  };
  const phone = await tailnet({ "Tailscale-User-Login": TEST_LOGIN }, "ios");
  const peer = await tailnet(
    { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-c" },
    "peer-fieldd",
  );
  const window = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(window, daemon.tokens.mint(["index.read", "index.search"], "sp13-window").token);
  world.phone = phone.rpc;
  world.phoneScopes = phone.granted;
  world.peer = peer.rpc;
  world.peerScopes = peer.granted;
  world.window = window;
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

describe("SP-D13 — the phone searches its own history, bounded at the door", () => {
  it("the phone is granted index.search by the preset; the catalog door stays the peer daemon's", async () => {
    expect(world.phoneScopes).toEqual([...TAILNET_SCOPES]);
    expect(world.phoneScopes).toContain("index.search");
    // the scope now passes, so what refuses the phone the replication door is
    // the HANDLER's kind gate (its details name the method, not a scope)
    const refused = await world.phone.callErr("index.catalog.subscribe", { table: "sessions" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.data?.details).toEqual({ method: "index.catalog.subscribe" });
  }, 30_000);

  it("index.search: an ask for 500 is answered MAX_ROWS hits, clipped — and rosettad was asked for no more", async () => {
    let answer: IndexSearchResult | undefined;
    const asked = await askedDuring("/api/search", async () => {
      answer = IndexSearchResult.parse(
        await world.phone.call("index.search", { q: "needle", limit: WINDOW_ASK }),
      );
    });
    expect(answer?.answered).toBe(true);
    expect(answer?.hits).toHaveLength(MAX);
    expect(answer?.clipped).toBe(true);
    expect(asked.map((url) => queryOf(url).get("limit"))).toEqual([String(MAX)]);
    // no ask at all: the door's default is bounded the same way
    const bare = IndexSearchResult.parse(await world.phone.call("index.search", { q: "needle" }));
    expect(bare.hits).toHaveLength(MAX);
    expect(bare.clipped).toBe(true);
    // and an answer the bound did not cut is not called clipped: the word
    // stays the service's, about what the index had
    const rare = IndexSearchResult.parse(
      await world.phone.call("index.search", { q: "rare", limit: WINDOW_ASK }),
    );
    expect(rare.hits).toHaveLength(RARE);
    expect(rare.clipped).toBe(false);
  }, 30_000);

  it("index.search {scope: mesh}: the asking arm forwards the same bound and cuts the merge at it", async () => {
    const self = world.mock.meshDeviceId;
    const answer = IndexSearchResult.parse(
      await world.phone.call("index.search", {
        q: "needle",
        scope: "mesh",
        devices: [self],
        limit: WINDOW_ASK,
      }),
    );
    expect(answer.hits).toHaveLength(MAX);
    expect(answer.clipped).toBe(true);
    expect(answer.sources).toEqual([
      expect.objectContaining({ device: self, state: "answered", clipped: true }),
    ]);
  }, 30_000);

  it("index.sessions' listing: a page of MAX_ROWS whose cursor pages on — a page, never a cut", async () => {
    const first = IndexSessionsResult.parse(
      await world.phone.call("index.sessions", { limit: WINDOW_ASK }),
    );
    expect(first.rows).toHaveLength(MAX);
    expect(first.cursor).toBeDefined();
    const second = IndexSessionsResult.parse(
      await world.phone.call("index.sessions", { limit: WINDOW_ASK, cursor: first.cursor }),
    );
    expect(second.rows).toHaveLength(MAX);
    // the order a window reads, picked up exactly where the first page stopped
    const whole = IndexSessionsResult.parse(
      await world.window.call("index.sessions", { limit: 2 * MAX }),
    );
    expect([...first.rows, ...second.rows].map((row) => row.sessionId)).toEqual(
      whole.rows.map((row) => row.sessionId),
    );
  }, 30_000);

  it("index.projects: a page of MAX_ROWS and its cursor", async () => {
    const page = IndexProjectsResult.parse(
      await world.phone.call("index.projects", { limit: WINDOW_ASK }),
    );
    expect(page.rows).toHaveLength(MAX);
    expect(page.cursor).toBeDefined();
  }, 30_000);

  it("index.recent: MAX_ROWS sessions — and rosettad was asked for no more", async () => {
    let recent: IndexRecentResult | undefined;
    const asked = await askedDuring("/api/sessions?limit=", async () => {
      recent = IndexRecentResult.parse(
        await world.phone.call("index.recent", { scope: "all", limit: WINDOW_ASK }),
      );
    });
    expect(recent?.rows).toHaveLength(MAX);
    expect(asked.map((url) => queryOf(url).get("limit"))).toEqual([String(MAX)]);
  }, 30_000);

  it("a window keeps every door's own limit: 500 of the 510, and the search door's own default", async () => {
    const search = IndexSearchResult.parse(
      await world.window.call("index.search", { q: "needle", limit: WINDOW_ASK }),
    );
    expect(search.hits).toHaveLength(WINDOW_ASK);
    expect(search.clipped).toBe(true);
    const bare = IndexSearchResult.parse(await world.window.call("index.search", { q: "needle" }));
    expect(bare.hits).toHaveLength(DEFAULT_SEARCH_LIMIT);
    const sessions = IndexSessionsResult.parse(
      await world.window.call("index.sessions", { limit: WINDOW_ASK }),
    );
    expect(sessions.rows).toHaveLength(WINDOW_ASK);
    expect(sessions.cursor).toBeDefined();
    const projects = IndexProjectsResult.parse(
      await world.window.call("index.projects", { limit: WINDOW_ASK }),
    );
    expect(projects.rows).toHaveLength(WINDOW_ASK);
    const recent = IndexRecentResult.parse(
      await world.window.call("index.recent", { scope: "all", limit: WINDOW_ASK }),
    );
    expect(recent.rows).toHaveLength(WINDOW_ASK);
  }, 30_000);

  it("a self peer DAEMON is not bounded: it asks on behalf of a window on another desktop", async () => {
    // it IS the peer daemon — the presets are equal since SP-D13, so the
    // witness is the door only a peer is served, not the grant
    expect(world.peerScopes).toEqual([...PEER_FIELDD_SCOPES]);
    const catalog = (await world.peer.call("index.catalog.subscribe", { table: "sessions" })) as {
      subId: string;
    };
    expect(typeof catalog.subId).toBe("string");
    const search = IndexSearchResult.parse(
      await world.peer.call("index.search", { q: "needle", limit: WINDOW_ASK }),
    );
    expect(search.hits).toHaveLength(WINDOW_ASK);
    const sessions = IndexSessionsResult.parse(
      await world.peer.call("index.sessions", { limit: WINDOW_ASK }),
    );
    expect(sessions.rows).toHaveLength(WINDOW_ASK);
    const projects = IndexProjectsResult.parse(
      await world.peer.call("index.projects", { limit: WINDOW_ASK }),
    );
    expect(projects.rows).toHaveLength(WINDOW_ASK);
    // the launcher's list stays this desktop's: the D36 wall refuses a `local`
    // door to a peer before any limit is read
    const refused = await world.peer.callErr("index.recent", { scope: "all", limit: WINDOW_ASK });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);
});

describe("item 60 — rows follow the asker, bytes follow the link: index.project", () => {
  it("a peer daemon's answer stops at PEER_ANSWER_BYTES and says clipped and how many it omitted; a window gets every row; the phone's row cut says its count too", async () => {
    const order = (answer: IndexProjectResult) => answer.contribution.map((row) => row.sessionId);
    const firstN = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

    const all = IndexProjectResult.parse(
      await world.window.call("index.project", { projectId: "p0" }),
    );
    expect(all.contribution).toHaveLength(CONTRIBUTION);
    expect(all.clipped).toBe(false);
    expect(all.omitted).toBeUndefined();

    // a peer read the way PeerLink reads: a frame past its 4 MiB closes it
    const capped = await tailnet(
      { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-c" },
      "peer-fieldd",
      PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES,
    );
    // whichever comes first; neither branch rejects, so the loser cannot either
    const first = await Promise.race([
      capped.rpc.call("index.project", { projectId: "p0" }).then((value) => ({ value })),
      until(() => capped.rpc.closed, 30_000).then(
        () => "closed" as const,
        () => "open" as const,
      ),
    ]);
    if (typeof first === "string")
      throw new Error("the capped peer closed: an answer past its 4 MiB");
    const raw = first.value;
    const bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
    expect(bytes).toBeLessThanOrEqual(INDEX_MESH.PEER_ANSWER_BYTES);
    const peer = IndexProjectResult.parse(raw);
    expect(peer.clipped).toBe(true);
    expect(peer.contribution.length).toBeGreaterThan(0);
    expect(peer.omitted).toBe(CONTRIBUTION - peer.contribution.length);
    expect(order(peer)).toEqual(firstN(peer.contribution.length));
    // the budget is spent, not padded: one more row would not have fitted
    expect(bytes + 200).toBeGreaterThan(INDEX_MESH.PEER_ANSWER_BYTES);

    const phone = IndexProjectResult.parse(
      await world.phone.call("index.project", { projectId: "p0" }),
    );
    expect(order(phone)).toEqual(firstN(INDEX_TAILNET_LIMITS.MAX_ROWS));
    expect(phone.clipped).toBe(true);
    expect(phone.omitted).toBe(CONTRIBUTION - INDEX_TAILNET_LIMITS.MAX_ROWS);
  }, 60_000);
});
