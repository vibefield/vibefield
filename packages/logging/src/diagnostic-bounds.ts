import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import {
  DiagnosticLogDeltaV1 as DiagnosticLogDeltaSchema,
  type DiagnosticLogDeltaV1,
  DiagnosticLogSnapshotV1 as DiagnosticLogSnapshotSchema,
  type DiagnosticLogSnapshotV1,
} from "@vibefield/contracts/diagnostics";

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function minimumRemoved(
  records: readonly unknown[],
  build: (remaining: readonly unknown[], removed: number) => unknown,
  maxBytes: number,
): number {
  let low = 0;
  let high = records.length;
  let best = records.length;
  while (low <= high) {
    const removed = Math.floor((low + high) / 2);
    if (bytes(build(records.slice(removed), removed)) <= maxBytes) {
      best = removed;
      high = removed - 1;
    } else {
      low = removed + 1;
    }
  }
  return best;
}

export function boundDiagnosticSnapshot(
  snapshot: DiagnosticLogSnapshotV1,
  maxBytes = LOG_TRANSPORT_LIMITS.DIAGNOSTIC_PAGE_BYTES,
): DiagnosticLogSnapshotV1 {
  if (bytes(snapshot) <= maxBytes) return snapshot;
  const build = (records: readonly unknown[], removed: number): Record<string, unknown> => ({
    ...snapshot,
    records,
    droppedBefore: Math.min(Number.MAX_SAFE_INTEGER, snapshot.droppedBefore + removed),
    transportTruncatedRecords: removed,
  });
  const removed = minimumRemoved(snapshot.records, build, maxBytes);
  return DiagnosticLogSnapshotSchema.parse(build(snapshot.records.slice(removed), removed));
}

export function boundDiagnosticDelta(
  delta: DiagnosticLogDeltaV1,
  maxBytes = LOG_TRANSPORT_LIMITS.DIAGNOSTIC_PAGE_BYTES,
): DiagnosticLogDeltaV1 {
  if (bytes(delta) <= maxBytes) return delta;
  const build = (records: readonly unknown[], removed: number): Record<string, unknown> => ({
    ...delta,
    records,
    droppedSincePrevious: Math.min(Number.MAX_SAFE_INTEGER, delta.droppedSincePrevious + removed),
    transportTruncatedRecords: removed,
  });
  const removed = minimumRemoved(delta.records, build, maxBytes);
  return DiagnosticLogDeltaSchema.parse(build(delta.records.slice(removed), removed));
}
