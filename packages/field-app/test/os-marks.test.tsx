// @vitest-environment happy-dom
/**
 * LP-4 (2026-11-05, the 0.9 launch) — THE MAC WEARS A COMPUTER. The device chip's OS marks are
 * their owners' marks, kept exact (DESIGN.md §13), except the Mac's: Apple's logo is Apple's to
 * license, and App Review (guideline 5.2.5) refuses an app that borrows it, so the Mac's mark is
 * a plain laptop in the `unknown` screen's construction. These rows hold the shipping `OsMark`
 * to that: the laptop drawn, Apple's apple never, the name a screen reader hears unchanged.
 * (`pnpm check:ios-fixtures` holds the phone's `OSMarks.xcassets` copy to the same path.)
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OS_LABEL, OsMark } from "../src/godview/os-marks";

/** The first segment of Simple Icons' `apple` path, the mark this chip wore until LP-4. */
const APPLE_LOGO_PREFIX = "M12.152 6.896";

const OSES = ["macos", "windows", "linux", "unknown"] as const;

function mark(os: (typeof OSES)[number]): SVGPathElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<OsMark os={os} size={11} />);
  const svg = host.querySelector("svg");
  if (svg === null) throw new Error(`no <svg> for ${os}`);
  expect(svg.getAttribute("data-os")).toBe(os);
  expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  const path = svg.querySelector("path");
  if (path === null) throw new Error(`no <path> for ${os}`);
  return path;
}

describe("the device chip's OS marks", () => {
  it("draws the Mac as a laptop in the unknown screen's construction, never Apple's logo", () => {
    const macos = mark("macos");
    const d = macos.getAttribute("d") ?? "";
    expect(d.startsWith(APPLE_LOGO_PREFIX)).toBe(false);
    expect(d).toBe(
      "M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9H4ZM6 6.5v7h12v-7ZM2 17h20v1a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18Z",
    );
    // One evenodd silhouette, the screen's hole cut by the rule (no mask, no second path).
    expect(macos.getAttribute("fill-rule")).toBe("evenodd");
    expect(macos.getAttribute("fill")).toBe("currentColor");
    // Its absolute moves stay in the glyph law's live area, 2 to 22.
    for (const [, x, y] of d.matchAll(/M(-?\d*\.?\d+) (-?\d*\.?\d+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(2);
      expect(Number(x)).toBeLessThanOrEqual(22);
      expect(Number(y)).toBeGreaterThanOrEqual(2);
      expect(Number(y)).toBeLessThanOrEqual(22);
    }
  });

  it("never draws Apple's logo for any platform", () => {
    for (const os of OSES) {
      expect((mark(os).getAttribute("d") ?? "").includes(APPLE_LOGO_PREFIX)).toBe(false);
    }
  });

  it("keeps the Mac distinct from a desktop whose platform is not said", () => {
    expect(mark("macos").getAttribute("d")).not.toBe(mark("unknown").getAttribute("d"));
  });

  it("still names the Mac's system to a screen reader", () => {
    expect(OS_LABEL.macos).toBe("macOS");
    expect(OS_LABEL.unknown).toBe("a desktop");
  });
});
