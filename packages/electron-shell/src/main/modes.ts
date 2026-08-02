// Mode selection (ESR §5.2.6): parsed ONCE, here — window, supervisor, and
// security code receive a mode, never argv.

export type ShellMode =
  | "production"
  | "dev"
  | "smoke"
  | "smoke-canvas"
  | "smoke-godview"
  | "spike-loro";

/** Precedence mirrors the pre-split dispatch order in main(). */
export function parseMode(argv: readonly string[]): ShellMode {
  if (argv.includes("--spike-loro")) return "spike-loro";
  if (argv.includes("--smoke-godview")) return "smoke-godview";
  if (argv.includes("--smoke")) return "smoke";
  if (argv.includes("--smoke-canvas")) return "smoke-canvas";
  if (argv.includes("--dev")) return "dev";
  return "production";
}

/** Test-harness modes: transient, port-isolated runs that never present UI.
 * They skip the single-instance lock (slice-0 finding 1: a lock-blocked smoke
 * exited 0 with no output — a silent false pass) and the workarea fill. */
export function isSmokeLike(mode: ShellMode): boolean {
  return (
    mode === "smoke" || mode === "smoke-canvas" || mode === "smoke-godview" || mode === "spike-loro"
  );
}

/** Daemon lifetime policy (ESR §7.3): smoke runs stop what they spawned;
 * production leaves daemons running past the shell (two-plane law). Dev is
 * leave-running too — §7.3 permits either, and the dev-runner is the daemon
 * custodian: a shell-only rebuild restarts Electron alone and the new shell
 * ADOPTS the running pair (buildId-gated probe); the runner reaps the pair
 * on daemon-plane changes and at session end.
 *
 * spike-loro is leave-running despite passing isSmokeLike: it touches no
 * daemon, so it has nothing to stop and no right to stop anyone else's. */
export function shutdownPolicy(mode: ShellMode): "stop-owned" | "leave-running" {
  return mode === "smoke" || mode === "smoke-canvas" || mode === "smoke-godview"
    ? "stop-owned"
    : "leave-running";
}
