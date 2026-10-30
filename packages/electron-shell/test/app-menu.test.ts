import type { MenuItemConstructorOptions } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  },
}));

vi.mock("electron", () => electron);

import { installAppMenu } from "../src/main/app-menu";
import { CLOSE_WINDOW_ITEM_ID, SETTINGS_ITEM_ID, UPDATE_ITEM_ID } from "../src/main/app-menu-model";

// AU-4 — the adapter keeps the last state and takes a patch: the view and the
// deck (one window's facts) and the update item (the updater's) are three
// owners of one menu, and a redraw by one must never wipe another's part.

const flatten = (items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((item) => [item, ...flatten(Array.isArray(item.submenu) ? item.submenu : [])]);

/** The template the last `setApplicationMenu` was handed (the fake builder returns it as is). */
const lastMenu = (): readonly MenuItemConstructorOptions[] =>
  flatten(electron.Menu.setApplicationMenu.mock.lastCall?.[0] as MenuItemConstructorOptions[]);

const byId = (id: string) => lastMenu().find((item) => item.id === id);

describe("installAppMenu (AU-4)", () => {
  beforeEach(() => {
    electron.Menu.buildFromTemplate.mockClear();
    electron.Menu.setApplicationMenu.mockClear();
  });

  it("installs at once, on the canvas, with no update item said yet", () => {
    installAppMenu("darwin", {});
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(byId(CLOSE_WINDOW_ITEM_ID)).toMatchObject({ role: "close" });
    expect(byId(UPDATE_ITEM_ID)).toMatchObject({ label: "Check for Updates…", enabled: false });
  });

  it("keeps the view and the deck when the update item redraws, and the update when they do", () => {
    const redraw = installAppMenu("darwin", { closeWindow: () => undefined });
    redraw({ view: "godview", deck: "up" });
    // ⌘W lent to the deck's panes: the close item carries no role
    expect(byId(CLOSE_WINDOW_ITEM_ID)?.role).toBeUndefined();
    const restart = () => undefined;
    redraw({ update: { label: "Restart to Update", enabled: true, click: restart } });
    expect(byId(CLOSE_WINDOW_ITEM_ID)?.role).toBeUndefined();
    expect(byId(UPDATE_ITEM_ID)).toMatchObject({ label: "Restart to Update", enabled: true });
    redraw({ view: "history", deck: null });
    expect(byId(CLOSE_WINDOW_ITEM_ID)).toMatchObject({ role: "close" });
    expect(byId(UPDATE_ITEM_ID)).toMatchObject({ label: "Restart to Update", enabled: true });
    expect(byId(UPDATE_ITEM_ID)?.click).toBe(restart);
  });

  it("hands Settings… its reveal", () => {
    const openSettings = vi.fn();
    installAppMenu("darwin", { openSettings });
    expect(byId(SETTINGS_ITEM_ID)).toMatchObject({
      label: "Settings…",
      accelerator: "CommandOrControl+,",
    });
    (byId(SETTINGS_ITEM_ID)?.click as (() => void) | undefined)?.();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
