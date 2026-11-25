import type { ActChoice, HeldGlyph } from "@vibecook/ice";
import type { MenuSlot } from "@vibecook/ice/desk";
import { tipOf } from "./bar-model";

// THE WORDS BAR'S CONTENT (IK, 2026-11-25; DESIGN.md §8 "The words bar"; ICE I60 on I61/I62's act shape). Pure: what the bar
// says while a sheet is being written and words on it are selected — the anchor's `words` (`WordsAnchor`: their box, their
// object, their range and the object's WORDS acts as slots). The host prints what the kind declares and adds nothing (R1, R2),
// reading each slot's own data, never its id:
//   a CHOICE act (it carries `choices` — the Pen, the Highlight) is a 44 × 32 cell showing the words' current value — the
//   `current` choice's swatch, a dot for a pen and a stripe for a highlighter, hollow when the words share none — then a ▾;
//   pressed, it swaps the bar's row for its choices (Back first, each a 32 cell, the current one shown on);
//   a TOGGLE (it says `pressed` — Strike, Underline) is a 32 cell, shown on while its kind says so;
//   a PLAIN act (Clear) is a 32 cell;
// in the kind's declared order, a rule where the run changes between choices, toggles and plain acts, and the desk's More
// at the end. A SWATCH is the CSS colour the kind says (`inkActs({ colour })`); a kind that says none (ICE's own note) has its
// pen's and highlighter's choices drawn from the desk's own palette by the choice's NAME (a kit pen's, a kit highlighter's —
// `deskLook(theme).palette`). Dot or stripe is read from the act's GLYPH — the pen's or the highlighter's — never its id.

/** The desk's palette as the swatches read it (ICE's `deskPalette`, narrowed): the pens' inks and the highlighters'. */
export interface SwatchPalette {
  readonly pens?: Readonly<Record<string, { readonly css: string }>>;
  readonly calendars?: {
    readonly highlighters?: Readonly<Record<string, { readonly css: string }>>;
  };
}

/** How a swatch is drawn: an ink's DOT (a pen), or a highlighter's STRIPE. */
export type SwatchShape = "dot" | "stripe";

/** A swatch as the bar draws it. */
export interface Swatch {
  readonly shape: SwatchShape;
  /** Its ink, CSS — undefined: HOLLOW (no colour said or named: None, or a name the palette lacks). */
  readonly ink: string | undefined;
}

/** The act glyphs that say a choice act's choices are inks (the kit's and §13's names): the pen's dots, the highlighter's
 * stripes. */
const INK_GLYPHS: Readonly<Record<string, SwatchShape>> = { pen: "dot", highlighter: "stripe" };

/** The shape an act's glyph says its choices are drawn in — undefined for any other glyph (or a drawing). */
const inkShapeOf = (glyph: HeldGlyph | undefined): SwatchShape | undefined =>
  typeof glyph === "string" && Object.hasOwn(INK_GLYPHS, glyph) ? INK_GLYPHS[glyph] : undefined;

/** The desk palette's inks a shape draws by name: a dot from its pens, a stripe from its highlighters. */
const inksOf = (shape: SwatchShape, palette: SwatchPalette) =>
  shape === "dot" ? palette.pens : palette.calendars?.highlighters;

/** What a cell shows: a swatch, a glyph (by §13's table, the bar's one path renderer for a kind's own drawing — R2), or its
 * label alone (R3). */
export type WordsFace =
  | { readonly by: "swatch"; readonly swatch: Swatch }
  | { readonly by: "glyph"; readonly glyph: HeldGlyph }
  | { readonly by: "label" };

/** One of a choice act's choices, as its row shows it. */
export interface WordsChoice {
  readonly id: string;
  /** Its name: its tooltip and accessible name. */
  readonly label: string;
  readonly face: WordsFace;
  /** The words' current choice: shown on, `aria-pressed`. */
  readonly on: boolean;
}

export type WordsCell =
  /** A choice act (Pen ▾, Highlight ▾): the words' current value, then a ▾; pressed, the row swaps for its choices. */
  | {
      readonly kind: "choice";
      readonly id: string;
      readonly label: string;
      readonly tip: string;
      /** Its kind says it is not to be used now: dim, `aria-disabled`, its press nothing. */
      readonly disabled: boolean;
      readonly face: WordsFace;
      readonly choices: readonly WordsChoice[];
    }
  /** A toggle (Strike, Underline): shown on while its kind says so (`aria-pressed`); pressed again it takes it away. */
  | {
      readonly kind: "toggle";
      readonly id: string;
      readonly label: string;
      readonly tip: string;
      /** Its kind says it is not to be used now: dim, `aria-disabled`, its press nothing. */
      readonly disabled: boolean;
      readonly glyph: HeldGlyph | undefined;
      readonly on: boolean;
    }
  /** A plain act (Clear). */
  | {
      readonly kind: "act";
      readonly id: string;
      readonly label: string;
      readonly tip: string;
      /** Its kind says it is not to be used now: dim, `aria-disabled`, its press nothing. */
      readonly disabled: boolean;
      readonly glyph: HeldGlyph | undefined;
    }
  | { readonly kind: "rule" }
  /** The desk's More: it grows the bar into the words' menu, Cut · Copy · Paste | Select all (bar-words-more.ts; V5b). */
  | { readonly kind: "more"; readonly label: string; readonly tip: string };

/** The words row's toolbar, by name (the objects' row is "Selection" — R9). */
export const WORDS_TOOLBAR = "Words";

/** The desk's More on the words row. */
export const WORDS_MORE: WordsCell = { kind: "more", label: "More", tip: "More" };

// ── THE ONE ADAPTER over ICE's slot shape (IK, 2026-11-25; re-shaped to I61/I62's acts, round two). Nothing else in the bar
// reads a slot's `choices`, `current`, `pressed`, `swatch`, `enabled` or `keys`: when ICE's act shape moves, `readSlot`
// alone changes. A swatch is what it ASKS for — a colour its kind says, or a kit ink's name the desk's palette draws — with
// the shape it is drawn in; `swatchFor` draws either.

/** What a choice's swatch asks for: the CSS colour its kind says, or a kit pen's or highlighter's NAME (the choice's id)
 * the desk's palette draws — the shape from the act's glyph. */
export type SwatchAsk =
  | { readonly shape: SwatchShape; readonly css: string }
  | { readonly shape: SwatchShape; readonly name: string };

/** One of a slot's choices, as the adapter reads it. */
export interface SlotChoice {
  readonly id: string;
  readonly label: string;
  readonly swatch: SwatchAsk | undefined;
  /** It is the words' current choice (`ActChoice.current`). */
  readonly current: boolean;
}

/** A words act's slot as the bar reads it: its kind of cell, its state now, its choices. */
export interface WordsSlot {
  readonly id: string;
  readonly label: string;
  readonly glyph: HeldGlyph | undefined;
  readonly kind: "choice" | "toggle" | "act";
  /** The key that does the same, as its kind declares it for the tip ("⇧⌘X"); the bar binds nothing (V5b). */
  readonly keys: string | undefined;
  /** A toggle's state now. */
  readonly pressed: boolean;
  /** False: its kind says it is not to be used now (I61) — drawn dim, `aria-disabled`, its press nothing. */
  readonly enabled: boolean;
  readonly choices: readonly SlotChoice[];
}

/** A choice's swatch: the colour its kind says; else, under the pen's or the highlighter's glyph, its name for the desk's
 * palette; else none. A colour under any other glyph is a dot. */
function askOf(choice: ActChoice, ink: SwatchShape | undefined): SwatchAsk | undefined {
  if (choice.swatch !== undefined && choice.swatch.length > 0)
    return { shape: ink ?? "dot", css: choice.swatch };
  return ink === undefined ? undefined : { shape: ink, name: choice.id };
}

/** THE ADAPTER: ICE's `MenuSlot` (I61/I62's shape, with I60's `pressed`) read as the bar's slot. */
export function readSlot(slot: MenuSlot): WordsSlot {
  const offered: readonly ActChoice[] = slot.choices ?? [];
  const ink = inkShapeOf(slot.glyph);
  return {
    id: slot.id,
    label: slot.label,
    glyph: slot.glyph,
    keys: slot.keys === undefined || slot.keys.length === 0 ? undefined : slot.keys,
    kind: offered.length > 0 ? "choice" : slot.pressed !== undefined ? "toggle" : "act",
    pressed: slot.pressed === true,
    enabled: slot.enabled !== false,
    choices: offered.map((choice) => ({
      id: choice.id,
      label: choice.label,
      swatch: askOf(choice, ink),
      current: choice.current === true,
    })),
  };
}

/** A swatch as drawn, from what it asks for: a colour as said; a name through the desk's palette — hollow where it holds
 * no such ink (None, or a name it lacks). */
export function swatchFor(ask: SwatchAsk, palette: SwatchPalette): Swatch {
  if ("css" in ask) return { shape: ask.shape, ink: ask.css };
  const inks = inksOf(ask.shape, palette);
  const css = inks !== undefined && Object.hasOwn(inks, ask.name) ? inks[ask.name]?.css : undefined;
  return { shape: ask.shape, ink: css === undefined || css.length === 0 ? undefined : css };
}

/** The shape a choice act's choices are drawn in: their first swatch's — undefined when none carries one. */
const shapeOfChoices = (slot: WordsSlot): SwatchShape | undefined =>
  slot.choices.find((c) => c.swatch !== undefined)?.swatch?.shape;

/** A choice's face: its swatch; else, among swatches, a hollow of their shape; else its label. */
function choiceFace(
  choice: SlotChoice,
  shape: SwatchShape | undefined,
  palette: SwatchPalette,
): WordsFace {
  if (choice.swatch !== undefined)
    return { by: "swatch", swatch: swatchFor(choice.swatch, palette) };
  if (shape !== undefined) return { by: "swatch", swatch: { shape, ink: undefined } };
  return { by: "label" };
}

/** A choice act's cell face — the words' current value: the current choice's face; with none shared, its family's hollow
 * swatch, else the act's own glyph, else its label. */
function currentFace(
  slot: WordsSlot,
  choices: readonly WordsChoice[],
  shape: SwatchShape | undefined,
): WordsFace {
  const current = choices.find((c) => c.on);
  if (current !== undefined && current.face.by !== "label") return current.face;
  if (shape !== undefined) return { by: "swatch", swatch: { shape, ink: undefined } };
  if (slot.glyph !== undefined) return { by: "glyph", glyph: slot.glyph };
  return { by: "label" };
}

/**
 * The words row's cells (DESIGN.md §8 "The words bar" — Order): the kind's words acts in their declared order — each a
 * choice act, a toggle or a plain act by its own data (`readSlot`) — a rule where the run changes between them, and the
 * desk's More at the end. For the ink acts: Pen ▾ · Highlight ▾ · rule · Strike · Underline · rule · Clear · More.
 */
export function wordsCells(menu: readonly MenuSlot[], palette: SwatchPalette): WordsCell[] {
  const cells: WordsCell[] = [];
  let last: WordsSlot["kind"] | undefined;
  for (const slot of menu.map(readSlot)) {
    if (last !== undefined && slot.kind !== last) cells.push({ kind: "rule" });
    last = slot.kind;
    const base = {
      id: slot.id,
      label: slot.label,
      tip: tipOf(slot.label, slot.keys),
      disabled: !slot.enabled,
    };
    if (slot.kind === "choice") {
      const shape = shapeOfChoices(slot);
      const choices = slot.choices.map(
        (choice): WordsChoice => ({
          id: choice.id,
          label: choice.label,
          face: choiceFace(choice, shape, palette),
          on: choice.current,
        }),
      );
      cells.push({ kind: "choice", ...base, face: currentFace(slot, choices, shape), choices });
    } else if (slot.kind === "toggle") {
      cells.push({ kind: "toggle", ...base, glyph: slot.glyph, on: slot.pressed });
    } else {
      cells.push({ kind: "act", ...base, glyph: slot.glyph });
    }
  }
  cells.push(WORDS_MORE);
  return cells;
}

/** What the bar says of the words acts, as one key (a change re-renders it; the same slots never do). */
export const wordsKey = (menu: readonly MenuSlot[]): string => JSON.stringify(menu);
