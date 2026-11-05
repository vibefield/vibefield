// PG-9 S4c — the debug swarm replay (`src/debug/swarm-replay.ts`), off the daemon: a corpus file
// read tolerantly, its fold frames played at their own times and looped, and the two sources it
// stands in for — the fold the boards read and the runtime the monitor reads — fed as a daemon's
// are, so the backend assembles a model row for every run and the remote cut serves them. The
// daemon's own seam is swarm-replay.e2e.test.ts; the packaged refusal, swarm-replay-packaged.test.ts.
//
// The corpus is field-app's in-repo n10-2s-s1 (its generator's output): a FILE this test reads, not
// a module it imports (fieldd imports nothing of field-app's; walls R-rules govern imports only).
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_CATALOG,
  type AgentListResult,
  AgentRemoteRow,
  createAgentCatalogReaders,
  FIELDD_DEBUG_SWARM_CORPUS_ENV,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { AgentMonitorState } from "@vibefield/puppeteer-core";
import { createMemoryProjectIdentityStore } from "@vibefield/puppeteer-monitor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteSubscription } from "../src/agent-model-board";
import { createAgentMonitorService } from "../src/agent-monitor";
import {
  createSwarmReplay,
  debugSwarmCorpusOf,
  openSwarmReplay,
  parseSwarmCorpus,
} from "../src/debug/swarm-replay";
import {
  manualClock,
  manualScheduler,
  profileSetsFrame,
  scriptedDevices,
  scriptedProfiles,
  scriptedTerminals,
} from "./agent-monitor-fixture";

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
/** the corpus's ten runs, as its generator names them */
const RUNS = Array.from({ length: 10 }, (_, index) => `run-${index + 1}`).sort();

/** the wall clock a synthetic corpus below was stamped at, and the replay's own */
const CORPUS_WALL = Date.parse("2026-10-03T12:00:00.000Z");
const NOW = Date.parse("2026-11-05T09:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  vi.useRealTimers();
});

interface Logged {
  event: string;
  attrs: Record<string, unknown> | undefined;
}

function captureLogger(events: Logged[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, _message, attrs) => events.push({ event, attrs }),
    debug: (event, _message, attrs) => events.push({ event, attrs }),
    info: (event, _message, attrs) => events.push({ event, attrs }),
    warn: (event, _message, attrs) => events.push({ event, attrs }),
    error: (event, _message, _error, attrs) => events.push({ event, attrs }),
    fatal: (event, _message, _error, attrs) => events.push({ event, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

/** A fold row as the generator writes one (puppeteer's mirror under `monitor`), stamped `at`
 * corpus time: its status began 5 s before, and its one usage sample a tick before. */
function row(
  run: string,
  revision: number,
  status: "idle" | "working" | "blocked",
  atMs: number,
): Record<string, unknown> {
  const wall = CORPUS_WALL + atMs;
  return {
    sessionId: `${run}-native`,
    sessionIdBasis: "observed",
    kind: "scripted",
    label: "Scripted",
    device: "desk-here",
    tier: "managed",
    runtimeRunId: run,
    runtimeEpoch: 1,
    terminal: { hosted: "local", runtimeSessionId: `${run}-pty`, workloadClass: "agent" },
    workspace: { mode: "direct", root: "/work/atlas", sourcePath: "/work/atlas" },
    monitor: {
      schemaVersion: 3,
      runtimeEpoch: 1,
      revision,
      runtimeRunId: run,
      status,
      statusSince: iso(wall - 5_000),
      blockers: [],
      usage: {
        cumulativeTokens: 100 * revision,
        samples: [{ at: iso(wall - 16), cumulativeTokens: 1 }],
      },
      freshness: { lastEvidenceAt: iso(wall), level: "native-hooks" },
      alive: true,
    },
    status,
    observationLevel: "native-hooks",
    createdAt: iso(CORPUS_WALL - 60_000),
    stateChangedAt: iso(wall - 5_000),
  };
}

/** A generated corpus's text: its meta header, then one fold frame per entry. */
function corpusText(
  frames: ReadonlyArray<{ t: number; rows: unknown[] }>,
  extra: readonly string[] = [],
): string {
  const lines = [
    JSON.stringify({
      kind: "corpus-meta",
      generator: "vibefield-godview-corpus",
      recipe: { foldTickMs: 16 },
    }),
    ...frames.map((frame, index) =>
      JSON.stringify({
        seq: index + 1,
        t: frame.t,
        wall: CORPUS_WALL + frame.t,
        kind: "fold",
        rows: frame.rows,
      }),
    ),
    ...extra,
  ];
  return `${lines.join("\n")}\n`;
}

/** Three frames of one run: working at 0 and 16, idle at 48 — one 64 ms pass. */
const THREE = corpusText([
  { t: 0, rows: [row("run-a", 1, "working", 0)] },
  { t: 16, rows: [row("run-a", 2, "working", 16)] },
  { t: 48, rows: [row("run-a", 3, "idle", 48)] },
]);

const revisionOf = (rows: AgentListResult): number | undefined =>
  rows.sessions[0]?.monitor?.revision;

describe("PG-9 S4c — a corpus file, read tolerantly", () => {
  it("reads the in-repo n10-2s-s1: 90 fold frames of ten runs, one 2016 ms pass, the peer half and the mark known and unused", () => {
    expect(existsSync(CORPUS), `the in-repo corpus ${CORPUS}`).toBe(true);
    const replay = openSwarmReplay({ path: CORPUS, deviceId: () => "dev-swarm" });
    cleanup.push(() => replay.dispose());
    const corpus = replay.corpus;
    expect(corpus.folds).toHaveLength(90);
    expect(corpus.generator).toBe("vibefield-godview-corpus");
    // the last fold frame is at 2000 ms; one fold tick (16 ms) closes the pass
    expect(corpus.periodMs).toBe(2_016);
    // one past the highest mirror revision the corpus holds (run-6's, 4705)
    expect(corpus.revisionStride).toBe(4_706);
    expect(corpus.unused).toEqual({ "mesh-open": 1, "mesh-frame": 20, mark: 1 });
    expect(corpus.unknown).toEqual({});
    expect(corpus.skipped).toBe(0);
    expect(
      replay
        .list()
        .sessions.map((session) => session.runtimeRunId)
        .sort(),
    ).toEqual(RUNS);
  });

  it("tolerates what it has no word for — a torn line, a non-object, an unknown kind, an unknown envelope field — each said once, none thrown", () => {
    const logs: Logged[] = [];
    const text = corpusText(
      [
        { t: 0, rows: [row("run-a", 1, "working", 0)] },
        { t: 16, rows: [row("run-a", 2, "working", 16)] },
      ],
      [
        "this is not JSON",
        "42",
        JSON.stringify({ seq: 9, t: 0, wall: CORPUS_WALL, kind: "telemetry", x: 1 }),
        JSON.stringify({ seq: 10, t: 16, wall: CORPUS_WALL + 16, kind: "telemetry" }),
        JSON.stringify({ seq: 11, t: 16, wall: CORPUS_WALL + 16, kind: "mesh-frame", frame: {} }),
        JSON.stringify({ kind: "corpus-roster", devices: [] }),
      ],
    ).replaceAll('"kind":"fold",', '"kind":"fold","extra":true,');
    const corpus = parseSwarmCorpus(text, captureLogger(logs));
    expect(corpus.folds.map((frame) => frame.t)).toEqual([0, 16]);
    expect(corpus.skipped).toBe(2);
    expect(corpus.unknown).toEqual({ telemetry: 2 });
    expect(corpus.unused).toEqual({ "mesh-frame": 1 });
    expect(logs.filter((log) => log.event === "fieldd.debug.swarm_unknown_kind")).toEqual([
      { event: "fieldd.debug.swarm_unknown_kind", attrs: { kind: "telemetry", frames: 2 } },
    ]);
    expect(logs.filter((log) => log.event === "fieldd.debug.swarm_unknown_field")).toEqual([
      { event: "fieldd.debug.swarm_unknown_field", attrs: { where: "fold", field: "extra" } },
    ]);
  });

  it("refuses a corpus with no fold frame: there is no board to play", () => {
    const text = `${JSON.stringify({ kind: "corpus-meta", generator: "vibefield-godview-corpus" })}\n`;
    expect(() => createSwarmReplay(parseSwarmCorpus(text), { deviceId: () => "dev-1" })).toThrow(
      /no fold frame/,
    );
  });

  it("a corpus that cannot be read fails loudly, naming the variable and the file", () => {
    expect(() =>
      openSwarmReplay({ path: "/nowhere/n5-60s-s1.jsonl.gz", deviceId: () => "dev-1" }),
    ).toThrow(new RegExp(`${FIELDD_DEBUG_SWARM_CORPUS_ENV}.*n5-60s-s1\\.jsonl\\.gz`));
  });
});

describe("PG-9 S4c — the frames, played at their own times and looped", () => {
  it("plays each fold frame at its own time: the runtime's state first, then the fold's publish", () => {
    vi.useFakeTimers({ now: NOW });
    const replay = createSwarmReplay(parseSwarmCorpus(THREE), { deviceId: () => "dev-1" });
    cleanup.push(() => replay.dispose());
    // the first frame stands from the start, before anyone listens
    expect(revisionOf(replay.list())).toBe(1);
    expect(replay.runtime.monitorStates().map((state) => state.revision)).toEqual([1]);
    const heard: Array<[string, number | undefined]> = [];
    cleanup.push(replay.subscribe((rows) => heard.push(["fold", revisionOf(rows)])));
    cleanup.push(replay.runtime.onMonitorState((state) => heard.push(["state", state.revision])));
    vi.advanceTimersByTime(15);
    expect(heard).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(heard).toEqual([
      ["state", 2],
      ["fold", 2],
    ]);
    vi.advanceTimersByTime(31);
    expect(heard).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(heard.slice(2)).toEqual([
      ["state", 3],
      ["fold", 3],
    ]);
    expect(replay.position()).toEqual({ pass: 0, frame: 2 });
  });

  it("is this desktop's board: every row stamped with its device, the corpus's clock rebased onto the replay's", () => {
    vi.useFakeTimers({ now: NOW });
    let device = "dev-1";
    const replay = createSwarmReplay(parseSwarmCorpus(THREE), { deviceId: () => device });
    cleanup.push(() => replay.dispose());
    const first = replay.list().sessions[0];
    expect(first?.device).toBe("dev-1");
    // the frame's own wall is the replay's start: every instant in the row moves with it, nested ones too
    expect(first?.monitor?.statusSince).toBe(iso(NOW - 5_000));
    expect(first?.stateChangedAt).toBe(iso(NOW - 5_000));
    const usage = first?.monitor?.usage as { samples?: Array<{ at: string }> } | undefined;
    expect(usage?.samples?.[0]?.at).toBe(iso(NOW - 16));
    cleanup.push(replay.subscribe(() => undefined));
    device = "dev-renamed";
    vi.advanceTimersByTime(16);
    expect(replay.list().sessions[0]?.device).toBe("dev-renamed");
    expect(replay.list().sessions[0]?.monitor?.statusSince).toBe(iso(NOW + 16 - 5_000));
  });

  it("loops: one fold tick after the last frame the first plays again, its revisions past every one the corpus holds, its clock one pass on", () => {
    vi.useFakeTimers({ now: NOW });
    const replay = createSwarmReplay(parseSwarmCorpus(THREE), { deviceId: () => "dev-1" });
    cleanup.push(() => replay.dispose());
    const states: AgentMonitorState[] = [];
    cleanup.push(replay.runtime.onMonitorState((state) => states.push(state)));
    vi.advanceTimersByTime(63);
    expect(replay.position()).toEqual({ pass: 0, frame: 2 });
    vi.advanceTimersByTime(1);
    expect(replay.position()).toEqual({ pass: 1, frame: 0 });
    // the stride is 4 (the corpus's highest revision is 3): the monitor's store takes only a newer one
    expect(revisionOf(replay.list())).toBe(5);
    expect(states.at(-1)?.revision).toBe(5);
    expect(states.at(-1)?.status).toBe("working");
    expect(replay.list().sessions[0]?.monitor?.statusSince).toBe(iso(NOW + 64 - 5_000));
    vi.advanceTimersByTime(64);
    expect(replay.position()).toEqual({ pass: 2, frame: 0 });
    expect(revisionOf(replay.list())).toBe(9);
  });

  it("drops a row that breaks the contract and passes an unknown field through, each said once however often it plays", () => {
    vi.useFakeTimers({ now: NOW });
    const logs: Logged[] = [];
    const frame = (t: number, revision: number) => {
      const kept = { ...row("run-a", revision, "working", t), futureField: "kept" };
      const { sessionId: _dropped, ...broken } = row("run-b", revision, "working", t);
      return { t, rows: [kept, broken] };
    };
    const replay = createSwarmReplay(parseSwarmCorpus(corpusText([frame(0, 1), frame(16, 2)])), {
      deviceId: () => "dev-1",
      logger: captureLogger(logs),
    });
    cleanup.push(() => replay.dispose());
    cleanup.push(replay.subscribe(() => undefined));
    vi.advanceTimersByTime(3 * 32);
    expect(replay.position().pass).toBeGreaterThanOrEqual(2);
    const rows = replay.list().sessions;
    expect(rows.map((session) => session.runtimeRunId)).toEqual(["run-a"]);
    expect((rows[0] as Record<string, unknown>)["futureField"]).toBe("kept");
    expect(logs.filter((log) => log.event === "fieldd.debug.swarm_row_invalid")).toHaveLength(1);
    expect(logs.filter((log) => log.event === "fieldd.debug.swarm_unknown_field")).toEqual([
      { event: "fieldd.debug.swarm_unknown_field", attrs: { where: "row", field: "futureField" } },
    ]);
  });

  it("removes from the runtime a run the corpus stops listing, under the epoch it ran in", () => {
    vi.useFakeTimers({ now: NOW });
    const text = corpusText([
      { t: 0, rows: [row("run-a", 1, "working", 0), row("run-b", 1, "idle", 0)] },
      { t: 16, rows: [row("run-a", 2, "working", 16)] },
    ]);
    const replay = createSwarmReplay(parseSwarmCorpus(text), { deviceId: () => "dev-1" });
    cleanup.push(() => replay.dispose());
    const removed: Array<[string, number]> = [];
    cleanup.push(
      replay.runtime.onMonitorRemoved((runtimeRunId, removal) =>
        removed.push([runtimeRunId, removal.runtimeEpoch]),
      ),
    );
    vi.advanceTimersByTime(16);
    expect(removed).toEqual([["run-b", 1]]);
    expect(replay.runtime.monitorStates().map((state) => state.runtimeRunId)).toEqual(["run-a"]);
  });

  it("plays only while it is heard: no timer without a listener, and a late listener is caught up to the clock", () => {
    vi.useFakeTimers({ now: NOW });
    const replay = createSwarmReplay(parseSwarmCorpus(THREE), { deviceId: () => "dev-1" });
    cleanup.push(() => replay.dispose());
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(replay.position()).toEqual({ pass: 0, frame: 0 });
    const heard: Array<number | undefined> = [];
    const off = replay.subscribe((rows) => heard.push(revisionOf(rows)));
    vi.advanceTimersByTime(0);
    // 100 ms in: the second pass (64 ms each), 36 ms into it — frame 1 (t = 16), played once, not four times
    expect(replay.position()).toEqual({ pass: 1, frame: 1 });
    expect(heard).toEqual([2 + 4]);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("PG-9 S4c — the monitor reads the replay as it reads the runtime", () => {
  it("assembles a model row for every run the replay plays, and the remote cut serves each as this desktop's", async () => {
    expect(existsSync(CORPUS), `the in-repo corpus ${CORPUS}`).toBe(true);
    const replay = openSwarmReplay({ path: CORPUS, deviceId: () => "dev-swarm" });
    cleanup.push(() => replay.dispose());
    const scheduler = manualScheduler();
    const service = createAgentMonitorService({
      runtime: replay.runtime,
      fold: replay,
      terminals: scriptedTerminals([]),
      devices: scriptedDevices({ id: "dev-swarm", name: "Studio", platform: "darwin" }),
      profiles: scriptedProfiles(profileSetsFrame([])),
      catalog: createAgentCatalogReaders(AGENT_CATALOG),
      identity: createMemoryProjectIdentityStore(),
      clock: manualClock(Date.now()).clock,
      scheduler: scheduler.scheduler,
    });
    cleanup.push(() => service.dispose());
    await service.ready;
    await Promise.resolve();
    scheduler.flush();
    expect(
      RUNS.filter((run) => service.rowForRun(run) === undefined),
      "runs with no model row",
    ).toEqual([]);
    const remote = createRemoteSubscription({
      fold: replay,
      monitor: service,
      emit: () => undefined,
    });
    cleanup.push(() => remote.dispose());
    const rows = remote.snapshot.rows.map((entry) => AgentRemoteRow.parse(entry));
    expect(rows.map((entry) => entry.runtimeRunId).sort()).toEqual(RUNS);
    for (const entry of rows) {
      expect(entry.device, entry.runtimeRunId).toBe("dev-swarm");
      expect(entry.monitorRow, entry.runtimeRunId).toMatchObject({
        kind: "agent",
        alive: true,
        device: { id: "dev-swarm" },
      });
    }
  });
});

describe("PG-9 S4c — bin.ts's reading of FIELDD_DEBUG_SWARM_CORPUS", () => {
  it("unset or empty is no swarm, in development and in a package (the shell blanks it there)", () => {
    for (const packaged of [false, true]) {
      expect(debugSwarmCorpusOf({}, packaged)).toBeUndefined();
      expect(debugSwarmCorpusOf({ [FIELDD_DEBUG_SWARM_CORPUS_ENV]: "" }, packaged)).toBeUndefined();
    }
  });

  it("development hands bin.ts the corpus's path", () => {
    expect(debugSwarmCorpusOf({ [FIELDD_DEBUG_SWARM_CORPUS_ENV]: CORPUS }, false)).toBe(CORPUS);
  });

  it("a package refuses it by name, and never ignores it", () => {
    expect(() => debugSwarmCorpusOf({ [FIELDD_DEBUG_SWARM_CORPUS_ENV]: CORPUS }, true)).toThrow(
      new RegExp(`${FIELDD_DEBUG_SWARM_CORPUS_ENV}.*packaged`),
    );
  });
});
