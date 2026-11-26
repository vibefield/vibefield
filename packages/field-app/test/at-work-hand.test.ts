/**
 * Item 550 (2026-11-24) — THE AT-WORK MARK AND THE HAND (DESIGN.md §8 "At work on the mat", Where and
 * When not; §6 "Something in hand"). Seen in the pages room's second live run: a browser pane lifted to browse wore its
 * stroke round its OPEN EXTENT (the page and the head), inside its own border, its sticker on the head; and a
 * Simulator's stroke behind the lifted pane was drawn across its page. Two rules, each a row here:
 *  - in hand the frame is the kind's silhouette carried by the hand's pose, never the open extent;
 *  - the object in hand covers the marks behind it: a point under its silhouette is covered, a frame whose marks reach
 *    it meets it.
 * Red first: each row says what the hand's geometry must do.
 */
import { describe, expect, it } from "vitest";
import {
  atWorkCarriedOf,
  atWorkCovers,
  atWorkFramesMeet,
  atWorkHeldFrame,
  atWorkPoseOf,
} from "../src/field/desk/at-work/at-work-hand";
import type { ScreenFrame } from "../src/field/desk/at-work/at-work-model";

/** A pane in world units: its rect, its silhouette (border included) and its open extent (page and head, no border). */
const RECT = { cx: 100, cy: 100 };
const SILHOUETTE: ScreenFrame = { cx: 100, cy: 100, hx: 100, hy: 60, angle: 0, r: 8 };
const EXTENT = { cx: 100, cy: 95, w: 180, h: 110 };
/** The hand's pose as ICE publishes it: the extent's centre on screen, its half extents and its scale. */
const POSE = { cx: 600, cy: 400, hx: 180, hy: 110, s: 2 };

function near(actual: ScreenFrame, expected: ScreenFrame): void {
  for (const k of ["cx", "cy", "hx", "hy", "angle", "r"] as const)
    expect(actual[k], k).toBeCloseTo(expected[k], 6);
}

describe("in hand the mark goes round the kind's silhouette, carried by the hand's pose (DESIGN.md §8, Where)", () => {
  it("is the silhouette at the pose's scale, offset from the extent as the object is — never the extent itself", () => {
    const frame = atWorkHeldFrame(POSE, SILHOUETTE, RECT, EXTENT);
    // the pane's border is in: 100 × 2 half wide, not the extent's 90 × 2; its centre 5 × 2 below the extent's
    near(frame, { cx: 600, cy: 410, hx: 200, hy: 120, angle: 0, r: 16 });
    expect(frame.hx).toBeGreaterThan(POSE.hx);
  });

  it("turns the offset with the object while the pose still carries a turn (the pickup's flight)", () => {
    const a = 0.3;
    const turned = { ...SILHOUETTE, angle: a };
    const frame = atWorkHeldFrame(POSE, turned, RECT, EXTENT);
    // the rect's centre: P + R(a)·(rect − extent)·s, then the silhouette's own offset from the rect (none here)
    const ox = (RECT.cx - EXTENT.cx) * POSE.s;
    const oy = (RECT.cy - EXTENT.cy) * POSE.s;
    near(frame, {
      cx: POSE.cx + Math.cos(a) * ox - Math.sin(a) * oy,
      cy: POSE.cy + Math.sin(a) * ox + Math.cos(a) * oy,
      hx: 200,
      hy: 120,
      angle: a,
      r: 16,
    });
  });

  it("keeps the shown page when the hand shows one page of a spread, and the pose's frame when no extent is read", () => {
    const single = { ...POSE, hx: POSE.hx / 2, cx: POSE.cx + POSE.hx / 2 };
    near(atWorkHeldFrame(single, SILHOUETTE, RECT, EXTENT), {
      cx: single.cx,
      cy: single.cy,
      hx: single.hx,
      hy: single.hy,
      angle: 0,
      r: 16,
    });
    near(atWorkHeldFrame(POSE, SILHOUETTE, null, null), {
      cx: 600,
      cy: 400,
      hx: 180,
      hy: 110,
      angle: 0,
      r: 16,
    });
  });
});

describe("the object in hand covers what lies behind it (DESIGN.md §8, When not)", () => {
  const HAND: ScreenFrame = { cx: 600, cy: 400, hx: 200, hy: 120, angle: 0, r: 16 };

  it("covers a point under its silhouette, corners rounded, and none past it", () => {
    expect(atWorkCovers(HAND, 600, 400)).toBe(true);
    expect(atWorkCovers(HAND, 799, 400)).toBe(true);
    expect(atWorkCovers(HAND, 801, 400)).toBe(false);
    // the corner is rounded: its very tip is outside
    expect(atWorkCovers(HAND, 799, 519)).toBe(false);
    expect(atWorkCovers(HAND, 790, 510)).toBe(true);
    expect(atWorkCovers(null, 600, 400)).toBe(false);
  });

  it("covers through its turn", () => {
    const turned = { ...HAND, hx: 200, hy: 20, r: 0, angle: Math.PI / 2 };
    expect(atWorkCovers(turned, 600, 590)).toBe(true);
    expect(atWorkCovers(turned, 790, 400)).toBe(false);
  });

  it("meets a frame whose marks reach under it, and none whose reach stops short", () => {
    const behind: ScreenFrame = { cx: 760, cy: 400, hx: 30, hy: 60, angle: 0, r: 0 };
    expect(atWorkFramesMeet(behind, 0, HAND)).toBe(true);
    const beside: ScreenFrame = { cx: 860, cy: 400, hx: 30, hy: 60, angle: 0, r: 0 };
    // 30 short of the edge: a reach of 24.5 stops short, one of 35 meets it
    expect(atWorkFramesMeet(beside, 24.5, HAND)).toBe(false);
    expect(atWorkFramesMeet(beside, 35, HAND)).toBe(true);
    // a turned frame is measured along its own axes too
    const turned: ScreenFrame = { cx: 860, cy: 400, hx: 80, hy: 10, angle: Math.PI / 4, r: 0 };
    expect(atWorkFramesMeet(turned, 0, HAND)).toBe(true);
    expect(atWorkFramesMeet(behind, 0, null)).toBe(false);
  });
});

describe("the hand's cover holds through the put-back (DESIGN.md §8 When not: through the pickup and the put-back)", () => {
  // ICE 0.20.0 clears the fact (`heldEntity`) the moment Done is pressed, while its desk builder still flies the object
  // home (`DeskLayerHandle.hand()`: `landing`) and the pose seam answers none
  const LANDING = { cx: 520, cy: 380, hx: 120, hy: 70, s: 1.4 };
  const flying = { entity: 7, landing: true, frame: LANDING };

  it("names the object the hand draws: the one flying home, though nothing is in hand", () => {
    expect(atWorkCarriedOf(flying, undefined)).toBe(7);
    expect(atWorkCarriedOf({ ...flying, landing: false }, 7)).toBe(7);
    // a hand the builder has not drawn yet (or a kind it does not hold): the fact's object
    expect(atWorkCarriedOf(undefined, 9)).toBe(9);
    expect(atWorkCarriedOf(undefined, undefined)).toBeUndefined();
  });

  it("takes the object's pose from the hand's own build while it lands, and the seam's otherwise", () => {
    const seam = { cx: 1, cy: 2, hx: 3, hy: 4, s: 1 };
    expect(atWorkPoseOf(7, flying, () => undefined)).toEqual(LANDING);
    expect(atWorkPoseOf(8, flying, () => seam)).toEqual(seam);
    expect(atWorkPoseOf(7, undefined, () => seam)).toEqual(seam);
    expect(atWorkPoseOf(7, undefined, () => undefined)).toBeUndefined();
  });
});
