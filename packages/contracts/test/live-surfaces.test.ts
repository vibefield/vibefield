import { describe, expect, it } from "vitest";
import {
  LIVE_SURFACE_MAX_PIXELS,
  LiveSurfaceDemandV1,
  LiveSurfaceFrameEnvelopeV1,
  LiveSurfaceFrameMetadataV1,
  LiveSurfaceGeometryV1,
  LiveSurfaceHostControlMessageV1,
  LiveSurfacePresentationCapabilitiesV1,
  LiveSurfaceRendererControlMessageV1,
  LiveSurfaceSequenceV1,
  LiveSurfaceSourceSpecV1,
} from "../src/live-surfaces";

const geometry = {
  revision: 3,
  codedSize: { width: 848, height: 1736 },
  visibleRect: { x: 0, y: 0, width: 848, height: 1736 },
  logicalSize: { width: 424, height: 868 },
  orientation: 0,
};

describe("LSF-1 Live Surfaces contracts", () => {
  it("keeps producer, geometry, and sequence discontinuities distinct", () => {
    expect(
      LiveSurfaceFrameMetadataV1.parse({
        v: 1,
        surfaceId: "surface_0123456789abcdef",
        producerEpoch: 2,
        sequence: "18446744073709551615",
        geometry,
        hostReceivedAtUs: "123456",
        pixelFormat: "bgra",
        colorSpace: "srgb",
        alphaMode: "opaque",
        transport: "shared-texture",
        futureField: "tolerated",
      }),
    ).toMatchObject({
      producerEpoch: 2,
      sequence: "18446744073709551615",
      geometry: { revision: 3 },
      futureField: "tolerated",
    });
    expect(LiveSurfaceSequenceV1.safeParse("18446744073709551616").success).toBe(false);
  });

  it("rejects visible rectangles outside the coded frame and oversized allocations", () => {
    expect(
      LiveSurfaceGeometryV1.safeParse({
        ...geometry,
        visibleRect: { x: 100, y: 0, width: 800, height: 1736 },
      }).success,
    ).toBe(false);
    expect(
      LiveSurfaceGeometryV1.safeParse({
        ...geometry,
        codedSize: { width: 16_384, height: 8_192 },
        visibleRect: { x: 0, y: 0, width: 16_384, height: 8_192 },
      }).success,
    ).toBe(false);
    expect(LIVE_SURFACE_MAX_PIXELS).toBe(67_108_864);
  });

  it("enforces coherent revisioned demand", () => {
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 1,
        mode: "live",
        targetFps: 30,
        targetRasterSize: { width: 1280, height: 800 },
        priority: 50,
        interactive: true,
      }).success,
    ).toBe(true);
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 2,
        mode: "live",
        targetFps: 0,
        priority: 50,
        interactive: false,
      }).success,
    ).toBe(false);
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 3,
        mode: "paused",
        targetFps: 5,
        priority: 0,
        interactive: false,
      }).success,
    ).toBe(false);
  });

  it("keeps semantic automation out of the presentation capability contract", () => {
    expect(
      LiveSurfacePresentationCapabilitiesV1.parse({
        pointer: true,
        wheel: true,
        keyboard: true,
        textInput: true,
        touch: false,
        rotateDevice: false,
        resizeLogicalViewport: true,
        resizeBackingRaster: true,
        crop: false,
      }),
    ).toEqual({
      pointer: true,
      wheel: true,
      keyboard: true,
      textInput: true,
      touch: false,
      rotateDevice: false,
      resizeLogicalViewport: true,
      resizeBackingRaster: true,
      crop: false,
    });
  });

  it("models Simulator as an SCK-resolved source without an encoded pixel endpoint", () => {
    expect(
      LiveSurfaceSourceSpecV1.parse({
        kind: "ios-simulator",
        udid: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
      }),
    ).toMatchObject({ kind: "ios-simulator", crop: { mode: "auto" } });
    expect(
      LiveSurfaceSourceSpecV1.safeParse({
        kind: "sck-window",
        sourceRef: "enumeration-ref-01",
      }).success,
    ).toBe(true);
  });

  it("keeps attach/demand control metadata separate from transferable frames", () => {
    const ticket = { v: 1, token: "abcdefghijklmnopqrstuvwxyz_0123456789-ABCDE" };
    expect(
      LiveSurfaceRendererControlMessageV1.parse({
        v: 1,
        type: "attach",
        requestId: "request_0001",
        ticket,
      }),
    ).toMatchObject({ type: "attach", ticket });
    expect(
      LiveSurfaceHostControlMessageV1.parse({
        v: 1,
        type: "ready",
        bootstrap: { v: 1, rendererGeneration: 4 },
      }),
    ).toMatchObject({ type: "ready", bootstrap: { rendererGeneration: 4 } });

    const metadata = LiveSurfaceFrameMetadataV1.parse({
      v: 1,
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 2,
      sequence: "7",
      geometry,
      hostReceivedAtUs: "123456",
      pixelFormat: "bgra",
      colorSpace: "srgb",
      alphaMode: "opaque",
      transport: "shared-texture",
    });
    const envelope = LiveSurfaceFrameEnvelopeV1.parse({
      v: 1,
      attachmentId: "attachment_0123456789abcdef",
      metadata,
    });
    expect(envelope.metadata.sequence).toBe("7");
    expect("frame" in envelope).toBe(false);
  });
});
