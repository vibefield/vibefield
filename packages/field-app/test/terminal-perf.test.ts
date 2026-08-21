// TP-S0a — the sampler's mode gate, its honesty, and TP-R18's "off costs
// nothing" claim made checkable rather than asserted.
import type { TerminalRenderPerformanceSnapshot as UpstreamSnapshot } from "@vibecook/ghosttea-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reduceSnapshot,
  summarizeStage,
  terminalPerf,
  toJsonLine,
} from "../src/perf/terminal-perf";
import {
  getTerminalPerfSource,
  observeTerminalPerfSource,
  registerTerminalPerfSource,
  type TerminalPerfSource,
} from "../src/perf/terminal-perf-source";
import type { TerminalRenderPerformanceSnapshot } from "../src/perf/terminal-perf-types";

function snapshot(
  over: Partial<TerminalRenderPerformanceSnapshot> = {},
): TerminalRenderPerformanceSnapshot {
  return {
    backend: "webgpu",
    durationMs: 1_000,
    timedOutWaitingForIdle: false,
    gpuQueueDrainMs: 0.4,
    frames: {
      received: 60,
      bytes: 1_200_000,
      full: 2,
      incremental: 58,
      stale: 1,
      resyncRequested: 0,
      rowsDecoded: 1_800,
      glyphDefinitions: 40,
    },
    scheduling: { flushes: 60, renderCalls: 60, maximumDirtyPanes: 4, panesPerFlush: [1, 2, 4] },
    renderer: {
      queueSubmits: 60,
      fullRenders: 2,
      partialRenders: 58,
      damagedRows: 900,
      geometryCacheHits: 800,
      geometryCacheMisses: 100,
      canvasPixelFrames: 60,
      renderPasses: 120,
      drawCalls: 240,
      rectangleVertices: 100,
      monoGlyphVertices: 200,
      colorGlyphVertices: 10,
      fallbackGlyphVertices: 0,
      vertexUploadBytes: 4_096,
      atlasUploadBytes: 2_048,
      atlasUploadCalls: 3,
    },
    samples: {
      frameApplyMs: [1, 2, 3, 4, 100],
      renderCpuMs: [0.5, 0.6, 0.7],
      dirtyToRenderMs: [2, 3],
      frameArrivalToRenderMs: [3, 4, 5],
    },
    ...over,
  };
}

function fakeSource(): TerminalPerfSource & { starts: number; finishes: number } {
  const source = {
    rendererBackend: "webgpu",
    starts: 0,
    finishes: 0,
    startPerformanceMeasurement: async (): Promise<void> => {
      source.starts += 1;
    },
    finishPerformanceMeasurement: async (): Promise<TerminalRenderPerformanceSnapshot> => {
      source.finishes += 1;
      return snapshot();
    },
  };
  return source;
}

afterEach(() => {
  terminalPerf.setMode("off");
});

describe("the perf source registry", () => {
  it("publishes, replaces, and unpublishes without stranding a stale runtime", () => {
    const first = fakeSource();
    const second = fakeSource();
    const undoFirst = registerTerminalPerfSource(first);
    expect(getTerminalPerfSource()).toBe(first);

    // A deck that rebuilt its runtime after a device loss registers a second
    // one before the first's cleanup runs. The stale cleanup must be a no-op,
    // or it would unpublish the LIVE runtime.
    const undoSecond = registerTerminalPerfSource(second);
    expect(getTerminalPerfSource()).toBe(second);
    undoFirst();
    expect(getTerminalPerfSource()).toBe(second);

    undoSecond();
    expect(getTerminalPerfSource()).toBeNull();
  });

  it("tells a new observer the current value immediately", () => {
    const source = fakeSource();
    const undo = registerTerminalPerfSource(source);
    const seen: (TerminalPerfSource | null)[] = [];
    const unobserve = observeTerminalPerfSource((value) => seen.push(value));
    expect(seen).toEqual([source]);
    undo();
    expect(seen).toEqual([source, null]);
    unobserve();
  });
});

describe("TP-R18 — off costs nothing", () => {
  it("opens no measurement window while the mode is off", async () => {
    const source = fakeSource();
    const undo = registerTerminalPerfSource(source);
    terminalPerf.setMode("off");
    await vi.waitFor(() => expect(terminalPerf.state().mode).toBe("off"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The claim, made checkable: the runtime is never asked for a measurement,
    // so the render worker's `performanceMeasurement` stays undefined and every
    // sample site in it early-returns.
    expect(source.starts).toBe(0);
    expect(source.finishes).toBe(0);
    expect(terminalPerf.state().sample).toBeNull();
    undo();
  });

  it("opens no measurement window in production mode either", async () => {
    const source = fakeSource();
    const undo = registerTerminalPerfSource(source);
    terminalPerf.setMode("production");
    await new Promise((resolve) => setTimeout(resolve, 80));
    // The load-bearing half of the finding: `production` cannot use the
    // runtime's window, because closing one drains the GPU queue. It carries
    // only counters field-app can observe on its own.
    expect(source.starts).toBe(0);
    expect(terminalPerf.state().counters.sourceChanges).toBeGreaterThan(0);
    expect(terminalPerf.state().sample).toBeNull();
    undo();
  });

  it("counts a mounted runtime without measuring it", async () => {
    terminalPerf.setMode("production");
    const undo = registerTerminalPerfSource(fakeSource());
    await vi.waitFor(() => expect(terminalPerf.state().sourceAttached).toBe(true));
    undo();
    await vi.waitFor(() => expect(terminalPerf.state().sourceAttached).toBe(false));
    expect(terminalPerf.state().counters.sourceMountedMs).toBeGreaterThanOrEqual(0);
  });
});

describe("reducing a snapshot to lanes", () => {
  it("derives rates from the window's OWN duration, not the requested period", () => {
    const half = reduceSnapshot(snapshot({ durationMs: 500 }), "metrics");
    expect(half.rates.framesPerSecond).toBe(120);
    const double = reduceSnapshot(snapshot({ durationMs: 2_000 }), "metrics");
    expect(double.rates.framesPerSecond).toBe(30);
  });

  it("keeps a null GPU drain null rather than turning it into zero", () => {
    // A Canvas2D backend has no queue to drain. Zero would read as "the GPU
    // was instant", which is a different and false claim.
    expect(
      reduceSnapshot(snapshot({ gpuQueueDrainMs: null }), "metrics").gpuQueueDrainMs,
    ).toBeNull();
  });

  it("carries the timed-out flag through, because a busy window is not an error", () => {
    expect(
      reduceSnapshot(snapshot({ timedOutWaitingForIdle: true }), "metrics").timedOutWaitingForIdle,
    ).toBe(true);
  });

  it("summarizes stages by nearest rank, so every quantile is a real sample", () => {
    const histogram = summarizeStage([1, 2, 3, 4, 100]);
    expect(histogram.count).toBe(5);
    expect(histogram.p50).toBe(3);
    expect(histogram.max).toBe(100);
    // p99 of five samples is the largest one — an observation, not an
    // interpolation between two frames that never happened.
    expect(histogram.p99).toBe(100);
    expect(summarizeStage([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  it("emits one flat JSONL line the baseline can consume", () => {
    const line = JSON.parse(
      toJsonLine(
        {
          mode: "metrics",
          sourceAttached: true,
          counters: terminalPerf.state().counters,
          sample: reduceSnapshot(snapshot(), "metrics"),
        },
        "deck-4",
      ),
    ) as Record<string, unknown>;
    expect(line["scenario"]).toBe("deck-4");
    expect(line["mode"]).toBe("metrics");
    expect((line["sample"] as Record<string, unknown>)["backend"]).toBe("webgpu");
  });
});

describe("the local snapshot type", () => {
  it("still describes what the upstream actually returns", () => {
    // `perf/` restates ghosttea's snapshot so nothing here has to import the
    // package to talk about a number. That copy is only safe if a compiler
    // checks it: this assignment fails to build the day upstream renames or
    // removes a field, which is the whole point of the row.
    const upstream: UpstreamSnapshot = snapshot() as UpstreamSnapshot;
    const local: TerminalRenderPerformanceSnapshot = upstream;
    expect(local.frames.received).toBe(60);
    expect(local.samples.frameApplyMs.length).toBe(5);
  });
});

describe("TP-R18 — the production probe's cost, measured", () => {
  it("costs below the measurement floor in an interleaved A/B with a null arm", () => {
    // THE ROW: "`production` counters sit below measurement noise in an on/off
    // A/B" (TP-R18). The arms are interleaved rather than run back to back —
    // this host is never quiet, so running arm A a thousand times and then arm
    // B a thousand times measures whatever the machine was doing in each half.
    //
    // What is actually being timed: the whole of what `production` mode does on
    // the hot-ish path, which is a runtime registering and unregistering (the
    // deck's own lifecycle) plus a state read. The frame path is not in here
    // because the sampler is not on it — in `production` the runtime is never
    // asked for anything, which the rows above already prove by counting calls.
    const ITERATIONS = 2_000;
    const onArm: number[] = [];
    const offArm: number[] = [];
    const nullArm: number[] = [];

    const source = fakeSource();
    for (let index = 0; index < ITERATIONS; index += 1) {
      // NULL: the loop and the clock, with the same shape of work.
      const nullStart = performance.now();
      const undoNull = (): void => undefined;
      undoNull();
      nullArm.push(performance.now() - nullStart);

      terminalPerf.setMode("off");
      const offStart = performance.now();
      const undoOff = registerTerminalPerfSource(source);
      terminalPerf.state();
      undoOff();
      offArm.push(performance.now() - offStart);

      terminalPerf.setMode("production");
      const onStart = performance.now();
      const undoOn = registerTerminalPerfSource(source);
      terminalPerf.state();
      undoOn();
      onArm.push(performance.now() - onStart);
    }
    terminalPerf.setMode("off");

    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] as number;
    };
    const report = {
      nullArmMedianUs: median(nullArm) * 1_000,
      offMedianUs: median(offArm) * 1_000,
      productionMedianUs: median(onArm) * 1_000,
      deltaUs: (median(onArm) - median(offArm)) * 1_000,
      iterations: ITERATIONS,
    };
    // Printed, because the NUMBER is the deliverable; the assertion below only
    // stops a future change from making the probe expensive by an order of
    // magnitude, which is all a timing row on a loaded shared host can honestly
    // gate.
    console.log(`[TP-R18] ${JSON.stringify(report)}`);

    expect(report.productionMedianUs).toBeLessThan(50);
    // The delta must be small next to the arm itself. Not "zero": the clock's
    // own resolution is the floor, and claiming a zero would be claiming a
    // precision `performance.now()` does not have.
    expect(Math.abs(report.deltaUs)).toBeLessThan(50);
  });
});
