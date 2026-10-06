// @vitest-environment node
/**
 * DK-11 — WHERE THE SELECTION BAR STANDS, AND HOW IT GROWS (field/desk/bar/bar-geometry.ts; DESIGN.md §8 "The selection
 * bar" — Place; "The bar grown"; §10 "The mat's places"; R6, R7). At the default window (1180 × 780): centred over the
 * brackets with its foot 10 above them; 10 below them when its top would cross the safe top (94), clamped there; 42
 * from each side; its top never below 660; no bar for a selection wholly off-screen. Grown: at least 244 wide (the
 * bar's width when wider), centred on the bar, 42 from the sides; up from its row, or down when the top would cross
 * 94; when it fits neither way the list scrolls, clamped between 94 and the line's reserve (700).
 */
import { describe, expect, it } from "vitest";
import { BAR, growMenu, HAND, placeBar, placeHand } from "../src/field/desk/bar/bar-geometry";
import { BAR_MOTION, barMotion, swapAt, travelTransition } from "../src/field/desk/bar/bar-motion";
import { DESK_HOLD } from "../src/field/desk/desk-layer";

const view = { width: 1180, height: 780 };
const one = (box: { x0: number; y0: number; x1: number; y1: number }) => ({ box, count: 1, view });

describe("where the selection bar stands (R7)", () => {
  it("centred over the brackets, its foot 10 above them", () => {
    expect(placeBar(one({ x0: 400, y0: 300, x1: 600, y1: 450 }), 260)).toEqual({
      x: 370,
      y: 300 - 10 - 40,
      below: false,
    });
  });

  it("10 BELOW the brackets when its top would cross the safe top (94) — and clamped at 94 there", () => {
    // the bar above would stand at 140 - 50 = 90 < 94
    expect(placeBar(one({ x0: 400, y0: 140, x1: 600, y1: 300 }), 260)).toMatchObject({
      y: 310,
      below: true,
    });
    // an object under the head: flipped below, its top at the safe top, never higher
    expect(placeBar(one({ x0: 400, y0: 20, x1: 600, y1: 60 }), 260)).toMatchObject({
      y: BAR.safeTop,
      below: true,
    });
    expect(BAR.safeTop).toBe(94);
  });

  it("kept 42 from each side, whatever the selection's x", () => {
    expect(placeBar(one({ x0: -100, y0: 300, x1: 60, y1: 400 }), 260)?.x).toBe(42);
    expect(placeBar(one({ x0: 1100, y0: 300, x1: 1300, y1: 400 }), 260)?.x).toBe(1180 - 42 - 260);
  });

  it("its top never lower than 660 — its foot 8 above the line's top (708)", () => {
    // a tall selection: no room above (top 60 - 50 < 94), below it would be 790: clamped at 660
    expect(placeBar(one({ x0: 400, y0: 60, x1: 600, y1: 780 }), 260)).toMatchObject({
      y: 660,
      below: true,
    });
    expect(780 - BAR.lowest).toBe(660);
  });

  it("no bar with nothing selected, no box drawn, or the selection wholly off-screen", () => {
    expect(placeBar({ box: null, count: 1, view }, 260)).toBeNull();
    expect(placeBar({ box: { x0: 1, y0: 1, x1: 2, y1: 2 }, count: 0, view }, 260)).toBeNull();
    expect(placeBar(one({ x0: -300, y0: 300, x1: -10, y1: 400 }), 260)).toBeNull();
    expect(placeBar(one({ x0: 300, y0: 800, x1: 500, y1: 900 }), 260)).toBeNull();
    // a sliver on screen keeps its bar
    expect(placeBar(one({ x0: -300, y0: 300, x1: 4, y1: 400 }), 260)).not.toBeNull();
  });
});

describe("the bar grown (R6, R20)", () => {
  it("at least 244 wide, the bar's width when wider — centred on the bar", () => {
    expect(growMenu({ x: 500, y: 400, width: 200 }, 200, view)).toMatchObject({
      x: 478,
      width: 244,
    });
    expect(growMenu({ x: 500, y: 400, width: 300 }, 200, view)).toMatchObject({
      x: 500,
      width: 300,
    });
  });

  it("kept 42 from the sides", () => {
    expect(growMenu({ x: 42, y: 400, width: 200 }, 200, view).x).toBe(42);
  });

  it("UPWARD from the bar's row while its top stays under the safe top; DOWNWARD when it would cross 94", () => {
    expect(growMenu({ x: 500, y: 400, width: 260 }, 300, view)).toMatchObject({
      up: true,
      listHeight: 300,
      scroll: false,
    });
    // a bar near the top: 200 - 1 - 120 = 79 < 94 — down, the row heading it
    expect(growMenu({ x: 500, y: 200, width: 260 }, 120, view)).toMatchObject({
      up: false,
      listHeight: 120,
      scroll: false,
    });
    // the same list from lower down: 400 - 1 - 120 = 279 ≥ 94 — up
    expect(growMenu({ x: 500, y: 400, width: 260 }, 120, view).up).toBe(true);
  });

  it("fitting neither way, the list SCROLLS inside it on the side with the more room — never over the line", () => {
    // room up: 300 - 1 - 94 = 205; room down: 780 - 80 - (300 + 41) = 359
    expect(growMenu({ x: 500, y: 300, width: 260 }, 500, view)).toEqual({
      x: 500,
      width: 260,
      up: false,
      listHeight: 359,
      scroll: true,
    });
    // grown down from a bar at 300, the list ends at 300 + 41 + 359 = 700: 8 above the line's top
    expect(300 + 41 + 359).toBe(708 - 8);
  });
});

// DK-12 — THE TOOLS IN HAND (§8 "Tools in hand"; R13; ICE I20): under the head, top y 64 (centre 84), centred on the
// window; the held object's reading fit keeps 116 above it (the bar's foot, 104, + 12) and 100 below (the line's 88 +
// 12); the travel 560 ms on the island curve, the cross-fade its last 120 ms; reduced motion a fade only, halved.
describe("where the tools in hand stand, and what the layer reserves for them (DK-12)", () => {
  it("under the head — top y 64, its centre 84 — centred on the window, whatever the selection's box", () => {
    expect(placeHand(view, 420)).toEqual({ x: (1180 - 420) / 2, y: 64, below: false });
    expect(HAND.top + BAR.height / 2).toBe(84);
    // a window narrower than the bar and its sides keeps 42 from the left
    expect(placeHand({ width: 400, height: 780 }, 420).x).toBe(42);
  });

  it("the layer keeps 116 above the held object (the bar's foot and 12) and 100 below it (the line's 88 and 12), the travel 560", () => {
    expect(DESK_HOLD).toEqual({ top: 116, band: 100, travelMs: 560 });
    expect(DESK_HOLD.top).toBe(HAND.top + BAR.height + 12);
    expect(DESK_HOLD.band).toBe(88 + 12);
  });

  it("travels on the island curve over the anchor's travel; the cross-fade is its last 120 ms — reduced, a fade only, halved", () => {
    expect(travelTransition(560)).toBe("transform 560ms var(--vf-ease-island)");
    expect(BAR_MOTION).toMatchObject({ swapMs: 120, travels: true });
    expect(swapAt(BAR_MOTION, 560)).toBe(440);
    expect(swapAt(BAR_MOTION, 80)).toBe(0); // a travel shorter than the cross-fade swaps at once
    expect(barMotion(true)).toMatchObject({ swapMs: 60, travels: false });
  });
});
