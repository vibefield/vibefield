import { execFile } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIRST_PARTY_RETENTION, type NodeLogging, PLUGIN_RETENTION } from "@vibefield/logging";
import { app, type BrowserWindow } from "electron";

const MiB = 1024 * 1024;
const MAX_CYCLES = 10_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_CYCLE_DELAY_MS = 5 * 60 * 1_000;
const COMMAND_OUTPUT_BYTES = 4 * MiB;

export const PLUGIN_RUNTIME_SOAK_EXACT_KEYS = [
  "bootstrapVectorMismatches",
  "rendererRuntimeVectorMismatches",
  "fielddRuntimeVectorMismatches",
  "oldFielddProcesses",
  "oldRendererProcesses",
  "rendererProcessCountDeviation",
  "fielddHandleDeviation",
  "nativePidDeviation",
  "sampledProcessDeaths",
  "loggingQueueRecords",
  "loggingQueueBytes",
  "unexplainedLogDrops",
  "plantedMainListeners",
  "powerSaveBlockerDeviation",
] as const;

export interface PluginRuntimeSoakConfig {
  readonly enabled: boolean;
  readonly cycles: number | null;
  readonly durationMs: number | null;
  readonly cycleDelayMs: number;
  readonly warmupSamples: number;
  readonly minimumGradedSamples: number;
  readonly footprint: boolean;
  readonly injection: "none" | "main-listener";
  readonly claim: "smoke" | "calibration" | "24h";
}

function boundedInteger(
  raw: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

export function pluginRuntimeSoakConfig(
  env: NodeJS.ProcessEnv = process.env,
): PluginRuntimeSoakConfig {
  const enabled = env["VF_PLUGIN_RUNTIME_SOAK"] === "1";
  if (!enabled) {
    return {
      enabled: false,
      cycles: 1,
      durationMs: null,
      cycleDelayMs: 0,
      warmupSamples: 0,
      minimumGradedSamples: 1,
      footprint: false,
      injection: "none",
      claim: "smoke",
    };
  }
  const durationRaw = env["VF_PLUGIN_RUNTIME_SOAK_DURATION_MS"];
  const cyclesRaw = env["VF_PLUGIN_RUNTIME_SOAK_CYCLES"];
  if (durationRaw !== undefined && cyclesRaw !== undefined) {
    throw new Error("plugin runtime soak accepts cycles or duration, not both");
  }
  const durationMs =
    durationRaw === undefined
      ? null
      : boundedInteger(
          durationRaw,
          "VF_PLUGIN_RUNTIME_SOAK_DURATION_MS",
          1_000,
          MAX_DURATION_MS,
          0,
        );
  const cycles =
    durationMs === null
      ? boundedInteger(cyclesRaw, "VF_PLUGIN_RUNTIME_SOAK_CYCLES", 1, MAX_CYCLES, 3)
      : null;
  const plannedSamples = cycles ?? MAX_CYCLES;
  const warmupSamples = boundedInteger(
    env["VF_PLUGIN_RUNTIME_SOAK_WARMUP_SAMPLES"],
    "VF_PLUGIN_RUNTIME_SOAK_WARMUP_SAMPLES",
    0,
    Math.max(0, plannedSamples - 1),
    cycles === null ? 8 : Math.min(1, cycles - 1),
  );
  const minimumGradedSamples = boundedInteger(
    env["VF_PLUGIN_RUNTIME_SOAK_MIN_GRADED_SAMPLES"],
    "VF_PLUGIN_RUNTIME_SOAK_MIN_GRADED_SAMPLES",
    1,
    Math.max(1, plannedSamples - warmupSamples),
    cycles === null ? 24 : Math.max(1, cycles - warmupSamples),
  );
  const injectionRaw = env["VF_PLUGIN_RUNTIME_SOAK_INJECT"] ?? "none";
  if (injectionRaw !== "none" && injectionRaw !== "main-listener") {
    throw new Error("VF_PLUGIN_RUNTIME_SOAK_INJECT must be none or main-listener");
  }
  return {
    enabled: true,
    cycles,
    durationMs,
    cycleDelayMs: boundedInteger(
      env["VF_PLUGIN_RUNTIME_SOAK_CYCLE_DELAY_MS"],
      "VF_PLUGIN_RUNTIME_SOAK_CYCLE_DELAY_MS",
      0,
      MAX_CYCLE_DELAY_MS,
      durationMs === null ? 0 : 45_000,
    ),
    warmupSamples,
    minimumGradedSamples,
    footprint: env["VF_PLUGIN_RUNTIME_SOAK_FOOTPRINT"] === "1",
    injection: injectionRaw,
    claim: durationMs === MAX_DURATION_MS ? "24h" : "calibration",
  };
}

export type CountVector = Readonly<Record<string, number>>;

/** Flattens only finite numbers, booleans, and nested plain objects. A census
 * accidentally carrying a runtime value fails here instead of being silently
 * ignored by the soak. */
export function countVector(value: unknown, label: string): CountVector {
  const output: Record<string, number> = {};
  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || candidate < 0) {
        throw new Error(`${label}.${path} is not a finite non-negative count`);
      }
      output[path] = candidate;
      return;
    }
    if (typeof candidate === "boolean") {
      output[path] = candidate ? 1 : 0;
      return;
    }
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      throw new Error(`${label}.${path} is not counts-only plain data`);
    }
    for (const key of Object.keys(candidate as object).sort()) {
      visit(
        (candidate as Record<string, unknown>)[key],
        path.length === 0 ? key : `${path}.${key}`,
      );
    }
  };
  visit(value, "");
  return Object.freeze(output);
}

export function vectorMismatches(expected: CountVector, actual: CountVector): number {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  let mismatches = 0;
  for (const key of keys) {
    if (expected[key] !== actual[key]) mismatches += 1;
  }
  return mismatches;
}

function run(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: COMMAND_OUTPUT_BYTES },
      (error, stdout) => {
        resolve(error === null ? stdout : null);
      },
    );
  });
}

export function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String((error as { code?: unknown }).code) === "EPERM"
    );
  }
}

function parseSizeKb(raw: string): number | null {
  const value = raw.trim();
  const suffix = value.at(-1);
  const multipliers: Record<string, number> = { B: 1 / 1024, K: 1, M: 1024, G: 1024 * 1024 };
  const multiplier = suffix === undefined ? 1 : (multipliers[suffix] ?? 1);
  const number = Number(suffix !== undefined && suffix in multipliers ? value.slice(0, -1) : value);
  return Number.isFinite(number) ? Math.floor(number * multiplier) : null;
}

async function darwinDescriptors(
  pid: number,
): Promise<{ fds: number; networkSockets: number } | null> {
  const raw = await run("/usr/sbin/lsof", ["-n", "-P", "-a", "-p", String(pid), "-Fft"]);
  if (raw === null) return null;
  let fds = 0;
  let networkSockets = 0;
  let descriptor = false;
  for (const line of raw.split("\n")) {
    if (line.startsWith("f")) {
      descriptor = true;
      fds += 1;
    } else if (descriptor && (line === "tIPv4" || line === "tIPv6")) {
      networkSockets += 1;
    }
  }
  return { fds, networkSockets };
}

function linuxDescriptors(pid: number): { fds: number; networkSockets: number } | null {
  try {
    const root = `/proc/${pid}/fd`;
    const entries = readdirSync(root);
    let networkSockets = 0;
    for (const entry of entries) {
      try {
        if (readlinkSync(join(root, entry)).startsWith("socket:[")) networkSockets += 1;
      } catch {
        // The target can close between readdir and readlink; the next sample owns truth.
      }
    }
    return { fds: entries.length, networkSockets };
  } catch {
    return null;
  }
}

async function threadCount(pid: number): Promise<number | null> {
  if (process.platform === "linux") {
    try {
      const match = /^Threads:\s+(\d+)$/mu.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
      return match === null ? null : Number(match[1]);
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    const raw = await run("/bin/ps", ["-M", "-p", String(pid)]);
    if (raw === null) return null;
    return Math.max(0, raw.trim().split("\n").length - 1);
  }
  return null;
}

export async function sampleProcessFootprintKb(
  pid: number,
  enabled: boolean,
): Promise<number | null> {
  if (!enabled || process.platform !== "darwin") return null;
  const raw = await run("/usr/bin/vmmap", ["-summary", String(pid)]);
  if (raw === null) return null;
  for (const line of raw.split("\n")) {
    const match = /^Physical footprint:\s*(\S+)/u.exec(line.trim());
    if (match !== null) return parseSizeKb(match[1]!);
  }
  return null;
}

export interface ProcessResourceSample {
  readonly pid: number;
  readonly alive: boolean;
  readonly fds: number | null;
  readonly networkSockets: number | null;
  readonly threads: number | null;
  readonly physicalFootprintKb: number | null;
}

export async function sampleProcessResources(
  pid: number,
  footprint: boolean,
): Promise<ProcessResourceSample> {
  if (!pidAlive(pid)) {
    return {
      pid,
      alive: false,
      fds: null,
      networkSockets: null,
      threads: null,
      physicalFootprintKb: null,
    };
  }
  const descriptors =
    process.platform === "darwin"
      ? await darwinDescriptors(pid)
      : process.platform === "linux"
        ? linuxDescriptors(pid)
        : null;
  const [threads, footprintKb] = await Promise.all([
    threadCount(pid),
    sampleProcessFootprintKb(pid, footprint),
  ]);
  return {
    pid,
    alive: pidAlive(pid),
    fds: descriptors?.fds ?? null,
    networkSockets: descriptors?.networkSockets ?? null,
    threads,
    physicalFootprintKb: footprintKb,
  };
}

export interface ElectronProcessSample {
  readonly roster: Readonly<Record<string, number>>;
  readonly processCount: number;
  readonly rendererPids: readonly number[];
  readonly rendererWorkingSetKb: number;
  readonly workingSetKb: number;
}

export async function sampleElectronProcesses(
  windows: readonly BrowserWindow[],
): Promise<ElectronProcessSample> {
  const metrics = app.getAppMetrics();
  const roster: Record<string, number> = {};
  let workingSetKb = 0;
  let rendererWorkingSetKb = 0;
  for (const metric of metrics) {
    roster[metric.type] = (roster[metric.type] ?? 0) + 1;
    workingSetKb += metric.memory.workingSetSize;
    if (metric.type === "Tab") rendererWorkingSetKb += metric.memory.workingSetSize;
  }
  const rendererPids = windows
    .map((window) => window.webContents.getOSProcessId())
    .sort((a, b) => a - b);
  return {
    roster: Object.freeze(roster),
    processCount: metrics.length,
    rendererPids: Object.freeze(rendererPids),
    rendererWorkingSetKb,
    workingSetKb,
  };
}

export interface LogCensus {
  readonly systemBytes: number;
  readonly systemFiles: number;
  readonly pluginBytes: number;
  readonly pluginFiles: number;
  readonly totalBytes: number;
  readonly totalFiles: number;
}

function categoryCensus(root: string, category: string): { bytes: number; files: number } {
  const path = join(root, category);
  try {
    let bytes = 0;
    let files = 0;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const details = statSync(join(path, entry.name));
      bytes += details.size;
      files += 1;
    }
    return { bytes, files };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String((error as { code?: unknown }).code) === "ENOENT"
    ) {
      return { bytes: 0, files: 0 };
    }
    throw error;
  }
}

export function logCensus(root: string): LogCensus {
  const system = categoryCensus(root, "system");
  const plugins = categoryCensus(root, "plugins");
  return {
    systemBytes: system.bytes,
    systemFiles: system.files,
    pluginBytes: plugins.bytes,
    pluginFiles: plugins.files,
    totalBytes: system.bytes + plugins.bytes,
    totalFiles: system.files + plugins.files,
  };
}

export const LOG_CENSUS_CEILINGS = Object.freeze({
  // Five registered first-party streams and three plugin streams can each
  // have one active segment above the category cleanup cap.
  systemBytes: FIRST_PARTY_RETENTION.categoryCapBytes + 5 * FIRST_PARTY_RETENTION.maxSegmentBytes,
  systemFiles: 5 * (FIRST_PARTY_RETENTION.maxClosedSegments + 2),
  pluginBytes: PLUGIN_RETENTION.categoryCapBytes + 3 * PLUGIN_RETENTION.maxSegmentBytes,
  pluginFiles: 3 * (PLUGIN_RETENTION.maxClosedSegments + 2),
});

interface LoggingHealthLike {
  readonly queue?: { readonly records?: number; readonly bytes?: number };
  readonly counters?: Readonly<Record<string, number>>;
}

export function loggingCensus(
  sinks: readonly NodeLogging[],
  remote: readonly (LoggingHealthLike | null | undefined)[],
): { queueRecords: number; queueBytes: number; unexplainedDrops: number } {
  const health = [...sinks.map((sink) => sink.health()), ...remote.filter((row) => row != null)];
  let queueRecords = 0;
  let queueBytes = 0;
  let unexplainedDrops = 0;
  for (const row of health) {
    queueRecords += row.queue?.records ?? 0;
    queueBytes += row.queue?.bytes ?? 0;
    const counters = row.counters ?? {};
    unexplainedDrops +=
      (counters["rejected"] ?? 0) +
      (counters["droppedTrace"] ?? 0) +
      (counters["droppedDebug"] ?? 0) +
      (counters["droppedInfo"] ?? 0) +
      (counters["droppedWarn"] ?? 0) +
      (counters["droppedError"] ?? 0) +
      (counters["emergencyFallbacks"] ?? 0);
  }
  return { queueRecords, queueBytes, unexplainedDrops };
}
