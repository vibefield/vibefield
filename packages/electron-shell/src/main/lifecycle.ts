import type { ShellLeaveReason } from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import { app } from "electron";
import { createQuitFlow, type QuitFlow } from "./quit-flow";
import type { QuitGate, QuitStopOutcome } from "./quit-gate";
import type { WindowRegistry } from "./window-policy";

// Lifecycle in ONE place (ESR §5.2.1): every path out of the process —
// window-all-closed, will-quit, second-instance, fatal boot failure — runs
// through the quit flow, which AWAITS bounded supervisor disposal before
// app.exit (2026-07-23 review P1: `void dispose()` lost the TERM→KILL
// escalation the moment Electron exited). Hooked on will-quit, not
// before-quit, so windows close first and installDurableClose gets its flush
// before daemons are told to stop. Smoke runners exit via app.exit() directly
// and never enter this flow. An adopted fieldd is never killed — that law
// lives in the supervisor itself.
//
// AL-3 (ESR §7.3 as amended 2026-10-27) — a PERSON's quit passes the quit gate
// first (`quit-gate.ts`): before anything closes, the census and, when it has to,
// the consent box; after the durable close, the consented stop of every pair;
// only then the native quit. A quit the shell performs itself — an update
// (QuitFlow's update mode), a signal from outside (`leavePairsOnQuit`: SIGTERM,
// SIGINT or SIGHUP — dev's runner restarting the shell or ending its session,
// AL-4, and since AU-5a the same signals in production and every other build) —
// skips the gate and leaves the pairs, and a mode with no gate is unchanged. Every
// re-issued `app.quit()` runs from a macrotask: a quit re-issued inside a promise
// continuation can leave the process alive on macOS (electron #55208).
//
// AU-7 (AU-G8; LC-25, LC-37; main-process.md §8.4) — Move to Applications is a
// person's quit through the same gate (`quitThen`), with the move in place of the
// plain native quit: Electron's mover copies the bundle, trashes this one and
// opens the copy once this process exits. It runs only after a COMPLETE stop — a
// pair left running would execute from the Trash, and a person who cancels must
// not be left running from it — so anything less opens VibeField again where it
// was, logged. A signal or the OS ending the session moves nothing.
//
// AU-5 (AU-D9 A; AU-G3; main-process.md §7.1, §7.3) — install on quit: after a
// person's quit has stopped every pair (a COMPLETE stop), and before the native
// quit, a ready update is handed to Squirrel (`installOnQuit`, the controller's,
// bounded there); nothing relaunches. Never on a quit that is not the person's —
// a signal's, an update's own, the OS ending the session (AL-D6: ShipIt is not
// proven inside loginwindow's budget) — never on an incomplete stop, and never
// while a move waits (LC-25: the move runs in its place). A hook that throws is
// logged and the quit goes on.

/** The quit flow plus WP12c's undo for an update quit that ABORTED after `before-quit` had durable-closed the windows
 * (`build-wp12-updater.md` §10 S4: the daemon's re-check refused, so nothing stopped and the app stays). */
export interface LifecycleFlow extends QuitFlow {
  /** Clear what the aborted quit left behind here — the durable-close replay flags and the observed-quit mark — so the
   * next ordinary quit durable-closes the reopened window again. The caller cancels the registry's shutdown and the
   * tray's `quitting`, then reopens the primary window. */
  resetAfterAbortedQuit(): void;
  /** AL-4 — the next quit is not a person's (a signal from outside: the dev runner's restart, or its own shutdown, which
   * stops the daemons itself; AU-5a: any signal, in every build): no gate, and the pairs are left for whoever owns
   * them next. */
  leavePairsOnQuit(cause: "signal"): void;
  /** AL-D6 — the OS is ending the session (powerMonitor `shutdown`: logout, restart, power off): from here the gate
   * never asks, and the durable close never waits on a person. */
  noteOsSessionEnding(): void;
  readonly osSessionEnding: boolean;
  /** AL-7 — why this shell leaves the pairs it holds, when it leaves them running ON PURPOSE (each supervisor's
   * dispose says it, `system.shell.leave`): a signal's quit is a `restart`, an armed update an `update`, and a person's
   * quit whose census could not be read a `quit`. undefined = nothing planned to say: the pairs were stopped, or the
   * shell is simply going (then the pair records the exit unplanned, which is true). */
  readonly leaveReason: ShellLeaveReason | undefined;
  /** AU-7 — quit through the gate, then run `after` (the move: true when it moved) in place of the plain native quit.
   * Resolves when the gate decides: `proceed` (the windows close), `cancel` (nothing changed), or at once `busy` (a
   * quit, an update's quit or another move is underway; the OS is ending the session). */
  quitThen(after: () => Promise<boolean>): Promise<"proceed" | "cancel" | "busy">;
  /** AU-7 (LC-25) — a move waits for the quit: nothing stages an install while it does (an update's quit is refused) */
  readonly movePending: boolean;
}

export function installLifecycle(opts: {
  registry: WindowRegistry;
  getSupervisor: () => FielddSupervisor | null;
  openPrimaryWindow: () => Promise<void>;
  keepAliveWithoutWindows: () => boolean;
  onQuitRequested: () => void;
  disposeShell: () => void;
  logger: Logger;
  closeLogging: () => Promise<void>;
  /** AL-3 — the quit gate, late-bound (it is built with the pairs, after boot); null or absent = no gate (smokes,
   * labs, a boot that never reached its pairs), and a person's quit leaves the pairs as before. */
  getQuitGate?: () => QuitGate | null;
  /** AL-3 — a session was born during the quit and the person kept the app: give it back (the update abort's restore:
   * the registry's shutdown cancelled, the tray's `quitting` cleared, the primary window reopened). */
  onQuitAborted?: () => void;
  /** AU-5 — after a person's quit stopped every pair, hand a ready update to Squirrel before the native quit (late-bound
   * by the caller like `getQuitGate`; its own bounds hold it: a 3 s policy read, a 30 s stage). `ended` = the sessions
   * the stop ended with consent. Absent = nothing installs on a quit. */
  installOnQuit?: (context: { readonly ended: number }) => Promise<void>;
}): LifecycleFlow {
  const logger = opts.logger.child({ component: "lifecycle" });
  const flow = createQuitFlow({
    closeWindows: () => opts.registry.disposeAll(),
    dispose: async () => {
      logger.info("desktop.lifecycle.stopping", "Electron shell is stopping");
      opts.disposeShell();
      const leave = leaveReason();
      await (opts.getSupervisor()?.dispose(leave === undefined ? undefined : { leave }) ??
        Promise.resolve());
      logger.info("desktop.lifecycle.stopped", "Electron shell teardown completed");
      await opts.closeLogging();
    },
    exit: (code) => app.exit(code),
    relaunch: () => app.relaunch(),
    onFatal: (error) =>
      logger.fatal("desktop.lifecycle.fatal", "Electron shell encountered a fatal error", error),
    onTeardownError: (error) =>
      logger.error("desktop.lifecycle.teardown_failed", "Electron shell teardown failed", error),
  });
  app.on("second-instance", () => {
    logger.info("desktop.lifecycle.second_instance_received", "A second app instance was routed");
    void opts.openPrimaryWindow().catch((error) => {
      logger.error(
        "desktop.lifecycle.second_instance_reveal_failed",
        "The primary window could not be revealed for a second instance",
        error,
      );
    });
  });
  app.on("activate", () => {
    logger.info("desktop.lifecycle.activated", "The app was activated");
    void opts.openPrimaryWindow().catch((error) => {
      logger.error(
        "desktop.lifecycle.activation_reveal_failed",
        "The primary window could not be revealed after app activation",
        error,
      );
    });
  });
  let quitAfterPrimaryCloses = false;
  let replayingNativeQuit = false;
  /** AL-3 — where a person's quit stands: `open` (not asked yet), `deciding` (the census or the box is out), `decided`
   * (the stop runs after the durable close). */
  let gate: "open" | "deciding" | "decided" = "open";
  let restarting = false;
  let osSessionEnding = false;
  let stopping = false;
  /** AU-7 — a move to Applications waiting for its quit; `answer` until the gate decides */
  let move: {
    readonly after: () => Promise<boolean>;
    answer: ((decision: "proceed" | "cancel") => void) | null;
  } | null = null;
  const leaveReason = (): ShellLeaveReason | undefined =>
    restarting ? "restart" : flow.updateArmed ? "update" : gate === "decided" ? "quit" : undefined;
  const replayQuit = (): void => {
    replayingNativeQuit = true;
    setImmediate(() => app.quit());
  };
  const resetQuitState = (): void => {
    quitAfterPrimaryCloses = false;
    replayingNativeQuit = false;
    quitObserved = false;
    gate = "open";
    move = null;
  };
  /** AU-7 — the gate decided a move's quit (or there was no gate to ask): its door answers now; a Cancel drops it. */
  const answerMove = (decision: "proceed" | "cancel"): void => {
    if (move === null) return;
    move.answer?.(decision);
    move.answer = null;
    if (decision === "cancel") move = null;
  };
  /** AU-7 (LC-25) — the windows are closed and the stop has run: the move, only after a COMPLETE stop; anything less
   * opens VibeField again where it was (the person is never left with no app). Then the native quit, as ever. */
  const finishMove = async (
    pending: { readonly after: () => Promise<boolean> },
    skip: string | null,
  ): Promise<void> => {
    replayingNativeQuit = true;
    if (restarting || osSessionEnding) {
      logger.info("desktop.update.move_skipped", "The quit was not the person's: nothing moved", {
        why: restarting ? "signal" : "os-session-ending",
      });
      replayQuit();
      return;
    }
    let why = skip;
    let error: string | undefined;
    if (why === null) {
      try {
        // false: the mover refused (an authorization Cancel, another VibeField running there, LC-37)
        if (!(await pending.after())) why = "move-refused";
      } catch (thrown) {
        why = "move-threw";
        error = String(thrown);
      }
    }
    if (why !== null) {
      logger.warn(
        "desktop.update.move_failed",
        "VibeField did not move to Applications; it opens again where it was",
        { why, ...(error !== undefined ? { error } : {}) },
      );
      app.relaunch();
    }
    replayQuit();
  };
  /** AU-5 — a person's quit stopped the pairs: the ready update installs as VibeField quits, then the native quit. Only
   * after a COMPLETE stop of a quit that is still the person's; `stopping` holds meanwhile, so a second ⌘Q during the
   * install is absorbed, never a second stop and an early exit. */
  const installThenQuit = async (
    outcome: Extract<QuitStopOutcome, { kind: "done" }>,
  ): Promise<void> => {
    const install = opts.installOnQuit;
    if (install !== undefined) {
      const skip = restarting
        ? "signal"
        : flow.updateArmed
          ? "update"
          : osSessionEnding
            ? "os-session-ending"
            : !outcome.complete
              ? "incomplete-stop"
              : null;
      if (skip !== null) {
        logger.info(
          "desktop.update.quit_install_skipped",
          "The quit was not the person's, or left a pair running: nothing installs",
          { why: skip },
        );
      } else {
        try {
          await install({ ended: outcome.ended });
        } catch (error) {
          // the quit goes on whatever the hook did: the update waits for the next restart or quit
          logger.error(
            "desktop.update.quit_install_failed",
            "The install on quit failed; VibeField quits and the update waits",
            error,
          );
        }
      }
    }
    stopping = false;
    replayQuit();
  };
  /** AU-5a — a signal came while the person's quit was still open to it. During the gate's box it is not the person's
   * quit, whatever the box answers: VibeField quits, the pairs are left, and nothing a waiting move or an install would
   * do runs. During the stop's re-ask box it acts only on Cancel (the stop comes back `aborted`, and VibeField quits
   * with no further pair stopped); "Quit and end N sessions" finishes the stop already under way, because a quit
   * already stopping waits for that stop's answer (`afterWindowsClosed`). Without it the swallowed signal left
   * `restarting` set for the rest of the session: no later signal acted (the handler's latch) and the person's next ⌘Q
   * skipped the gate.
   * (Corrected 2026-10-30: this said "the gate's re-ask box … whatever the box answers … the pairs are left"; the
   * records' checkers found that a confirmed re-ask finishes the stop.) */
  const quitForSignal = (): boolean => {
    if (!restarting) return false;
    gate = "open";
    answerMove("proceed");
    // the signal's own quit again, as it would have run: past the gate, through the durable close if a window is open
    setImmediate(() => app.quit());
    return true;
  };
  /** The windows are closed: a decided gate stops the pairs first; then the native quit is replayed. */
  const afterWindowsClosed = (): void => {
    const quitGate = opts.getQuitGate?.() ?? null;
    // a quit already stopping (a second ⌘Q, or a signal, during the stop) waits for that stop's answer
    if (stopping) return;
    // AU-5a — a signal's quit stops nothing, even one that came after the gate decided
    if (gate !== "decided" || quitGate === null || restarting) {
      // AU-7 — no gate stopped anything (a mode without one, a signal's quit): a move would leave the pairs running
      if (move !== null) {
        void finishMove(move, "no-stop");
        return;
      }
      replayingNativeQuit = true;
      app.quit();
      return;
    }
    stopping = true;
    void quitGate.stop().then(
      (outcome) => {
        if (outcome.kind === "aborted") {
          stopping = false;
          resetQuitState();
          // AU-5a — the re-ask box stopped nothing, and a signal during it still quits
          if (quitForSignal()) return;
          opts.onQuitAborted?.();
          return;
        }
        // AU-7 (LC-25) — a waiting move runs in place of the install: nothing stages Squirrel under it
        if (move !== null) {
          stopping = false;
          void finishMove(move, outcome.complete ? null : "incomplete-stop");
          return;
        }
        void installThenQuit(outcome);
      },
      (error: unknown) => {
        stopping = false;
        logger.error(
          "desktop.quit.stop_failed",
          "The quit's stop failed; the pairs it named may still run",
          error,
        );
        if (move !== null) {
          void finishMove(move, "stop-failed");
          return;
        }
        replayQuit();
      },
    );
  };
  app.on("window-all-closed", () => {
    logger.info("desktop.lifecycle.all_windows_closed", "All Electron windows closed");
    if (quitAfterPrimaryCloses) {
      afterWindowsClosed();
      return;
    }
    if (opts.keepAliveWithoutWindows()) {
      logger.info(
        "desktop.lifecycle.background_resident",
        "The Electron shell remains available without a renderer window",
      );
      return;
    }
    app.quit();
  });
  app.on("before-quit", (event) => {
    const quitGate = opts.getQuitGate?.() ?? null;
    if (gate === "deciding") {
      event.preventDefault(); // ⌘Q again while the box is up: the box answers it
      return;
    }
    if (gate === "open" && quitGate !== null && !restarting && !flow.updateArmed) {
      event.preventDefault();
      gate = "deciding";
      void quitGate.decide({ unattended: osSessionEnding }).then(
        (decision) => {
          if (quitForSignal()) return;
          gate = decision === "proceed" ? "decided" : "open";
          answerMove(decision);
          if (decision === "proceed") setImmediate(() => app.quit());
        },
        (error: unknown) => {
          // a gate that threw decided nothing: the quit goes on and the pairs are left, said
          logger.error(
            "desktop.quit.gate_failed",
            "The quit gate failed; the quit goes on and leaves the pairs running",
            error,
          );
          if (quitForSignal()) return;
          gate = "decided";
          answerMove("proceed");
          setImmediate(() => app.quit());
        },
      );
      return;
    }
    // AU-7 — no gate to ask (a mode without one, a signal's quit): a move's quit goes on, and moves nothing
    answerMove("proceed");
    opts.onQuitRequested();
    if (replayingNativeQuit) return;
    const primary = opts.registry.primary();
    if (primary === null) {
      // no window, no gate: nothing to defer — unless a move waits, which opens VibeField again where it was
      if (gate !== "decided" && move === null) return;
      event.preventDefault();
      quitAfterPrimaryCloses = true;
      afterWindowsClosed();
      return;
    }

    // app.quit() asks Electron to close windows synchronously, while VibeField's
    // durable-close protocol is intentionally asynchronous. Defer the native
    // quit, let the normal close handler drain and destroy the renderer, then
    // replay app.quit() from window-all-closed.
    event.preventDefault();
    quitAfterPrimaryCloses = true;
    primary.close();
  });
  let quitObserved = false;
  app.on("will-quit", (e) => {
    if (!quitObserved) {
      quitObserved = true;
      logger.info("desktop.lifecycle.quit_requested", "Electron quit was requested");
    }
    flow.willQuit(() => e.preventDefault());
  });
  return {
    ...flow,
    get updateArmed() {
      return flow.updateArmed;
    },
    armUpdate(plan) {
      // AU-7 (LC-25) — a move waits for its quit: no update's quit (and so no Squirrel staging) starts under it
      if (move !== null) return false;
      return flow.armUpdate(plan);
    },
    quitThen(after) {
      if (
        gate !== "open" ||
        flow.updateArmed ||
        restarting ||
        osSessionEnding ||
        stopping ||
        quitAfterPrimaryCloses ||
        replayingNativeQuit ||
        move !== null
      )
        return Promise.resolve("busy" as const);
      return new Promise<"proceed" | "cancel" | "busy">((resolve) => {
        move = { after, answer: resolve };
        logger.info(
          "desktop.update.move_requested",
          "Move to Applications: the quit asks first, then VibeField moves",
        );
        setImmediate(() => app.quit());
      });
    },
    get movePending() {
      return move !== null;
    },
    resetAfterAbortedQuit() {
      resetQuitState();
      logger.info(
        "desktop.lifecycle.update_quit_aborted",
        "An update quit was aborted before the daemons stopped; the app stays",
      );
    },
    leavePairsOnQuit(cause) {
      restarting = true;
      logger.info(
        "desktop.lifecycle.quit_leaves_pairs",
        "The next quit is not a person's: the daemon pairs are left running",
        { cause },
      );
    },
    noteOsSessionEnding() {
      if (osSessionEnding) return;
      osSessionEnding = true;
      logger.info(
        "desktop.lifecycle.os_session_ending",
        "The OS is ending the session: the quit asks nothing",
      );
    },
    get osSessionEnding() {
      return osSessionEnding;
    },
    get leaveReason() {
      return leaveReason();
    },
  };
}
