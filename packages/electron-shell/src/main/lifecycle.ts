import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app } from "electron";
import type { WindowRegistry } from "./window-policy";

// Lifecycle in ONE place (ESR §5.2.1): every path out of the process —
// window-all-closed, will-quit, second-instance, fatal boot failure — runs
// through here, and teardown order is visible: windows → supervisor
// (dispose closes the shell client and applies stop-owned/leave-running;
// adopted daemons are never killed — that is the supervisor's own law).

export function installLifecycle(opts: {
  registry: WindowRegistry;
  getSupervisor: () => FielddSupervisor | null;
}): void {
  app.on("second-instance", () => opts.registry.focusPrimary());
  app.on("window-all-closed", () => app.quit()); // skeleton: no tray icon yet
  app.on("will-quit", () => {
    opts.registry.disposeAll();
    void opts.getSupervisor()?.dispose();
  });
}

/** Boot failure: report, tear down (a spawned daemon must not leak — slice-0
 * finding 3), exit non-zero. Idempotent dispose makes will-quit overlap safe. */
export function fatal(error: unknown, getSupervisor: () => FielddSupervisor | null): void {
  console.error("[shell] fatal:", error);
  void getSupervisor()?.dispose();
  app.exit(1);
}
