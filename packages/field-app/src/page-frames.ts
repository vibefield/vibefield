import { VITALS_FRAMES } from "@vibefield/contracts/registries";
import type { RendererLogger } from "./logging";

// VT-3c (track VT, 2026-11-24; VT-D10 A) — THE DESK'S WINDOW SAYS ITS LONG FRAMES. The platform already counts a
// frame that took over 50 ms (a long animation frame; a long task where the engine has no frame count) and hands it
// to an observer when it happens. This module listens for those, and only those, and says how many there were and
// the longest to fieldd (`vitals.own.report`), which carries them on the Desk window's row of the census.
//
// It costs nothing at rest: no frame callback, no interval. A long frame is what starts its one timer (at most
// REPORT_DELAY_MS), the timer sends one report, and then it is idle again. It never has two reports on their way:
// frames heard while one is out wait for it. When fieldd answers that it is not recording, or refuses, the page
// stops counting for BACKOFF_MS rather than report into nothing.

/** One long frame as the platform says it: only its length is read. */
export interface LongFrameEntry {
  readonly duration: number;
}

/** Starts hearing the page's long frames and returns how to stop, or null where the platform counts none. */
export type LongFrameSource = (
  hear: (entries: readonly LongFrameEntry[]) => void,
) => (() => void) | null;

export interface LongFrameClient {
  request(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<unknown>;
}

export interface LongFrameReporterOptions {
  /** the window's fieldd client now, or null before the bootstrap has one */
  client(): LongFrameClient | null;
  logger?: Pick<RendererLogger, "debug">;
  /** the platform's observer, unless a test hands its own */
  source?: LongFrameSource;
  /** a monotonic clock in milliseconds */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** The engine's own count of long frames: the long animation frame where it has one, else the long task. */
export const platformLongFrames: LongFrameSource = (hear) => {
  if (typeof PerformanceObserver === "undefined") return null;
  const types = PerformanceObserver.supportedEntryTypes;
  const supported = Array.isArray(types) ? types : [];
  const type = supported.includes("long-animation-frame")
    ? "long-animation-frame"
    : supported.includes("longtask")
      ? "longtask"
      : null;
  if (type === null) return null;
  try {
    const observer = new PerformanceObserver((list) => hear(list.getEntries()));
    observer.observe({ type, buffered: false });
    return () => observer.disconnect();
  } catch {
    // an engine that names the type but refuses the observe counts nothing here, and nothing is said
    return null;
  }
};

export class LongFrameReporter {
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly stopHearing: (() => void) | null;
  private frames = 0;
  private longestMs = 0;
  private timer: unknown = null;
  private sending = false;
  private quietUntil = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(private readonly options: LongFrameReporterOptions) {
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.stopHearing = (options.source ?? platformLongFrames)((entries) => this.hear(entries));
  }

  /** Whether the platform counts this page's long frames at all. */
  get hearing(): boolean {
    return this.stopHearing !== null;
  }

  private hear(entries: readonly LongFrameEntry[]): void {
    if (this.disposed || this.now() < this.quietUntil) return;
    for (const entry of entries) {
      if (!(entry.duration > VITALS_FRAMES.LONG_FRAME_MS)) continue;
      this.frames += 1;
      this.longestMs = Math.max(this.longestMs, entry.duration);
    }
    this.arm();
  }

  /** One timer, and only while there is something to say and nothing on its way. */
  private arm(): void {
    if (this.disposed || this.frames === 0 || this.timer !== null || this.sending) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.send();
    }, VITALS_FRAMES.REPORT_DELAY_MS);
  }

  private drop(): void {
    this.frames = 0;
    this.longestMs = 0;
  }

  private send(): void {
    if (this.disposed || this.frames === 0) return;
    const client = this.options.client();
    if (client === null) {
      // nobody to tell yet: what was counted is let go, never kept for a later report
      this.drop();
      return;
    }
    // a report's own bounds (fieldd refuses past them): a page held for minutes says the most one report may
    const own = {
      longFrames: Math.min(this.frames, VITALS_FRAMES.FRAMES_PER_REPORT_MAX),
      longFrameMaxMs: Math.round(Math.min(this.longestMs, VITALS_FRAMES.FRAME_MS_MAX) * 10) / 10,
    };
    this.drop();
    this.sending = true;
    client
      .request("vitals.own.report", { own }, { timeoutMs: VITALS_FRAMES.REPORT_TIMEOUT_MS })
      .then((result) => {
        if ((result as { accepted?: unknown } | null)?.accepted === false)
          this.quiet("not recording");
      })
      .catch((error: unknown) => {
        this.quiet(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        this.sending = false;
        this.arm();
      });
  }

  /** fieldd is not recording, or did not take the report: count nothing for a while. */
  private quiet(why: string): void {
    this.quietUntil = this.now() + VITALS_FRAMES.BACKOFF_MS;
    this.drop();
    this.options.logger?.debug(
      "renderer.vitals.frames_quiet",
      "fieldd did not take the window's long frames; the window stops counting for a while",
      { why: why.slice(0, 200), quietMs: VITALS_FRAMES.BACKOFF_MS },
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.drop();
    try {
      this.stopHearing?.();
    } catch {
      // an observer that will not stop ends with the page
    }
  }
}
