import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type FaultSource, hearMainFaults, MAIN_WARNINGS_SAID_MAX } from "../src/main/main-faults";

// VT-4a (track VT, 2026-11-24) — nothing dies silently, Electron main's half: an error nobody caught and the
// runtime's own warnings reach main's log, and nothing about what the runtime then does is changed.

interface Said {
  level: string;
  event: string;
  error?: unknown;
  attrs?: Record<string, unknown>;
}

function setup() {
  const said: Said[] = [];
  const logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event: string, _message: string, attrs?: Record<string, unknown>) =>
      void said.push({ level: "warn", event, ...(attrs === undefined ? {} : { attrs }) }),
    error: () => undefined,
    fatal: (event: string, _message: string, error?: unknown, attrs?: Record<string, unknown>) =>
      void said.push({ level: "fatal", event, error, ...(attrs === undefined ? {} : { attrs }) }),
    isLevelEnabled: () => true,
  };
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const source = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    },
  } as unknown as FaultSource;
  hearMainFaults(logger, source);
  return {
    said,
    events: () => [...listeners.keys()].sort(),
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args),
  };
}

describe("VT-4a — Electron main's fault ears", () => {
  it("listens to the two events that only observe, and to neither that would change what the runtime does", () => {
    const main = setup();
    // a listener for `uncaughtException` or `unhandledRejection` would replace the runtime's own handling
    expect(main.events()).toEqual(["uncaughtExceptionMonitor", "warning"]);
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main", "main-faults.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\.on\(\s*"(uncaughtException|unhandledRejection)"/);
  });

  it("says an error nobody caught at fatal, with the runtime's word for how it arrived", () => {
    const main = setup();
    const error = new TypeError("the menu could not be built");
    main.emit("uncaughtExceptionMonitor", error, "uncaughtException");
    expect(main.said).toEqual([
      {
        level: "fatal",
        event: "desktop.lifecycle.uncaught",
        error,
        attrs: { origin: "uncaughtException" },
      },
    ]);
  });

  it("says a runtime warning by its name, its message and its stack, bounded", () => {
    const main = setup();
    const warning = Object.assign(new Error("Possible EventEmitter memory leak detected"), {
      name: "MaxListenersExceededWarning",
    });
    main.emit("warning", warning);
    expect(main.said[0]).toMatchObject({
      level: "warn",
      event: "desktop.lifecycle.runtime_warning",
      attrs: {
        warningName: "MaxListenersExceededWarning",
        warningMessage: "Possible EventEmitter memory leak detected",
      },
    });
    main.emit("warning", { name: "X", message: "m".repeat(5_000), stack: "" });
    expect(String(main.said[1]?.attrs?.["warningMessage"])).toMatch(/… \(3000 more\)$/);
    // anything can be emitted: a bare string is said as itself
    main.emit("warning", "plain");
    expect(main.said[2]?.attrs).toMatchObject({ warningName: "Warning", warningMessage: "plain" });
  });

  it("says a runtime that warns without end a bounded number of times, then once that it went on", () => {
    const main = setup();
    for (let n = 0; n < MAIN_WARNINGS_SAID_MAX + 50; n++) main.emit("warning", new Error(`w${n}`));
    expect(main.said).toHaveLength(MAIN_WARNINGS_SAID_MAX + 1);
    expect(main.said.at(-1)).toMatchObject({
      event: "desktop.lifecycle.runtime_warnings_muted",
      attrs: { said: MAIN_WARNINGS_SAID_MAX },
    });
    // an uncaught error is never muted
    main.emit("uncaughtExceptionMonitor", new Error("still said"), "unhandledRejection");
    expect(main.said.at(-1)?.event).toBe("desktop.lifecycle.uncaught");
  });

  it("is installed once, when main's logger exists", () => {
    const index = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main", "index.ts"),
      "utf8",
    );
    expect(index.match(/hearMainFaults\(logger\);/g)).toHaveLength(1);
    expect(index.indexOf("hearMainFaults(logger);")).toBeGreaterThan(
      index.indexOf('logger.info("desktop.lifecycle.boot_started"'),
    );
  });
});
