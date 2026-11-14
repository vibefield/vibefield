import type { DeskTrayDoor, TrayAnchor } from "@vibecook/ice/desk";
import { useMemo, useSyncExternalStore } from "react";
import { currentDesk, type MountedDesk, subscribeDesk } from "../desk-door";

// THE PEGBOARD'S DOOR, followed across mounts (DK-13; DESIGN.md §8 "The pegboard — Objects, behind the line", "The
// doors"): ICE gives the chrome data, never pixels — `handle.tray` opens, closes and toggles the drawer (`open()`
// answering false while an object is in hand), chooses its category, and publishes its anchor (`TrayAnchor`: the
// drawer as the last frame drew it — its slide, its clear header band — the hand, the categories) after each frame
// that moved it, never at rest. The chrome lives outside the stage, so it reads the tray of the desk MOUNTED NOW: a
// Reload, a kinds remount or a new document generation makes a new handle, and every reader follows it here, once.
// MK-4d: the Plugins popup's door to the board is here too — a showing of a set after an install (`showOnBoard`), which
// the pegboard's controller lands across that remount.
// MK-4d's names (James's MK-O10 pick A): the popup reads the board's names here too
// (`useBoardNames`) — each category the board hangs and the board's own name for it — by which
// What it adds and Installed's line say where a set hangs.

/** The mounted desk's tray door — absent on a handle without one (a test's double), and with no desk. */
export const trayOf = (desk: MountedDesk | null): DeskTrayDoor | null =>
  (desk?.handle as { tray?: DeskTrayDoor } | undefined)?.tray ?? null;

/** The tray door of the desk mounted now, or null. */
export function boardDoor(): DeskTrayDoor | null {
  return trayOf(currentDesk());
}

/** The board's anchor as the mounted desk last published it, or null with no desk. */
export function boardAnchor(): TrayAnchor | null {
  return boardDoor()?.anchor() ?? null;
}

/**
 * Told after each frame that moved the mounted desk's tray anchor (the slide frame by frame, the hand, the category),
 * and once whenever the mounted desk changes (a remount's new anchor, or none). Returns the unsubscribe.
 */
export function subscribeBoard(fn: () => void): () => void {
  let off: (() => void) | null = null;
  const follow = (): void => {
    off?.();
    off = boardDoor()?.subscribe(fn) ?? null;
  };
  follow();
  const offDesk = subscribeDesk(() => {
    follow();
    fn();
  });
  return () => {
    offDesk();
    off?.();
    off = null;
  };
}

/** What the line's create knows of the board: whether it is out, and whether an object is in hand (R14). */
export interface BoardFacts {
  /** The board is out — the tray's `open` fact (its slide may still be on its way). */
  readonly open: boolean;
  /** An object is IN HAND: the desk refuses the board, the create is faint, "Put it down first" (R14). */
  readonly held: boolean;
}

/**
 * The line's door to the board (DK-13): its facts, and the create's act — `handle.tray.toggle()` — which answers
 * whether the board is out now (`null`: no desk to ask). `keyboard`: the board was asked for from the keyboard (B, or
 * the create pressed by its keys), so the board takes the focus as it rises — its specimens a stop of Tab away.
 */
export interface BoardLineDoor extends BoardFacts {
  toggle(keyboard: boolean): boolean | null;
}

// ── the focus the board takes when it was asked for from the keyboard ───────────────────────────────────────────
let focusWanted = false;
const focusListeners = new Set<() => void>();

/** The board should take the focus once it is out (a keyboard open). */
export function requestBoardFocus(): void {
  focusWanted = true;
  for (const fn of [...focusListeners]) fn();
}

/** Take the pending focus request, if any (the pegboard's controller, once the board is out). */
export function takeBoardFocusRequest(): boolean {
  const wanted = focusWanted;
  focusWanted = false;
  return wanted;
}

export function subscribeBoardFocusRequest(fn: () => void): () => void {
  focusListeners.add(fn);
  return () => {
    focusListeners.delete(fn);
  };
}

/** Drop a pending request (the board refused, or closed before it rose). */
export function dropBoardFocusRequest(): void {
  focusWanted = false;
}

// ── a set shown on the board after an install (MK-4d; MK-D8's fallback B, MK-E14) ─────────────────────────────────
/** A showing asked of the board: the set's object types, in the set's own order, and which asking it is. */
export interface BoardReveal {
  readonly id: number;
  readonly types: readonly string[];
}

let reveal: BoardReveal | null = null;
let reveals = 0;
const revealListeners = new Set<() => void>();
const announceReveal = (): void => {
  for (const fn of [...revealListeners]) fn();
};

/**
 * SHOW THEM ON THE PEGBOARD (MK-D8, ruled A by James 2026-11-11; its fallback B, VF-PM's MK-E2): the Plugins popup's
 * act hands the set's object types here, in the set's own order. The pegboard's controller does the rest: over a
 * covered view it asks for Canvas first (MK-E14), raises the board holding the keyboard, and shows the set's first
 * category in the board's order with the set's first object there focused, asking again on each publish until the
 * board hangs the set (an install brings its kinds by a remount, DK-9; ICE's focus answers nothing until the board is
 * laid, I37). It stands until it lands or the person moves on, and a newer one replaces it. A set with no object asks
 * nothing (the popup offers such a set no act).
 */
export function showOnBoard(types: readonly string[]): void {
  if (types.length === 0) return;
  reveals += 1;
  reveal = { id: reveals, types: [...types] };
  announceReveal();
}

/** The showing that stands now, or null. */
export function boardReveal(): BoardReveal | null {
  return reveal;
}

export function subscribeBoardReveal(fn: () => void): () => void {
  revealListeners.add(fn);
  return () => {
    revealListeners.delete(fn);
  };
}

/** The showing `id` landed, or the person moved on: it stands no more (a newer one is left as it is). */
export function dropBoardReveal(id: number): void {
  if (reveal?.id !== id) return;
  reveal = null;
  announceReveal();
}

/** Test seam: no showing stands. */
export function resetBoardRevealForTest(): void {
  reveal = null;
}

// ── the facts as a store: one snapshot per change of what they SAY (never one per frame of the slide) ───────────────
const NO_DESK = "none";
const factsKey = (): string => {
  const door = boardDoor();
  if (door === null) return NO_DESK;
  const a = door.anchor();
  return `${a.open ? 1 : 0}${a.held ? 1 : 0}`;
};

/** The facts of the board of the desk mounted now — null with no desk (the catalog's line, a harness). */
export function useBoardFacts(): BoardFacts | null {
  const key = useSyncExternalStore(subscribeBoard, factsKey, () => NO_DESK);
  if (key === NO_DESK) return null;
  return { open: key[0] === "1", held: key[1] === "1" };
}

/** The published line door over the desk mounted now — null with no desk. */
export function useBoardLineDoor(): BoardLineDoor | null {
  const facts = useBoardFacts();
  if (facts === null) return null;
  return {
    ...facts,
    toggle(keyboard) {
      const door = boardDoor();
      if (door === null) return null;
      if (keyboard) requestBoardFocus();
      const open = door.toggle();
      if (!open) dropBoardFocusRequest();
      return open;
    },
  };
}

// ── the board's names, for the popup (MK-4d's names; James's MK-O10 pick A) ────────────────
/** The names as one string: each category's id and the board's name for it, in the board's order —
 * never its count, so a count that moves says nothing new. */
const namesKey = (): string => {
  const door = boardDoor();
  if (door === null) return NO_DESK;
  return JSON.stringify(door.anchor().categories.map((c) => [c.id, c.label]));
};

/**
 * THE PEGBOARD'S NAMES: each category the board of the desk mounted now hangs — its id, never
 * shown — and the board's own name for it, the one its filters say, in the board's order, as the
 * desk last published them (`anchor().categories`). The Plugins popup says where a set hangs by
 * them: under each object in What it adds, and on Installed's line. Null with no desk, or a handle
 * with no board (the catalog, a harness, a remount's gap). One snapshot per change of what they
 * SAY: the slide's frames, a count or the category chosen re-render nothing.
 */
export function useBoardNames(): ReadonlyMap<string, string> | null {
  const key = useSyncExternalStore(subscribeBoard, namesKey, () => NO_DESK);
  return useMemo(
    () => (key === NO_DESK ? null : new Map(JSON.parse(key) as [string, string][])),
    [key],
  );
}
