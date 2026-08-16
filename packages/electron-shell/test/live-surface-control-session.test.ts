import { EventEmitter } from "node:events";
import type { LiveSurfaceDemandV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  LiveSurfaceControlSession,
  type LiveSurfaceMainMessagePort,
} from "../src/main/live-surfaces/control-session";
import type {
  LiveSurfaceRuntimeAttachContext,
  LiveSurfaceRuntimeAuthority,
} from "../src/main/live-surfaces/runtime";
import type {
  LiveSurfaceProducerTextureFrame,
  LiveSurfaceTextureFrameSink,
} from "../src/main/live-surfaces/texture-forwarder";
import { LiveSurfaceTicketTable } from "../src/main/live-surfaces/ticket-table";

class FakeMainPort extends EventEmitter implements LiveSurfaceMainMessagePort {
  readonly sent: unknown[] = [];
  readonly postMessage = vi.fn((message: unknown) => {
    this.sent.push(message);
  });
  readonly start = vi.fn();
  readonly close = vi.fn();

  receive(message: unknown): void {
    this.emit("message", { data: message });
  }
}

function summary(
  state: LiveSurfaceRuntimeSummaryV1["state"] = "live",
  producerEpoch = 1,
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
    transport: "cpu-bgra",
  };
}

class FakeAuthority implements LiveSurfaceRuntimeAuthority {
  readonly surfaceId = "surface_0123456789abcdef";
  readonly demands: LiveSurfaceDemandV1[] = [];
  readonly dispose = vi.fn();
  context: LiveSurfaceRuntimeAttachContext | null = null;

  attach(context: LiveSurfaceRuntimeAttachContext) {
    this.context = context;
    return {
      summary: summary(),
      setDemand: (demand: LiveSurfaceDemandV1) => this.demands.push(demand),
      dispose: this.dispose,
    };
  }
}

function setup(createTextureSink?: () => LiveSurfaceTextureFrameSink) {
  const port = new FakeMainPort();
  const tickets = new LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>({
    randomToken: () => "ticket_0000000000000000000000000000000000000001",
  });
  const authority = new FakeAuthority();
  const ticket = tickets.issue({
    targetWebContentsId: 17,
    rendererGeneration: 3,
    surfaceId: authority.surfaceId,
    sourceKind: "browser",
    operations: ["view", "pointer"],
    authority,
  });
  const protocolFaults: string[] = [];
  const cpuFrames: Array<{ attachmentId: string; frame: unknown }> = [];
  const session = new LiveSurfaceControlSession({
    senderWebContentsId: 17,
    bootstrap: { v: 1, rendererGeneration: 3 },
    port,
    tickets,
    randomAttachmentId: () => "attachment_0123456789abcdef",
    publishCpuFrame: (attachmentId, frame) => {
      cpuFrames.push({ attachmentId, frame });
      return true;
    },
    ...(createTextureSink === undefined ? {} : { createTextureSink: () => createTextureSink() }),
    onProtocolFault: (fault) => protocolFaults.push(fault),
  });
  session.start();
  return { port, tickets, authority, ticket, session, protocolFaults, cpuFrames };
}

function textureFrame(): LiveSurfaceProducerTextureFrame {
  return {
    metadata: {
      v: 1,
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 1,
      sequence: "1",
      geometry: {
        revision: 1,
        codedSize: { width: 1, height: 1 },
        visibleRect: { x: 0, y: 0, width: 1, height: 1 },
        logicalSize: { width: 1, height: 1 },
        orientation: 0,
      },
      hostReceivedAtUs: "1",
      pixelFormat: "bgra",
      colorSpace: "srgb",
      alphaMode: "opaque",
      transport: "shared-texture",
    },
    textureInfo: { codedSize: { width: 1, height: 1 }, handle: {}, pixelFormat: "bgra" },
    releaseSource: vi.fn(),
    allReferencesReleased: vi.fn(),
  };
}

function attach(setupResult: ReturnType<typeof setup>): void {
  setupResult.port.receive({
    v: 1,
    type: "attach",
    requestId: "request_0001",
    ticket: setupResult.ticket,
  });
}

describe("LiveSurfaceControlSession", () => {
  it("handshakes, redeems once, and attaches without exposing source material", () => {
    const result = setup();
    expect(result.port.start).toHaveBeenCalledTimes(1);
    expect(result.port.sent[0]).toEqual({
      v: 1,
      type: "ready",
      bootstrap: { v: 1, rendererGeneration: 3 },
    });
    attach(result);
    expect(result.session.attachmentCount).toBe(1);
    expect(result.tickets.size).toBe(0);
    expect(result.port.sent[1]).toMatchObject({
      type: "attached",
      requestId: "request_0001",
      attachment: {
        attachmentId: "attachment_0123456789abcdef",
        summary: { surfaceId: result.authority.surfaceId },
      },
    });
    expect(JSON.stringify(result.port.sent)).not.toContain("sourceKind");
    expect(JSON.stringify(result.port.sent)).not.toContain("targetWebContentsId");
  });

  it("routes validated demand and summary updates through the exact attachment", () => {
    const result = setup();
    attach(result);
    const demand: LiveSurfaceDemandV1 = {
      revision: 1,
      mode: "live",
      targetFps: 30,
      priority: 50,
      interactive: true,
    };
    result.port.receive({
      v: 1,
      type: "demand",
      attachmentId: "attachment_0123456789abcdef",
      demand,
    });
    result.authority.context?.publishSummary(summary("reconnecting", 2));
    expect(result.authority.demands).toEqual([demand]);
    expect(result.port.sent.at(-1)).toMatchObject({
      type: "summary",
      attachmentId: "attachment_0123456789abcdef",
      summary: { state: "reconnecting", producerEpoch: 2 },
    });
  });

  it("does not publish a CPU frame until attach has committed", () => {
    const result = setup();
    attach(result);
    const accepted = result.authority.context?.publishCpuFrame({
      metadata: {
        v: 1,
        surfaceId: result.authority.surfaceId,
        producerEpoch: 1,
        sequence: "1",
        geometry: {
          revision: 1,
          codedSize: { width: 1, height: 1 },
          visibleRect: { x: 0, y: 0, width: 1, height: 1 },
          logicalSize: { width: 1, height: 1 },
          orientation: 0,
        },
        hostReceivedAtUs: "1",
        pixelFormat: "rgba",
        colorSpace: "srgb",
        alphaMode: "opaque",
        transport: "cpu-bgra",
        degradedMode: "cpu-bitmap",
      },
      pixels: new Uint8Array([255, 0, 0, 255]),
    });
    expect(accepted).toBe(true);
    expect(result.cpuFrames).toHaveLength(1);
  });

  it("routes owned textures only after commit and closes the attachment sink", () => {
    const sink: LiveSurfaceTextureFrameSink = {
      stats: {
        offered: 0,
        accepted: 0,
        dropped: 0,
        outstanding: 0,
        completed: 0,
        sendFailures: 0,
        releaseFaults: 0,
      },
      offer: vi.fn(() => ({ kind: "dropped" as const, reason: "transfer-cap" as const })),
      close: vi.fn(),
      whenDrained: vi.fn(() => Promise.resolve()),
    };
    const result = setup(() => sink);
    attach(result);
    const frame = textureFrame();
    expect(result.authority.context?.offerTextureFrame(frame)).toEqual({
      kind: "dropped",
      reason: "transfer-cap",
    });
    expect(sink.offer).toHaveBeenCalledWith(frame);
    result.port.receive({
      v: 1,
      type: "detach",
      attachmentId: "attachment_0123456789abcdef",
    });
    expect(sink.close).toHaveBeenCalledTimes(1);
  });

  it("releases both texture leases when no renderer transfer sink exists", () => {
    const result = setup();
    attach(result);
    const frame = textureFrame();
    expect(result.authority.context?.offerTextureFrame(frame)).toEqual({
      kind: "dropped",
      reason: "closed",
    });
    expect(frame.releaseSource).toHaveBeenCalledWith("closed");
    expect(frame.allReferencesReleased).toHaveBeenCalledWith("closed");
  });

  it("detaches idempotently and renderer-generation close disposes everything once", () => {
    const result = setup();
    attach(result);
    result.port.receive({
      v: 1,
      type: "detach",
      attachmentId: "attachment_0123456789abcdef",
    });
    result.port.receive({
      v: 1,
      type: "detach",
      attachmentId: "attachment_0123456789abcdef",
    });
    expect(result.authority.dispose).toHaveBeenCalledTimes(1);
    expect(result.session.attachmentCount).toBe(0);
    expect(
      result.port.sent.filter((message) => (message as { type?: string }).type === "detached"),
    ).toHaveLength(2);
    result.session.dispose();
    result.session.dispose();
    expect(result.authority.dispose).toHaveBeenCalledTimes(1);
    expect(result.port.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a ticket for another generation and burns it", () => {
    const result = setup();
    attach(result);
    const wrongGeneration = result.tickets.issue({
      targetWebContentsId: 17,
      rendererGeneration: 4,
      surfaceId: result.authority.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      authority: result.authority,
    });
    result.port.receive({
      v: 1,
      type: "attach",
      requestId: "request_0002",
      ticket: wrongGeneration,
    });
    expect(result.port.sent.at(-1)).toMatchObject({
      type: "rejected",
      requestId: "request_0002",
      error: { code: "security-rejected" },
    });
    expect(() =>
      result.tickets.redeem(wrongGeneration, {
        senderWebContentsId: 17,
        rendererGeneration: 4,
      }),
    ).toThrow(/unknown/);
  });

  it("fails the whole generation closed on malformed or cross-attachment demand", () => {
    const malformed = setup();
    malformed.port.receive({ nope: true });
    expect(malformed.session.closed).toBe(true);
    expect(malformed.protocolFaults).toEqual(["malformed renderer control message"]);

    const unknown = setup();
    attach(unknown);
    unknown.port.receive({
      v: 1,
      type: "demand",
      attachmentId: "attachment_9999999999999999",
      demand: {
        revision: 1,
        mode: "paused",
        targetFps: 0,
        priority: 0,
        interactive: false,
      },
    });
    expect(unknown.session.closed).toBe(true);
    expect(unknown.authority.dispose).toHaveBeenCalledTimes(1);
    expect(unknown.protocolFaults).toEqual(["demand named an unknown attachment"]);
  });
});
