import { describe, expect, it } from "vitest";
import { blockingObservable, FrameStatsCollector, verdictFor } from "../src/perf/frame-stats";

// The collector is clock-injected so a display can be simulated exactly: these
// tests drive 60Hz and 120Hz panels, a stall, and a backgrounded window through
// it without a browser, a real frame, or a timer.

const HZ_60 = 1_000 / 60;
const HZ_120 = 1_000 / 120;

/** Feed `count` steady frames of `period` starting at `from`; returns the clock. */
function steady(
  collector: FrameStatsCollector,
  from: number,
  period: number,
  count: number,
): number {
  let at = from;
  for (let index = 0; index < count; index += 1) {
    at += period;
    collector.frame(at);
  }
  return at;
}

function collector(blocking = true): FrameStatsCollector {
  return new FrameStatsCollector({ blockingObservable: blocking });
}

describe("FrameStatsCollector", () => {
  it("reports ~60fps and detects a 60Hz display from steady frames", () => {
    const stats = collector();
    const now = steady(stats, 0, HZ_60, 90);

    const sample = stats.sample(now);
    expect(sample).not.toBeNull();
    expect(sample?.fps).toBeCloseTo(60, 0);
    expect(sample?.refreshHz).toBe(60);
    expect(sample?.dropped).toBe(0);
    expect(sample?.verdict).toBe("healthy");
  });

  it("detects a 120Hz display rather than assuming 60", () => {
    const stats = collector();
    const now = steady(stats, 0, HZ_120, 200);

    const sample = stats.sample(now);
    expect(sample?.refreshHz).toBe(120);
    expect(sample?.fps).toBeCloseTo(120, 0);
    expect(sample?.dropped).toBe(0);
  });

  it("is too thin to describe below the minimum frame count", () => {
    const stats = collector();
    steady(stats, 0, HZ_60, 3);
    expect(stats.sample(3 * HZ_60)).toBeNull();
  });

  it("counts an overrun as a dropped frame and prices what it cost", () => {
    const stats = collector();
    let now = steady(stats, 0, HZ_60, 60);

    now += 50; // one 50ms frame — three display periods
    stats.frame(now);
    now = steady(stats, now, HZ_60, 5);

    const sample = stats.sample(now);
    expect(sample?.dropped).toBe(1);
    expect(sample?.lostMs).toBeCloseTo(50 - HZ_60, 1);
    expect(sample?.frameMs.worst).toBeCloseTo(50, 1);
  });

  it("blames the main thread when blocking explains the lost time", () => {
    const stats = collector();
    let now = steady(stats, 0, HZ_60, 60);

    now += 50;
    stats.frame(now);
    stats.blocked(now, 46); // a long task covering nearly the whole overrun
    now = steady(stats, now, HZ_60, 5);

    expect(stats.sample(now)?.verdict).toBe("main-thread");
  });

  it("blames the compositor when frames drop without the main thread blocking", () => {
    const stats = collector();
    let now = steady(stats, 0, HZ_60, 60);

    now += 50;
    stats.frame(now);
    stats.blocked(now, 2); // main thread was essentially idle through the stall
    now = steady(stats, now, HZ_60, 5);

    const sample = stats.sample(now);
    expect(sample?.verdict).toBe("off-main-thread");
    expect(sample?.blockingMs).toBeCloseTo(2, 1);
  });

  it("reports blocking as null — never zero — when LoAF cannot be observed", () => {
    const stats = collector(false);
    let now = steady(stats, 0, HZ_60, 60);

    now += 50;
    stats.frame(now);
    now = steady(stats, now, HZ_60, 5);

    const sample = stats.sample(now);
    // The distinction the UI depends on: we did not look, which is not the same
    // claim as "the main thread was clean".
    expect(sample?.blockingMs).toBeNull();
    expect(sample?.verdict).toBe("unknown");
  });

  it("discards an observation gap instead of counting a lunch break as a drop", () => {
    const stats = collector();
    let now = steady(stats, 0, HZ_60, 60);

    now += 45_000; // window hidden, machine asleep — not a frame that ran late
    stats.frame(now);
    now = steady(stats, now, HZ_60, 30);

    const sample = stats.sample(now);
    expect(sample?.dropped).toBe(0);
    expect(sample?.frameMs.worst).toBeLessThan(HZ_60 * 1.5);
  });

  it("drops the frame cursor across an explicit discontinuity", () => {
    const stats = collector();
    let now = steady(stats, 0, HZ_60, 60);

    stats.discontinuity();
    now += 800; // under the gap ceiling, so only the cursor drop saves us here
    stats.frame(now);
    now = steady(stats, now, HZ_60, 30);

    expect(stats.sample(now)?.dropped).toBe(0);
  });
});

describe("verdictFor", () => {
  it("is healthy whenever nothing dropped, measured or not", () => {
    expect(verdictFor({ dropped: 0, lostMs: 0, blockingMs: null })).toBe("healthy");
    expect(verdictFor({ dropped: 0, lostMs: 0, blockingMs: 120 })).toBe("healthy");
  });

  it("splits on blocking's share of the lost time", () => {
    expect(verdictFor({ dropped: 2, lostMs: 40, blockingMs: 30 })).toBe("main-thread");
    expect(verdictFor({ dropped: 2, lostMs: 40, blockingMs: 4 })).toBe("off-main-thread");
    // Exactly at the threshold the main thread is answerable for half the loss,
    // which is enough to name it.
    expect(verdictFor({ dropped: 2, lostMs: 40, blockingMs: 20 })).toBe("main-thread");
  });

  it("refuses to guess a cause it could not measure", () => {
    expect(verdictFor({ dropped: 5, lostMs: 90, blockingMs: null })).toBe("unknown");
  });
});

describe("blockingObservable", () => {
  it("answers without throwing on whatever engine runs the suite", () => {
    expect(typeof blockingObservable()).toBe("boolean");
  });
});
