import type { EventLoopUtilization } from "node:perf_hooks";
import { VITALS } from "@vibefield/contracts";
import { VitalsOwnV1 } from "@vibefield/contracts/vitals";
import { describe, expect, it } from "vitest";
import { OwnVitals } from "../src/own-vitals";

// VT-3 (track VT, 2026-11-24) — fieldd's own vitals, pure: the loop's busy share from two counters, the
// collections' pauses, the slowest request of an interval, each fold starting the next interval.

/** A loop whose counters the test moves: `idle` and `active` milliseconds since the process began. */
function loop(): {
  spend(idle: number, active: number): void;
  utilization(now?: EventLoopUtilization, before?: EventLoopUtilization): EventLoopUtilization;
} {
  let idle = 0;
  let active = 0;
  const share = (i: number, a: number): number => (i + a === 0 ? 0 : a / (i + a));
  return {
    spend: (i, a) => {
      idle += i;
      active += a;
    },
    utilization: (now, before) => {
      if (now === undefined) return { idle, active, utilization: share(idle, active) };
      const from = before ?? { idle: 0, active: 0, utilization: 0 };
      const i = now.idle - from.idle;
      const a = now.active - from.active;
      return { idle: i, active: a, utilization: share(i, a) };
    },
  };
}

const quiet = { observeGc: () => () => undefined };

describe("VT-3 — fieldd's own vitals", () => {
  it("says the share of each interval the loop was busy, each fold starting the next", () => {
    const counters = loop();
    counters.spend(5_000, 5_000); // before it was made: never counted
    const own = new OwnVitals({ utilization: counters.utilization, ...quiet });
    counters.spend(750, 250);
    expect(own.fold().loopBusy).toBe(0.25);
    counters.spend(0, 1_000);
    expect(own.fold().loopBusy).toBe(1);
    // an interval in which no time passed has no share to say, and says none busy
    expect(own.fold().loopBusy).toBe(0);
  });

  it("sums an interval's collections and keeps the longest; an interval with none is a true zero", () => {
    let hear: (ms: number) => void = () => undefined;
    const own = new OwnVitals({
      utilization: loop().utilization,
      observeGc: (onPause) => {
        hear = onPause;
        return () => undefined;
      },
    });
    hear(1.204);
    hear(7.5);
    hear(0.3);
    hear(Number.NaN); // never counted
    expect(own.fold()).toMatchObject({ gcMs: 9, gcMaxMs: 7.5 });
    expect(own.fold()).toMatchObject({ gcMs: 0, gcMaxMs: 0 });
  });

  it("leaves the pauses out where the runtime has none to hear: not measured, never none", () => {
    const own = new OwnVitals({
      utilization: loop().utilization,
      observeGc: () => {
        throw new Error("no gc entries here");
      },
    });
    own.noteGc(3);
    const fold = own.fold();
    expect("gcMs" in fold).toBe(false);
    expect("gcMaxMs" in fold).toBe(false);
  });

  it("keeps the slowest request of an interval, by its method alone, and forgets it at the fold", () => {
    const own = new OwnVitals({ utilization: loop().utilization, ...quiet });
    own.noteRequest("terminal.list", 12.34);
    own.noteRequest("index.sessions", 410.06);
    own.noteRequest("system.health", 3);
    own.noteRequest("", 9_999);
    own.noteRequest("system.health", -1);
    expect(own.fold().slow).toEqual({ method: "index.sessions", ms: 410.1 });
    expect("slow" in own.fold()).toBe(false);
  });

  it("bounds a method's name, and every fold is the wire's shape", () => {
    const own = new OwnVitals({ utilization: loop().utilization, ...quiet });
    own.noteRequest("m".repeat(400), 5);
    const fold = own.fold();
    expect(fold.slow?.method).toHaveLength(VITALS.METHOD_MAX);
    expect(VitalsOwnV1.safeParse(fold).success).toBe(true);
  });

  it("stops hearing collections when disposed", () => {
    let stopped = 0;
    const own = new OwnVitals({
      utilization: loop().utilization,
      observeGc: () => () => {
        stopped += 1;
      },
    });
    own.dispose();
    expect(stopped).toBe(1);
  });

  it("reads the real runtime: a busy loop is a busy share, between 0 and 1", () => {
    const own = new OwnVitals();
    const until = Date.now() + 60;
    while (Date.now() < until) Math.sqrt(until); // hold the loop
    const fold = own.fold();
    own.dispose();
    expect(fold.loopBusy).toBeGreaterThan(0.5);
    expect(fold.loopBusy).toBeLessThanOrEqual(1);
    expect(VitalsOwnV1.safeParse(fold).success).toBe(true);
  });
});
