import { EventEmitter } from "node:events";
import type {
  LiveSurfaceDemandV1,
  LiveSurfaceInputEventV1,
  LiveSurfaceNavigationCommandV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  LiveSurfaceControlSession,
  type LiveSurfaceMainMessagePort,
} from "../src/main/live-surfaces/control-session";
import type {
  LiveSurfaceCpuFrame,
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
  readonly inputs: Array<{ input: LiveSurfaceInputEventV1; geometryRevision: number }> = [];
  readonly navigations: LiveSurfaceNavigationCommandV1[] = [];
  readonly dispose = vi.fn();
  context: LiveSurfaceRuntimeAttachContext | null = null;
  initialSummary = summary();
  onAttach: ((context: LiveSurfaceRuntimeAttachContext) => void) | null = null;
  /** When true the returned attachment carries the DT-D6 lane members; the
   * default (false) models a view-only runtime with no lane at all. */
  withInputLane = false;
  inputThrows = false;

  attach(context: LiveSurfaceRuntimeAttachContext) {
    this.context = context;
    this.onAttach?.(context);
    return {
      summary: this.initialSummary,
      setDemand: (demand: LiveSurfaceDemandV1) => this.demands.push(demand),
      ...(this.withInputLane
        ? {
            dispatchInput: (input: LiveSurfaceInputEventV1, geometryRevision: number) => {
              if (this.inputThrows) throw new Error("runtime input fault");
              this.inputs.push({ input, geometryRevision });
            },
            navigate: (command: LiveSurfaceNavigationCommandV1) => {
              this.navigations.push(command);
            },
          }
        : {}),
      dispose: this.dispose,
    };
  }
}

function setup(
  createTextureSink?: () => LiveSurfaceTextureFrameSink,
  configureAuthority?: (authority: FakeAuthority) => void,
  operations: Parameters<LiveSurfaceTicketTable<unknown>["issue"]>[0]["operations"] = [
    "view",
    "pointer",
  ],
) {
  const port = new FakeMainPort();
  const tickets = new LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>({
    randomToken: () => "ticket_0000000000000000000000000000000000000001",
  });
  const authority = new FakeAuthority();
  configureAuthority?.(authority);
  const ticket = tickets.issue({
    targetWebContentsId: 17,
    rendererGeneration: 3,
    surfaceId: authority.surfaceId,
    sourceKind: "browser",
    operations,
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

function textureFrame(
  sequence = "1",
  override: { readonly surfaceId?: string; readonly producerEpoch?: number } = {},
): LiveSurfaceProducerTextureFrame {
  return {
    metadata: {
      v: 1,
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 1,
      sequence,
      geometry: {
        revision: 1,
        codedSize: { width: 1, height: 1 },
        visibleRect: { x: 0, y: 0, width: 1, height: 1 },
        logicalSize: { width: 1, height: 1 },
        orientation: 0,
      },
      hostReceivedAtUs: sequence,
      pixelFormat: "bgra",
      colorSpace: "srgb",
      alphaMode: "opaque",
      transport: "shared-texture",
      ...override,
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

  it("folds synchronous attach summaries into one monotonic attached snapshot", () => {
    const result = setup(undefined, (authority) => {
      authority.onAttach = (context) => {
        context.publishSummary({ ...summary("paused", 1), stateRevision: 2 });
      };
    });
    attach(result);
    expect(result.port.sent[1]).toMatchObject({
      type: "attached",
      attachment: { summary: { state: "paused", stateRevision: 2 } },
    });
    expect(
      result.port.sent.filter((message) => (message as { type?: string }).type === "summary"),
    ).toHaveLength(0);
  });

  it("retains the latest coherent attach-time capability update at the same state revision", () => {
    const result = setup(undefined, (authority) => {
      authority.onAttach = (context) => {
        context.publishSummary({
          ...summary(),
          transport: "shared-texture",
          geometry: textureFrame().metadata.geometry,
        });
      };
    });
    attach(result);
    expect(result.port.sent[1]).toMatchObject({
      type: "attached",
      attachment: {
        summary: {
          state: "live",
          stateRevision: 1,
          transport: "shared-texture",
          geometry: { revision: 1 },
        },
      },
    });
  });

  it("publishes at most one CPU frame until the renderer returns its credit", () => {
    const result = setup();
    attach(result);
    const makeFrame = (sequence: string, producerEpoch = 1): LiveSurfaceCpuFrame => ({
      metadata: {
        v: 1,
        surfaceId: result.authority.surfaceId,
        producerEpoch,
        sequence,
        geometry: {
          revision: 1,
          codedSize: { width: 1, height: 1 },
          visibleRect: { x: 0, y: 0, width: 1, height: 1 },
          logicalSize: { width: 1, height: 1 },
          orientation: 0,
        },
        hostReceivedAtUs: sequence,
        pixelFormat: "rgba",
        colorSpace: "srgb",
        alphaMode: "opaque",
        transport: "cpu-bgra",
        degradedMode: "cpu-bitmap",
      },
      pixels: new Uint8Array([255, 0, 0, 255]),
    });
    expect(result.authority.context?.publishCpuFrame(makeFrame("1"))).toBe(false);
    result.port.receive({
      v: 1,
      type: "demand",
      attachmentId: "attachment_0123456789abcdef",
      demand: {
        revision: 1,
        mode: "live",
        targetFps: 30,
        priority: 50,
        interactive: false,
      },
    });
    expect(result.authority.context?.publishCpuFrame(makeFrame("2"))).toBe(true);
    expect(result.authority.context?.publishCpuFrame(makeFrame("3"))).toBe(false);
    expect(result.cpuFrames).toHaveLength(1);
    result.port.receive({
      v: 1,
      type: "cpu-frame-ack",
      attachmentId: "attachment_0123456789abcdef",
      producerEpoch: 1,
      sequence: "2",
    });
    expect(result.authority.context?.publishCpuFrame(makeFrame("4"))).toBe(true);
    expect(result.cpuFrames).toHaveLength(2);

    result.authority.context?.publishSummary(summary("live", 2));
    expect(result.authority.context?.publishCpuFrame(makeFrame("1", 2))).toBe(true);
    result.port.receive({
      v: 1,
      type: "cpu-frame-ack",
      attachmentId: "attachment_0123456789abcdef",
      producerEpoch: 1,
      sequence: "4",
    });
    expect(result.session.closed).toBe(false);
    expect(result.authority.context?.publishCpuFrame(makeFrame("2", 2))).toBe(false);
    result.port.receive({
      v: 1,
      type: "cpu-frame-ack",
      attachmentId: "attachment_0123456789abcdef",
      producerEpoch: 2,
      sequence: "1",
    });
    expect(result.authority.context?.publishCpuFrame(makeFrame("3", 2))).toBe(true);
    expect(result.cpuFrames).toHaveLength(4);
  });

  it("routes owned textures only after commit and closes the attachment sink", () => {
    const sink: LiveSurfaceTextureFrameSink = {
      stats: {
        offered: 0,
        accepted: 0,
        dropped: 0,
        outstanding: 0,
        peakOutstanding: 0,
        completed: 0,
        timedOut: 0,
        sendFailures: 0,
        releaseFaults: 0,
      },
      offer: vi.fn(() => ({ kind: "dropped" as const, reason: "transfer-cap" as const })),
      close: vi.fn(),
      whenDrained: vi.fn(() => Promise.resolve()),
      closeAndDrain: vi.fn(() => Promise.resolve("drained" as const)),
    };
    const result = setup(() => sink);
    attach(result);
    result.port.receive({
      v: 1,
      type: "demand",
      attachmentId: "attachment_0123456789abcdef",
      demand: {
        revision: 1,
        mode: "live",
        targetFps: 30,
        priority: 50,
        interactive: false,
      },
    });
    result.authority.context?.publishSummary({
      ...summary(),
      stateRevision: 2,
      transport: "shared-texture",
    });
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
    expect(sink.closeAndDrain).toHaveBeenCalledTimes(1);
  });

  it("rejects absent demand, stale epochs, and non-monotonic texture sequences in main", () => {
    const sink: LiveSurfaceTextureFrameSink = {
      stats: {
        offered: 0,
        accepted: 0,
        dropped: 0,
        outstanding: 0,
        peakOutstanding: 0,
        completed: 0,
        timedOut: 0,
        sendFailures: 0,
        releaseFaults: 0,
      },
      offer: vi.fn(() => ({ kind: "dropped" as const, reason: "transfer-cap" as const })),
      close: vi.fn(),
      whenDrained: vi.fn(() => Promise.resolve()),
      closeAndDrain: vi.fn(() => Promise.resolve("drained" as const)),
    };
    const result = setup(() => sink);
    attach(result);
    result.authority.context?.publishSummary({
      ...summary(),
      stateRevision: 2,
      transport: "shared-texture",
    });
    const withoutDemand = textureFrame("1");
    expect(result.authority.context?.offerTextureFrame(withoutDemand)).toEqual({
      kind: "dropped",
      reason: "not-demanded",
    });
    result.port.receive({
      v: 1,
      type: "demand",
      attachmentId: "attachment_0123456789abcdef",
      demand: {
        revision: 1,
        mode: "live",
        targetFps: 30,
        priority: 50,
        interactive: false,
      },
    });
    const current = textureFrame("3");
    expect(result.authority.context?.offerTextureFrame(current)).toEqual({
      kind: "dropped",
      reason: "transfer-cap",
    });
    expect(sink.offer).toHaveBeenCalledTimes(1);
    const staleSequence = textureFrame("2");
    expect(result.authority.context?.offerTextureFrame(staleSequence)).toEqual({
      kind: "dropped",
      reason: "stale-sequence",
    });
    const staleEpoch = textureFrame("4", { producerEpoch: 0 });
    expect(result.authority.context?.offerTextureFrame(staleEpoch)).toEqual({
      kind: "dropped",
      reason: "stale-epoch",
    });
    expect(sink.offer).toHaveBeenCalledTimes(1);
  });

  it("exposes a bounded generation drain without delaying synchronous detach", async () => {
    let resolveDrain!: (outcome: "drained") => void;
    const drain = new Promise<"drained">((resolve) => {
      resolveDrain = resolve;
    });
    const sink: LiveSurfaceTextureFrameSink = {
      stats: {
        offered: 0,
        accepted: 0,
        dropped: 0,
        outstanding: 1,
        peakOutstanding: 1,
        completed: 0,
        timedOut: 0,
        sendFailures: 0,
        releaseFaults: 0,
      },
      offer: vi.fn(() => ({ kind: "dropped" as const, reason: "transfer-cap" as const })),
      close: vi.fn(),
      whenDrained: vi.fn(() => drain.then(() => undefined)),
      closeAndDrain: vi.fn(() => drain),
    };
    const result = setup(() => sink);
    attach(result);
    result.session.dispose();
    expect(result.session.closed).toBe(true);
    expect(sink.closeAndDrain).toHaveBeenCalledWith(2_000);
    let finished = false;
    const waiting = result.session.whenDrained().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    resolveDrain("drained");
    await waiting;
    expect(finished).toBe(true);
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

  it("forwards granted input and navigation to the runtime with the sender's revision", () => {
    const result = setup(
      undefined,
      (authority) => {
        authority.withInputLane = true;
      },
      ["view", "pointer", "keyboard", "navigate"],
    );
    attach(result);
    result.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 7,
      input: { kind: "pointer", action: "move", x: 10, y: 20 },
    });
    result.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 7,
      input: {
        kind: "key",
        action: "down",
        key: "a",
        code: "KeyA",
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      },
    });
    // PT-3: a composition rides the keyboard's grant
    result.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 7,
      input: { kind: "compose", text: "にほ", caret: 2 },
    });
    result.port.receive({
      v: 1,
      type: "navigate",
      attachmentId: "attachment_0123456789abcdef",
      navigation: { action: "go", url: "https://example.test/" },
    });
    expect(result.protocolFaults).toEqual([]);
    expect(result.session.closed).toBe(false);
    expect(result.authority.inputs).toEqual([
      { input: { kind: "pointer", action: "move", x: 10, y: 20 }, geometryRevision: 7 },
      {
        input: {
          kind: "key",
          action: "down",
          key: "a",
          code: "KeyA",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
        },
        geometryRevision: 7,
      },
      { input: { kind: "compose", text: "にほ", caret: 2 }, geometryRevision: 7 },
    ]);
    expect(result.authority.navigations).toEqual([{ action: "go", url: "https://example.test/" }]);
  });

  it("drops input for an unknown attachment silently — the stream races detach by design", () => {
    const result = setup(undefined, (authority) => {
      authority.withInputLane = true;
    });
    attach(result);
    result.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_9999999999999999",
      geometryRevision: 1,
      input: { kind: "pointer", action: "move", x: 1, y: 1 },
    });
    expect(result.session.closed).toBe(false);
    expect(result.protocolFaults).toEqual([]);
    expect(result.authority.inputs).toEqual([]);
  });

  it("fails the generation closed on input or navigation without its operation grant", () => {
    // The default grant is view+pointer: keyboard input cannot be legitimate.
    const keyboard = setup(undefined, (authority) => {
      authority.withInputLane = true;
    });
    attach(keyboard);
    keyboard.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 1,
      input: {
        kind: "text",
        text: "never",
      },
    });
    expect(keyboard.session.closed).toBe(true);
    expect(keyboard.protocolFaults).toEqual(["input arrived without its operation grant"]);
    expect(keyboard.authority.inputs).toEqual([]);

    // PT-3: an IME composition is the keyboard's, as text is — without the grant it closes the generation too
    const composing = setup(undefined, (authority) => {
      authority.withInputLane = true;
    });
    attach(composing);
    composing.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 1,
      input: { kind: "compose", text: "にほ", caret: 2 },
    });
    expect(composing.session.closed).toBe(true);
    expect(composing.protocolFaults).toEqual(["input arrived without its operation grant"]);
    expect(composing.authority.inputs).toEqual([]);

    const navigation = setup(undefined, (authority) => {
      authority.withInputLane = true;
    });
    attach(navigation);
    navigation.port.receive({
      v: 1,
      type: "navigate",
      attachmentId: "attachment_0123456789abcdef",
      navigation: { action: "reload" },
    });
    expect(navigation.session.closed).toBe(true);
    expect(navigation.protocolFaults).toEqual(["navigation arrived without its operation grant"]);
    expect(navigation.authority.navigations).toEqual([]);
  });

  it("drops granted input on a runtime with no lane, and faults a runtime that throws", () => {
    // A view-only runtime simply has no member: silent drop, session intact.
    const laneless = setup(undefined, undefined, ["view", "pointer"]);
    attach(laneless);
    laneless.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 1,
      input: { kind: "pointer", action: "move", x: 1, y: 1 },
    });
    expect(laneless.session.closed).toBe(false);
    expect(laneless.protocolFaults).toEqual([]);

    // A runtime that throws SYNCHRONOUSLY on a validated event is a fault.
    const throwing = setup(undefined, (authority) => {
      authority.withInputLane = true;
      authority.inputThrows = true;
    });
    attach(throwing);
    throwing.port.receive({
      v: 1,
      type: "input",
      attachmentId: "attachment_0123456789abcdef",
      geometryRevision: 1,
      input: { kind: "pointer", action: "move", x: 1, y: 1 },
    });
    expect(throwing.session.closed).toBe(true);
    expect(throwing.protocolFaults).toEqual(["runtime rejected a validated input event"]);
  });
});
