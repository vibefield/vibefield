import type { Logger } from "@vibefield/logging";

// VT-4a (track VT, 2026-11-24) — NOTHING DIES SILENTLY, Electron main's half. Main had no ear for an error nobody
// caught: Electron shows its own dialog and main goes on, and the log said nothing. Nor for the runtime's warnings
// (a promise nobody handled, a listener leak), which went to a stderr with no reader in a packaged app.
//
// Both ears only listen. `uncaughtExceptionMonitor` is told of the error before the runtime acts on it and changes
// nothing of what happens next; a `warning` listener does not stop the runtime's own print. Main keeps running
// after either, so the ordinary log writer has time to write.

/** How much of a message and a stack one record keeps, in characters. */
const MESSAGE_MAX = 2_000;
const STACK_MAX = 16_000;
/** A runtime that warns without end is said this many times a run, then once more that it went on. */
export const MAIN_WARNINGS_SAID_MAX = 20;

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more)`;

function field(value: unknown, key: "name" | "message" | "stack"): string {
  try {
    const read = (value as Record<string, unknown> | null | undefined)?.[key];
    return typeof read === "string" ? read : "";
  } catch {
    return "";
  }
}

/** As much of `process` as the ears use: a test hands its own. */
export interface FaultSource {
  on(
    event: "uncaughtExceptionMonitor",
    listener: (error: unknown, origin: string) => void,
  ): unknown;
  on(event: "warning", listener: (warning: unknown) => void): unknown;
}

/** Hear main's own faults for the log. Called once, when main's logger exists. */
export function hearMainFaults(logger: Logger, source: FaultSource = process as FaultSource): void {
  source.on("uncaughtExceptionMonitor", (error, origin) => {
    logger.fatal("desktop.lifecycle.uncaught", "Electron main met an error nobody caught", error, {
      origin: cut(String(origin), 64),
    });
  });
  let said = 0;
  source.on("warning", (warning) => {
    said += 1;
    if (said > MAIN_WARNINGS_SAID_MAX + 1) return;
    if (said === MAIN_WARNINGS_SAID_MAX + 1) {
      logger.warn(
        "desktop.lifecycle.runtime_warnings_muted",
        "The runtime keeps warning; later warnings of this run are not said",
        { said: MAIN_WARNINGS_SAID_MAX },
      );
      return;
    }
    logger.warn("desktop.lifecycle.runtime_warning", "The runtime warned Electron main", {
      warningName: cut(field(warning, "name") || "Warning", 128),
      warningMessage: cut(field(warning, "message") || String(warning), MESSAGE_MAX),
      stack: cut(field(warning, "stack"), STACK_MAX),
    });
  });
}
