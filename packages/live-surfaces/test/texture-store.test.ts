import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { LatestLiveSurfaceFrameQueue } from "../src/frame-queue";
import {
  type LiveSurfaceClosableFrame,
  type LiveSurfaceGpuDevice,
  type LiveSurfaceGpuTexture,
  WebGpuLiveSurfaceTextureStore,
} from "../src/renderer";

interface FakeFrame extends LiveSurfaceClosableFrame {
  readonly id: string;
  close: ReturnType<typeof vi.fn>;
}

class FakeTexture implements LiveSurfaceGpuTexture {
  readonly view = { texture: this };
  readonly destroy = vi.fn();

  createView(): unknown {
    return this.view;
  }
}

function metadata(sequence: string, width = 64, height = 48): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    producerEpoch: 1,
    sequence,
    geometry: {
      revision: Number(sequence),
      codedSize: { width: width + 4, height: height + 6 },
      visibleRect: { x: 2, y: 3, width, height },
      logicalSize: { width, height },
      orientation: 0,
    },
    hostReceivedAtUs: sequence,
    pixelFormat: "bgra",
    colorSpace: "srgb",
    alphaMode: "opaque",
    transport: "shared-texture",
  };
}

function makeDevice() {
  const textures: FakeTexture[] = [];
  const copyExternalImageToTexture = vi.fn();
  let lose!: () => void;
  const lost = new Promise<void>((resolve) => {
    lose = resolve;
  });
  const device: LiveSurfaceGpuDevice<FakeFrame> = {
    lost,
    queue: { copyExternalImageToTexture },
    createTexture: vi.fn(() => {
      const texture = new FakeTexture();
      textures.push(texture);
      return texture;
    }),
  };
  return { device, textures, copyExternalImageToTexture, lose };
}

function lease(frame: FakeFrame, frameMetadata: LiveSurfaceFrameMetadataV1) {
  const queue = new LatestLiveSurfaceFrameQueue<FakeFrame>(1, ({ value }) => value.close());
  queue.offer({ value: frame, metadata: frameMetadata });
  const taken = queue.take();
  if (taken === null) throw new Error("fixture frame was not taken");
  return taken;
}

function frame(id: string): FakeFrame {
  return { id, close: vi.fn() };
}

describe("WebGpuLiveSurfaceTextureStore", () => {
  it("copies into one stable texture and closes each source immediately", () => {
    const gpu = makeDevice();
    const store = new WebGpuLiveSurfaceTextureStore<FakeFrame>();
    expect(store.replaceDevice(gpu.device)).toBe(1);
    const first = frame("first");
    const second = frame("second");
    const firstResult = store.present(lease(first, metadata("1")));
    const secondResult = store.present(lease(second, metadata("2")));

    expect(firstResult.kind).toBe("presented");
    expect(secondResult.kind).toBe("presented");
    expect(gpu.textures).toHaveLength(1);
    expect(gpu.copyExternalImageToTexture).toHaveBeenNthCalledWith(
      1,
      { source: first, origin: { x: 2, y: 3 } },
      { texture: gpu.textures[0] },
      { width: 64, height: 48 },
    );
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(store.snapshot).toMatchObject({ contentRevision: 2, width: 64, height: 48 });
  });

  it("commits a resized replacement only after the copy is acquired", () => {
    const gpu = makeDevice();
    const store = new WebGpuLiveSurfaceTextureStore<FakeFrame>();
    store.replaceDevice(gpu.device);
    store.present(lease(frame("first"), metadata("1")));
    const oldTexture = gpu.textures[0];
    const resized = frame("resized");
    const result = store.present(lease(resized, metadata("2", 80, 60)));

    expect(result.kind).toBe("presented");
    expect(gpu.textures).toHaveLength(2);
    expect(oldTexture?.destroy).toHaveBeenCalledTimes(1);
    expect(store.snapshot).toMatchObject({ width: 80, height: 60, contentRevision: 2 });
    expect(resized.close).toHaveBeenCalledTimes(1);
  });

  it("destroys a failed candidate but preserves the last complete texture", () => {
    const gpu = makeDevice();
    const store = new WebGpuLiveSurfaceTextureStore<FakeFrame>();
    store.replaceDevice(gpu.device);
    store.present(lease(frame("first"), metadata("1")));
    const oldSnapshot = store.snapshot;
    gpu.copyExternalImageToTexture.mockImplementationOnce(() => {
      throw new Error("copy failed");
    });
    const failed = frame("failed");
    const result = store.present(lease(failed, metadata("2", 80, 60)));

    expect(result).toEqual({ kind: "dropped", reason: "copy-failed" });
    expect(gpu.textures[1]?.destroy).toHaveBeenCalledTimes(1);
    expect(store.snapshot).toMatchObject({
      contentRevision: oldSnapshot?.contentRevision,
      texture: oldSnapshot?.texture,
      metadata: oldSnapshot?.metadata,
    });
    expect(failed.close).toHaveBeenCalledTimes(1);
  });

  it("drops during recovery and accepts the next frame on a new device generation", async () => {
    const firstGpu = makeDevice();
    const secondGpu = makeDevice();
    const store = new WebGpuLiveSurfaceTextureStore<FakeFrame>();
    store.replaceDevice(firstGpu.device);
    store.present(lease(frame("first"), metadata("1")));
    firstGpu.lose();
    await Promise.resolve();
    const duringLoss = frame("lost");
    expect(store.present(lease(duringLoss, metadata("2")))).toEqual({
      kind: "dropped",
      reason: "device-unavailable",
    });
    expect(duringLoss.close).toHaveBeenCalledTimes(1);
    expect(firstGpu.textures[0]?.destroy).toHaveBeenCalledTimes(1);

    expect(store.replaceDevice(secondGpu.device)).toBe(2);
    const recovered = frame("recovered");
    const result = store.present(lease(recovered, metadata("3")));
    expect(result.kind).toBe("presented");
    expect(store.snapshot).toMatchObject({ deviceGeneration: 2, contentRevision: 2 });
    expect(recovered.close).toHaveBeenCalledTimes(1);
  });
});
