import { useSyncExternalStore } from "react";

// THE ME MENU ROW'S COUNT (MK-4b; DESIGN.md §8 "The Me menu"; VF-PM's C1): "1 update" says what the last read
// found, and opening the menu reads nothing. One value per window, module-level as the registry store is
// (`plugin-host/plugin-registry-store.ts`). Two writers, and nothing here reads fieldd:
// - the popup takes every answer it takes (`takePluginUpdates`), in the order it takes them;
// - the frame's one ask as the window opens (`primePluginUpdates`: the list fieldd already holds, MK-4b's ‹draft›
//   line in §8) counts only until the popup's first answer, so a late answer to it never replaces a newer read.
// null: nothing read in this window yet, and the row says no count.

let updates: number | null = null;
let popupAnswered = false;
let windowAsked = false;
const listeners = new Set<() => void>();

/** The frame's ask as the window opens claims its one turn here: true once per window, then false, however often
 * the frame mounts again. */
export function claimWindowAsk(): boolean {
  if (windowAsked) return false;
  windowAsked = true;
  return true;
}

function set(next: number): void {
  if (next === updates) return;
  updates = next;
  for (const fn of listeners) fn();
}

/** The popup's answer: the count it shows, always. */
export function takePluginUpdates(count: number): void {
  popupAnswered = true;
  set(count);
}

/** The window's one ask as it opens: it counts until the popup answers, never after. */
export function primePluginUpdates(count: number): void {
  if (!popupAnswered) set(count);
}

export function getPluginUpdates(): number | null {
  return updates;
}

export function subscribePluginUpdates(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePluginUpdates(): number | null {
  return useSyncExternalStore(subscribePluginUpdates, getPluginUpdates);
}

/** A test's own setup: the store as a window starts it. Nothing in the product calls it. */
export function resetPluginUpdates(): void {
  updates = null;
  popupAnswered = false;
  windowAsked = false;
  for (const fn of listeners) fn();
}
