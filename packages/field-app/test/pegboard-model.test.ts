/**
 * DK-13 — THE PEGBOARD'S MODEL (field/desk/pegboard/pegboard-model.ts; DESIGN.md §8 "The pegboard — Objects, behind the
 * line"; R14, R19, P3c): what the filters offer (All, then the categories whose plugin is on, no counts), where they
 * stand in the board's clear header band (centred, 12 in, the 36 track in the 48 band, fading over the slide's last
 * 40 %), and where the specimens hang (reading order; the row above and below for ↑ ↓). Since DK-17b (ICE I37) the walk
 * ← →, the focus itself and the scroll that shows it are ICE's (`tray.focus`), tested in ICE's tray-focus suite. MK-4d:
 * where More in Plugins… stands and when it steps aside (MK-D1), and where a set shown after an install lands and what
 * a showing does next (MK-D8's fallback B, MK-E14).
 */
import { specimenFit } from "@vibecook/ice/kernel";
import { describe, expect, it } from "vitest";
import { DESK_HOLD } from "../src/field/desk/desk-layer";
import {
  type BoardSpecimen,
  boardSpecimens,
  filterOptions,
  filtersOpacity,
  type LaidSpecimen,
  NO_SLIDE,
  offeredCategories,
  PEGBOARD,
  pillAside,
  placeFilters,
  placePill,
  type RevealFacts,
  readSlide,
  revealPlan,
  revealStep,
  rowStep,
} from "../src/field/desk/pegboard/pegboard-model";

const CATEGORIES = [
  { id: "paper", label: "Paper", count: 4 },
  { id: "surfaces", label: "Surfaces", count: 2 },
  { id: "things", label: "Things", count: 1 },
  { id: "comments", label: "Comments", count: 1 },
];
const HUNG = [
  { type: "desk.note", category: "paper" },
  { type: "desk.print", category: "paper" },
  { type: "desk.board", category: "surfaces" },
  { type: "desk.minimat", category: "surfaces" },
  { type: "vibefield.example.desk-clock", category: "things" },
  { type: "vibefield.comment-pad", category: "comments" },
];

describe("the filters (R19, P3c)", () => {
  it("offers every category the board hangs while every plugin is on", () => {
    expect(offeredCategories(CATEGORIES, HUNG, new Set()).map((c) => c.id)).toEqual([
      "paper",
      "surfaces",
      "things",
      "comments",
    ]);
  });

  it("does not offer a category whose every kind's plugin is off — and keeps one with any kind on", () => {
    const off = new Set(["vibefield.example.desk-clock", "desk.print"]);
    expect(offeredCategories(CATEGORIES, HUNG, off).map((c) => c.id)).toEqual([
      "paper",
      "surfaces",
      "comments",
    ]);
  });

  it("puts All first, then the categories in the lay's order, by their labels, with no counts", () => {
    expect(filterOptions(CATEGORIES)).toEqual([
      { id: "", label: "All" },
      { id: "paper", label: "Paper" },
      { id: "surfaces", label: "Surfaces" },
      { id: "things", label: "Things" },
      { id: "comments", label: "Comments" },
    ]);
    expect(filterOptions([])).toEqual([{ id: "", label: "All" }]);
  });

  it("fades the filters in over the slide's last 40 %, eased", () => {
    expect(filtersOpacity(0)).toBe(0);
    expect(filtersOpacity(0.6)).toBe(0);
    expect(filtersOpacity(0.8)).toBeCloseTo(0.5, 6);
    expect(filtersOpacity(0.7)).toBeCloseTo(0.15625, 6);
    expect(filtersOpacity(1)).toBe(1);
    expect(filtersOpacity(1.2)).toBe(1);
  });

  it("stands centred in the header band, 12 in from its sides, the 36 track in the 48 band", () => {
    const drawer = { x: 30, y: 437, w: 1120, p: 1, header: { y: 438.5, h: 48 } };
    expect(placeFilters(drawer)).toEqual({ cx: 590, y: 444.5, maxWidth: 1096, opacity: 1 });
    expect(PEGBOARD.track).toBe(36);
    // following the drawer mid-slide: its y moves with it, its opacity with the slide
    const mid = placeFilters({ ...drawer, y: 600, p: 0.8, header: { y: 601.5, h: 48 } });
    expect(mid?.y).toBe(607.5);
    expect(mid?.opacity).toBeCloseTo(0.5, 6);
    expect(placeFilters(null)).toBeNull();
  });
});

const laid = (
  type: string,
  x: number,
  y: number,
  w = 120,
  h = 160,
  natural = { w: 220, h: 280 },
): LaidSpecimen => ({ type, label: type, hang: { x, y, w, h }, natural });

describe("the specimens where the board draws them (R14)", () => {
  it("is the kernel's fit in each hang, offset by the drawer as drawn and its scroll, in the lay's order", () => {
    // the specimens in their sibling order; the lay's: a b on its first line, c on its second
    const specimens = boardSpecimens(
      [laid("b", 200, 80), laid("c", 40, 280), laid("a", 40, 80)],
      ["a", "b", "c"],
      { x: 30, y: 437 },
      20,
    );
    expect(specimens.map((s) => s.type)).toEqual(["a", "b", "c"]);
    expect(specimens.map((s) => s.row)).toEqual([0, 0, 1]);
    const fit = specimenFit({ x: 40, y: 80, w: 120, h: 160 }, { w: 220, h: 280 });
    expect(specimens[0]?.rect).toEqual({
      x0: 30 + fit.x,
      y0: 437 + fit.y - 20,
      x1: 30 + fit.x + fit.w,
      y1: 437 + fit.y + fit.h - 20,
    });
  });

  it("leaves out a type the lay does not name", () => {
    expect(
      boardSpecimens([laid("a", 40, 80), laid("b", 200, 80)], ["b"], { x: 0, y: 0 }, 0),
    ).toHaveLength(1);
  });
});

const spec = (type: string, row: number, x0: number, w = 80): BoardSpecimen => ({
  type,
  label: type,
  row,
  rect: { x0, y0: row, x1: x0 + w, y1: row + 100 },
});

describe("↑ ↓ — the row above or below (R14; ← → are ICE's walk in the lay's order)", () => {
  // two rows: a b c over d e
  const board = [
    spec("a", 80, 40),
    spec("b", 80, 200),
    spec("c", 80, 360),
    spec("d", 280, 40, 240),
    spec("e", 280, 330),
  ];

  it("moves to the nearest by its centre in the row above or below, staying at an edge row", () => {
    // b's centre 240: d's centre 160 (|80|), e's 370 (|130|) → d
    expect(rowStep(board, 1, "ArrowDown")).toBe(3);
    // c's centre 400: e's 370 → e
    expect(rowStep(board, 2, "ArrowDown")).toBe(4);
    // e's centre 370: a 80, b 240, c 400 → c
    expect(rowStep(board, 4, "ArrowUp")).toBe(2);
    expect(rowStep(board, 0, "ArrowUp")).toBe(0);
    expect(rowStep(board, 3, "ArrowDown")).toBe(3);
  });

  it("says nothing with nothing focused, nor on an empty board — the controller then asks ICE for the first", () => {
    expect(rowStep(board, -1, "ArrowDown")).toBeNull();
    expect(rowStep([], -1, "ArrowUp")).toBeNull();
  });
});

/** A drawer as ICE 0.17.0 slides it in a 1180 × 780 view: its top shut at the view's foot and its shadow's reach (62),
 * out at the foot less its height (343), running straight between them with the slide. */
const slid = (p: number) => ({
  x: 30,
  y: 780 + 62 - (343 + 62) * p,
  w: 1120,
  p,
  header: { y: 780 + 62 - (343 + 62) * p + 1.5, h: 48 },
});

describe("More in Plugins… (MK-4d; MK-D1)", () => {
  it("stands its foot 100 above the view's foot — a held object's reserve, DESK_HOLD's band — on the drawer's centre line", () => {
    expect(PEGBOARD.pill).toEqual({ height: 32, foot: 100 });
    expect(PEGBOARD.pill.foot).toBe(DESK_HOLD.band);
    // at 1180 × 780: y 648…680, 28 clear of the line's top (708)
    expect(placePill(slid(1), { height: 780 }, 405)).toEqual({ cx: 590, y: 648, opacity: 1 });
    expect(placePill(null, { height: 780 }, 405)).toBeNull();
  });

  it("rides the drawer every frame of its slide, below its place by the travel still to go, fading in with the filters", () => {
    for (const p of [0.62, 0.7, 0.8, 0.9]) {
      const at = placePill(slid(p), { height: 780 }, 405);
      expect(at?.y).toBeCloseTo(648 + 405 * (1 - p), 6);
      // the pill and the drawer's top move together
      expect((at?.y ?? 0) - slid(p).y).toBeCloseTo(648 - slid(1).y, 6);
      expect(at?.opacity).toBe(filtersOpacity(p));
    }
    // before a travel is read it stands at its place, unseen until the slide's last 40 %
    expect(placePill(slid(0.1), { height: 780 }, null)).toEqual({ cx: 590, y: 648, opacity: 0 });
  });

  it("reads the drawer's travel from two frames at different slides, and reads again in a view of another height", () => {
    let read = readSlide(NO_SLIDE, slid(0.1), 780);
    expect(read.travel).toBeNull();
    read = readSlide(read, slid(0.3), 780);
    expect(read.travel).toBeCloseTo(405, 6);
    // a frame that moved no slide (at rest, the rubber band) keeps it
    read = readSlide(read, slid(0.3), 780);
    expect(read.travel).toBeCloseTo(405, 6);
    // out, the pill stands at its place on the travel read
    expect(placePill(slid(1), { height: 780 }, read.travel)?.y).toBeCloseTo(648, 6);
    // a resize: read again
    read = readSlide(read, { y: 500, p: 1 }, 700);
    expect(read).toEqual({ height: 700, last: { y: 500, p: 1 }, travel: null });
  });

  it("steps aside while an object is in hand and while the board hangs nothing, as ICE's own bar does", () => {
    expect(pillAside({ held: false, entries: 6 })).toBe(false);
    expect(pillAside({ held: true, entries: 6 })).toBe(true);
    expect(pillAside({ held: false, entries: 0 })).toBe(true);
  });
});

describe("a set shown after an install (MK-4d; MK-D8's fallback B)", () => {
  it("lands on the set's first category in the board's order, and there on the set's first object", () => {
    // the set names the board first, the note second: the board's order puts Paper before Surfaces
    expect(revealPlan(["desk.board", "desk.note"], CATEGORIES, HUNG, new Set())).toEqual({
      category: "paper",
      type: "desk.note",
    });
    // within a category, the set's own order
    expect(revealPlan(["desk.print", "desk.note"], CATEGORIES, HUNG, new Set())).toEqual({
      category: "paper",
      type: "desk.print",
    });
    expect(revealPlan(["vibefield.example.desk-clock"], CATEGORIES, HUNG, new Set())).toEqual({
      category: "things",
      type: "vibefield.example.desk-clock",
    });
  });

  it("leaves out what the desk does not draw, and waits while none of the set hangs", () => {
    const off = new Set(["desk.note", "desk.print"]);
    expect(revealPlan(["desk.note", "desk.board"], CATEGORIES, HUNG, off)).toEqual({
      category: "surfaces",
      type: "desk.board",
    });
    expect(revealPlan(["desk.note"], CATEGORIES, HUNG, off)).toBeNull();
    // a kind a remount is still to bring
    expect(revealPlan(["acme.kanban.board"], CATEGORIES, HUNG, new Set())).toBeNull();
    expect(revealPlan([], CATEGORIES, HUNG, new Set())).toBeNull();
  });

  it("shows a set that hangs under no offered category under All, its first that hangs focused", () => {
    const hung = [...HUNG, { type: "acme.loose", category: "" }];
    expect(revealPlan(["acme.gone", "acme.loose"], CATEGORIES, hung, new Set())).toEqual({
      category: "",
      type: "acme.loose",
    });
  });
});

describe("what a showing does next (MK-4d; MK-E14)", () => {
  const asked: RevealFacts = {
    covered: false,
    askedCanvas: false,
    onCanvas: false,
    surface: "plugins",
    open: false,
    held: false,
    desk: "1.0",
    shownOn: null,
  };

  it("asks for Canvas first over a covered view and waits there — dropped if the popup folds while the view stays covered", () => {
    expect(revealStep({ ...asked, covered: true })).toBe("canvas");
    expect(revealStep({ ...asked, covered: true, askedCanvas: true })).toBe("wait");
    expect(revealStep({ ...asked, covered: true, askedCanvas: true, surface: null })).toBe("drop");
  });

  it("is dropped by a cover that comes once it stood on Canvas — the person's own move, Canvas never asked back", () => {
    // ⌘2 while the board rises, or while it waits for an install's remount
    expect(revealStep({ ...asked, covered: true, onCanvas: true })).toBe("drop");
    expect(
      revealStep({ ...asked, covered: true, onCanvas: true, surface: "objects", shownOn: "1.0" }),
    ).toBe("drop");
    // after a Canvas it asked for, the same
    expect(revealStep({ ...asked, covered: true, askedCanvas: true, onCanvas: true })).toBe("drop");
  });

  it("raises the board on Canvas over the popup, unless an object is in hand, and lays it once it is out", () => {
    expect(revealStep(asked)).toBe("raise");
    // Canvas reached: the popup folded with the change of view
    expect(revealStep({ ...asked, askedCanvas: true, surface: null })).toBe("raise");
    expect(revealStep({ ...asked, held: true })).toBe("drop");
    expect(revealStep({ ...asked, surface: "objects", open: true })).toBe("out");
  });

  it("is dropped when the board folds on the desk it was out on, and raised again on the desk a remount brings", () => {
    expect(revealStep({ ...asked, surface: null, shownOn: "1.0" })).toBe("drop");
    expect(revealStep({ ...asked, surface: "palette", shownOn: "1.0" })).toBe("drop");
    expect(revealStep({ ...asked, surface: null, shownOn: "1.0", desk: "1.1" })).toBe("raise");
    // …unless the person opened another surface meanwhile
    expect(revealStep({ ...asked, surface: "palette", shownOn: "1.0", desk: "1.1" })).toBe("drop");
  });
});
