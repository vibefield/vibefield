import type { WebContents } from "electron";

/** The part of Electron's `before-input-event` payload the chords read. */
export interface WindowChordInput {
  readonly type: "keyDown" | "keyUp";
  readonly key: string;
  /** The physical key (`KeyQ`). Electron always sends it; a test may leave it out. */
  readonly code?: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isAutoRepeat?: boolean;
}

export type WindowChord = "quit" | "full-screen" | "screenshot";

/**
 * THE CHORDS MAIN TAKES ABOVE EVERY PAGE — ⌃⌘A (SNAP-3), ⌘Q and ⌃⌘F (AL-9;
 * AL-D14 "A" and AL-D15, James at the board 2026-10-27 17:12–17:13Z;
 * `draft/thinking-app-lifecycle.md` §9).
 *
 * The app menu holds all three (the screenshot item, the `quit` and
 * `togglefullscreen` roles), and that was never enough. On macOS Electron offers
 * a key to the page FIRST, and a key the page claims never reaches the menu.
 * - The canvas engine's keymap binds ⌘A to select-all and tests its modifier as
 *   `metaKey || ctrlKey`, so ⌃⌘A selected every card and took no screenshot
 *   (found at James's first live press, 2026-09-23).
 * - ghosttea's workspace claims Ghostty's `quit` and `toggle_fullscreen` on the
 *   window's capture phase. The deck gave it no `quit` hook, so ⌘Q fell back to
 *   the deck's `closeWindow`: the terminals minimized, the active pane's session
 *   was swapped out, and nothing quit. The deck's `toggleFullscreen` is empty,
 *   so ⌃⌘F did nothing. A page product chord could not fix it, because stopping
 *   a key never stops a sibling listener on the same node.
 *
 * `before-input-event` fires in main before the page is offered the key. Here a
 * chord is swallowed: `preventDefault` keeps it from the page and, per Electron,
 * from the menu shortcut, so each act runs exactly once. ⌘Q is `app.quit()`, the
 * same call the menu's role and the tray's Quit make, so it reaches AL-3's census
 * gate as a person's quit. The menu keeps every chord in its accelerator column,
 * and Settings → Terminal → Keyboard names ⌘Q and ⌃⌘F as the shell's
 * (`product-chords.ts`).
 *
 * Off the Mac only the screenshot chord is taken, as Alt+A, the menu's own
 * spelling there (SNAP-D3). Ghostty spells quit `ctrl+shift+q` there and the OS
 * owns Alt+F4, and the Windows port measures before anything else is assumed
 * (§9.3).
 */
export function windowChordOf(
  input: WindowChordInput,
  platform: NodeJS.Platform = process.platform,
): WindowChord | null {
  if (input.type !== "keyDown") return null;
  const letter = chordLetterOf(input);
  if (letter === null) return null;
  const { control, meta, alt, shift } = input;
  if (platform !== "darwin") {
    return letter === "a" && alt && !control && !meta && !shift ? "screenshot" : null;
  }
  if (!meta || alt || shift) return null;
  if (letter === "q" && !control) return "quit";
  if (letter === "f" && control) return "full-screen";
  if (letter === "a" && control) return "screenshot";
  return null;
}

/**
 * The letter a chord names: the key's own when it is a Latin letter, otherwise
 * the physical key's (`KeyQ` → "q").
 *
 * The fallback is for a non-Latin layout. There ⌘ and the Q key can report the
 * layout's own letter (Russian "й"), while macOS's key equivalents fall back to
 * the Latin letter, and so does ghosttea's matcher (it reads `code` too:
 * `unicodeCandidates`, ghostty-triggers.js). Matching `key` alone would leave
 * ⌘Q to the pane on such a layout, AL-9's bug again.
 *
 * Any other key the layout sends (an ASCII one: Dvorak's `'` on the Q key) is
 * the layout's own, and names no chord here.
 */
function chordLetterOf(input: WindowChordInput): string | null {
  const key = input.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  if (input.key.length !== 1 || input.key.charCodeAt(0) < 0x80) return null;
  const code = /^Key([A-Z])$/.exec(input.code ?? "");
  return code?.[1]?.toLowerCase() ?? null;
}

/** The window the chords act on: its page's input, and its full screen. */
export interface WindowChordTarget {
  readonly webContents: Pick<WebContents, "on">;
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
}

export interface WindowChordActs {
  readonly quit: () => void;
  /** Absent where no capture can run (no helper, or Studio's window): ⌃⌘A is
   * then left to the page and the menu. */
  readonly screenshot?: () => void;
}

export function installWindowChords(
  target: WindowChordTarget,
  acts: WindowChordActs,
  platform: NodeJS.Platform = process.platform,
): void {
  target.webContents.on("before-input-event", (event, input) => {
    const chord = windowChordOf(input as WindowChordInput, platform);
    if (chord === null || (chord === "screenshot" && acts.screenshot === undefined)) return;
    event.preventDefault();
    // A held chord repeats. The repeats are swallowed too, or each would reach
    // the page and the menu: a pane's ghosttea would put the terminals away
    // behind the quit box, the menu would flip full screen back, and the canvas
    // would select all. The act runs once, on the first press.
    if (input.isAutoRepeat) return;
    if (chord === "quit") acts.quit();
    else if (chord === "full-screen") target.setFullScreen(!target.isFullScreen());
    else acts.screenshot?.();
  });
}
