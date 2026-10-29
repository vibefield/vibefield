import type { EventEmitter } from "node:events";

type SignalSource = Pick<EventEmitter, "on" | "off">;

/** The signals that end the shell from outside — a terminal's Ctrl-C, a process manager's TERM, the hangup of a
 * terminal that closed — the three Electron itself turns into an ordinary quit (LC-26's read). */
const QUIT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Translate terminal/process-manager signals into Electron's normal quit flow.
 *
 * Node's default SIGTERM behavior exits immediately, which would bypass
 * `will-quit` and skip durable-close and window teardown. (Daemons are the
 * dev-runner's to reap — dev runs leave-running — so what this protects is
 * the shell's own orderly shutdown, not daemon custody.) The handlers also
 * cover watched main-process restarts and stay installed until exit, so
 * repeated signals cannot restore that unsafe default midway through teardown.
 *
 * AU-5a (LC-26's read, 2026-10-29) — installed in EVERY mode, production too. A bare Electron 43.1.1 turns SIGTERM,
 * SIGINT and SIGHUP into an ordinary `app.quit()` (before-quit → will-quit → quit), so a production shell with no
 * handler of ours met the census gate on a signal exactly as on a person's ⌘Q, and stopped the pairs. A signal is
 * never a person's quit (ESR §7.3 as amended): the caller marks the quit as the shell's own (`leavePairsOnQuit`)
 * before it quits, so the gate is skipped and the pairs are left for whoever owns them next.
 */
export function installSignalQuit(source: SignalSource, quit: () => void): () => void {
  let requested = false;
  const requestQuit = (): void => {
    if (requested) return;
    requested = true;
    quit();
  };

  for (const signal of QUIT_SIGNALS) source.on(signal, requestQuit);
  return () => {
    for (const signal of QUIT_SIGNALS) source.off(signal, requestQuit);
  };
}
