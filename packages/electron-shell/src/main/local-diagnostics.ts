import { randomBytes } from "node:crypto";
import type { LogStream } from "@vibefield/contracts";
import { LOG_STREAMS } from "@vibefield/contracts";
import {
  type DiagnosticLeaseV1 as DiagnosticLease,
  type DiagnosticLeaseCreateV1 as DiagnosticLeaseCreate,
  DiagnosticLeaseCreateV1,
  type DiagnosticLeaseListV1 as DiagnosticLeaseList,
  DiagnosticLeaseListV1,
  DiagnosticLeaseRevokeV1,
  DiagnosticLeaseV1,
  type DiagnosticLogDeltaV1 as DiagnosticLogDelta,
  DiagnosticLogDeltaV1,
  type DiagnosticLogQueryV1 as DiagnosticLogQuery,
  DiagnosticLogQueryV1,
  type DiagnosticLogSnapshotV1 as DiagnosticLogSnapshot,
  DiagnosticLogSnapshotV1,
  type DiagnosticProducerStateV1 as DiagnosticProducerState,
} from "@vibefield/contracts/diagnostics";
import type { LogRecordV1 as LogRecord } from "@vibefield/contracts/logging";
import {
  diagnosticRecordMatches,
  type HistoricalLogPage,
  readLogHistory,
} from "@vibefield/logging";
import type { ElectronLogging } from "./logging";

const DELTA_INTERVAL_MS = 100;
const HEALTH_INTERVAL_MS = 1_000;

interface LocalProducer {
  id: string;
  stream: LogStream;
  sink: ElectronLogging["desktop"];
}

interface VectorEntry {
  bootId: string;
  cursor: number;
  droppedBefore: number;
}

type CursorVector = Map<string, VectorEntry>;

interface SnapshotBuild {
  snapshot: DiagnosticLogSnapshot;
  vector: CursorVector;
}

interface Subscriber {
  query: DiagnosticLogQuery;
  vector: CursorVector;
  emit: (payload: DiagnosticLogDelta | DiagnosticLogSnapshot, kind: "delta" | "snapshot") => void;
  dirty: boolean;
  needsSnapshot: boolean;
  processing: boolean;
  initializing: boolean;
  disposed: boolean;
  offset: number;
  activation: NodeJS.Immediate | null;
}

export interface LocalDiagnosticsSubscription {
  snapshot: DiagnosticLogSnapshot;
  dispose(): void;
}

export class LocalDiagnosticsError extends Error {
  constructor(
    readonly kind: "PRECONDITION_FAILED" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "LocalDiagnosticsError";
  }
}

function idFor(producer: ElectronLogging["desktop"]): string {
  const health = producer.health();
  return `${health.service}:${health.stream}:${health.instanceId}`;
}

function encodeVector(vector: CursorVector): string {
  const entries = [...vector]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, entry]) => [id, entry.bootId, entry.cursor, entry.droppedBefore]);
  return Buffer.from(JSON.stringify({ v: 1, entries }), "utf8").toString("base64url");
}

function compareRecords(left: LogRecord, right: LogRecord): number {
  return (
    left.time - right.time ||
    (left.observedTime ?? left.time) - (right.observedTime ?? right.time) ||
    left.bootId.localeCompare(right.bootId) ||
    left.seq - right.seq
  );
}

function dedupeAndLimit(records: readonly LogRecord[], limit: number): LogRecord[] {
  const unique = new Map<string, LogRecord>();
  for (const record of records) {
    unique.set(
      `${record.service}\0${record.role}\0${record.bootId}\0${record.instanceId}\0${record.seq}`,
      record,
    );
  }
  const sorted = [...unique.values()].sort(compareRecords);
  return sorted.length <= limit ? sorted : sorted.slice(-limit);
}

function safeSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total = Math.min(Number.MAX_SAFE_INTEGER, total + value);
  return total;
}

export class ElectronLocalDiagnostics {
  private readonly now: () => number;
  private readonly producers: LocalProducer[];
  private readonly leases = new Map<string, DiagnosticLease>();
  private readonly subscribers = new Set<Subscriber>();
  private readonly producerDisposers: Array<() => void> = [];
  private readonly healthTimer: NodeJS.Timeout;
  private healthFingerprint: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(
    private readonly logging: ElectronLogging,
    now: () => number = Date.now,
  ) {
    this.now = now;
    this.producers = [
      {
        id: idFor(logging.desktop),
        stream: LOG_STREAMS.SYSTEM_DESKTOP,
        sink: logging.desktop,
      },
      {
        id: idFor(logging.renderer),
        stream: LOG_STREAMS.SYSTEM_RENDERER,
        sink: logging.renderer,
      },
      {
        id: idFor(logging.utility),
        stream: LOG_STREAMS.SYSTEM_UTILITY,
        sink: logging.utility,
      },
      {
        id: idFor(logging.pluginRenderer),
        stream: LOG_STREAMS.PLUGINS_RENDERER,
        sink: logging.pluginRenderer,
      },
    ];
    for (const producer of this.producers) {
      this.producerDisposers.push(producer.sink.subscribeUpdates(() => this.markDirty()));
    }
    this.healthFingerprint = this.currentHealthFingerprint();
    this.healthTimer = setInterval(() => {
      if (this.disposed || this.subscribers.size === 0) return;
      const next = this.currentHealthFingerprint();
      if (next !== this.healthFingerprint) {
        this.healthFingerprint = next;
        this.markDirty(true);
      }
    }, HEALTH_INTERVAL_MS);
    this.healthTimer.unref();
  }

  async query(raw: unknown): Promise<DiagnosticLogSnapshot> {
    const query = this.parseQuery(raw);
    return (await this.buildSnapshot(query, true)).snapshot;
  }

  async subscribe(raw: unknown, emit: Subscriber["emit"]): Promise<LocalDiagnosticsSubscription> {
    const query = this.parseQuery(raw);
    const subscriber: Subscriber = {
      query,
      vector: new Map(),
      emit,
      dirty: false,
      needsSnapshot: false,
      processing: false,
      initializing: true,
      disposed: false,
      offset: 0,
      activation: null,
    };
    this.subscribers.add(subscriber);
    try {
      const built = await this.buildSnapshot(query, true);
      subscriber.vector = built.vector;
      subscriber.activation = setImmediate(() => {
        subscriber.activation = null;
        if (subscriber.disposed) return;
        subscriber.initializing = false;
        if (subscriber.dirty) this.scheduleFlush();
      });
      return {
        snapshot: built.snapshot,
        dispose: () => this.disposeSubscriber(subscriber),
      };
    } catch (error) {
      this.disposeSubscriber(subscriber);
      throw error;
    }
  }

  createLease(raw: unknown): DiagnosticLease {
    const parsed = DiagnosticLeaseCreateV1.safeParse(raw);
    if (!parsed.success) {
      throw new LocalDiagnosticsError(
        "PRECONDITION_FAILED",
        "expected a valid diagnostic lease request",
      );
    }
    const input: DiagnosticLeaseCreate = parsed.data;
    if (!this.ownsLeaseTarget(input)) {
      throw new LocalDiagnosticsError(
        "PRECONDITION_FAILED",
        "Electron does not own the selected diagnostic target",
      );
    }
    const createdAt = this.now();
    const expiresAt =
      input.duration === "15m"
        ? createdAt + 15 * 60 * 1_000
        : input.duration === "1h"
          ? createdAt + 60 * 60 * 1_000
          : Number.MAX_SAFE_INTEGER;
    const lease = DiagnosticLeaseV1.parse({
      v: 1,
      leaseId: `lease-${randomBytes(12).toString("base64url")}`,
      selector: input.selector,
      level: input.level,
      createdAt,
      expiresAt,
      createdBy: { kind: "shell-main", id: "electron-main" },
    });
    this.leases.set(lease.leaseId, lease);
    this.applyLeases();
    return lease;
  }

  listLeases(): DiagnosticLeaseList {
    this.pruneLeases();
    return DiagnosticLeaseListV1.parse({
      v: 1,
      observedAt: this.now(),
      leases: [...this.leases.values()].sort((left, right) => left.expiresAt - right.expiresAt),
    });
  }

  revokeLease(raw: unknown): { revoked: boolean } {
    const parsed = DiagnosticLeaseRevokeV1.safeParse(raw);
    if (!parsed.success) {
      throw new LocalDiagnosticsError("PRECONDITION_FAILED", "expected { leaseId }");
    }
    const revoked = this.leases.delete(parsed.data.leaseId);
    if (revoked) this.applyLeases();
    return { revoked };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.healthTimer);
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    if (this.leaseTimer !== null) clearTimeout(this.leaseTimer);
    for (const dispose of this.producerDisposers.splice(0)) dispose();
    for (const subscriber of [...this.subscribers]) this.disposeSubscriber(subscriber);
    this.leases.clear();
    for (const producer of this.producers) producer.sink.replaceDiagnosticLeases([]);
  }

  private capture(query: DiagnosticLogQuery): {
    producers: DiagnosticProducerState[];
    records: LogRecord[];
    vector: CursorVector;
  } {
    const producers: DiagnosticProducerState[] = [];
    const records: LogRecord[] = [];
    const vector: CursorVector = new Map();
    for (const producer of this.producers) {
      if (!query.sources.includes(producer.stream)) continue;
      const health = producer.sink.health();
      const recent = producer.sink.recent();
      producers.push({
        producerId: producer.id,
        service: health.service,
        stream: health.stream,
        bootId: health.bootId,
        instanceId: health.instanceId,
        oldestCursor: recent.oldestCursor,
        newestCursor: recent.newestCursor,
        droppedBefore: recent.droppedBefore,
        health,
      });
      records.push(
        ...recent.records
          .filter((record) => diagnosticRecordMatches(record, query))
          .slice(-query.limit),
      );
      vector.set(producer.id, {
        bootId: health.bootId,
        cursor: recent.newestCursor,
        droppedBefore: recent.droppedBefore,
      });
    }
    return { producers, records, vector };
  }

  private async buildSnapshot(
    query: DiagnosticLogQuery,
    includeHistory: boolean,
  ): Promise<SnapshotBuild> {
    const live = this.capture(query);
    const localSources = query.sources.filter((source) =>
      this.producers.some((producer) => producer.stream === source),
    );
    const history: HistoricalLogPage | null =
      includeHistory && localSources.length > 0
        ? await readLogHistory({
            logRoot: this.logging.logRoot,
            query: { ...query, sources: localSources },
          })
        : null;
    const records = [...live.records, ...(history?.records ?? [])];
    const snapshot = DiagnosticLogSnapshotV1.parse({
      v: 1,
      producers: live.producers,
      records: dedupeAndLimit(records, query.limit),
      nextCursor: encodeVector(live.vector),
      droppedBefore: safeSum(live.producers.map((producer) => producer.droppedBefore)),
      ...(history !== null
        ? {
            history: {
              scannedBytes: history.scannedBytes,
              scannedSegments: history.scannedSegments,
              parseFailures: history.failures.length,
              skippedUnsafeSegments: history.skippedUnsafeSegments,
              truncated: history.truncated,
            },
          }
        : {}),
    });
    return { snapshot, vector: live.vector };
  }

  private markDirty(needsSnapshot = false): void {
    if (this.disposed) return;
    for (const subscriber of this.subscribers) {
      subscriber.dirty = true;
      if (needsSnapshot) subscriber.needsSnapshot = true;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.disposed || this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const subscriber of this.subscribers) void this.flushSubscriber(subscriber);
    }, DELTA_INTERVAL_MS);
    this.flushTimer.unref();
  }

  private async flushSubscriber(subscriber: Subscriber): Promise<void> {
    if (
      subscriber.disposed ||
      subscriber.initializing ||
      subscriber.processing ||
      !subscriber.dirty
    ) {
      return;
    }
    subscriber.processing = true;
    subscriber.dirty = false;
    try {
      if (subscriber.needsSnapshot) {
        subscriber.needsSnapshot = false;
        const built = await this.buildSnapshot(subscriber.query, false);
        subscriber.vector = built.vector;
        subscriber.emit(built.snapshot, "snapshot");
        return;
      }

      const selected = this.producers.filter((producer) =>
        subscriber.query.sources.includes(producer.stream),
      );
      const records: LogRecord[] = [];
      let droppedSincePrevious = 0;
      let remaining = subscriber.query.limit;
      let hasMore = false;
      if (selected.length > 0) {
        const offset = subscriber.offset % selected.length;
        const ordered = [...selected.slice(offset), ...selected.slice(0, offset)];
        subscriber.offset = (offset + 1) % selected.length;
        for (const producer of ordered) {
          if (remaining <= 0) {
            hasMore = true;
            break;
          }
          const previous = subscriber.vector.get(producer.id);
          const health = producer.sink.health();
          if (previous === undefined || previous.bootId !== health.bootId) {
            subscriber.needsSnapshot = true;
            hasMore = true;
            break;
          }
          const delta = producer.sink.readSince(previous.cursor, remaining, (record) =>
            diagnosticRecordMatches(record, subscriber.query),
          );
          records.push(...delta.records);
          remaining -= delta.records.length;
          droppedSincePrevious = safeSum([droppedSincePrevious, delta.droppedSincePrevious]);
          subscriber.vector.set(producer.id, {
            bootId: health.bootId,
            cursor: delta.cursor,
            droppedBefore: producer.sink.recent(0).droppedBefore,
          });
          hasMore ||= delta.hasMore;
        }
      }
      if (subscriber.needsSnapshot) {
        subscriber.dirty = true;
        return;
      }
      if (records.length > 0 || droppedSincePrevious > 0) {
        subscriber.emit(
          DiagnosticLogDeltaV1.parse({
            v: 1,
            cursor: encodeVector(subscriber.vector),
            records: dedupeAndLimit(records, subscriber.query.limit),
            droppedSincePrevious,
          }),
          "delta",
        );
      }
      if (hasMore) subscriber.dirty = true;
    } finally {
      subscriber.processing = false;
      if (subscriber.dirty && !subscriber.disposed) this.scheduleFlush();
    }
  }

  private parseQuery(raw: unknown): DiagnosticLogQuery {
    const parsed = DiagnosticLogQueryV1.safeParse(raw);
    if (!parsed.success) {
      throw new LocalDiagnosticsError(
        "PRECONDITION_FAILED",
        "expected a valid bounded diagnostic query",
      );
    }
    return parsed.data;
  }

  private ownsLeaseTarget(input: DiagnosticLeaseCreate): boolean {
    const selector = input.selector;
    if (selector.kind === "plugin") {
      return selector.entry === undefined || selector.entry === "renderer";
    }
    return (
      selector.service === "desktop" ||
      selector.service === "renderer" ||
      selector.service === "utility"
    );
  }

  private applyLeases(): void {
    this.pruneLeases(false);
    const leases = [...this.leases.values()];
    for (const producer of this.producers) producer.sink.replaceDiagnosticLeases(leases);
    this.scheduleLeaseExpiry();
    this.healthFingerprint = this.currentHealthFingerprint();
    this.markDirty(true);
  }

  private pruneLeases(reapply = true): void {
    const now = this.now();
    let changed = false;
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.leases.delete(id);
        changed = true;
      }
    }
    if (changed && reapply) this.applyLeases();
  }

  private scheduleLeaseExpiry(): void {
    if (this.leaseTimer !== null) clearTimeout(this.leaseTimer);
    this.leaseTimer = null;
    const now = this.now();
    const nearest = [...this.leases.values()].reduce(
      (minimum, lease) => Math.min(minimum, lease.expiresAt),
      Number.MAX_SAFE_INTEGER,
    );
    if (nearest === Number.MAX_SAFE_INTEGER) return;
    const delay = Math.min(Math.max(1, nearest - now), 2_147_483_647);
    this.leaseTimer = setTimeout(() => {
      this.leaseTimer = null;
      this.pruneLeases();
    }, delay);
    this.leaseTimer.unref();
  }

  private disposeSubscriber(subscriber: Subscriber): void {
    if (subscriber.disposed) return;
    subscriber.disposed = true;
    if (subscriber.activation !== null) clearImmediate(subscriber.activation);
    subscriber.activation = null;
    this.subscribers.delete(subscriber);
  }

  private currentHealthFingerprint(): string {
    return JSON.stringify(
      this.producers.map((producer) => {
        const health = producer.sink.health();
        return {
          id: producer.id,
          state: health.writerState,
          level: health.currentLevel,
          leases: health.activeLeaseCount,
          drops: [
            health.counters.droppedTrace,
            health.counters.droppedDebug,
            health.counters.droppedInfo,
            health.counters.droppedWarn,
            health.counters.droppedError,
          ],
          failure: health.lastFailure,
        };
      }),
    );
  }
}
