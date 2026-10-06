import type { DeskTrayDoor, TrayAnchor } from "@vibecook/ice/desk";
import { useSyncExternalStore } from "react";
import { currentDesk, type MountedDesk, subscribeDesk } from "../desk-door";

// THE PEGBOARD'S DOOR, followed across mounts (DK-13; DESIGN.md §8 "The pegboard — Objects, behind the line", "The
// doors"): ICE gives the chrome data, never pixels — `handle.tray` opens, closes and toggles the drawer (`open()`
// answering false while an object is in hand), chooses its category, and publishes its anchor (`TrayAnchor`: the
// drawer as the last frame drew it — its slide, its clear header band — the hand, the categories) after each frame
// that moved it, never at rest. The chrome lives outside the stage, so it reads the tray of the desk MOUNTED NOW: a
// Reload, a kinds remount or a new document generation makes a new handle, and every reader follows it here, once.

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
