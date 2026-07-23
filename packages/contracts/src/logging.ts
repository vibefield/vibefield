import { z } from "zod";
import { LOG_STREAMS } from "./registries";

// LOG-L0 normalized diagnostic contracts. This module is a dedicated package
// subpath and is deliberately NOT re-exported from src/index.ts (LOG-41): the
// renderer boot chunk does not pay for schemas it does not parse at boot.

export const LogSchemaVersionV1 = z.number().int().min(1).max(1);
export type LogSchemaVersionV1 = z.infer<typeof LogSchemaVersionV1>;

export const LOG_LEVEL_VALUES_V1 = [10, 20, 30, 40, 50, 60] as const;
export type LogLevelV1 = (typeof LOG_LEVEL_VALUES_V1)[number];
export const LogLevelV1 = z
  .number()
  .int()
  .min(10)
  .max(60)
  .refine(
    (value): value is LogLevelV1 => (LOG_LEVEL_VALUES_V1 as readonly number[]).includes(value),
    "invalid log level",
  );

export const LogLevelNameV1 = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
export type LogLevelNameV1 = z.infer<typeof LogLevelNameV1>;

export const LogSeverityV1 = z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);
export type LogSeverityV1 = z.infer<typeof LogSeverityV1>;

export const LogServiceV1 = z.enum(["desktop", "renderer", "utility", "fieldd", "field-native"]);
export type LogServiceV1 = z.infer<typeof LogServiceV1>;

export const LogRoleV1 = z.enum(["main", "renderer", "utility", "daemon", "worker", "sidecar"]);
export type LogRoleV1 = z.infer<typeof LogRoleV1>;

export const LogStreamV1 = z.enum([
  LOG_STREAMS.SYSTEM_DESKTOP,
  LOG_STREAMS.SYSTEM_RENDERER,
  LOG_STREAMS.SYSTEM_UTILITY,
  LOG_STREAMS.SYSTEM_FIELDD,
  LOG_STREAMS.SYSTEM_FIELD_NATIVE,
  LOG_STREAMS.PLUGINS_RENDERER,
  LOG_STREAMS.PLUGINS_SERVICE,
  LOG_STREAMS.PLUGINS_UTILITY,
]);
export type LogStreamV1 = z.infer<typeof LogStreamV1>;

export const LogBoundedIdentityV1 = z.string().min(1).max(256);
export type LogBoundedIdentityV1 = z.infer<typeof LogBoundedIdentityV1>;

export const LogSafeIntegerV1 = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type LogSafeIntegerV1 = z.infer<typeof LogSafeIntegerV1>;

const EventName = z
  .string()
  .min(3)
  .max(192)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
const ComponentName = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$/);

export type LogValueV1 =
  | null
  | boolean
  | number
  | string
  | LogValueV1[]
  | { [key: string]: LogValueV1 };

function isLogValue(value: unknown, seen = new WeakSet<object>()): value is LogValueV1 {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.some((key) => typeof key === "symbol")) return false;
    if (Array.isArray(value)) {
      const elementKeys = descriptorKeys.filter((key) => key !== "length");
      const length = descriptors.length?.value;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        elementKeys.length !== length
      ) {
        return false;
      }
      for (const key of elementKeys) {
        if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) return false;
        const index = Number(key);
        const descriptor = descriptors[key];
        if (
          index >= length ||
          descriptor === undefined ||
          !("value" in descriptor) ||
          !isLogValue(descriptor.value, seen)
        ) {
          return false;
        }
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const descriptor of Object.values(descriptors)) {
      if (
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        !isLogValue(descriptor.value, seen)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

/** JSON-safe recursive value. Runtime sanitizers impose §13's stricter byte,
 * depth, array, and key limits before a record reaches this wire shape.
 * `z.custom` deliberately emits an unconstrained JSON Schema so typify uses
 * serde_json::Value and preserves integer-vs-float JSON number spelling. */
export const LogValueV1 = z.custom<LogValueV1>(isLogValue, "expected a JSON-safe value");

export type LogAttributesV1 = Record<string, LogValueV1>;

function isLogAttributes(value: unknown): value is LogAttributesV1 {
  if (value === null || typeof value !== "object") return false;
  try {
    return !Array.isArray(value) && isLogValue(value);
  } catch {
    return false;
  }
}

/** JSON-safe attribute bag validated as one value. Keeping this guard outside
 * `z.record(...)` prevents Zod from enumerating hostile proxies or invoking
 * getters before the fail-closed JSON-value check runs. */
export const LogAttributesV1 = z.custom<LogAttributesV1>(
  isLogAttributes,
  "expected a JSON-safe attribute object",
);

export const PluginLogProvenanceV1 = z
  .object({
    id: LogBoundedIdentityV1,
    version: z.string().min(1).max(64),
    installRevision: z.string().min(1).max(128),
    entry: z.enum(["renderer", "service", "utility"]),
    windowId: LogBoundedIdentityV1.optional(),
    installSource: z.enum(["bundled", "registry", "peer", "dev-link"]),
    trust: z.enum(["r0-bundled", "r1-registry", "r2-peer", "r3-dev"]),
  })
  .passthrough();
export type PluginLogProvenanceV1 = z.infer<typeof PluginLogProvenanceV1>;

export interface LogErrorShapeV1 {
  type: string;
  message: string;
  code?: string | undefined;
  stack?: string | undefined;
  causes?: LogErrorShapeV1[] | undefined;
  [key: string]: unknown;
}

export const LogErrorV1: z.ZodType<LogErrorShapeV1> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1).max(256),
      message: z.string().max(16 * 1024),
      code: z.string().max(256).optional(),
      stack: z
        .string()
        .max(32 * 1024)
        .optional(),
      causes: z.array(LogErrorV1).max(4).optional(),
    })
    .passthrough(),
);
export type LogErrorV1 = z.infer<typeof LogErrorV1>;

export const LogTruncationReasonV1 = z.enum([
  "record-bytes",
  "message-bytes",
  "string-bytes",
  "object-depth",
  "object-keys",
  "array-items",
  "error-causes",
  "partial-line",
]);
export type LogTruncationReasonV1 = z.infer<typeof LogTruncationReasonV1>;

export const LogTruncationV1 = z
  .object({
    reasons: z.array(LogTruncationReasonV1).min(1).max(8),
    originalBytes: LogSafeIntegerV1.optional(),
    droppedBytes: LogSafeIntegerV1.optional(),
    originalItems: LogSafeIntegerV1.optional(),
    droppedItems: LogSafeIntegerV1.optional(),
    fields: z.array(z.string().min(1).max(160)).max(32).optional(),
  })
  .passthrough();
export type LogTruncationV1 = z.infer<typeof LogTruncationV1>;

export const LogRecordV1 = z
  .object({
    v: LogSchemaVersionV1,
    time: LogSafeIntegerV1,
    observedTime: LogSafeIntegerV1.optional(),
    level: LogLevelV1,
    severity: LogSeverityV1,
    event: EventName,
    msg: z.string().max(16 * 1024),
    service: LogServiceV1,
    role: LogRoleV1,
    component: ComponentName,
    pid: LogSafeIntegerV1,
    bootId: LogBoundedIdentityV1,
    instanceId: LogBoundedIdentityV1,
    seq: LogSafeIntegerV1,
    traceId: LogBoundedIdentityV1.optional(),
    spanId: LogBoundedIdentityV1.optional(),
    operationId: LogBoundedIdentityV1.optional(),
    requestId: LogBoundedIdentityV1.optional(),
    sessionId: LogBoundedIdentityV1.optional(),
    docId: LogBoundedIdentityV1.optional(),
    deviceId: LogBoundedIdentityV1.optional(),
    windowId: LogBoundedIdentityV1.optional(),
    plugin: PluginLogProvenanceV1.optional(),
    err: LogErrorV1.optional(),
    attrs: LogAttributesV1.optional(),
    truncation: LogTruncationV1.optional(),
  })
  .passthrough()
  .describe("vibefield.logging.contract.v1");
export type LogRecordV1 = z.infer<typeof LogRecordV1>;

export const LoggingWriterStateV1 = z.enum([
  "starting",
  "healthy",
  "degraded",
  "closed",
  "writer-conflict",
]);
export type LoggingWriterStateV1 = z.infer<typeof LoggingWriterStateV1>;

export const LoggingBufferHealthV1 = z
  .object({
    records: LogSafeIntegerV1,
    bytes: LogSafeIntegerV1,
    highWaterRecords: LogSafeIntegerV1,
    highWaterBytes: LogSafeIntegerV1,
    capacityRecords: LogSafeIntegerV1,
    capacityBytes: LogSafeIntegerV1,
  })
  .passthrough();
export type LoggingBufferHealthV1 = z.infer<typeof LoggingBufferHealthV1>;

export const LoggingCountersV1 = z
  .object({
    accepted: LogSafeIntegerV1,
    rejected: LogSafeIntegerV1,
    truncated: LogSafeIntegerV1,
    droppedTrace: LogSafeIntegerV1,
    droppedDebug: LogSafeIntegerV1,
    droppedInfo: LogSafeIntegerV1,
    droppedWarn: LogSafeIntegerV1,
    droppedError: LogSafeIntegerV1,
    bytesWritten: LogSafeIntegerV1,
    rotations: LogSafeIntegerV1,
    cleanupDeletions: LogSafeIntegerV1,
    emergencyFallbacks: LogSafeIntegerV1,
  })
  .passthrough();
export type LoggingCountersV1 = z.infer<typeof LoggingCountersV1>;

export const LoggingFailureV1 = z
  .object({
    kind: z.enum([
      "enospc",
      "eacces",
      "read-only",
      "rename",
      "write",
      "flush",
      "close",
      "writer-conflict",
      "unknown",
    ]),
    time: LogSafeIntegerV1,
    message: z.string().max(500),
  })
  .passthrough();
export type LoggingFailureV1 = z.infer<typeof LoggingFailureV1>;

export const LoggingHealthV1 = z
  .object({
    v: LogSchemaVersionV1,
    stream: LogStreamV1,
    service: LogServiceV1,
    bootId: LogBoundedIdentityV1,
    instanceId: LogBoundedIdentityV1,
    writerState: LoggingWriterStateV1,
    currentLevel: LogLevelNameV1,
    activeLeaseCount: LogSafeIntegerV1,
    activeSegmentBytes: LogSafeIntegerV1,
    queue: LoggingBufferHealthV1,
    ring: LoggingBufferHealthV1,
    counters: LoggingCountersV1,
    lastWriteAt: LogSafeIntegerV1.optional(),
    lastFailure: LoggingFailureV1.optional(),
  })
  .passthrough()
  .describe("vibefield.logging.health.contract.v1");
export type LoggingHealthV1 = z.infer<typeof LoggingHealthV1>;
