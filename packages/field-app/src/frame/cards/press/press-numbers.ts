/**
 * THE PRESS'S NUMBERS (CS-D5 A, CS-D6 C; DESIGN.md §5 "The stock is printed, once — the press"), the round's own:
 * `card-press.test` holds them to the doc. Lengths are a card's design units (a card is 120 × 168), light directions are
 * x right, y down, z toward you. Its colours are not numbers here: they are tokens (§5 "Its colours are tokens"; item
 * 403), named below and read from the root when it prints (`press-colours.ts`).
 */

/** A card in design units: the size the prints are drawn at, before the density and the held scale. */
export const CARD_DESIGN = { width: 120, height: 168 } as const;

export const PRESS = {
  /** the mat's lamp: up and to the right, and low */
  lamp: [0.78, -0.475, 0.41],
  /** the room's soft light above you */
  room: [0.18, -0.55, 0.82],
  ambient: { day: 0.68, night: 0.55 },
  /** linen: a fine embossed weave this far apart, tipped this much */
  linen: { pitch: 1.35, tip: 0.11 },
  /** the satin varnish */
  varnish: { shininess: 34, strength: 0.22 },
  /** the cut edge: this much darker over its outer width */
  edge: { shade: 0.82, width: 1.15 },
  corner: 6,
  back: {
    inset: 5.5,
    corner: 3.6,
    rule: 2.6,
    mark: 60,
  },
} as const;

/**
 * The tokens the press prints with (DESIGN.md §5 "Its colours are tokens"): the front's paper, which is the back's margin
 * too; the back's field and its one rule; and the band pressed into the back, a little darker over its field. The mark's
 * three lights are named by `BACK_MARK.lights`, each at its place.
 */
export const PRESS_TOKENS = {
  paper: "--vf-card-press-paper",
  field: "--vf-card-back",
  rule: "--vf-card-back-rule",
  deboss: "--vf-card-press-deboss",
} as const;

/** The lamp by day, and by night over the card's own 86% (`--vf-card-dim`, which the card applies to its print). */
export const LAMP_COLOUR = {
  day: [1, 0.975, 0.93],
  night: [0.87 / 0.86, 0.86 / 0.86, 0.84 / 0.86],
} as const;
