import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ARTIFACT_PREVIEW_LIMITS,
  type ShellWebContentsCaptureArtifactPreviewResult as CaptureResult,
  type ShellWebContentsCaptureArtifactPreviewParams,
  ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";

const PREVIEW_PARTITION_PREFIX = "vibefield-artifact-preview:";
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
}

interface PreviewWebContents {
  capturePage(rect: { x: number; y: number; width: number; height: number }): Promise<PreviewImage>;
  getTitle(): string;
  on(
    event: "will-navigate" | "will-redirect",
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): void;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
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

export interface ArtifactPreviewCaptureOptions {
  dataDir: string;
  native: ArtifactPreviewCaptureNative;
  randomId?: () => string;
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

/** AH-4's one-shot browser. The shell provider serializes callers; this class
 * owns one ephemeral session/window, the network gate, JPEG normalization, and
 * the atomic host-private write. */
export class ArtifactPreviewCapture {
  readonly #previewRoot: string;
  readonly #native: ArtifactPreviewCaptureNative;
  readonly #randomId: () => string;

  constructor(options: ArtifactPreviewCaptureOptions) {
    this.#previewRoot = join(options.dataDir, "artifacts", "previews");
    this.#native = options.native;
    this.#randomId = options.randomId ?? (() => randomBytes(18).toString("base64url"));
  }

  async capture(
    params: ShellWebContentsCaptureArtifactPreviewParams,
    signal: AbortSignal,
  ): Promise<CaptureResult> {
    throwIfAborted(signal);
    const partition = `${PREVIEW_PARTITION_PREFIX}${this.#randomId()}`;
    const targetOrigin = new URL(params.url).origin;
    const targetDir = join(this.#previewRoot, params.artifactId);
    const targetPath = join(targetDir, "thumbnail.jpg");
    const tempPath = join(targetDir, `.${this.#randomId()}.thumbnail.jpg.tmp`);
    const denyDownload = (event: { preventDefault(): void }) => event.preventDefault();
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
      captureSession = this.#native.createSession(partition);
      guardedPreviewSessions.add(captureSession);
      captureSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      captureSession.setPermissionCheckHandler(() => false);
      captureSession.webRequest.onBeforeRequest(ALL_URLS, (details, callback) => {
        callback({
          cancel: !isAllowedPreviewRequest(targetOrigin, details.url, details.resourceType),
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
      await atomicReplace(tempPath, targetPath, jpeg, signal);
      return ShellWebContentsCaptureArtifactPreviewResult.parse({
        captured: true,
        ...(title !== undefined ? { title } : {}),
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
      if (captureSession !== null) {
        const sessionForCleanup = captureSession;
        if (requestGuardInstalled) {
          try {
            sessionForCleanup.webRequest.onBeforeRequest(ALL_URLS, null);
          } catch {
            // The unique session is never reused.
          }
        }
        if (responseGuardInstalled) {
          try {
            sessionForCleanup.webRequest.onHeadersReceived(ALL_URLS, null);
          } catch {
            // The unique session is never reused.
          }
        }
        if (downloadGuardInstalled) {
          try {
            sessionForCleanup.off("will-download", denyDownload);
          } catch {
            // The unique session is never reused.
          }
        }
        guardedPreviewSessions.delete(sessionForCleanup);
        // The session is unique and the window is already destroyed. Begin
        // privacy cleanup, but never let a wedged Chromium cleanup promise keep
        // the provider busy beyond the broker's whole-operation deadline.
        void Promise.allSettled([
          Promise.resolve().then(() => sessionForCleanup.clearStorageData()),
          Promise.resolve().then(() => sessionForCleanup.clearCache()),
          Promise.resolve().then(() => sessionForCleanup.closeAllConnections()),
        ]);
      }
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
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

export function isAllowedPreviewRequest(
  targetOrigin: string,
  candidate: string,
  resourceType?: string,
): boolean {
  const topLevel = resourceType === "mainFrame";
  try {
    const url = new URL(candidate);
    if (url.protocol === "data:") return !topLevel;
    if (url.protocol === "blob:") return !topLevel && url.origin === targetOrigin;
    return url.protocol === "https:" && url.origin === targetOrigin;
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
  await rename(tempPath, targetPath);
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
