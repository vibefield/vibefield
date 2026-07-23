import type { BrowserWindow, WebContents } from "electron";
import { describe, expect, it, type Mock, vi } from "vitest";
import { WindowRegistry, webPreferences } from "../src/main/window-policy";

// The PURE window policy (ESR §5.2.2–5.2.3). Electron appears as TYPES only: the
// registry is driven by structural fakes cast through `unknown`, so this suite
// runs in plain node vitest with NO runtime electron import.

interface FakeWindow {
  /** cast to BrowserWindow at the registry boundary. */
  readonly window: BrowserWindow;
  /** the identity object `owns()` compares against. */
  readonly webContents: WebContents;
  readonly restore: Mock;
  readonly focus: Mock;
  destroy(): void;
  minimize(): void;
  /** invoke the listener the registry installed via window.on("closed", …). */
  fireClosed(): void;
  hasClosedHandler(): boolean;
}

function makeFakeWindow(id: number): FakeWindow {
  const restore = vi.fn();
  const focus = vi.fn();
  const webContents = { id } as unknown as WebContents;
  let destroyed = false;
  let minimized = false;
  let closedHandler: (() => void) | undefined;

  const win = {
    id,
    webContents,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore,
    focus,
    on(event: string, handler: () => void) {
      if (event === "closed") closedHandler = handler;
    },
  };

  return {
    window: win as unknown as BrowserWindow,
    webContents,
    restore,
    focus,
    destroy: () => {
      destroyed = true;
    },
    minimize: () => {
      minimized = true;
    },
    fireClosed: () => closedHandler?.(),
    hasClosedHandler: () => closedHandler !== undefined,
  };
}

/** First recorded call order for a spy; fails the test if the spy never ran.
 * Keeps the ordering assertion typed as number under noUncheckedIndexedAccess. */
function firstCallOrder(spy: Mock): number {
  const order = spy.mock.invocationCallOrder[0];
  expect(order).toBeDefined();
  return order ?? Number.NaN;
}

describe("webPreferences", () => {
  it("pins the hardened production preferences and passes the preload path through", () => {
    const prefs = webPreferences("/abs/path/preload.cjs");
    expect(prefs.preload).toBe("/abs/path/preload.cjs");
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    // Electron's hidden-renderer throttling restored to default (slice 5) —
    // safe because persistence is visibility-EXEMPT by law (§5.4.5; pinned by
    // field-app's persistence-exemption suite).
    expect(prefs.backgroundThrottling).toBe(true);
  });
});

describe("WindowRegistry.owns", () => {
  it("owns a registered window's own webContents", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    reg.adopt(a.window);
    expect(reg.owns(a.webContents)).toBe(true);
  });

  it("does not own a foreign webContents", () => {
    const reg = new WindowRegistry();
    reg.adopt(makeFakeWindow(1).window);
    const foreign = { id: 999 } as unknown as WebContents;
    expect(reg.owns(foreign)).toBe(false);
  });

  it("stops owning a window once it reports destroyed", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    reg.adopt(a.window);
    a.destroy();
    expect(reg.owns(a.webContents)).toBe(false);
  });
});

describe("WindowRegistry.primary", () => {
  it("is null when the registry is empty", () => {
    expect(new WindowRegistry().primary()).toBeNull();
  });

  it("skips destroyed windows and returns the first live one", () => {
    const reg = new WindowRegistry();
    const dead = makeFakeWindow(1);
    const live = makeFakeWindow(2);
    reg.adopt(dead.window);
    reg.adopt(live.window);
    dead.destroy();
    expect(reg.primary()).toBe(live.window);
  });

  it("is null when every registered window is destroyed", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    reg.adopt(a.window);
    a.destroy();
    expect(reg.primary()).toBeNull();
  });
});

describe("WindowRegistry.focusPrimary", () => {
  it("restores a minimized primary BEFORE focusing it", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    reg.adopt(a.window);
    a.minimize();

    reg.focusPrimary();

    expect(a.restore).toHaveBeenCalledTimes(1);
    expect(a.focus).toHaveBeenCalledTimes(1);
    expect(firstCallOrder(a.restore)).toBeLessThan(firstCallOrder(a.focus));
  });

  it("focuses without restoring when the primary is not minimized", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    reg.adopt(a.window);

    reg.focusPrimary();

    expect(a.restore).not.toHaveBeenCalled();
    expect(a.focus).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when there is no window", () => {
    const reg = new WindowRegistry();
    expect(() => reg.focusPrimary()).not.toThrow();
  });
});

describe("WindowRegistry closed listener", () => {
  it("installs a closed handler that removes the session when it fires", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    reg.adopt(a.window);

    expect(a.hasClosedHandler()).toBe(true);
    expect(reg.owns(a.webContents)).toBe(true);

    a.fireClosed();

    expect(reg.owns(a.webContents)).toBe(false);
    expect(reg.primary()).toBeNull();
  });
});

describe("WindowRegistry.disposeAll", () => {
  it("empties the registry so nothing is owned afterward", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    const b = makeFakeWindow(2);
    reg.adopt(a.window);
    reg.adopt(b.window);

    reg.disposeAll();

    expect(reg.owns(a.webContents)).toBe(false);
    expect(reg.owns(b.webContents)).toBe(false);
    expect(reg.primary()).toBeNull();
  });
});
