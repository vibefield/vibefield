import { describe, expect, it } from "vitest";
import { derivedNullArm, gradeAb, groupRotations, quantile, summarizeArm } from "../src/ab";

// The A/B discipline is arithmetic, and arithmetic can be pinned. These rows
// exist because the alternative — checking the rig by running it — cannot tell a
// verdict that is wrong from a host that was busy.

describe("quantile", () => {
  it("is nearest-rank, so every value returned actually occurred", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(samples, 0.5)).toBe(5);
    expect(quantile(samples, 0.95)).toBe(10);
    expect(quantile(samples, 0.99)).toBe(10);
    // Not an interpolated 5.5 — an interpolated quantile is a number no sample
    // ever took, which is exactly what §19's "every number reported is a frame
    // that actually took that long" forbids.
    expect(samples).toContain(quantile(samples, 0.5));
  });

  it("survives one sample and refuses none", () => {
    expect(quantile([42], 0.99)).toBe(42);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe("summarizeArm", () => {
  it("reports the spread, which is what a null arm contributes", () => {
    const arm = summarizeArm("metrics", [10, 12, 11, 30]);
    // Nearest-rank on an even count takes the LOWER of the two middles
    // (`ceil(0.5 * 4) - 1` = index 1 of [10, 11, 12, 30]). That is the point of
    // nearest-rank: 11.5 is a number no rotation ever measured.
    expect(arm.median).toBe(11);
    expect(arm.min).toBe(10);
    expect(arm.max).toBe(30);
    expect(arm.spread).toBe(20);
  });

  it("drops non-finite rotations rather than poisoning the median", () => {
    const arm = summarizeArm("metrics", [10, Number.NaN, 12]);
    expect(arm.rotations).toEqual([10, 12]);
    expect(arm.median).toBe(10);
  });
});

describe("gradeAb", () => {
  const control = summarizeArm("off", [100, 100, 100, 100]);

  it("passes a small delta against a budget when the null arm is quiet", () => {
    const treatment = summarizeArm("metrics", [102, 103, 102, 103]);
    const result = gradeAb({
      metric: "frames/s",
      units: "fps",
      treatment,
      control,
      nullArm: summarizeArm("null", [100, 100]),
      budgetRelative: 0.05,
    });
    expect(result.deltaRelative).toBeCloseTo(0.02, 5);
    expect(result.verdict).toBe("within-budget");
  });

  it("fails a delta outside the budget", () => {
    const treatment = summarizeArm("metrics", [120, 121, 120, 121]);
    const result = gradeAb({
      metric: "frames/s",
      units: "fps",
      treatment,
      control,
      nullArm: summarizeArm("null", [100, 100]),
      budgetRelative: 0.05,
    });
    expect(result.verdict).toBe("over-budget");
  });

  it("calls a delta smaller than the null arm's own movement below-noise", () => {
    const treatment = summarizeArm("metrics", [101, 101]);
    const result = gradeAb({
      metric: "frames/s",
      units: "fps",
      treatment,
      // A null arm that wandered 3% cannot resolve a 1% difference, and the
      // verdict says that rather than claiming a 1% win.
      nullArm: summarizeArm("null", [100, 103]),
      control,
      budgetRelative: 0.05,
    });
    expect(result.verdict).toBe("below-noise");
  });

  it("refuses to grade when the noise floor is wider than the budget", () => {
    const treatment = summarizeArm("metrics", [140, 140]);
    const result = gradeAb({
      metric: "frames/s",
      units: "fps",
      treatment,
      control,
      // 20% of wander against a 5% budget: this run cannot tell pass from fail,
      // and `inconclusive` is the only honest answer a loaded host permits.
      nullArm: summarizeArm("null", [100, 120]),
      budgetRelative: 0.05,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.reason).toContain("wider than");
  });

  it("reports a delta without grading it when no budget is given", () => {
    const result = gradeAb({
      metric: "bytes/s",
      units: "B/s",
      treatment: summarizeArm("a", [200, 200]),
      control,
      nullArm: summarizeArm("null", [100, 100]),
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.deltaRelative).toBeCloseTo(1, 5);
  });

  it("says no-data rather than inventing one", () => {
    const result = gradeAb({
      metric: "x",
      units: "ms",
      treatment: summarizeArm("a", []),
      control,
      budgetRelative: 0.05,
    });
    expect(result.verdict).toBe("no-data");
  });

  it("names the missing null arm in its reason rather than assuming zero noise", () => {
    const result = gradeAb({
      metric: "x",
      units: "ms",
      treatment: summarizeArm("a", [104, 104]),
      control,
      nullArm: null,
      budgetRelative: 0.05,
    });
    expect(result.verdict).toBe("within-budget");
    expect(result.reason).toContain("NO null arm");
  });
});

describe("derivedNullArm", () => {
  it("splits one arm's rotations into alternating halves", () => {
    // Even indices 10, 10, 10; odd indices 10, 10 — a perfectly steady arm has
    // a null arm of zero spread.
    const steady = derivedNullArm(summarizeArm("m", [10, 10, 10, 10, 10]));
    expect(steady.spread).toBe(0);

    // A drifting arm's halves disagree, and the spread carries that.
    const drifting = derivedNullArm(summarizeArm("m", [10, 20, 10, 20]));
    expect(drifting.spread).toBe(10);
  });

  it("returns no rotations when a half is empty", () => {
    expect(derivedNullArm(summarizeArm("m", [10])).rotations).toEqual([]);
  });
});

describe("groupRotations", () => {
  it("orders each arm's values by rotation regardless of arrival order", () => {
    const grouped = groupRotations([
      { arm: "metrics", rotation: 1, value: 20 },
      { arm: "off", rotation: 0, value: 5 },
      { arm: "metrics", rotation: 0, value: 10 },
      { arm: "off", rotation: 1, value: 6 },
    ]);
    expect(grouped.get("metrics")).toEqual([10, 20]);
    expect(grouped.get("off")).toEqual([5, 6]);
  });
});
