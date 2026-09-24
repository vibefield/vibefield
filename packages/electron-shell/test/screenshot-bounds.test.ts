import type { ScreenshotCaptureOk } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { withScreenshotScreenBounds } from "../src/main/screenshot-bounds";

const shot: ScreenshotCaptureOk = {
  status: "ok",
  path: "/tmp/still.png",
  width: 600,
  height: 400,
  scale: 2,
  displayId: 42,
  bounds: { x: 100, y: 50, width: 300, height: 200 },
};

describe("screenshot coordinates across displays", () => {
  it.each([
    [
      { x: 0, y: 0, width: 1440, height: 900 },
      { x: 100, y: 650, width: 300, height: 200 },
    ],
    [
      { x: -1920, y: 120, width: 1920, height: 1080 },
      { x: -1820, y: 950, width: 300, height: 200 },
    ],
    [
      { x: 240, y: -1080, width: 1920, height: 1080 },
      { x: 340, y: -250, width: 300, height: 200 },
    ],
  ])(
    "maps Cocoa-local points on a Retina primary, left or upper display",
    (displayBounds, expected) => {
      const convert = vi.fn();
      const result = withScreenshotScreenBounds(
        shot,
        "darwin",
        [{ id: 42, bounds: displayBounds }],
        convert,
      );
      expect(result).toMatchObject({ bounds: shot.bounds, screenBounds: expected });
      expect(convert).not.toHaveBeenCalled();
    },
  );

  it("lets Electron convert Windows physical pixels relative to the actual monitor", () => {
    const bounds = { x: -2300, y: 100, width: 600, height: 400 };
    const dip = { x: -1533, y: 67, width: 400, height: 267 };
    const convert = vi.fn(() => dip);
    expect(withScreenshotScreenBounds({ ...shot, bounds }, "win32", [], convert)).toMatchObject({
      screenBounds: dip,
    });
    expect(convert).toHaveBeenCalledWith(bounds);
  });

  it("omits the mapping for a disconnected display instead of trusting a helper extension", () => {
    const result = withScreenshotScreenBounds(
      { ...shot, screenBounds: shot.bounds },
      "darwin",
      [],
      vi.fn(),
    );
    expect(result).not.toHaveProperty("screenBounds");
    expect(withScreenshotScreenBounds({ status: "cancel" }, "darwin", [], vi.fn())).toEqual({
      status: "cancel",
    });
  });
});
