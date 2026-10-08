import type { RoomTarget } from "@rosetta/room";
import { useSyncExternalStore } from "react";

// WHERE THE FRAME OPENS HISTORY AT A LINE (DESIGN.md §8 "Search — the Peek",
// "History"; GV-D8, 2026-10-08). The Peek is the frame's and History is a view
// below it: a past row picked in the popup asks History's room to open that
// session at that message, through the room's own `openAt` — which only the
// view holding the room's handle can call. So the frame publishes the place
// here and History's controller hands it to the room.
//
// A module store (line-door.ts's shape, for the same reason): the publisher
// sits in the frame and the reader deep inside the cover, and threading a prop
// between them would make ChromeLayer a second owner of something it never
// reads. Each ask is a FRESH object, even for the same place twice: the
// room's effect is keyed on the target's identity (`HistoryRoomView`), so a
// second pick of the same line opens it again. Types only from the room — they
// are erased, so nothing here pulls the room's chunk into the frame's.

let target: RoomTarget | null = null;
const listeners = new Set<() => void>();

/** The frame's side: open History's room at this session — and, when named,
 * this message. */
export function openHistoryAt(next: RoomTarget): void {
  target = { sessionId: next.sessionId, timelineId: next.timelineId ?? null };
  for (const fn of [...listeners]) fn();
}

export function getHistoryOpenAt(): RoomTarget | null {
  return target;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** History's side: the newest place asked, or null before the first. */
export function useHistoryOpenAt(): RoomTarget | null {
  return useSyncExternalStore(subscribe, getHistoryOpenAt, getHistoryOpenAt);
}

/** Tests: forget the last place asked. */
export function resetHistoryOpenAtForTest(): void {
  target = null;
  for (const fn of [...listeners]) fn();
}
