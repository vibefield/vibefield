import type { AtWorkState, ObjectPresence } from "@vibefield/contracts";

/**
 * OB-D16 (2026-11-25; DESIGN.md §8 "At work, in the pane") — WHAT A PANE'S STICKERS SAY, from the at-work feed alone.
 * The pane's run is fieldd's `runtimeRunId` (the deck's `runs`), the same id a feed row's `run` carries. A row of the
 * run's on an object is a sticker in that row's state; a `one` object the run waits for (`waiters`, which `claim` fills
 * and no row stands for) is a sticker on its backing. First held first: the first sits nearest the pane's corner.
 */

/** The sticker's state: the feed's, with `needs-you` spelled for CSS, and `waiting` for a place in a queue. */
export type PaneStickerState = Exclude<AtWorkState, "needs-you"> | "needs" | "waiting";

export interface PaneStickerItem {
  readonly ref: string;
  readonly docId: string;
  readonly key: string;
  readonly state: PaneStickerState;
  /** when this state began (the feed's `since`); a waiter's is 0 */
  readonly since: number;
  /** what the agent's last change undoes: an act landed, so the sticker is pressed once */
  readonly lastChange?: string | undefined;
  /** the run that holds a `one` object this run waits for */
  readonly holder?: string | undefined;
}

/** The stickers a pane shows at most; past it, the first two and a count. */
export const PANE_STICKERS_SHOWN = 3;

const stateOf = (state: AtWorkState): PaneStickerState => (state === "needs-you" ? "needs" : state);

/** Every object the run is on or waits for, first held first. */
export function paneStickerItems(
  objects: readonly ObjectPresence[],
  run: string | undefined,
): readonly PaneStickerItem[] {
  if (run === undefined) return [];
  const items: PaneStickerItem[] = [];
  for (const object of objects) {
    const row = object.agents.find((agent) => agent.run === run);
    if (row !== undefined) {
      items.push({
        ref: object.ref,
        docId: object.docId,
        key: object.key,
        state: stateOf(row.state),
        since: row.since,
        lastChange: row.lastChange?.label,
      });
      continue;
    }
    if (object.waiters?.includes(run) === true)
      items.push({
        ref: object.ref,
        docId: object.docId,
        key: object.key,
        state: "waiting",
        since: Number.MAX_SAFE_INTEGER,
        holder: object.holder,
      });
  }
  return items.sort((a, b) => a.since - b.since || a.ref.localeCompare(b.ref));
}

/** The stickers drawn, and how many more stand behind a count. */
export function shownStickers(items: readonly PaneStickerItem[]): {
  readonly shown: readonly PaneStickerItem[];
  readonly more: number;
} {
  if (items.length <= PANE_STICKERS_SHOWN) return { shown: items, more: 0 };
  const kept = PANE_STICKERS_SHOWN - 1;
  return { shown: items.slice(0, kept), more: items.length - kept };
}

/** What the run is doing with the object, in the words the hover chip says (the mat's, item 550). */
export function stateWords(state: PaneStickerState, holderName?: string): string {
  switch (state) {
    case "open":
      return "has it open";
    case "reading":
      return "reading it";
    case "acting":
      return "changing it";
    case "needs":
      return "needs you";
    case "paused":
      return "paused: you have it";
    case "failed":
      return "an act failed";
    case "released":
      return "let it go";
    case "waiting":
      return holderName === undefined ? "waiting for it" : `waiting: ${holderName} has it`;
  }
}

/** Its own angle, ±6° from its ref and its run, kept as the mat's sticker keeps one (a sticker is stuck on by hand). */
export function stickerAngle(ref: string, run: string): number {
  let hash = 2166136261;
  const seed = ref + run;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.round((((hash >>> 0) % 2001) / 1000 - 1) * 60) / 10;
}
