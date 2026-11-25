import type { HeldGlyph, MenuChoice } from "@vibecook/ice";
import type { MenuSlot } from "@vibecook/ice/desk";
import { getRendererLogger } from "../../../logging";
import { tipOf } from "./bar-model";

// THE WORDS BAR'S CONTENT (IK, 2026-11-25; DESIGN.md §8 "The words bar"; ICE I60). Pure: what the bar says while a sheet is
// being written and words on it are selected — the anchor's `words` (`WordsAnchor`: their box, their object, their range
// and the object's WORDS acts as slots). The host prints what the kind declares and adds nothing (R1, R2), reading each
// slot's own data, never its id:
//   a CHOICE act (it carries `choices` — the Pen, the Highlight) is a 44 × 32 cell showing the words' current value — the
//   chosen choice's swatch, a dot for an ink and a stripe for a highlighter, hollow when the words share none — then a ▾;
//   pressed, it swaps the bar's row for its choices (Back first, each a 32 cell, the chosen one shown on);
//   a TOGGLE (it says `pressed` — Strike, Underline) is a 32 cell, shown on while its kind says so;
//   a PLAIN act (Clear) is a 32 cell;
// in the kind's declared order, a rule where the run changes between choices, toggles and plain acts, and the desk's More
// at the end. A swatch is a PALETTE ROLE's name (`pen.felt`, `highlight.yellow`), never a colour: the ink is the desk's own
// palette's (`deskLook(theme).palette` — the pens a note is written with, the calendar's five highlighters), so the bar
// shows no colour the host never named, and a role the palette lacks draws hollow and is said once.

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
  /** Its ink, CSS, as the desk's palette names it — undefined: HOLLOW. */
  readonly ink: string | undefined;
  /** The palette role it was asked by; absent for a hollow that names none (no shared value, or a choice like None). */
  readonly role?: string;
}

/** The palette's families of roles, by the role's first word: a pen's ink is a dot, a highlighter's a stripe. */
const FAMILIES: Readonly<
  Record<
    string,
    {
      readonly shape: SwatchShape;
      readonly inks: (
        p: SwatchPalette,
      ) => Readonly<Record<string, { readonly css: string }>> | undefined;
    }
  >
> = {
  pen: { shape: "dot", inks: (p) => p.pens },
  highlight: { shape: "stripe", inks: (p) => p.calendars?.highlighters },
};

/** The family a role names (`pen.felt` → pen), or undefined. */
const familyOf = (role: string) => {
  const dot = role.indexOf(".");
  return dot < 0 ? undefined : FAMILIES[role.slice(0, dot)];
};

/** A role's swatch from the desk's palette: its family's shape, its ink — hollow (`ink` undefined) where the palette names
 * no such role; a role of no family the bar knows is a hollow dot. */
export function swatchOf(role: string, palette: SwatchPalette): Swatch {
  const family = familyOf(role);
  if (family === undefined) return { shape: "dot", ink: undefined, role };
  const name = role.slice(role.indexOf(".") + 1);
  const inks = family.inks(palette);
  const css = inks !== undefined && Object.hasOwn(inks, name) ? inks[name]?.css : undefined;
  return {
    shape: family.shape,
    ink: css === undefined || css.length === 0 ? undefined : css,
    role,
  };
}

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
  /** The desk's More: drawn, and WAITING — its rows (Cut · Copy · Paste | Select all) need the editor's own command, which
   * this build of ICE does not have (`DeskEditor.command`, petition I60's next slice). */
  | { readonly kind: "more"; readonly label: string; readonly tip: string; readonly waits: true };

/** The words row's toolbar, by name (the objects' row is "Selection" — R9). */
export const WORDS_TOOLBAR = "Words";

/** The desk's More on the words row. */
export const WORDS_MORE: WordsCell = { kind: "more", label: "More", tip: "More", waits: true };

// ── THE ONE ADAPTER over ICE's slot shape (IK, 2026-11-25). Nothing else in the bar reads a slot's `choices`, `chosen`,
// `pressed`, `swatch` or `enabled`: when ICE's act shape moves (a choice's `current` in place of the slot's `chosen`, a
// swatch a CSS colour the kind says, a slot's `enabled`), `readSlot` alone changes. A swatch is what it ASKS for — a palette
// role today, a colour after — with the shape it is drawn in; `swatchFor` draws either.

/** What a choice's swatch asks for: a palette ROLE's name (ICE I60 today), or a CSS colour its kind says. */
export type SwatchAsk =
  | { readonly shape: SwatchShape; readonly role: string }
  | { readonly shape: SwatchShape; readonly css: string };

/** One of a slot's choices, as the adapter reads it. */
export interface SlotChoice {
  readonly id: string;
  readonly label: string;
  readonly glyph: HeldGlyph | undefined;
  readonly swatch: SwatchAsk | undefined;
  /** It is the words' current choice. */
  readonly current: boolean;
}

/** A words act's slot as the bar reads it: its kind of cell, its state now, its choices. */
export interface WordsSlot {
  readonly id: string;
  readonly label: string;
  readonly glyph: HeldGlyph | undefined;
  readonly kind: "choice" | "toggle" | "act";
  /** A toggle's state now. */
  readonly pressed: boolean;
  /** False: its kind says it is not to be used now — drawn dim, `aria-disabled`, its press nothing. */
  readonly enabled: boolean;
  readonly choices: readonly SlotChoice[];
}

/** The shape a palette role is drawn in: its family's (a pen's dot, a highlighter's stripe); a role of no family a dot. */
const roleShape = (role: string): SwatchShape => familyOf(role)?.shape ?? "dot";

/** THE ADAPTER: ICE's `MenuSlot` (I60's shape) read as the bar's slot. A slot's `enabled: false` is read where a build
 * carries it (tolerant: the I60 type has none). */
export function readSlot(slot: MenuSlot): WordsSlot {
  const offered: readonly MenuChoice[] = slot.choices ?? [];
  const enabled = (slot as { readonly enabled?: unknown }).enabled !== false;
  return {
    id: slot.id,
    label: slot.label,
    glyph: slot.glyph,
    kind: offered.length > 0 ? "choice" : slot.pressed !== undefined ? "toggle" : "act",
    pressed: slot.pressed === true,
    enabled,
    choices: offered.map((choice) => ({
      id: choice.id,
      label: choice.label,
      glyph: choice.glyph,
      swatch:
        choice.swatch === undefined
          ? undefined
          : { shape: roleShape(choice.swatch), role: choice.swatch },
      current: slot.chosen === choice.id,
    })),
  };
}

/** A swatch as drawn, from what it asks for: a role through the desk's palette, a colour as said. */
export function swatchFor(ask: SwatchAsk, palette: SwatchPalette): Swatch {
  if ("css" in ask) return { shape: ask.shape, ink: ask.css.length === 0 ? undefined : ask.css };
  return { ...swatchOf(ask.role, palette), shape: ask.shape };
}

/** The shape a choice act's choices are drawn in: their first swatch's — undefined when none carries one. */
const shapeOfChoices = (slot: WordsSlot): SwatchShape | undefined =>
  slot.choices.find((c) => c.swatch !== undefined)?.swatch?.shape;

/** A choice's face: its swatch; else its glyph; else, among swatches, its family's hollow (None); else its label. */
function choiceFace(
  choice: SlotChoice,
  shape: SwatchShape | undefined,
  palette: SwatchPalette,
): WordsFace {
  if (choice.swatch !== undefined)
    return { by: "swatch", swatch: swatchFor(choice.swatch, palette) };
  if (choice.glyph !== undefined) return { by: "glyph", glyph: choice.glyph };
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
      tip: tipOf(slot.label),
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

/** The roles a row's swatches named that the desk's palette lacks — a kind's declaration the host cannot draw. */
export function missingSwatches(cells: readonly WordsCell[]): string[] {
  const roles = new Set<string>();
  const seen = (face: WordsFace): void => {
    if (face.by === "swatch" && face.swatch.ink === undefined && face.swatch.role !== undefined)
      roles.add(face.swatch.role);
  };
  for (const cell of cells) {
    if (cell.kind !== "choice") continue;
    seen(cell.face);
    for (const choice of cell.choices) seen(choice.face);
  }
  return [...roles];
}

/** The roles already said missing (said once: a kind's declaration error, not a look). */
const saidMissing = new Set<string>();

/** Say once each swatch role a kind named that the desk's palette does not hold. */
export function sayMissingSwatches(cells: readonly WordsCell[]): void {
  for (const role of missingSwatches(cells)) {
    if (saidMissing.has(role)) continue;
    saidMissing.add(role);
    getRendererLogger()
      .child({ component: "canvas.desk.bar" })
      .warn(
        "renderer.desk.swatch-missing",
        "A kind named a swatch the desk's palette does not hold",
        {
          swatch: role,
        },
      );
  }
}

/** Test seam: no role said yet. */
export function resetMissingSwatchesForTest(): void {
  saidMissing.clear();
}
