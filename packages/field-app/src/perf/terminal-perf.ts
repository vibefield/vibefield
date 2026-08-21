// THE TERMINAL PERF SAMPLER — TP-S0a's in-app half, under TP-L-G.
//
// > no budget without an instrument; no instrument with a cost when off.
//
// THREE MODES, and what each may touch:
//
//   off         the default, and the ONLY mode a production build can reach.
//               Nothing starts, nothing polls, no window is opened. In the
//               render worker `performanceMeasurement` stays `undefined`, so
//               every sample site early-returns before doing any work
//               (`if (!this.#performanceMeasurementEnabled) return void 0` —
//               terminal-render.worker.js:404, 1813, 2420, 2593; and
//               `recordRenderMetrics` returns on a falsy target at :2798). The
//               cost here is one module with no timer in it.
//
//   production  OUR counters only: what field-app can observe about the
//               terminal without asking the runtime for anything. Cheap by
//               construction — a few integers written on events that already
//               happen — and it opens no measurement window.
//
//   metrics     the runtime's own snapshot, sampled in repeated windows:
//               histograms, bounded sample arrays, per-window counters.
//
// THE FINDING THAT SHAPES THIS FILE — ghosttea 0.10.1 has NO always-on
// counters. Its entire perf surface is `startPerformanceMeasurement()` /
// `finishPerformanceMeasurement()`, and the counters it reports live in a
// `performanceMeasurement` object that only exists between those two calls
// (worker `beginPerformanceMeasurement`, :2753). Worse for a production lane,
// `finishPerformanceMeasurement` ENDS IN A GPU DRAIN BARRIER — it awaits
// `renderer.settle()` on both the idle path and the timeout path (:2828, :2840)
// — and before that it BLOCKS waiting for the renderer to go quiet.
//
// So a `production`-mode terminal counter cannot be sourced from the runtime
// today, at any sampling rate: reading one costs a drain. That is not a design
// choice here, it is an upstream seam that does not exist yet, and §14's list is
// where it belongs — "read the counters without closing the window". Until it
// lands, `production` carries what field-app itself knows, and the frame,
// decode and GPU lanes are honestly `metrics`-only. Inventing a production lane
// out of a `metrics` window would be exactly the instrument-with-a-cost TP-L-G
// forbids.

import { getTerminalPerfSource, observeTerminalPerfSource } from "./terminal-perf-source";
import type { TerminalRenderPerformanceSnapshot } from "./terminal-perf-types";

export type TerminalPerfMode = "off" | "production" | "metrics";

/** Bounded p50/p95/p99/max over an array of samples. */
export interface StageHistogram {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

const EMPTY_STAGE: StageHistogram = { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/** Nearest-rank, so every number reported is a sample that actually occurred.
 * Deliberately a second, tiny implementation rather than an import from
 * `frame-stats.ts`, whose `percentile` is module-private and whose input is
 * already-sorted — copying the sort in would be the larger change. */
export function summarizeStage(samples: readonly number[]): StageHistogram {
  if (samples.length === 0) return EMPTY_STAGE;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] as number;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] as number,
  };
}

/**
 * `production`-mode counters: monotonic, integer, written on events that
 * already happen and read by nobody unless a lane is open.
 *
 * None of them requires the runtime. `sourceChanges` and `sourceMountedMs` are
 * what field-app can honestly say about the terminal plane always-on: whether a
 * runtime exists and how long it has. Everything else the readout shows is
 * `metrics`, and the readout says so rather than showing a zero.
 */
export interface TerminalProductionCounters {
  /** Runtimes published to the registry over this page's life. */
  readonly sourceChanges: number;
  /** Milliseconds a runtime has been registered. */
  readonly sourceMountedMs: number;
  /** `metrics` windows opened and closed. */
  readonly windows: number;
  /** Windows that closed on their deadline rather than on idle. */
  readonly windowsTimedOut: number;
  /** Windows that failed — a disposed runtime mid-window is the normal cause. */
  readonly windowErrors: number;
}

/** One `metrics` window, reduced to the lanes §19.1 asks for. */
export interface TerminalPerfSample {
  readonly mode: TerminalPerfMode;
  readonly at: number;
  readonly backend: string;
  readonly windowMs: number;
  readonly timedOutWaitingForIdle: boolean;
  /** The drain barrier's own cost — the observer effect, reported not hidden. */
  readonly gpuQueueDrainMs: number | null;
  readonly frames: TerminalRenderPerformanceSnapshot["frames"];
  readonly renderer: TerminalRenderPerformanceSnapshot["renderer"];
  readonly scheduling: {
    readonly flushes: number;
    readonly renderCalls: number;
    readonly maximumDirtyPanes: number;
  };
  readonly stages: {
    /** TRF1 -> replica, per frame (ghosttea's `frameApplyMs`). */
    readonly frameApplyMs: StageHistogram;
    /** Raster CPU per flush. */
    readonly renderCpuMs: StageHistogram;
    /** Damage -> pixels on screen. */
    readonly dirtyToRenderMs: StageHistogram;
    /** Frame arrival -> pixels on screen. */
    readonly frameArrivalToRenderMs: StageHistogram;
  };
  /** Derived rates over the window — the numbers a lane actually shows. */
  readonly rates: {
    readonly framesPerSecond: number;
    readonly bytesPerSecond: number;
    readonly submitsPerSecond: number;
  };
}

export interface TerminalPerfState {
  readonly mode: TerminalPerfMode;
  readonly sourceAttached: boolean;
  readonly counters: TerminalProductionCounters;
  /** The most recent window, or null in `off`/`production` or before the first. */
  readonly sample: TerminalPerfSample | null;
}

/** Production builds may never sample. The gate is the bundler's `import.meta.env`,
 * so `metrics` is not merely unused in a production bundle — the mode setter
 * refuses it, and the check is one boolean read. */
function samplingAllowed(): boolean {
  try {
    // `DEV` alone: it is the flag Vite defines in every non-production build
    // and the one vitest sets, and it is the only member of `ImportMetaEnv`
    // this app declares. A production bundle has it statically `false`, so the
    // branch below is dead code the bundler can see.
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

const DEFAULT_PERIOD_MS = 1_000;
/** How long the finish waits for the renderer to go quiet. Small: under a live
 * deck the renderer is rarely idle, and a long quiet window would mean every
 * sample was taken during a lull, which is the opposite of what a perf lane is
 * for. A window that times out is reported as such. */
const DEFAULT_QUIET_MS = 30;
const DEFAULT_TIMEOUT_MS = 2_000;

class TerminalPerfSampler {
  #mode: TerminalPerfMode = "off";
  #sample: TerminalPerfSample | null = null;
  #counters = {
    sourceChanges: 0,
    sourceMountedAt: 0,
    sourceMountedMs: 0,
    windows: 0,
    windowsTimedOut: 0,
    windowErrors: 0,
  };
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #stopped = false;
  #unobserve: (() => void) | undefined;
  readonly #listeners = new Set<(state: TerminalPerfState) => void>();

  get mode(): TerminalPerfMode {
    return this.#mode;
  }

  /**
   * Change mode.
   *
   * `off` -> anything installs the source observer; anything -> `off` removes
   * it and cancels the loop, so the OFF state really is "no subscription and no
   * timer", not "a loop that returns early".
   */
  setMode(mode: TerminalPerfMode): void {
    const wanted = mode !== "off" && !samplingAllowed() ? "off" : mode;
    if (wanted === this.#mode) return;
    this.#mode = wanted;
    if (wanted === "off") {
      this.#teardown();
      this.#sample = null;
    } else {
      this.#setup();
      if (wanted === "metrics") this.#scheduleWindow(0);
    }
    this.#publish();
  }

  #setup(): void {
    if (this.#unobserve !== undefined) return;
    this.#stopped = false;
    this.#unobserve = observeTerminalPerfSource((source) => {
      const now = Date.now();
      if (source === null) {
        if (this.#counters.sourceMountedAt !== 0) {
          this.#counters.sourceMountedMs += now - this.#counters.sourceMountedAt;
          this.#counters.sourceMountedAt = 0;
        }
      } else {
        this.#counters.sourceChanges += 1;
        this.#counters.sourceMountedAt = now;
      }
      this.#publish();
    });
  }

  #teardown(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#unobserve?.();
    this.#unobserve = undefined;
    if (this.#counters.sourceMountedAt !== 0) {
      this.#counters.sourceMountedMs += Date.now() - this.#counters.sourceMountedAt;
      this.#counters.sourceMountedAt = 0;
    }
  }

  #scheduleWindow(delayMs: number): void {
    if (this.#stopped || this.#mode !== "metrics") return;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.#takeWindow();
    }, delayMs);
  }

  async #takeWindow(): Promise<void> {
    if (this.#running || this.#stopped || this.#mode !== "metrics") return;
    const source = getTerminalPerfSource();
    if (source === null) {
      // No runtime to measure. Keep the loop alive at the sample period rather
      // than stopping: a deck opening later must not need the mode toggled.
      this.#scheduleWindow(DEFAULT_PERIOD_MS);
      return;
    }
    this.#running = true;
    const startedAt = performance.now();
    try {
      await source.startPerformanceMeasurement();
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_PERIOD_MS));
      const snapshot = await source.finishPerformanceMeasurement({
        quietMs: DEFAULT_QUIET_MS,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      this.#counters.windows += 1;
      if (snapshot.timedOutWaitingForIdle) this.#counters.windowsTimedOut += 1;
      this.#sample = reduceSnapshot(snapshot, this.#mode);
      this.#publish();
    } catch {
      // A disposed runtime mid-window is the normal race (a deck closing), not
      // a fault worth a console. It is COUNTED, so a lane showing errors
      // climbing says something real.
      this.#counters.windowErrors += 1;
      this.#publish();
    } finally {
      this.#running = false;
      // Pace from the END of the window: the finish blocks for the quiet wait
      // and the drain, so scheduling from the start would compound.
      const spent = performance.now() - startedAt;
      this.#scheduleWindow(Math.max(0, DEFAULT_PERIOD_MS - Math.max(0, spent - DEFAULT_PERIOD_MS)));
    }
  }

  state(): TerminalPerfState {
    const mounted =
      this.#counters.sourceMountedMs +
      (this.#counters.sourceMountedAt === 0 ? 0 : Date.now() - this.#counters.sourceMountedAt);
    return {
      mode: this.#mode,
      sourceAttached: getTerminalPerfSource() !== null,
      counters: {
        sourceChanges: this.#counters.sourceChanges,
        sourceMountedMs: Math.round(mounted),
        windows: this.#counters.windows,
        windowsTimedOut: this.#counters.windowsTimedOut,
        windowErrors: this.#counters.windowErrors,
      },
      sample: this.#sample,
    };
  }

  subscribe(listener: (state: TerminalPerfState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.state());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #publish(): void {
    if (this.#listeners.size === 0) return;
    const state = this.state();
    for (const listener of this.#listeners) listener(state);
  }
}

/** Reduce a raw snapshot to the lanes, with every rate derived from the
 * window's own duration rather than from the requested period. */
export function reduceSnapshot(
  snapshot: TerminalRenderPerformanceSnapshot,
  mode: TerminalPerfMode,
): TerminalPerfSample {
  const seconds = snapshot.durationMs > 0 ? snapshot.durationMs / 1_000 : 0;
  const per = (value: number): number =>
    seconds > 0 ? Math.round((value / seconds) * 10) / 10 : 0;
  return {
    mode,
    at: Date.now(),
    backend: snapshot.backend,
    windowMs: Math.round(snapshot.durationMs * 10) / 10,
    timedOutWaitingForIdle: snapshot.timedOutWaitingForIdle,
    gpuQueueDrainMs:
      snapshot.gpuQueueDrainMs === null ? null : Math.round(snapshot.gpuQueueDrainMs * 100) / 100,
    frames: snapshot.frames,
    renderer: snapshot.renderer,
    scheduling: {
      flushes: snapshot.scheduling.flushes,
      renderCalls: snapshot.scheduling.renderCalls,
      maximumDirtyPanes: snapshot.scheduling.maximumDirtyPanes,
    },
    stages: {
      frameApplyMs: summarizeStage(snapshot.samples.frameApplyMs),
      renderCpuMs: summarizeStage(snapshot.samples.renderCpuMs),
      dirtyToRenderMs: summarizeStage(snapshot.samples.dirtyToRenderMs),
      frameArrivalToRenderMs: summarizeStage(snapshot.samples.frameArrivalToRenderMs),
    },
    rates: {
      framesPerSecond: per(snapshot.frames.received),
      bytesPerSecond: Math.round(per(snapshot.frames.bytes)),
      submitsPerSecond: per(snapshot.renderer.queueSubmits),
    },
  };
}

/** The one sampler. A module singleton for the same reason the registry is one:
 * two samplers would open overlapping windows on the same worker, and the
 * worker holds exactly one `performanceMeasurement`. */
export const terminalPerf = new TerminalPerfSampler();

/** One JSONL line per sample — the dump `pnpm perf:terminal` and the baseline
 * both consume. Flat by design: a line is greppable and a column is a jq path. */
export function toJsonLine(state: TerminalPerfState, scenario: string): string {
  return JSON.stringify({
    scenario,
    mode: state.mode,
    at: state.sample?.at ?? Date.now(),
    sourceAttached: state.sourceAttached,
    counters: state.counters,
    ...(state.sample === null ? {} : { sample: state.sample }),
  });
}
