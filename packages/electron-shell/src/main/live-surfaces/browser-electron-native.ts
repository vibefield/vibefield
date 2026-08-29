import { BrowserWindow, session } from "electron";
import type {
  BrowserSurfaceNative,
  BrowserSurfaceNativeKeyInput,
  BrowserSurfaceNativeMouseInput,
  BrowserSurfaceNativeWindow,
  BrowserSurfaceNativeWindowOptions,
  BrowserSurfaceNavigationState,
  BrowserSurfacePaint,
} from "./browser-producer";
import {
  installGuardedBrowserSurfaceContents,
  installGuardedBrowserSurfaceSession,
} from "./browser-security";

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

  invalidate(): void {
    this.window.webContents.invalidate();
  }

  setBackingRaster(
    requested: { width: number; height: number },
    logicalViewport: { width: number; height: number },
    deviceScaleFactor: number,
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
        mobile: false,
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
    const targetSession = session.fromPartition(options.partition, {
      cache: options.persistent,
    });
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
}

export const browserElectronRasterPolicy = {
  baseRaster,
  safeEffectiveRaster,
};
