import { describe, expect, it } from "vitest";
import {
  attribution,
  buildLabReport,
  keystrokeToRafMs,
  type LabArmRecord,
  type LabSample,
  parseLabJsonl,
  rollupArm,
  rollupStage,
} from "../src/lab-report";

// Fixtures, not runs. The reduction has to be checkable without a GPU, and the
// two rows that matter most here are the two the lab got WRONG on its first
// real runs: a straggling window attributed to the arm after it, and a
// sampler-derived metric differenced across sampler modes.

const stage = (p50: number, p95 = p50, p99 = p95, max = p99, count = 10) => ({
  count,
  p50,
  p95,
  p99,
  max,
});

const sample = (overrides: Partial<LabSample> = {}): LabSample => ({
  mode: "metrics",
  at: 1,
  backend: "webgpu",
  windowMs: 1_000,
  timedOutWaitingForIdle: false,
  gpuQueueDrainMs: 0.2,
  frames: {
    received: 10,
    bytes: 1_000,
    full: 1,
    incremental: 9,
    stale: 0,
    resyncRequested: 0,
    rowsDecoded: 100,
    glyphDefinitions: 0,
  },
  renderer: {
    queueSubmits: 20,
    drawCalls: 50,
    renderPasses: 30,
    geometryCacheHits: 8,
    geometryCacheMisses: 2,
    atlasUploadBytes: 0,
  },
  scheduling: { flushes: 5, renderCalls: 5, maximumDirtyPanes: 1 },
  stages: {
    frameApplyMs: stage(0.1, 0.2),
    renderCpuMs: stage(0.2, 0.3),
    dirtyToRenderMs: stage(0.4, 3.6),
    frameArrivalToRenderMs: stage(0.4, 5.1),
  },
  rates: { framesPerSecond: 10, bytesPerSecond: 1_000, submitsPerSecond: 20 },
  ...overrides,
});

const arm = (
  name: string,
  rotation: number,
  options: {
    samples?: LabSample[];
    effectiveMode?: string;
    fps?: number;
    frameP95?: number;
    probes?: { keydown: number; raf: number | null }[];
    visible?: boolean;
  } = {},
): LabArmRecord => ({
  kind: "arm",
  arm: name,
  rotation,
  requestedMode: name,
  effectiveMode: options.effectiveMode ?? name,
  startedAt: 0,
  durationMs: 10_000,
  snapshot: {
    mode: options.effectiveMode ?? name,
    sourceAttached: true,
    rendererBackend: "webgpu",
    framesRunning: true,
    samples: options.samples ?? [],
    frames: [
      {
        at: 1,
        fps: options.fps ?? 120,
        frameMs: { p50: 8.3, p95: options.frameP95 ?? 9.2, worst: 12 },
        dropped: 0,
        lostMs: 0,
        refreshHz: 120,
        blockingMs: 0,
        verdict: "healthy",
      },
    ],
    probes: (options.probes ?? [{ keydown: 100, raf: 103.4 }]).map((p, i) => ({
      probeId: "a",
      domKeydownMs: p.keydown,
      domKeydownWallMs: 1_700_000_000_000 + i,
      eventTimeStampMs: p.keydown - 0.6,
      target: "textarea.terminal-input",
      nextRafMs: p.raf,
    })),
    counters: { windows: options.samples?.length ?? 0, windowsTimedOut: 0, windowErrors: 0 },
    dropped: { samples: 0, frames: 0, probes: 0 },
    visibility: {
      state: options.visible === false ? "hidden" : "visible",
      focused: true,
      hiddenTransitions: options.visible === false ? 1 : 0,
    },
  },
});

describe("parseLabJsonl", () => {
  it("survives a truncated last line", () => {
    const records = parseLabJsonl('{"kind":"run","scenario":"x"}\n{"kind":"arm"');
    expect(records).toHaveLength(1);
  });
});

describe("rollupStage", () => {
  it("takes the median of the WINDOWS' p50s and says so by its field name", () => {
    const rollup = rollupStage(
      [
        sample({ stages: { ...sample().stages, frameApplyMs: stage(1) } }),
        sample({ stages: { ...sample().stages, frameApplyMs: stage(3) } }),
        sample({ stages: { ...sample().stages, frameApplyMs: stage(2) } }),
      ],
      (s) => s.stages.frameApplyMs,
    );
    expect(rollup.windows).toBe(3);
    expect(rollup.medianOfWindowP50).toBe(2);
  });

  it("ignores windows with no samples in the stage", () => {
    const rollup = rollupStage(
      [sample({ stages: { ...sample().stages, frameApplyMs: stage(1, 1, 1, 1, 0) } })],
      (s) => s.stages.frameApplyMs,
    );
    expect(rollup.windows).toBe(0);
    expect(Number.isNaN(rollup.medianOfWindowP50)).toBe(true);
  });
});

describe("keystrokeToRafMs", () => {
  it("drops probes whose run ended before a frame ran", () => {
    const record = arm("metrics", 0, {
      probes: [
        { keydown: 100, raf: 104 },
        { keydown: 200, raf: null },
      ],
    });
    expect(keystrokeToRafMs(record)).toEqual([4]);
  });
});

describe("rollupArm", () => {
  it("counts arm slots whose window was not presentable", () => {
    const rollup = rollupArm("metrics", [
      arm("metrics", 0, { visible: true }),
      arm("metrics", 1, { visible: false }),
    ]);
    // Chromium suspends rAF for an occluded window, so a slot like this reports
    // zeros that read like speed. The count is what makes them legible.
    expect(rollup.unpresentableArms).toBe(1);
  });

  it("reports the platform's input hop from Chromium's own event timestamp", () => {
    const rollup = rollupArm("metrics", [arm("metrics", 0)]);
    expect(rollup.inputHopMs?.medianOfWindowP50).toBeCloseTo(0.6, 6);
  });
});

describe("buildLabReport", () => {
  const run = {
    kind: "run",
    scenario: "deck-4",
    electron: "43",
    chrome: "150",
    arms: ["metrics", "off"],
    rotations: 2,
    armMs: 10_000,
  };

  it("REFUSES to A/B a sampler-derived metric across differing sampler modes", () => {
    const report = buildLabReport({
      scenario: "deck-4",
      host: {},
      records: [
        run,
        ...[0, 1].map((r) => arm("metrics", r, { samples: [sample()] })),
        // `off` has no windows by construction — that is what off means.
        ...[0, 1].map((r) => arm("off", r, { effectiveMode: "off", samples: [] })),
      ] as never,
    });
    const graded = report.ab.map((row) => row.metric);
    expect(graded).not.toContain("frames/s presented");
    expect(graded).toContain("keystroke → next rAF");
    expect(report.markdown).toContain("must not be differenced across modes");
  });

  it("DOES A/B a sampler-derived metric when both arms ran the same mode", () => {
    const report = buildLabReport({
      scenario: "deck-4",
      host: {},
      records: [
        run,
        ...[0, 1].map((r) => arm("a", r, { effectiveMode: "metrics", samples: [sample()] })),
        ...[0, 1].map((r) => arm("b", r, { effectiveMode: "metrics", samples: [sample()] })),
      ] as never,
    });
    expect(report.ab.map((row) => row.metric)).toContain("frames/s presented");
  });

  it("publishes the not-hostable reason and no numbers", () => {
    const report = buildLabReport({
      scenario: "multi-view",
      host: {},
      records: [
        { kind: "run", scenario: "multi-view" },
        {
          kind: "not-hostable",
          scenario: "multi-view",
          why: "no product surface binds a SECOND view",
        },
      ] as never,
    });
    expect(report.markdown).toContain("NOT HOSTABLE");
    expect(report.markdown).toContain("no product surface binds a SECOND view");
    expect(report.markdown).not.toContain("Stage histograms");
  });
});

describe("attribution", () => {
  it("reports no-evidence for the families whose probes do not exist yet", () => {
    const rollup = rollupArm("metrics", [arm("metrics", 0, { samples: [sample()] })]);
    const families = attribution(rollup);
    const cell = families.find((f) => f.family === "cellCpuContributors");
    expect(cell?.verdict).toBe("no-evidence");
    // …and names the slice that brings the probe, so the gap is actionable
    // rather than mysterious.
    expect(cell?.evidence).toContain("TP-S3");
  });

  it("calls a wildly spread worker stage unstable rather than primary", () => {
    const wide = sample({
      stages: {
        ...sample().stages,
        frameApplyMs: stage(0.1, 5, 20),
        renderCpuMs: stage(0.2, 0.3, 0.3),
      },
    });
    const rollup = rollupArm("metrics", [arm("metrics", 0, { samples: [wide] })]);
    expect(attribution(rollup).find((f) => f.family === "workerCpuContributors")?.verdict).toBe(
      "unstable",
    );
  });
});
