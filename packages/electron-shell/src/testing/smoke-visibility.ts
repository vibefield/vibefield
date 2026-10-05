// DK-11 — A FRAME COUNT NEEDS A DRAWN WINDOW (the grade's fix 2). Every GPU-on desk smoke row that COUNTS FRAMES — the freeze
// rows' busy second and parked second, the idle and rest windows, the kind-fault frame rate — reads zero when the window's
// page is HIDDEN: Chromium pauses an occluded page's animation frames, so the zero is the compositor's, never the desk's. On a
// shared machine another lane's windows land over ours (DK-11 measured 4 of 7 smoke:kind-faults runs red that way on
// 2026-10-05, the grade one smoke:canvas at load ~50), and DK-9's two switches do not stop it: covered, the page still blinks
// `hidden` for about a second (Electron 43.1.1, measured) — a 500 ms busy sample inside that second reads zero.
//
// So each such row (1) WAITS for the page to be visible before its first sample, and (2) is judged visible at both ends and
// never hidden in between — a page-side recorder counts every `visibilitychange` to a non-visible state, so a blink inside a
// window is caught though both ends read visible. A row whose window was hidden fails with the NAMED cause, never a frame
// verdict it could not have earned. (The gated modes also keep a covered page visible: `mainWindowPreferences`.)

/** What a row reads of the page: its visibility now, and how often it has gone non-visible since the recorder was armed. */
export interface PageVisibility {
  readonly visibility: string;
  /** non-visible transitions since the recorder was armed */
  readonly hidden: number;
  /** `performance.now()` of the latest of them (ms), when any */
  readonly lastHiddenAt?: number;
}

/**
 * The page's expression: arms the recorder on its first call (a capture-phase `visibilitychange` listener counting every
 * transition to a non-visible state) and answers the reading.
 */
export const PAGE_VISIBILITY = `(() => {
  const g = globalThis;
  if (g.__vfSmokeVisibility === undefined) {
    g.__vfSmokeVisibility = { hidden: 0, lastHiddenAt: undefined };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        g.__vfSmokeVisibility.hidden += 1;
        g.__vfSmokeVisibility.lastHiddenAt = Math.round(performance.now());
      }
    }, { capture: true });
  }
  const v = g.__vfSmokeVisibility;
  return {
    visibility: document.visibilityState,
    hidden: v.hidden,
    ...(v.lastHiddenAt !== undefined ? { lastHiddenAt: v.lastHiddenAt } : {}),
  };
})()`;

/** The cause a row names when its window was not drawn. */
export const HIDDEN_CAUSE = "the window was hidden — occluded";

/** How long a row waits for its page to be visible before it gives up and names the cause (ms). */
export const DRAWN_BUDGET_MS = 10_000;

/** The named problem for a row whose page never became visible within its budget. */
export function neverDrawn(row: string, seen: PageVisibility, waitedMs: number): string {
  return `${row}: ${HIDDEN_CAUSE} — the page stayed "${seen.visibility}" for ${waitedMs} ms, so no frame could be counted (the compositor's zero, not the desk's)`;
}

/**
 * Judge one sampled window by its two readings: null when the page was visible at both ends and never went non-visible in
 * between; otherwise the named problem.
 */
export function hiddenDuring(
  row: string,
  start: PageVisibility,
  end: PageVisibility,
): string | null {
  const blinks = end.hidden - start.hidden;
  if (start.visibility === "visible" && end.visibility === "visible" && blinks <= 0) return null;
  const when =
    blinks > 0 && end.lastHiddenAt !== undefined ? `, last at ${end.lastHiddenAt} ms` : "";
  return `${row}: ${HIDDEN_CAUSE} — the page went non-visible ${Math.max(blinks, 0)} time(s) inside the window${when} (it read "${start.visibility}" → "${end.visibility}"), so its frame count is the compositor's, not the desk's`;
}

/**
 * The named problem when the page went non-visible at all since its recorder was armed — the canvas smoke arms it as its window
 * loads: null when never. A mode that counts frames keeps its pages visible whole (`mainWindowPreferences`); with DK-9's
 * switches alone a new window's page blinks `hidden` for about a second once, early in its life, whether or not anything covers
 * it (measured) — the blink a frame-counting row read as zero.
 */
export function hiddenSinceLoad(row: string, reading: PageVisibility): string | null {
  if (reading.hidden <= 0 && reading.visibility === "visible") return null;
  const when = reading.lastHiddenAt !== undefined ? `, last at ${reading.lastHiddenAt} ms` : "";
  return `${row}: ${HIDDEN_CAUSE} — the page went non-visible ${reading.hidden} time(s) since the window loaded${when} (it reads "${reading.visibility}"); a mode that counts frames must keep its page visible whole`;
}
