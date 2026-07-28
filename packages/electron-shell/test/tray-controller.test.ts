import type { DesktopShellState } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type NativeTrayPort,
  TrayController,
  type TrayControllerActions,
  type TrayRuntime,
} from "../src/main/tray-controller";
import type { TrayMenuItem, TrayPlatform, TraySnapshot } from "../src/main/tray-model";

class FakeTray implements NativeTrayPort {
  readonly setImage = vi.fn();
  readonly setToolTip = vi.fn();
  readonly setContextMenu = vi.fn();
  readonly destroy = vi.fn();
  readonly listeners = new Map<string, () => void>();

  on(event: "click" | "double-click", listener: () => void): void {
    this.listeners.set(event, listener);
  }
}

function snapshot(patch: Partial<TraySnapshot> = {}): TraySnapshot {
  return {
    link: "starting",
    evidence: "healthy",
    update: { kind: "idle" },
    backgroundShell: true,
    showTray: true,
    windowOpen: false,
    quitting: false,
    ...patch,
  };
}

function harness(
  platform: TrayPlatform = "linux",
  failCreate = false,
  initial: Partial<TraySnapshot> = {},
) {
  const trays: FakeTray[] = [];
  const menus: (readonly TrayMenuItem[])[] = [];
  const runtime: TrayRuntime = {
    platform,
    loadImage: vi.fn((kind) => ({ kind })),
    createTray: vi.fn(() => {
      if (failCreate) throw new Error("desktop has no tray implementation");
      const tray = new FakeTray();
      trays.push(tray);
      return tray;
    }),
    buildMenu: vi.fn((items) => {
      menus.push(items);
      return items;
    }),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelSchedule: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const actions: TrayControllerActions = {
    openPrimaryWindow: vi.fn(async () => {}),
    openSettings: vi.fn(async () => {}),
    openDiagnostics: vi.fn(async () => {}),
    setBackgroundShell: vi.fn(async () => {}),
    setTrayVisible: vi.fn(async () => {}),
    quit: vi.fn(),
  };
  const onError = vi.fn();
  const desktopStates: DesktopShellState[] = [];
  const controller = new TrayController({
    runtime,
    initial: snapshot(initial),
    actions,
    onError,
    onDesktopState: (state) => desktopStates.push(state),
  });
  return { controller, runtime, actions, onError, trays, menus, desktopStates };
}

const menuItem = (menu: readonly TrayMenuItem[], id: string) =>
  menu.find((item) => item.id === id)!;

describe("TrayController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates exactly one tray and keeps the same instance across state updates", () => {
    const h = harness();
    expect(h.trays).toHaveLength(1);
    expect(h.trays[0]?.setToolTip).toHaveBeenCalledWith("VibeField");

    h.controller.update({ link: "ready" });
    h.controller.update({ evidence: "degraded" });
    h.controller.update({ windowOpen: true });
    expect(h.runtime.buildMenu).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    expect(h.runtime.buildMenu).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(h.runtime.buildMenu).toHaveBeenCalledTimes(2);
    expect(h.trays).toHaveLength(1);
    expect(h.trays[0]?.setImage).toHaveBeenCalledWith({ kind: "attention" });
  });

  it("destroys on hide and creates one fresh tray when re-enabled", () => {
    const h = harness();
    const first = h.trays[0]!;
    h.controller.update({ showTray: false });
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(h.controller.isUsable()).toBe(false);
    expect(h.controller.keepsAliveWithoutWindows()).toBe(false);
    expect(h.controller.desktopState().tray).toMatchObject({
      availability: "hidden",
      backgroundShellEffective: false,
      issue: null,
    });

    h.controller.update({ showTray: true });
    expect(h.trays).toHaveLength(2);
    expect(h.controller.isUsable()).toBe(true);
  });

  it("can start absent until persisted preference truth permits creation", () => {
    const h = harness("linux", false, { showTray: false });
    expect(h.controller.isUsable()).toBe(false);
    h.controller.update({ showTray: true });
    expect(h.runtime.createTray).toHaveBeenCalledTimes(1);
    expect(h.controller.isUsable()).toBe(true);
  });

  it("never leaves Windows/Linux background-resident without a usable tray", () => {
    const failed = harness("linux", true);
    expect(failed.controller.isUsable()).toBe(false);
    expect(failed.controller.keepsAliveWithoutWindows()).toBe(false);
    expect(failed.onError).toHaveBeenCalledWith("create", expect.any(Error));
    expect(failed.controller.desktopState().tray).toMatchObject({
      availability: "unavailable",
      backgroundShellEffective: false,
      issue: { code: "DESKTOP_TRAY_UNAVAILABLE" },
    });
    expect(failed.desktopStates.at(-1)?.tray.availability).toBe("unavailable");

    const disabled = harness("win32");
    disabled.controller.update({ backgroundShell: false });
    expect(disabled.controller.keepsAliveWithoutWindows()).toBe(false);
  });

  it("keeps the macOS shell reachable through the Dock when the tray is hidden", () => {
    const h = harness("darwin");
    h.controller.update({ showTray: false });
    expect(h.controller.keepsAliveWithoutWindows()).toBe(true);
  });

  it("guards callbacks from an already-built menu as soon as quitting begins", async () => {
    const h = harness();
    const oldMenu = h.menus[0]!;
    h.controller.update({ quitting: true });
    menuItem(oldMenu, "open").click?.();
    menuItem(oldMenu, "quit").click?.();
    await Promise.resolve();
    expect(h.actions.openPrimaryWindow).not.toHaveBeenCalled();
    expect(h.actions.quit).not.toHaveBeenCalled();
  });

  it("routes Windows double-click through the same guarded open action", async () => {
    const h = harness("win32");
    h.trays[0]?.listeners.get("double-click")?.();
    await Promise.resolve();
    expect(h.actions.openPrimaryWindow).toHaveBeenCalledTimes(1);
  });

  it("disposes idempotently and cancels a pending rebuild", () => {
    const h = harness();
    h.controller.update({ link: "ready" });
    h.controller.dispose();
    h.controller.dispose();
    vi.runAllTimers();
    expect(h.trays[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(h.runtime.buildMenu).toHaveBeenCalledTimes(1);
  });
});
