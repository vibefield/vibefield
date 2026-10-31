import {
  AGENT_FIELD,
  type AgentFieldDelta,
  type AgentFieldSnapshot,
  type AgentListResult,
  type AgentModelDelta,
  type AgentSessionSummary,
} from "@vibefield/contracts";
import type { MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";
import {
  createFieldSubscription,
  deskProjector,
  type ProjectedFieldRow,
  projectDeskRow,
  projectFieldRow,
  projectModelTerminalRow,
  type RowProjector,
} from "../../../fieldd/src/agent-field";
import {
  createModelSubscription,
  type ModelBoardSources,
} from "../../../fieldd/src/agent-model-board";
import {
  type CorpusRecipe,
  type CorpusTick,
  generateCorpus,
  recipeName,
  resolveRecipe,
} from "../../src/godview/monitor/perf/corpus";
import {
  deviceOf,
  floorOfPanes,
  type HostedDesktop,
  hostDesktop,
  liveTick,
  type VirtualTime,
  wire,
} from "./model-stream";

// THE PROJECTION BENCH (PG-1e0; `thinking-phone-godview.md` §8, PG-1's brief
// §PG-1e). Every cut of a desktop's board re-lists the fold on every apply,
// re-projects EVERY row and stamps each one as JSON to find what moved
// (`projection.ts`, `RowsProjection.apply`). How much of that work moves
// nothing, and how many cuts pay it for the same rows, decides 1e1 (one shared
// cut and cadence group), 1e2 (per-row incremental projection) or neither.
//
// A desktop serves three cuts of its own rows, as `daemon.ts`'s
// `openLocalBoard` wires them:
//   · `model` — its own windows: the model board at `AGENT_FIELD.FULL_TICK_MS`
//     with the urgent edge, agents and bare terminals;
//   · `desk` — a peer desktop's hub: the desk board at
//     `DESK_MIN_INTERVAL_MS`, the mesh heartbeat, woken by the backend too;
//   · `field` — the phone: the field board at `MIN_INTERVAL_MS`, the fold's
//     alone.
// The bench hosts the corpus's own desktop as `model-stream.ts` does and runs
// each cut ALONE over the same ticks, on virtual time:
//   · COUNTS — the sources a cut reads are wrapped, so every apply, every item
//     it projects and every stamp it makes is counted; the stamps are re-derived
//     by the same exported projectors the cut runs (`projectDeskRow` for the
//     window, `projectModelTerminalRow`, the desk and field projectors), and the
//     frames it emits are counted as sent. Deterministic: any host serves.
//   · CPU — the same replay with nothing wrapped, `process.cpuUsage` around the
//     ticks, beside a pass with no cut at all, interleaved so each cut's pass has
//     its own baseline next to it and the baselines' spread is the noise floor.
//     Host-bound: only on a quiet host.
// Every cut lists the fold as `agents.list()` does, a fresh sorted row per run
// on each call (`runtimeListing`), so a listing costs a pass what it costs a
// daemon.
// No fieldd line is touched: the cuts are fieldd's own, imported as the model
// stream imports them.

export type BenchCut = "model" | "desk" | "field";
export const BENCH_CUTS: readonly BenchCut[] = ["model", "desk", "field"];

/** Each cut's floor, as the daemon's askers ask it. */
export const CUT_FLOOR_MS: Record<BenchCut, number> = {
  model: AGENT_FIELD.FULL_TICK_MS,
  desk: AGENT_FIELD.DESK_MIN_INTERVAL_MS,
  field: AGENT_FIELD.MIN_INTERVAL_MS,
};

/** One cut over one corpus, as counted. */
export interface CutCounts {
  cut: BenchCut;
  floorMs: number;
  /** the fold listed: the open's projection, then one per apply */
  applies: number;
  /** items projected, summed over every apply (agent rows, and the model's
   * bare terminals) */
  projected: number;
  /** the JSON the stamps came to, in UTF-16 units (`string.length`) */
  stampChars: number;
  /** projected items whose stamp differed from the same row's last one (a row
   * new to the board counts): the rows an apply actually had to find */
  moved: number;
  /** the frames sent after the open: deltas and snapshots */
  frames: number;
  /** of which deltas carrying nothing (the mesh heartbeat) */
  emptyFrames: number;
  /** of which mid-stream snapshots (a re-present or a repair, PG-1d) */
  snapshots: number;
  upserts: number;
  removed: number;
  /** the frames' JSON, in UTF-16 units */
  frameChars: number;
}

export interface BenchCounts {
  recipe: string;
  n: number;
  durationMs: number;
  /** the board at the open: the fold's agents, and the bare terminals the
   * model board draws beside them */
  agents: number;
  terminals: number;
  cuts: CutCounts[];
}

/** A corpus, generated once: every pass replays a fresh copy of its ticks. */
export interface PreparedCorpus {
  recipe: CorpusRecipe;
  name: string;
  baseWall: number;
  durationMs: number;
  device: { id: string; name?: string; platform?: string };
  floor: ReturnType<typeof floorOfPanes>;
  ticks: CorpusTick[];
}

export function prepareCorpus(input: CorpusRecipe): PreparedCorpus {
  const recipe = resolveRecipe(input);
  const lived: CorpusTick[] = [];
  const corpus = generateCorpus(recipe, (tick) => lived.push(tick));
  // through JSON once the corpus is complete, as the model stream reads it
  const ticks = wire(lived);
  const first = ticks[0];
  if (first?.tMs !== 0 || first.here === undefined) {
    throw new Error("the corpus's first tick carries no board");
  }
  const agentPtys = new Set(
    first.here.flatMap((row) =>
      row.terminal?.runtimeSessionId !== undefined ? [row.terminal.runtimeSessionId] : [],
    ),
  );
  return {
    recipe: input,
    name: recipeName(input),
    baseWall: recipe.baseWall,
    durationMs: recipe.durationMs,
    device: deviceOf(corpus.roster, corpus.meta.here),
    floor: floorOfPanes(corpus.panes, agentPtys),
    ticks,
  };
}

/** What a pass attaches to the hosted desktop: a cut, or nothing. */
type Attach = (desktop: HostedDesktop) => () => void;

/**
 * One replay: the desktop hosted as the model stream hosts it, with a window's
 * screen open (the model's unread is per screen), `attach` run, then every
 * tick's states and publish, and the trailing floors. `measure` brackets the
 * attach and the ticks — what the cut adds is inside it; the hosting is not.
 */
async function replay(
  prepared: PreparedCorpus,
  time: VirtualTime,
  attach: Attach | null,
  measure: { start(): void; stop(): void } = { start() {}, stop() {} },
): Promise<void> {
  if (time.now() !== prepared.baseWall) {
    throw new Error(
      `the virtual clock must start at the recipe's baseWall (${prepared.baseWall}); it reads ${time.now()}`,
    );
  }
  const ticks = wire(prepared.ticks);
  const first = ticks[0] as CorpusTick & { here: AgentSessionSummary[] };
  const here = await hostDesktop(prepared.device, first.here, prepared.floor, time);
  const screen = here.service.openScreen("the-bench-window", { acknowledges: true });
  measure.start();
  const detach = attach?.(here) ?? (() => undefined);
  for (const tick of ticks.slice(1)) {
    await time.advance(prepared.baseWall + tick.tMs - time.now());
    if (tick.here !== undefined) liveTick(here, tick.here);
    await time.advance(0);
  }
  // the trailing floors: what the last ticks' changes still owe each cut
  await time.advance(Math.max(...Object.values(CUT_FLOOR_MS)));
  measure.stop();
  detach();
  screen();
  here.service.dispose();
}

/** The counters a cut's wrapped sources feed. An apply begins at its listing;
 * a row the apply did not project leaves the stamps, as it leaves
 * `RowsProjection`'s, so a row that comes back counts as moved again. */
class Meter {
  applies = 0;
  projected = 0;
  stampChars = 0;
  moved = 0;
  readonly #stamps = new Map<string, string>();
  #seen = new Set<string>();

  begin(): void {
    if (this.applies > 0) {
      for (const key of this.#stamps.keys()) if (!this.#seen.has(key)) this.#stamps.delete(key);
    }
    this.#seen = new Set();
    this.applies += 1;
  }

  stamp(key: string, projected: unknown): void {
    const stamp = JSON.stringify(projected);
    this.projected += 1;
    this.stampChars += stamp.length;
    this.#seen.add(key);
    if (this.#stamps.get(key) !== stamp) {
      this.moved += 1;
      this.#stamps.set(key, stamp);
    }
  }
}

class Sent {
  frames = 0;
  emptyFrames = 0;
  snapshots = 0;
  upserts = 0;
  removed = 0;
  frameChars = 0;

  delta(frame: { upserts: readonly unknown[]; removed: readonly unknown[] }): void {
    this.frames += 1;
    this.frameChars += JSON.stringify(frame).length;
    this.upserts += frame.upserts.length;
    this.removed += frame.removed.length;
    if (frame.upserts.length === 0 && frame.removed.length === 0) this.emptyFrames += 1;
  }

  snapshot(frame: unknown): void {
    this.frames += 1;
    this.snapshots += 1;
    this.frameChars += JSON.stringify(frame).length;
  }
}

/** The fold's listing as `agents.list()` makes it (`agent-runtime.ts`
 * `list`): a fresh row per run on every call, sorted by `createdAt`, which
 * every cut pays once per apply. The scripted fold hands back one cached list,
 * which would price the listing at nothing in the CPU passes and let a memo
 * keyed by a row's identity hit where production's never could (the bench's
 * review, 2026-10-31). */
function runtimeListing(desktop: HostedDesktop): () => AgentListResult {
  return () => {
    const rows = desktop.fold
      .list()
      .sessions.map((summary) => ({ createdAt: summary.createdAt, row: { ...summary } }));
    rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return { sessions: rows.map((r) => r.row) };
  };
}

/** The model board's sources, counted: `itemsOf`'s own reads (the listing, a
 * run's model row, the bare terminals and each one's join), each item's stamp
 * re-derived as `projectItem` derives it. */
function countedModelSources(
  desktop: HostedDesktop,
  list: () => AgentListResult,
  meter: Meter,
  chars: number,
): ModelBoardSources {
  let sessions = new Map<string, AgentSessionSummary>();
  let terminals = new Map<string, MonitorAgentRow>();
  return {
    fold: {
      list: () => {
        const listed = list();
        meter.begin();
        sessions = new Map(listed.sessions.map((summary) => [summary.runtimeRunId, summary]));
        return listed;
      },
      subscribe: (fn) => desktop.fold.subscribe(fn),
    },
    monitor: {
      subscribe: (listener) => desktop.service.subscribe(listener),
      rowForRun: (runtimeRunId) => {
        const row = desktop.service.rowForRun(runtimeRunId);
        const summary = sessions.get(runtimeRunId);
        if (summary !== undefined)
          meter.stamp(runtimeRunId, projectDeskRow(summary, chars, row, "window"));
        return row;
      },
      terminalRows: () => {
        const rows = desktop.service.terminalRows();
        terminals = new Map(rows.map((row) => [row.id, row]));
        return rows;
      },
      terminalJoin: (sessionId) => {
        const join = desktop.service.terminalJoin(sessionId);
        const row = terminals.get(sessionId);
        if (row !== undefined) meter.stamp(row.id, projectModelTerminalRow(row, join ?? {}));
        return join;
      },
    },
  };
}

/** A field-shaped cut's projector, counted: the stamp is the projected row. */
function countedProjector(project: RowProjector, meter: Meter): RowProjector {
  return (summary): ProjectedFieldRow => {
    const row = project(summary);
    meter.stamp(row.runtimeRunId, row);
    return row;
  };
}

/** The desk board's wake-ups: the fold's publish AND the backend's changes (a
 * peer's cut carries the model row), as `openLocalBoard` subscribes it. */
function deskWake(desktop: HostedDesktop): (fn: () => void) => () => void {
  return (fn) => {
    const offFold = desktop.fold.subscribe(fn);
    const offModel = desktop.service.subscribe(() => fn());
    return () => {
      offFold();
      offModel();
    };
  };
}

/** A cut attached to a hosted desktop; counted when a meter and a tally are
 * given, bare otherwise (the CPU passes). */
function attachCut(cut: BenchCut, counted?: { meter: Meter; sent: Sent }): Attach {
  const chars = AGENT_FIELD.DESK_TEXT_CHARS;
  return (desktop) => {
    const list = runtimeListing(desktop);
    if (cut === "model") {
      const board = createModelSubscription({
        ...(counted !== undefined
          ? countedModelSources(desktop, list, counted.meter, chars)
          : {
              fold: { list, subscribe: (fn) => desktop.fold.subscribe(fn) },
              monitor: desktop.service,
            }),
        emit: (delta: AgentModelDelta) => counted?.sent.delta(delta),
        epoch: "bench-model.1",
        minIntervalMs: CUT_FLOOR_MS.model,
        chars,
      });
      return board.dispose;
    }
    const meter = counted?.meter;
    const listed = (): AgentListResult => {
      const rows = list();
      meter?.begin();
      return rows;
    };
    const project =
      cut === "desk"
        ? deskProjector((runtimeRunId) => desktop.service.rowForRun(runtimeRunId), chars)
        : projectFieldRow;
    const board = createFieldSubscription({
      list: meter !== undefined ? listed : list,
      subscribe: cut === "desk" ? deskWake(desktop) : (fn) => desktop.fold.subscribe(fn),
      emit: (frame: AgentFieldDelta | AgentFieldSnapshot, kind) => {
        if (counted === undefined) return;
        if (kind === "delta") counted.sent.delta(frame as AgentFieldDelta);
        else counted.sent.snapshot(frame);
      },
      epoch: `bench-${cut}.1`,
      project: meter !== undefined ? countedProjector(project, meter) : project,
      minIntervalMs: CUT_FLOOR_MS[cut],
      ...(cut === "desk" ? { heartbeatMs: AGENT_FIELD.MESH_HEARTBEAT_MS } : {}),
      terminalPublished: () => true,
    });
    return board.dispose;
  };
}

/** One cut over one corpus, counted. */
export async function countCut(
  prepared: PreparedCorpus,
  cut: BenchCut,
  time: VirtualTime,
): Promise<CutCounts> {
  const meter = new Meter();
  const sent = new Sent();
  await replay(prepared, time, attachCut(cut, { meter, sent }));
  return {
    cut,
    floorMs: CUT_FLOOR_MS[cut],
    applies: meter.applies,
    projected: meter.projected,
    stampChars: meter.stampChars,
    moved: meter.moved,
    frames: sent.frames,
    emptyFrames: sent.emptyFrames,
    snapshots: sent.snapshots,
    upserts: sent.upserts,
    removed: sent.removed,
    frameChars: sent.frameChars,
  };
}

/** The board at the corpus's open: its agents, and the bare terminals the
 * backend draws beside them once hosted. */
export async function boardAtOpen(
  prepared: PreparedCorpus,
  time: VirtualTime,
): Promise<{ agents: number; terminals: number }> {
  let counted = { agents: 0, terminals: 0 };
  await replay(prepared, time, (desktop) => {
    counted = {
      agents: desktop.fold.list().sessions.length,
      terminals: desktop.service.terminalRows().length,
    };
    return () => undefined;
  });
  return counted;
}

/** One pass's CPU, in microseconds (user + system), over the attach and the
 * ticks: a cut, or `null` for the baseline with none. */
export async function timeCut(
  prepared: PreparedCorpus,
  cut: BenchCut | null,
  time: VirtualTime,
): Promise<number> {
  let started: ReturnType<typeof process.cpuUsage> | undefined;
  let spent = 0;
  await replay(prepared, time, cut === null ? null : attachCut(cut), {
    start() {
      started = process.cpuUsage();
    },
    stop() {
      const used = process.cpuUsage(started);
      spent = used.user + used.system;
    },
  });
  return spent;
}

/** Per corpus-second, to one decimal. */
export function perSecond(count: number, durationMs: number): number {
  return Math.round((count / (durationMs / 1_000)) * 10) / 10;
}

/** The median of a non-empty list. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
