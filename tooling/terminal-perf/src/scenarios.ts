// SCENARIOS — deck-4, flood, multi-view — over the pure-JS stages.
//
// A scenario is N corpus traces played into N replicas, INTERLEAVED BY ARRIVAL
// TIME, which is what the render worker's frame queue actually does: one worker,
// one `snapshots` map keyed by session handle, frames arriving from several
// sessions and applied in wire order (`applyFrame` -> `snapshot(id)`,
// terminal-render.worker.js:3203-3212). Playing traces one after another would
// measure the same frames with none of the interleaving, and interleaving is the
// whole difference between "one pane" and "a deck".
//
// WHAT THIS IS NOT. It is stages 5 only — decode and apply. Geometry, raster,
// upload, GPU and compositor need a device, and Node has none; the numbers here
// are a FLOOR on what a deck costs the worker, never the whole of it. §19.3 says
// the same thing in the spec's words ("Honest limit: raster/GPU/compositor
// stages need the lab"), and RESULTS.md repeats it rather than assuming a reader
// remembers.
import { join } from "node:path";
import { type Histogram, medianOf, roundHistogram, summarize } from "./histogram";
import { applyDecodedFrame, decodeFrameBody, emptyReplica } from "./replica";
import { readCaptureFile, type Trf1Capture } from "./trf1-container";

export interface ScenarioDefinition {
  readonly name: string;
  /** Corpus entries to play, one session each. */
  readonly traces: readonly string[];
  readonly what: string;
}

/** The three §15 asks, plus the two arms that make them readable. */
export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    name: "single-pane",
    traces: ["vim-edit"],
    what: "one editing session — the control the others are read against",
  },
  {
    name: "deck-4",
    traces: ["vim-edit", "top-repaint", "git-log-scroll", "ls-recursive"],
    what: "four panes of different character, interleaved as one worker sees them",
  },
  {
    name: "flood",
    traces: ["yes-flood"],
    what: "one session emitting at pty speed — the coalescing arm",
  },
  {
    name: "flood-in-a-deck",
    traces: ["yes-flood", "vim-edit", "top-repaint", "git-log-scroll"],
    what: "a flood beside three ordinary panes — the head-of-line question",
  },
  {
    name: "multi-view",
    traces: ["alt-animation", "alt-animation-exited", "unicode-wall", "softwrap", "redraw-heavy"],
    what: "five heavy repaint sessions at once",
  },
];

interface Arrival {
  readonly session: number;
  readonly offsetUs: number;
  readonly bytes: Uint8Array;
}

/** Merge N traces into one wire-ordered stream. Traces start together, as N
 * panes of one deck do, and each keeps its own recorded cadence. */
export function interleave(captures: readonly Trf1Capture[]): Arrival[] {
  const arrivals: Arrival[] = [];
  for (const [session, capture] of captures.entries()) {
    for (const frame of capture.frames) {
      arrivals.push({ session, offsetUs: frame.offsetUs, bytes: frame.bytes });
    }
  }
  arrivals.sort((a, b) => a.offsetUs - b.offsetUs || a.session - b.session);
  return arrivals;
}

export interface ScenarioResult {
  readonly name: string;
  readonly what: string;
  readonly sessions: number;
  readonly frames: number;
  readonly bytes: number;
  /** The wall time the interleaved stream spans, from its own arrivals. */
  readonly spanMs: number;
  readonly decodeUs: Histogram;
  readonly applyUs: Histogram;
  readonly totalUs: Histogram;
  /** Median across runs of each run's p50 — the estimate on a loaded host. */
  readonly medianOfRunP50Us: number;
  /** Worker CPU spent per second of the scenario's own wall time, as a
   * PERCENTAGE. The headline: a deck that costs 4% of one core in decode+apply
   * is a different product from one that costs 60%. */
  readonly workerCpuPercent: number;
  /** Frames/second the stream delivered, summed across sessions. */
  readonly framesPerSecond: number;
}

export function runScenario(
  definition: ScenarioDefinition,
  corpusDirectory: string,
  options: { runs?: number; warmupRuns?: number } = {},
): ScenarioResult {
  const runs = options.runs ?? 5;
  const warmupRuns = options.warmupRuns ?? 2;
  const captures = definition.traces.map((name) =>
    readCaptureFile(join(corpusDirectory, `${name}.trf1`)),
  );
  const arrivals = interleave(captures);
  const spanUs = arrivals.length === 0 ? 0 : (arrivals[arrivals.length - 1] as Arrival).offsetUs;

  const play = (collect: boolean): { decode: number[]; apply: number[]; total: number[] } => {
    const replicas = captures.map(() => emptyReplica());
    const decode: number[] = [];
    const apply: number[] = [];
    const total: number[] = [];
    for (const arrival of arrivals) {
      const startedAt = process.hrtime.bigint();
      const frame = decodeFrameBody(arrival.bytes);
      const decodedAt = process.hrtime.bigint();
      // Replicas are per SESSION, exactly as the worker keys its snapshots by
      // the decoded `sessionHandle`.
      applyDecodedFrame(replicas[arrival.session] as ReturnType<typeof emptyReplica>, frame);
      const appliedAt = process.hrtime.bigint();
      if (collect) {
        decode.push(Number(decodedAt - startedAt) / 1000);
        apply.push(Number(appliedAt - decodedAt) / 1000);
        total.push(Number(appliedAt - startedAt) / 1000);
      }
    }
    return { decode, apply, total };
  };

  for (let index = 0; index < warmupRuns; index += 1) play(false);

  const decode: number[] = [];
  const apply: number[] = [];
  const total: number[] = [];
  const runP50: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const samples = play(true);
    decode.push(...samples.decode);
    apply.push(...samples.apply);
    total.push(...samples.total);
    runP50.push(summarize(samples.total).p50);
  }

  const bytes = arrivals.reduce((sum, arrival) => sum + arrival.bytes.byteLength, 0);
  const spanMs = spanUs / 1_000;
  // Total CPU one pass costs, from the median run's own total.
  const cpuUsPerPass = medianOf(
    Array.from({ length: runs }, (_, run) =>
      total
        .slice(run * arrivals.length, (run + 1) * arrivals.length)
        .reduce((sum, value) => sum + value, 0),
    ),
  );

  return {
    name: definition.name,
    what: definition.what,
    sessions: captures.length,
    frames: arrivals.length,
    bytes,
    spanMs: Math.round(spanMs * 10) / 10,
    decodeUs: roundHistogram(summarize(decode)),
    applyUs: roundHistogram(summarize(apply)),
    totalUs: roundHistogram(summarize(total)),
    medianOfRunP50Us: Math.round(medianOf(runP50) * 1000) / 1000,
    workerCpuPercent:
      spanMs > 0 ? Math.round((cpuUsPerPass / (spanMs * 1_000)) * 100 * 100) / 100 : 0,
    framesPerSecond: spanMs > 0 ? Math.round((arrivals.length / (spanMs / 1_000)) * 10) / 10 : 0,
  };
}

/**
 * Run every scenario, INTERLEAVED across repeats rather than one after another.
 *
 * The loaded-host rule's A/B discipline applied to a set of arms: running
 * deck-4 five times and then flood five times measures deck-4 during whatever
 * the machine was doing then. Rotating through the arms puts every arm in every
 * phase of the host's own weather, so a difference between arms is more likely
 * to be about the arms.
 */
export function runScenarios(
  corpusDirectory: string,
  options: { runs?: number; warmupRuns?: number; rotations?: number } = {},
): ScenarioResult[] {
  const rotations = options.rotations ?? 3;
  const perRotation: ScenarioResult[][] = [];
  for (let rotation = 0; rotation < rotations; rotation += 1) {
    perRotation.push(
      SCENARIOS.map((definition) =>
        runScenario(definition, corpusDirectory, {
          runs: options.runs ?? 3,
          warmupRuns: rotation === 0 ? (options.warmupRuns ?? 2) : 0,
        }),
      ),
    );
  }
  // The reported arm is the MEDIAN rotation per metric, not the best or the
  // mean: one scheduling storm during rotation 2 moves a mean and does not move
  // a median of three.
  return SCENARIOS.map((definition, index) => {
    const samples = perRotation.map((rotation) => rotation[index] as ScenarioResult);
    const pick = (get: (result: ScenarioResult) => number): number =>
      Math.round(medianOf(samples.map(get)) * 1000) / 1000;
    const first = samples[0] as ScenarioResult;
    return {
      ...first,
      decodeUs: {
        ...first.decodeUs,
        p50: pick((s) => s.decodeUs.p50),
        p95: pick((s) => s.decodeUs.p95),
        p99: pick((s) => s.decodeUs.p99),
      },
      applyUs: {
        ...first.applyUs,
        p50: pick((s) => s.applyUs.p50),
        p95: pick((s) => s.applyUs.p95),
        p99: pick((s) => s.applyUs.p99),
      },
      totalUs: {
        ...first.totalUs,
        p50: pick((s) => s.totalUs.p50),
        p95: pick((s) => s.totalUs.p95),
        p99: pick((s) => s.totalUs.p99),
      },
      medianOfRunP50Us: pick((s) => s.medianOfRunP50Us),
      workerCpuPercent: pick((s) => s.workerCpuPercent),
      name: definition.name,
    };
  });
}

export function formatScenarios(results: readonly ScenarioResult[]): string {
  const lines: string[] = [];
  lines.push(
    "scenario           sess  frames  span ms   fps   decode p50/p95/p99   apply p50/p95/p99   total p50/p99   worker CPU",
  );
  for (const result of results) {
    lines.push(
      [
        result.name.padEnd(18),
        String(result.sessions).padStart(4),
        String(result.frames).padStart(7),
        result.spanMs.toFixed(0).padStart(8),
        result.framesPerSecond.toFixed(0).padStart(5),
        `${result.decodeUs.p50.toFixed(1)}/${result.decodeUs.p95.toFixed(1)}/${result.decodeUs.p99.toFixed(1)}`.padStart(
          20,
        ),
        `${result.applyUs.p50.toFixed(1)}/${result.applyUs.p95.toFixed(1)}/${result.applyUs.p99.toFixed(1)}`.padStart(
          20,
        ),
        `${result.totalUs.p50.toFixed(1)}/${result.totalUs.p99.toFixed(1)}`.padStart(15),
        `${result.workerCpuPercent.toFixed(2)}%`.padStart(11),
      ].join(" "),
    );
  }
  return lines.join("\n");
}
