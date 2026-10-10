import { BrowserWindow, session } from "electron";
import {
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
  engineAgentOf,
} from "./browser-producer";
import {
  installGuardedBrowserSurfaceContents,
  installGuardedBrowserSurfaceSession,
} from "./browser-security";

/** How long a favicon's fetch may take before the page is said to have none. */
const FAVICON_TIMEOUT_MS = 5_000;

function integerDimension(value: number): number {
  return Math.max(1, Math.min(16_384, Math.round(value)));
}

function baseRaster(options: BrowserSurfaceNativeWindowOptions): {
  width: number;
  height: number;
} {
  return {
    width: integerDimension(options.logicalViewport.width * options.deviceScaleFactor),
    height: integerDimension(options.logicalViewport.height * options.deviceScaleFactor),
  };
}

function safeEffectiveRaster(
  requested: { width: number; height: number },
  base: { width: number; height: number },
): { width: number; height: number; pageScaleFactor: number } {
  const baseAspect = base.width / base.height;
  const requestedAspect = requested.width / requested.height;
  const aspectDrift = Math.abs(requestedAspect / baseAspect - 1);
  const scale = Math.min(requested.width / base.width, requested.height / base.height);
  // Chromium clamps page scale below 1. Preserve layout/raster correctness and
  // let the WebGPU compositor downsample instead of relaying out the page.
  if (scale < 1 || aspectDrift > 0.01) {
    return { ...base, pageScaleFactor: 1 };
  }
  return {
    width: requested.width,
    height: requested.height,
    pageScaleFactor: scale,
  };
}

class ElectronBrowserSurfaceWindow implements BrowserSurfaceNativeWindow {
  readonly controlContents;
  #remoteLoadStarted = false;
  #debuggerAttached = false;
  #commandTail: Promise<void> = Promise.resolve();

  constructor(
    readonly window: BrowserWindow,
    readonly options: BrowserSurfaceNativeWindowOptions,
    readonly bootstrapReady: Promise<void>,
  ) {
    this.controlContents = window.webContents;
  }

  loadURL(url: string): Promise<void> {
    this.#remoteLoadStarted = true;
    return this.window.loadURL(url);
  }

  isDestroyed(): boolean {
    return this.window.isDestroyed() || this.window.webContents.isDestroyed();
  }

  destroy(): void {
    if (this.isDestroyed()) return;
    if (this.#debuggerAttached && this.window.webContents.debugger.isAttached()) {
      try {
        this.window.webContents.debugger.detach();
      } catch {
        // WebContents teardown owns the target now.
      }
    }
    this.#debuggerAttached = false;
    this.window.destroy();
  }

  setFrameRate(fps: number): void {
    this.window.webContents.setFrameRate(fps);
  }

  startPainting(): void {
    this.window.webContents.startPainting();
  }

  stopPainting(): void {
    this.window.webContents.stopPainting();
  }

  setAudioMuted(muted: boolean): void {
    if (this.isDestroyed()) return;
    this.window.webContents.setAudioMuted(muted);
  }

  invalidate(): void {
    this.window.webContents.invalidate();
  }

  setBackingRaster(
    requested: { width: number; height: number },
    logicalViewport: { width: number; height: number },
    deviceScaleFactor: number,
    mobile = false,
  ): Promise<{ width: number; height: number }> {
    // The base derives from THIS call's viewport (DT-3f), never the
    // construction-time one: the viewport now follows the card, and a raster
    // judged against a stale base would reject every request whose aspect had
    // legitimately moved with the layout.
    const effective = safeEffectiveRaster(requested, {
      width: integerDimension(logicalViewport.width * deviceScaleFactor),
      height: integerDimension(logicalViewport.height * deviceScaleFactor),
    });
    return this.enqueue(async () => {
      if (this.isDestroyed()) throw new Error("Browser surface was destroyed during resize");
      await this.bootstrapReady;
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        width: integerDimension(logicalViewport.width),
        height: integerDimension(logicalViewport.height),
        deviceScaleFactor,
        mobile,
        screenWidth: integerDimension(logicalViewport.width),
        screenHeight: integerDimension(logicalViewport.height),
      });
      await this.window.webContents.debugger.sendCommand("Emulation.setPageScaleFactor", {
        pageScaleFactor: effective.pageScaleFactor,
      });
      const contentWidth = integerDimension(effective.width / this.options.deviceScaleFactor);
      const contentHeight = integerDimension(effective.height / this.options.deviceScaleFactor);
      this.window.setContentSize(contentWidth, contentHeight, false);
    }).then(() => ({ width: effective.width, height: effective.height }));
  }

  /**
   * PT-4 — what the page is told of its device, over CDP's Emulation: its agent (`navigator.userAgent`, `navigator.platform`,
   * the request header) WITH its client hints — an overridden agent's are empty otherwise; touch on or off with its points;
   * the colour scheme, or the system's when none is named. Never `setEmitTouchEventsForMouse`: under it a dispatched mouse
   * event is swallowed and its command never answers, and this window's commands run one behind another.
   */
  setEmulation(emulation: BrowserSurfaceNativeEmulation): Promise<void> {
    return this.enqueue(async () => {
      if (this.isDestroyed()) throw new Error("Browser surface was destroyed during emulation");
      await this.bootstrapReady;
      await this.ensureDebugger();
      const cdp = this.window.webContents.debugger;
      await cdp.sendCommand("Emulation.setUserAgentOverride", {
        userAgent: emulation.userAgent,
        platform: emulation.navigatorPlatform,
        userAgentMetadata: emulation.metadata,
      });
      await cdp.sendCommand(
        "Emulation.setTouchEmulationEnabled",
        emulation.touchPoints > 0
          ? { enabled: true, maxTouchPoints: emulation.touchPoints }
          : { enabled: false },
      );
      await cdp.sendCommand("Emulation.setEmulatedMedia", {
        features:
          emulation.colorScheme === undefined
            ? []
            : [{ name: "prefers-color-scheme", value: emulation.colorScheme }],
      });
    });
  }

  dispatchTouch(input: BrowserSurfaceNativeTouchInput): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Input.dispatchTouchEvent", input);
    });
  }

  dispatchMouse(input: BrowserSurfaceNativeMouseInput): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", input);
    });
  }

  dispatchKey(input: BrowserSurfaceNativeKeyInput): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", input);
    });
  }

  dispatchText(text: string): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Input.insertText", { text });
    });
  }

  dispatchCompose(text: string, caret: number): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Input.imeSetComposition", {
        text,
        selectionStart: caret,
        selectionEnd: caret,
      });
    });
  }

  navigate(action: "back" | "forward" | "reload" | "stop"): void {
    if (this.isDestroyed()) return;
    const contents = this.window.webContents;
    if (action === "back") {
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      return;
    }
    if (action === "forward") {
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      return;
    }
    if (action === "reload") {
      contents.reload();
      return;
    }
    contents.stop();
  }

  onNavigationState(listener: (state: BrowserSurfaceNavigationState) => void): () => void {
    const contents = this.window.webContents;
    const emit = (): void => {
      // The about:blank bootstrap document is plumbing, not navigation truth.
      if (this.isDestroyed() || !this.#remoteLoadStarted) return;
      listener({
        url: contents.getURL(),
        title: contents.getTitle(),
        loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
      });
    };
    contents.on("did-navigate", emit);
    contents.on("did-navigate-in-page", emit);
    contents.on("page-title-updated", emit);
    contents.on("did-start-loading", emit);
    contents.on("did-stop-loading", emit);
    return () => {
      contents.off("did-navigate", emit);
      contents.off("did-navigate-in-page", emit);
      contents.off("page-title-updated", emit);
      contents.off("did-start-loading", emit);
      contents.off("did-stop-loading", emit);
    };
  }

  onFavicon(listener: (urls: readonly string[]) => void): () => void {
    const contents = this.window.webContents;
    // (the bootstrap document's is plumbing: nothing is said of it)
    const updated = (_event: Electron.Event, urls: string[]): void => {
      if (this.#remoteLoadStarted && !this.isDestroyed()) listener(urls);
    };
    contents.on("page-favicon-updated", updated);
    return () => {
      contents.off("page-favicon-updated", updated);
    };
  }

  /** Through the page's OWN session — its cookies, and the session's request guard (http and https alone at the top). */
  async fetchIcon(url: string, maxBytes: number): Promise<BrowserSurfaceIcon | null> {
    if (this.isDestroyed()) return null;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FAVICON_TIMEOUT_MS);
    try {
      const response = await this.window.webContents.session.fetch(url, { signal: abort.signal });
      if (!response.ok || response.body === null) return null;
      const declared = Number(response.headers.get("content-length") ?? Number.NaN);
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) return null;
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      return { mediaType: response.headers.get("content-type") ?? "", bytes };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }

  onCursor(listener: (cursor: string) => void): () => void {
    const handler = (_event: Electron.Event, type: string): void => listener(type);
    this.window.webContents.on("cursor-changed", handler);
    return () => this.window.webContents.off("cursor-changed", handler);
  }

  onPaint(listener: (paint: BrowserSurfacePaint) => void): () => void {
    const handler = (
      details: Electron.Event<Electron.WebContentsPaintEventParams>,
      _dirtyRect: Electron.Rectangle,
      image: Electron.NativeImage,
    ): void => {
      if (!this.#remoteLoadStarted) {
        details.texture?.release();
        return;
      }
      // Electron 43 can report a runtime `null` here even though its d.ts only
      // models the texture as optional. Normalize that native boundary before
      // handing the paint to the producer.
      const texture = details.texture ?? undefined;
      listener({
        ...(texture === undefined ? {} : { texture }),
        image: {
          getSize: () => image.getSize(),
          toBitmap: (targetSize) => {
            const current = image.getSize();
            if (
              targetSize === undefined ||
              (targetSize.width === current.width && targetSize.height === current.height)
            ) {
              return image.toBitmap();
            }
            return image
              .resize({ width: targetSize.width, height: targetSize.height, quality: "good" })
              .toBitmap();
          },
        },
      });
    };
    this.window.webContents.on("paint", handler);
    return () => this.window.webContents.off("paint", handler);
  }

  onRenderProcessGone(listener: (reason: string) => void): () => void {
    const handler = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void =>
      listener(details.reason);
    this.window.webContents.on("render-process-gone", handler);
    return () => this.window.webContents.off("render-process-gone", handler);
  }

  onDestroyed(listener: () => void): () => void {
    this.window.webContents.on("destroyed", listener);
    return () => this.window.webContents.off("destroyed", listener);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#commandTail.then(operation, operation);
    this.#commandTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async ensureDebugger(): Promise<void> {
    if (this.isDestroyed()) throw new Error("Browser surface target is unavailable");
    if (!this.window.webContents.debugger.isAttached()) {
      this.window.webContents.debugger.attach("1.3");
    }
    this.#debuggerAttached = true;
  }
}

/** Pinned Electron 43 Browser OSR adapter. */
export class ElectronBrowserSurfaceNative implements BrowserSurfaceNative {
  createWindow(options: BrowserSurfaceNativeWindowOptions): BrowserSurfaceNativeWindow {
    // PT-4: a persistent profile lives under its USER's data (`LAYOUT.BROWSER_PROFILES_DIR`) when the runtime names where;
    // else — and for a memory profile — Electron's own partition by name
    const targetSession =
      options.profilePath !== undefined
        ? session.fromPath(options.profilePath, { cache: true })
        : session.fromPartition(options.partition, { cache: options.persistent });
    installGuardedBrowserSurfaceSession(targetSession);
    const initial = baseRaster(options);
    const window = new BrowserWindow({
      show: false,
      frame: false,
      paintWhenInitiallyHidden: true,
      width: integerDimension(initial.width / options.deviceScaleFactor),
      height: integerDimension(initial.height / options.deviceScaleFactor),
      webPreferences: {
        session: targetSession,
        offscreen: {
          useSharedTexture: options.requestSharedTexture,
          sharedTexturePixelFormat: "argb",
          deviceScaleFactor: options.deviceScaleFactor,
        },
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        autoplayPolicy: "document-user-activation-required",
      },
    });
    installGuardedBrowserSurfaceContents(window.webContents);
    const bootstrapReady = window.loadURL("about:blank");
    return new ElectronBrowserSurfaceWindow(window, options, bootstrapReady);
  }

  monotonicNowUs(): bigint {
    return process.hrtime.bigint() / 1_000n;
  }

  engineAgent(): BrowserSurfaceAgent {
    return engineAgentOf({
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      systemVersion: process.getSystemVersion(),
    });
  }
}

export const browserElectronRasterPolicy = {
  baseRaster,
  safeEffectiveRaster,
};
