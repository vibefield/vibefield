// Mode selection (ESR §5.2.6): parsed ONCE, here — window, supervisor, and
// security code receive a mode, never argv.

export type ShellMode = "production" | "dev" | "smoke" | "smoke-canvas" | "spike-loro";

/** Precedence mirrors the pre-split dispatch order in main(). */
export function parseMode(argv: readonly string[]): ShellMode {
  if (argv.includes("--spike-loro")) return "spike-loro";
  if (argv.includes("--smoke")) return "smoke";
  if (argv.includes("--smoke-canvas")) return "smoke-canvas";
  if (argv.includes("--dev")) return "dev";
  return "production";
}

/** Test-harness modes: transient, port-isolated runs that never present UI.
 * They skip the single-instance lock (slice-0 finding 1: a lock-blocked smoke
 * exited 0 with no output — a silent false pass) and the workarea fill. */
export function isSmokeLike(mode: ShellMode): boolean {
  return mode === "smoke" || mode === "smoke-canvas" || mode === "spike-loro";
}

/** Daemon lifetime policy (ESR §7.3): dev/smoke stop what they spawned;
 * production leaves daemons running past the shell (two-plane law). */
export function shutdownPolicy(mode: ShellMode): "stop-owned" | "leave-running" {
  return mode === "dev" || mode === "smoke" || mode === "smoke-canvas"
    ? "stop-owned"
    : "leave-running";
}
