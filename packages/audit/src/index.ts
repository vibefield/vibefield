import { createHash, type Hash } from "node:crypto";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AuditRecordV1 as AuditRecordSchemaV1,
  type AuditRecordV1,
  type AuditTargetV1,
} from "@vibefield/contracts/diagnostics";
import type { LogAttributesV1 } from "@vibefield/contracts/logging";
import { type AuditRecordBase, auditChainHash, MAX_AUDIT_RECORD_BYTES } from "./model";

export {
  type AuditRecordBase,
  auditChainHash,
  canonicalAuditJson,
  MAX_AUDIT_RECORD_BYTES,
} from "./model";
export { type AuditIntegrityResult, verifyAuditSegment } from "./verify";

export const AUDIT_LEDGERS = ["approvals", "grants", "plugins", "own-actions"] as const;
export type AuditLedger = (typeof AUDIT_LEDGERS)[number];

export const MAX_AUDIT_ATTR_BYTES = 8 * 1024;
const UNCOMPUTED_AUDIT_HASH = "0".repeat(64);

const SECRET_KEY =
  /(?:authorization|cookie|token(?!id$)|credential|password|secret|private.?key|api.?key|environment|^env(?:vars?|values?)?$|command.?line|approval.?input)/i;
const SECRET_VALUE = [
  /\btok_[0-9a-f]{24,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\/t\/[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export interface AuditPathAliases {
  home?: string;
  temp?: string;
  logs?: string;
  data?: string;
}

export type AuditWriterOperation = "root" | "open" | "write" | "sync" | "checkpoint" | "close";

export interface AuditWriterTestHooks {
  beforeRoot?: (auditRoot: string) => void | Promise<void>;
  beforeOpen?: (path: string) => void | Promise<void>;
  beforeWrite?: (path: string, bytes: number) => void | Promise<void>;
  beforeSync?: (path: string) => void | Promise<void>;
  beforeDirectorySync?: (path: string) => void | Promise<void>;
  beforeCheckpoint?: (path: string) => void | Promise<void>;
}

export interface AuditLedgerWriterOptions {
  dataDir: string;
  bootId: string;
  now?: () => number;
  hooks?: AuditWriterTestHooks;
}

interface Segment {
  ledger: AuditLedger;
  period: string;
  path: string;
  handle: FileHandle;
  fileHash: Hash;
  firstHash: string | null;
  lastHash: string | null;
  records: number;
  bytes: number;
}

export class AuditWriterError extends Error {
  constructor(
    readonly operation: AuditWriterOperation,
    readonly code: string,
    readonly cause: unknown,
  ) {
    super(`audit writer ${operation} failed`);
    this.name = "AuditWriterError";
  }
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 64);
  }
  return error instanceof Error && error.name !== "" ? error.name.slice(0, 64) : "UNKNOWN";
}

function utcPeriod(time: number): string {
  return new Date(time).toISOString().slice(0, 7);
}

function safeBootId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
}

export function auditLedgerForAction(action: string): AuditLedger {
  if (action.startsWith("approval.")) return "approvals";
  if (action.startsWith("capability.") || action.startsWith("token.")) return "grants";
  if (action.startsWith("plugin.")) return "plugins";
  return "own-actions";
}

function containsSecret(value: string): boolean {
  return SECRET_VALUE.some((pattern) => pattern.test(value));
}

function replacePrivateText(value: string, aliases: AuditPathAliases | undefined): string {
  let result = value.slice(0, 1_024);
  const replacements: Array<[string | undefined, string]> = [
    [aliases?.home, "<home>"],
    [aliases?.temp, "<temp>"],
    [aliases?.logs, "<logs>"],
    [aliases?.data, "<data>"],
  ];
  replacements.sort((left, right) => (right[0]?.length ?? 0) - (left[0]?.length ?? 0));
  for (const [prefix, replacement] of replacements) {
    if (prefix) result = result.split(prefix).join(replacement);
  }
  result = result
    .replace(/\btok_[0-9a-f]{24,}\b/gi, "[redacted-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
    .replace(/\/t\/[A-Za-z0-9_-]{16,}/g, "/t/[redacted]")
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[redacted-private-key]",
    );
  return result.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted-url]");
}

function sanitizeValue(
  value: unknown,
  aliases: AuditPathAliases | undefined,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[non-finite]";
  if (typeof value === "string") return replacePrivateText(value, aliases);
  if (typeof value !== "object") return `[unsupported:${typeof value}]`;
  if (depth >= 4) return "[truncated:depth]";
  if (ancestors.has(value)) return "[circular]";
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < Math.min(value.length, 32); index += 1) {
        const descriptor = descriptors[String(index)];
        result.push(
          descriptor && "value" in descriptor
            ? sanitizeValue(descriptor.value, aliases, depth + 1, ancestors)
            : "[sparse]",
        );
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[unsupported:object]";
    const result: Record<string, unknown> = Object.create(null);
    let accepted = 0;
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) continue;
      if (["__proto__", "constructor", "prototype"].includes(key) || SECRET_KEY.test(key)) continue;
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) continue;
      if (accepted >= 32) break;
      result[key] = sanitizeValue(descriptor.value, aliases, depth + 1, ancestors);
      accepted += 1;
    }
    return result;
  } catch {
    return "[unavailable]";
  } finally {
    ancestors.delete(value);
  }
}

export function sanitizeAuditAttrs(
  attrs: Readonly<Record<string, unknown>> | undefined,
  aliases: AuditPathAliases | undefined,
): LogAttributesV1 | undefined {
  if (attrs === undefined) return undefined;
  const sanitized = sanitizeValue(attrs, aliases);
  if (sanitized === null || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return undefined;
  }
  const result = sanitized as Record<string, unknown>;
  const keys = Object.keys(result);
  while (
    keys.length > 0 &&
    Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_AUDIT_ATTR_BYTES
  ) {
    const key = keys.pop();
    if (key !== undefined) delete result[key];
  }
  return Object.keys(result).length > 0 ? (result as LogAttributesV1) : undefined;
}

function assertSafeIdentity(value: string, field: string): void {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (hasControlCharacter || containsSecret(value)) {
    throw new TypeError(`${field} contains forbidden credential-like material`);
  }
}

export function cleanAuditTarget(target: AuditTargetV1): AuditTargetV1 {
  assertSafeIdentity(target.id, "audit target id");
  if (target.parentId !== undefined) assertSafeIdentity(target.parentId, "audit parent id");
  return {
    kind: target.kind,
    id: target.id,
    ...(target.parentId !== undefined ? { parentId: target.parentId } : {}),
  };
}

function parsePersistedAuditBase(base: AuditRecordBase): AuditRecordBase {
  // Parse exactly once before choosing the ledger or hashing. The placeholder
  // satisfies the wire shape and is discarded; the returned object is the
  // exact post-schema representation that will be persisted.
  const parsed = AuditRecordSchemaV1.parse({
    ...base,
    integrity: {
      algorithm: "sha256-chain-v1",
      previousHash: null,
      recordHash: UNCOMPUTED_AUDIT_HASH,
    },
  });
  const { integrity: _placeholder, ...persistedBase } = parsed;
  // AuditRecordV1 is passthrough, whose index signature makes TypeScript's
  // Omit lose its named keys. The runtime object still retains every parsed
  // passthrough field; this cast restores the narrower required base shape.
  return persistedBase as unknown as AuditRecordBase;
}

export class AuditLedgerWriter {
  readonly root: string;
  private readonly now: () => number;
  private readonly bootId: string;
  private readonly segments = new Map<AuditLedger, Segment>();
  private readonly sequences = new Map<string, number>();
  private rootReady = false;
  private closed = false;

  constructor(private readonly options: AuditLedgerWriterOptions) {
    this.root = join(options.dataDir, "audit");
    this.now = options.now ?? Date.now;
    this.bootId = safeBootId(options.bootId);
  }

  async initialize(): Promise<void> {
    await this.ensureRoot();
  }

  async append(base: AuditRecordBase): Promise<{ record: AuditRecordV1; bytes: number }> {
    if (this.closed) throw new AuditWriterError("write", "CLOSED", new Error("writer closed"));
    const persistedBase = parsePersistedAuditBase(base);
    const ledger = auditLedgerForAction(persistedBase.action);
    const segment = await this.segment(ledger, utcPeriod(persistedBase.time));
    const recordHash = auditChainHash(persistedBase, segment.lastHash);
    const record: AuditRecordV1 = {
      ...persistedBase,
      integrity: {
        algorithm: "sha256-chain-v1",
        previousHash: segment.lastHash,
        recordHash,
      },
    };
    const line = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    if (line.byteLength > MAX_AUDIT_RECORD_BYTES) {
      throw new AuditWriterError(
        "write",
        "RECORD_TOO_LARGE",
        new Error("bounded audit record exceeds its byte cap"),
      );
    }
    try {
      await this.options.hooks?.beforeWrite?.(segment.path, line.byteLength);
      await this.writeAll(segment, line);
    } catch (error) {
      await this.abandon(segment);
      throw error instanceof AuditWriterError
        ? error
        : new AuditWriterError("write", errorCode(error), error);
    }
    try {
      await this.options.hooks?.beforeSync?.(segment.path);
      await segment.handle.sync();
    } catch (error) {
      await this.abandon(segment);
      throw error instanceof AuditWriterError
        ? error
        : new AuditWriterError("sync", errorCode(error), error);
    }
    segment.fileHash.update(line);
    segment.firstHash ??= recordHash;
    segment.lastHash = recordHash;
    segment.records += 1;
    segment.bytes += line.byteLength;
    return { record, bytes: line.byteLength };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    let failure: unknown;
    for (const segment of [...this.segments.values()]) {
      try {
        await this.closeSegment(segment);
      } catch (error) {
        failure ??= error;
      }
    }
    this.segments.clear();
    if (failure !== undefined) throw failure;
  }

  openSegments(): number {
    return this.segments.size;
  }

  private async ensureRoot(): Promise<void> {
    if (this.rootReady) return;
    try {
      await this.options.hooks?.beforeRoot?.(this.root);
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("audit root is not a private regular directory");
      }
      await chmod(this.root, 0o700);
      await this.syncDirectory(this.root);
      await this.syncDirectory(dirname(this.root));
      this.rootReady = true;
    } catch (error) {
      if (error instanceof AuditWriterError) throw error;
      throw new AuditWriterError("root", errorCode(error), error);
    }
  }

  private async segment(ledger: AuditLedger, period: string): Promise<Segment> {
    await this.ensureRoot();
    const current = this.segments.get(ledger);
    if (current?.period === period) return current;
    if (current !== undefined) {
      await this.closeSegment(current);
      this.segments.delete(ledger);
    }
    const sequenceKey = `${ledger}\0${period}`;
    let sequence = this.sequences.get(sequenceKey) ?? 0;
    for (let attempts = 0; attempts < 10_000; attempts += 1) {
      const sequencePart = sequence === 0 ? "" : `.${String(sequence).padStart(4, "0")}`;
      const path = join(this.root, `${ledger}.${period}.${this.bootId}${sequencePart}.jsonl`);
      try {
        await this.options.hooks?.beforeOpen?.(path);
        const flags =
          constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_APPEND |
          (constants.O_NOFOLLOW ?? 0);
        const handle = await open(path, flags, 0o600);
        try {
          await handle.chmod(0o600);
          await handle.sync();
          await this.syncDirectory(this.root);
        } catch (error) {
          await handle.close().catch(() => undefined);
          throw error instanceof AuditWriterError
            ? error
            : new AuditWriterError("sync", errorCode(error), error);
        }
        const segment: Segment = {
          ledger,
          period,
          path,
          handle,
          fileHash: createHash("sha256"),
          firstHash: null,
          lastHash: null,
          records: 0,
          bytes: 0,
        };
        this.segments.set(ledger, segment);
        this.sequences.set(sequenceKey, sequence + 1);
        return segment;
      } catch (error) {
        if (errorCode(error) === "EEXIST") {
          sequence += 1;
          continue;
        }
        if (error instanceof AuditWriterError) throw error;
        throw new AuditWriterError("open", errorCode(error), error);
      }
    }
    throw new AuditWriterError("open", "NAME_EXHAUSTED", new Error("segment names exhausted"));
  }

  private async writeAll(segment: Segment, line: Buffer): Promise<void> {
    let offset = 0;
    while (offset < line.byteLength) {
      try {
        const result = await segment.handle.write(line, offset, line.byteLength - offset, null);
        if (result.bytesWritten <= 0) throw new Error("audit write made no progress");
        offset += result.bytesWritten;
      } catch (error) {
        throw new AuditWriterError("write", errorCode(error), error);
      }
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    // Node cannot open directory handles with the flags Windows requires.
    // File fsync + atomic rename remain in force there; installed Windows
    // durability and ACL behavior are proven by the separate packaged gate.
    if (process.platform === "win32") return;
    let handle: FileHandle | null = null;
    let failure: unknown;
    try {
      await this.options.hooks?.beforeDirectorySync?.(path);
      handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
      await handle.sync();
    } catch (error) {
      failure = error;
    }
    try {
      await handle?.close();
    } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined) {
      throw new AuditWriterError("sync", errorCode(failure), failure);
    }
  }

  private async abandon(segment: Segment): Promise<void> {
    this.segments.delete(segment.ledger);
    try {
      await segment.handle.close();
    } catch {
      // The failed immutable segment is preserved. The next append gets a new
      // sequence, so a partial tail is never silently continued.
    }
  }

  private async closeSegment(segment: Segment): Promise<void> {
    this.segments.delete(segment.ledger);
    try {
      await this.options.hooks?.beforeSync?.(segment.path);
      await segment.handle.sync();
      await segment.handle.close();
    } catch (error) {
      try {
        await segment.handle.close();
      } catch {
        // Preserve the first close failure.
      }
      throw new AuditWriterError("close", errorCode(error), error);
    }
    if (segment.records === 0) return;
    const checkpointPath = `${segment.path}.integrity.json`;
    const partialPath = `${checkpointPath}.partial`;
    let handle: FileHandle | null = null;
    try {
      const checkpoint = {
        v: 1,
        algorithm: "sha256-chain-v1",
        ledger: segment.ledger,
        period: segment.period,
        bootId: this.bootId,
        records: segment.records,
        bytes: segment.bytes,
        firstHash: segment.firstHash,
        lastHash: segment.lastHash,
        fileSha256: segment.fileHash.digest("hex"),
        closedAt: this.now(),
      };
      await this.options.hooks?.beforeCheckpoint?.(checkpointPath);
      const flags =
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
      handle = await open(partialPath, flags, 0o600);
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(checkpoint)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(partialPath, checkpointPath);
      await this.syncDirectory(this.root);
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // The checkpoint failure is reported below.
      }
      await unlink(partialPath).catch(() => undefined);
      throw new AuditWriterError("checkpoint", errorCode(error), error);
    }
  }
}
