// The quit flow, PURE (ESR §5.2.1 + 2026-07-23 review P1): every path out of
// the process must AWAIT bounded supervisor disposal before the process dies.
// The old will-quit ran `void dispose()` — the SIGTERM landed (synchronous
// prefix) but the 2s SIGKILL escalation and the native TERM needed a live
// event loop that Electron had already torn down. The flow always defers the
// native quit and exits explicitly once teardown settles or the bound expires.
// Electron appears only in lifecycle.ts — tests drive this with plain fakes.

const DISPOSE_BOUND_MS = 4_000; // stopChild is 2s TERM-wait + KILL; ×2 headroom
/** WP12c — how long the install may take to quit the app after `quitAndInstall()` before the flow exits anyway. */
const INSTALL_QUIT_BOUND_MS = 30_000;

/** What WP12c's prepare step decided (`build-wp12-updater.md` §10 S3/S4; the PM's rulings 13:36–13:40Z):
 *  - `install`: everything that must hold did — hand the install off (`plan.install()`), then exit on Electron's own
 *    quit;
 *  - `abort`: refused BEFORE the daemon stop — nothing stopped, nothing staged: the flow does not exit;
 *  - `exit`: refused AFTER the daemon stop — the flow always exits, relaunching only when nothing can be armed. */
export type UpdatePrepared =
  | { readonly kind: "install" }
  | { readonly kind: "abort"; readonly reason: string }
  | { readonly kind: "exit"; readonly relaunch: boolean; readonly reason: string };

export interface UpdateQuitPlan {
  /** Runs once the windows have durable-closed (fieldd alive for their flush): the daemons' consented stop, then
   * Squirrel's staging — an irreversible step goes after the last refusal, never before it. */
  prepare(): Promise<UpdatePrepared>;
  /** `quitAndInstall()`: Squirrel's `relaunchToInstallUpdate` terminates the app, so Electron's own quit follows. */
  install(): void;
  /** The flow did not exit (an `abort`): the caller restores the shell — the window reopens, nothing else changed. */
  aborted(reason: string): void;
  /** The handed-off install never quit the app in time, or the updater reported it failed: said, then the flow exits
   * WITHOUT relaunch — the payload is staged and is applied at the next start (`electron.d.ts:2103-2104`). */
  installStalled(reason: string): Promise<void>;
}

export interface QuitFlow {
  /** AL-3 — an update's quit is armed: its own consent ran, so the quit gate does not ask again. */
  readonly updateArmed: boolean;
  /** will-quit: ALWAYS defer the native quit; the first call starts teardown
   * and exits 0 when it settles. Later calls just keep deferring. */
  willQuit(preventDefault: () => void): void;
  /** fatal boot failure: same bounded teardown, exit code 1. */
  fatal(error: unknown): void;
  /** WP12c's UPDATE MODE (§10 S3). Arm it, then quit as usual: the first will-quit (after `before-quit`'s durable
   * close) runs `plan.prepare()` instead of the teardown and, on `install`, hands the install off and keeps the process
   * alive — because **Electron's own quit arrives AFTER `quitAndInstall()`** (Squirrel's `relaunchToInstallUpdate`
   * terminates the app), and only that quit may exit. Without this mode `willQuit`'s first call would exit before
   * ShipIt took over. Returns false when a quit is already underway (nothing is armed). */
  armUpdate(plan: UpdateQuitPlan): boolean;
  /** The updater reported that the handed-off install failed: the flow says so and exits without relaunch. */
  updateInstallFailed(reason: string): void;
}

export function createQuitFlow(deps: {
  closeWindows: () => void;
  dispose: () => Promise<void>;
  exit: (code: number) => void;
  onFatal: (error: unknown) => void;
  onTeardownError?: (error: unknown) => void;
  /** `app.relaunch()` — called only before an exit that can have armed nothing (WP12c's Squirrel refusal). */
  relaunch?: () => void;
  boundMs?: number;
  installQuitBoundMs?: number;
}): QuitFlow {
  const bound = deps.boundMs ?? DISPOSE_BOUND_MS;
  const installBound = deps.installQuitBoundMs ?? INSTALL_QUIT_BOUND_MS;
  let exiting = false;
  interface Update {
    readonly plan: UpdateQuitPlan;
    phase: "armed" | "preparing" | "installing" | "stalling";
    timer: ReturnType<typeof setTimeout> | null;
  }
  let update: Update | null = null;

  function teardown(): Promise<void> {
    try {
      deps.closeWindows();
    } catch (error) {
      deps.onTeardownError?.(error);
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, bound);
      (timer as { unref?: () => void }).unref?.();
      deps
        .dispose()
        .catch((error: unknown) => deps.onTeardownError?.(error))
        .then(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  }

  function runOnce(code: number): void {
    if (exiting) return; // teardown already running; its exit() will land
    exiting = true;
    void teardown().then(() => deps.exit(code));
  }

  function clearUpdate(current: Update): void {
    if (current.timer !== null) clearTimeout(current.timer);
    current.timer = null;
    if (update === current) update = null;
  }

  /** The handed-off install did not end the process: say so, then exit WITHOUT relaunch. */
  function stall(current: Update, reason: string): void {
    if (current.phase !== "installing") return;
    current.phase = "stalling";
    if (current.timer !== null) clearTimeout(current.timer);
    current.timer = null;
    void current.plan
      .installStalled(reason)
      .catch((error: unknown) => deps.onTeardownError?.(error))
      .then(() => {
        clearUpdate(current);
        runOnce(0);
      });
  }

  async function step(current: Update): Promise<void> {
    if (current.phase === "installing") {
      // Electron's own quit, after quitAndInstall: the one that exits
      clearUpdate(current);
      runOnce(0);
      return;
    }
    if (current.phase !== "armed") return; // preparing or stalling: keep deferring
    current.phase = "preparing";
    try {
      deps.closeWindows();
    } catch (error) {
      deps.onTeardownError?.(error);
    }
    let prepared: UpdatePrepared;
    try {
      prepared = await current.plan.prepare();
    } catch (error) {
      // A prepare that threw cannot say whether the daemons stopped, so the safe reading is that they did: exit, and
      // never relaunch over a payload that may be armed.
      prepared = {
        kind: "exit",
        relaunch: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (update !== current) return;
    if (prepared.kind === "abort") {
      clearUpdate(current);
      current.plan.aborted(prepared.reason);
      return;
    }
    if (prepared.kind === "exit") {
      clearUpdate(current);
      if (prepared.relaunch) deps.relaunch?.();
      runOnce(0);
      return;
    }
    current.phase = "installing";
    current.timer = setTimeout(
      () => stall(current, "the install did not quit the app in time"),
      installBound,
    );
    try {
      current.plan.install();
    } catch (error) {
      stall(current, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    willQuit(preventDefault) {
      preventDefault(); // the native quit never proceeds; we always exit()
      if (update !== null && !exiting) {
        void step(update);
        return;
      }
      runOnce(0);
    },
    fatal(error) {
      deps.onFatal(error);
      if (update !== null) clearUpdate(update);
      runOnce(1);
    },
    armUpdate(plan) {
      if (exiting || update !== null) return false;
      update = { plan, phase: "armed", timer: null };
      return true;
    },
    updateInstallFailed(reason) {
      if (update !== null) stall(update, reason);
    },
    get updateArmed() {
      return update !== null;
    },
  };
}
