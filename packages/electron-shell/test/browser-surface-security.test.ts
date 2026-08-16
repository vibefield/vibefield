import { describe, expect, it, vi } from "vitest";
import {
  type BrowserSurfaceSession,
  browserSurfacePartition,
  installGuardedBrowserSurfaceContents,
  installGuardedBrowserSurfaceSession,
  isAllowedBrowserRequest,
  isAllowedBrowserTopLevelUrl,
  isGuardedBrowserSurfaceSession,
} from "../src/main/live-surfaces/browser-security";

describe("Browser Live Surface security", () => {
  it("derives stable opaque memory and persistent profile partitions", () => {
    const memory = browserSurfacePartition({
      kind: "browser",
      initialUrl: "https://example.test/",
      profile: { mode: "memory", ref: "private profile name" },
      logicalViewport: { width: 800, height: 600 },
    });
    const persistent = browserSurfacePartition({
      kind: "browser",
      initialUrl: "https://example.test/",
      profile: { mode: "persistent", ref: "private profile name" },
      logicalViewport: { width: 800, height: 600 },
    });
    expect(memory).toMatch(/^vibefield-live-surface:[a-f0-9]{40}$/);
    expect(persistent).toMatch(/^persist:vibefield-live-surface:[a-f0-9]{40}$/);
    expect(memory).not.toContain("private profile name");
    expect(memory).toBe(
      browserSurfacePartition({
        kind: "browser",
        initialUrl: "https://another.test/",
        profile: { mode: "memory", ref: "private profile name" },
        logicalViewport: { width: 320, height: 240 },
      }),
    );
  });

  it("allows ordinary web traffic but rejects privileged/external schemes", () => {
    expect(isAllowedBrowserTopLevelUrl("https://example.test/a")).toBe(true);
    expect(isAllowedBrowserTopLevelUrl("http://127.0.0.1:4312/a")).toBe(true);
    expect(isAllowedBrowserTopLevelUrl("about:blank")).toBe(true);
    for (const url of [
      "file:///etc/passwd",
      "vibefield-app://shell/index.html",
      "mailto:user@example.test",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isAllowedBrowserTopLevelUrl(url)).toBe(false);
    }
    expect(isAllowedBrowserRequest("wss://example.test/socket", "webSocket")).toBe(true);
    expect(isAllowedBrowserRequest("data:text/plain,ok", "image")).toBe(true);
    expect(isAllowedBrowserRequest("blob:https://example.test/id", "script")).toBe(true);
    expect(isAllowedBrowserRequest("about:blank", "subFrame")).toBe(true);
    expect(isAllowedBrowserRequest("about:blank", "mainFrame")).toBe(true);
    expect(isAllowedBrowserRequest("data:text/html,no", "mainFrame")).toBe(false);
    expect(isAllowedBrowserRequest("file:///tmp/private", "image")).toBe(false);
  });

  it("marks and configures a profile session before use, idempotently", () => {
    const hooks: {
      requestGuard:
        | ((
            details: { url: string; resourceType?: string },
            callback: (decision: { cancel: boolean }) => void,
          ) => void)
        | null;
      download: ((event: { preventDefault(): void }) => void) | null;
    } = { requestGuard: null, download: null };
    let permissionRequest = (
      _contents: unknown,
      _permission: string,
      callback: (v: boolean) => void,
    ) => callback(true);
    let permissionCheck = (_contents: unknown, _permission: string) => true;
    const target: BrowserSurfaceSession = {
      webRequest: {
        onBeforeRequest: (_filter, listener) => {
          hooks.requestGuard = listener;
        },
      },
      setPermissionRequestHandler: (handler) => {
        permissionRequest = handler;
      },
      setPermissionCheckHandler: (handler) => {
        permissionCheck = handler;
      },
      on: (_event, listener) => {
        hooks.download = listener;
        return target;
      },
    };
    installGuardedBrowserSurfaceSession(target);
    installGuardedBrowserSurfaceSession(target);
    expect(isGuardedBrowserSurfaceSession(target)).toBe(true);
    let granted = true;
    permissionRequest({}, "media", (value) => {
      granted = value;
    });
    expect(granted).toBe(false);
    expect(permissionCheck({}, "media")).toBe(false);
    let decision: { cancel: boolean } | null = null;
    hooks.requestGuard?.({ url: "file:///etc/passwd", resourceType: "image" }, (value) => {
      decision = value;
    });
    expect(decision).toEqual({ cancel: true });
    const downloadEvent = { preventDefault: vi.fn() };
    hooks.download?.(downloadEvent);
    expect(downloadEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it("denies popups, external navigation, and webview attachment per WebContents", () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const hooks: { windowOpen: (() => { action: "deny" }) | null } = { windowOpen: null };
    const contents = {
      on: (event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
        return contents;
      },
      setWindowOpenHandler: (handler: () => { action: "deny" }) => {
        hooks.windowOpen = handler;
      },
    };
    installGuardedBrowserSurfaceContents(contents);
    expect(hooks.windowOpen?.()).toEqual({ action: "deny" });
    const external = { preventDefault: vi.fn() };
    listeners.get("will-navigate")?.(external as never, "mailto:user@example.test" as never);
    expect(external.preventDefault).toHaveBeenCalledOnce();
    const web = { preventDefault: vi.fn() };
    listeners.get("will-redirect")?.(web as never, "https://example.test/next" as never);
    expect(web.preventDefault).not.toHaveBeenCalled();
    const webview = { preventDefault: vi.fn() };
    listeners.get("will-attach-webview")?.(webview as never);
    expect(webview.preventDefault).toHaveBeenCalledOnce();
  });
});
