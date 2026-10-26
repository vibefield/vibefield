import { CHROME_RETRY_FIRST_MS } from "@vibefield/puppeteer-views";
import { act } from "react";
import { vi } from "vitest";

/**
 * The chrome's backoff on a clock a row holds. Since MV-8b phase 2 a
 * `ChromeBoundary` tries a failed piece again only for a new `retryKey`, and at
 * most once per window (`CHROME_RETRY_FIRST_MS`, doubling on each retry that
 * fails, to `CHROME_RETRY_CAP_MS`): a fact that arrives inside the window waits
 * for its end. A row that heals a piece holds the clock and moves it.
 *
 * Only the timers the boundary uses and `Date` are held. The page's frames run
 * as they always do: happy-dom's `requestAnimationFrame` runs on the real
 * `setImmediate` it captured at load, which is never held.
 */
export function holdChromeClock(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}

/** Moves the held clock on (one first window by default): what falls due fires. */
export function advanceChromeClock(ms: number = CHROME_RETRY_FIRST_MS): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * One macrotask on whichever clock runs, for a file's `settle`: a real
 * `setTimeout(0)`, or on a held clock what is due now plus one real turn, so
 * the page's frames still land.
 */
export async function nextTask(): Promise<void> {
  if (!vi.isFakeTimers()) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return;
  }
  await vi.advanceTimersByTimeAsync(0);
  await new Promise((resolve) => setImmediate(resolve));
}
