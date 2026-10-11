import { useSyncExternalStore } from "react";

// WHAT GODVIEW SAYS OF ITS TERMINALS (Godview round 3, GV-D5/D6/D11; DESIGN.md
// §8 "The edge moves"). The terminals' wrapper is in one of three states —
// away (the monitor alone), up (the sheet), or maximized (its bar is the
// window's title bar) — and two readers stand outside Godview's own tree: the
// frame, whose head and Peek give way while the bar is the title bar, and the
// shell, which moves the window's lights there. So the state leaves through a
// door, as Find's and the line's do (`find-door.ts`, `line-door.ts`: the same
// module-store shape for the same reason — the publisher sits deep inside the
// cover and the readers above it).
//
// A plain fact, and no verbs yet: asking for the terminals ("bring them up")
// comes with the slice that can put them away. Today the deck is always up,
// so "up" is all that is ever published.

/** The wrapper's state. It reads "up" from the START of a drag out of
 * maximized, not from the release, so the head returns at once. */
export type GodviewDeckState = "away" | "up" | "maximized";

let deck: GodviewDeckState | null = null;
const listeners = new Set<() => void>();

/** Godview's side: publish on change, null to withdraw — on unmount, and
 * while Godview is not the window's view. Only the window's own stage speaks
 * (`GodviewStage`'s `publishesDeck`, set by `GodviewOverlay` alone); the
 * catalog's stage and Settings' miniature never do. */
export function publishGodviewDeck(next: GodviewDeckState | null): void {
  if (next === deck) return;
  deck = next;
  for (const fn of listeners) fn();
}

/** The state, or null while no Godview speaks for the window. */
export function getGodviewDeck(): GodviewDeckState | null {
  return deck;
}

/** Hears each change — for a reader outside React (the shell's lights). */
export function subscribeGodviewDeck(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Godview's own readers, and the shell's: the three-valued state. */
export function useGodviewDeck(): GodviewDeckState | null {
  return useSyncExternalStore(subscribeGodviewDeck, getGodviewDeck, getGodviewDeck);
}

const isMaximized = (): boolean => deck === "maximized";

/** The frame's side, and the whole of it: whether the terminals fill the
 * window. "away" and "up" never leave Godview — a reader of this hook renders
 * only when the answer flips. */
export function useGodviewDeckMaximized(): boolean {
  return useSyncExternalStore(subscribeGodviewDeck, isMaximized, isMaximized);
}

/** Test seam. */
export function resetGodviewDeckDoorForTest(): void {
  deck = null;
  listeners.clear();
}
