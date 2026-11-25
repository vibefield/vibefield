import type { EditorCommand } from "@vibecook/ice/desk";
import type { FieldHost } from "../../../host";
import type { DeskKeys, MenuRow } from "./bar-model";

// THE WORDS BAR'S MORE (IK, 2026-11-25; DESIGN.md §8 "The words bar" — More; "The bar grown — More, and right-click"; ICE
// I60's `DeskEditor.command`). Pure: the rows the words bar grows into — Cut · Copy · Paste | Select all, each with the key
// the platform field already answers to — and what the bar says when one of them could do nothing. The rows are the
// editor's own items, never a kind's acts: they run through the desk's one editor (bar-acts.ts `runWordsCommand`), which
// keeps the field's focus and its range.
//
// PASTE, THROUGH THE SHELL'S DOOR (round two). The desktop app grants the page no Chromium permission (ESP §7.4), so the web's
// own clipboard read is refused there; main reads the system clipboard for the focused product window instead
// (`FieldClipboardHost.readText`, the door a terminal's paste already takes — terminal/clipboard.ts). The bar's Paste reads
// the words through that door and hands them to the editor (`DeskEditor.command("paste", { text })`, which reads no clipboard
// itself and lays the desk's last copied piece only when its words are exactly these, so their marks come back). Where no
// such door exists (the browser catalog) the bar has no honest read, and its Paste WAITS — drawn, never taken — saying the
// key that does paste (the field's ⌘V). A paste that laid nothing, or a read the door refused, says so on the status line.

/** The bar's road to the clipboard: `door` (the host reads it through main), or `none` (no door: Paste waits). */
export type WordsPaste = "door" | "none";

/** The bar's road, by its host: a host with the clipboard door (host.ts `FieldClipboardHost`) reads it; none, no road. */
export const wordsPasteOf = (host: Pick<FieldHost, "clipboard"> | null): WordsPaste =>
  host?.clipboard === undefined ? "none" : "door";

/** The words' More rows' ids: `words:<command>`. */
export const WORDS_ROW = "words:";

/** What the words' menu acts on, at its far end (the eyebrow): the words selected. */
export const WORDS_EYEBROW = "WORDS";

const LABELS: Readonly<Record<EditorCommand, string>> = {
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select all",
};

/** The platform field's own keys for the four (§8 "The words bar" — Keys): the bar prints them; the field answers them. */
const WORDS_KEYS = {
  mac: { cut: "⌘X", copy: "⌘C", paste: "⌘V", selectAll: "⌘A" },
  other: { cut: "Ctrl+X", copy: "Ctrl+C", paste: "Ctrl+V", selectAll: "Ctrl+A" },
} as const satisfies Record<DeskKeys, Record<EditorCommand, string>>;

/** Why Paste waits where the page cannot read the clipboard: the key that does paste. */
export const pasteWaits = (keys: DeskKeys): string =>
  `the bar can't read the clipboard here; ${WORDS_KEYS[keys].paste} pastes`;

/** Where the words' menu stands: over words selected, or at a bare CARET (round two: its rows are Paste and Select all). */
export type WordsMenuAt = "words" | "caret";

/**
 * The words' menu, NEAREST FIRST: Cut · Copy · Paste | Select all (§8), each with the platform field's key; at a CARET alone
 * Paste | Select all (§8: nothing is selected to cut or copy). Paste waits where the bar has no road to the clipboard
 * (`none`), and says the key that pastes.
 */
export function wordsMenuGroups(
  keys: DeskKeys,
  paste: WordsPaste,
  at: WordsMenuAt = "words",
): MenuRow[][] {
  const k = WORDS_KEYS[keys];
  const row = (name: EditorCommand): MenuRow => ({
    id: `${WORDS_ROW}${name}`,
    label: LABELS[name],
    key: k[name],
  });
  const pasteRow: MenuRow =
    paste === "none" ? { ...row("paste"), waits: pasteWaits(keys) } : row("paste");
  if (at === "caret") return [[pasteRow], [row("selectAll")]];
  return [[row("cut"), row("copy"), pasteRow], [row("selectAll")]];
}

/** The editor's command a words' row runs — undefined for any other row. */
export function commandOfRow(id: string): EditorCommand | undefined {
  if (!id.startsWith(WORDS_ROW)) return undefined;
  const name = id.slice(WORDS_ROW.length);
  return Object.hasOwn(LABELS, name) ? (name as EditorCommand) : undefined;
}

/**
 * What the status line says when a command did nothing (the editor answered false) — never a silent nothing: the words,
 * and the key that does it. Select all says nothing: it fails only with nothing lent, and then the bar is not over words.
 */
export function wordsMissed(name: EditorCommand, keys: DeskKeys): string | undefined {
  const k = WORDS_KEYS[keys];
  switch (name) {
    case "cut":
      return `Couldn't cut these words. ${k.cut} cuts them.`;
    case "copy":
      return `Couldn't copy these words. ${k.copy} copies them.`;
    case "paste":
      return `Nothing to paste here. ${k.paste} pastes from the clipboard.`;
    case "selectAll":
      return undefined;
  }
}

/** What the status line says when the clipboard door refused its read (main answers only the focused product window). */
export const pasteUnread = (keys: DeskKeys): string =>
  `Couldn't read the clipboard. ${WORDS_KEYS[keys].paste} pastes from it.`;
