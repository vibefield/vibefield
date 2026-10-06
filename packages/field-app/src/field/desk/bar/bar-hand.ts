import type { HeldGlyph } from "@vibecook/ice";
import type { SelectionAnchor } from "@vibecook/ice/desk";
import { tipOf } from "./bar-model";

/** The hand as the anchor carries it (ICE's `HeldAnchor` — named by its docs, reached through the anchor's `held`:
 * `@vibecook/ice/desk` exports `SelectionAnchor` and not the two names, so they are read off it here). */
export type HeldAnchor = NonNullable<SelectionAnchor["held"]>;
/** One of the hand's slots (ICE's `HeldSlot`): id, label, kind, hint, glyph, swatch — plain data. */
export type HeldSlot = HeldAnchor["tools"][number];

// THE TOOLS IN HAND (DK-12; DESIGN.md §8 "Tools in hand"; MC-D4, MC-D9; R2, R13; ICE I20, I22). Pure: what the bar
// says while an object is IN HAND — the anchor's `held` (`HeldAnchor`: the kind's slots, the mode in hand, its word)
// — in the canon's order: Send to… · rule · the kind's tools · the readout · rule · Done. The tools are the anchor's
// slots IN THEIR DECLARED ORDER, never regrouped (R13), a 6 gap where the run changes between PAGES, INKS and TOOLS;
// each is used through `ops.useHeldTool(id)`. What a slot looks like is read off its data alone:
//   a MODE WITH A SWATCH (ICE's pens, the whiteboard's markers) is a DOT in the slot's own ink;
//   a MODE WITHOUT ONE (the eraser, the calendar's pen) a 32 cell, the inverted solid while it is the one in hand;
//   an ACTION (undo, today, a page) a 32 cell;
//   a slot with no `kind` (declared only) waits, faint by ink.
// Its glyph is drawn by §13's table through the bar's one path renderer (KindGlyph); a slot with neither a glyph nor
// a swatch shows its label (R3). The readout is ONE slot after the tools — the string carries no position (R13) — and
// a kind that says none shows none. Done puts it down (`ops.putDown()`).

/** A slot's run — where the 6 gap falls (§8: "where the run changes between pages, inks and tools"). */
export type HandRun = "page" | "ink" | "tool";

/** What a slot looks like on the bar. */
export type HandLook = "dot" | "mode" | "action" | "faint";

export type HandCell =
  /** Send to… — the bar's one word, as on the bar over a selection; DK-14 makes it draft (here it waits). */
  | { readonly kind: "send"; readonly label: string; readonly tip: string }
  | { readonly kind: "rule"; readonly at: "lead" | "end" }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly label: string;
      /** The tooltip the frame's way: the label and the slot's hint ("Felt pen  1", "Eraser  E"). */
      readonly tip: string;
      readonly look: HandLook;
      readonly glyph: HeldGlyph | undefined;
      /** A dot's ink (CSS, the kind's own look). */
      readonly swatch: string | undefined;
      /** The mode in hand (`HeldAnchor.active`): the dot's ring, the cell's inverted solid, `aria-pressed`. */
      readonly on: boolean;
      readonly run: HandRun;
      /** The run changed here: a 6 gap before it (the row's 2 and 4 of its own). */
      readonly gap: boolean;
    }
  /** The kind's word in hand (I22 — "Page 1", "September", the clock's time). */
  | { readonly kind: "readout"; readonly text: string }
  /** Done — VibeField's primary at 32, putting the object down. */
  | { readonly kind: "done"; readonly label: string; readonly tip: string };

/** ICE's names for a page or a month turned (§13: `chevron`, turned 180 to go back) — the slots that are PAGES. */
const PAGE_GLYPHS: ReadonlySet<string> = new Set(["chevron", "chevron-left"]);

/** A slot's run: an INK is a mode with a swatch; a PAGE wears §13's chevron (a page or a month); the rest are TOOLS. */
export function runOf(slot: HeldSlot): HandRun {
  if (slot.kind === "mode" && slot.swatch !== undefined) return "ink";
  if (typeof slot.glyph === "string" && PAGE_GLYPHS.has(slot.glyph)) return "page";
  return "tool";
}

/** A slot's look, from its data alone (§8 "Tools in hand"). */
export function lookOf(slot: HeldSlot): HandLook {
  if (slot.kind === undefined) return "faint";
  if (slot.kind === "mode") return slot.swatch !== undefined ? "dot" : "mode";
  return "action";
}

/** Done's tooltip: the act and its key, the frame's way (§8: "Put it down  Esc"). */
export const DONE_TIP = tipOf("Put it down", "Esc");

/**
 * The bar's cells in hand, in the canon's order: Send to… · rule · the kind's tools (declared order, a gap where the
 * run changes) · the readout (when the kind says one) · rule · Done.
 */
export function handCells(held: Pick<HeldAnchor, "tools" | "active" | "readout">): HandCell[] {
  const cells: HandCell[] = [
    { kind: "send", label: "Send to…", tip: "Send to… — next" },
    { kind: "rule", at: "lead" },
  ];
  let last: HandRun | undefined;
  for (const slot of held.tools) {
    const run = runOf(slot);
    const look = lookOf(slot);
    cells.push({
      kind: "tool",
      id: slot.id,
      label: slot.label,
      tip: tipOf(slot.label, slot.hint),
      look,
      glyph: slot.glyph,
      swatch: look === "dot" ? slot.swatch : undefined,
      on: slot.kind === "mode" && slot.id === held.active,
      run,
      gap: last !== undefined && run !== last,
    });
    last = run;
  }
  if (held.readout !== undefined && held.readout.length > 0)
    cells.push({ kind: "readout", text: held.readout });
  cells.push({ kind: "rule", at: "end" }, { kind: "done", label: "Done", tip: DONE_TIP });
  return cells;
}

/** The hand's slots as one key — what the bar SAYS of them (a change re-renders it; the same slots never do). */
export function slotsKey(tools: readonly HeldSlot[]): string {
  return tools
    .map(
      (t) =>
        `${t.id}\u0000${t.label}\u0000${t.kind ?? ""}\u0000${t.hint ?? ""}\u0000${JSON.stringify(t.glyph ?? null)}\u0000${t.swatch ?? ""}`,
    )
    .join("\u0001");
}
