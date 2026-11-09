// Item 48 — the deck edge's held readout, its judge (testing/deck-away-rungs.ts): said before the pointer let go, or said
// to be missing. The page keeps the watch; a read after the let-go never counts.
import { describe, expect, it } from "vitest";
import { judgeHeldReadout } from "../src/testing/deck-away-rungs";

describe("held past the line, the stage says so (item 48)", () => {
  it("said before the let-go passes", () => {
    expect(judgeHeldReadout({ said: 900, letGo: 1000 })).toEqual([]);
  });

  it("nothing said before the let-go is red", () => {
    expect(judgeHeldReadout({ said: null, letGo: 1000 })[0]).toMatch(
      /held past the line, the stage said nothing/,
    );
  });

  it("a watch never armed, or a let-go the page never heard, is said", () => {
    expect(judgeHeldReadout(null)).toEqual(["the readout's watch was never armed"]);
    expect(judgeHeldReadout({ said: 900, letGo: null })).toEqual([
      "the let-go never reached the page",
    ]);
  });
});
