import { isHot } from "../panels/agents/profiles-model";

// UM-1 (track UM; UM-D3, D4 and D13 at their leans, James 2026-11-06 03:11Z) — THE METER'S RULES, A LEAF: how a window
// is pressed (UM-D13), which is the tightest, when it runs out at this pace (UM-D4), and how a length and a reset are
// said. The ruled drawing's (draft/profile-meters/round4/src/p3a-core.js: `pressure`, `tightest`, `forecast`, `dur`).
//
// It imports nothing, so every reader may: the meter model (`meters.ts`), the Bands geometry (`bands.ts`) and Settings'
// own page (`panels/agents/profiles-model.ts`, U2's 2e, so Settings says the same meter, UM-D3) — the last reads this
// file while `meters.ts` reads Settings', and a leaf keeps that from being a cycle. What a window's orange is stays
// Settings' (`isHot`): a reader hands its `hot` in, and nothing here decides it.

/** Settings' `resetWords` says a reset this many minutes off, or more, by its day and clock ("Thu 09:00", in the
 * reader's own zone and locale), a nearer one as a length ("2h 10m"), and one already past as "now". */
export const RESET_BY_DAY_MINUTES = 24 * 60;

/** How Settings' `resetWords` says a window's reset: as a length, by its day, or "now"; nothing when it names none. */
export function resetForm(window: {
  resetIn?: number | undefined;
}): "length" | "day" | "now" | undefined {
  if (window.resetIn === undefined) return undefined;
  if (window.resetIn <= 0) return "now";
  return Math.round(window.resetIn) >= RESET_BY_DAY_MINUTES ? "day" : "length";
}

/** A length as the drawing says it: "45m", "2h 10m", "3d 4h" (its `dur`, the carry made exact). */
export function durationWords(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${Math.max(1, whole)}m`;
  if (whole < 24 * 60) {
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const hours = Math.round(whole / 60);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

/** What a window's pressure reads: its orange (Settings' pace rule) and its used share. */
export interface Pressed {
  hot: boolean;
  usedPercent: number;
}

/** UM-D13 — how close a window is to its limit: ahead of pace first (1000), then spent (500), then the fuller. */
export function pressureOf(window: Pressed): number {
  return (window.hot ? 1000 : 0) + (window.usedPercent >= 100 ? 500 : 0) + window.usedPercent;
}

/** UM-D13 — the window closest to its limit: the most pressed, the first of equals. */
export function tightestOf<T extends Pressed>(windows: readonly T[]): T | undefined;
export function tightestOf<T>(
  windows: readonly T[],
  pressed: (window: T) => Pressed,
): T | undefined;
export function tightestOf<T>(
  windows: readonly T[],
  pressed: (window: T) => Pressed = (window) => window as Pressed,
): T | undefined {
  let tightest: T | undefined;
  let most = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    const pressure = pressureOf(pressed(window));
    if (tightest === undefined || pressure > most) {
      tightest = window;
      most = pressure;
    }
  }
  return tightest;
}

/** UM-D4 — when a window runs out at this pace, said only while it runs ahead and only before its reset. */
export interface MeterForecast {
  /** minutes to the limit at this pace, unrounded */
  minutes: number;
  /** "~35m": rounded as the drawing rounds (to the minute under 10, to 5 under the hour, to 15 from it) */
  words: string;
  /** "out in ~35m": a meter's right words */
  short: string;
  /** "Runs out in ~35m at this pace" */
  long: string;
}

/** What the forecast reads of a window: its share used and gone, its length, the minutes to its reset, whether it is a
 * budget, and its orange as Settings' pace rule (`isHot`) gave it. */
export interface ForecastInput {
  usedPercent: number;
  elapsedPercent?: number | undefined;
  durationMinutes?: number | undefined;
  resetIn?: number | undefined;
  budget: boolean;
  hot: boolean;
}

/** UM-D4 — the forecast: at this pace the window is spent before it resets. Never for a budget (pace-less), a window
 * already spent, one whose length, time gone or reset is unknown, or one not ahead of pace (`hot` with time gone). */
export function forecastOf(window: ForecastInput): MeterForecast | undefined {
  const { usedPercent: used, elapsedPercent: elapsed, durationMinutes: length, resetIn } = window;
  if (window.budget || length === undefined || elapsed === undefined || resetIn === undefined) {
    return undefined;
  }
  // ahead of pace means some time has gone, so the pace is a positive share per minute
  // RED SKELETON: the forecast still decides the orange itself, ignoring the one it is handed
  if (used >= 100 || !isHot(used, elapsed) || elapsed <= 0) return undefined;
  const perMinute = used / ((elapsed / 100) * length);
  const minutes = (100 - used) / perMinute;
  if (minutes >= resetIn) return undefined;
  const words = `~${
    minutes < 10
      ? `${Math.max(1, Math.round(minutes))}m`
      : minutes < 60
        ? `${Math.round(minutes / 5) * 5}m`
        : durationWords(Math.round(minutes / 15) * 15)
  }`;
  return { minutes, words, short: `out in ${words}`, long: `Runs out in ${words} at this pace` };
}
