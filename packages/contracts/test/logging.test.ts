import { DiagnosticLogQueryV1, DiagnosticLogSnapshotV1 } from "@vibefield/contracts/diagnostics";
import { LoggingHealthV1, LogRecordV1 } from "@vibefield/contracts/logging";
import { describe, expect, it } from "vitest";
import * as rootContracts from "../src/index";

const baseRecord = {
  v: 1,
  time: 1,
  level: 30,
  severity: "INFO",
  event: "fieldd.lifecycle.ready",
  msg: "ready",
  service: "fieldd",
  role: "daemon",
  component: "lifecycle",
  pid: 1,
  bootId: "boot_1",
  instanceId: "fieldd_1",
  seq: 1,
} as const;

describe("logging subpath contracts (LOG-41)", () => {
  it("resolve through dedicated package exports", () => {
    expect(LogRecordV1.parse(baseRecord).event).toBe("fieldd.lifecycle.ready");
    expect(LoggingHealthV1).toBeDefined();
    expect(DiagnosticLogSnapshotV1).toBeDefined();
  });

  it("do not leak runtime schemas through the root export", () => {
    expect("LogRecordV1" in rootContracts).toBe(false);
    expect("DiagnosticLogSnapshotV1" in rootContracts).toBe(false);
  });
});

describe("normalized record boundaries", () => {
  it("rejects dynamic or non-namespaced event names", () => {
    expect(LogRecordV1.safeParse({ ...baseRecord, event: "ready" }).success).toBe(false);
    expect(LogRecordV1.safeParse({ ...baseRecord, event: "fieldd.docs.doc-123" }).success).toBe(
      false,
    );
  });

  it("rejects non-JSON attribute values", () => {
    expect(
      LogRecordV1.safeParse({
        ...baseRecord,
        attrs: { callback: () => undefined },
      }).success,
    ).toBe(false);
    expect(LogRecordV1.safeParse({ ...baseRecord, level: 15 }).success).toBe(false);
  });

  it("rejects circular and hostile values without rejecting repeated safe references", () => {
    const shared = { safe: true };
    expect(
      LogRecordV1.safeParse({
        ...baseRecord,
        attrs: { first: shared, second: shared },
      }).success,
    ).toBe(true);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(LogRecordV1.safeParse({ ...baseRecord, attrs: { circular } }).success).toBe(false);

    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("hostile");
        },
      },
    );
    expect(() => LogRecordV1.safeParse({ ...baseRecord, attrs: { hostile } })).not.toThrow();
    expect(LogRecordV1.safeParse({ ...baseRecord, attrs: { hostile } }).success).toBe(false);

    let getterCalls = 0;
    const getterValue = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must not run";
      },
    });
    expect(LogRecordV1.safeParse({ ...baseRecord, attrs: { getterValue } }).success).toBe(false);
    expect(getterCalls).toBe(0);

    const symbolValue = { safe: true, [Symbol("hidden")]: "not JSON" };
    expect(LogRecordV1.safeParse({ ...baseRecord, attrs: { symbolValue } }).success).toBe(false);
  });

  it("bounds diagnostics queries before a historical scan begins", () => {
    expect(
      DiagnosticLogQueryV1.safeParse({
        sources: ["system/fieldd"],
        limit: 1001,
      }).success,
    ).toBe(false);
  });
});
