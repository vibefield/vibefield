import { EventEmitter } from "node:events";
import { VITALS } from "@vibefield/contracts";
import type { VitalsOwnV1 } from "@vibefield/contracts/vitals";
import { VitalsQueryResult, vitalsKey } from "@vibefield/contracts/vitals";
import { createNoopLogger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import type { NativeLink } from "../src/native-link";
import { foldOwnStep } from "../src/vitals-own-fold";
import { VitalsService } from "../src/vitals-service";

// VT-3, the query's fold (track VT, 2026-11-24) — `vitals.query` keeps what a process said of itself over each step:
// the loop's busiest second, the pauses and long frames summed with their longest, the slowest request. Absent stays
// absent. The recorder runs here over a scripted floor (no daemon, no binary), so the fold is the real `query`.

describe("foldOwnStep — one step of what a process said of itself", () => {
  it("keeps the busiest second, sums pauses and frames, keeps the longest and the slowest", () => {
    let step: VitalsOwnV1 | null = null;
    for (const said of [
      { loopBusy: 0.1, gcMs: 2, gcMaxMs: 2, slow: { method: "terminal.list", ms: 40 } },
      { loopBusy: 0.97, gcMs: 1.5, gcMaxMs: 1.5, longFrames: 2, longFrameMaxMs: 80 },
      {
        loopBusy: 0.2,
        slow: { method: "vitals.query", ms: 12 },
        longFrames: 1,
        longFrameMaxMs: 120,
      },
    ] satisfies VitalsOwnV1[])
      step = foldOwnStep(step, said);
    expect(step).toEqual({
      loopBusy: 0.97,
      gcMs: 3.5,
      gcMaxMs: 2,
      slow: { method: "terminal.list", ms: 40 },
      longFrames: 3,
      longFrameMaxMs: 120,
    });
  });

  it("a slower request later in the step replaces the slowest; an equal one does not", () => {
    const first = foldOwnStep(null, { slow: { method: "a.first", ms: 40 } });
    expect(foldOwnStep(first, { slow: { method: "b.second", ms: 40 } })?.slow?.method).toBe(
      "a.first",
    );
    expect(foldOwnStep(first, { slow: { method: "b.second", ms: 41 } })?.slow?.method).toBe(
      "b.second",
    );
  });

  it("what no second said stays absent, never zero; a step that said nothing is null", () => {
    expect(foldOwnStep(null, { gcMs: 0 })).toEqual({ gcMs: 0 });
    const said = foldOwnStep(null, { loopBusy: 0.3 });
    expect(said).toEqual({ loopBusy: 0.3 });
    expect(said).not.toHaveProperty("gcMs");
    expect(foldOwnStep(null, {})).toBeNull();
    expect(foldOwnStep(null, undefined)).toBeNull();
    expect(foldOwnStep(said, undefined)).toBe(said);
    // a field this build does not know is not folded: its meaning over a span is not known here
    expect(foldOwnStep(null, { loopBusy: 0.3, newer: 9 } as VitalsOwnV1)).toEqual({
      loopBusy: 0.3,
    });
  });
});

/** A floor that answers the vitals subscription and lets the test push its samples. */
class ScriptedFloor extends EventEmitter {
  push: ((payload: unknown, kind?: "delta" | "snapshot") => void) | null = null;

  async subscribe(
    _method: string,
    _params: unknown,
    listener: (payload: unknown, kind?: "delta" | "snapshot") => void,
  ): Promise<{ snapshot: unknown; dispose(): void }> {
    this.push = listener;
    return {
      snapshot: {
        v: 1,
        bootId: "floor-boot",
        state: "running",
        intervalMs: 1_000,
        oldestSeq: 0,
        samples: [],
      },
      dispose: () => undefined,
    };
  }

  async request(): Promise<unknown> {
    return { accepted: 0 };
  }
}

const T0 = 1_795_478_530_000;
const SELF = { pid: process.pid, startedAt: T0 - 90_000 };
const OTHER = { pid: 4102, startedAt: T0 - 60_000 };

const reading = (who: { pid: number; startedAt: number }, origin: string, cpuUs: number) => ({
  pid: who.pid,
  startedAt: who.startedAt,
  origin,
  cpuUserUs: cpuUs,
  cpuSystemUs: 0,
  residentBytes: 1_000_000,
  footprintBytes: 1_000_000,
  diskReadBytes: 0,
  diskWrittenBytes: 0,
  wakeups: 0,
  energyNj: null,
});

async function recorder(said: (VitalsOwnV1 | undefined)[]) {
  const floor = new ScriptedFloor();
  let second = 0;
  const service = new VitalsService({
    native: floor as unknown as NativeLink,
    logger: createNoopLogger(),
    own: {
      fold: () => said[second++] ?? {},
      dispose: () => undefined,
    },
    sources: [() => [{ pid: SELF.pid, group: "fieldd", role: "fieldd" }]],
  });
  await service.start();
  for (let index = 0; index < said.length; index++) {
    floor.push?.({
      seq: index + 1,
      time: T0 + index * 1_000,
      tookUs: 300,
      rows: [reading(OTHER, "floor", index * 10_000), reading(SELF, "watched", index * 20_000)],
    });
  }
  return service;
}

describe("vitals.query folds the rows' own vitals (VT-3)", () => {
  it("per step: the busiest second, the sums, the longest, the slowest; null where nothing was said", async () => {
    const service = await recorder([
      { loopBusy: 0.1, gcMs: 1, gcMaxMs: 1, slow: { method: "terminal.list", ms: 41 } },
      { loopBusy: 0.98, gcMs: 4, gcMaxMs: 4 }, // a held loop, one second of the step
      { loopBusy: 0.05, slow: { method: "vitals.query", ms: 3 } },
      { loopBusy: 0.07 },
      undefined, // a second fieldd measured nothing of itself
      undefined,
    ]);
    // a span wide enough that its first step holds all six seconds
    const result = VitalsQueryResult.parse(
      service.query({ from: T0, to: T0 + VITALS.QUERY_MAX_POINTS * 6_000 }),
    );
    expect(result.stepMs).toBe(6_000);
    const wide = VitalsQueryResult.parse(service.query({ from: T0, to: T0 + 6_000 }));
    expect(wide.stepMs).toBe(1_000);
    const self = wide.series.find((series) => series.key === vitalsKey(SELF.pid, SELF.startedAt));
    expect(self?.own).toEqual([
      { loopBusy: 0.1, gcMs: 1, gcMaxMs: 1, slow: { method: "terminal.list", ms: 41 } },
      { loopBusy: 0.98, gcMs: 4, gcMaxMs: 4 },
      { loopBusy: 0.05, slow: { method: "vitals.query", ms: 3 } },
      { loopBusy: 0.07 },
      null,
      null,
    ]);

    // folded into one step, the held second is never averaged away
    const folded = result.series.find(
      (series) => series.key === vitalsKey(SELF.pid, SELF.startedAt),
    );
    expect(folded?.own?.[0]).toEqual({
      loopBusy: 0.98,
      gcMs: 5,
      gcMaxMs: 4,
      slow: { method: "terminal.list", ms: 41 },
    });
    expect(folded?.own).toHaveLength(result.times.length);
    service.dispose();
  });

  it("a process that said nothing over the span has no own series at all", async () => {
    const service = await recorder([{ loopBusy: 0.2 }, { loopBusy: 0.3 }]);
    const result = VitalsQueryResult.parse(service.query({ from: T0, to: T0 + 2_000 }));
    const floorRow = result.series.find(
      (series) => series.key === vitalsKey(OTHER.pid, OTHER.startedAt),
    );
    expect(floorRow).toBeDefined();
    expect(floorRow).not.toHaveProperty("own");
    // and a span before fieldd said anything carries none either
    const before = VitalsQueryResult.parse(service.query({ from: T0 - 10_000, to: T0 }));
    for (const series of before.series) expect(series).not.toHaveProperty("own");
    service.dispose();
  });
});
