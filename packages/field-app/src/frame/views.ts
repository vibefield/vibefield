import type { FrameView, ShellPlatform } from "@vibefield/contracts";
import type { GlyphName } from "@vibefield/design-kit/glyphs";

// The frame's four views as the views track draws them (One Frame FR-1;
// DESIGN.md §8 "The views track", §10). FC-D2: four cells, the Assistant's
// waiting. FC-D4: ⌘1–⌘4 and nothing else — Ctrl 1–4 off the Mac.

export interface FrameViewCell {
  readonly view: FrameView;
  readonly name: string;
  readonly glyph: GlyphName;
  readonly digit: "1" | "2" | "3" | "4";
}

/** In the track's order, which is also the keys' order. */
export const FRAME_VIEWS: readonly FrameViewCell[] = [
  { view: "canvas", name: "Canvas", glyph: "canvas", digit: "1" },
  { view: "godview", name: "Godview", glyph: "panes", digit: "2" },
  { view: "history", name: "History", glyph: "history", digit: "3" },
  { view: "assistant", name: "Assistant", glyph: "message", digit: "4" },
];

/** How the keys are printed and pressed: ⌘ on the Mac, Ctrl elsewhere. Never
 * both — ⌃1–⌃4 are the Mac's own Spaces, and a ⌃4 that reached a shell would be
 * ^\ (SIGQUIT), so the Mac's Control-digits stay the pane's. */
export type ViewKeys = "mac" | "other";

export function viewKeysOf(platform: ShellPlatform | undefined): ViewKeys {
  if (platform !== undefined) return platform === "darwin" ? "mac" : "other";
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? "mac" : "other";
}

/** The key's two printed parts — the modifier small and quiet, the digit the
 * legend (DESIGN.md §8). */
export function viewKeyParts(
  cell: FrameViewCell,
  keys: ViewKeys,
): { modifier: string; digit: string } {
  return { modifier: keys === "mac" ? "⌘" : "Ctrl", digit: cell.digit };
}

/** The key as a tooltip or menu says it: "⌘2", "Ctrl+2". */
export function viewKeyLabel(cell: FrameViewCell, keys: ViewKeys): string {
  return keys === "mac" ? `⌘${cell.digit}` : `Ctrl+${cell.digit}`;
}

/** The key as `aria-keyshortcuts` spells it. */
export function viewKeyShortcut(cell: FrameViewCell, keys: ViewKeys): string {
  return `${keys === "mac" ? "Meta" : "Control"}+${cell.digit}`;
}

type ViewChordKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> &
  Partial<Pick<KeyboardEvent, "code">>;

/** The view a key names, or null when it names none. The physical digit row
 * first (`Digit1`…, ghostty's own `digit_1` spelling, so a layout that types
 * "&" there still switches), then the digit itself for keys with no code. */
export function viewForKey(event: ViewChordKey, keys: ViewKeys): FrameView | null {
  const command =
    keys === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.altKey || event.shiftKey) return null;
  const digit =
    /^Digit([1-4])$/u.exec(event.code ?? "")?.[1] ??
    (/^[1-4]$/u.test(event.key) ? event.key : null);
  if (digit === null) return null;
  return FRAME_VIEWS.find((cell) => cell.digit === digit)?.view ?? null;
}
