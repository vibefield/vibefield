import { createHash, randomBytes } from "node:crypto";
import { constants, createWriteStream, type Dirent } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { verifyAuditSegment } from "@vibefield/audit/verify";
import {
  type SupportBundleExportResultV1 as SupportBundleExportResult,
  SupportBundleExportResultV1,
  type SupportBundleManifestV1 as SupportBundleManifest,
  SupportBundleManifestV1,
  type SupportBundlePreviewV1 as SupportBundlePreview,
  SupportBundlePreviewV1,
  type SupportBundleSelectionV1 as SupportBundleSelection,
  SupportBundleSelectionV1,
} from "@vibefield/contracts/diagnostics";
import {
  ExportPseudonyms,
  type Logger,
  type LogSanitizerAliases,
  readLogHistory,
  sanitizeLogRecordForExport,
} from "@vibefield/logging";
import type { CrashArtifactExport, CrashArtifactManager } from "./crash-artifacts";

const SANITIZER_VERSION = "support-v1";
const PREVIEW_TTL_MS = 5 * 60 * 1_000;
const MAX_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_LOG_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_AUDIT_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_AUDIT_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 320 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 320 * 1024 * 1024;
const HISTORY_RECORDS_PER_SOURCE = 1_000;
const TAR_BLOCK_BYTES = 512;

const SECRET_KEYS =
  /(?:authorization|cookie|token|credential|password|secret|private.?key|api.?key|environment|^env(?:vars?|values?)?$|command.?line|approval.?input)/i;
const CANARY_PATTERN = /VIBEFIELD_(?:LOG|SUPPORT)_CANARY_[A-Za-z0-9_-]+/i;
const PRIVATE_KEY_HEADER = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i;
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const AUDIT_SEGMENT_NAME =
  /^(approvals|grants|plugins|own-actions)\.\d{4}-\d{2}\.[A-Za-z0-9_-]+(?:\.\d{4})?\.jsonl$/;

interface MemoryPlanFile {
  kind: "memory";
  path: string;
  category: "system" | "plugin" | "health" | "doctor" | "audit" | "manifest";
  bytes: number;
  sha256: string;
  data: Buffer;
}

interface ExternalPlanFile {
  kind: "external";
  path: string;
  category: "crash";
  bytes: number;
  sha256: string;
  sourcePath: string;
  artifactId: string;
}

type PlanFile = MemoryPlanFile | ExternalPlanFile;

interface BundlePlan {
  preview: SupportBundlePreview;
  files: PlanFile[];
  crashArtifactIds: string[];
}

export interface SupportBundleAuditContext {
  bundleId: string;
  rangeHours: number;
  sourceCount: number;
  pluginCount: number;
  crashCount: number;
  includesAudit: boolean;
}

export class SupportBundleError extends Error {
  constructor(
    readonly kind: "INTERNAL" | "NOT_FOUND" | "PRECONDITION_FAILED" | "RESOURCE_EXHAUSTED",
    message: string,
  ) {
    super(message);
    this.name = "SupportBundleError";
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function privateFlags(): number {
  return constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
}

function replacePathPrefixes(value: string, aliases: LogSanitizerAliases): string {
  if (PRIVATE_KEY_HEADER.test(value)) return "[redacted-private-key]";
  const replacements: Array<[string | undefined, string]> = [
    [aliases.home, "<home>"],
    [aliases.temp, "<temp>"],
    [aliases.logs, "<logs>"],
    [aliases.data, "<data>"],
  ];
  replacements.sort((left, right) => (right[0]?.length ?? 0) - (left[0]?.length ?? 0));
  let result = value.slice(0, 16 * 1024);
  for (const [prefix, replacement] of replacements) {
    if (prefix) result = result.split(prefix).join(replacement);
  }
  result = result
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
    .replace(
      /\b(token|credential|password|secret|private[_-]?key|api[_-]?key)\s*[:=]\s*[^\s,;]{8,}/gi,
      "$1=[redacted]",
    )
    .replace(/\/t\/[A-Za-z0-9_-]{16,}/g, "/t/[redacted]")
    .replace(new RegExp(CANARY_PATTERN.source, "gi"), "[redacted-canary]")
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, "<home>")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "<home>");
  return result.replace(URL_PATTERN, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.protocol}//${url.host}/<path-redacted>`;
    } catch {
      return "[redacted-url]";
    }
  });
}

function identityKind(key: string): string | null {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "pid" || normalized.endsWith("pid")) return "pid";
  if (normalized === "pluginid") return "plugin";
  if (normalized.endsWith("id") && normalized.length <= 48) {
    return normalized.slice(0, -2) || "id";
  }
  return null;
}

function scrubSupportValue(
  value: unknown,
  options: {
    aliases: LogSanitizerAliases;
    pseudonyms: ExportPseudonyms;
    key: string;
    depth?: number;
  },
): unknown {
  const depth = options.depth ?? 0;
  if (depth > 8) return "[truncated:depth]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[non-finite]";
  if (typeof value === "string") {
    const kind = identityKind(options.key);
    if (kind !== null) return options.pseudonyms.alias(kind, value);
    return replacePathPrefixes(value, options.aliases);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 1_000).map((entry) =>
      scrubSupportValue(entry, {
        ...options,
        depth: depth + 1,
      }),
    );
  }
  if (typeof value !== "object") return `[unsupported:${typeof value}]`;
  const result: Record<string, unknown> = {};
  let accepted = 0;
  for (const [key, child] of Object.entries(value)) {
    if (accepted >= 200) {
      result["truncatedKeys"] = true;
      break;
    }
    result[key.slice(0, 160)] = SECRET_KEYS.test(key)
      ? "[redacted]"
      : scrubSupportValue(child, {
          aliases: options.aliases,
          pseudonyms: options.pseudonyms,
          key,
          depth: depth + 1,
        });
    accepted += 1;
  }
  return result;
}

function memoryFile(
  path: string,
  category: MemoryPlanFile["category"],
  data: Buffer,
): MemoryPlanFile {
  return {
    kind: "memory",
    path,
    category,
    bytes: data.byteLength,
    sha256: sha256(data),
    data,
  };
}

async function hashPrivateFile(
  path: string,
  expectedMaxBytes: number,
): Promise<{ bytes: number; sha256: string }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, privateFlags());
    const info = await handle.stat();
    if (!info.isFile() || info.size > expectedMaxBytes) {
      throw new SupportBundleError(
        "RESOURCE_EXHAUSTED",
        "selected crash artifact exceeds the support bundle limit",
      );
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < info.size) {
      const length = Math.min(buffer.byteLength, info.size - position);
      const read = await handle.read(buffer, 0, length, position);
      if (read.bytesRead === 0) break;
      position += read.bytesRead;
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    if (position !== info.size) throw new Error("crash artifact changed while previewing");
    return { bytes: info.size, sha256: hash.digest("hex") };
  } catch (error) {
    if (["ENOENT", "ELOOP"].includes(errorCode(error) ?? "")) {
      throw new SupportBundleError("NOT_FOUND", "selected crash artifact is unavailable");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function writeString(target: Buffer, offset: number, length: number, value: string): void {
  target.write(value.slice(0, length), offset, length, "utf8");
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  const encoded = Math.max(0, Math.floor(value))
    .toString(8)
    .padStart(length - 1, "0")
    .slice(-(length - 1));
  target.write(`${encoded}\0`, offset, length, "ascii");
}

function tarHeader(path: string, bytes: number, mtime: number): Buffer {
  if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/.test(path)) {
    throw new SupportBundleError("PRECONDITION_FAILED", "unsafe support archive entry");
  }
  if (Buffer.byteLength(path, "utf8") > 100) {
    throw new SupportBundleError("PRECONDITION_FAILED", "support archive entry is too long");
  }
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  writeString(header, 0, 100, path);
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, bytes);
  writeOctal(header, 136, 12, Math.floor(mtime / 1_000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "vibefield");
  writeString(header, 297, 32, "vibefield");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encoded = checksum.toString(8).padStart(6, "0").slice(-6);
  header.write(`${encoded}\0 `, 148, 8, "ascii");
  return header;
}

function padding(bytes: number): Buffer | null {
  const remainder = bytes % TAR_BLOCK_BYTES;
  return remainder === 0 ? null : Buffer.alloc(TAR_BLOCK_BYTES - remainder);
}

async function* tarEntries(
  files: readonly PlanFile[],
  mtime: number,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  for (const file of files) {
    signal?.throwIfAborted();
    yield tarHeader(file.path, file.bytes, mtime);
    if (file.kind === "memory") {
      yield file.data;
    } else {
      const handle = await open(file.sourcePath, privateFlags());
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size !== file.bytes) {
          throw new SupportBundleError(
            "PRECONDITION_FAILED",
            "crash artifact changed after preview",
          );
        }
        const hash = createHash("sha256");
        let seen = 0;
        const stream = handle.createReadStream({
          autoClose: false,
          highWaterMark: 64 * 1024,
        });
        try {
          for await (const raw of stream) {
            signal?.throwIfAborted();
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            seen += chunk.byteLength;
            if (seen > file.bytes) {
              throw new SupportBundleError(
                "PRECONDITION_FAILED",
                "crash artifact grew after preview",
              );
            }
            hash.update(chunk);
            yield chunk;
          }
        } finally {
          stream.destroy();
        }
        if (seen !== file.bytes || hash.digest("hex") !== file.sha256) {
          throw new SupportBundleError(
            "PRECONDITION_FAILED",
            "crash artifact changed after preview",
          );
        }
      } finally {
        await handle.close();
      }
    }
    const pad = padding(file.bytes);
    if (pad !== null) yield pad;
  }
  yield Buffer.alloc(TAR_BLOCK_BYTES * 2);
}

async function writeArchive(
  path: string,
  files: readonly PlanFile[],
  mtime: number,
  signal?: AbortSignal,
): Promise<number> {
  const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
  try {
    await pipeline(
      Readable.from(tarEntries(files, mtime, signal)),
      createGzip({ level: 6 }),
      output,
      ...(signal !== undefined ? [{ signal }] : []),
    );
  } catch (error) {
    output.destroy();
    await unlink(path).catch(() => undefined);
    throw error;
  }
  await chmod(path, 0o600);
  const info = await stat(path);
  if (info.size > MAX_ARCHIVE_BYTES) {
    await unlink(path).catch(() => undefined);
    throw new SupportBundleError("RESOURCE_EXHAUSTED", "support archive exceeds its size cap");
  }
  return info.size;
}

async function commitArchive(staging: string, destination: string): Promise<void> {
  if (!isAbsolute(destination)) {
    throw new SupportBundleError("PRECONDITION_FAILED", "support destination must be absolute");
  }
  let existing = false;
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new SupportBundleError(
        "PRECONDITION_FAILED",
        "support destination is not a regular file",
      );
    }
    existing = true;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const parent = dirname(destination);
  const token = randomBytes(8).toString("hex");
  const partial = join(parent, `.${basename(destination)}.${token}.partial`);
  const backup = join(parent, `.${basename(destination)}.${token}.backup`);
  await copyFile(staging, partial, constants.COPYFILE_EXCL);
  await chmod(partial, 0o600);
  const partialHandle = await open(partial, "r+");
  try {
    await partialHandle.sync();
  } finally {
    await partialHandle.close();
  }
  let backedUp = false;
  try {
    if (existing) {
      await rename(destination, backup);
      backedUp = true;
    }
    await rename(partial, destination);
    await chmod(destination, 0o600);
    if (backedUp) await unlink(backup);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    if (backedUp) {
      await rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }
}

export class SupportBundleService {
  private readonly stagingRoot: string;
  private readonly now: () => number;
  private operation: Promise<void> = Promise.resolve();
  private initialized = false;
  private plan: BundlePlan | null = null;
  private planTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      dataRoot: string;
      logRoot: string;
      crashArtifacts: CrashArtifactManager;
      logger: Logger;
      aliases: LogSanitizerAliases;
      versions: Record<string, string>;
      collectContext?: () => Promise<unknown>;
      now?: () => number;
    },
  ) {
    this.stagingRoot = join(options.dataRoot, "exports", ".staging");
    this.now = options.now ?? Date.now;
  }

  initialize(): Promise<void> {
    return this.serial(async () => {
      if (this.initialized) return;
      await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
      await chmod(this.stagingRoot, 0o700);
      const entries = await readdir(this.stagingRoot, { withFileTypes: true });
      let removed = 0;
      for (const entry of entries) {
        if (!/^bundle-[A-Za-z0-9_-]+\.partial\.tar\.gz$/.test(entry.name)) continue;
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        try {
          await unlink(join(this.stagingRoot, entry.name));
          removed += 1;
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
      if (removed > 0) {
        this.options.logger.info(
          "desktop.support.staging_cleaned",
          "Electron removed interrupted support bundle staging files",
          { removed },
        );
      }
      this.initialized = true;
    });
  }

  preview(raw: unknown, signal?: AbortSignal): Promise<SupportBundlePreview> {
    return this.serial(async () => {
      this.requireInitialized();
      const parsed = SupportBundleSelectionV1.safeParse(raw);
      if (!parsed.success) {
        throw new SupportBundleError(
          "PRECONDITION_FAILED",
          "expected a valid bounded support bundle selection",
        );
      }
      const selection = parsed.data;
      if (selection.range.to > this.now() + 60_000) {
        throw new SupportBundleError(
          "PRECONDITION_FAILED",
          "support range cannot extend into the future",
        );
      }
      const plan = await this.buildPlan(selection, signal);
      this.setPlan(plan);
      return plan.preview;
    });
  }

  export(
    previewId: string,
    destination: string,
    signal?: AbortSignal,
  ): Promise<SupportBundleExportResult> {
    return this.serial(async () => {
      this.requireInitialized();
      const plan = this.plan;
      if (plan === null || plan.preview.previewId !== previewId) {
        throw new SupportBundleError("NOT_FOUND", "support preview is unavailable");
      }
      if (plan.preview.expiresAt <= this.now()) {
        this.clearPlan();
        throw new SupportBundleError("PRECONDITION_FAILED", "support preview expired");
      }
      const staging = join(
        this.stagingRoot,
        `bundle-${plan.preview.manifest.bundleId}.partial.tar.gz`,
      );
      const resolvedStaging = `${resolve(this.stagingRoot)}${sep}`;
      if (resolve(destination).startsWith(resolvedStaging)) {
        throw new SupportBundleError(
          "PRECONDITION_FAILED",
          "support destination cannot be inside staging",
        );
      }
      let archiveBytes = 0;
      try {
        archiveBytes = await writeArchive(
          staging,
          plan.files,
          plan.preview.manifest.createdAt,
          signal,
        );
        await commitArchive(staging, destination);
      } finally {
        await unlink(staging).catch(() => undefined);
      }
      await this.options.crashArtifacts.markExported(plan.crashArtifactIds);
      this.options.logger.info(
        "desktop.support.bundle_exported",
        "The user exported a local support bundle",
        {
          bundleId: plan.preview.manifest.bundleId,
          from: plan.preview.manifest.range.from,
          to: plan.preview.manifest.range.to,
          sources: plan.preview.manifest.sources,
          pluginCount: plan.preview.manifest.pluginAliases.length,
          crashCount: plan.preview.manifest.crashArtifacts.length,
          archiveBytes,
        },
      );
      this.clearPlan();
      return SupportBundleExportResultV1.parse({
        v: 1,
        status: "exported",
        bundleId: plan.preview.manifest.bundleId,
        archiveBytes,
      });
    });
  }

  auditContext(previewId: string): SupportBundleAuditContext {
    this.requireInitialized();
    const plan = this.plan;
    if (plan === null || plan.preview.previewId !== previewId) {
      throw new SupportBundleError("NOT_FOUND", "support preview is unavailable");
    }
    if (plan.preview.expiresAt <= this.now()) {
      this.clearPlan();
      throw new SupportBundleError("PRECONDITION_FAILED", "support preview expired");
    }
    return {
      bundleId: plan.preview.manifest.bundleId,
      rangeHours: Math.ceil(
        (plan.preview.manifest.range.to - plan.preview.manifest.range.from) / (60 * 60 * 1_000),
      ),
      sourceCount: plan.preview.manifest.sources.length,
      pluginCount: plan.preview.manifest.pluginAliases.length,
      crashCount: plan.preview.manifest.crashArtifacts.length,
      includesAudit: plan.preview.manifest.includesAudit,
    };
  }

  cancelled(previewId: string): SupportBundleExportResult {
    const matches = this.plan?.preview.previewId === previewId;
    const bundleId = matches
      ? (this.plan?.preview.manifest.bundleId ?? "bundle-cancelled")
      : "bundle-cancelled";
    if (matches) this.clearPlan();
    return SupportBundleExportResultV1.parse({
      v: 1,
      status: "cancelled",
      bundleId,
    });
  }

  private async buildPlan(
    selection: SupportBundleSelection,
    signal?: AbortSignal,
  ): Promise<BundlePlan> {
    const pseudonyms = new ExportPseudonyms();
    const files: PlanFile[] = [];
    let scannedBytes = 0;
    let logPayloadBytes = 0;
    let omittedRecords = 0;
    let truncatedRecords = 0;

    const collectLogFile = async (
      source: SupportBundleSelection["sources"][number],
      path: string,
      pluginId?: string,
    ): Promise<void> => {
      signal?.throwIfAborted();
      const remainingScan = MAX_SCAN_BYTES - scannedBytes;
      if (remainingScan <= 0) {
        truncatedRecords += 1;
        return;
      }
      const page = await readLogHistory({
        logRoot: this.options.logRoot,
        query: {
          sources: [source],
          sinceTime: selection.range.from,
          ...(pluginId !== undefined ? { pluginId } : {}),
          limit: HISTORY_RECORDS_PER_SOURCE,
        },
        maxScanBytes: remainingScan,
        ...(signal !== undefined ? { signal } : {}),
      });
      scannedBytes += page.scannedBytes;
      omittedRecords += page.failures.length;
      if (page.truncated || page.records.length === HISTORY_RECORDS_PER_SOURCE) {
        truncatedRecords += 1;
      }
      const lines: Buffer[] = [];
      let bytes = 0;
      for (const raw of page.records) {
        if (raw.time > selection.range.to) continue;
        const sanitized = sanitizeLogRecordForExport(raw, {
          aliases: this.options.aliases,
          pseudonyms,
          maxRecordBytes: source.startsWith("plugins/") ? 16 * 1024 : 64 * 1024,
        });
        if (sanitized.omitted || sanitized.record === null) {
          omittedRecords += 1;
          continue;
        }
        if (sanitized.truncated) truncatedRecords += 1;
        const line = Buffer.from(`${JSON.stringify(sanitized.record)}\n`, "utf8");
        if (logPayloadBytes + bytes + line.byteLength > MAX_LOG_PAYLOAD_BYTES) {
          truncatedRecords += 1;
          break;
        }
        lines.push(line);
        bytes += line.byteLength;
      }
      const data = Buffer.concat(lines, bytes);
      logPayloadBytes += data.byteLength;
      files.push(memoryFile(path, source.startsWith("plugins/") ? "plugin" : "system", data));
    };

    for (const source of selection.sources) {
      if (source.startsWith("plugins/")) {
        const entry = source.slice("plugins/".length);
        for (const pluginId of selection.pluginIds) {
          const alias = pseudonyms.alias("plugin", pluginId);
          await collectLogFile(source, `logs/plugins/${alias}/${entry}.ndjson`, pluginId);
        }
      } else {
        await collectLogFile(source, `logs/system/${source.slice("system/".length)}.ndjson`);
      }
    }

    if (selection.includeAudit) {
      const auditRoot = join(this.options.dataRoot, "audit");
      let entries: Dirent<string>[];
      try {
        const rootInfo = await lstat(auditRoot);
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
          throw new SupportBundleError(
            "PRECONDITION_FAILED",
            "the audit ledger root is not a safe directory",
          );
        }
        entries = await readdir(auditRoot, { withFileTypes: true });
      } catch (error) {
        if (isNotFound(error)) {
          throw new SupportBundleError("NOT_FOUND", "audit evidence is unavailable");
        }
        throw error;
      }
      const byLedger = new Map<string, Buffer[]>();
      let auditScanBytes = 0;
      let auditPayloadBytes = 0;
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        signal?.throwIfAborted();
        const match = AUDIT_SEGMENT_NAME.exec(entry.name);
        if (match === null) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) {
          omittedRecords += 1;
          continue;
        }
        const remainingScan = MAX_AUDIT_SCAN_BYTES - auditScanBytes;
        if (remainingScan <= 0) {
          truncatedRecords += 1;
          break;
        }
        const verified = await verifyAuditSegment(join(auditRoot, entry.name), remainingScan);
        auditScanBytes += Math.min(verified.bytes, remainingScan);
        if (!verified.valid) {
          omittedRecords += Math.max(1, verified.records.length);
          if (verified.reason === "scan-cap") truncatedRecords += 1;
          continue;
        }
        const ledger = match[1] as string;
        const lines = byLedger.get(ledger) ?? [];
        for (const record of verified.records) {
          if (record.time < selection.range.from || record.time > selection.range.to) continue;
          const { integrity: _integrity, ...projected } = record;
          const scrubbed = scrubSupportValue(projected, {
            aliases: this.options.aliases,
            pseudonyms,
            key: "auditRecord",
          });
          const line = Buffer.from(`${JSON.stringify(scrubbed)}\n`, "utf8");
          if (auditPayloadBytes + line.byteLength > MAX_AUDIT_PAYLOAD_BYTES) {
            truncatedRecords += 1;
            break;
          }
          lines.push(line);
          auditPayloadBytes += line.byteLength;
        }
        byLedger.set(ledger, lines);
      }
      scannedBytes += auditScanBytes;
      for (const [ledger, lines] of byLedger) {
        const bytes = lines.reduce((total, line) => total + line.byteLength, 0);
        files.push(memoryFile(`audit/${ledger}.jsonl`, "audit", Buffer.concat(lines, bytes)));
      }
    }

    const context = await this.options.collectContext?.();
    const runtime = scrubSupportValue(
      {
        versions: this.options.versions,
        context: context ?? { state: "unavailable" },
      },
      {
        aliases: this.options.aliases,
        pseudonyms,
        key: "runtime",
      },
    );
    const runtimeData = Buffer.from(`${JSON.stringify(runtime, null, 2)}\n`, "utf8");
    if (CANARY_PATTERN.test(runtimeData.toString("utf8"))) {
      omittedRecords += 1;
    } else {
      files.push(memoryFile("health/runtime.json", "health", runtimeData));
    }
    const doctor = scrubSupportValue(
      { state: "unavailable", reason: "no host doctor surface is registered" },
      {
        aliases: this.options.aliases,
        pseudonyms,
        key: "doctor",
      },
    );
    files.push(
      memoryFile(
        "doctor/status.json",
        "doctor",
        Buffer.from(`${JSON.stringify(doctor, null, 2)}\n`, "utf8"),
      ),
    );

    const selectedCrashes: CrashArtifactExport[] =
      selection.crashArtifactIds.length > 0
        ? await this.options.crashArtifacts.selectArtifacts(selection.crashArtifactIds)
        : [];
    const crashAliases: string[] = [];
    for (const selected of selectedCrashes) {
      signal?.throwIfAborted();
      const alias = pseudonyms.alias("crash", selected.artifact.artifactId);
      const hashed = await hashPrivateFile(selected.path, MAX_UNCOMPRESSED_BYTES);
      crashAliases.push(alias);
      files.push({
        kind: "external",
        path: `crash/${alias}.dmp`,
        category: "crash",
        bytes: hashed.bytes,
        sha256: hashed.sha256,
        sourcePath: selected.path,
        artifactId: selected.artifact.artifactId,
      });
    }

    const totalPayloadBytes = files.reduce((total, file) => total + file.bytes, 0);
    if (totalPayloadBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new SupportBundleError(
        "RESOURCE_EXHAUSTED",
        "support bundle exceeds its uncompressed size cap",
      );
    }
    const bundleId = `bundle-${randomBytes(12).toString("base64url")}`;
    const createdAt = this.now();
    const versions: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.options.versions).slice(0, 64)) {
      versions[key.slice(0, 64)] = replacePathPrefixes(String(value), this.options.aliases).slice(
        0,
        128,
      );
    }
    const manifest: SupportBundleManifest = SupportBundleManifestV1.parse({
      v: 1,
      bundleId,
      createdAt,
      range: selection.range,
      sources: selection.sources,
      pluginAliases: pseudonyms.values("plugin"),
      includesAudit: selection.includeAudit,
      crashArtifacts: crashAliases,
      sanitizerVersion: SANITIZER_VERSION,
      omittedRecords,
      truncatedRecords,
      files: files.map((file) => ({
        path: file.path,
        category: file.category,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
      totalBytes: totalPayloadBytes,
      versions,
    });
    const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    files.push(memoryFile("manifest.json", "manifest", manifestData));
    const estimatedUncompressedBytes = totalPayloadBytes + manifestData.byteLength;
    const warnings = [
      "Support bundles can still contain sensitive local diagnostic context.",
      ...(selection.pluginIds.length > 0
        ? ["Selected plugin logs are included under pseudonymous plugin aliases."]
        : []),
      ...(selectedCrashes.length > 0
        ? ["Selected crash dumps are binary and may contain sensitive process memory."]
        : []),
      ...(selection.includeAudit
        ? [
            "Selected audit records are included as a second-scrubbed projection; integrity fields are omitted.",
          ]
        : []),
      ...(omittedRecords > 0 || truncatedRecords > 0
        ? ["Some records were omitted or truncated; see the manifest counters."]
        : []),
    ];
    const previewId = `preview-${randomBytes(12).toString("base64url")}`;
    const preview = SupportBundlePreviewV1.parse({
      v: 1,
      previewId,
      expiresAt: createdAt + PREVIEW_TTL_MS,
      estimatedUncompressedBytes,
      estimatedArchiveBytes: estimatedUncompressedBytes,
      manifest,
      warnings,
    });
    return {
      preview,
      files,
      crashArtifactIds: selectedCrashes.map((selected) => selected.artifact.artifactId),
    };
  }

  private requireInitialized(): void {
    if (!this.initialized)
      throw new SupportBundleError("INTERNAL", "support exporter is not ready");
  }

  private setPlan(plan: BundlePlan): void {
    this.clearPlan();
    this.plan = plan;
    const delay = Math.min(Math.max(1, plan.preview.expiresAt - this.now()), 2_147_483_647);
    this.planTimer = setTimeout(() => {
      this.planTimer = null;
      if (this.plan?.preview.previewId === plan.preview.previewId) this.plan = null;
    }, delay);
    this.planTimer.unref();
  }

  private clearPlan(): void {
    if (this.planTimer !== null) clearTimeout(this.planTimer);
    this.planTimer = null;
    this.plan = null;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operation.then(task, task);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
