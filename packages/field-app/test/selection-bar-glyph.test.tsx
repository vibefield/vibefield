/**
 * DK-11 — A KIND'S GLYPH ON THE BAR (field/desk/bar/KindGlyph.tsx; DESIGN.md §13 "ICE's glyph names, mapped", R2,
 * MC-D8). ICE's names draw from the set BY THE TABLE — `chevron-left` the chevron turned 180, `redo` the undo flipped,
 * `lock`/`unlock` the tape and the lift — never by a guess; a kind's own `{ path }` is drawn by the bar's ONE path
 * renderer in the 24-unit box, stroked 2 in the bar's ink (or filled); a name the set lacks draws `missing` and is
 * said once.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ICE_GLYPHS,
  KindGlyph,
  kindGlyphOf,
  resetKindGlyphsForTest,
} from "../src/field/desk/bar/KindGlyph";
import { getRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetKindGlyphsForTest();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const draw = (glyph: Parameters<typeof KindGlyph>[0]["glyph"], label = "An act"): SVGSVGElement => {
  act(() => root.render(createElement(KindGlyph, { glyph, label })));
  const svg = host.querySelector("svg");
  if (svg === null) throw new Error("no glyph drawn");
  return svg;
};

describe("a kind's glyph on the bar (R2)", () => {
  it("maps ICE's names by §13's table — turned and flipped where the set draws a meaning once", () => {
    expect(kindGlyphOf("chevron-left")).toEqual({ by: "set", name: "chevron", turn: 180 });
    expect(kindGlyphOf("redo")).toEqual({ by: "set", name: "undo", flip: true });
    expect(kindGlyphOf("lock")).toEqual({ by: "set", name: "tape" });
    expect(kindGlyphOf("unlock")).toEqual({ by: "set", name: "lift" });
    expect(Object.keys(ICE_GLYPHS).sort()).toEqual(
      [
        "agents",
        "check",
        "chevron",
        "chevron-left",
        "duplicate",
        "ellipsis",
        "eraser",
        "lock",
        "pen",
        "redo",
        "today",
        "trash",
        "undo",
        "unlock",
      ].sort(),
    );
    expect(draw("chevron-left").getAttribute("data-glyph")).toBe("chevron");
    expect(draw("unlock").getAttribute("data-glyph")).toBe("lift");
  });

  it("draws a kind's own drawing through the ONE path renderer: the 24-unit box, stroked 2 in currentColor — or filled", () => {
    const stroked = draw({ path: "M12 21a8 8 0 1 0 0-16" });
    expect(stroked.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(stroked.getAttribute("width")).toBe("16");
    expect(stroked.getAttribute("data-glyph")).toBe("kind");
    const path = stroked.querySelector("path");
    expect(path?.getAttribute("d")).toBe("M12 21a8 8 0 1 0 0-16");
    expect(path?.getAttribute("stroke")).toBe("currentColor");
    expect(path?.getAttribute("stroke-width")).toBe("2");
    expect(path?.getAttribute("fill")).toBe("none");
    const filled = draw({ path: "M0 0h24v24H0z", fill: true }).querySelector("path");
    expect(filled?.getAttribute("fill")).toBe("currentColor");
    expect(filled?.getAttribute("fill-rule")).toBe("evenodd");
    expect(filled?.hasAttribute("stroke")).toBe(false);
  });

  it("draws a name the set lacks as `missing` — never another glyph — and says it ONCE", () => {
    const warn = vi.fn();
    const logger = getRendererLogger();
    vi.spyOn(logger, "child").mockReturnValue({ ...logger, warn } as never);
    expect(draw("stopwatch", "Seconds hand").getAttribute("data-glyph")).toBe("missing");
    draw("stopwatch", "Seconds hand");
    draw("stopwatch", "Lap");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[2]).toEqual({ glyph: "stopwatch", act: "Seconds hand" });
  });
});
