import type { NeedsItem, NeedsItemId, SparkId } from "@vibefield/contracts";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StatusNotice } from "../frame/status-line";
import { NO_HANDLES } from "./at-rows";
import {
  NEEDS_FADE_MS,
  NEEDS_LEAVE_MS,
  NEEDS_SAID_MS,
  type NeedsAct,
  type NeedsCard,
  needsCardOf,
  needsNamesOf,
  needsRefused,
  needsSaid,
  waitingCardOf,
} from "./needs-card";
import type { SparkEntry } from "./spark-status";

// THE NEEDS-YOU CARD, KEPT STANDING (CP-3; DESIGN.md §8 "Chat's thread", the needs-you card: answering, answered here,
// answered in another window, motion, the keyboard). Chat's controller (`ChatView`) asks this for the card its shown
// thread stands, and hands it the presses. One card at a time, the oldest first: it rises in, stands while its item
// waits, and leaves — at once when its item no longer waits (answered in another window, or ended); answered or
// refused here, after a note's time and once its item has left the queue, a refused one's acts quiet meanwhile — and
// the next rises only once it has gone.
// A card this window is answering stands from the press until fieldd's answer returns, whatever the queue says
// meanwhile (fieldd drops the item once the answer is recorded, before it has told the spark). A thread left takes its
// card at once; an answer it was running still returns, and what did not go as asked, or was refused, is said on the
// status line. The keyboard is never taken by a card that arrives; a pressed act puts it on the card, and a card that
// leaves holding it hands it to the next card, else to the draft. What it answers is this window's alone, for its
// life, written nowhere. It names a session by @'s handles in the shown thread, handed in live (track CO, the handle),
// so the card and @ agree at every moment; an answer that returns off screen is said under the names it was pressed
// under, since the handles handed in by then may be another thread's.

/** What the card answers with, and where else it speaks. */
export interface NeedsCardDoors {
  /** needs.answer through the window's feed: the answered item, or fieldd's refusal thrown; null while no feed reads
   * the queue, so nothing is answered */
  readonly answer: ((item: NeedsItemId, choice: number) => Promise<NeedsItem>) | null;
  /** the status line: what an answer came to once its card has left the screen */
  readonly say: (notice: StatusNotice) => void;
  /** the thread's draft takes the keyboard */
  readonly focusDraft: () => void;
}

/** An answer this window gave, by its item: its card stands for it whatever the queue says meanwhile. */
interface Answering {
  readonly spark: SparkId;
  /** the item as pressed; answered, the item fieldd handed back with its answer */
  readonly item: NeedsItem;
  readonly act: Exclude<NeedsAct, { readonly state: "idle" }>;
  /** it stands though its item no longer waits: while its answer runs, and for a note's time after it returns */
  readonly holds: boolean;
}

type AnswerMap = ReadonlyMap<NeedsItemId, Answering>;

const NONE: AnswerMap = new Map();

/** A note's time over: what the card said stops holding it. It stays while its item still waits (a refused one, to be
 * answered again), and leaves once its item does not. An answer pressed again meanwhile is left as it is. */
function letGo(held: Answering | undefined, state: "said" | "refused"): Answering | null {
  if (held === undefined) return null;
  return held.act.state === state ? { ...held, holds: false } : held;
}

/** The card the thread should stand now: the one this window answers, while it holds or its item still waits; else
 * the oldest item waiting. */
function wantedOf(
  entry: SparkEntry | undefined,
  answering: AnswerMap,
  reduced: boolean,
  handles: ReadonlyMap<string, string>,
): NeedsCard | null {
  if (entry === undefined) return null;
  for (const held of answering.values()) {
    if (held.spark !== entry.spark.id) continue;
    const waiting = entry.items.find((each) => each.id === held.item.id);
    if (waiting === undefined && !held.holds) continue;
    const item = held.act.state === "said" ? held.item : (waiting ?? held.item);
    return needsCardOf(entry, item, held.act, { reduced, handles });
  }
  return waitingCardOf(entry, { reduced, handles });
}

/** The same card drawn the same way: what stands is kept, so nothing redraws for a frame that changed nothing. */
function sameCard(a: NeedsCard, b: NeedsCard): boolean {
  return (
    a.item === b.item &&
    a.act === b.act &&
    a.of === b.of &&
    a.waits === b.waits &&
    a.reduced === b.reduced &&
    a.leaving === b.leaving &&
    a.spark.id === b.spark.id &&
    a.spark.name === b.spark.name &&
    a.names.from === b.names.from &&
    a.names.to === b.names.to
  );
}

export interface NeedsCardStand {
  /** the card standing in the shown thread (leaving, for its way out), or null */
  readonly card: NeedsCard | null;
  /** an act pressed on it, by its place */
  readonly answer: (item: NeedsItem, choice: number) => void;
  /** the card's own element: the keyboard goes to it */
  readonly cardRef: RefObject<HTMLDivElement | null>;
}

/**
 * The card `entry`'s thread stands. `onScreen`: that thread is on screen (Chat is the view, and shows it) — an answer
 * that returns while it is not says what it came to on the status line. `reduced`: the person asked for reduced motion.
 * `handles`: @'s handles in that thread (`sessionHandlesOf`, by run id), which name its sessions; none, fieldd's names.
 */
export function useNeedsCard(
  entry: SparkEntry | undefined,
  onScreen: boolean,
  reduced: boolean,
  doors: NeedsCardDoors,
  handles: ReadonlyMap<string, string> = NO_HANDLES,
): NeedsCardStand {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [answering, setAnswering] = useState<AnswerMap>(NONE);
  const answeringNow = useRef<AnswerMap>(NONE);
  const [standing, setStanding] = useState<NeedsCard | null>(null);
  /** the leaving card's way out */
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the card that left held the keyboard: the next card takes it, else the draft */
  const keyboardOwed = useRef(false);
  const live = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  // what the async answer reads when it returns: the thread on screen now, and the doors as last handed in
  const shownNow = useRef<SparkId | null>(null);
  shownNow.current = onScreen ? (entry?.spark.id ?? null) : null;
  const entryNow = useRef(entry);
  entryNow.current = entry;
  const doorsNow = useRef(doors);
  doorsNow.current = doors;
  const handlesNow = useRef(handles);
  handlesNow.current = handles;

  useEffect(() => {
    live.current = true;
    const pending = timers.current;
    return () => {
      live.current = false;
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    };
  }, []);

  const later = useCallback((ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  }, []);

  /** Change what this window answers, by item. */
  const change = useCallback(
    (id: NeedsItemId, next: (held: Answering | undefined) => Answering | null) => {
      const map = new Map(answeringNow.current);
      const now = next(map.get(id));
      if (now === null) map.delete(id);
      else map.set(id, now);
      answeringNow.current = map;
      if (live.current) setAnswering(map);
    },
    [],
  );

  // what a card said is said where it began, once: a thread that leaves the screen takes its refusals and its "You
  // said …" with it; an answer still running stays, to stand its card again or to be said on the status line
  const shownId = onScreen ? (entry?.spark.id ?? null) : null;
  useEffect(() => {
    for (const [id, held] of answeringNow.current)
      if (held.act.state !== "busy" && held.spark !== shownId) change(id, () => null);
  }, [shownId, change]);

  // an answer whose note's time is over, and whose item has left the queue, is forgotten
  useEffect(() => {
    if (entry === undefined) return;
    for (const [id, held] of answering)
      if (
        held.spark === entry.spark.id &&
        !held.holds &&
        !entry.items.some((each) => each.id === id)
      )
        change(id, () => null);
  }, [entry, answering, change]);

  // keep the card standing: enter, stay, leave, or go with its thread
  const sparkId = entry?.spark.id ?? null;
  useLayoutEffect(() => {
    const wanted = wantedOf(entry, answering, reduced, handles);
    const prev = standing;
    if (prev === null || prev.spark.id !== sparkId) {
      // nothing stands, or the thread changed (its card goes at once): the wanted card rises, if any
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
      if (prev !== null) keyboardOwed.current = false;
      if (wanted === null && keyboardOwed.current) {
        keyboardOwed.current = false;
        doorsNow.current.focusDraft();
      }
      if (wanted !== prev) setStanding(wanted);
      return;
    }
    if (prev.leaving) return;
    if (wanted !== null && wanted.item.id === prev.item.id) {
      if (!sameCard(prev, wanted)) setStanding(wanted);
      return;
    }
    // its item no longer stands: it leaves, inert, and the next waits for it to go
    const card = cardRef.current;
    keyboardOwed.current = card?.contains(card.ownerDocument.activeElement) ?? false;
    setStanding({ ...prev, leaving: true });
    leaveTimer.current = setTimeout(
      () => {
        leaveTimer.current = null;
        if (live.current) setStanding(null);
      },
      prev.reduced ? NEEDS_FADE_MS : NEEDS_LEAVE_MS,
    );
  });

  // the card that takes a leaving card's place takes the keyboard it held: the card, never an act
  useLayoutEffect(() => {
    if (!keyboardOwed.current || standing === null || standing.leaving) return;
    keyboardOwed.current = false;
    cardRef.current?.focus();
  }, [standing]);

  const answer = useCallback(
    (item: NeedsItem, choice: number) => {
      const door = doorsNow.current.answer;
      const shown = entryNow.current;
      if (door === null || shown === undefined) return;
      const spark = shown.spark.id;
      // one answer at a time to an item; a refused one may be answered again while its item still waits
      const prior = answeringNow.current.get(item.id);
      const waits = shown.items.some((each) => each.id === item.id);
      if (prior !== undefined && (prior.act.state !== "refused" || !waits)) return;
      // the names the card says as it is pressed: what returns off screen is said under them
      const names = needsNamesOf(item, handlesNow.current);
      cardRef.current?.focus();
      change(item.id, () => ({ spark, item, act: { state: "busy", choice }, holds: true }));
      const here = () => live.current && shownNow.current === spark;
      door(item.id, choice).then(
        (done) => {
          if (here()) {
            // "You said …" for a note's time, then it leaves with its item (fieldd has dropped it, or drops it now)
            change(item.id, () => ({
              spark,
              item: done,
              act: { state: "said", choice },
              holds: true,
            }));
            later(NEEDS_SAID_MS, () => change(item.id, (held) => letGo(held, "said")));
            return;
          }
          change(item.id, () => null);
          const said = needsSaid(done, choice, names);
          if (said.tone !== "done")
            doorsNow.current.say({ id: `needs-answer:${item.id}`, text: said.text });
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          if (!here()) {
            // its card has left the screen: the refusal is said on the status line, in the card's words
            change(item.id, () => null);
            doorsNow.current.say({ id: `needs-answer:${item.id}`, text: needsRefused(reason) });
            return;
          }
          change(item.id, () => ({ spark, item, act: { state: "refused", reason }, holds: true }));
          later(NEEDS_SAID_MS, () => change(item.id, (held) => letGo(held, "refused")));
        },
      );
    },
    [change, later],
  );

  return { card: standing, answer, cardRef };
}
