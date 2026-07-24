import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { LOG_STREAMS, LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import {
  DiagnosticLogQueryV1,
  type DiagnosticParseFailureV1,
} from "@vibefield/contracts/diagnostics";
import { LogRecordV1 as LogRecordSchema, type LogRecordV1 } from "@vibefield/contracts/logging";
import { createBoundedLineFramer } from "./line-framer";
import type { HistoricalLogPage, HistoricalLogReadOptions } from "./types";

const DEFAULT_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_SCAN_BYTES = 256 * 1024 * 1024;
const MAX_SEGMENTS = 128;
const MAX_FAILURES = 256;

const LEVEL_NUMBER = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

interface Segment {
  source: DiagnosticLogQueryV1["sources"][number];
  path: string;
  active: boolean;
  mtimeMs: number;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function closedSegmentPattern(streamName: string): RegExp {
  return new RegExp(
    `^${streamName}\\.\\d{8}T\\d{9}Z\\.[A-Za-z0-9_-]+\\.\\d{4}\\.(?:size|utc-day|partial-recovery)\\.ndjson$`,
  );
}

function expectedPluginEntry(
  source: DiagnosticLogQueryV1["sources"][number],
): "renderer" | "service" | "utility" | undefined {
  if (source === LOG_STREAMS.PLUGINS_RENDERER) return "renderer";
  if (source === LOG_STREAMS.PLUGINS_SERVICE) return "service";
  if (source === LOG_STREAMS.PLUGINS_UTILITY) return "utility";
  return undefined;
}

function recordBelongsToSource(
  source: DiagnosticLogQueryV1["sources"][number],
  record: LogRecordV1,
): boolean {
  const systemService =
    source === LOG_STREAMS.SYSTEM_DESKTOP
      ? "desktop"
      : source === LOG_STREAMS.SYSTEM_RENDERER
        ? "renderer"
        : source === LOG_STREAMS.SYSTEM_UTILITY
          ? "utility"
          : source === LOG_STREAMS.SYSTEM_FIELDD
            ? "fieldd"
            : source === LOG_STREAMS.SYSTEM_FIELD_NATIVE
              ? "field-native"
              : undefined;
  if (systemService !== undefined) {
    return record.plugin === undefined && record.service === systemService;
  }
  const entry = expectedPluginEntry(source);
  return entry !== undefined && record.plugin?.entry === entry;
}

export function diagnosticRecordMatches(record: LogRecordV1, query: DiagnosticLogQueryV1): boolean {
  if (query.sinceTime !== undefined && record.time < query.sinceTime) return false;
  if (query.minLevel !== undefined && record.level < LEVEL_NUMBER[query.minLevel]) return false;
  if (query.components !== undefined && !query.components.includes(record.component)) return false;
  if (query.pluginId !== undefined && record.plugin?.id !== query.pluginId) return false;
  if (query.text !== undefined) {
    const needle = query.text.toLocaleLowerCase();
    if (!JSON.stringify(record).toLocaleLowerCase().includes(needle)) return false;
  }
  return true;
}

function compareRecords(left: LogRecordV1, right: LogRecordV1): number {
  return (
    left.time - right.time ||
    (left.observedTime ?? left.time) - (right.observedTime ?? right.time) ||
    left.bootId.localeCompare(right.bootId) ||
    left.seq - right.seq
  );
}

async function enumerateSegments(
  logRoot: string,
  sources: DiagnosticLogQueryV1["sources"],
): Promise<{ segments: Segment[]; skippedUnsafeSegments: number }> {
  let skippedUnsafeSegments = 0;
  try {
    const root = await lstat(logRoot);
    if (root.isSymbolicLink() || !root.isDirectory()) {
      return { segments: [], skippedUnsafeSegments: 1 };
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { segments: [], skippedUnsafeSegments: 0 };
    throw error;
  }

  const segments: Segment[] = [];
  for (const source of new Set(sources)) {
    const [category, streamName] = source.split("/");
    if (!category || !streamName) continue;
    const categoryPath = join(logRoot, category);
    try {
      const categoryInfo = await lstat(categoryPath);
      if (categoryInfo.isSymbolicLink() || !categoryInfo.isDirectory()) {
        skippedUnsafeSegments += 1;
        continue;
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }

    const activeName = `${streamName}.ndjson`;
    const closed = closedSegmentPattern(streamName);
    const entries = await readdir(categoryPath, { withFileTypes: true });
    for (const entry of entries.slice(0, MAX_SEGMENTS * 2)) {
      if (entry.name !== activeName && !closed.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        skippedUnsafeSegments += 1;
        continue;
      }
      const path = join(categoryPath, entry.name);
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isFile()) {
          skippedUnsafeSegments += 1;
          continue;
        }
        segments.push({
          source,
          path,
          active: entry.name === activeName,
          mtimeMs: info.mtimeMs,
        });
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }

  segments.sort(
    (left, right) =>
      Number(right.active) - Number(left.active) ||
      right.mtimeMs - left.mtimeMs ||
      right.path.localeCompare(left.path),
  );
  if (segments.length > MAX_SEGMENTS) {
    skippedUnsafeSegments += segments.length - MAX_SEGMENTS;
    segments.length = MAX_SEGMENTS;
  }
  return { segments, skippedUnsafeSegments };
}

/**
 * Reads only registered stream segments, newest first, with one shared byte
 * budget. No watcher, whole-file allocation, caller-provided path, or symlink
 * traversal participates in this path.
 */
export async function readLogHistory(
  options: HistoricalLogReadOptions,
): Promise<HistoricalLogPage> {
  if (!isAbsolute(options.logRoot)) throw new Error("logRoot must be absolute");
  const query = DiagnosticLogQueryV1.parse(options.query);
  const maxScanBytes = options.maxScanBytes ?? DEFAULT_SCAN_BYTES;
  if (!Number.isSafeInteger(maxScanBytes) || maxScanBytes <= 0 || maxScanBytes > MAX_SCAN_BYTES) {
    throw new Error(`maxScanBytes must be within 1..${MAX_SCAN_BYTES}`);
  }

  const enumerated = await enumerateSegments(options.logRoot, query.sources);
  const records: LogRecordV1[] = [];
  const failures: DiagnosticParseFailureV1[] = [];
  let scannedBytes = 0;
  let scannedSegments = 0;
  let truncated = false;

  const noteFailure = (
    source: DiagnosticLogQueryV1["sources"][number],
    reason: DiagnosticParseFailureV1["reason"],
    inputBytes: number,
    lineNumber?: number,
  ): void => {
    if (failures.length >= MAX_FAILURES) {
      truncated = true;
      return;
    }
    failures.push({
      v: 1,
      source,
      observedTime: Date.now(),
      reason,
      inputBytes: Math.min(Math.max(0, inputBytes), Number.MAX_SAFE_INTEGER),
      ...(lineNumber !== undefined ? { lineNumber } : {}),
    });
  };

  for (const segment of enumerated.segments) {
    options.signal?.throwIfAborted();
    if (scannedBytes >= maxScanBytes) {
      truncated = true;
      break;
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      handle = await open(segment.path, constants.O_RDONLY | noFollow);
      const info = await handle.stat();
      if (!info.isFile()) {
        enumerated.skippedUnsafeSegments += 1;
        await handle.close();
        continue;
      }
    } catch (error) {
      if (["ENOENT", "ELOOP"].includes(errorCode(error) ?? "")) {
        enumerated.skippedUnsafeSegments += 1;
        continue;
      }
      throw error;
    }

    scannedSegments += 1;
    let lineNumber = 0;
    let flushingTail = false;
    const maxLineBytes = segment.source.startsWith("plugins/")
      ? LOG_TRANSPORT_LIMITS.PLUGIN_RECORD_BYTES
      : LOG_TRANSPORT_LIMITS.FIRST_PARTY_PARTIAL_LINE_BYTES;
    const framer = createBoundedLineFramer({
      maxBytes: maxLineBytes,
      onLine(framed) {
        lineNumber += 1;
        if (flushingTail) {
          noteFailure(segment.source, "partial-line", framed.inputBytes, lineNumber);
          return;
        }
        if (framed.truncated) {
          noteFailure(segment.source, "oversized-record", framed.inputBytes, lineNumber);
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(framed.line);
        } catch {
          noteFailure(segment.source, "invalid-json", framed.inputBytes, lineNumber);
          return;
        }
        if (
          typeof raw === "object" &&
          raw !== null &&
          "v" in raw &&
          (raw as { v?: unknown }).v !== 1
        ) {
          noteFailure(segment.source, "unsupported-version", framed.inputBytes, lineNumber);
          return;
        }
        const parsed = LogRecordSchema.safeParse(raw);
        if (!parsed.success || !recordBelongsToSource(segment.source, parsed.data)) {
          noteFailure(segment.source, "invalid-record", framed.inputBytes, lineNumber);
          return;
        }
        if (diagnosticRecordMatches(parsed.data, query)) {
          records.push(parsed.data);
          if (records.length > query.limit * 2) {
            records.sort(compareRecords);
            records.splice(0, records.length - query.limit);
          }
        }
      },
    });

    const stream = handle.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
    });
    try {
      for await (const rawChunk of stream) {
        options.signal?.throwIfAborted();
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        const remaining = maxScanBytes - scannedBytes;
        if (remaining <= 0) {
          truncated = true;
          stream.destroy();
          break;
        }
        const accepted = chunk.subarray(0, remaining);
        scannedBytes += accepted.byteLength;
        framer.push(accepted);
        if (accepted.byteLength !== chunk.byteLength) {
          truncated = true;
          stream.destroy();
          break;
        }
      }
      flushingTail = true;
      framer.flush();
    } finally {
      stream.destroy();
      await handle.close();
    }

    // Segments are visited newest first. Once this entire segment supplied a
    // page, older segments cannot improve the bounded recent page.
    if (records.length >= query.limit) break;
  }

  records.sort(compareRecords);
  if (records.length > query.limit) records.splice(0, records.length - query.limit);
  return {
    records,
    failures,
    scannedBytes,
    scannedSegments,
    skippedUnsafeSegments: enumerated.skippedUnsafeSegments,
    truncated,
  };
}
