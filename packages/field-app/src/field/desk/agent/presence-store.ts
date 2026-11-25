import type { ObjectPresence } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";

/**
 * OB-D16 (2026-11-25) — THE AT-WORK FEED, HELD FOR THE WINDOW. `objects.presence.subscribe` admits one subscriber a
 * window (`subscription-admission.ts`, class `one`), and the desk's applier is it (`applier.ts`): it publishes every
 * snapshot here, whole — every board's objects, each with its agents, its holder and its waiters — so Godview's panes
 * read who holds what without a second subscription. Empty until the first snapshot, and again when the applier stops.
 */
let current: readonly ObjectPresence[] = [];
const listeners = new Set<() => void>();

export function publishPresence(objects: readonly ObjectPresence[]): void {
  if (objects === current) return;
  current = objects;
  for (const listener of [...listeners]) listener();
}

export function getPresence(): readonly ObjectPresence[] {
  return current;
}

export function subscribePresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePresence(): readonly ObjectPresence[] {
  return useSyncExternalStore(subscribePresence, getPresence, getPresence);
}
