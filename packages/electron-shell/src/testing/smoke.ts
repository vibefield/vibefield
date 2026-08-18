import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import {
  TerminalConfigDocument,
  TerminalConfigWriteResult,
  TerminalCreateResult,
  TerminalListResult,
  TerminalTicket,
  type WindowConnection,
} from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  powerSaveBlocker,
  type WebContents,
  webContents,
} from "electron";
import { CLOSE_WINDOW_ITEM_ID } from "../main/app-menu-model";
import { APP_ORIGIN } from "../main/app-protocol";
import type { WindowRendererBoundary } from "../main/bootstrap";
import { BrowserControlTargetRegistry } from "../main/live-surfaces/browser-control-target";
import { ElectronBrowserSurfaceNative } from "../main/live-surfaces/browser-electron-native";
import { BrowserLiveSurfaceRuntime } from "../main/live-surfaces/browser-producer";
import { createElectronLiveSurfaceTextureTransferApi } from "../main/live-surfaces/electron-texture-transfer";
import {
  IosSimulatorLiveSurfaceRuntime,
  IosSimulatorSourceResolver,
  type ResolvedIosSimulatorCapture,
  SimctlDeviceCatalog,
} from "../main/live-surfaces/ios-simulator-producer";
import {
  MacosCaptureHelperSupervisor,
  type MacosCaptureSource,
} from "../main/live-surfaces/macos-capture-helper";
import { loadMacosCaptureNativeAdapter } from "../main/live-surfaces/macos-capture-native";
import type { LiveSurfaceRuntimeAuthority } from "../main/live-surfaces/runtime";
import {
  aggregateLiveSurfaceRuntimeSupport,
  type LiveSurfaceRuntimeSupportSource,
} from "../main/live-surfaces/runtime-support";
import { SckLiveSurfaceRuntime } from "../main/live-surfaces/sck-producer";
import {
  LiveSurfaceTextureForwarder,
  type LiveSurfaceTextureTransferApi,
} from "../main/live-surfaces/texture-forwarder";
import { LiveSurfaceTicketTable } from "../main/live-surfaces/ticket-table";
import { LiveSurfaceWindowHost } from "../main/live-surfaces/window-host";
import type { ElectronLogging } from "../main/logging";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";
import { LiveSurfaceFixtureRuntime } from "./live-surface-fixture-runtime";
import {
  LIVE_SURFACE_LAB_ALL_TICKETS,
  LIVE_SURFACE_LAB_BROWSER_SURFACE_IDS,
  LIVE_SURFACE_LAB_CLOCK_OFFSET_DATASET,
  LIVE_SURFACE_LAB_CLOCK_UNCERTAINTY_DATASET,
  LIVE_SURFACE_LAB_CONTINUOUS_ACTIVE_DATASET,
  LIVE_SURFACE_LAB_FALLBACK_SURFACE_ID,
  LIVE_SURFACE_LAB_HELPER_CRASH_ACK_DATASET,
  LIVE_SURFACE_LAB_HELPER_CRASH_REQUEST_DATASET,
  LIVE_SURFACE_LAB_RELOAD_READY_DATASET,
  LIVE_SURFACE_LAB_RELOAD_TICKET,
  LIVE_SURFACE_LAB_RESULT_DATASET,
  LIVE_SURFACE_LAB_SCK_SURFACE_IDS,
  LIVE_SURFACE_LAB_TICKET_READY_DATASET,
  LIVE_SURFACE_LAB_TICKETS,
  type LiveSurfaceLabRendererResult,
} from "./live-surface-lab-contract";
import {
  type CountVector,
  countVector,
  type ElectronProcessSample,
  LOG_CENSUS_CEILINGS,
  logCensus,
  loggingCensus,
  PLUGIN_RUNTIME_SOAK_EXACT_KEYS,
  type ProcessResourceSample,
  pidAlive,
  pluginRuntimeSoakConfig,
  sampleElectronProcesses,
  sampleProcessFootprintKb,
  sampleProcessResources,
  vectorMismatches,
} from "./plugin-runtime-physical";
import {
  evaluatePhysicalSoak,
  type PhysicalSoakOptions,
  type PhysicalSoakSample,
} from "./plugin-runtime-soak";

// Smoke/spike runners (ESR §5.2.6 / ESR-12): a SEPARATE build artifact
// (dist/testing/smoke.cjs) that the production main bundle never contains —
// index.ts reaches it via a runtime-external dynamic import, and packaging
// omits the file entirely. Everything here is test-only by construction.

/** The text of one `console-message` payload, whichever shape Electron used.
 * The event's arguments changed shape between majors — a string in one, an
 * object carrying `message` in another — so both are read rather than one being
 * assumed and the other silently reading as empty. */
function consoleText(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg !== null && typeof arg === "object" && "message" in arg) {
    return String((arg as { message: unknown }).message);
  }
  return "";
}

/** Resolve when a renderer console line starting with `prefix` arrives.
 *
 * The listener is REMOVED on both settle paths. The godview smoke arms one of
 * these per reload plus one each for the monitor and cold-open lines, and a
 * listener that outlived its promise pushed the window past Node's default cap
 * of ten — so the harness printed `MaxListenersExceededWarning` into its own
 * output, which is a harness teaching its reader to ignore warnings. */
export function waitForConsole(
  win: BrowserWindow,
  prefix: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const listener = (...args: unknown[]): void => {
      for (const a of args) {
        const text = consoleText(a);
        if (text.startsWith(prefix)) {
          settle();
          resolve(text.slice(prefix.length));
          return;
        }
      }
    };
    const settle = (): void => {
      clearTimeout(t);
      win.webContents.off("console-message", listener);
    };
    const t = setTimeout(() => {
      settle();
      reject(new Error(`no "${prefix}" within ${timeoutMs}ms`));
    }, timeoutMs);
    win.webContents.on("console-message", listener);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stop-owned via the supervisor (adopted daemons survive — ownership law),
 * then remove the root ONLY if this run created it (an injected
 * FIELDD_DATA_DIR is someone else's data). */
async function teardown(
  supervisor: FielddSupervisor,
  root: string,
  beforeExit: () => Promise<void>,
): Promise<void> {
  await supervisor.dispose();
  await beforeExit();
  if (!process.env["FIELDD_DATA_DIR"]) rmSync(root, { recursive: true, force: true });
}

export async function runSmoke(
  handle: FielddHandle,
  supervisor: FielddSupervisor,
  root: string,
  beforeExit: () => Promise<void>,
): Promise<void> {
  const health = (await handle.client.request("system.health")) as {
    nativeConnected: boolean;
    native: { units?: Array<{ unit: string }> } | null;
  };
  const summary = {
    ok: health.nativeConnected,
    port: handle.info.port,
    nativeConnected: health.nativeConnected,
    units: health.native?.units?.map((u) => u.unit) ?? [],
  };
  console.log(`SMOKE ${JSON.stringify(summary)}`);
  await teardown(supervisor, root, beforeExit);
  app.exit(summary.ok ? 0 : 2); // exit is queued; the caller returns without opening a window
}

/** What one `CANVAS_READY {…}` line carries. */
interface CanvasFacts {
  widgetTypes: number;
  plugins: number;
  /** P8b-3 — how many plugins came through the STAGED path (fieldd approval →
   * plugin origin → import map → async activate) rather than merely registering. */
  stagedPlugins: number;
  /** PRC-6c physical census emitted from the actual prepared runtime after
   * layout effects attached the document behavior generation. */
  runtime?: object;
}

/** The census this smoke defends, and why it takes two numbers (P8-D2).
 *
 * `widgetTypes` is the product fact — 22 types across the five renderer-bearing
 * plugins — and it is what a loading regression actually costs a user.
 * `stagedPlugins` is the MECHANISM fact: the dev-bundled fallback can satisfy
 * the census on its own, so without this number a renderer that quietly fell
 * back would look exactly like one that staged correctly. Asserting both is
 * what keeps the two loaders from diverging — the field must be full AND it
 * must have been filled the real way. behavior-conformance contributes the
 * fifth renderer module and its one card; kv-service remains service-only and
 * stages no renderer module. */
const CANVAS_CENSUS = { widgetTypes: 22, minStagedPlugins: 5 } as const;

/** Every way the line disagrees with the census, named — a smoke that fails
 * should say what it saw, not that something was wrong. */
function censusFailures(facts: CanvasFacts): string[] {
  const problems: string[] = [];
  if (facts.widgetTypes !== CANVAS_CENSUS.widgetTypes) {
    problems.push(`${facts.widgetTypes} widget types, expected ${CANVAS_CENSUS.widgetTypes}`);
  }
  if (facts.stagedPlugins < CANVAS_CENSUS.minStagedPlugins) {
    problems.push(
      `${facts.stagedPlugins} staged plugin(s), expected at least ${CANVAS_CENSUS.minStagedPlugins} — the renderer did not load through the staged path`,
    );
  }
  return problems;
}

/** Full spine + real renderer, hidden: pass iff the canvas reports in WITH its
 * census. Teardown runs on EVERY path — the old failure path leaked the spawned
 * daemons (slice-0 finding 3). */
export async function runSmokeCanvas(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const win = createMainWindow({
    mode: "smoke-canvas",
    preloadPath: opts.preloadPath,
    show: false,
  });
  opts.registry.adopt(win); // the bootstrap sender policy admits only registered windows
  opts.onWindow?.(win);
  // The godview smoke has had this since GT-2; the canvas smoke wanted it the
  // first time its renderer failed to report (P8b-3). Without it a boot-time
  // renderer error reads only as "no CANVAS_READY within 45s", which names the
  // symptom and hides every cause.
  if (process.env["VF_SMOKE_DEBUG"]) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      console.log(`[renderer] ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    });
  }
  let ok = false;
  try {
    await loadRenderer(win, "smoke-canvas", opts.viteUrl);
    const raw = await waitForConsole(win, "CANVAS_READY ", 45_000);
    console.log(`SMOKE_CANVAS ${raw}`);
    const problems = censusFailures(JSON.parse(raw) as CanvasFacts);
    if (problems.length > 0) throw new Error(problems.join(" · "));
    ok = true;
  } catch (e) {
    console.error(`SMOKE_CANVAS failed: ${e instanceof Error ? e.message : e}`);
  }
  await teardown(opts.supervisor, opts.root, opts.beforeExit);
  app.exit(ok ? 0 : 2);
}

async function waitForCondition(
  label: string,
  timeoutMs: number,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms`);
}

async function rendererConnection(win: BrowserWindow): Promise<WindowConnection> {
  return (await win.webContents.executeJavaScript(
    "globalThis.vibefield.getConnection()",
    true,
  )) as WindowConnection;
}

function waitForReplacementHandle(
  subscribe: (listener: (handle: FielddHandle) => void) => () => void,
  oldBootId: string,
  timeoutMs: number,
): Promise<FielddHandle> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stop = (): void => undefined;
    const timeout = setTimeout(() => {
      settled = true;
      stop();
      reject(new Error(`fieldd was not automatically replaced within ${timeoutMs}ms`));
    }, timeoutMs);
    stop = subscribe((candidate) => {
      if (candidate.info.bootId === oldBootId) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      resolve(candidate);
    });
    // onHandle may synchronously deliver an already-current replacement.
    if (settled) stop();
  });
}

interface PluginRuntimeHealth {
  readonly fieldd: { readonly pid: number };
  readonly nativePid: number | null;
  readonly logging: Parameters<typeof loggingCensus>[1][number];
  readonly pluginLogging: Parameters<typeof loggingCensus>[1][number];
  readonly pluginRuntime: unknown;
}

interface SettledPluginRuntimeHealth {
  readonly health: PluginRuntimeHealth;
  readonly vector: CountVector;
}

interface PluginRuntimePhysicalSample extends PhysicalSoakSample {
  readonly phase: "restart" | "terminal";
  readonly bootId: string;
  readonly fielddPid: number;
  readonly nativePid: number;
  readonly rendererPids: readonly number[];
  readonly raw: Readonly<Record<string, unknown>>;
}

const PLUGIN_RUNTIME_SOAK_MAX_SAMPLE_GAP_MS = 5 * 60 * 1_000;

function rendererRuntimeVector(canvas: readonly CanvasFacts[]): CountVector {
  const windows: Record<string, unknown> = {};
  for (const [index, facts] of canvas.entries()) {
    if (facts.runtime === undefined) {
      throw new Error(`window ${index + 1} emitted no renderer runtime census`);
    }
    windows[`window${index + 1}`] = facts.runtime;
  }
  return countVector(windows, "rendererRuntime");
}

function pluginRuntimeHealth(raw: unknown): PluginRuntimeHealth {
  if (raw === null || typeof raw !== "object") throw new Error("fieldd health is not an object");
  const candidate = raw as Partial<PluginRuntimeHealth>;
  if (
    candidate.fieldd === undefined ||
    !Number.isSafeInteger(candidate.fieldd.pid) ||
    candidate.fieldd.pid <= 0 ||
    candidate.pluginRuntime === undefined
  ) {
    throw new Error("fieldd health omitted its process/runtime census");
  }
  return candidate as PluginRuntimeHealth;
}

function remoteLoggingIdle(health: PluginRuntimeHealth): boolean {
  for (const row of [health.logging, health.pluginLogging]) {
    if (row === null || row === undefined) return false;
    if ((row.queue?.records ?? -1) !== 0 || (row.queue?.bytes ?? -1) !== 0) return false;
  }
  return true;
}

async function settlePluginRuntimeHealth(
  handle: FielddHandle,
  expected?: CountVector,
): Promise<SettledPluginRuntimeHealth> {
  const deadline = Date.now() + 10_000;
  let lastFingerprint = "";
  let stableSince = Date.now();
  let last: SettledPluginRuntimeHealth | null = null;
  while (Date.now() < deadline) {
    const health = pluginRuntimeHealth(await handle.client.request("system.health"));
    const vector = countVector(health.pluginRuntime, "fieldd.pluginRuntime");
    last = { health, vector };
    const fingerprint = JSON.stringify(vector);
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      stableSince = Date.now();
    }
    const expectedReached = expected === undefined || vectorMismatches(expected, vector) === 0;
    if (expectedReached && remoteLoggingIdle(health) && Date.now() - stableSince >= 500)
      return last;
    await sleep(100);
  }
  if (last === null) throw new Error("fieldd emitted no runtime health sample");
  return last;
}

interface SettledPhysicalResources {
  readonly main: ProcessResourceSample;
  readonly fieldd: ProcessResourceSample;
  readonly native: ProcessResourceSample;
  readonly electron: ElectronProcessSample;
  readonly observationWindows: number;
  readonly ranges: Readonly<Record<string, { readonly minimum: number; readonly maximum: number }>>;
}

interface PhysicalResourceObservation {
  readonly main: ProcessResourceSample;
  readonly fieldd: ProcessResourceSample;
  readonly native: ProcessResourceSample;
  readonly electron: ElectronProcessSample;
}

function medianPresent(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  return present[Math.floor(present.length / 2)]!;
}

function resourceMedian(samples: readonly ProcessResourceSample[]): ProcessResourceSample {
  return {
    pid: samples[0]!.pid,
    alive: samples.every((sample) => sample.alive),
    fds: medianPresent(samples.map((sample) => sample.fds)),
    networkSockets: medianPresent(samples.map((sample) => sample.networkSockets)),
    threads: medianPresent(samples.map((sample) => sample.threads)),
    physicalFootprintKb: null,
  };
}

function noteRange(
  ranges: Record<string, { minimum: number; maximum: number }>,
  key: string,
  values: readonly (number | null)[],
): void {
  const present = values.filter((value): value is number => value !== null);
  if (present.length > 0)
    ranges[key] = { minimum: Math.min(...present), maximum: Math.max(...present) };
}

async function samplePhysicalResourceWindow(
  windows: readonly BrowserWindow[],
  fielddPid: number,
  nativePid: number,
): Promise<SettledPhysicalResources> {
  const deadline = Date.now() + 10_000;
  let observationWindows = 0;
  let lastFingerprints: readonly string[] = [];
  while (Date.now() < deadline) {
    observationWindows += 1;
    const observations: PhysicalResourceObservation[] = [];
    for (let index = 0; index < 7; index += 1) {
      const [main, fieldd, native, electron] = await Promise.all([
        sampleProcessResources(process.pid, false),
        sampleProcessResources(fielddPid, false),
        sampleProcessResources(nativePid, false),
        sampleElectronProcesses(windows),
      ]);
      observations.push({ main, fieldd, native, electron });
      if (index < 6) await sleep(125);
    }
    const electronFingerprints = new Set(
      observations.map(({ electron }) =>
        JSON.stringify({
          processCount: electron.processCount,
          rendererPids: electron.rendererPids,
          roster: Object.entries(electron.roster).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        }),
      ),
    );
    lastFingerprints = [...electronFingerprints];
    if (electronFingerprints.size !== 1) {
      await sleep(125);
      continue;
    }
    const ranges: Record<string, { minimum: number; maximum: number }> = {};
    for (const owner of ["main", "fieldd", "native"] as const) {
      const samples = observations.map((observation) => observation[owner]);
      noteRange(
        ranges,
        `${owner}Fds`,
        samples.map((sample) => sample.fds),
      );
      noteRange(
        ranges,
        `${owner}Threads`,
        samples.map((sample) => sample.threads),
      );
      noteRange(
        ranges,
        `${owner}NetworkSockets`,
        samples.map((sample) => sample.networkSockets),
      );
    }
    const electron = observations[3]!.electron;
    return {
      main: resourceMedian(observations.map((observation) => observation.main)),
      fieldd: resourceMedian(observations.map((observation) => observation.fieldd)),
      native: resourceMedian(observations.map((observation) => observation.native)),
      electron: {
        ...electron,
        processCount: medianPresent(
          observations.map((observation) => observation.electron.processCount),
        )!,
        workingSetKb: medianPresent(
          observations.map((observation) => observation.electron.workingSetKb),
        )!,
        rendererWorkingSetKb: medianPresent(
          observations.map((observation) => observation.electron.rendererWorkingSetKb),
        )!,
      },
      observationWindows,
      ranges: Object.freeze(ranges),
    };
  }
  throw new Error(
    `Electron process roster did not settle within 10000ms: ${JSON.stringify(lastFingerprints)}`,
  );
}

function plantedMainListenerCount(): number {
  let count = 0;
  for (const event of process.eventNames()) {
    if (typeof event === "string" && event.startsWith("vf:prc6:planted:")) {
      count += process.listenerCount(event);
    }
  }
  return count;
}

function physicalSoakOptions(
  config: ReturnType<typeof pluginRuntimeSoakConfig>,
): PhysicalSoakOptions {
  const long = config.claim === "24h";
  const osMetricsAvailable = process.platform === "darwin" || process.platform === "linux";
  const requireOsMetrics = long || osMetricsAvailable;
  const noSlopeGate = Number.MAX_SAFE_INTEGER;
  const MiB = 1024 * 1024;
  return {
    warmupSamples: config.warmupSamples,
    minimumGradedSamples: config.minimumGradedSamples,
    ...(long ? { minimumDurationMs: 24 * 60 * 60 * 1_000 } : {}),
    ...(config.durationMs !== null
      ? { maximumSampleGapMs: PLUGIN_RUNTIME_SOAK_MAX_SAMPLE_GAP_MS }
      : {}),
    exactZero: PLUGIN_RUNTIME_SOAK_EXACT_KEYS,
    plateau: {
      electronProcessCount: {
        maximumAboveBaseline: 1,
        maximumGrowth: 0,
        maximumSlopePerHour: noSlopeGate,
      },
      mainFds: {
        required: requireOsMetrics,
        maximumAboveBaseline: 4,
        maximumGrowth: 2,
        maximumSlopePerHour: noSlopeGate,
      },
      mainThreads: {
        required: requireOsMetrics,
        maximumAboveBaseline: 6,
        maximumGrowth: 3,
        maximumSlopePerHour: noSlopeGate,
      },
      fielddFds: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      fielddThreads: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      nativeFds: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      nativeThreads: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      mainNetworkSockets: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      fielddNetworkSockets: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      nativeNetworkSockets: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
    },
    trend: {
      mainHeapUsedBytes: {
        maximumGrowth: long ? 32 * MiB : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 4 * MiB : Number.MAX_SAFE_INTEGER,
      },
      mainExternalBytes: {
        maximumGrowth: long ? 32 * MiB : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 4 * MiB : Number.MAX_SAFE_INTEGER,
      },
      electronWorkingSetKb: {
        maximumGrowth: long ? 128 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 16 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      rendererWorkingSetKb: {
        maximumGrowth: long ? 64 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 8 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      mainPhysicalFootprintKb: {
        required: long && config.footprint && process.platform === "darwin",
        maximumGrowth: long ? 64 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 8 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      fielddPhysicalFootprintKb: {
        required: long && config.footprint && process.platform === "darwin",
        maximumGrowth: long ? 32 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 4 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      nativePhysicalFootprintKb: {
        required: long && config.footprint && process.platform === "darwin",
        maximumGrowth: long ? 16 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 2 * 1024 : Number.MAX_SAFE_INTEGER,
      },
    },
    ceiling: {
      systemLogBytes: { maximum: LOG_CENSUS_CEILINGS.systemBytes },
      systemLogFiles: { maximum: LOG_CENSUS_CEILINGS.systemFiles },
      pluginLogBytes: { maximum: LOG_CENSUS_CEILINGS.pluginBytes },
      pluginLogFiles: { maximum: LOG_CENSUS_CEILINGS.pluginFiles },
    },
  };
}

/** PRC-5g/PRC-6c2 physical witness: two real sandboxed renderer documents
 * load the production custom origin. The bounded soak mode repeats the exact
 * supervisor crash/boot-fence path inside one Electron owner and emits a
 * machine-readable structural + OS sample after every quiescent cycle. */
export async function runSmokePluginRestart(opts: {
  handle: FielddHandle;
  onHandle: (listener: (handle: FielddHandle) => void) => () => void;
  supervisor: FielddSupervisor;
  rendererBoundary: WindowRendererBoundary;
  logging: ElectronLogging;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const config = pluginRuntimeSoakConfig();
  const primary = createMainWindow({
    mode: "smoke-plugin-restart",
    preloadPath: opts.preloadPath,
    show: false,
  });
  const auxiliary = createMainWindow({
    mode: "smoke-plugin-restart",
    preloadPath: opts.preloadPath,
    show: false,
  });
  opts.registry.adopt(primary);
  opts.registry.adoptAuxiliary(auxiliary);
  opts.onWindow?.(primary);
  opts.onWindow?.(auxiliary);
  const windows = [primary, auxiliary] as const;
  const localLogSinks = [
    opts.logging.desktop,
    opts.logging.renderer,
    opts.logging.utility,
    opts.logging.pluginRenderer,
  ] as const;
  const plantedEvents: string[] = [];
  let powerSaveBlockerId: number | null = null;
  if (process.env["VF_SMOKE_DEBUG"]) {
    windows.forEach((win, index) => {
      win.webContents.on("console-message", (...args: unknown[]) => {
        console.log(`[renderer-${index + 1}] ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
      });
    });
  }
  let ok = false;
  try {
    // A duration claim must not be earned while the app is idle-suspended.
    // The display may still sleep, and every physical sample below proves the
    // blocker remained active for the observed interval.
    if (config.durationMs !== null) {
      powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
    const initialReady = windows.map((win) => waitForConsole(win, "CANVAS_READY ", 60_000));
    await Promise.all(
      windows.map((win) => loadRenderer(win, "smoke-plugin-restart", opts.viteUrl)),
    );
    let currentCanvas = (await Promise.all(initialReady)).map(
      (raw) => JSON.parse(raw) as CanvasFacts,
    );
    console.log(`SMOKE_PLUGIN_RESTART_INITIAL ${JSON.stringify(currentCanvas)}`);
    const initialProblems = currentCanvas.flatMap((facts, index) =>
      censusFailures(facts).map((problem) => `window ${index + 1}: ${problem}`),
    );
    if (initialProblems.length > 0) throw new Error(initialProblems.join(" · "));

    const expectedBootstrap = countVector(
      {
        generations: 2,
        hookedSenders: 2,
        windowIdentities: 2,
        documentIdentities: 2,
        retirements: 0,
        replacementsRequested: 0,
        staleBootReapers: 1,
      },
      "expectedBootstrap",
    );
    const initialBootstrap = countVector(opts.rendererBoundary.state(), "bootstrap");
    if (vectorMismatches(expectedBootstrap, initialBootstrap) !== 0) {
      throw new Error(`initial bootstrap census was ${JSON.stringify(initialBootstrap)}`);
    }
    const expectedRendererRuntime = rendererRuntimeVector(currentCanvas);
    let currentHandle = opts.handle;
    let currentConnections = await Promise.all(windows.map(rendererConnection));
    const initialFieldd = await settlePluginRuntimeHealth(currentHandle);
    const expectedFielddRuntime = initialFieldd.vector;
    const nativePid = initialFieldd.health.nativePid;
    if (nativePid === null || !pidAlive(nativePid)) {
      throw new Error("restart smoke requires one live field-native process");
    }
    const startedAt = performance.now();
    const deadline = config.durationMs === null ? null : startedAt + config.durationMs;
    const samples: PluginRuntimePhysicalSample[] = [];
    const oldBootIds: string[] = [];
    let cycle = 0;

    const collectSample = async (
      phase: PluginRuntimePhysicalSample["phase"],
      settled: SettledPluginRuntimeHealth,
      oldFielddPids: readonly number[],
      oldRendererPids: readonly number[],
    ): Promise<PluginRuntimePhysicalSample> => {
      await Promise.all(localLogSinks.map((sink) => sink.flush()));
      const resources = await samplePhysicalResourceWindow(
        windows,
        settled.health.fieldd.pid,
        nativePid,
      );
      const [mainFootprint, fielddFootprint, nativeFootprint] = await Promise.all([
        sampleProcessFootprintKb(process.pid, config.footprint),
        sampleProcessFootprintKb(settled.health.fieldd.pid, config.footprint),
        sampleProcessFootprintKb(nativePid, config.footprint),
      ]);
      const mainResources = { ...resources.main, physicalFootprintKb: mainFootprint };
      const fielddResources = { ...resources.fieldd, physicalFootprintKb: fielddFootprint };
      const nativeResources = { ...resources.native, physicalFootprintKb: nativeFootprint };
      const electron = resources.electron;
      const logs = logCensus(opts.logging.logRoot);
      const logging = loggingCensus(localLogSinks, [
        settled.health.logging,
        settled.health.pluginLogging,
      ]);
      const bootstrap = countVector(opts.rendererBoundary.state(), "bootstrap");
      const rendererRuntime = rendererRuntimeVector(currentCanvas);
      const memory = process.memoryUsage();
      const rendererPids = electron.rendererPids.filter((pid) => pid > 0);
      const sample: PluginRuntimePhysicalSample = {
        phase,
        cycle,
        elapsedMs: performance.now() - startedAt,
        bootId: currentHandle.info.bootId,
        fielddPid: settled.health.fieldd.pid,
        nativePid,
        rendererPids,
        exact: {
          bootstrapVectorMismatches: vectorMismatches(expectedBootstrap, bootstrap),
          rendererRuntimeVectorMismatches: vectorMismatches(
            expectedRendererRuntime,
            rendererRuntime,
          ),
          fielddRuntimeVectorMismatches: vectorMismatches(expectedFielddRuntime, settled.vector),
          oldFielddProcesses: oldFielddPids.filter(pidAlive).length,
          oldRendererProcesses: oldRendererPids.filter(pidAlive).length,
          rendererProcessCountDeviation:
            Math.abs(new Set(rendererPids).size - windows.length) +
            rendererPids.filter((pid) => pid <= 0).length,
          fielddHandleDeviation:
            currentHandle.ownership === "spawned" &&
            currentHandle.childPid === settled.health.fieldd.pid
              ? 0
              : 1,
          // A replacement fieldd adopts the floor and intentionally reports
          // null (it cannot vouch that it spawned that PID). The original
          // positive owner is sampled directly above; only a conflicting
          // positive claim is structural residue here.
          nativePidDeviation:
            settled.health.nativePid === null || settled.health.nativePid === nativePid ? 0 : 1,
          sampledProcessDeaths:
            Number(!mainResources.alive) +
            Number(!fielddResources.alive) +
            Number(!nativeResources.alive),
          loggingQueueRecords: logging.queueRecords,
          loggingQueueBytes: logging.queueBytes,
          unexplainedLogDrops: logging.unexplainedDrops,
          plantedMainListeners: plantedMainListenerCount(),
          powerSaveBlockerDeviation:
            config.durationMs === null ||
            (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId))
              ? 0
              : 1,
        },
        series: {
          electronProcessCount: electron.processCount,
          mainFds: mainResources.fds,
          mainThreads: mainResources.threads,
          mainNetworkSockets: mainResources.networkSockets,
          mainPhysicalFootprintKb: mainResources.physicalFootprintKb,
          fielddFds: fielddResources.fds,
          fielddThreads: fielddResources.threads,
          fielddNetworkSockets: fielddResources.networkSockets,
          fielddPhysicalFootprintKb: fielddResources.physicalFootprintKb,
          nativeFds: nativeResources.fds,
          nativeThreads: nativeResources.threads,
          nativeNetworkSockets: nativeResources.networkSockets,
          nativePhysicalFootprintKb: nativeResources.physicalFootprintKb,
          mainHeapUsedBytes: memory.heapUsed,
          mainExternalBytes: memory.external,
          electronWorkingSetKb: electron.workingSetKb,
          rendererWorkingSetKb: electron.rendererWorkingSetKb,
          systemLogBytes: logs.systemBytes,
          systemLogFiles: logs.systemFiles,
          pluginLogBytes: logs.pluginBytes,
          pluginLogFiles: logs.pluginFiles,
        },
        raw: {
          bootstrap,
          rendererRuntime,
          fielddRuntime: settled.vector,
          reportedNativePid: settled.health.nativePid,
          electronRoster: electron.roster,
          mainResources,
          fielddResources,
          nativeResources,
          osObservationWindows: resources.observationWindows,
          osObservationRanges: resources.ranges,
          logs,
          logging,
          powerSaveBlocker: {
            enabled: powerSaveBlockerId !== null,
            active: powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId),
          },
        },
      };
      samples.push(sample);
      console.log(`PLUGIN_RUNTIME_SOAK_SAMPLE ${JSON.stringify(sample)}`);
      cycle += 1;
      return sample;
    };

    while (
      cycle < 10_000 &&
      (config.cycles !== null ? cycle < config.cycles : performance.now() < (deadline ?? 0))
    ) {
      const childPid = currentHandle.childPid;
      if (currentHandle.ownership !== "spawned" || childPid === undefined) {
        throw new Error("restart smoke requires the isolated supervisor to own fieldd");
      }
      const oldHandle = currentHandle;
      const oldRendererPids = windows.map((window) => window.webContents.getOSProcessId());
      const replacementReady = windows.map((win) => waitForConsole(win, "CANVAS_READY ", 60_000));
      const replacementHandle = waitForReplacementHandle(
        opts.onHandle,
        oldHandle.info.bootId,
        15_000,
      );
      process.kill(childPid, "SIGKILL");
      await waitForCondition("owned fieldd handle retirement", 10_000, () => {
        return oldHandle.client.status === "closed";
      });
      currentHandle = await replacementHandle;
      if (currentHandle.info.bootId === oldHandle.info.bootId) {
        throw new Error("supervisor recovery returned the dead daemon boot id");
      }
      oldBootIds.push(oldHandle.info.bootId);

      currentCanvas = (await Promise.all(replacementReady)).map(
        (raw) => JSON.parse(raw) as CanvasFacts,
      );
      console.log(`SMOKE_PLUGIN_RESTART_RECOVERED ${JSON.stringify(currentCanvas)}`);
      const replacementProblems = currentCanvas.flatMap((facts, index) =>
        censusFailures(facts).map((problem) => `window ${index + 1}: ${problem}`),
      );
      if (replacementProblems.length > 0) throw new Error(replacementProblems.join(" · "));
      const newConnections = await Promise.all(windows.map(rendererConnection));
      for (let index = 0; index < windows.length; index += 1) {
        const oldIdentity = currentConnections[index]?.rendererParticipant;
        const newIdentity = newConnections[index]?.rendererParticipant;
        if (oldIdentity === undefined || newIdentity === undefined) {
          throw new Error(`window ${index + 1} has no renderer participant identity`);
        }
        if (newIdentity.participantId !== oldIdentity.participantId) {
          throw new Error(`window ${index + 1} lost its stable participant id`);
        }
        if (newIdentity.incarnation === oldIdentity.incarnation) {
          throw new Error(`window ${index + 1} reused its dead document incarnation`);
        }
      }
      currentConnections = newConnections;
      await waitForCondition("old fieldd process death", 10_000, () => !pidAlive(childPid));
      await waitForCondition("old renderer process death", 10_000, () =>
        oldRendererPids.every((pid) => !pidAlive(pid)),
      );
      const settled = await settlePluginRuntimeHealth(currentHandle, expectedFielddRuntime);
      if (config.injection === "main-listener" && cycle >= config.warmupSamples) {
        const event = `vf:prc6:planted:${cycle}`;
        process.on(event, () => undefined);
        plantedEvents.push(event);
      }
      await collectSample("restart", settled, [childPid], oldRendererPids);
      if (config.cycleDelayMs > 0) {
        const remaining = deadline === null ? config.cycleDelayMs : deadline - performance.now();
        if (remaining > 0) await sleep(Math.min(config.cycleDelayMs, remaining));
      }
    }

    if (deadline !== null && samples.at(-1)!.elapsedMs < config.durationMs!) {
      const remaining = deadline - performance.now();
      if (remaining > 0) await sleep(remaining);
      const settled = await settlePluginRuntimeHealth(currentHandle, expectedFielddRuntime);
      await collectSample("terminal", settled, [], []);
    }

    const verdict = evaluatePhysicalSoak(samples, physicalSoakOptions(config));
    console.log(
      `PLUGIN_RUNTIME_SOAK ${JSON.stringify({
        claim: config.claim,
        claimSatisfied: config.claim === "24h" && verdict.verdict === "pass",
        injection: config.injection,
        config,
        verdict,
      })}`,
    );
    console.log(
      `SMOKE_PLUGIN_RESTART ${JSON.stringify({
        windows: windows.length,
        cycles: oldBootIds.length,
        oldBootIds,
        newBootId: currentHandle.info.bootId,
        stableParticipants: true,
        freshIncarnations: true,
        widgetTypes: currentCanvas.map((facts) => facts.widgetTypes),
        stagedPlugins: currentCanvas.map((facts) => facts.stagedPlugins),
        soakVerdict: verdict.verdict,
      })}`,
    );
    ok = verdict.verdict === "pass";
  } catch (error) {
    console.error(
      `SMOKE_PLUGIN_RESTART failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const event of plantedEvents) process.removeAllListeners(event);
  try {
    await teardown(opts.supervisor, opts.root, opts.beforeExit);
  } finally {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
  }
  app.exit(ok ? 0 : 2);
}

/** The serviceName `GhostteaElectronBridge` forks its utilityProcess under.
 * Upstream's default, restated here because this harness kills by name. */
const BRIDGE_SERVICE_NAME = "ghosttea-terminal-bridge";

/** SIGKILL the bridge's utility process — the only honest way to test
 * `unexpected-exit`, since `Backend.stop()` is an ORDERLY stop that emits
 * nothing. Neither Backend nor Bridge exposes its child, so the process is
 * found through Electron's own metrics.
 *
 * `fork`'s `serviceName` option surfaces as the metric's `name`; the metric's
 * OWN `serviceName` is the mojo interface (`node.mojom.NodeService`), which
 * every utilityProcess shares. Matching the mojo name would find the logging
 * utility just as happily, so both fields are checked for what they actually
 * mean. Returns the pid it killed so the verdict can say what died. */
function killTerminalBridge(): number | null {
  const metric = app
    .getAppMetrics()
    .find(
      (m) =>
        m.type === "Utility" &&
        m.name === BRIDGE_SERVICE_NAME &&
        m.serviceName === "node.mojom.NodeService",
    );
  if (metric === undefined) return null;
  process.kill(metric.pid, "SIGKILL");
  return metric.pid;
}

// ---- GT-2: the Godview smoke -------------------------------------------------

/** One `GODVIEW_DECK {…}` line, as the deck published it. */
interface DeckFacts {
  active: boolean;
  panes: number;
  sessions: number;
  sessionIds: string[];
  rendererBackend: string;
  error?: string;
  /** present ONLY while the GT-3 restore consent face is up */
  consent?: { saved: number; alive: number; dead: number };
  /** panes showing an ended session */
  exitedSessionIds?: string[];
  /** the pane the deck's own affordances act on */
  activeSessionId?: string;
  /** GT-3v: the alpha the RENDERER was handed, and whose palette it came from */
  glass: { paneBackgroundAlpha: number; opacityCells: boolean; themeName: string | null };
  /** GT-3f: the shader the renderer was handed. Null means the deck passed no
   * `effects` prop at all, which is how an unchosen shader is spelled. */
  effects: { shaderEffect: string | null; animate: boolean };
}

/** The renderer-local home of the viewer's appearance (GT-D12). Named here so
 * the smoke seeds the same key the deck reads, and so a rename of that key
 * fails this harness rather than silently seeding nothing. */
const GODVIEW_APPEARANCE_STORAGE_KEY = "vf-godview-appearance-v1";
/** The port the smoke selects — a `GHOSTTEA_SHADER_OPTIONS` id, static by
 * choice (see row 5b). */
const SMOKE_SHADER_EFFECT = "ghosttea:crt";
/** The alpha row 11 writes into the DEVICE config document.
 *
 * Named because two rows need the same number for opposite reasons: row 11
 * writes it, and row 11b asserts the VIEWER's glass is not it. That second use
 * is the negative control the two-homes proof was missing — a before/after
 * comparison alone passes on a data dir where the deck already holds this
 * value, which is exactly the state a merged home would leave behind. */
const SMOKE_CONFIG_BACKGROUND_OPACITY = 0.62;

/** One `GODVIEW_MONITOR {…}` line, as the monitor stage published it. */
interface MonitorFacts {
  viewId: string;
  agents: number;
  agentBacked: number;
  mockLabel: string;
  /** GT-4: the split, counted — how many rows each source contributed. */
  mockAgents: number;
  remoteSessions: number;
  remoteHosts: number;
  /** `no-door` · `serving` · `unavailable`; the second is what makes an empty
   * mesh distinguishable from a mesh nobody asked. */
  remoteState: string;
  remoteReason?: string;
  swarmPhysics: string;
}

/** A running tail of one marker channel, armed BEFORE the load so a fast page
 * cannot report into a gap. Every wait is a predicate over the LATEST line,
 * because these surfaces say what they are on every change and the interesting
 * states are transient.
 *
 * Generic since GT-4: the monitor needs the same tail the deck has had since
 * GT-2 — a wait armed once and re-read after a gesture — and two copies of this
 * class would be two answers to "what did it last say".
 */
class MarkerWatch<T> {
  private latest: T | null = null;
  private seen: T[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(
    win: BrowserWindow,
    private readonly prefix: string,
  ) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const arg of args) {
        const text = consoleText(arg);
        if (!text.startsWith(this.prefix)) continue;
        try {
          this.latest = JSON.parse(text.slice(this.prefix.length)) as T;
        } catch {
          continue;
        }
        this.seen.push(this.latest);
        for (const notify of [...this.waiters]) notify();
      }
    });
  }

  current(): T | null {
    return this.latest;
  }

  /** EVERY marker since the last `reset()`, oldest first.
   *
   * A predicate over the LATEST line cannot answer a question about a face that
   * was up and is gone. The restore consent prompt is exactly that: it is
   * published with zero panes and replaced the moment it is answered or the
   * moment the workspace mounts without it — so "no prompt appeared" is a claim
   * about the whole window between the reload and the restored deck, and asking
   * the last line is asking about the one moment the answer is always no. */
  history(): readonly T[] {
    return this.seen;
  }

  /** Forget what the deck last said. Called immediately before a renderer
   * reload: `until` answers from the latest marker it has, so a pre-reload
   * state would satisfy a post-reload question — and every assertion about
   * what the deck did on COMING BACK would be about the deck that left. */
  reset(): void {
    this.latest = null;
    this.seen = [];
  }

  /** Resolve on the first marker satisfying `predicate`, including one already
   * seen — a state reached before the wait began is still the state. */
  async until(predicate: (facts: T) => boolean, what: string, timeoutMs: number) {
    if (this.latest !== null && predicate(this.latest)) return this.latest;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(notify);
        reject(
          new Error(
            `timed out waiting for ${what} (last: ${JSON.stringify(this.latest)}) after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      const notify = (): void => {
        if (this.latest === null || !predicate(this.latest)) return;
        clearTimeout(timer);
        this.waiters.delete(notify);
        resolve(this.latest);
      };
      this.waiters.add(notify);
    });
  }
}

/** The accelerator the LIVE application menu binds to Close Window, read out of
 * Electron's own installed menu rather than out of the template that built it —
 * and the difference between those two readings is the whole point.
 *
 * THE ⌘W ARBITRATION, what a smoke can prove about it, and what this reading
 * found the moment it was first taken (GT-5a).
 *
 * ⌘W means "close this window" in macOS and "close this pane" inside a terminal
 * deck; an application accelerator always wins, so with the overlay open the
 * close item must GIVE ⌘W UP or the deck's panes can never answer it.
 * `app-menu-model`'s `closeWindowItem` implements that handover by OMITTING the
 * accelerator while the overlay is open, and `installAppMenu` rebuilds the menu
 * on every toggle to make the omission take effect. Until GT-5a that function
 * ran after the godview harness returned, so the smoke pressed ⌘W with no
 * application menu installed at all and none of this was ever observed.
 *
 * MEASURED, on Electron 43.1.1, once it was: an omitted accelerator on a
 * `role`-bearing item is NOT an absent one. `MenuItem.accelerator` resolves to
 * `explicit ?? roleDefault`, and `role: "close"` carries a default of
 * `CommandOrControl+W` — so the item reports and binds ⌘W in BOTH overlay
 * states, and the handover releases nothing. An explicit accelerator does
 * override (a probe with `CommandOrControl+K` reported ⌘K), and an item with no
 * role at all reports null; `accelerator: null` and `registerAccelerator: false`
 * both still resolve to the role default.
 *
 * FIXED 2026-08-10 on exactly that measurement: the model now DROPS the role
 * while the overlay is open (the only spelling this probe found that reports
 * null), and supplies the role's close behaviour as an action. The two verdict
 * fields below stop being a record and become the ASSERTION — they are supposed
 * to differ, and this smoke now fails if they ever read alike again.
 *
 * What the smoke asserts: an application menu is INSTALLED while it presses ⌘W,
 * which is the gap the review named and the precondition for any of the rest.
 *
 * What it still cannot reach: whether macOS DELIVERS the chord to the page.
 * `sendInputEvent` injects synthesized events into Chromium's input pipeline,
 * below AppKit's key-equivalent dispatch, so a menu accelerator can neither
 * swallow nor pass the harness's ⌘W the way it would a real one. Row 6's
 * closing pane is honest evidence that the PANE answers ⌘W; it is not evidence
 * about what the menu would do to a keystroke from a keyboard. That step needs
 * a human at the machine — the repo's own lesson, that a chord needs a delivery
 * probe, and this chord has none. */
function closeWindowAccelerator(): string | null {
  const menu = Menu.getApplicationMenu();
  if (menu === null) return null;
  const item = menu.getMenuItemById(CLOSE_WINDOW_ITEM_ID);
  if (item === null) return null;
  return item.accelerator ?? null;
}

/** Press a chord the way a keyboard does: down, then up, with the character
 * Chromium expects. `sendInputEvent` injects at the browser's input layer, so
 * the workspace's own keydown listener and its Ghostty binding table decide
 * what happens — the harness presses keys and asserts nothing about routing. */
function pressChord(win: BrowserWindow, key: string): void {
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "char", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
}

/** Put the caret in a terminal, by clicking one — which is how a user does it.
 *
 * The workspace answers a hotkey only when focus is inside it
 * (`workspaceOwnsHotkey` checks `event.target` and `document.activeElement`
 * against its own root), and ghosttea's surface takes focus by itself only when
 * `document.hasFocus()` happened to be true at mount. A click needs neither: a
 * real pointer-down on the surface's input lands focus there the way Chromium
 * lands it anywhere. */
async function focusDeck(win: BrowserWindow): Promise<void> {
  win.focus();
  win.webContents.focus();
  // Focus is PLACED, not clicked into. `sendInputEvent` injects events but does
  // not run Chromium's default actions for them, so a synthesized mousedown on
  // the terminal does not focus it — it blurs whatever was focused, which is
  // the opposite of what a real click does. Asking the page to focus the
  // surface reproduces the state a real click leaves behind.
  //
  // What is under test starts AFTER this: the key events below are real, and
  // everything they reach — ghosttea's binding table, the workspace's command
  // routing, `createSplitSession`, fieldd — runs exactly as it does for a user.
  const focused = (await win.webContents.executeJavaScript(
    `(() => { const t = document.querySelector(".terminal-input"); if (!t) return "no surface";
      const r = t.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return "surface has no size";
      t.focus();
      return document.activeElement === t ? "ok" : "focus refused"; })()`,
  )) as string;
  if (focused !== "ok") throw new Error(`the deck could not take keyboard focus: ${focused}`);
  await sleep(150);
}

/** What has DOM focus, for a failure message. Diagnostic only — no assertion
 * reads it, so the harness never passes on the strength of its own probe. */
async function focusReport(win: BrowserWindow): Promise<string> {
  try {
    return String(
      await win.webContents.executeJavaScript(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: this is renderer-side source text.
        "`hasFocus=${document.hasFocus()} active=${document.activeElement?.tagName}.${document.activeElement?.className}`",
      ),
    );
  } catch (error) {
    return `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The `UNAVAILABLE` fieldd answers `terminal.list` with before its first
 * snapshot from the floor has applied, if it answers one at all.
 *
 * An UNARMED inventory is not an empty one, and until fieldd learned to say so
 * it answered `[]` — indistinguishable from "no terminals here", which is how a
 * restore came to offer to delete a layout whose sessions were alive (GT §9
 * finding 2). A harness must read the refusal the way the deck does: as a state
 * with a name, meaning ASK AGAIN, not as a failure. Recognised structurally
 * rather than by message text, and tolerated whether or not the fieldd on the
 * other end has learned to send it yet. */
function unobservedRefusal(error: unknown): string | null {
  if (!(error instanceof Error) || !("kind" in error) || error.kind !== "UNAVAILABLE") return null;
  const details = (error as { details?: unknown }).details;
  const state =
    details !== null && typeof details === "object" && "state" in details
      ? String((details as { state: unknown }).state)
      : "unstated";
  return state;
}

const listTerminals = async (handle: FielddHandle): Promise<TerminalListResult["terminals"]> =>
  TerminalListResult.parse(await handle.client.request("terminal.list", {})).terminals;

/** `terminal.list`, retried through an honest refusal. Every read of the floor
 * in this harness goes through here or through `untilFloor`, which does the
 * same: a row that failed because fieldd had not looked yet would be reporting
 * on the clock rather than on the product. */
async function listTerminalsWhenObserved(
  handle: FielddHandle,
  timeoutMs = 20_000,
): Promise<TerminalListResult["terminals"]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await listTerminals(handle);
    } catch (error) {
      if (unobservedRefusal(error) === null || Date.now() >= deadline) throw error;
      await sleep(150);
    }
  }
}

/** Poll `terminal.list` until it agrees.
 *
 * `terminal.list` reports fieldd's OBSERVED inventory, which is one management
 * round trip behind the floor — GT-0 measured 62–117ms for a session to appear
 * after its birth, and GT-1 answered it for CREATE by returning the ticket
 * inline rather than by making the observation faster. The lag is still real
 * for anyone reading the list, so a harness that reads once is asserting on the
 * clock. Polling asks the question the test actually means: does the floor come
 * to list this session. */
async function untilFloor(
  handle: FielddHandle,
  predicate: (terminals: TerminalListResult["terminals"]) => boolean,
  what: string,
  timeoutMs: number,
): Promise<TerminalListResult["terminals"]> {
  const deadline = Date.now() + timeoutMs;
  let last: TerminalListResult["terminals"] = [];
  let refusals = 0;
  let lastRefusal = "";
  while (Date.now() < deadline) {
    try {
      last = await listTerminals(handle);
    } catch (error) {
      // An unarmed inventory is fieldd declining to guess, which is the whole
      // point of the refusal — so it is a reason to ask again, never a failure.
      const state = unobservedRefusal(error);
      if (state === null) throw error;
      refusals += 1;
      lastRefusal = state;
      await sleep(150);
      continue;
    }
    if (predicate(last)) return last;
    await sleep(150);
  }
  const refused =
    refusals > 0 ? `; ${refusals} refusal(s), last UNAVAILABLE {state:"${lastRefusal}"}` : "";
  throw new Error(
    `the floor never ${what} within ${timeoutMs}ms (saw ${last.length} terminals${refused})`,
  );
}

/** Every persistence value the floor was ever seen to hold for one session, in
 * the order they were observed.
 *
 * The flip rows (GT-D11) assert that field-native RE-GOVERNS a workspace birth
 * from `terminate-with-app` to `keep-until-exit`. Waiting for the destination
 * alone cannot tell a working flip from a door that never needed one: if a
 * ghosttea upgrade started defaulting workspace panes to `keep-until-exit`, the
 * native flip could be dead code and the rows would stay green. So the harness
 * records what it SAW, and the row says out loud whether the precondition was
 * ever observable — the sampler runs from the toggle, ahead of the birth, which
 * is the earliest any observed inventory can be asked. */
class PersistenceSampler {
  private readonly observed = new Map<string, string[]>();
  private stopped = false;
  readonly running: Promise<void>;

  constructor(handle: FielddHandle, intervalMs = 50) {
    this.running = (async () => {
      while (!this.stopped) {
        try {
          for (const row of await listTerminals(handle)) {
            const seen = this.observed.get(row.sessionId) ?? [];
            const persistence = row.persistence ?? "unstated";
            if (seen.at(-1) !== persistence) seen.push(persistence);
            this.observed.set(row.sessionId, seen);
          }
        } catch {
          /* a refusal or a blip is not this sampler's business to report */
        }
        await sleep(intervalMs);
      }
    })();
  }

  /** What this session was observed to be, oldest first. Empty means the
   * sampler never saw the session at all. */
  trail(sessionId: string): readonly string[] {
    return this.observed.get(sessionId) ?? [];
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.running;
  }
}

/** Ask a real pane what shell it is, and prove it ran the question.
 *
 * `GhostteaAutomationClient` is ghosttea's Node door onto a session — the same
 * socket and token the deck's bridge dialed, redeemed through the same
 * `terminal.openTicket` any attach uses. `pasteAndSubmit` writes into the real
 * PTY, so what runs is the user's real shell interpreting a real command.
 *
 * One line carries both proofs. The SIDE EFFECT is the first: the marker only
 * reaches the file if the process on the other end actually executed the line,
 * which a screen scrape could never show. `$0` is the second: it is the shell's
 * own name for itself, so it answers what the workspace's own create door
 * spawned — the question GT-2e exists to settle. */
async function askPane(
  handle: FielddHandle,
  sessionId: string,
  markerPath: string,
  expression: string,
): Promise<{ marker: string; value: string }> {
  const marker = `godview-${Math.random().toString(36).slice(2, 10)}`;
  const ticket = TerminalTicket.parse(
    await handle.client.request("terminal.openTicket", { sessionId }),
  );
  const automation = new GhostteaAutomationClient(
    { controlSocket: ticket.controlSocket, authToken: ticket.token },
    { clientBuild: "vibefield-smoke-godview" },
  );
  try {
    await automation.connect();
    await automation.pasteAndSubmit(sessionId, `echo "${marker}:${expression}" > ${markerPath}\n`);
    // Matched rather than merely "contains": a half-written file must read as
    // not-yet, not as an empty answer.
    const written = new RegExp(`${marker}:(\\S+)`);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const found = written.exec(readFileSync(markerPath, "utf8"));
        if (found?.[1] !== undefined) return { marker, value: found[1] };
      } catch {
        /* the shell has not written it yet */
      }
      await sleep(150);
    }
    throw new Error(`the shell never wrote ${marker} to ${markerPath}`);
  } finally {
    automation.dispose();
  }
}

/** Run one line in a pane and wait for the shell to have finished it, without
 * asking for a value back. Used to move a pane's cwd — the thing GT-3's restore
 * has to carry across a death. */
async function runInPane(
  handle: FielddHandle,
  sessionId: string,
  markerPath: string,
  line: string,
): Promise<void> {
  const marker = `godview-${Math.random().toString(36).slice(2, 10)}`;
  const ticket = TerminalTicket.parse(
    await handle.client.request("terminal.openTicket", { sessionId }),
  );
  const automation = new GhostteaAutomationClient(
    { controlSocket: ticket.controlSocket, authToken: ticket.token },
    { clientBuild: "vibefield-smoke-godview" },
  );
  try {
    await automation.connect();
    await automation.pasteAndSubmit(sessionId, `${line}; echo ${marker} > ${markerPath}\n`);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        if (readFileSync(markerPath, "utf8").includes(marker)) return;
      } catch {
        /* not yet */
      }
      await sleep(100);
    }
    throw new Error(`the shell never finished "${line}"`);
  } finally {
    automation.dispose();
  }
}

/** Click a button in the deck's own chrome by its visible text.
 *
 * `element.click()` and not a synthesized mouse event: `sendInputEvent` injects
 * at the browser's input layer but skips Chromium's default actions, so a
 * synthesized mousedown on a button does not activate it (GT-2 finding 4, the
 * reason the deck is focused page-side). A DOM click dispatches a real,
 * bubbling click event, which is what React's root listener is waiting for. */
async function clickDeckButton(win: BrowserWindow, label: string): Promise<void> {
  // Polled, not asserted-on-arrival: a marker says what the deck WAS at the
  // moment it published, and a face can still be a render away. A harness that
  // demands an affordance exist the instant it looks for it is testing its own
  // timing, so this waits for the button the way a person would.
  const deadline = Date.now() + 20_000;
  let seen = "";
  while (Date.now() < deadline) {
    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const buttons = [...document.querySelectorAll("button")];
        const button = buttons.find(
          (candidate) => candidate.textContent.trim() === ${JSON.stringify(label)},
        );
        if (!button) return "absent: " + buttons.map((b) => b.textContent.trim()).join("|");
        button.click();
        return "ok";
      })()`,
    )) as string;
    if (clicked === "ok") return;
    seen = clicked;
    await sleep(200);
  }
  throw new Error(`no "${label}" button appeared within 20s (${seen})`);
}

/**
 * Click a bubble on the MONITOR stage, by CSS selector (GT-4).
 *
 * A DOM click for `clickDeckButton`'s reason (GT-2 finding 4: a synthesized
 * mousedown skips Chromium's default actions and blurs a terminal on the way
 * past), and selected by class rather than by text because a bubble's words are
 * a project name — the fact under test is which SOURCE the row came from, and
 * that is what the class says.
 *
 * Returns the bubble's accessible name, so the verdict records what was
 * actually clicked instead of asserting that something was.
 */
async function clickMonitorBubble(win: BrowserWindow, selector: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  let seen = "";
  while (Date.now() < deadline) {
    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const bubble = document.querySelector(${JSON.stringify(selector)});
        if (!bubble) return "absent";
        const label = bubble.getAttribute("aria-label") ?? "";
        bubble.click();
        return "ok:" + label;
      })()`,
    )) as string;
    if (clicked.startsWith("ok:")) return clicked.slice(3);
    seen = clicked;
    await sleep(200);
  }
  throw new Error(`no monitor bubble matched ${selector} within 20s (${seen})`);
}

/**
 * Wait until the deck has published nothing new for `quietMs` (GT-4).
 *
 * A before/after comparison needs a BEFORE that is not still moving. This row's
 * predecessor is the bridge kill, and a recovered deck goes on working after it
 * reports: a new runtime remounts the workspace, which re-reads the saved
 * layout, which rehydrates the pane whose session the kill row ended — a birth
 * that lands a second or two later and has nothing to do with the click under
 * test. The first version of this row sampled into that window and blamed a
 * mock agent for it (measured, not imagined: the id it saw replaced was
 * `killedSession`).
 *
 * Quiescence rather than a fixed sleep, because the settling time is the
 * machine's, not ours.
 */
async function deckSettled(
  deck: MarkerWatch<DeckFacts>,
  quietMs: number,
  timeoutMs: number,
): Promise<DeckFacts> {
  const deadline = Date.now() + timeoutMs;
  let last = JSON.stringify(deck.current());
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(250);
    const now = JSON.stringify(deck.current());
    if (now !== last) {
      last = now;
      quietSince = Date.now();
      continue;
    }
    const facts = deck.current();
    if (facts !== null && Date.now() - quietSince >= quietMs) return facts;
  }
  throw new Error(`the deck never settled for ${quietMs}ms within ${timeoutMs}ms (last: ${last})`);
}

/** What the stage last said out loud about a gesture. The acknowledgement is
 * the monitor's honest confirmation, and reading it is how the harness checks
 * the WORDS a person would have read rather than only the state behind them. */
async function readMonitorAck(win: BrowserWindow): Promise<string> {
  return (await win.webContents.executeJavaScript(
    `(document.querySelector(".vf-monitor-ack")?.textContent ?? "").trim()`,
  )) as string;
}

/** GT-D13's disclosure, as a person can read it: the words in the mock chip
 * ELEMENT, and whether it is actually on screen.
 *
 * The stage's own marker carries the same sentence, but it carries the pure
 * function's return value — so deleting the `<span>`, or hiding it, or letting
 * a layout push it out of the viewport, would leave the marker honest while the
 * screen disclosed nothing. Absent is an empty string and not a throw: an empty
 * disclosure is the failure this row exists to name, and it should be named in
 * the row's own words rather than as a TypeError from the harness.
 *
 * Polled for `readMonitorAck`'s reason and `clickDeckButton`'s: a marker says
 * what the stage WAS when it published, and a chip can still be a render away. */
async function readMonitorMockChip(win: BrowserWindow, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    seen = (await win.webContents.executeJavaScript(
      `(() => {
        const chip = document.querySelector(".vf-monitor-mock-chip");
        if (!chip) return "";
        const box = chip.getBoundingClientRect();
        // On screen at a readable size, or it is not a disclosure. A zero-box
        // or off-viewport chip reads to a person exactly like no chip at all.
        if (box.width < 1 || box.height < 1) return "";
        if (box.bottom < 0 || box.right < 0) return "";
        if (box.top > window.innerHeight || box.left > window.innerWidth) return "";
        return (chip.textContent ?? "").trim();
      })()`,
    )) as string;
    if (seen !== "") return seen;
    await sleep(200);
  }
  return seen;
}

/** The deck's saved layout, as the page holds it. Read so the smoke can assert
 * what `paneMeta` actually persisted rather than trusting that it did. */
async function readDeckLayout(win: BrowserWindow): Promise<string | null> {
  return (await win.webContents.executeJavaScript(`localStorage.getItem("vf-godview-deck-v1")`)) as
    | string
    | null;
}

/** Close the overlay, reload the renderer, open it again — the GT-2e claim
 * row's idiom, minus the `localStorage.clear()`. This is how a restore is
 * staged: the document dies and comes back while the FLOOR does not. */
async function reopenAfterReload(opts: {
  win: BrowserWindow;
  deck: MarkerWatch<DeckFacts>;
  toggleGodview: () => void;
  viteUrl: string;
}): Promise<void> {
  opts.toggleGodview();
  await opts.deck.until((facts) => !facts.active, "the overlay to close", 20_000);
  const reloaded = waitForConsole(opts.win, "CANVAS_READY ", 60_000);
  reloaded.catch(() => undefined);
  opts.deck.reset();
  await loadRenderer(opts.win, "smoke-godview", opts.viteUrl);
  await reloaded;
  opts.win.focus();
  opts.win.webContents.focus();
  opts.toggleGodview();
}

/** REPORT-ONLY (GT-3): how long a real keystroke takes to become an observable
 * effect. No threshold is asserted and nothing fails on it — the v0.3 review
 * asked for a number, and a number that gates a smoke would be a budget nobody
 * has agreed to yet.
 *
 * What it measures, stated exactly, because the name is a promise: the command
 * is STAGED with a control-plane paste and left unsubmitted, then Enter is
 * pressed as a real key event. The clock runs from that keypress to the moment
 * the shell's file side effect is visible to this process — so it spans the
 * renderer's input handling, the bridge, the floor, the PTY, the shell's own
 * execution of the line, and this harness's filesystem poll. It is NOT frame
 * paint, and it is NOT a floor round trip in isolation.
 *
 * Never fatal: it returns null with a reason rather than failing the smoke,
 * because a measurement that can fail a gate is an assertion in disguise. */
async function measureKeystrokeEcho(
  win: BrowserWindow,
  handle: FielddHandle,
  sessionId: string,
  markerPath: string,
): Promise<{ ms: number } | { skipped: string }> {
  const marker = `latency-${Math.random().toString(36).slice(2, 10)}`;
  const ticket = TerminalTicket.parse(
    await handle.client.request("terminal.openTicket", { sessionId }),
  );
  const automation = new GhostteaAutomationClient(
    { controlSocket: ticket.controlSocket, authToken: ticket.token },
    { clientBuild: "vibefield-smoke-godview" },
  );
  try {
    await automation.connect();
    // Staged WITHOUT a newline: the line sits on the shell's edit buffer and
    // nothing has run, so the only thing left between here and the side effect
    // is the keypress below.
    await automation.paste(sessionId, `echo ${marker} > ${markerPath}`);
    await sleep(500); // let the paste settle onto the line before timing starts
    const started = Date.now();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    const deadline = started + 10_000;
    while (Date.now() < deadline) {
      try {
        if (readFileSync(markerPath, "utf8").includes(marker)) {
          return { ms: Date.now() - started };
        }
      } catch {
        /* not yet */
      }
      await sleep(2); // the poll IS the resolution floor, so it is small
    }
    return { skipped: "the pane never ran the staged line on a Return keypress" };
  } catch (error) {
    return { skipped: error instanceof Error ? error.message : String(error) };
  } finally {
    automation.dispose();
  }
}

/** The shell name a path names, with the login-shell `-` convention allowed
 * for: a login shell reports `$0` as `-zsh`, and it is the same zsh. */
const shellName = (path: string): string => (path.split("/").pop() ?? path).replace(/^-/, "");

/** Main's resolution, mirrored — deliberately NOT imported from
 * `main/login-shell.ts`. Importing it would make this row assert that main
 * agrees with itself; writing the ladder out means the row fails if main's
 * answer ever stops being the user's shell. */
function expectedLoginShell(): string {
  const nonEmpty = (value: string | undefined | null): string | undefined => {
    const trimmed = value?.trim();
    return trimmed !== undefined && trimmed !== "" ? trimmed : undefined;
  };
  if (process.platform === "win32") return nonEmpty(process.env["COMSPEC"]) ?? "powershell.exe";
  return nonEmpty(process.env["SHELL"]) ?? nonEmpty(userInfo().shell) ?? "/bin/zsh";
}

/** A reported cwd as a filesystem path.
 *
 * The floor reports whatever the shell announced over OSC 7, verbatim — which
 * is a `file://host/path` URL. Written out here rather than imported from the
 * deck's own `paneCwd` on purpose: this is the harness's independent reading of
 * the same wire value, so a decoder that quietly stopped decoding would fail
 * this row instead of agreeing with itself. */
function cwdPath(reported: string | null | undefined): string | null {
  if (typeof reported !== "string" || reported === "") return null;
  if (reported.startsWith("/")) return reported;
  try {
    return decodeURIComponent(new URL(reported).pathname);
  } catch {
    return null;
  }
}

/** How the floor governs one session's retention, or undefined if it is gone. */
const persistenceOf = (
  terminals: TerminalListResult["terminals"],
  sessionId: string,
): string | undefined => terminals.find((t) => t.sessionId === sessionId)?.persistence;

/** GT-2/GT-2e: the product Godview, end to end, against the real pair.
 *
 * Everything the deck does here it does because a user asked: the overlay opens
 * through the accelerator's own action, and panes are born, split and closed
 * through the WORKSPACE's own doors (GT-D10) — the harness never asks fieldd
 * for a session except to plant the stranger the claim row needs. It presses
 * things and reads two sources of truth: the floor's inventory for what exists
 * and how it is governed, the deck's own marker for what is on screen.
 *
 * The window is SHOWN, unlike the canvas smoke's. Ghosttea gives its terminal
 * input focus only when `document.hasFocus()`, and the workspace routes a hotkey
 * only when focus is inside it, so a hidden window can be looked at but never
 * typed into — and closing a pane is reachable no other way in 0.8.0 (the
 * workspace context exposes split but no close). */
export async function runSmokeGodview(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  toggleGodview: () => void;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "vf-smoke-godview-"));
  const verdict: Record<string, unknown> = { ok: false };
  try {
    const win = createMainWindow({
      mode: "smoke-godview",
      preloadPath: opts.preloadPath,
      show: true,
    });
    opts.registry.adopt(win);
    opts.onWindow?.(win);
    if (process.env["VF_SMOKE_DEBUG"]) {
      win.webContents.on("console-message", (...args: unknown[]) => {
        console.log(`[renderer] ${args.map((a) => JSON.stringify(a)).join(" ")}`);
      });
    }
    const deck = new MarkerWatch<DeckFacts>(win, "GODVIEW_DECK ");
    // GT-4: the monitor's own tail, armed with the deck's and for the same
    // reason — the door rows below re-read the stage AFTER a click, and a
    // one-shot line wait can only ever answer about the mount.
    const monitorWatch = new MarkerWatch<MonitorFacts>(win, "GODVIEW_MONITOR ");
    const canvas = waitForConsole(win, "CANVAS_READY ", 60_000);
    canvas.catch(() => undefined);
    await loadRenderer(win, "smoke-godview", opts.viteUrl);
    await canvas;
    win.focus();
    win.webContents.focus();

    const before = await listTerminalsWhenObserved(opts.handle);
    if (before.length > 0) {
      throw new Error(
        `the init-door row needs an EMPTY floor; found ${before.length} session(s) already`,
      );
    }
    // …and an empty DECK. Row 1 is about a first open, and both planes have to
    // be first: the renderer origin's localStorage outlives this process, so a
    // previous run's saved layout is still sitting there — and since GT-3 that
    // layout is not silently dropped, it is a QUESTION (every session it names
    // died with the last run's floor). Clearing here rather than reloading
    // because nothing has mounted yet: the deck is not built until ⇧⇧.
    await win.webContents.executeJavaScript("localStorage.clear()");

    // GT-3m: armed BEFORE the toggle, because the monitor stage mounts WITH the
    // overlay and its field is already populated at tick 0 — a wait placed after
    // the open would be racing a line that has already been printed.
    const monitorLine = waitForConsole(win, "GODVIEW_MONITOR ", 90_000);
    monitorLine.catch(() => undefined);
    // GT-3p: the cold open's phase breakdown, armed for the same reason. The
    // renderer publishes it once, when the first open reaches a presented
    // frame, so a wait armed after the toggle could miss it outright.
    const coldOpenLine = waitForConsole(win, "GODVIEW_COLD_OPEN ", 90_000);
    coldOpenLine.catch(() => undefined);

    // 1. ⇧⇧'s own action. The overlay opens, the deck redeems a ticket for the
    //    CONNECTION — no session — and the workspace then creates its own first
    //    pane through its own door (GT-D10). Nothing outside it asked for a
    //    shell; there is one because the workspace decided there should be.
    //
    //    The persistence sampler starts HERE, before the key, because the fact
    //    the flip rows below need is the state a session was born in and that
    //    state is gone within one management round trip. Started after the
    //    birth, a sampler can only ever record the destination.
    const persistence = new PersistenceSampler(opts.handle);
    opts.toggleGodview();
    const opened = await deck.until(
      (facts) => facts.active && facts.panes >= 1,
      "the overlay to open with the workspace's own first pane",
      90_000,
    );
    const freeShell = opened.sessionIds[0]!;
    // "React mounted a workspace" and "the deck draws" are different claims,
    // and only the second is worth recording — the render worker names its
    // backend only once it has stood a renderer up against a mounted surface.
    // Bounded and non-fatal: the sessions are the pass condition, the backend
    // is evidence about HOW it drew.
    verdict["rendererBackend"] = await deck
      .until(
        (facts) => facts.rendererBackend !== "starting",
        "the render worker to name its backend",
        20_000,
      )
      .then((facts) => facts.rendererBackend)
      .catch(() => opened.rendererBackend);

    // 1b. THE MONITOR ROW (GT-3m). The stage above the deck, on the registry's
    //     default view, with the mock field on it and WEARING ITS LABEL.
    //
    //     The label is the assertion that earns this row. Everything the monitor
    //     draws is invented, and GT-D13 makes saying so a law rather than a
    //     courtesy — so the smoke fails if the words are missing, exactly as it
    //     would for a pane that lied about its shell. The other two facts are
    //     structure, not pixels: which view mounted, and that it has rows. What
    //     it LOOKS like is James's eye, as with the glass.
    const monitor = JSON.parse(await monitorLine) as MonitorFacts;
    verdict["monitorView"] = monitor.viewId;
    verdict["monitorAgents"] = monitor.agents;
    verdict["swarmPhysics"] = monitor.swarmPhysics;
    if (monitor.viewId !== "swarm") {
      throw new Error(`the monitor opened on "${monitor.viewId}", not the default swarm`);
    }
    if (!(monitor.agents > 0)) {
      throw new Error("the monitor stage mounted with no agents on it");
    }
    // The disclosure is read OFF THE SCREEN, not off the marker.
    //
    // The marker's `mockLabel` is the pure function's return value, and the law
    // GT-D13 states is about what a person can read — so a chip deleted from
    // the DOM, or moved off-screen, or rendered empty, left the marker saying
    // the right sentence while the stage said nothing at all. `readMonitorAck`
    // already had this right for the acknowledgement; this is the same reading
    // for the label beside it, and the marker becomes the corroboration rather
    // than the evidence.
    const mockChip = await readMonitorMockChip(win, 20_000);
    verdict["monitorMockChip"] = mockChip;
    verdict["monitorMockLabel"] = monitor.mockLabel;
    if (!mockChip.includes("mock")) {
      throw new Error(
        `the monitor is showing ${monitor.agents} invented agents without saying so on screen (chip: ${JSON.stringify(mockChip)}, marker said: ${JSON.stringify(monitor.mockLabel)})`,
      );
    }
    // GT-4: the label's claim must also be SCOPED once real rows join it —
    // "these are mock" over a real remote session is the lie GT-D17 forbids.
    // With no peer serving there is nothing to scope and the whole-stage
    // sentence is correct, which is why this row reads the counts and not a
    // fixed string.
    if (monitor.remoteSessions > 0 && !/\d/.test(mockChip)) {
      throw new Error(
        `${monitor.remoteSessions} real remote session(s) are sitting under an unscoped mock label: ${JSON.stringify(mockChip)}`,
      );
    }
    // GT-3c: the substrate, pinned. The swarm's physics has an honest fallback
    // for a renderer that cannot start a worker (a fixture under happy-dom is
    // one), and a fallback that shipped would look EXACTLY like the slice
    // working while undoing it. This row is the only thing standing between
    // those two states, so it asserts rather than reports.
    if (monitor.swarmPhysics !== "worker") {
      throw new Error(
        `the swarm is simulating "${monitor.swarmPhysics}", not in its worker — GT-D16's whole point is that this runs off the main thread`,
      );
    }

    // The pane is a FLOOR session, not a renderer's idea of one.
    const afterOpen = await untilFloor(
      opts.handle,
      (terminals) => terminals.some((terminal) => terminal.sessionId === freeShell),
      `listed the pane the workspace created for itself (${freeShell})`,
      15_000,
    );
    verdict["freeShellCreated"] = afterOpen.length > before.length;

    // 2. THE TOMBSTONE ROW. Type into that pane and ask it what it is. Before
    //    GT-2e the deck handed the workspace `defaultShell: "/bin/sh"` for a
    //    door it believed was never taken — the door WAS taken, and James's
    //    first real look at the deck found an `sh-3.2$` prompt. `$0` now has to
    //    name the user's actual shell, resolved by main and delivered on the
    //    connect.
    const asked = await askPane(opts.handle, freeShell, join(scratch, "echo.txt"), "$0");
    const expected = expectedLoginShell();
    verdict["echo"] = asked.marker;
    verdict["paneShell"] = asked.value;
    verdict["expectedShell"] = expected;
    if (shellName(asked.value) !== shellName(expected)) {
      throw new Error(
        `the workspace's own door spawned ${asked.value}, not the user's shell ${expected}`,
      );
    }
    if (shellName(asked.value) === "sh") {
      throw new Error("the deck is back to /bin/sh — the sh-3.2$ pane has returned");
    }

    // 3. THE FLIP ROW (GT-D11). That pane was born through a workspace door,
    //    and those doors hardcode `terminate-with-app` — the opposite of this
    //    product's daemon-lifetime promise. field-native watches
    //    `session-created` and re-governs ownerless births to keep-until-exit.
    //    Polling past the observed-inventory lag proves the WHOLE chain: the
    //    G9 event, the native flip, and the observed roundtrip fieldd reports.
    await untilFloor(
      opts.handle,
      (terminals) => persistenceOf(terminals, freeShell) === "keep-until-exit",
      `re-govern the workspace's own pane ${freeShell} to keep-until-exit`,
      20_000,
    );
    verdict["firstPaneRegoverned"] = true;
    // …and the PRECONDITION, which the destination alone cannot prove. If a
    // ghosttea upgrade started defaulting workspace panes to keep-until-exit,
    // the native flip would be dead code and every row above would stay green.
    //
    // MEASURED (GT-5a) and reported rather than asserted, because the
    // measurement says asserting it is not possible from here: sampling
    // `terminal.list` every 50ms from BEFORE this pane was born — the earliest
    // any observed inventory can be asked — caught `terminate-with-app` zero
    // times, for either pane. field-native re-governs the birth on its own
    // `session-created` event, inside the floor, and fieldd's observed
    // inventory is a management round trip behind that; the pre-flip state is
    // over before the plane that could report it has heard of the session. So
    // the trail is `["keep-until-exit"]` on a working flip AND on a dead one,
    // and a row that failed on it would fail always. The trails are in the
    // verdict so the fact is on the record every run, and the residual is named
    // where it belongs: this smoke proves the DESTINATION, not the flip.
    verdict["firstPaneTrail"] = persistence.trail(freeShell);

    // 4. Split — the workspace's own ⌘D, through the workspace's OWN create
    //    door now that the deck no longer intercepts it. The new session is a
    //    floor session, and it is re-governed exactly like the first.
    await focusDeck(win);
    verdict["focusAtSplit"] = await focusReport(win);
    const panesBeforeSplit = opened.panes;
    pressChord(win, "d");
    // ONE MORE than there were, not "at least two". The deck opens with one
    // pane today, so the two readings agree by accident — and an accident is
    // exactly what a harness must not rest on: a deck that came up with two
    // panes would satisfy `>= 2` before the key was ever pressed.
    const split = await deck.until(
      (facts) => facts.panes === panesBeforeSplit + 1,
      `⌘D to split the deck's ${panesBeforeSplit} pane(s) into ${panesBeforeSplit + 1} (focus: ${String(verdict["focusAtSplit"])})`,
      45_000,
    );
    const splitSession = split.sessionIds.find((id) => id !== freeShell);
    if (splitSession === undefined) throw new Error("the split pane carries no new session");
    await untilFloor(
      opts.handle,
      (terminals) => persistenceOf(terminals, splitSession) === "keep-until-exit",
      `list the split session ${splitSession} re-governed to keep-until-exit`,
      20_000,
    );
    verdict["splitCreated"] = true;
    verdict["splitRegoverned"] = true;
    verdict["splitPaneTrail"] = persistence.trail(splitSession);
    // The two trails together are what makes the flip rows non-vacuous, and the
    // rule is stated where it can be checked rather than left to a reader: a
    // pane observed to have been `terminate-with-app` at any point is the
    // precondition holding. If NEITHER pane was ever caught in that state, the
    // rows above proved only that the floor ends up where we want it — which
    // is worth knowing and is not the flip.
    const caughtPreFlip = [freeShell, splitSession].some((id) =>
      persistence.trail(id).includes("terminate-with-app"),
    );
    verdict["flipPreconditionObserved"] = caughtPreFlip;
    await persistence.stop();
    // The instrumentation's own anti-vacuity guard. `flipPreconditionObserved`
    // is only worth reading if the sampler was actually running — an empty
    // trail would report "never observed" for a sampler that never looked, and
    // a measurement that reads the same whether or not it ran is not one.
    for (const [name, id] of [
      ["the workspace's first pane", freeShell],
      ["the split pane", splitSession],
    ] as const) {
      if (persistence.trail(id).length === 0) {
        throw new Error(
          `the persistence sampler never saw ${name} (${id}) at all, so its trail proves nothing about the flip`,
        );
      }
    }

    // 5. Claim. `claimExistingSessions` is first-run-only upstream (gated on
    //    there being no saved workspace), so this stages a genuine first run:
    //    a session born on the floor outside the deck, the deck's saved layout
    //    cleared, and a fresh document. That is the real scenario — a machine
    //    where field-native has been running and the app is opened onto it.
    const stranger = TerminalCreateResult.parse(
      await opts.handle.client.request("terminal.create", {}),
    ).sessionId;
    opts.toggleGodview(); // closed, so the reload comes up with the deck unmounted
    await deck.until((facts) => !facts.active, "the overlay to close", 20_000);
    // The arbitration's OTHER state, read here because this is the one moment
    // the overlay is closed with the menu installed and the deck still
    // reporting. Read together with `closeAcceleratorWhileGodviewOpen`, the two
    // fields are the whole claim — and since 2026-08-10 they are asserted, not
    // merely recorded. See `closeWindowAccelerator`.
    const closedAccel = closeWindowAccelerator();
    verdict["closeAcceleratorWhileGodviewClosed"] = closedAccel;
    if (closedAccel !== "CommandOrControl+W") {
      throw new Error(
        `the close item must HOLD ⌘W while the overlay is closed, but the live menu reports ${String(closedAccel)}`,
      );
    }
    // The two-state comparison lives at the OPEN reading below, which happens
    // later in this run — comparing here would grade against a field that does
    // not exist yet and pass for that reason alone.
    await win.webContents.executeJavaScript("localStorage.clear()");
    // 5b. GT-3f: seed the VIEWER's shader the way a returning user's would
    //     already be sitting there. The appearance store reads localStorage
    //     synchronously at module init, so the fresh document below comes up
    //     with the port chosen — the real production path, and it rides the
    //     reload this row was already doing rather than adding one.
    //
    //     A NON-animated port deliberately: the claim under test is that a
    //     viewer-local selection reached the renderer, and an animated one
    //     would make that fact depend on frame timing. Whether CRT LOOKS right
    //     is James's eye; that its id crossed is what a harness can hold.
    await win.webContents.executeJavaScript(
      `localStorage.setItem(${JSON.stringify(GODVIEW_APPEARANCE_STORAGE_KEY)}, ${JSON.stringify(
        JSON.stringify({ shaderEffect: SMOKE_SHADER_EFFECT }),
      )})`,
    );
    const reloaded = waitForConsole(win, "CANVAS_READY ", 60_000);
    reloaded.catch(() => undefined);
    deck.reset();
    await loadRenderer(win, "smoke-godview", opts.viteUrl);
    await reloaded;
    win.focus();
    win.webContents.focus();
    opts.toggleGodview(); // the fresh document's FIRST open
    const claimed = await deck.until(
      (facts) => facts.active && facts.sessionIds.includes(stranger),
      "the workspace to claim the floor session nothing in this deck created",
      90_000,
    );
    // DESIGN.md §10's review ritual asks UI changes for a screenshot, and this
    // is the one moment the deck is fully itself: three panes, one adopted, all
    // live. `VF_SMOKE_SHOT=<path>` takes it; the settle is for the render worker,
    // which draws when it is ready and not when a harness asks.
    const shotPath = process.env["VF_SMOKE_SHOT"];
    if (shotPath !== undefined && shotPath !== "") {
      await sleep(5_000);
      writeFileSync(shotPath, (await win.capturePage()).toPNG());
    }
    verdict["claimedExisting"] = true;
    verdict["panesAfterClaim"] = claimed.panes;

    // 6. Close a pane — and watch the session go on living (GT-D5). The deck
    //    detaches; nothing kills. Ghosttea's own closePane removes the pane
    //    from the layout and sends the floor nothing at all, which is the law
    //    this asserts rather than assumes.
    await focusDeck(win);
    const panesBeforeClose = claimed.panes;
    // THE ARBITRATION, read where it matters: the overlay is open, so this is
    // the state in which the close item is supposed to have released ⌘W. See
    // `closeWindowAccelerator` for what this proves, what it found, and what it
    // cannot reach.
    if (Menu.getApplicationMenu() === null) {
      throw new Error(
        "no application menu is installed, so the ⌘W arbitration this row is about is not in place — which is exactly the state this smoke was in before GT-5a",
      );
    }
    const openAccel = closeWindowAccelerator();
    verdict["closeAcceleratorWhileGodviewOpen"] = openAccel;
    // THE HANDOVER, asserted rather than recorded (2026-08-10). The closed
    // reading is taken earlier in this same run, so both fields are real by now.
    // An item still holding a chord here is the defect this row exists for; an
    // item reporting the SAME thing in both states is that defect's signature.
    const closedReading = verdict["closeAcceleratorWhileGodviewClosed"];
    if (openAccel !== null) {
      throw new Error(
        `the close item must RELEASE ⌘W while the overlay is open, but the live menu reports ${openAccel} — a role-bearing item inherits CommandOrControl+W no matter what the model omits`,
      );
    }
    if (openAccel === closedReading) {
      throw new Error(
        `the ⌘W handover released nothing: the live menu reports ${String(openAccel)} in BOTH overlay states — the defect measured on Electron 43.1.1 and fixed by dropping the role`,
      );
    }
    pressChord(win, "w");
    const closed = await deck.until(
      (facts) => facts.panes === panesBeforeClose - 1,
      "⌘W to close one pane",
      45_000,
    );
    const detached = claimed.sessionIds.find((id) => !closed.sessionIds.includes(id));
    if (detached === undefined) throw new Error("no pane actually left the deck");
    // A settle long enough for a kill to have travelled, then the only question
    // that matters. The lag runs both ways: an inventory that has not yet
    // NOTICED a death would read as survival, so this waits well past the
    // observed round trip before believing the good news.
    await sleep(2_000);
    const afterClose = await listTerminalsWhenObserved(opts.handle);
    const survivor = afterClose.find((terminal) => terminal.sessionId === detached);
    if (survivor === undefined) {
      throw new Error(`closing a pane KILLED session ${detached} — GT-D5 broken`);
    }
    if (survivor.exited === true) {
      throw new Error(`closing a pane ended session ${detached} — GT-D5 broken`);
    }
    verdict["closedPaneSurvived"] = detached;
    verdict["panesAfterClose"] = closed.panes;

    // 7. RESTORE, the silent case (GT-3). The document dies and comes back
    //    while the floor does not: same panes, same session ids, and — the
    //    assertion that is about a face NOT being drawn — no consent prompt.
    //    Nothing was lost, so there is nothing to ask, and a prompt here would
    //    be the deck training its user to dismiss the one that matters.
    const beforeReload = [...closed.sessionIds];
    await reopenAfterReload({
      win,
      deck,
      toggleGodview: opts.toggleGodview,
      viteUrl: opts.viteUrl,
    });
    const restored = await deck.until(
      (facts) => facts.active && facts.panes === closed.panes,
      "the deck to come back with the panes it had",
      90_000,
    );
    // The prompt that must not have been drawn, asked of the WHOLE reopen
    // window rather than of the line that happened to be last. Reading
    // `restored.consent` was unreachable code: consent is published with zero
    // panes and the wait above only returns on `panes === closed.panes`, so the
    // marker in hand could never be a consent marker — the face could have been
    // up, answered and gone, and this row would have read the deck that came
    // after it. `deck.history()` starts at the reset inside `reopenAfterReload`,
    // which is exactly the window this claim is about.
    const promptedDuringRestore = deck.history().filter((facts) => facts.consent !== undefined);
    if (promptedDuringRestore.length > 0) {
      throw new Error(
        `an all-alive restore asked for consent it did not need: ${JSON.stringify(
          promptedDuringRestore.map((facts) => facts.consent),
        )}`,
      );
    }
    const rejoined = beforeReload.every((id) => restored.sessionIds.includes(id));
    if (!rejoined) {
      throw new Error(
        `panes did not rejoin their sessions: had ${beforeReload.join(",")}, got ${restored.sessionIds.join(",")}`,
      );
    }
    verdict["restoredSilently"] = true;
    verdict["restoredSessionIds"] = restored.sessionIds;

    // 8. THE LATENCY PROBE (report-only). A number the v0.3 review asked for,
    //    with no threshold attached — see `measureKeystrokeEcho` for exactly
    //    what the interval spans, because the name alone would over-promise.
    await focusDeck(win);
    const probe = await measureKeystrokeEcho(
      win,
      opts.handle,
      restored.sessionIds[0]!,
      join(scratch, "latency.txt"),
    );
    if ("ms" in probe) verdict["keystrokeEchoMs"] = probe.ms;
    else verdict["keystrokeEchoMs"] = { unmeasured: probe.skipped };

    // 9. THE DEGRADE ROW (GT-3, GT-D8). Move a pane into a distinctive folder,
    //    kill its session out from under the deck, and reopen: the deck must
    //    ASK, with honest counts, and a restore must relaunch that pane WHERE
    //    IT WAS. The cwd is the whole point of `paneMeta` — a shell reborn at
    //    `$HOME` is a shell that lost the work it was next to.
    //
    //    A plain `cd` is all it takes, and that is itself the finding: a
    //    session's cwd comes ONLY from what the shell announces over OSC 7 (the
    //    spawn directory is never reported), and this user's zsh announces it
    //    on every prompt. What the floor then reports is that announcement
    //    VERBATIM — a `file://host/path` URL, not a path — which is why the
    //    deck decodes it before spawning anything.
    const workdir = join(scratch, "work");
    mkdirSync(workdir, { recursive: true });
    const doomed = restored.sessionIds[0]!;
    await runInPane(opts.handle, doomed, join(scratch, "cd.txt"), `cd ${workdir}`);
    const withCwd = await untilFloor(
      opts.handle,
      (terminals) => cwdPath(terminals.find((t) => t.sessionId === doomed)?.cwd) === workdir,
      `report ${doomed} sitting in ${workdir} (a pane's cwd is only ever what its shell announced over OSC 7)`,
      20_000,
    );
    const recorded = withCwd.find((t) => t.sessionId === doomed)?.cwd;
    verdict["recordedCwd"] = recorded;
    // The layout has to have PERSISTED that cwd before the session dies —
    // otherwise the restore below would be reading a meta this run never wrote.
    const layoutDeadline = Date.now() + 15_000;
    let persisted = false;
    while (Date.now() < layoutDeadline && !persisted) {
      persisted = ((await readDeckLayout(win)) ?? "").includes(workdir);
      if (!persisted) await sleep(200);
    }
    if (!persisted) throw new Error(`paneMeta never persisted the cwd ${workdir}`);
    verdict["paneMetaPersisted"] = true;

    // The kill is the FLOOR's, not the deck's — this row is about restore, and
    // the deck's own kill affordance gets its own row below.
    await opts.handle.client.request("terminal.terminate", { sessionId: doomed });
    await untilFloor(
      opts.handle,
      (terminals) => {
        const row = terminals.find((t) => t.sessionId === doomed);
        return row === undefined || row.exited === true;
      },
      `let ${doomed} go`,
      20_000,
    );

    await reopenAfterReload({
      win,
      deck,
      toggleGodview: opts.toggleGodview,
      viteUrl: opts.viteUrl,
    });
    const asking = await deck.until(
      (facts) => facts.active && facts.consent !== undefined,
      "the deck to ask before relaunching a dead pane",
      90_000,
    );
    verdict["consentShown"] = asking.consent;
    if (asking.consent?.dead !== 1 || asking.consent.saved !== closed.panes) {
      throw new Error(`the consent face miscounted: ${JSON.stringify(asking.consent)}`);
    }
    if (asking.panes !== 0) {
      throw new Error("the workspace mounted before the question was answered");
    }
    await clickDeckButton(win, "restore");
    const relaunched = await deck.until(
      (facts) => facts.consent === undefined && facts.panes === closed.panes,
      "the restored deck to come up with every pane filled",
      90_000,
    );
    const replacement = relaunched.sessionIds.find((id) => !beforeReload.includes(id));
    if (replacement === undefined) {
      throw new Error("no new session was created for the dead pane");
    }
    verdict["rehydratedSession"] = replacement;
    // `openTicket` gates on the OBSERVED inventory, a mgmt round trip behind
    // the spawn (GT-0's measured 62-117ms) — and this session was born through
    // the WORKSPACE's door, which has no ticket to answer with the way
    // `terminal.create` does. So the wait is real and belongs here.
    await untilFloor(
      opts.handle,
      (terminals) => terminals.some((t) => t.sessionId === replacement),
      `list the relaunched session ${replacement}`,
      20_000,
    );
    // The claim, proven by the pane itself: a real shell, running in the folder
    // the dead one recorded.
    const where = await askPane(opts.handle, replacement, join(scratch, "pwd.txt"), "$PWD");
    verdict["rehydratedCwd"] = where.value;
    // Compared through `realpath` because macOS answers the same directory two
    // ways: the ORIGINAL pane's zsh reported the logical `/var/folders/…` it
    // was told to `cd` into, while the relaunched one was spawned with that
    // path and reports the physical `/private/var/folders/…` the symlink
    // resolves to. Same folder, two spellings — and a string compare would call
    // a working restore a failure.
    if (realpathSync(where.value) !== realpathSync(workdir)) {
      throw new Error(`the relaunched pane came up in ${where.value}, not ${workdir}`);
    }

    // 10. THE KILL ROW (GT-D5). Closing a pane detaches (row 6); killing is a
    //     separate, audited, confirmed act. Driven through the deck's own
    //     affordance — two clicks, because one would be the bug.
    await focusDeck(win);
    // The chip acts on the ACTIVE pane and names no session on screen, so the
    // target is read from the deck rather than chosen here — asserting about a
    // session the chip was never pointed at would be a test of nothing.
    const active = await deck.until(
      (facts) => facts.panes === closed.panes && facts.activeSessionId !== undefined,
      "the deck to name its active pane",
      20_000,
    );
    const killTarget = active.activeSessionId!;
    await clickDeckButton(win, "kill session");
    await clickDeckButton(win, "kill");
    // Two proofs, one for each plane. The floor: the session ends. The
    // renderer: the pane ADMITS it, which no floor query can show.
    await untilFloor(
      opts.handle,
      (terminals) => {
        const row = terminals.find((t) => t.sessionId === killTarget);
        return row === undefined || row.exited === true;
      },
      `end ${killTarget} on the deck's own kill`,
      20_000,
    );
    verdict["killedSession"] = killTarget;
    const degraded = await deck.until(
      (facts) =>
        (facts.exitedSessionIds ?? []).includes(killTarget) ||
        !facts.sessionIds.includes(killTarget),
      "the killed pane to degrade honestly",
      30_000,
    );
    verdict["killedPaneFace"] = (degraded.exitedSessionIds ?? []).includes(killTarget)
      ? "exited"
      : "pane dropped";

    // 11. THE CONFIG ROW (GT-3 rider). A real write through the product door,
    //     the floor's own reload verdict, and the one property that matters
    //     more than any restyle: nothing died for a settings change.
    const beforeConfig = await listTerminalsWhenObserved(opts.handle);
    const document = TerminalConfigDocument.parse(
      await opts.handle.client.request("terminal.config.read", {}),
    );
    verdict["configPath"] = document.path;
    verdict["configExisted"] = document.exists;
    // THE SHADER-LEAK CAPTURE, and it has to happen HERE — before the write.
    //
    // The viewer chose its shader at row 5b, many rows ago. Row 11c used to
    // prove "no leak" by reading the file back AFTER this write and comparing
    // it to the bytes this write put there — but the write below OVERWRITES the
    // whole document, so a genuine leak from 5b was destroyed by the very row
    // that then certified its absence. These are the bytes that carry the
    // answer: everything the appearance path could have written since 5b is in
    // them, and nothing this harness wrote is.
    const configBeforeWrite = document.exists ? document.text : "";
    verdict["configBytesBeforeWrite"] = configBeforeWrite.length;
    // GT-3v: the written text now carries an APPEARANCE-class key. It is the
    // interesting case for this document precisely because 0.9.0 gave the same
    // concept a second, viewer-local home — so the write proves the device file
    // still owns its key, and the deck's own glass (asserted below) proves the
    // two homes do not leak into one another.
    const configText = `# written by pnpm smoke:godview\nfont-size = 13\nbackground-opacity = ${SMOKE_CONFIG_BACKGROUND_OPACITY}\n`;
    const glassBefore = deck.current()?.glass;
    if (glassBefore === undefined) {
      throw new Error("the deck reported no glass before the config write");
    }
    const wrote = TerminalConfigWriteResult.parse(
      await opts.handle.client.request("terminal.config.write", {
        text: configText,
        revision: document.revision,
      }),
    );
    verdict["configOk"] = wrote.ok;
    verdict["configEffectiveChanged"] = wrote.effectiveChanged;
    // The messages and not just a count: "1 diagnostic" is a number nobody can
    // act on, and the loader's own words are the only honest record of what it
    // made of the file.
    verdict["configDiagnostics"] = wrote.diagnostics.map(
      (diagnostic) => `${diagnostic.severity}: ${diagnostic.code} — ${diagnostic.message}`,
    );
    if (!wrote.ok) {
      throw new Error(`the floor refused a benign config: ${JSON.stringify(wrote.diagnostics)}`);
    }
    if (readFileSync(document.path, "utf8") !== configText) {
      throw new Error(`the config file does not hold what was written: ${document.path}`);
    }
    // `effectiveChanged` is the floor's own verdict that the reload moved its
    // effective configuration — which for an appearance key is the round trip
    // worth naming: the document authority accepted it, the loader read it, and
    // it landed somewhere real rather than being parsed and dropped.
    if (!wrote.effectiveChanged) {
      throw new Error("background-opacity reached the file but changed no effective configuration");
    }
    // A settings change must not be a kill. Read PAST the observed round trip
    // before believing the good news, the same way row 6 does.
    await sleep(2_000);
    const afterConfig = await listTerminalsWhenObserved(opts.handle);
    const lost = beforeConfig
      .filter((row) => row.exited !== true)
      .filter(
        (row) => !afterConfig.some((now) => now.sessionId === row.sessionId && now.exited !== true),
      );
    if (lost.length > 0) {
      throw new Error(`a config reload ended ${lost.map((row) => row.sessionId).join(",")}`);
    }
    verdict["configSurvivors"] = afterConfig.length;

    // 11b. THE GLASS ROW (GT-3v / GT-D12). Structure, not pixels — whether the
    //      result looks right is James's eye; that a non-opaque background
    //      reached the RENDERER is a fact, and so is which home it came from.
    const glassAfter = deck.current()?.glass;
    if (glassAfter === undefined) throw new Error("the deck stopped reporting its glass");
    verdict["glassPaneAlpha"] = glassAfter.paneBackgroundAlpha;
    verdict["glassThemeName"] = glassAfter.themeName;
    if (!(glassAfter.paneBackgroundAlpha < 1)) {
      throw new Error(
        `the deck handed the renderer an opaque pane background (${glassAfter.paneBackgroundAlpha})`,
      );
    }
    // The other direction, and the one a regression would take: appearance is
    // the VIEWER's (GT-D12), so the value just written into the DEVICE file must
    // not have moved this deck. If these ever agree, the two homes have merged
    // and GT-5's phone would inherit this desktop's glass.
    if (glassAfter.paneBackgroundAlpha !== glassBefore.paneBackgroundAlpha) {
      throw new Error(
        `the device config moved the viewer's appearance: ${glassBefore.paneBackgroundAlpha} → ${glassAfter.paneBackgroundAlpha}`,
      );
    }
    // THE NEGATIVE CONTROL, and without it the row above proves nothing on a
    // machine that has run this smoke before. "Did not change" is satisfied by
    // a deck that was ALREADY holding the device file's value — a fully merged
    // home on a persisted data dir looks identical to two separate ones. So the
    // claim is also stated positively: the viewer's alpha is not the number the
    // device document holds.
    for (const [when, alpha] of [
      ["before", glassBefore.paneBackgroundAlpha],
      ["after", glassAfter.paneBackgroundAlpha],
    ] as const) {
      if (alpha === SMOKE_CONFIG_BACKGROUND_OPACITY) {
        throw new Error(
          `the viewer's glass ${when} the write IS the device file's background-opacity (${alpha}) — the two homes have merged, or this deck inherited the device value from a previous run`,
        );
      }
    }

    // 11c. THE EFFECTS ROW (GT-3f / petition G11). The same two-homes law as
    //      the glass, now for the third of appearance that could not be
    //      viewer-local until 0.9.1 — and it is proven in both directions,
    //      because one direction alone is what a regression would satisfy.
    //
    //      Direction one: the port this viewer chose reached the renderer. The
    //      deck reads this off the object it actually handed the workspace, so
    //      the line is what the panes were told and not what the store holds.
    const effects = deck.current()?.effects;
    if (effects === undefined) throw new Error("the deck stopped reporting its effects");
    verdict["shaderEffect"] = effects.shaderEffect;
    verdict["shaderAnimate"] = effects.animate;
    if (effects.shaderEffect !== SMOKE_SHADER_EFFECT) {
      throw new Error(
        `the viewer's shader never reached the renderer: expected ${SMOKE_SHADER_EFFECT}, deck reported ${String(effects.shaderEffect)}`,
      );
    }
    // Direction two: choosing it wrote NOTHING into the device document — and
    // the bytes that answer that are the ones captured BEFORE row 11's write.
    //
    // This row used to read the file back afterwards and compare it to the
    // exact text row 11 had just written, which cannot fail for the reason it
    // claims: the write replaces the whole document, so a genuine leak from row
    // 5b was erased by the write and the read-back could only ever agree with
    // itself. `configBeforeWrite` is the document as it stood after the viewer
    // had chosen a shader and before this harness touched it, so a
    // `custom-shader` key, a managed block, or the port id in any spelling is
    // still in it if the appearance path put one there.
    //
    // Named weakness, measured: on a fresh data dir the document does not exist
    // yet, so these bytes are empty and the check passes easily. Not vacuous —
    // a leak has to CREATE or extend that file, and creating it is exactly what
    // is being watched for — but a weaker pass than it looks, and `configExisted`
    // is in the verdict so a reader can tell which of the two runs they had.
    const shaderLeak = [SMOKE_SHADER_EFFECT, SMOKE_SHADER_EFFECT.split(":").pop() ?? "", "shader"]
      .filter((needle) => needle !== "")
      .filter((needle) => configBeforeWrite.includes(needle));
    if (shaderLeak.length > 0) {
      throw new Error(
        `the viewer's shader leaked into the device config document (${shaderLeak.join(", ")} present before this harness wrote anything): ${JSON.stringify(configBeforeWrite)}`,
      );
    }
    // …and it did not appear between that read and now either. Cheap, and it
    // covers the window this harness itself opened.
    const configAfterShader = readFileSync(document.path, "utf8");
    if (configAfterShader !== configText) {
      throw new Error(
        `the device config document changed under the smoke after its write: ${JSON.stringify(configAfterShader)}`,
      );
    }
    verdict["shaderLeftConfigAlone"] = true;

    // 12. The recovery row, inherited from the GT-1 spike: SIGKILL the bridge
    //    and watch the deck come back on a new runtime with the same sessions.
    //    field-native owns them; the bridge is only a pipe.
    //
    //    The survivor set is whatever the deck holds NOW — rows 9 to 11 have
    //    moved it since the close row, and a recovery that had to reproduce a
    //    stale list would be asserting about a deck that no longer exists.
    //    The killed session is excluded: a rebuild does not resurrect, and
    //    demanding it back would make a passing recovery impossible.
    //    THIS ROW HAD TO BE ABLE TO FAIL, and until GT-5a it could not.
    //
    //    It read the pre-kill marker, derived its expectations from that same
    //    marker, killed the bridge, and then asked `until` for a state the
    //    marker in hand already satisfied by construction — and `until`
    //    short-circuits on a marker it already holds. It returned instantly,
    //    reported the PRE-kill backend, and stayed green with the entire
    //    recovery ladder deleted. Eight slices cited it as their recovery proof.
    //
    //    What makes it evidence now is the reset plus the SEQUENCE. The
    //    expectations are still read from the pre-kill deck — that is what they
    //    are about — but the watch is emptied before the kill, and the row then
    //    waits for two states in order that no pre-kill marker can supply:
    //
    //      · the deck admitting the bridge DIED — `error` is the renderer's own
    //        record of receiving `bridge-down`, and a healthy deck has none;
    //      · the deck back with no error and every survivor — which it can only
    //        reach by having received `bridge-up`, retired the dead runtime and
    //        remounted, because that is the only path that clears the error.
    //
    //    Delete the ladder now and the first wait still passes (the death is
    //    real) while the second times out with the deck's own words in the
    //    message. Demonstrated, not assumed — see the slice's commit body.
    const current = deck.current();
    if (current === null) throw new Error("the deck said nothing before the bridge kill");
    const survivors = current.sessionIds.filter((id) => id !== killTarget);
    const panesBeforeKill = current.panes;
    if (current.error !== undefined) {
      throw new Error(
        `the deck was already reporting an error before the bridge kill, so a post-kill error would prove nothing: ${current.error}`,
      );
    }
    deck.reset();
    const pid = killTerminalBridge();
    if (pid === null) throw new Error("no ghosttea bridge utility process to kill");
    verdict["bridgeKilledPid"] = pid;
    const noticed = await deck.until(
      (facts) => facts.error !== undefined,
      "the deck to notice the bridge died (main's bridge-down reaching the page)",
      60_000,
    );
    verdict["bridgeDownFace"] = noticed.error;
    const recovered = await deck.until(
      (facts) =>
        facts.active &&
        facts.error === undefined &&
        facts.panes === panesBeforeKill &&
        survivors.every((id) => facts.sessionIds.includes(id)),
      "the deck to rebuild itself on a new bridge with the same sessions",
      120_000,
    );
    verdict["recoveredPanes"] = recovered.panes;
    verdict["recoveredBackend"] = recovered.rendererBackend;
    await untilFloor(
      opts.handle,
      (terminals) => survivors.every((id) => terminals.some((t) => t.sessionId === id)),
      "still listed every session after the bridge died",
      15_000,
    );

    // ── 13. THE GT-4 DOOR ROWS (GT-D17) ───────────────────────────────────
    //
    // Placed after the recovery deliberately: an attach REPLACES what the
    // active pane is showing, and every row above asserts about the sessions
    // this deck was holding. Nothing below them asserts anything.
    //
    // 13a. THE SPLIT-HONESTY ROW, and it runs on every machine: a mock agent
    //      still mounts NOTHING. The monitor now has a real door beside it, so
    //      "the stage holds no runtime" stopped being the structural guarantee
    //      it was at GT-3m — this row is what replaces that guarantee with a
    //      measurement.
    //
    //      The claim is asserted two ways, and NEITHER is "the pane ids did not
    //      change" — the first draft of this row said that and failed twice on
    //      a truth about the deck rather than about the click: the pane whose
    //      session row 10 killed rehydrates into a fresh shell some seconds
    //      after the recovery above reports, and the id it replaces is exactly
    //      `killedSession`. What holds regardless:
    //
    //        · the pane COUNT is unchanged (a mount that split would raise it)
    //        · every pane holds a session THE FLOOR KNOWS
    //
    //      The second is the one that means what this row is about. The mock's
    //      sessions are inventions — they exist in a seeded generator and
    //      nowhere else — so an invented row reaching a pane could only ever
    //      put an id there that `terminal.list` has never heard of, and the
    //      rehydrated shell (a real floor session) passes it untouched.
    const beforeMockClick = await deckSettled(deck, 2_000, 60_000);
    const mockClicked = await clickMonitorBubble(win, ".vf-monitor-bubble:not(.is-remote)");
    verdict["mockBubbleClicked"] = mockClicked;
    // Quiescence, not a stopwatch. The BEFORE of this comparison already waits
    // for the deck to stop moving and for exactly the right reason (the pane
    // the kill row ended rehydrates seconds later, on the machine's schedule
    // and not ours) — so an AFTER read off a fixed 1.5s sleep was sampling
    // into the same window the BEFORE was written to avoid. If a mock click
    // DID mount something, the deck moves and this waits for it to finish
    // moving; the assertions below then read a settled deck either way.
    const afterMockClick = await deckSettled(deck, 1_500, 45_000);
    const mockAck = await readMonitorAck(win);
    verdict["mockAck"] = mockAck;
    // The words a person would have read. GT-D13 makes the acknowledgement the
    // mock's whole answer, so a silent mock is as wrong as a mounting one.
    if (!mockAck.includes("nothing was mounted")) {
      throw new Error(
        `the preview acknowledged a mock selection without saying nothing was mounted: ${JSON.stringify(mockAck)}`,
      );
    }
    if (afterMockClick.panes !== beforeMockClick.panes) {
      throw new Error(
        `clicking an invented agent changed the deck's shape (${beforeMockClick.panes} → ${afterMockClick.panes} panes)`,
      );
    }
    const paneSessions = afterMockClick.sessionIds;
    await untilFloor(
      opts.handle,
      (terminals) => paneSessions.every((id) => terminals.some((t) => t.sessionId === id)),
      `list every session the deck's panes hold after a mock click (${JSON.stringify(paneSessions)}) — an invented agent that mounted would put an id here the floor never created`,
      20_000,
    );
    verdict["mockMountsNothing"] = true;
    verdict["mockPaneSessions"] = paneSessions.length;

    // 13b. THE DOOR ROW. A peer's session is a bubble in the swarm, and
    //      CLICKING it attaches the active pane to it — no palette anywhere in
    //      this path (⌘⇧O stays off; GT-D7's amendment).
    //
    //      Behind an honest capability check, because a peer is not something
    //      this harness can conjure: the mesh floor is GT-4's other half, and
    //      two floors on a tailnet are not stageable here yet. With no peer the
    //      row REPORTS `unavailable` with the monitor's own state — it never
    //      fakes a host, and it never passes silently as though it had run.
    const monitorNow = monitorWatch.current();
    verdict["remoteState"] = monitorNow?.remoteState ?? "unreported";
    verdict["remoteSessions"] = monitorNow?.remoteSessions ?? 0;
    verdict["remoteHosts"] = monitorNow?.remoteHosts ?? 0;
    if (monitorNow?.remoteReason !== undefined) verdict["remoteReason"] = monitorNow.remoteReason;
    if (monitorNow === null || monitorNow === undefined || monitorNow.remoteSessions === 0) {
      // The monitor asked and got nothing, or had nobody to ask. Both are
      // states with names, and neither is a remote session.
      verdict["remotePeer"] = "unavailable";
    } else {
      verdict["remotePeer"] = "available";
      const beforeAttach = deck.current();
      if (beforeAttach === null) throw new Error("the deck said nothing before the attach");
      const attachedLabel = await clickMonitorBubble(win, ".vf-monitor-bubble.is-remote");
      verdict["remoteBubbleClicked"] = attachedLabel;
      const attached = await deck.until(
        (facts) =>
          facts.activeSessionId !== undefined &&
          !beforeAttach.sessionIds.includes(facts.activeSessionId),
        "the active pane to be showing the peer's session",
        30_000,
      );
      verdict["remoteAttachedSessionId"] = attached.activeSessionId ?? null;
      verdict["remoteAttachAck"] = await readMonitorAck(win);
      // The pane COUNT is unchanged: GT-D17 attaches the pane the user is in,
      // it does not split one open. That is the difference between our door
      // and upstream's palette, and it is worth asserting rather than assuming.
      if (attached.panes !== beforeAttach.panes) {
        throw new Error(
          `the attach changed the deck's shape (${beforeAttach.panes} → ${attached.panes} panes); GT-D17 attaches the ACTIVE pane`,
        );
      }
    }

    // ── GT-3p, REPORT-ONLY ────────────────────────────────────────────────
    // Everything below records numbers and asserts nothing. A performance row
    // that could fail this smoke would be a budget nobody has agreed to yet
    // (the `keystrokeEchoMs` precedent, GT-3), and these numbers move with
    // machine load — the same load that already makes the reload rows flaky.
    //
    // THE COLD OPEN, and it is genuinely cold even though the prewarm is on:
    // row 1 presses ⇧⇧ the moment the canvas reports, and `claimWarmTransport`
    // deliberately never blocks an open on a warm still in flight (GT-D14) — so
    // the first open of this harness takes the cold path by construction, and
    // `prewarmed: false` in this object is the proof rather than a disappointment.
    // It is the BEFORE number, measured on the same run as the after.
    verdict["coldOpen"] = await coldOpenLine
      .then((raw) => JSON.parse(raw) as Record<string, unknown>)
      .catch((error) => ({ unmeasured: error instanceof Error ? error.message : String(error) }));

    // The steady-state frame cost, sampled from the page itself while the
    // overlay is open with the swarm running and a pane focused. One second of
    // rAF intervals; the median is the honest summary of a sample this short.
    //
    // GT-3c crosses the cadence with LoAF, which is `frame-stats.ts`'s own pairing
    // (its module note: neither source alone is a diagnosis, their disagreement
    // is). Cadence says whether frames are late; `blockingMs` says how much of
    // the lateness the main thread owes. A slice that moves work OFF the main
    // thread is supposed to leave the first number alone and shrink the second —
    // and LoAF reporting zero in both directions is itself a finding, not a
    // failure, because a swarm this small may never build a 50ms frame to be
    // seen. Still report-only: it asserts nothing.
    verdict["frameMs"] = await win.webContents
      .executeJavaScript(
        `new Promise((resolve) => {
          const intervals = [];
          const loaf = [];
          let observer = null;
          try {
            observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                loaf.push({
                  duration: entry.duration,
                  blocking: entry.blockingDuration ?? 0,
                  script: entry.scriptDuration ?? 0,
                });
              }
            });
            observer.observe({ type: "long-animation-frame", buffered: false });
          } catch {
            // An engine without LoAF reports null rather than a silent zero —
            // "unobservable" and "nothing blocked" are different answers.
            observer = null;
          }
          let last = performance.now();
          const tick = (now) => {
            intervals.push(now - last);
            last = now;
            if (now - start < 1000) requestAnimationFrame(tick);
            else {
              observer?.disconnect();
              const sorted = intervals.slice(1).sort((a, b) => a - b);
              const round = (value) => Math.round(value * 10) / 10;
              resolve(sorted.length === 0 ? null : {
                frames: sorted.length,
                p50: round(sorted[Math.floor(sorted.length * 0.5)]),
                p95: round(sorted[Math.floor(sorted.length * 0.95)]),
                loafFrames: observer === null ? null : loaf.length,
                loafBlockingMs:
                  observer === null
                    ? null
                    : round(loaf.reduce((total, entry) => total + entry.blocking, 0)),
                loafScriptMs:
                  observer === null
                    ? null
                    : round(loaf.reduce((total, entry) => total + entry.script, 0)),
                loafWorstMs:
                  observer === null
                    ? null
                    : round(loaf.reduce((worst, entry) => Math.max(worst, entry.duration), 0)),
              });
            }
          };
          const start = performance.now();
          requestAnimationFrame(tick);
        })`,
      )
      .catch((error) => ({ unmeasured: error instanceof Error ? error.message : String(error) }));

    // THE WARM OPEN — the AFTER number, and the row that actually tests GT-D14.
    //
    // A renderer reload resets the page's module state, so the next open is a
    // first open again; the difference from the row above is that this one WAITS
    // for the idle prewarm to land before pressing the key, which is the case a
    // real user is in (the app has been sitting there since login). The wait is
    // a plain sleep because the warm state lives in a module the page does not
    // publish — and the resulting line's own `prewarmed` field says whether the
    // transport was actually inherited, so a wait that was too short reports as
    // an honest `prewarmed: false` rather than a mislabelled number.
    //
    // The consent face is expected here: an earlier row killed a pane, so the
    // saved layout names a session the floor no longer has, and GT-3's gate asks
    // before the workspace may mount. Answering it is part of the path being
    // measured — this is the returning-user road to a pane, prompt and all.
    try {
      const warmLine = waitForConsole(win, "GODVIEW_COLD_OPEN ", 60_000);
      warmLine.catch(() => undefined);
      opts.toggleGodview();
      await deck.until((facts) => !facts.active, "the overlay to close", 20_000);
      const reloaded = waitForConsole(win, "CANVAS_READY ", 60_000);
      reloaded.catch(() => undefined);
      deck.reset();
      await loadRenderer(win, "smoke-godview", opts.viteUrl);
      await reloaded;
      win.focus();
      win.webContents.focus();
      // Long enough for the idle callback (2s ceiling) plus a ticket, a bridge
      // fork and a device request on a loaded machine.
      await sleep(5_000);
      opts.toggleGodview();
      const asked = await deck.until(
        (facts) => facts.active && (facts.panes >= 1 || facts.consent !== undefined),
        "the warm open to reach a pane or the restore question",
        60_000,
      );
      if (asked.consent !== undefined) await clickDeckButton(win, "restore");
      await deck.until((facts) => facts.panes >= 1, "the warm open's first pane", 60_000);
      verdict["coldOpenWarm"] = JSON.parse(await warmLine) as Record<string, unknown>;
    } catch (error) {
      verdict["coldOpenWarm"] = {
        unmeasured: error instanceof Error ? error.message : String(error),
      };
    }

    verdict["ok"] = true;
  } catch (error) {
    verdict["reason"] = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`SMOKE_GODVIEW failed: ${verdict["reason"]}`);
  }
  console.log(`SMOKE_GODVIEW ${JSON.stringify(verdict)}`);
  rmSync(scratch, { recursive: true, force: true });
  await teardown(opts.supervisor, opts.root, opts.beforeExit);
  app.exit(verdict["ok"] === true ? 0 : 2);
}

async function waitForLiveSurfaceLabResult(
  win: BrowserWindow,
  timeoutMs: number,
): Promise<LiveSurfaceLabRendererResult> {
  const resultExpression =
    `document.documentElement.dataset[${JSON.stringify(LIVE_SURFACE_LAB_RESULT_DATASET)}]` +
    ` ?? ""`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = (await win.webContents.executeJavaScript(resultExpression, true)) as unknown;
    if (typeof raw === "string" && raw !== "") {
      return JSON.parse(raw) as LiveSurfaceLabRendererResult;
    }
    await sleep(25);
  }
  throw new Error(`the Live Surfaces renderer did not report within ${timeoutMs}ms`);
}

async function startLiveSurfacePageServer(): Promise<{
  readonly origin: string;
  close(): Promise<void>;
}> {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07110d}canvas{width:100%;height:100%;display:block}#probe{position:fixed;z-index:2;left:4px;top:4px;width:100px;height:24px;opacity:.01}</style>
</head><body><input id="probe" aria-label="input probe"><canvas width="320" height="180"></canvas><script>
const probe=document.querySelector('#probe');window.__vfInputProof={mouseDown:0,keyDown:0};
probe.addEventListener('mousedown',()=>window.__vfInputProof.mouseDown++);
probe.addEventListener('keydown',()=>window.__vfInputProof.keyDown++);
const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');let frame=0;
function draw(now){frame++;const hue=(frame*3+location.pathname.length*17)%360;
const gradient=ctx.createLinearGradient(0,0,320,180);gradient.addColorStop(0,'hsl('+hue+' 72% 42%)');gradient.addColorStop(1,'hsl('+((hue+110)%360)+' 78% 18%)');
ctx.fillStyle=gradient;ctx.fillRect(0,0,320,180);ctx.fillStyle='rgba(255,255,255,.9)';ctx.fillRect((frame*5)%300,28,20,124);
ctx.font='600 18px system-ui';ctx.fillText(location.pathname.slice(-12),18,28);ctx.font='12px monospace';ctx.fillText(String(Math.round(now)),18,164);requestAnimationFrame(draw)}requestAnimationFrame(draw);
</script></body></html>`;
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(html);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) throw new Error("the Browser lab HTTP server did not bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface LiveSurfaceBrowserInputProof {
  readonly focused: boolean;
  readonly value: string;
  readonly mouseDown: number;
  readonly keyDown: number;
}

async function proveLiveSurfaceBrowserInput(
  runtime: BrowserLiveSurfaceRuntime,
  controlTargets: BrowserControlTargetRegistry,
  timeoutMs = 15_000,
): Promise<LiveSurfaceBrowserInputProof> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "source did not become input-ready";
  while (Date.now() < deadline) {
    try {
      const summary = runtime.summary;
      const binding = controlTargets.lookupPrivate(runtime.surfaceId);
      if (summary.state !== "live" || summary.geometry === undefined || binding === null) {
        await sleep(10);
        continue;
      }
      const contents = binding.contents as WebContents;
      const probeReady = (await contents.executeJavaScript(
        `document.querySelector("#probe") !== null`,
        true,
      )) as boolean;
      if (!probeReady) {
        await sleep(10);
        continue;
      }
      await contents.executeJavaScript(
        `(() => { const probe = document.querySelector("#probe"); probe.value = ""; window.__vfInputProof = { mouseDown: 0, keyDown: 0 }; })()`,
        true,
      );
      const revision = runtime.summary.geometry?.revision;
      if (revision === undefined) continue;
      for (const type of ["down", "up"] as const) {
        await runtime.dispatchInput({
          kind: "mouse",
          geometryRevision: revision,
          type,
          x: 12,
          y: 12,
          button: "left",
          clickCount: 1,
        });
      }
      for (const type of ["down", "up"] as const) {
        await runtime.dispatchInput({
          kind: "key",
          geometryRevision: revision,
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      }
      await runtime.dispatchInput({
        kind: "text",
        geometryRevision: revision,
        text: "vf",
      });
      await sleep(20);
      const proof = (await contents.executeJavaScript(
        `(() => ({ focused: document.activeElement?.id === "probe", value: document.querySelector("#probe")?.value ?? "", mouseDown: window.__vfInputProof?.mouseDown ?? 0, keyDown: window.__vfInputProof?.keyDown ?? 0 }))()`,
        true,
      )) as LiveSurfaceBrowserInputProof;
      if (proof.focused && proof.value === "vf" && proof.mouseDown >= 1 && proof.keyDown >= 1) {
        return proof;
      }
      lastFailure = JSON.stringify(proof);
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await sleep(10);
  }
  throw new Error(`Browser target-scoped input proof failed: ${lastFailure}`);
}

interface LiveSurfaceSckLabBase {
  readonly helperPath: string;
  readonly adapterPath: string;
}

interface LiveSurfaceSckFixtureLab extends LiveSurfaceSckLabBase {
  readonly kind: "fixture";
  readonly fixturePath: string;
  readonly sessionCount: number;
}

interface LiveSurfaceSimulatorLab extends LiveSurfaceSckLabBase {
  readonly kind: "simulator";
  readonly udid: string;
  readonly developerDir?: string;
  readonly rotate: boolean;
  readonly requireInactiveSpace: boolean;
}

interface LiveSurfaceMixedSckLab extends LiveSurfaceSckLabBase {
  readonly kind: "mixed";
  readonly fixturePath: string;
  readonly fixtureCount: number;
  readonly udid: string;
  readonly developerDir?: string;
  readonly rotate: boolean;
  readonly requireInactiveSpace: boolean;
}

type LiveSurfaceSckLab =
  | LiveSurfaceSckFixtureLab
  | LiveSurfaceSimulatorLab
  | LiveSurfaceMixedSckLab;

interface LiveSurfaceSckFixture {
  readonly pid: number;
  readonly title: string;
  dispose(): Promise<void>;
}

class LiveSurfaceHelperProcessHarness {
  #current: ChildProcessWithoutNullStreams | null = null;

  readonly spawnHelper = (
    helperPath: string,
    args: readonly string[],
  ): ChildProcessWithoutNullStreams => {
    const child = spawn(helperPath, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });
    this.#current = child;
    const clear = (): void => {
      if (this.#current === child) this.#current = null;
    };
    child.once("error", clear);
    child.once("exit", clear);
    return child;
  };

  get current(): ChildProcessWithoutNullStreams | null {
    return this.#current;
  }
}

interface LiveSurfaceHelperCrashProof {
  readonly requested: number;
  readonly completed: number;
  readonly helperExits: number;
  readonly helperLeasesReleasedByTeardown: number;
}

async function driveLiveSurfaceHelperCrashes(
  win: BrowserWindow,
  supervisor: MacosCaptureHelperSupervisor,
  harness: LiveSurfaceHelperProcessHarness,
  requested: number,
  timeoutMs: number,
): Promise<LiveSurfaceHelperCrashProof> {
  const stateExpression = `({ request: document.documentElement.dataset[${JSON.stringify(
    LIVE_SURFACE_LAB_HELPER_CRASH_REQUEST_DATASET,
  )}] ?? "", result: document.documentElement.dataset[${JSON.stringify(
    LIVE_SURFACE_LAB_RESULT_DATASET,
  )}] ?? "" })`;
  const deadline = Date.now() + timeoutMs;
  let completed = 0;
  while (completed < requested) {
    const expected = completed + 1;
    let observed = false;
    while (!observed && Date.now() < deadline) {
      const state = (await win.webContents.executeJavaScript(stateExpression, true)) as {
        readonly request: string;
        readonly result: string;
      };
      observed = state.request === String(expected);
      if (!observed && state.result.length > 0) {
        throw new Error(`renderer completed before requesting helper crash ${expected}`);
      }
      if (!observed) await sleep(10);
    }
    if (!observed) throw new Error(`renderer did not request helper crash ${expected}`);
    const child = harness.current;
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`helper crash ${expected} had no live process target`);
    }
    if (supervisor.stats.helperLeasesOutstanding === 0) {
      throw new Error(`helper crash ${expected} was not requested with a retained frame lease`);
    }
    const priorExits = supervisor.stats.helperExits;
    if (!child.kill("SIGKILL")) throw new Error(`helper crash ${expected} could not signal helper`);
    while (supervisor.stats.helperExits === priorExits && Date.now() < deadline) await sleep(10);
    if (supervisor.stats.helperExits === priorExits) {
      throw new Error(`helper crash ${expected} did not observe process teardown`);
    }
    completed = expected;
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset[${JSON.stringify(
        LIVE_SURFACE_LAB_HELPER_CRASH_ACK_DATASET,
      )}] = ${JSON.stringify(String(completed))}`,
      true,
    );
  }
  const stats = supervisor.stats;
  return {
    requested,
    completed,
    helperExits: stats.helperExits,
    helperLeasesReleasedByTeardown: stats.helperLeasesReleasedByTeardown,
  };
}

async function startLiveSurfaceSckFixture(path: string): Promise<LiveSurfaceSckFixture> {
  const child = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end();
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer | string) => {
    if (stderr.length < 4_096) stderr += String(chunk).slice(0, 4_096 - stderr.length);
  });
  const ready = await new Promise<{ pid: number; title: string }>((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error, value?: { pid: number; title: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error !== undefined) reject(error);
      else if (value !== undefined) resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (stdout.byteLength > 4_096) {
        finish(new Error("SCK fixture readiness output exceeded its bound"));
        return;
      }
      const newline = stdout.indexOf(0x0a);
      if (newline < 0) return;
      try {
        const value: unknown = JSON.parse(stdout.subarray(0, newline).toString("utf8"));
        if (
          typeof value !== "object" ||
          value === null ||
          !("ok" in value) ||
          value.ok !== true ||
          !("pid" in value) ||
          !Number.isSafeInteger(value.pid) ||
          value.pid !== child.pid ||
          !("title" in value) ||
          typeof value.title !== "string" ||
          value.title.length === 0 ||
          value.title.length > 512
        ) {
          throw new Error("SCK fixture returned invalid readiness metadata");
        }
        finish(undefined, { pid: value.pid as number, title: value.title });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      finish(
        new Error(
          `SCK fixture exited before ready (${code ?? signal ?? "unknown"})${
            stderr.length === 0 ? "" : `: ${stderr.trim()}`
          }`,
        ),
      );
    const timer = setTimeout(
      () => finish(new Error("SCK fixture did not become ready within 5s")),
      5_000,
    );
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  }).catch((error) => {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  });

  return {
    ...ready,
    dispose: async () => {
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(forceTimer);
          clearTimeout(finalTimer);
          resolve();
        };
        const forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        const finalTimer = setTimeout(finish, 3_000);
        child.once("exit", () => {
          finish();
        });
        if (!child.kill("SIGTERM") && child.exitCode !== null) finish();
      });
    },
  };
}

async function findSckFixtureSources(
  supervisor: MacosCaptureHelperSupervisor,
  fixtures: readonly LiveSurfaceSckFixture[],
): Promise<readonly MacosCaptureSource[]> {
  const deadline = Date.now() + 10_000;
  let lastSourceCount = 0;
  while (Date.now() < deadline) {
    const sources = await supervisor.enumerateWindows(true);
    lastSourceCount = sources.length;
    const matches = fixtures.map((fixture) =>
      sources.find(
        (candidate) => candidate.ownerPid === fixture.pid && candidate.title === fixture.title,
      ),
    );
    if (matches.every((source): source is MacosCaptureSource => source !== undefined)) {
      return matches;
    }
    await sleep(50);
  }
  throw new Error(
    `${fixtures.length} SCK fixture window(s) were not all enumerated among ${lastSourceCount} sources`,
  );
}

async function clickSimulatorRotate(): Promise<void> {
  const script = [
    'tell application "Simulator" to activate',
    "delay 0.5",
    'tell application "System Events"',
    '  tell process "Simulator"',
    "    repeat with candidate in windows",
    "      try",
    '        set controls to (every button of toolbar 1 of candidate whose description is "Rotate")',
    "        if (count of controls) > 0 then",
    "          click item 1 of controls",
    "          return",
    "        end if",
    "      end try",
    "    end repeat",
    "  end tell",
    "end tell",
    'error "Simulator rotate control was unavailable"',
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "/usr/bin/osascript",
      script.flatMap((line) => ["-e", line]),
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      if (stderr.length < 4_096) stderr += String(chunk).slice(0, 4_096 - stderr.length);
    });
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Simulator rotation command timed out"));
    }, 5_000);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `Simulator rotation command failed (${code ?? signal ?? "unknown"})${
              stderr.length === 0 ? "" : `: ${stderr.trim()}`
            }`,
          ),
        );
      }
    });
  });
}

interface LiveSurfaceSimulatorRotationProof {
  readonly initialEpoch: number;
  readonly finalEpoch: number;
  readonly initialLogicalSize: { readonly width: number; readonly height: number };
  readonly finalLogicalSize: { readonly width: number; readonly height: number };
  readonly sessionRestarts: number;
}

async function proveSimulatorRotation(
  runtime: IosSimulatorLiveSurfaceRuntime,
): Promise<LiveSurfaceSimulatorRotationProof> {
  const readyDeadline = Date.now() + 90_000;
  while (
    (runtime.stats.framesReceived < 3 || runtime.summary.geometry === undefined) &&
    Date.now() < readyDeadline
  ) {
    await sleep(25);
  }
  const initial = runtime.summary;
  if (runtime.stats.framesReceived < 3 || initial.geometry === undefined) {
    throw new Error("Simulator runtime produced no stable pre-rotation geometry");
  }
  await clickSimulatorRotate();
  const changedDeadline = Date.now() + 20_000;
  let final = runtime.summary;
  while (
    (final.producerEpoch <= initial.producerEpoch ||
      final.geometry === undefined ||
      (final.geometry.logicalSize.width === initial.geometry.logicalSize.width &&
        final.geometry.logicalSize.height === initial.geometry.logicalSize.height)) &&
    Date.now() < changedDeadline
  ) {
    await sleep(25);
    final = runtime.summary;
  }
  if (
    final.producerEpoch <= initial.producerEpoch ||
    final.geometry === undefined ||
    (final.geometry.logicalSize.width === initial.geometry.logicalSize.width &&
      final.geometry.logicalSize.height === initial.geometry.logicalSize.height)
  ) {
    throw new Error("Simulator runtime did not rebind after orientation changed");
  }
  return {
    initialEpoch: initial.producerEpoch,
    finalEpoch: final.producerEpoch,
    initialLogicalSize: initial.geometry.logicalSize,
    finalLogicalSize: final.geometry.logicalSize,
    sessionRestarts: runtime.stats.sessionRestarts,
  };
}

/**
 * LSF-2/3/4 standalone lab: retains the CPU/device-loss regression, then proves
 * real guarded Browser OSR through one surface, observed CPU fallback, and ten
 * concurrent shared-texture surfaces. The optional macOS phase then drives a
 * deterministic window through the production helper/adapter and same store.
 */
class LiveSurfaceImportDurationHistogram {
  static readonly maximumBucketUs = 10_000;
  readonly #buckets = new Uint32Array(LiveSurfaceImportDurationHistogram.maximumBucketUs + 2);
  #count = 0;
  #maximumMs = 0;

  observe(durationNs: bigint): void {
    const durationMs = Number(durationNs) / 1_000_000;
    const durationUs = Math.ceil(durationMs * 1_000);
    const bucket = Math.min(
      LiveSurfaceImportDurationHistogram.maximumBucketUs + 1,
      Math.max(0, durationUs),
    );
    this.#buckets[bucket] = (this.#buckets[bucket] ?? 0) + 1;
    this.#count += 1;
    this.#maximumMs = Math.max(this.#maximumMs, durationMs);
  }

  snapshot(): {
    readonly count: number;
    readonly p95Ms: number | null;
    readonly p95Overflow: boolean;
    readonly maximumMs: number;
  } {
    if (this.#count === 0) {
      return { count: 0, p95Ms: null, p95Overflow: false, maximumMs: 0 };
    }
    const rank = Math.ceil(this.#count * 0.95);
    let seen = 0;
    let p95Bucket = 0;
    for (const [bucket, count] of this.#buckets.entries()) {
      seen += count;
      if (seen >= rank) {
        p95Bucket = bucket;
        break;
      }
    }
    const p95Overflow = p95Bucket > LiveSurfaceImportDurationHistogram.maximumBucketUs;
    return {
      count: this.#count,
      p95Ms: p95Bucket / 1_000,
      p95Overflow,
      maximumMs: Math.round(this.#maximumMs * 1_000) / 1_000,
    };
  }
}

class LiveSurfaceMainDutyMeter {
  #active = false;
  #startedAtUs = 0n;
  #busyUs = 0n;
  #maximumWorkItemUs = 0n;
  #paintCallbacks = 0;
  #captureCallbacks = 0;
  #textureSends = 0;

  begin(): void {
    this.#active = true;
    this.#startedAtUs = process.hrtime.bigint() / 1_000n;
    this.#busyUs = 0n;
    this.#maximumWorkItemUs = 0n;
    this.#paintCallbacks = 0;
    this.#captureCallbacks = 0;
    this.#textureSends = 0;
  }

  observePaint(durationUs: bigint): void {
    this.observe(durationUs);
    if (this.#active && durationUs >= 0n) this.#paintCallbacks += 1;
  }

  observeCapture(durationUs: bigint): void {
    this.observe(durationUs);
    if (this.#active && durationUs >= 0n) this.#captureCallbacks += 1;
  }

  observeTextureSend(durationUs: bigint): void {
    this.observe(durationUs);
    if (this.#active && durationUs >= 0n) this.#textureSends += 1;
  }

  private observe(durationUs: bigint): void {
    if (!this.#active || durationUs < 0n) return;
    this.#busyUs += durationUs;
    this.#maximumWorkItemUs =
      durationUs > this.#maximumWorkItemUs ? durationUs : this.#maximumWorkItemUs;
  }

  finish(): {
    readonly paintCallbacks: number;
    readonly captureCallbacks: number;
    readonly textureSends: number;
    readonly elapsedMs: number;
    readonly busyMs: number;
    readonly ratio: number;
    readonly maximumWorkItemMs: number;
  } {
    if (!this.#active) throw new Error("main callback duty meter was not active");
    this.#active = false;
    const elapsedUs = process.hrtime.bigint() / 1_000n - this.#startedAtUs;
    const elapsedMs = Number(elapsedUs) / 1_000;
    const busyMs = Number(this.#busyUs) / 1_000;
    return {
      paintCallbacks: this.#paintCallbacks,
      captureCallbacks: this.#captureCallbacks,
      textureSends: this.#textureSends,
      elapsedMs: Math.round(elapsedMs),
      busyMs: Math.round(busyMs * 1_000) / 1_000,
      ratio: elapsedMs === 0 ? 0 : Math.round((busyMs / elapsedMs) * 100_000) / 100_000,
      maximumWorkItemMs: Number(this.#maximumWorkItemUs) / 1_000,
    };
  }
}

async function measureLiveSurfaceMainDuty(
  win: BrowserWindow,
  meter: LiveSurfaceMainDutyMeter,
  timeoutMs: number,
): Promise<ReturnType<LiveSurfaceMainDutyMeter["finish"]>> {
  const activeExpression = `document.documentElement.dataset[${JSON.stringify(
    LIVE_SURFACE_LAB_CONTINUOUS_ACTIVE_DATASET,
  )}] ?? ""`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await win.webContents.executeJavaScript(activeExpression, true);
    if (active === "1") {
      meter.begin();
      while (Date.now() < deadline) {
        await sleep(10);
        const current = await win.webContents.executeJavaScript(activeExpression, true);
        if (current !== "1") return meter.finish();
      }
      break;
    }
    await sleep(10);
  }
  throw new Error("continuous renderer window did not expose a bounded main-duty interval");
}

const MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS = 2_000;
const MINIMUM_CONTINUOUS_BUDGET_SAMPLE_MS = 60_000;

function browserReferenceRasterSize(index: number): { width: number; height: number } {
  if (index === 0) return { width: 1280, height: 800 };
  if (index <= 3) return { width: 640, height: 480 };
  return { width: 320, height: 240 };
}

export async function runLiveSurfacesLab(opts: {
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  beforeExit: () => Promise<void>;
  readonly continuousSoakMs?: number;
  readonly helperCrashCount?: number;
  readonly sck?: LiveSurfaceSckLab;
}): Promise<void> {
  const { LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS } = await import("@vibefield/live-surfaces/testing");
  const monitorUncaught: NodeJS.UncaughtExceptionListener = (error, origin) => {
    console.error(
      `LIVE_SURFACES_UNCAUGHT ${JSON.stringify({
        origin,
        message: error.message,
        stack: error.stack,
      })}`,
    );
  };
  // Electron's default uncaught-exception path is a native modal on macOS.
  // Observe it without changing that default so a headless lab failure remains
  // diagnosable instead of looking like a frozen frame deadline.
  process.on("uncaughtExceptionMonitor", monitorUncaught);
  const authority = new LiveSurfaceFixtureRuntime();
  let tokenIndex = 0;
  const tickets = new LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>({
    randomToken: () => {
      const ticket = LIVE_SURFACE_LAB_ALL_TICKETS[tokenIndex];
      tokenIndex += 1;
      if (ticket === undefined) throw new Error("the Browser lab exhausted its ticket tokens");
      return ticket.token;
    },
  });
  const win = createMainWindow({
    mode: "live-surfaces-lab",
    preloadPath: opts.preloadPath,
    show: process.env["VF_LIVE_SURFACES_LAB_HEADLESS"] !== "1",
  });
  opts.registry.adopt(win);
  const textureForwarders: LiveSurfaceTextureForwarder[] = [];
  const importDurations = new LiveSurfaceImportDurationHistogram();
  const mainDutyMeter = new LiveSurfaceMainDutyMeter();
  const host = new LiveSurfaceWindowHost(
    win,
    tickets,
    () => new MessageChannelMain(),
    undefined,
    (surfaceId, attachmentId, budget) => {
      const transferApi = createElectronLiveSurfaceTextureTransferApi(win.webContents);
      const measuredTransferApi: LiveSurfaceTextureTransferApi = {
        importTexture: (textureInfo, allReferencesReleased) => {
          const startedAt = process.hrtime.bigint();
          try {
            return transferApi.importTexture(textureInfo, allReferencesReleased);
          } finally {
            importDurations.observe(process.hrtime.bigint() - startedAt);
          }
        },
        sendTexture: (imported, envelope) => {
          const startedAt = process.hrtime.bigint();
          try {
            return transferApi.sendTexture(imported, envelope);
          } finally {
            mainDutyMeter.observeTextureSend((process.hrtime.bigint() - startedAt) / 1_000n);
          }
        },
      };
      const forwarder = new LiveSurfaceTextureForwarder(
        surfaceId,
        attachmentId,
        measuredTransferApi,
        2,
        budget,
      );
      textureForwarders.push(forwarder);
      return forwarder;
    },
  ).install();
  const native = new ElectronBrowserSurfaceNative();
  const controlTargets = new BrowserControlTargetRegistry({
    resolveTarget: (targetId) => webContents.fromDevToolsTargetId(targetId),
  });
  const browserRuntimes: BrowserLiveSurfaceRuntime[] = [];
  let fallbackRuntime: BrowserLiveSurfaceRuntime | null = null;
  const sckFixtures: LiveSurfaceSckFixture[] = [];
  const sckRuntimes: Array<SckLiveSurfaceRuntime | IosSimulatorLiveSurfaceRuntime> = [];
  const sckSources: MacosCaptureSource[] = [];
  const sckKinds: Array<"fixture" | "simulator"> = [];
  let sckSupervisor: MacosCaptureHelperSupervisor | null = null;
  let helperHarness: LiveSurfaceHelperProcessHarness | null = null;
  let simulatorRuntime: IosSimulatorLiveSurfaceRuntime | null = null;
  let simulatorResolution: ResolvedIosSimulatorCapture | null = null;
  let simulatorRotation: LiveSurfaceSimulatorRotationProof | null = null;
  let clockCalibration: {
    readonly roundTripMs: number;
    readonly uncertaintyMs: number;
  } | null = null;
  let pageServer: Awaited<ReturnType<typeof startLiveSurfacePageServer>> | null = null;
  let exitCode = 2;
  let verdict: Record<string, unknown> = { ok: false };
  try {
    const helperCrashCount = opts.helperCrashCount ?? 0;
    if (!Number.isSafeInteger(helperCrashCount) || helperCrashCount < 0 || helperCrashCount > 2) {
      throw new Error("the helper crash count must be an integer from zero through two");
    }
    if (helperCrashCount > 0 && (opts.sck === undefined || opts.continuousSoakMs === undefined)) {
      throw new Error("active helper crash recovery requires SCK and a continuous soak");
    }
    pageServer = await startLiveSurfacePageServer();
    for (const [index, surfaceId] of LIVE_SURFACE_LAB_BROWSER_SURFACE_IDS.entries()) {
      const logicalViewport =
        opts.continuousSoakMs === undefined
          ? { width: 320, height: 180 }
          : browserReferenceRasterSize(index);
      browserRuntimes.push(
        new BrowserLiveSurfaceRuntime({
          surfaceId,
          source: {
            kind: "browser",
            initialUrl: `${pageServer.origin}/surface/${index + 1}`,
            profile: { mode: "memory", ref: "live-surfaces-browser-lab" },
            logicalViewport,
            deviceScaleFactor: 1,
          },
          native,
          controlTargets,
          onPaintCallbackDurationUs: (durationUs) => mainDutyMeter.observePaint(durationUs),
        }),
      );
    }
    fallbackRuntime = new BrowserLiveSurfaceRuntime({
      surfaceId: LIVE_SURFACE_LAB_FALLBACK_SURFACE_ID,
      source: {
        kind: "browser",
        initialUrl: `${pageServer.origin}/surface/fallback`,
        profile: { mode: "memory", ref: "live-surfaces-browser-fallback-lab" },
        logicalViewport: { width: 320, height: 180 },
        deviceScaleFactor: 1,
      },
      native,
      controlTargets,
      requestSharedTexture: false,
      onPaintCallbackDurationUs: (durationUs) => mainDutyMeter.observePaint(durationUs),
    });
    if (opts.sck !== undefined) {
      const captureAdapter = loadMacosCaptureNativeAdapter(opts.sck.adapterPath);
      helperHarness = new LiveSurfaceHelperProcessHarness();
      sckSupervisor = new MacosCaptureHelperSupervisor({
        helperPath: opts.sck.helperPath,
        adapter: captureAdapter,
        spawnHelper: helperHarness.spawnHelper,
        onDiagnostic: (message) => console.error(`LIVE_SURFACES_SCK_HELPER ${message}`),
      });
      const fixtureCount =
        opts.sck.kind === "fixture"
          ? opts.sck.sessionCount
          : opts.sck.kind === "mixed"
            ? opts.sck.fixtureCount
            : 0;
      if (fixtureCount > LIVE_SURFACE_LAB_SCK_SURFACE_IDS.length) {
        throw new Error("the SCK lab requested too many fixture sessions");
      }
      const fixturePath = opts.sck.kind === "simulator" ? null : opts.sck.fixturePath;
      for (let index = 0; index < fixtureCount; index += 1) {
        if (fixturePath === null) throw new Error("fixture sessions require a fixture executable");
        const fixture = await startLiveSurfaceSckFixture(fixturePath);
        sckFixtures.push(fixture);
      }
      const fixtureSources = await findSckFixtureSources(sckSupervisor, sckFixtures);
      for (const [index, source] of fixtureSources.entries()) {
        sckSources.push(source);
        sckKinds.push("fixture");
        sckRuntimes.push(
          new SckLiveSurfaceRuntime({
            surfaceId: LIVE_SURFACE_LAB_SCK_SURFACE_IDS[index]!,
            source: {
              kind: "sck-window",
              sourceRef: source.sourceRef,
              crop: { mode: "none" },
              captureCursor: false,
            },
            client: sckSupervisor,
            onFrameCallbackDurationUs: (durationUs) => mainDutyMeter.observeCapture(durationUs),
          }),
        );
      }
      if (opts.sck.kind === "simulator" || opts.sck.kind === "mixed") {
        const simulatorIndex = sckRuntimes.length;
        if (simulatorIndex >= LIVE_SURFACE_LAB_SCK_SURFACE_IDS.length) {
          throw new Error("the mixed SCK lab exceeded its four-session bound");
        }
        const simulatorSource = {
          kind: "ios-simulator" as const,
          udid: opts.sck.udid,
          crop: { mode: "auto" as const },
        };
        const resolver = new IosSimulatorSourceResolver({
          devices: new SimctlDeviceCatalog({
            ...(opts.sck.developerDir === undefined ? {} : { developerDir: opts.sck.developerDir }),
          }),
          windows: sckSupervisor,
          viewport: captureAdapter,
        });
        simulatorResolution = await resolver.resolve(simulatorSource);
        sckSources.push(simulatorResolution.window);
        sckKinds.push("simulator");
        if (opts.sck.requireInactiveSpace && simulatorResolution.window.onScreen) {
          throw new Error("Simulator window must begin the cross-Space lab off the active Space");
        }
        simulatorRuntime = new IosSimulatorLiveSurfaceRuntime({
          surfaceId: LIVE_SURFACE_LAB_SCK_SURFACE_IDS[simulatorIndex]!,
          source: simulatorSource,
          resolver,
          delegate: sckSupervisor,
          revalidateIntervalMs: 250,
          onFrameCallbackDurationUs: (durationUs) => mainDutyMeter.observeCapture(durationUs),
        });
        sckRuntimes.push(simulatorRuntime);
      }
    }
    const sckQuery =
      sckRuntimes.length === 0 || opts.sck === undefined
        ? ""
        : `&sck=${opts.sck.kind}&sckModes=${sckKinds.join(",")}${
            (opts.sck.kind === "simulator" || opts.sck.kind === "mixed") && opts.sck.rotate
              ? "&rotate=1"
              : ""
          }${opts.helperCrashCount === undefined ? "" : `&helperCrashes=${opts.helperCrashCount}`}`;
    const soakQuery = opts.continuousSoakMs === undefined ? "" : `&soakMs=${opts.continuousSoakMs}`;
    await win.loadURL(
      `${APP_ORIGIN}/spike-live-surfaces-lab.html?phase=reload${sckQuery}${soakQuery}`,
    );
    const reloadFromGeneration = host.rendererGeneration;
    const reloadTicket = host.issue({
      surfaceId: browserRuntimes[0]!.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      principalId: "live-surfaces-foundation-reload-lab",
      authority: browserRuntimes[0]!,
    });
    if (reloadTicket.token !== LIVE_SURFACE_LAB_RELOAD_TICKET.token) {
      throw new Error("test-only reload ticket did not match its renderer rendezvous");
    }
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset[${JSON.stringify(
        LIVE_SURFACE_LAB_TICKET_READY_DATASET,
      )}] = "1"`,
      true,
    );
    const reloadReadyDeadline = Date.now() + 15_000;
    let reloadReady = false;
    while (!reloadReady && Date.now() < reloadReadyDeadline) {
      reloadReady =
        (await win.webContents.executeJavaScript(
          `document.documentElement.dataset[${JSON.stringify(
            LIVE_SURFACE_LAB_RELOAD_READY_DATASET,
          )}] === "1"`,
          true,
        )) === true;
      if (!reloadReady) await sleep(10);
    }
    if (!reloadReady) throw new Error("renderer never held a frame for the reload probe");
    win.webContents.reload();
    const reloadDeadline = Date.now() + 20_000;
    while (host.rendererGeneration <= reloadFromGeneration && Date.now() < reloadDeadline) {
      await sleep(10);
    }
    if (host.rendererGeneration <= reloadFromGeneration) {
      throw new Error("renderer reload did not finish within 20s");
    }
    await host.whenDrained();
    const reloadForwarders = textureForwarders.filter(
      (forwarder) => forwarder.surfaceId === browserRuntimes[0]!.surfaceId,
    );
    const reloadDrain = {
      forwarders: reloadForwarders.length,
      outstanding: reloadForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.outstanding,
        0,
      ),
      timedOut: reloadForwarders.reduce((total, forwarder) => total + forwarder.stats.timedOut, 0),
      completed: reloadForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.completed,
        0,
      ),
    };
    if (opts.continuousSoakMs !== undefined) {
      const hostBeforeUs = process.hrtime.bigint() / 1_000n;
      const rendererNowMs = await win.webContents.executeJavaScript("performance.now()", true);
      const hostAfterUs = process.hrtime.bigint() / 1_000n;
      if (typeof rendererNowMs !== "number" || !Number.isFinite(rendererNowMs)) {
        throw new Error("renderer did not return a finite monotonic clock sample");
      }
      const hostMidpointUs = (hostBeforeUs + hostAfterUs) / 2n;
      const hostClockOffsetUs = hostMidpointUs - BigInt(Math.round(rendererNowMs * 1_000));
      const roundTripUs = hostAfterUs - hostBeforeUs;
      const uncertaintyUs = (roundTripUs + 1n) / 2n;
      clockCalibration = {
        roundTripMs: Number(roundTripUs) / 1_000,
        uncertaintyMs: Number(uncertaintyUs) / 1_000,
      };
      await win.webContents.executeJavaScript(
        `document.documentElement.dataset[${JSON.stringify(
          LIVE_SURFACE_LAB_CLOCK_OFFSET_DATASET,
        )}] = ${JSON.stringify(hostClockOffsetUs.toString())}; document.documentElement.dataset[${JSON.stringify(
          LIVE_SURFACE_LAB_CLOCK_UNCERTAINTY_DATASET,
        )}] = ${JSON.stringify(uncertaintyUs.toString())}`,
        true,
      );
    }
    const authorities: LiveSurfaceRuntimeAuthority[] = [
      authority,
      ...browserRuntimes,
      fallbackRuntime,
      ...sckRuntimes,
    ];
    const sckKindByRuntime = new Map<LiveSurfaceRuntimeAuthority, "fixture" | "simulator">(
      sckRuntimes.map((runtime, index) => [runtime, sckKinds[index]!] as const),
    );
    for (const [index, runtime] of authorities.entries()) {
      const sckKind = sckKindByRuntime.get(runtime);
      const ticket = host.issue({
        surfaceId: runtime.surfaceId,
        // Native source identity remains main-private. Every token is still
        // one-use and generation-bound regardless of the source specialization.
        sourceKind: sckKind === "simulator" ? "ios-simulator" : sckKind ? "sck-window" : "browser",
        operations:
          index === 0
            ? ["view"]
            : sckKind !== undefined
              ? ["view", "crop"]
              : ["view", "pointer", "keyboard"],
        principalId: "live-surfaces-foundation-lab",
        authority: runtime,
      });
      if (ticket.token !== LIVE_SURFACE_LAB_TICKETS[index]?.token) {
        throw new Error(`test-only ticket ${index} did not match its renderer rendezvous`);
      }
    }
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset[${JSON.stringify(
        LIVE_SURFACE_LAB_TICKET_READY_DATASET,
      )}] = "1"`,
      true,
    );

    const browserInputProof = proveLiveSurfaceBrowserInput(browserRuntimes[0]!, controlTargets);
    const simulatorRotationProof =
      (opts.sck?.kind === "simulator" || opts.sck?.kind === "mixed") &&
      opts.sck.rotate &&
      simulatorRuntime !== null
        ? proveSimulatorRotation(simulatorRuntime)
        : Promise.resolve(null);
    const mainCpuStartedAt = process.cpuUsage();
    const mainDutyStartedAt = process.hrtime.bigint();
    const mainSurfaceDutyPromise =
      opts.continuousSoakMs === undefined
        ? Promise.resolve(null)
        : measureLiveSurfaceMainDuty(win, mainDutyMeter, 90_000 + opts.continuousSoakMs);
    const helperCrashProofPromise =
      helperCrashCount === 0 || sckSupervisor === null || helperHarness === null
        ? Promise.resolve<LiveSurfaceHelperCrashProof>({
            requested: helperCrashCount,
            completed: 0,
            helperExits: 0,
            helperLeasesReleasedByTeardown: 0,
          })
        : driveLiveSurfaceHelperCrashes(
            win,
            sckSupervisor,
            helperHarness,
            helperCrashCount,
            90_000 + (opts.continuousSoakMs ?? 0),
          );
    const [renderer, helperCrashProof] = await Promise.all([
      waitForLiveSurfaceLabResult(win, 90_000 + (opts.continuousSoakMs ?? 0)),
      helperCrashProofPromise,
    ]);
    const mainSurfaceDuty = await mainSurfaceDutyPromise;
    const mainCpu = process.cpuUsage(mainCpuStartedAt);
    const mainDutyElapsedMs = Number(process.hrtime.bigint() - mainDutyStartedAt) / 1_000_000;
    const mainCpuMs = (mainCpu.user + mainCpu.system) / 1_000;
    const mainProcessCpu = {
      elapsedMs: Math.round(mainDutyElapsedMs),
      cpuMs: Math.round(mainCpuMs),
      ratio:
        mainDutyElapsedMs === 0
          ? 0
          : Math.round((mainCpuMs / mainDutyElapsedMs) * 100_000) / 100_000,
    };
    const browserInput = await browserInputProof;
    simulatorRotation = await simulatorRotationProof;
    const offeredAtRendererDone = authority.stats.offered;
    const referenceDeadline = Date.now() + 3_000;
    while (
      Date.now() < referenceDeadline &&
      (browserRuntimes.some(
        (runtime) => runtime.stats.importedReferencesReleased !== runtime.stats.sharedFramesOffered,
      ) ||
        textureForwarders.some((forwarder) => forwarder.stats.outstanding !== 0))
    ) {
      await sleep(25);
    }
    await sleep(250);
    const source = authority.stats;
    const problems: string[] = [];
    const textureTransfers = {
      forwarders: textureForwarders.length,
      outstanding: textureForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.outstanding,
        0,
      ),
      peakOutstandingPerSurface: textureForwarders.reduce(
        (peak, forwarder) => Math.max(peak, forwarder.stats.peakOutstanding),
        0,
      ),
      timedOut: textureForwarders.reduce((total, forwarder) => total + forwarder.stats.timedOut, 0),
      sendFailures: textureForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.sendFailures,
        0,
      ),
      releaseFaults: textureForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.releaseFaults,
        0,
      ),
      importDuration: importDurations.snapshot(),
    };
    const primaryCpuPixelConversions = browserRuntimes.reduce(
      (total, runtime) => total + runtime.stats.cpuFramesOffered,
      0,
    );
    let sckEvidence: Record<string, unknown> | null = null;
    if (!renderer.ok) problems.push(renderer.error ?? "renderer returned a failed verdict");
    if (!renderer.rendererReloadObserved)
      problems.push("renderer did not observe its reload phase");
    if (
      reloadDrain.forwarders !== 1 ||
      reloadDrain.outstanding !== 0 ||
      reloadDrain.completed + reloadDrain.timedOut < 1
    ) {
      problems.push(
        `renderer reload did not reconcile its held texture within the bounded drain: ${JSON.stringify(reloadDrain)}`,
      );
    }
    if (source.attachments !== 1) problems.push(`source attached ${source.attachments} times`);
    if (source.demandUpdates < 2) problems.push("source did not receive live and paused demand");
    if (source.offered < 12) problems.push(`source offered only ${source.offered} frames`);
    if (source.accepted !== source.offered) {
      problems.push(`${source.offered - source.accepted} CPU frame(s) were refused by the host`);
    }
    if (source.offered !== offeredAtRendererDone) {
      problems.push("the fixture kept producing after paused demand");
    }
    if (textureTransfers.outstanding !== 0) {
      problems.push(`${textureTransfers.outstanding} shared texture transfer(s) survived drain`);
    }
    if (
      textureTransfers.peakOutstandingPerSurface >
      LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.mainOutstandingTransfersPerSurfaceMax
    ) {
      problems.push(
        `one surface reached ${textureTransfers.peakOutstandingPerSurface} outstanding transfers`,
      );
    }
    if (textureTransfers.sendFailures !== 0 || textureTransfers.releaseFaults !== 0) {
      problems.push("shared texture transfer faults occurred during the lab");
    }
    if (primaryCpuPixelConversions !== 0) {
      problems.push("a primary Browser source emitted CPU pixels");
    }
    if (opts.continuousSoakMs === undefined) {
      if (renderer.continuousSoak !== null) {
        problems.push("the renderer ran an unrequested continuous soak");
      }
    } else {
      const soak = renderer.continuousSoak;
      if (
        soak === null ||
        soak.requestedDurationMs !== opts.continuousSoakMs ||
        soak.elapsedMs < opts.continuousSoakMs ||
        soak.browserPresented.length !== 10 ||
        soak.browserPresented.some((count) => count <= 0) ||
        soak.browserMaximumPresentationGapMs.length !== 10 ||
        soak.browserMaximumPresentationGapMs.some(
          (gapMs) => gapMs > MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS,
        ) ||
        (opts.sck !== undefined &&
          (soak.sckPresented <= 0 ||
            soak.sckPresentedPerSurface.length !== sckRuntimes.length ||
            soak.sckPresentedPerSurface.some((count) => count <= 0) ||
            soak.sckMaximumPresentationGapMs === null ||
            soak.sckMaximumPresentationGapMs > MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS ||
            soak.sckMaximumPresentationGapMsPerSurface.length !== sckRuntimes.length ||
            soak.sckMaximumPresentationGapMsPerSurface.some(
              (gapMs) => gapMs > MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS,
            ))) ||
        soak.activeFrameAgeSamples.length !== 10 + sckRuntimes.length ||
        soak.activeFrameAgeSamples.some((count) => count <= 0) ||
        soak.activeRasterSizes.length !== 10 + sckRuntimes.length ||
        soak.activeRasterSizes.slice(0, 10).some((size, index) => {
          const expected = browserReferenceRasterSize(index);
          return size?.width !== expected.width || size.height !== expected.height;
        }) ||
        soak.rendererPendingPerSurfaceMax >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.rendererPendingPerSurfaceMax ||
        soak.rendererInFlightPerSurfaceMax >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.rendererInFlightPerSurfaceMax ||
        mainSurfaceDuty === null ||
        mainSurfaceDuty.paintCallbacks <= 0 ||
        (opts.sck !== undefined && mainSurfaceDuty.captureCallbacks <= 0) ||
        mainSurfaceDuty.textureSends <= 0 ||
        clockCalibration === null ||
        clockCalibration.uncertaintyMs > 5 ||
        soak.activeDeviceRecoveries !== (opts.continuousSoakMs >= 30_000 ? 2 : 1) ||
        soak.helperCrashRequests !== helperCrashCount ||
        soak.sckDemandChanges !== (sckRuntimes.length > 0 ? 2 : 0) ||
        helperCrashProof.requested !== helperCrashCount ||
        helperCrashProof.completed !== helperCrashCount
      ) {
        problems.push("the continuous renderer workload did not remain live and bounded");
      }
      if (opts.continuousSoakMs >= MINIMUM_CONTINUOUS_BUDGET_SAMPLE_MS) {
        if (
          soak !== null &&
          soak.worstActiveFrameAgeP95Ms >
            LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.worstActiveFrameAgeP95Ms
        ) {
          problems.push(`active frame-age p95 exceeded 50ms: ${soak.worstActiveFrameAgeP95Ms}`);
        }
        if (
          mainSurfaceDuty !== null &&
          mainSurfaceDuty.ratio > LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.electronMainDutyRatioMax
        ) {
          problems.push(`Electron main duty exceeded 10%: ${mainSurfaceDuty.ratio}`);
        }
        const imports = textureTransfers.importDuration;
        if (
          imports.p95Ms === null ||
          imports.p95Overflow ||
          imports.p95Ms > LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.sharedTextureImportP95Ms
        ) {
          problems.push(`shared texture import p95 exceeded 0.30ms: ${imports.p95Ms}`);
        }
      }
    }
    if (sckRuntimes.length > 0 && sckSupervisor !== null) {
      const reconciliationDeadline = Date.now() + 5_000;
      while (Date.now() < reconciliationDeadline) {
        const helperStats = sckSupervisor.stats;
        if (
          helperStats.activeSessions === 0 &&
          helperStats.helperLeasesOutstanding === 0 &&
          helperStats.native?.outstanding === 0 &&
          sckRuntimes.every(
            (runtime) =>
              runtime.stats.framesReceived === runtime.stats.localReferencesReleased &&
              runtime.stats.framesReceived ===
                runtime.stats.helperLeasesReleased + runtime.stats.helperLeasesQuarantined,
          )
        ) {
          break;
        }
        await sleep(25);
      }
      const helperStats = sckSupervisor.stats;
      const sckKind = opts.sck?.kind ?? "fixture";
      const simulatorLab =
        opts.sck?.kind === "simulator" || opts.sck?.kind === "mixed" ? opts.sck : null;
      sckEvidence = {
        kind: sckKind,
        sources: sckSources.map((source, index) => ({
          kind: sckKinds[index],
          applicationName: source.applicationName,
          title: source.title,
          ownerPid: source.ownerPid,
          onScreen: source.onScreen,
          logicalSize:
            sckKinds[index] === "simulator" && simulatorResolution !== null
              ? simulatorResolution.geometry.logicalSize
              : { width: source.frame.width, height: source.frame.height },
        })),
        simulator:
          simulatorResolution === null
            ? null
            : {
                device: simulatorResolution.device,
                resolvedSource: simulatorResolution.source,
                resolvedGeometry: simulatorResolution.geometry,
                rotation: simulatorRotation,
              },
        runtimes: sckRuntimes.map((runtime, index) => ({
          kind: sckKinds[index],
          summary: runtime.summary,
          stats: runtime.stats,
        })),
        helperCrash: helperCrashProof,
        helper: helperStats,
      };
      if (
        !renderer.sckEnabled ||
        renderer.sckMode !== sckKind ||
        renderer.sckSurfaceCount !== sckRuntimes.length ||
        renderer.sckModes.length !== sckKinds.length ||
        renderer.sckModes.some((kind, index) => kind !== sckKinds[index]) ||
        renderer.sckPresentedPerSurface.length !== sckRuntimes.length ||
        renderer.sckPresentedPerSurface.some((count) => count < 3) ||
        renderer.sckTransport !== "shared-texture" ||
        renderer.sckPixelFormat !== "bgra" ||
        (sckKinds.includes("fixture") &&
          (!renderer.sckExact ||
            renderer.sckRedPureRatio !== 1 ||
            renderer.sckBluePureRatio !== 1)) ||
        (simulatorLab?.rotate === true && !renderer.sckRebound)
      ) {
        problems.push(
          sckKinds.every((kind) => kind === "fixture")
            ? "the renderer did not prove exact SCK BGRA stripes"
            : "the renderer did not present every SCK/Simulator viewport",
        );
      }
      for (const [index, runtime] of sckRuntimes.entries()) {
        const stats = runtime.stats;
        const summary = runtime.summary;
        const rotationRestarts = sckKinds[index] === "simulator" && simulatorLab?.rotate ? 1 : 0;
        const minimumRestarts = helperCrashCount + rotationRestarts;
        if (
          summary.state !== "hibernated" ||
          summary.transport !== "shared-texture" ||
          stats.sessionsStarted < minimumRestarts + 1 ||
          stats.sessionRestarts < minimumRestarts ||
          stats.framesReceived < 3
        ) {
          problems.push(`${runtime.surfaceId} did not complete its recovered SCK session(s)`);
        }
        if (
          stats.framesReceived !== stats.localReferencesReleased ||
          stats.framesReceived !== stats.helperLeasesReleased ||
          stats.helperLeasesQuarantined !== 0
        ) {
          problems.push(`${runtime.surfaceId} did not reconcile every local/helper frame lease`);
        }
      }
      if (
        simulatorLab !== null &&
        (simulatorResolution === null ||
          simulatorResolution.geometry.cropState !== "applied" ||
          simulatorRuntime?.summary.geometry?.cropState !== "applied" ||
          (simulatorLab.rotate && simulatorRotation === null))
      ) {
        problems.push("the Simulator runtime did not preserve proven cropped geometry");
      }
      const totalRuntimeFrames = sckRuntimes.reduce(
        (total, runtime) => total + runtime.stats.framesReceived,
        0,
      );
      const totalSessionsStarted = sckRuntimes.reduce(
        (total, runtime) => total + runtime.stats.sessionsStarted,
        0,
      );
      const staleSessionFrames = helperStats.framesReceived - totalRuntimeFrames;
      const helperFrameAccounting =
        staleSessionFrames >= 0 &&
        staleSessionFrames === helperStats.framesRejected &&
        helperStats.framesRejected <= totalSessionsStarted * 2;
      if (
        helperStats.activeSessions !== 0 ||
        helperStats.helperLeasesOutstanding !== 0 ||
        helperStats.helperLeasesPeakPerSession >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.helperOutstandingLeasesPerSessionMax ||
        helperStats.nativeOutstandingPeak >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.helperOutstandingLeasesPerSessionMax *
            sckRuntimes.length ||
        !helperFrameAccounting ||
        helperStats.releaseCommands + helperStats.helperLeasesReleasedByTeardown !==
          helperStats.framesReceived ||
        helperStats.helperStarts !== helperCrashCount + 1 ||
        helperStats.helperExits !== helperCrashCount ||
        helperStats.helperLeasesReleasedByTeardown < helperCrashCount * sckRuntimes.length ||
        helperCrashProof.helperExits !== helperCrashCount ||
        helperCrashProof.helperLeasesReleasedByTeardown < helperCrashCount * sckRuntimes.length ||
        helperStats.native === null ||
        helperStats.native.accepted !==
          helperStats.framesReceived + helperStats.nativeReferencesReleasedByTeardown ||
        helperStats.native.outstanding !== 0 ||
        helperStats.native.rejectedIdentity !== 0 ||
        helperStats.native.rejectedCapability !== 0 ||
        helperStats.native.rejectedProtocol !== 0
      ) {
        problems.push("the SCK helper/native ownership counters did not reconcile");
      }
    } else if (opts.sck !== undefined) {
      problems.push("the requested SCK lab did not create its capture runtime");
    } else if (renderer.sckEnabled) {
      problems.push("the renderer enabled SCK without a main-process capture authority");
    }
    for (const [index, runtime] of browserRuntimes.entries()) {
      const stats = runtime.stats;
      const summary = runtime.summary;
      const control = controlTargets.status(runtime.surfaceId);
      const expectedStarts = index === 0 ? 2 : 1;
      if (stats.producersStarted !== expectedStarts) {
        problems.push(`${runtime.surfaceId} started ${stats.producersStarted} producers`);
      }
      if (stats.texturePaints < 3 || stats.sharedFramesAccepted < 3) {
        problems.push(`${runtime.surfaceId} did not deliver enough shared Browser frames`);
      }
      if (stats.producerTextureReleases !== stats.texturePaints) {
        problems.push(`${runtime.surfaceId} leaked an Electron OSR texture wrapper`);
      }
      if (stats.importedReferencesReleased !== stats.sharedFramesOffered) {
        problems.push(`${runtime.surfaceId} retained imported renderer references`);
      }
      if (summary.state !== "hibernated" || summary.transport !== "shared-texture") {
        problems.push(`${runtime.surfaceId} did not end as hibernated shared transport`);
      }
      if (control.bound || control.controlBindingRevision < 2) {
        problems.push(`${runtime.surfaceId} did not bind and revoke its private control target`);
      }
    }
    if (fallbackRuntime === null) {
      problems.push("the explicit Browser fallback runtime was not created");
    } else {
      const stats = fallbackRuntime.stats;
      const summary = fallbackRuntime.summary;
      const control = controlTargets.status(fallbackRuntime.surfaceId);
      if (stats.cpuPaints < 3 || stats.cpuFramesAccepted < 3) {
        problems.push("the Browser CPU fallback did not deliver enough observed frames");
      }
      if (
        summary.state !== "hibernated" ||
        summary.transport !== "cpu-bgra" ||
        summary.error?.code !== "transport-degraded"
      ) {
        problems.push("the Browser CPU fallback was not explicit in its final summary");
      }
      if (control.bound || control.controlBindingRevision < 2) {
        problems.push("the Browser CPU fallback did not bind and revoke its control target");
      }
    }
    if (tickets.size !== 0) problems.push("one or more one-use presentation tickets survived");
    const supportSources: LiveSurfaceRuntimeSupportSource[] = [
      ...browserRuntimes,
      ...(fallbackRuntime === null ? [] : [fallbackRuntime]),
      ...sckRuntimes,
    ];
    verdict = {
      ok: problems.length === 0,
      renderer,
      source,
      browserSources: browserRuntimes.map((runtime) => ({
        surfaceId: runtime.surfaceId,
        summary: runtime.summary,
        stats: runtime.stats,
        control: controlTargets.status(runtime.surfaceId),
      })),
      browserFallback:
        fallbackRuntime === null
          ? null
          : {
              summary: fallbackRuntime.summary,
              stats: fallbackRuntime.stats,
              control: controlTargets.status(fallbackRuntime.surfaceId),
            },
      browserInput,
      sck: sckEvidence,
      reloadDrain,
      hardening: {
        continuousSoakRequestedMs: opts.continuousSoakMs ?? null,
        clockCalibration,
        mainSurfaceDuty,
        mainProcessCpu,
        textureTransfers,
        helperOutstandingLeasesPeakPerSession: sckSupervisor?.stats.helperLeasesPeakPerSession ?? 0,
        helperCrash: helperCrashProof,
        primaryCpuPixelConversions,
        worstActiveFrameAgeP95Ms: renderer.continuousSoak?.worstActiveFrameAgeP95Ms ?? null,
      },
      runtimeSupport: aggregateLiveSurfaceRuntimeSupport(supportSources),
      rendererGeneration: host.rendererGeneration,
      ticketTableSize: tickets.size,
      ...(problems.length === 0 ? {} : { problems }),
    };
    exitCode = problems.length === 0 ? 0 : 2;
  } catch (error) {
    verdict = {
      ok: false,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      source: authority.stats,
      browserSources: browserRuntimes.map((runtime) => ({
        surfaceId: runtime.surfaceId,
        summary: runtime.summary,
        stats: runtime.stats,
      })),
      textureForwarders: textureForwarders.map((forwarder) => ({
        surfaceId: forwarder.surfaceId,
        attachmentId: forwarder.attachmentId,
        stats: forwarder.stats,
      })),
      sck:
        sckRuntimes.length === 0 || sckSupervisor === null
          ? null
          : {
              runtimes: sckRuntimes.map((runtime, index) => ({
                kind: sckKinds[index],
                summary: runtime.summary,
                stats: runtime.stats,
              })),
              helper: sckSupervisor.stats,
            },
      rendererGeneration: host.rendererGeneration,
    };
  } finally {
    process.off("uncaughtExceptionMonitor", monitorUncaught);
    host.dispose();
    for (const runtime of browserRuntimes) runtime.dispose();
    fallbackRuntime?.dispose();
    for (const runtime of sckRuntimes) runtime.dispose();
    await sckSupervisor?.dispose().catch(() => undefined);
    for (const fixture of sckFixtures) await fixture.dispose().catch(() => undefined);
    controlTargets.clear();
    await pageServer?.close().catch(() => undefined);
    if (!win.isDestroyed()) win.destroy();
    console.log(`LIVE_SURFACES_LAB ${JSON.stringify(verdict)}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

/** B1 spike: load the spike page over file:// in a sandboxed window and report
 * the renderer's own verdict. No daemons involved. Built only when the spike
 * entry is requested (VITE_SPIKE=1) — never part of the production renderer. */
export async function runSpikeLoro(opts: {
  root: string;
  beforeExit: () => Promise<void>;
}): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    // dist/testing → dist/renderer: the shell's own renderer output (ESR 3a)
    await win.loadFile(join(__dirname, "..", "renderer", "spike-loro.html"));
    const raw = await waitForConsole(win, "SPIKE_LORO ", 30_000);
    const result = JSON.parse(raw) as { ok: boolean };
    console.log(`SPIKE_LORO ${raw}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(result.ok ? 0 : 2);
  } catch (e) {
    console.error(`SPIKE_LORO failed: ${e instanceof Error ? e.message : e}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(2);
  }
}
