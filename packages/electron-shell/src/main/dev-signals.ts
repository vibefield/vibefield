import type { EventEmitter } from "node:events";

type SignalSource = Pick<EventEmitter, "on" | "off">;

/**
 * Translate terminal/process-manager signals into Electron's normal quit flow.
 *
 * Node's default SIGTERM behavior exits immediately, which would bypass
 * `will-quit` and strand the dev-owned fieldd/native children. The handlers
 * also cover watched main-process restarts and stay installed until exit, so
 * repeated signals cannot restore that unsafe default midway through teardown.
 */
export function installDevSignalQuit(source: SignalSource, quit: () => void): () => void {
  const signals = ["SIGINT", "SIGTERM"] as const;
  let requested = false;
  const requestQuit = (): void => {
    if (requested) return;
    requested = true;
    quit();
  };

  for (const signal of signals) source.on(signal, requestQuit);
  return () => {
    for (const signal of signals) source.off(signal, requestQuit);
  };
}
