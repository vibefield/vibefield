import { existsSync } from "node:fs";
import type { BrowserDataClearResult } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { LiveSurfaceEnumerationSources, LiveSurfaceRuntimeFactories } from "./authority";
import { clearBrowsingData } from "./browser-data";
import { ElectronBrowserSurfaceNative } from "./browser-electron-native";
import { BrowserLiveSurfaceRuntime } from "./browser-producer";
import {
  IosSimulatorLiveSurfaceRuntime,
  IosSimulatorSourceResolver,
  SimctlDeviceCatalog,
} from "./ios-simulator-producer";
import { MacosCaptureHelperSupervisor } from "./macos-capture-helper";
import { loadMacosCaptureNativeAdapter } from "./macos-capture-native";
import { SckLiveSurfaceRuntime } from "./sck-producer";

// DT-1c — the production binding of the authority's injectable seams onto the
// LSF runtime classes. Everything here is lazy: the browser native costs
// nothing until a browser surface exists, and the capture stack (native
// adapter + authenticated helper) spawns only when a capture kind is first
// enumerated or minted. Non-darwin and helper-less installs answer honest
// UNAVAILABLE; the browser kind keeps working everywhere.

export interface LiveSurfaceCapturePaths {
  readonly helperPath: string;
  readonly adapterPath: string;
}

export interface ProductionLiveSurfaceSupport {
  readonly factories: LiveSurfaceRuntimeFactories;
  readonly enumeration: LiveSurfaceEnumerationSources;
  /** BP-D4 — Settings' "Clear browsing data": this shell's persistent profiles cleared, their open pages reloaded
   * (`browser-data.ts`). */
  clearBrowsingData(): Promise<BrowserDataClearResult>;
  dispose(): Promise<void>;
}

interface CaptureStack {
  readonly supervisor: MacosCaptureHelperSupervisor;
  readonly resolver: IosSimulatorSourceResolver;
  readonly devices: SimctlDeviceCatalog;
}

export function createProductionLiveSurfaceSupport(opts: {
  capture: LiveSurfaceCapturePaths | null;
  /** PT-4: where the attached user's persistent browser profiles live (`<user root>/browser/profiles` — LAYOUT's): a
   * persistent browser source's session is a directory under it. Absent: Electron's own partitions. */
  browserProfilesRoot?: string;
  /** BP-D6: this shell is packaged — its profiles carry the packaged name, apart from an unpackaged shell's. */
  browserProfilesPackaged?: boolean;
  logger?: Logger;
}): ProductionLiveSurfaceSupport {
  let browserNative: ElectronBrowserSurfaceNative | null = null;
  /** BP-D4: the browser surfaces this support made — what "Clear browsing data" reloads (closed ones are let go there) */
  const browserSurfaces = new Set<BrowserLiveSurfaceRuntime>();
  let captureStack: CaptureStack | null = null;
  let disposed = false;

  const ensureBrowserNative = (): ElectronBrowserSurfaceNative => {
    if (browserNative === null) browserNative = new ElectronBrowserSurfaceNative();
    return browserNative;
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
      captureStack = { supervisor, resolver, devices };
    }
    return captureStack;
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
      const stack = captureStack;
      captureStack = null;
      browserNative = null;
      if (stack !== null) await stack.supervisor.dispose();
    },
  };
}
