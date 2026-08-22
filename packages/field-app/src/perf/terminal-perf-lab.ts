// THE PERF LAB'S RENDERER BRIDGE — TP-S0c, under TP-L-G.
//
// vibefield-terminal-perf-lab-only
//
// The sampler (`terminal-perf.ts`) lives in the renderer; the rig that drives a
// scenario lives in main. This module is the seam between them, and it exists
// ONLY in the `terminal-perf-lab` vite mode — the renderer host's import of it
// sits behind `__VIBEFIELD_TERMINAL_PERF_LAB__`, a vite `define` (the same
// mechanism `__VIBEFIELD_FORCE_ONBOARDING__` uses), so in every other build the
// branch folds to `if (false)` and rollup drops this module with it.
// `verify-production-renderer.mjs` greps the built output for the marker on the
// line above, so the exclusion is a gate rather than a claim.
//
// WHY A WINDOW GLOBAL AND NOT A CONSOLE MARKER. The deck already publishes
// `GODVIEW_DECK` lines that the godview smoke reads, and that is the right shape
// for a handful of state changes. It is the wrong shape here: a `metrics` window
// closes once a second and carries four histograms and twenty counters, a
// keystroke run carries one record per key, and console marshalling would both
// cost more than the thing being measured and drop lines under a flood. So main
// pulls, over `executeJavaScript`, and the renderer accumulates in between.
//
// WHAT THIS MODULE MAY NOT DO. It may not make the app behave differently. It
// installs listeners and reads clocks; it never touches the pool, the deck, the
// runtime or the sampler's own pacing. The one thing it adds to the page is a
// rAF loop, and only while frame stats are explicitly started — which is itself
// an observer effect, reported by `framesRunning` beside the numbers it moves.

import { emitTerminalPerfLabMarker } from "../development-console";
import { getLabSwitches, setLabSwitches } from "../godview/lab-switches";
import type { FrameStatsHandle, FrameStatsSample } from "./frame-stats";
import { startFrameStats } from "./frame-stats";
import type { StageHistogram, TerminalPerfMode, TerminalPerfSample } from "./terminal-perf";
import { allowSamplingForPerfLab, summarizeStage, terminalPerf } from "./terminal-perf";
import { getTerminalPerfSource } from "./terminal-perf-source";

/** One injected keystroke, as the RENDERER saw it.
 *
 * The rig knows when it injected the key; only the page knows when the document
 * received it and when the terminal surface's own handler ran. The two together
 * are §18.1 rows 1–2, and the gap between them is Chromium's input hop — the
 * part of the budget that is the platform's rather than ours. */
export interface KeystrokeProbe {
  /** The identity the rig injected, carried in the key itself. */
  readonly probeId: string;
  /** `performance.now()` at the document's capture-phase keydown. */
  readonly domKeydownMs: number;
  /** `Date.now()` at the same instant, so main can cross to its own clock. */
  readonly domKeydownWallMs: number;
  /** `event.timeStamp` — Chromium's own stamp for when the event was CREATED,
   * in the same time origin as `performance.now()`. `domKeydownMs - timeStamp`
   * is therefore the browser→renderer→dispatch delay, measured by the engine
   * rather than by us. */
  readonly eventTimeStampMs: number;
  /** What had focus when the key landed. A key that reached the document but
   * not the terminal surface is a different failure from a key that never
   * arrived, and only this tells them apart. */
  readonly target: string;
  /** The rAF that first ran AFTER this keydown, as `performance.now()`. The
   * nearest thing the renderer itself can see to "a frame carried this key";
   * null if the run ended before one ran. NOT a present timestamp — the
   * compositor latch is downstream of rAF and is read from `latencyInfo` in
   * trace mode instead. */
  readonly nextRafMs: number | null;
}

/** The lab's own reading of one process's frame pacing, kept beside the
 * terminal lanes so a scenario's verdict can separate "the terminal is slow"
 * from "the whole renderer is". */
export interface FrameStatsRecord extends FrameStatsSample {
  readonly at: number;
}

export interface TerminalPerfLabSnapshot {
  readonly mode: TerminalPerfMode;
  readonly sourceAttached: boolean;
  readonly rendererBackend: string | null;
  readonly framesRunning: boolean;
  readonly samples: readonly TerminalPerfSample[];
  readonly frames: readonly FrameStatsRecord[];
  readonly probes: readonly KeystrokeProbe[];
  readonly counters: {
    readonly sourceChanges: number;
    readonly sourceMountedMs: number;
    readonly windows: number;
    readonly windowsTimedOut: number;
    readonly windowErrors: number;
  };
  /** Bounded-buffer honesty: how many records were dropped because the cap was
   * reached. A lab that silently forgot the second half of a flood would report
   * the opening as the run — the same trap `MAX_PERFORMANCE_SAMPLES` sets
   * upstream (worker :2706), named here rather than repeated. */
  readonly dropped: { samples: number; frames: number; probes: number };
  /** What the PAGE says about its own presentability, for the window this drain
   * covers. An occluded or hidden Chromium window stops rAF and backgrounds its
   * renderer, so a measurement taken there reports zeros that read exactly like
   * a very fast terminal. The lab's `single-pane` run collected frame samples in
   * rotation 0 and none in rotations 1–3 for precisely that reason, and this is
   * how a later run says so instead of publishing the zeros. */
  readonly visibility: {
    readonly state: string;
    readonly focused: boolean;
    /** visibilitychange transitions to hidden since the last drain. Non-zero
     * invalidates the window it covers. */
    readonly hiddenTransitions: number;
  };
}

/** Per-array caps. Generous enough that a 60s scenario at the sampler's 1Hz
 * pacing never reaches them, small enough that a runaway cannot exhaust the
 * renderer's heap and make the lab the thing that broke the measurement. */
const MAX_SAMPLES = 4_000;
/** LoAF entries kept while the long-frame probe is armed. A cold open produces
 * a handful; the cap is there so an armed observer left running through a flood
 * cannot grow without bound. */
const MAX_LONG_FRAMES = 2_000;
const MAX_FRAMES = 20_000;
const MAX_PROBES = 20_000;

/** One `long-animation-frame` entry, reduced to the three numbers a cold open
 * needs: when the stretch began (page clock, the same origin the cold-open
 * trace stamps in), how long it lasted, and how much of it the engine calls
 * BLOCKING — the part during which no other task could run. */
export interface LongFrameRecord {
  readonly startMs: number;
  readonly durationMs: number;
  readonly blockingMs: number;
}

/** The key a probe rides in. The rig injects printable ASCII and the fixture
 * echoes it, so a probe id has to be reconstructible from ONE character. The
 * alphabet is deliberately 32 wide: a run injecting more than 32 keys reuses
 * ids, and the rig pairs them in arrival order within a window rather than by
 * id alone (`probeId` is a correlation aid, not a primary key). */
export const PROBE_ALPHABET = "abcdefghijklmnopqrstuvwxyz012345";

export function probeIdForIndex(index: number): string {
  return PROBE_ALPHABET[index % PROBE_ALPHABET.length] as string;
}

class TerminalPerfLab {
  readonly #samples: TerminalPerfSample[] = [];
  readonly #frames: FrameStatsRecord[] = [];
  readonly #probes: KeystrokeProbe[] = [];
  readonly #dropped = { samples: 0, frames: 0, probes: 0 };
  #unsubscribe: (() => void) | undefined;
  #frameStats: FrameStatsHandle | null = null;
  #keydown: ((event: KeyboardEvent) => void) | undefined;
  #lastSampleAt = -1;
  #hiddenTransitions = 0;
  #visibilityListener: (() => void) | undefined;
  #longFrames: LongFrameRecord[] = [];
  #longFrameObserver: PerformanceObserver | undefined;

  /**
   * TP-S1m — WATCH THE MAIN THREAD, on request.
   *
   * The cold-open trace can time a round trip but not say why one was slow: a
   * reply that is ready in fieldd and a reply the page has not got around to
   * reading look identical from the outside, and TP-S0c read one as the other.
   * `long-animation-frame` names the difference — every entry is a stretch the
   * page could not run a task in, so a mint whose answer landed inside one was
   * waiting on THIS thread rather than on the daemon.
   *
   * Opt-in per run (`VF_PERF_LONGTASKS=1`) and OFF by default, so a before/after
   * comparison is not itself an A/B on the presence of an observer. `buffered`
   * collects the entries the engine already recorded before this was called —
   * which is what lets main arm it immediately before the open rather than at
   * page load, where it would also record the canvas coming up.
   */
  captureLongFrames(): boolean {
    if (this.#longFrameObserver !== undefined) return true;
    if (typeof PerformanceObserver === "undefined") return false;
    const types = PerformanceObserver.supportedEntryTypes;
    if (!Array.isArray(types) || !types.includes("long-animation-frame")) return false;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (this.#longFrames.length >= MAX_LONG_FRAMES) return;
        const loaf = entry as PerformanceEntry & { blockingDuration?: number };
        this.#longFrames.push({
          startMs: Math.round(entry.startTime * 10) / 10,
          durationMs: Math.round(entry.duration * 10) / 10,
          blockingMs: Math.round((loaf.blockingDuration ?? 0) * 10) / 10,
        });
      }
    });
    observer.observe({ type: "long-animation-frame", buffered: true });
    this.#longFrameObserver = observer;
    return true;
  }

  /** Drain what the observer has seen. Empty when it was never armed. */
  takeLongFrames(): LongFrameRecord[] {
    const drained = this.#longFrames;
    this.#longFrames = [];
    return drained;
  }

  /**
   * TP-S1m — GT-3p's monitor kill switch, reachable from the rig.
   *
   * This is the one place the bridge's "may not make the app behave
   * differently" rule is deliberately spent, and only because the thing it
   * reaches for exists ONLY to be spent: `lab-switches.ts` is GT-D15.4's
   * instrument for "remove a layer and watch the readout move", memory-only and
   * unlabelled as a preference. Driving it from the panel measures a steady
   * deck; driving it from here measures the OPEN, which is the one moment the
   * layer's cost lands on a station a user can feel.
   *
   * Off by default and set only when the rig asks — a run that does not call
   * this is byte-for-byte the run that shipped.
   */
  setMonitorEnabled(enabled: boolean): boolean {
    setLabSwitches({ ...getLabSwitches(), monitor: enabled });
    return getLabSwitches().monitor;
  }

  /** Start accumulating. Idempotent — main may call it once per arm. */
  start(mode: TerminalPerfMode): void {
    this.#unsubscribe?.();
    // The sampler publishes its LATEST window; the lab keeps them all. Windows
    // are identified by `sample.at`, which the sampler stamps once per close,
    // so a state change with no new window (a source attaching, say) does not
    // record a duplicate.
    if (this.#visibilityListener === undefined) {
      const listener = (): void => {
        if (document.visibilityState === "hidden") this.#hiddenTransitions += 1;
      };
      this.#visibilityListener = listener;
      document.addEventListener("visibilitychange", listener);
    }
    this.#unsubscribe = terminalPerf.subscribe((state) => {
      const sample = state.sample;
      if (sample === null || sample.at === this.#lastSampleAt) return;
      this.#lastSampleAt = sample.at;
      if (this.#samples.length >= MAX_SAMPLES) this.#dropped.samples += 1;
      else this.#samples.push(sample);
    });
    terminalPerf.setMode(mode);
  }

  setMode(mode: TerminalPerfMode): TerminalPerfMode {
    terminalPerf.setMode(mode);
    // Read it BACK rather than echoing the request: `setMode` refuses anything
    // above `off` in a build whose sampling door was never opened, and a rig
    // that trusted its own request would publish a whole baseline of zeros
    // labelled `metrics`. This is the line that makes that impossible — and it
    // is the line that CAUGHT it: the lab's first run reported effective mode
    // `off` under arm `metrics` with zero windows, which is how the missing
    // door was found rather than published.
    return terminalPerf.mode;
  }

  /** Start the rAF/LoAF loop. Separate from `start` because it is a LOAD:
   * a rAF loop holds the compositor at full rate, which is exactly what a
   * frame-pacing measurement wants and exactly what an idle-cost measurement
   * (TP-R1) must not have. */
  startFrames(sampleHz = 4): void {
    if (this.#frameStats !== null) return;
    this.#frameStats = startFrameStats({
      sampleHz,
      onSample: (sample) => {
        if (this.#frames.length >= MAX_FRAMES) this.#dropped.frames += 1;
        else this.#frames.push({ ...sample, at: Date.now() });
      },
    });
  }

  stopFrames(): void {
    this.#frameStats?.stop();
    this.#frameStats = null;
  }

  /** Record every keydown the document sees, with the identity the rig gave it.
   *
   * CAPTURE phase and `passive: true`: the listener must observe the key before
   * anything can stop its propagation, and must never be able to delay the
   * handler it is measuring. A `passive` listener cannot call `preventDefault`,
   * which is the guarantee in code that this probe does not change what the key
   * does. */
  startProbes(): void {
    if (this.#keydown !== undefined) return;
    const handler = (event: KeyboardEvent): void => {
      if (this.#probes.length >= MAX_PROBES) {
        this.#dropped.probes += 1;
        return;
      }
      const now = performance.now();
      const target = event.target;
      const described =
        target instanceof Element
          ? `${target.tagName.toLowerCase()}.${target.className || "-"}`
          : String(target);
      const record: { -readonly [K in keyof KeystrokeProbe]: KeystrokeProbe[K] } = {
        probeId: event.key,
        domKeydownMs: now,
        domKeydownWallMs: Date.now(),
        eventTimeStampMs: event.timeStamp,
        target: described,
        nextRafMs: null,
      };
      this.#probes.push(record as KeystrokeProbe);
      // The first frame callback AFTER this key. One rAF, not a loop — this
      // must not become a second frame-stats loop holding the compositor awake.
      requestAnimationFrame((frameNow) => {
        record.nextRafMs = frameNow;
      });
    };
    this.#keydown = handler;
    document.addEventListener("keydown", handler, { capture: true, passive: true });
  }

  stopProbes(): void {
    if (this.#keydown === undefined) return;
    document.removeEventListener("keydown", this.#keydown, { capture: true });
    this.#keydown = undefined;
  }

  snapshot(): TerminalPerfLabSnapshot {
    const state = terminalPerf.state();
    return {
      mode: state.mode,
      sourceAttached: state.sourceAttached,
      rendererBackend: getTerminalPerfSource()?.rendererBackend ?? null,
      framesRunning: this.#frameStats !== null,
      samples: [...this.#samples],
      frames: [...this.#frames],
      probes: [...this.#probes],
      counters: state.counters,
      dropped: { ...this.#dropped },
      visibility: {
        state: typeof document === "undefined" ? "unknown" : document.visibilityState,
        focused: typeof document === "undefined" ? false : document.hasFocus(),
        hiddenTransitions: this.#hiddenTransitions,
      },
    };
  }

  /** Take everything and forget it, so an A/B arm's records can never be
   * attributed to the arm after it. Returns what `snapshot()` would have. */
  drain(): TerminalPerfLabSnapshot {
    const taken = this.snapshot();
    this.#samples.length = 0;
    this.#frames.length = 0;
    this.#probes.length = 0;
    this.#dropped.samples = 0;
    this.#dropped.frames = 0;
    this.#dropped.probes = 0;
    this.#hiddenTransitions = 0;
    return taken;
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.stopFrames();
    this.stopProbes();
    if (this.#visibilityListener !== undefined) {
      document.removeEventListener("visibilitychange", this.#visibilityListener);
      this.#visibilityListener = undefined;
    }
    terminalPerf.setMode("off");
  }
}

/** The stage histograms of a set of windows, pooled.
 *
 * Pooled rather than averaged: a p99 is a property of a distribution, and the
 * mean of twelve p99s is a number with no distribution behind it. Pooling the
 * underlying per-window samples is not possible — the sampler already reduced
 * them — so this pools the WINDOW summaries weighted by nothing and says so:
 * `p50` here is the median of the windows' p50s, which is a median of medians
 * and is reported under that name. The unpooled per-window values ride the
 * JSONL, so a stronger reduction stays available to whoever wants one. */
export function medianOfWindows(
  samples: readonly TerminalPerfSample[],
  pick: (sample: TerminalPerfSample) => StageHistogram,
): { medianP50: number; medianP95: number; medianP99: number; max: number; windows: number } {
  const kept = samples.map(pick).filter((stage) => stage.count > 0);
  if (kept.length === 0) return { medianP50: 0, medianP95: 0, medianP99: 0, max: 0, windows: 0 };
  const median = (values: readonly number[]): number => summarizeStage(values).p50;
  return {
    medianP50: median(kept.map((s) => s.p50)),
    medianP95: median(kept.map((s) => s.p95)),
    medianP99: median(kept.map((s) => s.p99)),
    max: Math.max(...kept.map((s) => s.max)),
    windows: kept.length,
  };
}

declare global {
  interface Window {
    __vfTerminalPerfLab?: TerminalPerfLab;
  }
}

/** Publish the bridge. Called once, from the renderer host, behind the mode
 * constant. Returns the instance so a test can drive it without a window. */
export function installTerminalPerfLab(): TerminalPerfLab {
  const existing = globalThis.window?.__vfTerminalPerfLab;
  if (existing !== undefined) return existing;
  // The sampler's door, opened here and nowhere else — see
  // `terminal-perf.ts`'s `allowSamplingForPerfLab`. Before this line the lab
  // build is a production build that reports `metrics` requested and `off`
  // effective, which is exactly what the first run did.
  allowSamplingForPerfLab();
  const lab = new TerminalPerfLab();
  if (globalThis.window !== undefined) {
    globalThis.window.__vfTerminalPerfLab = lab;
    // Through the marker module, which is where every harness marker in this app
    // is emitted from and the one file `noConsole` exempts.
    emitTerminalPerfLabMarker();
  }
  return lab;
}

export type { TerminalPerfLab };
