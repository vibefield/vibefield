// EY-1 (1f, 2026-11-19) — A PAGE'S POP-UPS UNDER ITS RUN'S POLICY, in the Electron adapter: the window keeps the policy
// the producer sets, and the contents' guard reads it at each pop-up; none once the window is destroyed (today's answer
// then); a pop-up the policy allowed that the address rule refuses is told to the native's maker. Electron is a fake;
// the contents' guard is the real one, wrapped so a row can read what it was handed.
import { describe, expect, it, vi } from "vitest";
import type { BrowserSurfacePopups } from "../src/main/live-surfaces/browser-security";

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class Emitter {
    readonly #listeners = new Map<string, Listener[]>();
    on(event: string, listener: Listener): this {
      this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
      return this;
    }
    off(event: string, listener: Listener): this {
      this.#listeners.set(
        event,
        (this.#listeners.get(event) ?? []).filter((l) => l !== listener),
      );
      return this;
    }
    once(event: string, listener: Listener): this {
      return this.on(event, listener);
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(...args);
    }
  }
  class Contents extends Emitter {
    destroyed = false;
    windowOpen: ((details: { url: string }) => unknown) | undefined;
    readonly debugger = Object.assign(new Emitter(), {
      isAttached: (): boolean => false,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: async () => ({}),
    });
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      clear: () => undefined,
    };
    isDestroyed = (): boolean => this.destroyed;
    getURL = (): string => "";
    getTitle = (): string => "";
    isLoading = (): boolean => false;
    setFrameRate = (): void => undefined;
    setWindowOpenHandler(handler: (details: { url: string }) => unknown): void {
      this.windowOpen = handler;
    }
  }
  const made: { webContents: Contents }[] = [];
  class BrowserWindow {
    readonly webContents = new Contents();
    constructor(readonly options: Record<string, unknown>) {
      made.push(this);
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    isDestroyed = (): boolean => this.webContents.destroyed;
    destroy = (): void => {
      this.webContents.destroyed = true;
    };
    setContentSize = (): void => undefined;
  }
  const installs: {
    readonly popups?: () => BrowserSurfacePopups | null;
    readonly belt?: () => void;
  }[] = [];
  return {
    BrowserWindow,
    made,
    installs,
    session: { fromPartition: () => ({}), fromPath: () => ({}) },
  };
});

vi.mock("electron", () => ({ BrowserWindow: electron.BrowserWindow, session: electron.session }));
vi.mock("../src/main/live-surfaces/browser-security", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/main/live-surfaces/browser-security")>();
  return {
    ...real,
    installGuardedBrowserSurfaceSession: () => undefined,
    installGuardedBrowserSurfaceContents: (
      ...args: Parameters<typeof real.installGuardedBrowserSurfaceContents>
    ) => {
      const [, , popups, belt] = args;
      electron.installs.push({
        ...(popups === undefined ? {} : { popups }),
        ...(belt === undefined ? {} : { belt }),
      });
      real.installGuardedBrowserSurfaceContents(...args);
    },
  };
});

import { ElectronBrowserSurfaceNative } from "../src/main/live-surfaces/browser-electron-native";

const OPTIONS = {
  partition: "memory:test",
  persistent: false,
  logicalViewport: { width: 320, height: 180 },
  initialBackingRaster: { width: 640, height: 360 },
  deviceScaleFactor: 2,
  requestSharedTexture: true,
} as const;

function made(hooks?: { readonly onPopupBeltRefused?: () => void }) {
  const native = new ElectronBrowserSurfaceNative(hooks).createWindow(OPTIONS);
  const install = electron.installs.at(-1);
  const contents = electron.made.at(-1)?.webContents;
  if (install === undefined || contents === undefined) throw new Error("no window was made");
  return { native, install, contents };
}

const policy = (
  decide: "allow" | "deny" = "allow",
): BrowserSurfacePopups & { open: ReturnType<typeof vi.fn> } => ({
  decide: () => decide,
  open: vi.fn(),
});

describe("a page's pop-ups under its run's policy, in the Electron adapter (EY-1 1f)", () => {
  it("hands the contents' guard a getter of the run's policy, answering none while none is set", () => {
    const w = made();
    expect(typeof w.install.popups).toBe("function");
    expect(w.install.popups?.() ?? null).toBeNull();
  });

  it("answers the policy set at each pop-up, the latest set winning", () => {
    const w = made();
    const first = policy();
    const second = policy("deny");
    w.native.setPopupPolicy?.(first);
    expect(w.install.popups?.()).toBe(first);
    w.native.setPopupPolicy?.(second);
    expect(w.install.popups?.()).toBe(second);
  });

  it("clears the policy on null, and a destroyed window answers none, whatever is set after", () => {
    const w = made();
    const set = policy();
    w.native.setPopupPolicy?.(set);
    expect(w.install.popups?.()).toBe(set);
    w.native.setPopupPolicy?.(null);
    expect(w.install.popups?.() ?? null).toBeNull();
    w.native.setPopupPolicy?.(set);
    expect(w.install.popups?.()).toBe(set);
    w.native.destroy();
    expect(w.install.popups?.() ?? null).toBeNull();
    w.native.setPopupPolicy?.(set);
    expect(w.install.popups?.() ?? null).toBeNull();
  });

  it("tells its maker each pop-up the address rule refused once; with no hook given, nothing throws", () => {
    const hook = vi.fn();
    const told = made({ onPopupBeltRefused: hook });
    told.install.belt?.();
    expect(hook).toHaveBeenCalledTimes(1);
    told.install.belt?.();
    expect(hook).toHaveBeenCalledTimes(2);
    const silent = made();
    expect(() => silent.install.belt?.()).not.toThrow();
  });

  it("end to end: a web address the policy allows is opened once with Electron denied; file: is refused and told", () => {
    const hook = vi.fn();
    const w = made({ onPopupBeltRefused: hook });
    const run = policy();
    w.native.setPopupPolicy?.(run);
    expect(w.contents.windowOpen?.({ url: "https://b.test/sign-in" })).toEqual({ action: "deny" });
    expect(run.open).toHaveBeenCalledTimes(1);
    expect(run.open).toHaveBeenCalledWith("https://b.test/sign-in");
    expect(w.contents.windowOpen?.({ url: "file:///etc/hosts" })).toEqual({ action: "deny" });
    expect(run.open).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
  });
});
