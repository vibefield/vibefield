import { useEffect } from "react";

// UA-D19 — how the spine holds the Me menu (DESIGN.md §8), at the grain a test
// can reach without mounting ChromeLayer: the Settings chord, and the rule
// that the menu is one of the spine's expanded surfaces.

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
 * to. It toggles, like ⌘K. */
export function useSettingsChord(open: boolean, onOpen: () => void, onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isSettingsChord(event)) return;
      event.preventDefault();
      if (open) onClose();
      else onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpen, onClose]);
}

/** The Me menu is one of the spine's expanded surfaces: whatever else opens —
 * the tray, the docs explorer, Settings, the palette, Godview, a side panel —
 * folds it. (Opening the menu folds them; that half is ChromeLayer's opener.) */
export function useMeMenuYields(meOpen: boolean, anotherOpen: boolean, fold: () => void): void {
  useEffect(() => {
    if (meOpen && anotherOpen) fold();
  }, [meOpen, anotherOpen, fold]);
}
