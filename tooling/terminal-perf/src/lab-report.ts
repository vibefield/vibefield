// THE LAB'S JSONL → NUMBERS — TP-S0c, pure.
//
// The Electron runner writes one JSONL line per event; this turns a run's lines
// into per-arm stage histograms, the A/B grade, the per-resource attribution
// families of §19.1, and the markdown RESULTS. It is pure so the suite can pin
// the reduction against a fixture instead of against a run — a rig whose
// arithmetic is only ever exercised by the thing it measures has no control.
//
// THE ATTRIBUTION SHAPE (§19.1, v0.3). Stages overlap, so summing stage
// durations and naming the largest is false certainty, and one `share` has no
// denominator across latency, worker CPU, GPU duty and wire occupancy. So the
// output is SEPARATE families with a verdict and a confidence each, and
// `mixed` / `unstable` / `host-contention-sensitive` are results rather than
// failures. What this file will not do is invent a family it has no evidence
// for: at S0c the cell and GPU probes do not exist yet (§19.1 rows 1–2 land at
// TP-S3, row 8 at TP-S5), so those families report `no-evidence` and say which
// slice brings the probe. A family filled in from a neighbouring number would
// be the instrument bug TP-R19 is written to catch.
//
// IMPORT STYLE, deliberately mixed in this package: this module is bundled INTO
// the Electron testing artifact by esbuild, so its relative import is
// extensionless like every other package here. The files that `node` runs
// directly (`bin/terminal-perf.ts`, `native-control.ts`) use explicit `.ts`
// extensions instead, because Node's ESM resolver requires them — and the
// package's own tsconfig carries `allowImportingTsExtensions` for exactly those.

import {
  type AbResult,
  type ArmSummary,
  derivedNullArm,
  gradeAb,
  median,
  summarizeArm,
} from "./ab";

export interface StageHistogram {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LabSample {
  mode: string;
  at: number;
  backend: string;
  windowMs: number;
  timedOutWaitingForIdle: boolean;
  gpuQueueDrainMs: number | null;
  frames: {
    received: number;
    bytes: number;
    full: number;
    incremental: number;
    stale: number;
    resyncRequested: number;
    rowsDecoded: number;
    glyphDefinitions: number;
  };
  renderer: Record<string, number>;
  scheduling: { flushes: number; renderCalls: number; maximumDirtyPanes: number };
  stages: {
    frameApplyMs: StageHistogram;
    renderCpuMs: StageHistogram;
    dirtyToRenderMs: StageHistogram;
    frameArrivalToRenderMs: StageHistogram;
  };
  rates: { framesPerSecond: number; bytesPerSecond: number; submitsPerSecond: number };
}

export interface LabFrameSample {
  at: number;
  fps: number;
  frameMs: { p50: number; p95: number; worst: number };
  dropped: number;
  lostMs: number;
  refreshHz: number | null;
  blockingMs: number | null;
  verdict: string;
}

export interface LabArmRecord {
  kind: "arm";
  arm: string;
  rotation: number;
  requestedMode: string;
  effectiveMode: string;
  startedAt: number;
  durationMs: number;
  snapshot: {
    mode: string;
    sourceAttached: boolean;
    rendererBackend: string | null;
    framesRunning: boolean;
    samples: LabSample[];
    frames: LabFrameSample[];
    probes: {
      probeId: string;
      domKeydownMs: number;
      domKeydownWallMs: number;
      eventTimeStampMs: number;
      target: string;
      nextRafMs: number | null;
    }[];
    counters: Record<string, number>;
    dropped: Record<string, number>;
    visibility?: { state: string; focused: boolean; hiddenTransitions: number };
  };
  injected?: { index: number; probeId: string; injectedNs: string; injectedWallMs: number }[];
}

export type LabRecord = { kind: string; scenario: string } & Record<string, unknown>;

export function parseLabJsonl(text: string): LabRecord[] {
  const out: LabRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      out.push(JSON.parse(trimmed) as LabRecord);
    } catch {
      // A truncated last line is what a killed run leaves; keeping the rest is
      // the point of a line-oriented format.
    }
  }
  return out;
}

// ---- per-arm reduction --------------------------------------------------------

/** Median across a set of window summaries.
 *
 * A median of per-window p50s, NOT a pooled p50 — the sampler already reduced
 * the per-frame samples, so pooling them is no longer possible and pretending
 * otherwise would be the pseudo-precision §19.1 warns about. Named
 * `medianOfWindowP50` in the output so nothing downstream reads it as a pooled
 * quantile. */
const pick = (samples: readonly LabSample[], path: (s: LabSample) => StageHistogram) =>
  samples.map(path).filter((stage) => stage.count > 0);

export interface StageRollup {
  windows: number;
  medianOfWindowP50: number;
  medianOfWindowP95: number;
  medianOfWindowP99: number;
  worstWindowMax: number;
}

export function rollupStage(
  samples: readonly LabSample[],
  path: (s: LabSample) => StageHistogram,
): StageRollup {
  const kept = pick(samples, path);
  if (kept.length === 0) {
    return {
      windows: 0,
      medianOfWindowP50: Number.NaN,
      medianOfWindowP95: Number.NaN,
      medianOfWindowP99: Number.NaN,
      worstWindowMax: Number.NaN,
    };
  }
  return {
    windows: kept.length,
    medianOfWindowP50: median(kept.map((s) => s.p50)),
    medianOfWindowP95: median(kept.map((s) => s.p95)),
    medianOfWindowP99: median(kept.map((s) => s.p99)),
    worstWindowMax: Math.max(...kept.map((s) => s.max)),
  };
}

export interface ArmRollup {
  arm: string;
  rotations: number;
  effectiveModes: string[];
  windows: number;
  windowsTimedOut: number;
  windowErrors: number;
  backend: string | null;
  framesPerSecond: number;
  bytesPerSecond: number;
  submitsPerSecond: number;
  framesReceived: number;
  framesFull: number;
  framesIncremental: number;
  rowsDecoded: number;
  drawCalls: number;
  renderPasses: number;
  queueSubmits: number;
  geometryCacheHits: number;
  geometryCacheMisses: number;
  atlasUploadBytes: number;
  gpuQueueDrainMs: number;
  stages: {
    frameApplyMs: StageRollup;
    renderCpuMs: StageRollup;
    dirtyToRenderMs: StageRollup;
    frameArrivalToRenderMs: StageRollup;
  };
  rendererFps: number;
  rendererFrameP95Ms: number;
  droppedFrames: number;
  blockingMs: number | null;
  /** DOM keydown − Chromium's own event timestamp: §18.1 row 1, the platform's
   * input hop, measured by the engine rather than by us. */
  inputHopMs: StageRollup | null;
  /** Arms whose window was not presentable for the whole slot. Any non-zero
   * value here makes every OTHER number in the row a measurement of Chromium's
   * occlusion policy rather than of the terminal. */
  unpresentableArms: number;
  perRotation: { rotation: number; framesPerSecond: number; keystrokeToRafMs: number }[];
}

const sum = (samples: readonly LabSample[], path: (s: LabSample) => number): number =>
  samples.reduce((total, sample) => total + path(sample), 0);

function histogram(values: readonly number[]): StageHistogram {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0)
    return { count: 0, p50: Number.NaN, p95: Number.NaN, p99: Number.NaN, max: Number.NaN };
  const sorted = [...usable].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] as number;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] as number,
  };
}

/** keydown → the first rAF after it, per probe. The renderer's own view of "a
 * frame carried this key"; NOT a present timestamp (the compositor latch is
 * downstream), which is why the field is named for what it is. */
export function keystrokeToRafMs(record: LabArmRecord): number[] {
  return record.snapshot.probes
    .filter((probe) => probe.nextRafMs !== null)
    .map((probe) => (probe.nextRafMs as number) - probe.domKeydownMs)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function rollupArm(arm: string, records: readonly LabArmRecord[]): ArmRollup {
  const samples = records.flatMap((record) => record.snapshot.samples);
  const frames = records.flatMap((record) => record.snapshot.frames);
  const inputHops = records.flatMap((record) =>
    record.snapshot.probes
      .map((probe) => probe.domKeydownMs - probe.eventTimeStampMs)
      .filter((value) => Number.isFinite(value) && value >= 0),
  );
  const seconds = samples.reduce((total, s) => total + s.windowMs, 0) / 1000;
  const per = (total: number) => (seconds > 0 ? total / seconds : Number.NaN);
  return {
    arm,
    rotations: records.length,
    effectiveModes: [...new Set(records.map((r) => r.effectiveMode))],
    windows: samples.length,
    windowsTimedOut: samples.filter((s) => s.timedOutWaitingForIdle).length,
    windowErrors: Math.max(...records.map((r) => r.snapshot.counters["windowErrors"] ?? 0), 0),
    backend: records[0]?.snapshot.rendererBackend ?? null,
    framesPerSecond: per(sum(samples, (s) => s.frames.received)),
    bytesPerSecond: per(sum(samples, (s) => s.frames.bytes)),
    submitsPerSecond: per(sum(samples, (s) => s.renderer["queueSubmits"] ?? 0)),
    framesReceived: sum(samples, (s) => s.frames.received),
    framesFull: sum(samples, (s) => s.frames.full),
    framesIncremental: sum(samples, (s) => s.frames.incremental),
    rowsDecoded: sum(samples, (s) => s.frames.rowsDecoded),
    drawCalls: sum(samples, (s) => s.renderer["drawCalls"] ?? 0),
    renderPasses: sum(samples, (s) => s.renderer["renderPasses"] ?? 0),
    queueSubmits: sum(samples, (s) => s.renderer["queueSubmits"] ?? 0),
    geometryCacheHits: sum(samples, (s) => s.renderer["geometryCacheHits"] ?? 0),
    geometryCacheMisses: sum(samples, (s) => s.renderer["geometryCacheMisses"] ?? 0),
    atlasUploadBytes: sum(samples, (s) => s.renderer["atlasUploadBytes"] ?? 0),
    gpuQueueDrainMs: median(
      samples.map((s) => s.gpuQueueDrainMs ?? Number.NaN).filter(Number.isFinite),
    ),
    stages: {
      frameApplyMs: rollupStage(samples, (s) => s.stages.frameApplyMs),
      renderCpuMs: rollupStage(samples, (s) => s.stages.renderCpuMs),
      dirtyToRenderMs: rollupStage(samples, (s) => s.stages.dirtyToRenderMs),
      frameArrivalToRenderMs: rollupStage(samples, (s) => s.stages.frameArrivalToRenderMs),
    },
    rendererFps: median(frames.map((f) => f.fps)),
    rendererFrameP95Ms: median(frames.map((f) => f.frameMs.p95)),
    droppedFrames: frames.reduce((total, f) => total + f.dropped, 0),
    blockingMs: frames.every((f) => f.blockingMs === null)
      ? null
      : median(frames.map((f) => f.blockingMs ?? 0)),
    unpresentableArms: records.filter((record) => {
      const v = record.snapshot.visibility;
      return v !== undefined && (v.state !== "visible" || v.hiddenTransitions > 0);
    }).length,
    inputHopMs:
      inputHops.length === 0
        ? null
        : {
            windows: 1,
            medianOfWindowP50: histogram(inputHops).p50,
            medianOfWindowP95: histogram(inputHops).p95,
            medianOfWindowP99: histogram(inputHops).p99,
            worstWindowMax: histogram(inputHops).max,
          },
    perRotation: records.map((record) => ({
      rotation: record.rotation,
      framesPerSecond: median(record.snapshot.samples.map((s) => s.rates.framesPerSecond)),
      keystrokeToRafMs: median(keystrokeToRafMs(record)),
    })),
  };
}

// ---- attribution families (§19.1) --------------------------------------------

export type FamilyVerdict =
  | "primary"
  | "secondary"
  | "mixed"
  | "unstable"
  | "host-contention-sensitive"
  | "no-evidence";

export interface AttributionFamily {
  family: string;
  verdict: FamilyVerdict;
  confidence: "high" | "medium" | "low";
  contributors: { stage: string; value: number; units: string }[];
  /** Why this family reads the way it does, including which probe is missing
   * and which slice brings it. */
  evidence: string;
}

export function attribution(rollup: ArmRollup): AttributionFamily[] {
  const apply = rollup.stages.frameApplyMs;
  const raster = rollup.stages.renderCpuMs;
  const dirty = rollup.stages.dirtyToRenderMs;
  const arrival = rollup.stages.frameArrivalToRenderMs;
  const haveWorker =
    Number.isFinite(apply.medianOfWindowP50) || Number.isFinite(raster.medianOfWindowP50);

  const workerContributors = [
    { stage: "decode+apply (frameApplyMs)", value: apply.medianOfWindowP50, units: "ms/frame" },
    { stage: "raster CPU (renderCpuMs)", value: raster.medianOfWindowP50, units: "ms/flush" },
  ].filter((c) => Number.isFinite(c.value));

  // "unstable" is a real verdict, not a failure: a window whose p99 is many
  // multiples of its p50 is telling the truth about a loaded host.
  const spread = (stage: StageRollup): number =>
    Number.isFinite(stage.medianOfWindowP50) && stage.medianOfWindowP50 > 0
      ? stage.medianOfWindowP99 / stage.medianOfWindowP50
      : Number.NaN;
  const workerSpread = Math.max(spread(apply), spread(raster));

  return [
    {
      family: "latencyCriticalPathContributors",
      verdict: Number.isFinite(dirty.medianOfWindowP50) ? "mixed" : "no-evidence",
      confidence: Number.isFinite(dirty.medianOfWindowP50) ? "low" : "low",
      contributors: [
        {
          stage: "damage → presented (dirtyToRenderMs)",
          value: dirty.medianOfWindowP50,
          units: "ms",
        },
        {
          stage: "arrival → presented (frameArrivalToRenderMs)",
          value: arrival.medianOfWindowP50,
          units: "ms",
        },
        ...(rollup.inputHopMs === null
          ? []
          : [
              {
                stage: "OS event → DOM keydown (platform)",
                value: rollup.inputHopMs.medianOfWindowP50,
                units: "ms",
              },
            ]),
      ].filter((c) => Number.isFinite(c.value)),
      evidence:
        "the renderer half only. §18.1 rows 3–5 (wire, cell, vault, PTY) have no probe until " +
        "TP-S3's cell perf snapshot and the profiling envelope, so no keystroke→photon split " +
        "can be attributed here — `mixed` is the honest verdict for a path measured at two of " +
        "its eight hops.",
    },
    {
      family: "workerCpuContributors",
      verdict: !haveWorker
        ? "no-evidence"
        : workerSpread > 8
          ? "unstable"
          : apply.medianOfWindowP50 > raster.medianOfWindowP50
            ? "primary"
            : "secondary",
      confidence: rollup.windows >= 10 ? "medium" : "low",
      contributors: workerContributors,
      evidence:
        `${rollup.windows} metrics windows; p99/p50 spread ${Number.isFinite(workerSpread) ? workerSpread.toFixed(1) : "n/a"}×. ` +
        "Upload µs, per-RasterKey raster and GPU pass timings are §19.1 rows 6–8 and land at TP-S5.",
    },
    {
      family: "cellCpuContributors",
      verdict: "no-evidence",
      confidence: "low",
      contributors: [],
      evidence:
        "§19.1 rows 1–2 (parse ns, encode ns, coalesced-away frames, credit stalls) are cell-side " +
        "and land at TP-S3/S4 with the upstream bundle. Nothing in the renderer can stand in for them.",
    },
    {
      family: "terminalGpuDutyContributors",
      verdict: Number.isFinite(rollup.gpuQueueDrainMs) ? "mixed" : "no-evidence",
      confidence: "low",
      contributors: [
        {
          stage: "queue drain at window close (gpuQueueDrainMs)",
          value: rollup.gpuQueueDrainMs,
          units: "ms",
        },
        { stage: "queue submits", value: rollup.submitsPerSecond, units: "/s" },
        { stage: "render passes", value: rollup.renderPasses, units: "count" },
        { stage: "draw calls", value: rollup.drawCalls, units: "count" },
      ].filter((c) => Number.isFinite(c.value)),
      evidence:
        "`gpuQueueDrainMs` is a DRAIN taken once at window close, not per pass — it is the " +
        "observer effect of measuring, and it is reported as such. Per-pass GPU time needs " +
        "WebGPU `timestamp-query` with its ≈100µs Chromium quantization recorded (§19.1 row 8, TP-S5).",
    },
    {
      family: "wireOccupancyContributors",
      verdict: Number.isFinite(rollup.bytesPerSecond) ? "mixed" : "no-evidence",
      confidence: "low",
      contributors: [
        { stage: "frame bytes", value: rollup.bytesPerSecond, units: "B/s" },
        { stage: "frames received", value: rollup.framesPerSecond, units: "/s" },
        { stage: "full frames", value: rollup.framesFull, units: "count" },
        { stage: "incremental frames", value: rollup.framesIncremental, units: "count" },
      ].filter((c) => Number.isFinite(c.value)),
      evidence:
        "measured at the WORKER's end of the wire only. The interval form §19.1 row 3 asks for " +
        "(`damageFirstTs`/`encodeTs` vs `recvTs` with `clockOffsetEstimate`) needs the profiling " +
        "envelope, which lands at TP-S3.",
    },
  ];
}

// ---- the report ---------------------------------------------------------------

const fixed = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";

const bytes = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${Math.round(value)} B`;
};

export interface LabReportInput {
  scenario: string;
  records: readonly LabRecord[];
  host: Record<string, unknown>;
  /** The raw-mode echo fixture's side channel, when the scenario ran one. */
  echo?: readonly {
    kind: string;
    probeId?: string;
    index?: number;
    receivedNs?: string;
    fixtureNs?: string;
    monotonicOriginNs?: string;
    cols?: number | null;
    rows?: number | null;
  }[];
}

/** `keydown injected -> the child program read the byte`, per probe, in ms.
 *
 * This is §18.1's FIRST measured item — "keydown → PTY write accepted", the one
 * the spec hypothesises at ≤1ms p50 — and it is the only end-to-end interval the
 * software rig can close without a photon: the lab stamps the injection in
 * Electron main and the fixture stamps the receipt in its own process, both
 * `process.hrtime.bigint()`, both CLOCK_MONOTONIC_RAW on this platform, so they
 * subtract directly.
 *
 * Pairing is by ARRIVAL ORDER over the a–z probes only. The fixture also records
 * the newline that `pasteAndSubmit` used to start it and anything the shell
 * echoed on the way in; those carry no injection stamp and are skipped rather
 * than matched to the wrong key. */
export function pairInjectedKeys(
  records: readonly LabArmRecord[],
  echo: NonNullable<LabReportInput["echo"]>,
): { inputPathMs: number[]; fixtureMs: number[]; injected: number; received: number } {
  const start = echo.find((r) => r.kind === "start");
  if (start?.monotonicOriginNs === undefined) {
    return { inputPathMs: [], fixtureMs: [], injected: 0, received: 0 };
  }
  const origin = BigInt(start.monotonicOriginNs);
  const injected = records
    .flatMap((record) => record.injected ?? [])
    .filter((key) => /^[a-z0-9]$/u.test(key.probeId));
  const received = echo.filter(
    (r) => r.kind === "key" && r.probeId !== undefined && /^[a-z0-9]$/u.test(r.probeId),
  );
  const inputPathMs: number[] = [];
  const fixtureMs: number[] = [];
  const n = Math.min(injected.length, received.length);
  for (let i = 0; i < n; i += 1) {
    const key = injected[i];
    const echoed = received[i];
    if (key === undefined || echoed?.receivedNs === undefined) continue;
    if (key.probeId !== echoed.probeId) continue; // a drop or a reorder, not a latency
    const ms = Number(origin + BigInt(echoed.receivedNs) - BigInt(key.injectedNs)) / 1e6;
    // The same two refusals the native control makes, for the same reasons: a
    // negative interval means two clocks, a huge one means focus loss.
    if (ms < 0 || ms > 1_000) continue;
    inputPathMs.push(ms);
    if (echoed.fixtureNs !== undefined) fixtureMs.push(Number(BigInt(echoed.fixtureNs)) / 1e6);
  }
  return { inputPathMs, fixtureMs, injected: injected.length, received: received.length };
}

export interface LabReport {
  scenario: string;
  arms: ArmRollup[];
  ab: AbResult[];
  attribution: AttributionFamily[];
  echoPairing: ReturnType<typeof pairInjectedKeys> | null;
  markdown: string;
}

/** The metrics an A/B may be graded on.
 *
 * `samplerIndependent` is the load-bearing field, and it exists because the
 * lab's first deck-4 A/B tried to compare `frames/s presented` between a
 * `metrics` arm and an `off` arm. That number COMES FROM the sampler: in the
 * `off` arm nobody measures frames, so the comparison was 16 windows against a
 * straggler, and it printed a −9.2% "within-budget" that meant nothing at all.
 *
 * A probe-overhead A/B — arms that differ in sampler MODE — may only be graded
 * on quantities the lab observes for itself: its own injected keystrokes and its
 * own rAF/LoAF loop. Those are measured identically in every arm, which is the
 * whole requirement. Everything else is reported per arm and never differenced
 * across modes. */
const AB_METRICS: {
  key: string;
  units: string;
  samplerIndependent: boolean;
  of: (rollup: ArmRollup, records: readonly LabArmRecord[]) => number[];
}[] = [
  {
    key: "frames/s presented",
    units: "frames/s",
    samplerIndependent: false,
    of: (_r, records) =>
      records.map((record) => median(record.snapshot.samples.map((s) => s.rates.framesPerSecond))),
  },
  {
    key: "keystroke → next rAF",
    units: "ms",
    samplerIndependent: true,
    of: (_r, records) => records.map((record) => median(keystrokeToRafMs(record))),
  },
  {
    key: "renderer frame interval p95",
    units: "ms",
    samplerIndependent: true,
    of: (_r, records) =>
      records.map((record) => median(record.snapshot.frames.map((f) => f.frameMs.p95))),
  },
  {
    key: "renderer fps",
    units: "fps",
    samplerIndependent: true,
    of: (_r, records) => records.map((record) => median(record.snapshot.frames.map((f) => f.fps))),
  },
];

export function buildLabReport(input: LabReportInput): LabReport {
  const armRecords = input.records.filter((r): r is LabRecord & LabArmRecord => r.kind === "arm");
  const byArm = new Map<string, LabArmRecord[]>();
  for (const record of armRecords) {
    byArm.set(record.arm, [...(byArm.get(record.arm) ?? []), record]);
  }
  const arms = [...byArm.entries()].map(([arm, records]) => rollupArm(arm, records));

  // The A/B compares the FIRST arm (the treatment — the mode being priced)
  // against the second (the control). With one arm there is nothing to compare
  // and the derived null arm is all that is available; the grade says so.
  const ab: AbResult[] = [];
  const skipped: string[] = [];
  const [first, second] = [...byArm.keys()];
  // Do the arms differ in the mode the SAMPLER actually ran in? Read from the
  // effective mode the renderer reported back, never from the requested one —
  // a build that refuses `metrics` would otherwise look like a probe-overhead
  // A/B while running two identical arms.
  const effectiveModes = new Set(arms.flatMap((arm) => arm.effectiveModes));
  const modesDiffer = effectiveModes.size > 1;
  if (first !== undefined) {
    for (const metric of AB_METRICS) {
      if (modesDiffer && !metric.samplerIndependent) {
        skipped.push(metric.key);
        continue;
      }
      const treatmentRecords = byArm.get(first) as LabArmRecord[];
      const treatment = summarizeArm(
        first,
        metric.of(rollupArm(first, treatmentRecords), treatmentRecords),
      );
      if (treatment.rotations.length === 0) continue;
      const control =
        second === undefined
          ? derivedNullArm(treatment)
          : summarizeArm(
              second,
              metric.of(
                rollupArm(second, byArm.get(second) as LabArmRecord[]),
                byArm.get(second) as LabArmRecord[],
              ),
            );
      ab.push(
        gradeAb({
          metric: metric.key,
          units: metric.units,
          treatment,
          control,
          // The null arm is derived from the CONTROL's own rotations: how much
          // an unchanged condition wanders across this run.
          nullArm: derivedNullArm(control),
          // TP-R18's number, applied to every metric an A/B of the sampler
          // modes is graded on. A scenario A/B that is not about probe overhead
          // reports the delta ungraded (gradeAb returns `inconclusive`).
          budgetRelative: first === "metrics" && second === "off" ? 0.05 : null,
        }),
      );
    }
  }

  const attributionFamilies = arms.length > 0 ? attribution(arms[0] as ArmRollup) : [];
  const echoPairing = input.echo === undefined ? null : pairInjectedKeys(armRecords, input.echo);
  return {
    scenario: input.scenario,
    arms,
    ab,
    attribution: attributionFamilies,
    echoPairing,
    markdown: renderMarkdown(
      input,
      arms,
      ab,
      attributionFamilies,
      skipped,
      echoPairing,
      input.echo,
    ),
  };
}

function renderMarkdown(
  input: LabReportInput,
  arms: readonly ArmRollup[],
  ab: readonly AbResult[],
  families: readonly AttributionFamily[],
  skippedMetrics: readonly string[] = [],
  echoPairing: ReturnType<typeof pairInjectedKeys> | null = null,
  echo: LabReportInput["echo"] = undefined,
): string {
  const run = input.records.find((r) => r.kind === "run");
  const layout = input.records.find((r) => r.kind === "layout");
  const generator = input.records.find((r) => r.kind === "generator");
  const notHostable = input.records.find((r) => r.kind === "not-hostable");
  const trace = input.records.find((r) => r.kind === "trace");
  const cold = input.records.find((r) => r.kind === "cold-open" && r["missing"] !== true);
  const failed = input.records.find((r) => r.kind === "failed");
  const resources = input.records.filter((r) => r.kind === "resources");
  const census = input.records.find((r) => r.kind === "pty-census");

  const lines: string[] = [];
  lines.push(`# TP-S0c lab run — \`${input.scenario}\``, "");

  if (notHostable !== undefined) {
    lines.push(
      "## NOT HOSTABLE at S0c",
      "",
      "This scenario has no host in the product today, so no numbers were produced.",
      "The rig refuses to substitute a different layout under this name.",
      "",
      `> ${String(notHostable["why"] ?? "(no reason recorded)")}`,
      "",
    );
    return lines.join("\n");
  }

  lines.push("## 1. The run", "", "| | |", "|---|---|");
  lines.push(`| scenario | \`${input.scenario}\` |`);
  if (run !== undefined) {
    const plan = run["plan"] as { note?: string } | null;
    if (plan?.note !== undefined) lines.push(`| what it is | ${plan.note} |`);
    lines.push(`| electron | ${String(run["electron"])} · chrome ${String(run["chrome"])} |`);
    lines.push(
      `| arms | ${JSON.stringify(run["arms"])} × ${String(run["rotations"])} rotations of ${String(run["armMs"])}ms |`,
    );
  }
  if (layout !== undefined) {
    const size = layout["windowContentSize"] as { width: number; height: number } | undefined;
    lines.push(
      `| layout | requested ${String(layout["requested"])} panes, reached **${String(layout["reached"])}**${layout["ceiling"] === null ? "" : ` — ceiling: ${String(layout["ceiling"])}`} |`,
    );
    if (size !== undefined) {
      lines.push(
        `| window | ${size.width}×${size.height} css px @ DPR ${String(layout["devicePixelRatio"] ?? "?")} — a pane ceiling is meaningless without it |`,
      );
    }
  }
  if (generator !== undefined) {
    lines.push(
      `| generator | \`${String(generator["which"])}\` ${JSON.stringify(generator["detail"])} |`,
    );
  }
  for (const [key, value] of Object.entries(input.host)) {
    lines.push(`| ${key} | ${typeof value === "object" ? JSON.stringify(value) : String(value)} |`);
  }
  if (cold !== undefined) {
    const phases = (cold["phases"] ?? {}) as Record<string, number>;
    lines.push(
      `| cold open (§19.1 row 13) | **${Number(cold["totalMs"]).toFixed(1)} ms** total — ` +
        `${Object.entries(phases)
          .map(([k, v]) => `${k} ${v.toFixed(0)}`)
          .join(" · ")}` +
        `${cold["prewarmed"] === true ? " · prewarmed" : " · cold"} |`,
    );
  }
  lines.push("");
  if (failed !== undefined) {
    lines.push(
      "> **This run FAILED partway.** Everything below is what it did collect.",
      "",
      "```",
      String(failed["error"]),
      "```",
      "",
    );
  }

  lines.push(
    "## 2. Stage histograms — the required deliverable",
    "",
    "Per `metrics` window, milliseconds. `medianOfWindowP50` is a **median of the",
    "windows' own p50s** — the sampler reduces per-frame samples before the lab sees",
    "them, so this is not a pooled quantile and is not labelled as one.",
    "",
    "| arm | mode | windows | apply p50/p95/p99 | raster p50/p95/p99 | damage→present p50/p99 | arrival→present p50/p99 |",
    "|---|---|---:|---|---|---|---|",
  );
  for (const arm of arms) {
    const s = arm.stages;
    lines.push(
      `| ${arm.arm} | ${arm.effectiveModes.join("/")} | ${arm.windows} | ` +
        `${fixed(s.frameApplyMs.medianOfWindowP50)}/${fixed(s.frameApplyMs.medianOfWindowP95)}/${fixed(s.frameApplyMs.medianOfWindowP99)} | ` +
        `${fixed(s.renderCpuMs.medianOfWindowP50)}/${fixed(s.renderCpuMs.medianOfWindowP95)}/${fixed(s.renderCpuMs.medianOfWindowP99)} | ` +
        `${fixed(s.dirtyToRenderMs.medianOfWindowP50)}/${fixed(s.dirtyToRenderMs.medianOfWindowP99)} | ` +
        `${fixed(s.frameArrivalToRenderMs.medianOfWindowP50)}/${fixed(s.frameArrivalToRenderMs.medianOfWindowP99)} |`,
    );
  }
  lines.push("");

  lines.push(
    "## 3. Counters and rates",
    "",
    "| arm | frames/s | bytes/s | submits/s | full/incr | rows decoded | draw calls | passes | geom hit% | atlas up | gpu drain | renderer fps | frame p95 | dropped | LoAF |",
    "|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const arm of arms) {
    const cacheTotal = arm.geometryCacheHits + arm.geometryCacheMisses;
    lines.push(
      `| ${arm.arm} | ${fixed(arm.framesPerSecond, 1)} | ${bytes(arm.bytesPerSecond)} | ${fixed(arm.submitsPerSecond, 1)} | ` +
        `${arm.framesFull}/${arm.framesIncremental} | ${arm.rowsDecoded} | ${arm.drawCalls} | ${arm.renderPasses} | ` +
        `${cacheTotal > 0 ? ((arm.geometryCacheHits / cacheTotal) * 100).toFixed(1) : "—"} | ${bytes(arm.atlasUploadBytes)} | ` +
        `${fixed(arm.gpuQueueDrainMs)} | ${fixed(arm.rendererFps, 1)} | ${fixed(arm.rendererFrameP95Ms)} | ${arm.droppedFrames} | ` +
        `${arm.blockingMs === null ? "unobservable" : fixed(arm.blockingMs)} |`,
    );
  }
  lines.push("");
  const unpresentable = arms.reduce((total, arm) => total + arm.unpresentableArms, 0);
  if (unpresentable > 0) {
    lines.push(
      `> **${unpresentable} arm slot(s) ran while the window was not presentable** (hidden or`,
      "> occluded). Chromium suspends rAF and backgrounds an occluded renderer, so those slots",
      "> report zeros that read like a very fast terminal. Every number above that comes from such",
      "> a slot is void; re-run with the window unobstructed.",
      "",
    );
  }
  const timedOut = arms.reduce((total, arm) => total + arm.windowsTimedOut, 0);
  if (timedOut > 0) {
    lines.push(
      `> ${timedOut} of ${arms.reduce((t, a) => t + a.windows, 0)} windows closed on their DEADLINE rather than on idle.`,
      "> Under a flood that is the normal outcome and never an error — every number in a",
      "> timed-out window describes a still-busy renderer (`terminal-perf-types.ts`).",
      "",
    );
  }

  if (ab.length > 0) {
    lines.push(
      "## 4. The A/B — interleaved, medians, tails gated by the null arm",
      "",
      "| metric | treatment | control | Δ | Δ% | null arm moved | verdict |",
      "|---|---:|---:|---:|---:|---:|---|",
    );
    for (const row of ab) {
      lines.push(
        `| ${row.metric} (${row.units}) | ${fixed(row.treatment.median)} | ${fixed(row.control.median)} | ` +
          `${fixed(row.deltaAbsolute)} | ${Number.isFinite(row.deltaRelative) ? `${(row.deltaRelative * 100).toFixed(1)}%` : "—"} | ` +
          `${row.noiseRelative === null ? "—" : `${(row.noiseRelative * 100).toFixed(1)}%`} | **${row.verdict}** — ${row.reason} |`,
      );
    }
    lines.push("");
    if (skippedMetrics.length > 0) {
      lines.push(
        `> Not graded across these arms, because the arms differ in sampler mode and these ` +
          `numbers COME FROM the sampler: ${skippedMetrics.map((m) => `\`${m}\``).join(", ")}. ` +
          "They are reported per arm in §3 and must not be differenced across modes.",
        "",
      );
    }
  }

  if (echoPairing !== null && echoPairing.inputPathMs.length > 0) {
    const h = histogram(echoPairing.inputPathMs);
    const f = histogram(echoPairing.fixtureMs);
    const start = echo?.find((r) => r.kind === "start");
    lines.push(
      "## 4b. keydown → PTY write accepted (§18.1's first measured item)",
      "",
      "The raw-mode echo fixture in the pane, with the lab's own injection stamp.",
      "Electron main stamps `process.hrtime.bigint()` the instant before",
      "`sendInputEvent`; the fixture stamps the same clock the instant it reads the",
      "byte. Both are CLOCK_MONOTONIC_RAW on this platform, so they subtract with no",
      "offset estimation. This interval covers DOM keydown → the surface → the",
      "control socket → the cell → the vault → the pty → the child, and it excludes",
      "the shell entirely — which is the whole point of a raw-mode fixture.",
      "",
      `Fixture geometry: ${start?.cols ?? "?"}×${start?.rows ?? "?"} cells.`,
      "",
      "| | p50 | p95 | p99 | max | n |",
      "|---|---:|---:|---:|---:|---:|",
      `| keydown → child read (ms) | **${fixed(h.p50, 3)}** | ${fixed(h.p95, 3)} | ${fixed(h.p99, 3)} | ${fixed(h.max, 3)} | ${h.count} |`,
      `| fixture's own read→write (ms) | ${fixed(f.p50, 3)} | ${fixed(f.p95, 3)} | ${fixed(f.p99, 3)} | ${fixed(f.max, 3)} | ${f.count} |`,
      "",
      `${echoPairing.injected} keys injected, ${echoPairing.received} reached the fixture, ` +
        `${h.count} paired.`,
      "",
      "> This injection is `sendInputEvent`, which enters at Chromium's input layer",
      "> and therefore does NOT include the OS/window-server hop a real keypress",
      "> takes. The native control uses CGEvents for exactly that reason, and the",
      "> difference between the two is that hop.",
      "",
    );
  }

  if (families.length > 0) {
    lines.push("## 5. Attribution, per resource (§19.1)", "");
    for (const family of families) {
      lines.push(
        `**\`${family.family}\`** — verdict **${family.verdict}**, confidence ${family.confidence}`,
        "",
      );
      if (family.contributors.length > 0) {
        lines.push("| contributor | value | units |", "|---|---:|---|");
        for (const c of family.contributors) {
          lines.push(`| ${c.stage} | ${fixed(c.value)} | ${c.units} |`);
        }
        lines.push("");
      }
      lines.push(`> ${family.evidence}`, "");
    }
  }

  if (resources.length > 0) {
    lines.push(
      "## 6. The process resource formula (TC §9 · §19.1 row 14)",
      "",
      "| phase | role | pid | fds | net sockets | threads | phys_footprint |",
      "|---|---|---:|---:|---:|---:|---:|",
    );
    for (const reading of resources) {
      const processes = (reading["processes"] ?? []) as {
        role: string;
        pid: number;
        fds: number | null;
        networkSockets: number | null;
        threads: number | null;
        physicalFootprintKb: number | null;
      }[];
      for (const p of processes) {
        lines.push(
          `| ${String(reading["phase"])} | ${p.role} | ${p.pid} | ${p.fds ?? "—"} | ${p.networkSockets ?? "—"} | ` +
            `${p.threads ?? "—"} | ${p.physicalFootprintKb === null ? "—" : `${(p.physicalFootprintKb / 1024).toFixed(1)} MiB`} |`,
        );
      }
    }
    lines.push("");
  }

  if (census !== undefined) {
    const leaked = Number(census["leaked"] ?? 0);
    lines.push(
      "## 6b. The pty census",
      "",
      "`kern.tty.ptmx_max` is **511 on macOS and it is SYSTEM-WIDE**: a scenario that",
      "leaks ptys does not slow itself down, it fails every terminal test, every godview",
      "smoke and every new shell on the machine. So each run counts `/dev/ttys*` before",
      "it spawns anything and again after teardown.",
      "",
      "| | ptys |",
      "|---|---:|",
      `| before the run | ${String(census["before"])} |`,
      `| after teardown | ${String(census["after"])} |`,
      `| returned | ${String(census["returned"] ?? "—")} |`,
      `| ptys still out after teardown | ${leaked} |`,
      `| returned within the wait | ${census["settled"] === true ? "yes" : "no (45s)"} |`,
      `| **this worktree's surviving lab Electrons** | **${String(census["survivingLabElectrons"] ?? "—")}** |`,
      `| **this worktree's surviving processes (all)** | **${String(census["survivingProcesses"] ?? "—")}** |`,
      `| teardown | ${String(census["note"])} |`,
      "",
      Number(census["survivingProcesses"] ?? 0) > 0
        ? "> **THIS RUN LEAKED.** " +
            `${String(census["survivingProcesses"])} of its own processes survived teardown ` +
            `(${((census["survivingKinds"] ?? []) as string[]).join(", ")}). Every number above ` +
            "describes a machine that was also holding this run's leftovers. Run " +
            "`pnpm perf:terminal --reap` and re-measure."
        : "> Clean: nothing of this run survived its teardown. The pty delta is the corroborating " +
            "evidence, not the claim — this machine is shared, so another agent's shells can hold " +
            "the count above the baseline through no fault of the run. (`/dev/ttys*` nodes are also " +
            "released LAZILY: an earlier fixed 1.5s sleep reported a four-pty leak on a run that had " +
            "leaked nothing, which is why the census waits for the return instead.)",
      "",
    );
  }

  if (trace !== undefined) {
    const atStart = (trace["availableCategoriesAtStart"] ?? []) as string[];
    const atEnd = (trace["availableCategoriesAtEnd"] ?? []) as string[];
    lines.push(
      "## 7. The trace",
      "",
      `Perfetto trace: \`${String(trace["path"])}\` — open it at ui.perfetto.dev.`,
      "",
      `- \`requestedTraceConfig\`: \`${JSON.stringify(trace["requestedTraceConfig"])}\``,
      `- \`availableCategoriesAtStart\`: ${atStart.length} categories`,
      `- \`availableCategoriesAtEnd\`: ${atEnd.length} categories` +
        (atEnd.length > atStart.length
          ? ` (**${atEnd.length - atStart.length} more than at start** — ` +
            "`getCategories()` reports what is AVAILABLE, which grows as code paths are first " +
            "reached; it is not a list of what the recording enabled)"
          : ""),
      "",
      "> `trace` mode's observer effect is real and is never the sole grade of a budget (§19).",
      "",
    );
  }

  return lines.join("\n");
}

export type { AbResult, ArmSummary };
