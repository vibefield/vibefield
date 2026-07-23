import type { FileHandle } from "node:fs/promises";
import { chmod, lstat, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LogRetentionPolicy, NodeLoggingTestHooks } from "./types";

export type WriterOperation = "open" | "write" | "rename" | "flush" | "close";

export class WriterOperationError extends Error {
  constructor(
    readonly operation: WriterOperation,
    readonly cause: unknown,
  ) {
    super(`log writer ${operation} failed`);
    this.name = "WriterOperationError";
  }
}

export class WriterConflictError extends Error {
  readonly code = "WRITER_CONFLICT";

  constructor(readonly lockPath: string) {
    super(`log stream already has a live writer: ${lockPath}`);
    this.name = "WriterConflictError";
  }
}

export class SegmentAppendError extends Error {
  constructor(
    message: string,
    readonly result: SegmentAppendResult,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = "SegmentAppendError";
  }

  get completedRecords(): number {
    return this.result.records;
  }
}

export interface SegmentAppendResult {
  records: number;
  bytes: number;
  rotations: number;
  cleanupDeletions: number;
}

export interface SegmentWriterOptions {
  logRoot: string;
  stream: string;
  bootId: string;
  now: () => number;
  retention: LogRetentionPolicy;
  hooks?: NodeLoggingTestHooks;
}

class PartialWriteError extends Error {
  constructor(
    readonly bytesWritten: number,
    readonly cause: unknown,
  ) {
    super("log write stopped after a partial block");
    this.name = "PartialWriteError";
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function closedStamp(time: number): string {
  return new Date(time).toISOString().replace(/[-:.]/g, "");
}

function safeBootId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
}

function isClosedSegment(name: string): boolean {
  return /^[a-z][a-z0-9-]*\.\d{8}T\d{9}Z\.[A-Za-z0-9_-]+\.\d{4}\.(?:size|utc-day|partial-recovery)\.ndjson$/.test(
    name,
  );
}

async function pidIsAlive(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

export class SegmentWriter {
  readonly categoryDir: string;
  readonly activePath: string;
  readonly lockPath: string;

  private active: FileHandle | null = null;
  private lock: FileHandle | null = null;
  private activeBytes = 0;
  private activeDay = "";
  private rotationSequence = 0;

  constructor(private readonly options: SegmentWriterOptions) {
    const [category, streamName, ...rest] = options.stream.split("/");
    if (
      !category ||
      !streamName ||
      rest.length > 0 ||
      !/^[a-z][a-z0-9-]*$/.test(category) ||
      !/^[a-z][a-z0-9-]*$/.test(streamName)
    ) {
      throw new Error("invalid registered log stream");
    }
    this.categoryDir = join(options.logRoot, category);
    this.activePath = join(this.categoryDir, `${streamName}.ndjson`);
    this.lockPath = `${this.activePath}.lock`;
  }

  get bytes(): number {
    return this.activeBytes;
  }

  get isOpen(): boolean {
    return this.active !== null;
  }

  async open(): Promise<void> {
    if (this.active) return;
    try {
      await mkdir(this.options.logRoot, { recursive: true, mode: 0o700 });
      await this.assertSafeDirectory(this.options.logRoot);
      await chmod(this.options.logRoot, 0o700);
      await mkdir(this.categoryDir, { recursive: true, mode: 0o700 });
      await this.assertSafeDirectory(this.categoryDir);
      await chmod(this.categoryDir, 0o700);
      if (!this.lock) await this.acquireLock();
      await this.rejectUnsafeActivePath();
      await this.options.hooks?.beforeOpen?.(this.activePath);
      this.active = await open(this.activePath, "a+", 0o600);
      await chmod(this.activePath, 0o600);
      const details = await this.active.stat();
      this.activeBytes = details.size;
      this.activeDay = utcDay(details.size > 0 ? details.mtimeMs : this.options.now());
      if (details.size > 0 && !(await this.endsWithNewline())) {
        await this.rotate("partial-recovery");
      }
    } catch (error) {
      await this.invalidateActive();
      if (error instanceof WriterConflictError || error instanceof WriterOperationError)
        throw error;
      throw new WriterOperationError("open", error);
    }
  }

  async append(lines: readonly Buffer[]): Promise<SegmentAppendResult> {
    await this.open();
    const result: SegmentAppendResult = {
      records: 0,
      bytes: 0,
      rotations: 0,
      cleanupDeletions: 0,
    };
    try {
      let index = 0;
      while (index < lines.length) {
        const now = this.options.now();
        if (
          this.activeBytes > 0 &&
          (this.activeDay !== utcDay(now) ||
            this.activeBytes + lines[index]!.byteLength > this.options.retention.maxSegmentBytes)
        ) {
          result.cleanupDeletions += await this.rotate(
            this.activeDay !== utcDay(now) ? "utc-day" : "size",
          );
          result.rotations += 1;
        }

        const group: Buffer[] = [];
        let groupBytes = 0;
        while (index < lines.length) {
          const line = lines[index]!;
          if (
            group.length > 0 &&
            this.activeBytes + groupBytes + line.byteLength > this.options.retention.maxSegmentBytes
          ) {
            break;
          }
          group.push(line);
          groupBytes += line.byteLength;
          index += 1;
          if (group.length >= 128 || groupBytes >= 256 * 1024) break;
        }
        const block = group.length === 1 ? group[0]! : Buffer.concat(group, groupBytes);
        await this.options.hooks?.beforeWrite?.(this.activePath, block.byteLength);
        try {
          await this.writeAll(block);
        } catch (error) {
          if (error instanceof PartialWriteError) {
            let completeBytes = 0;
            let completeRecords = 0;
            for (const line of group) {
              if (completeBytes + line.byteLength > error.bytesWritten) break;
              completeBytes += line.byteLength;
              completeRecords += 1;
            }
            result.records += completeRecords;
            result.bytes += completeBytes;
            throw error.cause;
          }
          throw error;
        }
        this.activeBytes += block.byteLength;
        result.records += group.length;
        result.bytes += block.byteLength;
      }
      return result;
    } catch (error) {
      await this.invalidateActive();
      throw new SegmentAppendError("segment append failed", result, error);
    }
  }

  async flush(): Promise<void> {
    if (!this.active) return;
    try {
      await this.options.hooks?.beforeFlush?.(this.activePath);
      await this.active.sync();
    } catch (error) {
      throw new WriterOperationError("flush", error);
    }
  }

  async close(): Promise<void> {
    let failure: unknown;
    if (this.active) {
      const handle = this.active;
      this.active = null;
      try {
        await handle.sync();
        await this.options.hooks?.beforeClose?.(this.activePath);
        await handle.close();
      } catch (error) {
        failure = error;
        try {
          await handle.close();
        } catch {
          // The original close/flush failure is the useful health fact.
        }
      }
    }
    await this.releaseLock();
    if (failure !== undefined) throw new WriterOperationError("close", failure);
  }

  private async acquireLock(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        try {
          await handle.writeFile(
            `${JSON.stringify({ pid: process.pid, bootId: safeBootId(this.options.bootId) })}\n`,
          );
          await handle.sync();
          this.lock = handle;
        } catch (error) {
          try {
            await handle.close();
          } finally {
            await rm(this.lockPath, { force: true });
          }
          throw error;
        }
        return;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        let stale = true;
        try {
          const parsed = JSON.parse(await readFile(this.lockPath, "utf8")) as { pid?: unknown };
          stale = !(await pidIsAlive(Number(parsed.pid)));
        } catch (readError) {
          if (errorCode(readError) === "ENOENT") continue;
          // Another process can observe the exclusive file between create and
          // its tiny identity write. Treat a fresh unreadable lock as live;
          // only an old abandoned artifact is safe to remove.
          try {
            const details = await stat(this.lockPath);
            stale = Date.now() - details.mtimeMs > 30_000;
          } catch (statError) {
            if (errorCode(statError) === "ENOENT") continue;
            stale = false;
          }
        }
        if (!stale) throw new WriterConflictError(this.lockPath);
        await rm(this.lockPath, { force: true });
      }
    }
    throw new WriterConflictError(this.lockPath);
  }

  private async releaseLock(): Promise<void> {
    const handle = this.lock;
    this.lock = null;
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Removing our lock is still attempted; close failure is separately
        // surfaced through the active writer lifecycle.
      }
      await rm(this.lockPath, { force: true });
    }
  }

  private async rejectUnsafeActivePath(): Promise<void> {
    try {
      const details = await lstat(this.activePath);
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error(`unsafe active log path: ${this.activePath}`);
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }

  private async assertSafeDirectory(path: string): Promise<void> {
    const details = await lstat(path);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`unsafe log directory: ${path}`);
    }
  }

  private async endsWithNewline(): Promise<boolean> {
    if (!this.active || this.activeBytes === 0) return true;
    const byte = Buffer.allocUnsafe(1);
    const { bytesRead } = await this.active.read(byte, 0, 1, this.activeBytes - 1);
    return bytesRead === 1 && byte[0] === 0x0a;
  }

  private async writeAll(buffer: Buffer): Promise<void> {
    if (!this.active) throw new Error("active segment is not open");
    let offset = 0;
    while (offset < buffer.byteLength) {
      try {
        const { bytesWritten } = await this.active.write(
          buffer,
          offset,
          buffer.byteLength - offset,
          null,
        );
        if (bytesWritten <= 0) throw new Error("log write made no progress");
        offset += bytesWritten;
      } catch (error) {
        throw new PartialWriteError(offset, error);
      }
    }
  }

  private async invalidateActive(): Promise<void> {
    const handle = this.active;
    this.active = null;
    if (!handle) return;
    try {
      await handle.close();
    } catch {
      // Recovery re-opens and rolls a partial active file on the next attempt.
    }
  }

  private closedPathCandidate(reason: string): string {
    this.rotationSequence += 1;
    const streamName = basename(this.activePath, ".ndjson");
    return join(
      this.categoryDir,
      `${streamName}.${closedStamp(this.options.now())}.${safeBootId(this.options.bootId)}.${String(
        this.rotationSequence,
      ).padStart(4, "0")}.${reason}.ndjson`,
    );
  }

  private async nextClosedPath(reason: string): Promise<string> {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = this.closedPathCandidate(reason);
      try {
        await lstat(candidate);
      } catch (error) {
        if (errorCode(error) === "ENOENT") return candidate;
        throw error;
      }
    }
    throw new Error("could not allocate a unique closed log segment name");
  }

  private async rotate(reason: string): Promise<number> {
    const handle = this.active;
    if (!handle) throw new Error("cannot rotate a closed segment");
    const closedPath = await this.nextClosedPath(reason);
    this.active = null;
    let operation: WriterOperation = "flush";
    try {
      await handle.sync();
      operation = "close";
      await handle.close();
      operation = "rename";
      await this.options.hooks?.beforeRename?.(this.activePath, closedPath);
      await rename(this.activePath, closedPath);
      operation = "open";
      await this.options.hooks?.beforeOpen?.(this.activePath);
      this.active = await open(this.activePath, "a+", 0o600);
      await chmod(this.activePath, 0o600);
      this.activeBytes = 0;
      this.activeDay = utcDay(this.options.now());
      return await this.cleanup();
    } catch (error) {
      try {
        await handle.close();
      } catch {
        // Rotation recovery below owns the useful failure.
      }
      try {
        this.active = await open(this.activePath, "a+", 0o600);
        const details = await this.active.stat();
        this.activeBytes = details.size;
        this.activeDay = utcDay(details.mtimeMs);
      } catch {
        this.active = null;
      }
      throw new WriterOperationError(operation, error);
    }
  }

  private async cleanup(): Promise<number> {
    const now = this.options.now();
    const activeName = basename(this.activePath);
    const streamPrefix = `${basename(this.activePath, ".ndjson")}.`;
    const entries = await readdir(this.categoryDir, { withFileTypes: true });
    const closed: Array<{ path: string; name: string; mtimeMs: number; size: number }> = [];
    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ndjson")) continue;
      const path = join(this.categoryDir, entry.name);
      let details: Awaited<ReturnType<typeof stat>>;
      try {
        details = await stat(path);
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        throw error;
      }
      totalBytes += details.size;
      if (entry.name !== activeName && isClosedSegment(entry.name)) {
        closed.push({ path, name: entry.name, mtimeMs: details.mtimeMs, size: details.size });
      }
    }
    closed.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
    const remove = new Set<string>();
    const own = closed.filter((entry) => entry.name.startsWith(streamPrefix));
    for (const entry of own.slice(
      0,
      Math.max(0, own.length - this.options.retention.maxClosedSegments),
    )) {
      remove.add(entry.path);
    }
    for (const entry of closed) {
      if (now - entry.mtimeMs > this.options.retention.maxAgeMs) remove.add(entry.path);
    }
    for (const entry of closed) {
      if (remove.has(entry.path)) totalBytes -= entry.size;
    }
    for (const entry of closed) {
      if (totalBytes <= this.options.retention.categoryCapBytes) break;
      if (remove.has(entry.path)) continue;
      remove.add(entry.path);
      totalBytes -= entry.size;
    }

    let deletions = 0;
    for (const entry of closed) {
      if (!remove.has(entry.path)) continue;
      await this.options.hooks?.beforeRemove?.(entry.path);
      await rm(entry.path, { force: true });
      deletions += 1;
    }
    return deletions;
  }
}
