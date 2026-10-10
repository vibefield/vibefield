import { EventEmitter } from "node:events";
import { join } from "node:path";
import type {
  LiveSurfaceBrowserEmulationV1,
  LiveSurfaceDemandV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSurfaceAuthority } from "../src/main/live-surfaces/authority";
import {
  BrowserControlTargetRegistry,
  type BrowserControlTargetWebContents,
} from "../src/main/live-surfaces/browser-control-target";
import {
  BrowserLiveSurfaceRuntime,
  type BrowserSurfaceAgent,
  type BrowserSurfaceIcon,
  type BrowserSurfaceNative,
  type BrowserSurfaceNativeEmulation,
  type BrowserSurfaceNativeKeyInput,
  type BrowserSurfaceNativeMouseInput,
  type BrowserSurfaceNativeTouchInput,
  type BrowserSurfaceNativeWindow,
  type BrowserSurfaceNativeWindowOptions,
  type BrowserSurfaceNavigationState,
  type BrowserSurfacePaint,
  type BrowserSurfaceRefusal,
  editingCommandsOf,
  engineAgentOf,
  faviconOf,
  loadFailureOf,
  virtualKeyCodeOf,
} from "../src/main/live-surfaces/browser-producer";
import { browserSurfaceProfileName } from "../src/main/live-surfaces/browser-security";
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
  readonly rasterViewports: Array<{ width: number; height: number }> = [];
  /** PT-4: each layout's density and whether it was a mobile one; what the page was told; its touches; its icon fetches. */
  readonly rasterDensities: number[] = [];
  readonly rasterMobile: boolean[] = [];
  readonly emulations: BrowserSurfaceNativeEmulation[] = [];
  readonly touchInputs: BrowserSurfaceNativeTouchInput[] = [];
  readonly iconFetches: Array<{ url: string; maxBytes: number }> = [];
  /** What a fetch of each icon answers (unset: nothing). */
  readonly icons = new Map<
    string,
    BrowserSurfaceIcon | null | Promise<BrowserSurfaceIcon | null>
  >();
  /** The order the window was told things in: "emulate", "raster", "load", "reload". */
  readonly order: string[] = [];
  readonly mouseInputs: BrowserSurfaceNativeMouseInput[] = [];
  readonly keyInputs: BrowserSurfaceNativeKeyInput[] = [];
  readonly textInputs: string[] = [];
  readonly compositions: Array<{ text: string; caret: number }> = [];
  readonly loadedUrls: string[] = [];
  readonly navigations: Array<"back" | "forward" | "reload" | "stop"> = [];
  readonly startPainting = vi.fn();
  readonly stopPainting = vi.fn();
  readonly invalidate = vi.fn();
  /** The page's sound: muted or not, and every call that set it. */
  muted = false;
  readonly mutes: boolean[] = [];
  readonly #events = new EventEmitter();

  constructor(
    readonly options: BrowserSurfaceNativeWindowOptions,
    readonly controlContents: FakeContents,
  ) {}

  /** PT-5a: the engine's net error the next loads fail with (unset: they load). */
  failLoad: number | undefined;

  // a failing load as Electron says it (probed): the failure told with the ASKED address, then the promise rejects
  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
    this.order.push("load");
    if (this.failLoad === undefined) return;
    this.emitNavigationState({
      url,
      title: url.replace(/^https?:\/\//, ""),
      loading: false,
      canGoBack: false,
      canGoForward: false,
      failure: this.failLoad,
    });
    throw new Error(`ERR (${this.failLoad}) loading '${url}'`);
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

  setAudioMuted(muted: boolean): void {
    this.muted = muted;
    this.mutes.push(muted);
  }

  async setBackingRaster(
    requested: { width: number; height: number },
    logicalViewport: { width: number; height: number },
    deviceScaleFactor: number,
    mobile = false,
  ) {
    this.backingRasters.push({ ...requested });
    this.rasterViewports.push({ ...logicalViewport });
    this.rasterDensities.push(deviceScaleFactor);
    this.rasterMobile.push(mobile);
    this.order.push("raster");
    return requested;
  }

  async setEmulation(emulation: BrowserSurfaceNativeEmulation): Promise<void> {
    this.emulations.push(emulation);
    this.order.push("emulate");
  }

  async dispatchTouch(input: BrowserSurfaceNativeTouchInput): Promise<void> {
    this.touchInputs.push(input);
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

  async dispatchCompose(text: string, caret: number): Promise<void> {
    this.compositions.push({ text, caret });
  }

  navigate(action: "back" | "forward" | "reload" | "stop"): void {
    this.navigations.push(action);
    if (action === "reload") this.order.push("reload");
  }

  onFavicon(listener: (urls: readonly string[]) => void): () => void {
    this.#events.on("favicon", listener);
    return () => this.#events.off("favicon", listener);
  }

  onRefused(listener: (what: BrowserSurfaceRefusal, url?: string) => void): () => void {
    this.#events.on("refused", listener);
    return () => this.#events.off("refused", listener);
  }

  /** PT-5a: the page asked for what it may not have (its guards answered it; the window tells the producer). */
  refuse(what: BrowserSurfaceRefusal, url?: string): void {
    this.#events.emit("refused", what, url);
  }

  /** The page named its icons (Electron's `page-favicon-updated` — said only when they differ from the page before's). */
  favicons(urls: readonly string[]): void {
    this.#events.emit("favicon", urls);
  }

  async fetchIcon(url: string, maxBytes: number): Promise<BrowserSurfaceIcon | null> {
    this.iconFetches.push({ url, maxBytes });
    return (await this.icons.get(url)) ?? null;
  }

  onNavigationState(listener: (state: BrowserSurfaceNavigationState) => void): () => void {
    this.#events.on("navigation", listener);
    return () => this.#events.off("navigation", listener);
  }

  emitNavigationState(state: BrowserSurfaceNavigationState): void {
    this.#events.emit("navigation", state);
  }

  onCursor(listener: (cursor: string) => void): () => void {
    this.#events.on("cursor", listener);
    return () => this.#events.off("cursor", listener);
  }

  /** The page's cursor changed (Electron's `cursor-changed` type). */
  cursorTo(type: string): void {
    this.#events.emit("cursor", type);
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

  onUnresponsive(listener: (unresponsive: boolean) => void): () => void {
    this.#events.on("unresponsive", listener);
    return () => this.#events.off("unresponsive", listener);
  }

  /** PT-5a: the page stopped answering (`true`), or answers again. */
  hang(unresponsive: boolean): void {
    this.#events.emit("unresponsive", unresponsive);
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

  engineAgent(): BrowserSurfaceAgent {
    return ENGINE;
  }
}

/** The engine's own agent as the fake host has it: Chromium 150 on an Apple-silicon Mac. */
const ENGINE = engineAgentOf({
  chrome: "150.0.7871.114",
  platform: "darwin",
  arch: "arm64",
  systemVersion: "26.5.2",
});

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const PHONE: LiveSurfaceBrowserEmulationV1 = {
  deviceScaleFactor: 3,
  mobile: true,
  touchPoints: 5,
  agent: {
    userAgent: IPHONE_UA,
    navigatorPlatform: "iPhone",
    hints: {
      platform: "iOS",
      platformVersion: "26.0",
      architecture: "",
      model: "iPhone",
      mobile: true,
    },
  },
  colorScheme: "dark",
};
const LAPTOP: LiveSurfaceBrowserEmulationV1 = {
  deviceScaleFactor: 2,
  mobile: false,
  touchPoints: 0,
  colorScheme: "light",
};

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
  logicalViewport?: { width: number; height: number },
): LiveSurfaceDemandV1 {
  return {
    revision,
    mode,
    targetFps,
    ...(targetRasterSize === undefined ? {} : { targetRasterSize }),
    ...(logicalViewport === undefined ? {} : { logicalViewport }),
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
  it("measures the full paint callback without letting the observer affect delivery", async () => {
    const durations: bigint[] = [];
    const result = setup({
      onPaintCallbackDurationUs: (durationUs) => {
        durations.push(durationUs);
        throw new Error("diagnostic observer fault");
      },
    });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    result.native.windows[0]?.paint(sharedPaint(320, 180).paint);

    expect(durations).toEqual([2n]);
    expect(renderer.textureFrames).toHaveLength(1);
    expect(result.runtime.summary.state).toBe("live");
  });

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

  it("a renderer that LEAVES pauses the page and keeps it — one re-attaching within the grace finds the SAME page; none back, hibernated after it (PT-2)", async () => {
    // a window reload: the document's attachment goes and the next one's comes; the page (its memory, its WebContents) must be
    // there for it — main's custody re-binds the surface by its reuse key, and the runtime must not have destroyed the page
    vi.useFakeTimers();
    try {
      const result = setup({ detachedHibernateMs: 1000 });
      const first = attach(result.runtime, "attachment_browser_00000001");
      first.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
      await vi.advanceTimersByTimeAsync(0);
      result.native.windows[0]?.paint(sharedPaint(320, 180).paint);
      expect(result.runtime.summary.state).toBe("live");
      first.attachment.dispose();
      expect(result.runtime.summary.state).toBe("paused");
      expect(result.native.windows[0]?.destroyed).toBe(false);
      // the next document attaches inside the grace: the SAME window, live again, never loaded twice
      await vi.advanceTimersByTimeAsync(500);
      const second = attach(result.runtime, "attachment_browser_00000002");
      second.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
      expect(result.native.windows).toHaveLength(1);
      expect(result.runtime.summary.state).toBe("live");
      await vi.advanceTimersByTimeAsync(2000);
      expect(result.native.windows[0]?.destroyed).toBe(false);
      expect(result.native.windows[0]?.loadedUrls).toEqual([source().initialUrl]);
      // the last renderer leaves and none comes back: hibernated once the grace lapses, not before
      second.attachment.dispose();
      await vi.advanceTimersByTimeAsync(999);
      expect(result.native.windows[0]?.destroyed).toBe(false);
      expect(result.runtime.summary.state).toBe("paused");
      await vi.advanceTimersByTimeAsync(1);
      expect(result.native.windows[0]?.destroyed).toBe(true);
      expect(result.runtime.summary.state).toBe("hibernated");
      result.runtime.dispose();
      // a runtime with no grace (a lab's): a detach hibernates at once, as it always did
      const lab = setup({ detachedHibernateMs: 0 });
      const once = attach(lab.runtime);
      once.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
      await vi.advanceTimersByTimeAsync(0);
      lab.native.windows[0]?.paint(sharedPaint(320, 180).paint);
      once.attachment.dispose();
      expect(lab.native.windows[0]?.destroyed).toBe(true);
      expect(lab.runtime.summary.state).toBe("hibernated");
      lab.runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a page is HEARD only while it is asked for live (PT-5a ruling 4): an attached pause is silent — a pause stops its painting, not its sound — a page whose renderer LEFT is muted for its grace, and one seen live again is heard again", async () => {
    // Electron 43 (PT-2's probe): an offscreen page under `stopPainting()` paints nothing and its audio plays on —
    // `isCurrentlyAudible()` true, its AudioContext's clock running. The grace keeps a page no renderer shows: silent.
    vi.useFakeTimers();
    try {
      const result = setup({ detachedHibernateMs: 1000 });
      const first = attach(result.runtime, "attachment_browser_00000001");
      first.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
      await vi.advanceTimersByTimeAsync(0);
      const window = result.native.windows[0];
      window?.paint(sharedPaint(320, 180).paint);
      expect(window?.mutes).toEqual([]);
      // an attached pause (a pane off the view, a parked desk, the pool's idle demand after a delete): painting stops AND
      // the page goes silent, at once
      first.attachment.setDemand(demand(2, "paused"));
      expect(result.runtime.summary.state).toBe("paused");
      expect(window?.muted).toBe(true);
      // seen live again: heard again
      first.attachment.setDemand(demand(3, "live", 30, { width: 640, height: 360 }));
      expect(result.runtime.summary.state).toBe("live");
      expect(window?.muted).toBe(false);
      // the same ask again says nothing more to the page's sound
      first.attachment.setDemand(demand(4, "live", 60, { width: 640, height: 360 }));
      expect(window?.mutes).toEqual([true, false]);
      // the renderer leaves: paused AND muted while the grace keeps it
      first.attachment.dispose();
      expect(result.runtime.summary.state).toBe("paused");
      expect(window?.muted).toBe(true);
      // the next document attaches inside the grace: the same page, live, its sound back
      await vi.advanceTimersByTimeAsync(500);
      const second = attach(result.runtime, "attachment_browser_00000002");
      second.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
      expect(result.native.windows).toHaveLength(1);
      expect(result.runtime.summary.state).toBe("live");
      expect(window?.muted).toBe(false);
      expect(window?.mutes).toEqual([true, false, true, false]);
      // none back: muted, then hibernated once the grace lapses; the page made again for the next renderer is born with its
      // sound, and is muted in its own grace
      second.attachment.dispose();
      expect(window?.muted).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(result.runtime.summary.state).toBe("hibernated");
      const third = attach(result.runtime, "attachment_browser_00000003");
      third.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
      await vi.advanceTimersByTimeAsync(0);
      const again = result.native.windows[1];
      expect(again?.muted).toBe(false);
      again?.paint(sharedPaint(320, 180).paint);
      third.attachment.dispose();
      expect(again?.muted).toBe(true);
      result.runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the grace holds only while the WINDOW lives: custody's window close and the app's quit destroy a page in its grace AT ONCE, as an explicit hibernated demand does — no timer outlives it (PT-2)", async () => {
    vi.useFakeTimers();
    try {
      const native = new FakeNative();
      const controlTargets = new BrowserControlTargetRegistry({
        resolveTarget: (targetId) => native.targets.get(targetId),
      });
      const runtimes: BrowserLiveSurfaceRuntime[] = [];
      const windows = new Map<string, { webContentsId: number }>();
      let tickets = 0;
      const custody = new LiveSurfaceAuthority({
        resolveWindow: (identity) => windows.get(identity.incarnation) ?? null,
        hostFor: () =>
          ({
            issue: () => {
              tickets += 1;
              return { v: 1, token: `ticket-${tickets}-${"x".repeat(30)}` };
            },
          }) as never,
        factories: {
          browser: (surfaceId, browserSource) => {
            const runtime = new BrowserLiveSurfaceRuntime({
              surfaceId,
              source: browserSource,
              native,
              controlTargets,
              detachedHibernateMs: 60_000,
            });
            runtimes.push(runtime);
            return runtime;
          },
          sckWindow: () => {
            throw new Error("no capture here");
          },
          iosSimulator: () => {
            throw new Error("no simulator here");
          },
        },
        enumeration: { sckWindows: async () => [], bootedSimulators: async () => [] },
      });
      /** A page minted by window `webContentsId`'s document, shown, then its renderer gone: paused, in its grace. */
      const inGrace = async (webContentsId: number, n: number) => {
        const document = { participantId: `window-${n}`, incarnation: `window-${n}:document-1` };
        windows.set(document.incarnation, { webContentsId });
        custody.mint({
          rendererParticipant: document,
          source: source(),
          reuseKey: `desk:page-${n}`,
        });
        const runtime = runtimes[runtimes.length - 1] as BrowserLiveSurfaceRuntime;
        const renderer = attach(runtime, `attachment_browser_0000000${n}`);
        renderer.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
        await vi.advanceTimersByTimeAsync(0);
        const window = native.windows[native.windows.length - 1];
        window?.paint(sharedPaint(320, 180).paint);
        renderer.attachment.dispose();
        expect(runtime.summary.state).toBe("paused");
        expect(window?.destroyed).toBe(false);
        return { runtime, window };
      };
      // the window closes (its `destroyed` hook: `releaseAllForWebContents`): the page goes with it, not 60 s later
      const closed = await inGrace(7, 1);
      custody.releaseAllForWebContents(7);
      expect(closed.window?.destroyed).toBe(true);
      expect(closed.runtime.summary.state).toBe("closed");
      // the app quits (`disposeShellState` → custody's `dispose`): the same
      const quit = await inGrace(8, 2);
      custody.dispose();
      expect(quit.window?.destroyed).toBe(true);
      expect(quit.runtime.summary.state).toBe("closed");
      expect(custody.state()).toEqual({ runtimes: 0, owners: 0 });
      // no grace's timer outlives the runtimes it was for
      expect(vi.getTimerCount()).toBe(0);
      // an explicit `hibernated` demand from a renderer that comes back: at once, the grace or not
      const asked = setup({ detachedHibernateMs: 60_000 });
      const one = attach(asked.runtime, "attachment_browser_00000001");
      one.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
      await vi.advanceTimersByTimeAsync(0);
      asked.native.windows[0]?.paint(sharedPaint(320, 180).paint);
      one.attachment.dispose();
      expect(asked.native.windows[0]?.destroyed).toBe(false);
      const two = attach(asked.runtime, "attachment_browser_00000002");
      two.attachment.setDemand(demand(1, "hibernated"));
      expect(asked.native.windows[0]?.destroyed).toBe(true);
      expect(asked.runtime.summary.state).toBe("hibernated");
      asked.runtime.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the DT-D6 lane: wire input, chrome navigation, and committed nav truth", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
    const window = result.native.windows[0];
    window?.paint(sharedPaint().paint);
    await flush();
    const revision = result.runtime.summary.geometry?.revision ?? 0;

    // Wire events arrive in CSS logical coordinates and pass through UNSCALED
    // (LSF §10.2 — the double-scaling class): what the wire said is what CDP
    // receives, and the engine's own validation stays the authority.
    renderer.attachment.dispatchInput?.(
      { kind: "pointer", action: "down", x: 160, y: 90, button: "left", clickCount: 1 },
      revision,
    );
    renderer.attachment.dispatchInput?.(
      { kind: "wheel", x: 10, y: 12, deltaX: 0, deltaY: 40 },
      revision,
    );
    renderer.attachment.dispatchInput?.(
      {
        kind: "key",
        action: "down",
        key: "a",
        code: "KeyA",
        modifiers: { alt: false, ctrl: false, meta: true, shift: false },
      },
      revision,
    );
    renderer.attachment.dispatchInput?.({ kind: "text", text: "hello" }, revision);
    await flush();
    expect(window?.mouseInputs).toEqual([
      { type: "mousePressed", x: 160, y: 90, button: "left", clickCount: 1 },
      { type: "mouseWheel", x: 10, y: 12, deltaX: 0, deltaY: 40 },
    ]);
    // PT-3: a letter carries its virtual code (a page's own chords act on it), and on the Mac ⌘A its editing command
    const selectAll = editingCommandsOf(
      { type: "down", code: "KeyA", modifiers: { meta: true } },
      process.platform,
    );
    expect(window?.keyInputs).toEqual([
      {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: 4,
        windowsVirtualKeyCode: 65,
        ...(selectAll === undefined ? {} : { commands: selectAll }),
      },
    ]);
    expect(window?.textInputs).toEqual(["hello"]);

    // A stale geometry revision is dropped and counted, never re-mapped.
    renderer.attachment.dispatchInput?.(
      { kind: "pointer", action: "move", x: 1, y: 1 },
      revision - 1,
    );
    await flush();
    expect(window?.mouseInputs).toHaveLength(2);
    expect(result.runtime.stats.inputRequests).toBe(5);
    expect(result.runtime.stats.inputDropped).toBe(1);

    // Navigation: `go` re-validates the top-level scheme policy; history and
    // loading actions ride the native without any URL at all.
    renderer.attachment.navigate?.({ action: "go", url: "https://example.test/next" });
    renderer.attachment.navigate?.({ action: "back" });
    renderer.attachment.navigate?.({ action: "go", url: "file:///etc/passwd" });
    await flush();
    expect(window?.loadedUrls).toContain("https://example.test/next");
    expect(window?.loadedUrls.some((url) => url.startsWith("file:"))).toBe(false);
    expect(window?.navigations).toEqual(["back"]);
    expect(result.runtime.stats.navigationRequests).toBe(3);
    expect(result.runtime.stats.navigationDropped).toBe(1);

    // Committed navigation truth rides summaries, clamped to the wire bounds
    // so a page's 9KB URL degrades to truncation, never to a schema fault.
    window?.emitNavigationState({
      url: `https://example.test/${"q".repeat(9_000)}`,
      title: `title ${"t".repeat(600)}`,
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
    const browser = result.runtime.summary.browser;
    expect(browser?.url).toHaveLength(8_192);
    expect(browser?.title).toHaveLength(512);
    expect(browser).toMatchObject({ loading: false, canGoBack: true, canGoForward: false });
    expect(renderer.summaries.at(-1)?.browser?.canGoBack).toBe(true);

    result.runtime.dispose();
  });

  it("PT-3: carries an IME composition, the buttons a drag holds, the wheel in the page's CSS px, ⏎'s char, and the page's cursor", async () => {
    const result = setup({ source: { ...source(), deviceScaleFactor: 2 } });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
    const window = result.native.windows[0];
    window?.paint(sharedPaint().paint);
    await flush();
    const revision = result.runtime.summary.geometry?.revision ?? 0;
    // a composition as it runs, then one whose caret ran past its text: held to its end (CDP refuses it past)
    renderer.attachment.dispatchInput?.({ kind: "compose", text: "", caret: 0 }, revision);
    renderer.attachment.dispatchInput?.({ kind: "compose", text: "にほ", caret: 2 }, revision);
    renderer.attachment.dispatchInput?.({ kind: "compose", text: "ん", caret: 9 }, revision);
    // a move with the primary held is a drag; a wheel of 40 of the page's CSS px stays 40 at its density 2 — CDP's wheel
    // deltas are CSS px (the PT-3 smoke's WHEEL row: multiplied by the density, the page scrolled twice the finger's travel)
    renderer.attachment.dispatchInput?.(
      { kind: "pointer", action: "move", x: 20, y: 30, buttons: 1 },
      revision,
    );
    renderer.attachment.dispatchInput?.(
      { kind: "wheel", x: 10, y: 12, deltaX: 3, deltaY: 40 },
      revision,
    );
    await flush();
    expect(window?.compositions).toEqual([
      { text: "", caret: 0 },
      { text: "にほ", caret: 2 },
      { text: "ん", caret: 1 },
    ]);
    expect(window?.mouseInputs).toEqual([
      { type: "mouseMoved", x: 20, y: 30, button: "none", buttons: 1 },
      { type: "mouseWheel", x: 10, y: 12, deltaX: 3, deltaY: 40 },
    ]);
    // a key's virtual code: a special key's by its name, a letter's and a digit's by its physical key — never another's
    expect(
      [
        ["Backspace", "Backspace"],
        ["a", "KeyA"],
        ["Z", "KeyZ"],
        ["7", "Digit7"],
        ["é", "KeyE"],
        ["!", "Digit1"],
        ["F5", "F5"],
        ["constructor", "Unidentified"],
      ].map(([k, c]) => virtualKeyCodeOf(k ?? "", c ?? "")),
    ).toEqual([8, 65, 90, 55, 69, 49, undefined, undefined]);
    // the Mac's editing chords ride with their command (no menu reaches an offscreen page); a chord with ⌃ or ⌥, an up, a key
    // with no command, and any chord off the Mac carry none
    const mac = (
      code: string,
      modifiers: { meta?: true; shift?: true; control?: true; alt?: true },
      type: "down" | "up" = "down",
    ) => editingCommandsOf({ type, code, modifiers }, "darwin");
    expect([
      mac("KeyA", { meta: true }),
      mac("KeyC", { meta: true }),
      mac("KeyV", { meta: true }),
      mac("KeyX", { meta: true }),
      mac("KeyZ", { meta: true }),
      mac("KeyZ", { meta: true, shift: true }),
    ]).toEqual([["selectAll"], ["copy"], ["paste"], ["cut"], ["undo"], ["redo"]]);
    expect([
      mac("KeyA", { meta: true, shift: true }),
      mac("KeyA", { meta: true, control: true }),
      mac("KeyA", { meta: true, alt: true }),
      mac("KeyA", { meta: true }, "up"),
      mac("KeyQ", { meta: true }),
      mac("KeyA", { control: true }),
      editingCommandsOf({ type: "down", code: "KeyA", modifiers: { meta: true } }, "linux"),
      editingCommandsOf({ type: "down", code: "KeyV", modifiers: { control: true } }, "win32"),
    ]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // ⏎ down makes its char (a form's submission, a textarea's newline — the page's keypress), alone or with ⇧; its up, and
    // ⌘⏎, none; another key never
    const key = (key: string, action: "down" | "up", mods: { shift?: true; meta?: true } = {}) =>
      renderer.attachment.dispatchInput?.(
        {
          kind: "key",
          action,
          key,
          code: key === "a" ? "KeyA" : key,
          modifiers: { alt: false, ctrl: false, meta: false, shift: false, ...mods },
        },
        revision,
      );
    key("Enter", "down");
    key("Enter", "up");
    key("Enter", "down", { shift: true });
    key("Enter", "down", { meta: true });
    key("a", "down");
    await flush();
    expect(
      window?.keyInputs.map((k) => [k.type, k.key, k.text ?? null, k.unmodifiedText ?? null]),
    ).toEqual([
      ["keyDown", "Enter", "\r", "\r"],
      ["keyUp", "Enter", null, null],
      ["keyDown", "Enter", "\r", "\r"],
      ["keyDown", "Enter", null, null],
      ["keyDown", "a", null, null],
    ]);
    // the page's cursor: said with the browser state, once it has one; Electron's names as CSS says them — its `hand` is a link's
    // (CSS `pointer`), its `pointer` Chromium's ARROW (CSS `default`)
    window?.cursorTo("hand");
    expect(result.runtime.summary.browser).toBeUndefined();
    window?.emitNavigationState({
      url: "https://example.test/app",
      title: "App",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
    expect(result.runtime.summary.browser?.cursor).toBe("pointer");
    const published = renderer.summaries.length;
    window?.cursorTo("hand");
    expect(renderer.summaries).toHaveLength(published);
    window?.cursorTo("text");
    expect(result.runtime.summary.browser?.cursor).toBe("text");
    expect(renderer.summaries.length).toBeGreaterThan(published);
    const said = (type: string): string | undefined => {
      window?.cursorTo(type);
      return result.runtime.summary.browser?.cursor;
    };
    expect(said("pointer")).toBe("default");
    expect(said("grab")).toBe("grab");
    expect(said("nodrop")).toBe("no-drop");
    expect(said("ne-panning")).toBe("all-scroll");
    expect(said("m-panning-vertical")).toBe("all-scroll");
    expect(said("drag-drop-link")).toBe("alias");
    expect(said("ns-no-resize")).toBe("ns-resize");
    expect(said("custom")).toBe("default");
    // a name CSS does not know is never passed on (where it is set it would be ignored, the last cursor left up)
    expect(said("text")).toBe("text");
    expect(said("sparkle")).toBe("default");
    expect(said("text")).toBe("text");
    expect(said("constructor")).toBe("default");
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

  // DT-3f — the logical viewport follows demand: the page LAYS OUT at the
  // holder's size, geometry names that layout, and a restarted producer is
  // born at it. The 2026-08-29 live finding: without this lane every card got
  // a permanent 1024×768 layout whatever its own size.
  it("is born at the demanded viewport and re-lays-out when demand moves it", async () => {
    vi.useFakeTimers();
    const result = setup({ rasterStabilizationMs: 300 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(
      demand(1, "live", 30, { width: 800, height: 500 }, { width: 800, height: 500 }),
    );
    const window = result.native.windows[0];
    expect(window?.options.logicalViewport).toEqual({ width: 800, height: 500 });
    expect(window?.rasterViewports).toEqual([{ width: 800, height: 500 }]);
    window?.paint(sharedPaint(800, 500).paint);
    expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 800, height: 500 });
    const firstRevision = result.runtime.summary.geometry?.revision;

    renderer.attachment.setDemand(
      demand(2, "live", 30, { width: 600, height: 420 }, { width: 600.4, height: 419.6 }),
    );
    await vi.advanceTimersByTimeAsync(300);
    // Fractional CSS sizes actuate at the same rounding the native adapter
    // applies, so geometry and emulation can never disagree by a pixel.
    expect(window?.rasterViewports.at(-1)).toEqual({ width: 600, height: 420 });
    window?.paint(sharedPaint(600, 420).paint);
    const geometry = result.runtime.summary.geometry;
    expect(geometry?.logicalSize).toEqual({ width: 600, height: 420 });
    expect(geometry?.revision).not.toBe(firstRevision);
    result.runtime.dispose();
  });

  it("frames painted before a viewport actuation keep naming the old layout", async () => {
    vi.useFakeTimers();
    const result = setup({ rasterStabilizationMs: 300 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    const window = result.native.windows[0];
    window?.paint(sharedPaint(320, 180).paint);
    expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 320, height: 180 });

    renderer.attachment.setDemand(
      demand(2, "live", 30, { width: 900, height: 532 }, { width: 900, height: 532 }),
    );
    // The stabilization window has not elapsed: a frame that arrives now was
    // painted at the OLD layout, and its geometry must say so.
    window?.paint(sharedPaint(320, 180).paint);
    expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 320, height: 180 });
    await vi.advanceTimersByTimeAsync(300);
    window?.paint(sharedPaint(900, 532).paint);
    expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 900, height: 532 });
    result.runtime.dispose();
  });

  it("reconnects a crashed producer at the demanded viewport, not the source's", async () => {
    vi.useFakeTimers();
    const result = setup({ restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(
      demand(1, "live", 30, { width: 900, height: 532 }, { width: 900, height: 532 }),
    );
    result.native.windows[0]?.paint(sharedPaint(900, 532).paint);
    result.native.windows[0]?.crash();
    await vi.advanceTimersByTimeAsync(0);
    const reconnected = result.native.windows[1];
    expect(reconnected?.options.logicalViewport).toEqual({ width: 900, height: 532 });
    reconnected?.paint(sharedPaint(900, 532).paint);
    expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 900, height: 532 });
    result.runtime.dispose();
  });

  it("aggregates the largest-area viewport whole across attachments", async () => {
    vi.useFakeTimers();
    const result = setup({ rasterStabilizationMs: 300 });
    const first = attach(result.runtime, "attachment_browser_00000001");
    const second = attach(result.runtime, "attachment_browser_00000002");
    first.attachment.setDemand(
      demand(1, "live", 30, { width: 640, height: 360 }, { width: 640, height: 360 }),
    );
    result.native.windows[0]?.paint(sharedPaint().paint);
    // A taller-but-smaller viewport must not lend its height to the winner.
    second.attachment.setDemand(
      demand(1, "live", 30, { width: 200, height: 900 }, { width: 200, height: 900 }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(result.native.windows[0]?.rasterViewports.at(-1)).toEqual({ width: 640, height: 360 });
    result.runtime.dispose();
  });

  // ── PT-4: the page as a device sees it ────────────────────────────────────────────────────────────────────────────
  const NAV = {
    url: "https://example.test/app",
    title: "App",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  const phoneSource = () => ({
    ...source(),
    logicalViewport: { width: 402, height: 874 },
    deviceScaleFactor: 3,
    emulation: PHONE,
  });

  it("PT-4: the engine's own agent is its Chromium by name and BUNDLED version on the host's platform — never Electron's string, never a number written down", () => {
    expect(ENGINE).toEqual({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      navigatorPlatform: "MacIntel",
      metadata: {
        brands: [
          { brand: "Chromium", version: "150" },
          { brand: "Not?A_Brand", version: "99" },
        ],
        fullVersionList: [
          { brand: "Chromium", version: "150.0.7871.114" },
          { brand: "Not?A_Brand", version: "99.0.0.0" },
        ],
        platform: "macOS",
        platformVersion: "26.5.2",
        architecture: "arm",
        model: "",
        mobile: false,
      },
    });
    // another engine's version is another agent's; another platform's its own tokens
    const win = engineAgentOf({
      chrome: "151.0.1.2",
      platform: "win32",
      arch: "x64",
      systemVersion: "10.0.26100",
    });
    expect(win.userAgent).toBe(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    );
    expect([win.navigatorPlatform, win.metadata.platform, win.metadata.architecture]).toEqual([
      "Win32",
      "Windows",
      "x86",
    ]);
    expect(win.metadata.brands[0]).toEqual({ brand: "Chromium", version: "151" });
    const linux = engineAgentOf({
      chrome: "150.0.0.1",
      platform: "linux",
      arch: "arm64",
      systemVersion: "6.8",
    });
    expect([linux.navigatorPlatform, linux.metadata.platform]).toEqual(["Linux x86_64", "Linux"]);
    expect(
      engineAgentOf({ chrome: "150.0.0.1", platform: "sunos", arch: "x64", systemVersion: "" })
        .userAgent,
    ).toContain("X11; Linux x86_64");
    expect(ENGINE.userAgent).not.toMatch(/Electron|VibeField/iu);
  });

  it("PT-4: a page is BORN on its device — told its agent with its hints, touch and its scheme before it is laid out and loads, mobile at its density; a source that names none is told nothing", async () => {
    const result = setup({ source: phoneSource() });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    await flush();
    const window = result.native.windows[0];
    expect(window?.options.deviceScaleFactor).toBe(3);
    expect(window?.emulations).toEqual([
      {
        userAgent: IPHONE_UA,
        navigatorPlatform: "iPhone",
        // an agent that is not the engine's ships no brands of it
        metadata: {
          brands: [],
          fullVersionList: [],
          platform: "iOS",
          platformVersion: "26.0",
          architecture: "",
          model: "iPhone",
          mobile: true,
        },
        touchPoints: 5,
        colorScheme: "dark",
      },
    ]);
    expect(window?.order).toEqual(["emulate", "raster", "load"]);
    expect(window?.rasterDensities).toEqual([3]);
    expect(window?.rasterMobile).toEqual([true]);
    expect(window?.backingRasters).toEqual([{ width: 1206, height: 2622 }]);
    result.runtime.dispose();

    // a device with no agent of its own: the ENGINE's, with its hints — no touch, the scheme said
    const laptop = setup({ source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP } });
    attach(laptop.runtime).attachment.setDemand(demand(1, "live"));
    await flush();
    await flush();
    expect(laptop.native.windows[0]?.emulations).toEqual([
      { ...ENGINE, touchPoints: 0, colorScheme: "light" },
    ]);
    expect(laptop.native.windows[0]?.rasterMobile).toEqual([false]);
    laptop.runtime.dispose();

    // a source that names no device (every one before PT-4): told nothing, laid out a desktop's
    const plain = setup();
    attach(plain.runtime).attachment.setDemand(demand(1, "live"));
    await flush();
    expect(plain.native.windows[0]?.emulations).toEqual([]);
    expect(plain.native.windows[0]?.order).toEqual(["raster", "load"]);
    expect(plain.native.windows[0]?.rasterMobile).toEqual([false]);
    plain.runtime.dispose();
  });

  it("PT-4: the device SWITCH under a running page — told at once, laid out again, and RELOADED ONCE when what the page is told of its device moved; a scheme or a density alone is told live; the same again is nothing", async () => {
    const result = setup({ source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP } });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, undefined, { width: 320, height: 180 }));
    await flush();
    await flush();
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    window.paint(sharedPaint().paint);
    // the page has loaded: its navigation truth is known
    window.emitNavigationState(NAV);
    window.order.length = 0;

    // the same device again: nothing
    await result.runtime.navigate({ action: "emulate", emulation: LAPTOP });
    await flush();
    expect(window.order).toEqual([]);
    expect(result.runtime.stats.emulations).toBe(0);

    // a phone: told, laid out mobile at the phone's density, reloaded once
    await result.runtime.navigate({ action: "emulate", emulation: PHONE });
    await flush();
    await flush();
    expect(window.order).toEqual(["emulate", "raster", "reload"]);
    expect(window.emulations.at(-1)).toMatchObject({
      userAgent: IPHONE_UA,
      touchPoints: 5,
      colorScheme: "dark",
    });
    expect([window.rasterDensities.at(-1), window.rasterMobile.at(-1)]).toEqual([3, true]);
    expect(window.backingRasters.at(-1)).toEqual({ width: 960, height: 540 });
    expect(window.navigations).toEqual(["reload"]);
    expect(result.runtime.stats).toMatchObject({ emulations: 1, emulationReloads: 1 });

    // the phone's SCHEME alone: told live — no reload, a frame asked
    window.order.length = 0;
    const invalidated = window.invalidate.mock.calls.length;
    await result.runtime.navigate({
      action: "emulate",
      emulation: { ...PHONE, colorScheme: "light" },
    });
    await flush();
    await flush();
    expect(window.order).toEqual(["emulate", "raster"]);
    expect(window.emulations.at(-1)?.colorScheme).toBe("light");
    expect(window.navigations).toEqual(["reload"]);
    expect(window.invalidate.mock.calls.length).toBe(invalidated + 1);
    // its DENSITY alone: told live too
    await result.runtime.navigate({
      action: "emulate",
      emulation: { ...PHONE, colorScheme: "light", deviceScaleFactor: 2 },
    });
    await flush();
    await flush();
    expect(window.rasterDensities.at(-1)).toBe(2);
    expect(window.navigations).toEqual(["reload"]);
    // back to the laptop: its agent is the engine's again — told, and reloaded once more
    await result.runtime.navigate({ action: "emulate", emulation: LAPTOP });
    await flush();
    await flush();
    expect(window.emulations.at(-1)).toEqual({ ...ENGINE, touchPoints: 0, colorScheme: "light" });
    expect(window.navigations).toEqual(["reload", "reload"]);
    expect(result.runtime.stats).toMatchObject({ emulations: 4, emulationReloads: 2 });
    result.runtime.dispose();
    await expect(result.runtime.navigate({ action: "emulate", emulation: PHONE })).rejects.toThrow(
      /not available/,
    );
  });

  it("PT-4: a page still to load is told its device and NOT reloaded; a page asleep is born on it when it wakes", async () => {
    const result = setup({ source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP } });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    await flush();
    const first = result.native.windows[0];
    // no navigation truth yet — the page has not loaded: told, never reloaded
    await result.runtime.navigate({ action: "emulate", emulation: PHONE });
    await flush();
    await flush();
    expect(first?.emulations).toHaveLength(2);
    expect(first?.navigations).toEqual([]);
    // asleep (hibernated: no window): the device is kept, and the next window is born on it
    first?.paint(sharedPaint().paint);
    renderer.attachment.setDemand(demand(2, "hibernated"));
    expect(result.runtime.summary.state).toBe("hibernated");
    await result.runtime.navigate({ action: "emulate", emulation: LAPTOP });
    expect(result.runtime.stats.emulations).toBe(2);
    renderer.attachment.setDemand(demand(3, "live"));
    await flush();
    await flush();
    const second = result.native.windows[1];
    expect(second?.emulations).toEqual([{ ...ENGINE, touchPoints: 0, colorScheme: "light" }]);
    expect(second?.options.deviceScaleFactor).toBe(2);
    expect(second?.order).toEqual(["emulate", "raster", "load"]);
    result.runtime.dispose();
  });

  it("PT-4: a press on a touch device's page is a TOUCH — its moves while it is down, its release its end; a hover and another button are nothing; the wheel stays the page's scroll", async () => {
    const result = setup({ source: phoneSource() });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 1206, height: 2622 }));
    await flush();
    await flush();
    const window = result.native.windows[0];
    window?.paint(sharedPaint(1206, 2622).paint);
    await flush();
    const revision = result.runtime.summary.geometry?.revision ?? 0;
    const send = (input: Parameters<NonNullable<typeof renderer.attachment.dispatchInput>>[0]) =>
      renderer.attachment.dispatchInput?.(input, revision);
    send({ kind: "pointer", action: "move", x: 50, y: 60 });
    send({ kind: "pointer", action: "down", x: 100, y: 200, button: "left", clickCount: 1 });
    send({ kind: "pointer", action: "move", x: 100, y: 150, buttons: 1 });
    send({ kind: "pointer", action: "up", x: 100, y: 150, button: "left", clickCount: 1 });
    send({ kind: "pointer", action: "move", x: 120, y: 150 });
    send({ kind: "pointer", action: "down", x: 10, y: 20, button: "right", clickCount: 1 });
    send({ kind: "pointer", action: "up", x: 10, y: 20, button: "right", clickCount: 1 });
    send({ kind: "wheel", x: 100, y: 200, deltaX: 0, deltaY: 120 });
    await flush();
    await flush();
    expect(window?.touchInputs).toEqual([
      { type: "touchStart", touchPoints: [{ x: 100, y: 200, id: 0 }] },
      { type: "touchMove", touchPoints: [{ x: 100, y: 150, id: 0 }] },
      { type: "touchEnd", touchPoints: [] },
    ]);
    // never a mouse press on a touch page: the wheel alone is the mouse's
    expect(window?.mouseInputs).toEqual([
      { type: "mouseWheel", x: 100, y: 200, deltaX: 0, deltaY: 120 },
    ]);
    result.runtime.dispose();

    // a pointer device's page: a press is the mouse's, as before
    const laptop = setup({
      source: { ...source(), emulation: { ...LAPTOP, deviceScaleFactor: 1 } },
    });
    const desk = attach(laptop.runtime);
    desk.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
    await flush();
    await flush();
    laptop.native.windows[0]?.paint(sharedPaint().paint);
    await flush();
    desk.attachment.dispatchInput?.(
      { kind: "pointer", action: "down", x: 10, y: 20, button: "left", clickCount: 1 },
      laptop.runtime.summary.geometry?.revision ?? 0,
    );
    await flush();
    expect(laptop.native.windows[0]?.touchInputs).toEqual([]);
    expect(laptop.native.windows[0]?.mouseInputs).toHaveLength(1);
    laptop.runtime.dispose();
  });

  it("PT-4: the page's FAVICON — the first http(s) icon it names, fetched through its own session and held to the cap, rides its state; it STANDS through a reload and a walk within its site (a page naming the same icons says nothing), and a page of another origin has none until it names its own; a later word stands over an earlier fetch", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    window.emitNavigationState(NAV);
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    window.icons.set("https://example.test/icon.png", {
      mediaType: "image/PNG; charset=binary",
      bytes,
    });
    window.favicons(["data:image/png;base64,AAAA", "https://example.test/icon.png"]);
    await flush();
    await flush();
    // never the data: one, never past the cap
    expect(window.iconFetches).toEqual([
      { url: "https://example.test/icon.png", maxBytes: 32_768 },
    ]);
    const favicon = result.runtime.summary.browser?.favicon;
    expect(favicon).toEqual({
      key: expect.stringMatching(/^[a-f0-9]{16}$/u),
      mediaType: "image/png",
      data: Buffer.from(bytes).toString("base64"),
    });
    expect(renderer.summaries.at(-1)?.browser?.favicon).toEqual(favicon);
    // the same icon named again publishes nothing more
    const published = renderer.summaries.length;
    window.favicons(["https://example.test/icon.png"]);
    await flush();
    await flush();
    expect(renderer.summaries).toHaveLength(published);

    // a RELOAD, and another page of its site: the engine says nothing of icons that did not change — the favicon stands
    window.emitNavigationState({ ...NAV, loading: true });
    window.emitNavigationState(NAV);
    expect(result.runtime.summary.browser?.favicon).toEqual(favicon);
    window.emitNavigationState({
      ...NAV,
      url: "https://example.test/elsewhere?x=1",
      title: "Else",
    });
    expect(result.runtime.summary.browser?.favicon).toEqual(favicon);
    expect(window.iconFetches).toHaveLength(2);
    // a page of ANOTHER origin: none of its own is known — never the last site's on this one's head
    window.emitNavigationState({ ...NAV, url: "https://other.test/" });
    expect(result.runtime.summary.browser).not.toHaveProperty("favicon");
    expect(renderer.summaries.at(-1)?.browser).not.toHaveProperty("favicon");
    // …and an error page, a blank one: none
    for (const url of ["chrome-error://chromewebdata/", "about:blank"]) {
      window.emitNavigationState({ ...NAV, url });
      expect(result.runtime.summary.browser, url).not.toHaveProperty("favicon");
    }
    // back on the first site with nothing said (its icons are the ones last named): its favicon again
    window.emitNavigationState(NAV);
    expect(result.runtime.summary.browser?.favicon).toEqual(favicon);
    // the other origin names its own: under THAT origin, and gone again on the first
    window.icons.set("https://other.test/o.png", {
      mediaType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    window.emitNavigationState({ ...NAV, url: "https://other.test/" });
    window.favicons(["https://other.test/o.png"]);
    await flush();
    await flush();
    expect(result.runtime.summary.browser?.favicon?.data).toBe(
      Buffer.from([1, 2, 3]).toString("base64"),
    );
    window.emitNavigationState(NAV);
    expect(result.runtime.summary.browser).not.toHaveProperty("favicon");
    // a page that names none it can fetch has none
    window.favicons(["https://example.test/icon.png"]);
    await flush();
    await flush();
    expect(result.runtime.summary.browser?.favicon).toEqual(favicon);
    const fetched = window.iconFetches.length;
    window.favicons(["data:image/png;base64,AAAA", "ftp://example.test/icon.png"]);
    await flush();
    expect(window.iconFetches).toHaveLength(fetched);
    expect(result.runtime.summary.browser).not.toHaveProperty("favicon");

    // not an image, too large, unanswered: none
    window.icons.set("https://example.test/a.html", { mediaType: "text/html", bytes });
    window.icons.set("https://example.test/big.png", {
      mediaType: "image/png",
      bytes: new Uint8Array(32_769),
    });
    for (const url of [
      "https://example.test/a.html",
      "https://example.test/big.png",
      "https://example.test/gone.png",
    ]) {
      window.favicons([url]);
      await flush();
      await flush();
      expect(result.runtime.summary.browser, url).not.toHaveProperty("favicon");
    }

    // an earlier page's fetch answering after a later page spoke: the later page's word stands
    let answer: (icon: BrowserSurfaceIcon) => void = () => {};
    window.icons.set(
      "https://example.test/slow.png",
      new Promise<BrowserSurfaceIcon>((resolve) => {
        answer = resolve;
      }),
    );
    window.favicons(["https://example.test/slow.png"]);
    window.favicons(["https://example.test/gone.png"]);
    answer({ mediaType: "image/png", bytes });
    await flush();
    await flush();
    expect(result.runtime.summary.browser).not.toHaveProperty("favicon");
    result.runtime.dispose();

    // the shape: an image's type without its parameters, a digest of the bytes; never empty, never past the cap
    expect(faviconOf({ mediaType: "image/x-icon", bytes })?.mediaType).toBe("image/x-icon");
    expect(faviconOf({ mediaType: "image/png", bytes })?.key).toBe(favicon?.key);
    expect(faviconOf({ mediaType: "image/png", bytes: new Uint8Array([9]) })?.key).not.toBe(
      favicon?.key,
    );
    expect(faviconOf({ mediaType: "image/png", bytes: new Uint8Array(0) })).toBeUndefined();
    expect(faviconOf({ mediaType: "application/octet-stream", bytes })).toBeUndefined();
    expect(faviconOf({ mediaType: "image/png", bytes: new Uint8Array(32_768) })).toBeDefined();
  });

  it("PT-5a: what a page MAY NOT do is counted by kind; a POP-UP's address is where the SAME pane goes — a web address, while the page is live, never a new window — and a cancelled DOWNLOAD is said in the page's state, its serial moving each time", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    expect(result.runtime.stats.refused).toEqual({
      alert: 0,
      confirm: 0,
      beforeunload: 0,
      popup: 0,
      download: 0,
      "file-picker": 0,
      auth: 0,
    });
    // before its first frame the page is not live: a pop-up is counted and goes nowhere
    window.refuse("popup", "https://example.test/early");
    expect(window.loadedUrls).toEqual(["https://example.test/app"]);
    window.paint(sharedPaint(640, 360).paint);
    window.emitNavigationState(NAV);
    // a pop-up: the SAME pane is sent there — one window, as before
    window.refuse("popup", "https://example.test/elsewhere");
    expect(window.loadedUrls).toEqual([
      "https://example.test/app",
      "https://example.test/elsewhere",
    ]);
    expect(result.native.windows).toHaveLength(1);
    // never past the top-level policy, never to nowhere
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "about:blank", undefined])
      window.refuse("popup", url);
    expect(window.loadedUrls).toHaveLength(2);
    // the dialogs, the picker, HTTP auth: answered by the window, counted here, nothing said to the page's state
    const published = renderer.summaries.length;
    for (const what of [
      "alert",
      "alert",
      "confirm",
      "beforeunload",
      "file-picker",
      "auth",
    ] as const)
      window.refuse(what);
    expect(renderer.summaries).toHaveLength(published);
    expect(result.runtime.summary.browser).not.toHaveProperty("refused");
    // a download: cancelled by the session's guard — said, for the head to say for a moment
    window.refuse("download");
    expect(result.runtime.summary.browser?.refused).toEqual({ what: "download", serial: 1 });
    expect(renderer.summaries.at(-1)?.browser?.refused).toEqual({ what: "download", serial: 1 });
    window.refuse("download");
    expect(result.runtime.summary.browser?.refused).toEqual({ what: "download", serial: 2 });
    const counted = {
      alert: 2,
      confirm: 1,
      beforeunload: 1,
      popup: 6,
      download: 2,
      "file-picker": 1,
      auth: 1,
    };
    expect(result.runtime.stats.refused).toEqual(counted);
    // …and the diagnostics carry the same count (the support snapshot)
    expect(result.runtime.supportSnapshot().refused).toEqual(counted);
    result.runtime.dispose();
    // a window that is no longer the runtime's says nothing
    window.refuse("download");
    expect(result.runtime.stats.refused.download).toBe(2);
  });

  it("PT-5a: a LOAD THAT FAILED is said in the page's state — its reason from the engine's code, the ASKED address kept, no title — and is not a failed SOURCE: the window lives, ↻ asks again, and the failure is gone when a page commits", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    window.failLoad = -102;
    await flush();
    await flush();
    // the first load was refused: the source has NOT failed — its window stands, and the page's state says why
    expect(window.loadedUrls).toEqual(["https://example.test/app"]);
    expect(window.destroyed).toBe(false);
    expect(result.runtime.summary.error).toBeUndefined();
    expect(result.runtime.summary.state).toBe("starting");
    expect(result.runtime.summary.browser).toEqual({
      url: "https://example.test/app",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      failure: { reason: "connection-refused" },
    });
    // the engine paints its own error page: the surface is live, and still says the load failed (a holder draws its face)
    window.paint(sharedPaint(640, 360).paint);
    expect(result.runtime.summary).toMatchObject({
      state: "live",
      browser: { url: "https://example.test/app", failure: { reason: "connection-refused" } },
    });
    expect(renderer.summaries.at(-1)?.browser?.failure).toEqual({ reason: "connection-refused" });
    // ↻ asks for the address again (Electron's reload of its error page asks the failed address — probed)
    renderer.attachment.navigate?.({ action: "reload" });
    expect(window.navigations).toEqual(["reload"]);
    expect(result.native.windows).toHaveLength(1);
    // the page commits: the failure is gone, its title back
    window.emitNavigationState(NAV);
    expect(result.runtime.summary.browser).toEqual({
      url: "https://example.test/app",
      title: "App",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
    // an address typed that fails: a load failure too, never a dropped source
    window.failLoad = -105;
    renderer.attachment.navigate?.({ action: "go", url: "https://no-such-host.test/" });
    await flush();
    expect(result.runtime.summary).toMatchObject({
      state: "live",
      browser: { url: "https://no-such-host.test/", failure: { reason: "name-not-resolved" } },
    });
    expect(result.runtime.summary.browser).not.toHaveProperty("title");
    result.runtime.dispose();
  });

  it("PT-5a: a failed load's reason, from the engine's net error — the named ones, a certificate's whole range one reason (refused, never bypassed), the rest `failed`", () => {
    expect(
      [-105, -137, -106, -102, -7, -118, -100, -101, -104, -109, -15].map((code) =>
        loadFailureOf(code),
      ),
    ).toEqual([
      "name-not-resolved",
      "name-not-resolved",
      "offline",
      "connection-refused",
      "timed-out",
      "timed-out",
      "connection-failed",
      "connection-failed",
      "connection-failed",
      "connection-failed",
      "connection-failed",
    ]);
    for (const code of [-200, -201, -202, -207, -219])
      expect(loadFailureOf(code)).toBe("certificate");
    for (const code of [-10, -20, -21, -27, -301, -302])
      expect(loadFailureOf(code)).toBe("blocked");
    for (const code of [-2, -199, -220, -324, -379, -9999])
      expect(loadFailureOf(code)).toBe("failed");
  });

  it("PT-5a: a source that SAYS when its page stops — its process gone, no restart behind the person's back: `failed`, `producer-crashed`, the person's to recover, its ADDRESS kept; no demand starts it again; ↻ starts it WHERE THE PAGE WAS; an address typed starts it there", async () => {
    vi.useFakeTimers();
    const result = setup({ source: { ...source(), whenStopped: "say" }, restartLimit: 1 });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await vi.advanceTimersByTimeAsync(0);
    const first = result.native.windows[0];
    if (first === undefined) throw new Error("no window");
    first.paint(sharedPaint().paint);
    first.emitNavigationState({ ...NAV, url: "https://example.test/deeper", canGoBack: true });
    first.crash();
    expect(result.runtime.summary).toMatchObject({
      state: "failed",
      error: { code: "producer-crashed", recovery: "user-action" },
      // its address kept; a page with no window has nowhere to go
      browser: { url: "https://example.test/deeper", loading: false, canGoBack: false },
    });
    expect(first.destroyed).toBe(true);
    // nothing brings it back but the person: not time, not a demand
    await vi.advanceTimersByTimeAsync(5_000);
    renderer.attachment.setDemand(demand(2, "paused"));
    renderer.attachment.setDemand(demand(3, "live", 30, { width: 800, height: 450 }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(result.native.windows).toHaveLength(1);
    expect(result.runtime.stats.producerRestarts).toBe(0);
    expect(result.runtime.summary.state).toBe("failed");
    // ↻: started again — where the page was, never back at the source's first address; its state says it is loading
    renderer.attachment.navigate?.({ action: "reload" });
    expect(result.native.windows).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.native.windows[1]?.loadedUrls).toEqual(["https://example.test/deeper"]);
    expect(result.runtime.summary).toMatchObject({
      state: "starting",
      browser: { url: "https://example.test/deeper", loading: true, canGoBack: false },
    });
    expect(result.runtime.summary.error).toBeUndefined();
    // stopped again before its first frame: said again (a `say` source is never retried by itself)
    result.native.windows[1]?.crash();
    expect(result.runtime.summary).toMatchObject({
      state: "failed",
      error: { code: "producer-crashed", recovery: "user-action" },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(result.native.windows).toHaveLength(2);
    // an address typed on a stopped page: never past the top-level policy — and a web one starts the page THERE
    renderer.attachment.navigate?.({ action: "go", url: "file:///etc/passwd" });
    expect(result.native.windows).toHaveLength(2);
    renderer.attachment.navigate?.({ action: "go", url: "https://example.test/typed" });
    expect(result.native.windows).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.native.windows[2]?.loadedUrls).toEqual(["https://example.test/typed"]);
    result.runtime.dispose();
  });

  it("PT-5a: ↻ on a stopped page nobody is looking at starts nothing — it starts when somebody looks; and a source that does NOT say (the default) is restarted by itself as before, where the page was", async () => {
    vi.useFakeTimers();
    const said = setup({ source: { ...source(), whenStopped: "say" } });
    const renderer = attach(said.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await vi.advanceTimersByTimeAsync(0);
    said.native.windows[0]?.paint(sharedPaint().paint);
    renderer.attachment.setDemand(demand(2, "paused"));
    said.native.windows[0]?.crash();
    expect(said.runtime.summary.state).toBe("failed");
    renderer.attachment.navigate?.({ action: "reload" });
    expect(said.native.windows).toHaveLength(1);
    renderer.attachment.setDemand(demand(3, "live"));
    expect(said.native.windows).toHaveLength(2);
    said.runtime.dispose();

    const plain = setup({ restartLimit: 1 });
    const other = attach(plain.runtime);
    other.attachment.setDemand(demand(1, "live"));
    await vi.advanceTimersByTimeAsync(0);
    plain.native.windows[0]?.paint(sharedPaint().paint);
    plain.native.windows[0]?.emitNavigationState({ ...NAV, url: "https://example.test/deeper" });
    plain.native.windows[0]?.crash();
    expect(plain.runtime.summary).toMatchObject({
      state: "reconnecting",
      error: { code: "producer-crashed", recovery: "automatic" },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(plain.native.windows).toHaveLength(2);
    expect(plain.native.windows[1]?.loadedUrls).toEqual(["https://example.test/deeper"]);
    plain.runtime.dispose();
  });

  it("PT-5a: a page UNRESPONSIVE past the bound is said to have stopped (`frame-stalled`, the person's to recover) — one that answers again within it is not; a source that does not say is left alone", async () => {
    vi.useFakeTimers();
    const result = setup({
      source: { ...source(), whenStopped: "say" },
      unresponsiveMs: 400,
    });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await vi.advanceTimersByTimeAsync(0);
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    window.paint(sharedPaint().paint);
    window.emitNavigationState(NAV);
    // it hangs, and answers again inside the bound: nothing is said
    window.hang(true);
    await vi.advanceTimersByTimeAsync(399);
    window.hang(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.runtime.summary.state).toBe("live");
    // it hangs past the bound: stopped, said, its window gone — and ↻ brings it back
    window.hang(true);
    await vi.advanceTimersByTimeAsync(399);
    expect(result.runtime.summary.state).toBe("live");
    await vi.advanceTimersByTimeAsync(1);
    expect(result.runtime.summary).toMatchObject({
      state: "failed",
      error: { code: "frame-stalled", recovery: "user-action" },
      browser: { url: "https://example.test/app" },
    });
    expect(window.destroyed).toBe(true);
    renderer.attachment.navigate?.({ action: "reload" });
    expect(result.native.windows).toHaveLength(2);
    result.runtime.dispose();

    const plain = setup({ unresponsiveMs: 400 });
    const other = attach(plain.runtime);
    other.attachment.setDemand(demand(1, "live"));
    await vi.advanceTimersByTimeAsync(0);
    plain.native.windows[0]?.paint(sharedPaint().paint);
    plain.native.windows[0]?.hang(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(plain.runtime.summary.state).toBe("live");
    plain.runtime.dispose();
  });

  it("PT-4: a PERSISTENT profile lives under its user's profiles root by an opaque name — one ref, one directory; a memory profile, or no root, is Electron's own partition", async () => {
    const root = "/data/users/7/browser/profiles";
    const desk = { ...source(), profile: { mode: "persistent" as const, ref: "desk" } };
    const born = async (options: Parameters<typeof setup>[0]) => {
      const result = setup(options);
      attach(result.runtime).attachment.setDemand(demand(1, "live"));
      await flush();
      const made = result.native.windows[0]?.options;
      result.runtime.dispose();
      return made;
    };
    const first = await born({ source: desk, profilesRoot: root });
    expect(first?.profilePath).toBe(join(root, browserSurfaceProfileName(desk)));
    expect(first?.profilePath).toMatch(/\/browser\/profiles\/[a-f0-9]{40}$/u);
    expect(first?.profilePath).not.toContain("desk");
    expect(first?.persistent).toBe(true);
    // another pane's page on the same ref: the SAME directory — the desk's pages share one profile
    expect(
      (
        await born({
          source: { ...desk, initialUrl: "https://example.test/other" },
          profilesRoot: root,
        })
      )?.profilePath,
    ).toBe(first?.profilePath);
    // another ref: another directory
    expect(
      (
        await born({
          source: { ...desk, profile: { mode: "persistent", ref: "other" } },
          profilesRoot: root,
        })
      )?.profilePath,
    ).not.toBe(first?.profilePath);
    // a memory profile, and a runtime given no root: no path — Electron's own partition by name
    expect((await born({ profilesRoot: root }))?.profilePath).toBeUndefined();
    const unrooted = await born({ source: desk });
    expect(unrooted?.profilePath).toBeUndefined();
    expect(unrooted?.partition).toMatch(/^persist:vibefield-live-surface:[a-f0-9]{40}$/u);
  });
});
