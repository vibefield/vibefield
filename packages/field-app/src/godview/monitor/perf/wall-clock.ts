// THE CORPUS CLOCK (MV-3c) — the page's wall clock, read off the corpus while a
// lab replays it.
//
// A corpus is dated (`DEFAULT_BASE_WALL`, 2026-10-03T12:00Z) and every row's
// clocks are relative to it. Today's seam classifies recency in the renderer
// against `Date.now()` (`useMonitorAgents.ts`), so a corpus replayed hours
// later draws every row stale — while the model stream's backend computed the
// same rows at the corpus's own time, offline. Paired arms that disagree on
// what time it is measure two different boards. So the lab may shift the
// page's `Date.now` to the corpus's wall for the length of a replay (`shift`:
// it reads the corpus's wall plus the time since), or stop it at one instant
// for a capture (`freeze`: ages that cannot move between two captures).
//
// Only `Date.now` moves, as the view SDK's fixture clock does
// (`view-sdk/testing/clock.ts`): views and the seam read the time through it,
// and `new Date()` with no argument (the stamps a door writes, `asOf`) stays
// the machine's. `performance.now` is never touched — the player's timeline,
// the probe's frame timing and every animation run on it. Dormant: nothing
// calls this outside the lab (`godviewPerf=1`).

/** The machine's `Date.now`, held while the page reads another. */
let original: (() => number) | null = null;
let reading: (machine: number) => number = (machine) => machine;

function machineNow(): number {
  return (original ?? Date.now)();
}

function install(): void {
  if (original !== null) return;
  const held = Date.now;
  original = held;
  Object.defineProperty(Date, "now", {
    configurable: true,
    writable: true,
    value: () => reading(held()),
  });
}

/** From now on `Date.now()` reads `wallMs` plus the machine time since. */
export function shiftWallClock(wallMs: number): void {
  const offset = wallMs - machineNow();
  install();
  reading = (machine) => machine + offset;
}

/** `Date.now()` reads `wallMs` until the clock is shifted or restored. */
export function freezeWallClock(wallMs: number): void {
  install();
  reading = () => wallMs;
}

/** The machine's clock again. */
export function restoreWallClock(): void {
  if (original === null) return;
  Object.defineProperty(Date, "now", { configurable: true, writable: true, value: original });
  original = null;
  reading = (machine) => machine;
}

/** What the page reads now, and whether it is the machine's. */
export function wallClockState(): { now: number; shifted: boolean } {
  return { now: Date.now(), shifted: original !== null };
}
