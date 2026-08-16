import type { LiveSurfaceFrameMetadataV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type LiveSurfaceClosableFrame,
  type LiveSurfaceMessagePort,
  LiveSurfaceRendererTransport,
} from "../src/renderer";

class MemoryPort implements LiveSurfaceMessagePort {
  onmessage: LiveSurfaceMessagePort["onmessage"] = null;
  onmessageerror: (() => void) | null = null;
  peer: MemoryPort | null = null;
  readonly sent: unknown[] = [];
  private readonly queued: unknown[] = [];
  private started = false;
  private closed = false;

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("memory port is closed");
    this.sent.push(message);
    this.peer?.deliver(message);
  }

  start(): void {
    if (this.closed) return;
    this.started = true;
    for (const message of this.queued.splice(0)) this.onmessage?.({ data: message });
  }

  close(): void {
    this.closed = true;
    this.queued.length = 0;
  }

  private deliver(message: unknown): void {
    if (this.closed) return;
    if (!this.started) this.queued.push(message);
    else this.onmessage?.({ data: message });
  }
}

function channel(): [MemoryPort, MemoryPort] {
  const left = new MemoryPort();
  const right = new MemoryPort();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

function summary(
  producerEpoch = 1,
  state: LiveSurfaceRuntimeSummaryV1["state"] = "live",
): LiveSurfaceRuntimeSummaryV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    state,
    producerEpoch,
    stateRevision: producerEpoch,
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

function metadata(sequence: string, producerEpoch = 1): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    producerEpoch,
    sequence,
    geometry: {
      revision: 1,
      codedSize: { width: 640, height: 480 },
      visibleRect: { x: 0, y: 0, width: 640, height: 480 },
      logicalSize: { width: 640, height: 480 },
      orientation: 0,
    },
    hostReceivedAtUs: sequence,
    pixelFormat: "bgra",
    colorSpace: "srgb",
    alphaMode: "opaque",
    transport: "shared-texture",
  };
}

function fakeFrame(): LiveSurfaceClosableFrame & { close: ReturnType<typeof vi.fn> } {
  return { close: vi.fn() };
}

async function attachedTransport() {
  const [rendererControl, hostControl] = channel();
  const [rendererFrames, preloadFrames] = channel();
  hostControl.start();
  preloadFrames.start();
  const transport = new LiveSurfaceRendererTransport(
    { v: 1, rendererGeneration: 3 },
    rendererControl,
    rendererFrames,
  );
  hostControl.postMessage({
    v: 1,
    type: "ready",
    bootstrap: { v: 1, rendererGeneration: 3 },
  });
  await transport.ready;
  hostControl.onmessage = (event) => {
    const request = event.data as { type?: string; requestId?: string };
    if (request.type !== "attach" || request.requestId === undefined) return;
    hostControl.postMessage({
      v: 1,
      type: "attached",
      requestId: request.requestId,
      attachment: {
        v: 1,
        attachmentId: "attachment_0123456789abcdef",
        summary: summary(),
      },
    });
  };
  const attachment = await transport.attach({
    v: 1,
    token: "abcdefghijklmnopqrstuvwxyz_0123456789-ABCDE",
  });
  return { transport, attachment, hostControl, preloadFrames };
}

describe("LiveSurfaceRendererTransport", () => {
  it("requires a matching generation handshake before redeeming a ticket", async () => {
    const [rendererControl, hostControl] = channel();
    const [rendererFrames] = channel();
    const transport = new LiveSurfaceRendererTransport(
      { v: 1, rendererGeneration: 7 },
      rendererControl,
      rendererFrames,
    );
    hostControl.start();
    hostControl.postMessage({
      v: 1,
      type: "ready",
      bootstrap: { v: 1, rendererGeneration: 8 },
    });
    await expect(transport.ready).rejects.toThrow(/generation handshake mismatch/);
    expect(transport.closed).toBe(true);
    expect(transport.protocolFaults).toBe(1);
  });

  it("keeps one pending/one in-flight and closes every superseded or consumed frame", async () => {
    const { attachment, preloadFrames } = await attachedTransport();
    const first = fakeFrame();
    const second = fakeFrame();
    preloadFrames.postMessage({
      type: "frame",
      envelope: {
        v: 1,
        attachmentId: attachment.attachmentId,
        metadata: metadata("1"),
      },
      frame: first,
    });
    preloadFrames.postMessage({
      type: "frame",
      envelope: {
        v: 1,
        attachmentId: attachment.attachmentId,
        metadata: metadata("2"),
      },
      frame: second,
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    expect(attachment.frameStats).toMatchObject({ pending: 1, inFlight: 0 });

    const lease = attachment.takeFrame();
    expect(lease?.frame.value).toBe(second);
    expect(attachment.takeFrame()).toBeNull();
    expect(attachment.frameStats).toMatchObject({ pending: 0, inFlight: 1 });
    lease?.release();
    lease?.release();
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(attachment.frameStats).toMatchObject({ pending: 0, inFlight: 0 });
  });

  it("drains an old epoch and makes a later lease release a no-op", async () => {
    const { attachment, hostControl, preloadFrames } = await attachedTransport();
    const frame = fakeFrame();
    preloadFrames.postMessage({
      type: "frame",
      envelope: {
        v: 1,
        attachmentId: attachment.attachmentId,
        metadata: metadata("1"),
      },
      frame,
    });
    const lease = attachment.takeFrame();
    hostControl.postMessage({
      v: 1,
      type: "summary",
      attachmentId: attachment.attachmentId,
      summary: summary(2, "reconnecting"),
    });
    expect(frame.close).toHaveBeenCalledTimes(1);
    lease?.release();
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(attachment.summary.producerEpoch).toBe(2);
  });

  it("closes malformed, unknown, and cross-surface frames without queueing them", async () => {
    const { transport, attachment, preloadFrames } = await attachedTransport();
    const malformed = fakeFrame();
    preloadFrames.postMessage({ type: "frame", envelope: { bad: true }, frame: malformed });
    const unknown = fakeFrame();
    preloadFrames.postMessage({
      type: "frame",
      envelope: {
        v: 1,
        attachmentId: "attachment_9999999999999999",
        metadata: metadata("3"),
      },
      frame: unknown,
    });
    const crossSurface = fakeFrame();
    preloadFrames.postMessage({
      type: "frame",
      envelope: {
        v: 1,
        attachmentId: attachment.attachmentId,
        metadata: { ...metadata("4"), surfaceId: "surface_9999999999999999" },
      },
      frame: crossSurface,
    });
    expect(malformed.close).toHaveBeenCalledTimes(1);
    expect(unknown.close).toHaveBeenCalledTimes(1);
    expect(crossSurface.close).toHaveBeenCalledTimes(1);
    expect(attachment.takeFrame()).toBeNull();
    expect(transport.protocolFaults).toBe(1);
  });

  it("detaches locally and emits no semantic-control surface", async () => {
    const { attachment, hostControl } = await attachedTransport();
    attachment.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 30,
      priority: 50,
      interactive: true,
    });
    attachment.dispose();
    attachment.dispose();
    expect(attachment.closed).toBe(true);
    expect(hostControl.sent).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "ready" })]),
    );
    const rendererMessages = (hostControl.peer?.sent ?? []) as Array<{ type?: string }>;
    expect(rendererMessages.filter((message) => message.type === "demand")).toHaveLength(1);
    expect(rendererMessages.filter((message) => message.type === "detach")).toHaveLength(1);
    expect("navigate" in attachment).toBe(false);
  });
});
