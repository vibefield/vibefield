import type { LogRecordV1 } from "@vibefield/contracts/logging";
import type { RecentLogDelta, RecentLogSnapshot } from "./types";

interface RingEntry {
  cursor: number;
  bytes: number;
  record: LogRecordV1;
}

export class BoundedLogRing {
  private entries: RingEntry[] = [];
  private bytes = 0;
  private cursor = 0;
  private droppedBefore = 0;
  private highWaterRecords = 0;
  private highWaterBytes = 0;

  constructor(
    readonly capacityRecords: number,
    readonly capacityBytes: number,
  ) {}

  push(record: LogRecordV1, bytes: number): void {
    this.cursor += 1;
    if (bytes > this.capacityBytes || this.capacityRecords === 0) {
      this.droppedBefore += 1;
      return;
    }
    while (this.entries.length >= this.capacityRecords || this.bytes + bytes > this.capacityBytes) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.bytes -= removed.bytes;
      this.droppedBefore += 1;
    }
    this.entries.push({ cursor: this.cursor, bytes, record });
    this.bytes += bytes;
    this.highWaterRecords = Math.max(this.highWaterRecords, this.entries.length);
    this.highWaterBytes = Math.max(this.highWaterBytes, this.bytes);
  }

  snapshot(limit = this.capacityRecords): RecentLogSnapshot {
    const bounded = Math.max(0, Math.min(limit, this.capacityRecords));
    const selected = bounded === 0 ? [] : this.entries.slice(-bounded);
    return {
      records: selected.map((entry) => structuredClone(entry.record)),
      oldestCursor: selected[0]?.cursor ?? this.cursor,
      newestCursor: selected.at(-1)?.cursor ?? this.cursor,
      droppedBefore: this.droppedBefore,
    };
  }

  readSince(
    afterCursor: number,
    limit = this.capacityRecords,
    predicate: (record: LogRecordV1) => boolean = () => true,
  ): RecentLogDelta {
    const bounded = Math.max(0, Math.min(limit, this.capacityRecords));
    const oldest = this.entries[0]?.cursor ?? this.cursor + 1;
    const droppedSincePrevious = Math.max(0, oldest - (afterCursor + 1));
    let scannedCursor = Math.max(afterCursor, oldest - 1);
    const records: LogRecordV1[] = [];
    let hasMore = false;

    for (const entry of this.entries) {
      if (entry.cursor <= afterCursor) continue;
      if (records.length >= bounded) {
        hasMore = true;
        break;
      }
      scannedCursor = entry.cursor;
      if (predicate(entry.record)) records.push(structuredClone(entry.record));
    }

    if (!hasMore) scannedCursor = this.cursor;
    return {
      records,
      cursor: scannedCursor,
      droppedSincePrevious,
      hasMore,
    };
  }

  health(): {
    records: number;
    bytes: number;
    highWaterRecords: number;
    highWaterBytes: number;
    capacityRecords: number;
    capacityBytes: number;
  } {
    return {
      records: this.entries.length,
      bytes: this.bytes,
      highWaterRecords: this.highWaterRecords,
      highWaterBytes: this.highWaterBytes,
      capacityRecords: this.capacityRecords,
      capacityBytes: this.capacityBytes,
    };
  }
}
