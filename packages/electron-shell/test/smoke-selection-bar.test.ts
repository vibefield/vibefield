/**
 * DK-11 — the smoke's own judges (testing/smoke-selection-bar.ts): where the canon puts the bar over an anchor, where
 * the grown menu may stand, and the counters' witness. A judge that passed a wrong place would let smoke:canvas's
 * BAR rows read green over a misplaced bar — so each is held here against the canon's numbers at the default window.
 */
import { describe, expect, it } from "vitest";
import {
  type BarSeen,
  judgeBarPlace,
  judgeCounters,
  judgeMenuPlace,
} from "../src/testing/smoke-selection-bar";

const view = { width: 1180, height: 780 };
const anchor = (box: { x0: number; y0: number; x1: number; y1: number } | null) => ({
  box,
  count: 1,
  locked: false,
  view,
});

describe("the bar's place, judged (R7)", () => {
  it("passes a bar centred over the brackets with its foot 10 above them, 40 tall", () => {
    expect(
      judgeBarPlace(anchor({ x0: 400, y0: 300, x1: 600, y1: 450 }), {
        x0: 370,
        y0: 250,
        x1: 630,
        y1: 290,
      }),
    ).toEqual([]);
  });

  it("names a bar off its place — its foot on the brackets, off centre, or the wrong height", () => {
    const box = { x0: 400, y0: 300, x1: 600, y1: 450 };
    expect(judgeBarPlace(anchor(box), { x0: 370, y0: 260, x1: 630, y1: 300 })).toEqual([
      "the bar's top is 260, not 250 (its foot 10 off the brackets)",
    ]);
    expect(judgeBarPlace(anchor(box), { x0: 300, y0: 250, x1: 560, y1: 290 })).toEqual([
      "the bar's left is 300, not 370 (centred, 42 from the sides)",
    ]);
    expect(judgeBarPlace(anchor(box), { x0: 370, y0: 250, x1: 630, y1: 302 })[0]).toContain(
      "tall, not 40",
    );
  });

  it("wants it 10 BELOW the brackets under the safe top — at least 94 — and 42 from a side", () => {
    expect(
      judgeBarPlace(anchor({ x0: 400, y0: 120, x1: 600, y1: 200 }), {
        x0: 370,
        y0: 210,
        x1: 630,
        y1: 250,
      }),
    ).toEqual([]);
    expect(
      judgeBarPlace(anchor({ x0: 400, y0: 20, x1: 600, y1: 60 }), {
        x0: 370,
        y0: 94,
        x1: 630,
        y1: 134,
      }),
    ).toEqual([]);
    expect(
      judgeBarPlace(anchor({ x0: 0, y0: 300, x1: 100, y1: 400 }), {
        x0: 42,
        y0: 250,
        x1: 302,
        y1: 290,
      }),
    ).toEqual([]);
  });

  it("names no box and no bar", () => {
    expect(judgeBarPlace(anchor(null), null)).toEqual([
      "the desk published no box for the selection",
    ]);
    expect(judgeBarPlace(anchor({ x0: 1, y0: 1, x1: 2, y1: 2 }), null)).toEqual([
      "no bar was drawn over the selection",
    ]);
  });
});

describe("the grown menu's place, judged (R6, R20)", () => {
  const row = { x0: 370, y0: 250, x1: 630, y1: 290 };
  const seen = (over: Partial<BarSeen>): BarSeen => ({
    shown: true,
    open: true,
    row,
    panel: { x0: 370, y0: 100, x1: 630, y1: 290 },
    dir: "up",
    cells: [],
    send: null,
    tips: {},
    glyphs: {},
    rows: [],
    eyebrow: null,
    ...over,
  });

  it("passes a menu the bar's width (≥ 244), inside 94 and the line's reserve, the row unmoved", () => {
    expect(judgeMenuPlace(view, row, seen({}))).toEqual([]);
  });

  it("names a moved row, a narrow menu, a top over 94 and a foot over the line", () => {
    expect(judgeMenuPlace(view, row, seen({ row: { ...row, y0: 240, y1: 280 } }))[0]).toContain(
      "row moved",
    );
    expect(
      judgeMenuPlace(
        view,
        { x0: 400, y0: 250, x1: 600, y1: 290 },
        seen({
          row: { x0: 400, y0: 250, x1: 600, y1: 290 },
          panel: { x0: 400, y0: 100, x1: 600, y1: 290 },
        }),
      ),
    ).toEqual(["the menu is 200 wide, not 244"]);
    expect(
      judgeMenuPlace(view, row, seen({ panel: { x0: 370, y0: 80, x1: 630, y1: 290 } })),
    ).toEqual(["the menu's top 80 crosses the safe top (94)"]);
    expect(
      judgeMenuPlace(
        view,
        row,
        seen({ dir: "down", panel: { x0: 370, y0: 250, x1: 630, y1: 720 } }),
      ),
    ).toEqual(["the menu's foot 720 is over the line's reserve (700)"]);
    expect(judgeMenuPlace(view, row, seen({ open: false }))).toEqual([
      "the bar did not grow into its menu",
    ]);
  });
});

describe("the counters' witness", () => {
  it("holds placements ≤ publishes, and names a placement without a publish", () => {
    expect(
      judgeCounters(
        { publishes: 10, placements: 4, renders: 2 },
        { publishes: 30, placements: 20, renders: 6 },
      ),
    ).toEqual([]);
    expect(
      judgeCounters(
        { publishes: 10, placements: 4, renders: 2 },
        { publishes: 12, placements: 7, renders: 2 },
      ),
    ).toEqual(["the bar was placed 3 times for 2 publishes — a placement without a publish"]);
  });
});
