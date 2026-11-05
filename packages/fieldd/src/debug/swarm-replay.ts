import type { AgentListResult, AgentSessionSummary } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { AgentMonitorState } from "@vibefield/puppeteer-core";
import type { MonitorRuntimeSource } from "@vibefield/puppeteer-monitor";
import type { AgentMonitorFold } from "../agent-monitor";

// PG-9 S4c — THE DEBUG SWARM REPLAY (option A, VF-PM 2026-11-05 03:18Z). RED: the names alone; the
// replay is the next commit's.

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
  /** the fold frames in time order, the first at t = 0 */
  folds: SwarmFoldFrame[];
  /** one pass: the last fold frame's time plus one fold tick, the gap the loop leaves */
  periodMs: number;
  /** what each loop adds to every mirror revision: one past the highest the corpus holds */
  revisionStride: number;
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
  /** where the replay stands: the pass (0 first) and the fold frame it last played */
  position(): { pass: number; frame: number };
  dispose(): void;
}

export function parseSwarmCorpus(_text: string, _logger?: Logger): SwarmCorpus {
  return {
    generator: undefined,
    folds: [],
    periodMs: 0,
    revisionStride: 1,
    unused: {},
    unknown: {},
    skipped: 0,
  };
}

export function readSwarmCorpus(_path: string): string {
  return "";
}

export function swarmStateOf(_row: AgentSessionSummary): AgentMonitorState | undefined {
  return undefined;
}

export function createSwarmReplay(corpus: SwarmCorpus, _opts: SwarmReplayOptions): SwarmReplay {
  const empty: AgentListResult = { sessions: [] };
  return {
    corpus,
    list: () => empty,
    subscribe: () => () => undefined,
    runtime: {
      monitorStates: () => [],
      onMonitorState: () => () => undefined,
      onMonitorNotification: () => () => undefined,
      onMonitorRemoved: () => () => undefined,
    },
    position: () => ({ pass: 0, frame: 0 }),
    dispose: () => undefined,
  };
}

export function openSwarmReplay(opts: SwarmReplayOptions & { path: string }): SwarmReplay {
  return createSwarmReplay(parseSwarmCorpus(""), opts);
}

export function debugSwarmCorpusOf(
  _env: Readonly<Record<string, string | undefined>>,
  _packaged: boolean,
): string | undefined {
  return undefined;
}
