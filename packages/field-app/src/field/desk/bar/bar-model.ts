import type { HeldGlyph } from "@vibecook/ice";
import type { MenuSlot } from "@vibecook/ice/desk";
import type { GlyphName } from "@vibefield/design-kit/glyphs";
import { eyebrowOf, type ObjectWords } from "../desk-object-words";

// THE BAR'S CONTENT (DK-11; DESIGN.md §8 "The selection bar" — Order, Keyboard; "The bar grown" — the order
// nearest first, the eyebrow; R1, R3, R4, R10, R11, R23 reversed, DK-D24, DK-D29; HN-D3). Pure: what the bar and its
// grown menu show for a selection, from the anchor's facts (`count`, `locked`, the kinds' acts `menu`) and the
// host's own read of the selected objects (their types' words, whether the one selected opens). The host prints
// what a kind declares and adds nothing; a kind's act prints NO key on this build (R1 — its declared keys are
// ICE's demo's), while the DESK's acts print theirs (DK-D24; ⇧⌘L is the desk's, ICE's default keymap's — R23; ⌘C
// the desk's Copy, HN-D3).

/** The desk's keys as this platform spells them (the frame's way, FR-5: said, never a cap). */
export type DeskKeys = "mac" | "other";

/** The desk's acts that have a key. */
type KeyedAct = "copy" | "duplicate" | "tape" | "delete" | "open";

const KEYS = {
  mac: { copy: "⌘C", duplicate: "⌘D", tape: "⇧⌘L", delete: "⌫", open: "↩" },
  other: {
    copy: "Ctrl+C",
    duplicate: "Ctrl+D",
    tape: "Ctrl+Shift+L",
    delete: "Delete",
    open: "Enter",
  },
} as const satisfies Record<DeskKeys, Record<KeyedAct, string>>;

/** The tooltip the frame's way: the act, two spaces, its key ("Tape it down  ⇧⌘L"). */
export const tipOf = (label: string, key?: string): string =>
  key === undefined ? label : `${label}  ${key}`;

/** Copy — the bar's one word (HN-D3): the selection dealt into the hand as ONE card. Plain "Copy" for one object or
 * several, as every Copy is — the count is the menu's eyebrow's ("2 OBJECTS"), and the card's own title. */
export const COPY_LABEL = "Copy";

/** Copy's tooltip, its key the desk's (⌘C over the desk; product-chords' `desk-copy`): "Copy  ⌘C". */
export const copyTip = (keys: DeskKeys): string => tipOf(COPY_LABEL, KEYS[keys].copy);

/** What the host read of the selection — the anchor's facts and its own (the doors, §8). */
export interface SelectionFacts {
  readonly count: number;
  /** Every selected object is taped (the anchor's `locked`). */
  readonly locked: boolean;
  /** The kinds' acts every selected object's type declares (the anchor's `menu`, K8a). */
  readonly menu: readonly MenuSlot[];
  /** The selected objects' types' words, one per type, in selection order (desk-object-words.ts). */
  readonly words: readonly ObjectWords[];
  /** Exactly one object selected whose type opens (`catalog.widget(type).openable`), not a container (R4). */
  readonly openable: boolean;
  /** The comment pad's kind is drawn here: the Comment row can lay one (DK-8's pad, DK-D24). */
  readonly commentable: boolean;
}

/** The desk's own four acts on the bar. */
export type DeskAct = "duplicate" | "tape" | "more" | "delete";

export type BarCell =
  /** Copy — the bar's one word: the selection dealt into the hand as ONE card (HN-D3). */
  | { readonly kind: "copy"; readonly label: string; readonly tip: string }
  | { readonly kind: "rule"; readonly at: "lead" | "end" }
  /** A kind's act: its glyph by §13's table, or its label alone (R3); its label is its tip — no key (R1). */
  | {
      readonly kind: "act";
      readonly id: string;
      readonly label: string;
      readonly glyph: HeldGlyph | undefined;
    }
  /** A missing face selected: the type's name and its word where the kind's acts would stand — a label. */
  | { readonly kind: "words"; readonly label: string }
  | {
      readonly kind: "desk";
      readonly act: DeskAct;
      readonly label: string;
      readonly glyph: GlyphName;
      readonly tip: string;
    };

/** The first selected type the desk draws as missing — the bar names it where the acts would stand. */
export const missingOf = (f: SelectionFacts): ObjectWords | undefined =>
  f.words.find((w) => w.state !== null);

/**
 * The bar's cells, in the canon's order: Copy · rule · the kind's acts · Duplicate · Tape it down · More · rule
 * · Delete. Taped (every selected object taped): no Duplicate, and the tape act becomes "Lift the tape", wearing
 * `lift` — an act whose name changes, never a toggle (R10). A missing face selected: its name and word where the
 * kind's acts would stand, and Duplicate still offered (it duplicates the data — R11).
 */
export function barCells(f: SelectionFacts, keys: DeskKeys): BarCell[] {
  const k = KEYS[keys];
  const cells: BarCell[] = [
    { kind: "copy", label: COPY_LABEL, tip: copyTip(keys) },
    { kind: "rule", at: "lead" },
  ];
  const missing = missingOf(f);
  if (missing !== undefined) cells.push({ kind: "words", label: missing.label });
  else
    for (const act of f.menu)
      cells.push({ kind: "act", id: act.id, label: act.label, glyph: act.glyph });
  if (!f.locked) {
    cells.push({
      kind: "desk",
      act: "duplicate",
      label: "Duplicate",
      glyph: "duplicate",
      tip: tipOf("Duplicate", k.duplicate),
    });
  }
  const tape = f.locked ? "Lift the tape" : "Tape it down";
  cells.push(
    {
      kind: "desk",
      act: "tape",
      label: tape,
      glyph: f.locked ? "lift" : "tape",
      tip: tipOf(tape, k.tape),
    },
    { kind: "desk", act: "more", label: "More", glyph: "ellipsis", tip: "More" },
    { kind: "rule", at: "end" },
    {
      kind: "desk",
      act: "delete",
      label: "Delete",
      glyph: "trash",
      tip: tipOf("Delete", k.delete),
    },
  );
  return cells;
}

/** One row of the grown menu: its label and, at its end, its key (none for a kind's act — R1). */
export interface MenuRow {
  /** `act:<id>` for a kind's act; else open · comment · copy · duplicate · front · back · cleanup · tape · delete. */
  readonly id: string;
  readonly label: string;
  readonly key?: string;
  /** A row that waits, and why: drawn, never taken (none does on this build). */
  readonly waits?: string;
  /** Delete: armed red under the pointer. */
  readonly danger?: boolean;
}

/**
 * The grown menu's rows in their groups, NEAREST FIRST (the group and the row next to the bar's own row first):
 * the kind's acts (no keys) · Open (one object whose type opens; a container has none — ⏎ enters it, R4) ·
 * Comment (a pad laid at the selection's edge — the C key's wrap, DK-D24) · Copy (⌘C — HN-D3: a card, not the
 * engine's, which has no copy op) | Duplicate (not while taped) · Bring to front · Send to back · Clean up (two or
 * more — DK-D29) | Tape it down, or Lift the tape | Delete.
 */
export function menuGroups(f: SelectionFacts, keys: DeskKeys): MenuRow[][] {
  const k = KEYS[keys];
  const near: MenuRow[] = [];
  if (missingOf(f) === undefined)
    for (const act of f.menu) near.push({ id: `act:${act.id}`, label: act.label });
  if (f.openable) near.push({ id: "open", label: "Open", key: k.open });
  if (f.commentable) near.push({ id: "comment", label: "Comment" });
  near.push({ id: "copy", label: COPY_LABEL, key: k.copy });
  const arrange: MenuRow[] = [];
  if (!f.locked) arrange.push({ id: "duplicate", label: "Duplicate", key: k.duplicate });
  arrange.push({ id: "front", label: "Bring to front" }, { id: "back", label: "Send to back" });
  if (f.count >= 2) arrange.push({ id: "cleanup", label: "Clean up" });
  return [
    near,
    arrange,
    [{ id: "tape", label: f.locked ? "Lift the tape" : "Tape it down", key: k.tape }],
    [{ id: "delete", label: "Delete", key: k.delete, danger: true }],
  ];
}

/**
 * The eyebrow at the menu's far end, in the mat's print (§8): what it acts on — the one object's name, a missing
 * face's with its word ("NOTE", "CLOCK · PLUGIN OFF"), or "2 OBJECTS".
 */
export function menuEyebrow(f: SelectionFacts): string {
  if (f.count > 1) return `${f.count} OBJECTS`;
  const one = f.words[0];
  return one === undefined ? "1 OBJECT" : eyebrowOf(one);
}
