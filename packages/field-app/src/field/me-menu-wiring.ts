import { useEffect } from "react";

// UA-D19 — how the spine holds the Me menu (DESIGN.md §8), at the grain a test
// can reach without mounting ChromeLayer: the Settings chord.

type ChordKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat"
>;

/** ⌘, or Ctrl+, — and only that: no Alt, no Shift, and never a held key's
 * repeats, which would flicker Settings open and shut. */
export function isSettingsChord(event: ChordKey): boolean {
  return (
    event.key === "," &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat
  );
}

/** Settings from anywhere. The gear this replaced said "settings" by being
 * one; a face does not, so the chord carries the discoverability the icon used
 * to. It toggles, like ⌘K.
 *
 * GT-D21: caught on the window's CAPTURE phase and stopped there — "anywhere"
 * includes a focused Godview pane, whose Ghostty default for ⌘, is
 * `open_config`, and ghosttea's own capture listener used to swallow it. */
export function useSettingsChord(open: boolean, onOpen: () => void, onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isSettingsChord(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (open) onClose();
      else onOpen();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onOpen, onClose]);
}

// The Me menu's other half — that it is one of the expanded surfaces, folded by
// whatever else opens — retired here at One Frame FR-4: it is one of the
// frame's open surfaces now (`frame/frame-surface.ts`), so the one owner folds
// it by construction, and Godview no longer folds it (the corner stands above
// the cover; DESIGN.md §10).
