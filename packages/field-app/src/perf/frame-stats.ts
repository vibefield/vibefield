// App-level frame statistics — the renderer's own answer to "are we dropping
// frames, and is it our JavaScript's fault."
//
// Two sources, deliberately: rAF cadence says WHETHER frames are late, and LoAF
// (`long-animation-frame`) says how much of the lateness the main thread can be
// blamed for. Neither alone is a diagnosis. Their DISAGREEMENT is: frames
// dropping while the main thread barely blocked means the cost is off the main
// thread — compositor, raster, or GPU — which is exactly the case a JS CPU
// profile reports as "idle, looks fine" (see `draft/thinking-renderer-perf-tooling.md`
// §4). Getting that verdict out of two counters that cost nothing is the whole
// reason this module exists rather than a bare FPS number.
//
// The collector is pure and clock-injected so the maths is testable without a
// DOM or a real display; `startFrameStats` is the thin part that owns the rAF
// loop and the observer.

/** Reporting window: what "current" means for every derived number. */
const WINDOW_MS = 1_000;
/** A longer window for display-period detection, which wants a stable floor. */
const REFRESH_WINDOW_MS = 4_000;
/** An interval this many times the display period lost at least one frame. */
const DROP_FACTOR = 1.5;
/** Blocking's share of lost time at or above which the main thread is at fault. */
const MAIN_THREAD_SHARE = 0.5;
/** Intervals longer than this are an OBSERVATION GAP — a hidden window, a
 * debugger pause, a suspended machine — not a dropped frame. Counting them
 * would let a lunch break define the worst-case frame. */
const GAP_MS = 1_000;
/** Below this many frames the window is too thin to describe; report nothing
 * rather than a number built from three samples. */
const MIN_FRAMES = 5;

/** Rates a detected period snaps to when it lands close enough. Snapping keeps
 * ProMotion's 120 from reading as 118.6 without inventing precision — and an
 * unrecognized display falls through to its measured rate rather than being
 * forced into this list. */
const KNOWN_REFRESH_HZ = [24, 30, 48, 50, 60, 72, 90, 100, 120, 144, 165, 240] as const;
const SNAP_TOLERANCE = 0.06;

export type FrameVerdict = "healthy" | "main-thread" | "off-main-thread" | "unknown";

export interface FrameStatsSample {
  /** Frames per second over the reporting window. */
  fps: number;
  /** Frame interval distribution, in milliseconds. */
  frameMs: { p50: number; p95: number; worst: number };
  /** Intervals in the window that overran the display period by DROP_FACTOR. */
  dropped: number;
  /** Total milliseconds those overruns cost. */
  lostMs: number;
  /** Detected display refresh, or null while the sample is too thin to tell. */
  refreshHz: number | null;
  /** LoAF blocking in the window, or **null when LoAF is unobservable** — which
   * is not the same as zero and must never render as it. */
  blockingMs: number | null;
  verdict: FrameVerdict;
}

interface Stamped {
  at: number;
  value: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] as number;
}

function snapRefresh(hz: number): number {
  for (const known of KNOWN_REFRESH_HZ) {
    if (Math.abs(hz - known) / known <= SNAP_TOLERANCE) return known;
  }
  return Math.round(hz);
}

function since(samples: readonly Stamped[], now: number, windowMs: number): Stamped[] {
  const floor = now - windowMs;
  return samples.filter((sample) => sample.at > floor);
}

/**
 * Accumulates frame intervals and LoAF blocking, and derives a sample on demand.
 *
 * Pure: it is handed timestamps rather than reading a clock, so a test can drive
 * a 120Hz display with a three-frame stall through it deterministically.
 */
export class FrameStatsCollector {
  private frames: Stamped[] = [];
  private blocking: Stamped[] = [];
  private lastFrameAt: number | null = null;
  private readonly blockingObservable: boolean;

  constructor(options: { blockingObservable: boolean }) {
    this.blockingObservable = options.blockingObservable;
  }

  /** Record a presented frame at `at` (a `performance.now()`-domain timestamp). */
  frame(at: number): void {
    if (this.lastFrameAt !== null) {
      const dt = at - this.lastFrameAt;
      if (dt > 0 && dt < GAP_MS) this.frames.push({ at, value: dt });
    }
    this.lastFrameAt = at;
    this.trim(at);
  }

  /** Record a LoAF blocking duration. Same clock domain as `frame`. */
  blocked(at: number, ms: number): void {
    if (ms > 0) this.blocking.push({ at, value: ms });
    this.trim(at);
  }

  /** Forget the frame cursor so the gap across a pause is never a "frame". */
  discontinuity(): void {
    this.lastFrameAt = null;
  }

  private trim(now: number): void {
    const floor = now - REFRESH_WINDOW_MS;
    if (this.frames.length > 0 && (this.frames[0] as Stamped).at <= floor) {
      this.frames = this.frames.filter((sample) => sample.at > floor);
    }
    if (this.blocking.length > 0 && (this.blocking[0] as Stamped).at <= floor) {
      this.blocking = this.blocking.filter((sample) => sample.at > floor);
    }
  }

  /** The detected display period in ms, or null while undetermined. */
  private periodMs(now: number): number | null {
    const long = since(this.frames, now, REFRESH_WINDOW_MS);
    if (long.length < MIN_FRAMES) return null;
    const sorted = long.map((sample) => sample.value).sort((a, b) => a - b);
    // The FLOOR of the distribution is the display period: the fastest frames
    // are the ones that hit the vsync deadline. p5 rather than the minimum, so
    // one anomalously short interval cannot define the whole scale.
    const floor = percentile(sorted, 0.05);
    if (floor <= 0) return null;
    return 1_000 / snapRefresh(1_000 / floor);
  }

  sample(now: number): FrameStatsSample | null {
    const window = since(this.frames, now, WINDOW_MS);
    if (window.length < MIN_FRAMES) return null;

    const intervals = window.map((sample) => sample.value);
    const sorted = [...intervals].sort((a, b) => a - b);
    const measuredMs = intervals.reduce((total, dt) => total + dt, 0);
    const fps = measuredMs > 0 ? (intervals.length * 1_000) / measuredMs : 0;

    const period = this.periodMs(now);
    let dropped = 0;
    let lostMs = 0;
    if (period !== null) {
      const threshold = period * DROP_FACTOR;
      for (const dt of intervals) {
        if (dt > threshold) {
          dropped += 1;
          lostMs += dt - period;
        }
      }
    }

    const blockingMs = this.blockingObservable
      ? since(this.blocking, now, WINDOW_MS).reduce((total, sample) => total + sample.value, 0)
      : null;

    return {
      fps,
      frameMs: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        worst: sorted[sorted.length - 1] as number,
      },
      dropped,
      lostMs,
      refreshHz: period === null ? null : Math.round(1_000 / period),
      blockingMs,
      verdict: verdictFor({ dropped, lostMs, blockingMs }),
    };
  }
}

/**
 * The diagnosis, from the disagreement between the two sources.
 *
 * `unknown` is load-bearing: without LoAF we know frames are late and genuinely
 * cannot say why, and saying so is worth more than guessing "main thread".
 */
export function verdictFor(input: {
  dropped: number;
  lostMs: number;
  blockingMs: number | null;
}): FrameVerdict {
  if (input.dropped === 0) return "healthy";
  if (input.blockingMs === null) return "unknown";
  if (input.lostMs <= 0) return "healthy";
  return input.blockingMs / input.lostMs >= MAIN_THREAD_SHARE ? "main-thread" : "off-main-thread";
}

/** Whether this engine can attribute blocking at all (LoAF: Chrome 123+). */
export function blockingObservable(): boolean {
  if (typeof PerformanceObserver === "undefined") return false;
  const types = PerformanceObserver.supportedEntryTypes;
  return Array.isArray(types) && types.includes("long-animation-frame");
}

export interface FrameStatsHandle {
  stop(): void;
}

/**
 * Run the rAF loop and the LoAF observer, emitting a sample at `sampleHz`.
 *
 * The loop is the measurement AND the load: a rAF loop keeps the compositor
 * awake at full rate, so this is started only while something is displaying it
 * (`frame-stats-overlay.ts` starts on show and stops on hide) rather than left
 * running for a panel nobody opened.
 */
export function startFrameStats(options: {
  onSample: (sample: FrameStatsSample) => void;
  sampleHz?: number;
}): FrameStatsHandle {
  const emitEvery = 1_000 / (options.sampleHz ?? 4);
  const observable = blockingObservable();
  const collector = new FrameStatsCollector({ blockingObservable: observable });

  let raf = 0;
  let lastEmit = 0;
  let stopped = false;

  const tick = (now: number): void => {
    if (stopped) return;
    collector.frame(now);
    if (now - lastEmit >= emitEvery) {
      lastEmit = now;
      const sample = collector.sample(now);
      if (sample) options.onSample(sample);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  let observer: PerformanceObserver | null = null;
  if (observable) {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const blocking = (entry as PerformanceEntry & { blockingDuration?: number })
            .blockingDuration;
          collector.blocked(entry.startTime, blocking ?? 0);
        }
      });
      observer.observe({ type: "long-animation-frame", buffered: false });
    } catch {
      // An engine that advertises the type but refuses the observe leaves the
      // collector reporting `unknown` — the honest state, not a silent zero.
      observer = null;
    }
  }

  // A hidden window stops presenting frames; the interval across the gap is not
  // a dropped frame and the cursor is dropped rather than counted.
  const onVisibility = (): void => collector.discontinuity();
  document.addEventListener("visibilitychange", onVisibility);

  return {
    stop(): void {
      stopped = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
