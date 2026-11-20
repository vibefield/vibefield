import { describe, expect, it } from "vitest";
import { SparkStarts } from "../src/objects/spark-starts";

// Item 550 (2026-11-18) — which spark this fieldd started a run for: its own memory of the talk room's spawn, handed on
// at a resume, and bounded.

describe("which spark this fieldd started a run for (item 550)", () => {
  it("says the spark a run was started for, and none for a run it was not told of", () => {
    const starts = new SparkStarts();
    starts.started("run-a", "sp-7k2m9q4x");
    expect(starts.of("run-a")).toBe("sp-7k2m9q4x");
    expect(starts.of("run-b")).toBeUndefined();
  });

  it("hands it on to the run a resume continues in, and the run before keeps it", () => {
    const starts = new SparkStarts();
    starts.started("run-a", "sp-7k2m9q4x");
    starts.replaced("run-a", "run-b");
    expect(starts.of("run-b")).toBe("sp-7k2m9q4x");
    expect(starts.of("run-a")).toBe("sp-7k2m9q4x");
    // a resume of a run no spark started hands nothing on
    starts.replaced("run-x", "run-y");
    expect(starts.of("run-y")).toBeUndefined();
  });

  it("forgets the oldest past its bound, and a run named again is the newest", () => {
    const starts = new SparkStarts(2);
    starts.started("run-a", "sp-aaaaaa");
    starts.started("run-b", "sp-bbbbbb");
    starts.started("run-a", "sp-aaaaaa");
    starts.started("run-c", "sp-cccccc");
    expect(starts.of("run-b")).toBeUndefined();
    expect(starts.of("run-a")).toBe("sp-aaaaaa");
    expect(starts.of("run-c")).toBe("sp-cccccc");
  });
});
