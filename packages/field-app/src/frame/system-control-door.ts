import { useSyncExternalStore } from "react";

// WHAT GODVIEW LENDS THE PALETTE (GV-D1; DESIGN.md §8 "Godview's head —
// Stories", "What left with the bar"). System control was the instrument bar's
// last tool; the bar left VibeField, and its one act is in the palette's "On
// this view" group while the view is Godview. The palette is the frame's and
// the panel's state is Godview's (`GodviewOverlay`'s `tuningOpen`), so the
// overlay publishes this door and the frame's act runs it — as the monitor
// publishes search's (`find-door.ts`, the same module-store shape for the same
// reason: the publisher sits inside the cover and the reader in the frame above
// it, and a prop drilled between them would make the frame a second owner of
// something it never reads). One verb, no state: the panel says for itself
// whether it is open.

export interface SystemControlDoor {
  /** Open the panel, or close it: what the bar's control did. */
  toggle(): void;
}

let door: SystemControlDoor | null = null;
const listeners = new Set<() => void>();

/** Godview's side: publish while the view is open, null when it goes away. */
export function publishSystemControlDoor(next: SystemControlDoor | null): void {
  if (next === door) return;
  door = next;
  for (const fn of listeners) fn();
}

export function getSystemControlDoor(): SystemControlDoor | null {
  return door;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The frame's side: whether the act can run (the palette draws it waiting
 * while there is no door, and never runs it). */
export function useSystemControlDoor(): SystemControlDoor | null {
  return useSyncExternalStore(subscribe, getSystemControlDoor, getSystemControlDoor);
}

/** The frame's side: run the act. False when Godview has lent no door. */
export function runSystemControl(): boolean {
  if (door === null) return false;
  door.toggle();
  return true;
}

/** Test seam. */
export function resetSystemControlDoorForTest(): void {
  door = null;
  listeners.clear();
}
