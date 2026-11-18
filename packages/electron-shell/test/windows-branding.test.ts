import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { createMainWindow, loadRenderer } from "../src/main/windows";

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

describe("preview batching on the canvas window", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["production", "dev"] as const)(
    "uses automatic preview batching and supports explicit overrides in %s",
    async (mode) => {
      const win = createMainWindow({ mode, preloadPath: "/app/preload.cjs", show: false });
      const load = vi.fn<(href: string) => Promise<void>>().mockResolvedValue(undefined);
      win.loadURL = load;
      const vite = "http://localhost:5173/?existing=1";
      vi.stubEnv("VF_SIMULATOR_PREVIEW_BATCHING", undefined);
      await loadRenderer(win, mode, vite);
      vi.stubEnv("VF_SIMULATOR_PREVIEW_BATCHING", "1");
      await loadRenderer(win, mode, vite);
      vi.stubEnv("VF_SIMULATOR_PREVIEW_BATCHING", "0");
      await loadRenderer(win, mode, vite);
      const urls = load.mock.calls.map(([href]) => new URL(href));
      expect(urls.map((url) => url.searchParams.get("simulatorPreviewBatch"))).toEqual([
        null,
        "1",
        "0",
      ]);
      if (mode === "dev")
        expect(urls.every((url) => url.searchParams.get("existing") === "1")).toBe(true);
    },
  );
});
