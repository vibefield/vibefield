/**
 * WHAT A RUN SAYS OF ITS OWN METHOD (MV lab debts) — `scripts/perf-godview-method.mjs`,
 * the pure half of the summary's account of each arm's lab: which views its
 * discarded warm-up replayed through, and whether its heap rows were read after
 * a forced collection. A lab change is a change of method, so a pair whose arms
 * did not do the same must read so, never as one measurement.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { script } from "./godview-perf-runs";

interface HeapCount {
  cells: number;
  collected: number;
}
interface Method {
  warmedViews(runs: unknown[]): string[] | null;
  warmupLine(recipe: string, byArm: Record<string, string[] | null>): string;
  heapCollection(runs: unknown[]): HeapCount;
  heapLine(byArm: Record<string, HeapCount>): string;
}

let method: Method;
beforeAll(async () => {
  method = await script<Method>("perf-godview-method.mjs");
});

const ALL = ["swarm", "list", "rain", "timeline"];
const RECIPE = "n=10,duration=1500,seed=9,markerQuietMs=50";

describe("the views an arm's warm-up replayed through", () => {
  it("are the list every launch of the arm names, in its order", () => {
    const runs = [{ warmedViews: [...ALL] }, { warmedViews: [...ALL] }];
    expect(method.warmedViews(runs)).toEqual(ALL);
    expect(method.warmedViews(runs)).not.toBe(runs[0]?.warmedViews);
  });

  it("are empty when the warm-up was off in every launch", () => {
    expect(method.warmedViews([{ warmedViews: [] }, { warmedViews: [] }])).toEqual([]);
  });

  it("are unknown when a launch says nothing: a lab from before the per-view warm-up", () => {
    expect(method.warmedViews([{ warmupRecipe: RECIPE }])).toBeNull();
    expect(method.warmedViews([{ warmedViews: [...ALL] }, {}])).toBeNull();
    expect(method.warmedViews([])).toBeNull();
  });

  it("are unknown when the launches differ, in views or in order", () => {
    expect(method.warmedViews([{ warmedViews: [...ALL] }, { warmedViews: ["swarm"] }])).toBeNull();
    expect(
      method.warmedViews([{ warmedViews: ["swarm", "list"] }, { warmedViews: ["list", "swarm"] }]),
    ).toBeNull();
  });
});

describe("the summary's warm-up line", () => {
  it("is one account when every arm warmed the same views", () => {
    const line = method.warmupLine(RECIPE, { A: ALL, B: ALL, "A′": ALL });
    expect(line).toContain(`\`${RECIPE}\``);
    expect(line).toContain("every arm swarm → list → rain → timeline");
    expect(line).not.toContain("DID NOT RUN");
  });

  it("says a run with no warm-up warmed nothing", () => {
    expect(method.warmupLine(RECIPE, { A: [], B: [] })).toContain("every arm NONE");
  });

  it("names each arm and refuses the pair as one measurement when the arms differ", () => {
    // B on this lab against an A whose lab still warmed its default view only
    const line = method.warmupLine(RECIPE, { A: null, B: ALL, "A′": null });
    expect(line).toContain("A NOT SAID");
    expect(line).toContain("B swarm → list → rain → timeline");
    expect(line).toContain("A′ NOT SAID");
    expect(line).toContain("THE ARMS DID NOT RUN THE SAME WARM-UP");
  });
});

describe("the heap rows an arm read after a collection", () => {
  const cell = (collected: boolean) => ({ heap: { collected, usedJSHeapSize: 1 } });

  it("are counted over every cell of every launch", () => {
    const runs = [{ cells: [cell(true), cell(true)] }, { cells: [cell(true), cell(false)] }];
    expect(method.heapCollection(runs)).toEqual({ cells: 4, collected: 3 });
  });

  it("are none for a lab from before the collection: its cells carry no heap record", () => {
    const runs = [{ cells: [{ report: { memory: { usedJSHeapSize: 1 } } }, {}] }];
    expect(method.heapCollection(runs)).toEqual({ cells: 2, collected: 0 });
    expect(method.heapCollection([{}])).toEqual({ cells: 0, collected: 0 });
  });
});

describe("the summary's heap line", () => {
  const whole = { cells: 84, collected: 84 };

  it("is one account when every cell of every arm was collected", () => {
    const line = method.heapLine({ A: whole, B: whole, "A′": whole });
    expect(line).toContain("HeapProfiler.collectGarbage");
    expect(line).toContain("every cell of every arm");
    expect(line).not.toContain("NOT A LEVEL");
  });

  it("counts each arm and says what an uncollected row is when any cell was not", () => {
    // one collection that could not be forced in B; an A arm from before the lane
    const line = method.heapLine({
      A: { cells: 84, collected: 0 },
      B: { cells: 84, collected: 83 },
      "A′": whole,
    });
    expect(line).toContain("A 0 of 84 cells");
    expect(line).toContain("B 83 of 84 cells");
    expect(line).toContain("A′ all 84 cells");
    expect(line).toContain("A PHASE OF THE COLLECTOR AND NOT A LEVEL");
  });

  it("never calls an arm with no cells collected", () => {
    expect(method.heapLine({ A: { cells: 0, collected: 0 } })).toContain("A 0 of 0 cells");
  });
});
