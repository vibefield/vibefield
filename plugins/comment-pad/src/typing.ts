// TYPING ON THE PAD IS THE KIT'S (IK, 2026-11-25 — ICE petition I60, `inkTyping`, `inkPart`, `inkActs`): the pad declares
// its writing and the desk's kit gives it the rest. Its typing is a DRAFT the kit holds while the desk's one editor is on a
// pad — drawn at once by the pad's writing (the sink below), never a live write — landed as ONE undoable transaction on
// the pad's `ink` cell (`{ text, seeds, marks }`, one cell so a text never pairs with another writer's seeds or marks)
// through the desk's writer's gate when the typing ends (the editor's 1 s without input, Escape, a blur, another part
// taking the editor); a draft that nets to nothing — the words, the hand and the marks as it found them — lands nothing; a
// read-only document opens none. ⌘Z undoes a typing, never a keystroke; a mark made on the words is one step of its own.
//
// What is the pad's own, and lives here: the MARKS its words take (every one the kit has — a pen, a highlighter, a line
// through, a line under), the same list for its written part and its acts; its ACTS (the words bar's Pen, Highlight,
// Strike, Underline and Clear); and its SINK — what its writing is told as the draft, the caret and the selection move.

import {
  INK_FIELDS,
  type InkField,
  type InkSink,
  inkActs,
  type MenuActionDef,
} from "@vibefield/plugin-sdk/desk";
import type { PadWriting } from "./writing";

/** The marks a pad's words take: all four of the kit's (its written part and its acts are given the same list). */
export const PAD_MARKS: readonly InkField[] = INK_FIELDS;

/** The pad's acts on its selected words — the words bar's (DESIGN.md §8): Pen ▾, Highlight ▾, Strike, Underline, Clear. */
export const padActs = (): MenuActionDef[] => inkActs({ marks: PAD_MARKS });

/** What the pad's writing is told by the kit's typing and lease: the draft (and how its glyphs came), the caret, the selection. */
export function padSink(writing: () => PadWriting | undefined): InkSink {
  return {
    draft: (e, ink, arrived) => writing()?.setDraft(e, ink, arrived),
    caret: (e, index) => writing()?.setCaret(e, index),
    selection: (e, from, to) => writing()?.setSelection(e, from, to),
  };
}
