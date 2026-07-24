import { randomBytes } from "node:crypto";
import type { CallerContext, LogStream } from "@vibefield/contracts";
import { LOG_STREAMS } from "@vibefield/contracts";
import {
  type DiagnosticLeaseV1 as DiagnosticLease,
  type DiagnosticLeaseCreateV1 as DiagnosticLeaseCreate,
  DiagnosticLeaseCreateV1,
  type DiagnosticLeaseListV1 as DiagnosticLeaseList,
  DiagnosticLeaseListV1,
  type DiagnosticLeaseRevokeV1 as DiagnosticLeaseRevoke,
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
  boundDiagnosticDelta,
  boundDiagnosticSnapshot,
  diagnosticRecordMatches,
  type HistoricalLogPage,
  type Logger,
  type NodeLogging,
  readLogHistory,
} from "@vibefield/logging";
import { type NativeLink, RpcCallError } from "./native-link";
import type { ProductApi } from "./product-api";

const HISTORICAL_STREAMS = new Set<LogStream>([
  LOG_STREAMS.SYSTEM_FIELDD,
  LOG_STREAMS.SYSTEM_FIELD_NATIVE,
  LOG_STREAMS.PLUGINS_SERVICE,
]);
const NATIVE_STREAM = LOG_STREAMS.SYSTEM_FIELD_NATIVE;
const NATIVE_PROJECTION_RECORDS = 1_000;
const NATIVE_PROJECTION_BYTES = 2 * 1024 * 1024;
const DELTA_INTERVAL_MS = 100;
const HEALTH_INTERVAL_MS = 1_000;

interface VectorEntry {
  bootId: string;
  cursor: number;
  reportedDropped: number;
}

type CursorVector = Map<string, VectorEntry>;

interface SnapshotBuild {
  snapshot: DiagnosticLogSnapshot;
  vector: CursorVector;
}

interface ProjectionEntry {
  cursor: number;
  bytes: number;
  record: LogRecord;
}

interface ProjectionRead {
  records: LogRecord[];
  cursor: number;
  reportedDropped: number;
  droppedSincePrevious: number;
  hasMore: boolean;
}

interface Subscriber {
  query: DiagnosticLogQuery;
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void;
  vector: CursorVector;
  dirty: boolean;
  needsSnapshot: boolean;
  initializing: boolean;
  processing: boolean;
  disposed: boolean;
  producerOffset: number;
  activation: NodeJS.Immediate | null;
}

interface LocalProducer {
  id: string;
  stream: LogStream;
  sink: NodeLogging;
}

export interface DiagnosticsServiceOptions {
  native: NativeLink;
  logging: NodeLogging | null;
  pluginLogging: NodeLogging | null;
  logRoot?: string;
  logger: Logger;
  now?: () => number;
}

function cloneVector(vector: CursorVector): CursorVector {
  return new Map(
    [...vector].map(([id, entry]) => [
      id,
      {
        bootId: entry.bootId,
        cursor: entry.cursor,
        reportedDropped: entry.reportedDropped,
      },
    ]),
  );
}

function encodeVector(vector: CursorVector): string {
  const entries = [...vector]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([producerId, entry]) => [producerId, entry.bootId, entry.cursor, entry.reportedDropped]);
  return Buffer.from(JSON.stringify({ v: 1, entries }), "utf8").toString("base64url");
}

function producerId(health: ReturnType<NodeLogging["health"]>): string {
  return `${health.service}:${health.stream}:${health.instanceId}`;
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
  const byIdentity = new Map<string, LogRecord>();
  for (const record of records) {
    byIdentity.set(
      `${record.service}\0${record.role}\0${record.bootId}\0${record.instanceId}\0${record.seq}`,
      record,
    );
  }
  const sorted = [...byIdentity.values()].sort(compareRecords);
  return sorted.length <= limit ? sorted : sorted.slice(-limit);
}

function safeSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total = Math.min(Number.MAX_SAFE_INTEGER, total + value);
  return total;
}

function nativeCursor(raw: string): number | undefined {
  const value = raw.slice(raw.lastIndexOf(":") + 1);
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

class NativeDiagnosticProjection {
  private entries: ProjectionEntry[] = [];
  private bytes = 0;
  private cursor = 0;
  private projectionDropped = 0;
  private reportedDropped = 0;
  private state: DiagnosticProducerState | null = null;

  get available(): boolean {
    return this.state !== null;
  }

  applySnapshot(raw: unknown): boolean {
    const snapshot = DiagnosticLogSnapshotV1.parse(raw);
    const next = snapshot.producers.find((producer) => producer.stream === NATIVE_STREAM) ?? null;
    const previousBoot = this.state?.bootId;
    this.entries = [];
    this.bytes = 0;
    this.cursor = 0;
    this.projectionDropped = 0;
    this.reportedDropped = next?.droppedBefore ?? snapshot.droppedBefore;
    this.state = next === null ? null : structuredClone(next);
    if (next !== null) {
      for (const record of snapshot.records) this.push(record);
    }
    return previousBoot !== undefined && previousBoot !== next?.bootId;
  }

  applyDelta(raw: unknown): void {
    const delta = DiagnosticLogDeltaV1.parse(raw);
    this.reportedDropped = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.reportedDropped + delta.droppedSincePrevious,
    );
    for (const record of delta.records) this.push(record);
    const newest = nativeCursor(delta.cursor);
    if (this.state !== null && newest !== undefined) {
      this.state = { ...this.state, newestCursor: newest };
    }
  }

  capture(query: DiagnosticLogQuery): {
    producer: DiagnosticProducerState | null;
    records: LogRecord[];
    vector: VectorEntry | null;
  } {
    const producer =
      this.state === null
        ? null
        : {
            ...structuredClone(this.state),
            droppedBefore: Math.min(
              Number.MAX_SAFE_INTEGER,
              this.reportedDropped + this.projectionDropped,
            ),
          };
    return {
      producer,
      records: this.entries
        .map((entry) => entry.record)
        .filter((record) => diagnosticRecordMatches(record, query))
        .slice(-query.limit)
        .map((record) => structuredClone(record)),
      vector:
        producer === null
          ? null
          : {
              bootId: producer.bootId,
              cursor: this.cursor,
              reportedDropped: this.reportedDropped,
            },
    };
  }

  readSince(
    afterCursor: number,
    previousReportedDropped: number,
    limit: number,
    predicate: (record: LogRecord) => boolean,
  ): ProjectionRead {
    const oldest = this.entries[0]?.cursor ?? this.cursor + 1;
    const cursorLoss = Math.max(0, oldest - (afterCursor + 1));
    const sourceLoss = Math.max(0, this.reportedDropped - previousReportedDropped);
    let scannedCursor = Math.max(afterCursor, oldest - 1);
    const records: LogRecord[] = [];
    let hasMore = false;
    for (const entry of this.entries) {
      if (entry.cursor <= afterCursor) continue;
      if (records.length >= limit) {
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
      reportedDropped: this.reportedDropped,
      droppedSincePrevious: safeSum([cursorLoss, sourceLoss]),
      hasMore,
    };
  }

  private push(record: LogRecord): void {
    if (record.service !== "field-native" || record.plugin !== undefined) {
      this.reportedDropped = Math.min(Number.MAX_SAFE_INTEGER, this.reportedDropped + 1);
      return;
    }
    const bytes = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    this.cursor += 1;
    if (bytes > NATIVE_PROJECTION_BYTES) {
      this.projectionDropped += 1;
      return;
    }
    this.entries.push({ cursor: this.cursor, bytes, record: structuredClone(record) });
    this.bytes += bytes;
    while (
      this.entries.length > NATIVE_PROJECTION_RECORDS ||
      this.bytes > NATIVE_PROJECTION_BYTES
    ) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.bytes -= removed.bytes;
      this.projectionDropped += 1;
    }
  }
}

export class DiagnosticsService {
  private readonly now: () => number;
  private readonly projection = new NativeDiagnosticProjection();
  private readonly local: LocalProducer[];
  private readonly subscribers = new Set<Subscriber>();
  private readonly localDisposers: Array<() => void> = [];
  private readonly leases = new Map<string, DiagnosticLease>();
  private nativeAttached = false;
  private nativeAttachPromise: Promise<void> | null = null;
  private disposed = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private healthFingerprint = "";
  private readonly healthTimer: NodeJS.Timeout;
  private readonly onNativeConnected = (): void => {
    void this.attachNativeProjection();
  };

  constructor(private readonly options: DiagnosticsServiceOptions) {
    this.now = options.now ?? Date.now;
    this.local = [
      ...(options.logging === null
        ? []
        : [
            {
              id: producerId(options.logging.health()),
              stream: LOG_STREAMS.SYSTEM_FIELDD,
              sink: options.logging,
            },
          ]),
      ...(options.pluginLogging === null
        ? []
        : [
            {
              id: producerId(options.pluginLogging.health()),
              stream: LOG_STREAMS.PLUGINS_SERVICE,
              sink: options.pluginLogging,
            },
          ]),
    ];
    for (const producer of this.local) {
      this.localDisposers.push(producer.sink.subscribeUpdates(() => this.markDirty()));
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
    options.native.on("connected", this.onNativeConnected);
  }

  async start(): Promise<void> {
    await this.attachNativeProjection();
  }

  register(api: ProductApi): void {
    api.register("diagnostics.query", (ctx, params) => {
      this.assertLocalDiagnosticCaller(ctx);
      return this.query(params);
    });
    api.registerSubscription("diagnostics.subscribe", (ctx, params, emit) => {
      this.assertLocalDiagnosticCaller(ctx);
      return this.subscribe(params, emit);
    });
    api.register("diagnostics.lease.create", (ctx, params) => this.createLease(ctx, params));
    api.register("diagnostics.lease.list", (ctx) => {
      this.assertLocalDiagnosticCaller(ctx);
      return this.listLeases();
    });
    api.register("diagnostics.lease.revoke", (ctx, params) => this.revokeLease(ctx, params));
  }

  async query(raw: unknown): Promise<DiagnosticLogSnapshot> {
    const query = this.parseQuery(raw);
    return (await this.buildSnapshot(query, true, true)).snapshot;
  }

  async subscribe(
    raw: unknown,
    emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
  ): Promise<{ snapshot: DiagnosticLogSnapshot; dispose: () => void }> {
    const query = this.parseQuery(raw);
    const subscriber: Subscriber = {
      query,
      emit,
      vector: new Map(),
      dirty: false,
      needsSnapshot: false,
      initializing: true,
      processing: false,
      disposed: false,
      producerOffset: 0,
      activation: null,
    };
    this.subscribers.add(subscriber);
    try {
      const built = await this.buildSnapshot(query, true, false);
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

  async createLease(ctx: CallerContext, raw: unknown): Promise<DiagnosticLease> {
    this.assertLocalDiagnosticCaller(ctx);
    const parsed = DiagnosticLeaseCreateV1.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected a valid diagnostic lease request",
        false,
        { issues: parsed.error.issues.length },
      );
    }
    const input: DiagnosticLeaseCreate = parsed.data;
    const owner = this.leaseOwner(input);
    const createdAt = this.now();
    const expiresAt =
      input.duration === "15m"
        ? createdAt + 15 * 60 * 1_000
        : input.duration === "1h"
          ? createdAt + 60 * 60 * 1_000
          : Number.MAX_SAFE_INTEGER;
    const principal = ctx.principal;
    const lease = DiagnosticLeaseV1.parse({
      v: 1,
      leaseId: `lease-${randomBytes(12).toString("base64url")}`,
      selector: input.selector,
      level: input.level,
      createdAt,
      expiresAt,
      createdBy: {
        kind: "shell-main",
        ...(principal.kind === "local-token" ? { id: principal.tokenId } : {}),
      },
    });
    if (owner === "native") {
      return DiagnosticLeaseV1.parse(
        await this.options.native.request("native.diagnostics.lease.create", { lease }),
      );
    }
    this.leases.set(lease.leaseId, lease);
    this.applyLeases();
    return lease;
  }

  async listLeases(): Promise<DiagnosticLeaseList> {
    this.pruneLeases();
    const native = DiagnosticLeaseListV1.parse(
      await this.options.native.request("native.diagnostics.lease.list", {}),
    );
    return DiagnosticLeaseListV1.parse({
      v: 1,
      observedAt: this.now(),
      leases: [...this.leases.values(), ...native.leases].sort(
        (left, right) => left.expiresAt - right.expiresAt,
      ),
    });
  }

  async revokeLease(ctx: CallerContext, raw: unknown): Promise<{ revoked: boolean }> {
    this.assertLocalDiagnosticCaller(ctx);
    const parsed = DiagnosticLeaseRevokeV1.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError("PRECONDITION_FAILED", "expected { leaseId }", false, {
        issues: parsed.error.issues.length,
      });
    }
    const input: DiagnosticLeaseRevoke = parsed.data;
    const localRevoked = this.leases.delete(input.leaseId);
    if (localRevoked) {
      this.applyLeases();
      return { revoked: true };
    }
    const result = await this.options.native.request("native.diagnostics.lease.revoke", input);
    if (
      typeof result !== "object" ||
      result === null ||
      !("revoked" in result) ||
      typeof result.revoked !== "boolean"
    ) {
      throw new RpcCallError("INTERNAL", "native returned an invalid lease revoke result");
    }
    return { revoked: result.revoked };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.native.off("connected", this.onNativeConnected);
    clearInterval(this.healthTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.flushTimer = null;
    this.leaseTimer = null;
    for (const dispose of this.localDisposers.splice(0)) dispose();
    for (const subscriber of [...this.subscribers]) this.disposeSubscriber(subscriber);
    this.leases.clear();
    this.applyLeases();
  }

  private async attachNativeProjection(): Promise<void> {
    if (this.disposed || this.nativeAttached) return;
    if (this.nativeAttachPromise) return await this.nativeAttachPromise;
    this.nativeAttachPromise = (async () => {
      try {
        const { snapshot } = await this.options.native.subscribe(
          "native.diagnostics.subscribe",
          { sources: [NATIVE_STREAM], limit: 1_000 },
          (payload, kind) => {
            if (this.disposed) return;
            try {
              if (kind === "snapshot") {
                this.projection.applySnapshot(payload);
                this.markDirty(true);
              } else {
                this.projection.applyDelta(payload);
                this.markDirty();
              }
            } catch (error) {
              this.options.logger.warn(
                "fieldd.diagnostics.native_projection_rejected",
                "A malformed native diagnostics projection was rejected",
                { error },
              );
            }
          },
        );
        this.nativeAttached = true;
        this.projection.applySnapshot(snapshot);
      } catch (error) {
        this.options.logger.warn(
          "fieldd.diagnostics.native_projection_unavailable",
          "The native diagnostics projection is unavailable",
          { error },
        );
      } finally {
        this.nativeAttachPromise = null;
      }
    })();
    await this.nativeAttachPromise;
  }

  private captureLocal(query: DiagnosticLogQuery): {
    producers: DiagnosticProducerState[];
    records: LogRecord[];
    vector: CursorVector;
  } {
    const producers: DiagnosticProducerState[] = [];
    const records: LogRecord[] = [];
    const vector: CursorVector = new Map();
    for (const producer of this.local) {
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
        reportedDropped: recent.droppedBefore,
      });
    }
    return { producers, records, vector };
  }

  private async buildSnapshot(
    query: DiagnosticLogQuery,
    includeHistory: boolean,
    directNative: boolean,
  ): Promise<SnapshotBuild> {
    const local = this.captureLocal(query);
    const producers = [...local.producers];
    const records = [...local.records];
    const vector = cloneVector(local.vector);

    const localSources = query.sources.filter((source) => HISTORICAL_STREAMS.has(source));
    const historyPromise: Promise<HistoricalLogPage | null> =
      includeHistory && this.options.logRoot !== undefined && localSources.length > 0
        ? readLogHistory({
            logRoot: this.options.logRoot,
            query: { ...query, sources: localSources },
          })
        : Promise.resolve(null);

    let nativeSnapshot: DiagnosticLogSnapshot | null = null;
    if (query.sources.includes(NATIVE_STREAM)) {
      if (directNative) {
        try {
          nativeSnapshot = DiagnosticLogSnapshotV1.parse(
            await this.options.native.request("native.diagnostics.query", {
              ...query,
              sources: [NATIVE_STREAM],
            }),
          );
        } catch (error) {
          this.options.logger.warn(
            "fieldd.diagnostics.native_query_unavailable",
            "A one-shot native diagnostics query was unavailable",
            { error },
          );
        }
      }
      if (nativeSnapshot !== null) {
        producers.push(...nativeSnapshot.producers);
        records.push(...nativeSnapshot.records);
        for (const producer of nativeSnapshot.producers) {
          vector.set(producer.producerId, {
            bootId: producer.bootId,
            cursor: producer.newestCursor,
            reportedDropped: producer.droppedBefore,
          });
        }
      } else {
        const native = this.projection.capture(query);
        if (native.producer !== null && native.vector !== null) {
          producers.push(native.producer);
          records.push(...native.records);
          vector.set(native.producer.producerId, native.vector);
        }
      }
    }

    const history = await historyPromise;
    if (history !== null) records.push(...history.records);
    const snapshot = boundDiagnosticSnapshot(
      DiagnosticLogSnapshotV1.parse({
        v: 1,
        producers,
        records: dedupeAndLimit(records, query.limit),
        nextCursor: encodeVector(vector),
        droppedBefore: safeSum(producers.map((producer) => producer.droppedBefore)),
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
      }),
    );
    return { snapshot, vector };
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
    if (this.flushTimer !== null || this.disposed) return;
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
      if (subscriber.needsSnapshot || this.vectorBootChanged(subscriber)) {
        subscriber.needsSnapshot = false;
        const built = await this.buildSnapshot(subscriber.query, false, false);
        subscriber.vector = built.vector;
        subscriber.emit(built.snapshot, "snapshot");
        return;
      }

      const records: LogRecord[] = [];
      let droppedSincePrevious = 0;
      let remaining = subscriber.query.limit;
      let hasMore = false;
      const selected = this.selectedLiveProducers(subscriber.query);
      if (selected.length > 0) {
        const offset = subscriber.producerOffset % selected.length;
        const ordered = [...selected.slice(offset), ...selected.slice(0, offset)];
        subscriber.producerOffset = (offset + 1) % selected.length;
        for (const producer of ordered) {
          if (remaining <= 0) {
            hasMore = true;
            break;
          }
          const previous = subscriber.vector.get(producer.id);
          if (previous === undefined) {
            subscriber.needsSnapshot = true;
            hasMore = true;
            break;
          }
          if (producer.kind === "local") {
            const result = producer.sink.readSince(previous.cursor, remaining, (record) =>
              diagnosticRecordMatches(record, subscriber.query),
            );
            records.push(...result.records);
            remaining -= result.records.length;
            droppedSincePrevious = safeSum([droppedSincePrevious, result.droppedSincePrevious]);
            subscriber.vector.set(producer.id, {
              bootId: previous.bootId,
              cursor: result.cursor,
              reportedDropped: producer.sink.recent(0).droppedBefore,
            });
            hasMore ||= result.hasMore;
          } else {
            const result = this.projection.readSince(
              previous.cursor,
              previous.reportedDropped,
              remaining,
              (record) => diagnosticRecordMatches(record, subscriber.query),
            );
            records.push(...result.records);
            remaining -= result.records.length;
            droppedSincePrevious = safeSum([droppedSincePrevious, result.droppedSincePrevious]);
            subscriber.vector.set(producer.id, {
              bootId: previous.bootId,
              cursor: result.cursor,
              reportedDropped: result.reportedDropped,
            });
            hasMore ||= result.hasMore;
          }
        }
      }

      if (subscriber.needsSnapshot) {
        subscriber.dirty = true;
        return;
      }
      if (records.length > 0 || droppedSincePrevious > 0) {
        const delta: DiagnosticLogDelta = boundDiagnosticDelta(
          DiagnosticLogDeltaV1.parse({
            v: 1,
            cursor: encodeVector(subscriber.vector),
            records: dedupeAndLimit(records, subscriber.query.limit),
            droppedSincePrevious,
          }),
        );
        subscriber.emit(delta, "delta");
      }
      if (hasMore) subscriber.dirty = true;
    } catch (error) {
      this.options.logger.warn(
        "fieldd.diagnostics.subscriber_update_failed",
        "A diagnostics subscriber update failed",
        { error },
      );
      subscriber.needsSnapshot = true;
      subscriber.dirty = true;
    } finally {
      subscriber.processing = false;
      if (subscriber.dirty && !subscriber.disposed) this.scheduleFlush();
    }
  }

  private selectedLiveProducers(
    query: DiagnosticLogQuery,
  ): Array<
    | { kind: "local"; id: string; stream: LogStream; sink: NodeLogging }
    | { kind: "native"; id: string; stream: typeof NATIVE_STREAM }
  > {
    const selected: Array<
      | { kind: "local"; id: string; stream: LogStream; sink: NodeLogging }
      | { kind: "native"; id: string; stream: typeof NATIVE_STREAM }
    > = this.local
      .filter((producer) => query.sources.includes(producer.stream))
      .map((producer) => ({ kind: "local", ...producer }));
    if (query.sources.includes(NATIVE_STREAM)) {
      const native = this.projection.capture(query).producer;
      if (native !== null) {
        selected.push({ kind: "native", id: native.producerId, stream: NATIVE_STREAM });
      }
    }
    return selected;
  }

  private vectorBootChanged(subscriber: Subscriber): boolean {
    for (const producer of this.selectedLiveProducers(subscriber.query)) {
      const previous = subscriber.vector.get(producer.id);
      const bootId =
        producer.kind === "local"
          ? producer.sink.health().bootId
          : this.projection.capture(subscriber.query).producer?.bootId;
      if (previous === undefined || bootId === undefined || previous.bootId !== bootId) return true;
    }
    return false;
  }

  private disposeSubscriber(subscriber: Subscriber): void {
    if (subscriber.disposed) return;
    subscriber.disposed = true;
    if (subscriber.activation !== null) clearImmediate(subscriber.activation);
    subscriber.activation = null;
    this.subscribers.delete(subscriber);
  }

  private assertLocalDiagnosticCaller(ctx: CallerContext): void {
    if (ctx.transport !== "ws-loopback" || ctx.principal.kind !== "local-token") {
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "diagnostics are available only to a trusted local shell token",
      );
    }
  }

  private parseQuery(raw: unknown): DiagnosticLogQuery {
    const parsed = DiagnosticLogQueryV1.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected a valid bounded diagnostic query",
        false,
        { issues: parsed.error.issues.length },
      );
    }
    return parsed.data;
  }

  private leaseOwner(input: DiagnosticLeaseCreate): "local" | "native" {
    const selector = input.selector;
    if (selector.kind === "plugin") {
      if (selector.entry === undefined || selector.entry === "service") return "local";
    } else if (selector.service === "fieldd") {
      return "local";
    } else if (selector.kind === "service" && selector.service === "field-native") {
      return "native";
    }
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      "this producer does not own the selected diagnostic target",
      false,
      { selector },
    );
  }

  private applyLeases(): void {
    this.pruneLeases(false);
    const leases = [...this.leases.values()];
    this.options.logging?.replaceDiagnosticLeases(leases);
    this.options.pluginLogging?.replaceDiagnosticLeases(leases);
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
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
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

  private currentHealthFingerprint(): string {
    return JSON.stringify(
      this.local.map((producer) => {
        const health = producer.sink.health();
        return {
          id: producer.id,
          writerState: health.writerState,
          currentLevel: health.currentLevel,
          activeLeaseCount: health.activeLeaseCount,
          dropped: [
            health.counters.droppedTrace,
            health.counters.droppedDebug,
            health.counters.droppedInfo,
            health.counters.droppedWarn,
            health.counters.droppedError,
          ],
          lastFailure: health.lastFailure,
        };
      }),
    );
  }
}
