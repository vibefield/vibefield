import { existsSync } from "node:fs";
import {
  BROWSER_DESK_PROFILE_REF,
  type BrowserDataClearResult,
  type LiveSurfaceBrowserSourceV1,
  type ShellSurfacesControlParams,
  type SimulatorSetupStatus,
  type SimulatorSetupTarget,
  SURFACE_AUTHORITY_LIMITS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { pageClassOf } from "../pages/core/policy";
import type { PageClass } from "../pages/core/types";
import {
  type LiveSurfaceAuthority,
  type LiveSurfaceEnumerationSources,
  type LiveSurfaceRuntimeFactories,
  type LiveSurfaceSimulatorCensus,
  type LiveSurfaceSimulatorDeviceSource,
  RUN_PROFILE_PREFIX,
} from "./authority";
import {
  BrowserControlTargetRegistry,
  type BrowserControlTargetRegistryOptions,
} from "./browser-control-target";
import { clearBrowsingData } from "./browser-data";
import { ElectronBrowserSurfaceNative } from "./browser-electron-native";
import { BrowserLiveSurfaceRuntime } from "./browser-producer";
import { browserSurfacePartition } from "./browser-security";
import { SimulatorDeviceSessions } from "./ios-simulator-device-runtime";
import {
  IosSimulatorLiveSurfaceRuntime,
  IosSimulatorSourceResolver,
  type SimulatorDeviceCatalog,
} from "./ios-simulator-producer";
import { MacosCaptureHelperSupervisor } from "./macos-capture-helper";
import { loadMacosCaptureNativeAdapter } from "./macos-capture-native";
import { fileOwnedDeviceLedger } from "./owned-simulator-devices";
import { SckLiveSurfaceRuntime } from "./sck-producer";
import { type SimctlCall, type SimctlCallCounts, SimctlService } from "./simctl";

import { SimulatorSetupService } from "./simulator-setup";

// DT-1c — the production binding of the authority's injectable seams onto the
// LSF runtime classes. Everything here is lazy: the browser native costs
// nothing until a browser surface exists, and the capture stack (native
// adapter + authenticated helper) spawns only when a capture kind is first
// enumerated or minted. Non-darwin and helper-less installs answer honest
// UNAVAILABLE; the browser kind keeps working everywhere. PT-S2: a bound phone
// (`ios-simulator-device`) is the exception — it MINTS everywhere and says
// `no-simulator` where there is none (R5); its simctl is one lazy service,
// independent of the capture stack, shared by every phone and the attach's
// device list (R8). PT-S3 (P1): and by the booted-simulator kind's catalog —
// main's ONE simctl, so every xcrun main spawns is pinned to the vetted Xcode.

/** EY-1 (1f): what emptying a run's own session needs of Electron's session. */
export interface RunPartitionSession {
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
  clearAuthCache(): Promise<void>;
}

/** EY-1 (1f, 2026-11-19): custody's `clearRunPartition`. It empties an ended run's own memory
 * session (its site storage, its HTTP cache, its auth cache) through the session its pages held,
 * named as the producer named it. Any other source is refused, a desk's page or a person's profile
 * above all: a run's end never clears what is not the run's. */
export function createRunPartitionClearer(
  sessionOf: (partition: string) => RunPartitionSession,
): (source: LiveSurfaceBrowserSourceV1) => Promise<void> {
  return async (source) => {
    if (source.profile.mode !== "memory" || !source.profile.ref.startsWith(RUN_PROFILE_PREFIX)) {
      throw new Error("only a run's own memory session is cleared at its end");
    }
    const target = sessionOf(browserSurfacePartition(source));
    await target.clearStorageData();
    await target.clearCache();
    await target.clearAuthCache();
  };
}

/**
 * EY-1 (C3, 2026-11-24) — THE RULE MAIN HOLDS BY ITSELF: A RUN IS OF THE FIELDD THAT NAMED IT. A run ended in main
 * only when fieldd's pages room sent the run form's close. A fieldd that restarted or crashed has no room that knows
 * the run, so that message can never come: its kept pages stood hidden, its adopted panes went on minting into its
 * session, and nothing was cleared, until the app quit. So when a fieldd with ANOTHER BOOT IDENTITY attaches (main's
 * boot fence, which already replaces every renderer document then), main ends every run it holds:
 * - custody first, at once and whole (`endEveryRun`): pages, sessions, records;
 * - then the pages broker's half of each run it named (its grants, its route, its engine), through the plane's own
 *   door, the run form's close, with the control call's own deadline. The broker answers at once for a run it does
 *   not hold, and by then finds no page of the run in custody to close. A close that fails is said and stops nothing.
 * With no run to end, the plane's door is never asked.
 *
 * Why this rule and no smaller one: the boot identity is what main already reads to know fieldd's whole in-memory
 * authority was replaced, and it is exact (a reconnect of the same fieldd ends nothing). Why no larger one: every
 * other way a run's end fails to reach main is fieldd's to mend (it now says a run's end whether or not its room
 * holds panes), and custody's own bounds on a kept page stand behind it (KEPT_UNUSED_MS, the last product window).
 * A run the broker holds and custody never did (it made no page) is ended by the plane's own door, `endEveryRun`,
 * which the boot fence asks beside this (2026-11-24).
 */
export function endRunsOfGoneFieldd(deps: {
  readonly custody: Pick<LiveSurfaceAuthority, "endEveryRun">;
  /** the pages plane's `control` */
  readonly control: (
    params: ShellSurfacesControlParams,
    ctx: { readonly signal: AbortSignal; readonly deadlineAt: number },
  ) => Promise<unknown>;
  readonly now?: () => number;
  /** an event and its fields, never a run's id */
  readonly warn?: (event: string, fields: Readonly<Record<string, unknown>>) => void;
}): { runs: number; pages: number } {
  const ended = deps.custody.endEveryRun();
  const deadlineAt = (deps.now ?? Date.now)() + SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS;
  const failed = (error: unknown): void => {
    const kind =
      typeof error === "object" && error !== null && "kind" in error
        ? String(error.kind)
        : "INTERNAL";
    deps.warn?.("desktop.pages.gone_fieldd_close_failed", { kind });
  };
  for (const run of ended.runs) {
    try {
      void deps
        .control(
          { run, window: "act", command: { action: "close" } },
          { signal: new AbortController().signal, deadlineAt },
        )
        .catch(failed);
    } catch (error) {
      failed(error);
    }
  }
  return { runs: ended.runs.length, pages: ended.pages };
}

export interface LiveSurfaceCapturePaths {
  readonly helperPath: string;
  readonly adapterPath: string;
}

export interface ProductionLiveSurfaceSupport {
  readonly factories: LiveSurfaceRuntimeFactories;
  readonly enumeration: LiveSurfaceEnumerationSources;
  /** PT-S2 (R11): the attach's device rows — none on a shell with no capture half, or a Mac with no Simulator */
  readonly simulatorDevices: LiveSurfaceSimulatorDeviceSource;
  /** BP-D4 — Settings' "Clear browsing data": this shell's persistent profiles cleared, their open pages reloaded
   * (`browser-data.ts`). */
  clearBrowsingData(): Promise<BrowserDataClearResult>;
  checkSimulatorSetup(): Promise<SimulatorSetupStatus>;
  openSimulatorSetup(target: SimulatorSetupTarget): Promise<void>;
  /** PT-S3 (D1) — main's simulator census (the authority's `state().simulator`): it READS what was made and never makes
   * — no simctl, no capture stack, no session, no spawn, no load. */
  census(): LiveSurfaceSimulatorCensus;
  /** EY-1 (7b, 2026-11-19): main's ONE control-target registry, every browser page this support
   * makes binds there; null when it was given no resolver. Cleared at dispose: no binding outlives it. */
  readonly controlTargets: BrowserControlTargetRegistry | null;
  /** EY-1 (7b): a browser page's class by its profile, of the live page this support made for the
   * surface; null for none. */
  pageClass(surfaceId: string): PageClass | null;
  dispose(): Promise<void>;
}

interface CaptureStack {
  readonly supervisor: MacosCaptureHelperSupervisor;
  readonly resolver: IosSimulatorSourceResolver;
  /** PT-S3 (P1): the shared simctl — never a catalog of its own, whose xcrun ran unpinned */
  readonly devices: SimulatorDeviceCatalog;
  /** PT-S2: the bound phones' resolver — its devices are the shared simctl's snapshot, never a list of its own (R8) */
  readonly deviceResolver: IosSimulatorSourceResolver;
}

export function createProductionLiveSurfaceSupport(opts: {
  capture: LiveSurfaceCapturePaths | null;
  /** PT-4: where the attached user's persistent browser profiles live (`<user root>/browser/profiles` — LAYOUT's): a
   * persistent browser source's session is a directory under it. Absent: Electron's own partitions. */
  browserProfilesRoot?: string;
  /** BP-D6: this shell is packaged — its profiles carry the packaged name, apart from an unpackaged shell's. */
  browserProfilesPackaged?: boolean;
  /** PT-S2 (R4): a bound phone's Open Settings — main's fixed Screen Recording address, behind the harness's gate
   * (`main/index.ts`: a smoke records it, never opens System Settings). Absent: the act does nothing. */
  openSettings?: () => Promise<void>;
  /** PT-S3 (P2) — a SMOKE's simctl developer directories (`main/index.ts`: `smokeSimctlDeveloperDir`, read only in a
   * smoke-like mode): the probe vets these alone and asks xcode-select nothing. Absent (production): xcode-select's. */
  simctlCandidates?: readonly string[];
  /** PT-S3 (D2) — SMOKE-ONLY (`main/index.ts` passes it only in a smoke-like mode, beside the harness's shell opens): the
   * harness's count of main's simctl calls by NAME — never an argument, so never a UDID. The shared simctl bumps it at
   * each call (its `onCall`), and `census().simctl` reads a copy. Absent (production): nothing is counted. */
  simctlCalls?: SimctlCallCounts;
  /** Item 568 (2026-11-19): the file that keeps which simulators this shell booted (main's userData), so a device a
   * crash left running is shut down by the next start's panes. Absent: none is kept, and such a device runs on. */
  simulatorBootedFile?: string;
  logger?: Logger;
  /** EY-1 (7b, 2026-11-19): Electron's `webContents.fromDevToolsTargetId`, the registry's resolver.
   * Absent: no registry, and no browser page binds for an agent. */
  controlTargetResolver?: BrowserControlTargetRegistryOptions["resolveTarget"];
}): ProductionLiveSurfaceSupport {
  const simctlCalls = opts.simctlCalls;
  let browserNative: ElectronBrowserSurfaceNative | null = null;
  /** BP-D4: the browser surfaces this support made — what "Clear browsing data" reloads (closed ones are let go there) */
  const browserSurfaces = new Set<BrowserLiveSurfaceRuntime>();
  const controlTargets =
    opts.controlTargetResolver === undefined
      ? null
      : new BrowserControlTargetRegistry({ resolveTarget: opts.controlTargetResolver });
  let captureStack: CaptureStack | null = null;
  let simctl: SimctlService | null = null;
  let simulatorSessions: SimulatorDeviceSessions | null = null;
  let disposed = false;

  const ensureBrowserNative = (): ElectronBrowserSurfaceNative => {
    if (browserNative === null) {
      browserNative = new ElectronBrowserSurfaceNative({
        // EY-1 (1f, 2026-11-19): a pop-up the run's policy allowed, refused by the address rule: the two diverged
        onPopupBeltRefused: () =>
          opts.logger?.warn(
            "desktop.pages.popup_belt_refused",
            "a pop-up the run's policy allowed was refused by the address rule",
          ),
      });
    }
    return browserNative;
  };

  const ensureSimctl = (): SimctlService => {
    if (simctl === null) {
      simctl = new SimctlService({
        ...(opts.simctlCandidates === undefined ? {} : { candidates: opts.simctlCandidates }),
        ...(simctlCalls === undefined
          ? {}
          : {
              onCall: (call: SimctlCall) => {
                simctlCalls[call] += 1;
              },
            }),
      });
    }
    return simctl;
  };

  const framebuffer = process.env["VF_SIMULATOR_FRAMEBUFFER"] !== "0";
  const ensureCapture = (): CaptureStack => {
    if (disposed || opts.capture === null) throw { kind: "UNAVAILABLE" };
    if (captureStack === null) {
      const adapter = loadMacosCaptureNativeAdapter(opts.capture.adapterPath);
      const supervisor = new MacosCaptureHelperSupervisor({
        helperPath: opts.capture.helperPath,
        adapter,
        onDiagnostic: (message) =>
          opts.logger?.info(
            "desktop.live_surfaces.capture_helper",
            "screen-capture helper diagnostic",
            { message },
          ),
      });
      const devices = ensureSimctl();
      const resolver = new IosSimulatorSourceResolver({
        devices,
        framebuffer,
        windows: supervisor,
        viewport: adapter,
      });
      const deviceResolver = new IosSimulatorSourceResolver({
        devices: ensureSimctl(),
        framebuffer,
        windows: supervisor,
        viewport: adapter,
      });
      captureStack = { supervisor, resolver, devices, deviceResolver };
    }
    return captureStack;
  };

  // PT-S2: built at the first bound phone; its capture half is asked for at each look, never at mint, so a shell
  // without one mints and says `no-simulator` (R5)
  const ensureSimulatorSessions = (): SimulatorDeviceSessions => {
    if (disposed) throw { kind: "UNAVAILABLE" };
    if (simulatorSessions === null) {
      simulatorSessions = new SimulatorDeviceSessions({
        framebuffer,
        simctl: ensureSimctl(),
        capture: () => {
          const stack = ensureCapture();
          return { resolver: stack.deviceResolver, client: stack.supervisor };
        },
        openSettings: opts.openSettings ?? (() => Promise.resolve()),
        ...(opts.simulatorBootedFile === undefined
          ? {}
          : {
              ownedLedger: fileOwnedDeviceLedger(opts.simulatorBootedFile, (message) =>
                opts.logger?.warn("desktop.live_surfaces.simulator_ledger", message),
              ),
            }),
        ...(opts.logger === undefined ? {} : { logger: opts.logger }),
      });
    }
    return simulatorSessions;
  };

  let setup: SimulatorSetupService | undefined;
  const simulatorSetup = () => {
    setup ??= new SimulatorSetupService(ensureSimctl());
    return setup;
  };

  return {
    checkSimulatorSetup: async () => {
      if (process.platform !== "darwin") return { stage: "unsupported" };
      if (disposed || !opts.capture) return { stage: "unavailable" };
      return simulatorSetup().check();
    },
    openSimulatorSetup: async (target) => {
      if (disposed || !opts.capture) throw new Error("Simulator setup is unavailable");
      await simulatorSetup().open(target);
    },
    factories: {
      browser: (surfaceId, source) => {
        const runtime = new BrowserLiveSurfaceRuntime({
          surfaceId,
          source,
          native: ensureBrowserNative(),
          ...(opts.browserProfilesRoot === undefined
            ? {}
            : { profilesRoot: opts.browserProfilesRoot }),
          ...(opts.browserProfilesPackaged === true ? { profilesPackaged: true } : {}),
          ...(controlTargets === null ? {} : { controlTargets }),
        });
        // a closed surface is let go as the next is made, so the set holds the open ones (and a few just closed)
        for (const surface of browserSurfaces)
          if (surface.isClosed()) browserSurfaces.delete(surface);
        browserSurfaces.add(runtime);
        return runtime;
      },
      sckWindow: (surfaceId, source) =>
        new SckLiveSurfaceRuntime({ surfaceId, source, client: ensureCapture().supervisor }),
      iosSimulator: (surfaceId, source) => {
        const stack = ensureCapture();
        return new IosSimulatorLiveSurfaceRuntime({
          surfaceId,
          source,
          resolver: stack.resolver,
          delegate: stack.supervisor,
        });
      },
      iosSimulatorDevice: (surfaceId, source) => ensureSimulatorSessions().open(surfaceId, source),
    },
    enumeration: {
      sckWindows: async () => {
        const stack = ensureCapture();
        const sources = await stack.supervisor.enumerateWindows(true);
        return sources.map((source) => ({
          sourceRef: source.sourceRef,
          title: source.title,
          appName: source.applicationName,
        }));
      },
      bootedSimulators: async () => {
        // Booted-device listing needs only simctl, but a picker row a user
        // cannot mint (no helper) would be a lie — gate both on the stack.
        const stack = ensureCapture();
        const devices = await stack.devices.enumerateBootedDevices();
        return devices.map((device) => ({
          sourceRef: device.udid,
          title: device.name,
          appName: device.runtimeName,
        }));
      },
    },
    simulatorDevices: {
      // a row a phone could not stream (no capture half) would be a lie, as a booted-simulator picker row would be
      list: async () => {
        if (disposed || opts.capture === null) return [];
        return await ensureSimctl().deviceRows();
      },
      configurations: async () =>
        disposed || opts.capture === null ? [] : ensureSimctl().configurations(),
      runtimes: async () => {
        if (disposed || opts.capture === null) return [];
        return await ensureSimctl().runtimeIds();
      },
    },
    clearBrowsingData: async () => {
      for (const surface of browserSurfaces)
        if (surface.isClosed()) browserSurfaces.delete(surface);
      const result = await clearBrowsingData({
        profilesRoot: opts.browserProfilesRoot,
        packaged: opts.browserProfilesPackaged === true,
        // BP-D10 (2026-11-25): the person's known browser profiles are the desk's alone until their list has its
        // store; a profile an open page has is cleared beside them, as before
        refs: [BROWSER_DESK_PROFILE_REF],
        surfaces: browserSurfaces,
        exists: existsSync,
        clearProfile: (path) => ensureBrowserNative().clearProfile(path),
      });
      opts.logger?.info(
        "desktop.live_surfaces.browser_data_cleared",
        "the browser profiles were cleared and their open pages reloaded",
        { ...result },
      );
      return result;
    },
    census: () => {
      // reads only: each `?.` is a thing not yet made, and stays unmade
      const stats = captureStack?.supervisor.stats;
      return {
        sessions: simulatorSessions?.size ?? 0,
        sessionsMade: simulatorSessions?.sessionsMade ?? 0,
        captureReady: captureStack !== null,
        helperPresent: opts.capture !== null && existsSync(opts.capture.helperPath),
        helper:
          stats === undefined
            ? null
            : {
                helperStarts: stats.helperStarts,
                helperExits: stats.helperExits,
                activeSessions: stats.activeSessions,
                framesReceived: stats.framesReceived,
                ...(stats.simulatorFramebufferStarts > 0
                  ? { simulatorFramebufferStarts: stats.simulatorFramebufferStarts }
                  : {}),
              },
        vetted: simctl?.vetted() ?? null,
        ...(simctlCalls === undefined ? {} : { simctl: { ...simctlCalls } }),
      };
    },
    controlTargets,
    pageClass: (surfaceId) => {
      for (const surface of browserSurfaces) {
        if (surface.surfaceId === surfaceId && !surface.isClosed()) {
          return pageClassOf(surface.source.profile);
        }
      }
      return null;
    },
    dispose: async () => {
      disposed = true;
      controlTargets?.clear();
      const phonesStopped = simulatorSessions?.dispose();
      simulatorSessions = null;
      const stack = captureStack;
      captureStack = null;
      browserNative = null;
      try {
        await Promise.all([phonesStopped, stack?.supervisor.dispose()]);
      } finally {
        simctl?.dispose();
        simctl = null;
      }
    },
  };
}
