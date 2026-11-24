import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RendererLogger } from "../src/logging";
import { hearPageFaults, PAGE_FAULTS_SAID_MAX, type PageFaultTarget } from "../src/page-faults";

// VT-4a (track VT, 2026-11-24) — nothing dies silently, the product page's half: a script error nobody caught and
// a promise nobody handled reach the log, bounded, and the page's own handling is left as it was.

interface Said {
  level: string;
  event: string;
  error?: unknown;
  attrs?: Record<string, unknown>;
}

function setup() {
  const said: Said[] = [];
  const logger: RendererLogger = {
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn: (event, _message, attrs) =>
      void said.push({
        level: "warn",
        event,
        ...(attrs === undefined ? {} : { attrs: { ...attrs } }),
      }),
    error: (event, _message, error, attrs) =>
      void said.push({
        level: "error",
        event,
        error,
        ...(attrs === undefined ? {} : { attrs: { ...attrs } }),
      }),
    fatal() {},
    isLevelEnabled: () => true,
  };
  const listeners = new Map<string, (event: Event) => void>();
  const target: PageFaultTarget = {
    addEventListener: (type, listener) => void listeners.set(type, listener),
  };
  hearPageFaults(logger, target);
  let prevented = 0;
  const event = (fields: Record<string, unknown>): Event =>
    ({
      ...fields,
      preventDefault: () => {
        prevented += 1;
      },
    }) as unknown as Event;
  return {
    said,
    types: () => [...listeners.keys()].sort(),
    error: (fields: Record<string, unknown>) => listeners.get("error")?.(event(fields)),
    rejection: (fields: Record<string, unknown>) =>
      listeners.get("unhandledrejection")?.(event(fields)),
    prevented: () => prevented,
  };
}

describe("VT-4a — the product page's fault listeners", () => {
  it("says a script error nobody caught, with where it was thrown and never a whole address", () => {
    const page = setup();
    const error = new TypeError("card is undefined");
    page.error({
      error,
      message: "Uncaught TypeError: card is undefined",
      filename: "vibefield-app://shell/assets/workspace-B7x2.js?v=3#frag",
      lineno: 412,
      colno: 19,
    });
    expect(page.said).toEqual([
      {
        level: "error",
        event: "renderer.page.uncaught",
        error,
        attrs: { script: "workspace-B7x2.js", line: 412, column: 19 },
      },
    ]);
  });

  it("says an error event that carries no error object by its message, and one with nothing in words", () => {
    const page = setup();
    page.error({ message: "Script error." });
    page.error({});
    expect(page.said.map((entry) => entry.error)).toEqual([
      "Script error.",
      "an error event with nothing in it",
    ]);
    expect(page.said[0]?.attrs).toEqual({});
  });

  it("says a promise nobody handled by its reason", () => {
    const page = setup();
    const reason = new Error("the door closed");
    page.rejection({ reason });
    page.rejection({});
    expect(page.said).toMatchObject([
      { event: "renderer.page.unhandled_rejection", error: reason },
      { event: "renderer.page.unhandled_rejection", error: "a rejection with no reason" },
    ]);
  });

  it("only listens: the page's own handling of the fault is never prevented", () => {
    const page = setup();
    page.error({ error: new Error("x") });
    page.rejection({ reason: new Error("y") });
    expect(page.prevented()).toBe(0);
    expect(page.types()).toEqual(["error", "unhandledrejection"]);
  });

  it("says a page that fails without end a bounded number of times, then once that it went on", () => {
    const page = setup();
    for (let n = 0; n < PAGE_FAULTS_SAID_MAX + 40; n++) page.error({ error: new Error(`f${n}`) });
    page.rejection({ reason: new Error("later") });
    expect(page.said).toHaveLength(PAGE_FAULTS_SAID_MAX + 1);
    expect(page.said.at(-1)).toEqual({
      level: "warn",
      event: "renderer.page.faults_muted",
      attrs: { said: PAGE_FAULTS_SAID_MAX },
    });
  });

  it("is installed once, with the host's logger, before the product composes", () => {
    const mount = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "mount.tsx"),
      "utf8",
    );
    expect(mount.match(/hearPageFaults\(opts\.host\.logger\);/g)).toHaveLength(1);
    expect(mount.indexOf("hearPageFaults(opts.host.logger);")).toBeLessThan(
      mount.indexOf("createBootMachine("),
    );
  });
});
