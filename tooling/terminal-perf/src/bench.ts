// THE WORKER REPLAY MICROBENCH — the pure-JS stages over the TRF1 corpus.
//
// Stages 5's two halves from §19.1's ladder, in Node, with no Electron and no
// GPU: `decodeFrame` (the shipping decoder, inlined verbatim into the worker
// bundle) and the replica apply (ours — see `replica.ts` for exactly why). The
// honest limit is the spec's own: raster, upload, GPU and compositor stages need
// the lab, because WebGPU is absent in Node.
//
// MEASUREMENT DISCIPLINE, in the order it matters:
//   * WARM-UP before any timed run, so JIT tiering is not the thing measured.
//   * REPEATED runs, and the estimate is the MEDIAN of the per-run p50s, never
//     a single run's — this host is never quiet (the loaded-host rule).
//   * PER-FRAME timing with `hrtime.bigint()`, whose resolution is nanoseconds,
//     rather than a total divided by a count, so the tails are real.
//   * A NULL ARM available on demand: the same loop over the same frames doing
//     the trivial work, which says what the harness itself costs.
import { readdirSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { type Histogram, medianOf, roundHistogram, summarize } from "./histogram";
import { applyDecodedFrame, decodeFrameBody, emptyReplica } from "./replica";
import { readCaptureFile, type Trf1Capture } from "./trf1-container";

export interface TraceResult {
  readonly name: string;
  readonly frames: number;
  readonly bytes: number;
  /** Per-frame `decodeFrame` duration, microseconds. */
  readonly decodeUs: Histogram;
  /** Per-frame replica apply duration (decode excluded), microseconds. */
  readonly applyUs: Histogram;
  /** decode + apply, the stage-5 total a frame actually costs. */
  readonly totalUs: Histogram;
  /** The estimate: median across runs of each run's p50, microseconds. */
  readonly medianOfRunP50Us: { readonly decode: number; readonly apply: number };
  /** What the frames turned out to be — a distribution's context. */
  readonly classes: { readonly apply: number; readonly stale: number; readonly resync: number };
  readonly rowsApplied: number;
  readonly glyphsDefined: number;
  /** MiB/s of TRF1 through decode+apply, from the medians. */
  readonly throughputMiBPerSecond: number;
}

export interface BenchOptions {
  /** Timed runs over each trace. */
  readonly runs?: number;
  /** Untimed passes before the first timed one. */
  readonly warmupRuns?: number;
  /** Run the null arm and report its cost beside the real one. */
  readonly nullArm?: boolean;
}

interface RunSamples {
  decode: number[];
  apply: number[];
  total: number[];
  classes: { apply: number; stale: number; resync: number };
  rowsApplied: number;
  glyphsDefined: number;
}

const US_PER_NS = 1 / 1000;

function runOnce(capture: Trf1Capture, collect: boolean): RunSamples {
  const replica = emptyReplica();
  const samples: RunSamples = {
    decode: [],
    apply: [],
    total: [],
    classes: { apply: 0, stale: 0, resync: 0 },
    rowsApplied: 0,
    glyphsDefined: 0,
  };
  for (const record of capture.frames) {
    const startedAt = process.hrtime.bigint();
    const frame = decodeFrameBody(record.bytes);
    const decodedAt = process.hrtime.bigint();
    const outcome = applyDecodedFrame(replica, frame);
    const appliedAt = process.hrtime.bigint();
    if (collect) {
      samples.decode.push(Number(decodedAt - startedAt) * US_PER_NS);
      samples.apply.push(Number(appliedAt - decodedAt) * US_PER_NS);
      samples.total.push(Number(appliedAt - startedAt) * US_PER_NS);
      samples.classes[outcome.klass] += 1;
      samples.rowsApplied += outcome.rowsApplied;
      samples.glyphsDefined += outcome.glyphsDefined;
    }
  }
  return samples;
}

/**
 * The NULL ARM: the same iteration over the same frames, touching each frame's
 * bytes but doing no decode.
 *
 * Without it a 6us decode has no scale — it could be five microseconds of loop.
 * With it the report can say "the loop costs 0.05us and the decode costs 6.0",
 * which is a measurement rather than an assertion.
 */
export function nullArm(capture: Trf1Capture): Histogram {
  const samples: number[] = [];
  let sink = 0;
  for (const record of capture.frames) {
    const startedAt = process.hrtime.bigint();
    sink += record.bytes.byteLength + (record.bytes[0] as number);
    samples.push(Number(process.hrtime.bigint() - startedAt) * US_PER_NS);
  }
  if (sink === -1) throw new Error("unreachable");
  return summarize(samples);
}

export function benchTrace(
  name: string,
  capture: Trf1Capture,
  options: BenchOptions = {},
): TraceResult {
  const runs = options.runs ?? 5;
  const warmupRuns = options.warmupRuns ?? 2;

  for (let index = 0; index < warmupRuns; index += 1) runOnce(capture, false);

  const decode: number[] = [];
  const apply: number[] = [];
  const total: number[] = [];
  const runDecodeP50: number[] = [];
  const runApplyP50: number[] = [];
  let classes = { apply: 0, stale: 0, resync: 0 };
  let rowsApplied = 0;
  let glyphsDefined = 0;

  for (let index = 0; index < runs; index += 1) {
    const samples = runOnce(capture, true);
    decode.push(...samples.decode);
    apply.push(...samples.apply);
    total.push(...samples.total);
    runDecodeP50.push(summarize(samples.decode).p50);
    runApplyP50.push(summarize(samples.apply).p50);
    // The last run's classification is reported: every run replays the same
    // frames into a fresh replica, so they agree by construction, and taking
    // the last avoids multiplying the counts by `runs`.
    classes = samples.classes;
    rowsApplied = samples.rowsApplied;
    glyphsDefined = samples.glyphsDefined;
  }

  const bytes = capture.frames.reduce((sum, frame) => sum + frame.bytes.byteLength, 0);
  const medianDecode = medianOf(runDecodeP50);
  const medianApply = medianOf(runApplyP50);
  const perFrameUs = medianDecode + medianApply;
  const meanFrameBytes = capture.frames.length > 0 ? bytes / capture.frames.length : 0;

  return {
    name,
    frames: capture.frames.length,
    bytes,
    decodeUs: roundHistogram(summarize(decode)),
    applyUs: roundHistogram(summarize(apply)),
    totalUs: roundHistogram(summarize(total)),
    medianOfRunP50Us: {
      decode: Math.round(medianDecode * 1000) / 1000,
      apply: Math.round(medianApply * 1000) / 1000,
    },
    classes,
    rowsApplied,
    glyphsDefined,
    throughputMiBPerSecond:
      perFrameUs > 0
        ? Math.round((((meanFrameBytes / perFrameUs) * 1_000_000) / (1024 * 1024)) * 100) / 100
        : 0,
  };
}

export interface BenchReport {
  readonly startedAt: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly loadAvg1: number;
  readonly runs: number;
  readonly warmupRuns: number;
  readonly traces: readonly TraceResult[];
  /** Every frame in the corpus, pooled — the corpus-level distribution. */
  readonly corpus: {
    readonly frames: number;
    readonly bytes: number;
    readonly decodeUs: Histogram;
    readonly applyUs: Histogram;
    readonly totalUs: Histogram;
  };
  /** The harness's own per-frame cost, if the null arm ran. */
  readonly nullArmUs?: Histogram;
}

/** Every `.trf1` in a directory, sorted, with the manifest skipped. */
export function corpusFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".trf1"))
    .sort();
}

export function runBench(directory: string, options: BenchOptions = {}): BenchReport {
  const files = corpusFiles(directory);
  if (files.length === 0) throw new Error(`no .trf1 fixtures in ${directory}`);

  const traces: TraceResult[] = [];
  const allDecode: number[] = [];
  const allApply: number[] = [];
  const allTotal: number[] = [];
  let nullSamples: Histogram | undefined;

  for (const file of files) {
    const capture = readCaptureFile(join(directory, file));
    if (capture.frames.length === 0) continue;
    const result = benchTrace(capture.header.name, capture, options);
    traces.push(result);
    // The pooled distribution needs the raw samples, and `benchTrace` keeps
    // only histograms, so one extra timed pass feeds the corpus view. It is a
    // pass with the same warm-up state as the last timed run, which is the
    // point: pooling cold and warm samples would blur the tail.
    const samples = runOnce(capture, true);
    allDecode.push(...samples.decode);
    allApply.push(...samples.apply);
    allTotal.push(...samples.total);
    if (options.nullArm === true && nullSamples === undefined) nullSamples = nullArm(capture);
  }

  return {
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    loadAvg1: Math.round((loadavg()[0] as number) * 100) / 100,
    runs: options.runs ?? 5,
    warmupRuns: options.warmupRuns ?? 2,
    traces,
    corpus: {
      frames: allDecode.length,
      bytes: traces.reduce((sum, trace) => sum + trace.bytes, 0),
      decodeUs: roundHistogram(summarize(allDecode)),
      applyUs: roundHistogram(summarize(allApply)),
      totalUs: roundHistogram(summarize(allTotal)),
    },
    ...(nullSamples === undefined ? {} : { nullArmUs: roundHistogram(nullSamples) }),
  };
}

/** A fixed-width table — the form a PR comment and a RESULTS.md both want. */
export function formatReport(report: BenchReport): string {
  const lines: string[] = [];
  lines.push(
    `corpus: ${report.traces.length} traces · ${report.corpus.frames} frame-samples · ` +
      `${(report.corpus.bytes / 1024 / 1024).toFixed(2)} MiB TRF1`,
  );
  lines.push(
    `host: node ${report.node} ${report.platform}/${report.arch} · load1 ${report.loadAvg1} · ` +
      `${report.runs} runs after ${report.warmupRuns} warm-up`,
  );
  lines.push("");
  lines.push(
    "trace                    frames    KiB   decode p50/p95/p99/max us      apply p50/p95/p99/max us    MiB/s",
  );
  for (const trace of report.traces) {
    lines.push(
      [
        trace.name.padEnd(24),
        String(trace.frames).padStart(6),
        (trace.bytes / 1024).toFixed(0).padStart(7),
        `${trace.decodeUs.p50.toFixed(1)}/${trace.decodeUs.p95.toFixed(1)}/${trace.decodeUs.p99.toFixed(1)}/${trace.decodeUs.max.toFixed(1)}`.padStart(
          28,
        ),
        `${trace.applyUs.p50.toFixed(1)}/${trace.applyUs.p95.toFixed(1)}/${trace.applyUs.p99.toFixed(1)}/${trace.applyUs.max.toFixed(1)}`.padStart(
          28,
        ),
        trace.throughputMiBPerSecond.toFixed(0).padStart(7),
      ].join(" "),
    );
  }
  lines.push("");
  lines.push(
    `CORPUS decode p50/p95/p99/max: ${report.corpus.decodeUs.p50}/${report.corpus.decodeUs.p95}/${report.corpus.decodeUs.p99}/${report.corpus.decodeUs.max} us`,
  );
  lines.push(
    `CORPUS apply  p50/p95/p99/max: ${report.corpus.applyUs.p50}/${report.corpus.applyUs.p95}/${report.corpus.applyUs.p99}/${report.corpus.applyUs.max} us`,
  );
  lines.push(
    `CORPUS total  p50/p95/p99/max: ${report.corpus.totalUs.p50}/${report.corpus.totalUs.p95}/${report.corpus.totalUs.p99}/${report.corpus.totalUs.max} us`,
  );
  if (report.nullArmUs !== undefined) {
    lines.push(
      `NULL ARM (loop only)  p50/p99: ${report.nullArmUs.p50}/${report.nullArmUs.p99} us — the harness's own cost`,
    );
  }
  return lines.join("\n");
}
