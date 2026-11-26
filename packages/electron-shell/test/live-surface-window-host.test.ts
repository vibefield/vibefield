import { EventEmitter } from "node:events";
import type { LiveSurfaceDemandV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import type { BrowserWindow, MessagePortMain, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type {
  LiveSurfaceRuntimeAttachContext,
  LiveSurfaceRuntimeAuthority,
} from "../src/main/live-surfaces/runtime";
import type { LiveSurfaceTextureFrameSink } from "../src/main/live-surfaces/texture-forwarder";
import { LiveSurfaceTicketTable } from "../src/main/live-surfaces/ticket-table";
import {
  type LiveSurfaceMainMessageChannel,
  type LiveSurfaceTextureSinkFactory,
  type LiveSurfaceWindowDesk,
  LiveSurfaceWindowHost,
  liveSurfaceProductWindows,
} from "../src/main/live-surfaces/window-host";

class FakePort extends EventEmitter {
  readonly sent: unknown[] = [];
  readonly start = vi.fn();
  readonly close = vi.fn();

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  receive(message: unknown): void {
    this.emit("message", { data: message });
  }
}

class FakeWebContents extends EventEmitter {
  readonly id = 17;
  readonly posted: Array<{ channel: string; message: unknown; ports: readonly unknown[] }> = [];
  loading = true;
  destroyed = false;
  throwOnPost = false;

  isLoadingMainFrame(): boolean {
    return this.loading;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  postMessage(channel: string, message: unknown, ports: readonly unknown[]): void {
    if (this.throwOnPost) throw new Error("renderer unavailable");
    this.posted.push({ channel, message, ports });
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
    transport: "cpu-bgra",
  };
}

class FakeAuthority implements LiveSurfaceRuntimeAuthority {
  readonly surfaceId = "surface_0123456789abcdef";
  readonly dispose = vi.fn();
  context: LiveSurfaceRuntimeAttachContext | null = null;

  attach(context: LiveSurfaceRuntimeAttachContext) {
    this.context = context;
    return {
      summary: summary(),
      setDemand: (_demand: LiveSurfaceDemandV1) => undefined,
      dispose: this.dispose,
    };
  }
}

function setup(createTextureSink?: LiveSurfaceTextureSinkFactory, desk?: LiveSurfaceWindowDesk) {
  const webContents = new FakeWebContents();
  const window = { webContents } as unknown as BrowserWindow;
  const tickets = new LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>({
    randomToken: (() => {
      let sequence = 0;
      return () => `ticket_${String(++sequence).padStart(40, "0")}`;
    })(),
  });
  const channels: Array<{ port1: FakePort; port2: FakePort }> = [];
  const createChannel = (): LiveSurfaceMainMessageChannel => {
    const channel = { port1: new FakePort(), port2: new FakePort() };
    channels.push(channel);
    return channel as unknown as LiveSurfaceMainMessageChannel;
  };
  const host = new LiveSurfaceWindowHost(
    window,
    tickets,
    createChannel,
    undefined,
    createTextureSink,
    undefined,
    desk,
  ).install();
  return { webContents, window, tickets, channels, host };
}

function textureSink(): LiveSurfaceTextureFrameSink {
  return {
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
}

function finishLoad(result: ReturnType<typeof setup>): void {
  result.webContents.loading = false;
  result.webContents.emit("did-finish-load");
}

describe("LiveSurfaceWindowHost", () => {
  it("opens exactly three channel pairs and targets tickets to the current generation", () => {
    const result = setup();
    expect(result.host.rendererGeneration).toBe(0);
    finishLoad(result);
    expect(result.host.rendererGeneration).toBe(1);
    expect(result.channels).toHaveLength(3);
    expect(result.webContents.posted).toHaveLength(1);
    expect(result.webContents.posted[0]).toMatchObject({
      message: { v: 1, rendererGeneration: 1 },
      ports: [
        result.channels[0]?.port2,
        result.channels[1]?.port1,
        result.channels[1]?.port2,
        result.channels[2]?.port2,
      ],
    });
    const authority = new FakeAuthority();
    const ticket = result.host.issue({
      surfaceId: authority.surfaceId,
      sourceKind: "browser",
      operations: ["view", "pointer"],
      authority,
    });
    expect(
      result.tickets.redeem(ticket, { senderWebContentsId: 17, rendererGeneration: 1 }).authority,
    ).toBe(authority);
  });

  it("tears down attachments/fallback on navigation and refuses stale-generation tickets", () => {
    const result = setup();
    finishLoad(result);
    const authority = new FakeAuthority();
    const ticket = result.host.issue({
      surfaceId: authority.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      authority,
    });
    const control = result.channels[0]?.port1;
    control?.receive({ v: 1, type: "attach", requestId: "request_0001", ticket });
    expect(authority.context).not.toBeNull();
    expect(control?.sent.at(-1)).toMatchObject({ type: "attached" });
    const attachmentId = (
      control?.sent.at(-1) as { attachment?: { attachmentId?: string } } | undefined
    )?.attachment?.attachmentId;
    expect(attachmentId).toBeDefined();
    control?.receive({
      v: 1,
      type: "demand",
      attachmentId,
      demand: {
        revision: 1,
        mode: "live",
        targetFps: 30,
        priority: 50,
        interactive: false,
      },
    });
    const published = authority.context?.publishCpuFrame({
      metadata: {
        v: 1,
        surfaceId: authority.surfaceId,
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
    expect(published).toBe(true);
    expect(result.channels[2]?.port1.sent).toHaveLength(1);

    const stale = result.host.issue({
      surfaceId: authority.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      authority,
    });
    result.webContents.emit("did-start-navigation", {}, "vibefield-app://shell", false, true);
    expect(authority.dispose).toHaveBeenCalledTimes(1);
    expect(result.channels[2]?.port1.close).toHaveBeenCalledTimes(1);
    expect(() =>
      result.tickets.redeem(stale, { senderWebContentsId: 17, rendererGeneration: 2 }),
    ).toThrow(/wrong-generation/);
    expect(() =>
      result.host.issue({
        surfaceId: authority.surfaceId,
        sourceKind: "browser",
        operations: ["view"],
        authority,
      }),
    ).toThrow(/without a live renderer generation/);

    result.webContents.emit("did-finish-load");
    expect(result.host.rendererGeneration).toBe(2);
    expect(result.channels).toHaveLength(6);
  });

  // EY-1 (C4, 2026-11-24): the generation's number alone does not say a document stands: it is 0 before the first
  // load ends, and still the old document's from a navigation's start until its load's end. Custody reads which
  // document a pane placed now lands in, so the host says whether one stands.
  it("EY-1: says whether its generation's document stands: not before the first load ends, not between a navigation's start and its load's end, not once its process is gone or it is disposed", () => {
    const result = setup();
    expect(result.host.rendererGeneration).toBe(0);
    expect(result.host.rendererLive).toBe(false);
    finishLoad(result);
    expect(result.host.rendererLive).toBe(true);
    // a navigation begins: the number is still the old document's, and no document stands
    result.webContents.emit("did-start-navigation", {}, "vibefield-app://shell", false, true);
    expect(result.host.rendererGeneration).toBe(1);
    expect(result.host.rendererLive).toBe(false);
    // a navigation inside the document, or a frame's own, replaces nothing
    result.webContents.emit("did-finish-load");
    expect(result.host.rendererGeneration).toBe(2);
    expect(result.host.rendererLive).toBe(true);
    result.webContents.emit("did-start-navigation", {}, "vibefield-app://shell#a", true, true);
    result.webContents.emit("did-start-navigation", {}, "https://frame.test/", false, false);
    expect(result.host.rendererLive).toBe(true);
    result.webContents.emit("render-process-gone");
    expect(result.host.rendererLive).toBe(false);
    result.webContents.emit("did-finish-load");
    expect(result.host.rendererLive).toBe(true);
    result.host.dispose();
    expect(result.host.rendererLive).toBe(false);
  });

  it("closes a generation when its control port disconnects", () => {
    const result = setup();
    finishLoad(result);
    const authority = new FakeAuthority();
    const ticket = result.host.issue({
      surfaceId: authority.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      authority,
    });
    result.channels[0]?.port1.receive({
      v: 1,
      type: "attach",
      requestId: "request_0001",
      ticket,
    });
    result.channels[0]?.port1.emit("close");
    expect(authority.dispose).toHaveBeenCalledTimes(1);
    expect(result.channels[2]?.port1.close).toHaveBeenCalledTimes(1);
    expect(() =>
      result.host.issue({
        surfaceId: authority.surfaceId,
        sourceKind: "browser",
        operations: ["view"],
        authority,
      }),
    ).toThrow(/without a live renderer generation/);
  });

  it("retains one surface transfer budget across renderer generations", () => {
    const budgets: unknown[] = [];
    const result = setup((_surfaceId, _attachmentId, budget) => {
      budgets.push(budget);
      return textureSink();
    });
    finishLoad(result);
    const authority = new FakeAuthority();
    const firstTicket = result.host.issue({
      surfaceId: authority.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      authority,
    });
    result.channels[0]?.port1.receive({
      v: 1,
      type: "attach",
      requestId: "request_0001",
      ticket: firstTicket,
    });
    result.webContents.emit("did-start-navigation", {}, "vibefield-app://shell", false, true);
    result.webContents.emit("did-finish-load");
    const secondTicket = result.host.issue({
      surfaceId: authority.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      authority,
    });
    result.channels[3]?.port1.receive({
      v: 1,
      type: "attach",
      requestId: "request_0002",
      ticket: secondTicket,
    });
    expect(budgets).toHaveLength(2);
    expect(budgets[1]).toBe(budgets[0]);
  });

  it("closes every local port when the renderer handoff throws", () => {
    const result = setup();
    result.webContents.throwOnPost = true;
    finishLoad(result);
    expect(result.channels).toHaveLength(3);
    for (const channel of result.channels) {
      expect(channel.port1.close).toHaveBeenCalledTimes(1);
      expect(channel.port2.close).toHaveBeenCalledTimes(1);
    }
    expect(() =>
      result.host.issue({
        surfaceId: "surface_0123456789abcdef",
        sourceKind: "browser",
        operations: ["view"],
        authority: new FakeAuthority(),
      }),
    ).toThrow(/without a live renderer generation/);
  });

  it("removes lifecycle listeners and closes the current generation on dispose", () => {
    const result = setup();
    finishLoad(result);
    const before = result.webContents.listenerCount("did-finish-load");
    expect(before).toBe(1);
    result.host.dispose();
    result.host.dispose();
    expect(result.webContents.listenerCount("did-finish-load")).toBe(0);
    expect(result.channels[0]?.port1.close).toHaveBeenCalledTimes(1);
    expect(result.channels[2]?.port1.close).toHaveBeenCalledTimes(1);
  });

  // EY-1 (1f, 2026-11-19) — the window's desk word reaches the window's desk callbacks from every
  // renderer generation's control session, and the product windows are the hosts that stand.
  it("EY-1: hands each generation's room and declines from its desk to the window's desk", () => {
    const rooms: number[] = [];
    const declined: string[] = [];
    const result = setup(undefined, {
      onRoom: (agentPages) => rooms.push(agentPages),
      onMadeDeclined: (made) => declined.push(made),
    });
    finishLoad(result);
    result.channels[0]?.port1.receive({ v: 1, type: "room", agentPages: 3 });
    result.channels[0]?.port1.receive({
      v: 1,
      type: "made-declined",
      made: "surface_0123456789ab",
      reason: "no-room",
    });
    // a reload opens a new generation: its control session reaches the same desk
    result.webContents.emit("did-start-navigation", {}, "vibefield-app://shell", false, true);
    result.webContents.emit("did-finish-load");
    result.channels[3]?.port1.receive({ v: 1, type: "room", agentPages: 0 });
    expect(rooms).toEqual([3, 0]);
    expect(declined).toEqual(["surface_0123456789ab"]);
  });

  it("EY-1: names the product windows that stand: a host added, one removed, one destroyed", () => {
    const hostOf = (id: number, destroyed = false): Pick<LiveSurfaceWindowHost, "window"> => {
      const window = { isDestroyed: () => destroyed, webContents: { id } };
      return { window: window as unknown as BrowserWindow };
    };
    const hosts = new Map<number, Pick<LiveSurfaceWindowHost, "window">>();
    expect(liveSurfaceProductWindows(hosts.values())).toEqual([]);
    hosts.set(1, hostOf(7));
    hosts.set(2, hostOf(8));
    expect(liveSurfaceProductWindows(hosts.values())).toEqual([7, 8]);
    hosts.delete(1);
    expect(liveSurfaceProductWindows(hosts.values())).toEqual([8]);
    hosts.set(3, hostOf(9, true));
    expect(liveSurfaceProductWindows(hosts.values())).toEqual([8]);
  });
});

// Compile-time structural assertion: the fake models only the WebContents API
// the host needs; no Electron runtime module is loaded by this suite.
void (null as unknown as WebContents);
void (null as unknown as MessagePortMain);
