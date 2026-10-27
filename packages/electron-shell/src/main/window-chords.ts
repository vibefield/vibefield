import type { WebContents } from "electron";

/** The part of Electron's `before-input-event` payload the chords read. */
export interface WindowChordInput {
  readonly type: "keyDown" | "keyUp";
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isAutoRepeat?: boolean;
}

export type WindowChord = "quit" | "full-screen";

/**
 * ⌘Q AND ⌃⌘F ABOVE EVERY PAGE (AL-9; AL-D14 "A" and AL-D15, James at the
 * board 2026-10-27 17:12–17:13Z; `draft/thinking-app-lifecycle.md` §9).
 *
 * The app menu holds both chords (the `quit` and `togglefullscreen` roles), and
 * that was never enough over a terminal pane. On macOS Electron offers a key to
 * the page FIRST, and a key the page claims never reaches the menu (SNAP-3,
 * `screenshot-chord.ts`). ghosttea's workspace claims Ghostty's `quit` and
 * `toggle_fullscreen` on the window's capture phase. The deck gave it no `quit`
 * hook, so ⌘Q fell back to the deck's `closeWindow`: the terminals minimized,
 * the active pane's session was swapped out, and nothing quit. The deck's
 * `toggleFullscreen` is empty, so ⌃⌘F did nothing. A page product chord could
 * not fix it, because stopping a key never stops a sibling listener on the
 * same node.
 *
 * `before-input-event` fires in main before the page is offered the key. Here
 * both chords are swallowed: `preventDefault` keeps them from the page and, per
 * Electron, from the menu shortcut, so each act runs exactly once. ⌘Q is
 * `app.quit()`, the same call the menu's role and the tray's Quit make, so it
 * reaches AL-3's census gate as a person's quit. The menu keeps both chords in
 * its accelerator column, and Settings → Terminal → Keyboard names them as the
 * shell's (`product-chords.ts`).
 *
 * Off the Mac nothing is taken yet. Ghostty spells quit `ctrl+shift+q` there and
 * the OS owns Alt+F4, and the Windows port measures before anything is assumed
 * (§9.3).
 */
export function windowChordOf(
  input: WindowChordInput,
  platform: NodeJS.Platform = process.platform,
): WindowChord | null {
  if (platform !== "darwin") return null;
  if (input.type !== "keyDown" || input.isAutoRepeat === true) return null;
  if (!input.meta || input.alt || input.shift) return null;
  const key = input.key.toLowerCase();
  if (key === "q" && !input.control) return "quit";
  if (key === "f" && input.control) return "full-screen";
  return null;
}

/** The window the chords act on: its page's input, and its full screen. */
export interface WindowChordTarget {
  readonly webContents: Pick<WebContents, "on">;
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
}

export function installWindowChords(
  target: WindowChordTarget,
  acts: { quit: () => void },
  platform: NodeJS.Platform = process.platform,
): void {
  target.webContents.on("before-input-event", (event, input) => {
    const chord = windowChordOf(input as WindowChordInput, platform);
    if (chord === null) return;
    event.preventDefault();
    if (chord === "quit") acts.quit();
    else target.setFullScreen(!target.isFullScreen());
  });
}
