import type { BrowserWindow, WebContents, WebPreferences } from "electron";
import { describe, expect, it, type Mock, vi } from "vitest";
import { assertSecurePreferences, WindowRegistry, webPreferences } from "../src/main/window-policy";

// The PURE window policy (ESR §5.2.2–5.2.3). Electron appears as TYPES only: the
// registry is driven by structural fakes cast through `unknown`, so this suite
// runs in plain node vitest with NO runtime electron import.

interface FakeWindow {
  /** cast to BrowserWindow at the registry boundary. */
  readonly window: BrowserWindow;
  /** the identity object `owns()` compares against. */
  readonly webContents: WebContents;
  readonly restore: Mock;
  readonly show: Mock;
  readonly focus: Mock;
  destroy(): void;
  minimize(): void;
  hide(): void;
  /** invoke the listener the registry installed via window.on("closed", …). */
  fireClosed(): void;
  hasClosedHandler(): boolean;
}

function makeFakeWindow(id: number): FakeWindow {
  let destroyed = false;
  let minimized = false;
  let visible = true;
  let closedHandler: (() => void) | undefined;
  const restore = vi.fn();
  const show = vi.fn(() => {
    visible = true;
  });
  const focus = vi.fn();
  const webContents = { id } as unknown as WebContents;

  const win = {
    id,
    webContents,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore,
    show,
    focus,
    destroy: () => {
      destroyed = true;
    },
    on(event: string, handler: () => void) {
      if (event === "closed") closedHandler = handler;
    },
  };

  return {
    window: win as unknown as BrowserWindow,
    webContents,
    restore,
    show,
    focus,
    destroy: () => {
      destroyed = true;
    },
    minimize: () => {
      minimized = true;
    },
    hide: () => {
      visible = false;
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
    // The ESP §7.1 set, asserted field by field rather than as a snapshot: a
    // removed field must fail loudly here, not read as an incidental diff.
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.nodeIntegrationInWorker).toBe(false);
    expect(prefs.webviewTag).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.allowRunningInsecureContent).toBe(false);
    expect(prefs.experimentalFeatures).toBe(false);
    expect(prefs.spellcheck).toBe(false);
    // Electron's hidden-renderer throttling restored to default (slice 5) —
    // safe because persistence is visibility-EXEMPT by law (§5.4.5; pinned by
    // field-app's persistence-exemption suite).
    expect(prefs.backgroundThrottling).toBe(true);
  });

  it("produces preferences that satisfy the assertion the factory runs", () => {
    expect(() => assertSecurePreferences(webPreferences("/p.cjs"))).not.toThrow();
  });
});

describe("assertSecurePreferences", () => {
  // ESP §13.1 — "call-site overrides cannot weaken it." Each row is a real
  // downgrade someone could write while adding a presentation option.
  const WEAKENINGS: readonly (readonly [string, WebPreferences])[] = [
    ["sandbox", { sandbox: false }],
    ["contextIsolation", { contextIsolation: false }],
    ["nodeIntegration", { nodeIntegration: true }],
    ["nodeIntegrationInWorker", { nodeIntegrationInWorker: true }],
    ["webviewTag", { webviewTag: true }],
    ["webSecurity", { webSecurity: false }],
    ["allowRunningInsecureContent", { allowRunningInsecureContent: true }],
    ["experimentalFeatures", { experimentalFeatures: true }],
    ["spellcheck", { spellcheck: true }],
  ];

  describe.each(WEAKENINGS)("refuses a relaxed %s", (field, override) => {
    it("throws naming the offending field", () => {
      const prefs = { ...webPreferences("/p.cjs"), ...override };
      expect(() => assertSecurePreferences(prefs)).toThrow(new RegExp(field));
    });
  });

  it("refuses preferences that simply omit a security field", () => {
    const { sandbox: _dropped, ...withoutSandbox } = webPreferences("/p.cjs");
    expect(() => assertSecurePreferences(withoutSandbox)).toThrow(/sandbox/);
  });

  it("permits presentation options alongside the hardened set", () => {
    const prefs = { ...webPreferences("/p.cjs"), zoomFactor: 1.25, backgroundThrottling: false };
    expect(() => assertSecurePreferences(prefs)).not.toThrow();
  });

  it("returns the same object so it can wrap the factory call inline", () => {
    const prefs = webPreferences("/p.cjs");
    expect(assertSecurePreferences(prefs)).toBe(prefs);
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

  it("owns auxiliary renderer realms without changing the primary", () => {
    const reg = new WindowRegistry();
    const primary = makeFakeWindow(1);
    const auxiliary = makeFakeWindow(2);
    reg.adopt(primary.window);
    reg.adoptAuxiliary(auxiliary.window);

    expect(reg.primary()).toBe(primary.window);
    expect(reg.owns(primary.webContents)).toBe(true);
    expect(reg.owns(auxiliary.webContents)).toBe(true);
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
    dead.destroy();
    reg.adopt(live.window);
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

  it("shows a hidden primary BEFORE focusing it", () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    reg.adopt(a.window);
    a.hide();

    reg.focusPrimary();

    expect(a.show).toHaveBeenCalledTimes(1);
    expect(firstCallOrder(a.show)).toBeLessThan(firstCallOrder(a.focus));
  });

  it("is a no-op when there is no window", () => {
    const reg = new WindowRegistry();
    expect(() => reg.focusPrimary()).not.toThrow();
  });
});

describe("WindowRegistry single-primary reveal", () => {
  it("adopts before preparation and reveals after the renderer is ready", async () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    let ownedDuringPrepare = false;

    const revealed = await reg.revealPrimary(() => ({
      window: a.window,
      prepare: async () => {
        ownedDuringPrepare = reg.owns(a.webContents);
      },
    }));

    expect(ownedDuringPrepare).toBe(true);
    expect(revealed).toBe(a.window);
    expect(a.focus).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent creation onto one preparation promise", async () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    let finish = (): void => {};
    const preparation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const factory = vi.fn(() => ({
      window: a.window,
      prepare: () => preparation,
    }));

    const first = reg.revealPrimary(factory);
    const second = reg.revealPrimary(factory);
    expect(factory).toHaveBeenCalledTimes(1);
    finish();
    await expect(Promise.all([first, second])).resolves.toEqual([a.window, a.window]);
  });

  it("recreates only after the prior primary has closed", async () => {
    const reg = new WindowRegistry();
    const first = makeFakeWindow(1);
    const second = makeFakeWindow(2);
    await reg.revealPrimary(() => ({ window: first.window, prepare: async () => {} }));
    first.fireClosed();

    await expect(
      reg.revealPrimary(() => ({ window: second.window, prepare: async () => {} })),
    ).resolves.toBe(second.window);
    expect(reg.primary()).toBe(second.window);
  });

  it("queues one replacement when Open arrives during durable close", async () => {
    const reg = new WindowRegistry();
    const first = makeFakeWindow(1);
    const second = makeFakeWindow(2);
    await reg.revealPrimary(() => ({ window: first.window, prepare: async () => {} }));
    expect(reg.markClosing(first.window)).toBe(true);
    const factory = vi.fn(() => ({ window: second.window, prepare: async () => {} }));

    const firstOpen = reg.revealPrimary(factory);
    const secondOpen = reg.revealPrimary(factory);
    expect(firstOpen).toBe(secondOpen);
    expect(factory).not.toHaveBeenCalled();
    expect(first.focus).toHaveBeenCalledTimes(1);

    first.fireClosed();
    await expect(Promise.all([firstOpen, secondOpen])).resolves.toEqual([
      second.window,
      second.window,
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(reg.primary()).toBe(second.window);
  });

  it("preserves Open when durable close starts before initial preparation finishes", async () => {
    const reg = new WindowRegistry();
    const first = makeFakeWindow(1);
    const second = makeFakeWindow(2);
    let finishPreparation = (): void => {};
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const opening = reg.revealPrimary(() => ({
      window: first.window,
      prepare: () => preparation,
    }));
    expect(reg.markClosing(first.window)).toBe(true);
    const replacementFactory = vi.fn(() => ({
      window: second.window,
      prepare: async () => {},
    }));

    const reopen = reg.revealPrimary(replacementFactory);
    expect(reopen).not.toBe(opening);
    expect(replacementFactory).not.toHaveBeenCalled();

    finishPreparation();
    await expect(opening).resolves.toBe(first.window);
    first.fireClosed();
    await expect(reopen).resolves.toBe(second.window);
    expect(replacementFactory).toHaveBeenCalledTimes(1);
    expect(reg.primary()).toBe(second.window);
  });

  it("cancels a queued replacement when app shutdown wins the race", async () => {
    const reg = new WindowRegistry();
    const first = makeFakeWindow(1);
    const second = makeFakeWindow(2);
    await reg.revealPrimary(() => ({ window: first.window, prepare: async () => {} }));
    reg.markClosing(first.window);
    const factory = vi.fn(() => ({ window: second.window, prepare: async () => {} }));
    const queued = reg.revealPrimary(factory);
    const rejection = expect(queued).rejects.toThrow(/shutting down/);

    reg.beginShutdown();
    await rejection;
    first.fireClosed();
    expect(factory).not.toHaveBeenCalled();
    await expect(
      reg.revealPrimary(() => ({ window: second.window, prepare: async () => {} })),
    ).rejects.toThrow(/shutting down/);
  });

  it("refuses a second live primary at the registry boundary", () => {
    const reg = new WindowRegistry();
    reg.adopt(makeFakeWindow(1).window);
    expect(() => reg.adopt(makeFakeWindow(2).window)).toThrow(/single-primary-window/);
  });

  it("destroys and releases a window whose preparation fails", async () => {
    const reg = new WindowRegistry();
    const a = makeFakeWindow(1);
    await expect(
      reg.revealPrimary(() => ({
        window: a.window,
        prepare: async () => {
          throw new Error("renderer failed");
        },
      })),
    ).rejects.toThrow("renderer failed");
    expect(reg.primary()).toBeNull();
  });

  it("publishes open/closed state transitions", () => {
    const reg = new WindowRegistry();
    const states: boolean[] = [];
    reg.onPrimaryChanged((open) => states.push(open));
    const a = makeFakeWindow(1);
    reg.adopt(a.window);
    a.fireClosed();
    expect(states).toEqual([true, false]);
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
    reg.adopt(a.window);

    reg.disposeAll();

    expect(reg.owns(a.webContents)).toBe(false);
    expect(reg.primary()).toBeNull();
  });
});
