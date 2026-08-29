import type { Logger } from "@vibefield/logging";
import type { LiveSurfaceEnumerationSources, LiveSurfaceRuntimeFactories } from "./authority";
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
  dispose(): Promise<void>;
}

interface CaptureStack {
  readonly supervisor: MacosCaptureHelperSupervisor;
  readonly resolver: IosSimulatorSourceResolver;
  readonly devices: SimctlDeviceCatalog;
}

export function createProductionLiveSurfaceSupport(opts: {
  capture: LiveSurfaceCapturePaths | null;
  logger?: Logger;
}): ProductionLiveSurfaceSupport {
  let browserNative: ElectronBrowserSurfaceNative | null = null;
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
      browser: (surfaceId, source) =>
        new BrowserLiveSurfaceRuntime({ surfaceId, source, native: ensureBrowserNative() }),
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
    dispose: async () => {
      disposed = true;
      const stack = captureStack;
      captureStack = null;
      browserNative = null;
      if (stack !== null) await stack.supervisor.dispose();
    },
  };
}
