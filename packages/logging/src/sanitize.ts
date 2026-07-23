import type {
  LogErrorShapeV1,
  LogLevelNameV1,
  LogRecordV1,
  LogTruncationReasonV1,
  LogTruncationV1,
  LogValueV1,
} from "@vibefield/contracts/logging";
import { FIRST_PARTY_VALUE_LIMITS } from "./limits";
import type { LoggerBindings, LogSanitizerAliases } from "./types";

const EVENT_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const COMPONENT_NAME = /^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$/;
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SECRET_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "token",
  "accesstoken",
  "refreshtoken",
  "credential",
  "password",
  "secret",
  "privatekey",
  "pairing",
  "apikey",
  "sessioncookie",
  "environment",
  "env",
  "commandline",
  "approvalinput",
]);
const LEVEL_NUMBER: Record<LogLevelNameV1, 10 | 20 | 30 | 40 | 50 | 60> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

interface TruncationTracker {
  reasons: Set<LogTruncationReasonV1>;
  fields: Set<string>;
}

export interface NormalizeRecordInput {
  level: LogLevelNameV1;
  event: string;
  message: string;
  error?: unknown;
  attrs?: Readonly<Record<string, unknown>>;
  bindings: LoggerBindings;
  service: LogRecordV1["service"];
  role: LogRecordV1["role"];
  component: string;
  pid: number;
  bootId: string;
  instanceId: string;
  seq: number;
  time: number;
  observedTime?: number;
  truncation?: LogTruncationV1;
  maxRecordBytes: number;
  aliases?: LogSanitizerAliases;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value: string, maxBytes: number, marker = "…[truncated]"): string {
  if (maxBytes <= 0) return "";
  if (byteLength(value) <= maxBytes) return value;
  const markerBytes = byteLength(marker);
  if (markerBytes >= maxBytes) {
    const markerBuffer = Buffer.from(marker);
    let markerEnd = Math.min(markerBuffer.byteLength, maxBytes);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (markerEnd > 0) {
      try {
        return decoder.decode(markerBuffer.subarray(0, markerEnd));
      } catch {
        markerEnd -= 1;
      }
    }
    return "";
  }
  const source = Buffer.from(value);
  let end = maxBytes - markerBytes;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (end > 0) {
    try {
      return `${decoder.decode(source.subarray(0, end))}${marker}`;
    } catch {
      end -= 1;
    }
  }
  return marker;
}

function normalizeSecretKey(key: string): string {
  return key.toLowerCase().replace(/[_\s-]/g, "");
}

function isSecretKey(key: string): boolean {
  const normalized = normalizeSecretKey(key);
  return (
    SECRET_KEYS.has(normalized) ||
    normalized.endsWith("token") ||
    normalized.endsWith("password") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("sessioncookie")
  );
}

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function redactPatterns(value: string, aliases: LogSanitizerAliases | undefined): string {
  let out = value
    .replace(/\/t\/[A-Za-z0-9_-]{16,}/g, "/t/[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
    .replace(
      /\b(token|access[_-]?token|refresh[_-]?token|credential|password|secret|private[_-]?key|pairing|api[_-]?key|session[_-]?cookie)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,}/gi,
      "$1=[redacted]",
    )
    .replace(
      /\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]{8,}/gi,
      "$1=[redacted]",
    )
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[private-key redacted]",
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, sanitizeUrl);

  const replacements: Array<[string | undefined, string]> = [
    [aliases?.home, "<home>"],
    [aliases?.temp, "<temp>"],
    [aliases?.logs, "<logs>"],
    [aliases?.data, "<data>"],
  ];
  replacements.sort((a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0));
  for (const [prefix, replacement] of replacements) {
    if (!prefix) continue;
    out = out.split(prefix).join(replacement);
  }
  return out;
}

function safeDataProperty(value: object, key: string): unknown {
  let cursor: object | null = value;
  for (let depth = 0; cursor !== null && depth < 3; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    } catch {
      return undefined;
    }
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    try {
      cursor = Object.getPrototypeOf(cursor);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function safeString(
  value: unknown,
  maxBytes: number,
  aliases: LogSanitizerAliases | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  return truncateUtf8(redactPatterns(value, aliases), maxBytes);
}

export function serializeError(
  value: unknown,
  options: {
    aliases?: LogSanitizerAliases | undefined;
    maxCauses?: number;
    seen?: WeakSet<object>;
  } = {},
): LogErrorShapeV1 {
  const aliases = options.aliases;
  const seen = options.seen ?? new WeakSet<object>();
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return {
      type: "ThrownValue",
      message: truncateUtf8(redactPatterns(String(value), aliases), 16 * 1024),
    };
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
    const safeType = safeString(rawType, 256, aliases);
    const type =
      safeType && safeType.length > 0
        ? safeType
        : value instanceof Error && value.name.length > 0
          ? truncateUtf8(value.name, 256)
          : "ErrorLike";
    const message =
      safeString(rawMessage, 16 * 1024, aliases) ??
      truncateUtf8(redactPatterns("[error details unavailable]", aliases), 16 * 1024);
    const code =
      typeof rawCode === "string" || typeof rawCode === "number"
        ? truncateUtf8(redactPatterns(String(rawCode), aliases), 256)
        : undefined;
    const stack = safeString(rawStack, FIRST_PARTY_VALUE_LIMITS.stackBytes, aliases);
    const maxCauses = options.maxCauses ?? FIRST_PARTY_VALUE_LIMITS.errorCauses;
    const causeValues: unknown[] = [];
    const cause = safeDataProperty(value, "cause");
    if (cause !== undefined) causeValues.push(cause);
    const aggregate = safeDataProperty(value, "errors") ?? safeDataProperty(value, "causes");
    if (Array.isArray(aggregate)) {
      const descriptors = Object.getOwnPropertyDescriptors(aggregate);
      for (let index = 0; index < aggregate.length && causeValues.length < maxCauses; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor && "value" in descriptor) causeValues.push(descriptor.value);
      }
    }
    const causes = causeValues
      .slice(0, maxCauses)
      .map((entry) => serializeError(entry, { aliases, maxCauses: maxCauses - 1, seen }));
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

function errorToLogValue(error: LogErrorShapeV1): LogValueV1 {
  const result: Record<string, LogValueV1> = {
    type: error.type,
    message: error.message,
  };
  if (error.code !== undefined) result.code = error.code;
  if (error.stack !== undefined) result.stack = error.stack;
  if (error.causes !== undefined) {
    result.causes = error.causes.map((cause) => errorToLogValue(cause));
  }
  return result;
}

function sanitizeValue(
  value: unknown,
  path: string,
  depth: number,
  aliases: LogSanitizerAliases | undefined,
  tracker: TruncationTracker,
  ancestors: WeakSet<object>,
): LogValueV1 {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = redactPatterns(value, aliases);
    const bounded = truncateUtf8(redacted, FIRST_PARTY_VALUE_LIMITS.stringBytes);
    if (bounded !== redacted) {
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
  if (depth >= FIRST_PARTY_VALUE_LIMITS.objectDepth) {
    tracker.reasons.add("object-depth");
    tracker.fields.add(path);
    return "[truncated:object-depth]";
  }
  if (ancestors.has(value)) return "[circular]";

  ancestors.add(value);
  try {
    if (Buffer.isBuffer(value)) return `[binary omitted:${value.byteLength} bytes]`;
    if (value instanceof Error) return errorToLogValue(serializeError(value, { aliases }));

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === "symbol")) return "[unsupported:symbol-keys]";
    if (Array.isArray(value)) {
      const lengthDescriptor = descriptors.length;
      const length =
        lengthDescriptor &&
        "value" in lengthDescriptor &&
        typeof lengthDescriptor.value === "number"
          ? lengthDescriptor.value
          : 0;
      const count = Math.min(length, FIRST_PARTY_VALUE_LIMITS.arrayItems);
      const result: LogValueV1[] = [];
      for (let index = 0; index < count; index += 1) {
        const descriptor = descriptors[String(index)];
        result.push(
          descriptor && "value" in descriptor
            ? sanitizeValue(
                descriptor.value,
                `${path}[${index}]`,
                depth + 1,
                aliases,
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
      if (typeof key !== "string") continue;
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) continue;
      if (PROTOTYPE_KEYS.has(key)) continue;
      if (accepted >= FIRST_PARTY_VALUE_LIMITS.objectKeys) {
        tracker.reasons.add("object-keys");
        tracker.fields.add(path);
        break;
      }
      const safeKey = truncateUtf8(redactPatterns(key, aliases), 160);
      if (isSecretKey(key)) {
        result[safeKey] = "[redacted]";
      } else {
        result[safeKey] = sanitizeValue(
          descriptor.value,
          `${path}.${safeKey}`,
          depth + 1,
          aliases,
          tracker,
          ancestors,
        );
      }
      accepted += 1;
    }
    return result;
  } catch {
    return "[unavailable]";
  } finally {
    ancestors.delete(value);
  }
}

function safeIdentity(
  value: string | undefined,
  aliases: LogSanitizerAliases | undefined,
): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return truncateUtf8(redactPatterns(value, aliases), FIRST_PARTY_VALUE_LIMITS.identityBytes, "…");
}

function recordBytes(record: LogRecordV1): number {
  return Buffer.byteLength(JSON.stringify(record), "utf8");
}

function safeNonnegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value)));
}

function enforceRecordLimit(
  record: LogRecordV1,
  maxBytes: number,
  tracker: TruncationTracker,
): LogRecordV1 | null {
  const originalBytes = recordBytes(record);
  if (originalBytes <= maxBytes) return record;
  tracker.reasons.add("record-bytes");

  if (record.err?.stack !== undefined) {
    delete record.err.stack;
    tracker.fields.add("err.stack");
  }
  if (record.err?.causes !== undefined && recordBytes(record) > maxBytes) {
    delete record.err.causes;
    tracker.fields.add("err.causes");
  }
  if (record.attrs !== undefined) {
    const keys = Object.keys(record.attrs);
    while (keys.length > 0 && recordBytes(record) > maxBytes - 256) {
      const key = keys.pop();
      if (key !== undefined) {
        delete record.attrs[key];
        tracker.fields.add(`attrs.${key}`);
      }
    }
    if (Object.keys(record.attrs).length === 0) delete record.attrs;
  }
  if (recordBytes(record) > maxBytes - 256) {
    record.msg = truncateUtf8(record.msg, 4 * 1024);
    tracker.reasons.add("message-bytes");
    tracker.fields.add("msg");
  }
  if (record.err && recordBytes(record) > maxBytes - 256) {
    record.err.message = truncateUtf8(record.err.message, 2 * 1024);
    tracker.fields.add("err.message");
  }

  const reasons = [...tracker.reasons].slice(0, 8);
  const fields = [...tracker.fields].slice(0, 32);
  record.truncation = {
    reasons,
    originalBytes,
    ...(fields.length > 0 ? { fields } : {}),
  };
  let finalBytes = recordBytes(record);
  if (finalBytes > maxBytes) {
    delete record.attrs;
    delete record.err;
    record.msg = truncateUtf8(record.msg, 1_024);
    finalBytes = recordBytes(record);
  }
  if (record.truncation) record.truncation.droppedBytes = Math.max(0, originalBytes - finalBytes);
  finalBytes = recordBytes(record);
  if (finalBytes > maxBytes && record.truncation?.fields !== undefined) {
    delete record.truncation.fields;
    finalBytes = recordBytes(record);
  }
  if (finalBytes > maxBytes) {
    const messageOverhead = finalBytes - byteLength(record.msg);
    const availableMessageBytes = maxBytes - messageOverhead;
    if (availableMessageBytes < 0) return null;
    record.msg = truncateUtf8(record.msg, availableMessageBytes, "…");
    finalBytes = recordBytes(record);
  }
  if (record.truncation) {
    record.truncation.droppedBytes = Math.max(0, originalBytes - finalBytes);
  }
  return recordBytes(record) <= maxBytes ? record : null;
}

export function normalizeLogRecord(input: NormalizeRecordInput): LogRecordV1 | null {
  try {
    if (
      typeof input.level !== "string" ||
      !Object.hasOwn(LEVEL_NUMBER, input.level) ||
      typeof input.event !== "string" ||
      typeof input.message !== "string"
    ) {
      return null;
    }
    if (!EVENT_NAME.test(input.event) || input.event.length > 192) return null;
    const component = input.bindings.component ?? input.component;
    if (typeof component !== "string") return null;
    if (!COMPONENT_NAME.test(component) || component.length > 160) return null;
    const tracker: TruncationTracker = {
      reasons: new Set(input.truncation?.reasons ?? []),
      fields: new Set(input.truncation?.fields ?? []),
    };
    const redactedMessage = redactPatterns(input.message, input.aliases);
    const message = truncateUtf8(redactedMessage, FIRST_PARTY_VALUE_LIMITS.messageBytes);
    if (message !== redactedMessage) {
      tracker.reasons.add("message-bytes");
      tracker.fields.add("msg");
    }
    const attrsValue =
      input.attrs === undefined
        ? undefined
        : sanitizeValue(input.attrs, "attrs", 0, input.aliases, tracker, new WeakSet());
    const attrs =
      attrsValue !== null && typeof attrsValue === "object" && !Array.isArray(attrsValue)
        ? attrsValue
        : undefined;
    const err =
      input.error === undefined
        ? undefined
        : serializeError(input.error, { aliases: input.aliases });
    const traceId = safeIdentity(input.bindings.traceId, input.aliases);
    const spanId = safeIdentity(input.bindings.spanId, input.aliases);
    const operationId = safeIdentity(input.bindings.operationId, input.aliases);
    const requestId = safeIdentity(input.bindings.requestId, input.aliases);
    const sessionId = safeIdentity(input.bindings.sessionId, input.aliases);
    const docId = safeIdentity(input.bindings.docId, input.aliases);
    const deviceId = safeIdentity(input.bindings.deviceId, input.aliases);
    const windowId = safeIdentity(input.bindings.windowId, input.aliases);
    const record: LogRecordV1 = {
      v: 1,
      time: safeNonnegativeInteger(input.time),
      ...(input.observedTime !== undefined
        ? { observedTime: safeNonnegativeInteger(input.observedTime) }
        : {}),
      level: LEVEL_NUMBER[input.level],
      severity: input.level.toUpperCase() as LogRecordV1["severity"],
      event: input.event,
      msg: message,
      service: input.service,
      role: input.role,
      component,
      pid: safeNonnegativeInteger(input.pid),
      bootId: safeIdentity(input.bootId, input.aliases) ?? "unknown-boot",
      instanceId: safeIdentity(input.instanceId, input.aliases) ?? "unknown-instance",
      seq: safeNonnegativeInteger(input.seq),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(spanId !== undefined ? { spanId } : {}),
      ...(operationId !== undefined ? { operationId } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(docId !== undefined ? { docId } : {}),
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(windowId !== undefined ? { windowId } : {}),
      ...(attrs !== undefined ? { attrs } : {}),
      ...(err !== undefined ? { err } : {}),
    };
    if (tracker.reasons.size > 0) {
      record.truncation = {
        ...(input.truncation?.originalBytes !== undefined
          ? { originalBytes: safeNonnegativeInteger(input.truncation.originalBytes) }
          : {}),
        ...(input.truncation?.droppedBytes !== undefined
          ? { droppedBytes: safeNonnegativeInteger(input.truncation.droppedBytes) }
          : {}),
        ...(input.truncation?.originalItems !== undefined
          ? { originalItems: safeNonnegativeInteger(input.truncation.originalItems) }
          : {}),
        ...(input.truncation?.droppedItems !== undefined
          ? { droppedItems: safeNonnegativeInteger(input.truncation.droppedItems) }
          : {}),
        reasons: [...tracker.reasons].slice(0, 8),
        ...(tracker.fields.size > 0 ? { fields: [...tracker.fields].slice(0, 32) } : {}),
      };
    }
    return enforceRecordLimit(record, input.maxRecordBytes, tracker);
  } catch {
    return null;
  }
}
