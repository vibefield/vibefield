// SP-6 (thinking-sync-planes.md §5.4 "until RO-1", SP-D5 (a); thinking-ios-
// history.md H-D2) — one session's transcript over the DOOR until the ticket:
// `index.timeline` (one backward page, bounded) and `index.session.subscribe`
// (the live tail as rows at a floor), against the scripted rosettad that
// serves rosetta's own page route and its own session-socket frames — and,
// opt-in, against the REAL pinned rosettad on rosetta's ground-truth transcript
// seeded into an empty home. The rows are about what an answer MEANS: the
// projection, the bounds a tailnet caller is held to and the words that say
// so, the floor, the barrier, the shared socket, the restart, the honest
// refusals — never an asset's bytes or address.
import { spawn } from "node:child_process";
import {
  appendFileSync,
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
  INDEX_MESH,
  INDEX_TAILNET_LIMITS,
  INDEX_TIMELINE,
  type IndexSessionsResult,
  IndexSessionTailDelta,
  IndexSessionTailSnapshot,
  IndexTimelineResult,
  PRODUCT_API_LIMITS,
  ROWS,
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

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-rosettad.mjs");

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

async function untilAsync(
  fn: () => Promise<boolean>,
  ms: number,
  what = "condition",
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await fn().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`untilAsync: ${what} not met within ${ms}ms`);
}

const sessionRow = (id: string) => ({
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
});

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
];

/** A rosetta `TimelineEntry` of `kind`, at `ordinal`, in `sessionId`. */
function entry(
  sessionId: string,
  ordinal: number,
  kind: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const text = (words: string) => ({ type: "inline", text: words });
  const bodies: Record<string, unknown> = {
    user: { type: "user", text: text(`prompt ${ordinal}`), attachments: [] },
    agent: { type: "agent", text: text(`reply ${ordinal}`), attachments: [], citations: [] },
    thinking: { type: "thinking", text: text(`thought ${ordinal}`) },
    summary: { type: "summary", purpose: "compaction", text: text(`summary ${ordinal}`) },
    notice: { type: "notice", notice: { type: "model_changed", from: null, to: "claude-opus-5" } },
    tool_use: {
      type: "tool_use",
      tool: {
        correlation: { key: `toolu_${ordinal}`, derivation: "native_id" },
        native: { id: `toolu_${ordinal}`, name: "Bash", namespace: null, provider: null },
        status: { value: "succeeded", basis: "native_terminal_record" },
        action: {
          type: "shell",
          command: text(`pnpm test --filter ${ordinal}\nsecond line`),
          cwd: null,
          timeout_ms: null,
          background: false,
          outcome: { exit_code: 0, signal: null, process_id: null },
        },
        failure: null,
        timing: { started_at: 1_000, completed_at: 3_500, duration_ms: null },
      },
    },
  };
  return {
    timeline_id: `${sessionId}-t${ordinal}`,
    session_id: sessionId,
    ordinal,
    group: {
      id: `turn-${Math.floor(ordinal / 10)}`,
      kind: kind === "user" ? "human_turn" : "agent_cycle",
      derivation: "native",
    },
    response:
      kind === "user" ? null : { id: `response-${Math.floor(ordinal / 10)}`, derivation: "native" },
    block_index: null,
    native_id: null,
    parent_native_id: null,
    at: 3_600_000 + ordinal * 1_000,
    model: kind === "user" ? null : "claude-opus-5",
    effort: null,
    body: bodies[kind] ?? { type: kind },
    parent_tool_native_id: null,
    usage: {
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
      thinking: null,
      cache_write_1h: null,
      web_searches: null,
      service_tier: null,
      route: null,
      billed_pico_usd: null,
      scope: "request",
      requests: null,
    },
    provenance: { agent_version: "2.1.241", src_cursor: 1, src_offset: ordinal },
    ...over,
  };
}

/** s1's seven rows: a turn of every kind the projection reads */
const S1 = [
  entry("s1", 1, "user"),
  entry("s1", 2, "thinking"),
  entry("s1", 3, "tool_use"),
  entry("s1", 4, "agent", {
    body: {
      type: "agent",
      text: { type: "inline", text: "reply 4" },
      attachments: [
        {
          id: "img-4",
          kind: "image",
          label: null,
          name: "shot.png",
          media_type: "image/png",
          byte_len: 1234,
          source: {
            type: "asset",
            asset: {
              url: "/api/assets/abc.png",
              digest: "abc",
              media_type: "image/png",
              byte_len: 1234,
            },
          },
          dimensions: null,
          message_ranges: [],
        },
        {
          id: "doc-4",
          kind: "document",
          label: "notes",
          name: null,
          media_type: null,
          byte_len: null,
          source: { type: "unavailable", reason: "not_recorded" },
          dimensions: null,
          message_ranges: [],
        },
      ],
      citations: [],
    },
    usage: {
      input: 10,
      output: 5,
      cache_read: null,
      cache_write: null,
      thinking: null,
      scope: "request",
      requests: null,
    },
    cost: { status: "priced", micro_usd: 175, long_context: false },
  }),
  entry("s1", 5, "notice"),
  entry("s1", 6, "summary"),
  entry("s1", 7, "user", {
    body: {
      type: "user",
      text: { type: "inline", text: "x".repeat(INDEX_TIMELINE.TEXT_CHARS + 500) },
      attachments: [],
    },
  }),
];

/** s2's hundred and fifty rows: a session longer than a phone's page */
const S2 = Array.from({ length: 150 }, (_, i) =>
  entry("s2", i + 1, i % 2 === 0 ? "user" : "agent"),
);

interface World {
  daemon: FielddDaemon;
  mock: MockMgmtServer;
  /** the READS fieldd made, in order */
  asked(): string[];
  /** the fake's session-socket events (opened, resync fired, drop fired,
   * closed), stamped — what it SENT, for a row that waited on a frame */
  sockets(): string[];
  /** fieldd's own `fieldd.index.*` log lines */
  indexLog(): string[];
  timeline(rows: unknown[]): void;
  control(value: Record<string, unknown>): void;
}

async function setup(
  opts: { rosettad?: boolean; timeline?: unknown[]; sessions?: string[] } = {},
): Promise<World> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ixtl-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  const files = {
    sessions: join(dataDir, "sessions.json"),
    runtimes: join(dataDir, "runtimes.json"),
    timeline: join(dataDir, "timeline.json"),
    control: join(dataDir, "timeline-control.json"),
    requests: join(dataDir, "requests.log"),
  };
  writeFileSync(files.sessions, JSON.stringify((opts.sessions ?? ["s1", "s2"]).map(sessionRow)));
  writeFileSync(files.runtimes, JSON.stringify(RUNTIMES));
  writeFileSync(files.timeline, JSON.stringify(opts.timeline ?? [...S1, ...S2]));
  writeFileSync(files.control, JSON.stringify({ watermark: "w-1" }));
  writeFileSync(files.requests, "");
  const fakeRosettad = ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: {
        ...process.env,
        FAKE_ROSETTAD_MODE: "ok",
        FAKE_ROSETTAD_SESSIONS: files.sessions,
        FAKE_ROSETTAD_RUNTIMES: files.runtimes,
        FAKE_ROSETTAD_TIMELINE: files.timeline,
        FAKE_ROSETTAD_TIMELINE_CONTROL: files.control,
        FAKE_ROSETTAD_REQUEST_LOG: files.requests,
      },
    })) as unknown as typeof spawn;
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const logRoot = join(dataDir, "logs");
  const daemon = await bootstrap({
    dataDir,
    logRoot,
    controlPort: 0,
    dataPort: 0,
    ...(opts.rosettad === false
      ? { rosettadBin: "" }
      : { rosettadBin: "/stand-in/rosettad", rosettadSpawn: fakeRosettad, rosettadHome: home }),
  });
  cleanup.push(() => daemon.stop());
  const requestLines = () =>
    readFileSync(files.requests, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  const isSocketEvent = (line: string) => line.slice(line.indexOf(" ") + 1).startsWith("ws ");
  return {
    daemon,
    mock,
    asked: () =>
      requestLines()
        .filter((line) => !isSocketEvent(line))
        .map((line) => line.slice(line.indexOf(" ") + 1)),
    sockets: () => requestLines().filter(isSocketEvent),
    indexLog: () => {
      const file = join(logRoot, "system", "fieldd.ndjson");
      return existsSync(file)
        ? readFileSync(file, "utf8")
            .split("\n")
            .filter((line) => line.includes('"fieldd.index.'))
        : [];
    },
    timeline: (rows) => writeFileSync(files.timeline, JSON.stringify(rows)),
    control: (value) => writeFileSync(files.control, JSON.stringify(value)),
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

async function windowOf(daemon: FielddDaemon, scopes: Scope[] = ["index.search"]): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(rpc, daemon.tokens.mint(scopes, "ixtl-window").token);
  return rpc;
}

/** The product door the way the SIDECAR delivers a self phone. */
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
  await until(() => daemon.health().rosettad.phase === "ready", 15_000);
}

const page = async (rpc: WsRpc, params: Record<string, unknown>): Promise<IndexTimelineResult> =>
  IndexTimelineResult.parse(await rpc.call("index.timeline", params));

/** Subscribe and parse the open; the frames arrive as notifications. */
async function tail(rpc: WsRpc, params: Record<string, unknown>) {
  const answer = (await rpc.call("index.session.subscribe", params)) as {
    subId: string;
    snapshot: unknown;
  };
  const opened = answer.snapshot as { snapshot?: unknown; resumed?: unknown };
  if (opened.snapshot === undefined) throw new Error("the open was not a snapshot");
  const snapshot = IndexSessionTailSnapshot.parse(opened.snapshot);
  const frames = () =>
    rpc.notifications
      .filter((note) => note.params.subId === answer.subId)
      .map((note) => ({ kind: note.method, payload: note.params.payload, at: note.receivedAt }));
  const deltas = () =>
    frames()
      .filter((frame) => frame.kind === "index.session.delta")
      .map((frame) => ({ ...IndexSessionTailDelta.parse(frame.payload), at: frame.at }));
  const resets = () =>
    frames()
      .filter((frame) => frame.kind === "index.session.snapshot")
      .map((frame) => ({ ...IndexSessionTailSnapshot.parse(frame.payload), at: frame.at }));
  return { subId: answer.subId, snapshot, frames, deltas, resets };
}

describe("index.timeline — one backward page of one session (SP-6)", () => {
  it("answers the projection of rosetta's page: every kind, oldest first, the text bounded, refs without addresses", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon);
    const answer = await page(win, { sessionId: "s1" });
    expect(answer.sessionId).toBe("s1");
    expect(answer.watermark).toBe("w-1");
    // the whole session fits one page: no cursor, nothing cut
    expect(answer.nextCursor).toBeNull();
    expect(answer.clipped).toBe(false);
    expect(answer.entries.map((row) => [row.ordinal, row.kind])).toEqual([
      [1, "user"],
      [2, "thinking"],
      [3, "tool_use"],
      [4, "agent"],
      [5, "notice"],
      [6, "summary"],
      [7, "user"],
    ]);
    const [prompt, thought, tool, reply, notice, summary, long] = answer.entries;
    expect(prompt).toMatchObject({ text: "prompt 1", group: { id: "turn-0", kind: "human_turn" } });
    expect(prompt).not.toHaveProperty("responseId");
    expect(thought?.text).toBe("thought 2");
    // a tool line: the command's FIRST line, the exit, the span from its timing
    expect(tool?.tool).toEqual({
      name: "Bash",
      family: "shell",
      status: "succeeded",
      failed: false,
      object: "pnpm test --filter 3",
      result: "exit 0",
      durationMs: 2_500,
    });
    expect(tool).not.toHaveProperty("text");
    expect(tool?.responseId).toBe("response-0");
    // a reply: its text, its usage, its priced cost, its attachments as REFS
    expect(reply).toMatchObject({
      text: "reply 4",
      model: "claude-opus-5",
      usage: { input: 10, output: 5 },
      costMicroUsd: 175,
      attachments: [
        {
          id: "img-4",
          kind: "image",
          name: "shot.png",
          mediaType: "image/png",
          byteLen: 1234,
          available: true,
        },
        { id: "doc-4", kind: "document", name: "notes", available: false, reason: "not_recorded" },
      ],
    });
    // a notice carries its type, a summary its purpose
    expect(notice).toMatchObject({ kind: "notice", notice: "model_changed" });
    expect(summary).toMatchObject({
      kind: "summary",
      summaryPurpose: "compaction",
      text: "summary 6",
    });
    // the text bound, and the word that says it was cut
    expect(long?.text).toHaveLength(INDEX_TIMELINE.TEXT_CHARS);
    expect(long?.textClipped).toBe(true);
    expect(prompt).not.toHaveProperty("textClipped");
    // never the asset's address, never its digest
    const wire = JSON.stringify(answer);
    expect(wire).not.toContain("/api/assets/");
    expect(wire).not.toContain('"digest"');
    expect(wire).not.toContain('"url"');
    // the one GET, with rosetta's own query
    expect(world.asked()).toContain(
      `/api/sessions/s1/timeline?limit=${INDEX_TIMELINE.PAGE_DEFAULT_LIMIT}`,
    );
  }, 30_000);

  it("pages backward through the cursor; a cursor the session was rewritten under is the caller's to re-read", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon);
    const newest = await page(win, { sessionId: "s1", limit: 3 });
    expect(newest.entries.map((row) => row.ordinal)).toEqual([5, 6, 7]);
    expect(newest.nextCursor).not.toBeNull();
    // a window's page cut by ITS OWN ask is not `clipped` — that word is the
    // tailnet bound's
    expect(newest.clipped).toBe(false);
    const older = await page(win, {
      sessionId: "s1",
      limit: 3,
      cursor: newest.nextCursor as string,
    });
    expect(older.entries.map((row) => row.ordinal)).toEqual([2, 3, 4]);
    const top = await page(win, { sessionId: "s1", limit: 3, cursor: older.nextCursor as string });
    expect(top.entries.map((row) => row.ordinal)).toEqual([1]);
    expect(top.nextCursor).toBeNull();
    // the session's projection is rewritten under the reader's cursor
    world.control({ watermark: "w-2" });
    const expired = await win.callErr("index.timeline", {
      sessionId: "s1",
      cursor: newest.nextCursor,
    });
    expect(expired.data).toMatchObject({
      kind: "PRECONDITION_FAILED",
      retryable: false,
      details: { service: "index", reason: "cursor-expired" },
    });
    const head = await page(win, { sessionId: "s1", limit: 3 });
    expect(head.watermark).toBe("w-2");
  }, 30_000);

  it("a tailnet caller's page is cut at the bound and says so; a window keeps its own ask", async () => {
    const world = await setup();
    await ready(world.daemon);
    const phone = await phoneOf(world.daemon, world.mock);
    const bounded = await page(phone, { sessionId: "s2", limit: 300 });
    expect(bounded.entries).toHaveLength(INDEX_TAILNET_LIMITS.MAX_ROWS);
    expect(bounded.entries[0]?.ordinal).toBe(51);
    expect(bounded.entries.at(-1)?.ordinal).toBe(150);
    expect(bounded.clipped).toBe(true);
    expect(bounded.nextCursor).not.toBeNull();
    // rosettad was asked for the bound, never the phone's 300
    expect(world.asked().at(-1)).toBe(
      `/api/sessions/s2/timeline?limit=${INDEX_TAILNET_LIMITS.MAX_ROWS}`,
    );
    // the phone pages on from the cut
    const rest = await page(phone, {
      sessionId: "s2",
      limit: 300,
      cursor: bounded.nextCursor as string,
    });
    expect(rest.entries).toHaveLength(50);
    expect(rest.nextCursor).toBeNull();
    // a phone's no-ask is the door's default, which is at the bound already
    const unasked = await page(phone, { sessionId: "s2" });
    expect(unasked.entries).toHaveLength(INDEX_TAILNET_LIMITS.MAX_ROWS);
    expect(unasked.clipped).toBe(INDEX_TIMELINE.PAGE_DEFAULT_LIMIT > INDEX_TAILNET_LIMITS.MAX_ROWS);
    // a phone asking fewer than the bound is served its own ask, uncut
    const small = await page(phone, { sessionId: "s2", limit: 7 });
    expect(small.entries).toHaveLength(7);
    expect(small.clipped).toBe(false);
    // a window's 300 reaches rosettad whole: every row, no cursor, not clipped
    const win = await windowOf(world.daemon);
    const whole = await page(win, { sessionId: "s2", limit: 300 });
    expect(whole.entries).toHaveLength(150);
    expect(whole.nextCursor).toBeNull();
    expect(whole.clipped).toBe(false);
    expect(world.asked().at(-1)).toBe("/api/sessions/s2/timeline?limit=300");
  }, 30_000);

  it("a session the index does not hold is NOT_FOUND; a bad ask is the caller's; no daemon is the honest unconfigured", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon);
    expect((await win.callErr("index.timeline", { sessionId: "nope" })).data).toMatchObject({
      kind: "NOT_FOUND",
      retryable: false,
    });
    expect((await win.callErr("index.timeline", {})).data?.kind).toBe("PRECONDITION_FAILED");
    expect((await win.callErr("index.timeline", { sessionId: "s1", limit: 0 })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    expect(
      (
        await win.callErr("index.timeline", {
          sessionId: "s1",
          limit: INDEX_TIMELINE.PAGE_MAX_LIMIT + 1,
        })
      ).data?.kind,
    ).toBe("PRECONDITION_FAILED");
    // a reader that holds the roll-call scope alone is refused the content
    const census = await windowOf(world.daemon, ["index.read"]);
    expect((await census.callErr("index.timeline", { sessionId: "s1" })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    const bare = await setup({ rosettad: false });
    const unconfigured = await windowOf(bare.daemon);
    expect((await unconfigured.callErr("index.timeline", { sessionId: "s1" })).data).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: false,
      details: { service: "index", state: "unconfigured" },
    });
    expect(
      (await unconfigured.callErr("index.session.subscribe", { sessionId: "s1" })).data,
    ).toMatchObject({ kind: "UNAVAILABLE", details: { service: "index", state: "unconfigured" } });
  }, 40_000);
});

describe("index.session.subscribe — the live tail as rows (SP-6)", () => {
  it("opens on rosetta's snapshot, then a delta keyed by timelineId within the floor; an idle session sends nothing", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon);
    const sub = await tail(win, { sessionId: "s1" });
    expect(sub.snapshot.revision).toBe(1);
    expect(sub.snapshot.epoch).toMatch(/^tail-[0-9a-f]{16}\.\d+$/);
    expect(sub.snapshot.rows.map((row) => row.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sub.snapshot.rows[3]?.text).toBe("reply 4");
    // the socket is open, once
    expect(world.daemon.indexTail.openSockets).toBe(1);
    // idle: nothing crosses in two floors
    await new Promise((resolve) =>
      setTimeout(resolve, INDEX_MESH.SESSION_TAIL_MIN_INTERVAL_MS * 2),
    );
    expect(sub.frames()).toEqual([]);
    // the session moves: a new row, and a changed one
    const appended = Date.now();
    world.timeline([
      ...S1.map((row) =>
        row.timeline_id === "s1-t4"
          ? {
              ...row,
              body: { ...(row.body as object), text: { type: "inline", text: "reply 4, edited" } },
            }
          : row,
      ),
      entry("s1", 8, "agent"),
      ...S2,
    ]);
    await until(() => sub.deltas().length >= 1, 10_000);
    const delta = sub.deltas()[0];
    expect(delta).toMatchObject({ epoch: sub.snapshot.epoch, since: 1, revision: 2, removed: [] });
    expect(delta?.upserts.map((row) => [row.timelineId, row.text]).sort()).toEqual([
      ["s1-t4", "reply 4, edited"],
      ["s1-t8", "reply 8"],
    ]);
    // never faster than the floor, never a second frame for the same change
    expect((delta?.at ?? 0) - appended).toBeGreaterThanOrEqual(0);
    await new Promise((resolve) =>
      setTimeout(resolve, INDEX_MESH.SESSION_TAIL_MIN_INTERVAL_MS * 2),
    );
    expect(sub.deltas()).toHaveLength(1);
    expect(sub.resets()).toEqual([]);
  }, 30_000);

  it("holds the floor under churn: three appends inside one window are one frame; a slower ask is honoured", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon);
    const floor = INDEX_MESH.SESSION_TAIL_MIN_INTERVAL_MS * 2;
    const sub = await tail(win, { sessionId: "s1", minIntervalMs: floor });
    const started = Date.now();
    for (let i = 8; i <= 10; i += 1) {
      world.timeline([
        ...S1,
        ...Array.from({ length: i - 7 }, (_, k) => entry("s1", 8 + k, "agent")),
        ...S2,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await until(() => sub.deltas().length >= 1, 15_000);
    await new Promise((resolve) => setTimeout(resolve, floor));
    const deltas = sub.deltas();
    // the three rows crossed in at most two frames (a change landing just as a
    // window closes opens the next), never three, and every frame chained
    expect(deltas.length).toBeLessThanOrEqual(2);
    expect(
      deltas.flatMap((d) => d.upserts.map((row) => row.ordinal)).sort((a, b) => a - b),
    ).toEqual([8, 9, 10]);
    expect(deltas[0]?.since).toBe(1);
    for (let i = 1; i < deltas.length; i += 1)
      expect(deltas[i]?.since).toBe(deltas[i - 1]?.revision);
    // the first frame came no sooner than the ask's own floor after the open
    expect((deltas[0]?.at ?? 0) - started).toBeGreaterThanOrEqual(floor - 50);
    if (deltas.length === 2)
      expect((deltas[1]?.at ?? 0) - (deltas[0]?.at ?? 0)).toBeGreaterThanOrEqual(floor - 50);
  }, 40_000);

  it("a tailnet caller's snapshot is the newest MAX_ROWS rows; a window's is rosetta's whole snapshot; both hear the next row", async () => {
    const world = await setup();
    await ready(world.daemon);
    const phone = await phoneOf(world.daemon, world.mock);
    const win = await windowOf(world.daemon);
    const bounded = await tail(phone, { sessionId: "s2" });
    const whole = await tail(win, { sessionId: "s2" });
    expect(bounded.snapshot.rows).toHaveLength(INDEX_TAILNET_LIMITS.MAX_ROWS);
    expect(bounded.snapshot.rows[0]?.ordinal).toBe(51);
    expect(bounded.snapshot.rows.at(-1)?.ordinal).toBe(150);
    expect(whole.snapshot.rows).toHaveLength(150);
    // one socket serves both
    expect(world.daemon.indexTail.openSockets).toBe(1);
    world.timeline([...S1, ...S2, entry("s2", 151, "agent")]);
    await until(() => bounded.deltas().length >= 1 && whole.deltas().length >= 1, 10_000);
    expect(bounded.deltas()[0]?.upserts.map((row) => row.ordinal)).toEqual([151]);
    expect(whole.deltas()[0]?.upserts.map((row) => row.ordinal)).toEqual([151]);
    // the last subscriber to leave closes the socket
    await phone.call("system.unsubscribe", { subId: bounded.subId });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(world.daemon.indexTail.openSockets).toBe(1);
    await win.call("system.unsubscribe", { subId: whole.subId });
    await until(() => world.daemon.indexTail.openSockets === 0, 5_000);
  }, 30_000);

  it("item 60 — a snapshot past a page goes out in the rows protocol's pages: an open, a later reader's open of every held row, a reset", async () => {
    // The measurement's rows: a reply at the text bound (item 60 measured
    // 2.3 KB a row on rosettad's own; these project to about 2.1 KB). One
    // socket serves every reader of a session, and what it holds grows with
    // every append, so a reader that opens late is answered EVERY held row: on
    // main, one frame, past PeerLink's 4 MiB reader here.
    const HELD = 2_600;
    const LONG = Array.from({ length: HELD }, (_, i) =>
      entry("s3", i + 1, "agent", {
        body: {
          type: "agent",
          text: { type: "inline", text: `${i + 1} `.padEnd(INDEX_TIMELINE.TEXT_CHARS, "y") },
          attachments: [],
          citations: [],
        },
      }),
    );
    const world = await setup({ timeline: [...S1, ...LONG.slice(0, 200)], sessions: ["s1", "s3"] });
    await ready(world.daemon);
    const bytes = (frame: unknown) => Buffer.byteLength(JSON.stringify(frame), "utf8");
    type Page = { epoch?: string; revision: number; rows: { ordinal: number }[]; more?: boolean };
    /** one snapshot's pages, from its first to the one that says no more */
    const assemble = (pages: Page[]) => {
      for (const page of pages) {
        expect(bytes(page), "a page stays under the rows protocol's budget").toBeLessThanOrEqual(
          ROWS.SNAPSHOT_PAGE_BYTES,
        );
        expect(page.epoch).toBe(pages[0]?.epoch);
        expect(page.revision).toBe(pages[0]?.revision);
      }
      expect(pages.slice(0, -1).every((page) => page.more === true)).toBe(true);
      expect(pages.at(-1)?.more).toBeUndefined();
      return pages.flatMap((page) => page.rows.map((row) => row.ordinal));
    };
    const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    /** the open's pages: its answer, then the `.snapshot` frames after it */
    const opened = async (sub: Awaited<ReturnType<typeof tail>>) => {
      await until(
        () => sub.resets().some((page) => page.more !== true),
        15_000,
        "the open's last page",
      );
      return [sub.snapshot as Page, ...(sub.resets() as Page[])];
    };

    /** a window that reads the way PeerLink does: a frame past 4 MiB closes it
     * (`ws`'s maxPayload; its own side reports the close as 1006) */
    const capped = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${world.daemon.controlPort}`, {
        maxPayload: PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES,
      });
      cleanup.push(() => ws.close());
      const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      ws.on("error", () => undefined);
      const rpc = new WsRpc(ws);
      await helloAs(rpc, world.daemon.tokens.mint(["index.search"], "ixtl-capped").token);
      return { rpc, closed };
    };

    // rosetta's own snapshot, 200 rows: already past one page
    const first = await tail(await windowOf(world.daemon), { sessionId: "s3" });

    // the session runs on while the first reader holds the socket
    world.timeline([...S1, ...LONG]);
    await until(
      () => first.deltas().some((delta) => delta.upserts.some((row) => row.ordinal === HELD)),
      30_000,
      "the appended rows",
    );

    // a reader that opens now is answered every held row — through a reader
    // capped like PeerLink's, which closes on one frame past its 4 MiB
    const reader = await capped();
    const late = await Promise.race([
      tail(reader.rpc, { sessionId: "s3" }),
      reader.closed.then((code): never => {
        throw new Error(`the capped reader closed ${code}: a frame past its 4 MiB`);
      }),
    ]);
    expect(late.snapshot.more).toBe(true);
    const latePages = await opened(late);
    expect(reader.rpc.closed).toBe(false);
    expect(latePages.length).toBeGreaterThan(Math.ceil((HELD * 2_000) / ROWS.SNAPSHOT_PAGE_BYTES));
    expect(assemble(latePages)).toEqual(upTo(HELD));
    // and the first reader's own open was paged the same way
    expect(first.snapshot.more).toBe(true);
    expect(assemble(await opened(first))).toEqual(upTo(200));

    // rosetta's barrier: the reset is its fresh snapshot, in pages too
    const before = late.resets().length;
    world.control({ watermark: "w-2", resync: 1 });
    await until(
      () =>
        late
          .resets()
          .slice(before)
          .some((page) => page.more !== true),
      15_000,
      "the reset's last page",
    );
    const reset = late.resets().slice(before) as Page[];
    expect(reset.length).toBeGreaterThan(1);
    expect(reset[0]?.epoch).toBe(late.snapshot.epoch);
    expect(assemble(reset)).toEqual(Array.from({ length: 200 }, (_, i) => HELD - 199 + i));
  }, 90_000);

  it("rosetta's barrier (resync) and a dropped socket each reset the copy with a .snapshot frame — the chain stands", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon);
    const sub = await tail(win, { sessionId: "s1" });
    // Four reds at 10.4 s on loaded gates: the barrier's `.snapshot` frame
    // never came, and nothing said which side lost it. A wait that expires now
    // says what each side held: the frames this window got, fieldd's tail
    // (rosetta's client status, the generation, each chain's gap), what the
    // fake sent on the socket, and fieldd's own index log.
    const waitFor = async (fn: () => boolean, ms: number, label: string) => {
      const started = Date.now();
      await until(fn, ms, label).catch((error: Error) => {
        const said = {
          waitedFrom: started,
          frames: sub.frames(),
          tail: world.daemon.indexTail.tailState("s1"),
          fake: world.sockets(),
          fieldd: world.indexLog(),
        };
        throw new Error(`${error.message}\n${JSON.stringify(said, null, 1)}`);
      });
    };
    world.control({ watermark: "w-2", resync: 1 });
    await waitFor(() => sub.resets().length >= 1, 10_000, "the barrier's .snapshot frame");
    const reset = sub.resets()[0];
    expect(reset?.epoch).toBe(sub.snapshot.epoch);
    expect(reset?.revision).toBeGreaterThanOrEqual(sub.snapshot.revision);
    expect(reset?.rows.map((row) => row.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // a change after the reset chains from it
    world.timeline([...S1, entry("s1", 8, "agent"), ...S2]);
    await waitFor(() => sub.deltas().length >= 1, 10_000, "the delta after the reset");
    expect(sub.deltas()[0]?.since).toBe(reset?.revision);
    // the socket drops: rosetta's client re-dials and re-snapshots; the copy is replaced
    const before = sub.resets().length;
    world.control({ watermark: "w-2", resync: 1, drop: 1 });
    await waitFor(() => sub.resets().length > before, 15_000, "the re-dial's .snapshot frame");
    expect(
      sub
        .resets()
        .at(-1)
        ?.rows.map((row) => row.ordinal),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.daemon.indexTail.openSockets).toBe(1);
  }, 40_000);

  it("the kill matrix: rosettad restarted mid-tail — the tail follows the new generation and resets; a session the index lacks is NOT_FOUND", async () => {
    const world = await setup();
    await ready(world.daemon);
    const win = await windowOf(world.daemon, ["index.search", "index.manage", "index.read"]);
    const sub = await tail(win, { sessionId: "s1" });
    const firstPid = world.daemon.health().rosettad.pid;
    await win.call("system.index.restart", {}).catch(() => undefined);
    if (world.daemon.health().rosettad.pid === firstPid)
      await world.daemon.rosettad?.requestRestart();
    await until(
      () =>
        world.daemon.health().rosettad.phase === "ready" &&
        world.daemon.health().rosettad.pid !== firstPid,
      30_000,
    );
    // the new generation holds another bearer: the tail re-aimed and re-read
    await until(() => sub.resets().length >= 1, 20_000);
    expect(
      sub
        .resets()
        .at(-1)
        ?.rows.map((row) => row.ordinal),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sub.resets().at(-1)?.epoch).toBe(sub.snapshot.epoch);
    // and it is live again
    world.timeline([...S1, entry("s1", 8, "agent"), ...S2]);
    await until(() => sub.deltas().some((d) => d.upserts.some((row) => row.ordinal === 8)), 15_000);
    expect(world.daemon.indexTail.openSockets).toBe(1);
    // a session the index does not hold: refused in fieldd's words, no socket opened
    expect(
      (await win.callErr("index.session.subscribe", { sessionId: "nope" })).data,
    ).toMatchObject({
      kind: "NOT_FOUND",
    });
    expect(world.daemon.indexTail.openSockets).toBe(1);
    expect((await win.callErr("index.session.subscribe", {})).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
  }, 60_000);
});

// ── the REAL rosettad (`pnpm siblings:build`; FIELDD_ROSETTAD_BIN) over
// rosetta's own ground-truth transcript seeded into an empty home, read from
// the checkout dedicated to the pin (`../rosetta-pin`, W-D10) ──

const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
const GROUNDTRUTH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "rosetta-pin",
  "groundtruth",
  "claude-code",
  "fixtures",
  "2.1.241",
  "basic-chat",
  "claude-config",
);
/** the one session that transcript records */
const FIXTURE_NATIVE_ID = "665e3e71-7c12-4810-925a-e8b92cb6f29d";
const FIXTURE_TRANSCRIPT = join(
  "projects",
  "-private-tmp-rosetta-farm-basic-chat-project",
  `${FIXTURE_NATIVE_ID}.jsonl`,
);

async function realWorld(): Promise<{
  daemon: FielddDaemon;
  mock: MockMgmtServer;
  win: WsRpc;
  sid: string;
  home: string;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ixtl-real-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  cpSync(GROUNDTRUTH, join(home, ".claude"), { recursive: true });
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    allowedOrigins: ["file://", "vibefield-app://shell"],
    rosettadBin: REAL_BIN as string,
    rosettadHome: home,
  });
  cleanup.push(() => daemon.stop());
  await until(() => daemon.health().rosettad.phase === "ready", 30_000);
  const win = await windowOf(daemon, ["index.read", "index.search", "index.manage"]);
  await untilAsync(
    async () => (await daemon.index.status()).phase === "awaiting_consent",
    30_000,
    "consent",
  );
  await win.call("index.enroll", { kinds: ["claude-code"] });
  let sid = "";
  await untilAsync(
    async () => {
      const found = (await win.call("index.sessions", {
        nativeSessionIds: [FIXTURE_NATIVE_ID],
      })) as IndexSessionsResult;
      sid = found.rows[0]?.sessionId ?? "";
      return sid !== "";
    },
    90_000,
    "the ground-truth session indexed",
  );
  return { daemon, mock, win, sid, home };
}

describe.skipIf(
  REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN) || !existsSync(GROUNDTRUTH),
)("SP-6 — the two doors against the REAL rosettad (opt-in via FIELDD_ROSETTAD_BIN)", () => {
  it("the page over the ground-truth transcript: a phone's bounded page, a window's; the words are rosetta's", async () => {
    const { daemon, mock, win, sid } = await realWorld();
    const whole = await page(win, { sessionId: sid });
    expect(whole.entries.length).toBeGreaterThanOrEqual(1);
    expect(whole.nextCursor).toBeNull();
    expect(whole.clipped).toBe(false);
    expect(whole.watermark).toMatch(/\S/);
    const reply = whole.entries.find((row) => row.kind === "agent");
    expect(reply?.text).toMatch(/^Hello from rosetta mockmodel/);
    expect(reply?.model).toBe("claude-opus-5");
    expect(reply?.usage?.input).toBe(128);
    expect(reply?.usage?.output).toBe(32);
    for (const row of whole.entries) {
      expect(row.sessionId).toBe(sid);
      expect(Number.isFinite(row.ordinal)).toBe(true);
    }
    const phone = await phoneOf(daemon, mock);
    const bounded = await page(phone, { sessionId: sid, limit: 300 });
    expect(bounded.entries.map((row) => row.timelineId)).toEqual(
      whole.entries.map((row) => row.timelineId),
    );
    expect(bounded.clipped).toBe(false);
    expect(JSON.stringify(whole)).not.toContain(daemon.rosettad?.state().origin ?? "127.0.0.1:");
  }, 180_000);

  it("the tail over rosetta's own socket through Node's global WebSocket: the first frame is the page; an appended line moves it; a restart resets it", async () => {
    const { daemon, win, sid, home } = await realWorld();
    const sub = await tail(win, { sessionId: sid });
    const first = await page(win, { sessionId: sid });
    expect(sub.snapshot.rows.map((row) => row.timelineId)).toEqual(
      first.entries.map((row) => row.timelineId),
    );
    expect(sub.snapshot.watermark ?? first.watermark).toBe(first.watermark);
    expect(daemon.indexTail.openSockets).toBe(1);
    // the session moves ON DISK: a user line appended to the transcript copy,
    // in the vendor's own shape — rosettad watches the root (notify) and
    // ingests it live
    const transcript = join(home, ".claude", FIXTURE_TRANSCRIPT);
    const lines = readFileSync(transcript, "utf8")
      .split("\n")
      .filter((line) => line !== "");
    const assistant = JSON.parse(lines[0] as string) as Record<string, unknown>;
    const line = {
      parentUuid: assistant["uuid"],
      isSidechain: false,
      userType: "external",
      cwd: assistant["cwd"],
      sessionId: FIXTURE_NATIVE_ID,
      version: assistant["version"],
      gitBranch: assistant["gitBranch"],
      type: "user",
      message: { role: "user", content: "And now, from the phone: does the tail move?" },
      uuid: "5f0c2d1e-7a6b-4c3d-9e8f-0a1b2c3d4e5f",
      timestamp: new Date().toISOString(),
    };
    appendFileSync(transcript, `${JSON.stringify(line)}\n`);
    const appendedAt = Date.now();
    let moved = false;
    try {
      await until(
        () =>
          sub.deltas().some((d) => d.upserts.some((row) => row.kind === "user")) ||
          sub.resets().some((r) => r.rows.some((row) => row.kind === "user")),
        45_000,
      );
      moved = true;
    } catch {
      moved = false;
    }
    const words = `SP6_REAL_TAIL ${JSON.stringify({
      snapshotRows: sub.snapshot.rows.length,
      moved,
      viaDelta: sub.deltas().some((d) => d.upserts.some((row) => row.kind === "user")),
      viaReset: sub.resets().some((r) => r.rows.some((row) => row.kind === "user")),
      afterMs: moved ? Date.now() - appendedAt : null,
      frames: sub.frames().length,
    })}`;
    console.log(words);
    expect(moved, "the appended line reached the tail").toBe(true);
    // the daemon restarted under the tail: a new generation, a new bearer, the
    // tail re-aims and resets with the rows re-read
    const resetsBefore = sub.resets().length;
    const firstPid = daemon.health().rosettad.pid;
    await win.call("system.index.restart", {}).catch(() => undefined);
    if (daemon.health().rosettad.pid === firstPid) await daemon.rosettad?.requestRestart();
    await until(
      () => daemon.health().rosettad.phase === "ready" && daemon.health().rosettad.pid !== firstPid,
      60_000,
    );
    await until(() => sub.resets().length > resetsBefore, 60_000);
    expect(
      sub
        .resets()
        .at(-1)
        ?.rows.some((row) => row.kind === "agent"),
    ).toBe(true);
    expect(daemon.indexTail.openSockets).toBe(1);
  }, 240_000);
});
