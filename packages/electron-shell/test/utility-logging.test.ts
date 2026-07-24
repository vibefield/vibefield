import { EventEmitter } from "node:events";
import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import type { Logger, NodeLogging, TrustedLogIngress } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import { captureUtilityProcessLogging, type UtilityProcessLike } from "../src/main/utility-logging";

function logger(events: string[]): Logger {
  const value: Logger = {
    child: () => value,
    trace: (event) => events.push(event),
    debug: (event) => events.push(event),
    info: (event) => events.push(event),
    warn: (event) => events.push(event),
    error: (event) => events.push(event),
    fatal: (event) => events.push(event),
    isLevelEnabled: () => true,
  };
  return value;
}

function sink(records: TrustedLogIngress[]): NodeLogging {
  return {
    logger: logger([]),
    filePath: "/not-used",
    ingest: (record) => records.push(record),
    health: () => {
      throw new Error("not used");
    },
    recent: () => {
      throw new Error("not used");
    },
    readSince: () => {
      throw new Error("not used");
    },
    subscribeUpdates: () => () => undefined,
    replaceDiagnosticLeases: () => undefined,
    setLevel: () => undefined,
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

class FakeUtility extends EventEmitter implements UtilityProcessLike {
  readonly pid = 42;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
}

describe("bounded UtilityProcess logging", () => {
  it("accepts structured lines and line-frames raw stdout/stderr separately", () => {
    const child = new FakeUtility();
    const records: TrustedLogIngress[] = [];
    const desktop: string[] = [];
    captureUtilityProcessLogging({
      process: child,
      sink: sink(records),
      desktopLogger: logger(desktop),
      component: "thumbnail.worker",
      windowId: "7",
    });
    child.stdout.emit(
      "data",
      `${JSON.stringify({
        v: 1,
        time: 10,
        level: "warn",
        event: "utility.thumbnail.render_failed",
        msg: "render failed",
        component: "thumbnail.worker",
        attrs: { item: 1 },
      })}\nraw split`,
    );
    child.stdout.emit("data", " line\r\n");
    child.stderr.emit("data", "bad bytes\n");

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      time: 10,
      level: "warn",
      event: "utility.thumbnail.render_failed",
      pid: 42,
      windowId: "7",
      attrs: { item: 1, stream: "stdout", utilityPid: 42 },
    });
    expect(records[1]).toMatchObject({
      level: "info",
      event: "utility.process.unstructured_output",
      attrs: { stream: "stdout", raw: true, rawLine: "raw split line" },
    });
    expect(records[2]).toMatchObject({
      level: "error",
      attrs: { stream: "stderr", rawLine: "bad bytes" },
    });
    expect(desktop).toEqual(["desktop.utility.capture_started"]);
  });

  it("bounds no-newline output, replaces invalid UTF-8, and resumes after newline", () => {
    const child = new FakeUtility();
    const records: TrustedLogIngress[] = [];
    captureUtilityProcessLogging({
      process: child,
      sink: sink(records),
      desktopLogger: logger([]),
      component: "first_party.worker",
    });
    child.stderr.emit(
      "data",
      Buffer.concat([
        Buffer.from([0xff]),
        Buffer.alloc(LOG_TRANSPORT_LIMITS.FIRST_PARTY_PARTIAL_LINE_BYTES, 0x61),
      ]),
    );
    child.stderr.emit("data", "discarded\nnext\n");

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      event: "utility.process.output_truncated",
      truncation: { reasons: ["partial-line"] },
      attrs: { stream: "stderr", raw: true },
    });
    const rawLine = records[0]?.attrs?.["rawLine"];
    expect(rawLine).toEqual(expect.any(String));
    expect((rawLine as string).startsWith("�")).toBe(true);
    expect(records[1]?.attrs?.["rawLine"]).toBe("next");
  });

  it("flushes the bounded final tail and detaches every listener once", () => {
    const child = new FakeUtility();
    const records: TrustedLogIngress[] = [];
    const desktop: string[] = [];
    const dispose = captureUtilityProcessLogging({
      process: child,
      sink: sink(records),
      desktopLogger: logger(desktop),
      component: "first_party.worker",
    });
    child.stdout.emit("data", "final tail");
    child.emit("exit", 3);
    dispose();

    expect(records.at(-1)?.attrs?.["rawLine"]).toBe("final tail");
    expect(desktop).toEqual(["desktop.utility.capture_started", "desktop.utility.process_gone"]);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stdout.listenerCount("end")).toBe(0);
  });
});
