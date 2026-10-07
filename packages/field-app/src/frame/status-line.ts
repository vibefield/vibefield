import { useSyncExternalStore } from "react";

// THE STATUS LINE's store (DESIGN.md §8 "The status line", R12, R16, R18; §10: the head's place) —
// the frame's one line for the desk's notices, where what the desk says ONCE is said: a degraded
// desk (DK-3), a type it cannot draw and a type to remount (DK-11, desk-notices.ts), and later a
// capture that failed. One notice at a time, each said once, never per frame: a notice is keyed by
// its `id`, and saying an id that is already standing — or waiting its turn — is nothing. A plain
// notice stands 2.4s and goes, and one said while another stands waits its turn behind it (DK-11: a
// board with two missing kinds says each); one that HOLDS (a notice with an act — the degraded
// desk's Reload) stands until it is withdrawn, the act taken or the state cleared, a passing notice
// the latest word over it. A module store read through `useSyncExternalStore` (board-status.ts's
// shape): its writers and its one reader live in different subtrees, and a prop between them would
// invent a second owner.

export interface StatusAct {
  readonly label: string;
  readonly run: () => void;
}

export interface StatusNotice {
  /** What makes it ONE notice: said again while it stands, it is not said twice. */
  readonly id: string;
  readonly text: string;
  /** The renderer's own words after VibeField's, verbatim — small, on a row of its own, as the
   * unavailable card carries its detail (the degraded desk's: ICE's message; DK-17). */
  readonly detail?: string;
  /** The act at its end (a text button in primary ink); a notice with an act holds. */
  readonly act?: StatusAct;
  /** Stand until withdrawn rather than for the line's 2.4s (implied by `act`). */
  readonly hold?: boolean;
}

/** A notice the line said, in the order said — what a smoke counts ("said once"). */
export interface SaidNotice {
  readonly id: string;
  readonly text: string;
}

/** How long a plain notice stands (DESIGN.md §8): it rises in, then goes. */
export const STATUS_STAND_MS = 2400;

/** The said log's length: a session's notices, never the session's every word. */
const SAID_KEPT = 64;

let held: StatusNotice[] = [];
let passing: StatusNotice | null = null;
let waiting: StatusNotice[] = [];
let passingTimer: ReturnType<typeof setTimeout> | null = null;
let shown: StatusNotice | null = null;
let said: SaidNotice[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  // the passing notice is the latest word; a held one stands under it, the newest first
  const next = passing ?? held[held.length - 1] ?? null;
  if (next === shown) return;
  shown = next;
  for (const fn of listeners) fn();
}

const holds = (notice: StatusNotice): boolean => notice.hold === true || notice.act !== undefined;

function log(notice: StatusNotice): void {
  said = [...said, { id: notice.id, text: notice.text }].slice(-SAID_KEPT);
}

/** A plain notice takes the line for its 2.4s; when it goes, the next waiting one takes it. */
function pass(notice: StatusNotice): void {
  passing = notice;
  log(notice);
  passingTimer = setTimeout(() => {
    passingTimer = null;
    passing = null;
    const next = waiting[0];
    waiting = waiting.slice(1);
    if (next !== undefined) pass(next);
    publish();
  }, STATUS_STAND_MS);
}

/** Say a notice on the line — once: an id already standing, or waiting its turn, is not said again. */
export function sayStatus(notice: StatusNotice): void {
  const standing = (n: StatusNotice): boolean => n.id === notice.id;
  if (passing?.id === notice.id || held.some(standing) || waiting.some(standing)) return;
  if (holds(notice)) {
    held = [...held, notice];
    log(notice);
  } else if (passing === null) {
    pass(notice);
  } else {
    waiting = [...waiting, notice];
  }
  publish();
}

/** The state that held a notice has cleared, or its act was taken: it goes. */
export function withdrawStatus(id: string): void {
  waiting = waiting.filter((w) => w.id !== id);
  if (passing?.id === id) {
    if (passingTimer !== null) clearTimeout(passingTimer);
    passingTimer = null;
    passing = null;
    const next = waiting[0];
    waiting = waiting.slice(1);
    if (next !== undefined) pass(next);
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

/** Every notice the line has said this session, in order (the last 64) — what a harness reads. */
export function statusLineSaid(): readonly SaidNotice[] {
  return said;
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
  waiting = [];
  held = [];
  shown = null;
  said = [];
  listeners.clear();
}
