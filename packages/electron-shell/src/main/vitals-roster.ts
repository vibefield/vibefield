import { VITALS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";

// VT-2 (track VT, 2026-11-24) — THE SHELL'S ROSTER. The floor measures every pid, and only Electron main knows
// which Chromium process is which: the desk's window, the GPU process, a browser pane, a helper. Main names them for
// fieldd (`vitals.roster.set`, the whole list each time) WHEN THE LIST CHANGES, never on a timer: a process is born
// or gone, a window loads, a new fieldd is attached. One short one-shot wait folds a burst of such events into one
// report. This is one more steady-state duty for main, an amendment to PF2's closed list (DECISIONS VT, VT-D7).
//
// A row is a pid, a role from fieldd's closed list and Chromium's own name for a helper. It carries no URL, title,
// argument or path (VT-D4).

/** What `app.getAppMetrics()` says of one process, as far as the roster reads it. */
export interface ShellProcessMetric {
  readonly pid: number;
  /** Chromium's process type: "Browser", "Tab", "GPU", "Utility", "Zygote", … */
  readonly type: string;
  /** a utility process's service name ("Network Service"), where Chromium gives one */
  readonly name?: string | undefined;
  readonly serviceName?: string | undefined;
}

/** A renderer process main can name: its OS pid and what it draws. */
export interface ShellRendererRole {
  readonly pid: number;
  readonly role: "window" | "vitals-window" | "studio-window" | "browser-pane";
}

export interface VitalsRosterRow {
  pid: number;
  role: string;
  label?: string;
}

/** The roster of one moment, pure: Chromium's processes named by what main knows of them, in pid order. A renderer
 * main cannot name is a browser pane's or a guest's and is said as `other`, never guessed to be the desk. */
export function shellRoster(
  metrics: readonly ShellProcessMetric[],
  renderers: readonly ShellRendererRole[],
): VitalsRosterRow[] {
  const byPid = new Map(renderers.map((renderer) => [renderer.pid, renderer.role]));
  const rows: VitalsRosterRow[] = [];
  const seen = new Set<number>();
  for (const metric of metrics) {
    if (!Number.isSafeInteger(metric.pid) || metric.pid <= 0 || seen.has(metric.pid)) continue;
    seen.add(metric.pid);
    switch (metric.type) {
      case "Browser":
        rows.push({ pid: metric.pid, role: "main" });
        break;
      case "GPU":
        rows.push({ pid: metric.pid, role: "gpu" });
        break;
      case "Tab":
        rows.push({ pid: metric.pid, role: byPid.get(metric.pid) ?? "other" });
        break;
      default: {
        const name = (metric.name ?? metric.serviceName ?? metric.type).trim();
        rows.push({
          pid: metric.pid,
          role: "utility",
          ...(name === "" ? {} : { label: name.slice(0, VITALS.LABEL_MAX) }),
        });
      }
    }
  }
  return rows.sort((a, b) => a.pid - b.pid).slice(0, VITALS.ROSTER_MAX);
}

/** How long a burst of process events is folded before one report is read and sent. */
export const VITALS_ROSTER_SETTLE_MS = 400;

export interface VitalsRosterClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

export interface VitalsRosterReporterOptions {
  read(): VitalsRosterRow[];
  /** main's fieldd client now, or null while there is none */
  client(): VitalsRosterClient | null;
  logger: Logger;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** Sends the roster when it changed. `poke()` is called by every event that can change it; `fresh()` by a newly
 * attached fieldd, which has heard nothing yet. */
export class VitalsRosterReporter {
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private waiting: unknown = null;
  private sent: string | null = null;
  private disposed = false;

  constructor(private readonly options: VitalsRosterReporterOptions) {
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  poke(): void {
    if (this.disposed || this.waiting !== null) return;
    this.waiting = this.setTimer(() => {
      this.waiting = null;
      void this.report();
    }, VITALS_ROSTER_SETTLE_MS);
  }

  /** A fieldd that was just attached knows no roster: forget what was sent and report. */
  fresh(): void {
    this.sent = null;
    this.poke();
  }

  dispose(): void {
    this.disposed = true;
    if (this.waiting !== null) this.clearTimer(this.waiting);
    this.waiting = null;
  }

  private async report(): Promise<void> {
    if (this.disposed) return;
    const client = this.options.client();
    if (client === null) return;
    let rows: VitalsRosterRow[];
    try {
      rows = this.options.read();
    } catch (error) {
      this.options.logger.warn(
        "desktop.vitals.roster_unreadable",
        "Electron could not list its own processes for the vitals roster",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return;
    }
    const fingerprint = JSON.stringify(rows);
    if (fingerprint === this.sent) return;
    try {
      await client.request("vitals.roster.set", { processes: rows });
      this.sent = fingerprint;
    } catch (error) {
      // a fieldd without the door (older than VT-1) or one that is leaving: nothing is retried on a timer; the
      // next process event or the next fieldd asks again
      this.options.logger.debug(
        "desktop.vitals.roster_refused",
        "fieldd did not take the shell's vitals roster",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}
