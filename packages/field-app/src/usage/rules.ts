// UM-1 (track UM; UM-D3, D4 and D13 at their leans, James 2026-11-06 03:11Z) — THE METER'S RULES, A LEAF: how a window
// is pressed (UM-D13), which is the tightest, when it runs out at this pace (UM-D4), and how a length and a reset are
// said. The ruled drawing's (draft/profile-meters/round4/src/p3a-core.js: `pressure`, `tightest`, `forecast`, `dur`),
// and a window's length in words (`windowWords`), which the limit moment says too (`setup/limit-moment.ts` reads it
// here, so the meters need nothing of setup/).
//
// It imports nothing, so every reader may: the meter model (`meters.ts`), the Bands geometry (`bands.ts`), the limit
// moment, and Settings' own page and the column's popover (`panels/agents/ProfilesView.tsx` and
// `godview/profiles-column/ProfilePopoverView.tsx` read `resetForm`, UM-3, so Settings says the same meter, UM-D3;
// and Settings says a reading's age by the meters' `ageWords`, DESIGN.md §8 "A window read before its reset").
// Settings reads the meters' windows from `meters.ts` (`meterWindows`, that file's own), which reads Settings' lines
// (`panels/agents/profiles-model.ts`, which reads nothing here): ProfilesView → meters → profiles-model, no module
// cycle. A reader imports each rule from the module that owns it; none moves to spare an import. What a window's
// orange is stays Settings' (`isHot`): a reader hands its `hot` in, and nothing here decides it.

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

/** What a window's length is said from: its length in minutes, or its adapter's label when it names none. */
export interface WindowLength {
  label: string;
  durationMinutes?: number | undefined;
}

/** A window's length as a person says it — "7 days", "5 hours", "30 minutes" — or its adapter's label when it names
 * none: a meter's window ("of 7 days") and the limit moment's ("92% · 7 days") alike. */
export function windowWords(window: WindowLength): string {
  const minutes = window.durationMinutes;
  if (minutes === undefined || !Number.isSafeInteger(minutes) || minutes <= 0) return window.label;
  if (minutes % 1440 === 0) return counted(minutes / 1440, "day");
  if (minutes % 60 === 0) return counted(minutes / 60, "hour");
  return counted(minutes, "minute");
}

/** "1 day", "7 days": Settings' `plural`, which the leaf cannot import. */
function counted(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
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

/** A reading's age as the meters say it (§9 "A reading": "as of 5m ago", "as of 3h ago"), in place of a forecast or a
 * reset: a kept reading's, and one with a window read before its reset. Nothing when its time cannot be read, rather
 * than words §9 does not rule. The meters' right words and Settings' C1 line both say it from here. */
export function ageWords(fetchedAt: string, now: Date): string {
  const age = (now.getTime() - Date.parse(fetchedAt)) / 60_000;
  return Number.isFinite(age) ? `as of ${durationWords(Math.max(0, age))} ago` : "";
}

/** What a window's pressure reads: its orange (Settings' pace rule), its used share, and whether its `resetsAt` is at
 * or before now, whether its reset came before or after its reading (`passed`). */
export interface Pressed {
  hot: boolean;
  usedPercent: number;
  passed?: boolean | undefined;
}

/** UM-D13 — how close a window is to its limit: ahead of pace first (1000), then spent (500), then the fuller. A window
 * read before its reset presses nothing (0): what it metered is gone (DESIGN.md §8 "The Bands circle"). */
export function pressureOf(window: Pressed): number {
  if (window.passed === true) return 0;
  return (window.hot ? 1000 : 0) + (window.usedPercent >= 100 ? 500 : 0) + window.usedPercent;
}

/** UM-D13's rank of a window: its pressure, and whether it was read before its reset. */
export interface Rank {
  pressure: number;
  passed?: boolean | undefined;
}

/** UM-D13 — whether `a` ranks above `b`: the more pressed, and at equal pressure a window still running above one read
 * before its reset. Both press 0 at that tie (a running window at 0%), so a passed window ranks below every running
 * window, an empty one too (DESIGN.md §8 "A window read before its reset"); equals of one kind keep their order. */
export function outranks(a: Rank, b: Rank): boolean {
  if (a.pressure !== b.pressure) return a.pressure > b.pressure;
  return a.passed !== true && b.passed === true;
}

/** UM-D13 — the window closest to its limit: the most pressed, one still running before one read before its reset
 * (`outranks`), the first of equals. */
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
  let best: Rank | undefined;
  for (const window of windows) {
    const read = pressed(window);
    const rank: Rank = { pressure: pressureOf(read), passed: read.passed };
    if (best === undefined || outranks(rank, best)) {
      tightest = window;
      best = rank;
    }
  }
  return tightest;
}

/** UM-D4 — when a window runs out at this pace, said only while it runs ahead and only before its reset. */
export interface MeterForecast {
  /** minutes to the limit at this pace, unrounded */
  minutes: number;
  /** "~35m", "~1h", "~1h 15m": rounded as the drawing rounds (to the minute under 10, to 5 under the hour, to 15 from
   * it), and only then said, so a time that rounds to the hour says it as one ("~1h", never "~60m") */
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
  if (used >= 100 || !window.hot || elapsed <= 0) return undefined;
  const perMinute = used / ((elapsed / 100) * length);
  const minutes = (100 - used) / perMinute;
  if (minutes >= resetIn) return undefined;
  // round first, then choose the form: 57.5 to 60 minutes round to the hour, said "~1h" (DESIGN.md §8, "Hot, and
  // the forecast")
  const rounded =
    minutes < 10
      ? Math.max(1, Math.round(minutes))
      : minutes < 60
        ? Math.round(minutes / 5) * 5
        : Math.round(minutes / 15) * 15;
  const words = `~${rounded >= 60 ? durationWords(rounded) : `${rounded}m`}`;
  return { minutes, words, short: `out in ${words}`, long: `Runs out in ${words} at this pace` };
}
