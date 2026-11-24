// the room's types only, which ride no chunk: this module is the frame's
import type { ImportSign } from "@vibefield/rosetta-room";
import { useSyncExternalStore } from "react";

// WHAT HISTORY LENDS THE FRAME: THE IMPORT'S SIGN (track IM, IM-1; DESIGN.md §8 "History", the import's sign).
// rosetta's room reads the import and hands it to its host (R11, `importSign`, rosetta-room 0.1.9); the frame draws it
// as the History circle in its head, beside search (`HistoryImportSign.tsx`). A module store, as the line's door is
// (`line-door.ts`), for the same reason: the room sits deep inside the cover and the circle in the frame above it.
// Plain data only — the room's words, figures and fractions; no port, no node and no callback crosses.

let current: ImportSign | null = null;
const listeners = new Set<() => void>();

/** The room says the import moved; null when there is none to sign (before the index answers, while it waits for
 * consent) or the room has gone. */
export function publishImportSign(sign: ImportSign | null): void {
  if (sign === current) return;
  current = sign;
  for (const listener of listeners) listener();
}

/** The sign the frame draws now, or null. */
export function readImportSign(): ImportSign | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The sign, as the frame's head draws it. */
export function useImportSign(): ImportSign | null {
  return useSyncExternalStore(subscribe, readImportSign, readImportSign);
}
