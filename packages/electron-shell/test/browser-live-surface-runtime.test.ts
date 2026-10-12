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

  /** PT-5c (ruling 1): the page SAYS its scale (its guard's word), tagged with the document the window counts now. */
  onScale(listener: (scale: number, document: number) => void): () => void {
    this.#events.on("scale", listener);
    return () => this.#events.off("scale", listener);
  }

  say(scale: number): void {
    this.#events.emit("scale", scale, this.documents);
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

  /**
   * PT-5b3 (ruling 4): the fake COUNTS DOCUMENTS as the native does. A state that names `document` says it outright (a
   * row that moves an address WITHIN a document — `pushState`, `replaceState` — names the same one). Else a state whose
   * address, less its fragment, is another than the last said — or whose failure is (an error page standing where a
   * page did; a page committing where one stood) — is another document; the bootstrap blank is none.
   */
  documents = 0;
  #documentAt: string | undefined;
  #documentFailure: number | undefined;
  emitNavigationState(
    state: Omit<BrowserSurfaceNavigationState, "document"> & { readonly document?: number },
  ): void {
    if (state.document !== undefined) this.documents = state.document;
    else if (state.url !== "about:blank") {
      const at = state.url.split("#")[0];
      if (at !== this.#documentAt || state.failure !== this.#documentFailure) this.documents += 1;
      this.#documentAt = at;
      this.#documentFailure = state.failure;
    }
    this.#events.emit("navigation", { ...state, document: this.documents });
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

/** Two turns of the microtask queue. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * The hand's events DELIVERED (PT-5b2's chain): each event takes its turn on the page's chain behind the one before it —
 * the tail's turn, its scale's read where it needs one, its dispatch (and on `phone()`'s window a turn more, on its one
 * queue) — so a row that sends several reads what reached the page only after as many turns as they take. Enough turns
 * for every event that CAN go to have gone; an event waiting on a read the row holds goes nowhere, and that is what the
 * rows that hold one read.
 */
async function delivered(): Promise<void> {
  for (let i = 0; i < 48; i += 1) await Promise.resolve();
}

/** A window's BIRTH ends (PT-5b3, ruling 1): once the layout the row held answers — its device told, its layout laid, its
 * address asked for — a few turns of the fake's promises. (PT-5c, ruling 4: the layout now says what it laid when it
 * answers — a turn more — and a re-birth runs the device and the layout again: the re-birth's row needs 10 now, where
 * PT-5b3's 8 sufficed; 12.) */
async function birthEnds(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
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
    await delivered();
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
    await delivered();
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
    await delivered();
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

  /** A tablet as the laptop's window sees it: a touch device laid out mobile, at the laptop's own density. */
  const TABLET: LiveSurfaceBrowserEmulationV1 = { ...PHONE, deviceScaleFactor: 2 };

  it("PT-4: the device SWITCH under a running page — told at once, laid out again, and RELOADED ONCE when what the page is told of its device moved; a scheme alone is told live; the same again is nothing", async () => {
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

    // a tablet (the laptop's density): told, laid out mobile, reloaded once — in the SAME window
    await result.runtime.navigate({ action: "emulate", emulation: TABLET });
    await flush();
    await flush();
    expect(window.order).toEqual(["emulate", "raster", "reload"]);
    expect(window.emulations.at(-1)).toMatchObject({
      userAgent: IPHONE_UA,
      touchPoints: 5,
      colorScheme: "dark",
    });
    expect([window.rasterDensities.at(-1), window.rasterMobile.at(-1)]).toEqual([2, true]);
    expect(window.backingRasters.at(-1)).toEqual({ width: 640, height: 360 });
    expect(window.navigations).toEqual(["reload"]);
    expect(result.runtime.stats).toMatchObject({
      emulations: 1,
      emulationReloads: 1,
      windowsRemade: 0,
    });

    // the tablet's SCHEME alone: told live — no reload, a frame asked
    window.order.length = 0;
    const invalidated = window.invalidate.mock.calls.length;
    await result.runtime.navigate({
      action: "emulate",
      emulation: { ...TABLET, colorScheme: "light" },
    });
    await flush();
    await flush();
    expect(window.order).toEqual(["emulate", "raster"]);
    expect(window.emulations.at(-1)?.colorScheme).toBe("light");
    expect(window.navigations).toEqual(["reload"]);
    expect(window.invalidate.mock.calls.length).toBe(invalidated + 1);
    // back to the laptop: its agent is the engine's again — told, and reloaded once more
    await result.runtime.navigate({ action: "emulate", emulation: LAPTOP });
    await flush();
    await flush();
    expect(window.emulations.at(-1)).toEqual({ ...ENGINE, touchPoints: 0, colorScheme: "light" });
    expect(window.navigations).toEqual(["reload", "reload"]);
    expect(result.runtime.stats).toMatchObject({ emulations: 3, emulationReloads: 2 });
    expect(result.native.windows).toHaveLength(1);
    result.runtime.dispose();
    await expect(result.runtime.navigate({ action: "emulate", emulation: PHONE })).rejects.toThrow(
      /not available/,
    );
  });

  it("PT-5b (ruling 5a): a device switch that changes the DENSITY makes the page's window ANEW at the new one — born on the device, at the page's address — with ONE summary (`starting`), never a reload of the old window", async () => {
    const result = setup({ source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP } });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, undefined, { width: 320, height: 180 }));
    await flush();
    await flush();
    const first = result.native.windows[0];
    if (first === undefined) throw new Error("no window");
    expect(first.options.deviceScaleFactor).toBe(2);
    first.paint(sharedPaint().paint);
    // the page went somewhere of its own: that is where it is
    first.emitNavigationState({ ...NAV, url: "https://example.test/deeper", canGoBack: true });
    const epoch = result.runtime.summary.producerEpoch;
    const said = renderer.summaries.length;

    // the phone: another density (@3) — the laptop's window cannot show it (an offscreen window's density is its own)
    await result.runtime.navigate({ action: "emulate", emulation: PHONE });
    await flush();
    await flush();
    expect(first.destroyed).toBe(true);
    expect(first.navigations).toEqual([]);
    const second = result.native.windows[1];
    if (second === undefined) throw new Error("no second window");
    expect(result.native.windows).toHaveLength(2);
    expect(second.options.deviceScaleFactor).toBe(3);
    // born on the phone: told before it is laid out, laid out mobile at @3, then loaded — where the page WAS
    expect(second.order).toEqual(["emulate", "raster", "load"]);
    expect(second.emulations.at(-1)).toMatchObject({ userAgent: IPHONE_UA, touchPoints: 5 });
    expect([second.rasterDensities.at(-1), second.rasterMobile.at(-1)]).toEqual([3, true]);
    expect(second.loadedUrls).toEqual(["https://example.test/deeper"]);
    // one summary: starting, a new epoch — nothing said of the steps between (no page "paused", none "hibernated")
    expect(renderer.summaries.slice(said).map((summary) => summary.state)).toEqual(["starting"]);
    expect(result.runtime.summary.producerEpoch).toBeGreaterThan(epoch);
    // its history is the cost: the new window's page has nowhere to go back to, and says it is loading
    expect(result.runtime.summary.browser).toMatchObject({
      url: "https://example.test/deeper",
      loading: true,
      canGoBack: false,
    });
    expect(result.runtime.stats).toMatchObject({
      emulations: 1,
      emulationReloads: 0,
      windowsRemade: 1,
    });
    // born under a live ask: with its sound
    expect(second.mutes).toEqual([]);
    // the phone's scheme alone, its density standing: told live in the new window
    second.paint(sharedPaint().paint);
    second.emitNavigationState({ ...NAV, url: "https://example.test/deeper" });
    await result.runtime.navigate({
      action: "emulate",
      emulation: { ...PHONE, colorScheme: "light" },
    });
    await flush();
    await flush();
    expect(result.native.windows).toHaveLength(2);
    expect(second.navigations).toEqual([]);
    // back to the laptop (@2): made anew again
    await result.runtime.navigate({ action: "emulate", emulation: LAPTOP });
    await flush();
    await flush();
    expect(result.native.windows).toHaveLength(3);
    expect(result.native.windows[2]?.options.deviceScaleFactor).toBe(2);
    expect(result.runtime.stats.windowsRemade).toBe(2);
    result.runtime.dispose();
  });

  it("PT-5b (ruling 5a): a density moved under a page NOBODY LOOKS AT makes no window — the old one goes, and the page is born at its device's density, with its sound, when it is next asked for live", async () => {
    const result = setup({ source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP } });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    await flush();
    const first = result.native.windows[0];
    first?.paint(sharedPaint().paint);
    first?.emitNavigationState(NAV);
    renderer.attachment.setDemand(demand(2, "paused"));
    expect(result.runtime.summary.state).toBe("paused");
    await result.runtime.navigate({ action: "emulate", emulation: PHONE });
    await flush();
    await flush();
    expect(first?.destroyed).toBe(true);
    expect(result.native.windows).toHaveLength(1);
    expect(result.runtime.summary.state).toBe("hibernated");
    expect(result.runtime.stats.windowsRemade).toBe(1);
    // asked for live: born on the phone at @3 — and heard
    renderer.attachment.setDemand(demand(3, "live"));
    await flush();
    await flush();
    const second = result.native.windows[1];
    expect(second?.options.deviceScaleFactor).toBe(3);
    expect(second?.order).toEqual(["emulate", "raster", "load"]);
    expect(second?.mutes).toEqual([]);
    expect(second?.loadedUrls).toEqual([NAV.url]);
    result.runtime.dispose();
  });

  it("PT-4: a page still to load learns its device by loading AS it — PT-5b3: its address asked for again on a window made anew, never the engine's reload; a page asleep is born on it when it wakes", async () => {
    const result = setup({ source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP } });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    await flush();
    const first = result.native.windows[0];
    // no navigation truth yet — the page's load is under way, no document of it yet. (PT-4 told the device on that window
    // and left it: but the engine holds a device's commands while a load is pending, so the page loaded as the device
    // before. PT-5b3, ruling 2: the address is asked for again AS the device, on a window made anew.)
    await result.runtime.navigate({ action: "emulate", emulation: TABLET });
    await flush();
    await flush();
    expect(first?.emulations).toHaveLength(1);
    expect(first?.navigations).toEqual([]);
    expect(first?.isDestroyed()).toBe(true);
    expect(result.runtime.stats.windowsRemade).toBe(1);
    const anew = result.native.windows[1];
    expect(anew?.emulations.at(-1)).toMatchObject({ touchPoints: TABLET.touchPoints });
    expect(anew?.order).toEqual(["emulate", "raster", "load"]);
    // asleep (hibernated: no window): the device is kept, and the next window is born on it
    anew?.paint(sharedPaint().paint);
    renderer.attachment.setDemand(demand(2, "hibernated"));
    expect(result.runtime.summary.state).toBe("hibernated");
    await result.runtime.navigate({ action: "emulate", emulation: PHONE });
    expect(result.runtime.stats.emulations).toBe(2);
    // (no window stands: none is made anew — and none is made for a page asleep)
    expect(result.runtime.stats.windowsRemade).toBe(1);
    expect(result.native.windows).toHaveLength(2);
    renderer.attachment.setDemand(demand(3, "live"));
    await flush();
    await flush();
    const second = result.native.windows[2];
    expect(second?.emulations.at(-1)).toMatchObject({ userAgent: IPHONE_UA, touchPoints: 5 });
    expect(second?.options.deviceScaleFactor).toBe(3);
    expect(second?.order).toEqual(["emulate", "raster", "load"]);
    result.runtime.dispose();
  });

  it("PT-5b (ruling 3): a window is made ONLY under a live ask — a page at rest asked `paused` makes none; woken live it is born with its sound; and a page whose ask falls to paused while its window is still STARTING is silenced before its first frame", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    // never asked for live: nothing is made of it, whatever else it is asked
    renderer.attachment.setDemand(demand(1, "paused"));
    renderer.attachment.setDemand(demand(2, "hibernated"));
    await flush();
    expect(result.native.windows).toHaveLength(0);
    expect(result.runtime.summary.state).toBe("created");
    // alive, then put to rest
    renderer.attachment.setDemand(demand(3, "live"));
    await flush();
    const first = result.native.windows[0];
    first?.paint(sharedPaint().paint);
    renderer.attachment.setDemand(demand(4, "hibernated"));
    expect(result.runtime.summary.state).toBe("hibernated");
    expect(first?.destroyed).toBe(true);
    // at rest, asked `paused` (its pane unseen; a parked desk): no window — there is none to be born silent
    renderer.attachment.setDemand(demand(5, "paused"));
    await flush();
    expect(result.native.windows).toHaveLength(1);
    expect(result.runtime.summary.state).toBe("hibernated");
    // woken by a live ask: born with its sound (never muted)
    renderer.attachment.setDemand(demand(6, "live"));
    await flush();
    const second = result.native.windows[1];
    expect(second).toBeDefined();
    expect(second?.muted).toBe(false);
    expect(second?.mutes).toEqual([]);
    // …and its ask falls to paused before its first frame: silenced at once, while it is still starting
    renderer.attachment.setDemand(demand(7, "paused"));
    expect(result.runtime.summary.state).toBe("starting");
    expect(second?.mutes).toEqual([true]);
    // its first frame lands: it pauses as it was asked, silent still
    second?.paint(sharedPaint().paint);
    expect(result.runtime.summary.state).toBe("paused");
    expect(second?.muted).toBe(true);
    // rested again from there, then woken: the NEXT window is born with its sound — the last one's silence is not its own
    renderer.attachment.setDemand(demand(8, "hibernated"));
    renderer.attachment.setDemand(demand(9, "live"));
    await flush();
    const third = result.native.windows[2];
    expect(third?.mutes).toEqual([]);
    expect(third?.muted).toBe(false);
    result.runtime.dispose();
  });

  it("PT-5b: the window's own FIRST document is not the page — a paint of the bootstrap blank is offered to nobody and released; it meets the startup deadline, the page stays STARTING, and its first frame is its own", async () => {
    vi.useFakeTimers();
    try {
      const result = setup({ startupTimeoutMs: 1_000 });
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await vi.advanceTimersByTimeAsync(0);
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window");
      // the page's server is slow to answer: the window paints its blank bootstrap meanwhile
      const blank = sharedPaint(320, 180);
      window.paint({ ...blank.paint, bootstrap: true });
      window.paint({ ...sharedPaint(320, 180).paint, bootstrap: true });
      expect(blank.release).toHaveBeenCalledTimes(1);
      expect(renderer.textureFrames).toHaveLength(0);
      expect(renderer.cpuFrames).toHaveLength(0);
      expect(result.runtime.summary.state).toBe("starting");
      expect(result.runtime.summary.geometry).toBeUndefined();
      expect(result.runtime.stats.bootstrapPaints).toBe(2);
      // the window is up: the startup deadline does not fail a page that is only slow
      await vi.advanceTimersByTimeAsync(5_000);
      expect(result.runtime.summary.state).toBe("starting");
      expect(result.native.windows).toHaveLength(1);
      // the page's own first frame: live, and offered
      window.paint(sharedPaint(320, 180).paint);
      expect(result.runtime.summary.state).toBe("live");
      expect(renderer.textureFrames).toHaveLength(1);
      result.runtime.dispose();
      // a window that never paints at all is still failed by the deadline (and retried within its budget)
      const dead = setup({ startupTimeoutMs: 1_000, restartLimit: 0 });
      const waiting = attach(dead.runtime);
      waiting.attachment.setDemand(demand(1, "live"));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(dead.runtime.summary.state).toBe("failed");
      dead.runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("PT-5b: while a window's first load is pending the engine's committed address is its bootstrap's — plumbing: the page says where it is HEADED (the address it was sent to, or where it last was), loading, with no title", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const first = result.native.windows[0];
    if (first === undefined) throw new Error("no window");
    // a pending load as Electron says it: `getURL()` is still the bootstrap's
    first.emitNavigationState({
      url: "about:blank",
      title: "about:blank",
      loading: true,
      canGoBack: true,
      canGoForward: false,
    });
    expect(result.runtime.summary.browser).toEqual({
      url: "https://example.test/app",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    });
    // the page commits, goes on, is put to rest and woken: its new window's pending load says where it WAS
    first.paint(sharedPaint().paint);
    first.emitNavigationState({ ...NAV, url: "https://example.test/deeper", title: "Deeper" });
    renderer.attachment.setDemand(demand(2, "hibernated"));
    renderer.attachment.setDemand(demand(3, "live"));
    await flush();
    const second = result.native.windows[1];
    second?.emitNavigationState({
      url: "about:blank",
      title: "",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    });
    // (PT-5c, ruling 3: the new window has committed no document of its own yet — none is said; PT-5b3 said the last
    // one stood, at the new address)
    expect(result.runtime.summary.browser).toEqual({
      url: "https://example.test/deeper",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    });
    // a load that FAILED is said with the address asked for, as PT-5a's — never mistaken for plumbing
    second?.emitNavigationState({
      url: "https://example.test/deeper",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      failure: -106,
    });
    expect(result.runtime.summary.browser).toMatchObject({
      url: "https://example.test/deeper",
      failure: { reason: "offline" },
    });
    result.runtime.dispose();
  });

  it("PT-5b: a page put to REST while it is still starting is let go AT ONCE — its window gone, one summary, its address kept; asked `paused` while starting it loads on", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const first = result.native.windows[0];
    expect(result.runtime.summary.state).toBe("starting");
    // out of view while it loads: it loads on (its pane finds it loaded)
    renderer.attachment.setDemand(demand(2, "paused"));
    expect(result.runtime.summary.state).toBe("starting");
    expect(first?.destroyed).toBe(false);
    // put to rest: gone at once — it holds no slot while its server takes its time
    const said = renderer.summaries.length;
    renderer.attachment.setDemand(demand(3, "hibernated"));
    expect(first?.destroyed).toBe(true);
    expect(result.runtime.summary.state).toBe("hibernated");
    expect(renderer.summaries.slice(said).map((summary) => summary.state)).toEqual(["hibernated"]);
    // a late paint of the window that went is nothing
    first?.paint(sharedPaint().paint);
    expect(result.runtime.summary.state).toBe("hibernated");
    // woken: a new window, at its address
    renderer.attachment.setDemand(demand(4, "live"));
    await flush();
    expect(result.native.windows).toHaveLength(2);
    expect(result.native.windows[1]?.loadedUrls).toEqual(["https://example.test/app"]);
    result.runtime.dispose();
  });

  it("PT-5b: a page SENT SOMEWHERE while nobody looks — with no window (at rest, or never made) it is born there when it is next asked for, and says so at once; paused, it goes there at once in its own window; every other verb still waits for a page that is live", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    // never made: where it is sent is where it will be born
    await result.runtime.navigate({ action: "go", url: "https://example.test/first" });
    expect(result.native.windows).toHaveLength(0);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const first = result.native.windows[0];
    expect(first?.loadedUrls).toEqual(["https://example.test/first"]);
    first?.paint(sharedPaint().paint);
    first?.emitNavigationState({ ...NAV, url: "https://example.test/first", title: "First" });
    // PAUSED (alive, unseen): it goes there at once — the same window, nothing made
    renderer.attachment.setDemand(demand(2, "paused"));
    await result.runtime.navigate({ action: "go", url: "https://example.test/second" });
    expect(first?.loadedUrls).toEqual([
      "https://example.test/first",
      "https://example.test/second",
    ]);
    expect(result.native.windows).toHaveLength(1);
    // (a paused page takes no other verb: there is nobody to press ‹)
    await expect(result.runtime.navigate({ action: "back" })).rejects.toThrow(/not available/);
    await expect(result.runtime.navigate({ action: "reload" })).rejects.toThrow(/not available/);
    first?.emitNavigationState({ ...NAV, url: "https://example.test/second", title: "Second" });
    // AT REST (hibernated: no window): its address is its pane's at once — no title, no history, nothing loading
    renderer.attachment.setDemand(demand(3, "hibernated"));
    expect(result.runtime.summary.state).toBe("hibernated");
    const said = renderer.summaries.length;
    await result.runtime.navigate({ action: "go", url: "https://example.test/third" });
    expect(result.native.windows).toHaveLength(1);
    expect(renderer.summaries.slice(said).map((summary) => summary.state)).toEqual(["hibernated"]);
    // (PT-5c, ruling 3: at rest no document of the page stands — none is said; PT-5b3 said its second, at the new address)
    expect(result.runtime.summary.browser).toEqual({
      url: "https://example.test/third",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
    // woken: born THERE
    renderer.attachment.setDemand(demand(4, "live"));
    await flush();
    expect(result.native.windows[1]?.loadedUrls).toEqual(["https://example.test/third"]);
    // an address the desk does not open is refused, at rest as anywhere
    renderer.attachment.setDemand(demand(5, "hibernated"));
    result.native.windows[1]?.paint(sharedPaint().paint);
    renderer.attachment.setDemand(demand(6, "hibernated"));
    await expect(
      result.runtime.navigate({ action: "go", url: "file:///etc/passwd" }),
    ).rejects.toThrow(/HTTP or HTTPS/);
    result.runtime.dispose();
  });

  it("PT-5b (ruling 5c), PT-5c (ruling 1): on a `mobile` page shown whole at its own scale the hand's points are the VIEW's — sent as the page's CSS px, the view's OVER the visual-viewport scale the page SAYS (its guard's word, at its start and at every change; never READ on the hand's path): its press, its moves and the wheel (whose travel passes as it is) go at it; a zoom is said, and the next event goes at it; another document's is its own; a page that is not mobile is asked nothing", async () => {
    const result = setup({ source: phoneSource() });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 1206, height: 2622 }));
    await flush();
    await flush();
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    window.emitNavigationState({ ...NAV });
    window.paint(sharedPaint(1206, 2622).paint);
    await flush();
    const revision = result.runtime.summary.geometry?.revision ?? 0;
    const send = async (
      input: Parameters<NonNullable<typeof renderer.attachment.dispatchInput>>[0],
    ): Promise<void> => {
      renderer.attachment.dispatchInput?.(input, revision);
      await delivered();
    };
    // a page that names no viewport: laid out 980 px wide, shown whole in the phone's 402 — it says 0.41
    window.say(402 / 980);
    await send({ kind: "pointer", action: "down", x: 201, y: 100, button: "left", clickCount: 1 });
    const [finger] = window.touchInputs[0]?.touchPoints ?? [];
    expect(finger?.x).toBeCloseTo(490, 6);
    expect(finger?.y).toBeCloseTo(100 / (402 / 980), 6);
    // its move: the scale said
    await send({ kind: "pointer", action: "move", x: 402, y: 100, buttons: 1 });
    expect(window.touchInputs[1]?.touchPoints[0]?.x).toBeCloseTo(980, 6);
    await send({ kind: "pointer", action: "up", x: 402, y: 100, button: "left", clickCount: 1 });
    // the wheel: WHERE it is — the page's px — and never how far: its travel is the view's, as the hand gave it (the engine
    // scrolls the document by it over the page's scale itself)
    await send({ kind: "wheel", x: 201, y: 437, deltaX: 0, deltaY: 82 });
    const wheel = window.mouseInputs.at(-1);
    expect(wheel?.x).toBeCloseTo(490, 6);
    expect(wheel?.deltaY).toBe(82);
    // the page zoomed itself (a double tap it answers by zooming): it SAYS so — the next press goes at it
    window.say(1);
    await send({ kind: "pointer", action: "down", x: 201, y: 100, button: "left", clickCount: 1 });
    expect(window.touchInputs.at(-1)?.touchPoints[0]).toEqual({ x: 201, y: 100, id: 0 });
    await send({ kind: "pointer", action: "up", x: 201, y: 100, button: "left", clickCount: 1 });
    window.say(0.5);
    await send({ kind: "wheel", x: 100, y: 100, deltaX: 0, deltaY: 10 });
    expect(window.mouseInputs.at(-1)).toMatchObject({ x: 200, y: 200, deltaY: 10 });
    // another document takes its own scale: its first word
    window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
    window.say(1);
    await send({ kind: "wheel", x: 100, y: 100, deltaX: 0, deltaY: 10 });
    expect(window.mouseInputs.at(-1)).toMatchObject({ x: 100, y: 100, deltaY: 10 });
    // a word that is no scale is nothing: the last one stands
    window.say(Number.NaN);
    await send({ kind: "pointer", action: "down", x: 50, y: 50, button: "left", clickCount: 1 });
    expect(window.touchInputs.at(-1)?.touchPoints[0]).toEqual({ x: 50, y: 50, id: 0 });
    result.runtime.dispose();

    // a laptop's page: laid out at the view's width, its scale forced — nothing is asked, the points pass as they are
    const laptop = setup({
      source: { ...source(), emulation: { ...LAPTOP, deviceScaleFactor: 1 } },
    });
    const desk = attach(laptop.runtime);
    desk.attachment.setDemand(demand(1, "live", 30, { width: 640, height: 360 }));
    await flush();
    await flush();
    const plain = laptop.native.windows[0];
    if (plain === undefined) throw new Error("no window");
    plain.paint(sharedPaint().paint);
    await flush();
    plain.say(0.5);
    desk.attachment.dispatchInput?.(
      { kind: "pointer", action: "down", x: 10, y: 20, button: "left", clickCount: 1 },
      laptop.runtime.summary.geometry?.revision ?? 0,
    );
    await flush();
    await flush();
    expect(plain.mouseInputs.at(-1)).toMatchObject({ x: 10, y: 20 });
    laptop.runtime.dispose();
  });

  const FIRST = "https://example.test/app";
  /** What Electron 43 rejects `loadURL` with (the scratch probe): a navigation that replaced the load; a load that ended
   * with no document (an attachment, a 204, a stop with nothing answered). */
  const aborted = (): Error =>
    Object.assign(new Error("ERR_ABORTED (-3) loading"), { code: "ERR_ABORTED", errno: -3 });
  const nothing = (): Error =>
    Object.assign(new Error("ERR_FAILED (-2) loading"), { code: "ERR_FAILED", errno: -2 });
  /** A page asked for live whose first `loadURL` settles when the row says: `resolve`, or `reject(with)`. */
  const starting = async (
    options: Parameters<typeof setup>[0] = {},
    { blankPaint = true }: { blankPaint?: boolean } = {},
  ) => {
    const result = setup(options);
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window yet");
    const loads: { url: string; resolve(): void; reject(error: Error): void }[] = [];
    window.loadURL = (url: string) => {
      window.loadedUrls.push(url);
      return new Promise<void>((resolve, reject) => {
        loads.push({ url, resolve, reject });
      });
    };
    await flush();
    // the window is up: its blank bootstrap paints (the startup deadline is met), the page's server has not answered
    if (blankPaint) window.paint({ ...sharedPaint(320, 180).paint, bootstrap: true });
    const blank = (loading: boolean): void =>
      window.emitNavigationState({
        url: "about:blank",
        title: "about:blank",
        loading,
        canGoBack: false,
        canGoForward: false,
      });
    blank(true);
    return { result, renderer, window, loads, blank };
  };

  describe("PT-5b2 (rulings 3, 6) — a page's FIRST LOAD: superseded, ended with nothing, sent elsewhere, stopped", () => {
    it("a first load that another navigation SUPERSEDES is not a failed page (Electron rejects it ERR_ABORTED: a script's redirect, a link clicked while the page still loads)", async () => {
      const p = await starting();
      // the page's document commits and paints; before its load FINISHES a script sends it elsewhere
      p.window.emitNavigationState({ ...NAV, url: FIRST, loading: true });
      p.window.paint(sharedPaint().paint);
      await flush();
      expect(p.result.runtime.summary.state).toBe("live");
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/b", loading: true });
      p.loads[0]?.reject(aborted());
      await flush();
      expect(p.result.runtime.summary.state).toBe("live");
      expect(p.result.runtime.summary.error).toBeUndefined();
      expect(p.window.isDestroyed()).toBe(false);
      expect(p.result.runtime.summary.browser).toMatchObject({ url: "https://example.test/b" });
      expect(p.result.runtime.summary.browser?.failure).toBeUndefined();
      // …and one whose superseding navigation itself FAILS is said by the engine's own event: the address it went to
      const q = await starting();
      q.window.emitNavigationState({ ...NAV, url: FIRST, loading: true });
      q.window.paint(sharedPaint().paint);
      q.window.emitNavigationState({
        ...NAV,
        url: "https://dead.test/gone",
        loading: false,
        failure: -102,
      });
      q.loads[0]?.reject(aborted());
      await flush();
      expect(q.result.runtime.summary.state).toBe("live");
      expect(q.window.isDestroyed()).toBe(false);
      expect(q.result.runtime.summary.browser).toMatchObject({
        url: "https://dead.test/gone",
        failure: { reason: "connection-refused" },
      });
      p.result.runtime.dispose();
      q.result.runtime.dispose();
    });

    it("a first load that ENDS with no document of the page and nothing under way (an attachment, a 204) is SAID — `no-document`, the address kept, its window standing — never `starting` for good, never a failed source; ↻ asks for the address again", async () => {
      const p = await starting();
      // the engine: the load stops, nothing committed, nothing failed — and `loadURL` rejects ERR_FAILED
      p.blank(false);
      p.loads[0]?.reject(nothing());
      await flush();
      expect(p.result.runtime.summary.error).toBeUndefined();
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.window.isDestroyed()).toBe(false);
      expect(p.result.runtime.summary.browser).toEqual({
        url: FIRST,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        failure: { reason: "no-document" },
      });
      // ↻: the address is asked for again — by a load of it, never the engine's own reload (it reloads the blank)
      p.renderer.attachment.navigate?.({ action: "reload" });
      await flush();
      expect(p.window.loadedUrls).toEqual([FIRST, FIRST]);
      expect(p.window.navigations).toEqual([]);
      expect(p.result.runtime.summary.browser).toMatchObject({ url: FIRST, loading: true });
      expect(p.result.runtime.summary.browser?.failure).toBeUndefined();
      expect(p.result.runtime.stats.navigationDropped).toBe(0);
      // the promise's word ALONE (an engine that says nothing more) reads the same, once
      const q = await starting();
      q.loads[0]?.reject(nothing());
      await flush();
      expect(q.result.runtime.summary.state).toBe("starting");
      expect(q.result.runtime.summary.browser?.failure).toEqual({ reason: "no-document" });
      expect(q.window.isDestroyed()).toBe(false);
      p.result.runtime.dispose();
      q.result.runtime.dispose();
    });

    it("a page still STARTING can be SENT ELSEWHERE: it loads there in its own window and says where it is headed — the first load it supersedes is nothing", async () => {
      const p = await starting();
      expect(p.result.runtime.summary.state).toBe("starting");
      p.renderer.attachment.navigate?.({ action: "go", url: "https://example.test/elsewhere" });
      await flush();
      expect(p.window.loadedUrls).toEqual([FIRST, "https://example.test/elsewhere"]);
      expect(p.result.runtime.stats.navigationDropped).toBe(0);
      expect(p.result.runtime.summary.browser).toMatchObject({
        url: "https://example.test/elsewhere",
        loading: true,
      });
      // the first load, replaced: Electron rejects it — nothing is said of it
      p.loads[0]?.reject(aborted());
      await flush();
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.browser?.failure).toBeUndefined();
      expect(p.result.native.windows).toHaveLength(1);
      // an address the desk does not open is refused, as ever
      p.renderer.attachment.navigate?.({ action: "go", url: "file:///etc/passwd" });
      await flush();
      expect(p.result.runtime.stats.navigationDropped).toBe(1);
      // the page it was sent to arrives
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/elsewhere" });
      p.window.paint(sharedPaint().paint);
      p.loads[1]?.resolve();
      await flush();
      expect(p.result.runtime.summary.state).toBe("live");
      p.result.runtime.dispose();
    });

    it("a page still STARTING can be STOPPED: with no document of the page standing it SAYS so — `stopped`, its address kept, ↻ loads it again — and with its document standing a stop is only a stop", async () => {
      const p = await starting();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await flush();
      expect(p.window.navigations).toEqual(["stop"]);
      expect(p.result.runtime.stats.navigationDropped).toBe(0);
      // the engine: the load stops with nothing committed (and `loadURL` rejects)
      p.blank(false);
      p.loads[0]?.reject(nothing());
      await flush();
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.browser).toMatchObject({
        url: FIRST,
        loading: false,
        failure: { reason: "stopped" },
      });
      // ↻ with nothing standing: a load of the address
      p.renderer.attachment.navigate?.({ action: "reload" });
      await flush();
      expect(p.window.loadedUrls).toEqual([FIRST, FIRST]);
      expect(p.window.navigations).toEqual(["stop"]);
      expect(p.result.runtime.summary.browser?.failure).toBeUndefined();
      // …this load answers with nothing by itself (it is no page): THAT is said — the stop before it is over
      p.blank(true);
      p.blank(false);
      await flush();
      expect(p.result.runtime.summary.browser?.failure).toEqual({ reason: "no-document" });
      // a page whose document STANDS (a subresource still arriving): stopped, it is the page as far as it came
      const q = await starting();
      q.window.emitNavigationState({ ...NAV, url: FIRST, loading: true });
      q.renderer.attachment.navigate?.({ action: "stop" });
      await flush();
      expect(q.window.navigations).toEqual(["stop"]);
      q.window.emitNavigationState({ ...NAV, url: FIRST, loading: false });
      q.loads[0]?.reject(aborted());
      await flush();
      expect(q.result.runtime.summary.browser?.failure).toBeUndefined();
      // …and its ↻ is the engine's own reload
      q.renderer.attachment.navigate?.({ action: "reload" });
      await flush();
      expect(q.window.navigations).toEqual(["stop", "reload"]);
      p.result.runtime.dispose();
      q.result.runtime.dispose();
    });
  });

  describe("PT-5b3 (rulings 1, 2, 3) — a window not yet BORN, a device switch with no document, a load that ended", () => {
    const ELSEWHERE = "https://example.test/elsewhere";
    /** A laptop told it has TOUCH: the same density, and what the page is told of its device moved. */
    const TOUCH_LAPTOP: LiveSurfaceBrowserEmulationV1 = { ...LAPTOP, touchPoints: 5 };
    const laptopSource = () => ({ ...source(), deviceScaleFactor: 2, emulation: LAPTOP });
    /**
     * A page asked for live whose window is NOT BORN yet: its layout answers when the row says (`born()`). As Electron does
     * (the scratch probe `pt-5b3-probe/unborn.cjs`): a `loadURL`, or the engine's own reload, asked before that REJECTS
     * the bootstrap's promise — on which every layout of the native waits — so `born()` then FAILS the birth; a `stop`
     * asked there stops nothing and rejects nothing.
     */
    const hold = (window: FakeBrowserWindow): (() => Promise<void>) => {
      let held = true;
      let bootstrapRejected = false;
      const waiting: { resolve(): void; reject(error: Error): void }[] = [];
      const raster = window.setBackingRaster.bind(window);
      window.setBackingRaster = (async (...args: Parameters<typeof raster>) => {
        if (held)
          await new Promise<void>((resolve, reject) => {
            waiting.push({ resolve, reject });
          });
        return raster(...args);
      }) as typeof window.setBackingRaster;
      const load = window.loadURL.bind(window);
      window.loadURL = (url: string) => {
        if (held) bootstrapRejected = true;
        return load(url);
      };
      const navigate = window.navigate.bind(window);
      window.navigate = (action) => {
        if (held && action === "reload") bootstrapRejected = true;
        navigate(action);
      };
      return async (): Promise<void> => {
        held = false;
        for (const w of waiting.splice(0)) {
          if (bootstrapRejected) w.reject(aborted());
          else w.resolve();
        }
        await birthEnds();
      };
    };
    // (a source that names its device: its birth tells the device first, so the layout the row holds is asked a turn later)
    const unborn = async (options: Parameters<typeof setup>[0] = { source: laptopSource() }) => {
      const result = setup(options);
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window yet");
      const born = hold(window);
      await flush();
      return { result, renderer, window, born };
    };

    it("ruling 1 — a RELOAD taken before the window is born asks NOTHING of it (the load it asks for has not begun, and will): the born window loads the address ONCE, and the source is not failed", async () => {
      const p = await unborn();
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.window.loadedUrls).toEqual([]);
      p.renderer.attachment.navigate?.({ action: "reload" });
      await flush();
      expect(p.window.loadedUrls).toEqual([]);
      expect(p.window.navigations).toEqual([]);
      await p.born();
      expect(p.result.runtime.summary.state).not.toBe("failed");
      expect(p.result.runtime.summary.error).toBeUndefined();
      expect(p.result.native.windows).toHaveLength(1);
      expect(p.window.loadedUrls).toEqual([FIRST]);
      expect(p.result.runtime.stats.navigationDropped).toBe(0);
      p.result.runtime.dispose();
    });

    it("ruling 1 — a GO before the birth says where the page is headed and asks nothing of the window: the born window loads THAT, once", async () => {
      const p = await unborn();
      p.renderer.attachment.navigate?.({ action: "go", url: ELSEWHERE });
      await flush();
      expect(p.window.loadedUrls).toEqual([]);
      expect(p.result.runtime.summary.browser).toMatchObject({ url: ELSEWHERE, loading: true });
      // an address the desk does not open is refused, as ever — and changes nothing
      p.renderer.attachment.navigate?.({ action: "go", url: "file:///etc/passwd" });
      await flush();
      expect(p.result.runtime.stats.navigationDropped).toBe(1);
      await p.born();
      expect(p.result.runtime.summary.state).not.toBe("failed");
      expect(p.result.native.windows).toHaveLength(1);
      expect(p.window.loadedUrls).toEqual([ELSEWHERE]);
      p.result.runtime.dispose();
    });

    it("ruling 1 — a STOP before the birth is remembered: the born window is NOT loaded, the page says `stopped` at its address — and is not started again by the startup deadline; ↻ loads it. A ↻ or a go after the stop, still before the birth, is the load after all", async () => {
      vi.useFakeTimers();
      const p = await unborn();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await vi.advanceTimersByTimeAsync(0);
      // nothing is asked of a window that is not born — the engine's stop would stop nothing (the probe)
      expect(p.window.navigations).toEqual([]);
      expect(p.window.loadedUrls).toEqual([]);
      await p.born();
      await vi.advanceTimersByTimeAsync(0);
      expect(p.window.loadedUrls).toEqual([]);
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.browser).toEqual({
        url: FIRST,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        failure: { reason: "stopped" },
      });
      // (ruling 3: the window is up — it was born — and the person stopped it: nothing starts it again)
      await vi.advanceTimersByTimeAsync(60_000);
      expect(p.result.native.windows).toHaveLength(1);
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.browser?.failure).toEqual({ reason: "stopped" });
      p.renderer.attachment.navigate?.({ action: "reload" });
      await vi.advanceTimersByTimeAsync(0);
      expect(p.window.loadedUrls).toEqual([FIRST]);
      expect(p.result.runtime.summary.browser?.failure).toBeUndefined();
      // a stop, then ↻, both before the birth: the load after all
      const q = await unborn();
      q.renderer.attachment.navigate?.({ action: "stop" });
      q.renderer.attachment.navigate?.({ action: "reload" });
      await q.born();
      await vi.advanceTimersByTimeAsync(0);
      expect(q.window.loadedUrls).toEqual([FIRST]);
      expect(q.result.runtime.summary.browser?.failure).toBeUndefined();
      // a stop, then a go: it loads where it was sent
      const r = await unborn();
      r.renderer.attachment.navigate?.({ action: "stop" });
      r.renderer.attachment.navigate?.({ action: "go", url: ELSEWHERE });
      await r.born();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.window.loadedUrls).toEqual([ELSEWHERE]);
      p.result.runtime.dispose();
      q.result.runtime.dispose();
      r.result.runtime.dispose();
    });

    it("ruling 2 — a device switched to BEFORE the birth (the same density): the born window is told the device it should have before anything loads, and loads once — never the engine's reload (a page that has been somewhere before: woken from rest)", async () => {
      const p = await unborn({ source: laptopSource() });
      await p.born();
      p.window.emitNavigationState({ ...NAV });
      p.window.paint(sharedPaint().paint);
      await flush();
      expect(p.result.runtime.summary.state).toBe("live");
      // put to rest, and woken: its window is made anew — and is not born yet
      p.renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await flush();
      p.renderer.attachment.setDemand(demand(3, "live"));
      const woken = p.result.native.windows[1];
      if (woken === undefined) throw new Error("no second window");
      const born = hold(woken);
      await flush();
      await p.result.runtime.navigate({ action: "emulate", emulation: TOUCH_LAPTOP });
      await flush();
      expect(woken.loadedUrls).toEqual([]);
      await born();
      expect(p.result.runtime.summary.state).not.toBe("failed");
      expect(p.result.native.windows).toHaveLength(2);
      expect(woken.navigations).toEqual([]);
      expect(woken.loadedUrls).toEqual([FIRST]);
      // what the window was told LAST before its one load: the device it should have
      expect(woken.emulations.at(-1)?.touchPoints).toBe(5);
      expect(woken.order.lastIndexOf("emulate")).toBeLessThan(woken.order.indexOf("load"));
      expect(woken.order.filter((step) => step === "load")).toHaveLength(1);
      // (the remake is for a load under way on a BORN window: before the birth the window is told — none is made anew)
      expect(p.result.runtime.stats.windowsRemade).toBe(0);
      p.result.runtime.dispose();
    });

    it("ruling 2 — a device switch (the same density) on a page whose first address has NOT ANSWERED asks for the ADDRESS again, as that device — never the engine's own reload, which reloads the blank: its window is made anew (the engine takes none of a device's commands while a load is pending), and the page stays headed there, loading", async () => {
      const p = await starting({ source: laptopSource() });
      await p.result.runtime.navigate({ action: "emulate", emulation: TOUCH_LAPTOP });
      await flush();
      // nothing more was asked of the window whose load was pending — not the engine's reload, not a second load
      expect(p.window.navigations).toEqual([]);
      expect(p.window.loadedUrls).toEqual([FIRST]);
      expect(p.window.isDestroyed()).toBe(true);
      expect(p.result.runtime.stats.windowsRemade).toBe(1);
      // its window made anew: told the device it should have BEFORE its one load of the address
      expect(p.result.native.windows).toHaveLength(2);
      const anew = p.result.native.windows[1];
      if (anew === undefined) throw new Error("no window was made anew");
      expect(anew.emulations.at(-1)?.touchPoints).toBe(5);
      expect(anew.loadedUrls).toEqual([FIRST]);
      expect(anew.order.lastIndexOf("emulate")).toBeLessThan(anew.order.indexOf("load"));
      expect(anew.navigations).toEqual([]);
      // the load it replaced is nothing (its window is gone); the page is headed where it was — never "no page"
      p.loads[0]?.reject(aborted());
      await flush();
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.error).toBeUndefined();
      expect(p.result.runtime.summary.browser).toMatchObject({ url: FIRST, loading: true });
      expect(p.result.runtime.summary.browser?.failure).toBeUndefined();
      // a SCHEME alone is told live: no window is made, nothing is loaded
      const q = await starting({ source: laptopSource() });
      await q.result.runtime.navigate({
        action: "emulate",
        emulation: { ...LAPTOP, colorScheme: "dark" },
      });
      await flush();
      expect(q.result.native.windows).toHaveLength(1);
      expect(q.window.loadedUrls).toEqual([FIRST]);
      expect(q.window.navigations).toEqual([]);
      p.result.runtime.dispose();
      q.result.runtime.dispose();
    });

    it("ruling 2 — a device switch on a page that has SAID its load ended (`no-document`, `stopped`) tells it its device and loads NOTHING: what it said stands, word for word, and ↻ loads it on the new device", async () => {
      const p = await starting({ source: laptopSource() });
      p.blank(false);
      await flush();
      expect(p.result.runtime.summary.browser?.failure).toEqual({ reason: "no-document" });
      const said = p.result.runtime.summary.browser;
      await p.result.runtime.navigate({ action: "emulate", emulation: TOUCH_LAPTOP });
      await flush();
      expect(p.window.emulations.at(-1)?.touchPoints).toBe(5);
      expect(p.window.navigations).toEqual([]);
      expect(p.window.loadedUrls).toEqual([FIRST]);
      expect(p.result.runtime.summary.browser).toEqual(said);
      // (told on its own window: none is made anew)
      expect(p.result.native.windows).toHaveLength(1);
      expect(p.result.runtime.stats.windowsRemade).toBe(0);
      p.renderer.attachment.navigate?.({ action: "reload" });
      await flush();
      expect(p.window.loadedUrls).toEqual([FIRST, FIRST]);
      // …and one the person stopped stays `stopped`
      const q = await starting({ source: laptopSource() });
      q.renderer.attachment.navigate?.({ action: "stop" });
      q.blank(false);
      await flush();
      expect(q.result.runtime.summary.browser?.failure).toEqual({ reason: "stopped" });
      await q.result.runtime.navigate({ action: "emulate", emulation: TOUCH_LAPTOP });
      await flush();
      expect(q.window.navigations).toEqual(["stop"]);
      expect(q.window.loadedUrls).toEqual([FIRST]);
      expect(q.result.runtime.summary.browser?.failure).toEqual({ reason: "stopped" });
      expect(q.result.native.windows).toHaveLength(1);
      p.result.runtime.dispose();
      q.result.runtime.dispose();
    });

    it("ruling 2's neighbour — a page whose DOCUMENT STANDS, a navigation of it pending, its device switched (the same density): no window is made anew — its own window is told, and reloaded by the engine once its commands are answered (the engine holds them until the navigation commits)", async () => {
      const result = setup({ source: laptopSource() });
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await flush();
      await flush();
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window");
      window.paint(sharedPaint().paint);
      window.emitNavigationState({ ...NAV });
      await flush();
      // a navigation of the page that stands: asked, not committed — and the engine answers none of the device's
      // commands until it commits (the probe)
      renderer.attachment.navigate?.({ action: "go", url: ELSEWHERE });
      let commit: () => void = () => {};
      const tell = window.setEmulation.bind(window);
      window.setEmulation = async (emulation) => {
        await new Promise<void>((resolve) => {
          commit = resolve;
        });
        return tell(emulation);
      };
      await result.runtime.navigate({ action: "emulate", emulation: TOUCH_LAPTOP });
      await flush();
      expect(result.native.windows).toHaveLength(1);
      expect(result.runtime.stats.windowsRemade).toBe(0);
      expect(window.navigations).toEqual([]);
      // the navigation commits; the device's commands are answered; THEN the engine's reload, once, in the same window
      window.emitNavigationState({ ...NAV, url: ELSEWHERE });
      commit();
      await flush();
      await flush();
      await flush();
      expect(window.emulations.at(-1)?.touchPoints).toBe(5);
      expect(window.navigations).toEqual(["reload"]);
      expect(result.native.windows).toHaveLength(1);
      expect(result.runtime.stats.windowsRemade).toBe(0);
      result.runtime.dispose();
    });

    it("ruling 3 — a first load that ENDED with nothing before any paint of the window was heard meets the startup deadline: the page is not started again behind the person, nor failed as a source", async () => {
      vi.useFakeTimers();
      const p = await starting({}, { blankPaint: false });
      p.blank(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(p.result.runtime.summary.browser?.failure).toEqual({ reason: "no-document" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(p.result.native.windows).toHaveLength(1);
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.error).toBeUndefined();
      expect(p.result.runtime.summary.browser?.failure).toEqual({ reason: "no-document" });
      // (a page whose load has NOT ended and whose window never painted is the deadline's still: the window never came up)
      const q = await starting({}, { blankPaint: false });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(q.result.native.windows.length).toBeGreaterThan(1);
      p.result.runtime.dispose();
      q.result.runtime.dispose();
    });

    it("ruling 1's table — a STOP on a page that has said its load ended asks nothing and remembers nothing: a load that follows and ends with nothing by itself is `no-document`, never `stopped`", async () => {
      const p = await starting();
      p.blank(false);
      await flush();
      expect(p.result.runtime.summary.browser?.failure).toEqual({ reason: "no-document" });
      p.renderer.attachment.navigate?.({ action: "stop" });
      await flush();
      expect(p.window.navigations).toEqual([]);
      expect(p.result.runtime.summary.browser?.failure).toEqual({ reason: "no-document" });
      p.result.runtime.dispose();
    });
  });

  describe("PT-5b3 (ruling 4) — ONE notion of another document: the engine's serial, said with the page's state and with every frame", () => {
    it("a commit moves the serial — a move WITHIN a document does not, a failed load's error page does; a window made anew goes on counting; every frame says the document it is of", async () => {
      const result = setup();
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await flush();
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window");
      const said = (): number | undefined => result.runtime.summary.browser?.document;
      const stamped = (): unknown => renderer.textureFrames.at(-1)?.metadata.document;
      // no document of the page yet: none is said
      window.emitNavigationState({ ...NAV, url: "about:blank", title: "", loading: true });
      expect(result.runtime.summary.browser).not.toHaveProperty("document");
      window.emitNavigationState({ ...NAV });
      expect(said()).toBe(1);
      window.paint(sharedPaint().paint);
      await flush();
      expect(stamped()).toBe(1);
      // its address moves within the document — a hash; a script's replaceState to another path
      window.emitNavigationState({ ...NAV, url: `${NAV.url}#section` });
      expect(result.runtime.summary.browser).toMatchObject({
        url: `${NAV.url}#section`,
        document: 1,
      });
      window.emitNavigationState({ ...NAV, url: "https://example.test/tidied", document: 1 });
      expect(result.runtime.summary.browser).toMatchObject({
        url: "https://example.test/tidied",
        document: 1,
      });
      window.paint(sharedPaint().paint);
      expect(stamped()).toBe(1);
      // a load that begins is not yet another document; its commit is
      window.emitNavigationState({
        ...NAV,
        url: "https://example.test/tidied",
        loading: true,
        document: 1,
      });
      expect(said()).toBe(1);
      window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      expect(said()).toBe(2);
      window.paint(sharedPaint().paint);
      expect(stamped()).toBe(2);
      // a failed load: the engine's error page stands in the asked address's place
      window.emitNavigationState({ ...NAV, url: "https://dead.test/", failure: -102 });
      expect(result.runtime.summary.browser).toMatchObject({
        failure: { reason: "connection-refused" },
        document: 3,
      });
      // put to rest and woken: a window made anew — its first document is ANOTHER, never the first again. (PT-5c, ruling
      // 3: at rest, and in the new window before its first commit, no document of the page stands — none is said)
      renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await flush();
      expect(said()).toBeUndefined();
      renderer.attachment.setDemand(demand(3, "live"));
      await flush();
      const woken = result.native.windows[1];
      if (woken === undefined) throw new Error("no second window");
      woken.emitNavigationState({ ...NAV, url: "about:blank", title: "", loading: true });
      expect(said()).toBeUndefined();
      woken.emitNavigationState({ ...NAV, url: "https://dead.test/" });
      expect(woken.documents).toBe(1);
      expect(said()).toBe(4);
      woken.paint(sharedPaint().paint);
      await flush();
      expect(stamped()).toBe(4);
      result.runtime.dispose();
    });

    it("the CPU's frames say their document too", async () => {
      const result = setup({ cpuFallbackPaints: 1 });
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await flush();
      const window = result.native.windows[0];
      window?.emitNavigationState({ ...NAV });
      window?.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      window?.paint(cpuPaint().paint);
      await flush();
      expect(renderer.cpuFrames.at(-1)?.metadata.document).toBe(2);
      result.runtime.dispose();
    });

    it("the scale SAID for a document is ITS OWN: an address that moves within the document keeps it — a finger's move behind it goes at that scale — and another document's events go at ITS word (PT-5c: never read)", async () => {
      const result = setup({ source: phoneSource() });
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live", 30, { width: 1206, height: 2622 }));
      await flush();
      await flush();
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window");
      window.emitNavigationState({ ...NAV });
      window.paint(sharedPaint(1206, 2622).paint);
      await flush();
      const revision = result.runtime.summary.geometry?.revision ?? 0;
      const pointer = (action: "down" | "up" | "move", x: number): void =>
        renderer.attachment.dispatchInput?.(
          { kind: "pointer", action, x, y: 10, button: "left", clickCount: 1, buttons: 1 },
          revision,
        );
      window.say(0.5);
      pointer("down", 10);
      await delivered();
      expect(window.touchInputs.map((t) => t.type)).toEqual(["touchStart"]);
      // the page answers the touch by moving its address WITHIN the document (a router's pushState): its word stands
      window.emitNavigationState({ ...NAV, url: "https://example.test/app/route", document: 1 });
      pointer("move", 20);
      await delivered();
      expect(window.touchInputs.map((t) => t.type)).toEqual(["touchStart", "touchMove"]);
      expect(window.touchInputs.at(-1)?.touchPoints[0]).toMatchObject({ x: 40, y: 20 });
      // ANOTHER document commits: the finger is cancelled (PT-5c, ruling 1), and its press waits for the new one's word
      window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      pointer("down", 30);
      await delivered();
      expect(window.touchInputs.map((t) => t.type)).toEqual([
        "touchStart",
        "touchMove",
        "touchCancel",
      ]);
      window.say(1);
      await delivered();
      expect(window.touchInputs.at(-1)).toEqual({
        type: "touchStart",
        touchPoints: [{ x: 30, y: 10, id: 0 }],
      });
      result.runtime.dispose();
    });
  });

  const NONE = { shift: false, alt: false, ctrl: false, meta: false };
  /**
   * A page in the hand, live, its window's inputs kept in ONE list as they reach it — a phone's unless the row names
   * another device. Its window's dispatches run one behind another, each to its answer — as the native's HAND queue has
   * them (PT-5c, ruling 1: the device's commands are a queue of their own; the page's scale is SAID, never read here).
   */
  const phone = async (pageSource: ReturnType<typeof phoneSource> = phoneSource()) => {
    const result = setup({ source: pageSource });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 1206, height: 2622 }));
    await flush();
    await flush();
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    window.emitNavigationState({ ...NAV });
    // (PT-5c: the page says its scale — its guard's first words — before its first frame)
    window.say(1);
    window.paint(sharedPaint(1206, 2622).paint);
    await flush();
    const revision = result.runtime.summary.geometry?.revision ?? 0;
    const heard: string[] = [];
    let tail: Promise<unknown> = Promise.resolve();
    const queued =
      <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
      (...args: A): Promise<R> => {
        const answer = tail.then(
          () => run(...args),
          () => run(...args),
        );
        tail = answer.catch(() => undefined);
        return answer;
      };
    const touch = window.dispatchTouch.bind(window);
    window.dispatchTouch = queued(async (input) => {
      heard.push(input.type);
      await touch(input);
    });
    const mouse = window.dispatchMouse.bind(window);
    window.dispatchMouse = queued(async (input) => {
      heard.push(input.type);
      await mouse(input);
    });
    const key = window.dispatchKey.bind(window);
    window.dispatchKey = queued(async (input) => {
      heard.push(`${input.type} ${input.key}`);
      await key(input);
    });
    const text = window.dispatchText.bind(window);
    window.dispatchText = queued(async (typed) => {
      heard.push(`text ${typed}`);
      await text(typed);
    });
    const send = (
      input: Parameters<NonNullable<typeof renderer.attachment.dispatchInput>>[0],
      under: number = revision,
    ): void => renderer.attachment.dispatchInput?.(input, under);
    const pointer = (action: "down" | "up" | "move", x: number, under: number = revision): void =>
      send(
        {
          kind: "pointer",
          action,
          x,
          y: 10,
          ...(action === "move" ? {} : { button: "left" as const }),
          clickCount: 1,
        },
        under,
      );
    return {
      result,
      renderer,
      window,
      revision,
      heard,
      send,
      pointer,
      delivered,
    };
  };

  describe("PT-5b2 (ruling 4) — the hand's events reach the page in the order they were sent, whatever is awaited on the way", () => {
    it("a RELEASE sent while its press WAITS for its document's first word arrives AFTER it: the page hears a start and its end — never a finger left down (PT-5c: a wait for the page's word, where PT-5b2 had a read)", async () => {
      const p = await phone();
      // a first tap: the scale its page said
      p.pointer("down", 10);
      p.pointer("up", 10);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      // ANOTHER document, whose page has not said its scale yet. A second tap — its press, then its release BEFORE the word
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      p.pointer("down", 20);
      p.pointer("up", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      p.window.say(0.5);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd", "touchStart", "touchEnd"]);
      p.result.runtime.dispose();
    });

    it("a KEY and a text sent at once after a press arrive after it; and a dispatch that REJECTS does not break the chain", async () => {
      const p = await phone();
      // a new document, whose page has not said its scale yet
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      p.pointer("down", 10);
      p.send({ kind: "key", action: "down", key: "a", code: "KeyA", modifiers: NONE });
      p.send({ kind: "text", text: "a" });
      p.pointer("up", 10);
      await p.delivered();
      // nothing overtakes the press, which waits for its page's word
      expect(p.heard).toEqual([]);
      p.window.say(1);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "keyDown a", "text a", "touchEnd"]);
      // a key the window refuses (its command rejects): counted dropped — and the events behind it still arrive, in order
      const dropped = p.result.runtime.stats.inputDropped;
      const key = p.window.dispatchKey;
      p.window.dispatchKey = async () => {
        throw new Error("the page's debugger went");
      };
      p.send({ kind: "key", action: "down", key: "b", code: "KeyB", modifiers: NONE });
      p.send({ kind: "text", text: "c" });
      await p.delivered();
      p.window.dispatchKey = key;
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      expect(p.heard.at(-1)).toBe("text c");
      p.result.runtime.dispose();
    });
  });

  describe("PT-5b3 (rulings 5, 6) — a gesture ENDS; the scale's read is awaited in the chain", () => {
    /** A `mobile` page with a MOUSE (laid out as a phone's, shown at its own scale; no touch). */
    const mobileMouse = () => ({ ...phoneSource(), emulation: { ...PHONE, touchPoints: 0 } });
    const types = (p: Awaited<ReturnType<typeof phone>>): string[] =>
      p.window.touchInputs.map((t) => t.type);

    it("ruling 5 — an event is judged against the geometry it was SENT under, as it ARRIVES: a release queued behind its press is not refused because the geometry moved while it waited its turn", async () => {
      const p = await phone();
      // a new document whose page has not said its scale yet (PT-5c: the wait is for its word)
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      const dropped = p.result.runtime.stats.inputDropped;
      // a tap: its press takes its turn (and waits on its page), its release queues behind it — both sent under `revision`
      p.pointer("down", 20);
      p.pointer("up", 20);
      await p.delivered();
      // …and while they wait the page's raster moves (the pane put down: its rest rung) — a frame of another size lands
      p.window.paint(sharedPaint(603, 1311).paint);
      await p.delivered();
      expect(p.result.runtime.summary.geometry?.revision).not.toBe(p.revision);
      p.window.say(0.5);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped);
      p.result.runtime.dispose();
    });

    it("ruling 5 — a press sent under a geometry that has MOVED is refused as it arrives, counted, and NOTHING is down: its release is nothing (the page is not told of half a click, and nothing is counted), and a hover that follows is a hover", async () => {
      const p = await phone({
        ...phoneSource(),
        emulation: { ...PHONE, mobile: false, touchPoints: 0 },
      });
      p.window.paint(sharedPaint(603, 1311).paint);
      await p.delivered();
      const now = p.result.runtime.summary.geometry?.revision ?? 0;
      expect(now).not.toBe(p.revision);
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      p.pointer("up", 20);
      await p.delivered();
      expect(p.heard).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      p.pointer("move", 30, now);
      await p.delivered();
      expect(p.heard).toEqual(["mouseMoved"]);
      expect(p.window.mouseInputs.at(-1)).toMatchObject({ type: "mouseMoved", button: "none" });
      p.result.runtime.dispose();
    });

    it("ruling 5 — a RELEASE of what is down is ALWAYS sent: under a geometry that moved since its press; and to a page that is no longer live (the window that took the press, paused)", async () => {
      const p = await phone({
        ...phoneSource(),
        emulation: { ...PHONE, mobile: false, touchPoints: 0 },
      });
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual(["mousePressed"]);
      // the raster moves under the button (a frame of another size): the release still names the revision it was sent under
      p.window.paint(sharedPaint(603, 1311).paint);
      await p.delivered();
      p.pointer("up", 22);
      await p.delivered();
      expect(p.heard).toEqual(["mousePressed", "mouseReleased"]);
      expect(p.window.mouseInputs.at(-1)).toMatchObject({
        type: "mouseReleased",
        x: 22,
        y: 10,
        button: "left",
      });
      // a button down, and the pane goes out of view: the page is PAUSED when its release arrives
      const now = p.result.runtime.summary.geometry?.revision ?? 0;
      p.pointer("down", 40, now);
      await p.delivered();
      p.renderer.attachment.setDemand(demand(2, "paused", 0));
      await p.delivered();
      expect(p.result.runtime.summary.state).toBe("paused");
      p.pointer("up", 40, now);
      await p.delivered();
      expect(p.heard).toEqual(["mousePressed", "mouseReleased", "mousePressed", "mouseReleased"]);
      // …and a press there is refused, as ever: nobody is looking
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 40, now);
      await p.delivered();
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      expect(p.heard).toHaveLength(4);
      p.result.runtime.dispose();
    });

    it("ruling 5 — a touch's END carries no point and asks nothing; PT-5c (ruling 1): a finger down when ANOTHER document commits under it is cancelled THERE — its late release is nothing, and a hover after it is nothing a finger does", async () => {
      const p = await phone();
      p.window.say(0.5);
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart"]);
      p.pointer("up", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      expect(types(p)).toEqual(["touchStart", "touchEnd"]);
      expect(p.window.touchInputs.at(-1)?.touchPoints).toEqual([]);
      // a finger down; ANOTHER document commits under it (its page not yet speaking): cancelled at the commit
      p.pointer("down", 20);
      await p.delivered();
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      p.pointer("up", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd", "touchStart", "touchCancel"]);
      // a hover after it is nothing a finger does: the page is told of no move
      p.pointer("move", 30);
      await p.delivered();
      expect(p.heard).toHaveLength(4);
      p.result.runtime.dispose();
    });

    it("ruling 5 — a mouse's release goes at the scale its PRESS went at: a `mobile` page shown at 0.5 that zooms while the button is down (PT-5c: the scale said, never read)", async () => {
      const p = await phone(mobileMouse());
      p.window.say(0.5);
      p.pointer("down", 20);
      await p.delivered();
      expect(p.window.mouseInputs.at(-1)).toMatchObject({ type: "mousePressed", x: 40, y: 20 });
      // the page zooms while the button is down: the release goes where its press did — at the press's scale
      p.window.say(1);
      p.pointer("up", 30);
      await p.delivered();
      expect(p.heard).toEqual(["mousePressed", "mouseReleased"]);
      expect(p.window.mouseInputs.at(-1)).toMatchObject({ type: "mouseReleased", x: 60, y: 20 });
      p.result.runtime.dispose();
    });

    it("ruling 6, PT-5c (ruling 1) — a press on a document whose page has not yet SAID its scale waits — within its second (R2: the net; a page silent past it has the press refused, its own row) — and lands at the scale it says; its release behind it; nothing is dropped while it waits", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(2_000_000);
      const p = await phone();
      // ANOTHER document, just loaded and hydrating: its page has not said its scale yet
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      p.pointer("up", 20);
      await vi.advanceTimersByTimeAsync(900);
      expect(p.heard).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped);
      p.window.say(0.25);
      await vi.advanceTimersByTimeAsync(0);
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      expect(p.window.touchInputs.at(-2)?.touchPoints[0]).toMatchObject({ x: 80, y: 40 });
      // a second tap, at once: both heard, in order
      p.pointer("down", 20);
      p.pointer("up", 20);
      await vi.advanceTimersByTimeAsync(0);
      expect(p.heard).toEqual(["touchStart", "touchEnd", "touchStart", "touchEnd"]);
      p.result.runtime.dispose();
    });

    /**
     * A laptop's page, live, its window's inputs kept as they reach it — and ITS RESTART: the renderer crashed, a window
     * made again for it (the producer's own reconnect), that window's first frame painted.
     */
    const crashing = async () => {
      vi.useFakeTimers();
      const result = setup();
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await vi.advanceTimersByTimeAsync(0);
      const first = result.native.windows[0];
      if (first === undefined) throw new Error("no window");
      first.paint(sharedPaint().paint);
      await vi.advanceTimersByTimeAsync(0);
      const key = (k: string, revision: number): void =>
        renderer.attachment.dispatchInput?.(
          { kind: "key", action: "down", key: k, code: `Key${k.toUpperCase()}`, modifiers: NONE },
          revision,
        );
      const press = (revision: number): void =>
        renderer.attachment.dispatchInput?.(
          { kind: "pointer", action: "down", x: 10, y: 10, button: "left", clickCount: 1 },
          revision,
        );
      const restart = async () => {
        first.crash();
        await vi.advanceTimersByTimeAsync(0);
        const second = result.native.windows[1];
        if (second === undefined) throw new Error("no window was made again");
        second.paint(sharedPaint().paint);
        await vi.advanceTimersByTimeAsync(0);
        return second;
      };
      return { result, renderer, first, key, press, restart };
    };

    it("ruling 5 — a turn pending on a window that has GONE ends with it: a key the crashed page never answered does not hold the page that replaced it — a key sent to the new page arrives", async () => {
      const p = await crashing();
      // the page never answers this key (its renderer is about to go)
      p.first.dispatchKey = () => new Promise<void>(() => {});
      p.key("a", p.result.runtime.summary.geometry?.revision ?? 0);
      await vi.advanceTimersByTimeAsync(0);
      const second = await p.restart();
      expect(p.result.runtime.summary.state).toBe("live");
      p.key("b", p.result.runtime.summary.geometry?.revision ?? 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(second.keyInputs.map((k) => k.key)).toEqual(["b"]);
      p.result.runtime.dispose();
    });

    it("ruling 5 — an event is FOR THE WINDOW that stood when it was sent: a press and a key queued behind a key the crashed page was slow to take are never delivered to the page that replaced it — nor asked of the window that is gone — refused at their turn, counted", async () => {
      const p = await crashing();
      // the crashed page's first key is answered only when the row says — after the page that replaces it is live; what
      // its window is asked after that, it records
      let answer: () => void = () => {};
      const asked: string[] = [];
      p.first.dispatchKey = (input) => {
        asked.push(input.key);
        return asked.length > 1
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              answer = resolve;
            });
      };
      const revision = p.result.runtime.summary.geometry?.revision ?? 0;
      p.key("a", revision);
      // a press and a key sent to the same page, judged at their arrival against the geometry they were sent under: they
      // stand — and wait their turn behind the key
      p.press(revision);
      p.key("z", revision);
      await vi.advanceTimersByTimeAsync(0);
      const dropped = p.result.runtime.stats.inputDropped;
      const second = await p.restart();
      answer();
      await vi.advanceTimersByTimeAsync(0);
      expect(second.mouseInputs).toEqual([]);
      expect(second.keyInputs).toEqual([]);
      expect(p.first.mouseInputs).toEqual([]);
      expect(asked).toEqual(["a"]);
      // (counted: the key whose window went from under it, and the press and the key refused at their turn)
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 3);
      p.result.runtime.dispose();
    });
  });

  it("PT-4: a press on a touch device's page is a TOUCH — its moves while it is down, its release its end; a hover and another button are nothing; the wheel stays the page's scroll", async () => {
    const result = setup({ source: phoneSource() });
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live", 30, { width: 1206, height: 2622 }));
    await flush();
    await flush();
    const window = result.native.windows[0];
    // (PT-5c: the page says its scale — its guard's first words)
    window?.say(1);
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
    await delivered();
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
    await delivered();
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

  it("PT-5b3 (ruling 7 c): a LIVE page sent by its link or a script to an ATTACHMENT is not loading for good — the engine begins a load, refuses the download, and stops it at once (the probe): the page's state reads `loading: false`, at its own address, in its own document, the refusal said", async () => {
    const result = setup();
    const renderer = attach(result.runtime);
    renderer.attachment.setDemand(demand(1, "live"));
    await flush();
    const window = result.native.windows[0];
    if (window === undefined) throw new Error("no window");
    window.paint(sharedPaint(640, 360).paint);
    window.emitNavigationState(NAV);
    expect(result.runtime.summary.browser).toMatchObject({
      url: NAV.url,
      loading: false,
      document: 1,
    });
    // its link pressed (or its script's `location.href`): Electron 43 — did-start-loading, will-navigate to the file,
    // the download cancelled by the session's guard, did-stop-loading 2–6 ms on; `isLoading()` false; nothing commits
    window.emitNavigationState({ ...NAV, loading: true, document: 1 });
    expect(result.runtime.summary.browser).toMatchObject({ loading: true });
    window.refuse("download");
    window.emitNavigationState({ ...NAV, loading: false, document: 1 });
    expect(result.runtime.summary.browser).toEqual({
      url: NAV.url,
      title: NAV.title,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      document: 1,
      refused: { what: "download", serial: 1 },
    });
    expect(renderer.summaries.at(-1)?.browser?.loading).toBe(false);
    result.runtime.dispose();
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
    // (PT-5b3: the engine's error page stands in the asked address's place — a document, the window's first)
    expect(result.runtime.summary.browser).toEqual({
      url: "https://example.test/app",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      failure: { reason: "connection-refused" },
      document: 1,
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
      document: 2,
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

  describe("PT-5c — the chain finished: every event for the document it was sent to; what the third grade found", () => {
    /** A laptop's page, live, its first frame shown: its window, its geometry's revision, a key sent under a revision. */
    const laptop = async () => {
      const result = setup();
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await delivered();
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window");
      window.emitNavigationState({ ...NAV });
      window.paint(sharedPaint().paint);
      await delivered();
      const key = (action: "down" | "up", under: number, key = "a"): void =>
        renderer.attachment.dispatchInput?.(
          { kind: "key", action, key, code: `Key${key.toUpperCase()}`, modifiers: NONE },
          under,
        );
      return { result, renderer, window, key };
    };

    it("ruling 1 (P4) — an event with NO POINT is never judged by a geometry: a key's release, a word typed and a composition sent under the frame before one of another size landed all reach the page — no key is left down", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      p.key("down", r);
      await delivered();
      // a frame of another size lands (a desk zoom moved the raster's rung, the pane was resized)
      p.window.paint(sharedPaint(603, 1311).paint);
      await delivered();
      expect(p.result.runtime.summary.geometry?.revision).toBe(r + 1);
      const dropped = p.result.runtime.stats.inputDropped;
      p.key("up", r);
      p.renderer.attachment.dispatchInput?.({ kind: "text", text: "é" }, r);
      p.renderer.attachment.dispatchInput?.({ kind: "compose", text: "か", caret: 1 }, r);
      await delivered();
      expect(p.window.keyInputs.map((k) => k.type)).toEqual(["keyDown", "keyUp"]);
      expect(p.window.textInputs).toEqual(["é"]);
      expect(p.window.compositions).toEqual([{ text: "か", caret: 1 }]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped);
      // a press aimed at the frame before is still refused: its point names a place in a frame that is not there
      p.renderer.attachment.dispatchInput?.(
        { kind: "pointer", action: "down", x: 10, y: 10, button: "left", clickCount: 1 },
        r,
      );
      await delivered();
      expect(p.window.mouseInputs).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      p.result.runtime.dispose();
    });

    const NEXT = "https://example.test/next";

    it("ruling 1 — an event is for the DOCUMENT that stood when it was sent: a press and a key queued behind a key the page was slow to take are never delivered to the document that committed meanwhile — refused at their turn, counted", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      // the page takes its first key when the row says
      let answer: () => void = () => {};
      const keys: string[] = [];
      const key = p.window.dispatchKey.bind(p.window);
      p.window.dispatchKey = (input) => {
        keys.push(`${input.type} ${input.key}`);
        return keys.length > 1
          ? key(input)
          : new Promise<void>((resolve) => {
              answer = resolve;
            });
      };
      p.key("down", r, "a");
      await delivered();
      p.renderer.attachment.dispatchInput?.(
        { kind: "pointer", action: "down", x: 10, y: 10, button: "left", clickCount: 1 },
        r,
      );
      p.key("down", r, "z");
      await delivered();
      const dropped = p.result.runtime.stats.inputDropped;
      // ANOTHER document commits (a link the page followed, a redirect, a reload)
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      answer();
      await delivered();
      expect(p.window.mouseInputs).toEqual([]);
      expect(keys).toEqual(["keyDown a"]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 2);
      p.result.runtime.dispose();
    });

    it("ruling 1 — a FINGER down when another document commits is CANCELLED (the engine holds a touch open across a commit — the next document is deaf to touch without it: the probe); nothing is down; the hand's late release is nothing, and the next tap is heard whole", async () => {
      const p = await phone();
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart"]);
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchCancel"]);
      expect(p.window.touchInputs.at(-1)).toEqual({ type: "touchCancel", touchPoints: [] });
      // the hand lifts the finger it had down: nothing — what was down ended at the commit
      p.pointer("up", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchCancel"]);
      // the next document says its scale; a tap on it is heard whole
      p.window.say(1);
      p.pointer("down", 30);
      p.pointer("up", 30);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchCancel", "touchStart", "touchEnd"]);
      p.result.runtime.dispose();
    });

    it("ruling 1 — a BUTTON down when another document commits is FORGOTTEN — nothing sent (a release after the commit is a stray mouseup in the next document: the probe); the hand's late release is nothing", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      const pointer = (action: "down" | "up"): void =>
        p.renderer.attachment.dispatchInput?.(
          { kind: "pointer", action, x: 10, y: 10, button: "left", clickCount: 1 },
          r,
        );
      pointer("down");
      await delivered();
      expect(p.window.mouseInputs.map((m) => m.type)).toEqual(["mousePressed"]);
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      await delivered();
      pointer("up");
      await delivered();
      expect(p.window.mouseInputs.map((m) => m.type)).toEqual(["mousePressed"]);
      p.result.runtime.dispose();
    });

    it("ruling 1 — a touchStart ANSWERED after another document committed is cancelled at once: nothing is set down — the next hover is nothing", async () => {
      const p = await phone();
      let answer: () => void = () => {};
      p.window.dispatchTouch = (input) => {
        p.heard.push(input.type);
        if (input.type !== "touchStart") return Promise.resolve();
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      };
      p.pointer("down", 20);
      await p.delivered();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      await p.delivered();
      answer();
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchCancel"]);
      p.window.say(1);
      p.pointer("move", 30);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchCancel"]);
      p.result.runtime.dispose();
    });

    it("ruling 1 — the scale is FOLLOWED: the page SAYS it (its guard's word) and nothing reads the engine on the hand's path — a press goes at the scale said; a zoom the page makes (a double tap it answers by zooming) is said, and the next press goes at it", async () => {
      const p = await phone();
      p.window.say(0.5);
      p.pointer("down", 20);
      p.pointer("up", 20);
      await p.delivered();
      expect(
        p.window.touchInputs.filter((t) => t.type === "touchStart").at(-1)?.touchPoints[0],
      ).toMatchObject({ x: 40, y: 20 });
      p.window.say(2);
      p.pointer("down", 20);
      p.pointer("up", 20);
      await p.delivered();
      expect(
        p.window.touchInputs.filter((t) => t.type === "touchStart").at(-1)?.touchPoints[0],
      ).toMatchObject({ x: 10, y: 5 });
      p.result.runtime.dispose();
    });

    it("ruling 1 — a press on a NEW document whose page has not yet said its scale WAITS for the page's first word, and lands at it; with no word, the next commit ends the wait — refused, counted, and its release is nothing; and so does the window's going", async () => {
      const p = await phone();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      p.pointer("down", 20);
      p.pointer("up", 20);
      await p.delivered();
      expect(p.heard).toEqual([]);
      p.window.say(0.5);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      expect(p.window.touchInputs.at(-2)?.touchPoints[0]).toMatchObject({ x: 40, y: 20 });
      // a newer document, no word of it; ANOTHER commits before any: the press is refused, its release is nothing
      p.window.emitNavigationState({ ...NAV, url: `${NEXT}/2` });
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      p.pointer("up", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      p.window.emitNavigationState({ ...NAV, url: `${NEXT}/3` });
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      expect(p.result.runtime.stats.inputDropped).toBeGreaterThanOrEqual(dropped + 1);
      // and a press waiting so when its window goes (a rest): its turn ends, nothing is heard
      p.pointer("down", 20);
      await p.delivered();
      p.renderer.attachment.setDemand(demand(3, "hibernated", 0));
      await p.delivered();
      expect(p.result.runtime.summary.state).toBe("hibernated");
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      p.result.runtime.dispose();
    });

    /** A second attachment of the same page, live, its first frame laid again — what the attachment that comes back is. */
    const again = async (
      runtime: BrowserLiveSurfaceRuntime,
      window: FakeBrowserWindow,
      size: { width: number; height: number },
    ) => {
      const back = attach(runtime, "attachment_browser_00000002");
      back.attachment.setDemand(demand(2, "live", 30, size));
      await delivered();
      window.paint(sharedPaint(size.width, size.height).paint);
      await delivered();
      const revision = runtime.summary.geometry?.revision ?? 0;
      const move = (x: number): void =>
        back.attachment.dispatchInput?.(
          { kind: "pointer", action: "move", x, y: 10, clickCount: 1 },
          revision,
        );
      return { back, move, revision };
    };

    it("ruling 1 — a press waits for ITS document's word: a word the window tags with ANOTHER document (its count moved, the commit not yet heard — an order the probe never saw, every word came after its document's `did-navigate`) releases nothing; the commit then refuses the press, and the next document's events go at that word", async () => {
      const p = await phone();
      // a new document whose page has not said its scale: the press waits
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual([]);
      p.window.documents += 1;
      p.window.say(0.5);
      await p.delivered();
      expect(p.heard).toEqual([]);
      p.window.emitNavigationState({ ...NAV, url: `${NEXT}/2`, document: p.window.documents });
      await p.delivered();
      expect(p.heard).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      p.pointer("down", 20);
      await p.delivered();
      expect(p.window.touchInputs.at(-1)).toEqual({
        type: "touchStart",
        touchPoints: [{ x: 40, y: 20, id: 0 }],
      });
      p.result.runtime.dispose();
    });

    it("ruling 1 — a press whose word came in the SAME turn as another document's commit (the word, then the commit, before the press's turn goes on) is refused: the document it was sent for went before it could be sent", async () => {
      const p = await phone();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual([]);
      p.window.say(1);
      p.window.emitNavigationState({ ...NAV, url: `${NEXT}/2` });
      await p.delivered();
      expect(p.heard).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      p.result.runtime.dispose();
    });

    it("ruling 1 — a page RECONNECTED (its renderer gone, a window made anew) follows its NEW window's word: a press there goes at the scale the new page says", async () => {
      vi.useFakeTimers();
      const p = await phone();
      p.window.crash();
      await vi.advanceTimersByTimeAsync(0);
      const second = p.result.native.windows[1];
      if (second === undefined) throw new Error("no window was made again");
      await birthEnds();
      second.emitNavigationState({ ...NAV });
      second.say(0.5);
      second.paint(sharedPaint(1206, 2622).paint);
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      expect(p.result.runtime.summary.state).toBe("live");
      p.pointer("down", 20, p.result.runtime.summary.geometry?.revision ?? 0);
      await delivered();
      expect(second.touchInputs).toEqual([
        { type: "touchStart", touchPoints: [{ x: 40, y: 20, id: 0 }] },
      ]);
      p.result.runtime.dispose();
    });

    it("ruling 2 (P3) — a FINGER down when the attachment that sent its press GOES is CANCELLED: the page hears its touchCancel — never a touchEnd, which would be a tap — nothing is down, and the attachment that comes back hovers", async () => {
      const p = await phone();
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart"]);
      // the app's window reloads: the attachment goes, the page is kept through the grace (paused) — and told
      p.renderer.attachment.dispose();
      await p.delivered();
      expect(p.result.runtime.summary.state).toBe("paused");
      expect(p.heard).toEqual(["touchStart", "touchCancel"]);
      expect(p.window.touchInputs.at(-1)).toEqual({ type: "touchCancel", touchPoints: [] });
      // the attachment that comes back: its first move is a hover — on a touch page, nothing
      const b = await again(p.result.runtime, p.window, { width: 1206, height: 2622 });
      b.move(30);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchCancel"]);
      p.result.runtime.dispose();
    });

    it("ruling 2 — a BUTTON down when the attachment that sent its press goes is released OUTSIDE the page's view — never over what was pressed (at its point, even with clickCount 0, the engine clicks it: the probe); the next move has no button down", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      p.renderer.attachment.dispatchInput?.(
        { kind: "pointer", action: "down", x: 12, y: 8, button: "left", clickCount: 1 },
        r,
      );
      await delivered();
      expect(p.window.mouseInputs.map((m) => m.type)).toEqual(["mousePressed"]);
      p.renderer.attachment.dispose();
      await delivered();
      expect(p.window.mouseInputs.at(-1)).toEqual({
        type: "mouseReleased",
        x: -1000,
        y: -1000,
        button: "left",
      });
      const b = await again(p.result.runtime, p.window, { width: 640, height: 360 });
      b.move(30);
      await delivered();
      expect(p.window.mouseInputs.map((m) => m.type)).toEqual([
        "mousePressed",
        "mouseReleased",
        "mouseMoved",
      ]);
      // a release the hand sends later — of a press it no longer holds — is nothing
      b.back.attachment.dispatchInput?.(
        { kind: "pointer", action: "up", x: 30, y: 10, button: "left", clickCount: 1 },
        b.revision,
      );
      await delivered();
      expect(p.window.mouseInputs).toHaveLength(3);
      p.result.runtime.dispose();
    });

    it("ruling 2 — a gesture pressed through ANOTHER attachment is not released when this one goes (a second window shows the pane); R1 — a press of the going attachment still WAITING for its page's word is never sent: its wait ends, refused, counted", async () => {
      const p = await phone();
      // the second window's attachment presses
      const other = attach(p.result.runtime, "attachment_browser_00000002");
      other.attachment.setDemand(demand(2, "live", 30, { width: 1206, height: 2622 }));
      await p.delivered();
      other.attachment.dispatchInput?.(
        { kind: "pointer", action: "down", x: 20, y: 10, button: "left", clickCount: 1 },
        p.revision,
      );
      await p.delivered();
      expect(p.heard).toEqual(["touchStart"]);
      // the FIRST window's attachment goes: the finger is the other's — nothing is sent
      p.renderer.attachment.dispose();
      await p.delivered();
      expect(p.heard).toEqual(["touchStart"]);
      // the other lifts it: the page hears its end
      other.attachment.dispatchInput?.(
        { kind: "pointer", action: "up", x: 20, y: 10, button: "left", clickCount: 1 },
        p.revision,
      );
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      // a press of the other attachment takes its turn and waits on its page (a new document, its page not yet speaking);
      // the attachment goes before it is sent: its wait ENDS there (R1 — the page never hears a gesture begin after its
      // attachment went). A third window shows the pane, so the page stays LIVE: its going alone ends the wait
      const third = attach(p.result.runtime, "attachment_browser_00000003");
      third.attachment.setDemand(demand(3, "live", 30, { width: 1206, height: 2622 }));
      await p.delivered();
      p.window.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      const dropped = p.result.runtime.stats.inputDropped;
      other.attachment.dispatchInput?.(
        { kind: "pointer", action: "down", x: 20, y: 10, button: "left", clickCount: 1 },
        p.revision,
      );
      await p.delivered();
      other.attachment.dispose();
      await p.delivered();
      expect(p.result.runtime.summary.state).toBe("live");
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      // its page's word, after: nothing — the press is gone
      p.window.say(1);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchEnd"]);
      p.result.runtime.dispose();
    });

    it("ruling 2 — a press already SENT when its attachment goes (its answer not yet back) is released AFTER it: `letGo` takes its turn behind every event its attachment sent — the page never keeps a finger it pressed", async () => {
      const p = await phone();
      let answer: () => void = () => {};
      p.window.dispatchTouch = (input) => {
        p.heard.push(input.type);
        if (input.type !== "touchStart") return Promise.resolve();
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      };
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart"]);
      p.renderer.attachment.dispose();
      await p.delivered();
      answer();
      await p.delivered();
      expect(p.heard).toEqual(["touchStart", "touchCancel"]);
      p.result.runtime.dispose();
    });

    it("ruling 2 — a BUTTON pressed through ANOTHER attachment stands when this one goes (a second window shows the pane): nothing is released; the other's own release lifts it, at its own point", async () => {
      const p = await laptop();
      const other = attach(p.result.runtime, "attachment_browser_00000002");
      other.attachment.setDemand(demand(2, "live"));
      await delivered();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      const pointer = (action: "down" | "up"): void =>
        other.attachment.dispatchInput?.(
          { kind: "pointer", action, x: 12, y: 8, button: "left", clickCount: 1 },
          r,
        );
      pointer("down");
      await delivered();
      expect(p.window.mouseInputs.map((m) => m.type)).toEqual(["mousePressed"]);
      p.renderer.attachment.dispose();
      await delivered();
      expect(p.window.mouseInputs.map((m) => m.type)).toEqual(["mousePressed"]);
      pointer("up");
      await delivered();
      expect(p.window.mouseInputs.at(-1)).toMatchObject({
        type: "mouseReleased",
        x: 12,
        y: 8,
        button: "left",
      });
      p.result.runtime.dispose();
    });

    /** A laptop's page live at its first document (1), its window the first. */
    const standing = async (options: Parameters<typeof setup>[0] = {}) => {
      const result = setup(options);
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await delivered();
      const first = result.native.windows[0];
      if (first === undefined) throw new Error("no window");
      first.emitNavigationState({ ...NAV });
      first.paint(sharedPaint().paint);
      await delivered();
      expect(result.runtime.summary.browser?.document).toBe(1);
      return { result, renderer, first };
    };

    it("ruling 3 (P1c) — a window made ANEW (another density) says NO document until its own first commit — sent elsewhere meanwhile, none either, never the one its old window stood; at its commit, the next", async () => {
      const p = await standing({
        source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP },
      });
      await p.result.runtime.navigate({
        action: "emulate",
        emulation: { ...LAPTOP, deviceScaleFactor: 3 },
      });
      await delivered();
      expect(p.result.native.windows).toHaveLength(2);
      expect(p.result.runtime.summary.browser?.document).toBeUndefined();
      await p.result.runtime.navigate({ action: "go", url: "https://example.test/elsewhere" });
      await delivered();
      expect(p.result.runtime.summary.browser).toMatchObject({
        url: "https://example.test/elsewhere",
        loading: true,
      });
      expect(p.result.runtime.summary.browser?.document).toBeUndefined();
      const made = p.result.native.windows[1];
      if (made === undefined) throw new Error("no window was made anew");
      made.emitNavigationState({ ...NAV, url: "https://example.test/elsewhere" });
      expect(p.result.runtime.summary.browser?.document).toBe(2);
      p.result.runtime.dispose();
    });

    it("ruling 3 — a page at REST says no document; SENT ELSEWHERE at rest, none (P1b's door); woken, none until its window commits — and a load that ENDED with nothing says none", async () => {
      const p = await standing();
      p.renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await delivered();
      expect(p.result.runtime.summary.state).toBe("hibernated");
      expect(p.result.runtime.summary.browser?.document).toBeUndefined();
      await p.result.runtime.navigate({ action: "go", url: "https://example.test/next" });
      expect(p.result.runtime.summary.browser).toMatchObject({ url: "https://example.test/next" });
      expect(p.result.runtime.summary.browser?.document).toBeUndefined();
      p.renderer.attachment.setDemand(demand(3, "live"));
      await delivered();
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.browser?.document).toBeUndefined();
      const woken = p.result.native.windows[1];
      if (woken === undefined) throw new Error("no window at the wake");
      // its load ends with nothing (an attachment): still none — its blank is no page
      const blank = (loading: boolean): void =>
        woken.emitNavigationState({
          url: "about:blank",
          title: "about:blank",
          loading,
          canGoBack: false,
          canGoForward: false,
        });
      blank(true);
      blank(false);
      expect(p.result.runtime.summary.browser).toMatchObject({
        failure: { reason: "no-document" },
      });
      expect(p.result.runtime.summary.browser?.document).toBeUndefined();
      woken.emitNavigationState({ ...NAV, url: "https://example.test/next" });
      expect(p.result.runtime.summary.browser?.document).toBe(2);
      p.result.runtime.dispose();
    });

    it("ruling 4 (my O) — a device switch DURING a window's birth (another device of the same density, its pane re-shaped): the re-birth lays the window out at the layout the page should have NOW — never the one asked before the switch, last", async () => {
      vi.useFakeTimers();
      const result = setup({
        source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP },
        rasterStabilizationMs: 50,
      });
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(
        demand(1, "live", 30, { width: 640, height: 400 }, { width: 320, height: 200 }),
      );
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window yet");
      // the birth's own layout answers when the row says (its first ask only)
      let born: () => void = () => {};
      let held = true;
      const raster = window.setBackingRaster.bind(window);
      window.setBackingRaster = (async (...args: Parameters<typeof raster>) => {
        if (held) {
          held = false;
          await new Promise<void>((resolve) => {
            born = resolve;
          });
        }
        return raster(...args);
      }) as typeof window.setBackingRaster;
      await vi.advanceTimersByTimeAsync(0);
      // during the birth the pane becomes a tablet — the same density, another device, its view re-shaped
      renderer.attachment.setDemand(
        demand(2, "live", 30, { width: 1640, height: 2360 }, { width: 820, height: 1180 }),
      );
      await result.runtime.navigate({ action: "emulate", emulation: TABLET });
      // the new layout's own debounce runs out while the birth is still held
      await vi.advanceTimersByTimeAsync(100);
      born();
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      await vi.advanceTimersByTimeAsync(500);
      await delivered();
      expect(window.rasterViewports.at(-1)).toEqual({ width: 820, height: 1180 });
      expect(window.backingRasters.at(-1)).toEqual({ width: 1640, height: 2360 });
      window.emitNavigationState({ ...NAV });
      window.paint(sharedPaint(1640, 2360).paint);
      await delivered();
      expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 820, height: 1180 });
      result.runtime.dispose();
    });

    it("ruling 4 — the FIRST birth's own order (the reviewer's caveat): its device told only after the bootstrap — past the demand's debounce on a busy Mac — then its layout; the demand moved meanwhile and its actuation laid first: the birth lays the layout as it stands, never the start's last", async () => {
      vi.useFakeTimers();
      const result = setup({
        source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP },
        rasterStabilizationMs: 50,
      });
      // the bootstrap is slow: the window's device is told when the row says (held from the window's making)
      let told: () => void = () => {};
      const make = result.native.createWindow.bind(result.native);
      result.native.createWindow = (options) => {
        const made = make(options) as FakeBrowserWindow;
        const emulate = made.setEmulation.bind(made);
        made.setEmulation = async (emulation) => {
          await new Promise<void>((resolve) => {
            told = resolve;
          });
          return emulate(emulation);
        };
        return made;
      };
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(
        demand(1, "live", 30, { width: 640, height: 400 }, { width: 320, height: 200 }),
      );
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window yet");
      await vi.advanceTimersByTimeAsync(0);
      expect(window.rasterViewports).toEqual([]);
      // the pane is re-shaped; its actuation lays the new layout while the birth still waits on its device
      renderer.attachment.setDemand(
        demand(2, "live", 30, { width: 1000, height: 800 }, { width: 500, height: 400 }),
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(window.rasterViewports).toEqual([{ width: 500, height: 400 }]);
      told();
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      expect(window.loadedUrls).toEqual(["https://example.test/app"]);
      expect(window.rasterViewports.at(-1)).toEqual({ width: 500, height: 400 });
      expect(window.backingRasters.at(-1)).toEqual({ width: 1000, height: 800 });
      window.emitNavigationState({ ...NAV });
      window.paint(sharedPaint(1000, 800).paint);
      await delivered();
      expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 500, height: 400 });
      result.runtime.dispose();
    });

    const laptopAt2 = () => ({ ...source(), deviceScaleFactor: 2, emulation: LAPTOP });
    const ANOTHER_DENSITY: LiveSurfaceBrowserEmulationV1 = { ...LAPTOP, deviceScaleFactor: 3 };

    it("ruling 5 (my R) — a page the person STOPPED while its first load was under way, its device switched (the same density) before the engine said the load ended, stays stopped: the window made anew is born and NOT loaded, the page says `stopped` at its address, and ↻ loads it on the new device", async () => {
      const p = await starting();
      await delivered();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      expect(p.window.navigations).toEqual(["stop"]);
      await p.result.runtime.navigate({
        action: "emulate",
        emulation: { ...PHONE, deviceScaleFactor: 1 },
      });
      await delivered();
      expect(p.result.native.windows).toHaveLength(2);
      const made = p.result.native.windows[1];
      if (made === undefined) throw new Error("no window was made anew");
      expect(made.loadedUrls).toEqual([]);
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.browser).toMatchObject({
        url: FIRST,
        loading: false,
        failure: { reason: "stopped" },
      });
      // ↻ loads it — on the new device
      p.renderer.attachment.navigate?.({ action: "reload" });
      await delivered();
      expect(made.loadedUrls).toEqual([FIRST]);
      expect(made.emulations.at(-1)?.userAgent).toBe(IPHONE_UA);
      p.result.runtime.dispose();
    });

    it("ruling 5 — a stop asked BEFORE the birth survives a density switch that makes the unborn window anew: the new window is born and not loaded, `stopped` said", async () => {
      const result = setup({ source: laptopAt2() });
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      const first = result.native.windows[0];
      if (first === undefined) throw new Error("no window yet");
      // its birth's layout is held: the window is not born
      const raster = first.setBackingRaster.bind(first);
      first.setBackingRaster = (async (...args: Parameters<typeof raster>) => {
        await new Promise<void>(() => {});
        return raster(...args);
      }) as typeof first.setBackingRaster;
      await flush();
      renderer.attachment.navigate?.({ action: "stop" });
      await flush();
      await result.runtime.navigate({ action: "emulate", emulation: ANOTHER_DENSITY });
      await delivered();
      const made = result.native.windows[1];
      if (made === undefined) throw new Error("no window was made anew");
      expect(first.loadedUrls).toEqual([]);
      expect(made.loadedUrls).toEqual([]);
      expect(result.runtime.summary.browser).toMatchObject({ failure: { reason: "stopped" } });
      result.runtime.dispose();
    });

    it("ruling 5 — a page that SAID `stopped` stays stopped across a density switch (its window made anew, not loaded); one that said `no-document` — no stop of the person's — is asked for again there, as before", async () => {
      const stopped = await starting({ source: laptopAt2() });
      await delivered();
      stopped.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      stopped.blank(false);
      expect(stopped.result.runtime.summary.browser).toMatchObject({
        failure: { reason: "stopped" },
      });
      await stopped.result.runtime.navigate({ action: "emulate", emulation: ANOTHER_DENSITY });
      await delivered();
      expect(stopped.result.native.windows[1]?.loadedUrls).toEqual([]);
      expect(stopped.result.runtime.summary.browser).toMatchObject({
        failure: { reason: "stopped" },
      });
      stopped.result.runtime.dispose();
      const ended = await starting({ source: laptopAt2() });
      await delivered();
      ended.blank(false);
      expect(ended.result.runtime.summary.browser).toMatchObject({
        failure: { reason: "no-document" },
      });
      await ended.result.runtime.navigate({ action: "emulate", emulation: ANOTHER_DENSITY });
      await delivered();
      expect(ended.result.native.windows[1]?.loadedUrls).toEqual([FIRST]);
      ended.result.runtime.dispose();
    });

    /** R4: every state a page published from `from` on says it is STOPPED — never loading, never anything else. */
    const allStopped = (
      renderer: { summaries: LiveSurfaceRuntimeSummaryV1[] },
      from: number,
    ): void => {
      const said = renderer.summaries.slice(from).map((summary) => summary.browser);
      expect(said.length).toBeGreaterThan(0);
      for (const browser of said)
        expect(browser).toMatchObject({ loading: false, failure: { reason: "stopped" } });
    };

    it("R4 — a person's STOP holds until the person asks again: across a remake under a LIVE ask the window made anew is born and not loaded, and EVERY state published says `stopped` — never `loading`", async () => {
      const p = await starting({ source: laptopAt2() });
      await delivered();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      p.blank(false);
      const from = p.renderer.summaries.length;
      await p.result.runtime.navigate({ action: "emulate", emulation: ANOTHER_DENSITY });
      await delivered();
      expect(p.result.native.windows[1]?.loadedUrls).toEqual([]);
      allStopped(p.renderer, from);
      p.result.runtime.dispose();
    });

    it("R4 — … across a remake under an ask that is NOT live (the page goes to rest), and its wake: born, not loaded, `stopped` — never `loading`", async () => {
      const p = await starting({ source: laptopAt2() });
      await delivered();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      p.blank(false);
      p.renderer.attachment.setDemand(demand(2, "paused"));
      await delivered();
      const from = p.renderer.summaries.length;
      await p.result.runtime.navigate({ action: "emulate", emulation: ANOTHER_DENSITY });
      await delivered();
      expect(p.result.native.windows).toHaveLength(1);
      p.renderer.attachment.setDemand(demand(3, "live"));
      await delivered();
      const made = p.result.native.windows[1];
      if (made === undefined) throw new Error("no window was made at the wake");
      expect(made.loadedUrls).toEqual([]);
      allStopped(p.renderer, from);
      p.result.runtime.dispose();
    });

    it("R4 — … across a REST and its wake: born, not loaded, `stopped` — never `loading`; then ↻ loads it (the person asked again)", async () => {
      const p = await starting();
      await delivered();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      p.blank(false);
      const from = p.renderer.summaries.length;
      p.renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await delivered();
      expect(p.result.runtime.summary.state).toBe("hibernated");
      p.renderer.attachment.setDemand(demand(3, "live"));
      await delivered();
      const woken = p.result.native.windows[1];
      if (woken === undefined) throw new Error("no window was made at the wake");
      expect(woken.loadedUrls).toEqual([]);
      allStopped(p.renderer, from);
      p.renderer.attachment.navigate?.({ action: "reload" });
      await delivered();
      expect(woken.loadedUrls).toEqual([FIRST]);
      p.result.runtime.dispose();
    });

    it("R4 — … across a CRASH of its window and the restart: the window made again is born and not loaded, `stopped`", async () => {
      vi.useFakeTimers();
      const p = await starting({ restartLimit: 2 });
      await vi.advanceTimersByTimeAsync(0);
      p.renderer.attachment.navigate?.({ action: "stop" });
      await vi.advanceTimersByTimeAsync(0);
      p.blank(false);
      const from = p.renderer.summaries.length;
      p.window.crash();
      await vi.advanceTimersByTimeAsync(5_000);
      const again = p.result.native.windows[1];
      if (again === undefined) throw new Error("no window was made again");
      expect(again.loadedUrls).toEqual([]);
      expect(p.result.runtime.summary.browser).toMatchObject({
        loading: false,
        failure: { reason: "stopped" },
      });
      allStopped(p.renderer, from);
      p.result.runtime.dispose();
    });

    it("R4's neighbour — a GO forgets the person's stop (the person asked again): a stopped page sent elsewhere at rest is born THERE at its wake, and loads it", async () => {
      const p = await starting();
      await delivered();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      p.blank(false);
      p.renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await delivered();
      await p.result.runtime.navigate({ action: "go", url: "https://example.test/elsewhere" });
      p.renderer.attachment.setDemand(demand(3, "live"));
      await delivered();
      expect(p.result.native.windows[1]?.loadedUrls).toEqual(["https://example.test/elsewhere"]);
      p.result.runtime.dispose();
    });

    it("R4 — a window born under the person's stop MEETS its startup deadline: nothing restarts it, nothing fails it — it stands, `stopped`, until the person asks", async () => {
      vi.useFakeTimers();
      const p = await starting({ startupTimeoutMs: 1_000, restartLimit: 2 });
      await vi.advanceTimersByTimeAsync(0);
      p.renderer.attachment.navigate?.({ action: "stop" });
      await vi.advanceTimersByTimeAsync(0);
      p.blank(false);
      p.renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await vi.advanceTimersByTimeAsync(0);
      p.renderer.attachment.setDemand(demand(3, "live"));
      await vi.advanceTimersByTimeAsync(0);
      expect(p.result.native.windows).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(p.result.native.windows).toHaveLength(2);
      expect(p.result.native.windows[1]?.loadedUrls).toEqual([]);
      expect(p.result.runtime.summary.state).toBe("starting");
      expect(p.result.runtime.summary.error).toBeUndefined();
      expect(p.result.runtime.summary.browser).toMatchObject({ failure: { reason: "stopped" } });
      p.result.runtime.dispose();
    });

    it("R4's neighbour — ↻ on a stopped page that FAILED as a source (its renderer gone, a source that says so) is the person asking again: the window started anew LOADS the address", async () => {
      const p = await starting({ source: { ...source(), whenStopped: "say" } });
      await delivered();
      p.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      p.blank(false);
      p.window.crash();
      await delivered();
      expect(p.result.runtime.summary.state).toBe("failed");
      p.renderer.attachment.navigate?.({ action: "reload" });
      await delivered();
      expect(p.result.native.windows[1]?.loadedUrls).toEqual([FIRST]);
      p.result.runtime.dispose();
    });

    /** A live page whose renderer crashed: RECONNECTING, its window made anew (a `restart` source), its blank told. */
    const reconnecting = async () => {
      vi.useFakeTimers();
      const result = setup();
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await vi.advanceTimersByTimeAsync(0);
      const first = result.native.windows[0];
      if (first === undefined) throw new Error("no window");
      first.emitNavigationState({ ...NAV });
      first.paint(sharedPaint().paint);
      await vi.advanceTimersByTimeAsync(0);
      first.crash();
      await vi.advanceTimersByTimeAsync(0);
      const second = result.native.windows[1];
      if (second === undefined) throw new Error("no window was made again");
      await vi.advanceTimersByTimeAsync(0);
      expect(result.runtime.summary.state).toBe("reconnecting");
      const blank = (loading: boolean): void =>
        second.emitNavigationState({
          url: "about:blank",
          title: "about:blank",
          loading,
          canGoBack: false,
          canGoForward: false,
        });
      const loads = (): number =>
        result.native.windows.reduce((n, w) => n + w.loadedUrls.length, 0);
      return { result, renderer, second, blank, loads };
    };

    it("R6 — a page RECONNECTING with NO window takes the verbs as a window not yet born does: a go heads it there (at the reconnect's tick, and paused at it — its window waiting for a live ask) and the reconnect loads THAT; a stop is remembered — born, not loaded, `stopped`; a ↻ is nothing", async () => {
      vi.useFakeTimers();
      const ELSEWHERE = "https://example.test/elsewhere";
      /** A live page whose renderer crashed: reconnecting, its window not yet made (the reconnect's tick). */
      const crashed = async () => {
        const result = setup();
        const renderer = attach(result.runtime);
        renderer.attachment.setDemand(demand(1, "live"));
        await vi.advanceTimersByTimeAsync(0);
        const first = result.native.windows[0];
        if (first === undefined) throw new Error("no window");
        first.emitNavigationState({ ...NAV });
        first.paint(sharedPaint().paint);
        await vi.advanceTimersByTimeAsync(0);
        first.crash();
        expect(result.runtime.summary.state).toBe("reconnecting");
        expect(result.native.windows).toHaveLength(1);
        return { result, renderer, dropped: result.runtime.stats.navigationDropped };
      };
      // a go at the tick: the reconnect loads THAT
      const go = await crashed();
      go.renderer.attachment.navigate?.({ action: "go", url: ELSEWHERE });
      await delivered();
      expect(go.result.runtime.stats.navigationDropped).toBe(go.dropped);
      expect(go.result.runtime.summary.browser?.url).toBe(ELSEWHERE);
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      expect(go.result.native.windows[1]?.loadedUrls).toEqual([ELSEWHERE]);
      go.result.runtime.dispose();
      // paused at the tick: the window waits for a live ask; a go meanwhile (a peer's, an undo) is kept
      const paused = await crashed();
      paused.renderer.attachment.setDemand(demand(2, "paused"));
      await vi.advanceTimersByTimeAsync(0);
      expect(paused.result.native.windows).toHaveLength(1);
      paused.renderer.attachment.navigate?.({ action: "go", url: ELSEWHERE });
      await delivered();
      expect(paused.result.runtime.stats.navigationDropped).toBe(paused.dropped);
      paused.renderer.attachment.setDemand(demand(3, "live"));
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      expect(paused.result.native.windows[1]?.loadedUrls).toEqual([ELSEWHERE]);
      paused.result.runtime.dispose();
      // a stop at the tick: born, not loaded, `stopped`
      const stop = await crashed();
      stop.renderer.attachment.navigate?.({ action: "stop" });
      await delivered();
      expect(stop.result.runtime.stats.navigationDropped).toBe(stop.dropped);
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      expect(stop.result.native.windows[1]?.loadedUrls).toEqual([]);
      expect(stop.result.runtime.summary.browser).toMatchObject({
        loading: false,
        failure: { reason: "stopped" },
      });
      stop.result.runtime.dispose();
      // a ↻ at the tick: nothing — the reconnect loads the address it would have
      const reload = await crashed();
      reload.renderer.attachment.navigate?.({ action: "reload" });
      await delivered();
      expect(reload.result.runtime.stats.navigationDropped).toBe(reload.dropped);
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      expect(reload.result.native.windows[1]?.loadedUrls).toEqual(["https://example.test/app"]);
      reload.result.runtime.dispose();
    });

    it("ruling 6 (P6) — a page RECONNECTING whose load ENDS with nothing is not stuck: it says so, with no document of its own, and ↻ asks for the address again; its paint makes it live", async () => {
      const p = await reconnecting();
      p.blank(true);
      p.blank(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(p.result.runtime.summary.state).toBe("reconnecting");
      expect(p.result.runtime.summary.browser).toMatchObject({
        failure: { reason: "no-document" },
      });
      expect(p.result.runtime.summary.browser?.document).toBeUndefined();
      const before = p.loads();
      const dropped = p.result.runtime.stats.navigationDropped;
      p.renderer.attachment.navigate?.({ action: "reload" });
      await vi.advanceTimersByTimeAsync(0);
      expect(p.loads()).toBe(before + 1);
      expect(p.second.loadedUrls.at(-1)).toBe("https://example.test/app");
      expect(p.result.runtime.stats.navigationDropped).toBe(dropped);
      p.second.emitNavigationState({ ...NAV });
      p.second.paint(sharedPaint().paint);
      await vi.advanceTimersByTimeAsync(0);
      expect(p.result.runtime.summary.state).toBe("live");
      p.result.runtime.dispose();
    });

    it("ruling 6 — a page reconnecting takes a person's go and stop as a starting page does, and a REST lets it go at once — its window too", async () => {
      const p = await reconnecting();
      p.blank(true);
      // sent elsewhere while its load is under way: that address is loaded
      p.renderer.attachment.navigate?.({ action: "go", url: "https://example.test/elsewhere" });
      await vi.advanceTimersByTimeAsync(0);
      expect(p.second.loadedUrls.at(-1)).toBe("https://example.test/elsewhere");
      expect(p.result.runtime.summary.browser).toMatchObject({
        url: "https://example.test/elsewhere",
        loading: true,
      });
      // stopped: the engine is asked, and the page says `stopped` when its load ends
      p.renderer.attachment.navigate?.({ action: "stop" });
      await vi.advanceTimersByTimeAsync(0);
      expect(p.second.navigations).toEqual(["stop"]);
      p.blank(false);
      expect(p.result.runtime.summary.browser).toMatchObject({ failure: { reason: "stopped" } });
      // put to rest: let go at once
      p.renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await vi.advanceTimersByTimeAsync(0);
      expect(p.result.runtime.summary.state).toBe("hibernated");
      expect(p.second.destroyed).toBe(true);
      p.result.runtime.dispose();
    });

    it("ruling 6 — a page reconnecting with NO window yet (the reconnect's tick) asked to REST goes to rest; its reconnect does not come", async () => {
      vi.useFakeTimers();
      const result = setup();
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(demand(1, "live"));
      await vi.advanceTimersByTimeAsync(0);
      const first = result.native.windows[0];
      if (first === undefined) throw new Error("no window");
      first.paint(sharedPaint().paint);
      first.crash();
      expect(result.runtime.summary.state).toBe("reconnecting");
      renderer.attachment.setDemand(demand(2, "hibernated", 0));
      await vi.advanceTimersByTimeAsync(0);
      expect(result.runtime.summary.state).toBe("hibernated");
      expect(result.native.windows).toHaveLength(1);
      // woken: born again, as a page at rest is
      renderer.attachment.setDemand(demand(3, "live"));
      await vi.advanceTimersByTimeAsync(0);
      expect(result.native.windows).toHaveLength(2);
      expect(result.runtime.summary.state).toBe("starting");
      result.runtime.dispose();
    });

    it("ruling 4 — the birth's layout IS the geometry's: a demand moved during the birth, its actuation not yet due — the window is laid at the new layout, and every frame's geometry says it", async () => {
      vi.useFakeTimers();
      const result = setup({
        source: { ...source(), deviceScaleFactor: 2, emulation: LAPTOP },
        rasterStabilizationMs: 60_000,
      });
      let told: () => void = () => {};
      const make = result.native.createWindow.bind(result.native);
      result.native.createWindow = (options) => {
        const made = make(options) as FakeBrowserWindow;
        const emulate = made.setEmulation.bind(made);
        made.setEmulation = async (emulation) => {
          await new Promise<void>((resolve) => {
            told = resolve;
          });
          return emulate(emulation);
        };
        return made;
      };
      const renderer = attach(result.runtime);
      renderer.attachment.setDemand(
        demand(1, "live", 30, { width: 640, height: 400 }, { width: 320, height: 200 }),
      );
      const window = result.native.windows[0];
      if (window === undefined) throw new Error("no window yet");
      await vi.advanceTimersByTimeAsync(0);
      renderer.attachment.setDemand(
        demand(2, "live", 30, { width: 1000, height: 800 }, { width: 500, height: 400 }),
      );
      await vi.advanceTimersByTimeAsync(100);
      told();
      await vi.advanceTimersByTimeAsync(0);
      await delivered();
      expect(window.rasterViewports).toEqual([{ width: 500, height: 400 }]);
      window.emitNavigationState({ ...NAV });
      window.paint(sharedPaint(1000, 800).paint);
      await delivered();
      expect(result.runtime.summary.geometry?.logicalSize).toEqual({ width: 500, height: 400 });
      result.runtime.dispose();
    });

    it("ruling 1 — a mouse press ANSWERED after another document committed is FORGOTTEN: nothing is set down — the hand's release of it sends nothing", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      let answer: () => void = () => {};
      const mouse = p.window.dispatchMouse.bind(p.window);
      p.window.dispatchMouse = (input) => {
        if (input.type !== "mousePressed") return mouse(input);
        p.window.mouseInputs.push(input);
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      };
      const pointer = (action: "down" | "up"): void =>
        p.renderer.attachment.dispatchInput?.(
          { kind: "pointer", action, x: 10, y: 10, button: "left", clickCount: 1 },
          r,
        );
      pointer("down");
      await delivered();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      answer();
      await delivered();
      pointer("up");
      await delivered();
      expect(p.window.mouseInputs.map((m) => m.type)).toEqual(["mousePressed"]);
      p.result.runtime.dispose();
    });

    it("ruling 2 (my T21) — a touchStart ANSWERED after its window was REPLACED sets nothing down for the window that replaced it: the new window's first move is a hover", async () => {
      const p = await phone();
      // the press's dispatch answers when the row says
      let answer: () => void = () => {};
      p.window.dispatchTouch = (input) => {
        p.heard.push(input.type);
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      };
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual(["touchStart"]);
      // the device moves to another density: the window is made anew (its pending turn ends with the old one)
      await p.result.runtime.navigate({
        action: "emulate",
        emulation: { ...PHONE, deviceScaleFactor: 2 },
      });
      await p.delivered();
      const made = p.result.native.windows[1];
      if (made === undefined) throw new Error("no window was made anew");
      // the old window's touchStart answers only now
      answer();
      await p.delivered();
      made.emitNavigationState({ ...NAV });
      made.paint(sharedPaint(804, 1748).paint);
      await p.delivered();
      expect(p.result.runtime.summary.state).toBe("live");
      p.pointer("move", 30, p.result.runtime.summary.geometry?.revision ?? 0);
      await p.delivered();
      expect(made.touchInputs).toEqual([]);
      p.result.runtime.dispose();
    });

    it("R1 — an event whose attachment GOES before its turn is refused at its turn: a press and a word typed, queued behind a key the page was slow to take, are never sent — counted (the page live all along: a second window shows it)", async () => {
      const p = await laptop();
      // a second window shows the pane: the page stays live when the first one's attachment goes
      const other = attach(p.result.runtime, "attachment_browser_00000002");
      other.attachment.setDemand(demand(2, "live"));
      await delivered();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      // the page takes its first key when the row says
      let answer: () => void = () => {};
      let held = true;
      const key = p.window.dispatchKey.bind(p.window);
      p.window.dispatchKey = (input) => {
        if (!held) return key(input);
        held = false;
        p.window.keyInputs.push(input);
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      };
      p.key("down", r, "a");
      await delivered();
      p.renderer.attachment.dispatchInput?.(
        { kind: "pointer", action: "down", x: 10, y: 10, button: "left", clickCount: 1 },
        r,
      );
      p.renderer.attachment.dispatchInput?.({ kind: "text", text: "zz" }, r);
      await delivered();
      const dropped = p.result.runtime.stats.inputDropped;
      p.renderer.attachment.dispose();
      answer();
      await delivered();
      expect(p.result.runtime.summary.state).toBe("live");
      expect(p.window.mouseInputs).toEqual([]);
      expect(p.window.textInputs).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 2);
      p.result.runtime.dispose();
    });

    it("R1 — a press WAITING for its document's word ends at a REST: refused, counted — the page at rest never hears it, nor the page woken after", async () => {
      const p = await phone();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      await p.delivered();
      expect(p.heard).toEqual([]);
      p.renderer.attachment.setDemand(demand(2, "paused", 30, { width: 1206, height: 2622 }));
      await p.delivered();
      expect(p.result.runtime.summary.state).toBe("paused");
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      p.window.say(1);
      p.renderer.attachment.setDemand(demand(3, "live", 30, { width: 1206, height: 2622 }));
      await p.delivered();
      expect(p.heard).toEqual([]);
      p.result.runtime.dispose();
    });

    it("R1 — read AT THE SEND: a press whose word came in the same turn as a REST is refused; so is one whose word came in the same turn as its attachment's GOING", async () => {
      const p = await phone();
      const size = { width: 1206, height: 2622 };
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      await p.delivered();
      p.window.say(1);
      p.renderer.attachment.setDemand(demand(2, "paused", 30, size));
      await p.delivered();
      expect(p.heard).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      // live again (a second window shows it too: the page stays LIVE when the first one's attachment goes), at another
      // document: its word, and the attachment's going, in one turn
      p.renderer.attachment.setDemand(demand(3, "live", 30, size));
      const second = attach(p.result.runtime, "attachment_browser_00000002");
      second.attachment.setDemand(demand(4, "live", 30, size));
      p.window.emitNavigationState({ ...NAV, url: `${NEXT}/2` });
      await p.delivered();
      p.pointer("down", 20, p.result.runtime.summary.geometry?.revision ?? p.revision);
      await p.delivered();
      p.window.say(1);
      p.renderer.attachment.dispose();
      await p.delivered();
      expect(p.result.runtime.summary.state).toBe("live");
      expect(p.heard).toEqual([]);
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 2);
      p.result.runtime.dispose();
    });

    it("R8 — a KEY is pressed too: held across a REST its up is a RELEASE — sent to the page at rest, never refused; the up of a key the page was never told is down is nothing", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      const keys = (): string[] => p.window.keyInputs.map((k) => `${k.type} ${k.key}`);
      p.key("down", r, "q");
      await delivered();
      p.renderer.attachment.setDemand(demand(2, "paused"));
      await delivered();
      expect(p.result.runtime.summary.state).toBe("paused");
      p.key("up", r, "q");
      await delivered();
      expect(keys()).toEqual(["keyDown q", "keyUp q"]);
      // live again: the up of a key never pressed is nothing
      p.renderer.attachment.setDemand(demand(3, "live"));
      await delivered();
      p.key("up", r, "b");
      await delivered();
      expect(keys()).toEqual(["keyDown q", "keyUp q"]);
      p.result.runtime.dispose();
    });

    it("R8 — a key held when the attachment that pressed it GOES is let up, as a button (Space held in a design tool's page stays down no longer); another attachment's key stands until its own up", async () => {
      const p = await laptop();
      const other = attach(p.result.runtime, "attachment_browser_00000002");
      other.attachment.setDemand(demand(2, "live"));
      await delivered();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      const keys = (): string[] => p.window.keyInputs.map((k) => `${k.type} ${k.key}`);
      const otherKey = (action: "down" | "up"): void =>
        other.attachment.dispatchInput?.(
          { kind: "key", action, key: "b", code: "KeyB", modifiers: NONE },
          r,
        );
      p.key("down", r, "a");
      otherKey("down");
      await delivered();
      p.renderer.attachment.dispose();
      await delivered();
      expect(keys()).toEqual(["keyDown a", "keyDown b", "keyUp a"]);
      expect(p.window.keyInputs.at(-1)).toMatchObject({ type: "keyUp", key: "a", code: "KeyA" });
      otherKey("up");
      await delivered();
      expect(keys()).toEqual(["keyDown a", "keyDown b", "keyUp a", "keyUp b"]);
      p.result.runtime.dispose();
    });

    it("R8 — a key down when another document commits is FORGOTTEN, as a button: the hand's late up is nothing (it would be a stray keyUp in the next document)", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      p.key("down", r, "a");
      await delivered();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      await delivered();
      p.key("up", r, "a");
      await delivered();
      expect(p.window.keyInputs.map((k) => `${k.type} ${k.key}`)).toEqual(["keyDown a"]);
      p.result.runtime.dispose();
    });

    it("R8 — a key down ANSWERED after another document committed is forgotten, as a mouse press: its late up is nothing", async () => {
      const p = await laptop();
      const r = p.result.runtime.summary.geometry?.revision ?? 0;
      let answer: () => void = () => {};
      const key = p.window.dispatchKey.bind(p.window);
      p.window.dispatchKey = (input) => {
        if (input.type !== "keyDown") return key(input);
        p.window.keyInputs.push(input);
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      };
      p.key("down", r, "a");
      await delivered();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      answer();
      await delivered();
      p.key("up", r, "a");
      await delivered();
      expect(p.window.keyInputs.map((k) => k.type)).toEqual(["keyDown"]);
      p.result.runtime.dispose();
    });

    it("R8 — keys down when their WINDOW goes (a remake: another density) are forgotten with it: the hand's up, sent to the window made anew, is nothing", async () => {
      const s = await standing({ source: laptopAt2() });
      const r = s.result.runtime.summary.geometry?.revision ?? 0;
      const key = (action: "down" | "up"): void =>
        s.renderer.attachment.dispatchInput?.(
          { kind: "key", action, key: "a", code: "KeyA", modifiers: NONE },
          r,
        );
      key("down");
      await delivered();
      expect(s.first.keyInputs.map((k) => k.type)).toEqual(["keyDown"]);
      await s.result.runtime.navigate({ action: "emulate", emulation: ANOTHER_DENSITY });
      await delivered();
      const made = s.result.native.windows[1];
      if (made === undefined) throw new Error("no window was made anew");
      key("up");
      await delivered();
      expect(made.keyInputs).toEqual([]);
      s.result.runtime.dispose();
    });

    it("R2 — the net under the hand: a press waiting for a word its page NEVER says is refused after a second, counted — and the key behind it is delivered", async () => {
      vi.useFakeTimers();
      const p = await phone();
      p.window.emitNavigationState({ ...NAV, url: NEXT });
      const dropped = p.result.runtime.stats.inputDropped;
      p.pointer("down", 20);
      p.send({ kind: "key", action: "down", key: "a", code: "KeyA", modifiers: NONE });
      await p.delivered();
      expect(p.heard).toEqual([]);
      await vi.advanceTimersByTimeAsync(999);
      await p.delivered();
      expect(p.heard).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await p.delivered();
      expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
      expect(p.heard).toEqual(["keyDown a"]);
      p.result.runtime.dispose();
    });

    describe("PT-5c2 — the chain's edges: what PT-5c's grade found", () => {
      it("F2 — NOTHING IS KEPT PER EVENT: 10,000 moves over a laptop's page leave no promise behind them — each turn's race against its window's going is let go when the turn is done, sent or refused (before: a reaction a turn on a promise as old as the window — 10,000 kept)", async () => {
        const { queryObjects } = await import("node:v8");
        const p = await laptop();
        const r = p.result.runtime.summary.geometry?.revision ?? 0;
        const drained = async (): Promise<void> => {
          for (let k = 0; k < 6; k += 1)
            await new Promise<void>((resolve) => setImmediate(resolve));
        };
        const moves = async (n: number): Promise<void> => {
          for (let i = 0; i < n; i += 1) {
            p.renderer.attachment.dispatchInput?.(
              { kind: "pointer", action: "move", x: 1 + (i % 100), y: 10 },
              r,
            );
            if (i % 100 === 99) await drained();
          }
          await drained();
        };
        await moves(100);
        const before = queryObjects(Promise, { format: "count" }) as number;
        const heard = p.window.mouseInputs.length;
        await moves(10_000);
        const after = queryObjects(Promise, { format: "count" }) as number;
        expect(p.window.mouseInputs.length - heard).toBe(10_000);
        expect(after - before).toBeLessThan(500);
        // …and 10,000 REFUSED at their turn (the page at rest: never sent, each counted)
        p.renderer.attachment.setDemand(demand(2, "paused"));
        await delivered();
        const dropped = p.result.runtime.stats.inputDropped;
        await moves(10_000);
        const refused = queryObjects(Promise, { format: "count" }) as number;
        expect(p.result.runtime.stats.inputDropped - dropped).toBe(10_000);
        expect(refused - after).toBeLessThan(500);
        p.result.runtime.dispose();
      });

      it("F3 — a document's bound on its first word runs out ONCE: four wheels and a key on a page that never speaks — the first wheel waits its second, the three after it are refused AT ONCE, counted, and the key is heard by 1.5 s (before: a second each — the key at 4 s; the orchestrator's S3)", async () => {
        vi.useFakeTimers();
        const p = await phone();
        p.window.emitNavigationState({ ...NAV, url: NEXT });
        await p.delivered();
        const dropped = p.result.runtime.stats.inputDropped;
        for (let i = 0; i < 4; i += 1)
          p.send({ kind: "wheel", x: 20, y: 10, deltaX: 0, deltaY: 40 });
        p.send({ kind: "key", action: "down", key: "q", code: "KeyQ", modifiers: NONE });
        await vi.advanceTimersByTimeAsync(1_500);
        await p.delivered();
        expect(p.heard).toEqual(["keyDown q"]);
        expect(p.result.runtime.stats.inputDropped).toBe(dropped + 4);
        p.result.runtime.dispose();
      });

      it("F3 — a WORD after the bound lifts it: once the bound has run out a press is refused at once, counted; the page speaks, and the next press goes at the scale it said", async () => {
        vi.useFakeTimers();
        const p = await phone();
        p.window.emitNavigationState({ ...NAV, url: NEXT });
        await p.delivered();
        p.send({ kind: "wheel", x: 20, y: 10, deltaX: 0, deltaY: 40 });
        await vi.advanceTimersByTimeAsync(1_000);
        await p.delivered();
        // the document's bound has run out: a press now is refused at once — never another second's wait
        const dropped = p.result.runtime.stats.inputDropped;
        p.pointer("down", 20);
        await p.delivered();
        expect(p.heard).toEqual([]);
        expect(p.result.runtime.stats.inputDropped).toBe(dropped + 1);
        // the page speaks at last: the next press goes at its scale
        p.window.say(0.5);
        p.pointer("down", 20);
        await p.delivered();
        expect(p.heard).toEqual(["touchStart"]);
        expect(p.window.touchInputs.at(-1)).toEqual({
          type: "touchStart",
          touchPoints: [{ x: 40, y: 20, id: 0 }],
        });
        p.result.runtime.dispose();
      });

      it("F5 — `letGo` sends nothing from a stale snapshot: an attachment holding two KEYS goes, and another document commits while the first key's up is unanswered — the second key, forgotten at the commit, is never let up into the new document (the orchestrator's S5)", async () => {
        const p = await laptop();
        const other = attach(p.result.runtime, "attachment_browser_00000002");
        other.attachment.setDemand(demand(2, "live"));
        await delivered();
        const r = p.result.runtime.summary.geometry?.revision ?? 0;
        const keys = (): string[] => p.window.keyInputs.map((k) => `${k.type} ${k.key}`);
        p.key("down", r, "a");
        p.key("down", r, "b");
        await delivered();
        expect(keys()).toEqual(["keyDown a", "keyDown b"]);
        // the first key's up is answered when the row says
        let answer: () => void = () => {};
        const send = p.window.dispatchKey.bind(p.window);
        p.window.dispatchKey = async (input) => {
          await send(input);
          if (input.type === "keyUp" && input.key === "a")
            await new Promise<void>((resolve) => {
              answer = resolve;
            });
        };
        p.renderer.attachment.dispose();
        await delivered();
        // while it is unanswered, another document commits
        p.window.emitNavigationState({ ...NAV, url: NEXT });
        await delivered();
        answer();
        await delivered();
        expect(keys()).toEqual(["keyDown a", "keyDown b", "keyUp a"]);
        p.result.runtime.dispose();
      });

      it("F5 — … and two BUTTONS: the second is never released into the new document", async () => {
        const p = await laptop();
        const other = attach(p.result.runtime, "attachment_browser_00000002");
        other.attachment.setDemand(demand(2, "live"));
        await delivered();
        const r = p.result.runtime.summary.geometry?.revision ?? 0;
        const press = (button: "left" | "right"): void =>
          p.renderer.attachment.dispatchInput?.(
            { kind: "pointer", action: "down", x: 10, y: 10, button, clickCount: 1 },
            r,
          );
        const mouse = (): string[] => p.window.mouseInputs.map((m) => `${m.type} ${m.button}`);
        press("left");
        press("right");
        await delivered();
        expect(mouse()).toEqual(["mousePressed left", "mousePressed right"]);
        let answer: () => void = () => {};
        const send = p.window.dispatchMouse.bind(p.window);
        p.window.dispatchMouse = async (input) => {
          await send(input);
          if (input.type === "mouseReleased" && input.button === "left")
            await new Promise<void>((resolve) => {
              answer = resolve;
            });
        };
        p.renderer.attachment.dispose();
        await delivered();
        p.window.emitNavigationState({ ...NAV, url: NEXT });
        await delivered();
        answer();
        await delivered();
        expect(mouse()).toEqual(["mousePressed left", "mousePressed right", "mouseReleased left"]);
        p.result.runtime.dispose();
      });

      it("F6 — a stop asked while the first load is under way, NOT YET SAID, then the page put to REST: the page says `stopped` at once — every state published from the rest on; never `loading` at rest (the orchestrator's S6)", async () => {
        const p = await starting();
        await delivered();
        p.renderer.attachment.navigate?.({ action: "stop" });
        await delivered();
        expect(p.window.navigations).toEqual(["stop"]);
        const from = p.renderer.summaries.length;
        p.renderer.attachment.setDemand(demand(2, "hibernated", 0));
        await delivered();
        expect(p.result.runtime.summary.state).toBe("hibernated");
        allStopped(p.renderer, from);
        // woken: born, not loaded — `stopped` all along
        p.renderer.attachment.setDemand(demand(3, "live"));
        await delivered();
        expect(p.result.native.windows[1]?.loadedUrls).toEqual([]);
        allStopped(p.renderer, from);
        p.result.runtime.dispose();
      });

      it("F6 — … the same at a REMAKE under an ask that is not live (another density, the pane out of view) and its wake: `stopped` at once, born and not loaded", async () => {
        const p = await starting({ source: laptopAt2() });
        await delivered();
        p.renderer.attachment.navigate?.({ action: "stop" });
        await delivered();
        p.renderer.attachment.setDemand(demand(2, "paused"));
        await delivered();
        const from = p.renderer.summaries.length;
        await p.result.runtime.navigate({ action: "emulate", emulation: ANOTHER_DENSITY });
        await delivered();
        expect(p.result.native.windows).toHaveLength(1);
        p.renderer.attachment.setDemand(demand(3, "live"));
        await delivered();
        expect(p.result.native.windows[1]?.loadedUrls).toEqual([]);
        allStopped(p.renderer, from);
        p.result.runtime.dispose();
      });

      it("F6 — … and at a CRASH of its window (a source that starts again): `stopped` at once, through the restart — born and not loaded", async () => {
        vi.useFakeTimers();
        const p = await starting({ restartLimit: 2 });
        await vi.advanceTimersByTimeAsync(0);
        p.renderer.attachment.navigate?.({ action: "stop" });
        await vi.advanceTimersByTimeAsync(0);
        const from = p.renderer.summaries.length;
        p.window.crash();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(p.result.native.windows[1]?.loadedUrls).toEqual([]);
        allStopped(p.renderer, from);
        p.result.runtime.dispose();
      });
    });
  });
});
