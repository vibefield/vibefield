import type { ActChoice, ActChoiceField, HeldGlyph } from "@vibecook/ice";
import type { MenuSlot } from "@vibecook/ice/desk";
import type { GlyphName } from "@vibefield/design-kit/glyphs";
import { eyebrowOf, type ObjectWords } from "../desk-object-words";

// THE BAR'S CONTENT (DK-11; DESIGN.md §8 "The selection bar" — Order, Keyboard; "The bar grown" — the order
// nearest first, the eyebrow; R1, R3, R4, R10, R11, R23 reversed, DK-D24, DK-D29; HN-D3). Pure: what the bar and its
// grown menu show for a selection, from the anchor's facts (`count`, `locked`, the kinds' acts `menu`) and the
// host's own read of the selected objects (their types' words, whether the one selected opens). The host prints
// what a kind declares and adds nothing; a kind's act prints NO key on this build (R1 — its declared keys are
// ICE's demo's), while the DESK's acts print theirs (DK-D24; ⇧⌘L is the desk's, ICE's default keymap's — R23; ⌘C
// the desk's Make a card, CS-D11). Item 578 (2026-11-19): Download… follows Open for one print whose picture the
// desk holds; it is the host's act (the save is main's), prints no key, and has no cell on the bar itself.
// Track OM (2026-11-25; ICE I61, I62): a kind's act says what it is NOW — disabled, another label and drawing, a swatch —
// and an act may be a CHOICE: a pill with the current choice's label, whose list grows from the bar as More's menu does
// (`choiceGroups`, `choiceEyebrow`), a choice that asks for values reading with an ellipsis there. OM-2: a choice whose
// every choice carries a swatch is a SWATCH PILL — the current choice's dot, or an empty ring while Mixed, and no words.

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

/** Make a card — the bar's one word (CS-D11 A, on HN-D3): the selection dealt into the hand as ONE card. The same words
 * for one object or several — the count is the menu's eyebrow's ("2 OBJECTS"), and the card's own title. */
export const MAKE_CARD_LABEL = "Make a card";

/** Its tooltip, its key the desk's (⌘C over the desk; product-chords' `desk-copy`): "Make a card  ⌘C". */
export const makeCardTip = (keys: DeskKeys): string => tipOf(MAKE_CARD_LABEL, KEYS[keys].copy);

/** Download… — its ellipsis because it asks where before it acts (the system's save panel; item 578). */
export const DOWNLOAD_LABEL = "Download…";

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
  /** Exactly one object selected, a print whose picture this desk holds in a format the save door takes, where a
   * save door exists (print-download.ts; item 578). */
  readonly downloadable: boolean;
  /** The comment pad's kind is drawn here: the Comment row can lay one (DK-8's pad, DK-D24). */
  readonly commentable: boolean;
}

/** The desk's own four acts on the bar. */
export type DeskAct = "duplicate" | "tape" | "more" | "delete";

export type BarCell =
  /** Make a card — the bar's one word: the selection dealt into the hand as ONE card (CS-D11 A). */
  | { readonly kind: "copy"; readonly label: string; readonly tip: string }
  | { readonly kind: "rule"; readonly at: "lead" | "end" }
  /** A kind's act: its glyph by §13's table, or its label alone (R3); its label is its tip — no key (R1). Its kind's word
   * NOW (ICE I61): `disabled` — faint by ink and inert; a `swatch` in place of its glyph, the hand's dot. */
  | {
      readonly kind: "act";
      readonly id: string;
      readonly label: string;
      readonly glyph: HeldGlyph | undefined;
      readonly disabled?: boolean;
      readonly swatch?: string;
    }
  /** A kind's act that is a CHOICE (ICE I62; §8 "An act that is a choice"): a pill — its glyph, the current choice's
   * label (`Mixed` when the selected objects stand on different ones), a chevron; pressed, its list grows. */
  | {
      readonly kind: "choice";
      readonly id: string;
      /** The act's name ("Device") — its list's eyebrow, and the tip's first word. */
      readonly label: string;
      readonly glyph: HeldGlyph | undefined;
      /** The current choice's label, or `Mixed`. */
      readonly current: string;
      readonly mixed: boolean;
      /** Its tooltip and accessible name: the act and the choice ("Device: Laptop"). */
      readonly tip: string;
      readonly disabled?: boolean;
      /** A SWATCH PILL (§8, track OM, OM-2): every choice carries a swatch, so the pill is the current choice's dot — an
       * empty ring while Mixed — and the chevron, no words ("Finish: Cosmic Orange" its tip). */
      readonly swatches?: true;
      /** A swatch pill's current choice's swatch (CSS, the kind's own word), its dot's ink; absent while Mixed. */
      readonly swatch?: string;
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

/** What a choice pill says when the selected objects stand on different choices (§8 "An act that is a choice"). */
export const MIXED_LABEL = "Mixed";

/**
 * A choice act's current choice as its pill says it — the label of the one marked current, or Mixed with none — and
 * whether it is a SWATCH PILL (track OM, OM-2): every choice carries a swatch, and the pill draws the current one's
 * (none while Mixed).
 */
export function currentChoice(choices: readonly ActChoice[]): {
  readonly current: string;
  readonly mixed: boolean;
  readonly swatches: boolean;
  readonly swatch?: string;
} {
  const on = choices.find((c) => c.current === true);
  const swatches = choices.length > 0 && choices.every((c) => c.swatch !== undefined);
  const swatch = swatches ? on?.swatch : undefined;
  return {
    current: on === undefined ? MIXED_LABEL : on.label,
    mixed: on === undefined,
    swatches,
    ...(swatch === undefined ? {} : { swatch }),
  };
}

/** A kind's act as the bar prints it: a choice pill when it offers choices — a swatch pill when every choice carries a
 * swatch (OM-2) — else a cell (ICE I61, I62). */
export function actCell(act: MenuSlot): BarCell {
  if (act.choices !== undefined) {
    const { current, mixed, swatches, swatch } = currentChoice(act.choices);
    return {
      kind: "choice",
      id: act.id,
      label: act.label,
      glyph: act.glyph,
      current,
      mixed,
      tip: `${act.label}: ${current}`,
      ...(act.enabled === false ? { disabled: true } : {}),
      ...(swatches ? { swatches: true as const } : {}),
      ...(swatch === undefined ? {} : { swatch }),
    };
  }
  return {
    kind: "act",
    id: act.id,
    label: act.label,
    glyph: act.glyph,
    ...(act.enabled === false ? { disabled: true } : {}),
    ...(act.swatch !== undefined ? { swatch: act.swatch } : {}),
  };
}

/** The first selected type the desk draws as missing — the bar names it where the acts would stand. */
export const missingOf = (f: SelectionFacts): ObjectWords | undefined =>
  f.words.find((w) => w.state !== null);

/**
 * The bar's cells, in the canon's order: Make a card · rule · the kind's acts · Duplicate · Tape it down · More · rule
 * · Delete. Taped (every selected object taped): no Duplicate, and the tape act becomes "Lift the tape", wearing
 * `lift` — an act whose name changes, never a toggle (R10). A missing face selected: its name and word where the
 * kind's acts would stand, and Duplicate still offered (it duplicates the data — R11).
 */
export function barCells(f: SelectionFacts, keys: DeskKeys): BarCell[] {
  const k = KEYS[keys];
  const cells: BarCell[] = [
    { kind: "copy", label: MAKE_CARD_LABEL, tip: makeCardTip(keys) },
    { kind: "rule", at: "lead" },
  ];
  const missing = missingOf(f);
  if (missing !== undefined) cells.push({ kind: "words", label: missing.label });
  else for (const act of f.menu) cells.push(actCell(act));
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
  /** `act:<id>` for a kind's act; else open · download · comment · copy · duplicate · front · back · cleanup · tape ·
   * delete. */
  readonly id: string;
  readonly label: string;
  readonly key?: string;
  /** A row that waits, and why: drawn, never taken — a kind's act its kind says is disabled now (ICE I61), whose why is
   * "" (the kind says none); the words' Paste where the page cannot read the clipboard (IK). */
  readonly waits?: string;
  /** Delete: armed red under the pointer. */
  readonly danger?: boolean;
  /** Taking it OPENS another list in this one's place — More's row for a choice act (§8 "A choice's list"): the menu
   * stays grown. */
  readonly opens?: boolean;
  /** A choice's row (ICE I62): whether it is the current one — `menuitemradio`, `check` at its start. Absent: not a choice. */
  readonly checked?: boolean;
  /** A choice's swatch: a 12 dot before its label. */
  readonly swatch?: string;
  /** A choice that asks for values first (the pane's Custom): its fields open under its row when it is taken. */
  readonly fields?: readonly ActChoiceField[];
}

/**
 * The grown menu's rows in their groups, NEAREST FIRST (the group and the row next to the bar's own row first):
 * the kind's acts (no keys) · Open (one object whose type opens; a container has none — ⏎ enters it, R4) ·
 * Download… (one print whose picture the desk holds; no key — item 578) ·
 * Comment (a pad laid at the selection's edge — the C key's wrap, DK-D24) · Make a card (⌘C — a card, not the
 * engine's, which has no copy op) | Duplicate (not while taped) · Bring to front · Send to back · Clean up (two or
 * more — DK-D29) | Tape it down, or Lift the tape | Delete.
 */
export function menuGroups(f: SelectionFacts, keys: DeskKeys): MenuRow[][] {
  const k = KEYS[keys];
  const near: MenuRow[] = [];
  if (missingOf(f) === undefined)
    for (const act of f.menu) {
      // its kind says it is disabled now (ICE I61): drawn, never taken — the kind says no why, so none is printed
      if (act.enabled === false) {
        near.push({ id: `act:${act.id}`, label: act.label, waits: "" });
        continue;
      }
      // a choice act is one row, its current choice in the key's place; taking it shows its list in More's (ICE I62)
      if (act.choices !== undefined)
        near.push({
          id: `act:${act.id}`,
          label: act.label,
          key: currentChoice(act.choices).current,
          opens: true,
        });
      else near.push({ id: `act:${act.id}`, label: act.label });
    }
  if (f.openable) near.push({ id: "open", label: "Open", key: k.open });
  if (f.downloadable) near.push({ id: "download", label: DOWNLOAD_LABEL });
  if (f.commentable) near.push({ id: "comment", label: "Comment" });
  near.push({ id: "copy", label: MAKE_CARD_LABEL, key: k.copy });
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

/** A row's id for a choice of the list (`choice:<id>`), and the choice's id back from one. */
export const choiceRowId = (id: string): string => `choice:${id}`;
export const choiceOfRow = (row: string): string | undefined =>
  row.startsWith("choice:") ? row.slice("choice:".length) : undefined;

/**
 * A CHOICE'S LIST (§8 "The bar grown" — "A choice's list"; ICE I62): the kind's choices nearest first in the kind's
 * order, a new group where the kind's group changes; each row its label — with an ellipsis for one that asks for values
 * first ("Custom…") — its hint in the key's place, its swatch, whether it is the current one, and its fields.
 */
export function choiceGroups(choices: readonly ActChoice[]): MenuRow[][] {
  const groups: MenuRow[][] = [];
  let group: string | undefined;
  for (const [i, c] of choices.entries()) {
    if (i === 0 || c.group !== group) groups.push([]);
    group = c.group;
    groups[groups.length - 1]?.push({
      id: choiceRowId(c.id),
      label: c.fields === undefined ? c.label : `${c.label}…`,
      checked: c.current === true,
      ...(c.hint === undefined ? {} : { key: c.hint }),
      ...(c.swatch === undefined ? {} : { swatch: c.swatch }),
      ...(c.fields === undefined ? {} : { fields: c.fields }),
    });
  }
  return groups;
}

/** A choice's list's eyebrow, in the mat's print: the act's name ("DEVICE"). */
export const choiceEyebrow = (label: string): string => label.toUpperCase();

/**
 * The eyebrow at the menu's far end, in the mat's print (§8): what it acts on — the one object's name, a missing
 * face's with its word ("NOTE", "CLOCK · PLUGIN OFF"), or "2 OBJECTS".
 */
export function menuEyebrow(f: SelectionFacts): string {
  if (f.count > 1) return `${f.count} OBJECTS`;
  const one = f.words[0];
  return one === undefined ? "1 OBJECT" : eyebrowOf(one);
}
