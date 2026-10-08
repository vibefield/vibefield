import type { TrayCategory } from "@vibecook/ice";
import { specimenFit } from "@vibecook/ice/kernel";

// THE PEGBOARD'S MODEL (DK-13; DESIGN.md §8 "The pegboard — Objects, behind the line"; R14, R19, P3c) — pure: what the
// filters offer and where they stand in the board's clear header band, and where the specimens hang (the listbox's
// options, and the row above or below for ↑ ↓). The keyboard's focus, its ← → walk, its scroll into view and its ring are
// ICE's since desk.6 (I37 — `handle.tray.focus`, `anchor().focused`; DK-17b). No DOM, no engine: the controller hands it
// the desk's facts (the tray's anchor, the specimens core laid) and writes what it answers.

/** The canon's numbers (§8; §10 "The mat's places"). */
export const PEGBOARD = {
  /** The board's lay keeps this at its foot (I21) — the line's 88 — so the last row clears the line. */
  foot: 88,
  /** The filters stand this far in from the header band's sides. */
  inset: 12,
  /** The track: segments 30 tall in a padding of 3 — 36 in all, centred in the band's 48. */
  track: 36,
  /** The filters fade in over the slide's last 40 % (ICE's own bar: `smoothstep(0.6, 1, p)`). */
  fadeFrom: 0.6,
} as const;

/** One filter: its id (`tray.category(id)`; `""` is All) and what it shows. */
export interface FilterOption {
  readonly id: string;
  readonly label: string;
}

/** A type the board hangs and its category (`""`: its entry names none — under All alone). */
export interface HungType {
  readonly type: string;
  readonly category: string;
}

/**
 * P3c — the board hangs only the kinds whose plugin is on: of the categories `tray.categories()` offers, those whose
 * every hung type is one the desk was mounted WITHOUT (a plugin off — its kind not drawn) are not offered.
 */
export function offeredCategories(
  categories: readonly TrayCategory[],
  hung: readonly HungType[],
  off: ReadonlySet<string>,
): TrayCategory[] {
  return categories.filter((c) => hung.some((h) => h.category === c.id && !off.has(h.type)));
}

/** All first, then the offered categories in the lay's order — their labels as ICE gives them (no counts). */
export function filterOptions(offered: readonly TrayCategory[]): FilterOption[] {
  return [{ id: "", label: "All" }, ...offered.map((c) => ({ id: c.id, label: c.label }))];
}

/** The filters' opacity over the slide `p` (0 shut … 1 out): nothing until 60 %, whole at 100 %, eased. */
export function filtersOpacity(p: number): number {
  const t = Math.min(Math.max((p - PEGBOARD.fadeFrom) / (1 - PEGBOARD.fadeFrom), 0), 1);
  return t * t * (3 - 2 * t);
}

/** The drawer as the anchor says it was drawn (`TrayAnchor.drawer`). */
export interface DrawnDrawer {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly p: number;
  readonly header: { readonly y: number; readonly h: number };
}

/** Where the filters stand: their centre's x, their top, the widest they may be, and their opacity. */
export interface FiltersPlace {
  readonly cx: number;
  readonly y: number;
  readonly maxWidth: number;
  readonly opacity: number;
}

/**
 * The filters centred in the board's clear header band, 12 in from its sides, following the drawer every frame of its
 * slide (its `y` moves with it) and fading in over the last 40 %; null with no drawer drawn.
 */
export function placeFilters(drawer: DrawnDrawer | null): FiltersPlace | null {
  if (drawer === null) return null;
  return {
    cx: drawer.x + drawer.w / 2,
    y: drawer.header.y + (drawer.header.h - PEGBOARD.track) / 2,
    maxWidth: Math.max(0, drawer.w - 2 * PEGBOARD.inset),
    opacity: filtersOpacity(drawer.p),
  };
}

/** A rect on screen, CSS px. */
export interface ScreenRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A specimen as core laid it: its type, its hang on the board (board px — x from the drawer's left edge, y down from
 * the board's top at scroll 0) and its object's natural size (the fit's other half). */
export interface LaidSpecimen {
  readonly type: string;
  readonly label: string;
  readonly hang: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly natural: { readonly w: number; readonly h: number };
}

/** A specimen where the board draws it: its object (the kernel's fit in its hang) on screen. */
export interface BoardSpecimen {
  readonly type: string;
  readonly label: string;
  /** The hang's top on the board — the row it hangs in. */
  readonly row: number;
  readonly rect: ScreenRect;
}

/**
 * Each specimen's OBJECT on screen as the board draws it — the kernel's fit inside its hang (`specimenFit`, the law
 * core's grab point reads), offset by the drawer as drawn and the board's scroll — in READING order: row by row, each
 * row left to right.
 */
export function boardSpecimens(
  laid: readonly LaidSpecimen[],
  drawer: { readonly x: number; readonly y: number },
  scroll: number,
): BoardSpecimen[] {
  return laid
    .map((s) => {
      const fit = specimenFit(s.hang, s.natural);
      return {
        type: s.type,
        label: s.label,
        row: s.hang.y,
        rect: {
          x0: drawer.x + fit.x,
          y0: drawer.y + fit.y - scroll,
          x1: drawer.x + fit.x + fit.w,
          y1: drawer.y + fit.y + fit.h - scroll,
        },
      };
    })
    .sort((a, b) => a.row - b.row || a.rect.x0 - b.rect.x0);
}

/**
 * ↑ ↓ on the board (R14): the specimen nearest by its centre in the row above or below the one at `index` — never
 * wrapping (at the top or the bottom row it stays). Null with nothing focused (`index` −1) or nothing hung. ← → are
 * ICE's own walk in the lay's order (`tray.focus("prev" | "next")`, I37).
 */
export function rowStep(
  specimens: readonly BoardSpecimen[],
  index: number,
  key: "ArrowUp" | "ArrowDown",
): number | null {
  const at = specimens[index];
  if (at === undefined) return null;
  const rows = [...new Set(specimens.map((s) => s.row))].sort((a, b) => a - b);
  const to = rows[rows.indexOf(at.row) + (key === "ArrowDown" ? 1 : -1)];
  if (to === undefined) return index;
  const cx = (at.rect.x0 + at.rect.x1) / 2;
  let best = index;
  let bestD = Number.POSITIVE_INFINITY;
  specimens.forEach((s, i) => {
    if (s.row !== to) return;
    const d = Math.abs((s.rect.x0 + s.rect.x1) / 2 - cx);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
