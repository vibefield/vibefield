import type { SparkId } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";
import type { PendingSay } from "./transcript-items";

// YOUR WORDS BEFORE THE RECORD HAS THEM (TH-1; DESIGN.md §8 "Chat's thread", your words; "Chat's composer", Send). A
// send's bubble stands in the flow at once: from the moment it passes the window's own checks until the spark's record
// shows its `you` line (matched by its request id, `transcriptItemsOf`), with the say's receipt once fieldd answers.
// A send refused leaves no bubble. A module store, for the window's life and written nowhere (HN-D9's rule): a thread
// left and shown again finds its sends still standing.

/** The sends a thread holds at most: the newest, so a window that sends all day keeps a bounded list. */
const KEPT = 32;

const NONE: readonly PendingSay[] = Object.freeze([]);
let pending: ReadonlyMap<SparkId, readonly PendingSay[]> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<SparkId, readonly PendingSay[]>): void {
  pending = next;
  for (const listener of listeners) listener();
}

function update(
  spark: SparkId,
  change: (held: readonly PendingSay[]) => readonly PendingSay[],
): void {
  const held = pending.get(spark) ?? NONE;
  const next = change(held);
  if (next === held) return;
  const map = new Map(pending);
  if (next.length === 0) map.delete(spark);
  else map.set(spark, next);
  publish(map);
}

/** A send passed the window's checks: its bubble stands, newest last. */
export function standPendingSay(spark: SparkId, say: PendingSay): void {
  update(spark, (held) =>
    [...held.filter((each) => each.requestId !== say.requestId), say].slice(-KEPT),
  );
}

/** A send's answer: its receipt's state, or null for a send not taken, whose bubble leaves. */
export function settlePendingSay(spark: SparkId, requestId: string, state: string | null): void {
  update(spark, (held) => {
    if (!held.some((each) => each.requestId === requestId)) return held;
    return state === null
      ? held.filter((each) => each.requestId !== requestId)
      : held.map((each) => (each.requestId === requestId ? { ...each, state } : each));
  });
}

/** The record shows these sends: their bubbles are the record's now. */
export function letGoPendingSays(spark: SparkId, said: ReadonlySet<string>): void {
  update(spark, (held) =>
    held.some((each) => said.has(each.requestId))
      ? held.filter((each) => !said.has(each.requestId))
      : held,
  );
}

export function pendingSaysNow(spark: SparkId): readonly PendingSay[] {
  return pending.get(spark) ?? NONE;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The shown thread's sends the record does not show yet, oldest first. */
export function usePendingSays(spark: SparkId | null): readonly PendingSay[] {
  return useSyncExternalStore(subscribe, () => (spark === null ? NONE : pendingSaysNow(spark)));
}

/** Tests: a fresh window's store. */
export function resetPendingSaysForTest(): void {
  publish(new Map());
}
