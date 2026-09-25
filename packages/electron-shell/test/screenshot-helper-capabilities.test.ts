import { describe, expect, it, vi } from "vitest";
import { screenshotHelperSupportsService } from "../src/main/screenshot-helper-capabilities";

describe("staged screenshot helper capabilities", () => {
  it("requires the bundle itself to advertise service version 1", () => {
    const read = vi.fn(
      () => "<dict><key>VFScreenshotServiceVersion</key>\n<integer>1</integer></dict>",
    );
    expect(screenshotHelperSupportsService("/app/Contents/MacOS/helper", read)).toBe(true);
    expect(read).toHaveBeenCalledWith("/app/Contents/Info.plist");
    expect(screenshotHelperSupportsService("/old/helper", () => "<dict></dict>")).toBe(false);
    expect(
      screenshotHelperSupportsService(
        "/future/helper",
        () => "<key>VFScreenshotServiceVersion</key><integer>2</integer>",
      ),
    ).toBe(false);
  });

  it("does not prewarm a missing helper or an unreadable capability", () => {
    const read = vi.fn(() => {
      throw new Error("missing");
    });
    expect(screenshotHelperSupportsService(null, read)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(screenshotHelperSupportsService("/missing/helper", read)).toBe(false);
  });
});
