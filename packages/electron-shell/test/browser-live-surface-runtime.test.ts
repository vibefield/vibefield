import { EventEmitter } from "node:events";
import type { LiveSurfaceDemandV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserControlTargetRegistry,
  type BrowserControlTargetWebContents,
} from "../src/main/live-surfaces/browser-control-target";
import {
  BrowserLiveSurfaceRuntime,
  type BrowserSurfaceNative,
  type BrowserSurfaceNativeKeyInput,
  type BrowserSurfaceNativeMouseInput,
  type BrowserSurfaceNativeWindow,
  type BrowserSurfaceNativeWindowOptions,
  type BrowserSurfacePaint,
} from "../src/main/live-surfaces/browser-producer";
import type { LiveSurfaceRuntimeAttachContext } from "../src/main/live-surfaces/runtime";

const SURFACE_ID = "browser_surface_0123456789";

class FakeContents extends EventEmitter implements BrowserControlTargetWebContents {
  destroyed = false;

  constructor(
    readonly id: number,
    readonly targetId: string,
  ) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getOrCreateDevToolsTargetId(): string {
    return this.targetId;
  }
}

class FakeBrowserWindow implements BrowserSurfaceNativeWindow {
  destroyed = false;
  readonly frameRates: number[] = [];
  readonly backingRasters: Array<{ width: number; height: number }> = [];
  readonly mouseInputs: BrowserSurfaceNativeMouseInput[] = [];
  readonly keyInputs: BrowserSurfaceNativeKeyInput[] = [];
  readonly textInputs: string[] = [];
  readonly loadedUrls: string[] = [];
  readonly startPainting = vi.fn();
  readonly stopPainting = vi.fn();
  readonly invalidate = vi.fn();
  readonly #events = new EventEmitter();

  constructor(
    readonly options: BrowserSurfaceNativeWindowOptions,
    readonly controlContents: FakeContents,
  ) {}

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controlContents.destroyed = true;
    this.controlContents.emit("destroyed");
    this.#events.emit("destroyed");
  }

  setFrameRate(fps: number): void {
    this.frameRates.push(fps);
  }

  async setBackingRaster(requested: { width: number; height: number }) {
    this.backingRasters.push({ ...requested });
    return requested;
  }

  async dispatchMouse(input: BrowserSurfaceNativeMouseInput): Promise<void> {
    this.mouseInputs.push(input);
  }

  async dispatchKey(input: BrowserSurfaceNativeKeyInput): Promise<void> {
    this.keyInputs.push(input);
  }

  async dispatchText(text: string): Promise<void> {
    this.textInputs.push(text);
  }

  onPaint(listener: (paint: BrowserSurfacePaint) => void): () => void {
    this.#events.on("paint", listener);
    return () => this.#events.off("paint", listener);
  }

  onRenderProcessGone(listener: (reason: string) => void): () => void {
    this.#events.on("gone", listener);
    return () => this.#events.off("gone", listener);
  }

  onDestroyed(listener: () => void): () => void {
    this.#events.on("destroyed", listener);
    return () => this.#events.off("destroyed", listener);
  }

  paint(paint: BrowserSurfacePaint): void {
    this.#events.emit("paint", paint);
  }

  crash(): void {
    this.#events.emit("gone", "crashed");
  }
}

class FakeNative implements BrowserSurfaceNative {
  readonly windows: FakeBrowserWindow[] = [];
  readonly targets = new Map<string, BrowserControlTargetWebContents>();
  now = 100n;

  createWindow(options: BrowserSurfaceNativeWindowOptions): BrowserSurfaceNativeWindow {
    const index = this.windows.length + 1;
    const contents = new FakeContents(100 + index, `target-${index}`);
    const window = new FakeBrowserWindow(options, contents);
    this.targets.set(contents.targetId, contents);
    this.windows.push(window);
    return window;
  }

  monotonicNowUs(): bigint {
    this.now += 1n;
    return this.now;
  }
}

function source() {
  return {
    kind: "browser" as const,
    initialUrl: "https://example.test/app",
    profile: { mode: "memory" as const, ref: "runtime-test" },
    logicalViewport: { width: 320, height: 180 },
    deviceScaleFactor: 1,
  };
}

function setup(options: Partial<ConstructorParameters<typeof BrowserLiveSurfaceRuntime>[0]> = {}) {
  const native = new FakeNative();
  const controlTargets = new BrowserControlTargetRegistry({
    resolveTarget: (targetId) => native.targets.get(targetId),
  });
  const runtime = new BrowserLiveSurfaceRuntime({
    surfaceId: SURFACE_ID,
    source: source(),
    native,
    controlTargets,
    ...options,
  });
  return { native, controlTargets, runtime };
}

function attach(runtime: BrowserLiveSurfaceRuntime, attachmentId = "attachment_browser_00000001") {
  const summaries: LiveSurfaceRuntimeSummaryV1[] = [];
  const cpuFrames: Array<Parameters<LiveSurfaceRuntimeAttachContext["publishCpuFrame"]>[0]> = [];
  const textureFrames: Array<Parameters<LiveSurfaceRuntimeAttachContext["offerTextureFrame"]>[0]> =
    [];
  const events: string[] = [];
  const context: LiveSurfaceRuntimeAttachContext = {
    attachmentId,
    rendererGeneration: 1,
    operations: ["view", "pointer", "keyboard"],
    publishSummary: (summary) => {
      summaries.push(summary);
      events.push(`summary:${summary.state}:${summary.transport ?? "unknown"}`);
    },
    publishCpuFrame: (frame) => {
      cpuFrames.push(frame);
      events.push("cpu-frame");
      return true;
    },
    offerTextureFrame: (frame) => {
      textureFrames.push(frame);
      events.push("texture-frame");
      frame.releaseSource("imported");
      frame.allReferencesReleased("released");
      return { kind: "accepted", transfer: Promise.resolve() };
    },
  };
  return {
    attachment: runtime.attach(context),
    summaries,
    cpuFrames,
    textureFrames,
    events,
  };
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
    interactive: mode === "live",
  };
}

function colorSpace(): Electron.ColorSpace {
  return { matrix: "rgb", primaries: "bt709", range: "full", transfer: "srgb" };
}

function sharedPaint(width = 640, height = 360) {
  const release = vi.fn();
  const paint: BrowserSurfacePaint = {
    texture: {
      release,
      textureInfo: {
        widgetType: "frame",
        pixelFormat: "bgra",
        codedSize: { width, height },
        colorSpace: colorSpace(),
        visibleRect: { x: 0, y: 0, width, height },
        contentRect: { x: 0, y: 0, width, height },
        timestamp: 42,
        metadata: {},
        handle: {},
      },
    },
    image: {
      getSize: () => ({ width, height }),
      toBitmap: () => new Uint8Array(width * height * 4),
    },
  };
  return { paint, release };
}

function cpuPaint(width = 64, height = 48) {
  const toBitmap = vi.fn((targetSize?: { width: number; height: number }) => {
    const output = targetSize ?? { width, height };
    return new Uint8Array(output.width * output.height * 4);
  });
  return {
    paint: {
      image: { getSize: () => ({ width, height }), toBitmap },
    } satisfies BrowserSurfacePaint,
    toBitmap,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BrowserLiveSurfaceRuntime", () => {
  it("observes shared transport, maps logical input, pauses, hibernates, and re-epochs", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
    const first = result.native.windows[0];
    expect(first?.options).toMatchObject({
      persistent: false,
      logicalViewport: { width: 320, height: 180 },
      initialBackingRaster: { width: 640, height: 360 },
      requestSharedTexture: true,
    });
    expect(result.runtime.summary).toMatchObject({ state: "starting", producerEpoch: 1 });
    await flush();
    expect(result.controlTargets.status(SURFACE_ID)).toMatchObject({
      bound: true,
      producerEpoch: 1,
      webContentsId: 101,
    });
    const shared = sharedPaint();
    first?.paint(shared.paint);
    expect(shared.release).toHaveBeenCalledOnce();
    expect(renderer.textureFrames).toHaveLength(1);
    expect(result.runtime.summary).toMatchObject({
      state: "live",
      producerEpoch: 1,
      transport: "shared-texture",
      geometry: {
        codedSize: { width: 640, height: 360 },
        logicalSize: { width: 320, height: 180 },
      },
    });
    const revision = result.runtime.summary.geometry?.revision ?? 0;
    await result.runtime.dispatchInput({
      kind: "mouse",
      geometryRevision: revision,
      type: "down",
      x: 160,
      y: 90,
      button: "left",
      clickCount: 1,
    });
    expect(first?.mouseInputs).toEqual([
      {
        type: "mousePressed",
        x: 160,
        y: 90,
        button: "left",
        clickCount: 1,
      },
    ]);
    expect(renderer.events.slice(-2)).toEqual(["summary:live:shared-texture", "texture-frame"]);
    await result.runtime.dispatchInput({
      kind: "key",
      geometryRevision: revision,
      type: "down",
      key: "Enter",
      code: "Enter",
      modifiers: { meta: true, shift: true },
      windowsVirtualKeyCode: 13,
    });
    expect(first?.keyInputs).toEqual([
      {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        modifiers: 12,
        windowsVirtualKeyCode: 13,
      },
    ]);
    await expect(
      result.runtime.dispatchInput({
        kind: "wheel",
        geometryRevision: revision - 1,
        x: 10,
        y: 10,
        deltaX: 0,
        deltaY: 20,
      }),
    ).rejects.toThrow(/stale geometry/);

    renderer.attachment.setDemand(demand(2, "paused"));
    expect(first?.stopPainting).toHaveBeenCalledOnce();
    expect(result.runtime.summary.state).toBe("paused");
    expect(result.controlTargets.status(SURFACE_ID).bound).toBe(true);
    renderer.attachment.setDemand(demand(3, "hibernated"));
    expect(first?.destroyed).toBe(true);
    expect(result.runtime.summary.state).toBe("hibernated");
    expect(result.controlTargets.status(SURFACE_ID).bound).toBe(false);

    renderer.attachment.setDemand(demand(4, "live"));
    expect(result.native.windows).toHaveLength(2);
    expect(result.runtime.summary).toMatchObject({ state: "starting", producerEpoch: 2 });
    result.native.windows[1]?.paint(sharedPaint(320, 180).paint);
    expect(result.runtime.summary).toMatchObject({ state: "live", producerEpoch: 2 });
    await flush();
    expect(result.native.windows[1]?.loadedUrls).toEqual([source().initialUrl]);
    result.runtime.dispose();
  });

  it("declares bounded CPU fallback only after repeated texture-less paints", async () => {
    vi.useFakeTimers();
    const result = setup({ requestSharedTexture: false, cpuFallbackPaints: 3 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 60, { width: 1920, height: 1080 }));
    const window = result.native.windows[0];
    const first = cpuPaint(1920, 1080);
    const second = cpuPaint(1920, 1080);
    const third = cpuPaint(1920, 1080);
    // Electron 43 has emitted a literal null for a missing shared texture in
    // native OSR; keep the producer boundary tolerant even if its d.ts regresses.
    window?.paint({ ...first.paint, texture: null });
    window?.paint(second.paint);
    expect(first.toBitmap).not.toHaveBeenCalled();
    expect(second.toBitmap).not.toHaveBeenCalled();
    expect(renderer.cpuFrames).toHaveLength(0);
    window?.paint(third.paint);
    expect(third.toBitmap).toHaveBeenCalledOnce();
    expect(renderer.cpuFrames).toHaveLength(1);
    expect(renderer.events.slice(-2)).toEqual(["summary:live:cpu-bgra", "cpu-frame"]);
    expect(third.toBitmap).toHaveBeenCalledWith(renderer.cpuFrames[0]?.metadata.geometry.codedSize);
    const emittedSize = renderer.cpuFrames[0]?.metadata.geometry.codedSize;
    expect((emittedSize?.width ?? 0) * (emittedSize?.height ?? 0)).toBeLessThanOrEqual(1280 * 720);
    expect(result.runtime.summary).toMatchObject({
      state: "live",
      transport: "cpu-bgra",
      error: { code: "transport-degraded" },
    });
    expect(window?.frameRates.at(-1)).toBe(10);
    await vi.advanceTimersByTimeAsync(300);
    const bounded = window?.backingRasters.at(-1);
    expect((bounded?.width ?? 0) * (bounded?.height ?? 0)).toBeLessThanOrEqual(1280 * 720);
    expect(result.runtime.stats).toMatchObject({
      cpuPaints: 3,
      cpuFramesOffered: 1,
      cpuFramesAccepted: 1,
    });

    window?.paint(sharedPaint(640, 360).paint);
    expect(result.runtime.summary.transport).toBe("shared-texture");
    expect(result.runtime.summary.error).toBeUndefined();
    result.runtime.dispose();
  });

  it("fans one producer texture to live attachments and releases the wrapper exactly once", () => {
    const result = setup();
    const firstRenderer = attach(result.runtime, "attachment_browser_00000001");
    const secondRenderer = attach(result.runtime, "attachment_browser_00000002");
    firstRenderer.attachment.setDemand(demand(1, "live"));
    secondRenderer.attachment.setDemand(demand(1, "live"));
    expect(result.native.windows).toHaveLength(1);
    const shared = sharedPaint();
    result.native.windows[0]?.paint(shared.paint);
    expect(firstRenderer.textureFrames).toHaveLength(1);
    expect(secondRenderer.textureFrames).toHaveLength(1);
    expect(shared.release).toHaveBeenCalledOnce();
    expect(result.runtime.stats).toMatchObject({
      sharedFramesOffered: 2,
      sharedFramesAccepted: 2,
      producerTextureReleases: 1,
      importedReferencesReleased: 2,
    });
    expect(result.runtime.supportSnapshot()).toMatchObject({
      v: 1,
      sourceKind: "browser",
      metrics: {
        framesObserved: 1,
        framesOffered: 2,
        framesAccepted: 2,
        framesDropped: 0,
        localReferencesReleased: 1,
        downstreamReferencesReleased: 2,
      },
    });
    firstRenderer.attachment.setDemand(demand(2, "hibernated"));
    expect(result.runtime.summary.state).toBe("live");
    secondRenderer.attachment.setDemand(demand(2, "hibernated"));
    expect(result.runtime.summary.state).toBe("hibernated");
    result.runtime.dispose();
  });

  it("fails a stalled producer within the bounded startup deadline", () => {
    vi.useFakeTimers();
    const result = setup({ startupTimeoutMs: 250, restartLimit: 0 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    vi.advanceTimersByTime(250);
    expect(result.runtime.summary).toMatchObject({
      state: "failed",
      error: { code: "frame-stalled" },
    });
    expect(result.native.windows[0]?.destroyed).toBe(true);
    expect(result.controlTargets.status(SURFACE_ID).bound).toBe(false);
    result.runtime.dispose();
  });

  it("retries a stalled startup within the bounded restart budget", async () => {
    vi.useFakeTimers();
    const result = setup({ startupTimeoutMs: 250, restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1);
    expect(result.native.windows).toHaveLength(2);
    expect(result.native.windows[0]?.destroyed).toBe(true);
    expect(result.runtime.summary).toMatchObject({ state: "starting", producerEpoch: 2 });
    expect(result.runtime.stats.producerRestarts).toBe(1);
    result.runtime.dispose();
  });

  it("retries a producer that crashes before its first usable frame", async () => {
    vi.useFakeTimers();
    const result = setup({ restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    result.native.windows[0]?.crash();
    expect(result.runtime.summary).toMatchObject({
      state: "failed",
      producerEpoch: 1,
      error: { code: "producer-crashed", recovery: "automatic" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(result.native.windows).toHaveLength(2);
    expect(result.runtime.summary).toMatchObject({ state: "starting", producerEpoch: 2 });
    result.runtime.dispose();
  });

  it("recovers one crashed live producer with a fresh epoch and exact target", async () => {
    vi.useFakeTimers();
    const result = setup({ restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    result.native.windows[0]?.paint(sharedPaint().paint);
    result.native.windows[0]?.crash();
    expect(result.runtime.summary).toMatchObject({
      state: "reconnecting",
      producerEpoch: 2,
      error: { code: "producer-crashed" },
    });
    expect(result.runtime.summary.transport).toBeUndefined();
    expect(result.runtime.summary.geometry).toBeUndefined();
    expect(result.controlTargets.status(SURFACE_ID).bound).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.native.windows).toHaveLength(2);
    expect(result.controlTargets.status(SURFACE_ID)).toMatchObject({
      bound: true,
      producerEpoch: 2,
      webContentsId: 102,
    });
    result.native.windows[1]?.paint(sharedPaint().paint);
    expect(result.runtime.summary).toMatchObject({
      state: "live",
      producerEpoch: 2,
      transport: "shared-texture",
    });
    expect(result.runtime.stats.producerRestarts).toBe(1);
    result.runtime.dispose();
  });

  it("recovers when the owned WebContents is destroyed directly", async () => {
    vi.useFakeTimers();
    const result = setup({ restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    const first = result.native.windows[0];
    first?.paint(sharedPaint().paint);
    first?.destroy();
    expect(result.runtime.summary).toMatchObject({
      state: "reconnecting",
      producerEpoch: 2,
      error: { code: "producer-crashed" },
    });
    expect(result.controlTargets.status(SURFACE_ID).bound).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.native.windows).toHaveLength(2);
    result.runtime.dispose();
  });

  it("resumes a reconnect that was suspended by non-live demand", async () => {
    vi.useFakeTimers();
    const result = setup({ restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    result.native.windows[0]?.paint(sharedPaint().paint);
    result.native.windows[0]?.crash();
    renderer.attachment.setDemand(demand(2, "paused"));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.native.windows).toHaveLength(1);
    expect(result.runtime.summary.state).toBe("reconnecting");

    renderer.attachment.setDemand(demand(3, "live"));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.native.windows).toHaveLength(2);
    expect(result.runtime.summary).toMatchObject({ state: "reconnecting", producerEpoch: 2 });
    result.runtime.dispose();
  });

  it("ignores stale demand and stabilizes only the latest backing-raster request", async () => {
    vi.useFakeTimers();
    const result = setup({ rasterStabilizationMs: 300 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(2, "live", 30, { width: 640, height: 360 }));
    result.native.windows[0]?.paint(sharedPaint().paint);
    renderer.attachment.setDemand(demand(1, "paused"));
    expect(result.runtime.summary.state).toBe("live");
    renderer.attachment.setDemand(demand(3, "live", 15, { width: 800, height: 450 }));
    renderer.attachment.setDemand(demand(4, "live", 15, { width: 960, height: 540 }));
    await vi.advanceTimersByTimeAsync(299);
    // One immediate startup configuration, no stabilized resize yet.
    expect(result.native.windows[0]?.backingRasters).toEqual([{ width: 640, height: 360 }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(result.native.windows[0]?.backingRasters.at(-1)).toEqual({ width: 960, height: 540 });
    expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 320, height: 180 });
    result.runtime.dispose();
  });

  it("cancels stabilized raster work when live demand pauses", async () => {
    vi.useFakeTimers();
    const result = setup({ rasterStabilizationMs: 300 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
    result.native.windows[0]?.paint(sharedPaint().paint);
    renderer.attachment.setDemand(demand(2, "live", 30, { width: 960, height: 540 }));
    renderer.attachment.setDemand(demand(3, "paused"));
    await vi.advanceTimersByTimeAsync(300);
    expect(result.native.windows[0]?.backingRasters).toEqual([{ width: 640, height: 360 }]);
    expect(result.native.windows[0]?.invalidate).not.toHaveBeenCalled();
    result.runtime.dispose();
  });
});
