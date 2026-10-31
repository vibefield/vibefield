import type { DesktopShellState } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type NativeTrayPort,
  TrayController,
  type TrayControllerActions,
  type TrayNativeState,
  type TrayPlacement,
  type TrayRuntime,
  trayImageKind,
} from "../src/main/tray-controller";
import type {
  TrayMenuItem,
  TrayPlatform,
  TraySnapshot,
  TrayUpdateState,
} from "../src/main/tray-model";

class FakeTray implements NativeTrayPort {
  readonly setImage = vi.fn();
  readonly setToolTip = vi.fn();
  readonly setContextMenu = vi.fn();
  readonly destroy = vi.fn();
  readonly listeners = new Map<string, () => void>();

  on(event: "click" | "double-click" | "mouse-enter", listener: () => void): void {
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
  initialPlacement: TrayPlacement = "visible",
  extraActions: Partial<TrayControllerActions> = {},
) {
  const trays: FakeTray[] = [];
  const menus: (readonly TrayMenuItem[])[] = [];
  const nativeStates: TrayNativeState[] = [];
  let placement = initialPlacement;
  let displayCallback: (() => void) | null = null;
  const stopDisplayObservation = vi.fn();
  const runtime: TrayRuntime = {
    platform,
    guid: platform === "darwin" ? "c524c40e-05b6-4d89-bbb9-82ba4e97ea91" : null,
    loadImage: vi.fn((kind) => ({ kind })),
    inspectImage: vi.fn(() => ({
      sourcePath: "/tray/fieldTemplate.png",
      width: 16,
      height: 16,
      scaleFactors: [1, 2],
      template: platform === "darwin",
    })),
    createTray: vi.fn(() => {
      if (failCreate) throw new Error("desktop has no tray implementation");
      const tray = new FakeTray();
      trays.push(tray);
      return tray;
    }),
    inspectTray: vi.fn(() => ({
      bounds:
        placement === "offscreen"
          ? { x: -1, y: 1116, width: 34, height: 24 }
          : { x: 1200, y: 4, width: 34, height: 24 },
      displayBounds: [{ x: 0, y: 0, width: 1728, height: 1117 }],
      placement,
    })),
    watchDisplays: vi.fn((callback) => {
      displayCallback = callback;
      return stopDisplayObservation;
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
    ...extraActions,
  };
  const onError = vi.fn();
  const desktopStates: DesktopShellState[] = [];
  const controller = new TrayController({
    runtime,
    initial: snapshot(initial),
    actions,
    onError,
    onNativeState: (state) => nativeStates.push(state),
    onDesktopState: (state) => desktopStates.push(state),
  });
  return {
    controller,
    runtime,
    actions,
    onError,
    trays,
    menus,
    desktopStates,
    nativeStates,
    stopDisplayObservation,
    setPlacement(next: TrayPlacement) {
      placement = next;
    },
    emitDisplayChange() {
      displayCallback?.();
    },
  };
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
    expect(h.nativeStates[0]).toMatchObject({
      reason: "created",
      image: {
        sourcePath: "/tray/fieldTemplate.png",
        width: 16,
        height: 16,
        scaleFactors: [1, 2],
      },
      native: { placement: "visible" },
    });
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

  it("reports a real-but-offscreen macOS status item without calling creation a failure", () => {
    const h = harness("darwin", false, {}, "offscreen");
    expect(h.controller.isUsable()).toBe(true);
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.controller.desktopState().tray).toMatchObject({
      availability: "available",
      placement: "offscreen",
      issue: { code: "DESKTOP_TRAY_OFFSCREEN" },
    });
  });

  it("rechecks placement after display changes without polling", () => {
    const h = harness("darwin", false, {}, "offscreen");
    h.setPlacement("visible");
    h.emitDisplayChange();
    vi.advanceTimersByTime(249);
    expect(h.controller.desktopState().tray.placement).toBe("offscreen");
    vi.advanceTimersByTime(1);
    expect(h.controller.desktopState().tray.placement).toBe("visible");
    expect(h.controller.desktopState().tray.issue).toBeNull();
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

  it("wears the update image while an install waits, and drops it when the update goes (AU-4)", () => {
    const h = harness("darwin", false, { link: "ready" });
    h.controller.update({
      update: { kind: "staged", version: "2.0.0", sessions: 0, applyWired: true },
    });
    vi.advanceTimersByTime(100);
    expect(h.trays[0]?.setImage).toHaveBeenLastCalledWith({ kind: "update" });
    h.controller.update({ update: { kind: "idle" } });
    vi.advanceTimersByTime(100);
    expect(h.trays[0]?.setImage).toHaveBeenLastCalledWith({ kind: "base" });
  });

  it("routes Download Update through the same guarded actions, with its version (AU-4)", async () => {
    const downloadUpdate = vi.fn(async (_version: string) => {});
    const h = harness("darwin", false, {}, "visible", { downloadUpdate });
    h.controller.update({
      update: { kind: "available", version: "2.0.0", declined: false, enabled: false },
    });
    vi.advanceTimersByTime(100);
    menuItem(h.menus.at(-1)!, "update").click?.();
    await Promise.resolve();
    expect(downloadUpdate).toHaveBeenCalledWith("2.0.0");
    // a menu built before the quit began acts on nothing after it
    const before = h.menus.at(-1)!;
    h.controller.update({ quitting: true });
    menuItem(before, "update").click?.();
    await Promise.resolve();
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("disposes idempotently and cancels a pending rebuild", () => {
    const h = harness();
    h.controller.update({ link: "ready" });
    h.controller.dispose();
    h.controller.dispose();
    vi.runAllTimers();
    expect(h.trays[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(h.runtime.buildMenu).toHaveBeenCalledTimes(1);
    expect(h.stopDisplayObservation).toHaveBeenCalledTimes(1);
  });
});

// AU-4 (AU-G14) — the attention badge keeps ONE meaning (a degraded service or a failed check); an install that
// waits on the person wears the update image of its own, and only where an apply exists.
describe("trayImageKind", () => {
  const staged = (applyWired?: boolean): TrayUpdateState => ({
    kind: "staged",
    version: "2.0.0",
    sessions: 0,
    ...(applyWired === undefined ? {} : { applyWired }),
  });
  const snap = (patch: Partial<TraySnapshot>) => snapshot({ link: "ready", ...patch });

  it.each([
    ["an install waits", { update: staged(true) }, "update"],
    ["staged where no apply exists", { update: staged(false) }, "base"],
    ["staged from an older caller", { update: staged() }, "base"],
    ["a failed check", { update: { kind: "failed" } }, "attention"],
    [
      "a degraded service, over a waiting install",
      { evidence: "degraded", update: staged(true) },
      "attention",
    ],
    [
      "no service, over a waiting install",
      { link: "unavailable", update: staged(true) },
      "offline",
    ],
    ["at rest", {}, "base"],
    [
      "a found update with updates off",
      { update: { kind: "available", version: "2.0.0", declined: false, enabled: false } },
      "base",
    ],
  ] as const)("%s", (_case, patch, kind) => {
    expect(trayImageKind(snap(patch))).toBe(kind);
  });
});
