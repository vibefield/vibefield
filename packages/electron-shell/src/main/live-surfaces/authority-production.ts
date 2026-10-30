import { existsSync } from "node:fs";
import type { BrowserDataClearResult } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type {
  LiveSurfaceEnumerationSources,
  LiveSurfaceRuntimeFactories,
  LiveSurfaceSimulatorDeviceSource,
} from "./authority";
import { clearBrowsingData } from "./browser-data";
import { ElectronBrowserSurfaceNative } from "./browser-electron-native";
import { BrowserLiveSurfaceRuntime } from "./browser-producer";
import { SimulatorDeviceSessions } from "./ios-simulator-device-runtime";
import {
  IosSimulatorLiveSurfaceRuntime,
  IosSimulatorSourceResolver,
  SimctlDeviceCatalog,
} from "./ios-simulator-producer";
import { MacosCaptureHelperSupervisor } from "./macos-capture-helper";
import { loadMacosCaptureNativeAdapter } from "./macos-capture-native";
import { SckLiveSurfaceRuntime } from "./sck-producer";
import { SimctlService } from "./simctl";

// DT-1c — the production binding of the authority's injectable seams onto the
// LSF runtime classes. Everything here is lazy: the browser native costs
// nothing until a browser surface exists, and the capture stack (native
// adapter + authenticated helper) spawns only when a capture kind is first
// enumerated or minted. Non-darwin and helper-less installs answer honest
// UNAVAILABLE; the browser kind keeps working everywhere. PT-S2: a bound phone
// (`ios-simulator-device`) is the exception — it MINTS everywhere and says
// `no-simulator` where there is none (R5); its simctl is one lazy service,
// independent of the capture stack, shared by every phone and the attach's
// device list (R8).

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
  dispose(): Promise<void>;
}

interface CaptureStack {
  readonly supervisor: MacosCaptureHelperSupervisor;
  readonly resolver: IosSimulatorSourceResolver;
  readonly devices: SimctlDeviceCatalog;
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
  logger?: Logger;
}): ProductionLiveSurfaceSupport {
  let browserNative: ElectronBrowserSurfaceNative | null = null;
  /** BP-D4: the browser surfaces this support made — what "Clear browsing data" reloads (closed ones are let go there) */
  const browserSurfaces = new Set<BrowserLiveSurfaceRuntime>();
  let captureStack: CaptureStack | null = null;
  let simctl: SimctlService | null = null;
  let simulatorSessions: SimulatorDeviceSessions | null = null;
  let disposed = false;

  const ensureBrowserNative = (): ElectronBrowserSurfaceNative => {
    if (browserNative === null) browserNative = new ElectronBrowserSurfaceNative();
    return browserNative;
  };

  const ensureSimctl = (): SimctlService => {
    if (simctl === null) simctl = new SimctlService();
    return simctl;
  };

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
      const devices = new SimctlDeviceCatalog({});
      const resolver = new IosSimulatorSourceResolver({
        devices,
        windows: supervisor,
        viewport: adapter,
      });
      const deviceResolver = new IosSimulatorSourceResolver({
        devices: ensureSimctl(),
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
        simctl: ensureSimctl(),
        capture: () => {
          const stack = ensureCapture();
          return { resolver: stack.deviceResolver, client: stack.supervisor };
        },
        openSettings: opts.openSettings ?? (() => Promise.resolve()),
        ...(opts.logger === undefined ? {} : { logger: opts.logger }),
      });
    }
    return simulatorSessions;
  };

  return {
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
      // the attach's third pick: the runtimes installed here, from the same shared list — none where no phone could stream
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
    dispose: async () => {
      disposed = true;
      simulatorSessions?.dispose();
      simulatorSessions = null;
      simctl?.dispose();
      simctl = null;
      const stack = captureStack;
      captureStack = null;
      browserNative = null;
      if (stack !== null) await stack.supervisor.dispose();
    },
  };
}
