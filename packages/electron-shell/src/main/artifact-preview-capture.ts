import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ARTIFACT_PREVIEW_LIMITS,
  type ShellWebContentsCaptureArtifactPreviewResult as CaptureResult,
  LAYOUT,
  type ShellWebContentsCaptureArtifactPreviewParams,
  ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";
import { durableRename } from "@vibefield/logging";

const PREVIEW_PARTITION_PREFIX = "vibefield-artifact-preview:";
/** Item 378 — where a capture's WebRTC TCP is sent: a loopback port nothing serves, so a relay over TCP or TLS never
 * connects. The page's own origin and its allowHosts bypass it, and the request gate cancels everything else anyway. */
const PREVIEW_DEAD_PROXY = "127.0.0.1:9";
const ALL_URLS = { urls: ["<all_urls>"] } as const;
const guardedPreviewSessions = new WeakSet<object>();

interface PreviewImage {
  getSize(): { width: number; height: number };
  isEmpty(): boolean;
  resize(options: { width: number; height: number; quality: "best" }): PreviewImage;
  toJPEG(quality: number): Buffer;
}

interface PreviewWebRequest {
  onBeforeRequest(
    filter: { urls: readonly string[] },
    listener:
      | ((
          details: { url: string; resourceType?: string },
          callback: (decision: { cancel: boolean }) => void,
        ) => void)
      | null,
  ): void;
  onHeadersReceived(
    filter: { urls: readonly string[] },
    listener:
      | ((
          details: { url: string; resourceType?: string; statusCode: number },
          callback: (decision: { cancel: boolean }) => void,
        ) => void)
      | null,
  ): void;
}

/** Item 378 — the capture session's proxy, as `Session.setProxy` takes it. */
interface PreviewProxyConfig {
  mode: "fixed_servers";
  proxyRules: string;
  proxyBypassRules: string;
}

interface PreviewSession {
  webRequest: PreviewWebRequest;
  setPermissionRequestHandler(
    handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
  ): void;
  setPermissionCheckHandler(handler: (contents: unknown, permission: string) => boolean): void;
  on(event: "will-download", listener: (event: { preventDefault(): void }) => void): void;
  off(event: "will-download", listener: (event: { preventDefault(): void }) => void): void;
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
  closeAllConnections(): Promise<void>;
  setProxy(config: PreviewProxyConfig): Promise<void>;
  // Item 519 (2026-11-18): the rest of what a reused session is cleared of between captures.
  clearData(): Promise<void>;
  clearAuthCache(): Promise<void>;
  clearHostResolverCache(): Promise<void>;
  clearCodeCaches(options: { urls?: string[] }): Promise<void>;
  clearSharedDictionaryCache(): Promise<void>;
  readonly serviceWorkers: { getAllRunning(): Record<number, unknown> };
}

interface PreviewWebContents {
  capturePage(rect: { x: number; y: number; width: number; height: number }): Promise<PreviewImage>;
  getTitle(): string;
  on(
    event: "will-navigate" | "will-redirect",
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): void;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
  setWebRTCIPHandlingPolicy(policy: "disable_non_proxied_udp"): void;
}

interface PreviewWindow {
  readonly webContents: PreviewWebContents;
  destroy(): void;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
}

interface PreviewWindowOptions {
  width: number;
  height: number;
  partition: string;
  webPreferences: {
    sandbox: true;
    contextIsolation: true;
    nodeIntegration: false;
    nodeIntegrationInWorker: false;
    webviewTag: false;
    webSecurity: true;
    allowRunningInsecureContent: false;
  };
}

export interface ArtifactPreviewCaptureNative {
  createSession(partition: string): PreviewSession;
  createWindow(options: PreviewWindowOptions): PreviewWindow;
  decodeImage(bytes: Buffer): PreviewImage;
}

/** Item 519 (2026-11-18): why a capture session is never used again. */
export type PreviewSessionRetiredReason =
  | "clear-rejected"
  | "clear-overran"
  | "worker-running"
  | "in-use";

/** Item 519 (2026-11-18): how long a capture waits for its artifact's session to finish clearing before it reuses
 * it. A clearing still unsettled by then retires the session, and the capture takes a fresh one. */
export const PREVIEW_SESSION_CLEAR_BOUND_MS = 2_000;

export interface ArtifactPreviewCaptureOptions {
  dataDir: string;
  native: ArtifactPreviewCaptureNative;
  randomId?: () => string;
  /** Item 519: told each time a session is retired, with the number of captures it served. */
  onSessionRetired?: (reason: PreviewSessionRetiredReason, captures: number) => void;
  /** Item 519: the clearing bound; PREVIEW_SESSION_CLEAR_BOUND_MS unless a test shortens it. */
  clearBoundMs?: number;
}

/** Item 519 (2026-11-18): one artifact's capture session, kept so its next capture reuses it once it is cleared. */
interface HeldPreviewSession {
  readonly partition: string;
  readonly session: PreviewSession;
  /** false for a session made for one capture alone, which is never kept. */
  readonly kept: boolean;
  inUse: boolean;
  clearing: Promise<"clean" | "rejected"> | null;
  captures: number;
}

export class ArtifactPreviewCaptureError extends Error {
  readonly kind:
    | "CONFLICT"
    | "INTERNAL"
    | "PRECONDITION_FAILED"
    | "RESOURCE_EXHAUSTED"
    | "TIMEOUT"
    | "UNAVAILABLE";

  constructor(
    kind: ArtifactPreviewCaptureError["kind"],
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ArtifactPreviewCaptureError";
    this.kind = kind;
  }
}

/** AH-4's capture browser: one in-memory session per artifact, one window per
 * capture, the network gate, JPEG normalization, and the atomic host-private
 * write. Item 519 (2026-11-18): an artifact's session is kept and reused by its
 * next capture, only once every clear of it has settled; a clear that fails or
 * overruns retires it for good. Two artifacts never share a session. (This said
 * the class owns one ephemeral session per capture: Electron has no call that
 * ends a session, so each one was held until the app quit.) */
export class ArtifactPreviewCapture {
  readonly #previewRoot: string;
  readonly #native: ArtifactPreviewCaptureNative;
  readonly #randomId: () => string;
  readonly #onSessionRetired: (reason: PreviewSessionRetiredReason, captures: number) => void;
  readonly #clearBoundMs: number;
  /** Item 519: each artifact's kept session, by artifact id. */
  readonly #sessions = new Map<string, HeldPreviewSession>();

  constructor(options: ArtifactPreviewCaptureOptions) {
    this.#previewRoot = join(options.dataDir, ...LAYOUT.ARTIFACT_PREVIEWS_DIR);
    this.#native = options.native;
    this.#randomId = options.randomId ?? (() => randomBytes(18).toString("base64url"));
    this.#onSessionRetired = options.onSessionRetired ?? (() => undefined);
    this.#clearBoundMs = options.clearBoundMs ?? PREVIEW_SESSION_CLEAR_BOUND_MS;
  }

  async capture(
    params: ShellWebContentsCaptureArtifactPreviewParams,
    signal: AbortSignal,
  ): Promise<CaptureResult> {
    throwIfAborted(signal);
    const targetOrigin = new URL(params.url).origin;
    // MA-3c: a made app's served-shell hosts (absent for a live artifact: its origin alone).
    const allowHosts = params.allowHosts ?? [];
    const targetDir = join(this.#previewRoot, params.artifactId);
    const targetPath = join(targetDir, "thumbnail.jpg");
    let tempPath: string | null = null;
    const denyDownload = (event: { preventDefault(): void }) => event.preventDefault();
    let held: HeldPreviewSession | null = null;
    let captureSession: PreviewSession | null = null;
    let window: PreviewWindow | null = null;
    let requestGuardInstalled = false;
    let responseGuardInstalled = false;
    let downloadGuardInstalled = false;
    let abortGuardInstalled = false;
    let mainFrameStatus: number | null = null;
    const abort = () => {
      if (window !== null && !window.isDestroyed()) window.destroy();
    };
    try {
      await ensureOwnedPreviewDirectory(this.#previewRoot, targetDir);
      throwIfAborted(signal);
      // Item 519: the artifact's kept session, reused only once its last clearing has settled, else a fresh one.
      held = await this.#lease(params.artifactId, signal);
      captureSession = held.session;
      const partition = held.partition;
      tempPath = join(targetDir, `.${this.#randomId()}.thumbnail.jpg.tmp`);
      guardedPreviewSessions.add(captureSession);
      captureSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      captureSession.setPermissionCheckHandler(() => false);
      captureSession.webRequest.onBeforeRequest(ALL_URLS, (details, callback) => {
        callback({
          cancel: !isAllowedPreviewRequest(
            targetOrigin,
            details.url,
            details.resourceType,
            allowHosts,
          ),
        });
      });
      requestGuardInstalled = true;
      captureSession.webRequest.onHeadersReceived(ALL_URLS, (details, callback) => {
        const mainFrame = details.resourceType === "mainFrame";
        if (mainFrame) mainFrameStatus = details.statusCode;
        // Permit same-origin redirects to reach the request/navigation guards,
        // but do not execute an origin-controlled HTTP error document.
        callback({ cancel: mainFrame && details.statusCode >= 400 });
      });
      responseGuardInstalled = true;
      captureSession.on("will-download", denyDownload);
      downloadGuardInstalled = true;
      signal.addEventListener("abort", abort, { once: true });
      abortGuardInstalled = true;
      // Item 378 — WebRTC's ICE never passes webRequest, so the gate above cannot see a page's peer
      // connection. Its unproxied UDP is refused per contents (below); its TCP (a TURN relay over TCP
      // or TLS, ICE-TCP) takes this session's proxy, a dead one. `<-loopback>` takes away Chromium's
      // implicit loopback bypass, so this Mac's loopback ports are no relay either. Per capture, never
      // process-wide: the desk's own browser pages share a profile where a person may hold a call.
      // Both halves are measured on a real Electron by desk-gates row 38 (`smoke:capture-webrtc`).
      // Item 415 — a bypass entry with no port matches EVERY port of its host, so the origin bypasses
      // at its own port alone (any other port of this desktop's own name takes the dead proxy too),
      // and each allowHost at 443, the one port the gate admits it on (https, `url.port === ""`).
      const targetUrl = new URL(params.url);
      await captureSession.setProxy({
        mode: "fixed_servers",
        proxyRules: PREVIEW_DEAD_PROXY,
        proxyBypassRules: [
          `${targetUrl.hostname}:${targetUrl.port || "443"}`,
          ...allowHosts.map((host) => `${host}:443`),
          "<-loopback>",
        ].join(","),
      });
      throwIfAborted(signal);

      window = this.#native.createWindow({
        width: ARTIFACT_PREVIEW_LIMITS.WIDTH,
        height: ARTIFACT_PREVIEW_LIMITS.HEIGHT,
        partition,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          webviewTag: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      const guardTopLevel = (event: { preventDefault(): void }, url: string) => {
        if (!isAllowedTopLevelNavigation(targetOrigin, url)) event.preventDefault();
      };
      window.webContents.on("will-navigate", guardTopLevel);
      window.webContents.on("will-redirect", guardTopLevel);

      await abortable(window.loadURL(params.url), signal);
      throwIfAborted(signal);
      if (mainFrameStatus === null || !isCapturableResponseStatus(mainFrameStatus)) {
        throw new ArtifactPreviewCaptureError(
          "PRECONDITION_FAILED",
          "artifact did not return a capturable page",
        );
      }
      const rawImage = await abortable(
        window.webContents.capturePage({
          x: 0,
          y: 0,
          width: ARTIFACT_PREVIEW_LIMITS.WIDTH,
          height: ARTIFACT_PREVIEW_LIMITS.HEIGHT,
        }),
        signal,
      );
      const normalized = rawImage.resize({
        width: ARTIFACT_PREVIEW_LIMITS.WIDTH,
        height: ARTIFACT_PREVIEW_LIMITS.HEIGHT,
        quality: "best",
      });
      const jpeg = encodeBoundedJpeg(normalized);
      verifyJpeg(this.#native.decodeImage(jpeg), jpeg);
      const title = sanitizePreviewTitle(window.webContents.getTitle());
      // MA-3c (MA-D10 (b)): the digest names the bytes this capture commits, taken before the
      // replace and never by re-reading the destination, which a later writer may already own.
      const digest = createHash("sha256").update(jpeg).digest("hex");
      await atomicReplace(tempPath, targetPath, jpeg, signal);
      return ShellWebContentsCaptureArtifactPreviewResult.parse({
        captured: true,
        ...(title !== undefined ? { title } : {}),
        digest,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new ArtifactPreviewCaptureError("TIMEOUT", "preview capture was cancelled", true);
      }
      if (error instanceof ArtifactPreviewCaptureError) throw error;
      if (mainFrameStatus !== null && !isCapturableResponseStatus(mainFrameStatus)) {
        throw new ArtifactPreviewCaptureError(
          "PRECONDITION_FAILED",
          "artifact did not return a capturable page",
        );
      }
      throw new ArtifactPreviewCaptureError("INTERNAL", "preview capture failed", true);
    } finally {
      if (abortGuardInstalled) signal.removeEventListener("abort", abort);
      try {
        if (window !== null && !window.isDestroyed()) window.destroy();
      } catch {
        // The operation has already settled; teardown is best-effort.
      }
      // Item 519: a gate this capture could not remove leaves its session in a state no clear call
      // vouches for, so that session is never reused.
      let teardownClean = true;
      if (captureSession !== null) {
        const sessionForCleanup = captureSession;
        if (requestGuardInstalled) {
          try {
            sessionForCleanup.webRequest.onBeforeRequest(ALL_URLS, null);
          } catch {
            teardownClean = false;
          }
        }
        if (responseGuardInstalled) {
          try {
            sessionForCleanup.webRequest.onHeadersReceived(ALL_URLS, null);
          } catch {
            teardownClean = false;
          }
        }
        if (downloadGuardInstalled) {
          try {
            sessionForCleanup.off("will-download", denyDownload);
          } catch {
            teardownClean = false;
          }
        }
        guardedPreviewSessions.delete(sessionForCleanup);
      }
      // The window is already destroyed. Begin clearing the session, but never let a wedged
      // Chromium clear keep the provider busy beyond the broker's whole-operation deadline: the
      // artifact's next capture waits for it instead (item 519).
      if (held !== null) this.#release(held, teardownClean);
      if (tempPath !== null) await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  /** Item 519 (2026-11-18): the session this capture of `artifactId` uses. The artifact's kept
   * session is claimed at once, so no second capture is ever handed it; it is reused only when its
   * last clearing settled clean within the bound and no worker of it still runs. Otherwise it is
   * retired for good and a fresh one is kept in its place. A capture that finds the kept session in
   * use takes a session of its own, which nobody keeps. */
  async #lease(artifactId: string, signal: AbortSignal): Promise<HeldPreviewSession> {
    const kept = this.#sessions.get(artifactId);
    if (kept?.inUse === true) {
      this.#onSessionRetired("in-use", 0);
      return this.#fresh(false);
    }
    if (kept !== undefined) {
      kept.inUse = true;
      const outcome = await settledWithin(kept.clearing, this.#clearBoundMs);
      const reason: PreviewSessionRetiredReason | null =
        outcome === "rejected"
          ? "clear-rejected"
          : outcome === "overran"
            ? "clear-overran"
            : hasRunningWorker(kept.session)
              ? "worker-running"
              : null;
      if (reason === null) {
        kept.clearing = null;
        if (signal.aborted) kept.inUse = false;
        throwIfAborted(signal);
        return kept;
      }
      this.#sessions.delete(artifactId);
      this.#onSessionRetired(reason, kept.captures);
      throwIfAborted(signal);
    }
    const fresh = this.#fresh(true);
    this.#sessions.set(artifactId, fresh);
    return fresh;
  }

  #fresh(kept: boolean): HeldPreviewSession {
    const partition = `${PREVIEW_PARTITION_PREFIX}${this.#randomId()}`;
    return {
      partition,
      session: this.#native.createSession(partition),
      kept,
      inUse: true,
      clearing: null,
      captures: 0,
    };
  }

  /** Item 519: every clear starts now; the artifact's next capture awaits them. */
  #release(held: HeldPreviewSession, teardownClean: boolean): void {
    held.captures += 1;
    const clearing = clearPreviewSession(held.session);
    held.clearing = teardownClean ? clearing : clearing.then(() => "rejected" as const);
    if (held.kept) held.inUse = false;
  }
}

/** Item 519 (2026-11-18): every clear a capture session is given between captures, all started at
 * once; "clean" only when every one resolved. Electron 43's own words for each are in the item's
 * design: storage of every kind, the HTTP, code and shared-dictionary caches, the HTTP
 * authentication and host resolver caches, and every open connection. */
function clearPreviewSession(session: PreviewSession): Promise<"clean" | "rejected"> {
  const clears: Array<() => Promise<void>> = [
    () => session.clearData(),
    () => session.clearStorageData(),
    () => session.clearCache(),
    () => session.clearAuthCache(),
    () => session.clearHostResolverCache(),
    () => session.clearCodeCaches({}),
    () => session.clearSharedDictionaryCache(),
    () => session.closeAllConnections(),
  ];
  return Promise.allSettled(
    clears.map((clear) => {
      try {
        return clear();
      } catch (error) {
        return Promise.reject(error);
      }
    }),
  ).then((results) =>
    results.every((result) => result.status === "fulfilled") ? "clean" : "rejected",
  );
}

/** Item 519: a clearing's outcome, or "overran" once `ms` has passed without one. */
async function settledWithin(
  clearing: Promise<"clean" | "rejected"> | null,
  ms: number,
): Promise<"clean" | "rejected" | "overran"> {
  if (clearing === null) return "clean";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overran = new Promise<"overran">((resolve) => {
    timer = setTimeout(() => resolve("overran"), ms);
  });
  try {
    return await Promise.race([clearing, overran]);
  } finally {
    clearTimeout(timer);
  }
}

/** Item 519: a worker of the session still running between captures (or one that cannot be read). */
function hasRunningWorker(session: PreviewSession): boolean {
  try {
    return Object.keys(session.serviceWorkers.getAllRunning()).length > 0;
  } catch {
    return true;
  }
}

export function isArtifactPreviewSession(value: object): boolean {
  return guardedPreviewSessions.has(value);
}

export function isAllowedTopLevelNavigation(targetOrigin: string, candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.origin === targetOrigin;
  } catch {
    return false;
  }
}

/** The capture's request guard. HTTPS to the target's exact origin, and `data:` / same-origin `blob:` for a
 * subresource. MA-3c (MA-D10 (b)): a made app's page also loads from the hosts its served shell names, so
 * `allowHosts` (the capture params' `MadeAppReach`, bare canonical hosts) admits an HTTPS SUBRESOURCE whose host is
 * exactly one of them, on the default port, with no credentials. Never a document: Electron's webRequest names three
 * kinds that can hold one (`mainFrame`, `subFrame`, and `object` for an `<object>`/`<embed>`, whose data may be
 * HTML), and all three stay on the target's origin, as top-level navigation does. Absent or empty: the live
 * artifact's guard, unchanged. */
export function isAllowedPreviewRequest(
  targetOrigin: string,
  candidate: string,
  resourceType?: string,
  allowHosts: readonly string[] = [],
): boolean {
  const topLevel = resourceType === "mainFrame";
  try {
    const url = new URL(candidate);
    if (url.protocol === "data:") return !topLevel;
    if (url.protocol === "blob:") return !topLevel && url.origin === targetOrigin;
    if (url.protocol !== "https:") return false;
    if (url.origin === targetOrigin) return true;
    if (topLevel || resourceType === "subFrame" || resourceType === "object") return false;
    // The parser has already folded the host's case, spelled an IDN as punycode and dropped
    // `:443`, so exact membership is the whole host rule; a port or credentials are refused.
    return (
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      allowHosts.includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isCapturableResponseStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

export function sanitizePreviewTitle(raw: string): string | undefined {
  let printable = "";
  for (const character of raw) {
    const codePoint = character.codePointAt(0) ?? 0;
    printable += codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }
  const clean = printable.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return undefined;
  let title = "";
  for (const character of clean) {
    if (title.length + character.length > 128) break;
    title += character;
  }
  return title.length === 0 ? undefined : title;
}

function encodeBoundedJpeg(image: PreviewImage): Buffer {
  const size = image.getSize();
  if (
    image.isEmpty() ||
    size.width !== ARTIFACT_PREVIEW_LIMITS.WIDTH ||
    size.height !== ARTIFACT_PREVIEW_LIMITS.HEIGHT
  ) {
    throw new ArtifactPreviewCaptureError(
      "INTERNAL",
      "preview image did not match the fixed viewport",
    );
  }
  for (const quality of ARTIFACT_PREVIEW_LIMITS.JPEG_QUALITIES) {
    const jpeg = image.toJPEG(quality);
    if (jpeg.length > 0 && jpeg.length <= ARTIFACT_PREVIEW_LIMITS.JPEG_BYTES) return jpeg;
  }
  throw new ArtifactPreviewCaptureError("RESOURCE_EXHAUSTED", "preview JPEG is too large");
}

function verifyJpeg(image: PreviewImage, bytes: Buffer): void {
  const size = image.getSize();
  if (
    !hasJpegEnvelope(bytes) ||
    bytes.length > ARTIFACT_PREVIEW_LIMITS.JPEG_BYTES ||
    image.isEmpty() ||
    size.width !== ARTIFACT_PREVIEW_LIMITS.WIDTH ||
    size.height !== ARTIFACT_PREVIEW_LIMITS.HEIGHT
  ) {
    throw new ArtifactPreviewCaptureError("INTERNAL", "preview JPEG verification failed");
  }
}

export function hasJpegEnvelope(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

async function ensureOwnedPreviewDirectory(previewRoot: string, targetDir: string): Promise<void> {
  await mkdir(previewRoot, { recursive: true, mode: 0o700 });
  const root = await lstat(previewRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new ArtifactPreviewCaptureError(
      "PRECONDITION_FAILED",
      "preview destination is not an owned directory",
    );
  }
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const target = await lstat(targetDir);
  if (!target.isDirectory() || target.isSymbolicLink()) {
    throw new ArtifactPreviewCaptureError(
      "PRECONDITION_FAILED",
      "preview destination is not an owned directory",
    );
  }
}

async function atomicReplace(
  tempPath: string,
  targetPath: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  throwIfAborted(signal);
  // WIN-10: the same win32 sharing-violation class as every other commit point —
  // a scanner holding the previous thumbnail makes MoveFileEx refuse. A lost
  // preview is a blemish rather than lost evidence, but the cure is identical.
  await durableRename(tempPath, targetPath);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ArtifactPreviewCaptureError("TIMEOUT", "preview capture was cancelled", true);
  }
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new ArtifactPreviewCaptureError("TIMEOUT", "preview capture was cancelled", true));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
