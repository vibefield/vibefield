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
  | "godview-perf-lab"
  | "terminal-door-probe"
  | "spike-loro";

/** Precedence mirrors the pre-split dispatch order in main(). */
export function parseMode(argv: readonly string[]): ShellMode {
  if (argv.includes("--live-surfaces-lab")) return "live-surfaces-lab";
  if (argv.includes("--terminal-perf-lab")) return "terminal-perf-lab";
  if (argv.includes("--godview-perf-lab")) return "godview-perf-lab";
  if (argv.includes("--terminal-door-probe")) return "terminal-door-probe";
  if (argv.includes("--spike-loro")) return "spike-loro";
  if (argv.includes("--smoke-plugin-restart")) return "smoke-plugin-restart";
  if (argv.includes("--smoke-godview")) return "smoke-godview";
  if (argv.includes("--smoke")) return "smoke";
  if (argv.includes("--smoke-canvas")) return "smoke-canvas";
  if (argv.includes("--dev")) return "dev";
  return "production";
}

/** The Godview worker probe can serve the renderer from Vite while keeping
 * its isolated data root and stop-owned pair. Only RENDERER policies use this
 * answer; daemon lifetime, resources and test dispatch always use ShellMode.
 * The flag has no effect outside that lab, especially in production. */
export function rendererPolicyMode(
  mode: ShellMode,
  godviewLabRenderer: string | undefined,
): ShellMode {
  return mode === "godview-perf-lab" && godviewLabRenderer === "dev" ? "dev" : mode;
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
    mode === "godview-perf-lab" ||
    mode === "terminal-door-probe" ||
    mode === "spike-loro"
  );
}

/** Whether the mode keeps hardware acceleration. Main disables it for every other
 * smoke-like mode: a smoke must run over ssh and on a GPU-less runner, where Chromium's
 * GPU init fails outright. The labs measure the GPU path itself (MV-0: the Godview perf lab
 * too — the swarm's WebGPU canvas is one of the four views it measures). The canvas and
 * plugin-restart smokes draw the DESK — WebGPU alone, no Canvas2D fallback (DK-D32) —
 * so a software run would prove only that the registry loaded (r6b risk 1); each keeps
 * the GPU unless run with `--disable-gpu`, the smokes' GPU-less mode, where the desk's
 * unavailable card is what it asserts instead (DK-3 canvas, DK-5 plugin-restart). */
export function keepsGpu(mode: ShellMode, argv: readonly string[]): boolean {
  if (!isSmokeLike(mode)) return true;
  if (mode === "live-surfaces-lab" || mode === "terminal-perf-lab" || mode === "godview-perf-lab") {
    return true;
  }
  return (
    (mode === "smoke-canvas" || mode === "smoke-plugin-restart") && !argv.includes("--disable-gpu")
  );
}

/**
 * TP-S0c, grown at DK-9: the modes whose window must keep its animation frames while COVERED. Chromium
 * suspends rAF and backgrounds the renderer of an occluded window — for a lab that counts frames that is not
 * "slow", it is zero, and the zero is the compositor's, not the subject's. The terminal perf lab measures frames;
 * so do the GPU-on DESK SMOKES (smoke-canvas, smoke-plugin-restart — its soak): their idle, stillness and frame-rate
 * rows count frames and submits, and on a shared Mac a window something else came to sit on had its desk loop wait
 * for a frame that never came (awake, not a step in a second — DK-9's soak, cycle 1). Production backgrounds a
 * covered window — a battery feature — and so does every other mode.
 * The gate does TWO things: main/index.ts appends Chromium's two switches (DK-9), and since DK-11 the main window's own
 * `backgroundThrottling` is off (window-policy.ts `mainWindowPreferences`) — the switches alone still let a new window's
 * page blink `hidden` for about a second, once, early in its life (measured on Electron 43.1.1), the blink a frame-counting
 * row read as zero.
 */
export function keepsFramesWhenCovered(mode: ShellMode, argv: readonly string[]): boolean {
  if (mode === "terminal-perf-lab") return true;
  return (
    (mode === "smoke-canvas" || mode === "smoke-plugin-restart") && !argv.includes("--disable-gpu")
  );
}

// The `--terminal-direct-door` rollback flag RETIRED at TP-S3e: the routed
// transport is the only one, the production CSP admits the cells' loopback
// WebSockets unconditionally (security-policy.ts), and the bridge it selected
// is gone. `--terminal-door-probe` remains a MODE below.
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
    // MV-0: the Godview perf lab is the perf lab's shape — its own pair, stop-owned
    mode === "godview-perf-lab" ||
    mode === "terminal-door-probe"
    ? "stop-owned"
    : "leave-running";
}
