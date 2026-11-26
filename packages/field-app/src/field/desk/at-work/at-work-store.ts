import { OBJECT_ROOM, type ObjectsPresenceSnapshot } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";
import { AT_WORK_LEAVE_MS } from "./at-work-model";
import { type AtWorkObject, readAtWorkObjects } from "./at-work-rows";

// THE AT-WORK STORE (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat"). The window's one reading of who is at
// work on the mounted board's objects, fed by the applier's own presence feed (`startApplier` → `atWorkStore.publish`),
// never a second subscription. It holds one board's objects: a publish for another board replaces it, and `current`
// answers an empty board to any other board. The selection bar reads it too, for its foot's clearance (`SelectionBar`).
//
// WHEN IT IS EMPTY. Nothing on the desk claims work without a feed: the applier clears the store when it stops (a
// remount, a user switch), when the presence feed ends or is refused, and when the client leaves `ready` (a reconnect).
// The replay's snapshot refills it, and the runs on the first board after a clear LAND: they are already at work, so
// the model shows them settled, never arriving (`landed`). A run first seen on a later board arrives; a landed run
// that leaves the feed and comes back arrives too.
//
// Named for the mark, never "presence": that word on the desk is ICE's peer presence (the stillness rows' wake reason).
// Module state in the sparks feed's pattern (`chat/sparks-feed.ts`): `current` is stable between publishes, so a view
// reads it with `useSyncExternalStore` and draws again only on a change.
//
// WHEN A MARK HAS LEFT (item 550, 2026-11-19; track EY, EY-1). A pane an agent's run made leaves the desk on its at-work
// leaving (`whenAtWorkLeft`), so the store keeps, by object key, when the object's last at-work row stopped (released,
// or gone from the feed), on its own clock. The door reads the store, never the layer: the layer steps an object only
// while it is placed and on screen in a shown layer, and a made pane is often none of those.

/** The board as the store holds it. */
export interface AtWorkBoard {
  /** the board these objects lie on; null while the store is empty */
  readonly docId: string | null;
  /** the objects agents are at work on, by the object's durable key, in the feed's order */
  readonly objects: ReadonlyMap<string, AtWorkObject>;
  /** by key, the runs that land without arriving: on the object since the feed began, or began again */
  readonly landed: ReadonlyMap<string, ReadonlySet<string>>;
  /** counts the clears: a reader whose epoch moved drops what it drew at once, with no leaving */
  readonly epoch: number;
}

export interface AtWorkStore {
  /** A snapshot of the applier's feed, for the board `docId` (the store keeps that board's objects alone). */
  publish(docId: string, snapshot: ObjectsPresenceSnapshot): void;
  /** No feed: nothing claims work. The next publish lands its runs. */
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** The board `docId` as the store holds it now: the same object until the next change. */
  current(docId: string): AtWorkBoard;
  /** Item 550 (2026-11-19; track EY, EY-1): `then`, once, when the at-work mark has left the object `key` of the board
   * the store holds: AT_WORK_LEAVE_MS after its last at-work row stopped (released, or gone from the feed); at once when
   * none is at work on it and none stopped that recently, and when the store clears; never later than
   * OBJECT_ROOM.RELEASED_SHOWN_MS after the call. `then` is never called inside this call, nor inside a publish.
   * Returns the cancel, which may be called again. */
  whenLeft(key: string, then: () => void): () => void;
}

const NO_OBJECTS: ReadonlyMap<string, AtWorkObject> = new Map();
const NO_LANDED: ReadonlyMap<string, ReadonlySet<string>> = new Map();

const emptyBoard = (epoch: number): AtWorkBoard => ({
  docId: null,
  objects: NO_OBJECTS,
  landed: NO_LANDED,
  epoch,
});

/** Whether an agent is at work on `object`: a row on it that is not released. PURE. */
const atWork = (object: AtWorkObject | undefined): boolean =>
  object?.agents.some((row) => row.state !== "released") ?? false;

/** A store of its own (the window's is `atWorkStore`; a test makes one per row, on its own clock). */
export function createAtWorkStore(clock: () => number = () => performance.now()): AtWorkStore {
  let board = emptyBoard(0);
  /** the board another board's reader sees: empty, one per epoch so it is stable */
  let elsewhere = board;
  /** the last published board's rows as they were spelled: an unmoved board notifies nobody */
  let spelled: string | null = null;
  /** true until the first publish after a clear: that board's runs land */
  let fresh = true;
  const listeners = new Set<() => void>();
  /** by object key, when (by `clock`) the object's last at-work row stopped: what a made pane's door waits on */
  const stopped = new Map<string, number>();
  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    publish(docId, snapshot) {
      const objects = readAtWorkObjects(snapshot, docId);
      const spelling = JSON.stringify([docId, objects]);
      if (!fresh && spelling === spelled) return;
      const landed = new Map<string, ReadonlySet<string>>();
      for (const object of objects) {
        const before = fresh ? undefined : board.landed.get(object.key);
        const runs = new Set<string>();
        for (const row of object.agents) {
          if (fresh || before?.has(row.run) === true) runs.add(row.run);
        }
        if (runs.size > 0) landed.set(object.key, runs);
      }
      const next = new Map(objects.map((object) => [object.key, object] as const));
      // a made pane's door: when each object's last at-work row stopped (released, or gone from the feed)
      const now = clock();
      for (const [key, at] of stopped) {
        if (now - at >= AT_WORK_LEAVE_MS) stopped.delete(key);
      }
      for (const [key, was] of board.objects) {
        if (atWork(was) && !atWork(next.get(key))) stopped.set(key, now);
      }
      for (const [key, object] of next) {
        if (atWork(object)) stopped.delete(key);
      }
      spelled = spelling;
      fresh = false;
      board = {
        docId,
        objects: next,
        landed: landed.size > 0 ? landed : NO_LANDED,
        epoch: board.epoch,
      };
      emit();
    },
    clear() {
      stopped.clear();
      fresh = true;
      spelled = null;
      if (board.docId === null) return;
      board = emptyBoard(board.epoch + 1);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current(docId) {
      if (board.docId === docId) return board;
      if (elsewhere.epoch !== board.epoch) elsewhere = emptyBoard(board.epoch);
      return elsewhere;
    },
    whenLeft(key, then) {
      let settled = false;
      let cancelled = false;
      let leaveAt: number | null = null;
      let leave: ReturnType<typeof setTimeout> | null = null;
      const stopLeave = (): void => {
        if (leave !== null) clearTimeout(leave);
        leave = null;
        leaveAt = null;
      };
      const end = (): void => {
        settled = true;
        listeners.delete(look);
        clearTimeout(cap);
        stopLeave();
      };
      const settle = (): void => {
        if (settled) return;
        end();
        // never inside the call nor a publish: the caller takes an object off the desk
        queueMicrotask(() => {
          if (!cancelled) then();
        });
      };
      // at work: wait; stopped within the leaving: wait out the rest; else the mark has left
      function look(): void {
        if (settled) return;
        if (atWork(board.objects.get(key))) {
          stopLeave();
          return;
        }
        const at = stopped.get(key);
        const now = clock();
        if (at === undefined || now - at >= AT_WORK_LEAVE_MS) {
          settle();
          return;
        }
        const until = at + AT_WORK_LEAVE_MS;
        if (leaveAt === until) return;
        stopLeave();
        leaveAt = until;
        // a timer that wakes a hair early looks again and waits out what is left
        leave = setTimeout(() => {
          leave = null;
          leaveAt = null;
          look();
        }, until - now);
      }
      listeners.add(look);
      // the released row's own stay: neither a release that never comes nor another agent holds the pane
      const cap = setTimeout(settle, OBJECT_ROOM.RELEASED_SHOWN_MS);
      look();
      return () => {
        cancelled = true;
        if (!settled) end();
      };
    },
  };
}

/** The window's store: the applier publishes into it, the at-work layer and its names read it. */
export const atWorkStore: AtWorkStore = createAtWorkStore();

/** Item 550 (2026-11-19; track EY, EY-1): `then`, once, when the at-work mark has left the object `objectKey`, by the
 * window's store (`AtWorkStore.whenLeft`): a pane an agent's run made leaves the desk on it (DESIGN.md §8 "At work on
 * the mat"). Returns the cancel. */
export function whenAtWorkLeft(
  objectKey: string,
  then: () => void,
  store: AtWorkStore = atWorkStore,
): () => void {
  return store.whenLeft(objectKey, then);
}

/** The board `docId` as the window's store holds it, drawn again on each change. */
export function useAtWorkBoard(docId: string, store: AtWorkStore = atWorkStore): AtWorkBoard {
  return useSyncExternalStore(store.subscribe, () => store.current(docId));
}
