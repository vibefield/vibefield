import type { Logger } from "@vibefield/logging";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const app = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
    }),
    quit: vi.fn(),
    exit: vi.fn(),
  };
  return {
    app,
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    reset() {
      listeners.clear();
      app.on.mockClear();
      app.quit.mockClear();
      app.exit.mockClear();
    },
  };
});

vi.mock("electron", () => ({ app: electron.app }));

import { installLifecycle } from "../src/main/lifecycle";
import { WindowRegistry } from "../src/main/window-policy";

function logger(): Logger {
  const value = {
    child: () => value,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  return value as unknown as Logger;
}

function install(keepAlive: () => boolean, registry: WindowRegistry = new WindowRegistry()) {
  const openPrimaryWindow = vi.fn(async () => {});
  const onQuitRequested = vi.fn();
  const disposeShell = vi.fn();
  installLifecycle({
    registry,
    getSupervisor: () => null,
    openPrimaryWindow,
    keepAliveWithoutWindows: keepAlive,
    onQuitRequested,
    disposeShell,
    logger: logger(),
    closeLogging: async () => {},
  });
  return { openPrimaryWindow, onQuitRequested, disposeShell };
}

describe("Electron lifecycle routing", () => {
  beforeEach(() => electron.reset());

  it("routes second-instance and Dock activation through the same reveal operation", async () => {
    const h = install(() => true);
    electron.emit("second-instance");
    electron.emit("activate");
    await Promise.resolve();
    expect(h.openPrimaryWindow).toHaveBeenCalledTimes(2);
  });

  it("stays resident only when a platform escape path is usable", () => {
    install(() => true);
    electron.emit("window-all-closed");
    expect(electron.app.quit).not.toHaveBeenCalled();

    electron.reset();
    install(() => false);
    electron.emit("window-all-closed");
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
  });

  it("marks the tray quitting synchronously at the native before-quit boundary", () => {
    const h = install(() => true);
    const event = { preventDefault: vi.fn() };
    electron.emit("before-quit", event);
    expect(h.onQuitRequested).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("defers native quit until the durable primary close has completed", () => {
    let primaryOpen = true;
    const close = vi.fn();
    const registry = {
      primary: () => (primaryOpen ? { close } : null),
      disposeAll: vi.fn(),
    } as unknown as WindowRegistry;
    const h = install(() => true, registry);
    const event = { preventDefault: vi.fn() };

    electron.emit("before-quit", event);
    expect(h.onQuitRequested).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(electron.app.quit).not.toHaveBeenCalled();

    primaryOpen = false;
    electron.emit("window-all-closed");
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
  });
});
