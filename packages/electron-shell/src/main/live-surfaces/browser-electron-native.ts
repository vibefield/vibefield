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
  type BrowserSurfaceRefusal,
  engineAgentOf,
} from "./browser-producer";
import {
  installGuardedBrowserSurfaceContents,
  installGuardedBrowserSurfaceSession,
} from "./browser-security";

/** How long a favicon's fetch may take before the page is said to have none. */
const FAVICON_TIMEOUT_MS = 5_000;

/**
 * PT-5a — said to every document before its own scripts run (CDP `Page.addScriptToEvaluateOnNewDocument`): a page may not
 * close its own window (Electron destroys the WebContents under a script's `window.close()` with no event to refuse — the
 * probe), and its `prompt` answers as a cancelled one (Electron's throws "prompt() is not supported").
 */
const PAGE_GUARD_SCRIPT =
  '(() => { try { Object.defineProperty(window, "close", { value: function close() {}, writable: true, configurable: true }); } catch {} window.prompt = function prompt() { return null; }; })();';

/** The file picker never shown: CDP says it was asked for (`Page.fileChooserOpened`) and cancels it — the input hears `cancel`. */
const NO_FILE_PICKER = { enabled: true, cancel: true } as const;

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
  /** PT-5a: the bootstrap document has been taken out of the page's history (below) — once a window's life. */
  #bootstrapPruned = false;
  /** PT-5a: the main frame's last load failed with this net error (cleared when a page commits). */
  #loadFailure: number | undefined;
  /** PT-5a: who hears what the page asked for and may not have. */
  readonly #refusedListeners = new Set<(what: BrowserSurfaceRefusal, url?: string) => void>();

  constructor(
    readonly window: BrowserWindow,
    readonly options: BrowserSurfaceNativeWindowOptions,
    readonly bootstrapReady: Promise<void>,
  ) {
    this.controlContents = window.webContents;
    window.webContents.debugger.on("message", (_event, method, params, sessionId) =>
      this.heard(method, params as Readonly<Record<string, unknown>>, sessionId),
    );
  }

  /** PT-5a: the page asked for what it may not have — told to the producer (the guards have already answered the page). */
  refused(what: BrowserSurfaceRefusal, url?: string): void {
    for (const listener of [...this.#refusedListeners]) listener(what, url);
  }

  onRefused(listener: (what: BrowserSurfaceRefusal, url?: string) => void): () => void {
    this.#refusedListeners.add(listener);
    return () => this.#refusedListeners.delete(listener);
  }

  /**
   * PT-5a — what CDP says of the page's asks. A dialog is WebContents-wide and said on every session with its Page domain on,
   * so it is counted on the page's own session alone (`alert`, `confirm`; `beforeunload` is `will-prevent-unload`'s to say);
   * a file picker is its frame's. A frame in ANOTHER process is a target of its own (`Target.attachedToTarget`): the same
   * guards are put on its session as it attaches — the page's own session does not reach it (the probe).
   */
  private heard(
    method: string,
    params: Readonly<Record<string, unknown>>,
    sessionId: string | undefined,
  ): void {
    if (method === "Page.fileChooserOpened") {
      this.refused("file-picker");
      return;
    }
    if (method === "Page.javascriptDialogOpening") {
      const type = params["type"];
      if ((sessionId === undefined || sessionId === "") && (type === "alert" || type === "confirm"))
        this.refused(type);
      return;
    }
    if (method !== "Target.attachedToTarget") return;
    const info = params["targetInfo"] as { readonly type?: unknown } | undefined;
    const child = params["sessionId"];
    if (info?.type !== "iframe" || typeof child !== "string" || this.isDestroyed()) return;
    const cdp = this.window.webContents.debugger;
    void (async () => {
      await cdp.sendCommand("Page.enable", {}, child);
      await cdp.sendCommand("Page.setInterceptFileChooserDialog", NO_FILE_PICKER, child);
      await cdp.sendCommand(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: PAGE_GUARD_SCRIPT },
        child,
      );
    })().catch(() => undefined);
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
      // PT-5b (ruling 5b): never forced on a `mobile` page — a phone's page lays itself out at its OWN width (one that
      // names no viewport: 980 px) and is shown whole at its own scale; forced to 1 it showed its top-left corner (PT-4)
      if (!mobile) {
        await this.window.webContents.debugger.sendCommand("Emulation.setPageScaleFactor", {
          pageScaleFactor: effective.pageScaleFactor,
        });
      }
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

  /** PT-5b (ruling 5c): the page's visual-viewport scale now (1 where the engine says none). */
  visualScale(): Promise<number> {
    let scale = 1;
    return this.enqueue(async () => {
      await this.ensureDebugger();
      const metrics = (await this.window.webContents.debugger.sendCommand(
        "Page.getLayoutMetrics",
      )) as { cssVisualViewport?: { scale?: number } } | undefined;
      const said = metrics?.cssVisualViewport?.scale;
      if (typeof said === "number" && Number.isFinite(said) && said > 0) scale = said;
    }).then(() => scale);
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
        ...(this.#loadFailure === undefined ? {} : { failure: this.#loadFailure }),
      });
    };
    // PT-5a — A LOAD THAT FAILED (probed): Electron says `did-fail-load` with the net error and the address ASKED for, then
    // commits its own error page under that address with NO `did-navigate`; `getURL()` stays the asked address. So a failure
    // stands from `did-fail-load` until the next `did-navigate` (a page that committed). −3 is an aborted load (a stop, a
    // download, a navigation that replaced it): not a failure.
    const failed = (
      _event: Electron.Event,
      code: number,
      _description: string,
      _url: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || code === -3) return;
      this.#loadFailure = code;
      emit();
    };
    const committed = (): void => {
      this.#loadFailure = undefined;
      emit();
    };
    // PT-5a — A FRESH PAGE HAS NOWHERE TO GO BACK TO: the bootstrap `about:blank` is an entry of the window's history, so a
    // page's first load said `canGoBack: true` and ‹ went to a blank film (probed; the BAR row's first read). It is pruned
    // once the first remote load has stopped — a load that failed too (its error page stands in the asked address's entry).
    const stopped = (): void => {
      if (!this.#bootstrapPruned && this.#remoteLoadStarted && !this.isDestroyed()) {
        this.#bootstrapPruned = true;
        try {
          contents.navigationHistory.clear();
        } catch {
          // a history that cannot be pruned now keeps its first entry: ‹ stays lit, as before
        }
      }
      emit();
    };
    contents.on("did-navigate", committed);
    contents.on("did-fail-load", failed);
    contents.on("did-navigate-in-page", emit);
    contents.on("page-title-updated", emit);
    contents.on("did-start-loading", emit);
    contents.on("did-stop-loading", stopped);
    return () => {
      contents.off("did-navigate", committed);
      contents.off("did-fail-load", failed);
      contents.off("did-navigate-in-page", emit);
      contents.off("page-title-updated", emit);
      contents.off("did-start-loading", emit);
      contents.off("did-stop-loading", stopped);
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

  onUnresponsive(listener: (unresponsive: boolean) => void): () => void {
    const hung = (): void => listener(true);
    const answering = (): void => listener(false);
    this.window.webContents.on("unresponsive", hung);
    this.window.webContents.on("responsive", answering);
    return () => {
      this.window.webContents.off("unresponsive", hung);
      this.window.webContents.off("responsive", answering);
    };
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

  /**
   * The page's CDP session — and, PT-5a, its GUARDS, put on as it attaches (before the page's first load: the window's first
   * layout asks for it, after the bootstrap document): the file picker intercepted and cancelled, `window.close` and
   * `prompt` replaced in every new document, frames in other processes attached so they are guarded too. A guard that
   * cannot be set fails the command that asked for the session — the page is never loaded without them.
   */
  private async ensureDebugger(): Promise<void> {
    if (this.isDestroyed()) throw new Error("Browser surface target is unavailable");
    const cdp = this.window.webContents.debugger;
    if (!cdp.isAttached()) {
      cdp.attach("1.3");
      try {
        await cdp.sendCommand("Page.enable");
        await cdp.sendCommand("Page.setInterceptFileChooserDialog", NO_FILE_PICKER);
        await cdp.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
          source: PAGE_GUARD_SCRIPT,
        });
        await cdp.sendCommand("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
      } catch (error) {
        cdp.detach();
        throw error;
      }
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
        // PT-5a: a page never raises a native dialog — `alert` returns at once, `confirm` answers false (ruling 7)
        disableDialogs: true,
      },
    });
    // the guards are installed BEFORE the bootstrap document; what they refuse is told to the window made just below
    const told: { refused?: (what: BrowserSurfaceRefusal, url?: string) => void } = {};
    installGuardedBrowserSurfaceContents(window.webContents, (what, url) =>
      told.refused?.(what, url),
    );
    const bootstrapReady = window.loadURL("about:blank");
    const surface = new ElectronBrowserSurfaceWindow(window, options, bootstrapReady);
    told.refused = (what, url) => surface.refused(what, url);
    return surface;
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
