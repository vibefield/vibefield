import { createHash, randomBytes } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import {
  type CrashArtifactV1 as CrashArtifact,
  type CrashArtifactListV1 as CrashArtifactList,
  CrashArtifactListV1,
  CrashArtifactV1,
  CrashArtifactViewedV1,
} from "@vibefield/contracts/diagnostics";
import type { Logger } from "@vibefield/logging";
import type { CrashReporterStartOptions } from "electron";

const CRASH_MAX_ARTIFACTS = 5;
const CRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const CRASH_MAX_BYTES = 250 * 1024 * 1024;
const MAX_SCAN_DEPTH = 3;
const MAX_STATE_BYTES = 128 * 1024;

interface RunMarker {
  v: 1;
  bootId: string;
  startedAt: number;
  appVersion: string;
}

interface ArtifactState {
  viewed: boolean;
  exported: boolean;
  processRole: string;
  appVersion: string;
  bootId?: string;
}

interface PersistedState {
  v: 1;
  artifacts: Record<string, ArtifactState>;
}

interface InternalArtifact {
  public: CrashArtifact;
  path: string;
}

interface CleanupSummary {
  deletedArtifacts: number;
  deletedBytes: number;
  failures: number;
  skippedUnsafeEntries: number;
}

export interface CrashArtifactExport {
  artifact: CrashArtifact;
  path: string;
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

function cleanCardinality(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("crash evidence directory is not a private regular directory");
  }
  await chmod(path, 0o700);
}

/** Starts Crashpad with a deliberately network-incapable configuration.
 * Exported so tests can prove that a future refactor cannot smuggle a submit
 * URL or uploading back into early startup. */
export function startLocalCrashReporter(options: {
  start: (config: CrashReporterStartOptions) => void;
  bootId: string;
  appVersion: string;
  contractsVersion: string;
  channel: string;
}): CrashReporterStartOptions {
  const config: CrashReporterStartOptions = {
    productName: "VibeField",
    uploadToServer: false,
    globalExtra: {
      appVersion: cleanCardinality(options.appVersion, "unknown"),
      contractsVersion: cleanCardinality(options.contractsVersion, "unknown"),
      channel: cleanCardinality(options.channel, "unknown"),
      processRole: "desktop-main",
      bootId: cleanCardinality(options.bootId, "unknown"),
    },
  };
  options.start(config);
  return config;
}

async function readPrivateJson(path: string): Promise<unknown | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) return null;
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    const handle = await open(path, flags);
    try {
      const afterOpen = await handle.stat();
      if (!afterOpen.isFile() || afterOpen.size > MAX_STATE_BYTES) return null;
      return JSON.parse(await handle.readFile("utf8")) as unknown;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isNotFound(error) || errorCode(error) === "ELOOP") return null;
    throw error;
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await unlink(path);
  } catch (error) {
    if (!isNotFound(error)) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function parseRunMarker(raw: unknown): RunMarker | null {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("v" in raw) ||
    raw.v !== 1 ||
    !("bootId" in raw) ||
    typeof raw.bootId !== "string" ||
    raw.bootId.length < 1 ||
    raw.bootId.length > 160 ||
    !("startedAt" in raw) ||
    typeof raw.startedAt !== "number" ||
    !Number.isSafeInteger(raw.startedAt) ||
    !("appVersion" in raw) ||
    typeof raw.appVersion !== "string"
  ) {
    return null;
  }
  return {
    v: 1,
    bootId: raw.bootId,
    startedAt: raw.startedAt,
    appVersion: raw.appVersion.slice(0, 64) || "unknown",
  };
}

function parseState(raw: unknown): Map<string, ArtifactState> {
  const result = new Map<string, ArtifactState>();
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("v" in raw) ||
    raw.v !== 1 ||
    !("artifacts" in raw) ||
    typeof raw.artifacts !== "object" ||
    raw.artifacts === null
  ) {
    return result;
  }
  for (const [id, value] of Object.entries(raw.artifacts)) {
    if (
      !/^crash-[A-Za-z0-9_-]{12,80}$/.test(id) ||
      typeof value !== "object" ||
      value === null ||
      !("viewed" in value) ||
      typeof value.viewed !== "boolean" ||
      !("exported" in value) ||
      typeof value.exported !== "boolean" ||
      !("processRole" in value) ||
      typeof value.processRole !== "string" ||
      !("appVersion" in value) ||
      typeof value.appVersion !== "string"
    ) {
      continue;
    }
    const bootId = "bootId" in value && typeof value.bootId === "string" ? value.bootId : undefined;
    result.set(id, {
      viewed: value.viewed,
      exported: value.exported,
      processRole: value.processRole.slice(0, 64) || "electron",
      appVersion: value.appVersion.slice(0, 64) || "unknown",
      ...(bootId !== undefined ? { bootId } : {}),
    });
    if (result.size >= 32) break;
  }
  return result;
}

function artifactId(name: string, bytes: number, modifiedAt: number): string {
  const digest = createHash("sha256")
    .update(name)
    .update("\0")
    .update(String(bytes))
    .update("\0")
    .update(String(modifiedAt))
    .digest("base64url")
    .slice(0, 24);
  return `crash-${digest}`;
}

export class CrashArtifactManager {
  private readonly markerPath: string;
  private readonly statePath: string;
  private readonly now: () => number;
  private readonly startedAt: number;
  private previousRun: RunMarker | null = null;
  private state = new Map<string, ArtifactState>();
  private artifacts = new Map<string, InternalArtifact>();
  private cleanup: CleanupSummary = {
    deletedArtifacts: 0,
    deletedBytes: 0,
    failures: 0,
    skippedUnsafeEntries: 0,
  };
  private operation: Promise<void> = Promise.resolve();
  private initialized = false;
  private clean = false;

  constructor(
    private readonly options: {
      dataRoot: string;
      crashDumpsRoot: string;
      bootId: string;
      appVersion: string;
      logger: Logger;
      now?: () => number;
    },
  ) {
    const stateRoot = join(options.dataRoot, "crash");
    this.markerPath = join(stateRoot, "active-run.json");
    this.statePath = join(stateRoot, "manifest-state.json");
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  initialize(): Promise<CrashArtifactList> {
    return this.serial(async () => {
      if (!this.initialized) {
        await ensurePrivateDirectory(this.options.crashDumpsRoot);
        await ensurePrivateDirectory(dirname(this.markerPath));
        this.previousRun = parseRunMarker(await readPrivateJson(this.markerPath));
        if (this.previousRun !== null) {
          this.options.logger.warn(
            "desktop.crash.previous_run_unclean",
            "The previous Electron run did not record a clean shutdown",
            {
              previousBootId: this.previousRun.bootId,
              previousStartedAt: this.previousRun.startedAt,
            },
          );
        }
        this.state = parseState(await readPrivateJson(this.statePath));
        await writePrivateJson(this.markerPath, {
          v: 1,
          bootId: this.options.bootId,
          startedAt: this.startedAt,
          appVersion: this.options.appVersion,
        } satisfies RunMarker);
        this.initialized = true;
      }
      return this.refreshUnlocked();
    });
  }

  refresh(processRoleHint = "electron"): Promise<CrashArtifactList> {
    return this.serial(async () => {
      this.requireInitialized();
      return this.refreshUnlocked(processRoleHint);
    });
  }

  markViewed(raw: unknown): Promise<{ viewed: boolean }> {
    return this.serial(async () => {
      this.requireInitialized();
      const request = CrashArtifactViewedV1.safeParse(raw);
      if (!request.success) throw new Error("expected a valid crash artifact id");
      await this.refreshUnlocked();
      const artifact = this.artifacts.get(request.data.artifactId);
      if (artifact === undefined) return { viewed: false };
      const state = this.state.get(request.data.artifactId);
      if (state === undefined) return { viewed: false };
      state.viewed = true;
      await this.persistState();
      artifact.public = CrashArtifactV1.parse({ ...artifact.public, viewed: true });
      return { viewed: true };
    });
  }

  selectArtifacts(ids: readonly string[]): Promise<CrashArtifactExport[]> {
    return this.serial(async () => {
      this.requireInitialized();
      await this.refreshUnlocked();
      const unique = [...new Set(ids)];
      if (unique.length > CRASH_MAX_ARTIFACTS) {
        throw new Error("too many crash artifacts selected");
      }
      const exports: CrashArtifactExport[] = [];
      for (const id of unique) {
        const artifact = this.artifacts.get(id);
        if (artifact === undefined) throw new Error(`crash artifact ${id} is unavailable`);
        exports.push({ artifact: artifact.public, path: artifact.path });
      }
      return exports;
    });
  }

  markExported(ids: readonly string[]): Promise<void> {
    return this.serial(async () => {
      this.requireInitialized();
      let changed = false;
      for (const id of new Set(ids)) {
        const state = this.state.get(id);
        const internal = this.artifacts.get(id);
        if (state === undefined || internal === undefined) continue;
        state.exported = true;
        internal.public = CrashArtifactV1.parse({
          ...internal.public,
          exported: true,
        });
        changed = true;
      }
      if (changed) await this.persistState();
    });
  }

  markClean(): Promise<void> {
    return this.serial(async () => {
      if (!this.initialized || this.clean) return;
      this.clean = true;
      try {
        await unlink(this.markerPath);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      this.options.logger.info(
        "desktop.crash.clean_shutdown_recorded",
        "Electron recorded a clean shutdown marker",
      );
    });
  }

  private async refreshUnlocked(processRoleHint = "electron"): Promise<CrashArtifactList> {
    const candidates: Array<{
      id: string;
      path: string;
      bytes: number;
      createdAt: number;
    }> = [];
    let skippedUnsafeEntries = 0;
    const walk = async (directory: string, depth: number): Promise<void> => {
      try {
        const info = await lstat(directory);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          skippedUnsafeEntries += 1;
          return;
        }
        await chmod(directory, 0o700);
      } catch (error) {
        if (isNotFound(error)) return;
        skippedUnsafeEntries += 1;
        return;
      }
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          skippedUnsafeEntries += 1;
          continue;
        }
        if (entry.isDirectory()) {
          if (depth < MAX_SCAN_DEPTH) await walk(path, depth + 1);
          continue;
        }
        if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".dmp") continue;
        try {
          const stat = await lstat(path);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            skippedUnsafeEntries += 1;
            continue;
          }
          await chmod(path, 0o600);
          const createdAt = Math.max(0, Math.floor(stat.mtimeMs));
          candidates.push({
            id: artifactId(
              relative(this.options.crashDumpsRoot, path).replaceAll("\\", "/"),
              stat.size,
              createdAt,
            ),
            path,
            bytes: stat.size,
            createdAt,
          });
        } catch (error) {
          if (!isNotFound(error)) skippedUnsafeEntries += 1;
        }
      }
    };
    await walk(this.options.crashDumpsRoot, 0);
    candidates.sort((left, right) => right.createdAt - left.createdAt);

    const next = new Map<string, InternalArtifact>();
    const nextState = new Map<string, ArtifactState>();
    let retainedBytes = 0;
    let retainedCount = 0;
    let deletedArtifacts = 0;
    let deletedBytes = 0;
    let failures = 0;
    for (const candidate of candidates) {
      const overAge = this.now() - candidate.createdAt > CRASH_MAX_AGE_MS;
      const overCount = retainedCount >= CRASH_MAX_ARTIFACTS;
      const overBytes = retainedBytes + candidate.bytes > CRASH_MAX_BYTES;
      if (overAge || overCount || overBytes) {
        try {
          await unlink(candidate.path);
          deletedArtifacts += 1;
          deletedBytes += candidate.bytes;
          continue;
        } catch (error) {
          if (isNotFound(error)) {
            deletedArtifacts += 1;
            deletedBytes += candidate.bytes;
            continue;
          }
          failures += 1;
        }
      } else {
        retainedCount += 1;
        retainedBytes += candidate.bytes;
      }

      const prior = this.state.get(candidate.id);
      const attributed = prior ?? this.attribute(candidate.createdAt, processRoleHint);
      nextState.set(candidate.id, attributed);
      const cleanupResult = overAge || overCount || overBytes ? "cleanup-failed" : "retained";
      const record = CrashArtifactV1.parse({
        v: 1,
        artifactId: candidate.id,
        processRole: attributed.processRole,
        createdAt: candidate.createdAt,
        bytes: candidate.bytes,
        appVersion: attributed.appVersion,
        ...(attributed.bootId !== undefined ? { bootId: attributed.bootId } : {}),
        viewed: attributed.viewed,
        exported: attributed.exported,
        cleanupResult,
      });
      next.set(candidate.id, { public: record, path: candidate.path });
      if (next.size >= 32) break;
    }
    this.artifacts = next;
    this.state = nextState;
    this.cleanup = {
      deletedArtifacts,
      deletedBytes,
      failures,
      skippedUnsafeEntries,
    };
    await this.persistState();
    if (candidates.length > 0 || deletedArtifacts > 0 || failures > 0) {
      this.options.logger.info(
        "desktop.crash.artifacts_refreshed",
        "Electron refreshed its local crash artifact manifest",
        {
          discovered: candidates.length,
          retained: next.size,
          retainedBytes,
          deletedArtifacts,
          deletedBytes,
          cleanupFailures: failures,
          skippedUnsafeEntries,
        },
      );
    }
    return this.snapshot();
  }

  private attribute(createdAt: number, processRoleHint: string): ArtifactState {
    if (createdAt >= this.startedAt) {
      return {
        viewed: false,
        exported: false,
        processRole: processRoleHint.slice(0, 64) || "electron",
        appVersion: this.options.appVersion,
        bootId: this.options.bootId,
      };
    }
    if (
      this.previousRun !== null &&
      createdAt >= this.previousRun.startedAt &&
      createdAt < this.startedAt
    ) {
      return {
        viewed: false,
        exported: false,
        processRole: "electron",
        appVersion: this.previousRun.appVersion,
        bootId: this.previousRun.bootId,
      };
    }
    return {
      viewed: false,
      exported: false,
      processRole: "electron",
      appVersion: "unknown",
    };
  }

  private snapshot(): CrashArtifactList {
    return CrashArtifactListV1.parse({
      v: 1,
      observedAt: this.now(),
      artifacts: [...this.artifacts.values()]
        .map((artifact) => artifact.public)
        .sort((left, right) => right.createdAt - left.createdAt),
      cleanup: this.cleanup,
    });
  }

  private async persistState(): Promise<void> {
    const artifacts: Record<string, ArtifactState> = {};
    for (const [id, state] of this.state) artifacts[id] = state;
    await writePrivateJson(this.statePath, {
      v: 1,
      artifacts,
    } satisfies PersistedState);
  }

  private requireInitialized(): void {
    if (!this.initialized) throw new Error("crash artifact manager is not initialized");
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
