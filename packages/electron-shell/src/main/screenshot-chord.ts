import type { WebContents } from "electron";

/** The part of Electron's `before-input-event` payload the chord reads. */
export interface ScreenshotChordInput {
  readonly type: "keyDown" | "keyUp";
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isAutoRepeat?: boolean;
}

/**
 * ⌃⌘A ABOVE THE PAGE (SNAP-3; the GT-D2 door ⇧⇧ already uses).
 *
 * The View menu's item carries the chord as an application accelerator, and
 * that was never enough: on macOS Electron offers a key to the page FIRST, and
 * a page that calls `preventDefault` keeps the menu from ever seeing it. The
 * canvas engine's keymap does exactly that for ⌘A (select all) and tests its
 * modifier as `metaKey || ctrlKey`, so ⌃⌘A selected every card and took no
 * screenshot — found at James's first live press, 2026-09-23. `before-input-
 * event` fires in main before the page is offered the key; here the chord IS
 * swallowed (unlike ⇧⇧'s Shift, which a terminal needs): `preventDefault`
 * keeps it from the page and, per Electron, from the menu shortcut too, so
 * the capture runs exactly once. The menu item keeps the chord in its
 * accelerator column so the gesture stays discoverable.
 */
export function isScreenshotChord(
  input: ScreenshotChordInput,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (input.type !== "keyDown" || input.isAutoRepeat === true) return false;
  if (input.key.toLowerCase() !== "a") return false;
  if (platform === "darwin") {
    return input.control && input.meta && !input.alt && !input.shift;
  }
  // Alt+A elsewhere — the menu's own spelling of the chord (SNAP-D3).
  return input.alt && !input.control && !input.meta && !input.shift;
}

export function installScreenshotChord(
  target: WebContents,
  capture: () => void,
  platform: NodeJS.Platform = process.platform,
): void {
  target.on("before-input-event", (event, input) => {
    if (!isScreenshotChord(input as ScreenshotChordInput, platform)) return;
    event.preventDefault();
    capture();
  });
}
