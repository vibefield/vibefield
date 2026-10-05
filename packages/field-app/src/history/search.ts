import type { HistoryRoomHandle } from "@rosetta/room";
import { type RefObject, useEffect, useRef } from "react";
import { type FrameSurface, foldSurface } from "../frame/frame-surface";
import type { ViewKeys } from "../frame/views";

// HISTORY'S SEARCH, UNTIL THE PEEK LANDS (the search interim, ruled by James
// 2026-10-04; DESIGN.md §8 "History"). AR-D41's end state stands — the Peek is
// the one search, and the room's sheet does not ship once it lands — so this
// module is dated and leaves with the interim. Until then History searches
// with the room's OWN sheet: its strip's launcher grows into it, a hit opens
// its session and lands the transcript on the message, and the stepper the
// sheet leaves in the transcript's head walks the session's other matches.
//
// The host decides two things here and the room prints what it is told
// (RO-14, rosetta `856bd80`; its README's "What a host decides"):
//   - The sheet's open state is the FRAME's one value (`frame-surface.ts`,
//     `history-search`), so the palette, a drawer, the Me menu, Settings and a
//     change of view fold the sheet, and opening it folds them. No key opens
//     it: ⌘K is the palette's (One Frame §7), so the launcher prints none
//     (`shortcut: null`, said in `HistoryRoomView`).
//   - ⌘G / ⇧⌘G — Ctrl G / Ctrl Shift G off the Mac — walk the stepper, because
//     the stepper names those keys and the room binds none itself. They are
//     heard on the window's capture phase (the product chords' rule) while
//     History is the view and nothing of the frame's is open, the sheet
//     included; when the room has nothing to walk the key is left alone.
// Nothing here imports the room's code: its types only, which are erased, so
// the controller and the catalog keep the room on its own chunk.

/** The room's sheet as its host holds it: whether it is open, and how the
 * room asks to open or close it. */
export interface HistorySearchSheet {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The query the room opens with — the catalog's search plate holds one;
   * the product passes none. */
  readonly initialQuery?: string;
}

/** The sheet over the frame's one value: open while the value is
 * `history-search`. Opening asks the owner for it, which folds whatever else
 * was open; a close of its own folds it and leaves any other surface alone. */
export function historySearchSheet(
  surface: FrameSurface | null,
  onSurfaceChange: (next: FrameSurface | null) => void,
): HistorySearchSheet {
  return {
    open: surface === "history-search",
    onOpenChange: (open) =>
      onSurfaceChange(open ? "history-search" : foldSurface(surface, "history-search")),
  };
}

type MatchKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** ⌘G (Ctrl G off the Mac) walks to the next match, ⇧⌘G (Ctrl Shift G) to the
 * previous; anything else is null. Never with ⌥, and never the other
 * platform's modifier — the keys the stepper prints, and only those. */
export function matchStepOf(event: MatchKey, keys: ViewKeys): 1 | -1 | null {
  const command =
    keys === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.altKey) return null;
  if (event.key !== "g" && event.key !== "G") return null;
  return event.shiftKey ? -1 : 1;
}

/** Bind ⌘G / ⇧⌘G to the room's stepper while `active` (History is the view):
 * on the window's capture phase, so a key aimed anywhere in the window is
 * heard before anything else answers it. A key is claimed only when the room
 * walked — with something of the frame's open (`frameOpen`, the sheet
 * included), no room mounted yet, or no match to walk, it is left alone. */
export function useMatchStepKeys({
  active,
  frameOpen,
  keys,
  room,
}: {
  active: boolean;
  frameOpen: boolean;
  keys: ViewKeys;
  room: RefObject<HistoryRoomHandle | null>;
}): void {
  const frameOpenNow = useRef(frameOpen);
  frameOpenNow.current = frameOpen;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      const delta = matchStepOf(event, keys);
      if (delta === null || frameOpenNow.current) return;
      if (room.current?.stepMatch(delta) !== true) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, keys, room]);
}
