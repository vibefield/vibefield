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
import type { UpdateQuitPlan } from "../src/main/quit-flow";
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

  // WP12c (L2b-ii, build-wp12-updater.md §10 S4; the PM's ruling 13:36Z) — an update quit that ABORTS after
  // before-quit's durable close (the daemon's re-check refused: nothing stopped) keeps the app; the reset undoes the
  // durable-close replay flags so the reopened window is durable-closed again by the next ordinary quit.
  function updateRig(resetOnAbort: boolean) {
    let primaryOpen = true;
    const close = vi.fn(() => {
      primaryOpen = false;
    });
    const registry = {
      primary: () => (primaryOpen ? { close } : null),
      disposeAll: vi.fn(),
    } as unknown as WindowRegistry;
    const flow = installLifecycle({
      registry,
      getSupervisor: () => null,
      openPrimaryWindow: vi.fn(async () => {}),
      keepAliveWithoutWindows: () => true,
      onQuitRequested: vi.fn(),
      disposeShell: vi.fn(),
      logger: logger(),
      closeLogging: async () => {},
    });
    const plan: UpdateQuitPlan = {
      prepare: async () => ({ kind: "abort", reason: "the live sessions differ" }),
      install: vi.fn(),
      aborted: vi.fn(() => {
        if (resetOnAbort) flow.resetAfterAbortedQuit();
        primaryOpen = true; // the window reopens
      }),
      installStalled: vi.fn(async () => {}),
    };
    return { flow, plan, close };
  }

  async function abortedUpdateQuit(rig: ReturnType<typeof updateRig>): Promise<void> {
    expect(rig.flow.armUpdate(rig.plan)).toBe(true);
    electron.emit("before-quit", { preventDefault: vi.fn() }); // the durable close of the primary
    electron.emit("window-all-closed"); // the replayed quit
    electron.emit("before-quit", { preventDefault: vi.fn() });
    electron.emit("will-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(rig.plan.aborted).toHaveBeenCalledTimes(1));
    expect(electron.app.exit).not.toHaveBeenCalled(); // the abort keeps the app
  }

  it("an aborted update quit keeps the app; the window reopens and an ORDINARY quit still durable-closes and exits", async () => {
    const rig = updateRig(true);
    await abortedUpdateQuit(rig);
    expect(rig.close).toHaveBeenCalledTimes(1);

    const ordinary = { preventDefault: vi.fn() };
    electron.emit("before-quit", ordinary);
    expect(ordinary.preventDefault).toHaveBeenCalledTimes(1); // deferred for the durable close again
    expect(rig.close).toHaveBeenCalledTimes(2);
    electron.emit("window-all-closed");
    electron.emit("before-quit", { preventDefault: vi.fn() });
    electron.emit("will-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(0));
    expect(rig.plan.install).not.toHaveBeenCalled();
  });

  it("the control: WITHOUT the reset, the next quit would skip the reopened window's durable close", async () => {
    const rig = updateRig(false);
    await abortedUpdateQuit(rig);
    const ordinary = { preventDefault: vi.fn() };
    electron.emit("before-quit", ordinary);
    expect(ordinary.preventDefault).not.toHaveBeenCalled(); // the stale replay flag let it straight through
    expect(rig.close).toHaveBeenCalledTimes(1);
  });
});
