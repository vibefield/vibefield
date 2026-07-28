import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import { app } from "electron";
import { createQuitFlow, type QuitFlow } from "./quit-flow";
import type { WindowRegistry } from "./window-policy";

// Lifecycle in ONE place (ESR §5.2.1): every path out of the process —
// window-all-closed, will-quit, second-instance, fatal boot failure — runs
// through the quit flow, which AWAITS bounded supervisor disposal before
// app.exit (2026-07-23 review P1: `void dispose()` lost the TERM→KILL
// escalation the moment Electron exited). Hooked on will-quit, not
// before-quit, so windows close first and installDurableClose gets its flush
// before daemons are told to stop. Smoke runners exit via app.exit() directly
// and never enter this flow. Adopted daemons are never killed — that law
// lives in the supervisor itself.

export function installLifecycle(opts: {
  registry: WindowRegistry;
  getSupervisor: () => FielddSupervisor | null;
  openPrimaryWindow: () => Promise<void>;
  keepAliveWithoutWindows: () => boolean;
  onQuitRequested: () => void;
  disposeShell: () => void;
  logger: Logger;
  closeLogging: () => Promise<void>;
}): QuitFlow {
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
  app.on("window-all-closed", () => {
    logger.info("desktop.lifecycle.all_windows_closed", "All Electron windows closed");
    if (quitAfterPrimaryCloses) {
      replayingNativeQuit = true;
      app.quit();
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
    opts.onQuitRequested();
    const primary = opts.registry.primary();
    if (replayingNativeQuit || primary === null) return;

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
  return flow;
}
