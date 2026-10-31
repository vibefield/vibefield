/**
 * DK-13 — THE PEGBOARD'S MODEL (field/desk/pegboard/pegboard-model.ts; DESIGN.md §8 "The pegboard — Objects, behind the
 * line"; R14, R19, P3c): what the filters offer (All, then the categories whose plugin is on, no counts), where they
 * stand in the board's clear header band (centred, 12 in, the 36 track in the 48 band, fading over the slide's last
 * 40 %), and where the specimens hang (reading order; the row above and below for ↑ ↓). Since DK-17b (ICE I37) the walk
 * ← →, the focus itself and the scroll that shows it are ICE's (`tray.focus`), tested in ICE's tray-focus suite.
 */
import { specimenFit } from "@vibecook/ice/kernel";
import { describe, expect, it } from "vitest";
import {
  type BoardSpecimen,
  boardSpecimens,
  filterOptions,
  filtersOpacity,
  type LaidSpecimen,
  offeredCategories,
  PEGBOARD,
  placeFilters,
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

  it("keeps the line's 88 at the board's foot (I21)", () => {
    expect(PEGBOARD.foot).toBe(88);
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
