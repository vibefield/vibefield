import { describe, expect, it, vi } from "vitest";
import { applyDevelopmentDockIcon } from "../src/main/app-branding";

const resources = {
  packaged: false,
  developmentDockIconPath: "/repo/apps/desktop/packaging/icons/app-macos-1024.png",
};

describe("development Dock branding", () => {
  it("applies the checked Icon Composer rendition to raw Electron.app on macOS", () => {
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 1024, height: 1024 }),
    };
    const dock = { setIcon: vi.fn() };
    expect(
      applyDevelopmentDockIcon(resources, {
        platform: "darwin",
        dock,
        loadImage: vi.fn(() => image),
      }),
    ).toEqual({
      status: "applied",
      path: resources.developmentDockIconPath,
      width: 1024,
      height: 1024,
    });
    expect(dock.setIcon).toHaveBeenCalledWith(image);
  });

  it("never overrides bundle-owned packaged identity or another platform", () => {
    const loadImage = vi.fn();
    const dock = { setIcon: vi.fn() };
    expect(
      applyDevelopmentDockIcon(
        { packaged: true, developmentDockIconPath: null },
        { platform: "darwin", dock, loadImage },
      ),
    ).toEqual({ status: "not-applicable" });
    expect(applyDevelopmentDockIcon(resources, { platform: "win32", dock, loadImage })).toEqual({
      status: "not-applicable",
    });
    expect(loadImage).not.toHaveBeenCalled();
    expect(dock.setIcon).not.toHaveBeenCalled();
  });

  it("fails visibly instead of installing an empty development image", () => {
    expect(() =>
      applyDevelopmentDockIcon(resources, {
        platform: "darwin",
        dock: { setIcon: vi.fn() },
        loadImage: () => ({
          isEmpty: () => true,
          getSize: () => ({ width: 0, height: 0 }),
        }),
      }),
    ).toThrow(/empty or unreadable/);
  });
});
