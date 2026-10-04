// The COMMENT PAD's law as numbers — pure: no GPU, no DOM. A pad of comments lying on the desk: a block of
// writing paper under a gummed binding strip, its top sheet ruled, a few sheets' edges showing below it,
// lifting and casting its shadow by the desk's ONE PHYSICS (the kit's `PHYSICS`, by name — the note, the
// notebook and the board agree with it). Its words are written in the desk's HAND (the kit's `HAND`, a
// little smaller: a pad holds lines of comments, not a note's few words) through the host's text raster.
// Lengths are world units (CSS px at zoom 1); "pad units" are the same lengths from the top sheet's
// top-left, before the lift's scale.

import { HAND, type HandLaw, PHYSICS } from "@vibefield/plugin-sdk/desk";
import { PAD_SIZE } from "./ids";

export const PAD = {
  /** The pad's size as laid (ids.ts — the manifest's too). */
  size: PAD_SIZE,
  /** The die-cut corner. */
  radius: 3,
  /** The gummed binding strip across the top, pad units. */
  binding: 24,
  /** The sheets under the top one whose edges show along the bottom, and how far each shows. */
  sheets: 3,
  sheetStep: 1.5,
  /** The block's thickness off the desk — what its shadow is cast from and the gobo is sampled at. */
  thickness: 3,
  /** The writing box inside the top sheet, below the binding: its insets, pad units. */
  inset: { left: 30, right: 12, top: 8, bottom: 10 },
  /** The red margin rule, pad units from the left edge (the writing starts right of it). */
  marginRule: 24,
  /** The ruled lines' half width, pad units. */
  ruleHalf: 0.45,
  /** How far a HELD pad rises and the scale it reads at — the one physics's. */
  lift: PHYSICS.lift,
  /** The contact shadow — the one physics's penumbra. */
  shadow: PHYSICS.shadow,
  /** The paper's fibre: ± this on the albedo. */
  grain: 2 / 255,
  /** The caret the pass draws while the desk's editor is on the pad (the editor's own is invisible): pad units wide. */
  caret: { width: 1.4 },
  /** The ink's raster density, texels per pad unit — the rungs a zoom picks among (a power of two each). */
  band: { min: 0.5, max: 4 },
} as const;

/** The pad's numbers (`PAD`) — the plugin's unless a test says. */
export type PadLaw = typeof PAD;

/** The hand the pad is written in: the desk's (kit `HAND`), smaller and with room between the lines for the rules. */
export const PAD_HAND: HandLaw = {
  ...HAND,
  size: 17,
  lineHeight: 1.4,
  pad: 0,
};

/** The face the hand is laid in — the desk's hand (`PEN_FACES.caveat`; the product ships the file). */
export const PAD_FACE = "caveat";

/** The pen's spread around each glyph, pad units (the raster's faint stroke under the face). */
export const PAD_BLEED = 0.25;

/** The writing box in pad units: where the hand's layout is laid and its raster covers. */
export interface PadBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The writing box of a pad `w × h` pad units under `law`. */
export function writingBox(w: number, h: number, law: PadLaw = PAD): PadBox {
  const x = law.inset.left;
  const y = law.binding + law.inset.top;
  return {
    x,
    y,
    w: Math.max(1, w - law.inset.left - law.inset.right),
    h: Math.max(1, h - y - law.inset.bottom),
  };
}

/** The raster density for a zoom × dpr: the smallest power of two at or past the screen's, within the law's rungs. */
export function bandFor(zoomDpr: number, law: PadLaw = PAD): number {
  if (!(zoomDpr > 0) || !Number.isFinite(zoomDpr)) return law.band.min;
  const b = 2 ** Math.ceil(Math.log2(zoomDpr));
  return Math.min(law.band.max, Math.max(law.band.min, b));
}

/**
 * How far the pad's drawing reaches past its rect, world units: its shadow at full lift (cast along the lamp's capped slope and
 * blurred by its height), the lower sheets' edges, and the held scale's growth.
 */
export function padReach(law: PadLaw = PAD): number {
  const h = law.thickness + law.lift.height;
  const shadow = law.shadow.slopeMax * h + 2.5 * (law.shadow.sigma + law.shadow.sigmaPerUnit * h);
  const held = (Math.max(law.size.w, law.size.h) * (law.lift.scale - 1)) / 2;
  return shadow + law.sheets * law.sheetStep + held;
}
