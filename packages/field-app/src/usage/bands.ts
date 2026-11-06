import type { MeterWindow, PlanMeter } from "./meters";

// UM-1 (UM-D16 = E, "Bands", round 3, James) — THE BANDS CIRCLE'S GEOMETRY, PURE: every plan of one Agent Profile on
// one circle, an arc segment each, five hours on the inner band, the week on the outer, a model's own week as a
// hairline outside them at full size, a budget filling both. Transcribed from the ruled drawing
// (draft/profile-meters/round4/src/p3e-dials.js: `bandsOf`, `drawBands`, `meterOnArc`, `centreSvg`, `dialSvg`),
// whose detail follows the size: level 0 below 38 px, 1 to 71 (the column's 40), 2 to 149, 3 from 150 (opened).
//
// No DOM and no colour: the arcs, lit heads, notches, need threads, marks, the centre and the hot dot are numbers and
// tones, which the desktop's BandsCircle and the phone's BandsDial draw in DESIGN.md's tokens (the hot dot is
// `--vf-orange`). Angles are degrees, 0 at three o'clock and -90 at the top, clockwise; lengths are pixels (points on
// the phone) in a box `size` square.

/** The detail a circle's size allows. */
export type BandsLevel = 0 | 1 | 2 | 3;

// UM-1 (red): the geometry's rules are stubs until the green commit.
export function bandsLevel(_size: number): BandsLevel {
  return 0;
}

/** A tone, never a colour: the ink at a share, the attention orange at a share (a hot fill), white at a share (a hot
 * fill's lit head), or the attention ink of words and marks. */
export type BandsPaint =
  | { tone: "ink"; percent: number }
  | { tone: "hot"; percent: number }
  | { tone: "light"; percent: number }
  | { tone: "attention" };

export interface BandsArc {
  /** the week outside, five hours inside, both (a budget, a need, a first read), a model's week's hairline */
  band: "outer" | "inner" | "both" | "hairline";
  /** a window's track; its fill; one of the six steps of a fill's lit head; the dashed thread of a plan that needs
   * you; a first read's breath; a band with no window of its own */
  part: "track" | "fill" | "head" | "thread" | "breath" | "empty";
  r: number;
  from: number;
  to: number;
  width: number;
  cap: "round" | "butt";
  paint: BandsPaint;
  opacity: number;
  /** a dash and its gap, along the arc */
  dash?: readonly [number, number];
}

/** The time gone, across a window's band. */
export interface BandsNotch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  paint: BandsPaint;
  opacity: number;
}

/** A plan's agent mark (levels 2 and 3, outside the bands; and the centre's). */
export interface BandsMark {
  provider: string;
  /** its middle */
  x: number;
  y: number;
  size: number;
  paint: BandsPaint;
  opacity: number;
  /** what the plan needs, on a disc at its upper right: the key glyph (sign in) or "!" (retry), r × 1.32 and r × 1.25 */
  badge?: { need: "sign-in" | "retry"; x: number; y: number; r: number };
  /** an agent with more than one plan here wears the profile's glyph under its mark (an All view) */
  glyph?: { x: number; y: number; size: number; paint: BandsPaint };
}

/** One plan's segment: what it draws, and where a pointer finds it. */
export interface BandsPlan {
  key: string;
  from: number;
  span: number;
  /** another plan has the pointer */
  dim: boolean;
  arcs: BandsArc[];
  notches: BandsNotch[];
  mark?: BandsMark;
  /** the plan's pointer target, when the circle answers a pointer per plan */
  hit?: { r: number; width: number; from: number; to: number };
  /** the plan in words, for a pointer and a screen reader */
  words: string;
}

export type BandsCentreItem =
  | { kind: "glyph"; x: number; y: number; size: number; paint: BandsPaint }
  | ({ kind: "mark" } & BandsMark)
  | {
      kind: "text";
      /** the percent; "…" (a first read); "!" (needs you, small); "Sign in" or "Retry"; the window; the say line */
      role: "figure" | "ellipsis" | "bang" | "act" | "sub" | "say";
      text: string;
      /** its middle across, and its baseline */
      x: number;
      y: number;
      size: number;
      font: "display" | "sans";
      weight: number;
      paint: BandsPaint;
      /** a "%" after the figure at half its size, weight 700, 0.04 × size after it */
      percent?: true;
    };

export interface BandsGeometry {
  size: number;
  level: BandsLevel;
  /** the circle's middle, the hole the bands leave, and what it holds */
  centre: { x: number; y: number; r: number; items: BandsCentreItem[] };
  /** the plans on the circle, in the profile's order (a plan with no meter is left off) */
  plans: BandsPlan[];
  /** nothing meters and nothing needs you: one dashed ring */
  empty?: { r: number; width: number; paint: BandsPaint; dash: readonly [number, number] };
  /** some plan runs hot (Settings' pace rule): a dot at -45°, ringed in the circle's ground */
  hotDot?: { x: number; y: number; r: number; ring: number };
  /** "Usage: …" or "No meters" */
  label: string;
}

export interface BandsOptions {
  /** what the middle shows: the deciding plan (the default), the profile's glyph, or nothing (the Me menu's row) */
  centre?: "plan" | "glyph" | "none";
  /** the hot dot (a profile's circle) */
  hotDot?: boolean;
  /** the plan a pointer is on (its key): the others dim, and the middle speaks for it */
  focus?: string;
  /** each plan answers a pointer: its hit arc */
  hit?: boolean;
  /** an agent with more than one plan here wears the profile's glyph under its mark */
  crowd?: boolean;
}

/** The inner band's reach: a window of five hours or less. */
export const SHORT_WINDOW_MINUTES = 300;

/** A plan's bands (UM-D16): the inner is its first window of five hours or less; the outer its most pressed longer
 * window that meters the whole plan; the hairline a window that meters part of it (a model's week); a budget fills
 * both. A plan with no reading has none. */
export interface PlanBands {
  short?: MeterWindow;
  long?: MeterWindow;
  group?: MeterWindow;
  budget?: MeterWindow;
}

export function bandsOf(_entry: PlanMeter): PlanBands {
  return {};
}
export function windowOf(_window: MeterWindow): string {
  return "";
}
export function bandsSay(_entry: PlanMeter): { words: string; hot: boolean } {
  return { words: "", hot: false };
}
export function bandsPlanWords(_entry: PlanMeter): string {
  return "";
}
export function bandsLabel(_entries: readonly PlanMeter[]): string {
  return "";
}
export function arcPath(_c: number, _arc: Pick<BandsArc, "r" | "from" | "to">): string {
  return "";
}
export function bandsGeometry(
  size: number,
  _entries: readonly PlanMeter[],
  _options: BandsOptions = {},
): BandsGeometry {
  return { size, level: 0, centre: { x: 0, y: 0, r: 0, items: [] }, plans: [], label: "" };
}
