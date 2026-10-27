import { useSyncExternalStore } from "react";

// SETTINGS, OPENED FROM INSIDE THE COVER (track AO, AO-6b2; DESIGN.md §8 "The
// moments"). Settings is the frame's (`ChromeLayer`'s `openSettings`), and the
// limit moment stands on Godview's claims strip, inside the cover: the frame
// publishes this door and the moment's act runs it. The module-store shape of
// `system-control-door.ts`, with publisher and reader swapped, for the same
// reason: a prop drilled from the frame down into the cover would make the
// cover a second owner of the panel it only asks for.

/** Where Settings opens: the pages a door outside the panel may ask for.
 * `new-profile` is Agent Profiles on its New profile… form. */
export type SettingsTarget = "general" | "account" | "new-profile";

export interface SettingsDoor {
  open(target: SettingsTarget): void;
}

let door: SettingsDoor | null = null;
const listeners = new Set<() => void>();

/** The frame's side: publish while the chrome is mounted, null when it goes. */
export function publishSettingsDoor(next: SettingsDoor | null): void {
  if (next === door) return;
  door = next;
  for (const fn of listeners) fn();
}

export function getSettingsDoor(): SettingsDoor | null {
  return door;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The asker's side: whether Settings can be opened from here (an act draws
 * itself waiting while there is no door, and never runs). */
export function useSettingsDoor(): SettingsDoor | null {
  return useSyncExternalStore(subscribe, getSettingsDoor, getSettingsDoor);
}

/** Open Settings at `target`. False when no frame lends the door. */
export function openSettingsAt(target: SettingsTarget): boolean {
  if (door === null) return false;
  door.open(target);
  return true;
}

/** Test seam. */
export function resetSettingsDoorForTest(): void {
  door = null;
  listeners.clear();
}
