import { DESKTOP_TRAY_GUID } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  constructed: [] as Array<{ image: unknown; guid: string | undefined }>,
  displayBounds: [{ x: 0, y: 0, width: 1728, height: 1117 }],
}));

vi.mock("electron", () => ({
  Menu: { buildFromTemplate: vi.fn((items) => items) },
  nativeImage: { createFromPath: vi.fn() },
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

import {
  classifyTrayPlacement,
  createElectronTrayRuntime,
  trayGuidForPlatform,
} from "../src/main/tray-native";

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
