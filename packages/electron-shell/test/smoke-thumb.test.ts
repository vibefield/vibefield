/**
 * DK-17b — the explorer's thumbnail taken while a selection stands is the desk without its marks (ICE I40's purpose;
 * smoke:canvas's THUMB row, testing/smoke-thumb.ts): the judge over the selection's region of the quarter still.
 */
import { describe, expect, it } from "vitest";
import { judgeThumb, THUMB, type ThumbSeen } from "../src/testing/smoke-thumb";

const seen = (over: Partial<ThumbSeen> = {}): ThumbSeen => ({
  fresh: true,
  selected: 1,
  size: [295, 187, 295, 187],
  region: { x0: 40, y0: 30, x1: 90, y1: 70 },
  bare: 0,
  marks: 48,
  vsMarked: 48,
  ...over,
});

describe("the thumbnail is the document's picture, not the person's selection (ICE I40)", () => {
  it("passes a thumbnail that is the desk without the marks, the marks showing at a quarter", () => {
    expect(judgeThumb(seen())).toEqual([]);
    expect(judgeThumb(seen({ bare: THUMB.maxBare }))).toEqual([]);
  });
  it("names desk.6's thumbnail: the selection's marks in it", () => {
    const problems = judgeThumb(seen({ bare: 48, vsMarked: 0 }));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/not the desk without the selection's marks \(48 px/);
    expect(problems[1]).toMatch(
      /carries the selection's marks \(0 px from the marked capture, the marks 48\)/,
    );
  });
  it("fails a row that proves nothing: no new still, nothing selected, marks that do not show at a quarter", () => {
    expect(judgeThumb(seen({ fresh: false }))).toEqual([
      "no new thumbnail was kept after the move, the selection standing",
    ]);
    expect(judgeThumb(seen({ selected: 0 }))[0]).toMatch(/nothing stood selected/);
    expect(judgeThumb(seen({ marks: THUMB.minMarks - 1, vsMarked: 0 }))[0]).toMatch(
      /marks do not show at a quarter \(19 px\)/,
    );
  });
});
