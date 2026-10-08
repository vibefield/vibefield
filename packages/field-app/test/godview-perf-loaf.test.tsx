// @vitest-environment happy-dom
/**
 * THE PROBE'S LONG FRAMES (MV-8b, M177 ruling 3). The reports used to keep only
 * `loaf.{count, blockingMs, longestMs}`, so a 166 ms frame could be counted and
 * never explained. A cell's report now keeps its five longest long animation
 * frames with their attribution — the frame's own timings and every script it
 * ran — and counts the frames of 100 ms or more. The observer is stood in: the
 * browser's `long-animation-frame` entries reach the probe through its callback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type GodviewPerfLoafEntry,
  installGodviewPerfProbe,
  LOAF_KEPT,
  LOAF_LONG_MS,
} from "../src/godview/monitor/perf/godview-perf-probe";
import { resetGodviewPerfLabForTest } from "../src/godview/monitor/perf/lab-bridge";

let deliver: ((entries: unknown[]) => void) | null = null;

beforeEach(() => {
  deliver = null;
  class StoodInObserver {
    static supportedEntryTypes = ["long-animation-frame"];
    constructor(callback: (list: { getEntries(): unknown[] }) => void) {
      deliver = (entries) => callback({ getEntries: () => entries });
    }
    observe(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("PerformanceObserver", StoodInObserver);
});

afterEach(() => {
  resetGodviewPerfLabForTest();
  installGodviewPerfProbe().dispose();
  vi.unstubAllGlobals();
});

/** A long animation frame as Chromium reports it, one script inside. */
function frame(startTime: number, duration: number, extra: Record<string, unknown> = {}) {
  return {
    entryType: "long-animation-frame",
    name: "long-animation-frame",
    startTime,
    duration,
    blockingDuration: 0,
    renderStart: startTime + duration - 12,
    styleAndLayoutStart: startTime + duration - 6,
    firstUIEventTimestamp: 0,
    scripts: [
      {
        entryType: "script",
        name: "script",
        invoker: "FrameRequestCallback",
        invokerType: "user-callback",
        windowAttribution: "self",
        sourceURL: "app://renderer/assets/timeline.js",
        sourceFunctionName: "draw",
        sourceCharPosition: 4_210,
        startTime: startTime + 1,
        executionStart: startTime + 1,
        duration: duration - 14,
        forcedStyleAndLayoutDuration: 3,
        pauseDuration: 0,
      },
    ],
    ...extra,
  };
}

describe("a cell's long frames", () => {
  it("keeps the five longest with their attribution, longest first, and counts those of 100 ms or more", () => {
    const probe = installGodviewPerfProbe();
    probe.reset();
    expect(deliver).not.toBeNull();
    // eight frames over a window: 166 ms the longest, three at 100 or more
    deliver?.([frame(10, 60), frame(200, 166, { blockingDuration: 0 }), frame(400, 54)]);
    deliver?.([
      frame(600, 100),
      frame(800, 99.5),
      frame(1_000, 120),
      frame(1_200, 51),
      frame(1_400, 70),
    ]);
    const { loaf } = probe.report();
    expect(loaf).toMatchObject({
      observable: true,
      count: 8,
      blockingMs: 0,
      longestMs: 166,
      over100Ms: 3,
    });
    expect(LOAF_KEPT).toBe(5);
    expect(LOAF_LONG_MS).toBe(100);
    expect(loaf.longest.map((entry) => entry.duration)).toEqual([166, 120, 100, 99.5, 70]);
    // the report shape, field for field: the frame's own timings and every script it ran
    const longest = loaf.longest[0] as GodviewPerfLoafEntry;
    expect(longest).toEqual({
      startTime: 200,
      duration: 166,
      blockingDuration: 0,
      renderStart: 354,
      styleAndLayoutStart: 360,
      scripts: [
        {
          invoker: "FrameRequestCallback",
          invokerType: "user-callback",
          sourceURL: "app://renderer/assets/timeline.js",
          sourceFunctionName: "draw",
          sourceCharPosition: 4_210,
          startTime: 201,
          duration: 152,
          forcedStyleAndLayoutDuration: 3,
        },
      ],
    });
  });

  it("starts each cell's window empty, and reads an entry without attribution as zeros", () => {
    const probe = installGodviewPerfProbe();
    deliver?.([frame(10, 180)]);
    probe.reset();
    expect(probe.report().loaf).toMatchObject({ count: 0, over100Ms: 0, longest: [] });
    // an entry a browser hands without the newer fields still counts, honestly empty
    deliver?.([{ entryType: "long-animation-frame", startTime: 5, duration: 130 }]);
    expect(probe.report().loaf.longest).toEqual([
      {
        startTime: 5,
        duration: 130,
        blockingDuration: 0,
        renderStart: 0,
        styleAndLayoutStart: 0,
        scripts: [],
      },
    ]);
    expect(probe.report().loaf.over100Ms).toBe(1);
  });

  it("hands each report its own copy: a later frame never rewrites an earlier report", () => {
    const probe = installGodviewPerfProbe();
    probe.reset();
    deliver?.([frame(10, 110)]);
    const first = probe.report().loaf.longest;
    deliver?.([frame(300, 140)]);
    expect(first.map((entry) => entry.duration)).toEqual([110]);
    expect(probe.report().loaf.longest.map((entry) => entry.duration)).toEqual([140, 110]);
  });
});
