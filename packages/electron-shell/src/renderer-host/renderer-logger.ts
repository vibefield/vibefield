import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import type {
  LogErrorV1,
  LogIngressRecordV1,
  LogLevelNameV1,
  LogTruncationReasonV1,
  LogTruncationV1,
  LogValueV1,
  RendererLogBatchV1,
  RendererLogDropCountsV1,
} from "@vibefield/contracts/logging";
import type {
  RendererLogFields,
  RendererLogger,
  RendererLoggerBindings,
} from "@vibefield/field-app/logging";

const EVENT_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const COMPONENT_NAME = /^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$/;
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const LEVEL_NUMBER: Record<LogLevelNameV1, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

interface TruncationTracker {
  readonly reasons: Set<LogTruncationReasonV1>;
  readonly fields: Set<string>;
}

interface QueueEntry {
  readonly record: LogIngressRecordV1;
  readonly bytes: number;
}

interface RendererValueLimits {
  readonly messageBytes: number;
  readonly stringBytes: number;
  readonly stackBytes: number;
  readonly objectDepth: number;
  readonly objectKeys: number;
  readonly arrayItems: number;
  readonly errorCauses: number;
  readonly recordBytes: number;
}

const FIRST_PARTY_LIMITS: RendererValueLimits = {
  messageBytes: 16 * 1024,
  stringBytes: 16 * 1024,
  stackBytes: 32 * 1024,
  objectDepth: 6,
  objectKeys: 100,
  arrayItems: 100,
  errorCauses: 4,
  recordBytes: LOG_TRANSPORT_LIMITS.RENDERER_RECORD_BYTES,
};

const PLUGIN_LIMITS: RendererValueLimits = {
  messageBytes: LOG_TRANSPORT_LIMITS.PLUGIN_MESSAGE_BYTES,
  stringBytes: LOG_TRANSPORT_LIMITS.PLUGIN_STRING_BYTES,
  stackBytes: LOG_TRANSPORT_LIMITS.PLUGIN_STACK_BYTES,
  objectDepth: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_DEPTH,
  objectKeys: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_KEYS,
  arrayItems: LOG_TRANSPORT_LIMITS.PLUGIN_ARRAY_ITEMS,
  errorCauses: LOG_TRANSPORT_LIMITS.PLUGIN_ERROR_CAUSES,
  recordBytes: LOG_TRANSPORT_LIMITS.PLUGIN_RECORD_BYTES,
};

export interface RendererLoggerHealth {
  readonly queueRecords: number;
  readonly queueBytes: number;
  readonly queueHighWaterRecords: number;
  readonly queueHighWaterBytes: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly sentBatches: number;
  readonly sentRecords: number;
  readonly dropped: RendererLogDropCountsV1;
}

export interface RendererLoggingClient {
  readonly logger: RendererLogger;
  flush(): void;
  close(): void;
  health(): RendererLoggerHealth;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number, marker = "…[truncated]"): string {
  if (byteLength(value) <= maxBytes) return value;
  const markerBytes = encoder.encode(marker);
  if (markerBytes.byteLength >= maxBytes) {
    for (let end = maxBytes; end > 0; end -= 1) {
      try {
        return decoder.decode(markerBytes.subarray(0, end));
      } catch {
        // Walk to the previous complete UTF-8 boundary.
      }
    }
    return "";
  }
  const source = encoder.encode(value);
  for (let end = maxBytes - markerBytes.byteLength; end > 0; end -= 1) {
    try {
      return `${decoder.decode(source.subarray(0, end))}${marker}`;
    } catch {
      // Walk to the previous complete UTF-8 boundary.
    }
  }
  return marker;
}

function safeDataProperty(value: object, key: string): unknown {
  let cursor: object | null = value;
  for (let depth = 0; cursor !== null && depth < 3; depth += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
      if (descriptor !== undefined) return "value" in descriptor ? descriptor.value : undefined;
      cursor = Object.getPrototypeOf(cursor);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function safeError(
  value: unknown,
  limits: RendererValueLimits,
  seen = new WeakSet<object>(),
  depth = 0,
): LogErrorV1 {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    const primitive =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "[non-serializable thrown value]";
    return { type: "ThrownValue", message: truncateUtf8(primitive, limits.messageBytes) };
  }
  if (typeof value === "object" && seen.has(value)) {
    return { type: "CircularError", message: "[circular error cause]" };
  }
  if (typeof value === "object") seen.add(value);
  try {
    const rawType = safeDataProperty(value, "name") ?? safeDataProperty(value, "type");
    const rawMessage = safeDataProperty(value, "message");
    const rawCode = safeDataProperty(value, "code");
    const rawStack = safeDataProperty(value, "stack");
    const type =
      typeof rawType === "string" && rawType.length > 0
        ? truncateUtf8(rawType, 256, "…")
        : "ErrorLike";
    const message =
      typeof rawMessage === "string"
        ? truncateUtf8(rawMessage, limits.messageBytes)
        : "[error details unavailable]";
    const code =
      typeof rawCode === "string" || typeof rawCode === "number"
        ? truncateUtf8(String(rawCode), 256, "…")
        : undefined;
    const stack =
      typeof rawStack === "string" ? truncateUtf8(rawStack, limits.stackBytes) : undefined;
    const causes: LogErrorV1[] = [];
    if (depth < limits.errorCauses) {
      const cause = safeDataProperty(value, "cause");
      if (cause !== undefined) causes.push(safeError(cause, limits, seen, depth + 1));
      const aggregate = safeDataProperty(value, "errors") ?? safeDataProperty(value, "causes");
      if (Array.isArray(aggregate)) {
        const descriptors = Object.getOwnPropertyDescriptors(aggregate);
        for (
          let index = 0;
          index < aggregate.length && causes.length < limits.errorCauses;
          index += 1
        ) {
          const descriptor = descriptors[String(index)];
          if (descriptor && "value" in descriptor) {
            causes.push(safeError(descriptor.value, limits, seen, depth + 1));
          }
        }
      }
    }
    return {
      type,
      message,
      ...(code !== undefined ? { code } : {}),
      ...(stack !== undefined ? { stack } : {}),
      ...(causes.length > 0 ? { causes } : {}),
    };
  } catch {
    return { type: "ErrorLike", message: "[error serialization failed safely]" };
  } finally {
    if (typeof value === "object") seen.delete(value);
  }
}

function safeValue(
  value: unknown,
  path: string,
  depth: number,
  limits: RendererValueLimits,
  tracker: TruncationTracker,
  ancestors: WeakSet<object>,
): LogValueV1 {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bounded = truncateUtf8(value, limits.stringBytes);
    if (bounded !== value) {
      tracker.reasons.add("string-bytes");
      tracker.fields.add(path);
    }
    return bounded;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : `[non-finite:${value}]`;
  if (typeof value === "bigint") return `[bigint:${truncateUtf8(String(value), 128)}]`;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function") return "[unsupported:function]";
  if (typeof value === "symbol") return "[unsupported:symbol]";
  if (depth >= limits.objectDepth) {
    tracker.reasons.add("object-depth");
    tracker.fields.add(path);
    return "[truncated:object-depth]";
  }
  if (ancestors.has(value)) return "[circular]";
  ancestors.add(value);
  try {
    if (value instanceof Error) {
      const error = safeError(value, limits);
      return error as unknown as LogValueV1;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === "symbol")) return "[unsupported:symbol-keys]";
    if (Array.isArray(value)) {
      const length =
        descriptors.length &&
        "value" in descriptors.length &&
        typeof descriptors.length.value === "number"
          ? descriptors.length.value
          : 0;
      const count = Math.min(length, limits.arrayItems);
      const result: LogValueV1[] = [];
      for (let index = 0; index < count; index += 1) {
        const descriptor = descriptors[String(index)];
        result.push(
          descriptor && "value" in descriptor
            ? safeValue(
                descriptor.value,
                `${path}[${index}]`,
                depth + 1,
                limits,
                tracker,
                ancestors,
              )
            : "[sparse]",
        );
      }
      if (length > count) {
        tracker.reasons.add("array-items");
        tracker.fields.add(path);
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[unsupported:object]";
    const result: Record<string, LogValueV1> = Object.create(null);
    let accepted = 0;
    for (const key of ownKeys) {
      if (typeof key !== "string" || PROTOTYPE_KEYS.has(key)) continue;
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) continue;
      if (accepted >= limits.objectKeys) {
        tracker.reasons.add("object-keys");
        tracker.fields.add(path);
        break;
      }
      const safeKey = truncateUtf8(key, 160, "…");
      result[safeKey] = safeValue(
        descriptor.value,
        `${path}.${safeKey}`,
        depth + 1,
        limits,
        tracker,
        ancestors,
      );
      accepted += 1;
    }
    return result;
  } catch {
    return "[unavailable]";
  } finally {
    ancestors.delete(value);
  }
}

function safeIdentity(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return truncateUtf8(value, 256, "…");
}

function emptyDrops(): RendererLogDropCountsV1 {
  return { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
}

function hasDrops(value: RendererLogDropCountsV1): boolean {
  return Object.values(value).some((count) => count > 0);
}

class RendererLoggerView implements RendererLogger {
  constructor(
    private readonly owner: RendererLoggingOwner,
    private readonly bindings: RendererLoggerBindings,
  ) {}

  child(bindings: RendererLoggerBindings): RendererLogger {
    return new RendererLoggerView(this.owner, { ...this.bindings, ...bindings });
  }

  trace(event: string, message: string, attrs?: RendererLogFields): void {
    this.owner.emit("trace", this.bindings, event, message, undefined, attrs);
  }

  debug(event: string, message: string, attrs?: RendererLogFields): void {
    this.owner.emit("debug", this.bindings, event, message, undefined, attrs);
  }

  info(event: string, message: string, attrs?: RendererLogFields): void {
    this.owner.emit("info", this.bindings, event, message, undefined, attrs);
  }

  warn(event: string, message: string, attrs?: RendererLogFields): void {
    this.owner.emit("warn", this.bindings, event, message, undefined, attrs);
  }

  error(event: string, message: string, error?: unknown, attrs?: RendererLogFields): void {
    this.owner.emit("error", this.bindings, event, message, error, attrs);
  }

  fatal(event: string, message: string, error?: unknown, attrs?: RendererLogFields): void {
    this.owner.emit("fatal", this.bindings, event, message, error, attrs);
  }

  isLevelEnabled(level: LogLevelNameV1): boolean {
    return this.owner.isLevelEnabled(level);
  }
}

class RendererLoggingOwner implements RendererLoggingClient {
  readonly logger: RendererLogger;
  private readonly queue: QueueEntry[] = [];
  private readonly dropped = emptyDrops();
  private queueBytes = 0;
  private queueHighWaterRecords = 0;
  private queueHighWaterBytes = 0;
  private accepted = 0;
  private rejected = 0;
  private sentBatches = 0;
  private sentRecords = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private accepting = true;
  private flushing = false;

  constructor(
    private readonly options: {
      send(serializedBatch: string): boolean;
      component: string;
      level: LogLevelNameV1;
      now: () => number;
    },
  ) {
    this.logger = new RendererLoggerView(this, { component: options.component });
  }

  isLevelEnabled(level: LogLevelNameV1): boolean {
    return LEVEL_NUMBER[level] >= LEVEL_NUMBER[this.options.level];
  }

  emit(
    level: LogLevelNameV1,
    bindings: RendererLoggerBindings,
    event: string,
    message: string,
    error?: unknown,
    attrs?: RendererLogFields,
  ): void {
    if (!this.accepting || !this.isLevelEnabled(level)) return;
    const record = this.makeRecord(level, bindings, event, message, error, attrs);
    if (record === null) {
      this.rejected += 1;
      return;
    }
    const serialized = JSON.stringify(record);
    const bytes = byteLength(serialized);
    if (bytes > LOG_TRANSPORT_LIMITS.RENDERER_RECORD_BYTES) {
      this.rejected += 1;
      this.dropped[level] += 1;
      return;
    }
    if (!this.admit({ record, bytes })) return;
    this.accepted += 1;
    if (LEVEL_NUMBER[level] >= LEVEL_NUMBER.error) {
      this.schedule(0);
    } else {
      this.schedule(100);
    }
  }

  flush(): void {
    if (this.flushing) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0 && !hasDrops(this.dropped)) return;
    this.flushing = true;
    try {
      let count = Math.min(this.queue.length, LOG_TRANSPORT_LIMITS.RENDERER_BATCH_RECORDS);
      let serialized = "";
      let batch: RendererLogBatchV1;
      for (;;) {
        batch = {
          v: 1,
          records: this.queue.slice(0, count).map((entry) => entry.record),
          ...(hasDrops(this.dropped) ? { dropped: { ...this.dropped } } : {}),
        };
        serialized = JSON.stringify(batch);
        if (byteLength(serialized) <= LOG_TRANSPORT_LIMITS.RENDERER_BATCH_BYTES) break;
        count -= 1;
        if (count < 0) {
          this.rejectQueued();
          return;
        }
      }
      if (!this.options.send(serialized)) {
        this.schedule(100);
        return;
      }
      const sent = this.queue.splice(0, count);
      for (const entry of sent) this.queueBytes -= entry.bytes;
      this.sentBatches += 1;
      this.sentRecords += sent.length;
      Object.assign(this.dropped, emptyDrops());
    } finally {
      this.flushing = false;
    }
    if (this.queue.length > 0 || hasDrops(this.dropped)) this.schedule(100);
  }

  close(): void {
    if (!this.accepting) return;
    this.accepting = false;
    this.flush();
    if (this.queue.length > 0) this.rejectQueued();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  health(): RendererLoggerHealth {
    return {
      queueRecords: this.queue.length,
      queueBytes: this.queueBytes,
      queueHighWaterRecords: this.queueHighWaterRecords,
      queueHighWaterBytes: this.queueHighWaterBytes,
      accepted: this.accepted,
      rejected: this.rejected,
      sentBatches: this.sentBatches,
      sentRecords: this.sentRecords,
      dropped: { ...this.dropped },
    };
  }

  private makeRecord(
    level: LogLevelNameV1,
    bindings: RendererLoggerBindings,
    event: string,
    message: string,
    error?: unknown,
    attrs?: RendererLogFields,
  ): LogIngressRecordV1 | null {
    if (
      typeof event !== "string" ||
      event.length > 192 ||
      !EVENT_NAME.test(event) ||
      typeof message !== "string"
    ) {
      return null;
    }
    const component = bindings.component ?? this.options.component;
    if (component.length > 160 || !COMPONENT_NAME.test(component)) return null;
    const pluginId = safeIdentity(bindings.pluginId);
    if (bindings.pluginId !== undefined && pluginId === undefined) return null;
    const limits = pluginId === undefined ? FIRST_PARTY_LIMITS : PLUGIN_LIMITS;
    const tracker: TruncationTracker = { reasons: new Set(), fields: new Set() };
    const msg = truncateUtf8(message, limits.messageBytes);
    if (msg !== message) {
      tracker.reasons.add("message-bytes");
      tracker.fields.add("msg");
    }
    const attrsValue =
      attrs === undefined
        ? undefined
        : safeValue(attrs, "attrs", 0, limits, tracker, new WeakSet());
    const normalizedAttrs =
      attrsValue !== null && typeof attrsValue === "object" && !Array.isArray(attrsValue)
        ? (attrsValue as Record<string, LogValueV1>)
        : undefined;
    const truncation: LogTruncationV1 | undefined =
      tracker.reasons.size === 0
        ? undefined
        : {
            reasons: [...tracker.reasons].slice(0, 8),
            ...(tracker.fields.size > 0 ? { fields: [...tracker.fields].slice(0, 32) } : {}),
          };
    const record: LogIngressRecordV1 = {
      v: 1,
      time: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(this.options.now()))),
      level,
      event,
      msg,
      component,
      ...(safeIdentity(bindings.traceId) !== undefined
        ? { traceId: safeIdentity(bindings.traceId) }
        : {}),
      ...(safeIdentity(bindings.spanId) !== undefined
        ? { spanId: safeIdentity(bindings.spanId) }
        : {}),
      ...(safeIdentity(bindings.operationId) !== undefined
        ? { operationId: safeIdentity(bindings.operationId) }
        : {}),
      ...(safeIdentity(bindings.requestId) !== undefined
        ? { requestId: safeIdentity(bindings.requestId) }
        : {}),
      ...(safeIdentity(bindings.sessionId) !== undefined
        ? { sessionId: safeIdentity(bindings.sessionId) }
        : {}),
      ...(safeIdentity(bindings.docId) !== undefined
        ? { docId: safeIdentity(bindings.docId) }
        : {}),
      ...(safeIdentity(bindings.deviceId) !== undefined
        ? { deviceId: safeIdentity(bindings.deviceId) }
        : {}),
      ...(pluginId !== undefined ? { pluginId } : {}),
      ...(error !== undefined ? { err: safeError(error, limits) } : {}),
      ...(normalizedAttrs !== undefined ? { attrs: normalizedAttrs } : {}),
      ...(truncation !== undefined ? { truncation } : {}),
    };

    let serialized = JSON.stringify(record);
    if (byteLength(serialized) <= limits.recordBytes) return record;
    delete record.attrs;
    delete record.err;
    record.msg = truncateUtf8(record.msg, 1_024);
    const finalReasons: LogTruncationReasonV1[] = [
      ...new Set<LogTruncationReasonV1>([...(record.truncation?.reasons ?? []), "record-bytes"]),
    ].slice(0, 8);
    const finalTruncation: LogTruncationV1 = {
      reasons: finalReasons,
      originalBytes: byteLength(serialized),
      fields: ["attrs", "err", "msg"],
    };
    record.truncation = finalTruncation;
    serialized = JSON.stringify(record);
    finalTruncation.droppedBytes = Math.max(
      0,
      (finalTruncation.originalBytes ?? 0) - byteLength(serialized),
    );
    return byteLength(JSON.stringify(record)) <= limits.recordBytes ? record : null;
  }

  private admit(entry: QueueEntry): boolean {
    const highSeverity =
      entry.record.level === "warn" ||
      entry.record.level === "error" ||
      entry.record.level === "fatal";
    if (highSeverity) {
      while (
        this.queue.length + 1 > LOG_TRANSPORT_LIMITS.RENDERER_QUEUE_RECORDS ||
        this.queueBytes + entry.bytes > LOG_TRANSPORT_LIMITS.RENDERER_QUEUE_BYTES
      ) {
        const index = this.queue.findIndex(
          (queued) =>
            queued.record.level === "trace" ||
            queued.record.level === "debug" ||
            queued.record.level === "info",
        );
        if (index < 0) break;
        const [removed] = this.queue.splice(index, 1);
        if (removed === undefined) break;
        this.queueBytes -= removed.bytes;
        this.dropped[removed.record.level] += 1;
      }
    }
    if (
      this.queue.length + 1 > LOG_TRANSPORT_LIMITS.RENDERER_QUEUE_RECORDS ||
      this.queueBytes + entry.bytes > LOG_TRANSPORT_LIMITS.RENDERER_QUEUE_BYTES
    ) {
      this.dropped[entry.record.level] += 1;
      return false;
    }
    if (highSeverity && this.queue.length >= LOG_TRANSPORT_LIMITS.RENDERER_BATCH_RECORDS) {
      const firstLowSeverity = this.queue.findIndex(
        (queued) =>
          queued.record.level === "trace" ||
          queued.record.level === "debug" ||
          queued.record.level === "info",
      );
      if (firstLowSeverity >= 0) this.queue.splice(firstLowSeverity, 0, entry);
      else this.queue.push(entry);
    } else {
      this.queue.push(entry);
    }
    this.queueBytes += entry.bytes;
    this.queueHighWaterRecords = Math.max(this.queueHighWaterRecords, this.queue.length);
    this.queueHighWaterBytes = Math.max(this.queueHighWaterBytes, this.queueBytes);
    return true;
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) {
      if (delayMs !== 0) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delayMs);
  }

  private rejectQueued(): void {
    for (const entry of this.queue) this.dropped[entry.record.level] += 1;
    this.rejected += this.queue.length;
    this.queue.length = 0;
    this.queueBytes = 0;
  }
}

export function createRendererLoggingClient(options: {
  send(serializedBatch: string): boolean;
  component?: string;
  level?: LogLevelNameV1;
  now?: () => number;
}): RendererLoggingClient {
  return new RendererLoggingOwner({
    send: options.send,
    component: options.component ?? "renderer",
    level: options.level ?? "info",
    now: options.now ?? Date.now,
  });
}
