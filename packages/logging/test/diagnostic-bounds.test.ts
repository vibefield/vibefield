import type { LogRecordV1 } from "@vibefield/contracts/logging";
import { describe, expect, it } from "vitest";
import { boundDiagnosticDelta, boundDiagnosticSnapshot } from "../src/diagnostic-bounds";

function record(seq: number): LogRecordV1 {
  return {
    v: 1,
    time: 1_000 + seq,
    level: 30,
    severity: "INFO",
    event: "fieldd.diagnostics.large_record",
    msg: `${seq}:${"x".repeat(8_000)}`,
    service: "fieldd",
    role: "daemon",
    component: "diagnostics.test",
    pid: 1,
    bootId: "boot-1",
    instanceId: "instance-1",
    seq,
  };
}

describe("diagnostic transport page bounds", () => {
  it("keeps the newest snapshot records and charges removed records as drops", () => {
    const bounded = boundDiagnosticSnapshot(
      {
        v: 1,
        producers: [],
        records: Array.from({ length: 10 }, (_, index) => record(index)),
        nextCursor: "cursor-1",
        droppedBefore: 3,
      },
      25_000,
    );
    expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThanOrEqual(25_000);
    expect(bounded.records.length).toBeGreaterThan(0);
    expect(bounded.records.at(-1)?.seq).toBe(9);
    expect(bounded.droppedBefore).toBe(3 + (10 - bounded.records.length));
    expect(bounded["transportTruncatedRecords"]).toBe(10 - bounded.records.length);
  });

  it("charges removed delta records to droppedSincePrevious", () => {
    const bounded = boundDiagnosticDelta(
      {
        v: 1,
        cursor: "cursor-2",
        records: Array.from({ length: 10 }, (_, index) => record(index)),
        droppedSincePrevious: 2,
      },
      25_000,
    );
    expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThanOrEqual(25_000);
    expect(bounded.records.at(-1)?.seq).toBe(9);
    expect(bounded.droppedSincePrevious).toBe(2 + (10 - bounded.records.length));
    expect(bounded["transportTruncatedRecords"]).toBe(10 - bounded.records.length);
  });
});
