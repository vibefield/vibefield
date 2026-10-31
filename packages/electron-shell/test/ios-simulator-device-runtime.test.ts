import type {
  LiveSurfaceDemandV1,
  LiveSurfaceDeviceVerbV1,
  LiveSurfaceIosSimulatorBindingV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type IosSimulatorDeviceLiveSurfaceRuntime,
  type SimulatorDeviceCapture,
  SimulatorDeviceSessions,
  type SimulatorDeviceSimctl,
} from "../src/main/live-surfaces/ios-simulator-device-runtime";
import type {
  IosSimulatorResolutionProvider,
  ResolvedIosSimulatorCapture,
} from "../src/main/live-surfaces/ios-simulator-producer";
import type { LiveSurfaceRuntimeAttachContext } from "../src/main/live-surfaces/runtime";
import {
  type SckCaptureClient,
  SckCaptureClientError,
  type SckCaptureClientStartRequest,
  type SckCaptureFrame,
  type SckCaptureSession,
} from "../src/main/live-surfaces/sck-producer";
import {
  parseSimctlSnapshot,
  type SimctlSnapshot,
  SimctlUnavailableError,
} from "../src/main/live-surfaces/simctl";
import type { LiveSurfaceProducerTextureFrame } from "../src/main/live-surfaces/texture-forwarder";

// PT-S2 — the bound simulator's condition machine over fakes: a scripted simctl (the `SimctlService` seam), a scripted
// window resolver and the SCK client fake of `sck-live-surface-runtime.test.ts`, under fake timers. The inner runtime is
// the real `IosSimulatorLiveSurfaceRuntime`.

const SURFACE_A = "simdev_surface_000000000a";
const SURFACE_B = "simdev_surface_000000000b";
const PRO = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const IOS_26_5 = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const IOS_27_0 = "com.apple.CoreSimulator.SimRuntime.iOS-27-0";
const UDID = "F93EABF3-4281-4EB5-A5F6-A550FBE95CDC";
const UDID_2 = "0B2A5C11-3C51-4E77-9D9A-6C1AC0FFEE02";
const NEW_UDID = "11111111-2222-4333-8444-555555555555";
const PHONE = { deviceType: PRO, runtime: IOS_26_5 } as const;

function rawDevice(udid: string, state: string, name = "iPhone 17 Pro") {
  return { udid, name, state, deviceTypeIdentifier: PRO, isAvailable: true };
}

function listJson(devices: Record<string, readonly Record<string, unknown>[]>): string {
  const pro = [{ identifier: PRO, name: "iPhone 17 Pro" }];
  return JSON.stringify({
    devicetypes: pro,
    runtimes: [
      {
        identifier: IOS_26_1,
        name: "iOS 26.1",
        version: "26.1",
        isAvailable: true,
        supportedDeviceTypes: pro,
      },
      {
        identifier: IOS_26_5,
        name: "iOS 26.5",
        version: "26.5",
        isAvailable: true,
        supportedDeviceTypes: pro,
      },
    ],
    devices,
  });
}

class FakeSimctl implements SimulatorDeviceSimctl {
  readonly calls: string[] = [];
  lists = 0;
  invalidations = 0;
  unavailable = false;
  /** when set, every act's verb waits on it (single-flight rows) */
  gate: Promise<void> | null = null;
  /** when set, every list is read at its call and answered when it opens (a list in flight) */
  listGate: Promise<void> | null = null;

  constructor(public raw: string) {}

  async list(): Promise<SimctlSnapshot> {
    this.lists += 1;
    if (this.unavailable) throw new SimctlUnavailableError();
    const raw = this.raw;
    if (this.listGate !== null) await this.listGate;
    return parseSimctlSnapshot(raw);
  }

  invalidate(): void {
    this.invalidations += 1;
  }

  async boot(udid: string): Promise<void> {
    this.calls.push(`boot ${udid}`);
    await this.gate;
  }

  async create(name: string, deviceType: string, runtime: string): Promise<string> {
    this.calls.push(`create ${name} ${deviceType} ${runtime}`);
    await this.gate;
    return NEW_UDID;
  }

  async show(udid: string): Promise<void> {
    this.calls.push(`show ${udid}`);
    await this.gate;
  }
}

class FakeSession implements SckCaptureSession {
  readonly demands: Parameters<SckCaptureSession["setDemand"]>[0][] = [];
  readonly dispose = vi.fn(async () => undefined);

  async setDemand(demand: Parameters<SckCaptureSession["setDemand"]>[0]): Promise<void> {
    this.demands.push(demand);
  }
}

class FakeClient implements SckCaptureClient {
  readonly requests: SckCaptureClientStartRequest[] = [];

  async startSession(request: SckCaptureClientStartRequest): Promise<SckCaptureSession> {
    this.requests.push(request);
    return new FakeSession();
  }
}

type WindowScript = "found" | "degraded" | "none" | "ambiguous" | "denied";

function resolvedCapture(udid: string, degraded: boolean): ResolvedIosSimulatorCapture {
  return {
    device: {
      udid,
      name: "iPhone 17 Pro",
      runtimeIdentifier: IOS_26_5,
      runtimeName: "iOS 26.5",
      deviceTypeIdentifier: PRO,
    },
    window: {
      sourceRef: "0123456789abcdef0123456789abcdef",
      applicationName: "Simulator",
      bundleIdentifier: "com.apple.iphonesimulator",
      title: "iPhone 17 Pro",
      windowId: 77,
      ownerPid: 900,
      frame: { x: 636, y: 48, width: 456, height: 972 },
      onScreen: false,
    },
    source: {
      kind: "sck-window",
      sourceRef: "0123456789abcdef0123456789abcdef",
      crop: degraded
        ? { mode: "none" }
        : { mode: "explicit", sourceRect: { x: 27, y: 80, width: 402, height: 874 } },
      captureCursor: false,
    },
    geometry: {
      logicalSize: degraded ? { width: 456, height: 972 } : { width: 402, height: 874 },
      orientation: 0,
      cropState: degraded ? "degraded" : "applied",
    },
    fingerprint: `${udid}:${degraded ? "degraded" : "applied"}`,
  };
}

class FakeCapture implements SimulatorDeviceCapture {
  readonly client = new FakeClient();
  /** the UDIDs main asked the resolver for, in order */
  readonly resolved: string[] = [];
  window: WindowScript = "found";
  readonly resolver: IosSimulatorResolutionProvider = {
    resolve: async (source) => {
      this.resolved.push(source.udid);
      switch (this.window) {
        case "found":
        case "degraded":
          return resolvedCapture(source.udid, this.window === "degraded");
        case "none":
          throw new SckCaptureClientError(
            {
              code: "source-not-found",
              message: "The booted Simulator device has no capture window",
              recovery: "automatic",
            },
            "no-window",
          );
        case "ambiguous":
          throw new SckCaptureClientError(
            {
              code: "source-not-found",
              message: "The Simulator window identity is ambiguous",
              recovery: "automatic",
            },
            "ambiguous",
          );
        case "denied":
          throw new SckCaptureClientError({
            code: "permission-denied",
            message: "Screen Recording is not granted",
            recovery: "user-action",
          });
      }
    },
  };
}

function setup(options: { readonly raw?: string; readonly capture?: FakeCapture | null } = {}) {
  const simctl = new FakeSimctl(
    options.raw ?? listJson({ [IOS_26_5]: [rawDevice(UDID, "Booted")] }),
  );
  const capture = options.capture === undefined ? new FakeCapture() : options.capture;
  const settings = { opened: 0, gate: null as Promise<void> | null };
  const sessions = new SimulatorDeviceSessions({
    simctl,
    capture: () => {
      // a shell with no capture half (not a Mac, or no helper): production's ensureCapture throws UNAVAILABLE
      if (capture === null)
        throw Object.assign(new Error("capture unavailable"), { kind: "UNAVAILABLE" });
      return capture;
    },
    openSettings: async () => {
      settings.opened += 1;
      await settings.gate;
    },
    monotonicNowUs: () => 123_456n,
  });
  return { simctl, capture, settings, sessions };
}

function open(
  sessions: SimulatorDeviceSessions,
  surfaceId = SURFACE_A,
  binding: LiveSurfaceIosSimulatorBindingV1 = PHONE,
): IosSimulatorDeviceLiveSurfaceRuntime {
  return sessions.open(surfaceId, {
    kind: "ios-simulator-device",
    binding,
    crop: { mode: "auto" },
  });
}

function attach(
  runtime: IosSimulatorDeviceLiveSurfaceRuntime,
  attachmentId = "attachment_simdev_0001",
) {
  const summaries: LiveSurfaceRuntimeSummaryV1[] = [];
  const frames: LiveSurfaceProducerTextureFrame[] = [];
  const context: LiveSurfaceRuntimeAttachContext = {
    attachmentId,
    rendererGeneration: 1,
    operations: ["view", "device"],
    publishSummary: (summary) => summaries.push(summary),
    publishCpuFrame: () => false,
    offerTextureFrame: (frame) => {
      frames.push(frame);
      frame.releaseSource("imported");
      frame.allReferencesReleased("released");
      return { kind: "accepted", transfer: Promise.resolve() };
    },
  };
  const attachment = runtime.attach(context);
  const initial = attachment.summary;
  return {
    attachment,
    summaries,
    frames,
    /** what the face holds now: the last summary published, else the one it attached with */
    latest: () => summaries.at(-1) ?? initial,
    all: () => [initial, ...summaries],
    act: (verb: LiveSurfaceDeviceVerbV1) => attachment.device?.({ verb }),
  };
}

function demand(revision: number, mode: LiveSurfaceDemandV1["mode"] = "live"): LiveSurfaceDemandV1 {
  return {
    revision,
    mode,
    targetFps: mode === "live" ? 30 : 0,
    priority: mode === "live" ? 50 : 0,
    interactive: false,
  };
}

function captureFrame(epoch: number, sequence = 1n): SckCaptureFrame {
  return {
    producerEpoch: epoch,
    sequence,
    codedSize: { width: 804, height: 1748 },
    logicalSize: { width: 402, height: 874 },
    timestampUs: 42n,
    textureInfo: {
      codedSize: { width: 804, height: 1748 },
      visibleRect: { x: 0, y: 0, width: 804, height: 1748 },
      pixelFormat: "bgra",
      handle: { ioSurface: Buffer.alloc(8) },
    },
    releaseLocal: vi.fn(),
    releaseLease: vi.fn(),
  };
}

/** every promise chain the fakes start, settled (fake timers hold the clock) */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await vi.advanceTimersByTimeAsync(0);
}

/** R7: what a face is told never moves backwards — the control session would kill the window's generation. */
function expectMonotonic(
  summaries: readonly LiveSurfaceRuntimeSummaryV1[],
  surfaceId: string,
): void {
  for (const [index, summary] of summaries.entries()) {
    expect(summary.surfaceId).toBe(surfaceId);
    const previous = summaries[index - 1];
    if (previous === undefined) continue;
    expect(summary.stateRevision).toBeGreaterThanOrEqual(previous.stateRevision);
    expect(summary.producerEpoch).toBeGreaterThanOrEqual(previous.producerEpoch);
    if (summary.stateRevision === previous.stateRevision) {
      expect(summary.state).toBe(previous.state);
      expect(summary.producerEpoch).toBe(previous.producerEpoch);
    }
  }
}

function expectNoUdid(value: unknown): void {
  const said = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  for (const udid of [UDID, UDID_2, NEW_UDID]) {
    expect(said).not.toContain(udid);
    expect(said).not.toContain(udid.toLowerCase());
  }
  expect(said).not.toContain('"udid"');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IosSimulatorDeviceLiveSurfaceRuntime — the conditions (R2)", () => {
  it("says nothing of the device before its first look, then where it is and what main attached", async () => {
    const { sessions } = setup();
    const runtime = open(sessions);
    expect(runtime.summary.simulator).toBeUndefined();
    expect(runtime.summary.surfaceId).toBe(SURFACE_A);
    const face = attach(runtime);
    await settle();
    expect(face.latest().simulator).toEqual({
      condition: "streaming",
      name: "iPhone 17 Pro",
      deviceType: PRO,
      runtime: IOS_26_5,
    });
  });

  it("no-simulator: a shell with no capture half never runs simctl (R5), and simctl's failed probe says the same", async () => {
    const helperless = setup({ capture: null });
    const face = attach(open(helperless.sessions));
    await settle();
    expect(face.latest().simulator).toEqual({ condition: "no-simulator" });
    expect(helperless.simctl.lists).toBe(0);

    const xcodeless = setup();
    xcodeless.simctl.unavailable = true;
    const other = attach(open(xcodeless.sessions));
    await settle();
    expect(other.latest().simulator).toEqual({ condition: "no-simulator" });
  });

  it("no-device names the bound type; off and booting are the device's own; the attached runtime is told honestly (R3)", async () => {
    const none = setup({ raw: listJson({ [IOS_26_5]: [] }) });
    const noDevice = attach(open(none.sessions));
    await settle();
    expect(noDevice.latest().simulator).toEqual({ condition: "no-device", name: "iPhone 17 Pro" });

    // the bound 26.5 has no 17 Pro on this Mac: the 26.1 one is attached, and said
    const elsewhere = setup({ raw: listJson({ [IOS_26_1]: [rawDevice(UDID, "Shutdown")] }) });
    const off = attach(open(elsewhere.sessions));
    await settle();
    expect(off.latest().simulator).toEqual({
      condition: "off",
      name: "iPhone 17 Pro",
      deviceType: PRO,
      runtime: IOS_26_1,
    });

    const rising = setup({ raw: listJson({ [IOS_26_5]: [rawDevice(UDID, "Booting")] }) });
    const booting = attach(open(rising.sessions));
    await settle();
    expect(booting.latest().simulator?.condition).toBe("booting");
  });

  it("no-window and no-permission from the resolver's TYPED refusals; a crop with no Accessibility is streaming, degraded (R6)", async () => {
    const windowless = setup();
    windowless.capture!.window = "none";
    const noWindow = attach(open(windowless.sessions));
    await settle();
    noWindow.attachment.setDemand(demand(1));
    await settle();
    expect(noWindow.latest().simulator?.condition).toBe("no-window");

    const twins = setup();
    twins.capture!.window = "ambiguous";
    const ambiguous = attach(open(twins.sessions));
    await settle();
    ambiguous.attachment.setDemand(demand(1));
    await settle();
    expect(ambiguous.latest().simulator?.condition).toBe("no-window");

    const refused = setup();
    refused.capture!.window = "denied";
    const denied = attach(open(refused.sessions));
    await settle();
    denied.attachment.setDemand(demand(1));
    await settle();
    expect(denied.latest().simulator?.condition).toBe("no-permission");

    const plain = setup();
    plain.capture!.window = "degraded";
    const degraded = attach(open(plain.sessions));
    await settle();
    degraded.attachment.setDemand(demand(1));
    await settle();
    expect(degraded.latest().simulator).toMatchObject({ condition: "streaming", degraded: true });
  });

  it("stopped: it streamed and its window went while the device stayed booted — a device shut down then is off", async () => {
    const { simctl, capture, sessions } = setup();
    const face = attach(open(sessions));
    await settle();
    face.attachment.setDemand(demand(1));
    await settle();
    const request = capture!.client.requests[0]!;
    request.onFrame(captureFrame(request.producerEpoch));
    expect(face.latest()).toMatchObject({ state: "live", simulator: { condition: "streaming" } });

    // Simulator.app quit: the inner's 1 s revalidation finds no window
    capture!.window = "none";
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(face.latest().simulator?.condition).toBe("stopped");
    // withheld: the inner lets its stream go rather than retry an absent window
    expect(face.latest().state).toBe("hibernated");

    simctl.raw = listJson({ [IOS_26_5]: [rawDevice(UDID, "Shutdown")] });
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(face.latest().simulator?.condition).toBe("off");
    expectMonotonic(face.all(), SURFACE_A);
  });
});

describe("IosSimulatorDeviceLiveSurfaceRuntime — the gate and the inner (R7)", () => {
  it("withholds the renderer's ask until the device streams, then re-forwards it — the summaries only move forwards", async () => {
    const { simctl, capture, sessions } = setup({
      raw: listJson({ [IOS_26_5]: [rawDevice(UDID, "Shutdown")] }),
    });
    const runtime = open(sessions);
    const face = attach(runtime);
    await settle();
    face.attachment.setDemand(demand(1));
    await settle();
    expect(face.latest().simulator?.condition).toBe("off");
    expect(capture!.client.requests).toHaveLength(0);
    expect(runtime.supportSnapshot().effectiveDemand?.mode).toBe("hibernated");

    simctl.raw = listJson({ [IOS_26_5]: [rawDevice(UDID, "Booted")] });
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(face.latest().simulator?.condition).toBe("streaming");
    expect(capture!.client.requests).toHaveLength(1);
    expect(runtime.supportSnapshot().effectiveDemand).toMatchObject({
      mode: "live",
      targetFps: 30,
    });
    expect(capture!.resolved).toEqual([UDID]);

    const request = capture!.client.requests[0]!;
    request.onFrame(captureFrame(request.producerEpoch));
    expect(face.frames.map((frame) => frame.metadata.surfaceId)).toEqual([SURFACE_A]);
    expect(face.latest().state).toBe("live");
    expectMonotonic(face.all(), SURFACE_A);
  });

  it("re-forwards when the window appears under a live ask, probing it only under that ask", async () => {
    const { capture, sessions } = setup();
    capture!.window = "none";
    const face = attach(open(sessions));
    await settle();
    // at rest nothing asks the helper for windows: only simctl runs
    await vi.advanceTimersByTimeAsync(10_000);
    expect(capture!.resolved).toEqual([]);
    face.attachment.setDemand(demand(1));
    await settle();
    expect(face.latest().simulator?.condition).toBe("no-window");
    expect(capture!.client.requests).toHaveLength(0);

    capture!.window = "found";
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(face.latest().simulator?.condition).toBe("streaming");
    expect(capture!.client.requests).toHaveLength(1);
    expectMonotonic(face.all(), SURFACE_A);
  });

  it("moves to another device by its resolver, never by a fresh inner", async () => {
    const { simctl, capture, sessions } = setup({
      raw: listJson({ [IOS_26_1]: [rawDevice(UDID, "Booted")] }),
    });
    const face = attach(open(sessions));
    await settle();
    face.attachment.setDemand(demand(1));
    await settle();
    const first = capture!.client.requests[0]!;
    first.onFrame(captureFrame(first.producerEpoch));
    expect(face.latest().simulator).toMatchObject({ condition: "streaming", runtime: IOS_26_1 });

    // the bound runtime's own 17 Pro appears, booted: the exact tier wins
    simctl.raw = listJson({
      [IOS_26_1]: [rawDevice(UDID, "Booted")],
      [IOS_26_5]: [rawDevice(UDID_2, "Booted")],
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(face.latest().simulator).toMatchObject({ condition: "streaming", runtime: IOS_26_5 });
    expect(capture!.resolved.at(-1)).toBe(UDID_2);
    expect(capture!.client.requests.length).toBeGreaterThanOrEqual(2);
    expectMonotonic(face.all(), SURFACE_A);
  });

  it("watches every ~2 s while the device is not streaming and every ~5 s at rest, and only while a face is attached", async () => {
    const { simctl, sessions } = setup({
      raw: listJson({ [IOS_26_5]: [rawDevice(UDID, "Shutdown")] }),
    });
    const runtime = open(sessions);
    expect(simctl.lists).toBe(0);
    const face = attach(runtime);
    await settle();
    expect(simctl.lists).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(simctl.lists).toBe(2);
    simctl.raw = listJson({ [IOS_26_5]: [rawDevice(UDID, "Booted")] });
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(simctl.lists).toBe(3);
    expect(face.latest().simulator?.condition).toBe("streaming");
    await vi.advanceTimersByTimeAsync(4_000);
    expect(simctl.lists).toBe(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(simctl.lists).toBe(4);
    face.attachment.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(simctl.lists).toBe(4);
  });
});

describe("IosSimulatorDeviceLiveSurfaceRuntime — the acts (R4)", () => {
  it("boot boots then shows, single-flight with `acting` said; an act its condition does not offer is nothing", async () => {
    const { simctl, sessions, settings } = setup({
      raw: listJson({ [IOS_26_5]: [rawDevice(UDID, "Shutdown")] }),
    });
    const face = attach(open(sessions));
    await settle();
    expect(face.latest().simulator?.condition).toBe("off");
    for (const verb of ["create", "show", "retry", "open-settings"] as const) face.act(verb);
    await settle();
    expect(simctl.calls).toEqual([]);
    expect(settings.opened).toBe(0);

    let release!: () => void;
    simctl.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    face.act("boot");
    expect(face.latest().simulator).toMatchObject({ condition: "booting", acting: "boot" });
    face.act("boot");
    await settle();
    expect(simctl.calls).toEqual([`boot ${UDID}`]);

    simctl.raw = listJson({ [IOS_26_5]: [rawDevice(UDID, "Booted")] });
    release();
    await settle();
    expect(simctl.calls).toEqual([`boot ${UDID}`, `show ${UDID}`]);
    expect(simctl.invalidations).toBeGreaterThan(0);
    expect(face.latest().simulator).toEqual({
      condition: "streaming",
      name: "iPhone 17 Pro",
      deviceType: PRO,
      runtime: IOS_26_5,
    });
  });

  it("create makes one of the bound type on the bound runtime, boots and shows it — ONE act", async () => {
    const { simctl, sessions } = setup({ raw: listJson({ [IOS_26_5]: [] }) });
    const face = attach(open(sessions));
    await settle();
    expect(face.latest().simulator?.condition).toBe("no-device");
    face.act("boot");
    await settle();
    expect(simctl.calls).toEqual([]);

    face.act("create");
    expect(face.latest().simulator).toMatchObject({ condition: "booting", acting: "create" });
    simctl.raw = listJson({ [IOS_26_5]: [rawDevice(NEW_UDID, "Booted")] });
    await settle();
    expect(simctl.calls).toEqual([
      `create iPhone 17 Pro ${PRO} ${IOS_26_5}`,
      `boot ${NEW_UDID}`,
      `show ${NEW_UDID}`,
    ]);
    expect(face.latest().simulator).toEqual({
      condition: "streaming",
      name: "iPhone 17 Pro",
      deviceType: PRO,
      runtime: IOS_26_5,
    });
  });

  it("an act's flight lasts until CoreSimulator is read afresh: a second Create it while that read is out makes no twin of the phone just made", async () => {
    const { simctl, sessions } = setup({ raw: listJson({ [IOS_26_5]: [] }) });
    const face = attach(open(sessions));
    await settle();
    expect(face.latest().simulator?.condition).toBe("no-device");

    let release!: () => void;
    simctl.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    simctl.raw = listJson({ [IOS_26_5]: [rawDevice(NEW_UDID, "Booted")] });
    const told = face.all().length;
    face.act("create");
    await settle();
    // created, booted and shown — the list after them still out: the act is in flight yet, and offers nothing
    expect(simctl.calls).toEqual([
      `create iPhone 17 Pro ${PRO} ${IOS_26_5}`,
      `boot ${NEW_UDID}`,
      `show ${NEW_UDID}`,
    ]);
    expect(face.latest().simulator).toMatchObject({ condition: "booting", acting: "create" });
    face.act("create");
    await settle();
    expect(simctl.calls).toHaveLength(3);

    release();
    await settle();
    expect(face.latest().simulator).toEqual({
      condition: "streaming",
      name: "iPhone 17 Pro",
      deviceType: PRO,
      runtime: IOS_26_5,
    });
    face.act("create");
    await settle();
    expect(simctl.calls.filter((call) => call.startsWith("create "))).toHaveLength(1);
    // from the press on, the face never went back to offering Create it
    expect(
      face
        .all()
        .slice(told)
        .map((summary) => summary.simulator?.condition),
    ).not.toContain("no-device");
  });

  it("show opens the device's window and reads as booting while Simulator.app draws it", async () => {
    const { simctl, capture, sessions } = setup();
    capture!.window = "none";
    const face = attach(open(sessions));
    await settle();
    face.attachment.setDemand(demand(1));
    await settle();
    expect(face.latest().simulator?.condition).toBe("no-window");
    face.act("show");
    await settle();
    expect(simctl.calls).toEqual([`show ${UDID}`]);
    expect(face.latest().simulator?.condition).toBe("booting");

    capture!.window = "found";
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(face.latest().simulator?.condition).toBe("streaming");
    expect(capture!.client.requests).toHaveLength(1);
  });

  it("retry shows a windowless device first, then streams on a FRESH live demand", async () => {
    const { simctl, capture, sessions } = setup();
    const face = attach(open(sessions));
    await settle();
    face.attachment.setDemand(demand(1));
    await settle();
    const first = capture!.client.requests[0]!;
    first.onFrame(captureFrame(first.producerEpoch));
    capture!.window = "none";
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(face.latest().simulator?.condition).toBe("stopped");

    capture!.window = "found";
    face.act("retry");
    await settle();
    expect(simctl.calls).toEqual([`show ${UDID}`]);
    expect(face.latest().simulator?.condition).toBe("streaming");
    expect(capture!.client.requests).toHaveLength(2);
    expectMonotonic(face.all(), SURFACE_A);
  });

  it("open-settings opens main's settings address only under no-permission, once at a time", async () => {
    const { sessions, settings, capture } = setup();
    const face = attach(open(sessions));
    await settle();
    face.act("open-settings");
    await settle();
    expect(settings.opened).toBe(0);

    capture!.window = "denied";
    face.attachment.setDemand(demand(1));
    await settle();
    expect(face.latest().simulator?.condition).toBe("no-permission");
    let release!: () => void;
    settings.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    face.act("open-settings");
    face.act("open-settings");
    expect(face.latest().simulator).toMatchObject({
      condition: "no-permission",
      acting: "open-settings",
    });
    release();
    await settle();
    expect(settings.opened).toBe(1);
    expect(face.latest().simulator?.acting).toBeUndefined();
  });
});

describe("IosSimulatorDeviceLiveSurfaceRuntime — never a UDID, one stream a device", () => {
  it("never says a UDID in a summary, a frame's metadata or the support snapshot", async () => {
    const { capture, sessions } = setup();
    const runtime = open(sessions);
    const face = attach(runtime);
    await settle();
    face.attachment.setDemand(demand(1));
    await settle();
    const request = capture!.client.requests[0]!;
    request.onFrame(captureFrame(request.producerEpoch));
    face.act("show");
    const snapshot = runtime.supportSnapshot();
    expect(snapshot.sourceKind).toBe("ios-simulator-device");
    expect(snapshot.summary.surfaceId).toBe(SURFACE_A);
    expectNoUdid([
      face.all(),
      runtime.summary,
      snapshot,
      face.frames.map((frame) => frame.metadata),
    ]);
  });

  it("R3: two bindings that land on one device share ONE inner — each face its own surface, every summary forwards", async () => {
    const { capture, sessions } = setup();
    const exact = open(sessions, SURFACE_A, PHONE);
    const a = attach(exact, "attachment_simdev_000a");
    await settle();
    // this Mac has no iOS 27: the binding falls back to the booted 26.5 device the first phone streams
    const b = attach(
      open(sessions, SURFACE_B, { deviceType: PRO, runtime: IOS_27_0 }),
      "attachment_simdev_000b",
    );
    await settle();
    expect(sessions.size).toBe(1);
    expect(b.latest()).toMatchObject({
      surfaceId: SURFACE_B,
      simulator: { condition: "streaming", runtime: IOS_26_5 },
    });

    a.attachment.setDemand(demand(1));
    b.attachment.setDemand(demand(1));
    await settle();
    expect(capture!.client.requests).toHaveLength(1);
    const request = capture!.client.requests[0]!;
    request.onFrame(captureFrame(request.producerEpoch));
    expect(a.frames.map((frame) => frame.metadata.surfaceId)).toEqual([SURFACE_A]);
    expect(b.frames.map((frame) => frame.metadata.surfaceId)).toEqual([SURFACE_B]);
    expect(b.latest()).toMatchObject({ surfaceId: SURFACE_B, state: "live" });
    expectMonotonic(a.all(), SURFACE_A);
    expectMonotonic(b.all(), SURFACE_B);

    // the first phone closing keeps the second's stream
    exact.dispose();
    expect(sessions.size).toBe(1);
    request.onFrame(captureFrame(request.producerEpoch, 2n));
    expect(b.frames).toHaveLength(2);
  });

  it("R3 holds while the bindings agree: a joined phone whose OWN binding comes to pick another device leaves for its own session at its next idle — never under a face", async () => {
    const { simctl, sessions } = setup();
    const a = attach(open(sessions, SURFACE_A, PHONE), "attachment_simdev_000a");
    await settle();
    // the 26.1 binding has no 17 Pro of its own runtime here: it falls back to the booted 26.5 one, and joins
    const second = open(sessions, SURFACE_B, { deviceType: PRO, runtime: IOS_26_1 });
    const b = attach(second, "attachment_simdev_000b");
    await settle();
    expect(sessions.size).toBe(1);
    expect(b.latest().simulator).toMatchObject({ condition: "streaming", runtime: IOS_26_5 });

    // the 26.5 device shuts down and a 17 Pro on the second binding's own runtime boots: the bindings part
    simctl.raw = listJson({
      [IOS_26_1]: [rawDevice(UDID_2, "Booted")],
      [IOS_26_5]: [rawDevice(UDID, "Shutdown")],
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    // under its face it stays (a fresh inner would move that face's summaries backwards)
    expect(sessions.size).toBe(1);
    expect(a.latest().simulator).toMatchObject({ condition: "off", runtime: IOS_26_5 });
    expect(b.latest().simulator).toMatchObject({ condition: "off", runtime: IOS_26_5 });

    // its face detached, it leaves; attached again, it is its own binding's device — the first phone's never moved
    b.attachment.dispose();
    expect(sessions.size).toBe(2);
    const again = attach(second, "attachment_simdev_000c");
    await settle();
    expect(again.latest().simulator).toMatchObject({ condition: "streaming", runtime: IOS_26_1 });
    expect(a.latest().simulator).toMatchObject({ condition: "off", runtime: IOS_26_5 });
    expectMonotonic(a.all(), SURFACE_A);
    expectMonotonic(b.all(), SURFACE_B);
    expectMonotonic(again.all(), SURFACE_B);
    expectNoUdid([a.all(), b.all(), again.all()]);
  });

  it("R3 picks by a binding a member HOLDS: the phone that opened a shared session leaving, the one left follows its OWN binding — a device the leaver's would pick moves nothing under its face", async () => {
    const { simctl, capture, sessions } = setup({
      raw: listJson({ [IOS_26_1]: [rawDevice(UDID, "Booted")] }),
    });
    // neither binding has a 17 Pro of its own runtime here: both fall back to the one booted 26.1 device, and share it
    const first = open(sessions, SURFACE_A, PHONE);
    const a = attach(first, "attachment_simdev_000a");
    await settle();
    const second = open(sessions, SURFACE_B, { deviceType: PRO, runtime: IOS_27_0 });
    const b = attach(second, "attachment_simdev_000b");
    await settle();
    expect(sessions.size).toBe(1);
    a.attachment.setDemand(demand(1));
    b.attachment.setDemand(demand(1));
    await settle();
    expect(capture!.client.requests).toHaveLength(1);
    const request = capture!.client.requests[0]!;
    request.onFrame(captureFrame(request.producerEpoch));
    expect(b.latest()).toMatchObject({
      state: "live",
      simulator: { condition: "streaming", runtime: IOS_26_1 },
    });

    // the first phone is deleted: its surface leaves, and the session lives on for the second
    first.dispose();
    await settle();
    expect(sessions.size).toBe(1);
    // a 17 Pro on the first phone's own runtime is made outside the app, shut down: the leaver's binding would pick it
    simctl.raw = listJson({
      [IOS_26_1]: [rawDevice(UDID, "Booted")],
      [IOS_26_5]: [rawDevice(UDID_2, "Shutdown")],
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    // the second phone's own binding still picks the booted 26.1 device: its face keeps streaming it, and offers no Boot
    expect(b.latest()).toMatchObject({
      state: "live",
      simulator: { condition: "streaming", runtime: IOS_26_1 },
    });
    expect(b.all().map((summary) => summary.simulator?.condition)).not.toContain("off");
    b.act("boot");
    await settle();
    expect(simctl.calls).not.toContain(`boot ${UDID_2}`);
    expect(simctl.calls).toEqual([]);
    expect(capture!.resolved).not.toContain(UDID_2);
    expect(capture!.client.requests).toHaveLength(1);
    request.onFrame(captureFrame(request.producerEpoch, 2n));
    expect(b.frames.map((frame) => frame.metadata.surfaceId)).toEqual([SURFACE_B, SURFACE_B]);

    // its face detached, it stays (the session's binding is its own); attached again, it is its own binding's device
    b.attachment.dispose();
    expect(sessions.size).toBe(1);
    const again = attach(second, "attachment_simdev_000c");
    await settle();
    expect(again.latest().simulator).toMatchObject({ condition: "streaming", runtime: IOS_26_1 });
    expect(simctl.calls).toEqual([]);
    expectMonotonic(a.all(), SURFACE_A);
    expectMonotonic(b.all(), SURFACE_B);
    expectMonotonic(again.all(), SURFACE_B);
    expectNoUdid([a.all(), b.all(), again.all()]);
  });
});
