import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactPreviewCapture,
  type ArtifactPreviewCaptureNative,
  hasJpegEnvelope,
  isAllowedPreviewRequest,
  isAllowedTopLevelNavigation,
  isArtifactPreviewSession,
  isCapturableResponseStatus,
  sanitizePreviewTitle,
} from "../src/main/artifact-preview-capture";

const ARTIFACT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const URL = "https://device.tail1234.ts.net:12000/";
const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0).reverse()) rmSync(path, { recursive: true, force: true });
});

function dataDir(): string {
  const path = mkdtempSync(join(tmpdir(), "vf-preview-capture-"));
  cleanup.push(path);
  return path;
}

describe("ArtifactPreviewCapture", () => {
  it("captures through one guarded ephemeral session and atomically commits a bounded JPEG", async () => {
    const root = dataDir();
    const targetDir = join(root, "artifacts", "previews", ARTIFACT_ID);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "thumbnail.jpg"), "old-preview");
    const qualities: number[] = [];
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xd9]);
    const image = {
      getSize: () => ({ width: 640, height: 400 }),
      isEmpty: () => false,
      resize: () => image,
      toJPEG: (quality: number) => {
        qualities.push(quality);
        return quality === 82 ? Buffer.alloc(256 * 1024 + 1) : jpeg;
      },
    };
    let beforeRequest:
      | ((
          details: { url: string; resourceType?: string },
          callback: (decision: { cancel: boolean }) => void,
        ) => void)
      | null = null;
    let headersReceived:
      | ((
          details: { url: string; resourceType?: string; statusCode: number },
          callback: (decision: { cancel: boolean }) => void,
        ) => void)
      | null = null;
    let permissionRequest = (
      _contents: unknown,
      _permission: string,
      _callback: (granted: boolean) => void,
    ) => undefined;
    let permissionCheck = (_contents: unknown, _permission: string) => true;
    let download: ((event: { preventDefault(): void }) => void) | null = null;
    let responseStatus = 200;
    let crossOriginBlocked = false;
    const captureSession = {
      webRequest: {
        onBeforeRequest: (_filter: { urls: readonly string[] }, listener: typeof beforeRequest) => {
          beforeRequest = listener;
        },
        onHeadersReceived: (
          _filter: { urls: readonly string[] },
          listener: typeof headersReceived,
        ) => {
          headersReceived = listener;
        },
      },
      setPermissionRequestHandler: (handler: typeof permissionRequest) => {
        permissionRequest = handler;
      },
      setPermissionCheckHandler: (handler: typeof permissionCheck) => {
        permissionCheck = handler;
      },
      on: (_event: "will-download", listener: typeof download) => {
        download = listener;
      },
      off: () => {
        download = null;
      },
      clearStorageData: vi.fn(async () => undefined),
      clearCache: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined),
    };
    const navigation = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    const window = {
      destroyed: false,
      webContents: {
        capturePage: vi.fn(async () => image),
        getTitle: () => "  Captured\nworkbench  ",
        on: (event: "will-navigate" | "will-redirect", listener: never) => {
          navigation.set(event, listener);
        },
        setWindowOpenHandler: vi.fn(),
      },
      destroy() {
        this.destroyed = true;
      },
      isDestroyed() {
        return this.destroyed;
      },
      loadURL: vi.fn(async (url: string) => {
        beforeRequest?.(
          { url: "https://evil.example/tracker.js", resourceType: "script" },
          (decision) => {
            crossOriginBlocked = decision.cancel;
          },
        );
        headersReceived?.(
          { url, resourceType: "mainFrame", statusCode: responseStatus },
          () => undefined,
        );
      }),
    };
    const partitions: string[] = [];
    let windowOptions: Parameters<ArtifactPreviewCaptureNative["createWindow"]>[0] | null = null;
    const native: ArtifactPreviewCaptureNative = {
      createSession: (partition) => {
        partitions.push(partition);
        return captureSession;
      },
      createWindow: (options) => {
        windowOptions = options;
        expect(isArtifactPreviewSession(captureSession)).toBe(true);
        return window;
      },
      decodeImage: () => image,
    };
    const capture = new ArtifactPreviewCapture({
      dataDir: root,
      native,
      randomId: (() => {
        let value = 0;
        return () => `random-${++value}`;
      })(),
    });

    await expect(
      capture.capture({ artifactId: ARTIFACT_ID, url: URL }, new AbortController().signal),
    ).resolves.toEqual({ captured: true, title: "Captured workbench" });

    expect(partitions).toEqual(["vibefield-artifact-preview:random-1"]);
    expect(windowOptions).toEqual({
      width: 640,
      height: 400,
      partition: "vibefield-artifact-preview:random-1",
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
    expect(qualities).toEqual([82, 70]);
    expect(readFileSync(join(root, "artifacts", "previews", ARTIFACT_ID, "thumbnail.jpg"))).toEqual(
      jpeg,
    );
    expect(readdirSync(join(root, "artifacts", "previews", ARTIFACT_ID))).toEqual([
      "thumbnail.jpg",
    ]);
    expect(window.destroyed).toBe(true);
    expect(isArtifactPreviewSession(captureSession)).toBe(false);
    expect(captureSession.clearStorageData).toHaveBeenCalledOnce();
    expect(captureSession.clearCache).toHaveBeenCalledOnce();
    expect(captureSession.closeAllConnections).toHaveBeenCalledOnce();

    let granted = true;
    permissionRequest({}, "media", (value: boolean) => {
      granted = value;
    });
    expect(granted).toBe(false);
    expect(permissionCheck({}, "geolocation")).toBe(false);
    expect(crossOriginBlocked).toBe(true);
    expect(beforeRequest).toBeNull();
    expect(headersReceived).toBeNull();
    expect(download).toBeNull();
    const redirect = { preventDefault: vi.fn() };
    navigation.get("will-redirect")?.(redirect, "https://evil.example/");
    expect(redirect.preventDefault).toHaveBeenCalledOnce();

    responseStatus = 403;
    window.destroyed = false;
    await expect(
      capture.capture({ artifactId: ARTIFACT_ID, url: URL }, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(targetDir, "thumbnail.jpg"))).toEqual(jpeg);
  });

  // Creating a symlink on Windows needs SeCreateSymbolicLinkPrivilege — admin,
  // or Developer Mode — so `symlinkSync` throws EPERM for an ordinary user and
  // the FIXTURE cannot be built at all. The guard itself is not mac-only: the
  // `lstat().isSymbolicLink()` checks in artifact-preview-capture.ts run on
  // every platform, and Windows directory junctions are a live version of the
  // same EL7 attack. What is withheld here is the ability to plant one, not the
  // property; the rest of the row's coverage stays on both platforms.
  it.skipIf(process.platform === "win32")(
    "rejects a symlinked artifact destination before creating a WebContents",
    async () => {
      const root = dataDir();
      const outside = dataDir();
      const previewRoot = join(root, "artifacts", "previews");
      mkdirSync(previewRoot, { recursive: true });
      symlinkSync(outside, join(previewRoot, ARTIFACT_ID), "dir");
      const createSession = vi.fn();
      const capture = new ArtifactPreviewCapture({
        dataDir: root,
        native: { createSession, createWindow: vi.fn(), decodeImage: vi.fn() } as never,
      });
      await expect(
        capture.capture({ artifactId: ARTIFACT_ID, url: URL }, new AbortController().signal),
      ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it("drops its privileged-session marker when partial policy setup fails", async () => {
    const captureSession = {
      webRequest: { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
      setPermissionRequestHandler: vi.fn(() => {
        throw new Error("policy setup failed");
      }),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      clearStorageData: vi.fn(async () => undefined),
      clearCache: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined),
    };
    const createWindow = vi.fn();
    const capture = new ArtifactPreviewCapture({
      dataDir: dataDir(),
      native: {
        createSession: () => captureSession,
        createWindow,
        decodeImage: vi.fn(),
      } as never,
    });

    await expect(
      capture.capture({ artifactId: ARTIFACT_ID, url: URL }, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "INTERNAL" });
    expect(createWindow).not.toHaveBeenCalled();
    expect(isArtifactPreviewSession(captureSession)).toBe(false);
    await vi.waitFor(() => expect(captureSession.clearStorageData).toHaveBeenCalledOnce());
  });

  // Same win32 privilege wall as the row above — the link cannot be planted.
  it.skipIf(process.platform === "win32")(
    "rejects a symlinked preview root without creating directories outside it",
    async () => {
      const root = dataDir();
      const outside = dataDir();
      mkdirSync(join(root, "artifacts"), { recursive: true });
      symlinkSync(outside, join(root, "artifacts", "previews"), "dir");
      const createSession = vi.fn();
      const capture = new ArtifactPreviewCapture({
        dataDir: root,
        native: { createSession, createWindow: vi.fn(), decodeImage: vi.fn() } as never,
      });

      await expect(
        capture.capture({ artifactId: ARTIFACT_ID, url: URL }, new AbortController().signal),
      ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
      expect(createSession).not.toHaveBeenCalled();
      expect(existsSync(join(outside, ARTIFACT_ID))).toBe(false);
    },
  );
});

describe("artifact preview request policy", () => {
  const origin = "https://device.tail1234.ts.net:12000";

  it("allows only the exact HTTPS origin plus document-generated data/blob subresources", () => {
    expect(isAllowedPreviewRequest(origin, `${origin}/app.js`, "script")).toBe(true);
    expect(isAllowedPreviewRequest(origin, "data:image/png;base64,AA==", "image")).toBe(true);
    expect(isAllowedPreviewRequest(origin, `blob:${origin}/uuid`, "image")).toBe(true);
    expect(isAllowedPreviewRequest(origin, "https://evil.example/app.js", "script")).toBe(false);
    expect(
      isAllowedPreviewRequest(origin, "http://device.tail1234.ts.net:12000/app.js", "script"),
    ).toBe(false);
    expect(isAllowedPreviewRequest(origin, "data:text/html,no", "mainFrame")).toBe(false);
  });

  it("confines top-level navigation and sanitizes bounded titles", () => {
    expect(isAllowedTopLevelNavigation(origin, `${origin}/next`)).toBe(true);
    expect(isAllowedTopLevelNavigation(origin, "https://evil.example/")).toBe(false);
    expect(sanitizePreviewTitle("  Hello\n\tworld\u0000 ")).toBe("Hello world");
    expect(sanitizePreviewTitle("x".repeat(129))).toHaveLength(128);
    expect(sanitizePreviewTitle(" \n\t ")).toBeUndefined();
  });

  it("recognizes only a JPEG SOI/EOI envelope", () => {
    expect(hasJpegEnvelope(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xd9]))).toBe(true);
    expect(hasJpegEnvelope(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(hasJpegEnvelope(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
  });

  it("accepts only successful final document response statuses", () => {
    expect(isCapturableResponseStatus(200)).toBe(true);
    expect(isCapturableResponseStatus(204)).toBe(true);
    expect(isCapturableResponseStatus(302)).toBe(false);
    expect(isCapturableResponseStatus(403)).toBe(false);
  });
});
