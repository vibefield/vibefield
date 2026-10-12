import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  LiveSurfaceBrowserSourceV1 as BrowserSourceSchema,
  LIVE_SURFACE_FAVICON_MAX_BYTES,
  type LiveSurfaceBrowserEmulationV1,
  type LiveSurfaceBrowserSourceV1,
  type LiveSurfaceBrowserStateV1,
  type LiveSurfaceDemandV1,
  type LiveSurfaceErrorV1,
  type LiveSurfaceFrameMetadataV1,
  type LiveSurfaceGeometryV1,
  LiveSurfaceIdV1,
  type LiveSurfaceInputEventV1,
  type LiveSurfaceLoadFailureV1,
  type LiveSurfaceNavigationCommandV1,
  type LiveSurfacePixelSizeV1,
  type LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import { LiveSurfaceDemandTracker, LiveSurfaceLifecycle } from "@vibefield/live-surfaces";
import type {
  BrowserControlTargetRegistry,
  BrowserControlTargetWebContents,
} from "./browser-control-target";
import {
  browserSurfacePartition,
  browserSurfaceProfileName,
  isAllowedBrowserTopLevelUrl,
} from "./browser-security";
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
/** PT-5a: how long past Electron's own `unresponsive` a page may hang before it is said to have stopped. */
const DEFAULT_UNRESPONSIVE_MS = 5_000;
/** How long a page with no renderer attached is kept paused before it hibernates (PT-2: a window reload's gap — the window
 * pool's own grace). */
const DEFAULT_DETACHED_HIBERNATE_MS = 60_000;
const CPU_FALLBACK_MAX_FPS = 10;
/** PT-5b (ruling 5c): how long a `mobile` page's visual-viewport scale, once read, serves a move, a hover or a wheel
 * (a press always reads it afresh). */
/** PT-5c (ruling 2): where a button is let go that the person never let go over the page — outside its view (CSS px). */
const OUTSIDE_THE_VIEW = { x: -1000, y: -1000 } as const;
/** PT-5c (R2): how long an event waits for its document's first word of its scale before it is refused — the net under the
 * hand: no page that never speaks is known, and none holds the events behind it for good. */
const SCALE_WORD_MS = 1_000;
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
  /**
   * PT-5b: a paint of the window's BOOTSTRAP document — its blank `about:blank`, which stands until the page's own first
   * document commits (for as long as the page's server takes to answer). It says the window is up; it is nothing of the
   * page, and is shown to nobody.
   */
  readonly bootstrap?: boolean;
}

export interface BrowserSurfaceNativeWindow {
  readonly controlContents: BrowserControlTargetWebContents;
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  destroy(): void;
  setFrameRate(fps: number): void;
  startPainting(): void;
  stopPainting(): void;
  /** The page's sound. `stopPainting()` stops an offscreen page's frames, never its audio (Electron 43). */
  setAudioMuted(muted: boolean): void;
  invalidate(): void;
  /** Keeps logical layout fixed while selecting a producer backing raster. */
  setBackingRaster(
    requested: LiveSurfacePixelSizeV1,
    logicalViewport: LiveSurfaceBrowserSourceV1["logicalViewport"],
    deviceScaleFactor: number,
    /** PT-4: a phone's or a tablet's layout (the metrics override's `mobile`); absent: a desktop's. */
    mobile?: boolean,
  ): Promise<LiveSurfacePixelSizeV1>;
  /** PT-4: what the page is TOLD of its device — its agent with its hints, touch, the colour scheme (CDP's Emulation). */
  setEmulation(emulation: BrowserSurfaceNativeEmulation): Promise<void>;
  dispatchMouse(input: BrowserSurfaceNativeMouseInput): Promise<void>;
  /** PT-4: a finger on a touch device's page (CDP `Input.dispatchTouchEvent`). */
  dispatchTouch(input: BrowserSurfaceNativeTouchInput): Promise<void>;
  dispatchKey(input: BrowserSurfaceNativeKeyInput): Promise<void>;
  dispatchText(text: string): Promise<void>;
  /** PT-3: an IME composition as it runs — its text and the caret within it (CDP `Input.imeSetComposition`). */
  dispatchCompose(text: string, caret: number): Promise<void>;
  /** History/loading navigation. `go` rides `loadURL` so the initial-load and
   * chrome-navigation paths share one policy gate. */
  navigate(action: "back" | "forward" | "reload" | "stop"): void;
  /** Committed navigation truth, emitted on every URL/title/loading/history
   * change. The adapter reads the values fresh at emit time. */
  onNavigationState(listener: (state: BrowserSurfaceNavigationState) => void): () => void;
  /** PT-3: the page's CURSOR as it changes (Electron's `cursor-changed`), as a CSS cursor name. */
  onCursor(listener: (cursor: string) => void): () => void;
  /** PT-4: the page NAMED its icons (Electron's `page-favicon-updated`). Said once a page has stopped loading, and ONLY when
   * they differ from the page before's — a reload, and a page naming the same icons, say nothing (the PT-4 smoke lost its
   * favicon at the first reload; the probe showed why). */
  onFavicon(listener: (urls: readonly string[]) => void): () => void;
  /** PT-4: an icon fetched THROUGH THE PAGE'S OWN SESSION (its cookies, its guard), held to `maxBytes`; null — not
   * answered, not an image, or past the cap. */
  fetchIcon(url: string, maxBytes: number): Promise<BrowserSurfaceIcon | null>;
  /**
   * PT-5c (ruling 1) — the page SAYS its VISUAL-VIEWPORT scale (its guard's word through a binding): how many view px a
   * page's CSS px takes on screen — 1 for a page laid out at the view's width; under 1 for a `mobile` page that lays itself
   * out wider (one that names no viewport: 980 px into a phone's 402 — 0.41) and is shown whole; more after it zooms. Said
   * at a document's start and at every change, with the document the window counted as the word came. (PT-5b read it —
   * `Page.getLayoutMetrics`, the renderer's — on the hand's path: unanswered while a navigation pends.)
   */
  onScale(listener: (scale: number, document: number) => void): () => void;
  /** PT-5a: the page stopped answering its input (`true` — Electron's `unresponsive`) or answers again (`false`). */
  onUnresponsive(listener: (unresponsive: boolean) => void): () => void;
  /** PT-5a: the page asked for something it MAY NOT have, and was answered at once (`BrowserSurfaceRefusal`); a pop-up
   * comes with the address it asked for. */
  onRefused(listener: (what: BrowserSurfaceRefusal, url?: string) => void): () => void;
  onPaint(listener: (paint: BrowserSurfacePaint) => void): () => void;
  onRenderProcessGone(listener: (reason: string) => void): () => void;
  onDestroyed(listener: () => void): () => void;
}

/**
 * PT-5a (ruling 7) — WHAT A PAGE MAY NOT DO, each answered at once and never by a native window:
 *  - `alert` — dismissed; `confirm` — cancelled (`prompt` is cancelled before it reaches the engine: uncounted);
 *  - `beforeunload` — the page leaves; `popup` (`window.open`, `target=_blank`) — no window: the SAME pane goes there;
 *  - `download` — cancelled, and said in the page's state (`refused`) for the head to say for a moment;
 *  - `file-picker` — cancelled (the input hears `cancel`); `auth` — HTTP auth cancelled (the page's own 401).
 * Permission requests are denied by the session's handlers and `window.close()` is replaced before the page's scripts run:
 * neither is counted here.
 */
export const BROWSER_SURFACE_REFUSALS = [
  "alert",
  "confirm",
  "beforeunload",
  "popup",
  "download",
  "file-picker",
  "auth",
] as const;
export type BrowserSurfaceRefusal = (typeof BROWSER_SURFACE_REFUSALS)[number];

export interface BrowserSurfaceNavigationState {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** PT-5b3 (ruling 4): how many DOCUMENTS of the page this window has committed (0: none yet) — one more at a
   * navigation's commit and at a failed load's error page; never at a move within a document (a hash, `pushState`,
   * `replaceState`), a load that only began, or one that was aborted. */
  readonly document: number;
  /** PT-5a: the main frame's last load FAILED — the engine's net error code (`-102` a refused connection); absent once a
   * page commits. `url` is then the address that was asked for (Electron's own word: the probe). */
  readonly failure?: number;
}

/** PT-5a: a page's state as a producer started again finds it — its address kept, its last load's failure forgotten. */
function loadingAgain(state: LiveSurfaceBrowserStateV1): LiveSurfaceBrowserStateV1 {
  const { failure: _failure, ...rest } = state;
  return { ...rest, loading: true, canGoBack: false, canGoForward: false };
}

/**
 * PT-5a — a failed load's reason, from the engine's net error code. Named ones first; a certificate's whole range
 * (`ERR_CERT_*`, −200 … −219) is one reason — refused, never bypassed; the rest is `failed`.
 */
export function loadFailureOf(code: number): LiveSurfaceLoadFailureV1 {
  if (code === -105 || code === -137) return "name-not-resolved";
  if (code === -106) return "offline";
  if (code === -102) return "connection-refused";
  if (code === -7 || code === -118) return "timed-out";
  if (code === -100 || code === -101 || code === -104 || code === -109 || code === -15)
    return "connection-failed";
  if (code <= -200 && code >= -219) return "certificate";
  if (
    code === -10 ||
    code === -20 ||
    code === -21 ||
    code === -27 ||
    code === -301 ||
    code === -302
  )
    return "blocked";
  return "failed";
}

/** CDP's `userAgentMetadata` — the client hints an agent ships with. */
export interface BrowserSurfaceUserAgentMetadata {
  readonly brands: readonly { readonly brand: string; readonly version: string }[];
  readonly fullVersionList: readonly { readonly brand: string; readonly version: string }[];
  readonly platform: string;
  readonly platformVersion: string;
  readonly architecture: string;
  readonly model: string;
  readonly mobile: boolean;
}

/** An agent as a page reads it: `navigator.userAgent`, `navigator.platform`, `navigator.userAgentData`. */
export interface BrowserSurfaceAgent {
  readonly userAgent: string;
  readonly navigatorPlatform: string;
  readonly metadata: BrowserSurfaceUserAgentMetadata;
}

/** What the native window tells its page of its device (the metrics ride `setBackingRaster`). */
export interface BrowserSurfaceNativeEmulation extends BrowserSurfaceAgent {
  /** 0: a pointer device — touch off. */
  readonly touchPoints: number;
  /** Absent: the system's. */
  readonly colorScheme?: "light" | "dark";
}

export interface BrowserSurfaceNativeTouchInput {
  /** PT-5c: a `touchCancel` ends a gesture the person did not finish (its attachment gone, its document gone) — never a tap. */
  readonly type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel";
  /** The fingers down after this event (none for an end or a cancel). */
  readonly touchPoints: readonly { readonly x: number; readonly y: number; readonly id: number }[];
}

export interface BrowserSurfaceIcon {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface BrowserSurfaceNativeWindowOptions {
  readonly partition: string;
  readonly persistent: boolean;
  /** PT-4: where a PERSISTENT profile lives — an absolute path under its user's data (`LAYOUT.BROWSER_PROFILES_DIR`), when
   * the runtime was given a profiles' root; absent: Electron's own partition by `partition`'s name. */
  readonly profilePath?: string;
  readonly logicalViewport: LiveSurfaceBrowserSourceV1["logicalViewport"];
  readonly initialBackingRaster: LiveSurfacePixelSizeV1;
  readonly deviceScaleFactor: number;
  readonly requestSharedTexture: boolean;
}

export interface BrowserSurfaceNative {
  createWindow(options: BrowserSurfaceNativeWindowOptions): BrowserSurfaceNativeWindow;
  monotonicNowUs(): bigint;
  /** PT-4: the ENGINE'S OWN agent — its Chromium by name and bundled version, on the host's platform (`engineAgentOf`). */
  engineAgent(): BrowserSurfaceAgent;
}

/** Chrome's own user-agent tokens per platform (frozen by its UA reduction), `navigator.platform`, and the hint's name. */
const ENGINE_PLATFORMS: Readonly<
  Record<string, { readonly token: string; readonly navigator: string; readonly hint: string }>
> = {
  darwin: { token: "Macintosh; Intel Mac OS X 10_15_7", navigator: "MacIntel", hint: "macOS" },
  win32: { token: "Windows NT 10.0; Win64; x64", navigator: "Win32", hint: "Windows" },
  linux: { token: "X11; Linux x86_64", navigator: "Linux x86_64", hint: "Linux" },
};

/**
 * THE ENGINE'S OWN AGENT (PT-4 ruling 1): what a pane on a laptop or a desktop announces — the bundled Chromium as Chrome
 * itself says it (its reduced string: the major and zeros), never Electron's own string, which names Electron and the app to
 * every site. Its hints are given with it: an overridden agent's are empty otherwise (BW-5). The version is the host's
 * (`process.versions.chrome`), never a number written here.
 */
export function engineAgentOf(host: {
  readonly chrome: string;
  readonly platform: string;
  readonly arch: string;
  readonly systemVersion: string;
}): BrowserSurfaceAgent {
  const major = host.chrome.split(".")[0] ?? host.chrome;
  const os =
    ENGINE_PLATFORMS[host.platform] ??
    (ENGINE_PLATFORMS.linux as (typeof ENGINE_PLATFORMS)[string]);
  return {
    userAgent: `Mozilla/5.0 (${os.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    navigatorPlatform: os.navigator,
    metadata: {
      brands: [
        { brand: "Chromium", version: major },
        { brand: "Not?A_Brand", version: "99" },
      ],
      fullVersionList: [
        { brand: "Chromium", version: host.chrome },
        { brand: "Not?A_Brand", version: "99.0.0.0" },
      ],
      platform: os.hint,
      platformVersion: host.systemVersion,
      architecture: host.arch.startsWith("arm") ? "arm" : "x86",
      model: "",
      mobile: false,
    },
  };
}

/** What a page is TOLD of its device, as one string: its agent, its hints, mobile, touch — what only a load teaches it. */
const toldKey = (e: LiveSurfaceBrowserEmulationV1 | undefined): string =>
  e === undefined ? "" : JSON.stringify([e.agent ?? null, e.mobile, e.touchPoints]);

/** A fetched icon as the state carries it: an image, within the cap, with a short digest of its bytes — else none. */
export function faviconOf(icon: BrowserSurfaceIcon): LiveSurfaceBrowserStateV1["favicon"] {
  const mediaType = icon.mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!/^image\/[a-z0-9.+-]{1,40}$/u.test(mediaType)) return undefined;
  if (icon.bytes.byteLength === 0 || icon.bytes.byteLength > LIVE_SURFACE_FAVICON_MAX_BYTES)
    return undefined;
  return {
    key: createHash("sha256").update(icon.bytes).digest("hex").slice(0, 16),
    mediaType,
    data: Buffer.from(icon.bytes).toString("base64"),
  };
}

export type BrowserSurfaceMouseButton = "none" | "left" | "middle" | "right";

export interface BrowserSurfaceNativeMouseInput {
  readonly type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
  readonly x: number;
  readonly y: number;
  readonly button?: BrowserSurfaceMouseButton;
  readonly clickCount?: number;
  /** The buttons held (DOM's mask): a move with the primary held is a drag. */
  readonly buttons?: number;
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
  /** The char the key makes (CDP makes its keypress of it): only ⏎'s, "\r" — the wire's text arrives as `insertText`. */
  readonly text?: string;
  readonly unmodifiedText?: string;
  /** The editing command the key's chord means where a menu would send it (the Mac's ⌘A ⌘C ⌘V ⌘X ⌘Z ⇧⌘Z). */
  readonly commands?: readonly string[];
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
      readonly buttons?: number;
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
      readonly kind: "compose";
      readonly geometryRevision: number;
      readonly text: string;
      readonly caret: number;
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
  /** PT-5a: how long a page may stay unresponsive before a `whenStopped: "say"` source is said to have stopped (5 s past
   * the engine's own word — Chromium says `unresponsive` only after an input went unanswered for its own delay). */
  readonly unresponsiveMs?: number;
  /** How long the page is kept PAUSED once no renderer is attached before it hibernates (default 60 s): a renderer that
   * re-attaches within it — a window reload's next document, re-bound by main's custody — finds the SAME page. 0: at once. */
  readonly detachedHibernateMs?: number;
  /** PT-4: where this user's persistent browser profiles live (`<user root>/browser/profiles` — LAYOUT's); a persistent
   * source's session is the directory under it named by its profile's digest. Absent: Electron's own partitions. */
  readonly profilesRoot?: string;
  /** Optional main-private instrumentation; observer faults never affect frames. */
  readonly onPaintCallbackDurationUs?: (durationUs: bigint) => void;
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
  readonly inputRequests: number;
  readonly inputDropped: number;
  readonly navigationRequests: number;
  readonly navigationDropped: number;
  /** PT-4: emulations applied that differed from the one before; reloads they asked (the page's told device moved). */
  readonly emulations: number;
  readonly emulationReloads: number;
  /** PT-5b: windows made ANEW because the page's device moved to another density (ruling 5a). */
  readonly windowsRemade: number;
  /** PT-5b: paints of a window's bootstrap document — taken as the window being up, shown to nobody. */
  readonly bootstrapPaints: number;
  /** PT-5a: what the page asked for and was refused, counted by kind (the diagnostics' count — ruling 7). */
  readonly refused: Readonly<Record<BrowserSurfaceRefusal, number>>;
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
  readonly removeNavigation: () => void;
  readonly removeCursor: () => void;
  readonly removeFavicon: () => void;
  readonly removeRefused: () => void;
  readonly removeUnresponsive: () => void;
  readonly removeScale: () => void;
}

function increment(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} exhausted its safe integer range`);
  }
  return value + 1;
}

function defaultRaster(
  viewport: LiveSurfaceBrowserSourceV1["logicalViewport"],
  deviceScaleFactor: number,
): LiveSurfacePixelSizeV1 {
  const scale = deviceScaleFactor;
  const candidate = {
    width: Math.max(1, Math.min(16_384, Math.round(viewport.width * scale))),
    height: Math.max(1, Math.min(16_384, Math.round(viewport.height * scale))),
  };
  const pixels = candidate.width * candidate.height;
  if (pixels <= 67_108_864) return candidate;
  const boundedScale = Math.sqrt(67_108_864 / pixels);
  return {
    width: Math.max(1, Math.floor(candidate.width * boundedScale)),
    height: Math.max(1, Math.floor(candidate.height * boundedScale)),
  };
}

/** The producer's own copy of the native adapter's dimension rounding, so the
 * logical size geometry reports is the one the page actually laid out at. */
function roundedViewport(
  viewport: LiveSurfaceBrowserSourceV1["logicalViewport"],
): LiveSurfaceBrowserSourceV1["logicalViewport"] {
  return {
    width: Math.max(1, Math.min(16_384, Math.round(viewport.width))),
    height: Math.max(1, Math.min(16_384, Math.round(viewport.height))),
  };
}

function sameViewport(
  left: LiveSurfaceBrowserSourceV1["logicalViewport"],
  right: LiveSurfaceBrowserSourceV1["logicalViewport"],
): boolean {
  return left.width === right.width && left.height === right.height;
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
    ...(demand.logicalViewport === undefined
      ? {}
      : {
          logicalViewport: {
            width: demand.logicalViewport.width,
            height: demand.logicalViewport.height,
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
  // Largest-area viewport, taken WHOLE (mixing axes from two holders would
  // name a layout nobody asked for) — same rule as the renderer pool's fold.
  let logicalViewport: LiveSurfaceDemandV1["logicalViewport"];
  for (const demand of selected) {
    if (demand.targetRasterSize !== undefined) {
      width = Math.max(width, demand.targetRasterSize.width);
      height = Math.max(height, demand.targetRasterSize.height);
    }
    if (
      demand.logicalViewport !== undefined &&
      (logicalViewport === undefined ||
        demand.logicalViewport.width * demand.logicalViewport.height >
          logicalViewport.width * logicalViewport.height)
    ) {
      logicalViewport = demand.logicalViewport;
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
    ...(logicalViewport === undefined
      ? {}
      : { logicalViewport: { width: logicalViewport.width, height: logicalViewport.height } }),
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

const MAX_BROWSER_STATE_URL = 8_192;
const MAX_BROWSER_STATE_TITLE = 512;

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

/**
 * Native navigation truth → the bounded wire block. Clamped HERE because the
 * page chooses its own URL and title lengths, and a summary that fails its
 * schema downstream would read as a protocol fault and kill the renderer
 * generation — a 9KB URL must degrade to truncation, never to teardown.
 */
/** A web page's origin (`https://host:port`), or undefined: no address, not one, or not a web page's (about:blank, an
 * error page) — where a favicon is never shown. */
function webOriginOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const at = new URL(url);
    return at.protocol === "http:" || at.protocol === "https:" ? at.origin : undefined;
  } catch {
    return undefined;
  }
}

function clampBrowserState(
  state: BrowserSurfaceNavigationState,
): LiveSurfaceBrowserStateV1 | undefined {
  const url = stripControlCharacters(state.url).slice(0, MAX_BROWSER_STATE_URL);
  if (url.length === 0) return undefined;
  const title = stripControlCharacters(state.title).slice(0, MAX_BROWSER_STATE_TITLE);
  // a failed load: the engine's error page stands in the asked address's entry, and its "title" is that address — none
  const failed = state.failure !== undefined;
  return {
    url,
    ...(title.length === 0 || failed ? {} : { title }),
    loading: state.loading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    ...(state.failure === undefined ? {} : { failure: { reason: loadFailureOf(state.failure) } }),
  };
}

/** The cursors Electron names as CSS does (`cursor-changed`'s types that are CSS keywords too). */
const CSS_CURSORS: ReadonlySet<string> = new Set([
  "default",
  "crosshair",
  "text",
  "wait",
  "help",
  "e-resize",
  "n-resize",
  "ne-resize",
  "nw-resize",
  "s-resize",
  "se-resize",
  "sw-resize",
  "w-resize",
  "ns-resize",
  "ew-resize",
  "nesw-resize",
  "nwse-resize",
  "col-resize",
  "row-resize",
  "move",
  "vertical-text",
  "cell",
  "context-menu",
  "alias",
  "progress",
  "copy",
  "none",
  "not-allowed",
  "zoom-in",
  "zoom-out",
  "grab",
  "grabbing",
]);

/** The ones it names otherwise: its `pointer` is Chromium's ARROW (CSS's `default`) and its `hand` the link's (CSS's `pointer`) —
 * the PT-3 smoke's CURSOR row saw a link say `hand`; Chromium's own (no-drop, the drag's, a resize that cannot) as CSS's kin. */
const ELECTRON_CURSORS: ReadonlyMap<string, string> = new Map([
  ["pointer", "default"],
  ["hand", "pointer"],
  ["nodrop", "no-drop"],
  ["custom", "default"],
  ["null", "default"],
  ["drag-drop-none", "no-drop"],
  ["drag-drop-move", "move"],
  ["drag-drop-copy", "copy"],
  ["drag-drop-link", "alias"],
  ["ns-no-resize", "ns-resize"],
  ["ew-no-resize", "ew-resize"],
  ["nesw-no-resize", "nesw-resize"],
  ["nwse-no-resize", "nwse-resize"],
]);

/**
 * Electron's `cursor-changed` type → the CSS cursor the page means (PT-3): the CSS keywords as they are, Electron's own names as
 * CSS spells them (above), the panning arrows as `all-scroll`, one only an image can say (`custom`) as the default — and anything
 * else as the default, never passed through: a name CSS does not know is IGNORED where it is set, leaving the last cursor up.
 */
export function cssCursorOf(type: string): string {
  const named = ELECTRON_CURSORS.get(type);
  if (named !== undefined) return named;
  if (/-panning(-vertical|-horizontal)?$/.test(type)) return "all-scroll";
  return CSS_CURSORS.has(type) ? type : "default";
}

/** The special keys the wire carries by NAME. CDP acts on most of them only
 * when a Windows virtual key code rides along, and the wire deliberately does
 * not carry one — the code is presentation-neutral producer knowledge, derived
 * here once rather than trusted from every sender. */
const KEY_VIRTUAL_CODES: Readonly<Record<string, number>> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

/** A key's Windows virtual key code: a special key's by its name; a letter's or a digit's by its physical key (PT-3 — the
 * page's own chords act on it: ⌃A and the rest off the Mac). */
export function virtualKeyCodeOf(key: string, code: string): number | undefined {
  if (Object.hasOwn(KEY_VIRTUAL_CODES, key)) return KEY_VIRTUAL_CODES[key];
  const glyph = /^(?:Key[A-Z]|Digit[0-9])$/.test(code) ? code.at(-1) : undefined;
  return glyph?.charCodeAt(0);
}

/** The Mac's editing chords and the command each means (Blink's editing commands, as CDP's `commands` names them). */
const MAC_EDITING: ReadonlyMap<string, string> = new Map([
  ["KeyA", "selectAll"],
  ["KeyC", "copy"],
  ["KeyV", "paste"],
  ["KeyX", "cut"],
  ["KeyZ", "undo"],
]);

/**
 * The page's own editing chords on the Mac — ⌘A ⌘C ⌘V ⌘X, ⌘Z and ⇧⌘Z (PT-3 ruling 7: every key but the browser's chords is
 * the page's): Chromium takes them from the app's MENU there, and no menu reaches a page in an offscreen window — the PT-3
 * smoke's probe saw ⌘A select nothing — so each rides with its editing command (CDP's `commands`), as a browser's own menu
 * would send it. Off the Mac a page's key bindings act on the key itself (its virtual code).
 */
export function editingCommandsOf(
  request: {
    readonly type: "down" | "up";
    readonly code: string;
    readonly modifiers?: BrowserSurfaceKeyModifiers;
  },
  platform: NodeJS.Platform,
): readonly string[] | undefined {
  const m = request.modifiers;
  if (platform !== "darwin" || request.type !== "down" || m?.meta !== true) return undefined;
  if (m.control === true || m.alt === true) return undefined;
  if (request.code === "KeyZ" && m.shift === true) return ["redo"];
  const command = m.shift === true ? undefined : MAC_EDITING.get(request.code);
  return command === undefined ? undefined : [command];
}

/** Wire input (CSS logical, validated by contracts) → the engine's request.
 * A pass-through by design: coordinates are NEVER re-scaled here (LSF §10.2);
 * the engine's own bounds and staleness checks stay the authority. */
function browserInputRequest(
  input: LiveSurfaceInputEventV1,
  geometryRevision: number,
): BrowserSurfaceInputRequest {
  if (input.kind === "pointer") {
    return {
      kind: "mouse",
      geometryRevision,
      type: input.action,
      x: input.x,
      y: input.y,
      ...(input.action === "move" ? {} : { button: input.button ?? "left" }),
      ...(input.clickCount === undefined ? {} : { clickCount: input.clickCount }),
      ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
    };
  }
  if (input.kind === "wheel") {
    return {
      kind: "wheel",
      geometryRevision,
      x: input.x,
      y: input.y,
      deltaX: input.deltaX,
      deltaY: input.deltaY,
    };
  }
  if (input.kind === "text") return { kind: "text", geometryRevision, text: input.text };
  if (input.kind === "compose")
    return { kind: "compose", geometryRevision, text: input.text, caret: input.caret };
  const virtualKeyCode = virtualKeyCodeOf(input.key, input.code);
  return {
    kind: "key",
    geometryRevision,
    type: input.action,
    key: input.key,
    code: input.code,
    modifiers: {
      ...(input.modifiers.alt ? { alt: true } : {}),
      ...(input.modifiers.ctrl ? { control: true } : {}),
      ...(input.modifiers.meta ? { meta: true } : {}),
      ...(input.modifiers.shift ? { shift: true } : {}),
    },
    ...(input.autoRepeat === undefined ? {} : { autoRepeat: input.autoRepeat }),
    ...(virtualKeyCode === undefined ? {} : { windowsVirtualKeyCode: virtualKeyCode }),
  };
}

/** ⏎ makes its char alone or with ⇧ (a line break) — never under ⌘, ⌃ or ⌥ (the page's shortcuts). */
function enterMakesChar(modifiers: BrowserSurfaceKeyModifiers | undefined): boolean {
  return modifiers?.meta !== true && modifiers?.control !== true && modifiers?.alt !== true;
}

/** PT-5c (R8): a key the page was told is DOWN — what its press carried, and who pressed it. */
interface KeyDown {
  readonly key: string;
  readonly code: string;
  readonly location: 0 | 1 | 2 | 3 | undefined;
  readonly windowsVirtualKeyCode: number | undefined;
  readonly by: string | undefined;
}

/** PT-5c (R8): a held key's up — the key as its release names it (the attachment's going names none), its code, its place. */
function keyUpOf(
  down: KeyDown,
  key: string,
  modifiers: BrowserSurfaceKeyModifiers | undefined,
): BrowserSurfaceNativeKeyInput {
  return {
    type: "keyUp",
    key,
    code: down.code,
    modifiers: keyModifierMask(modifiers),
    ...(down.location === undefined ? {} : { location: down.location }),
    ...(down.windowsVirtualKeyCode === undefined
      ? {}
      : { windowsVirtualKeyCode: down.windowsVirtualKeyCode }),
  };
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
  readonly #detachedHibernateMs: number;
  readonly #profilesRoot: string | undefined;
  readonly #onPaintCallbackDurationUs: ((durationUs: bigint) => void) | undefined;
  readonly #lifecycle = new LiveSurfaceLifecycle();
  readonly #attachments = new Map<string, BrowserRuntimeAttachmentRecord>();
  #window: BrowserSurfaceNativeWindow | null = null;
  #callbacks: SourceCallbacks | null = null;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #rasterTimer: ReturnType<typeof setTimeout> | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #hibernateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Muted because no renderer is attached (the grace's page); unmuted when one comes back. */
  #muted = false;
  #effectiveDemand: LiveSurfaceDemandV1 | null = null;
  #transport: "shared-texture" | "cpu-bgra" | undefined;
  /** The logical viewport the page is CURRENTLY laid out at (DT-3f): starts as
   * the source's, follows aggregated demand once actuation lands. Geometry
   * reports THIS, never the source's construction-time value. */
  #viewport: LiveSurfaceBrowserSourceV1["logicalViewport"];
  #geometry: LiveSurfaceGeometryV1 | undefined;
  #geometryKey = "";
  #geometryRevision = 0;
  #sequence = 0n;
  /** Last committed navigation truth. Survives producer restarts on purpose:
   * chrome keeps showing the last known URL through a reconnect gap. */
  #browserState: LiveSurfaceBrowserStateV1 | undefined;
  /** PT-3: the cursor the page last showed (a CSS name), published with the browser state; reset with its window. */
  #cursor: string | undefined;
  /** PT-4: the device the page is seen as — the source's at its creation, an `emulate` command's after. Survives its
   * window: a producer started again is born on it. */
  #emulation: LiveSurfaceBrowserEmulationV1 | undefined;
  /**
   * PT-4, PT-5b3 (ruling 5) — WHAT THE PAGE HAS BEEN TOLD IS DOWN: the finger (a press began a touch; its moves and its
   * release are the touch's), and each mouse button with the scale its press went at. A release of what is down is
   * ALWAYS sent; a release of nothing is nothing. Gone with the window.
   * PT-5c (ruling 2) — and WHO pressed it: the attachment its press came through (none, for the runtime's own seam). When
   * that attachment goes, what it pressed is released (`letGo`).
   */
  #touching = false;
  #touchingBy: string | undefined;
  readonly #pressed = new Map<
    string,
    {
      readonly scale: number;
      readonly x: number;
      readonly y: number;
      readonly by: string | undefined;
    }
  >();
  /** PT-5c (R8) — A KEY IS PRESSED TOO: each key the page was told is DOWN, by its `code`, with what its press carried and
   * the attachment it came through. Its up is a release; an attachment's going lets its keys up; a commit forgets them. */
  readonly #keysDown = new Map<string, KeyDown>();
  /** PT-4: the favicon the page last named and the ORIGIN it named it under — published with the browser state while the
   * page stands on that origin (a page that names the same icons as the one before says nothing, so a reload and a walk
   * within a site keep it; a page of another origin has none until it names its own); the count that names the word whose
   * icon is awaited. */
  #favicon: LiveSurfaceBrowserStateV1["favicon"];
  #faviconOrigin: string | undefined;
  #faviconSerial = 0;
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
  #inputRequests = 0;
  #inputDropped = 0;
  #navigationRequests = 0;
  #navigationDropped = 0;
  #emulations = 0;
  #emulationReloads = 0;
  #windowsRemade = 0;
  /**
   * PT-5b2 (rulings 3, 6) — THE PAGE'S FIRST LOAD, as the engine's events say it (never the `loadURL` promise alone): a
   * DOCUMENT of the page stands in the window (it committed, or the engine's error page stands in a failed address's
   * place); the window was heard LOADING (its remote load is under way — a stop-loading before that is the bootstrap's);
   * and the person asked the load to STOP while nothing of the page stood.
   */
  #documentStands = false;
  #heardLoading = false;
  #stopAsked = false;
  /**
   * PT-5b3 (ruling 1) — THE WINDOW IS BORN: `bornOn` has ended — its bootstrap blank loaded, its session attached WITH
   * ITS GUARDS, its device told. A page is `starting` from `startProducer`, a few hundred milliseconds before that; until
   * then NOTHING IS ASKED OF ITS WINDOW. (Electron, probed: a `loadURL` or a reload asked before the bootstrap has
   * settled rejects the bootstrap's own promise, ERR_ABORTED — every layout of the native waits on it, so the birth
   * failed and the source with it; after the bootstrap and before the guards, the page loaded unguarded, as the engine's
   * own agent, and then again. A `stop` there stops nothing.) Its birth then asks for the address ONCE.
   */
  #born = false;
  /**
   * PT-5b3 (ruling 4) — WHICH DOCUMENT THE PAGE IS AT, counted for the surface's life: the window's own count (the
   * native's: one more at each commit, never at a move within a document) over what the windows before it had reached
   * (`#documentBase` — a window made anew begins another document, never the first again). 0: none has committed. It is
   * said with the page's state (`browser.document`) and stamped on every frame at its paint: whoever asks "is this
   * another document?" — whose pixels a texture holds, whose scale was read — asks THIS, never the address.
   */
  #document = 0;
  #documentBase = 0;
  /** PT-5b2 (ruling 4) — ONE CHAIN a page: the hand's events take their turn here, in the order they were sent. */
  #inputTail: Promise<void> = Promise.resolve();
  /**
   * PT-5b3 (ruling 5) — each window's GOING, as a promise that rejects when the producer lets that window go (a remake, a
   * rest, a crash and its restart, a failure, the end): a turn pending on a window that has gone ends with it. (The
   * engine rejects a command pending at a detach or a destroy — "target closed while handling command" — but NOT at a
   * crash, where it stays pending until the window is destroyed: the probe. Nothing here leans on either.)
   */
  readonly #going = new WeakMap<
    BrowserSurfaceNativeWindow,
    { readonly gone: Promise<never>; readonly go: (reason: Error) => void }
  >();
  #bootstrapPaints = 0;
  /** PT-5b (ruling 5a): the density the page's window was BORN at — an offscreen window's density is its own for life. */
  #windowDensity: number | undefined;
  /** PT-5c (ruling 1): a `mobile` page's visual-viewport scale as its page last SAID it, and the document it said it for. */
  #pageScale: { readonly value: number; readonly document: number } | undefined;
  /** PT-5c (ruling 1): presses and moves waiting for their document's first word (see `pointScale`) — and (R1) the
   * attachment each came through, whose going ends its wait. */
  readonly #scaleWaiters = new Set<{
    readonly document: number;
    readonly by: string | undefined;
    readonly heard: (scale: number) => void;
    readonly gone: (error: Error) => void;
    /** R2: its bound */
    readonly timer: ReturnType<typeof setTimeout>;
  }>();
  /** PT-5a: the page's refusals by kind, and the last one a person is told of (its serial counts them for the page's life). */
  readonly #refusals: Record<BrowserSurfaceRefusal, number> = {
    alert: 0,
    confirm: 0,
    beforeunload: 0,
    popup: 0,
    download: 0,
    "file-picker": 0,
    auth: 0,
  };
  #refused: LiveSurfaceBrowserStateV1["refused"];
  /** PT-5a: the page's last WEB address — where a producer started again loads it (never back at its first address). */
  #resumeUrl: string | undefined;
  /** PT-5a: the page was SAID to have stopped (`whenStopped: "say"`): no demand starts it again — its reload does. */
  #waitsForReload = false;
  #unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #unresponsiveMs: number;

  constructor(options: BrowserLiveSurfaceRuntimeOptions) {
    this.surfaceId = LiveSurfaceIdV1.parse(options.surfaceId);
    this.source = BrowserSourceSchema.parse(options.source);
    if (!isAllowedBrowserTopLevelUrl(this.source.initialUrl)) {
      throw new Error("Browser source initial URL must use HTTP or HTTPS");
    }
    this.#viewport = roundedViewport(this.source.logicalViewport);
    this.#emulation = this.source.emulation;
    this.#profilesRoot = options.profilesRoot;
    this.#native = options.native;
    this.#controlTargets = options.controlTargets;
    this.#requestSharedTexture = options.requestSharedTexture ?? true;
    this.#startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.#rasterStabilizationMs = options.rasterStabilizationMs ?? DEFAULT_RASTER_STABILIZATION_MS;
    this.#cpuFallbackPaints = options.cpuFallbackPaints ?? DEFAULT_CPU_FALLBACK_PAINTS;
    this.#restartLimit = options.restartLimit ?? DEFAULT_RESTART_LIMIT;
    this.#unresponsiveMs = options.unresponsiveMs ?? DEFAULT_UNRESPONSIVE_MS;
    this.#detachedHibernateMs = options.detachedHibernateMs ?? DEFAULT_DETACHED_HIBERNATE_MS;
    this.#onPaintCallbackDurationUs = options.onPaintCallbackDurationUs;
    if (
      this.#startupTimeoutMs <= 0 ||
      this.#rasterStabilizationMs < 0 ||
      !(this.#detachedHibernateMs >= 0)
    ) {
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
      ...(this.#browserState === undefined
        ? {}
        : {
            browser: {
              ...this.#browserState,
              // PT-5c (ruling 3) — NOTHING SAYS A DOCUMENT THAT DOES NOT STAND: where no document of the page stands in
              // its window (none committed in a window made anew, a page at rest, one headed elsewhere before its first
              // commit, a load that ended with nothing) the serial is not said — whoever asks "is this another
              // document?" reads the address. (Before: the last one stood, said at the new address — the desk took the
              // old page's picture for the new address's at a rest and on the shelf: the third grade's P1.)
              ...(this.#document === 0 || !this.#documentStands
                ? {}
                : { document: this.#document }),
              ...(this.#cursor === undefined ? {} : { cursor: this.#cursor }),
              ...(this.#favicon !== undefined &&
              this.#faviconOrigin !== undefined &&
              this.#faviconOrigin === webOriginOf(this.#browserState.url)
                ? { favicon: this.#favicon }
                : {}),
              ...(this.#refused === undefined ? {} : { refused: this.#refused }),
            },
          }),
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
      inputRequests: this.#inputRequests,
      inputDropped: this.#inputDropped,
      navigationRequests: this.#navigationRequests,
      navigationDropped: this.#navigationDropped,
      emulations: this.#emulations,
      emulationReloads: this.#emulationReloads,
      windowsRemade: this.#windowsRemade,
      bootstrapPaints: this.#bootstrapPaints,
      refused: { ...this.#refusals },
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
      refused: stats.refused,
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
      // The DT-D6 lane's runtime half. The control session has already run the
      // ticket's operation gate; what remains here is the ENGINE's own truth —
      // availability, geometry staleness, bounds — and its refusals are
      // ordinary dropped frames of a fire-and-forget stream, counted and
      // swallowed, never thrown back up the port.
      dispatchInput(input, geometryRevision) {
        if (disposed || !record.active) return;
        runtime.#inputRequests += 1;
        void runtime
          .dispatchInput(browserInputRequest(input, geometryRevision), context.attachmentId)
          .catch(() => {
            runtime.#inputDropped += 1;
          });
      },
      navigate(command) {
        if (disposed || !record.active) return;
        runtime.#navigationRequests += 1;
        void runtime.navigate(command).catch(() => {
          runtime.#navigationDropped += 1;
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        record.active = false;
        runtime.#attachments.delete(context.attachmentId);
        runtime.reconcileDemand();
        // PT-5c (ruling 2): a gesture ends when the attachment that took its press goes
        runtime.letGo(context.attachmentId);
      },
    };
  }

  /** Explicit source-owner teardown; renderer detach alone only pauses the source, and hibernates it once the grace lapses. */
  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.clearTimers();
    this.destroyWindow();
    this.#attachments.clear();
    if (this.#lifecycle.snapshot.state !== "closed") this.#lifecycle.transition("closed");
  }

  /**
   * Main-private input seam; authorization is deliberately outside LiveSurfaceAttachment.
   *
   * PT-5b2 (ruling 4) — THE HAND'S EVENTS REACH THE PAGE IN THE ORDER THEY WERE SENT, whatever is awaited on the way:
   * one chain a page. An event takes its turn behind the one before it — a pointer, a wheel, a key, text, a composition
   * alike — and a dispatch that rejects (a command the window refuses) is its own caller's, never the chain's. PT-5c
   * routes on this chain.
   *
   * PT-5b3 (ruling 5) — AN EVENT IS JUDGED AGAINST THE GEOMETRY IT WAS SENT UNDER AS IT ARRIVES, before it takes its turn:
   * the chain orders, it does not judge that again. (PT-5b2 judged it at the turn: a release queued behind a press that
   * waited on its page was thrown away when a frame of another size landed meanwhile — the page was left with a finger
   * down, and every hover after it was a drag.) What the window IS — standing, live — is still read at the turn. And A
   * RELEASE IS NEVER JUDGED BY ITS GEOMETRY: of what is down it is always sent (`release`).
   */
  dispatchInput(
    request: BrowserSurfaceInputRequest,
    /** the attachment it came through (none: the runtime's own seam) — what it presses is its own */
    by?: string,
  ): Promise<void> {
    const geometry = this.#geometry;
    // PT-5b3 (ruling 5) — AN EVENT IS FOR THE WINDOW THAT STOOD WHEN IT WAS SENT. The chain is one a page and outlives a
    // window — a remake, a rest and its wake, a crash and its restart — and a geometry's revision is not a window's: at
    // its turn an event whose window is gone is refused (its caller counts it), never delivered to the window that
    // replaced it (a press sent to the page that crashed, landing on the page made again in its place). And its turn
    // ENDS when its window goes: the next window's first event never waits behind a command sent to one that is no more.
    const window = this.#window;
    // PT-5c (ruling 1) — AN EVENT IS FOR THE DOCUMENT THAT STOOD WHEN IT WAS SENT (the moment main hears it): at its turn an
    // event whose document has gone — another committed: a link the page followed, a redirect, a reload — is refused,
    // counted, never delivered to the document that replaced it. What was down in the gone document was ended at the
    // commit (`acceptNavigationState`), so a release of it is nothing.
    const document = this.#document;
    // (R8: a key's up is a release, as a button's)
    const release = (request.kind === "mouse" || request.kind === "key") && request.type === "up";
    // PT-5c (ruling 1) — AN EVENT WITH NO POINT IS NEVER JUDGED BY A GEOMETRY: a key, text and a composition are judged
    // by their window and their document alone. (Before: refused when a frame of another size had landed since their own
    // — a desk zoom that moved the raster's rung, a pane resized — and a `keyUp` refused left the key down in the page.)
    const pointed = (request.kind === "mouse" && !release) || request.kind === "wheel";
    if (pointed && geometry !== undefined && request.geometryRevision !== geometry.revision) {
      return Promise.reject(new Error("Browser input named a stale geometry revision"));
    }
    const turn = this.#inputTail.then(() =>
      this.onWindow(window, document, (standing) =>
        release
          ? this.release(request, standing)
          : this.dispatchInTurn(request, geometry, standing, document, by),
      ),
    );
    this.#inputTail = turn.catch(() => undefined);
    return turn;
  }

  /** PT-5b3 (ruling 5): an event's turn on the window it was sent for — refused if that window is gone, ended if it goes.
   * PT-5c (ruling 1): and on the DOCUMENT it was sent for — refused if another has committed since. */
  private onWindow(
    window: BrowserSurfaceNativeWindow | null,
    document: number,
    turn: (window: BrowserSurfaceNativeWindow) => Promise<void>,
  ): Promise<void> {
    if (this.#closed || window === null || window.isDestroyed() || this.#window !== window) {
      return Promise.reject(new Error("Browser input's window is gone"));
    }
    if (this.#document !== document) {
      return Promise.reject(new Error("Browser input's document is gone"));
    }
    return Promise.race([turn(window), this.goneOf(window)]);
  }

  /** PT-5b3 (ruling 5): a promise that rejects when the producer lets `window` go. */
  private goneOf(window: BrowserSurfaceNativeWindow): Promise<never> {
    let going = this.#going.get(window);
    if (going === undefined) {
      let go: (reason: Error) => void = () => {};
      const gone = new Promise<never>((_resolve, reject) => {
        go = reject;
      });
      // (a going nobody waits on is no unhandled rejection)
      gone.catch(() => undefined);
      going = { gone, go };
      this.#going.set(window, going);
    }
    return going.gone;
  }

  /**
   * PT-5b3 (ruling 5) — A GESTURE ENDS. A release of what the page was told is DOWN is always sent — to the window that
   * took the press, live or paused; never refused for a geometry that moved, never withheld for a scale: a touch's end
   * carries no point and reads none, a mouse's goes at the scale its press went at. A release of NOTHING (its press was
   * refused, or its window is gone) is nothing: the page is not told of half a click.
   */
  private async release(
    request: Extract<BrowserSurfaceInputRequest, { kind: "mouse" | "key" }>,
    window: BrowserSurfaceNativeWindow,
  ): Promise<void> {
    // PT-5c (R8) — A KEY'S UP IS A RELEASE: of a key the page was told is down it is sent — to a page at rest too, never
    // judged by a geometry; of a key not down it is nothing. (Before: a keyUp was judged as a press — refused at a rest,
    // the key left down for good; sent though no keyDown was told.)
    if (request.kind === "key") {
      const down = this.#keysDown.get(request.code);
      if (down === undefined) return;
      this.#keysDown.delete(request.code);
      await window.dispatchKey(
        keyUpOf(down, validKeyToken(request.key) ? request.key : down.key, request.modifiers),
      );
      return;
    }
    if (this.#touching) {
      if (request.button !== undefined && request.button !== "left") return;
      this.#touching = false;
      this.#touchingBy = undefined;
      await window.dispatchTouch({ type: "touchEnd", touchPoints: [] });
      return;
    }
    const button = request.button ?? "left";
    const scale = this.#pressed.get(button)?.scale;
    if (scale === undefined) return;
    this.#pressed.delete(button);
    const clicks = request.clickCount;
    await window.dispatchMouse({
      type: "mouseReleased",
      x: Number.isFinite(request.x) ? Math.max(0, request.x) / scale : 0,
      y: Number.isFinite(request.y) ? Math.max(0, request.y) / scale : 0,
      button,
      ...(clicks !== undefined && Number.isSafeInteger(clicks) && clicks >= 1 && clicks <= 3
        ? { clickCount: clicks }
        : {}),
      ...(request.buttons === undefined ? {} : { buttons: request.buttons }),
    });
  }

  /**
   * PT-5c (ruling 2) — A GESTURE ENDS WHEN THE ATTACHMENT THAT TOOK ITS PRESS GOES (the app's window reloaded or closed,
   * its renderer gone, the face let go): what it pressed in the page is released, on the chain — behind every event it
   * sent before it went, read at the release's turn — and nothing of it is left down. The attachment that comes back
   * starts with nothing down: its first move is a hover. A FINGER is CANCELLED, never ended: from a short touch the engine
   * makes a tap — a click the person never made. A BUTTON is released OUTSIDE the page's view: the page hears its mouseup
   * (a drag it tracks ends) and its click lands on the page's root — never on what the person pressed and never let go
   * over (released at its press's point the engine clicks it, `clickCount` 0 or not: PT-5c's probe `release.cjs`). What
   * another attachment pressed stands. (Before: nothing ended
   * a gesture at an attachment's going — the window lives on through the grace, and the attachment that came back
   * dragged the page with its first hover: the third grade's P3.)
   */
  private letGo(by: string): void {
    // R1: what it sent and is still WAITING for its page's word is never sent — its wait ends now, ahead of the chain
    this.scaleWaitsEnd((waiter) => waiter.by === by, "Browser input's attachment is gone");
    const turn = this.#inputTail.then((): Promise<void> | undefined => {
      const window = this.#window;
      if (this.#closed || window === null || window.isDestroyed()) return undefined;
      return Promise.race([this.letGoOn(window, by), this.goneOf(window)]);
    });
    this.#inputTail = turn.catch(() => undefined);
  }

  private async letGoOn(window: BrowserSurfaceNativeWindow, by: string): Promise<void> {
    if (this.#touching && this.#touchingBy === by) {
      this.#touching = false;
      this.#touchingBy = undefined;
      await window.dispatchTouch({ type: "touchCancel", touchPoints: [] });
    }
    for (const [button, down] of [...this.#pressed]) {
      if (down.by !== by) continue;
      this.#pressed.delete(button);
      await window.dispatchMouse({
        type: "mouseReleased",
        ...OUTSIDE_THE_VIEW,
        button: button as Exclude<BrowserSurfaceMouseButton, "none">,
      });
    }
    // R8: a KEY it holds down is let up, as a button
    for (const [code, down] of [...this.#keysDown]) {
      if (down.by !== by) continue;
      this.#keysDown.delete(code);
      await window.dispatchKey(keyUpOf(down, down.key, undefined));
    }
  }

  private async dispatchInTurn(
    request: BrowserSurfaceInputRequest,
    /** the geometry that stood when the event ARRIVED — the one it was judged against, and its bounds */
    geometry: LiveSurfaceGeometryV1 | undefined,
    /** the window it was sent for — standing, the chain's turn has made sure */
    window: BrowserSurfaceNativeWindow,
    /** PT-5c (ruling 1): the document it was sent for — standing at its turn */
    document: number,
    /** the attachment it came through */
    by: string | undefined,
  ): Promise<void> {
    // PT-5c (R1) — AN EVENT IS SENT ONLY WHILE ITS PAGE IS LIVE AND THE ATTACHMENT THAT SENT IT STANDS (every event but a
    // release), read when it is sent: here for what waits for nothing, and again after a wait (below). (Before: judged
    // live at its turn's start alone — a press queued behind a slow key went to the page after its attachment had gone,
    // a gesture begun that its attachment would never end.)
    if (geometry === undefined || this.#lifecycle.snapshot.state !== "live" || !this.stands(by)) {
      throw new Error("Browser surface is not available for input");
    }
    if (request.kind === "text") {
      if (request.text.length === 0 || request.text.length > 16_384) {
        throw new Error("Browser text input is outside the bounded contract");
      }
      await window.dispatchText(request.text);
      return;
    }
    if (request.kind === "compose") {
      if (
        request.text.length > 16_384 ||
        !Number.isSafeInteger(request.caret) ||
        request.caret < 0
      ) {
        throw new Error("Browser composition is outside the bounded contract");
      }
      // the caret within the composition (CDP refuses one past its end)
      await window.dispatchCompose(request.text, Math.min(request.caret, request.text.length));
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
      const commands = editingCommandsOf(request, process.platform);
      // (a key's up is a release — `release`: what reaches here is a key's DOWN)
      await window.dispatchKey({
        type: "keyDown",
        key: request.key,
        code: request.code,
        modifiers: keyModifierMask(request.modifiers),
        ...(request.autoRepeat === undefined ? {} : { autoRepeat: request.autoRepeat }),
        ...(request.location === undefined ? {} : { location: request.location }),
        ...(request.windowsVirtualKeyCode === undefined
          ? {}
          : { windowsVirtualKeyCode: request.windowsVirtualKeyCode }),
        // ⏎'s char (PT-3): a page acts on its KEYPRESS — a form's implicit submission, a textarea's newline — and CDP makes
        // one only for a keyDown that carries its text (the wire's text arrives as `insertText`, which makes none). The
        // PT-3 smoke's KEYS row: without it, ⏎ in a field submitted nothing.
        ...(request.key === "Enter" && enterMakesChar(request.modifiers)
          ? { text: "\r", unmodifiedText: "\r" }
          : {}),
        ...(commands === undefined ? {} : { commands }),
      });
      // (told: the key is DOWN — on the window that heard it, in the document it was sent for, by the attachment that sent
      // it. R8)
      if (this.#window === window && this.#document === document)
        this.#keysDown.set(request.code, {
          key: request.key,
          code: request.code,
          location: request.location,
          windowsVirtualKeyCode: request.windowsVirtualKeyCode,
          by,
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
    // PT-4 — A FINGER: on a touch device's page a press is a touch, its moves the touch's while it is down, its release
    // the touch's end (`release`); a hover is nothing a finger does, and no other button is one — neither is told to the
    // page, and neither asks it anything (PT-5b3: a hover over a touch page read its scale all the same). Sent as touch
    // events from here (`Input.dispatchTouchEvent`), never by CDP's mouse-to-touch emulation: under
    // `setEmitTouchEventsForMouse` a dispatched mouse event is swallowed and its command never answers (the PT-4 probe),
    // and the commands queued behind it never run. The wheel stays the page's scroll (below).
    const touch = (this.#emulation?.touchPoints ?? 0) > 0;
    if (touch && request.kind === "mouse") {
      if (request.type === "move" && !this.#touching) return;
      if (request.type === "down" && request.button !== undefined && request.button !== "left")
        return;
    }
    // CDP Input coordinates are CSS pixels in the main-frame viewport. The
    // presentation adapter has already supplied Browser logical coordinates;
    // backing-raster pixels and visibleRect offsets are presentation-only.
    // PT-5b (ruling 5c): the VIEW's — a `mobile` page shown whole at its own scale takes them over that scale
    const scale = await this.pointScale(document, by);
    // (after its wait — the moment it is sent: its window, its document, the page live, its attachment standing. R1)
    if (
      window.isDestroyed() ||
      this.#window !== window ||
      this.#document !== document ||
      this.#lifecycle.snapshot.state !== "live" ||
      !this.stands(by)
    ) {
      throw new Error("Browser surface is not available for input");
    }
    const x = request.x / scale;
    const y = request.y / scale;
    if (request.kind === "wheel") {
      if (
        !Number.isFinite(request.deltaX) ||
        !Number.isFinite(request.deltaY) ||
        Math.abs(request.deltaX) > 100_000 ||
        Math.abs(request.deltaY) > 100_000
      ) {
        throw new Error("Browser wheel input is outside the bounded contract");
      }
      // The wire's deltas are the page's CSS px (what the finger moved on screen, PT-3 ruling 4), and CDP's `mouseWheel`
      // takes CSS px too — never device px: the PT-3 smoke's WHEEL row measured a page at density 2 scrolled by twice the
      // finger's travel when its density multiplied them here (LT2's probe said device px; the page said otherwise).
      // PT-5b: WHERE the wheel is — the page's px, as a press's — but never how far: the engine takes a wheel's travel in
      // the VIEW's px and scrolls the document by it over the page's scale itself (the LEGACY row: a travel divided here
      // too scrolled a page shown at 0.41 by 1/0.41² of the finger's)
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
    if (touch) {
      const finger = [{ x, y, id: 0 }];
      if (request.type === "down") {
        await window.dispatchTouch({ type: "touchStart", touchPoints: finger });
        // (told: the finger is DOWN — on the window that heard it, by the attachment that sent it. PT-5c (ruling 1): a
        // touchStart ANSWERED after another document committed went down in a document that is gone — the engine holds
        // that touch open over the next one (deaf to touch without its end: the probe), so it is cancelled at once)
        if (this.#window === window) {
          if (this.#document === document) {
            this.#touching = true;
            this.#touchingBy = by;
          } else await window.dispatchTouch({ type: "touchCancel", touchPoints: [] });
        }
      } else await window.dispatchTouch({ type: "touchMove", touchPoints: finger });
      return;
    }
    const button = request.type === "move" ? "none" : (request.button ?? "left");
    await window.dispatchMouse({
      type: request.type === "move" ? "mouseMoved" : "mousePressed",
      x,
      y,
      button,
      ...(request.clickCount === undefined ? {} : { clickCount: request.clickCount }),
      ...(request.buttons === undefined ? {} : { buttons: request.buttons }),
    });
    // (told: the button is DOWN, at the scale its press went at — its release goes there. PT-5c (ruling 1): a press
    // answered after another document committed is forgotten: the engine carries no button across a commit — the probe)
    if (request.type === "down" && this.#window === window && this.#document === document)
      this.#pressed.set(button, { scale, x: request.x, y: request.y, by });
  }

  /**
   * Chrome navigation companion to `dispatchInput` — same availability gate.
   * `go` re-validates against the SAME top-level scheme policy as the initial
   * load, and rides `loadURL` so browser-security's will-navigate guard sits
   * beneath both paths; history/loading actions carry no URL at all.
   */
  async navigate(command: LiveSurfaceNavigationCommandV1): Promise<void> {
    if (command.action === "emulate") {
      if (this.#closed) throw new Error("Browser surface is not available for navigation");
      this.emulate(command.emulation);
      return;
    }
    // PT-5a — ↻ ON A PAGE THAT STOPPED (its process gone, unresponsive past the bound, its first load unanswered): the
    // producer starts again, where the page last was — or at the address just typed. Its restart budget is the person's
    // to spend: asked, it tries. Nobody looking (no live demand), it starts when somebody is.
    if (
      (command.action === "reload" || command.action === "go") &&
      !this.#closed &&
      this.#lifecycle.snapshot.state === "failed"
    ) {
      if (command.action === "go") {
        if (!isAllowedBrowserTopLevelUrl(command.url)) {
          throw new Error("Browser navigation URL must use HTTP or HTTPS");
        }
        this.#resumeUrl = command.url;
      }
      this.#waitsForReload = false;
      this.#restartAttempts = 0;
      if (this.#effectiveDemand?.mode === "live") this.startProducer();
      return;
    }
    const window = this.#window;
    const state = this.#lifecycle.snapshot.state;
    // PT-5b — A PAGE SENT SOMEWHERE WHILE NOBODY LOOKS (the document's word: a peer's navigation, an undo, an address
    // typed in another window): a page with NO WINDOW (at rest — hibernated — or never made) is BORN THERE when it is next
    // asked for, and says so now (its address is its pane's: a still of where it was is not shown for it); a page PAUSED
    // goes there at once, unseen and silent. Before PT-5b both were refused, and the page stood where it was for good.
    if (command.action === "go" && !this.#closed && state !== "live") {
      if (!isAllowedBrowserTopLevelUrl(command.url)) {
        throw new Error("Browser navigation URL must use HTTP or HTTPS");
      }
      if (state === "hibernated" || state === "created") {
        this.#resumeUrl = command.url;
        if (this.#browserState !== undefined) {
          this.#browserState = {
            url: command.url,
            loading: false,
            canGoBack: false,
            canGoForward: false,
            ...(this.#browserState.refused === undefined
              ? {}
              : { refused: this.#browserState.refused }),
          };
          this.publishSummary();
        }
        return;
      }
      if (state === "paused" && window !== null && !window.isDestroyed()) {
        this.load(window, command.url);
        return;
      }
    }
    // PT-5b2 (ruling 3) — A PAGE THAT IS STARTING has a window: it can be sent elsewhere, stopped, and loaded again. (Before:
    // all three were refused until its first frame — and since PT-5b a page is `starting` for as long as its first address
    // takes to answer: a pane on a slow host could be neither stopped nor sent anywhere.)
    // PT-5c (ruling 6) — and a page RECONNECTING is a page starting again (its renderer went; a window made anew): once
    // born it is sent, stopped and loaded again as a starting page is. (Before: every verb was refused while it
    // reconnected — and a reconnect whose load ended with nothing was stuck for good, its ↻ dead: the third grade's P6.)
    if (
      this.#closed ||
      window === null ||
      window.isDestroyed() ||
      (state !== "live" && state !== "starting" && state !== "reconnecting")
    ) {
      throw new Error("Browser surface is not available for navigation");
    }
    if (!this.#born) {
      // PT-5b3 (ruling 1) — THE WINDOW IS NOT BORN YET: nothing is asked of it. A GO says where the page is headed — the
      // born window loads THAT, once; a RELOAD is nothing (the load it asks for has not begun, and will — a stop
      // remembered before it is forgotten: ↻ after Stop is the load after all); a STOP is remembered — the born window is
      // not loaded, and the page says `stopped` at its address (↻ loads it). There is no history to go through.
      if (command.action === "go") {
        if (!isAllowedBrowserTopLevelUrl(command.url)) {
          throw new Error("Browser navigation URL must use HTTP or HTTPS");
        }
        this.headed(command.url);
      } else if (command.action === "stop") this.#stopAsked = true;
      else if (command.action === "reload") this.#stopAsked = false;
      return;
    }
    if (command.action === "go") {
      if (!isAllowedBrowserTopLevelUrl(command.url)) {
        throw new Error("Browser navigation URL must use HTTP or HTTPS");
      }
      // (the load it replaces is not a failure: Electron rejects it ERR_ABORTED, and nothing is read off that)
      if (!this.#documentStands) this.headed(command.url);
      this.load(window, command.url);
      return;
    }
    if (!this.#documentStands) {
      // NO DOCUMENT OF THE PAGE STANDS — the window shows its bootstrap blank. A STOP is asked of the engine and
      // remembered: when the load ends with nothing, THAT is what is said — and where the page has SAID its load ended
      // already (PT-5b3) nothing is under way: a stop is nothing, and nothing is remembered. A RELOAD is a load of the
      // address the page was sent to — the engine's own reload would reload the blank (the probe). There is no history
      // to go through.
      if (command.action === "stop") {
        if (this.#browserState?.failure !== undefined) return;
        this.#stopAsked = true;
        window.navigate("stop");
      } else if (command.action === "reload") {
        const url = this.#resumeUrl ?? this.source.initialUrl;
        this.headed(url);
        this.load(window, url);
      }
      return;
    }
    window.navigate(command.action);
  }

  /**
   * PT-5b2 (ruling 6) — A LOAD IS ASKED, AND ITS PROMISE SAYS NOTHING OF THE SOURCE. Electron settles `loadURL` at
   * `did-finish-load` and REJECTS it for anything else — a script's redirect or a link clicked before `load`
   * (ERR_ABORTED −3, the page standing fine where it went), an attachment or an empty answer (ERR_FAILED −2), a refused
   * connection. A page's load failures are the engine's EVENTS (a main-frame `did-fail-load` → `browser.failure`), a
   * window that never comes up is the startup deadline's, and an aborted load is nothing by itself: the navigation that
   * took its place speaks for the page. A rejection that is not an abort is one more word that the load ENDED (see
   * `loadEnded` — an engine that says nothing else).
   */
  private load(window: BrowserSurfaceNativeWindow, url: string): void {
    const epoch = this.#lifecycle.snapshot.producerEpoch;
    void window.loadURL(url).catch((error: unknown) => {
      const said = error as { code?: unknown; errno?: unknown } | null;
      if (said?.errno === -3 || said?.code === "ERR_ABORTED") return;
      if (this.isCurrent(window, epoch)) this.loadEnded();
    });
  }

  /** The page is HEADED to `url` with nothing of it standing yet: it says so — loading, no title, no failure. */
  private headed(url: string): void {
    this.#resumeUrl = url;
    this.#stopAsked = false;
    this.#browserState = {
      url,
      loading: true,
      canGoBack: false,
      canGoForward: false,
      ...(this.#browserState?.refused === undefined ? {} : { refused: this.#browserState.refused }),
    };
    this.publishSummary();
  }

  /**
   * PT-5b2 (ruling 6) — A LOAD THAT ENDED WITH NO DOCUMENT OF THE PAGE AND NOTHING UNDER WAY: the address answered with
   * no page (an attachment — cancelled by the session's guard — or an empty answer), or the person stopped it before
   * anything arrived. The window stands, at its blank; the page SAYS so — a failure of the address it was asked for, in
   * the contract's words — and a reload asks again. Never `starting` for good, never a blank passed off as live.
   *
   * PT-5b3 (ruling 3) — and THE STARTUP DEADLINE IS MET: a window that answered a load (or was born, and held back by
   * the person's stop) is up. Before, only a paint of the blank heard after the remote load began met it — in every run
   * so far that paint came, and nothing makes it come: without it a page that had said "no page at this address" was
   * started again behind the person five seconds later, then failed as a source (`frame-stalled`).
   */
  private loadEnded(): void {
    if (this.#documentStands || this.#browserState?.failure !== undefined) return;
    if (this.#startupTimer !== null) {
      clearTimeout(this.#startupTimer);
      this.#startupTimer = null;
    }
    this.#browserState = {
      url: this.#resumeUrl ?? this.source.initialUrl,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      ...(this.#browserState?.refused === undefined ? {} : { refused: this.#browserState.refused }),
      failure: { reason: this.#stopAsked ? "stopped" : "no-document" },
    };
    this.#stopAsked = false;
    this.publishSummary();
  }

  /** The page's density: its device's as emulated, else its source's. */
  private density(): number {
    return this.#emulation?.deviceScaleFactor ?? this.source.deviceScaleFactor ?? 1;
  }

  private mobile(): boolean {
    return this.#emulation?.mobile === true;
  }

  /** A window's birth: its user's profile directory for a persistent source (given a profiles' root), its density. */
  private windowOptions(
    viewport: LiveSurfaceBrowserSourceV1["logicalViewport"],
    initialRaster: LiveSurfacePixelSizeV1,
  ): BrowserSurfaceNativeWindowOptions {
    const persistent = this.source.profile.mode === "persistent";
    return {
      partition: browserSurfacePartition(this.source),
      persistent,
      ...(persistent && this.#profilesRoot !== undefined
        ? { profilePath: join(this.#profilesRoot, browserSurfaceProfileName(this.source)) }
        : {}),
      logicalViewport: viewport,
      initialBackingRaster: initialRaster,
      deviceScaleFactor: this.density(),
      requestSharedTexture: this.#requestSharedTexture,
    };
  }

  /** What the native window tells its page: the device's agent — or the engine's own — with touch and the scheme. */
  private nativeEmulation(e: LiveSurfaceBrowserEmulationV1): BrowserSurfaceNativeEmulation {
    const agent: BrowserSurfaceAgent =
      e.agent === undefined
        ? this.#native.engineAgent()
        : {
            userAgent: e.agent.userAgent,
            navigatorPlatform: e.agent.navigatorPlatform,
            // an agent that is not this engine's ships no brands of it (a Safari has none)
            metadata: { brands: [], fullVersionList: [], ...e.agent.hints },
          };
    return {
      ...agent,
      touchPoints: e.touchPoints,
      ...(e.colorScheme === undefined ? {} : { colorScheme: e.colorScheme }),
    };
  }

  /** A window's first layout, its page told its device BEFORE it loads — a source that names none is told nothing (the
   * engine as Electron has it).
   * PT-5c (ruling 4) — LAID AT THE LAYOUT THE PAGE SHOULD HAVE NOW: the demand's viewport and raster as they stand when
   * the layout is ASKED — never those the producer started with — and the geometry then says what was laid, as the
   * actuation's does. The layout is asked only once the device is told, and that waits on the window's bootstrap — past
   * the demand's debounce on a busy Mac: the demand moved meanwhile, its actuation laid the new layout first, and the
   * start's was laid LAST (the window at the old size while every frame's geometry said the new: presses landed
   * elsewhere). A re-birth (a device switched to during the birth) laid the start's again, last — my probe O. */
  private bornOn(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
  ): Promise<LiveSurfacePixelSizeV1> {
    const e = this.#emulation;
    const laid = (): Promise<LiveSurfacePixelSizeV1> => {
      const viewport = this.wantedViewport();
      const raster =
        this.#effectiveDemand?.targetRasterSize ?? defaultRaster(viewport, this.density());
      return window
        .setBackingRaster(raster, viewport, this.density(), this.mobile())
        .then((size) => {
          if (this.isCurrent(window, epoch)) this.#viewport = viewport;
          return size;
        });
    };
    return e === undefined ? laid() : window.setEmulation(this.nativeEmulation(e)).then(laid);
  }

  /**
   * PT-5b3 (rulings 1, 2) — A WINDOW'S BIRTH, and the ONE load that follows it. The window is laid out and told its
   * device (`bornOn`); a device switched to meanwhile is told again, BEFORE anything loads; then the window is BORN, and
   * the address is asked for — once, where the page is headed (`#resumeUrl`: a `go` taken before the birth moved it) —
   * or NOT asked for, where the person stopped it before the birth: the page says `stopped` at its address, and ↻
   * loads it. `failed`: the window could not be laid out or told its device — THAT is the source's.
   */
  private born(window: BrowserSurfaceNativeWindow, epoch: number, failed: () => void): void {
    const told = this.#emulation;
    void this.bornOn(window, epoch).then(
      () => {
        if (!this.isCurrent(window, epoch)) return;
        if (this.#emulation !== told) {
          this.born(window, epoch, failed);
          return;
        }
        this.#born = true;
        this.#controlTargets?.associate(this.surfaceId, epoch, window.controlContents);
        // PT-5a: a load the page itself said FAILED is not a failed SOURCE — its window lives, its state says why, and a
        // reload asks again. PT-5b2 (ruling 6): and NOTHING of the source is read off this load's promise (`load`)
        if (this.#stopAsked) this.loadEnded();
        else this.load(window, this.#resumeUrl ?? this.source.initialUrl);
      },
      () => {
        if (this.isCurrent(window, epoch)) failed();
      },
    );
  }

  /**
   * PT-4 — THE DEVICE SWITCH under a running page (the `emulate` command): the page is told at once — its agent and hints,
   * touch, the scheme, its density and mobile layout at the viewport the demand names — and, when what it is TOLD of its
   * device moved (its agent, its hints, mobile, touch), RELOADED ONCE: a loaded document keeps what it learnt at its load
   * (the probe: `ontouchstart` is absent until the next document; a site that chose its markup by its agent has chosen).
   * A scheme or a density alone is told live. The same emulation again is nothing. A page asleep is born on it.
   */
  private emulate(next: LiveSurfaceBrowserEmulationV1): void {
    const was = this.#emulation;
    if (was !== undefined && JSON.stringify(was) === JSON.stringify(next)) return;
    this.#emulation = next;
    this.#emulations += 1;
    const window = this.#window;
    if (window === null || window.isDestroyed()) return;
    // PT-5b (ruling 5a) — the device moved to ANOTHER DENSITY: the page's window is made anew at it
    if (this.#windowDensity !== undefined && this.density() !== this.#windowDensity) {
      this.remakeWindow();
      return;
    }
    // PT-5b3 (rulings 1, 2) — THE WINDOW IS NOT BORN YET: nothing is asked of it; its birth tells it the device it should
    // have before anything loads (`born`), and loads once. (Before: told behind the birth's own commands — after the
    // page's load had begun, its first request gone out under the device before — and then, where the page had said a
    // state in an earlier life, the engine's reload: of the blank.)
    if (!this.#born) return;
    const epoch = this.#lifecycle.snapshot.producerEpoch;
    const told = toldKey(was) !== toldKey(next);
    // PT-5b3 (ruling 2) — A LOAD UNDER WAY, NO DOCUMENT OF THE PAGE YET, and what the page is told of its device moved:
    // the address must be asked for AGAIN, as that device. The engine's own reload would reload the blank (PT-5b2's probe)
    // — and the engine takes none of the device's commands while a navigation is pending: every `Emulation.*` command
    // waits, unanswered, for the commit (PT-5b3's probe, `pending.cjs`), so told on this window the page would load as
    // the device before and then load again. So the window is made ANEW: born on the device, its address asked for once
    // more, at once — there is no page to lose (no history, no scroll, nothing typed).
    if (told && !this.#documentStands && this.#browserState?.failure === undefined) {
      this.#emulationReloads += 1;
      this.remakeWindow();
      return;
    }
    if (this.#rasterTimer !== null) {
      clearTimeout(this.#rasterTimer);
      this.#rasterTimer = null;
    }
    const viewport = this.wantedViewport();
    const requested =
      this.#effectiveDemand?.targetRasterSize ?? defaultRaster(viewport, this.density());
    const bounded = this.#transport === "cpu-bgra" ? clampCpuRaster(requested) : requested;
    void window
      .setEmulation(this.nativeEmulation(next))
      .then(() => window.setBackingRaster(bounded, viewport, this.density(), this.mobile()))
      .then(() => {
        if (!this.isCurrent(window, epoch)) return;
        this.#viewport = viewport;
        // a page that has loaded learns its device by loading again. PT-5b3 (ruling 2) — with NO DOCUMENT of the page
        // standing the engine's own reload is never asked (it reloads the blank — and the page then said `no-document`
        // for an address it had never been asked for again): a page that has SAID its load ended (`no-document`,
        // `stopped`) is told its device and loads nothing — what it said stands, word for word, and ↻ loads it on the
        // new device.
        if (told && this.#documentStands) {
          this.#emulationReloads += 1;
          window.navigate("reload");
        } else window.invalidate();
      })
      .catch(() => undefined);
  }

  /**
   * PT-5b (ruling 5a) — A PAGE'S WINDOW IS BORN AT ITS DEVICE'S DENSITY. An offscreen window's density is its own for life;
   * told another by emulation alone, the engine paints a page that lays itself out by a phone's rules (one that names no
   * viewport) at the RATIO of the two (PT-4's probe 6: a pane laid as a laptop, @2, switched to the phone, @3, painted at
   * ⅔). So a device switch that changes the density makes the window ANEW at the new one, at the page's address (where it
   * last was) — its history, its scroll and whatever was typed into it are the cost; ruled acceptable: a device switch
   * starts the page anew (it already reloaded once). Asked for LIVE the page starts again at once; nobody asking for it
   * live, its window goes and it is made at its device's density when it is next asked for — no window is born under an
   * ask that is not live. Nothing is said between: one summary, `starting` or `hibernated`.
   */
  private remakeWindow(): void {
    this.#windowsRemade += 1;
    this.clearSourceTimers();
    // PT-5c (ruling 5) — A PERSON'S STOP SURVIVES A REMAKE: one asked before the birth, one asked while the first load
    // was under way (the engine's stop not yet answered), one SAID (`stopped`). The window made anew is born and NOT
    // loaded; the page says `stopped` at its address, and ↻ loads it on the new device. (Before: the going forgot it, and
    // the new window loaded the address — my probe R.) A page that said `no-document` had no stop of the person's: it
    // is asked for again. Under an ask that is not live the remake puts the page to rest — its wake is a rest's.
    const stopped = this.#stopAsked || this.#browserState?.failure?.reason === "stopped";
    // to rest by the table's own steps, silently
    for (const step of ["live", "paused", "hibernated"] as const) {
      if (this.#lifecycle.snapshot.state !== step && this.#lifecycle.canTransition(step))
        this.#lifecycle.transition(step);
    }
    this.destroyWindow();
    if (this.#effectiveDemand?.mode === "live") {
      this.startProducer();
      // (read at the birth's end: `born`)
      if (stopped) this.#stopAsked = true;
    } else this.publishSummary();
  }

  /**
   * PT-5b (ruling 5c) — WHERE THE HAND'S POINT IS ON THE PAGE. The hand sends the VIEW's points (the displayed frame's
   * logical px) and CDP takes the page's CSS px: the same thing wherever the page is laid out at the view's width — every
   * page but a `mobile` one that lays itself out wider and is shown whole, scaled into the view (never forced to 1 on a
   * `mobile` page: ruling 5b). There the page's px are the view's OVER its visual-viewport scale. A page that is not
   * `mobile` is asked nothing: 1.
   * PT-5c (ruling 1) — THE SCALE IS FOLLOWED, NEVER READ ON THE HAND'S PATH: the page SAYS it (its guard's word at its
   * start and at every change of its visual viewport — a zoom it makes, a pinch), and an event goes at the scale its
   * document last said. (PT-5b read it at each press, on the chain — `Page.getLayoutMetrics`, the renderer's: while a
   * navigation pended it was not answered, and a tap after a link to a slow site waited for the site, then landed, with
   * the keys and the wheel behind it, on the NEXT document.) An event of a document whose page has not yet said its scale
   * — a new one — WAITS for the page's first word; that wait ends at the word, at the next commit (refused, counted), or
   * when the window goes (its turn ends with it) — and (R1) at a rest, and at the going of the attachment it came through
   * (refused, counted: never sent to a page at rest, nor a gesture begun after its attachment went) — and (R2) after
   * `SCALE_WORD_MS`, refused, counted: the keys and text behind it are never held for good by a page that never speaks.
   */
  private pointScale(document: number, by: string | undefined): Promise<number> {
    if (!this.mobile()) return Promise.resolve(1);
    const said = this.#pageScale;
    if (said !== undefined && said.document === document) return Promise.resolve(said.value);
    return new Promise<number>((heard, gone) => {
      const waiter = {
        document,
        by,
        heard,
        gone,
        timer: setTimeout(() => {
          if (this.#scaleWaiters.delete(waiter))
            gone(new Error("Browser page said no scale within its bound"));
        }, SCALE_WORD_MS),
      };
      this.#scaleWaiters.add(waiter);
    });
  }

  /** PT-5c (R1): the attachment an event came through still stands (an event of the runtime's own seam has none). */
  private stands(by: string | undefined): boolean {
    return by === undefined || this.#attachments.has(by);
  }

  /** PT-5c (ruling 1): the page SAID its scale — the document's word, kept; the events waiting for it go at it. */
  private acceptScale(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    scale: number,
    counted: number,
  ): void {
    if (!this.ownsProducer(window, epoch) || !Number.isFinite(scale) || scale <= 0) return;
    const value = Math.min(Math.max(scale, 0.05), 20);
    const document = this.#documentBase + counted;
    this.#pageScale = { value, document };
    for (const waiter of [...this.#scaleWaiters]) {
      if (waiter.document !== document) continue;
      this.#scaleWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.heard(value);
    }
  }

  /** PT-5c (ruling 1): at a commit — the finger cancelled on the chain, the buttons forgotten, the old document's waits ended. */
  private endDown(window: BrowserSurfaceNativeWindow): void {
    this.scaleWaitsEnd(
      (waiter) => waiter.document !== this.#document,
      "Browser input's document is gone",
    );
    this.#pressed.clear();
    // R8: the keys too — forgotten, as the buttons
    this.#keysDown.clear();
    if (!this.#touching) return;
    this.#touching = false;
    this.#touchingBy = undefined;
    const turn = this.#inputTail.then((): Promise<void> | undefined => {
      if (this.#closed || window.isDestroyed() || this.#window !== window) return undefined;
      return Promise.race([
        window.dispatchTouch({ type: "touchCancel", touchPoints: [] }),
        this.goneOf(window),
      ]);
    });
    this.#inputTail = turn.catch(() => undefined);
  }

  /** PT-5c (ruling 1; R1): the events waiting for a word wait no longer — those of a document that is no more (a commit),
   * all of them (the window's going, a rest), or those of an attachment that went. */
  private scaleWaitsEnd(
    which: (waiter: { readonly document: number; readonly by: string | undefined }) => boolean,
    reason: string,
  ): void {
    for (const waiter of [...this.#scaleWaiters]) {
      if (!which(waiter)) continue;
      this.#scaleWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.gone(new Error(reason));
    }
  }

  /**
   * PT-4 — the page's FAVICON: the icons the page NAMES; the first http(s) one is fetched through the page's own session,
   * held to the cap, and published with the browser state — under the origin the page stood on when it named them. A later
   * word stands over an earlier fetch's answer.
   */
  private acceptFavicon(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    urls: readonly string[],
  ): void {
    if (!this.ownsProducer(window, epoch)) return;
    this.#faviconSerial += 1;
    const serial = this.#faviconSerial;
    const origin = webOriginOf(this.#browserState?.url);
    const url = urls.find((candidate) => /^https?:\/\//iu.test(candidate));
    if (url === undefined) {
      this.setFavicon(undefined, origin);
      return;
    }
    void window
      .fetchIcon(url, LIVE_SURFACE_FAVICON_MAX_BYTES)
      .then((icon) => (icon === null ? undefined : faviconOf(icon)))
      .catch(() => undefined)
      .then((favicon) => {
        if (serial === this.#faviconSerial && !this.#closed) this.setFavicon(favicon, origin);
      });
  }

  private setFavicon(next: LiveSurfaceBrowserStateV1["favicon"], origin: string | undefined): void {
    this.#favicon = next;
    this.#faviconOrigin = origin;
    // (a summary is sent only when it changed: the same icon under the same origin publishes nothing)
    if (this.#browserState !== undefined) this.publishSummary();
  }

  /**
   * PT-5a — the page stopped answering (Electron's `unresponsive`) or answers again. A source that says when its page
   * stops gives it the bound (`unresponsiveMs`) to answer; past it the page is said to have stopped and waits for a reload.
   */
  private acceptUnresponsive(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    unresponsive: boolean,
  ): void {
    if (!this.ownsProducer(window, epoch)) return;
    if (this.#unresponsiveTimer !== null) {
      clearTimeout(this.#unresponsiveTimer);
      this.#unresponsiveTimer = null;
    }
    if (!unresponsive || this.source.whenStopped !== "say") return;
    this.#unresponsiveTimer = setTimeout(() => {
      this.#unresponsiveTimer = null;
      if (!this.isCurrent(window, epoch)) return;
      this.#waitsForReload = true;
      this.failSource(
        sourceError("frame-stalled", "Browser page stopped responding", "user-action"),
      );
    }, this.#unresponsiveMs);
  }

  /**
   * PT-5a — the page asked for what it may not have (the native window answered it at once): counted; a POP-UP's address
   * is where the SAME pane goes (a desk has no tabs) — through the same top-level policy as any navigation, and only while
   * the page is live; a cancelled DOWNLOAD is said in the page's state, its serial moved, for the head to say for a moment.
   */
  private acceptRefusal(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    what: BrowserSurfaceRefusal,
    url: string | undefined,
  ): void {
    if (!this.ownsProducer(window, epoch)) return;
    this.#refusals[what] += 1;
    if (what === "popup") {
      if (
        url !== undefined &&
        isAllowedBrowserTopLevelUrl(url) &&
        url !== "about:blank" &&
        !window.isDestroyed() &&
        this.#lifecycle.snapshot.state === "live"
      )
        void window.loadURL(url).catch(() => undefined);
      return;
    }
    if (what !== "download") return;
    this.#refused = { what: "download", serial: (this.#refused?.serial ?? 0) + 1 };
    if (this.#browserState !== undefined) this.publishSummary();
  }

  /** PT-3: the page's cursor moved — a summary, so the renderer's face says it (`LiveInfo.cursor`) and wakes its desk. */
  private acceptCursor(window: BrowserSurfaceNativeWindow, epoch: number, cursor: string): void {
    if (!this.ownsProducer(window, epoch)) return;
    this.#cursor = cssCursorOf(cursor);
    // the same cursor again publishes nothing: a summary is sent only when it changed
    if (this.#browserState !== undefined) this.publishSummary();
  }

  private acceptNavigationState(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    state: BrowserSurfaceNavigationState,
  ): void {
    if (!this.ownsProducer(window, epoch)) return;
    const said = clampBrowserState(state);
    if (said === undefined) return;
    // PT-5b3 (ruling 4): the document the page is at now, counted over the windows before this one
    const document = this.#documentBase + state.document;
    const another = document !== this.#document;
    this.#document = document;
    // PT-5b — WHILE A WINDOW'S FIRST LOAD IS PENDING the engine's committed address is still its bootstrap's (`about:blank`):
    // plumbing, never where the page is. The page is headed where it was sent — it says THAT, loading, with no title yet.
    // (Before: a page slow to answer said it was at `about:blank` — on its head, and to the desk, which took its still for
    // another address's and let it go.)
    const plumbing = webOriginOf(said.url) === undefined && said.failure === undefined;
    if (!plumbing) {
      // a document of the page stands (or the engine's error page, in a failed address's place)
      this.#documentStands = true;
      this.#stopAsked = false;
    } else if (!this.#documentStands) {
      // PT-5b2 (ruling 6): the window is at its blank, and the engine says the load is under way — or that it STOPPED
      // with nothing committed and nothing failed (an attachment, a 204, a stop: the probe). That is the load's END.
      if (said.loading) this.#heardLoading = true;
      else if (this.#heardLoading) {
        this.loadEnded();
        return;
      }
    }
    const clamped: LiveSurfaceBrowserStateV1 = plumbing
      ? {
          url: this.#resumeUrl ?? this.source.initialUrl,
          loading: said.loading,
          canGoBack: false,
          canGoForward: false,
          ...(this.#browserState?.refused === undefined
            ? {}
            : { refused: this.#browserState.refused }),
        }
      : said;
    // PT-5c (ruling 1) — ANOTHER DOCUMENT (the engine's own word — a commit; never a move within one: PT-5b3 ruling 4):
    // what was DOWN in the gone document is ended as the engine needs, and then nothing is down. A FINGER is cancelled —
    // the engine holds a touch open across a commit, and the next document is deaf to touch until it ends (its cancel
    // reaches the next document as nothing: PT-5c's probe `across.cjs`); a BUTTON is forgotten — the engine carries none
    // across a commit, and a release after it is a stray `mouseup` in the next document. The events waiting for the gone
    // document's word wait no longer (refused, counted); its scale is its own (`#pageScale` names its document).
    if (another) this.endDown(window);
    this.#browserState = clamped;
    if (webOriginOf(clamped.url) !== undefined) this.#resumeUrl = clamped.url;
    this.publishSummary();
  }

  private reconcileDemand(): void {
    this.#effectiveDemand = aggregateDemand(this.#attachments.values());
    const demand = this.#effectiveDemand;
    const state = this.#lifecycle.snapshot.state;
    if (demand === null) {
      // No renderer attached — a window reload's gap, or its last face gone: the page PAUSES and is KEPT, so a renderer that
      // re-attaches within the grace (main's custody re-binds the surface by its reuse key) finds the SAME page, its memory
      // whole; none back, it hibernates once the grace lapses (PT-2). An explicit `hibernated` demand still hibernates at once.
      // A pause stops the page's frames, never its sound: a page no renderer shows is MUTED while the grace keeps it.
      if (state === "live") this.pauseProducer();
      this.mute(true);
      this.armDetachedHibernate();
      return;
    }
    this.cancelDetachedHibernate();
    // PT-5a (ruling 4) — WHO HEARS A PAGE: one asked for LIVE — its pane seen, or held — and no other. An ATTACHED pause is
    // silent too: a pane off the view, a parked desk, and a deleted pane's page in the pool's grace (the pool's idle demand
    // is a paused one, written the moment its last face lets go: silent AT ONCE). Seen live again, it is heard again.
    this.mute(demand.mode !== "live");
    if (demand.mode === "live") {
      if (
        state === "created" ||
        state === "hibernated" ||
        (state === "failed" && !this.#waitsForReload)
      ) {
        this.startProducer();
        return;
      }
      // a page said to have stopped waits for its reload, whoever looks at it
      if (state === "failed") return;
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
    // PT-5b — a page put to REST while it is still STARTING (its server slow to answer) is let go AT ONCE: it would be
    // discarded at its first frame anyway, and meanwhile it held a slot of the desk's cap for as long as its load took.
    // (A page asked `paused` while starting still loads on — its pane is only out of view, and finds it loaded.)
    // PT-5c (ruling 6) — and a page RECONNECTING the same, its window made or still to be made (its reconnect's tick:
    // the reconnect is not made). Before, a rest was ignored while it reconnected.
    if ((state === "starting" && this.#window !== null) || state === "reconnecting") {
      this.clearSourceTimers();
      for (const step of ["live", "paused", "hibernated"] as const)
        this.#lifecycle.transition(step);
      this.destroyWindow();
      this.publishSummary();
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
    this.#waitsForReload = false;
    const epoch = this.#lifecycle.snapshot.producerEpoch;
    // A producer started under live demand is born at the demanded layout —
    // the source's own viewport is only the no-opinion fallback (DT-3f).
    const viewport = this.wantedViewport();
    const demandRaster = this.#effectiveDemand?.targetRasterSize;
    const initialRaster = demandRaster ?? defaultRaster(viewport, this.density());
    let window: BrowserSurfaceNativeWindow;
    try {
      window = this.#native.createWindow(this.windowOptions(viewport, initialRaster));
      this.#viewport = viewport;
      this.#window = window;
      this.#windowDensity = this.density();
      const removePaint = window.onPaint((paint) => this.acceptPaint(window, epoch, paint));
      const removeGone = window.onRenderProcessGone((reason) =>
        this.handleProducerGone(window, epoch, reason),
      );
      const removeDestroyed = window.onDestroyed(() =>
        this.handleProducerGone(window, epoch, "WebContents destroyed"),
      );
      const removeNavigation = window.onNavigationState((state) =>
        this.acceptNavigationState(window, epoch, state),
      );
      const removeCursor = window.onCursor((cursor) => this.acceptCursor(window, epoch, cursor));
      const removeFavicon = window.onFavicon((urls) => this.acceptFavicon(window, epoch, urls));
      const removeRefused = window.onRefused((what, url) =>
        this.acceptRefusal(window, epoch, what, url),
      );
      const removeUnresponsive = window.onUnresponsive((unresponsive) =>
        this.acceptUnresponsive(window, epoch, unresponsive),
      );
      const removeScale = window.onScale((scale, counted) =>
        this.acceptScale(window, epoch, scale, counted),
      );
      this.#callbacks = {
        removePaint,
        removeGone,
        removeDestroyed,
        removeNavigation,
        removeCursor,
        removeFavicon,
        removeRefused,
        removeUnresponsive,
        removeScale,
      };
      this.#producersStarted += 1;
      this.applyFrameRate();
      this.#startupTimer = setTimeout(
        () => this.handleStartupTimeout(window, epoch),
        this.#startupTimeoutMs,
      );
      this.born(window, epoch, () =>
        this.failSource(
          sourceError("source-not-found", "Browser source could not load", "user-action"),
        ),
      );
      this.publishSummary();
    } catch {
      this.failSource(
        sourceError("security-rejected", "Browser source could not start safely", "permanent"),
      );
    }
  }

  /** The layout the page should be at NOW: aggregated demand's, else the
   * source's own — both through the same rounding the native adapter applies. */
  private wantedViewport(): LiveSurfaceBrowserSourceV1["logicalViewport"] {
    return roundedViewport(this.#effectiveDemand?.logicalViewport ?? this.source.logicalViewport);
  }

  private acceptPaint(
    window: BrowserSurfaceNativeWindow,
    epoch: number,
    paint: BrowserSurfacePaint,
  ): void {
    const observeDuration = this.#onPaintCallbackDurationUs;
    const startedAtUs = observeDuration === undefined ? null : this.#native.monotonicNowUs();
    try {
      if (!this.isCurrent(window, epoch) || !this.#lifecycle.acceptsFrames) {
        paint.texture?.release();
        return;
      }
      // PT-5b — THE WINDOW'S OWN FIRST DOCUMENT IS NOT THE PAGE: a paint of the bootstrap blank is offered to nobody (before:
      // a pane whose page was slow to answer showed a blank white frame, "live", in place of its film — or of its still).
      // It says the window is up — the startup deadline is met — and the page is still STARTING: its first frame is its own.
      if (paint.bootstrap === true) {
        paint.texture?.release();
        this.#bootstrapPaints += 1;
        if (this.#startupTimer !== null) {
          clearTimeout(this.#startupTimer);
          this.#startupTimer = null;
        }
        return;
      }
      // (a paint of the page's own: a document of it stands — the native marks every paint before that `bootstrap`)
      this.#documentStands = true;
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
    } finally {
      if (observeDuration !== undefined && startedAtUs !== null) {
        try {
          observeDuration(this.#native.monotonicNowUs() - startedAtUs);
        } catch {
          // Diagnostics must not become part of the producer's correctness path.
        }
      }
    }
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
      ...(this.#document === 0 ? {} : { document: this.#document }),
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
        ...(this.#document === 0 ? {} : { document: this.#document }),
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
    const key = `${codedSize.width}:${codedSize.height}:${visibleRect.x}:${visibleRect.y}:${visibleRect.width}:${visibleRect.height}:${this.#viewport.width}:${this.#viewport.height}`;
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
      // The CURRENT layout (DT-3f), never the source's construction-time
      // viewport: input maps against a frame's logicalSize, so this must name
      // the layout the page was actually painted at.
      logicalSize: {
        width: this.#viewport.width,
        height: this.#viewport.height,
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
    // PT-5c (R1): nothing waiting for its page's word is sent to a page at rest — every such wait ends here, refused
    this.scaleWaitsEnd(() => true, "Browser page is at rest");
    this.publishSummary();
  }

  private armDetachedHibernate(): void {
    if (this.#hibernateTimer !== null || this.#closed) return;
    // no grace (a lab's runtime, no custody behind it): hibernated at once, as a detach always did
    if (this.#detachedHibernateMs === 0) {
      this.hibernateProducer();
      return;
    }
    this.#hibernateTimer = setTimeout(() => {
      this.#hibernateTimer = null;
      if (this.#closed || aggregateDemand(this.#attachments.values()) !== null) return;
      if (this.#lifecycle.snapshot.state === "live") this.pauseProducer();
      this.hibernateProducer();
    }, this.#detachedHibernateMs);
  }

  /** A page whose renderer left is silent until one is attached again (an attached pause keeps its sound — PT-5's call). */
  private mute(muted: boolean): void {
    if (this.#muted === muted) return;
    const window = this.#window;
    if (window === null || window.isDestroyed()) return;
    this.#muted = muted;
    window.setAudioMuted(muted);
  }

  private cancelDetachedHibernate(): void {
    if (this.#hibernateTimer === null) return;
    clearTimeout(this.#hibernateTimer);
    this.#hibernateTimer = null;
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
    // Viewport and raster actuate TOGETHER on the same stabilization debounce:
    // a drag-resize streams demand, and each is one CDP emulation pass. The
    // viewport flips `#viewport` only once the native window confirms, so
    // geometry keeps naming the layout frames were actually painted at.
    const viewport = this.wantedViewport();
    const requested = demand.targetRasterSize ?? defaultRaster(viewport, this.density());
    const bounded = this.#transport === "cpu-bgra" ? clampCpuRaster(requested) : requested;
    this.#rasterTimer = setTimeout(() => {
      this.#rasterTimer = null;
      if (!this.isCurrent(window, epoch) || this.#effectiveDemand?.mode !== "live") return;
      void window
        .setBackingRaster(bounded, viewport, this.density(), this.mobile())
        .then(() => {
          if (this.isCurrent(window, epoch) && this.#effectiveDemand?.mode === "live") {
            this.#viewport = viewport;
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
    // PT-5a — a source that SAYS when its page stops: no restart behind the person's back; the page waits for a reload
    if (this.source.whenStopped === "say") {
      this.#waitsForReload = true;
      this.failSource(sourceError("producer-crashed", "Browser page stopped", "user-action"));
      return;
    }
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
    const viewport = this.wantedViewport();
    const initialRaster =
      this.#effectiveDemand?.targetRasterSize ?? defaultRaster(viewport, this.density());
    try {
      const window = this.#native.createWindow(this.windowOptions(viewport, initialRaster));
      this.#window = window;
      this.#viewport = viewport;
      this.#windowDensity = this.density();
      this.#callbacks = {
        removePaint: window.onPaint((paint) => this.acceptPaint(window, epoch, paint)),
        removeGone: window.onRenderProcessGone((reason) =>
          this.handleProducerGone(window, epoch, reason),
        ),
        removeDestroyed: window.onDestroyed(() =>
          this.handleProducerGone(window, epoch, "WebContents destroyed"),
        ),
        removeNavigation: window.onNavigationState((state) =>
          this.acceptNavigationState(window, epoch, state),
        ),
        removeCursor: window.onCursor((cursor) => this.acceptCursor(window, epoch, cursor)),
        removeFavicon: window.onFavicon((urls) => this.acceptFavicon(window, epoch, urls)),
        removeRefused: window.onRefused((what, url) =>
          this.acceptRefusal(window, epoch, what, url),
        ),
        removeUnresponsive: window.onUnresponsive((unresponsive) =>
          this.acceptUnresponsive(window, epoch, unresponsive),
        ),
        removeScale: window.onScale((scale, counted) =>
          this.acceptScale(window, epoch, scale, counted),
        ),
      };
      this.#producersStarted += 1;
      this.applyFrameRate();
      this.#startupTimer = setTimeout(
        () => this.handleStartupTimeout(window, epoch),
        this.#startupTimeoutMs,
      );
      this.born(window, epoch, () =>
        this.failSource(
          sourceError("source-not-found", "Browser source could not reconnect", "user-action"),
        ),
      );
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
    // PT-5a: a page with no window keeps its address — and has nowhere to go, and loads nothing
    if (this.#browserState !== undefined) {
      this.#browserState = {
        ...this.#browserState,
        loading: false,
        canGoBack: false,
        canGoForward: false,
      };
    }
    this.#error = error;
    this.publishSummary();
  }

  private destroyWindow(): void {
    const window = this.#window;
    const callbacks = this.#callbacks;
    this.#window = null;
    this.#callbacks = null;
    // PT-5b3 (ruling 5): a turn pending on this window ends with it
    if (window !== null) this.#going.get(window)?.go(new Error("Browser input's window is gone"));
    // the next window is born with its sound (it is made only under a LIVE ask — every caller of `startProducer` and
    // `createReconnectingProducer` says so: a page woken is born as its ask says), at its own density, its scale unread
    this.#muted = false;
    this.#windowDensity = undefined;
    this.#documentStands = false;
    this.#heardLoading = false;
    this.#stopAsked = false;
    this.#born = false;
    this.#documentBase = this.#document;
    // PT-5c (ruling 1): nothing waits for a word of this window's documents any more (its turns end with it besides)
    this.#pageScale = undefined;
    this.scaleWaitsEnd(() => true, "Browser input's window is gone");
    if (this.#startupTimer !== null) {
      clearTimeout(this.#startupTimer);
      this.#startupTimer = null;
    }
    callbacks?.removePaint();
    callbacks?.removeGone();
    callbacks?.removeDestroyed();
    callbacks?.removeNavigation();
    callbacks?.removeCursor();
    callbacks?.removeFavicon();
    callbacks?.removeRefused();
    callbacks?.removeUnresponsive();
    callbacks?.removeScale();
    if (this.#unresponsiveTimer !== null) {
      clearTimeout(this.#unresponsiveTimer);
      this.#unresponsiveTimer = null;
    }
    this.#cursor = undefined;
    this.#touching = false;
    this.#touchingBy = undefined;
    this.#pressed.clear();
    this.#keysDown.clear();
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
    // PT-5a: a new window's page keeps the last one's address and says it is LOADING, with nowhere to go yet — the last
    // window's history and its failed load are not this one's
    if (this.#browserState !== undefined) this.#browserState = loadingAgain(this.#browserState);
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
    this.cancelDetachedHibernate();
  }
}
