import { type EventLoopUtilization, PerformanceObserver, performance } from "node:perf_hooks";
import { VITALS } from "@vibefield/contracts";
import type { VitalsOwnV1 } from "@vibefield/contracts/vitals";

// VT-3 (track VT, 2026-11-24; DECISIONS VT) — FIELDD'S OWN VITALS: what only fieldd can say of itself, folded once a
// sample and carried on its own row of the census (`VitalsPointV1.own`).
//
// It costs no wake at rest, which is why it measures a busy SHARE and not a delay. Node's loop-delay histogram is a
// timer that fires every few milliseconds for as long as it is on, a steady wake the idle budget forbids (the
// wedge detector turns it on only while an episode is open, `native-supervisor.ts`). The event loop's utilization is
// two counters the runtime already keeps: read when the recorder makes a sample, their difference is the share of
// that second the loop was running something. A garbage collection is counted when it happens, by the runtime's own
// observer, and a request when it replies.

/** A method's name as its row may carry it: a registered product method, bounded. */
function boundedMethod(method: string): string {
  return method.length <= VITALS.METHOD_MAX ? method : method.slice(0, VITALS.METHOD_MAX);
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export interface OwnVitalsOptions {
  /** The loop's utilization: with none, since the process began; with two, the first less the second. The
   * runtime's, unless a test says. */
  utilization?: (now?: EventLoopUtilization, before?: EventLoopUtilization) => EventLoopUtilization;
  /** Start hearing garbage collections; returns how to stop. Absent in a test that feeds `noteGc` itself. */
  observeGc?: (onPause: (ms: number) => void) => () => void;
}

/** The runtime's garbage-collection entries. The observer's callback runs only after a collection. */
function observeRuntimeGc(onPause: (ms: number) => void): () => void {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) onPause(entry.duration);
  });
  observer.observe({ entryTypes: ["gc"] });
  return () => observer.disconnect();
}

export class OwnVitals {
  private readonly utilization: (
    now?: EventLoopUtilization,
    before?: EventLoopUtilization,
  ) => EventLoopUtilization;
  private readonly stopGc: () => void;
  /** whether collections are heard at all: an interval with none is then a true zero */
  private readonly gcHeard: boolean;
  private loop: EventLoopUtilization;
  private gcMs = 0;
  private gcMaxMs = 0;
  private slow: { method: string; ms: number } | null = null;

  constructor(options: OwnVitalsOptions = {}) {
    this.utilization =
      options.utilization ?? ((now, before) => performance.eventLoopUtilization(now, before));
    this.loop = this.utilization();
    let stop: () => void = () => undefined;
    let heard = false;
    try {
      stop = (options.observeGc ?? observeRuntimeGc)((ms) => this.noteGc(ms));
      heard = true;
    } catch {
      // a runtime with no gc entries: the pauses are left out, never said as none
    }
    this.stopGc = stop;
    this.gcHeard = heard;
  }

  /** A garbage collection paused the process for `ms`. */
  noteGc(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.gcMs += ms;
    if (ms > this.gcMaxMs) this.gcMaxMs = ms;
  }

  /** A request replied `ms` after it arrived. Only the slowest of an interval is kept, and only its method. */
  noteRequest(method: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || method === "") return;
    if (this.slow === null || ms > this.slow.ms) this.slow = { method: boundedMethod(method), ms };
  }

  /** What fieldd says of itself since the last fold. Called once a recorded sample; it starts the next interval. */
  fold(): VitalsOwnV1 {
    const now = this.utilization();
    const since = this.utilization(now, this.loop);
    this.loop = now;
    const own: VitalsOwnV1 = {};
    if (Number.isFinite(since.utilization)) {
      own.loopBusy = round(Math.min(1, Math.max(0, since.utilization)), 4);
    }
    if (this.gcHeard) {
      own.gcMs = round(this.gcMs, 2);
      own.gcMaxMs = round(this.gcMaxMs, 2);
    }
    if (this.slow !== null) own.slow = { method: this.slow.method, ms: round(this.slow.ms, 1) };
    this.gcMs = 0;
    this.gcMaxMs = 0;
    this.slow = null;
    return own;
  }

  dispose(): void {
    this.stopGc();
  }
}
