// AR-8b (thinking-ar-history-room.md §3) — the History room's three reads
// THROUGH fieldd: `index.session` (one session's header row), `index.project`
// (a project's panels folded into one answer) and `index.projectDay` (one
// day's hours), against the scripted rosettad started — as every rosettad is
// now — behind a bearer and a grant key. The rows are about what an answer
// MEANS: the projection and its joins, the honest refusals (NOT_FOUND, the
// `building` of a projection not yet published, a body fieldd cannot vouch
// for), the wire fieldd actually sent (read back from the fake's request
// log), SP-D13's bound for the phone, and that every dial fieldd makes to
// rosettad — these doors', the older ones' and the catalog's stream —
// carries the bearer (read back from the fake's decision log).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACTS_VERSION,
  INDEX_TAILNET_LIMITS,
  IndexProjectDayResult,
  IndexProjectResult,
  IndexSessionResult,
  type Scope,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");

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

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  native_session_id: `nat-${id}`,
  runtime_id: "rt-claude",
  project_id: "p1",
  cwd: "/w/one",
  parent_session_id: null,
  delegation: null,
  root_session_id: id,
  role: "main",
  title: `title ${id}`,
  summary: null,
  started_at: 10_000,
  updated_at: 20_000,
  activity: { first_at: 11_000, last_at: 19_000 },
  stream_state: "indexed",
  ...over,
});

const SESSIONS = [
  row("s1", { summary: "the first run" }),
  // a delegated child: its header names its parent and rolls up to its root
  row("c1", {
    parent_session_id: "s1",
    root_session_id: "s1",
    role: "subagent",
    activity: null,
    stream_state: "streaming",
  }),
  // a session with no workspace: no project, nothing to name
  row("s2", { project_id: null, runtime_id: "rt-unmapped" }),
];

/** a row rosetta could never have written: no stream state */
const BAD = { ...row("bad"), stream_state: undefined };

const PROJECTS = [{ id: "p1", name: "one", root_paths: ["/w/one"], git_repo: null }];

const RUNTIMES = [
  {
    id: "rt-claude",
    kind: "claude-code",
    data_root: "~/.claude",
    enabled: true,
    account: null,
    config: null,
    skills: null,
    versions_seen: null,
    discovered_at: 1,
  },
  {
    id: "rt-unmapped",
    kind: "no-catalog-row",
    data_root: "~/.nothing",
    enabled: true,
    account: null,
    config: null,
    skills: null,
    versions_seen: null,
    discovered_at: 1,
  },
];

interface World {
  daemon: FielddDaemon;
  mock: MockMgmtServer;
  /** the routes (with queries) the fake was asked, in order */
  asked(): string[];
  /** the fake's credential decisions: `<METHOD> <path> <credential> <verdict>` */
  decisions(): string[];
  /** rescript the aggregates (re-read per request) */
  aggregates(value: unknown): void;
  /** rescript the session rows (re-read per request) */
  sessions(value: unknown): void;
}

async function setup(opts: { mode?: string; aggregates?: unknown } = {}): Promise<World> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ixh-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  const files = {
    sessions: join(dataDir, "sessions.json"),
    projects: join(dataDir, "projects.json"),
    runtimes: join(dataDir, "runtimes.json"),
    aggregates: join(dataDir, "aggregates.json"),
    requests: join(dataDir, "requests.log"),
    decisions: join(dataDir, "auth.log"),
  };
  writeFileSync(files.sessions, JSON.stringify(SESSIONS));
  writeFileSync(files.projects, JSON.stringify(PROJECTS));
  writeFileSync(files.runtimes, JSON.stringify(RUNTIMES));
  writeFileSync(files.aggregates, JSON.stringify(opts.aggregates ?? {}));
  writeFileSync(files.requests, "");
  writeFileSync(files.decisions, "");
  const fakeRosettad = ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: {
        ...process.env,
        FAKE_ROSETTAD_MODE: opts.mode ?? "ok",
        FAKE_ROSETTAD_SESSIONS: files.sessions,
        FAKE_ROSETTAD_PROJECTS: files.projects,
        FAKE_ROSETTAD_RUNTIMES: files.runtimes,
        FAKE_ROSETTAD_AGGREGATES: files.aggregates,
        FAKE_ROSETTAD_REQUEST_LOG: files.requests,
        FAKE_ROSETTAD_AUTH_LOG: files.decisions,
      },
    })) as unknown as typeof spawn;
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeRosettad,
    rosettadHome: home,
  });
  cleanup.push(() => daemon.stop());
  const lines = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  return {
    daemon,
    mock,
    asked: () => lines(files.requests).map((line) => line.slice(line.indexOf(" ") + 1)),
    decisions: () => lines(files.decisions),
    aggregates: (value) => writeFileSync(files.aggregates, JSON.stringify(value)),
    sessions: (value) => writeFileSync(files.sessions, JSON.stringify(value)),
  };
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

async function windowOf(daemon: FielddDaemon, scopes: Scope[]): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(rpc, daemon.tokens.mint(scopes, "ixh-window").token);
  return rpc;
}

async function phoneOf(daemon: FielddDaemon, mock: MockMgmtServer): Promise<WsRpc> {
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
    "Tailscale-User-Login": TEST_LOGIN,
  });
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
}

async function ready(daemon: FielddDaemon): Promise<void> {
  await until(() => daemon.health().rosettad.phase === "ready", 10_000);
}

const figures = {
  tokens: 5,
  cost_micro_usd: null,
  billed_micro_usd: 12,
  unpriced_tokens: 0,
  unrecorded_output: 1,
  reported_cost_adjustment_micro_usd: -3,
};

describe("index.session — one session's header row (AR-8b)", () => {
  it("answers the row with its joins: the catalog agent, the project's name, the parent of a delegated child", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.search"]);
    const s1 = IndexSessionResult.parse(await win.call("index.session", { sessionId: "s1" }));
    expect(s1.session).toEqual({
      sessionId: "s1",
      nativeSessionId: "nat-s1",
      rootSessionId: "s1",
      title: "title s1",
      summary: "the first run",
      cwd: "/w/one",
      updatedAt: 20_000,
      activity: { firstAt: 11_000, lastAt: 19_000 },
      streamState: "indexed",
      projectId: "p1",
      provider: "claude",
      startedAt: 10_000,
      project: { id: "p1", name: "one" },
    });
    const child = IndexSessionResult.parse(await win.call("index.session", { sessionId: "c1" }));
    expect(child.session).toMatchObject({
      sessionId: "c1",
      rootSessionId: "s1",
      parentSessionId: "s1",
      activity: null,
      streamState: "streaming",
    });
    // no workspace, no catalog row for its kind: absent, never a placeholder
    const s2 = IndexSessionResult.parse(await win.call("index.session", { sessionId: "s2" }));
    expect(s2.session).not.toHaveProperty("project");
    expect(s2.session).not.toHaveProperty("projectId");
    expect(s2.session).not.toHaveProperty("provider");
    // the one GET by canonical id, percent-encoded into one segment
    expect(world.asked()).toContain("/api/sessions/s1");
  }, 30_000);

  it("a session the index does not hold is NOT_FOUND; a row it cannot vouch for is malformed; a bad ask is the caller's", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.search"]);
    const missing = await win.callErr("index.session", { sessionId: "nope/../s1" });
    expect(missing.data).toMatchObject({ kind: "NOT_FOUND", retryable: false });
    expect(world.asked()).toContain("/api/sessions/nope%2F..%2Fs1");
    world.sessions([...SESSIONS, BAD]);
    const bad = await win.callErr("index.session", { sessionId: "bad" });
    expect(bad.data).toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "index", state: "malformed" },
    });
    expect((await win.callErr("index.session", {})).data?.kind).toBe("PRECONDITION_FAILED");
    expect((await win.callErr("index.session", { sessionId: "" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
  }, 30_000);
});

describe("index.project — a project's panels in one answer (AR-8b, AR-D39 (a))", () => {
  it("folds the heatmap, its decomposition and the contribution, over the window asked, in VibeField's spelling", async () => {
    const world = await setup({
      aggregates: {
        heatmap: { days: [{ day: "2026-09-30", ...figures }], unread: "rides" },
        usage: {
          models: [{ day: "2026-09-30", model: "unknown", ...figures }],
          hours: [{ hour: 23, ...figures }],
        },
        contribution: {
          rows: [
            {
              session_id: "s1",
              project_id: "p1",
              commits: 1,
              edits: 2,
              loc: 30,
              messages: 41,
              ...figures,
            },
            {
              session_id: "s9",
              project_id: null,
              commits: 0,
              edits: 0,
              loc: 0,
              messages: 1,
              ...figures,
            },
          ],
        },
      },
    });
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.search"]);
    const before = world.asked().length;
    const answer = IndexProjectResult.parse(
      await win.call("index.project", {
        projectId: "p 1",
        sinceMs: 1_756_166_400_000,
        offsetMinutes: -420,
      }),
    );
    // the three bearer-only routes, in one flight, the window on two of them
    expect(world.asked().slice(before).sort()).toEqual([
      "/api/projects/p%201/contribution",
      "/api/projects/p%201/heatmap?since_ms=1756166400000&offset_minutes=-420",
      "/api/projects/p%201/usage?since_ms=1756166400000&offset_minutes=-420",
    ]);
    const projected = {
      tokens: 5,
      costMicroUsd: null,
      billedMicroUsd: 12,
      unpricedTokens: 0,
      unrecordedOutput: 1,
      reportedCostAdjustmentMicroUsd: -3,
    };
    expect(answer).toEqual({
      projectId: "p 1",
      heatmap: [{ day: "2026-09-30", ...projected }],
      usage: {
        models: [{ day: "2026-09-30", model: "unknown", ...projected }],
        hours: [{ hour: 23, ...projected }],
      },
      contribution: [
        {
          sessionId: "s1",
          projectId: "p1",
          commits: 1,
          edits: 2,
          loc: 30,
          messages: 41,
          ...projected,
        },
        // rosetta's unassigned bucket: a null project, never an empty string
        {
          sessionId: "s9",
          projectId: null,
          commits: 0,
          edits: 0,
          loc: 0,
          messages: 1,
          ...projected,
        },
      ],
      clipped: false,
    });
    // a window asked with no window: rosetta's defaults, so no query at all
    await win.call("index.project", { projectId: "p1" });
    expect(world.asked()).toContain("/api/projects/p1/heatmap");
    // never the daemon's origin (EL7) — the answer is figures and ids
    const origin = world.daemon.rosettad?.state().origin as string;
    expect(JSON.stringify(answer)).not.toContain(new URL(origin).port);
  }, 30_000);

  it("rosetta's 503 before canonical publication is the honest `building`; a body fieldd cannot vouch for is `malformed`", async () => {
    const world = await setup({ aggregates: { status: 503 } });
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.search"]);
    const building = await win.callErr("index.project", { projectId: "p1" });
    expect(building.data).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "index", state: "building" },
    });
    world.aggregates({ heatmap: { days: [{ day: "2026-09-30", tokens: "lots" }] } });
    const malformed = await win.callErr("index.project", { projectId: "p1" });
    expect(malformed.data).toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "index", state: "malformed" },
    });
    // the ask is held to what rosetta answers before anything is asked (read
    // by what each bad ask WOULD have sent: the malformed answer above failed
    // its flight at the first body, and the other two GETs may still land)
    for (const ask of [
      { projectId: "" },
      { projectId: "p1", offsetMinutes: 900 },
      { projectId: "p1", sinceMs: -1 },
    ]) {
      expect((await win.callErr("index.project", ask)).data?.kind, JSON.stringify(ask)).toBe(
        "PRECONDITION_FAILED",
      );
    }
    expect(
      world
        .asked()
        .filter(
          (url) =>
            url.startsWith("/api/projects//") ||
            url.includes("offset_minutes=900") ||
            url.includes("since_ms=-1"),
        ),
    ).toEqual([]);
  }, 30_000);

  it("SP-D13: the phone's contribution rows stop at the tailnet bound and say clipped; a window gets every row", async () => {
    const rows = Array.from({ length: INDEX_TAILNET_LIMITS.MAX_ROWS + 50 }, (_, i) => ({
      session_id: `s${i}`,
      project_id: "p1",
      commits: 0,
      edits: 0,
      loc: 0,
      messages: 1,
      ...figures,
    }));
    const world = await setup({ aggregates: { contribution: { rows } } });
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.search"]);
    const all = IndexProjectResult.parse(await win.call("index.project", { projectId: "p1" }));
    expect(all.contribution).toHaveLength(rows.length);
    expect(all.clipped).toBe(false);
    const phone = await phoneOf(world.daemon, world.mock);
    const bounded = IndexProjectResult.parse(
      await phone.call("index.project", { projectId: "p1" }),
    );
    expect(bounded.contribution).toHaveLength(INDEX_TAILNET_LIMITS.MAX_ROWS);
    expect(bounded.contribution.map((r) => r.sessionId)).toEqual(
      rows.slice(0, INDEX_TAILNET_LIMITS.MAX_ROWS).map((r) => r.session_id),
    );
    expect(bounded.clipped).toBe(true);
  }, 30_000);
});

describe("index.projectDay — one day's hours (AR-8b)", () => {
  it("asks rosetta's day route with the day and offset, and refuses a day that is not a date before asking", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.search"]);
    const day = IndexProjectDayResult.parse(
      await win.call("index.projectDay", {
        projectId: "p1",
        day: "2026-09-30",
        offsetMinutes: 120,
      }),
    );
    expect(day).toEqual({
      projectId: "p1",
      day: "2026-09-30",
      models: [{ hour: 16, model: "claude-opus-5-5", tokens: 123 }],
    });
    expect(world.asked().at(-1)).toBe(
      "/api/projects/p1/usage/day?day=2026-09-30&offset_minutes=120",
    );
    const bad = ["2026-02-30", "2026-9-30", "today"];
    for (const day of bad) {
      expect(
        (await win.callErr("index.projectDay", { projectId: "p1", day })).data?.kind,
        day,
      ).toBe("PRECONDITION_FAILED");
    }
    expect(world.asked().filter((url) => bad.some((day) => url.includes(`day=${day}`)))).toEqual(
      [],
    );
  }, 30_000);
});

describe("the doors' gates (AR-8b)", () => {
  it("each rides index.search: a caller holding only the census scope is refused", async () => {
    const world = await setup();
    await ready(world.daemon);
    const census = await windowOf(world.daemon, ["index.read"]);
    for (const [method, params] of [
      ["index.session", { sessionId: "s1" }],
      ["index.project", { projectId: "p1" }],
      ["index.projectDay", { projectId: "p1", day: "2026-09-30" }],
    ] as const) {
      const refused = await census.callErr(method, params);
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.data?.details, method).toEqual({ required: "index.search" });
    }
  }, 30_000);

  it("no daemon ready: the doors answer the index's phase, never a blank", async () => {
    const world = await setup({ mode: "silent" });
    const win = await windowOf(world.daemon, ["index.search"]);
    for (const [method, params] of [
      ["index.session", { sessionId: "s1" }],
      ["index.project", { projectId: "p1" }],
      ["index.projectDay", { projectId: "p1", day: "2026-09-30" }],
    ] as const) {
      const refused = await win.callErr(method, params);
      expect(refused.data, method).toMatchObject({
        kind: "UNAVAILABLE",
        details: { service: "index", state: "starting" },
      });
    }
  }, 30_000);

  it("every dial fieldd makes to rosettad carries the bearer — these doors, the older ones, the catalog's stream", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.read", "index.search"]);
    await win.call("index.status", {});
    await win.call("index.discoveries", {});
    await win.call("index.sessions", { nativeSessionIds: ["nat-s1"] });
    await win.call("index.search", { q: "x" });
    await win.call("index.recent", { scope: "all" });
    await win.call("index.session", { sessionId: "s1" });
    await win.call("index.project", { projectId: "p1" });
    await win.call("index.projectDay", { projectId: "p1", day: "2026-09-30" });
    await until(() => world.decisions().some((line) => line.includes(" /ws/meta ")), 10_000);
    const decisions = world.decisions();
    for (const route of [
      "/api/status",
      "/api/discoveries",
      "/api/runtimes",
      "/api/sessions",
      "/api/search",
      "/api/projects",
      "/api/sessions/s1",
      "/api/projects/p1/heatmap",
      "/api/projects/p1/usage",
      "/api/projects/p1/contribution",
      "/api/projects/p1/usage/day",
      "/ws/meta",
    ]) {
      expect(
        decisions.some((line) => line.startsWith(`GET ${route} bearer ok`)),
        route,
      ).toBe(true);
    }
    // and nothing went without it, or with a bearer the daemon did not take
    expect(decisions.filter((line) => !line.endsWith(" bearer ok"))).toEqual([]);
  }, 30_000);
});
