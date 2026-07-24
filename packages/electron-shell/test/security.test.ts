import type { Session, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Electron WIRING (electron-security-packaging.md §7.2/§7.4). The verdicts
// themselves live in security-policy.test.ts; what is proven here is that every
// gate is actually installed, on every surface, before content can run — the
// failure mode a pure policy test cannot see. `electron` is mocked rather than
// launched: a real Electron harness (ESP §13.2) belongs to packaged smoke.

const stub = vi.hoisted(() => ({
  appListeners: new Map<string, ((...args: never[]) => void)[]>(),
  openExternal: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    on: (event: string, fn: (...args: never[]) => void) => {
      stub.appListeners.set(event, [...(stub.appListeners.get(event) ?? []), fn]);
    },
  },
  session: { defaultSession: {} },
  shell: { openExternal: stub.openExternal },
}));

const { installNavigationPolicy, installPermissionPolicy, installWebContentsBackstop } =
  await import("../src/main/security");

interface FakeEvent {
  preventDefault: ReturnType<typeof vi.fn>;
}
const fakeEvent = (): FakeEvent => ({ preventDefault: vi.fn() });

function fakeContents(url = "app://shell/index.html") {
  const listeners = new Map<string, ((...args: never[]) => void)[]>();
  let windowOpen: ((details: { url: string }) => { action: string }) | undefined;
  const contents = {
    id: 7,
    getURL: () => url,
    getType: () => "window",
    on(event: string, fn: (...args: never[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    setWindowOpenHandler(fn: (details: { url: string }) => { action: string }) {
      windowOpen = fn;
    },
  };
  return {
    contents: contents as unknown as WebContents,
    window: { webContents: contents } as unknown as Electron.BrowserWindow,
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
    },
    listenerCount: (event: string) => (listeners.get(event) ?? []).length,
    openWindow: (target: string) => windowOpen?.({ url: target }),
    hasWindowOpenHandler: () => windowOpen !== undefined,
  };
}

function fakeSession() {
  let request: ((c: unknown, p: string, cb: (granted: boolean) => void) => void) | undefined;
  let check: ((c: unknown, p: string) => boolean) | undefined;
  const target = {
    setPermissionRequestHandler(fn: typeof request) {
      request = fn;
    },
    setPermissionCheckHandler(fn: typeof check) {
      check = fn;
    },
  };
  return {
    session: target as unknown as Session,
    request(permission: string): boolean | undefined {
      let granted: boolean | undefined;
      request?.(null, permission, (value) => {
        granted = value;
      });
      return granted;
    },
    check: (permission: string) => check?.(null, permission),
    installed: () => request !== undefined && check !== undefined,
  };
}

beforeEach(() => {
  stub.appListeners.clear();
  stub.openExternal.mockClear();
});

describe("installPermissionPolicy", () => {
  it("installs BOTH handlers — a lone request handler leaves queries on Chromium defaults", () => {
    const ses = fakeSession();
    installPermissionPolicy(ses.session);
    expect(ses.installed()).toBe(true);
  });

  it("denies a permission request through the callback", () => {
    const ses = fakeSession();
    installPermissionPolicy(ses.session);
    expect(ses.request("media")).toBe(false);
  });

  it("denies the matching permission check, so the two can never disagree", () => {
    const ses = fakeSession();
    installPermissionPolicy(ses.session);
    for (const permission of ["media", "geolocation", "notifications", "usb"]) {
      expect(ses.request(permission)).toBe(false);
      expect(ses.check(permission)).toBe(false);
    }
  });

  it("reports each denial so an unexpected request is visible in evidence", () => {
    const ses = fakeSession();
    const denied = vi.fn();
    installPermissionPolicy(ses.session, denied);
    ses.request("display-capture");
    expect(denied).toHaveBeenCalledWith("display-capture");
  });

  it("does not require the reporter", () => {
    const ses = fakeSession();
    installPermissionPolicy(ses.session);
    expect(() => ses.request("hid")).not.toThrow();
  });
});

describe("installNavigationPolicy", () => {
  it("refuses a webview attachment even though webviewTag is already false", () => {
    const surface = fakeContents();
    installNavigationPolicy(surface.window, "production");
    const event = fakeEvent();
    surface.emit("will-attach-webview", event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("denies top-level navigation in production", () => {
    const surface = fakeContents();
    installNavigationPolicy(surface.window, "production");
    const event = fakeEvent();
    surface.emit("will-navigate", event, "https://evil.example/x");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("permits same-origin navigation in dev (Vite full reload)", () => {
    const surface = fakeContents("http://localhost:5173/index.html");
    installNavigationPolicy(surface.window, "dev");
    const event = fakeEvent();
    surface.emit("will-navigate", event, "http://localhost:5173/other");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("denies every window open and routes https out to the system browser", () => {
    const surface = fakeContents();
    installNavigationPolicy(surface.window, "production");
    expect(surface.openWindow("https://login.tailscale.com/a/0123")).toEqual({ action: "deny" });
    expect(stub.openExternal).toHaveBeenCalledWith("https://login.tailscale.com/a/0123");
  });

  it("denies a non-https window open without opening anything externally", () => {
    const surface = fakeContents();
    installNavigationPolicy(surface.window, "production");
    expect(surface.openWindow("file:///etc/passwd")).toEqual({ action: "deny" });
    expect(stub.openExternal).not.toHaveBeenCalled();
  });
});

describe("installWebContentsBackstop", () => {
  const created = (contents: WebContents): void => {
    for (const fn of stub.appListeners.get("web-contents-created") ?? [])
      (fn as (...a: unknown[]) => void)({}, contents);
  };

  it("subscribes to web-contents-created", () => {
    installWebContentsBackstop("production");
    expect(stub.appListeners.get("web-contents-created")).toHaveLength(1);
  });

  it("arms a surface the window factory never created", () => {
    installWebContentsBackstop("production");
    const stray = fakeContents();
    created(stray.contents);

    expect(stray.hasWindowOpenHandler()).toBe(true);
    const attach = fakeEvent();
    stray.emit("will-attach-webview", attach);
    expect(attach.preventDefault).toHaveBeenCalledTimes(1);
    const navigate = fakeEvent();
    stray.emit("will-navigate", navigate, "https://evil.example/x");
    expect(navigate.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("reports the stray surface so it is caught in review, not in the wild", () => {
    const report = vi.fn();
    installWebContentsBackstop("production", report);
    const stray = fakeContents();
    created(stray.contents);
    expect(report).toHaveBeenCalledWith(stray.contents);
  });

  it("leaves the registered window's explicit policy agreeing with its own", () => {
    // The main window is covered twice — backstop at birth, factory right
    // after. Both run the same pure decisions, so the double install must be
    // harmless: navigation still denied, exactly one refusal per listener.
    installWebContentsBackstop("production");
    const surface = fakeContents();
    created(surface.contents);
    installNavigationPolicy(surface.window, "production");

    expect(surface.listenerCount("will-navigate")).toBe(2);
    const event = fakeEvent();
    surface.emit("will-navigate", event, "https://evil.example/x");
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });
});
