import type { LiveSurfaceDemandV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveSurfaceRuntimeAttachContext } from "../src/main/live-surfaces/runtime";
import {
  type SckCaptureClient,
  type SckCaptureClientStartRequest,
  type SckCaptureFrame,
  type SckCaptureSession,
  SckLiveSurfaceRuntime,
} from "../src/main/live-surfaces/sck-producer";
import type { LiveSurfaceProducerTextureFrame } from "../src/main/live-surfaces/texture-forwarder";

const SURFACE_ID = "sck_surface_0123456789";

class FakeSession implements SckCaptureSession {
  readonly demands: Parameters<SckCaptureSession["setDemand"]>[0][] = [];
  readonly dispose = vi.fn(async () => undefined);

  async setDemand(demand: Parameters<SckCaptureSession["setDemand"]>[0]): Promise<void> {
    this.demands.push(demand);
  }
}

class FakeClient implements SckCaptureClient {
  readonly requests: SckCaptureClientStartRequest[] = [];
  readonly sessions: FakeSession[] = [];
  rejectNext = false;

  async startSession(request: SckCaptureClientStartRequest): Promise<SckCaptureSession> {
    this.requests.push(request);
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new Error("helper unavailable");
    }
    const session = new FakeSession();
    this.sessions.push(session);
    return session;
  }
}

function source() {
  return {
    kind: "sck-window" as const,
    sourceRef: "sck_enumeration_ref_0123456789",
    crop: { mode: "none" as const },
    captureCursor: false,
  };
}

function setup(options: Partial<ConstructorParameters<typeof SckLiveSurfaceRuntime>[0]> = {}) {
  const client = new FakeClient();
  const runtime = new SckLiveSurfaceRuntime({
    surfaceId: SURFACE_ID,
    source: source(),
    client,
    monotonicNowUs: () => 123_456n,
    ...options,
  });
  return { client, runtime };
}

type OfferBehavior = "accept" | "hold" | "drop" | "timeout";

function attach(
  runtime: SckLiveSurfaceRuntime,
  attachmentId = "attachment_sck_00000001",
  behavior: OfferBehavior = "accept",
) {
  const summaries: LiveSurfaceRuntimeSummaryV1[] = [];
  const frames: LiveSurfaceProducerTextureFrame[] = [];
  const context: LiveSurfaceRuntimeAttachContext = {
    attachmentId,
    rendererGeneration: 1,
    operations: ["view", "crop"],
    publishSummary: (summary) => summaries.push(summary),
    publishCpuFrame: () => false,
    offerTextureFrame: (frame) => {
      frames.push(frame);
      if (behavior === "hold") return { kind: "accepted", transfer: Promise.resolve() };
      frame.releaseSource(behavior === "accept" ? "imported" : "transfer-cap");
      if (behavior === "timeout") frame.allReferencesReleased("lease-timeout");
      else if (behavior === "accept") frame.allReferencesReleased("released");
      else frame.allReferencesReleased("transfer-cap");
      return behavior === "drop"
        ? { kind: "dropped", reason: "transfer-cap" }
        : { kind: "accepted", transfer: Promise.resolve() };
    },
  };
  return { attachment: runtime.attach(context), summaries, frames };
}

function demand(
  revision: number,
  mode: LiveSurfaceDemandV1["mode"],
  targetFps: LiveSurfaceDemandV1["targetFps"] = mode === "live" ? 30 : 0,
  targetRasterSize?: { width: number; height: number },
): LiveSurfaceDemandV1 {
  return {
    revision,
    mode,
    targetFps,
    ...(targetRasterSize === undefined ? {} : { targetRasterSize }),
    priority: mode === "live" ? 50 : 0,
    interactive: false,
  };
}

function captureFrame(epoch = 1, sequence = 1n, width = 640, height = 360) {
  const releaseLocal = vi.fn();
  const releaseLease = vi.fn();
  const frame: SckCaptureFrame = {
    producerEpoch: epoch,
    sequence,
    codedSize: { width, height },
    logicalSize: { width: width / 2, height: height / 2 },
    timestampUs: 42n,
    textureInfo: {
      codedSize: { width, height },
      visibleRect: { x: 0, y: 0, width, height },
      pixelFormat: "bgra",
      handle: { ioSurface: Buffer.alloc(8) },
    },
    releaseLocal,
    releaseLease,
  };
  return { frame, releaseLocal, releaseLease };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SckLiveSurfaceRuntime", () => {
  it("measures complete frame callbacks without letting diagnostics break delivery", async () => {
    const durations: bigint[] = [];
    const ticks = [100n, 101n, 103n];
    const result = setup({
      monotonicNowUs: () => ticks.shift() ?? 103n,
      onFrameCallbackDurationUs: (durationUs) => {
        durations.push(durationUs);
        throw new Error("diagnostic failed");
      },
    });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();

    const captured = captureFrame();
    expect(() => result.client.requests[0]?.onFrame(captured.frame)).not.toThrow();
    expect(durations).toEqual([3n]);
    expect(renderer.frames).toHaveLength(1);
    expect(captured.releaseLocal).toHaveBeenCalledOnce();
    expect(captured.releaseLease).toHaveBeenCalledWith("released");
    result.runtime.dispose();
  });

  it("starts on live demand, observes the first frame, pauses, and hibernates at the helper", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
    expect(result.runtime.summary).toMatchObject({ state: "starting", producerEpoch: 1 });
    expect(result.client.requests[0]).toMatchObject({
      producerEpoch: 1,
      source: source(),
      demand: { mode: "live", targetFps: 30, targetRasterSize: { width: 640, height: 360 } },
    });
    await flush();

    const first = captureFrame();
    result.client.requests[0]?.onFrame(first.frame);
    expect(result.runtime.summary).toMatchObject({
      state: "live",
      producerEpoch: 1,
      transport: "shared-texture",
      geometry: {
        codedSize: { width: 640, height: 360 },
        logicalSize: { width: 320, height: 180 },
      },
    });
    expect(renderer.frames[0]?.metadata).toMatchObject({
      sequence: "1",
      hostReceivedAtUs: "123456",
      producerTimestamp: { clockDomain: "sck-presentation", timestampUs: "42" },
    });
    expect(first.releaseLocal).toHaveBeenCalledOnce();
    expect(first.releaseLease).toHaveBeenCalledWith("released");

    renderer.attachment.setDemand(demand(2, "paused"));
    expect(result.runtime.summary.state).toBe("paused");
    await flush();
    expect(result.client.sessions[0]?.demands.at(-1)).toMatchObject({
      mode: "paused",
      targetFps: 0,
    });

    renderer.attachment.setDemand(demand(3, "hibernated"));
    expect(result.runtime.summary.state).toBe("hibernated");
    expect(result.client.sessions[0]?.dispose).toHaveBeenCalledOnce();
    result.runtime.dispose();
  });

  it("publishes source crop state and revisions geometry when its logical mapping changes", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const first = captureFrame();
    result.client.requests[0]?.onFrame({
      ...first.frame,
      logicalSize: { width: 402, height: 874 },
      orientation: 0,
      cropState: "applied",
    });
    expect(result.runtime.summary.geometry).toMatchObject({
      revision: 1,
      logicalSize: { width: 402, height: 874 },
      orientation: 0,
      cropState: "applied",
    });

    const second = captureFrame(1, 2n, 360, 640);
    result.client.requests[0]?.onFrame({
      ...second.frame,
      logicalSize: { width: 874, height: 402 },
      orientation: 90,
      cropState: "applied",
    });
    expect(result.runtime.summary.geometry).toMatchObject({
      revision: 2,
      logicalSize: { width: 874, height: 402 },
      orientation: 90,
      cropState: "applied",
    });
    result.runtime.dispose();
  });

  it("fans out one local IOSurface and releases each ownership tier exactly once", async () => {
    const result = setup();
    const firstRenderer = attach(result.runtime, "attachment_sck_00000001", "hold");
    const secondRenderer = attach(result.runtime, "attachment_sck_00000002", "hold");
    firstRenderer.attachment.setDemand(demand(1, "live"));
    secondRenderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const captured = captureFrame();
    result.client.requests[0]?.onFrame(captured.frame);
    expect(firstRenderer.frames).toHaveLength(1);
    expect(secondRenderer.frames).toHaveLength(1);
    expect(captured.releaseLocal).not.toHaveBeenCalled();
    expect(captured.releaseLease).not.toHaveBeenCalled();

    firstRenderer.frames[0]?.releaseSource("imported");
    firstRenderer.frames[0]?.allReferencesReleased("released");
    expect(captured.releaseLocal).not.toHaveBeenCalled();
    expect(captured.releaseLease).not.toHaveBeenCalled();
    secondRenderer.frames[0]?.releaseSource("imported");
    secondRenderer.frames[0]?.allReferencesReleased("released");
    expect(captured.releaseLocal).toHaveBeenCalledOnce();
    expect(captured.releaseLease).toHaveBeenCalledOnce();
    expect(captured.releaseLease).toHaveBeenCalledWith("released");
    expect(result.runtime.stats).toMatchObject({
      framesOffered: 2,
      framesAccepted: 2,
      localReferencesReleased: 1,
      helperLeasesReleased: 1,
    });
    expect(result.runtime.supportSnapshot()).toMatchObject({
      v: 1,
      sourceKind: "sck-window",
      metrics: {
        framesObserved: 1,
        framesOffered: 2,
        framesAccepted: 2,
        framesDropped: 0,
        localReferencesReleased: 1,
        downstreamReferencesReleased: 1,
        referencesQuarantined: 0,
      },
    });
    result.runtime.dispose();
  });

  it("quarantines a timed-out helper slot and ignores every later release", async () => {
    const result = setup();
    const timedOut = attach(result.runtime, "attachment_sck_timeout_01", "timeout");
    timedOut.attachment.setDemand(demand(1, "live"));
    await flush();
    const captured = captureFrame();
    result.client.requests[0]?.onFrame(captured.frame);
    expect(captured.releaseLocal).toHaveBeenCalledOnce();
    expect(captured.releaseLease).toHaveBeenCalledOnce();
    expect(captured.releaseLease).toHaveBeenCalledWith("quarantined");
    timedOut.frames[0]?.allReferencesReleased("released");
    expect(captured.releaseLease).toHaveBeenCalledOnce();
    expect(result.runtime.stats.helperLeasesQuarantined).toBe(1);
    result.runtime.dispose();
  });

  it("fails closed on a regressed helper sequence and drops the offending frame", async () => {
    const result = setup({ restartLimit: 0 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    result.client.requests[0]?.onFrame(captureFrame(1, 2n).frame);
    const regressed = captureFrame(1, 2n);
    result.client.requests[0]?.onFrame(regressed.frame);
    expect(regressed.releaseLocal).toHaveBeenCalledOnce();
    expect(regressed.releaseLease).toHaveBeenCalledWith("dropped");
    expect(result.runtime.summary).toMatchObject({
      state: "failed",
      error: { code: "protocol-violation", recovery: "permanent" },
    });
    expect(result.client.sessions[0]?.dispose).toHaveBeenCalledOnce();
    result.runtime.dispose();
  });

  it("restarts a crashed live helper session with a fresh producer epoch", async () => {
    vi.useFakeTimers();
    const result = setup({ restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    result.client.requests[0]?.onFrame(captureFrame().frame);
    result.client.requests[0]?.onFault({
      code: "producer-crashed",
      message: "helper exited",
      recovery: "automatic",
    });
    expect(result.runtime.summary).toMatchObject({ state: "reconnecting", producerEpoch: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(result.client.requests).toHaveLength(2);
    expect(result.client.requests[1]?.producerEpoch).toBe(2);
    result.client.requests[1]?.onFrame(captureFrame(2, 1n).frame);
    expect(result.runtime.summary).toMatchObject({ state: "live", producerEpoch: 2 });
    expect(result.runtime.stats.sessionRestarts).toBe(1);
    result.runtime.dispose();
  });

  it("bounds a helper that starts but never produces a usable frame", async () => {
    vi.useFakeTimers();
    const result = setup({ startupTimeoutMs: 250, restartLimit: 0 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(result.runtime.summary).toMatchObject({
      state: "failed",
      error: { code: "frame-stalled" },
    });
    expect(result.client.sessions[0]?.dispose).toHaveBeenCalledOnce();
    result.runtime.dispose();
  });

  it("drops late frames from a destroyed session without resurrecting its epoch", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    renderer.attachment.dispose();
    expect(result.runtime.summary.state).toBe("starting");
    // Starting cannot jump directly to hibernated. The pending session remains
    // bounded until its first callback, then demand reconciliation tears it down.
    const late = captureFrame();
    result.client.requests[0]?.onFrame(late.frame);
    expect(late.releaseLocal).toHaveBeenCalledOnce();
    expect(late.releaseLease).toHaveBeenCalledWith("dropped");
    expect(result.runtime.summary.state).toBe("hibernated");
    result.runtime.dispose();
  });
});
