import { VITALS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";

// VT-4b (track VT, 2026-11-24; VT-D11 A) — WHAT ONLY ELECTRON MAIN SEES DIE. fieldd keeps incidents
// (`fieldd/src/vitals-incidents.ts`), and the shell's own processes are Chromium's: only main hears a GPU or helper
// process gone (`child-process-gone`), a page's process gone (`render-process-gone`), a page that stops responding
// and answers again, and main's own error nobody caught. This says each to fieldd (`vitals.incident.report`, main
// alone), naming the process by the role main's roster already gives it, never by anything it shows or runs.
//
// It only listens: nothing here changes what Chromium or the runtime does next. Nothing is timed. A report made while
// no fieldd is attached is held, a few at most, and said when one is. What dies while the app is quitting dies
// because it was asked to, and is not said, nor is a process's clean exit.

/** What main reports, as `VitalsIncidentReportParams` reads it. */
export interface ShellIncidentReport {
  kind: "exit" | "error" | "unresponsive" | "responsive";
  role: string;
  label?: string;
  pid?: number;
  at: number;
  detail?: {
    code?: number;
    reason?: string;
    errorName?: string;
    message?: string;
  };
}

export interface ShellIncidentClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

/** As much of a WebContents as the reporter hears. */
export interface IncidentContents {
  on(
    event: "render-process-gone",
    listener: (event: unknown, details: GoneDetails) => void,
  ): unknown;
  on(event: "unresponsive" | "responsive" | "did-finish-load", listener: () => void): unknown;
  once(event: "destroyed", listener: () => void): unknown;
}

/** Chromium's words for a process gone. */
export interface GoneDetails {
  reason: string;
  exitCode: number;
}

export interface ChildGoneDetails extends GoneDetails {
  type: string;
  name?: string | undefined;
  serviceName?: string | undefined;
}

/** Who a page is: its roster role and its pid, while main can say them. */
export type ContentsName = () => { role: string; pid: number | null };

/** Reports held while no fieldd is attached. */
export const SHELL_INCIDENTS_HELD_MAX = 16;

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function said(value: unknown, key: "name" | "message"): string {
  try {
    const read = (value as Record<string, unknown> | null | undefined)?.[key];
    return typeof read === "string" ? read : "";
  } catch {
    return "";
  }
}

/** Chromium's process type, as the roster names it: the GPU process by its role, every other a helper by its name. */
function childRole(details: ChildGoneDetails): { role: string; label?: string } {
  if (details.type === "GPU") return { role: "gpu" };
  const name = (details.name ?? details.serviceName ?? details.type).trim();
  return { role: "utility", ...(name === "" ? {} : { label: name.slice(0, VITALS.LABEL_MAX) }) };
}

export interface ShellIncidentReporterOptions {
  /** main's fieldd client now, or null while there is none */
  client(): ShellIncidentClient | null;
  logger: Logger;
  now?: () => number;
  /** main's own pid */
  pid?: number;
}

export class ShellIncidentReporter {
  private readonly now: () => number;
  private readonly pid: number;
  private held: ShellIncidentReport[] = [];
  private leaving = false;
  private readonly heard = new WeakSet<object>();

  constructor(private readonly options: ShellIncidentReporterOptions) {
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
  }

  /** The app is quitting: what ends from now on ends because it was asked to. */
  leave(): void {
    this.leaving = true;
    this.held = [];
  }

  /** A Chromium child process ended (`app`'s `child-process-gone`). */
  childGone(details: ChildGoneDetails): void {
    if (details.reason === "clean-exit") return;
    this.say({
      kind: "exit",
      ...childRole(details),
      at: this.now(),
      detail: { reason: cut(details.reason, 64), code: details.exitCode },
    });
  }

  /** Hear one page: its process gone, and its stopping and starting to respond. Once a page. */
  watchContents(contents: IncidentContents, name: ContentsName): void {
    if (this.heard.has(contents)) return;
    this.heard.add(contents);
    // a page whose process is gone has no pid to read, so the last one read is said
    let last: { role: string; pid: number | null } = { role: "other", pid: null };
    const read = (): { role: string; pid: number | null } => {
      try {
        const now = name();
        last = { role: now.role, pid: now.pid ?? last.pid };
      } catch {
        // the last one read stands
      }
      return last;
    };
    read();
    const subject = (): { role: string; pid?: number } => {
      const who = read();
      return { role: who.role, ...(who.pid !== null ? { pid: who.pid } : {}) };
    };
    contents.on("did-finish-load", () => {
      read();
    });
    contents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") return;
      this.say({
        kind: "exit",
        ...subject(),
        at: this.now(),
        detail: { reason: cut(details.reason, 64), code: details.exitCode },
      });
    });
    contents.on("unresponsive", () =>
      this.say({ kind: "unresponsive", ...subject(), at: this.now() }),
    );
    contents.on("responsive", () => this.say({ kind: "responsive", ...subject(), at: this.now() }));
  }

  /** Main met an error nobody caught (`uncaughtExceptionMonitor`): Electron shows its dialog and main goes on. */
  mainError(error: unknown): void {
    const errorName = cut((said(error, "name") || "Error").trim(), 128);
    let message = said(error, "message");
    if (message === "") {
      try {
        message = typeof error === "string" ? error : String(error);
      } catch {
        message = "";
      }
    }
    message = cut(message.trim(), VITALS.INCIDENT_MESSAGE_MAX);
    this.say({
      kind: "error",
      role: "main",
      pid: this.pid,
      at: this.now(),
      detail: { errorName, ...(message === "" ? {} : { message }) },
    });
  }

  /** Hear main's own errors. Returns how to stop hearing. */
  listen(source: {
    on(event: "uncaughtExceptionMonitor", listener: (error: unknown) => void): unknown;
    off(event: "uncaughtExceptionMonitor", listener: (error: unknown) => void): unknown;
  }): () => void {
    const listener = (error: unknown): void => this.mainError(error);
    source.on("uncaughtExceptionMonitor", listener);
    return () => source.off("uncaughtExceptionMonitor", listener);
  }

  /** A fieldd was attached: say what was held for it. */
  flush(): void {
    if (this.options.client() === null) return;
    const held = this.held;
    this.held = [];
    for (const report of held) this.say(report);
  }

  private say(report: ShellIncidentReport): void {
    if (this.leaving) return;
    const client = this.options.client();
    if (client === null) {
      this.held.push(report);
      if (this.held.length > SHELL_INCIDENTS_HELD_MAX)
        this.held.splice(0, this.held.length - SHELL_INCIDENTS_HELD_MAX);
      return;
    }
    client.request("vitals.incident.report", report).catch((error: unknown) => {
      // a fieldd without the door, or one that is leaving: said in main's own log, never retried on a timer
      this.options.logger.debug(
        "desktop.vitals.incident_refused",
        "fieldd did not take an incident main saw",
        {
          kind: report.kind,
          role: report.role,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    });
  }
}

// -- the Vitals window's one ask ---------------------------------------------------------------------------------

/** The window's ask, `{ v: 1, kind: "incident", id }` as a JSON string, read strictly: an id of the incident form,
 * or nothing. */
export function readIncidentAsk(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 256) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const ask = value as Record<string, unknown>;
  const id = ask["id"];
  if (ask["v"] !== 1 || ask["kind"] !== "incident" || typeof id !== "string") return null;
  return /^[0-9a-z]{1,16}-[0-9a-f]{8}$/.test(id) ? id : null;
}

/** One incident read at a time for the window, the newest ask winning: while one is out, a later ask waits, and an
 * ask in between is dropped for it. The answer goes down the feed as `{ kind: "incident", event: "snapshot" }`, or
 * `event: "down"` with the id when fieldd cannot answer. */
export class VitalsIncidentAsks {
  private out = false;
  private next: string | null = null;

  constructor(
    private readonly read: (id: string) => Promise<unknown> | null,
    private readonly post: (message: Record<string, unknown>) => void,
  ) {}

  hear(raw: unknown): void {
    const id = readIncidentAsk(raw);
    if (id === null) return;
    if (this.out) {
      this.next = id;
      return;
    }
    this.ask(id);
  }

  private ask(id: string): void {
    const pending = this.read(id);
    if (pending === null) {
      this.post({ kind: "incident", event: "down", id });
      return;
    }
    this.out = true;
    pending
      .then(
        (payload) => this.post({ kind: "incident", event: "snapshot", payload }),
        () => this.post({ kind: "incident", event: "down", id }),
      )
      .finally(() => {
        this.out = false;
        const next = this.next;
        this.next = null;
        if (next !== null) this.ask(next);
      });
  }
}
