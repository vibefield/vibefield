import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: [] as Electron.BrowserWindowConstructorOptions[] }));
vi.mock("electron", () => ({
  BrowserWindow: class {
    webContents = { openDevTools: vi.fn() };
    setBounds = vi.fn();
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      captured.options.push(options);
    }
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }) },
}));

import { createMainWindow } from "../src/main/windows";

describe("main window branding", () => {
  beforeEach(() => {
    captured.options.length = 0;
  });

  it.each(["/resources/icons/app.ico", "/resources/icons/app-1024.png"])(
    "supplies the native window with its selected platform icon: %s",
    (iconPath) => {
      createMainWindow({ mode: "smoke", preloadPath: "/app/preload.cjs", show: false, iconPath });
      expect(captured.options[0]?.icon).toBe(iconPath);
      expect(captured.options[0]?.webPreferences).toMatchObject({
        contextIsolation: true,
        sandbox: true,
      });
    },
  );

  it("leaves macOS icon selection to its bundle and Dock path", () => {
    createMainWindow({
      mode: "smoke",
      preloadPath: "/app/preload.cjs",
      show: false,
      iconPath: null,
    });
    expect(captured.options[0]).not.toHaveProperty("icon");
  });
});
