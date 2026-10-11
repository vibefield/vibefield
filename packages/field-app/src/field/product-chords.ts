import { FRAME_VIEWS, type ViewKeys, viewForKey, viewKeysOf } from "../frame/views";
import { getHost } from "../host";
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
//
// ⌘1–⌘4 (One Frame FR-1, FC-D4) are the frame's four views. Ghostty binds
// ⌘1–⌘8 to goto_tab, and a pane in the deck has no tabs; the frame takes them
// first, so ⌘1 leaves Godview from inside a focused pane and ⌘2 comes back.
//
// ⌘T (One Frame FR-2, §11) is Godview's create in the line — New terminal —
// over ghostty's new_tab, which the deck has no tabs for either. The line
// claims it only while the window is in Godview; the table names it so
// Settings can say which Ghostty default it keeps from a pane.
//
// ⌘F (the Peek, GV-D8/D10, 2026-10-08) is search's, printed under the frame's
// button: the Peek claims it while History or Godview is the view (Godview's
// own Find left with P2, 2026-10-09). So Ghostty's start_search reaches a pane
// in neither — the row says WHEN, so Settings says it honestly rather than as
// an always.

type ChordKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat"
> &
  Partial<Pick<KeyboardEvent, "code">>;

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

/** ⌘T (Ctrl+T off the Mac): New terminal, Godview's create. Never with ⇧ or
 * ⌥, and never the other platform's modifier. */
export function isNewTerminalChord(event: ChordKey, keys: ViewKeys): boolean {
  const command =
    keys === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.altKey || event.shiftKey) return false;
  return event.key === "t" || event.key === "T";
}

/** ⌘F (Ctrl+F off the Mac): search — the Peek. Never with ⇧ or ⌥, and never
 * the other platform's modifier. */
export function isSearchChord(event: ChordKey, keys: ViewKeys): boolean {
  const command =
    keys === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.altKey || event.shiftKey) return false;
  return event.key === "f" || event.key === "F";
}

export interface ProductChord {
  readonly id:
    | "palette"
    | "settings"
    | "clipboard-tray"
    | "new-terminal"
    | "search"
    | "view-canvas"
    | "view-godview"
    | "view-history"
    | "view-assistant";
  /** The chord in Ghostty's own spelling (macOS), so a Ghostty binding on the
   * same keys can be recognized as the one it overrides. */
  readonly trigger: string;
  readonly label: string;
  /** When VibeField keeps the chord, if not always — said beside the label. */
  readonly when?: string;
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
  {
    id: "new-terminal",
    trigger: "super+t",
    label: "New terminal",
    matches: (event) => isNewTerminalChord(event, viewKeysOf(getHost().platform)),
  },
  {
    id: "search",
    trigger: "super+f",
    label: "Search",
    when: "while History or Godview is the view",
    matches: (event) => isSearchChord(event, viewKeysOf(getHost().platform)),
  },
  // The four views, in the track's order. Off the Mac they are Ctrl+1–4; the
  // trigger keeps ghostty's macOS spelling, which is what names the default
  // (goto_tab) each one overrides.
  ...FRAME_VIEWS.map(
    (cell): ProductChord => ({
      id: `view-${cell.view}`,
      trigger: `super+${cell.digit}`,
      label: cell.name,
      matches: (event) => viewForKey(event, viewKeysOf(getHost().platform)) === cell.view,
    }),
  ),
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
