import type { DeskLightValues } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";

// THE DESK'S LIGHT, LIVE (item 583; DESIGN.md §8 "Settings → Canvas"): what this window's desks wear right now. It is
// the person's preference (`storage.appPreferences`, the key `desk.light`), except while a row of Settings → Canvas
// is in hand: the desk follows a slider as it is dragged, and the preference is written when it is let go.
// A STORE, with no daemon in it: the stage reads it (`useDeskLight`) as it reads the theme, so a stage mounts wherever
// it is mounted; the preference is put here by the field's view (`desk-light-bridge.ts`), and the rows in hand by
// Settings (`holdDeskLight`). The rows in hand are this window's alone; nothing of them is stored.

/** The person's preference with every other row at its rest; `null` until it has been read once. */
let stored: DeskLightValues | null = null;
/** The rows Settings → Canvas holds (a slider in hand, a choice on its way to fieldd). */
let held: DeskLightValues | null = null;
/** What the desks wear: the rows in hand, else the preference. One object per change, so a reader re-renders once. */
let worn: DeskLightValues | null = null;
const listeners = new Set<() => void>();

/** Two lights say the same when every row is equal (a row is a number, a boolean or a plant's id). */
function sameLight(a: DeskLightValues, b: DeskLightValues): boolean {
  const rows = Object.keys(a) as (keyof DeskLightValues)[];
  return rows.length === Object.keys(b).length && rows.every((row) => a[row] === b[row]);
}

function publish(): void {
  const next = held ?? stored;
  // BY VALUE: rows let go that say what the preference says keep the object the readers hold
  if (next === worn || (next !== null && worn !== null && sameLight(next, worn))) return;
  worn = next;
  for (const listener of [...listeners]) listener();
}

/**
 * The person's preference, as the field's view read it (`desk-light-bridge.ts`). BY VALUE: each snapshot's reading
 * is a new object, and one that says the same light again stores nothing and re-renders nothing.
 */
export function storeDeskLight(values: DeskLightValues): void {
  if (stored !== null && sameLight(stored, values)) return;
  stored = values;
  publish();
}

/** Settings → Canvas holds these rows, or lets go (`null`). */
export function holdDeskLight(values: DeskLightValues | null): void {
  if (held === values) return;
  held = values;
  publish();
}

const wornDeskLight = (): DeskLightValues | null => worn;
const onWorn = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The light a desk wears: the rows in hand, else the person's preference. `null` until the preference has been read
 * once, so a desk never shows one plant and then another: it stands in open light, as it does while a plate loads.
 */
export function useDeskLight(): DeskLightValues | null {
  return useSyncExternalStore(onWorn, wornDeskLight, wornDeskLight);
}

/** Test seam: forget the preference, the rows in hand and the readers. */
export function resetDeskLight(): void {
  stored = null;
  held = null;
  worn = null;
  listeners.clear();
}
