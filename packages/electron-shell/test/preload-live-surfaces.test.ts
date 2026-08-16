import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type PreloadLiveSurfaceFrame,
  PreloadLiveSurfaceFrameMux,
  type PreloadLiveSurfacePort,
} from "../src/preload/live-surfaces";

class FakePort implements PreloadLiveSurfacePort {
  onmessage: PreloadLiveSurfacePort["onmessage"] = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: Array<{ message: unknown; transfer: readonly object[] }> = [];
  readonly start = vi.fn();
  readonly close = vi.fn();
  throwOnPost = false;

  postMessage(message: unknown, transfer: readonly object[] = []): void {
    if (this.throwOnPost) throw new Error("port disconnected");
    this.messages.push({ message, transfer });
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: message });
  }
}

function metadata(transport: "shared-texture" | "cpu-bgra"): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    producerEpoch: 1,
    sequence: "1",
    geometry: {
      revision: 1,
      codedSize: { width: 2, height: 1 },
      visibleRect: { x: 0, y: 0, width: 2, height: 1 },
      logicalSize: { width: 2, height: 1 },
      orientation: 0,
    },
    hostReceivedAtUs: "123",
    pixelFormat: "rgba",
    colorSpace: "srgb",
    alphaMode: "opaque",
    transport,
    ...(transport === "cpu-bgra" ? { degradedMode: "cpu-bitmap" as const } : {}),
  };
}

function envelope(transport: "shared-texture" | "cpu-bgra") {
  return {
    v: 1,
    attachmentId: "attachment_0123456789abcdef",
    metadata: metadata(transport),
  };
}

function frame(): PreloadLiveSurfaceFrame & { close: ReturnType<typeof vi.fn> } {
  return { close: vi.fn() };
}

function setup() {
  const forwarded: Array<{
    bootstrap: unknown;
    control: PreloadLiveSurfacePort;
    frames: PreloadLiveSurfacePort;
  }> = [];
  const rejected: string[] = [];
  const madeFrames: PreloadLiveSurfaceFrame[] = [];
  const mux = new PreloadLiveSurfaceFrameMux({
    forwardPorts: (bootstrap, control, frames) => forwarded.push({ bootstrap, control, frames }),
    createCpuFrame: () => {
      const created = frame();
      madeFrames.push(created);
      return created;
    },
    onRejected: (reason) => rejected.push(reason),
  });
  const ports = [new FakePort(), new FakePort(), new FakePort(), new FakePort()] as const;
  return { mux, ports, forwarded, rejected, madeFrames };
}

describe("PreloadLiveSurfaceFrameMux", () => {
  it("retains only the frame sender/fallback ingress and forwards capabilities once", () => {
    const result = setup();
    expect(result.mux.bind({ v: 1, rendererGeneration: 4 }, result.ports)).toBe(true);
    expect(result.forwarded).toEqual([
      {
        bootstrap: { v: 1, rendererGeneration: 4 },
        control: result.ports[0],
        frames: result.ports[2],
      },
    ]);
    expect(result.ports[1].start).toHaveBeenCalledTimes(1);
    expect(result.ports[3].start).toHaveBeenCalledTimes(1);
    expect(result.mux.stats).toMatchObject({ generation: 4, dropped: 0 });

    const next = [new FakePort(), new FakePort(), new FakePort(), new FakePort()] as const;
    result.mux.bind({ v: 1, rendererGeneration: 5 }, next);
    expect(result.ports[1].close).toHaveBeenCalledTimes(1);
    expect(result.ports[3].close).toHaveBeenCalledTimes(1);
    expect(result.ports[0].close).not.toHaveBeenCalled();
    expect(result.ports[2].close).not.toHaveBeenCalled();
  });

  it("turns one imported texture into one transferred frame and releases its wrapper", async () => {
    const result = setup();
    result.mux.bind({ v: 1, rendererGeneration: 4 }, result.ports);
    const videoFrame = frame();
    const imported = { getVideoFrame: vi.fn(() => videoFrame), release: vi.fn() };
    await result.mux.acceptSharedTexture(
      { importedSharedTexture: imported },
      envelope("shared-texture"),
    );
    expect(imported.getVideoFrame).toHaveBeenCalledTimes(1);
    expect(imported.release).toHaveBeenCalledTimes(1);
    expect(result.ports[1].messages).toEqual([
      {
        message: { type: "frame", envelope: envelope("shared-texture"), frame: videoFrame },
        transfer: [videoFrame],
      },
    ]);
    expect(videoFrame.close).not.toHaveBeenCalled();
    expect(result.mux.stats.sharedAccepted).toBe(1);
  });

  it("closes a frame when transfer fails and releases arrivals before bind", async () => {
    const result = setup();
    const beforeFrame = frame();
    const before = { getVideoFrame: vi.fn(() => beforeFrame), release: vi.fn() };
    await result.mux.acceptSharedTexture(
      { importedSharedTexture: before },
      envelope("shared-texture"),
    );
    expect(before.getVideoFrame).not.toHaveBeenCalled();
    expect(before.release).toHaveBeenCalledTimes(1);

    result.mux.bind({ v: 1, rendererGeneration: 4 }, result.ports);
    result.ports[1].throwOnPost = true;
    const failedFrame = frame();
    const failed = { getVideoFrame: vi.fn(() => failedFrame), release: vi.fn() };
    await result.mux.acceptSharedTexture(
      { importedSharedTexture: failed },
      envelope("shared-texture"),
    );
    expect(failed.release).toHaveBeenCalledTimes(1);
    expect(failedFrame.close).toHaveBeenCalledTimes(1);
    expect(result.mux.stats).toMatchObject({ sharedAccepted: 0, dropped: 2 });
  });

  it("normalizes bounded CPU fallback pixels through the same private frame port", () => {
    const result = setup();
    result.mux.bind({ v: 1, rendererGeneration: 4 }, result.ports);
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    result.ports[3].receive({ type: "cpu-frame", envelope: envelope("cpu-bgra"), pixels });
    const made = result.madeFrames[0];
    expect(made).toBeDefined();
    expect(result.ports[1].messages[0]).toEqual({
      message: { type: "frame", envelope: envelope("cpu-bgra"), frame: made },
      transfer: [made],
    });
    expect(result.mux.stats.cpuAccepted).toBe(1);
  });

  it("closes every supplied port on an invalid handoff", () => {
    const result = setup();
    expect(result.mux.bind({ v: 2, rendererGeneration: 4 }, result.ports)).toBe(false);
    for (const port of result.ports) expect(port.close).toHaveBeenCalledTimes(1);
    expect(result.rejected).toEqual(["invalid generation port handoff"]);
  });
});
