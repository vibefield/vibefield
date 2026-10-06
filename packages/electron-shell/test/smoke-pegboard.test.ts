// DK-13 — THE PEGBOARD'S SMOKE JUDGES (testing/smoke-pegboard.ts; DESIGN.md §8 "The pegboard — Objects, behind the line";
// R14, R19): where the filters stand in the board's header band, whether the keyboard's ring stands around the desk's own
// drawing of the focused specimen, whether ⏎'s object lies on the view's centre, and the counters' rule (no placement
// without a publish or a key). Pure — the rows' words, red where the canon is missed.
import { describe, expect, it } from "vitest";
import {
  BOARD_PLACE,
  judgeBoardCounters,
  judgeCentred,
  judgeFiltersPlace,
  judgeRing,
} from "../src/testing/smoke-pegboard";

const drawer = { x: 30, y: 419, w: 1120, p: 1, header: { y: 420.5, h: 48 } };
/** The track where the canon puts it: centred on the drawer, its top 6 under the band's (36 in the 48). */
const track = (w = 382, dx = 0, dy = 0) => ({
  x0: 590 - w / 2 + dx,
  y0: 426.5 + dy,
  x1: 590 + w / 2 + dx,
  y1: 462.5 + dy,
});
const segment = (h = 30) => ({ x0: 0, y0: 0, x1: 60, y1: h });

describe("the filters' place (§8)", () => {
  it("passes the canon's place", () => {
    expect(judgeFiltersPlace(drawer, track(), [segment(), segment()])).toEqual([]);
    expect(BOARD_PLACE).toEqual({ foot: 88, inset: 12, track: 36, segment: 30 });
  });

  it("names a track off the drawer's centre, out of the band, the wrong height, or a segment not 30", () => {
    expect(judgeFiltersPlace(drawer, track(382, 12), [])).toEqual([
      "the filters' centre is 602, not the drawer's 590",
    ]);
    expect(judgeFiltersPlace(drawer, track(382, 0, 9), [])).toEqual([
      "the track's top is 435.5, not 426.5 (centred in the header band)",
      "the track's foot 471.5 leaves the header band",
    ]);
    expect(judgeFiltersPlace(drawer, track(1110), [])).toEqual([
      "the filters leave the 12 in from the band's sides (35…1145)",
    ]);
    expect(judgeFiltersPlace(drawer, { ...track(), y1: 466.5 }, [])).toEqual([
      "the track is 40 tall, not 36",
    ]);
    expect(judgeFiltersPlace(drawer, track(), [segment(34)])).toEqual([
      "a segment is 34 tall, not 30",
    ]);
    expect(judgeFiltersPlace(null, track(), [])).toEqual(["the tray drew no drawer"]);
    expect(judgeFiltersPlace(drawer, null, [])).toEqual(["no filters were drawn"]);
  });
});

describe("the keyboard's ring (R14)", () => {
  const object = { x0: 100, y0: 500, x1: 200, y1: 640 };
  it("passes a ring 2 out from where the desk draws the object", () => {
    expect(judgeRing({ x0: 98, y0: 498, x1: 202, y1: 642 }, object, "desk.note")).toEqual([]);
  });

  it("names a ring off the drawing, or none", () => {
    expect(judgeRing({ x0: 98, y0: 543, x1: 202, y1: 687 }, object, "desk.note")).toHaveLength(1);
    expect(judgeRing({ x0: 100, y0: 500, x1: 200, y1: 640 }, object, "desk.note")).toHaveLength(1);
    expect(judgeRing(null, object, "desk.note")).toEqual([
      "no ring stood over the focused desk.note",
    ]);
    expect(judgeRing({ x0: 0, y0: 0, x1: 1, y1: 1 }, null, "desk.note")).toEqual([
      "the desk drew no desk.note on the board",
    ]);
  });
});

describe("⏎ at the view's centre (R14)", () => {
  const view = { width: 1180, height: 748 };
  it("passes a box centred on the view", () => {
    expect(judgeCentred(view, { x0: 424, y0: 248, x1: 756, y1: 500 })).toEqual([]);
  });
  it("names a box off the centre", () => {
    expect(judgeCentred(view, { x0: 413, y0: 241, x1: 745, y1: 493 })).toEqual([
      "the laid object's centre is (579, 367), not the view's (590, 374)",
    ]);
    // off in x alone, and in y alone
    expect(judgeCentred(view, { x0: 434, y0: 248, x1: 766, y1: 500 })).toEqual([
      "the laid object's centre is (600, 374), not the view's (590, 374)",
    ]);
    expect(judgeCentred(view, { x0: 424, y0: 258, x1: 756, y1: 510 })).toEqual([
      "the laid object's centre is (590, 384), not the view's (590, 374)",
    ]);
    expect(judgeCentred(view, null)).toEqual(["the laid object has no box"]);
  });
});

describe("the counters (no render or placement per frame)", () => {
  const at = (publishes: number, placements: number) => ({
    publishes,
    placements,
    renders: 0,
    inserts: 0,
  });
  it("passes placements within two a publish and two a key", () => {
    expect(judgeBoardCounters(at(7, 8), at(295, 346), 2)).toEqual([]);
    expect(judgeBoardCounters(at(0, 0), at(10, 24), 2)).toEqual([]);
  });
  it("names a placement without a publish or a key", () => {
    expect(judgeBoardCounters(at(0, 0), at(10, 25), 2)).toEqual([
      "the pegboard placed 25 times for 10 publishes and 2 key moves — a placement without a publish",
    ]);
  });
});
