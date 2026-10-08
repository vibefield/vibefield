/**
 * DK-18 (plan (24)) — the desk's long wake after an act, named (testing/smoke-rest.ts): the ambient wind and nothing else —
 * with the wind stilled the desk rests at once after a move; with it, by the canon's 20 s and its 2 s ease (and not before
 * the 20 s: the act touched the wind); a cover lowered over a still wind rests at once.
 */
import { describe, expect, it } from "vitest";
import { judgePromptRest, judgeWindRest, REST } from "../src/testing/smoke-rest";

describe("REST ACT with the wind — the canon's 20 s and its 2 s ease, and nothing else", () => {
  it("passes a rest inside the wind and its ease (DK-17b's 21.8 s, THUMB's 21.7 s)", () => {
    expect(judgeWindRest({ ms: 21_800, wakes: { input: 6, "desk:ink": 4 } })).toEqual([]);
    expect(judgeWindRest({ ms: REST.windMs + REST.settleMs + REST.slackMs, wakes: {} })).toEqual(
      [],
    );
  });

  it("refuses a desk something else held past the wind — and names the wakes", () => {
    const [problem] = judgeWindRest({ ms: 31_000, wakes: { "desk:kind": 900 } });
    expect(problem).toMatch(/past the wind's 20000 \+ 2000 ms .* something else held it/);
    expect(problem).toMatch(/desk:kind/);
  });

  it("refuses a rest before the wind's 20 s — the act touched no wind", () => {
    expect(judgeWindRest({ ms: 900, wakes: {} })[0]).toMatch(/before the wind's 20000 ms/);
    expect(judgeWindRest({ ms: null, wakes: {} })).toEqual([
      "with the wind the desk never rested after the act",
    ]);
  });
});

describe("REST ACT with the wind stilled, and REST COVER — at once", () => {
  it("passes a rest within the stilled budget", () => {
    expect(judgePromptRest("REST ACT", { ms: 420, wakes: { input: 6 } })).toEqual([]);
  });

  it("refuses a desk held past the budget, naming the wakes, and one that never rested", () => {
    expect(judgePromptRest("REST COVER", { ms: 21_000, wakes: { ambient: 1 } })[0]).toMatch(
      /REST COVER: the desk rested 21000 ms after, over its 1500 — something but the wind held it/,
    );
    expect(judgePromptRest("REST ACT", { ms: null, wakes: {} })).toEqual([
      "REST ACT: the desk never rested",
    ]);
  });
});
