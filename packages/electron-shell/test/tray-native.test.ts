import { DESKTOP_TRAY_GUID } from "@vibefield/contracts";
import { nativeImage, nativeTheme } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  constructed: [] as Array<{ image: unknown; guid: string | undefined }>,
  displayBounds: [{ x: 0, y: 0, width: 1728, height: 1117 }],
}));

vi.mock("electron", () => ({
  Menu: { buildFromTemplate: vi.fn((items) => items) },
  nativeImage: { createFromPath: vi.fn() },
  nativeTheme: {
    shouldUseDarkColors: false,
    shouldUseDarkColorsForSystemIntegratedUI: false,
    on: vi.fn(),
    off: vi.fn(),
  },
  screen: {
    getAllDisplays: () => electron.displayBounds.map((bounds) => ({ bounds })),
    on: vi.fn(),
    off: vi.fn(),
  },
  Tray: class {
    constructor(image: unknown, guid?: string) {
      electron.constructed.push({ image, guid });
    }
    getBounds() {
      return { x: 1200, y: 4, width: 34, height: 24 };
    }
  },
}));

import { resolvePackagedResources } from "../src/main/resources";
import {
  classifyTrayPlacement,
  createElectronTrayRuntime,
  loadTrayImage,
  trayGuidForPlatform,
} from "../src/main/tray-native";

describe("reviewed tray artwork", () => {
  const resources = resolvePackagedResources({
    resourcesPath: "/app/resources",
    electronExecPath: "/app/VibeField",
    platform: "win32",
  });
  const theme = nativeTheme as {
    shouldUseDarkColors: boolean;
    shouldUseDarkColorsForSystemIntegratedUI: boolean;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    theme.shouldUseDarkColors = false;
    theme.shouldUseDarkColorsForSystemIntegratedUI = false;
    vi.mocked(nativeImage.createFromPath).mockImplementation(
      () =>
        ({
          isEmpty: () => false,
          setTemplateImage: vi.fn(),
        }) as unknown as Electron.NativeImage,
    );
  });

  it("loads both Retina representations and marks macOS artwork as a template", () => {
    const image = loadTrayImage(resources.tray, "attention", "darwin");
    expect(nativeImage.createFromPath).toHaveBeenNthCalledWith(
      1,
      resources.tray.attention.macTemplate1x,
    );
    expect(nativeImage.createFromPath).toHaveBeenNthCalledWith(
      2,
      resources.tray.attention.macTemplate2x,
    );
    expect(image.setTemplateImage).toHaveBeenCalledWith(true);
  });

  it("uses the Windows system theme even when the application's theme differs", () => {
    theme.shouldUseDarkColorsForSystemIntegratedUI = true;
    loadTrayImage(resources.tray, "update", "win32");
    expect(nativeImage.createFromPath).toHaveBeenLastCalledWith(
      resources.tray.update.windowsDarkIco,
    );
    theme.shouldUseDarkColors = true;
    theme.shouldUseDarkColorsForSystemIntegratedUI = false;
    loadTrayImage(resources.tray, "update", "win32");
    expect(nativeImage.createFromPath).toHaveBeenLastCalledWith(resources.tray.update.windowsIco);
  });

  it("selects both Linux appearances while preserving the offline state", () => {
    loadTrayImage(resources.tray, "offline", "linux");
    expect(nativeImage.createFromPath).toHaveBeenLastCalledWith(resources.tray.offline.linuxPng);
    theme.shouldUseDarkColors = true;
    loadTrayImage(resources.tray, "offline", "linux");
    expect(nativeImage.createFromPath).toHaveBeenLastCalledWith(
      resources.tray.offline.linuxDarkPng,
    );
  });

  it("removes the system appearance subscription on teardown and lets AppKit tint macOS", () => {
    const callback = vi.fn();
    const stop = createElectronTrayRuntime(resources, "win32").watchAppearance(callback);
    expect(nativeTheme.on).toHaveBeenCalledWith("updated", callback);
    stop();
    expect(nativeTheme.off).toHaveBeenCalledWith("updated", callback);
    vi.mocked(nativeTheme.on).mockClear();
    createElectronTrayRuntime(resources, "darwin").watchAppearance(callback)();
    expect(nativeTheme.on).not.toHaveBeenCalled();
  });
});

describe("native tray identity and placement", () => {
  beforeEach(() => {
    electron.constructed.length = 0;
  });

  it("uses the frozen GUID on macOS but does not burn the unsigned Windows slot", () => {
    expect(trayGuidForPlatform("darwin")).toBe(DESKTOP_TRAY_GUID);
    expect(trayGuidForPlatform("win32")).toBeNull();
    expect(trayGuidForPlatform("linux")).toBeNull();

    const runtime = createElectronTrayRuntime({ tray: {} as never }, "darwin");
    const image = {};
    runtime.createTray(image);
    expect(electron.constructed).toEqual([{ image, guid: DESKTOP_TRAY_GUID }]);
  });

  it("recognizes a visible status item by its center point", () => {
    expect(
      classifyTrayPlacement({ x: 1200, y: 4, width: 34, height: 24 }, [
        { x: 0, y: 0, width: 1728, height: 1117 },
      ]),
    ).toBe("visible");
  });

  it("recognizes AppKit's edge-parked overflow item as offscreen", () => {
    expect(
      classifyTrayPlacement({ x: -1, y: 1116, width: 34, height: 24 }, [
        { x: 0, y: 0, width: 1728, height: 1117 },
      ]),
    ).toBe("offscreen");
  });

  it("stays honest when native geometry has not settled", () => {
    expect(
      classifyTrayPlacement({ x: 0, y: 0, width: 0, height: 0 }, [
        { x: 0, y: 0, width: 1728, height: 1117 },
      ]),
    ).toBe("unknown");
  });
});
