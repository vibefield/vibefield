import { spawn } from "node:child_process";
import { SHELL_BACKGROUND_RELAUNCH_ARG, type ShellExitRecord } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";

// AL-5 (`draft/thinking-app-lifecycle.md` §8.2; AL-D4, AL-D8) — what a pair does while no shell holds its lease:
// - no live session for the whole IDLE span → it ends itself, the floor with it (`stopForIdle`: the consented stop
//   with nothing to end, reason `idle`);
// - an UNPLANNED exit that left live sessions → after a short delay it relaunches the app into the menu bar, so the
//   sessions have a visible owner again and Quit is a click away — at most RELAUNCH_CAP times per window, then it
//   stops relaunching and says so (a crash loop must not become an app that cannot be got rid of).
// A shell attaching ends both. Pure policy over injected effects; the daemon wires the effects.

export const SHELL_ABSENCE = {
  /** AL-D4 — no shell and no session for this long ends the pair */
  IDLE_EXIT_MS: 10 * 60_000,
  /** how often the idle watch reads the floor's count while no shell holds the lease */
  IDLE_POLL_MS: 30_000,
  /** AL-D8 — the relaunch waits this long after an unplanned exit (a quick manual relaunch wins) */
  RELAUNCH_DELAY_MS: 5_000,
  /** AL-D8 — at most this many relaunches … */
  RELAUNCH_CAP: 3,
  /** … inside this window */
  RELAUNCH_WINDOW_MS: 10 * 60_000,
} as const;

export interface ShellAbsenceOptions {
  readonly liveSessions: () => number | null;
  /** the consented stop with nothing to end, reason `idle`, then fieldd's own exit */
  readonly stopForIdle: () => Promise<void>;
  /** relaunch the app into the menu bar; null = this fieldd cannot (a dev or unpackaged run, another platform) */
  readonly relaunchShell: (() => Promise<boolean>) | null;
  readonly logger: Logger;
  readonly now?: () => number;
  readonly timings?: Partial<Record<keyof typeof SHELL_ABSENCE, number>>;
}

export class ShellAbsence {
  private readonly t: Record<keyof typeof SHELL_ABSENCE, number>;
  private readonly now: () => number;
  private idleSince: number | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private relaunchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly relaunches: number[] = [];
  private stopping = false;
  /** no shell holds the lease (between `vacant` and `held`) */
  private vacancy = false;

  constructor(private readonly opts: ShellAbsenceOptions) {
    this.t = { ...SHELL_ABSENCE, ...(opts.timings ?? {}) };
    this.now = opts.now ?? Date.now;
  }

  /** the last shell left (the lease's record) */
  vacant(record: ShellExitRecord): void {
    this.clear();
    this.vacancy = true;
    this.armIdle();
    this.watchIdle();
    if (!record.planned && (record.sessions ?? 1) > 0) this.scheduleRelaunch();
  }

  /** a shell holds the lease again */
  held(): void {
    this.vacancy = false;
    this.clear();
  }

  dispose(): void {
    this.vacancy = false;
    this.clear();
  }

  private armIdle(): void {
    this.idleTimer = setInterval(() => this.watchIdle(), this.t.IDLE_POLL_MS);
    this.idleTimer.unref?.();
  }

  private clear(): void {
    if (this.idleTimer !== null) clearInterval(this.idleTimer);
    if (this.relaunchTimer !== null) clearTimeout(this.relaunchTimer);
    this.idleTimer = null;
    this.relaunchTimer = null;
    this.idleSince = null;
  }

  private watchIdle(): void {
    if (this.stopping) return;
    const live = this.opts.liveSessions();
    if (live !== 0) {
      // a session, or a count that cannot be read: never idle on a guess
      this.idleSince = null;
      return;
    }
    const now = this.now();
    this.idleSince ??= now;
    if (now - this.idleSince < this.t.IDLE_EXIT_MS) return;
    this.stopping = true;
    this.clear();
    this.opts.logger.info(
      "fieldd.shell_absence.idle_exit",
      "No shell and no session for the orphan bound: the pair ends itself",
      { idleMs: now - (this.idleSince ?? now) },
    );
    void this.opts.stopForIdle().catch((error: unknown) => {
      this.stopping = false;
      this.opts.logger.warn("fieldd.shell_absence.idle_exit_failed", "The idle stop did not run", {
        error: error instanceof Error ? error.message : String(error),
      });
      // the floor refused it (a session born at the last moment, an inventory older than its bound): still no shell,
      // so the watch goes on and a whole new span must pass; a shell back meanwhile ended it
      if (this.vacancy) this.armIdle();
    });
  }

  private scheduleRelaunch(): void {
    const relaunch = this.opts.relaunchShell;
    if (relaunch === null) return;
    this.relaunchTimer = setTimeout(() => {
      this.relaunchTimer = null;
      const now = this.now();
      while (
        this.relaunches.length > 0 &&
        now - (this.relaunches[0] ?? now) > this.t.RELAUNCH_WINDOW_MS
      ) {
        this.relaunches.shift();
      }
      if (this.relaunches.length >= this.t.RELAUNCH_CAP) {
        this.opts.logger.warn(
          "fieldd.shell_absence.relaunch_capped",
          "The app went away again; it is not relaunched past the cap, and the sessions keep running",
          { relaunches: this.relaunches.length, windowMs: this.t.RELAUNCH_WINDOW_MS },
        );
        return;
      }
      this.relaunches.push(now);
      void relaunch().then(
        (started) =>
          this.opts.logger.info(
            "fieldd.shell_absence.relaunched",
            "The app went away with sessions running; it was relaunched into the menu bar",
            { started, relaunches: this.relaunches.length },
          ),
        (error: unknown) =>
          this.opts.logger.warn(
            "fieldd.shell_absence.relaunch_failed",
            "The app could not be relaunched",
            {
              error: error instanceof Error ? error.message : String(error),
            },
          ),
      );
    }, this.t.RELAUNCH_DELAY_MS);
    this.relaunchTimer.unref?.();
  }
}

/** AL-D8 — the app bundle this fieldd ships in, read from its OWN path (never from a message, EL7): a packaged fieldd
 * is `<…>.app/Contents/Resources/bin/fieldd`. null on any other path or platform: a dev run's shells are its runner's. */
export function appBundleOf(execPath: string, platform: NodeJS.Platform): string | null {
  if (platform !== "darwin") return null;
  return /^(.+\.app)\/Contents\/Resources\/bin\/fieldd$/.exec(execPath)?.[1] ?? null;
}

/** `open -g -a <bundle> --args --background-relaunch`: LaunchServices starts the app without taking focus. */
export function relaunchFromBundle(bundle: string): () => Promise<boolean> {
  return () =>
    new Promise<boolean>((resolve) => {
      const child = spawn("open", ["-g", "-a", bundle, "--args", SHELL_BACKGROUND_RELAUNCH_ARG], {
        detached: true,
        stdio: "ignore",
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
}
