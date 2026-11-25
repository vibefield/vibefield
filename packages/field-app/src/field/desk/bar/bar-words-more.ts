import type { EditorCommand } from "@vibecook/ice/desk";
import type { FieldHost } from "../../../host";
import type { DeskKeys, MenuRow } from "./bar-model";

// THE WORDS BAR'S MORE (IK, 2026-11-25; DESIGN.md §8 "The words bar" — More; "The bar grown — More, and right-click"; ICE
// I60's `DeskEditor.command`). Pure: the rows the words bar grows into — Cut · Copy · Paste | Select all, each with the key
// the platform field already answers to — and what the bar says when one of them could do nothing. The rows are the
// editor's own items, never a kind's acts: they run through the desk's one editor (bar-acts.ts `runWordsCommand`), which
// keeps the field's focus and its range.
//
// PASTE, HONESTLY. The editor's paste reads the system clipboard through the web's own read (`navigator.clipboard`). The
// desktop app grants no Chromium permission (ESP §7.4), so that read is refused there, and the editor would then lay the
// last words copied or cut on THIS desk, whatever the clipboard holds since. A paste of stale words is worse than none, so
// where the page cannot read the clipboard (the app: its host reads it through main, `FieldClipboardHost`) the bar's Paste
// WAITS — drawn, never taken — and its tooltip says the key that does paste (the field's ⌘V). Where the page reads it (a
// browser harness), Paste runs, and a paste that laid nothing says so on the status line.

/** Whether this page can read the system clipboard itself: `reads` (the web's read stands), or `shell` (the app's shell
 * refuses it; the host reads it through main, which the editor's paste does not take). */
export type WordsPaste = "reads" | "shell";

/** The page's road to the clipboard, by its host: a host that reads the clipboard through main is the app's shell, where the
 * web's own read is refused (host.ts `FieldClipboardHost`); no such host, the web's read stands. */
export const wordsPasteOf = (host: Pick<FieldHost, "clipboard"> | null): WordsPaste =>
  host?.clipboard === undefined ? "reads" : "shell";

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

/**
 * The words' menu, NEAREST FIRST: Cut · Copy · Paste | Select all (§8), each with the platform field's key. Paste waits where
 * the page cannot read the clipboard (`shell`), and says the key that pastes.
 */
export function wordsMenuGroups(keys: DeskKeys, paste: WordsPaste): MenuRow[][] {
  const k = WORDS_KEYS[keys];
  const row = (name: EditorCommand): MenuRow => ({
    id: `${WORDS_ROW}${name}`,
    label: LABELS[name],
    key: k[name],
  });
  const pasteRow: MenuRow =
    paste === "shell" ? { ...row("paste"), waits: pasteWaits(keys) } : row("paste");
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
