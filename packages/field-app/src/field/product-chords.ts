import { isSettingsChord } from "./me-menu-wiring";

// The chords VibeField keeps for itself (GT-D21) — one table, read by the
// handlers that act on them and by Settings → Terminal → Keyboard, which has to
// say which of Ghostty's defaults never reach a pane.
//
// WHY THE CAPTURE PHASE. A focused Godview pane is ghosttea's: its workspace
// listens on the window in the capture phase for workspace, platform and
// unhandled binds, and its terminal surface consumes terminal binds at the
// target (0.11.1 `Workspace.js` / `TerminalSurface.js`, both stopping the
// event). A listener on the window's BUBBLE phase therefore never hears a chord
// a pane has claimed: ⌘K cleared the screen instead of opening the palette, ⌘,
// was swallowed as Ghostty's `open_config`, and ⌘⇧V pinned the tray AND pasted
// the selection. Caught on the window in the capture phase and stopped there,
// each chord does VibeField's thing and nothing else, wherever focus is.

type ChordKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat"
>;

/** ⌘K or Ctrl+K (Shift allowed, as it always was): the command palette. */
export function isCommandPaletteChord(event: ChordKey): boolean {
  return (
    (event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey) && !event.altKey
  );
}

/** ⌘⇧V or Ctrl+Shift+V: the clipboard tray. */
export function isClipboardTrayChord(event: ChordKey): boolean {
  return (
    (event.key === "v" || event.key === "V") &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey
  );
}

export interface ProductChord {
  readonly id: "palette" | "settings" | "clipboard-tray";
  /** The chord in Ghostty's own spelling (macOS), so a Ghostty binding on the
   * same keys can be recognized as the one it overrides. */
  readonly trigger: string;
  readonly label: string;
  readonly matches: (event: ChordKey) => boolean;
}

export const PRODUCT_CHORDS: readonly ProductChord[] = [
  { id: "palette", trigger: "super+k", label: "Command palette", matches: isCommandPaletteChord },
  { id: "settings", trigger: "super+,", label: "Settings", matches: isSettingsChord },
  {
    id: "clipboard-tray",
    trigger: "super+shift+v",
    label: "Clipboard tray",
    matches: isClipboardTrayChord,
  },
];

/** Listen for one product chord on the window's CAPTURE phase and stop it
 * there (see the head of this file). Returns the unsubscribe. */
export function listenForProductChord(
  matches: (event: KeyboardEvent) => boolean,
  onChord: (event: KeyboardEvent) => void,
): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (!matches(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onChord(event);
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
