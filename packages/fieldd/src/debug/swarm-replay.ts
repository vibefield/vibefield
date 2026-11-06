import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { constants, gunzipSync } from "node:zlib";
import {
  type AgentListResult,
  AgentSessionSummary,
  FIELDD_DEBUG_SWARM_CORPUS_ENV,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AgentMonitorState, MonitorNotification } from "@vibefield/puppeteer-core";
import type { MonitorRuntimeSource } from "@vibefield/puppeteer-monitor";
import type { AgentMonitorFold } from "../agent-monitor";

// PG-9 S4c — THE DEBUG SWARM REPLAY (option A, VF-PM 2026-11-05 03:18Z). DEVELOPMENT ONLY.
//
// James's device run (M1: the phone's mesh rates at n5 and n20, beside the Energy Log) must not
// depend on herding twenty paid agents. So a dev desktop's fieldd plays a recorded synthetic swarm —
// a corpus FILE, field-app's generator output (`perf:godview:corpora`) — on every board it serves,
// and its phone reads it through the REAL door (`agent.subscribe {projection: "remote", scope:
// "mesh"}`): the bytes measured are this daemon's own, its ProductApi's cap and its tailnet door's
// gates included.
//
// The replay stands in for the two sources the boards and the monitor read (the production twins of
// the test fixture's `scriptedFold`, `scriptedRuntime` and `stateOf`, agent-monitor-fixture.ts): the
// FOLD (`agents.list`/`subscribe`), whose rows the model and remote cuts join to the monitor's model
// row per run, and puppeteer's RUNTIME as the monitor reads it (`agents.runtime`'s push bus and
// all-runs snapshot). Both, because a run with no model row has no remote row (agent-model-board.ts).
// The agent runtime itself stays as it is, unread by the boards (daemon.ts's one seam).
//
// fieldd imports NOTHING of field-app's. It parses the JSONL itself, as a tolerant reader: a line
// that is no JSON object is skipped, a frame of a kind it has no word for is counted and said once, a
// field it has no word for is passed through and said once, and a row that breaks the fold's contract
// is dropped and said once. A generated corpus's peer half (`mesh-open`/`mesh-frame`) and its marks
// are known and unused: the replay serves THIS desktop's board alone, and the phone reads the dev
// desktop as its home.
//
// It plays the corpus ONCE, each frame at its own time, then HOLDS its last state: the rows stay
// alive and quiet, and nothing more comes from the replay itself (VF-PM 2026-11-05 06:42Z: no loop —
// S5's M1 needs an idle row on a real phone, the one PU-I reaches James on: the backend's 30 s cost
// step re-emitting every priced row once the swarm is quiet). Restart fieldd to replay. Every row is
// made THIS desktop's: stamped with its device id, and every instant in it moved so the frame's own
// wall is the moment it plays (a corpus is stamped at its recipe's base wall; a board a month stale
// would read as a dead swarm). The rows say they are synthetic in their own words (the generator's
// content).
//
// It plays only while it is heard: its first listener starts the frames and its last one leaving stops
// them, so the daemon's own teardown (the monitor's dispose, every board's) is its stop too; a late
// listener is caught up to the clock in one frame (the held last one, once the span has passed).
//
// Refused when packaged, twice: bin.ts fails the boot of a single executable that is handed one
// (`debugSwarmCorpusOf`), and the shell blanks the variable for a packaged fieldd (main/fieldd.ts).

/** One fold frame of a corpus: its time from the corpus's first fold frame, the wall clock it was
 * stamped at, and its rows as the file holds them (each is validated when it is played). */
export interface SwarmFoldFrame {
  t: number;
  wall: number;
  rows: readonly unknown[];
}

/** A corpus file as the replay reads it: its fold frames, and what it held besides. */
export interface SwarmCorpus {
  /** the header's generator, when the file names one */
  generator: string | undefined;
  /** the fold frames in time order, the first at t = 0; the last is the one held */
  folds: SwarmFoldFrame[];
  /** frames of kinds a generated corpus carries and the replay does not play, by kind */
  unused: Record<string, number>;
  /** frames of kinds this build has no word for, by kind */
  unknown: Record<string, number>;
  /** lines that are no JSON object, or a fold frame with no time or no rows */
  skipped: number;
}

export interface SwarmReplayOptions {
  /** this desktop's device id, read at each frame: every row is stamped with it */
  deviceId: () => string;
  logger?: Logger | undefined;
}

/** The fold `agents` gives the boards, and the runtime `agents.runtime` gives the monitor. */
export interface SwarmReplay extends AgentMonitorFold {
  readonly runtime: MonitorRuntimeSource;
  readonly corpus: SwarmCorpus;
  /** where the replay stands: the fold frame it last played (the last one: held) */
  position(): { frame: number };
  /** item 190 — the frame standing now, played again under this desktop's device id when the id
   * has moved since it played (a mesh identity that arrives after the span); else nothing plays */
  restamp(): void;
  dispose(): void;
}

/** The kinds a corpus header carries (field-app's `corpus-codec.ts`; `meta` is a recorded file's). */
const HEADER_KINDS: ReadonlySet<string> = new Set([
  "corpus-meta",
  "corpus-roster",
  "corpus-panes",
  "meta",
]);
/** The frames a generated corpus carries that the replay does not play: the peer's mesh half, the
 * fold's own failures, and the lab's marks (`corpus-frames.ts`). */
const UNUSED_KINDS: ReadonlySet<string> = new Set([
  "fold-error",
  "mesh-open",
  "mesh-frame",
  "mesh-error",
  "mark",
]);
/** A fold frame's envelope, as the recorder stamps it. */
const FOLD_ENVELOPE: ReadonlySet<string> = new Set(["seq", "t", "wall", "kind", "rows"]);
/** The fold row's own fields: any other rides through (`.passthrough()`) and is said once. */
const ROW_FIELDS: ReadonlySet<string> = new Set(Object.keys(AgentSessionSummary.shape));
/** An instant as `toISOString` writes one: the only strings the replay moves. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A corpus's text (JSONL, gzip already undone), read tolerantly; throws nothing. */
export function parseSwarmCorpus(text: string, logger: Logger = createNoopLogger()): SwarmCorpus {
  let generator: string | undefined;
  const raw: Array<{ seq: number; t: number; wall: number; rows: unknown[] }> = [];
  const unused: Record<string, number> = {};
  const unknown: Record<string, number> = {};
  const noted = new Set<string>();
  let skipped = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      skipped += 1;
      continue;
    }
    if (!isRecord(value)) {
      skipped += 1;
      continue;
    }
    const kind = value["kind"];
    if (kind === "corpus-meta" || kind === "meta") {
      const named = value["generator"];
      if (typeof named === "string") generator = named;
      continue;
    }
    if (typeof kind === "string" && HEADER_KINDS.has(kind)) continue;
    if (kind === "fold") {
      const { t, wall, rows } = value;
      if (!finite(t) || !finite(wall) || !Array.isArray(rows)) {
        skipped += 1;
        continue;
      }
      for (const field of Object.keys(value)) {
        if (FOLD_ENVELOPE.has(field) || noted.has(field)) continue;
        noted.add(field);
        logger.info(
          "fieldd.debug.swarm_unknown_field",
          "A swarm corpus carries a field this build does not read",
          { where: "fold", field },
        );
      }
      const seq = value["seq"];
      raw.push({ seq: finite(seq) ? seq : raw.length, t, wall, rows });
      continue;
    }
    const name = typeof kind === "string" ? kind : "(none)";
    const tally = typeof kind === "string" && UNUSED_KINDS.has(kind) ? unused : unknown;
    tally[name] = (tally[name] ?? 0) + 1;
  }
  for (const [kind, frames] of Object.entries(unknown)) {
    logger.info(
      "fieldd.debug.swarm_unknown_kind",
      "A swarm corpus carries frames of a kind this build does not play",
      { kind, frames },
    );
  }
  // a recorder writes in order; a file joined by hand need not be
  raw.sort((left, right) => left.t - right.t || left.seq - right.seq);
  const t0 = raw[0]?.t ?? 0;
  const folds = raw.map((frame) => ({ t: frame.t - t0, wall: frame.wall, rows: frame.rows }));
  return {
    generator,
    folds,
    unused,
    unknown,
    skipped,
  };
}

/** A corpus file's text: gunzipped when it is a `.gz` (read to its last flush, as field-app's
 * `corpus-io.ts` reads one); throws an error naming the variable and the file. */
export function readSwarmCorpus(path: string): string {
  try {
    if (!existsSync(path)) throw new Error("no such file");
    const bytes = readFileSync(path);
    return path.endsWith(".gz")
      ? gunzipSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8")
      : bytes.toString("utf8");
  } catch (error) {
    throw new Error(
      `${FIELDD_DEBUG_SWARM_CORPUS_ENV} names a corpus that cannot be read: ${path} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

/** The runtime's live state for a fold row: its mirror IS core's projection (the fold carries it
 * verbatim), with the collections a mirror leaves out and the backend never derives from. The
 * production twin of agent-monitor-fixture.ts's `stateOf`. Undefined for a row with no mirror. */
export function swarmStateOf(row: AgentSessionSummary): AgentMonitorState | undefined {
  const mirror = row.monitor;
  if (mirror === undefined) return undefined;
  return {
    modes: { execution: "native-tui" },
    subagentCount: 0,
    subagents: [],
    compaction: { active: false, count: 0 },
    usage: { samples: [] },
    ...(mirror as unknown as Record<string, unknown>),
  } as unknown as AgentMonitorState;
}

/** Every instant in a value moved by `shiftMs`; everything else as it was. */
function rebase(value: unknown, shiftMs: number): unknown {
  if (typeof value === "string") {
    if (!ISO_INSTANT.test(value)) return value;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms + shiftMs).toISOString() : value;
  }
  if (Array.isArray(value)) return value.map((item) => rebase(item, shiftMs));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = rebase(item, shiftMs);
    return out;
  }
  return value;
}

/** The player: the corpus's first frame stands at once, the rest play as the clock reaches them,
 * and the last is held. */
export function createSwarmReplay(corpus: SwarmCorpus, opts: SwarmReplayOptions): SwarmReplay {
  const first = corpus.folds[0];
  if (first === undefined) {
    throw new Error(
      `the ${FIELDD_DEBUG_SWARM_CORPUS_ENV} corpus holds no fold frame: there is no board to play`,
    );
  }
  const logger = opts.logger ?? createNoopLogger();
  const startedAt = Date.now();
  const foldSubscribers = new Set<(rows: AgentListResult) => void>();
  const stateListeners = new Set<(state: AgentMonitorState) => void>();
  const removedListeners = new Set<
    (runtimeRunId: string, removal: { readonly runtimeEpoch: number }) => void
  >();
  const noticeListeners = new Set<(notification: MonitorNotification) => void>();
  const states = new Map<string, AgentMonitorState>();
  const noted = new Set<string>();
  let current: AgentListResult = { sessions: [] };
  let played = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const noteOnce = (key: string, say: () => void): void => {
    if (noted.has(key)) return;
    noted.add(key);
    say();
  };

  // the corpus's first wall becomes the replay's start: every frame's own wall, the moment it plays
  const shift = startedAt - first.wall;

  /** A frame's rows as this desktop's: moved, stamped, validated. */
  const rowsOf = (frame: SwarmFoldFrame): AgentSessionSummary[] => {
    const device = opts.deviceId();
    const rows: AgentSessionSummary[] = [];
    frame.rows.forEach((source, index) => {
      const moved = rebase(source, shift);
      if (isRecord(moved)) moved["device"] = device;
      const parsed = AgentSessionSummary.safeParse(moved);
      if (!parsed.success) {
        const run = isRecord(moved) ? moved["runtimeRunId"] : undefined;
        const issue = parsed.error.issues[0];
        const at = issue?.path.join(".") ?? "";
        noteOnce(`invalid:${typeof run === "string" ? run : `#${index}`}:${at}`, () =>
          logger.warn(
            "fieldd.debug.swarm_row_invalid",
            "A swarm corpus row does not match the fold's contract; it is not played",
            {
              ...(typeof run === "string" ? { runtimeRunId: run } : { index }),
              path: at,
              issue: issue?.message ?? "invalid",
            },
          ),
        );
        return;
      }
      for (const field of Object.keys(moved as Record<string, unknown>)) {
        if (ROW_FIELDS.has(field)) continue;
        noteOnce(`row:${field}`, () =>
          logger.info(
            "fieldd.debug.swarm_unknown_field",
            "A swarm corpus carries a field this build does not read",
            { where: "row", field },
          ),
        );
      }
      rows.push(parsed.data);
    });
    return rows;
  };

  /** One listener's call: a throw is said once and never stops the replay (a timer's throw would). */
  const tell = <A extends unknown[]>(listener: (...args: A) => void, ...args: A): void => {
    try {
      listener(...args);
    } catch (error) {
      noteOnce("listener", () =>
        logger.warn("fieldd.debug.swarm_listener_failed", "A swarm replay listener threw", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  /** One frame played: puppeteer's states on the bus first, then the fold's publish — the order a
   * daemon hears them in (`liveTick`'s, field-app perf/lib/model-stream.ts). */
  const play = (index: number): void => {
    const frame = corpus.folds[index];
    if (frame === undefined) return;
    const rows = rowsOf(frame);
    const listed = new Set<string>();
    for (const row of rows) {
      listed.add(row.runtimeRunId);
      const state = swarmStateOf(row);
      if (state === undefined) continue;
      const held = states.get(row.runtimeRunId);
      if (
        held !== undefined &&
        held.revision === state.revision &&
        held.runtimeEpoch === state.runtimeEpoch
      )
        continue;
      states.set(row.runtimeRunId, state);
      for (const listener of [...stateListeners]) tell(listener, state);
    }
    for (const [runtimeRunId, state] of [...states]) {
      if (listed.has(runtimeRunId)) continue;
      states.delete(runtimeRunId);
      for (const listener of [...removedListeners])
        tell(listener, runtimeRunId, { runtimeEpoch: state.runtimeEpoch });
    }
    current = { sessions: rows };
    played = index;
    for (const emit of [...foldSubscribers]) tell(emit, current);
  };

  const heard = (): boolean =>
    foldSubscribers.size + stateListeners.size + removedListeners.size + noticeListeners.size > 0;
  /** The frame the clock stands at: the last whose time is at or before it (past the span, the last). */
  const standing = (now: number): number => {
    const elapsed = now - startedAt;
    let low = 0;
    let high = corpus.folds.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((corpus.folds[middle]?.t ?? Number.POSITIVE_INFINITY) <= elapsed) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const tick = (): void => {
    timer = null;
    if (disposed || !heard()) return;
    const at = standing(Date.now());
    // late (a loaded host, a listener back after a quiet spell): the frame the clock stands at, once
    if (at > played) play(at);
    arm();
  };
  const arm = (): void => {
    const next = corpus.folds[played + 1];
    // the last frame played: held, nothing left to schedule
    if (disposed || timer !== null || next === undefined || !heard()) return;
    timer = setTimeout(tick, Math.max(0, startedAt + next.t - Date.now()));
    timer.unref?.();
  };
  const quiet = (): void => {
    if (heard() || timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  /** A listener in a set until it leaves: the first one in starts the frames, the last one out stops them. */
  const hear = <L>(set: Set<L>, listener: L): (() => void) => {
    set.add(listener);
    arm();
    return () => {
      set.delete(listener);
      quiet();
    };
  };

  play(0);
  return {
    corpus,
    list: () => current,
    subscribe: (emit) => hear(foldSubscribers, emit),
    runtime: {
      monitorStates: () => [...states.values()],
      onMonitorState: (listener) => hear(stateListeners, listener),
      // a recording carries no notification: the bus is listened on and never speaks
      onMonitorNotification: (listener) => hear(noticeListeners, listener),
      onMonitorRemoved: (listener) => hear(removedListeners, listener),
      // a recorded run has no failure a person can take: the recording owns its rows
      acknowledgeFailureBlocker: async () => false,
    },
    position: () => ({ frame: played }),
    restamp() {
      // item 190 (red): the skeleton plays nothing
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      foldSubscribers.clear();
      stateListeners.clear();
      removedListeners.clear();
      noticeListeners.clear();
    },
  };
}

/** daemon.ts's one seam: the corpus read, played, and said — loudly, once, at boot. Throws (the boot
 * fails) on a corpus that cannot be read or holds no fold frame: a debug seam is never ignored. */
export function openSwarmReplay(opts: SwarmReplayOptions & { path: string }): SwarmReplay {
  const logger = opts.logger ?? createNoopLogger();
  const corpus = parseSwarmCorpus(readSwarmCorpus(opts.path), logger);
  const replay = createSwarmReplay(corpus, { ...opts, logger });
  const runs = new Set(replay.list().sessions.map((row) => row.runtimeRunId));
  logger.warn(
    "fieldd.debug.swarm_replay",
    "This desktop's boards play a recorded synthetic swarm once, then hold it, in place of its agents",
    {
      variable: FIELDD_DEBUG_SWARM_CORPUS_ENV,
      file: basename(opts.path),
      ...(corpus.generator !== undefined ? { generator: corpus.generator } : {}),
      frames: corpus.folds.length,
      runs: runs.size,
      spanMs: corpus.folds.at(-1)?.t ?? 0,
      unused: corpus.unused,
      unknown: corpus.unknown,
      skipped: corpus.skipped,
    },
  );
  return replay;
}

/** bin.ts's reading of FIELDD_DEBUG_SWARM_CORPUS: the corpus's path, or undefined when it is unset or
 * empty (the shell blanks it for a packaged fieldd). A packaged fieldd handed one REFUSES to boot: a
 * synthetic swarm on a person's desktop is never a thing to ignore quietly. */
export function debugSwarmCorpusOf(
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): string | undefined {
  const path = env[FIELDD_DEBUG_SWARM_CORPUS_ENV];
  if (path === undefined || path === "") return undefined;
  if (packaged) {
    throw new Error(
      `${FIELDD_DEBUG_SWARM_CORPUS_ENV} is set, and a packaged fieldd plays no debug swarm: it is a development seam (PG-9 S4c); unset it`,
    );
  }
  return path;
}
