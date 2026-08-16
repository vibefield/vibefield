import {
  LiveSurfaceBrowserSourceV1 as BrowserSourceSchema,
  type LiveSurfaceBrowserSourceV1,
  type LiveSurfaceDemandV1,
  type LiveSurfaceErrorV1,
  type LiveSurfaceFrameMetadataV1,
  type LiveSurfaceGeometryV1,
  LiveSurfaceIdV1,
  type LiveSurfacePixelSizeV1,
  type LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import { LiveSurfaceDemandTracker, LiveSurfaceLifecycle } from "@vibefield/live-surfaces";
import type {
  BrowserControlTargetRegistry,
  BrowserControlTargetWebContents,
} from "./browser-control-target";
import { browserSurfacePartition, isAllowedBrowserTopLevelUrl } from "./browser-security";
import type {
  LiveSurfaceCpuFrame,
  LiveSurfaceRuntimeAttachContext,
  LiveSurfaceRuntimeAttachment,
  LiveSurfaceRuntimeAuthority,
} from "./runtime";
import {
  createLiveSurfaceRuntimeSupportSnapshot,
  type LiveSurfaceRuntimeSupportSnapshot,
} from "./runtime-support";
import type { LiveSurfaceProducerTextureFrame } from "./texture-forwarder";

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const DEFAULT_RASTER_STABILIZATION_MS = 300;
const DEFAULT_CPU_FALLBACK_PAINTS = 3;
const DEFAULT_RESTART_LIMIT = 1;
const CPU_FALLBACK_MAX_FPS = 10;
const CPU_FALLBACK_MAX_PIXELS = 1280 * 720;

const BROWSER_CAPABILITIES = {
  pointer: true,
  wheel: true,
  keyboard: true,
  textInput: true,
  touch: false,
  rotateDevice: false,
  resizeLogicalViewport: true,
  resizeBackingRaster: true,
  crop: false,
} as const;

export interface BrowserSurfacePaintImage {
  getSize(): { width: number; height: number };
  /** CPU-only fallback conversion; the requested output keeps degradation bounded. */
  toBitmap(targetSize?: LiveSurfacePixelSizeV1): Uint8Array;
}

export interface BrowserSurfacePaintTexture {
  readonly textureInfo: Electron.TextureInfo;
  release(): void;
}

export interface BrowserSurfacePaint {
  /** Electron 43 has been observed delivering `null` despite its optional-only d.ts. */
  readonly texture?: BrowserSurfacePaintTexture | null;
  readonly image: BrowserSurfacePaintImage;
}

export interface BrowserSurfaceNativeWindow {
  readonly controlContents: BrowserControlTargetWebContents;
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  destroy(): void;
  setFrameRate(fps: number): void;
  startPainting(): void;
  stopPainting(): void;
  invalidate(): void;
  /** Keeps logical layout fixed while selecting a producer backing raster. */
  setBackingRaster(
    requested: LiveSurfacePixelSizeV1,
    logicalViewport: LiveSurfaceBrowserSourceV1["logicalViewport"],
    deviceScaleFactor: number,
  ): Promise<LiveSurfacePixelSizeV1>;
  dispatchMouse(input: BrowserSurfaceNativeMouseInput): Promise<void>;
  dispatchKey(input: BrowserSurfaceNativeKeyInput): Promise<void>;
  dispatchText(text: string): Promise<void>;
  onPaint(listener: (paint: BrowserSurfacePaint) => void): () => void;
  onRenderProcessGone(listener: (reason: string) => void): () => void;
  onDestroyed(listener: () => void): () => void;
}

export interface BrowserSurfaceNativeWindowOptions {
  readonly partition: string;
  readonly persistent: boolean;
  readonly logicalViewport: LiveSurfaceBrowserSourceV1["logicalViewport"];
  readonly initialBackingRaster: LiveSurfacePixelSizeV1;
  readonly deviceScaleFactor: number;
  readonly requestSharedTexture: boolean;
}

export interface BrowserSurfaceNative {
  createWindow(options: BrowserSurfaceNativeWindowOptions): BrowserSurfaceNativeWindow;
  monotonicNowUs(): bigint;
}

export type BrowserSurfaceMouseButton = "none" | "left" | "middle" | "right";

export interface BrowserSurfaceNativeMouseInput {
  readonly type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
  readonly x: number;
  readonly y: number;
  readonly button?: BrowserSurfaceMouseButton;
  readonly clickCount?: number;
  readonly deltaX?: number;
  readonly deltaY?: number;
}

export interface BrowserSurfaceNativeKeyInput {
  readonly type: "keyDown" | "keyUp";
  readonly key: string;
  readonly code: string;
  readonly modifiers: number;
  readonly autoRepeat?: boolean;
  readonly location?: 0 | 1 | 2 | 3;
  readonly windowsVirtualKeyCode?: number;
}

export interface BrowserSurfaceKeyModifiers {
  readonly alt?: boolean;
  readonly control?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
}

export type BrowserSurfaceInputRequest =
  | {
      readonly kind: "mouse";
      readonly geometryRevision: number;
      readonly type: "move" | "down" | "up";
      readonly x: number;
      readonly y: number;
      readonly button?: Exclude<BrowserSurfaceMouseButton, "none">;
      readonly clickCount?: number;
    }
  | {
      readonly kind: "wheel";
      readonly geometryRevision: number;
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
    }
  | {
      readonly kind: "text";
      readonly geometryRevision: number;
      readonly text: string;
    }
  | {
      readonly kind: "key";
      readonly geometryRevision: number;
      readonly type: "down" | "up";
      readonly key: string;
      readonly code: string;
      readonly modifiers?: BrowserSurfaceKeyModifiers;
      readonly autoRepeat?: boolean;
      readonly location?: 0 | 1 | 2 | 3;
      readonly windowsVirtualKeyCode?: number;
    };

export interface BrowserLiveSurfaceRuntimeOptions {
  readonly surfaceId: string;
  readonly source: LiveSurfaceBrowserSourceV1;
  readonly native: BrowserSurfaceNative;
  readonly controlTargets?: BrowserControlTargetRegistry;
  readonly requestSharedTexture?: boolean;
  readonly startupTimeoutMs?: number;
  readonly rasterStabilizationMs?: number;
  readonly cpuFallbackPaints?: number;
  readonly restartLimit?: number;
}

export interface BrowserLiveSurfaceRuntimeStats {
  readonly attachmentsCreated: number;
  readonly activeAttachments: number;
  readonly demandUpdates: number;
  readonly producersStarted: number;
  readonly producerRestarts: number;
  readonly texturePaints: number;
  readonly cpuPaints: number;
  readonly sharedFramesOffered: number;
  readonly sharedFramesAccepted: number;
  readonly sharedFramesDropped: number;
  readonly cpuFramesOffered: number;
  readonly cpuFramesAccepted: number;
  readonly producerTextureReleases: number;
  readonly importedReferencesReleased: number;
  readonly effectiveDemand: LiveSurfaceDemandV1 | null;
}

interface BrowserRuntimeAttachmentRecord {
  readonly context: LiveSurfaceRuntimeAttachContext;
  readonly demand: LiveSurfaceDemandTracker;
  active: boolean;
}

interface SourceCallbacks {
  readonly removePaint: () => void;
  readonly removeGone: () => void;
  readonly removeDestroyed: () => void;
}

function increment(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} exhausted its safe integer range`);
  }
  return value + 1;
}

function defaultRaster(source: LiveSurfaceBrowserSourceV1): LiveSurfacePixelSizeV1 {
  const scale = source.deviceScaleFactor ?? 1;
  const candidate = {
    width: Math.max(1, Math.min(16_384, Math.round(source.logicalViewport.width * scale))),
    height: Math.max(1, Math.min(16_384, Math.round(source.logicalViewport.height * scale))),
  };
  const pixels = candidate.width * candidate.height;
  if (pixels <= 67_108_864) return candidate;
  const boundedScale = Math.sqrt(67_108_864 / pixels);
  return {
    width: Math.max(1, Math.floor(candidate.width * boundedScale)),
    height: Math.max(1, Math.floor(candidate.height * boundedScale)),
  };
}

function clampCpuRaster(size: LiveSurfacePixelSizeV1): LiveSurfacePixelSizeV1 {
  const pixels = size.width * size.height;
  if (pixels <= CPU_FALLBACK_MAX_PIXELS) return size;
  const scale = Math.sqrt(CPU_FALLBACK_MAX_PIXELS / pixels);
  return {
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
  };
}

function copyDemand(demand: LiveSurfaceDemandV1): LiveSurfaceDemandV1 {
  return {
    revision: demand.revision,
    mode: demand.mode,
    targetFps: demand.targetFps,
    ...(demand.targetRasterSize === undefined
      ? {}
      : {
          targetRasterSize: {
            width: demand.targetRasterSize.width,
            height: demand.targetRasterSize.height,
          },
        }),
    priority: demand.priority,
    interactive: demand.interactive,
  };
}

function aggregateDemand(
  attachments: Iterable<BrowserRuntimeAttachmentRecord>,
): LiveSurfaceDemandV1 | null {
  const demands = [...attachments]
    .filter((attachment) => attachment.active)
    .map((attachment) => attachment.demand.current)
    .filter((demand): demand is LiveSurfaceDemandV1 => demand !== null);
  if (demands.length === 0) return null;
  const live = demands.filter((demand) => demand.mode === "live");
  const selected = live.length > 0 ? live : demands;
  const mode =
    live.length > 0
      ? "live"
      : demands.some((demand) => demand.mode === "paused")
        ? "paused"
        : "hibernated";
  let width = 0;
  let height = 0;
  for (const demand of selected) {
    if (demand.targetRasterSize !== undefined) {
      width = Math.max(width, demand.targetRasterSize.width);
      height = Math.max(height, demand.targetRasterSize.height);
    }
  }
  return {
    revision: Math.max(...selected.map((demand) => demand.revision)),
    mode,
    targetFps:
      mode === "live"
        ? (Math.max(...live.map((demand) => demand.targetFps)) as LiveSurfaceDemandV1["targetFps"])
        : 0,
    ...(width > 0 && height > 0 ? { targetRasterSize: { width, height } } : {}),
    priority: Math.max(...selected.map((demand) => demand.priority)),
    interactive: selected.some((demand) => demand.interactive),
  };
}

function safeTimestamp(value: bigint): string {
  if (value < 0n) return "0";
  const maximum = 0xffff_ffff_ffff_ffffn;
  return (value > maximum ? maximum : value).toString();
}

function frameColorSpace(
  colorSpace: Electron.ColorSpace | undefined,
): "srgb" | "display-p3" | "rec709" {
  if (colorSpace?.primaries === "p3") return "display-p3";
  if (colorSpace?.matrix === "bt709" && colorSpace.range === "limited") return "rec709";
  return "srgb";
}

function sourceError(
  code: LiveSurfaceErrorV1["code"],
  message: string,
  recovery: LiveSurfaceErrorV1["recovery"],
): LiveSurfaceErrorV1 {
  return { code, message, recovery };
}

function validKeyToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function keyModifierMask(modifiers: BrowserSurfaceKeyModifiers | undefined): number {
  if (modifiers === undefined) return 0;
  return (
    (modifiers.alt === true ? 1 : 0) |
    (modifiers.control === true ? 2 : 0) |
    (modifiers.meta === true ? 4 : 0) |
    (modifiers.shift === true ? 8 : 0)
  );
}

/** Main-private, demand-driven Browser Offscreen Rendering producer. */
export class BrowserLiveSurfaceRuntime implements LiveSurfaceRuntimeAuthority {
  readonly surfaceId: string;
  readonly source: LiveSurfaceBrowserSourceV1;
  readonly #native: BrowserSurfaceNative;
  readonly #controlTargets: BrowserControlTargetRegistry | undefined;
  readonly #requestSharedTexture: boolean;
  readonly #startupTimeoutMs: number;
  readonly #rasterStabilizationMs: number;
  readonly #cpuFallbackPaints: number;
  readonly #restartLimit: number;
  readonly #lifecycle = new LiveSurfaceLifecycle();
  readonly #attachments = new Map<string, BrowserRuntimeAttachmentRecord>();
  #window: BrowserSurfaceNativeWindow | null = null;
  #callbacks: SourceCallbacks | null = null;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #rasterTimer: ReturnType<typeof setTimeout> | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #effectiveDemand: LiveSurfaceDemandV1 | null = null;
  #transport: "shared-texture" | "cpu-bgra" | undefined;
  #geometry: LiveSurfaceGeometryV1 | undefined;
  #geometryKey = "";
  #geometryRevision = 0;
  #sequence = 0n;
  #error: LiveSurfaceErrorV1 | undefined;
  #lastPublishedSummary = "";
  #cpuPaintStreak = 0;
  #restartAttempts = 0;
  #closed = false;
  #attachmentsCreated = 0;
  #demandUpdates = 0;
  #producersStarted = 0;
  #producerRestarts = 0;
  #texturePaints = 0;
  #cpuPaints = 0;
  #sharedFramesOffered = 0;
  #sharedFramesAccepted = 0;
  #sharedFramesDropped = 0;
  #cpuFramesOffered = 0;
  #cpuFramesAccepted = 0;
  #producerTextureReleases = 0;
  #importedReferencesReleased = 0;

  constructor(options: BrowserLiveSurfaceRuntimeOptions) {
    this.surfaceId = LiveSurfaceIdV1.parse(options.surfaceId);
    this.source = BrowserSourceSchema.parse(options.source);
    if (!isAllowedBrowserTopLevelUrl(this.source.initialUrl)) {
      throw new Error("Browser source initial URL must use HTTP or HTTPS");
    }
    this.#native = options.native;
    this.#controlTargets = options.controlTargets;
    this.#requestSharedTexture = options.requestSharedTexture ?? true;
    this.#startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.#rasterStabilizationMs = options.rasterStabilizationMs ?? DEFAULT_RASTER_STABILIZATION_MS;
    this.#cpuFallbackPaints = options.cpuFallbackPaints ?? DEFAULT_CPU_FALLBACK_PAINTS;
    this.#restartLimit = options.restartLimit ?? DEFAULT_RESTART_LIMIT;
    if (this.#startupTimeoutMs <= 0 || this.#rasterStabilizationMs < 0) {
      throw new RangeError("browser producer timing bounds are invalid");
    }
    if (!Number.isSafeInteger(this.#cpuFallbackPaints) || this.#cpuFallbackPaints <= 0) {
      throw new RangeError("CPU fallback paint threshold must be positive");
    }
    if (!Number.isSafeInteger(this.#restartLimit) || this.#restartLimit < 0) {
      throw new RangeError("browser producer restart limit must be non-negative");
    }
  }

  get summary(): LiveSurfaceRuntimeSummaryV1 {
    const lifecycle = this.#lifecycle.snapshot;
    return {
      v: 1,
      surfaceId: this.surfaceId,
      state: lifecycle.state,
      producerEpoch: lifecycle.producerEpoch,
      stateRevision: lifecycle.stateRevision,
      capabilities: BROWSER_CAPABILITIES,
      ...(this.#transport === undefined ? {} : { transport: this.#transport }),
      ...(this.#geometry === undefined ? {} : { geometry: this.#geometry }),
      ...(this.#error === undefined ? {} : { error: this.#error }),
    };
  }

  get stats(): BrowserLiveSurfaceRuntimeStats {
    return {
      attachmentsCreated: this.#attachmentsCreated,
      activeAttachments: this.#attachments.size,
      demandUpdates: this.#demandUpdates,
      producersStarted: this.#producersStarted,
      producerRestarts: this.#producerRestarts,
      texturePaints: this.#texturePaints,
      cpuPaints: this.#cpuPaints,
      sharedFramesOffered: this.#sharedFramesOffered,
      sharedFramesAccepted: this.#sharedFramesAccepted,
      sharedFramesDropped: this.#sharedFramesDropped,
      cpuFramesOffered: this.#cpuFramesOffered,
      cpuFramesAccepted: this.#cpuFramesAccepted,
      producerTextureReleases: this.#producerTextureReleases,
      importedReferencesReleased: this.#importedReferencesReleased,
      effectiveDemand: this.#effectiveDemand === null ? null : copyDemand(this.#effectiveDemand),
    };
  }

  supportSnapshot(): LiveSurfaceRuntimeSupportSnapshot {
    const stats = this.stats;
    return createLiveSurfaceRuntimeSupportSnapshot({
      sourceKind: "browser",
      summary: this.summary,
      effectiveDemand: stats.effectiveDemand,
      metrics: {
        attachmentsCreated: stats.attachmentsCreated,
        activeAttachments: stats.activeAttachments,
        producerStarts: stats.producersStarted,
        producerRestarts: stats.producerRestarts,
        framesObserved: stats.texturePaints + stats.cpuPaints,
        framesOffered: stats.sharedFramesOffered + stats.cpuFramesOffered,
        framesAccepted: stats.sharedFramesAccepted + stats.cpuFramesAccepted,
        framesDropped:
          stats.sharedFramesDropped + Math.max(0, stats.cpuFramesOffered - stats.cpuFramesAccepted),
        sharedFramesObserved: stats.texturePaints,
        cpuFramesObserved: stats.cpuPaints,
        localReferencesReleased: stats.producerTextureReleases,
        downstreamReferencesReleased: stats.importedReferencesReleased,
        referencesQuarantined: 0,
      },
    });
  }

  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment {
    if (this.#closed) throw new Error("cannot attach a closed Browser Live Surface");
    if (!context.operations.includes("view"))
      throw new Error("Browser attachment lacks view grant");
    if (this.#attachments.has(context.attachmentId)) {
      throw new Error("duplicate Browser Live Surface attachment identity");
    }
    const record: BrowserRuntimeAttachmentRecord = {
      context,
      demand: new LiveSurfaceDemandTracker(),
      active: true,
    };
    this.#attachments.set(context.attachmentId, record);
    this.#attachmentsCreated += 1;
    let disposed = false;
    const runtime = this;
    return {
      get summary() {
        return runtime.summary;
      },
      setDemand(demand) {
        if (disposed || !record.active) return;
        const result = record.demand.update(demand);
        if (result.kind !== "accepted") return;
        runtime.#demandUpdates += 1;
        runtime.reconcileDemand();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        record.active = false;
        runtime.#attachments.delete(context.attachmentId);
        runtime.reconcileDemand();
      },
    };
  }

  /** Explicit source-owner teardown; renderer detach alone only hibernates the source. */
  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.clearTimers();
    this.destroyWindow();
    this.#attachments.clear();
    if (this.#lifecycle.snapshot.state !== "closed") this.#lifecycle.transition("closed");
  }

  /** Main-private input seam; authorization is deliberately outside LiveSurfaceAttachment. */
  async dispatchInput(request: BrowserSurfaceInputRequest): Promise<void> {
    const geometry = this.#geometry;
    const window = this.#window;
    if (
      this.#closed ||
      window === null ||
      window.isDestroyed() ||
      geometry === undefined ||
      this.#lifecycle.snapshot.state !== "live"
    ) {
      throw new Error("Browser surface is not available for input");
    }
    if (request.geometryRevision !== geometry.revision) {
      throw new Error("Browser input named a stale geometry revision");
    }
    if (request.kind === "text") {
      if (request.text.length === 0 || request.text.length > 16_384) {
        throw new Error("Browser text input is outside the bounded contract");
      }
      await window.dispatchText(request.text);
      return;
    }
    if (request.kind === "key") {
      if (!validKeyToken(request.key) || !validKeyToken(request.code)) {
        throw new Error("Browser key input is outside the bounded contract");
      }
      if (
        request.windowsVirtualKeyCode !== undefined &&
        (!Number.isSafeInteger(request.windowsVirtualKeyCode) ||
          request.windowsVirtualKeyCode < 0 ||
          request.windowsVirtualKeyCode > 0xffff)
      ) {
        throw new Error("Browser key input has an invalid virtual key code");
      }
      if (
        (request.autoRepeat !== undefined && typeof request.autoRepeat !== "boolean") ||
        (request.location !== undefined && ![0, 1, 2, 3].includes(request.location))
      ) {
        throw new Error("Browser key input has invalid key state");
      }
      await window.dispatchKey({
        type: request.type === "down" ? "keyDown" : "keyUp",
        key: request.key,
        code: request.code,
        modifiers: keyModifierMask(request.modifiers),
        ...(request.autoRepeat === undefined ? {} : { autoRepeat: request.autoRepeat }),
        ...(request.location === undefined ? {} : { location: request.location }),
        ...(request.windowsVirtualKeyCode === undefined
          ? {}
          : { windowsVirtualKeyCode: request.windowsVirtualKeyCode }),
      });
      return;
    }
    if (
      !Number.isFinite(request.x) ||
      !Number.isFinite(request.y) ||
      request.x < 0 ||
      request.y < 0 ||
      request.x > geometry.logicalSize.width ||
      request.y > geometry.logicalSize.height
    ) {
      throw new Error("Browser pointer input is outside the logical viewport");
    }
    // CDP Input coordinates are CSS pixels in the main-frame viewport. The
    // presentation adapter has already supplied Browser logical coordinates;
    // backing-raster pixels and visibleRect offsets are presentation-only.
    const x = request.x;
    const y = request.y;
    if (request.kind === "wheel") {
      if (
        !Number.isFinite(request.deltaX) ||
        !Number.isFinite(request.deltaY) ||
        Math.abs(request.deltaX) > 100_000 ||
        Math.abs(request.deltaY) > 100_000
      ) {
        throw new Error("Browser wheel input is outside the bounded contract");
      }
      await window.dispatchMouse({
        type: "mouseWheel",
        x,
        y,
        deltaX: request.deltaX,
        deltaY: request.deltaY,
      });
      return;
    }
    if (
      request.clickCount !== undefined &&
      (!Number.isSafeInteger(request.clickCount) ||
        request.clickCount < 1 ||
        request.clickCount > 3)
    ) {
      throw new Error("Browser click count is outside the bounded contract");
    }
    await window.dispatchMouse({
      type:
        request.type === "move"
          ? "mouseMoved"
          : request.type === "down"
            ? "mousePressed"
            : "mouseReleased",
      x,
      y,
      button: request.type === "move" ? "none" : (request.button ?? "left"),
      ...(request.clickCount === undefined ? {} : { clickCount: request.clickCount }),
    });
  }

  private reconcileDemand(): void {
    this.#effectiveDemand = aggregateDemand(this.#attachments.values());
    const demand = this.#effectiveDemand;
    const state = this.#lifecycle.snapshot.state;
    if (demand === null) {
      if (state === "live") this.pauseProducer();
      if (this.#lifecycle.snapshot.state === "paused") this.hibernateProducer();
      return;
    }
    if (demand.mode === "live") {
      if (state === "created" || state === "hibernated" || state === "failed") {
        this.startProducer();
        return;
      }
      if (state === "reconnecting" && this.#window === null) {
        this.scheduleReconnect();
        return;
      }
      if (state === "paused") {
        this.#lifecycle.transition("live");
        this.#window?.startPainting();
        this.applyFrameRate();
        this.#window?.invalidate();
        this.publishSummary();
      } else {
        this.applyFrameRate();
      }
      this.scheduleRasterActuation();
      return;
    }
    if (demand.mode === "paused") {
      if (state === "live") this.pauseProducer();
      return;
    }
    if (state === "live") this.pauseProducer();
    if (this.#lifecycle.snapshot.state === "paused") this.hibernateProducer();
  }

  private startProducer(): void {
    if (this.#closed) return;
    this.clearSourceTimers();
    this.destroyWindow();
    this.#lifecycle.transition("starting");
    this.resetProducerObservations();
    this.#error = undefined;
    const epoch = this.#lifecycle.snapshot.producerEpoch;
    const demandRaster = this.#effectiveDemand?.targetRasterSize;
    const initialRaster = demandRaster ?? defaultRaster(this.source);
    let window: BrowserSurfaceNativeWindow;
    try {
      window = this.#native.createWindow({
        partition: browserSurfacePartition(this.source),
        persistent: this.source.profile.mode === "persistent",
        logicalViewport: this.source.logicalViewport,
        initialBackingRaster: initialRaster,
        deviceScaleFactor: this.source.deviceScaleFactor ?? 1,
        requestSharedTexture: this.#requestSharedTexture,
      });
      this.#window = window;
      const removePaint = window.onPaint((paint) => this.acceptPaint(window, epoch, paint));
      const removeGone = window.onRenderProcessGone((reason) =>
        this.handleProducerGone(window, epoch, reason),
      );
      const removeDestroyed = window.onDestroyed(() =>
        this.handleProducerGone(window, epoch, "WebContents destroyed"),
      );
      this.#callbacks = { removePaint, removeGone, removeDestroyed };
      this.#producersStarted += 1;
      this.applyFrameRate();
      this.#startupTimer = setTimeout(
        () => this.handleStartupTimeout(window, epoch),
        this.#startupTimeoutMs,
      );
      void window
        .setBackingRaster(
          initialRaster,
          this.source.logicalViewport,
          this.source.deviceScaleFactor ?? 1,
        )
        .then(() => {
          if (!this.isCurrent(window, epoch)) return;
          this.#controlTargets?.associate(this.surfaceId, epoch, window.controlContents);
          return window.loadURL(this.source.initialUrl);
        })
        .catch(() => {
          if (this.isCurrent(window, epoch)) {
            this.failSource(
              sourceError("source-not-found", "Browser source could not load", "user-action"),
            );
          }
        });
      this.publishSummary();
    } catch {
      this.failSource(
        sourceError("security-rejected", "Browser source could not start safely", "permanent"),
      );
    }
  }

  private acceptPaint(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    paint: BrowserSurfacePaint,
  ): void {
    if (!this.isCurrent(window, epoch) || !this.#lifecycle.acceptsFrames) {
      paint.texture?.release();
      return;
    }
    const texture = paint.texture;
    if (texture != null && texture.textureInfo.widgetType !== "frame") {
      texture.release();
      return;
    }
    if (
      texture != null &&
      (texture.textureInfo.pixelFormat === "bgra" || texture.textureInfo.pixelFormat === "rgba")
    ) {
      this.acceptSharedPaint(texture, epoch);
      return;
    }
    texture?.release();
    this.acceptCpuPaint(paint.image, epoch);
  }

  private acceptSharedPaint(texture: BrowserSurfacePaintTexture, epoch: number): void {
    this.#texturePaints += 1;
    this.#cpuPaintStreak = 0;
    const info = texture.textureInfo;
    const geometry = this.updateGeometry(info.codedSize, info.visibleRect);
    if (geometry === null) {
      texture.release();
      this.#producerTextureReleases += 1;
      return;
    }
    const capabilityChanged = this.#transport !== "shared-texture";
    this.#transport = "shared-texture";
    this.#error = undefined;
    const becameLive = this.observeFirstUsableFrame();
    this.#sequence += 1n;
    const pixelFormat = info.pixelFormat === "rgba" ? "rgba" : "bgra";
    const metadata: LiveSurfaceFrameMetadataV1 = {
      v: 1,
      surfaceId: this.surfaceId,
      producerEpoch: epoch,
      sequence: this.#sequence.toString(),
      geometry,
      hostReceivedAtUs: safeTimestamp(this.#native.monotonicNowUs()),
      ...(Number.isFinite(info.timestamp) && info.timestamp >= 0
        ? {
            producerTimestamp: {
              clockDomain: "chromium-osr-capture",
              timestampUs: safeTimestamp(BigInt(Math.floor(info.timestamp))),
            },
          }
        : {}),
      pixelFormat,
      colorSpace: frameColorSpace(info.colorSpace),
      alphaMode: "premultiplied",
      transport: "shared-texture",
    };
    this.publishSummary();
    const targets = this.liveAttachments();
    if (targets.length === 0) {
      texture.release();
      this.#producerTextureReleases += 1;
    } else {
      let sourceLeases = targets.length;
      let sourceReleased = false;
      const releaseSource = (): void => {
        sourceLeases -= 1;
        if (sourceLeases !== 0 || sourceReleased) return;
        sourceReleased = true;
        texture.release();
        this.#producerTextureReleases += 1;
      };
      for (const target of targets) {
        let sourceCallbackUsed = false;
        let referenceCallbackUsed = false;
        const frame: LiveSurfaceProducerTextureFrame = {
          metadata,
          textureInfo: {
            codedSize: info.codedSize,
            colorSpace: info.colorSpace,
            handle: info.handle,
            pixelFormat,
            timestamp: info.timestamp,
            visibleRect: info.visibleRect,
          },
          releaseSource: () => {
            if (sourceCallbackUsed) return;
            sourceCallbackUsed = true;
            releaseSource();
          },
          allReferencesReleased: () => {
            if (referenceCallbackUsed) return;
            referenceCallbackUsed = true;
            this.#importedReferencesReleased += 1;
          },
        };
        this.#sharedFramesOffered += 1;
        try {
          const result = target.context.offerTextureFrame(frame);
          if (result.kind === "accepted") this.#sharedFramesAccepted += 1;
          else this.#sharedFramesDropped += 1;
        } catch {
          frame.releaseSource("protocol-violation");
          frame.allReferencesReleased("protocol-violation");
          this.#sharedFramesDropped += 1;
        }
      }
    }
    if (capabilityChanged) this.applyFrameRate();
    if (becameLive && this.#effectiveDemand?.mode !== "live") this.reconcileDemand();
  }

  private acceptCpuPaint(image: BrowserSurfacePaintImage, epoch: number): void {
    this.#cpuPaints += 1;
    this.#cpuPaintStreak += 1;
    if (this.#cpuPaintStreak < this.#cpuFallbackPaints && this.#transport !== "cpu-bgra") return;
    const size = clampCpuRaster(image.getSize());
    const geometry = this.updateGeometry(size, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });
    if (geometry === null) return;
    let pixels: Uint8Array;
    try {
      const bitmap = image.toBitmap(size);
      if (bitmap.byteLength !== size.width * size.height * 4) return;
      pixels = Uint8Array.from(bitmap);
    } catch {
      return;
    }
    const capabilityChanged = this.#transport !== "cpu-bgra";
    this.#transport = "cpu-bgra";
    this.#error = sourceError(
      "transport-degraded",
      "Browser shared texture was unavailable; bounded CPU fallback is active",
      "automatic",
    );
    const becameLive = this.observeFirstUsableFrame();
    this.#sequence += 1n;
    const frame: LiveSurfaceCpuFrame = {
      metadata: {
        v: 1,
        surfaceId: this.surfaceId,
        producerEpoch: epoch,
        sequence: this.#sequence.toString(),
        geometry,
        hostReceivedAtUs: safeTimestamp(this.#native.monotonicNowUs()),
        pixelFormat: "bgra",
        colorSpace: "srgb",
        alphaMode: "premultiplied",
        transport: "cpu-bgra",
        degradedMode: "cpu-bitmap",
      },
      pixels,
    };
    this.publishSummary();
    for (const target of this.liveAttachments()) {
      this.#cpuFramesOffered += 1;
      if (target.context.publishCpuFrame(frame)) this.#cpuFramesAccepted += 1;
    }
    if (capabilityChanged) {
      this.applyFrameRate();
      this.scheduleRasterActuation();
    }
    if (becameLive && this.#effectiveDemand?.mode !== "live") this.reconcileDemand();
  }

  private observeFirstUsableFrame(): boolean {
    if (this.#startupTimer !== null) {
      clearTimeout(this.#startupTimer);
      this.#startupTimer = null;
    }
    const state = this.#lifecycle.snapshot.state;
    if (state === "starting" || state === "reconnecting") {
      this.#lifecycle.transition("live");
      this.#restartAttempts = 0;
      return true;
    }
    return false;
  }

  private updateGeometry(
    codedSize: { width: number; height: number },
    visibleRect: { x: number; y: number; width: number; height: number },
  ): LiveSurfaceGeometryV1 | null {
    if (
      !Number.isInteger(codedSize.width) ||
      !Number.isInteger(codedSize.height) ||
      codedSize.width <= 0 ||
      codedSize.height <= 0 ||
      codedSize.width > 16_384 ||
      codedSize.height > 16_384 ||
      codedSize.width * codedSize.height > 67_108_864 ||
      !Number.isInteger(visibleRect.x) ||
      !Number.isInteger(visibleRect.y) ||
      !Number.isInteger(visibleRect.width) ||
      !Number.isInteger(visibleRect.height) ||
      visibleRect.x < 0 ||
      visibleRect.y < 0 ||
      visibleRect.width <= 0 ||
      visibleRect.height <= 0 ||
      visibleRect.x + visibleRect.width > codedSize.width ||
      visibleRect.y + visibleRect.height > codedSize.height
    ) {
      return null;
    }
    const key = `${codedSize.width}:${codedSize.height}:${visibleRect.x}:${visibleRect.y}:${visibleRect.width}:${visibleRect.height}:${this.source.logicalViewport.width}:${this.source.logicalViewport.height}`;
    if (key !== this.#geometryKey) {
      this.#geometryRevision = increment(this.#geometryRevision, "Browser geometry revision");
      this.#geometryKey = key;
    }
    this.#geometry = {
      revision: this.#geometryRevision,
      codedSize: { width: codedSize.width, height: codedSize.height },
      visibleRect: {
        x: visibleRect.x,
        y: visibleRect.y,
        width: visibleRect.width,
        height: visibleRect.height,
      },
      logicalSize: {
        width: this.source.logicalViewport.width,
        height: this.source.logicalViewport.height,
      },
      orientation: 0,
    };
    return this.#geometry;
  }

  private pauseProducer(): void {
    if (this.#lifecycle.snapshot.state !== "live") return;
    if (this.#rasterTimer !== null) {
      clearTimeout(this.#rasterTimer);
      this.#rasterTimer = null;
    }
    this.#window?.stopPainting();
    this.#lifecycle.transition("paused");
    this.publishSummary();
  }

  private hibernateProducer(): void {
    if (this.#lifecycle.snapshot.state !== "paused") return;
    this.#lifecycle.transition("hibernated");
    this.destroyWindow();
    this.publishSummary();
  }

  private applyFrameRate(): void {
    const demand = this.#effectiveDemand;
    const window = this.#window;
    if (demand?.mode !== "live" || window === null || window.isDestroyed()) return;
    const requested = demand.targetFps;
    window.setFrameRate(
      this.#transport === "cpu-bgra" ? Math.min(requested, CPU_FALLBACK_MAX_FPS) : requested,
    );
  }

  private scheduleRasterActuation(): void {
    const window = this.#window;
    const demand = this.#effectiveDemand;
    if (window === null || demand?.mode !== "live") return;
    if (this.#rasterTimer !== null) clearTimeout(this.#rasterTimer);
    const epoch = this.#lifecycle.snapshot.producerEpoch;
    const requested = demand.targetRasterSize ?? defaultRaster(this.source);
    const bounded = this.#transport === "cpu-bgra" ? clampCpuRaster(requested) : requested;
    this.#rasterTimer = setTimeout(() => {
      this.#rasterTimer = null;
      if (!this.isCurrent(window, epoch) || this.#effectiveDemand?.mode !== "live") return;
      void window
        .setBackingRaster(bounded, this.source.logicalViewport, this.source.deviceScaleFactor ?? 1)
        .then(() => {
          if (this.isCurrent(window, epoch) && this.#effectiveDemand?.mode === "live") {
            window.invalidate();
          }
        })
        .catch(() => undefined);
    }, this.#rasterStabilizationMs);
  }

  private handleStartupTimeout(window: BrowserSurfaceNativeWindow, epoch: number): void {
    this.#startupTimer = null;
    if (!this.isCurrent(window, epoch)) return;
    const error = sourceError(
      "frame-stalled",
      "Browser source produced no usable paint",
      "automatic",
    );
    if (this.retryFailedProducer(error)) return;
    this.failSource(error);
  }

  private handleProducerGone(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    _reason: string,
  ): void {
    if (!this.ownsProducer(window, epoch) || this.#closed) return;
    const state = this.#lifecycle.snapshot.state;
    if (
      state === "live" &&
      this.#effectiveDemand?.mode === "live" &&
      this.#restartAttempts < this.#restartLimit
    ) {
      this.#restartAttempts += 1;
      this.#producerRestarts += 1;
      this.#lifecycle.transition("reconnecting");
      this.destroyWindow();
      this.resetProducerObservations();
      this.#error = sourceError(
        "producer-crashed",
        "Browser renderer exited; reconnecting the source",
        "automatic",
      );
      this.publishSummary();
      this.scheduleReconnect();
      return;
    }
    const error = sourceError("producer-crashed", "Browser renderer exited", "automatic");
    if ((state === "starting" || state === "reconnecting") && this.retryFailedProducer(error)) {
      return;
    }
    this.failSource(error);
  }

  private createReconnectingProducer(): void {
    if (this.#lifecycle.snapshot.state !== "reconnecting") return;
    // Reconnecting already advanced producerEpoch. Reuse the normal constructor
    // path without a second lifecycle transition.
    const epoch = this.#lifecycle.snapshot.producerEpoch;
    const initialRaster = this.#effectiveDemand?.targetRasterSize ?? defaultRaster(this.source);
    try {
      const window = this.#native.createWindow({
        partition: browserSurfacePartition(this.source),
        persistent: this.source.profile.mode === "persistent",
        logicalViewport: this.source.logicalViewport,
        initialBackingRaster: initialRaster,
        deviceScaleFactor: this.source.deviceScaleFactor ?? 1,
        requestSharedTexture: this.#requestSharedTexture,
      });
      this.#window = window;
      this.#callbacks = {
        removePaint: window.onPaint((paint) => this.acceptPaint(window, epoch, paint)),
        removeGone: window.onRenderProcessGone((reason) =>
          this.handleProducerGone(window, epoch, reason),
        ),
        removeDestroyed: window.onDestroyed(() =>
          this.handleProducerGone(window, epoch, "WebContents destroyed"),
        ),
      };
      this.#producersStarted += 1;
      this.applyFrameRate();
      this.#startupTimer = setTimeout(
        () => this.handleStartupTimeout(window, epoch),
        this.#startupTimeoutMs,
      );
      void window
        .setBackingRaster(
          initialRaster,
          this.source.logicalViewport,
          this.source.deviceScaleFactor ?? 1,
        )
        .then(() => {
          if (this.isCurrent(window, epoch)) {
            this.#controlTargets?.associate(this.surfaceId, epoch, window.controlContents);
            return window.loadURL(this.source.initialUrl);
          }
        })
        .catch(() => {
          if (this.isCurrent(window, epoch)) {
            this.failSource(
              sourceError("source-not-found", "Browser source could not reconnect", "user-action"),
            );
          }
        });
    } catch {
      this.failSource(
        sourceError("security-rejected", "Browser source could not reconnect safely", "permanent"),
      );
    }
  }

  private failSource(error: LiveSurfaceErrorV1): void {
    if (this.#closed) return;
    const state = this.#lifecycle.snapshot.state;
    this.clearSourceTimers();
    this.destroyWindow();
    if (state !== "failed" && this.#lifecycle.canTransition("failed")) {
      this.#lifecycle.transition("failed");
    }
    this.#error = error;
    this.publishSummary();
  }

  private destroyWindow(): void {
    const window = this.#window;
    const callbacks = this.#callbacks;
    this.#window = null;
    this.#callbacks = null;
    if (this.#startupTimer !== null) {
      clearTimeout(this.#startupTimer);
      this.#startupTimer = null;
    }
    callbacks?.removePaint();
    callbacks?.removeGone();
    callbacks?.removeDestroyed();
    if (window === null) return;
    this.#controlTargets?.revoke(this.surfaceId, window.controlContents);
    if (!window.isDestroyed()) window.destroy();
  }

  private liveAttachments(): BrowserRuntimeAttachmentRecord[] {
    return [...this.#attachments.values()].filter(
      (attachment) => attachment.active && attachment.demand.current?.mode === "live",
    );
  }

  private publishSummary(): void {
    const summary = this.summary;
    const key = JSON.stringify(summary);
    if (key === this.#lastPublishedSummary) return;
    this.#lastPublishedSummary = key;
    for (const attachment of this.#attachments.values()) {
      if (attachment.active) attachment.context.publishSummary(summary);
    }
  }

  private isCurrent(window: BrowserSurfaceNativeWindow, epoch: number): boolean {
    return this.ownsProducer(window, epoch) && !window.isDestroyed();
  }

  private ownsProducer(window: BrowserSurfaceNativeWindow, epoch: number): boolean {
    return (
      !this.#closed && this.#window === window && this.#lifecycle.snapshot.producerEpoch === epoch
    );
  }

  private resetProducerObservations(): void {
    this.#transport = undefined;
    this.#geometry = undefined;
    this.#geometryKey = "";
    this.#sequence = 0n;
    this.#cpuPaintStreak = 0;
  }

  private scheduleReconnect(): void {
    if (
      this.#restartTimer !== null ||
      this.#closed ||
      this.#lifecycle.snapshot.state !== "reconnecting" ||
      this.#effectiveDemand?.mode !== "live"
    ) {
      return;
    }
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#closed || this.#effectiveDemand?.mode !== "live") return;
      this.createReconnectingProducer();
    }, 0);
  }

  private retryFailedProducer(error: LiveSurfaceErrorV1): boolean {
    if (
      this.#closed ||
      this.#effectiveDemand?.mode !== "live" ||
      this.#restartAttempts >= this.#restartLimit
    ) {
      return false;
    }
    this.#restartAttempts += 1;
    this.#producerRestarts += 1;
    this.failSource(error);
    this.scheduleFailedRestart();
    return true;
  }

  private scheduleFailedRestart(): void {
    if (
      this.#restartTimer !== null ||
      this.#closed ||
      this.#lifecycle.snapshot.state !== "failed" ||
      this.#effectiveDemand?.mode !== "live"
    ) {
      return;
    }
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (
        this.#closed ||
        this.#lifecycle.snapshot.state !== "failed" ||
        this.#effectiveDemand?.mode !== "live"
      ) {
        return;
      }
      this.startProducer();
    }, 0);
  }

  private clearSourceTimers(): void {
    if (this.#startupTimer !== null) clearTimeout(this.#startupTimer);
    if (this.#rasterTimer !== null) clearTimeout(this.#rasterTimer);
    if (this.#restartTimer !== null) clearTimeout(this.#restartTimer);
    this.#startupTimer = null;
    this.#rasterTimer = null;
    this.#restartTimer = null;
  }

  private clearTimers(): void {
    this.clearSourceTimers();
  }
}
