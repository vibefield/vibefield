import { useSyncExternalStore } from "react";

// THE STATUS LINE's store (DESIGN.md §8 "The status line", R12, R16, R18; §10: the head's place) —
// the frame's one line for the desk's notices, where what the desk says ONCE is said: a degraded
// desk (DK-3), and later a type it cannot draw, a type to remount, a capture that failed. One notice
// at a time, each said once, never per frame: a notice is keyed by its `id`, and saying an id that is
// already standing is nothing. A plain notice stands 2.4s and goes; one that HOLDS (a notice with an
// act — the degraded desk's Reload) stands until it is withdrawn, the act taken or the state cleared.
// A module store read through `useSyncExternalStore` (board-status.ts's shape): its writers and its
// one reader live in different subtrees, and a prop between them would invent a second owner.

export interface StatusAct {
  readonly label: string;
  readonly run: () => void;
}

export interface StatusNotice {
  /** What makes it ONE notice: said again while it stands, it is not said twice. */
  readonly id: string;
  readonly text: string;
  /** The act at its end (a text button in primary ink); a notice with an act holds. */
  readonly act?: StatusAct;
  /** Stand until withdrawn rather than for the line's 2.4s (implied by `act`). */
  readonly hold?: boolean;
}

/** How long a plain notice stands (DESIGN.md §8): it rises in, then goes. */
export const STATUS_STAND_MS = 2400;

let held: StatusNotice[] = [];
let passing: StatusNotice | null = null;
let passingTimer: ReturnType<typeof setTimeout> | null = null;
let shown: StatusNotice | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  // the passing notice is the latest word; a held one stands under it, the newest first
  const next = passing ?? held[held.length - 1] ?? null;
  if (next === shown) return;
  shown = next;
  for (const fn of listeners) fn();
}

const holds = (notice: StatusNotice): boolean => notice.hold === true || notice.act !== undefined;

/** Say a notice on the line — once: an id already standing is not said again. */
export function sayStatus(notice: StatusNotice): void {
  if (passing?.id === notice.id || held.some((h) => h.id === notice.id)) return;
  if (holds(notice)) {
    held = [...held, notice];
  } else {
    if (passingTimer !== null) clearTimeout(passingTimer);
    passing = notice;
    passingTimer = setTimeout(() => {
      passingTimer = null;
      passing = null;
      publish();
    }, STATUS_STAND_MS);
  }
  publish();
}

/** The state that held a notice has cleared, or its act was taken: it goes. */
export function withdrawStatus(id: string): void {
  if (passing?.id === id) {
    if (passingTimer !== null) clearTimeout(passingTimer);
    passingTimer = null;
    passing = null;
  }
  held = held.filter((h) => h.id !== id);
  publish();
}

export function subscribeStatusLine(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getStatusNotice(): StatusNotice | null {
  return shown;
}

/** The one notice on the line now, or null. */
export function useStatusNotice(): StatusNotice | null {
  return useSyncExternalStore(subscribeStatusLine, getStatusNotice, getStatusNotice);
}

/** Test seam: an empty line, no timers. */
export function resetStatusLineForTest(): void {
  if (passingTimer !== null) clearTimeout(passingTimer);
  passingTimer = null;
  passing = null;
  held = [];
  shown = null;
  listeners.clear();
}
