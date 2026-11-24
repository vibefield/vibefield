import { VITALS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";

// VT-3b (track VT, 2026-11-24) — ELECTRON MAIN'S OWN VITALS: the share of each second main's own thread was
// running, said to fieldd (`vitals.own.report`), which carries it on Main's row of the census as its loop's busy
// share.
//
// It runs ONLY while the Vitals window is open, so it adds nothing to main's duties at rest (PF2): the window's
// open is what starts it and its close what stops it. While it runs it is one fold a second and one request. Main's
// share then includes what relaying the window's feed costs, which is the truth of that second.
//
// WHAT IT READS, AND WHY NOT THE LOOP'S OWN COUNTERS. fieldd reads Node's event-loop utilization. In Electron's
// main process those counters stand still: Chromium's message loop drives Node's, which never waits in its own
// poll, so the runtime counts no idle and no active time. Measured 2026-11-24 on Electron 43.1.1: the utilization
// read 0 through idle seconds and through seconds held for 250, 500 and 900 ms alike. A zero that was not measured
// is never said, so main reads its own THREAD's CPU time instead (`process.threadCpuUsage`): the same probe read
// 0.25, 0.50 and 0.88 for those held seconds and under 0.01 at rest. It is the share of the second main's thread
// was running JavaScript or native code. It does not count a second main spent asleep in a blocking call, which
// the loop's counters would have.

/** The calling thread's CPU time so far, in microseconds: Node's `process.threadCpuUsage()`. */
type ThreadCpu = () => { user: number; system: number };

export interface MainOwnClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

export interface MainOwnReporterOptions {
  /** main's fieldd client now, or null while there is none */
  client(): MainOwnClient | null;
  logger: Logger;
  /** the main thread's CPU time; null where this runtime cannot say it. The runtime's, unless a test says. */
  threadCpu?: ThreadCpu | null;
  /** a monotonic clock in microseconds */
  clockUs?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

function runtimeThreadCpu(): ThreadCpu | null {
  const read = (process as { threadCpuUsage?: ThreadCpu }).threadCpuUsage;
  return typeof read === "function" ? () => read.call(process) : null;
}

export class MainOwnReporter {
  private readonly threadCpu: ThreadCpu | null;
  private readonly clockUs: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private timer: unknown = null;
  private before: { cpuUs: number; atUs: number } | null = null;
  private sending = false;

  constructor(private readonly options: MainOwnReporterOptions) {
    this.threadCpu = options.threadCpu === undefined ? runtimeThreadCpu() : options.threadCpu;
    this.clockUs = options.clockUs ?? (() => Number(process.hrtime.bigint() / 1_000n));
    this.setTimer =
      options.setTimer ??
      ((fn, ms) => {
        const timer = setInterval(fn, ms);
        // a quit never waits on a measure
        timer.unref();
        return timer;
      });
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
  }

  /** Whether it is reporting: true only between the Vitals window's open and its close. */
  get running(): boolean {
    return this.timer !== null;
  }

  private read(): { cpuUs: number; atUs: number } | null {
    if (this.threadCpu === null) return null;
    const cpu = this.threadCpu();
    return { cpuUs: cpu.user + cpu.system, atUs: this.clockUs() };
  }

  /** The Vitals window opened. A second call while running changes nothing. A runtime that cannot say its
   * thread's CPU time reports nothing at all: Main's row then says no loop, never a zero. */
  start(): void {
    if (this.timer !== null) return;
    this.before = this.read();
    if (this.before === null) {
      this.options.logger.debug(
        "desktop.vitals.own_unmeasured",
        "This runtime cannot read main's own thread time; main's loop is not said",
      );
      return;
    }
    this.timer = this.setTimer(() => this.tick(), VITALS.SAMPLE_INTERVAL_MS);
  }

  /** The Vitals window closed, or main is leaving. */
  stop(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
    this.before = null;
  }

  private tick(): void {
    const client = this.options.client();
    // with nobody to tell, or the last report still on its way, the interval is left open: the next fold covers it
    if (client === null || this.sending || this.before === null) return;
    const now = this.read();
    if (now === null) return;
    const wallUs = now.atUs - this.before.atUs;
    const cpuUs = now.cpuUs - this.before.cpuUs;
    this.before = now;
    if (!(wallUs > 0) || !Number.isFinite(cpuUs)) return;
    const loopBusy = Math.round(Math.min(1, Math.max(0, cpuUs / wallUs)) * 10_000) / 10_000;
    this.sending = true;
    client
      .request("vitals.own.report", { own: { loopBusy } })
      .catch((error: unknown) => {
        // a fieldd without the door, or one that is leaving: said in the log, never retried on its own
        this.options.logger.debug(
          "desktop.vitals.own_refused",
          "fieldd did not take main's own vitals",
          { error: error instanceof Error ? error.message : String(error) },
        );
      })
      .finally(() => {
        this.sending = false;
      });
  }
}
