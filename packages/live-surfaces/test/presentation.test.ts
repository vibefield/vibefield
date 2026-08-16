import type { LiveSurfaceFrameMetadataV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type LiveSurfaceClosableFrame,
  type LiveSurfaceGpuDevice,
  type LiveSurfaceGpuTexture,
  LiveSurfacePresentation,
  LiveSurfaceRendererAttachment,
} from "../src/renderer";

interface FakeFrame extends LiveSurfaceClosableFrame {
  readonly close: ReturnType<typeof vi.fn>;
}

class FakeTexture implements LiveSurfaceGpuTexture {
  readonly view = { kind: "view" };
  readonly destroy = vi.fn();

  createView(): unknown {
    return this.view;
  }
}

function summary(): LiveSurfaceRuntimeSummaryV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    state: "live",
    producerEpoch: 1,
    stateRevision: 1,
    capabilities: {
      pointer: true,
      wheel: true,
      keyboard: true,
      textInput: true,
      touch: false,
      rotateDevice: false,
      resizeLogicalViewport: true,
      resizeBackingRaster: true,
      crop: false,
    },
    transport: "shared-texture",
  };
}

function metadata(sequence = "1"): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    producerEpoch: 1,
    sequence,
    geometry: {
      revision: 2,
      codedSize: { width: 68, height: 54 },
      visibleRect: { x: 2, y: 3, width: 64, height: 48 },
      logicalSize: { width: 64, height: 48 },
      orientation: 0,
    },
    hostReceivedAtUs: "10",
    pixelFormat: "bgra",
    colorSpace: "srgb",
    alphaMode: "opaque",
    transport: "shared-texture",
  };
}

function setup() {
  const controls: unknown[] = [];
  const attachment = new LiveSurfaceRendererAttachment<FakeFrame>(
    "attachment_0123456789abcdef",
    summary(),
    (message) => controls.push(message),
    () => undefined,
  );
  const texture = new FakeTexture();
  const copyExternalImageToTexture = vi.fn();
  const device: LiveSurfaceGpuDevice<FakeFrame> = {
    queue: { copyExternalImageToTexture },
    createTexture: vi.fn(() => texture),
  };
  const presentation = new LiveSurfacePresentation(attachment);
  return { attachment, controls, texture, copyExternalImageToTexture, device, presentation };
}

describe("LiveSurfacePresentation", () => {
  it("is the narrow demand/frame/texture handoff and emits a handle-free support snapshot", () => {
    const result = setup();
    expect(result.presentation.replaceDevice(result.device)).toBe(1);
    result.presentation.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 30,
      priority: 50,
      interactive: true,
    });
    expect(result.controls).toContainEqual({
      v: 1,
      type: "demand",
      attachmentId: "attachment_0123456789abcdef",
      demand: {
        revision: 1,
        mode: "live",
        targetFps: 30,
        priority: 50,
        interactive: true,
      },
    });

    const source: FakeFrame = { close: vi.fn() };
    const frameMetadata = metadata();
    result.attachment.acceptFrame(source, {
      v: 1,
      attachmentId: result.attachment.attachmentId,
      metadata: frameMetadata,
    });
    const tick = result.presentation.presentLatest();
    expect(tick.kind).toBe("presented");
    expect(source.close).toHaveBeenCalledOnce();
    expect(result.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source, origin: { x: 2, y: 3 } },
      { texture: result.texture },
      { width: 64, height: 48 },
    );

    const support = result.presentation.supportSnapshot();
    expect(support).toMatchObject({
      v: 1,
      surfaceId: "surface_0123456789abcdef",
      attachmentId: "attachment_0123456789abcdef",
      closed: false,
      frameQueue: { pending: 0, inFlight: 0 },
      texture: {
        deviceGeneration: 1,
        contentRevision: 1,
        width: 64,
        height: 48,
        producerEpoch: 1,
        sequence: "1",
        geometryRevision: 2,
        transport: "shared-texture",
        pixelFormat: "bgra",
      },
      stats: { ticks: 1, idleTicks: 0, presented: 1 },
    });
    expect(JSON.stringify(support)).not.toContain('kind":"view');
    expect(result.presentation.presentLatest()).toEqual({ kind: "idle" });
    expect(result.presentation.stats).toMatchObject({ ticks: 2, idleTicks: 1 });
  });

  it("accounts device-unavailable drops and closes presentation ownership idempotently", () => {
    const result = setup();
    const source: FakeFrame = { close: vi.fn() };
    result.attachment.acceptFrame(source, {
      v: 1,
      attachmentId: result.attachment.attachmentId,
      metadata: metadata(),
    });
    expect(result.presentation.presentLatest()).toEqual({
      kind: "dropped",
      reason: "device-unavailable",
    });
    expect(source.close).toHaveBeenCalledOnce();
    expect(result.presentation.stats.droppedDeviceUnavailable).toBe(1);

    result.presentation.replaceDevice(result.device);
    result.presentation.dispose();
    result.presentation.dispose();
    expect(result.texture.destroy).not.toHaveBeenCalled();
    expect(result.controls).toContainEqual({
      v: 1,
      type: "detach",
      attachmentId: "attachment_0123456789abcdef",
    });
    expect(result.presentation.closed).toBe(true);
    expect(() =>
      result.presentation.setDemand({
        revision: 2,
        mode: "hibernated",
        targetFps: 0,
        priority: 0,
        interactive: false,
      }),
    ).toThrow(/closed live surface presentation/);
  });
});
