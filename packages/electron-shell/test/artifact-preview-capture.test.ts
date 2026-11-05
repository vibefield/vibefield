import { createHash } from "node:crypto";
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
import { durableRename } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

// MA-3c: the capture's commit point, observed. The real rename runs unless a row says otherwise,
// so every older row here sees the module exactly as before.
vi.mock("@vibefield/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibefield/logging")>();
  return { ...actual, durableRename: vi.fn(actual.durableRename) };
});

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

/** A directory link an ordinary win32 account can actually plant. `symlinkSync`
 * with type "dir" needs SeCreateSymbolicLinkPrivilege there; a junction needs
 * none, and `lstat` reports it as a symbolic link — so it trips the very same
 * guard, which is what makes it the live win32 form of this EL7 attack. */
const DIR_LINK = process.platform === "win32" ? "junction" : "dir";

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

    // MA-3c: the answer now also carries `digest`, so this row matches its members and the
    // exact shape is pinned by "answers exactly {captured, title, digest}" below.
    await expect(
      capture.capture({ artifactId: ARTIFACT_ID, url: URL }, new AbortController().signal),
    ).resolves.toMatchObject({ captured: true, title: "Captured workbench" });

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

  // The old skip named SeCreateSymbolicLinkPrivilege, which gates FILE
  // symlinks. Both links in this file point at a DIRECTORY, and a directory
  // junction needs no privilege at all — `lstat` reports it as a symbolic link,
  // so it trips the very `lstat().isSymbolicLink()` guard under test. The
  // comment even said junctions were "a live version of the same EL7 attack"
  // and then declined to plant one; the property was always testable here, and
  // the skip was withholding coverage rather than documenting a limit.
  it("rejects a symlinked artifact destination before creating a WebContents", async () => {
    const root = dataDir();
    const outside = dataDir();
    const previewRoot = join(root, "artifacts", "previews");
    mkdirSync(previewRoot, { recursive: true });
    symlinkSync(outside, join(previewRoot, ARTIFACT_ID), DIR_LINK);
    const createSession = vi.fn();
    const capture = new ArtifactPreviewCapture({
      dataDir: root,
      native: { createSession, createWindow: vi.fn(), decodeImage: vi.fn() } as never,
    });
    await expect(
      capture.capture({ artifactId: ARTIFACT_ID, url: URL }, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(createSession).not.toHaveBeenCalled();
  });

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

  // Same directory-junction fixture as the row above, one level up the tree.
  it("rejects a symlinked preview root without creating directories outside it", async () => {
    const root = dataDir();
    const outside = dataDir();
    mkdirSync(join(root, "artifacts"), { recursive: true });
    symlinkSync(outside, join(root, "artifacts", "previews"), DIR_LINK);
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
  });
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

// ---------------------------------------------------------------------------------------------
// MA-3c (MA-D10 (b); the build plan's §3 "3c", L11 as ruled: no show event). A made app's capture
// photographs the page as it runs: the guard admits the hosts its served shell names
// (`allowHosts`, MadeAppReach) beside its own origin, and the answer carries the JPEG's sha256 as
// `digest`, taken from the bytes before the atomic replace. Rows titled "PIN:" pass on the red
// skeleton by design (refusals the old guard already makes, and the commit path); every other row
// here fails on it by assertion.
// ---------------------------------------------------------------------------------------------

const MADE_ORIGIN = "https://device.tail1234.ts.net:14211";
const MADE_URL = `${MADE_ORIGIN}/`;
const ALLOW_HOSTS: string[] = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const MADE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x4d, 0x41, 0x33, 0x63, 0xff, 0xd9]);

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type RigBeforeRequest = (
  details: { url: string; resourceType?: string },
  callback: (decision: { cancel: boolean }) => void,
) => void;
type RigHeadersReceived = (
  details: { url: string; resourceType?: string; statusCode: number },
  callback: (decision: { cancel: boolean }) => void,
) => void;
type RigNavigationGuard = (event: { preventDefault(): void }, url: string) => void;

interface RigRequest {
  url: string;
  resourceType: string;
}

/** One fake Electron for a capture: `loadURL` puts each named request through the installed
 * request guard (recording its verdict), then answers the main frame 200. */
function captureRig(
  options: { requests?: readonly RigRequest[]; toJPEG?: (quality: number) => Buffer } = {},
) {
  const image = {
    getSize: () => ({ width: 640, height: 400 }),
    isEmpty: () => false,
    resize: () => image,
    toJPEG: options.toJPEG ?? (() => MADE_JPEG),
  };
  let beforeRequest: RigBeforeRequest | null = null;
  let headersReceived: RigHeadersReceived | null = null;
  const verdicts: Array<{ url: string; resourceType: string; admitted: boolean }> = [];
  const navigation = new Map<string, RigNavigationGuard>();
  const captureSession = {
    webRequest: {
      onBeforeRequest: (
        _filter: { urls: readonly string[] },
        listener: RigBeforeRequest | null,
      ) => {
        beforeRequest = listener;
      },
      onHeadersReceived: (
        _filter: { urls: readonly string[] },
        listener: RigHeadersReceived | null,
      ) => {
        headersReceived = listener;
      },
    },
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    closeAllConnections: vi.fn(async () => undefined),
  };
  const window = {
    destroyed: false,
    webContents: {
      capturePage: vi.fn(async () => image),
      getTitle: () => "Made app",
      on: (event: "will-navigate" | "will-redirect", listener: RigNavigationGuard) => {
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
      for (const request of options.requests ?? []) {
        beforeRequest?.(request, (decision) => {
          verdicts.push({ ...request, admitted: !decision.cancel });
        });
      }
      headersReceived?.({ url, resourceType: "mainFrame", statusCode: 200 }, () => undefined);
    }),
  };
  const native: ArtifactPreviewCaptureNative = {
    createSession: () => captureSession,
    createWindow: () => window,
    decodeImage: () => image,
  };
  return { native, navigation, verdicts, window };
}

/** The requests a made app's page makes as it runs, each with the verdict the guard owes it under
 * ALLOW_HOSTS. */
const MADE_PAGE_REQUESTS: ReadonlyArray<RigRequest & { admitted: boolean }> = [
  { url: `${MADE_ORIGIN}/index.css`, resourceType: "stylesheet", admitted: true },
  {
    url: "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
    resourceType: "script",
    admitted: true,
  },
  {
    url: "https://fonts.googleapis.com/css2?family=Inter&display=swap",
    resourceType: "stylesheet",
    admitted: true,
  },
  {
    url: "https://fonts.gstatic.com/s/inter/v13/inter.woff2",
    resourceType: "font",
    admitted: true,
  },
  {
    url: "http://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
    resourceType: "script",
    admitted: false,
  },
  { url: "https://cdn.jsdelivr.net.evil.example/x.js", resourceType: "script", admitted: false },
  {
    url: "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
    resourceType: "script",
    admitted: false,
  },
  { url: "https://cdn.jsdelivr.net/npm/x/index.html", resourceType: "subFrame", admitted: false },
];

describe("MA-3c — a made app's capture admits its allowHosts", () => {
  it("a made capture's guard admits its allowHosts' https subresources beside its own origin, and nothing else", async () => {
    const rig = captureRig({
      requests: MADE_PAGE_REQUESTS.map(({ url, resourceType }) => ({ url, resourceType })),
    });
    const capture = new ArtifactPreviewCapture({ dataDir: dataDir(), native: rig.native });
    const result = await capture.capture(
      { artifactId: ARTIFACT_ID, url: MADE_URL, allowHosts: ALLOW_HOSTS },
      new AbortController().signal,
    );
    expect(result.captured, "the made capture completes").toBe(true);
    expect(rig.verdicts, "each request the made page made, with the guard's verdict").toEqual(
      MADE_PAGE_REQUESTS,
    );
  });

  it("PIN: a live capture (no allowHosts) still admits only its own origin", async () => {
    const rig = captureRig({
      requests: MADE_PAGE_REQUESTS.map(({ url, resourceType }) => ({ url, resourceType })),
    });
    const capture = new ArtifactPreviewCapture({ dataDir: dataDir(), native: rig.native });
    await capture.capture({ artifactId: ARTIFACT_ID, url: MADE_URL }, new AbortController().signal);
    expect(rig.verdicts, "each request, with the live guard's verdict").toEqual(
      MADE_PAGE_REQUESTS.map((request) => ({
        ...request,
        admitted: request.url.startsWith(`${MADE_ORIGIN}/`),
      })),
    );
  });

  it("PIN: a made capture's top level stays on the app's origin: a navigation or redirect to an allowHosts host is prevented", async () => {
    const rig = captureRig();
    const capture = new ArtifactPreviewCapture({ dataDir: dataDir(), native: rig.native });
    await capture.capture(
      { artifactId: ARTIFACT_ID, url: MADE_URL, allowHosts: ALLOW_HOSTS },
      new AbortController().signal,
    );
    const navigate = { preventDefault: vi.fn() };
    const redirect = { preventDefault: vi.fn() };
    const own = { preventDefault: vi.fn() };
    expect(rig.navigation.has("will-navigate"), "the navigation guard is installed").toBe(true);
    expect(rig.navigation.has("will-redirect"), "the redirect guard is installed").toBe(true);
    rig.navigation.get("will-navigate")?.(navigate, "https://cdn.jsdelivr.net/");
    rig.navigation.get("will-redirect")?.(redirect, "https://fonts.googleapis.com/");
    rig.navigation.get("will-navigate")?.(own, `${MADE_ORIGIN}/next`);
    expect(navigate.preventDefault, "a navigation to an allowHosts host").toHaveBeenCalledOnce();
    expect(redirect.preventDefault, "a redirect to an allowHosts host").toHaveBeenCalledOnce();
    expect(own.preventDefault, "a navigation within the app's origin").not.toHaveBeenCalled();
    expect(isAllowedTopLevelNavigation(MADE_ORIGIN, "https://cdn.jsdelivr.net/")).toBe(false);
  });
});

describe("MA-3c — the guard's allowHosts rule (isAllowedPreviewRequest)", () => {
  const verdicts = (rows: ReadonlyArray<readonly [string, string | undefined]>) =>
    rows.map(([url, resourceType]) => ({
      url,
      resourceType,
      admitted: isAllowedPreviewRequest(MADE_ORIGIN, url, resourceType, ALLOW_HOSTS),
    }));
  const all = (rows: ReadonlyArray<readonly [string, string | undefined]>, admitted: boolean) =>
    rows.map(([url, resourceType]) => ({ url, resourceType, admitted }));

  it("admits https to exactly an allowHosts host on its default port, for a subresource", () => {
    const rows = [
      ["https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js", "script"],
      ["https://fonts.googleapis.com/css2?family=Inter&display=swap", "stylesheet"],
      ["https://fonts.gstatic.com/s/inter/v13/inter.woff2", "font"],
      ["https://cdn.jsdelivr.net/npm/logo.png", "image"],
      ["https://cdn.jsdelivr.net/npm/data.json", "xhr"],
      // the default port spelled out is the default port (the URL parser drops it)
      ["https://cdn.jsdelivr.net:443/npm/x.js", "script"],
      // the URL parser folds a host's case
      ["https://CDN.JSDELIVR.NET/npm/y.js", "script"],
      // Electron may name no resource type; a request that is not a document is a subresource
      ["https://cdn.jsdelivr.net/npm/z.js", undefined],
    ] as const;
    expect(verdicts(rows), "each allowHosts subresource's verdict").toEqual(all(rows, true));
  });

  it("PIN: refuses every scheme but https to an allowHosts host", () => {
    const rows = [
      ["http://cdn.jsdelivr.net/npm/x.js", "script"],
      ["ws://cdn.jsdelivr.net/socket", "webSocket"],
      ["wss://cdn.jsdelivr.net/socket", "webSocket"],
      ["ftp://cdn.jsdelivr.net/x.js", "other"],
    ] as const;
    expect(verdicts(rows), "each non-https verdict").toEqual(all(rows, false));
  });

  it("PIN: refuses a lookalike of an allowHosts host — the host must be exactly one of them", () => {
    const rows = [
      ["https://evil.cdn.jsdelivr.net/x.js", "script"], // a subdomain
      ["https://jsdelivr.net/x.js", "script"], // the parent
      ["https://cdn.jsdelivr.net.evil.example/x.js", "script"], // a suffix
      ["https://xcdn.jsdelivr.net/x.js", "script"], // a prefix
      ["https://cdn-jsdelivr.net/x.js", "script"], // a sibling spelling
      ["https://cdn.jsdelivr.net./x.js", "script"], // the terminal dot
      ["https://cdn.jsdelivr.net@evil.example/x.js", "script"], // userinfo before the real host
      ["https://evil.example\\@cdn.jsdelivr.net/x.js", "script"], // a backslash is a slash
      ["https://cdn.jsdеlivr.net/x.js", "script"], // a Cyrillic homograph (punycode)
      ["https://cdn.jsdelivr.net:8443/x.js", "script"], // a port other than the default
      ["https://user:secret@cdn.jsdelivr.net/x.js", "script"], // credentials
      ["https://104.16.85.20/x.js", "script"], // an IP literal
    ] as const;
    expect(verdicts(rows), "each lookalike's verdict").toEqual(all(rows, false));
  });

  it("PIN: never admits a document from an allowHosts host: mainFrame and subFrame stay on the app's origin", () => {
    expect(
      verdicts([
        ["https://cdn.jsdelivr.net/", "mainFrame"],
        ["https://cdn.jsdelivr.net/npm/x/index.html", "subFrame"],
        [`${MADE_ORIGIN}/`, "mainFrame"],
        [`${MADE_ORIGIN}/frame.html`, "subFrame"],
      ]),
      "each document's verdict",
    ).toEqual([
      { url: "https://cdn.jsdelivr.net/", resourceType: "mainFrame", admitted: false },
      {
        url: "https://cdn.jsdelivr.net/npm/x/index.html",
        resourceType: "subFrame",
        admitted: false,
      },
      { url: `${MADE_ORIGIN}/`, resourceType: "mainFrame", admitted: true },
      { url: `${MADE_ORIGIN}/frame.html`, resourceType: "subFrame", admitted: true },
    ]);
  });

  it("PIN: allowHosts widens nothing else — the app's origin, data: and same-origin blob: as before; other tailnet names and foreign blobs refused", () => {
    expect(
      verdicts([
        [`${MADE_ORIGIN}/app.js`, "script"],
        ["data:image/png;base64,AA==", "image"],
        ["data:text/html,no", "mainFrame"],
        [`blob:${MADE_ORIGIN}/0b6d1f0e-uuid`, "image"],
        ["blob:https://cdn.jsdelivr.net/0b6d1f0e-uuid", "image"],
        ["https://other.tail1234.ts.net:14211/app.js", "script"],
        ["https://device.tail1234.ts.net:14212/app.js", "script"],
      ]),
      "each verdict with allowHosts present",
    ).toEqual([
      { url: `${MADE_ORIGIN}/app.js`, resourceType: "script", admitted: true },
      { url: "data:image/png;base64,AA==", resourceType: "image", admitted: true },
      { url: "data:text/html,no", resourceType: "mainFrame", admitted: false },
      { url: `blob:${MADE_ORIGIN}/0b6d1f0e-uuid`, resourceType: "image", admitted: true },
      {
        url: "blob:https://cdn.jsdelivr.net/0b6d1f0e-uuid",
        resourceType: "image",
        admitted: false,
      },
      {
        url: "https://other.tail1234.ts.net:14211/app.js",
        resourceType: "script",
        admitted: false,
      },
      {
        url: "https://device.tail1234.ts.net:14212/app.js",
        resourceType: "script",
        admitted: false,
      },
    ]);
  });

  it("PIN: an empty or absent allowHosts is the live artifact's guard", () => {
    const cdn = "https://cdn.jsdelivr.net/npm/x.js";
    expect(isAllowedPreviewRequest(MADE_ORIGIN, cdn, "script", []), "empty allowHosts").toBe(false);
    expect(isAllowedPreviewRequest(MADE_ORIGIN, cdn, "script"), "absent allowHosts").toBe(false);
    expect(isAllowedPreviewRequest(MADE_ORIGIN, `${MADE_ORIGIN}/x.js`, "script", [])).toBe(true);
  });
});

describe("MA-3c — the JPEG's digest", () => {
  it("answers exactly {captured, title, digest}, the digest the sha256 of the JPEG it committed", async () => {
    const root = dataDir();
    const chosen = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x70, 0xff, 0xd9]);
    const qualities: number[] = [];
    const rig = captureRig({
      toJPEG: (quality) => {
        qualities.push(quality);
        return quality === 82 ? Buffer.alloc(256 * 1024 + 1) : chosen;
      },
    });
    const capture = new ArtifactPreviewCapture({ dataDir: root, native: rig.native });
    const result = await capture.capture(
      { artifactId: ARTIFACT_ID, url: MADE_URL, allowHosts: ALLOW_HOSTS },
      new AbortController().signal,
    );
    const thumbnail = join(root, "artifacts", "previews", ARTIFACT_ID, "thumbnail.jpg");
    expect(existsSync(thumbnail), "the thumbnail is committed").toBe(true);
    expect(qualities, "the budget's quality steps").toEqual([82, 70]);
    expect(sha256(readFileSync(thumbnail)), "the committed file is the step that fit").toBe(
      sha256(chosen),
    );
    expect(result, "the made capture's answer").toEqual({
      captured: true,
      title: "Made app",
      digest: sha256(chosen),
    });
  });

  it("a live artifact's capture (no allowHosts) answers its digest too", async () => {
    const rig = captureRig();
    const capture = new ArtifactPreviewCapture({ dataDir: dataDir(), native: rig.native });
    const result = await capture.capture(
      { artifactId: ARTIFACT_ID, url: URL },
      new AbortController().signal,
    );
    expect(result.captured, "the live capture completes").toBe(true);
    expect(result.digest, "the live capture's digest").toBe(sha256(MADE_JPEG));
  });

  it("the digest is taken from the bytes before the atomic replace — never a re-read of the destination", async () => {
    const root = dataDir();
    const { durableRename: realRename } =
      await vi.importActual<typeof import("@vibefield/logging")>("@vibefield/logging");
    const committed: Buffer[] = [];
    vi.mocked(durableRename).mockImplementationOnce(async (tmp, target) => {
      committed.push(readFileSync(tmp));
      await realRename(tmp, target);
      // a later writer replaces the destination before the capture answers
      writeFileSync(target, "a later writer's bytes");
    });
    const rig = captureRig();
    const capture = new ArtifactPreviewCapture({ dataDir: root, native: rig.native });
    const result = await capture.capture(
      { artifactId: ARTIFACT_ID, url: MADE_URL, allowHosts: ALLOW_HOSTS },
      new AbortController().signal,
    );
    expect(committed.length, "the capture committed through one replace").toBe(1);
    expect(sha256(committed[0] ?? ""), "the bytes the replace committed").toBe(sha256(MADE_JPEG));
    expect(
      result.digest,
      "the answer names the committed bytes, not the destination's later contents",
    ).toBe(sha256(MADE_JPEG));
  });

  it("PIN: a failed replace answers no digest and keeps the previous thumbnail", async () => {
    const root = dataDir();
    const targetDir = join(root, "artifacts", "previews", ARTIFACT_ID);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "thumbnail.jpg"), "old-preview");
    vi.mocked(durableRename).mockRejectedValueOnce(
      Object.assign(new Error("rename refused"), { code: "EXDEV" }),
    );
    const rig = captureRig();
    const capture = new ArtifactPreviewCapture({ dataDir: root, native: rig.native });
    await expect(
      capture.capture(
        { artifactId: ARTIFACT_ID, url: MADE_URL, allowHosts: ALLOW_HOSTS },
        new AbortController().signal,
      ),
      "a capture whose replace fails",
    ).rejects.toMatchObject({ kind: "INTERNAL" });
    expect(readFileSync(join(targetDir, "thumbnail.jpg"), "utf8"), "the previous thumbnail").toBe(
      "old-preview",
    );
    expect(readdirSync(targetDir), "no temp file is left").toEqual(["thumbnail.jpg"]);
  });
});
