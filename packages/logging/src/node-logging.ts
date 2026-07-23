import { isAbsolute } from "node:path";
import {
  type LoggingHealthV1 as LoggingHealth,
  LoggingHealthV1,
  type LogLevelNameV1,
  type LogRecordV1 as LogRecord,
  LogRecordV1,
  LogStreamV1,
} from "@vibefield/contracts/logging";
import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";
import { FIRST_PARTY_BUFFERS, FIRST_PARTY_RETENTION } from "./limits";
import { BoundedLogRing } from "./ring";
import { normalizeLogRecord, serializeError } from "./sanitize";
import type { WriterOperation } from "./segment-writer";
import {
  SegmentAppendError,
  SegmentWriter,
  WriterConflictError,
  WriterOperationError,
} from "./segment-writer";
import type {
  CreateNodeLoggingOptions,
  LogBufferLimits,
  LogFields,
  Logger,
  LoggerBindings,
  LogRetentionPolicy,
  NodeLogging,
  TrustedLogIngress,
} from "./types";

interface QueuedLine {
  line: Buffer;
  level: LogRecord["level"];
}

type FailureKind = NonNullable<LoggingHealth["lastFailure"]>["kind"];

function classifyFailure(error: unknown, operation: WriterOperation): FailureKind {
  if (error instanceof WriterConflictError) return "writer-conflict";
  if (error instanceof WriterOperationError) {
    return classifyFailure(error.cause, error.operation);
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "ENOSPC") return "enospc";
  if (code === "EACCES" || code === "EPERM") return "eacces";
  if (code === "EROFS") return "read-only";
  if (code === "WRITER_CONFLICT") return "writer-conflict";
  return operation === "open" ? "unknown" : operation;
}

function droppedCounter(
  level: LogRecord["level"],
): "droppedTrace" | "droppedDebug" | "droppedInfo" | "droppedWarn" | "droppedError" {
  if (level <= 10) return "droppedTrace";
  if (level <= 20) return "droppedDebug";
  if (level <= 30) return "droppedInfo";
  if (level <= 40) return "droppedWarn";
  return "droppedError";
}

function mergeBuffers(overrides: Partial<LogBufferLimits> | undefined): LogBufferLimits {
  return { ...FIRST_PARTY_BUFFERS, ...overrides };
}

function mergeRetention(overrides: Partial<LogRetentionPolicy> | undefined): LogRetentionPolicy {
  return { ...FIRST_PARTY_RETENTION, ...overrides };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function validateOptions(
  options: CreateNodeLoggingOptions,
  buffers: LogBufferLimits,
  retention: LogRetentionPolicy,
): void {
  if (!isAbsolute(options.logRoot)) throw new Error("logRoot must be absolute");
  LogStreamV1.parse(options.stream);
  if (options.bootId.length === 0 || options.bootId.length > 256) {
    throw new Error("bootId must contain 1..256 characters");
  }
  if (options.instanceId.length === 0 || options.instanceId.length > 256) {
    throw new Error("instanceId must contain 1..256 characters");
  }
  const component = options.component ?? "root";
  if (component.length > 160 || !/^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$/.test(component)) {
    throw new Error("component is invalid");
  }

  assertPositiveInteger(buffers.queueRecords, "queueRecords");
  assertPositiveInteger(buffers.queueBytes, "queueBytes");
  assertPositiveInteger(buffers.ringRecords, "ringRecords");
  assertPositiveInteger(buffers.ringBytes, "ringBytes");
  assertPositiveInteger(buffers.maxRecordBytes, "maxRecordBytes");
  if (
    !Number.isSafeInteger(buffers.reservedRecords) ||
    buffers.reservedRecords < 0 ||
    buffers.reservedRecords >= buffers.queueRecords
  ) {
    throw new Error("reservedRecords must be smaller than queueRecords");
  }
  if (
    !Number.isSafeInteger(buffers.reservedBytes) ||
    buffers.reservedBytes < 0 ||
    buffers.reservedBytes >= buffers.queueBytes
  ) {
    throw new Error("reservedBytes must be smaller than queueBytes");
  }
  if (buffers.maxRecordBytes + 1 > buffers.queueBytes) {
    throw new Error("maxRecordBytes must fit in queueBytes");
  }

  assertPositiveInteger(retention.maxSegmentBytes, "maxSegmentBytes");
  assertPositiveInteger(retention.maxAgeMs, "maxAgeMs");
  assertPositiveInteger(retention.categoryCapBytes, "categoryCapBytes");
  if (!Number.isSafeInteger(retention.maxClosedSegments) || retention.maxClosedSegments < 0) {
    throw new Error("maxClosedSegments must be a non-negative safe integer");
  }
}

class FirstPartyLogger implements Logger {
  constructor(
    private readonly owner: NodeLoggingService,
    private readonly bindings: LoggerBindings,
  ) {}

  child(bindings: LoggerBindings): Logger {
    return new FirstPartyLogger(this.owner, { ...this.bindings, ...bindings });
  }

  trace(event: string, message: string, attrs?: LogFields): void {
    this.owner.emit("trace", this.bindings, event, message, undefined, attrs);
  }

  debug(event: string, message: string, attrs?: LogFields): void {
    this.owner.emit("debug", this.bindings, event, message, undefined, attrs);
  }

  info(event: string, message: string, attrs?: LogFields): void {
    this.owner.emit("info", this.bindings, event, message, undefined, attrs);
  }

  warn(event: string, message: string, attrs?: LogFields): void {
    this.owner.emit("warn", this.bindings, event, message, undefined, attrs);
  }

  error(event: string, message: string, error?: unknown, attrs?: LogFields): void {
    this.owner.emit("error", this.bindings, event, message, error, attrs);
  }

  fatal(event: string, message: string, error?: unknown, attrs?: LogFields): void {
    this.owner.emit("fatal", this.bindings, event, message, error, attrs);
  }

  isLevelEnabled(level: LogLevelNameV1): boolean {
    return this.owner.isLevelEnabled(level);
  }
}

class NodeLoggingService implements NodeLogging {
  readonly logger: Logger;
  readonly filePath: string;

  private readonly now: () => number;
  private readonly buffers: LogBufferLimits;
  private readonly writer: SegmentWriter;
  private readonly ring: BoundedLogRing;
  private readonly pino: PinoLogger;
  private readonly emergency: (message: string) => void;
  private readonly queue: QueuedLine[] = [];
  private queueBytes = 0;
  private queueHighWaterRecords = 0;
  private queueHighWaterBytes = 0;
  private draining = false;
  private drainScheduled = false;
  private accepting = true;
  private closed = false;
  private seq = 0;
  private retryAttempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private emergencyEmitted = false;
  private idleWaiters = new Set<() => void>();
  private lastWriterError: unknown;

  private state: LoggingHealth["writerState"] = "starting";
  private level: LogLevelNameV1;
  private activeSegmentBytes = 0;
  private lastWriteAt: number | undefined;
  private lastFailure: LoggingHealth["lastFailure"];
  private counters: LoggingHealth["counters"] = {
    accepted: 0,
    rejected: 0,
    truncated: 0,
    droppedTrace: 0,
    droppedDebug: 0,
    droppedInfo: 0,
    droppedWarn: 0,
    droppedError: 0,
    bytesWritten: 0,
    rotations: 0,
    cleanupDeletions: 0,
    emergencyFallbacks: 0,
  };

  constructor(private readonly options: CreateNodeLoggingOptions) {
    this.now = options.now ?? Date.now;
    this.buffers = mergeBuffers(options.buffers);
    const retention = mergeRetention(options.retention);
    validateOptions(options, this.buffers, retention);
    this.level = options.level ?? "info";
    this.emergency =
      options.emergency ??
      ((message) => {
        process.stderr.write(`${message}\n`);
      });
    this.writer = new SegmentWriter({
      logRoot: options.logRoot,
      stream: options.stream,
      bootId: options.bootId,
      now: this.now,
      retention,
      ...(options.testHooks !== undefined ? { hooks: options.testHooks } : {}),
    });
    this.filePath = this.writer.activePath;
    this.ring = new BoundedLogRing(this.buffers.ringRecords, this.buffers.ringBytes);
    const destination: DestinationStream = {
      write: (line: string) => {
        this.acceptSerialized(line);
      },
    };
    this.pino = pino(
      {
        level: this.level,
        base: null,
        timestamp: false,
        messageKey: "msg",
        formatters: {
          level(label, number) {
            return { level: number, severity: label.toUpperCase() };
          },
        },
        serializers: {
          err(value) {
            return value;
          },
        },
      },
      destination,
    );
    this.logger = new FirstPartyLogger(this, {
      component: options.component ?? "root",
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.writer.open();
      this.activeSegmentBytes = this.writer.bytes;
      this.state = "healthy";
      this.lastWriterError = undefined;
    } catch (error) {
      this.noteFailure(error, "open");
      this.scheduleRetry();
    }
  }

  isLevelEnabled(level: LogLevelNameV1): boolean {
    return this.pino.isLevelEnabled(level);
  }

  emit(
    level: LogLevelNameV1,
    bindings: LoggerBindings,
    event: string,
    message: string,
    error?: unknown,
    attrs?: LogFields,
  ): void {
    this.normalizeAndWrite({
      level,
      event,
      message,
      ...(error !== undefined ? { error } : {}),
      ...(attrs !== undefined ? { attrs } : {}),
      bindings,
      pid: this.options.pid ?? process.pid,
      time: this.now(),
    });
  }

  ingest(input: TrustedLogIngress): void {
    this.normalizeAndWrite({
      level: input.level,
      event: input.event,
      message: input.message,
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.attrs !== undefined ? { attrs: input.attrs } : {}),
      bindings: {
        ...(input.bindings ?? {}),
        component: input.component,
        ...(input.windowId !== undefined ? { windowId: input.windowId } : {}),
      },
      pid: input.pid ?? this.options.pid ?? process.pid,
      time: input.time,
      observedTime: input.observedTime ?? this.now(),
      ...(input.truncation !== undefined ? { truncation: input.truncation } : {}),
    });
  }

  private normalizeAndWrite(input: {
    level: LogLevelNameV1;
    event: string;
    message: string;
    error?: unknown;
    attrs?: LogFields;
    bindings: LoggerBindings;
    pid: number;
    time: number;
    observedTime?: number;
    truncation?: TrustedLogIngress["truncation"];
  }): void {
    if (!this.accepting || !this.pino.isLevelEnabled(input.level)) return;
    const record = normalizeLogRecord({
      level: input.level,
      event: input.event,
      message: input.message,
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.attrs !== undefined ? { attrs: input.attrs } : {}),
      bindings: input.bindings,
      service: this.options.service,
      role: this.options.role,
      component: this.options.component ?? "root",
      pid: input.pid,
      bootId: this.options.bootId,
      instanceId: this.options.instanceId,
      seq: ++this.seq,
      time: input.time,
      ...(input.observedTime !== undefined ? { observedTime: input.observedTime } : {}),
      ...(input.truncation !== undefined ? { truncation: input.truncation } : {}),
      maxRecordBytes: this.buffers.maxRecordBytes,
      ...(this.options.aliases !== undefined ? { aliases: this.options.aliases } : {}),
    });
    if (!record) {
      this.counters.rejected += 1;
      return;
    }
    const { level: _level, severity: _severity, msg, ...fields } = record;
    try {
      const method = this.pino[input.level].bind(this.pino) as (
        values: Record<string, unknown>,
        message: string,
      ) => void;
      method(fields, msg);
    } catch {
      this.counters.rejected += 1;
    }
  }

  health(): LoggingHealth {
    const candidate: LoggingHealth = {
      v: 1,
      stream: this.options.stream,
      service: this.options.service,
      bootId: this.options.bootId,
      instanceId: this.options.instanceId,
      writerState: this.state,
      currentLevel: this.level,
      activeLeaseCount: 0,
      activeSegmentBytes: this.activeSegmentBytes,
      queue: {
        records: this.queue.length,
        bytes: this.queueBytes,
        highWaterRecords: this.queueHighWaterRecords,
        highWaterBytes: this.queueHighWaterBytes,
        capacityRecords: this.buffers.queueRecords,
        capacityBytes: this.buffers.queueBytes,
      },
      ring: this.ring.health(),
      counters: { ...this.counters },
      ...(this.lastWriteAt !== undefined ? { lastWriteAt: this.lastWriteAt } : {}),
      ...(this.lastFailure !== undefined ? { lastFailure: { ...this.lastFailure } } : {}),
    };
    return LoggingHealthV1.parse(candidate);
  }

  recent(limit?: number) {
    return this.ring.snapshot(limit);
  }

  setLevel(level: LogLevelNameV1): void {
    this.level = level;
    this.pino.level = level;
  }

  async flush(): Promise<void> {
    this.cancelRetry();
    this.scheduleDrain();
    await this.waitForIdle(2_000);
    if (!this.writer.isOpen) {
      throw this.lastWriterError ?? new Error("logging writer is unavailable");
    }
    try {
      await this.writer.flush();
    } catch (error) {
      this.noteFailure(error, "flush");
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.accepting = false;
    this.cancelRetry();
    this.scheduleDrain();
    try {
      await this.waitForIdle(2_000);
    } catch {
      this.dropQueued();
    }
    this.cancelRetry();
    try {
      await this.writer.close();
    } catch (error) {
      this.noteFailure(error, "close");
    }
    this.closed = true;
    this.state = "closed";
    this.resolveIdleWaiters();
  }

  private acceptSerialized(serialized: string): void {
    try {
      const lineText = serialized.endsWith("\n") ? serialized : `${serialized}\n`;
      const line = Buffer.from(lineText, "utf8");
      if (line.byteLength > this.buffers.maxRecordBytes + 1) {
        this.counters.rejected += 1;
        this.counters.truncated += 1;
        return;
      }
      const parsed = LogRecordV1.safeParse(JSON.parse(lineText));
      if (!parsed.success) {
        this.counters.rejected += 1;
        return;
      }
      if (!this.admit(line, parsed.data.level)) return;
      this.counters.accepted += 1;
      if (parsed.data.truncation) this.counters.truncated += 1;
      this.ring.push(parsed.data, line.byteLength);
      this.scheduleDrain();
    } catch {
      this.counters.rejected += 1;
    }
  }

  private admit(line: Buffer, level: LogRecord["level"]): boolean {
    if (!this.accepting) {
      this.counters.rejected += 1;
      return false;
    }
    const highSeverity = level >= 40;
    const recordLimit = highSeverity
      ? this.buffers.queueRecords
      : this.buffers.queueRecords - this.buffers.reservedRecords;
    const byteLimit = highSeverity
      ? this.buffers.queueBytes
      : this.buffers.queueBytes - this.buffers.reservedBytes;

    if (highSeverity) {
      while (this.queue.length + 1 > recordLimit || this.queueBytes + line.byteLength > byteLimit) {
        const evicted = this.evictLowerSeverity();
        if (!evicted) break;
      }
    }
    if (this.queue.length + 1 > recordLimit || this.queueBytes + line.byteLength > byteLimit) {
      this.noteDrop(level);
      if (highSeverity) this.emitEmergency("VibeField logging queue exhausted");
      return false;
    }
    this.queue.push({ line, level });
    this.queueBytes += line.byteLength;
    this.queueHighWaterRecords = Math.max(this.queueHighWaterRecords, this.queue.length);
    this.queueHighWaterBytes = Math.max(this.queueHighWaterBytes, this.queueBytes);
    return true;
  }

  private evictLowerSeverity(): boolean {
    for (const maximum of [10, 20, 30] as const) {
      const index = this.queue.findIndex((entry) => entry.level <= maximum);
      if (index < 0) continue;
      const [removed] = this.queue.splice(index, 1);
      if (!removed) return false;
      this.queueBytes -= removed.line.byteLength;
      this.noteDrop(removed.level);
      return true;
    }
    return false;
  }

  private noteDrop(level: LogRecord["level"]): void {
    const counter = droppedCounter(level);
    this.counters[counter] += 1;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.draining || this.closed || this.retryTimer) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining || this.closed || this.retryTimer) return;
    this.draining = true;
    try {
      if (!this.writer.isOpen) {
        try {
          await this.writer.open();
          this.activeSegmentBytes = this.writer.bytes;
          if (this.queue.length === 0) {
            this.state = "healthy";
            this.lastFailure = undefined;
            this.lastWriterError = undefined;
            this.retryAttempt = 0;
            this.emergencyEmitted = false;
          }
        } catch (error) {
          this.noteFailure(error, "open");
          this.scheduleRetry();
          return;
        }
      }
      while (this.queue.length > 0 && !this.closed) {
        const batch = this.queue.splice(0, 128);
        const batchBytes = batch.reduce((sum, entry) => sum + entry.line.byteLength, 0);
        this.queueBytes -= batchBytes;
        try {
          const result = await this.writer.append(batch.map((entry) => entry.line));
          this.counters.bytesWritten += result.bytes;
          this.counters.rotations += result.rotations;
          this.counters.cleanupDeletions += result.cleanupDeletions;
          this.activeSegmentBytes = this.writer.bytes;
          this.lastWriteAt = this.now();
          this.state = "healthy";
          this.lastFailure = undefined;
          this.lastWriterError = undefined;
          this.retryAttempt = 0;
          this.emergencyEmitted = false;
        } catch (error) {
          const partial = error instanceof SegmentAppendError ? error.result : undefined;
          const completed = partial?.records ?? 0;
          if (partial !== undefined) {
            this.counters.bytesWritten += partial.bytes;
            this.counters.rotations += partial.rotations;
            this.counters.cleanupDeletions += partial.cleanupDeletions;
            if (partial.records > 0) this.lastWriteAt = this.now();
          }
          for (let index = batch.length - 1; index >= completed; index -= 1) {
            const entry = batch[index];
            if (!entry) continue;
            this.queue.unshift(entry);
            this.queueBytes += entry.line.byteLength;
          }
          this.noteFailure(error instanceof SegmentAppendError ? error.cause : error, "write");
          this.scheduleRetry();
          break;
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length === 0) this.resolveIdleWaiters();
      else if (!this.retryTimer) this.scheduleDrain();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.closed) return;
    const delay = Math.min(250 * 2 ** Math.min(this.retryAttempt, 16), 30_000);
    this.retryAttempt = Math.min(this.retryAttempt + 1, 16);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.scheduleDrain();
    }, delay);
    this.retryTimer.unref();
  }

  private noteFailure(error: unknown, operation: WriterOperation): void {
    const kind = classifyFailure(error, operation);
    this.lastWriterError = error;
    this.state = kind === "writer-conflict" ? "writer-conflict" : "degraded";
    const detail = error instanceof WriterOperationError ? error.cause : error;
    const serialized = serializeError(detail, {
      ...(this.options.aliases !== undefined ? { aliases: this.options.aliases } : {}),
    });
    this.lastFailure = {
      kind,
      time: this.now(),
      message: serialized.message.slice(0, 500),
    };
    this.emitEmergency(`VibeField logging ${operation} failed (${this.lastFailure.kind})`);
  }

  private emitEmergency(message: string): void {
    if (this.emergencyEmitted) return;
    this.emergencyEmitted = true;
    this.counters.emergencyFallbacks += 1;
    try {
      this.emergency(message);
    } catch {
      // Emergency output is terminal; it never recurses through this logger.
    }
  }

  private waitForIdle(timeoutMs: number): Promise<void> {
    if (!this.drainScheduled && !this.draining && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        if (error) reject(error);
        else resolve();
      };
      const onIdle = () => finish();
      const timer = setTimeout(
        () => finish(new Error("logging flush deadline exceeded")),
        timeoutMs,
      );
      this.idleWaiters.add(onIdle);
    });
  }

  private resolveIdleWaiters(): void {
    if (this.drainScheduled || this.draining || this.queue.length > 0) return;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  private dropQueued(): void {
    for (const entry of this.queue) this.noteDrop(entry.level);
    this.queue.length = 0;
    this.queueBytes = 0;
    this.resolveIdleWaiters();
  }

  private cancelRetry(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

export async function createNodeLogging(options: CreateNodeLoggingOptions): Promise<NodeLogging> {
  const service = new NodeLoggingService(options);
  await service.initialize();
  return service;
}

export function createNoopLogger(): Logger {
  const noop: Logger = {
    child: () => noop,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    isLevelEnabled: () => false,
  };
  return noop;
}
