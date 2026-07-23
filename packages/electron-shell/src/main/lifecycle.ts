import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
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
}): QuitFlow {
  const flow = createQuitFlow({
    closeWindows: () => opts.registry.disposeAll(),
    dispose: () => opts.getSupervisor()?.dispose() ?? Promise.resolve(),
    exit: (code) => app.exit(code),
    onFatal: (error) => console.error("[shell] fatal:", error),
    onTeardownError: (error) => console.error("[shell] teardown:", error),
  });
  app.on("second-instance", () => opts.registry.focusPrimary());
  app.on("window-all-closed", () => app.quit()); // skeleton: no tray icon yet
  app.on("will-quit", (e) => flow.willQuit(() => e.preventDefault()));
  return flow;
}
