// Mode selection (ESR §5.2.6): parsed ONCE, here — window, supervisor, and
// security code receive a mode, never argv.

export type ShellMode =
  | "production"
  | "dev"
  | "smoke"
  | "smoke-canvas"
  | "smoke-plugin-restart"
  | "smoke-godview"
  | "live-surfaces-lab"
  | "terminal-perf-lab"
  | "terminal-door-probe"
  | "spike-loro";

/** Precedence mirrors the pre-split dispatch order in main(). */
export function parseMode(argv: readonly string[]): ShellMode {
  if (argv.includes("--live-surfaces-lab")) return "live-surfaces-lab";
  if (argv.includes("--terminal-perf-lab")) return "terminal-perf-lab";
  if (argv.includes("--terminal-door-probe")) return "terminal-door-probe";
  if (argv.includes("--spike-loro")) return "spike-loro";
  if (argv.includes("--smoke-plugin-restart")) return "smoke-plugin-restart";
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
    mode === "smoke" ||
    mode === "smoke-canvas" ||
    mode === "smoke-plugin-restart" ||
    mode === "smoke-godview" ||
    mode === "live-surfaces-lab" ||
    mode === "terminal-perf-lab" ||
    mode === "terminal-door-probe" ||
    mode === "spike-loro"
  );
}

/** TP-S3a — the DIRECT terminal door (terminal-pipeline-v3 TP-D1 as ratified):
 * the renderer dials the cells' loopback WebSocket doors itself. OFF by
 * default until TP-S3e retires the bridge; while off, production keeps its
 * two pinned fieldd ports in `connect-src`; while on, the policy admits
 * `ws://127.0.0.1:*` (security-policy.ts) — the same rollback flag that will
 * route the pool's transport at S3b. Parsed ONCE, here, like the mode. The
 * probe mode implies it. */
export function parseDirectTerminalDoor(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (argv.includes("--terminal-direct-door")) return true;
  if (argv.includes("--terminal-door-probe")) return true;
  return env["VIBEFIELD_TERMINAL_DIRECT_DOOR"] === "1";
}

/** Daemon lifetime policy (ESR §7.3): smoke runs stop what they spawned;
 * production leaves daemons running past the shell (two-plane law). Dev is
 * leave-running too — §7.3 permits either, and the dev-runner is the daemon
 * custodian: a shell-only rebuild restarts Electron alone and the new shell
 * ADOPTS the running pair (buildId-gated probe); the runner reaps the pair
 * on daemon-plane changes and at session end.
 *
 * Test-only lab/spike modes are leave-running despite passing isSmokeLike:
 * they touch no daemon, so have nothing to stop and no right to stop another
 * process's. `terminal-perf-lab` is the exception among the labs (TP-S0c): it
 * SPAWNS a pair against its own isolated data root and drives real sessions
 * through it, so it owns them and stops them — otherwise a night of A/B arms
 * would leave one daemon pair and a hundred ptys per run behind. The
 * `terminal-door-probe` (TP-S3a) is the same shape: its own pair, one session,
 * stop-owned. */
export function shutdownPolicy(mode: ShellMode): "stop-owned" | "leave-running" {
  return mode === "smoke" ||
    mode === "smoke-canvas" ||
    mode === "smoke-plugin-restart" ||
    mode === "smoke-godview" ||
    mode === "terminal-perf-lab" ||
    mode === "terminal-door-probe"
    ? "stop-owned"
    : "leave-running";
}
