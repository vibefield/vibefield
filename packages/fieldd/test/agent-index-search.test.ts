// AR-5e — the find sheet's doors THROUGH fieldd (`index.sessions`,
// `index.search`; thinking-ar-views-port.md §6.3): a real daemon, a real
// window token, and the scripted rosettad answering the two routes the
// reference client asks. The rows here are about what an ANSWER means — a
// daemon that cannot answer says so, a scoped question never answers outside
// its scope, and a body fieldd cannot vouch for is a refusal, not "no
// matches" — plus the wire fieldd actually sent, read back from the fake's
// request log.
//
// The last block runs both doors against the REAL rosettad when
// FIELDD_ROSETTAD_BIN names it, over rosetta's own ground-truth transcript.
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACTS_VERSION,
  IndexSearchResult,
  IndexSessionsResult,
  type IndexStatus,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { ProductApi } from "../src/product-api";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** `until` for an async predicate (the doors are the only way to look). */
async function untilAsync(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`untilAsync: condition not met within ${ms}ms`);
}

/** The scripted world: two top-level runs, a third the scope never names, and
 * one delegated child of the first (the hit that must answer for its root). */
const SESSIONS = [
  {
    id: "s1",
    native_session_id: "nat-1",
    runtime_id: "rt1",
    project_id: "p1",
    cwd: "/w/one",
    parent_session_id: null,
    delegation: null,
    root_session_id: "s1",
    role: "main",
    title: "First",
    summary: "The first run",
    started_at: 10_000,
    updated_at: 20_000,
    activity: { first_at: 11_000, last_at: 19_000 },
    stream_state: "indexed",
  },
  {
    id: "s2",
    native_session_id: "nat-2",
    runtime_id: "rt1",
    project_id: null,
    cwd: null,
    parent_session_id: null,
    delegation: null,
    root_session_id: "s2",
    role: "main",
    title: "Second",
    summary: null,
    started_at: 10_000,
    updated_at: 21_000,
    activity: null,
    stream_state: "streaming",
  },
  {
    id: "s3",
    native_session_id: "nat-3",
    runtime_id: "rt1",
    project_id: null,
    cwd: null,
    parent_session_id: null,
    delegation: null,
    root_session_id: "s3",
    role: "main",
    title: "Third",
    summary: null,
    started_at: 10_000,
    updated_at: 22_000,
    activity: null,
    stream_state: "indexed",
  },
  {
    id: "c1",
    native_session_id: "nat-child",
    runtime_id: "rt1",
    project_id: null,
    cwd: null,
    parent_session_id: "s1",
    delegation: null,
    root_session_id: "s1",
    role: "subagent",
    title: "A delegated child",
    summary: null,
    started_at: 12_000,
    updated_at: 18_000,
    activity: { first_at: 12_000, last_at: 18_000 },
    stream_state: "indexed",
  },
];

const HITS = [
  {
    timeline_id: "t1",
    session_id: "s1",
    kind: "user",
    at: 1_000,
    snippet: "[needle] in a haystack",
    score: -1.5,
  },
  {
    timeline_id: "t2",
    session_id: "s2",
    kind: "agent",
    at: 2_000,
    snippet: "another [needle] here",
    score: -1.2,
  },
  {
    timeline_id: "t3",
    session_id: "s3",
    kind: "user",
    at: 3_000,
    snippet: "a [needle] out of scope",
    score: -1.1,
  },
  {
    timeline_id: "t4",
    session_id: "c1",
    kind: "agent",
    at: 4_000,
    snippet: "a [needle] inside a child",
    score: -1,
  },
];

interface World {
  daemon: FielddDaemon;
  dataDir: string;
  /** the query strings the fake was asked, in order */
  asked(): string[];
}

async function setup(
  config: {
    mode?: string;
    sessions?: unknown;
    search?: unknown;
    /** spawn the real binary against an empty home (the opt-in live rows) */
    rosettadBin?: string;
    real?: boolean;
    seedClaudeHome?: string;
  } = {},
): Promise<World> {
  // a SHORT root: the mock mgmt socket must stay inside macOS's 104-byte
  // sun_path (the AR-5-0 lesson)
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ixs-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const sessionsFile = join(dataDir, "sessions.json");
  const searchFile = join(dataDir, "search.json");
  const logFile = join(dataDir, "requests.log");
  writeFileSync(sessionsFile, JSON.stringify(config.sessions ?? SESSIONS));
  writeFileSync(searchFile, JSON.stringify(config.search ?? { hits: HITS }));
  writeFileSync(logFile, "");
  const env = {
    FAKE_ROSETTAD_MODE: config.mode ?? "ok",
    FAKE_ROSETTAD_SESSIONS: sessionsFile,
    FAKE_ROSETTAD_SEARCH: searchFile,
    FAKE_ROSETTAD_REQUEST_LOG: logFile,
  };
  const fakeSpawner = ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: { ...process.env, ...env },
    })) as unknown as typeof spawn;

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  if (config.seedClaudeHome !== undefined) {
    cpSync(config.seedClaudeHome, join(home, ".claude"), { recursive: true });
  }
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    rosettadBin: config.rosettadBin ?? "/stand-in/rosettad",
    ...(config.real ? {} : { rosettadSpawn: fakeSpawner }),
    rosettadHome: home,
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return {
    daemon,
    dataDir,
    asked: () =>
      readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.slice(line.indexOf(" ") + 1)),
  };
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

/** A renderer window token holding exactly `scopes` (the shell mints it). */
async function windowToken(daemon: FielddDaemon, scopes: string[], suffix: string): Promise<WsRpc> {
  const shell = await openRpc(daemon.controlPort);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: {
      participantId: `renderer:desktop-test:window-${suffix}`,
      incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
    },
  })) as { token: string };
  const win = await openRpc(daemon.controlPort);
  await helloAs(win, minted.token);
  return win;
}

/** the daemon ready and the index live (the fake goes live once consented —
 * with no enrolled kinds it still serves every route) */
async function ready(daemon: FielddDaemon): Promise<void> {
  await until(() => daemon.health().rosettad.phase === "ready", 8_000);
}

const queryOf = (url: string): URLSearchParams =>
  new URLSearchParams(url.slice(url.indexOf("?") + 1));

const searchesIn = (urls: string[]): string[] =>
  urls.filter((url) => url.startsWith("/api/search"));

describe("index.sessions — the facts lane's lookup (AR-5e)", () => {
  it("asks ONE comma list for three native ids and answers a projection, in the caller's order", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "s1");
    const before = world.asked().length;
    // parsed under the contract on the producer's side (EL9), not cast
    const result = IndexSessionsResult.parse(
      await win.call("index.sessions", { nativeSessionIds: ["nat-2", "nat-1", "nat-unknown"] }),
    );

    const asked = world.asked().slice(before);
    expect(asked).toHaveLength(1);
    expect(queryOf(asked[0] as string).get("native_session_id")).toBe("nat-2,nat-1,nat-unknown");
    // the caller's order, and a native id the index never read is ABSENT
    expect(result.rows.map((row) => row.sessionId)).toEqual(["s2", "s1"]);
    expect(result.rows[1]).toEqual({
      sessionId: "s1",
      nativeSessionId: "nat-1",
      rootSessionId: "s1",
      title: "First",
      summary: "The first run",
      cwd: "/w/one",
      updatedAt: 20_000,
      activity: { firstAt: 11_000, lastAt: 19_000 },
      streamState: "indexed",
    });
    // rosetta's nulls are absences, not empty strings a sheet would draw
    expect(result.rows[0]).not.toHaveProperty("cwd");
    expect(result.rows[0]?.activity).toBeNull();
  });

  it("chunks an ask wider than 64 ids and merges the answers", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "s2");
    const before = world.asked().length;
    const ids = [...Array.from({ length: 69 }, (_, i) => `nat-filler-${i}`), "nat-1"];
    const result = (await win.call("index.sessions", {
      nativeSessionIds: ids,
    })) as IndexSessionsResult;

    const asked = world.asked().slice(before);
    expect(asked).toHaveLength(2);
    expect(
      queryOf(asked[0] as string)
        .get("native_session_id")
        ?.split(","),
    ).toHaveLength(64);
    expect(
      queryOf(asked[1] as string)
        .get("native_session_id")
        ?.split(","),
    ).toHaveLength(6);
    expect(result.rows.map((row) => row.sessionId)).toEqual(["s1"]);
  });

  it("an index that is not ready refuses the lookup — the honest phase, before the wire", async () => {
    const world = await setup({ mode: "silent" });
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "s3");
    const before = world.asked().length;
    const error = await win.callErr("index.sessions", { nativeSessionIds: ["nat-1"] });
    expect(error.data?.kind).toBe("UNAVAILABLE");
    expect(error.data?.details).toMatchObject({ service: "index" });
    // BEFORE the wire: the honest early refusal, not a late one dressed the
    // same (deleting `requireReady` passed this row until it asked)
    expect(world.asked().length).toBe(before);
  });
});

describe("index.search — one question over the history (AR-5e)", () => {
  it("scopes to the live runs' canonical roots, forwards prefix, and joins each hit to its run", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q1");
    const before = world.asked().length;
    const result = IndexSearchResult.parse(
      await win.call("index.search", { q: "needle", nativeSessionIds: ["nat-1", "nat-2"] }),
    );

    const search = searchesIn(world.asked().slice(before));
    expect(search).toHaveLength(1);
    const query = queryOf(search[0] as string);
    expect(query.get("q")).toBe("needle");
    expect(query.get("sessions")).toBe("s1,s2");
    expect(query.get("prefix")).toBe("true");
    expect(query.get("limit")).toBe("300");
    expect(query.get("kind")).toBeNull();

    expect(result.answered).toBe(true);
    expect(result.clipped).toBe(false);
    expect(result.state.readiness).toBe("ready");
    // s3 is outside the scope and never answers; the child's hit answers for
    // the ROOT the reader navigates to, with the root's native id
    expect(result.hits.map((hit) => hit.sessionId).sort()).toEqual(["c1", "s1", "s2"]);
    expect(result.hits.find((hit) => hit.sessionId === "s1")).toEqual({
      sessionId: "s1",
      rootSessionId: "s1",
      nativeSessionId: "nat-1",
      title: "First",
      timelineId: "t1",
      kind: "user",
      at: 1_000,
      snippet: "[needle] in a haystack",
    });
    expect(result.hits.find((hit) => hit.sessionId === "c1")).toMatchObject({
      rootSessionId: "s1",
      nativeSessionId: "nat-1",
      title: "First",
      timelineId: "t4",
    });
  });

  it("kind and the other filters ride through as the caller asked them", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q2");
    const before = world.asked().length;
    const result = (await win.call("index.search", {
      q: "needle",
      nativeSessionIds: ["nat-1", "nat-2"],
      kind: "user",
      prefix: false,
      limit: 2,
      afterMs: 500,
    })) as IndexSearchResult;

    const query = queryOf(searchesIn(world.asked().slice(before))[0] as string);
    expect(query.get("kind")).toBe("user");
    expect(query.get("prefix")).toBe("false");
    expect(query.get("limit")).toBe("2");
    expect(query.get("after_ts")).toBe("500");
    // only the user-side hit inside the scope survives
    expect(result.hits.map((hit) => hit.timelineId)).toEqual(["t1"]);
    expect(result.answered).toBe(true);
  });

  it("a building projection has NO answer: never an empty one a sheet would read as `no matches`", async () => {
    const world = await setup({
      search: {
        readiness: "building",
        canonical_ready: false,
        progress: { documents_done: 3, documents_total: 9 },
        hits: HITS,
      },
    });
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q3");
    const result = (await win.call("index.search", {
      q: "needle",
      nativeSessionIds: ["nat-1"],
    })) as IndexSearchResult;
    expect(result.answered).toBe(false);
    expect(result.hits).toEqual([]);
    expect(result.state.readiness).toBe("building");
    expect(result.state.progress).toEqual({ done: 3, total: 9 });
    // and the same state is what the sheet's foot reads off the status door
    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(status.search).toMatchObject({
      reachable: true,
      readiness: "building",
      canonicalReady: false,
      capabilities: { sessionScope: true, prefix: true },
    });
  });

  it("a scope the index has never read stays UNANSWERED while the projection is building (the readiness edge)", async () => {
    // The row that pins `scopeUnknown`'s other branch: over a building index an
    // unknown scope must not read as "no matches" (the mutation `answered = true`
    // passed the ready-only row).
    const world = await setup({
      search: {
        readiness: "building",
        canonical_ready: false,
        progress: { documents_done: 3, documents_total: 9 },
        hits: HITS,
      },
    });
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q9");
    const result = IndexSearchResult.parse(
      await win.call("index.search", { q: "needle", nativeSessionIds: ["nat-never"] }),
    );
    expect(result.answered).toBe(false);
    expect(result.hits).toEqual([]);
    expect(result.state.readiness).toBe("building");
  });

  it("a daemon that is not ready is unanswered, not thrown — and nothing is asked", async () => {
    const world = await setup({ mode: "silent" });
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q4");
    const before = world.asked().length;
    const result = (await win.call("index.search", { q: "needle" })) as IndexSearchResult;
    expect(result).toMatchObject({ answered: false, hits: [], clipped: false });
    expect(result.state.readiness).toBe("unknown");
    expect(result.state.detail).toMatch(/the agent index is/);
    expect(world.asked().slice(before)).toEqual([]);
    // …and the foot says the same thing
    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(status.search?.reachable).toBe(false);
  });

  it("a scope the index has never read is answered-and-empty only once the index says it is ready", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q5");
    const result = (await win.call("index.search", {
      q: "needle",
      nativeSessionIds: ["nat-never-indexed"],
    })) as IndexSearchResult;
    // the daemon IS ready and its canonical projection is serveable, so "I
    // know none of these" is a real answer rather than a held sheet
    expect(result.answered).toBe(true);
    expect(result.hits).toEqual([]);
    expect(result.state.detail).toMatch(/none of these sessions are in the history index yet/);
  });

  it("a body fieldd cannot vouch for is UNAVAILABLE {malformed} — never a silent empty answer", async () => {
    const world = await setup({
      // a hit that names no row: the sheet would have nothing to open
      search: { hits: [{ session_id: "s1", kind: "user", at: 1, snippet: "[needle]" }] },
    });
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q6");
    const error = await win.callErr("index.search", { q: "needle" });
    expect(error.data?.kind).toBe("UNAVAILABLE");
    expect(error.data?.details).toEqual({ service: "index", state: "malformed" });
  });

  it("never carries the daemon's origin, in either answer (EL7)", async () => {
    const world = await setup();
    await ready(world.daemon);
    const origin = world.daemon.rosettad?.state().origin as string;
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q7");
    const sessions = await win.call("index.sessions", { nativeSessionIds: ["nat-1"] });
    const search = await win.call("index.search", { q: "needle", nativeSessionIds: ["nat-1"] });
    const status = await win.call("index.status", {});
    for (const answer of [sessions, search, status]) {
      const serialized = JSON.stringify(answer);
      expect(serialized).not.toContain(origin);
      expect(serialized).not.toContain(`:${new URL(origin).port}`);
    }
  });

  it("refuses params the doors do not admit", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowToken(world.daemon, ["index.read", "index.search"], "q8");
    expect((await win.callErr("index.search", { q: "" })).data?.kind).toBe("PRECONDITION_FAILED");
    // rosetta answers 400 for a kind it does not index; the door refuses first
    expect((await win.callErr("index.search", { q: "needle", kind: "tool_use" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    expect((await win.callErr("index.sessions", { nativeSessionIds: [] })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
  });
});

describe("the doors' posture", () => {
  it("both doors ride index.search, their OWN scope: a token holding only the fold or the census is refused (AR-5b)", async () => {
    // The census scope `index.read` draws the roll call and is plugin-eligible;
    // transcript search over every consented root is a different consent, so a
    // holder of index.read alone — or of the fold — gets nothing here.
    const world = await setup();
    await ready(world.daemon);
    for (const [suffix, scopes] of [
      ["p1", ["agent.observe"]],
      ["p2", ["index.read"]],
    ] as const) {
      const win = await windowToken(world.daemon, [...scopes], suffix);
      for (const method of ["index.sessions", "index.search"]) {
        const error = await win.callErr(method, { q: "needle", nativeSessionIds: ["nat-1"] });
        expect(error.data?.kind, `${method} with ${scopes.join()}`).toBe("FORBIDDEN_SCOPE");
      }
    }
  });

  it("D36: a peer-fieldd principal cannot call either door, whatever the tailnet preset grants", async () => {
    // the locality column, not the scope, is what keeps a peer out: the
    // history a person can search is the one indexed on the device in front
    // of them (the harness device-routing.test.ts uses for agent.spawn)
    const secret = "3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM";
    const api = new ProductApi({
      port: 0,
      tokens: { verify: () => null },
      tailnetPathSecret: secret,
    });
    let called = 0;
    for (const method of ["index.sessions", "index.search"]) {
      api.register(method, () => {
        called += 1;
        return {};
      });
    }
    const port = await api.listen();
    cleanup.push(() => api.close());
    const ws = new WebSocket(`ws://127.0.0.1:${port}/t/${secret}`, {
      headers: { "Tailscale-User-Login": "me@jamesyong42.com" },
    });
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const call = (id: number, method: string, params: unknown): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const onMsg = (raw: Buffer) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id === id) {
            ws.off("message", onMsg);
            resolve(msg);
          }
        };
        ws.on("message", onMsg);
        ws.once("close", () => reject(new Error("closed before reply")));
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    await call(1, "system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "peer-fieldd",
      deviceId: "dev-peer-a",
    });
    for (const [id, method] of [
      [2, "index.sessions"],
      [3, "index.search"],
    ] as const) {
      const res = (await call(id, method, { q: "needle", nativeSessionIds: ["nat-1"] })) as {
        error: { data: { kind: string; details: Record<string, unknown> } };
      };
      expect(res.error.data.kind, method).toBe("FORBIDDEN_SCOPE");
      // AR-5b: the tailnet preset carries no content scope at all, so the scope
      // wall fires before the locality wall for a peer; the locality column
      // still stands behind it (the census reads on index.read exercise it),
      // and the handler ran for neither door either way
      expect(res.error.data.details).toMatchObject({ required: "index.search" });
    }
    expect(called).toBe(0);
  });
});

// The real binary (`pnpm siblings:build`; FIELDD_ROSETTAD_BIN=$(node
// scripts/siblings.mjs bin)): the same two doors over rosetta's own
// ground-truth transcript, seeded into an empty home so nothing of the
// developer's is ever read.
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
const GROUNDTRUTH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "rosetta",
  "groundtruth",
  "claude-code",
  "fixtures",
  "2.1.241",
  "basic-chat",
  "claude-config",
);
/** the one session that transcript records, and a word inside its reply */
const FIXTURE_NATIVE_ID = "665e3e71-7c12-4810-925a-e8b92cb6f29d";

describe.skipIf(
  REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN) || !existsSync(GROUNDTRUTH),
)("the find doors (AR-5e) — against the real rosettad (opt-in via FIELDD_ROSETTAD_BIN)", () => {
  it("indexes the ground-truth transcript, answers its facts by native id, and finds a word in it", async () => {
    const world = await setup({
      rosettadBin: REAL_BIN as string,
      real: true,
      seedClaudeHome: GROUNDTRUTH,
    });
    await until(() => world.daemon.health().rosettad.phase === "ready", 30_000);
    const win = await windowToken(
      world.daemon,
      ["index.read", "index.search", "index.manage"],
      "real1",
    );
    await untilAsync(
      () =>
        world.daemon.index
          .status()
          .then((s) => s.phase === "awaiting_consent")
          .catch(() => false),
      20_000,
    );
    await win.call("index.enroll", { kinds: ["claude-code"] });
    await untilAsync(
      () =>
        world.daemon.index
          .status()
          .then((s) => s.phase === "live")
          .catch(() => false),
      60_000,
    );
    // the rows land a beat after the daemon says live
    await untilAsync(
      async () =>
        (
          (await win.call("index.sessions", {
            nativeSessionIds: [FIXTURE_NATIVE_ID],
          })) as IndexSessionsResult
        ).rows.length > 0,
      60_000,
    );

    const facts = (await win.call("index.sessions", {
      nativeSessionIds: [FIXTURE_NATIVE_ID],
    })) as IndexSessionsResult;
    const row = facts.rows[0];
    expect(row?.nativeSessionId).toBe(FIXTURE_NATIVE_ID);
    expect(row?.sessionId).toMatch(/\S/);
    expect(row?.rootSessionId).toMatch(/\S/);

    // a word the transcript really carries ("Hello from rosetta mockmodel…")
    let found: IndexSearchResult | undefined;
    await untilAsync(async () => {
      const answer = (await win.call("index.search", {
        q: "mockmodel",
        nativeSessionIds: [FIXTURE_NATIVE_ID],
      })) as IndexSearchResult;
      if (answer.answered && answer.hits.length > 0) found = answer;
      return found !== undefined;
    }, 60_000);
    expect(found?.hits[0]?.nativeSessionId).toBe(FIXTURE_NATIVE_ID);
    expect(found?.hits[0]?.snippet.toLowerCase()).toContain("mockmodel");
    expect(found?.state.readiness === "ready" || found?.state.readiness === "catching-up").toBe(
      true,
    );

    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(status.search).toMatchObject({
      reachable: true,
      capabilities: { sessionScope: true, prefix: true },
    });
  }, 180_000);
});
