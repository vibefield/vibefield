import { isHidden, onVisibilityChange } from "./visibility";

// The chrome ticker (3b, review finding 5): ONE shared pacing source for
// chrome that reads engine state — zoom pill, breadcrumbs, tool switcher,
// ghost affordances — replacing N free-running setIntervals. rAF-aligned;
// each subscriber declares a cadence and runs at most once per window; the
// whole ticker PAUSES while the window is hidden (the old intervals kept
// firing hidden) and resumes with one catch-up pass on refocus, so chrome
// reads fresh engine truth before the first visible frame. Subscriptions
// support AbortSignal cancellation.
//
// This is the visibility seam's runtime service face: optional chrome work
// subscribes HERE; the persistence path and the loading pipeline stay
// visibility-EXEMPT by law (§5.4.5) and must never ride this ticker.

export interface ChromeTickerSeam {
  isHidden(): boolean;
  onVisibilityChange(fn: (hidden: boolean) => void): () => void;
  raf(fn: () => void): number;
  caf(id: number): void;
  now(): number;
}

export interface ChromeTicker {
  /** Run `fn` at most every `everyMs` while the window is visible; the first
   * run lands on the next frame. Returns unsubscribe. */
  subscribe(everyMs: number, fn: () => void, opts?: { signal?: AbortSignal }): () => void;
  /** Cancel the frame loop and drop every subscriber (tests/teardown). */
  dispose(): void;
}

interface Sub {
  everyMs: number;
  fn: () => void;
  last: number;
}

export function createChromeTicker(seam?: Partial<ChromeTickerSeam>): ChromeTicker {
  const hidden = seam?.isHidden ?? isHidden;
  const onVis = seam?.onVisibilityChange ?? onVisibilityChange;
  const raf = seam?.raf ?? ((fn: () => void) => requestAnimationFrame(fn));
  const caf = seam?.caf ?? ((id: number) => cancelAnimationFrame(id));
  const now = seam?.now ?? (() => performance.now());

  const subs = new Set<Sub>();
  let frame: number | null = null;
  let disposed = false;

  const cancelFrame = (): void => {
    if (frame !== null) {
      caf(frame);
      frame = null;
    }
  };
  const pump = (): void => {
    frame = null;
    if (disposed || hidden() || subs.size === 0) return;
    const t = now();
    for (const s of [...subs]) {
      if (t - s.last >= s.everyMs) {
        s.last = t;
        s.fn();
      }
    }
    schedule();
  };
  const schedule = (): void => {
    if (disposed || frame !== null || hidden() || subs.size === 0) return;
    frame = raf(pump);
  };
  const unVis = onVis((h) => {
    if (disposed) return;
    if (h) {
      cancelFrame();
      return;
    }
    // refocus: every subscriber is due — one catch-up pass, then pacing
    for (const s of subs) s.last = 0;
    schedule();
  });

  return {
    subscribe(everyMs, fn, opts) {
      if (disposed || opts?.signal?.aborted) return () => {};
      const sub: Sub = { everyMs, fn, last: 0 };
      const unsubscribe = (): void => {
        subs.delete(sub);
        opts?.signal?.removeEventListener("abort", unsubscribe);
        if (subs.size === 0) cancelFrame();
      };
      opts?.signal?.addEventListener("abort", unsubscribe, { once: true });
      subs.add(sub);
      schedule();
      return unsubscribe;
    },
    dispose() {
      disposed = true;
      unVis();
      cancelFrame();
      subs.clear();
    },
  };
}

// The renderer-wide instance chrome components share. Lazy so tests that
// never touch chrome pay nothing; test code builds its own via the factory.
let shared: ChromeTicker | null = null;
export function sharedChromeTicker(): ChromeTicker {
  shared ??= createChromeTicker();
  return shared;
}
