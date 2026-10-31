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
  stateRevision = producerEpoch,
): LiveSurfaceRuntimeSummaryV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    state,
    producerEpoch,
    stateRevision,
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

function cpuMetadata(sequence: string, producerEpoch = 1): LiveSurfaceFrameMetadataV1 {
  return {
    ...metadata(sequence, producerEpoch),
    transport: "cpu-bgra",
    pixelFormat: "bgra",
    degradedMode: "cpu-bitmap",
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

  it("tells a subscriber when a frame LANDS — once per frame the queue keeps, never for one it drops (PT-2)", async () => {
    const { attachment, hostControl, preloadFrames } = await attachedTransport();
    const heard = vi.fn();
    attachment.onFrame(heard);
    const post = (sequence: string, surfaceId?: string) => {
      const frame = fakeFrame();
      preloadFrames.postMessage({
        type: "frame",
        envelope: {
          v: 1,
          attachmentId: attachment.attachmentId,
          metadata: { ...metadata(sequence), ...(surfaceId === undefined ? {} : { surfaceId }) },
        },
        frame,
      });
      return frame;
    };
    post("1");
    expect(heard).toHaveBeenCalledTimes(1);
    // superseding the pending frame is a frame landing too (the newest is what a consumer takes)
    post("2");
    expect(heard).toHaveBeenCalledTimes(2);
    // a stale sequence: dropped and closed — and nobody told
    const stale = post("2");
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(2);
    // another surface's frame on this attachment: closed, untold
    const stranger = post("3", "surface_ffffffffffffffff");
    expect(stranger.close).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(2);
    // not demanded (paused): dropped, untold
    hostControl.postMessage({
      v: 1,
      type: "summary",
      attachmentId: attachment.attachmentId,
      summary: summary(1, "paused", 2),
    });
    post("4");
    expect(heard).toHaveBeenCalledTimes(2);
    // the listener was told, never handed the frame: the consumer takes it
    expect(heard.mock.calls.every((args) => args.length === 0)).toBe(true);
  });

  it("isolates a throwing frame observer, stops telling one that unsubscribed, and tells none once closed (PT-2)", async () => {
    const { attachment, preloadFrames } = await attachedTransport();
    const post = (sequence: string) =>
      preloadFrames.postMessage({
        type: "frame",
        envelope: { v: 1, attachmentId: attachment.attachmentId, metadata: metadata(sequence) },
        frame: fakeFrame(),
      });
    const after = vi.fn();
    attachment.onFrame(() => {
      throw new Error("a faulty observer");
    });
    const off = attachment.onFrame(after);
    post("1");
    expect(after).toHaveBeenCalledTimes(1);
    expect(attachment.frameStats).toMatchObject({ pending: 1 });
    off();
    post("2");
    expect(after).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    attachment.dispose();
    attachment.onFrame(late)();
    post("3");
    expect(late).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
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

  it("PT-5a: keeps the favicon's BYTES it was sent — a later summary naming the key alone is WHOLE to its holders; bytes arrive once a key; a key whose bytes never came is no favicon", async () => {
    const { attachment, hostControl } = await attachedTransport();
    const browser = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const A = { key: "aaaaaaaaaaaaaaaa", mediaType: "image/png" };
    const B = { key: "bbbbbbbbbbbbbbbb", mediaType: "image/png" };
    const heard: unknown[] = [];
    attachment.onSummary((next) => heard.push(next.browser?.favicon ?? null));
    const say = (revision: number, favicon?: object, cursor = "default"): void =>
      hostControl.postMessage({
        v: 1,
        type: "summary",
        attachmentId: attachment.attachmentId,
        summary: {
          ...summary(1, "live", revision),
          browser: { ...browser, cursor, ...(favicon === undefined ? {} : { favicon }) },
        },
      });
    expect(attachment.faviconArrivals).toBe(0);
    say(2, { ...A, data: "AAAA" });
    expect(attachment.summary.browser?.favicon).toEqual({ ...A, data: "AAAA" });
    expect(attachment.faviconArrivals).toBe(1);
    // the cursor moves: the key alone crosses — the summary a holder reads still has the bytes
    say(3, A, "pointer");
    say(4, A, "text");
    expect(attachment.summary.browser).toMatchObject({
      cursor: "text",
      favicon: { ...A, data: "AAAA" },
    });
    expect(attachment.faviconArrivals).toBe(1);
    // another key, its bytes with it; then alone
    say(5, { ...B, data: "BBBB" });
    say(6, B);
    expect(attachment.summary.browser?.favicon).toEqual({ ...B, data: "BBBB" });
    expect(attachment.faviconArrivals).toBe(2);
    // a key whose bytes were never sent here (the last sent was B's): no favicon — never half of one
    say(7, A);
    expect(attachment.summary.browser).not.toHaveProperty("favicon");
    expect(attachment.summary.browser?.url).toBe("https://example.test/");
    // none named: none; the last key's bytes are still kept for when it is named again
    say(8);
    say(9, B);
    expect(attachment.summary.browser?.favicon).toEqual({ ...B, data: "BBBB" });
    expect(attachment.faviconArrivals).toBe(2);
    expect(heard.slice(1)).toEqual([
      { ...A, data: "AAAA" },
      { ...A, data: "AAAA" },
      { ...A, data: "AAAA" },
      { ...B, data: "BBBB" },
      { ...B, data: "BBBB" },
      null,
      null,
      { ...B, data: "BBBB" },
    ]);
  });

  it("rejects stale summaries and isolates observers while closing", async () => {
    const { transport, attachment, hostControl } = await attachedTransport();
    const observed: string[] = [];
    attachment.onSummary(() => {
      throw new Error("observer failed");
    });
    attachment.onSummary((next) => observed.push(`${next.state}:${next.stateRevision}`));

    hostControl.postMessage({
      v: 1,
      type: "summary",
      attachmentId: attachment.attachmentId,
      summary: summary(1, "paused", 3),
    });
    hostControl.postMessage({
      v: 1,
      type: "summary",
      attachmentId: attachment.attachmentId,
      summary: summary(1, "paused", 2),
    });
    expect(attachment.summary).toMatchObject({ state: "paused", stateRevision: 3 });
    expect(transport.protocolFaults).toBe(1);

    expect(() =>
      hostControl.postMessage({
        v: 1,
        type: "summary",
        attachmentId: attachment.attachmentId,
        summary: summary(1, "closed", 4),
      }),
    ).not.toThrow();
    expect(attachment.closed).toBe(true);
    expect(observed).toEqual(["live:1", "paused:3", "closed:4"]);
  });

  it("returns one CPU credit after the renderer inbox incorporates the frame", async () => {
    const { attachment, hostControl, preloadFrames } = await attachedTransport();
    const delivered = fakeFrame();
    preloadFrames.postMessage({
      type: "frame",
      envelope: {
        v: 1,
        attachmentId: attachment.attachmentId,
        metadata: cpuMetadata("1"),
      },
      frame: delivered,
    });
    expect(hostControl.peer?.sent).toContainEqual({
      v: 1,
      type: "cpu-frame-ack",
      attachmentId: attachment.attachmentId,
      producerEpoch: 1,
      sequence: "1",
    });
    expect(attachment.frameStats.pending).toBe(1);
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

  it("detaches locally and exposes the human lane but no semantic control", async () => {
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
    // DT-D6 moved HUMAN interaction — input events, navigation commands — onto
    // the attachment, ops-gated main-side by the ticket. SEMANTIC control (CDP
    // sessions, DOM access: the DT-5 broker lane) still has no surface here.
    expect(typeof attachment.sendInput).toBe("function");
    expect(typeof attachment.sendNavigation).toBe("function");
    expect("debugger" in attachment).toBe(false);
    expect("sendCommand" in attachment).toBe(false);
  });

  it("stamps input with the geometry the renderer mapped against, soft-failing without one", async () => {
    const { attachment, hostControl } = await attachedTransport();

    // The initial summary carries no geometry: nothing to map coordinates
    // against, so the stream soft-fails rather than inventing a revision.
    expect(attachment.sendInput({ kind: "pointer", action: "move", x: 1, y: 2 })).toBe(false);

    hostControl.postMessage({
      v: 1,
      type: "summary",
      attachmentId: "attachment_0123456789abcdef",
      summary: { ...summary(), geometry: metadata("1").geometry },
    });
    expect(attachment.sendInput({ kind: "pointer", action: "move", x: 1, y: 2 })).toBe(true);
    expect(attachment.sendNavigation({ action: "go", url: "https://example.test/" })).toBe(true);

    const rendererMessages = (hostControl.peer?.sent ?? []) as Array<Record<string, unknown>>;
    expect(rendererMessages.find((message) => message.type === "input")).toMatchObject({
      v: 1,
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 1,
      input: { kind: "pointer", action: "move", x: 1, y: 2 },
    });
    expect(rendererMessages.find((message) => message.type === "navigate")).toMatchObject({
      v: 1,
      attachmentId: "attachment_0123456789abcdef",
      navigation: { action: "go", url: "https://example.test/" },
    });

    // A closed attachment's stream simply ends — false, never a throw.
    attachment.dispose();
    expect(attachment.sendInput({ kind: "pointer", action: "move", x: 1, y: 2 })).toBe(false);
    expect(attachment.sendNavigation({ action: "reload" })).toBe(false);
  });

  it("PT-S2: fires a bound Simulator's device ACT on its own control message — the verb alone, parsed at the sender, never a navigation; false, never a throw, once closed", async () => {
    const { attachment, hostControl } = await attachedTransport();

    // no geometry is needed: an act names no point of the frame
    expect(attachment.sendDevice({ verb: "boot" })).toBe(true);
    expect(attachment.sendDevice({ verb: "open-settings" })).toBe(true);

    const rendererMessages = (hostControl.peer?.sent ?? []) as Array<Record<string, unknown>>;
    expect(rendererMessages.filter((message) => message.type === "device")).toEqual([
      {
        v: 1,
        type: "device",
        attachmentId: "attachment_0123456789abcdef",
        command: { verb: "boot" },
      },
      {
        v: 1,
        type: "device",
        attachmentId: "attachment_0123456789abcdef",
        command: { verb: "open-settings" },
      },
    ]);
    // a device act is never a navigation
    expect(rendererMessages.some((message) => message.type === "navigate")).toBe(false);

    // a verb outside the five (one that would change iOS, or the device's life) never reaches the port
    expect(() => attachment.sendDevice({ verb: "shutdown" } as never)).toThrow();
    expect(rendererMessages.filter((message) => message.type === "device")).toHaveLength(2);

    attachment.dispose();
    expect(attachment.sendDevice({ verb: "retry" })).toBe(false);
    expect(rendererMessages.filter((message) => message.type === "device")).toHaveLength(2);
  });
});
