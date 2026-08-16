import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BootedSimulatorDevice,
  IosSimulatorCaptureClient,
  type IosSimulatorResolutionProvider,
  IosSimulatorSourceResolver,
  parseBootedSimulatorDevices,
  type ResolvedIosSimulatorCapture,
  type SimulatorDeviceCatalog,
  type SimulatorWindowCatalog,
} from "../src/main/live-surfaces/ios-simulator-producer";
import type { MacosCaptureSource } from "../src/main/live-surfaces/macos-capture-helper";
import type { MacosSimulatorViewportResult } from "../src/main/live-surfaces/macos-capture-native";
import type {
  SckCaptureClient,
  SckCaptureClientStartRequest,
  SckCaptureSession,
} from "../src/main/live-surfaces/sck-producer";

const UDID = "F93EABF3-4281-4EB5-A5F6-A550FBE95CDC";
const device: BootedSimulatorDevice = {
  udid: UDID,
  name: "iPhone 17 Pro",
  runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
  runtimeName: "iOS 26.5",
  deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
};

function simulatorWindow(override: Partial<MacosCaptureSource> = {}): MacosCaptureSource {
  return {
    sourceRef: "0123456789abcdef0123456789abcdef",
    applicationName: "Simulator",
    bundleIdentifier: "com.apple.iphonesimulator",
    title: "iPhone 17 Pro",
    windowId: 77,
    ownerPid: 900,
    frame: { x: 636, y: 48, width: 456, height: 972 },
    onScreen: false,
    ...override,
  };
}

class FakeDevices implements SimulatorDeviceCatalog {
  constructor(readonly values: readonly BootedSimulatorDevice[] = [device]) {}

  async enumerateBootedDevices(): Promise<readonly BootedSimulatorDevice[]> {
    return this.values;
  }
}

class FakeWindows implements SimulatorWindowCatalog {
  readonly calls: boolean[] = [];

  constructor(readonly values: readonly MacosCaptureSource[] = [simulatorWindow()]) {}

  async enumerateWindows(allSpaces = true): Promise<readonly MacosCaptureSource[]> {
    this.calls.push(allSpaces);
    return this.values;
  }
}

function viewportResolved(
  override: Partial<Extract<MacosSimulatorViewportResult, { status: "resolved" }>> = {},
): Extract<MacosSimulatorViewportResult, { status: "resolved" }> {
  return {
    status: "resolved",
    sourceRect: { x: 27, y: 80, width: 402, height: 874 },
    windowTitle: "iPhone 17 Pro – iOS 26.5",
    ...override,
  };
}

function source(
  crop:
    | { mode: "auto" }
    | { mode: "none" }
    | {
        mode: "explicit";
        sourceRect: { x: number; y: number; width: number; height: number };
      } = { mode: "auto" },
  windowRef?: string,
) {
  return {
    kind: "ios-simulator" as const,
    udid: UDID,
    crop,
    ...(windowRef === undefined ? {} : { windowRef }),
  };
}

function resolverSetup(
  viewport: (ownerPid: number, frame: MacosCaptureSource["frame"]) => MacosSimulatorViewportResult,
  windows = new FakeWindows(),
) {
  const viewportSpy = vi.fn(viewport);
  const resolver = new IosSimulatorSourceResolver({
    devices: new FakeDevices(),
    windows,
    viewport: { resolveSimulatorViewport: viewportSpy },
  });
  return { resolver, viewportSpy, windows };
}

class FakeDelegate implements SckCaptureClient {
  readonly requests: SckCaptureClientStartRequest[] = [];
  readonly setDemand = vi.fn(async () => undefined);
  readonly dispose = vi.fn(async () => undefined);

  async startSession(request: SckCaptureClientStartRequest): Promise<SckCaptureSession> {
    this.requests.push(request);
    return { setDemand: this.setDemand, dispose: this.dispose };
  }
}

function resolvedCapture(
  fingerprint: string,
  window = simulatorWindow(),
): ResolvedIosSimulatorCapture {
  return {
    device,
    window,
    source: {
      kind: "sck-window",
      sourceRef: window.sourceRef,
      crop: { mode: "explicit", sourceRect: { x: 27, y: 80, width: 402, height: 874 } },
      captureCursor: false,
    },
    geometry: {
      logicalSize: { width: 402, height: 874 },
      orientation: 0,
      cropState: "applied",
    },
    fingerprint,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Simulator resolution", () => {
  it("strictly extracts only available booted devices from simctl metadata", () => {
    const parsed = parseBootedSimulatorDevices(
      JSON.stringify({
        runtimes: [
          {
            identifier: device.runtimeIdentifier,
            name: device.runtimeName,
            isAvailable: true,
          },
        ],
        devices: {
          [device.runtimeIdentifier]: [
            {
              udid: UDID,
              name: device.name,
              deviceTypeIdentifier: device.deviceTypeIdentifier,
              state: "Booted",
              isAvailable: true,
            },
            {
              udid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
              name: "iPhone 17 Pro Max",
              deviceTypeIdentifier: "type.max",
              state: "Shutdown",
              isAvailable: true,
            },
          ],
        },
      }),
    );
    expect(parsed).toEqual([device]);
    expect(() => parseBootedSimulatorDevices("not-json")).toThrow(/malformed JSON/);
  });

  it("matches a booted UDID to an inactive-Space window and applies the declared content group", async () => {
    const result = resolverSetup(() => viewportResolved());
    await expect(result.resolver.resolve(source())).resolves.toMatchObject({
      device: { udid: UDID, runtimeName: "iOS 26.5" },
      window: { title: "iPhone 17 Pro", onScreen: false },
      source: {
        kind: "sck-window",
        crop: {
          mode: "explicit",
          sourceRect: { x: 27, y: 80, width: 402, height: 874 },
        },
      },
      geometry: {
        logicalSize: { width: 402, height: 874 },
        orientation: 0,
        cropState: "applied",
      },
    });
    expect(result.windows.calls).toEqual([true]);
    expect(result.viewportSpy).toHaveBeenCalledWith(900, {
      x: 636,
      y: 48,
      width: 456,
      height: 972,
    });
  });

  it("keeps the full window and marks degraded geometry when Accessibility cannot prove a crop", async () => {
    const result = resolverSetup(() => ({ status: "permission-denied" }));
    await expect(result.resolver.resolve(source())).resolves.toMatchObject({
      source: { crop: { mode: "none" } },
      geometry: {
        logicalSize: { width: 456, height: 972 },
        cropState: "degraded",
      },
    });
  });

  it("honors a validated explicit viewport without querying Accessibility", async () => {
    const result = resolverSetup(() => ({ status: "viewport-not-found" }));
    await expect(
      result.resolver.resolve(
        source({
          mode: "explicit",
          sourceRect: { x: 20, y: 60, width: 410, height: 890 },
        }),
      ),
    ).resolves.toMatchObject({
      source: {
        crop: {
          mode: "explicit",
          sourceRect: { x: 20, y: 60, width: 410, height: 890 },
        },
      },
      geometry: { logicalSize: { width: 410, height: 890 }, cropState: "applied" },
    });
    expect(result.viewportSpy).not.toHaveBeenCalled();
  });

  it("uses exact AX runtime identity to disambiguate same-named Simulator windows", async () => {
    const first = simulatorWindow({
      sourceRef: "11111111111111111111111111111111",
      windowId: 1,
      frame: { x: 10, y: 10, width: 456, height: 972 },
    });
    const second = simulatorWindow({
      sourceRef: "22222222222222222222222222222222",
      windowId: 2,
      frame: { x: 500, y: 10, width: 456, height: 972 },
    });
    const result = resolverSetup(
      (_pid, frame) =>
        viewportResolved({
          windowTitle:
            frame.x === first.frame.x ? "iPhone 17 Pro – iOS 26.1" : "iPhone 17 Pro – iOS 26.5",
        }),
      new FakeWindows([first, second]),
    );
    await expect(result.resolver.resolve(source())).resolves.toMatchObject({
      window: { sourceRef: second.sourceRef, windowId: 2 },
    });
  });

  it("rejects shutdown devices, stale hints, and out-of-window explicit crops", async () => {
    const empty = new IosSimulatorSourceResolver({
      devices: new FakeDevices([]),
      windows: new FakeWindows(),
      viewport: { resolveSimulatorViewport: () => viewportResolved() },
    });
    await expect(empty.resolve(source())).rejects.toMatchObject({
      surfaceError: { code: "source-not-found", recovery: "automatic" },
    });

    const result = resolverSetup(() => viewportResolved());
    await expect(
      result.resolver.resolve(source({ mode: "auto" }, "stale-ref")),
    ).rejects.toMatchObject({ surfaceError: { code: "source-not-found" } });
    await expect(
      result.resolver.resolve(
        source({ mode: "explicit", sourceRect: { x: 40, y: 80, width: 430, height: 874 } }),
      ),
    ).rejects.toMatchObject({
      surfaceError: { code: "source-not-found", recovery: "user-action" },
    });
  });
});

describe("IosSimulatorCaptureClient", () => {
  it("passes only the resolved SCK source/geometry and faults once when revalidation changes", async () => {
    vi.useFakeTimers();
    const resolve = vi
      .fn<IosSimulatorResolutionProvider["resolve"]>()
      .mockResolvedValueOnce(resolvedCapture("portrait"))
      .mockResolvedValue(resolvedCapture("landscape"));
    const delegate = new FakeDelegate();
    const client = new IosSimulatorCaptureClient({
      source: source(),
      resolver: { resolve },
      delegate,
      revalidateIntervalMs: 50,
    });
    const onFault = vi.fn();
    const session = await client.startSession({
      producerEpoch: 1,
      source: {
        kind: "sck-window",
        sourceRef: "ios-simulator-placeholder",
        crop: { mode: "none" },
        captureCursor: false,
      },
      demand: { revision: 1, mode: "live", targetFps: 30 },
      onFrame: () => undefined,
      onFault,
    });
    expect(delegate.requests[0]).toMatchObject({
      source: {
        sourceRef: "0123456789abcdef0123456789abcdef",
        crop: { mode: "explicit" },
      },
      geometry: { logicalSize: { width: 402, height: 874 }, cropState: "applied" },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(onFault).toHaveBeenCalledOnce();
    expect(onFault).toHaveBeenCalledWith({
      code: "source-closed",
      message: "Simulator window geometry changed and will be rebound",
      recovery: "automatic",
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(onFault).toHaveBeenCalledOnce();
    await session.dispose();
    expect(delegate.dispose).toHaveBeenCalledOnce();
  });

  it("suspends low-rate revalidation with non-live demand and resumes it", async () => {
    vi.useFakeTimers();
    const resolve = vi
      .fn<IosSimulatorResolutionProvider["resolve"]>()
      .mockResolvedValue(resolvedCapture("stable"));
    const delegate = new FakeDelegate();
    const client = new IosSimulatorCaptureClient({
      source: source(),
      resolver: { resolve },
      delegate,
      revalidateIntervalMs: 50,
    });
    const session = await client.startSession({
      producerEpoch: 1,
      source: {
        kind: "sck-window",
        sourceRef: "ios-simulator-placeholder",
        captureCursor: false,
      },
      demand: { revision: 1, mode: "live", targetFps: 30 },
      onFrame: () => undefined,
      onFault: () => undefined,
    });
    await session.setDemand({ revision: 2, mode: "paused", targetFps: 0 });
    await vi.advanceTimersByTimeAsync(500);
    expect(resolve).toHaveBeenCalledOnce();
    await session.setDemand({ revision: 3, mode: "live", targetFps: 30 });
    await vi.advanceTimersByTimeAsync(50);
    expect(resolve).toHaveBeenCalledTimes(2);
    await session.dispose();
  });
});
