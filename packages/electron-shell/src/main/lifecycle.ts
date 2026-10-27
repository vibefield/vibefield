import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import { app } from "electron";
import { createQuitFlow, type QuitFlow } from "./quit-flow";
import type { QuitGate } from "./quit-gate";
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
// (QuitFlow's update mode), a signal from outside (`leavePairsOnQuit`: dev's
// SIGTERM/SIGINT, the runner's restart and its own shutdown alike, AL-4) — skips
// the gate and leaves the pairs, and a mode with no gate is unchanged. Every
// re-issued `app.quit()` runs from a macrotask: a quit re-issued inside a promise
// continuation can leave the process alive on macOS (electron #55208).

/** The quit flow plus WP12c's undo for an update quit that ABORTED after `before-quit` had durable-closed the windows
 * (`build-wp12-updater.md` §10 S4: the daemon's re-check refused, so nothing stopped and the app stays). */
export interface LifecycleFlow extends QuitFlow {
  /** Clear what the aborted quit left behind here — the durable-close replay flags and the observed-quit mark — so the
   * next ordinary quit durable-closes the reopened window again. The caller cancels the registry's shutdown and the
   * tray's `quitting`, then reopens the primary window. */
  resetAfterAbortedQuit(): void;
  /** AL-4 — the next quit is not a person's (a signal from outside: the dev runner's restart, or its own shutdown, which
   * stops the daemons itself): no gate, and the pairs are left for whoever owns them next. */
  leavePairsOnQuit(cause: "signal"): void;
  /** AL-D6 — the OS is ending the session (powerMonitor `shutdown`: logout, restart, power off): from here the gate
   * never asks, and the durable close never waits on a person. */
  noteOsSessionEnding(): void;
  readonly osSessionEnding: boolean;
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
}): LifecycleFlow {
  const logger = opts.logger.child({ component: "lifecycle" });
  const flow = createQuitFlow({
    closeWindows: () => opts.registry.disposeAll(),
    dispose: async () => {
      logger.info("desktop.lifecycle.stopping", "Electron shell is stopping");
      opts.disposeShell();
      await (opts.getSupervisor()?.dispose() ?? Promise.resolve());
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
  const replayQuit = (): void => {
    replayingNativeQuit = true;
    setImmediate(() => app.quit());
  };
  const resetQuitState = (): void => {
    quitAfterPrimaryCloses = false;
    replayingNativeQuit = false;
    quitObserved = false;
    gate = "open";
  };
  /** The windows are closed: a decided gate stops the pairs first; then the native quit is replayed. */
  const afterWindowsClosed = (): void => {
    const quitGate = opts.getQuitGate?.() ?? null;
    if (gate !== "decided" || quitGate === null) {
      replayingNativeQuit = true;
      app.quit();
      return;
    }
    if (stopping) return;
    stopping = true;
    void quitGate.stop().then(
      (outcome) => {
        stopping = false;
        if (outcome === "aborted") {
          resetQuitState();
          opts.onQuitAborted?.();
          return;
        }
        replayQuit();
      },
      (error: unknown) => {
        stopping = false;
        logger.error(
          "desktop.quit.stop_failed",
          "The quit's stop failed; the pairs it named may still run",
          error,
        );
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
          gate = decision === "proceed" ? "decided" : "open";
          if (decision === "proceed") setImmediate(() => app.quit());
        },
        (error: unknown) => {
          // a gate that threw decided nothing: the quit goes on and the pairs are left, said
          logger.error(
            "desktop.quit.gate_failed",
            "The quit gate failed; the quit goes on and leaves the pairs running",
            error,
          );
          gate = "decided";
          setImmediate(() => app.quit());
        },
      );
      return;
    }
    opts.onQuitRequested();
    if (replayingNativeQuit) return;
    const primary = opts.registry.primary();
    if (primary === null) {
      if (gate !== "decided") return; // no window, no gate: nothing to defer
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
  };
}
