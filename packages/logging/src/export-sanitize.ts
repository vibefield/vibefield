import {
  LogRecordV1 as LogRecordSchema,
  type LogRecordV1,
  type LogValueV1,
} from "@vibefield/contracts/logging";
import { normalizeLogRecord } from "./sanitize";
import type { LogSanitizerAliases } from "./types";

const LEVEL_NAME = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
} as const;

const RESIDUAL_SECRET_PATTERNS = [
  /VIBEFIELD_(?:LOG|SUPPORT)_CANARY_[A-Za-z0-9_-]+/i,
  /\bBearer\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]{12,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\/t\/(?!\[redacted\])[A-Za-z0-9_-]{16,}/,
];

function identityKind(key: string): string | null {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "pid" || normalized.endsWith("pid")) return "pid";
  if (normalized === "pluginid") return "plugin";
  if (normalized.endsWith("id") && normalized.length <= 48) {
    return normalized.slice(0, -2) || "id";
  }
  return null;
}

export class ExportPseudonyms {
  private readonly aliases = new Map<string, string>();
  private readonly counts = new Map<string, number>();

  alias(kind: string, value: string): string {
    const key = `${kind}\0${value}`;
    const existing = this.aliases.get(key);
    if (existing !== undefined) return existing;
    const next = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, next);
    const alias = `${kind}-${next}`;
    this.aliases.set(key, alias);
    return alias;
  }

  aliasNumber(kind: string, value: number): number {
    const alias = this.alias(kind, String(value));
    return Number(alias.slice(alias.lastIndexOf("-") + 1));
  }

  values(kind: string): string[] {
    return [...this.aliases.entries()]
      .filter(([key]) => key.startsWith(`${kind}\0`))
      .map(([, alias]) => alias);
  }
}

function aliasValue(value: LogValueV1, key: string, pseudonyms: ExportPseudonyms): LogValueV1 {
  const kind = identityKind(key);
  if (kind !== null && typeof value === "string") return pseudonyms.alias(kind, value);
  if (kind === "pid" && typeof value === "number") {
    return pseudonyms.aliasNumber("pid", value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => aliasValue(entry, key, pseudonyms));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, LogValueV1> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = aliasValue(childValue, childKey, pseudonyms);
    }
    return result;
  }
  return value;
}

export interface ExportSanitizeResult {
  record: LogRecordV1 | null;
  omitted: boolean;
  truncated: boolean;
}

/** Reparse + re-sanitize + pseudonymize one already-ingested record. This is
 * intentionally independent from the writer path: support export never treats
 * at-ingest redaction as sufficient. */
export function sanitizeLogRecordForExport(
  raw: unknown,
  options: {
    aliases: LogSanitizerAliases;
    pseudonyms: ExportPseudonyms;
    maxRecordBytes: number;
  },
): ExportSanitizeResult {
  const parsed = LogRecordSchema.safeParse(raw);
  if (!parsed.success) return { record: null, omitted: true, truncated: false };
  const source = parsed.data;
  const level = LEVEL_NAME[source.level];
  if (level === undefined) return { record: null, omitted: true, truncated: false };
  const attrs =
    source.attrs === undefined
      ? undefined
      : (aliasValue(source.attrs, "attrs", options.pseudonyms) as Record<string, LogValueV1>);
  const sanitized = normalizeLogRecord({
    level,
    event: source.event,
    message: source.msg,
    ...(source.err !== undefined ? { error: source.err } : {}),
    ...(attrs !== undefined ? { attrs } : {}),
    bindings: {
      ...(source.traceId !== undefined
        ? { traceId: options.pseudonyms.alias("trace", source.traceId) }
        : {}),
      ...(source.spanId !== undefined
        ? { spanId: options.pseudonyms.alias("span", source.spanId) }
        : {}),
      ...(source.operationId !== undefined
        ? { operationId: options.pseudonyms.alias("operation", source.operationId) }
        : {}),
      ...(source.requestId !== undefined
        ? { requestId: options.pseudonyms.alias("request", source.requestId) }
        : {}),
      ...(source.sessionId !== undefined
        ? { sessionId: options.pseudonyms.alias("session", source.sessionId) }
        : {}),
      ...(source.docId !== undefined
        ? { docId: options.pseudonyms.alias("document", source.docId) }
        : {}),
      ...(source.deviceId !== undefined
        ? { deviceId: options.pseudonyms.alias("device", source.deviceId) }
        : {}),
      ...(source.windowId !== undefined
        ? { windowId: options.pseudonyms.alias("window", source.windowId) }
        : {}),
    },
    service: source.service,
    role: source.role,
    component: source.component,
    pid: options.pseudonyms.aliasNumber("pid", source.pid),
    bootId: options.pseudonyms.alias("boot", source.bootId),
    instanceId: options.pseudonyms.alias("instance", source.instanceId),
    seq: source.seq,
    time: source.time,
    ...(source.observedTime !== undefined ? { observedTime: source.observedTime } : {}),
    ...(source.truncation !== undefined ? { truncation: source.truncation } : {}),
    ...(source.plugin !== undefined
      ? {
          plugin: {
            ...source.plugin,
            id: options.pseudonyms.alias("plugin", source.plugin.id),
            installRevision: options.pseudonyms.alias("revision", source.plugin.installRevision),
            ...(source.plugin.windowId !== undefined
              ? {
                  windowId: options.pseudonyms.alias("window", source.plugin.windowId),
                }
              : {}),
          },
        }
      : {}),
    maxRecordBytes: options.maxRecordBytes,
    aliases: options.aliases,
  });
  if (sanitized === null) return { record: null, omitted: true, truncated: false };
  const serialized = JSON.stringify(sanitized);
  if (RESIDUAL_SECRET_PATTERNS.some((pattern) => pattern.test(serialized))) {
    return { record: null, omitted: true, truncated: false };
  }
  return {
    record: sanitized,
    omitted: false,
    truncated:
      JSON.stringify(sanitized.truncation ?? null) !== JSON.stringify(source.truncation ?? null),
  };
}
