// @vitest-environment happy-dom
/**
 * The theme browser's line under its stage, and Godview's built-ins' own sixteen (item 590,
 * 2026-11-19; DESIGN.md §2.7 "The terminal's own colours"). Since item 590 Godview's look brings
 * sixteen colours of its own, and a catalog theme picked for a mode brings its sixteen to that
 * mode: a colour the person set in Program colors or their own Ghostty file still wins. The
 * browser's line says so for each theme it shows.
 */
import { describe, expect, it } from "vitest";
import { GODVIEW_TERMINAL_LOOK } from "../src/godview/terminal-look";
import { themeBrowserLine } from "../src/panels/terminal/ThemeBrowser";
import { BUILTIN_THEMES } from "../src/panels/terminal/theme-view";

const SIXTEEN = Array.from(
  { length: 16 },
  (_, index) => `#0000${index.toString(16).padStart(2, "0")}`,
);

describe("the theme browser's line (item 590)", () => {
  it("says, for each theme shown, what it brings to the sixteen and what copying does", () => {
    const builtin = { catalogName: null, palette: GODVIEW_TERMINAL_LOOK.light.palette };
    const catalog = { catalogName: "iTerm2 Solarized Light", palette: SIXTEEN };
    const fewer = { catalogName: "A theme with fewer", palette: null };
    expect(themeBrowserLine(true, catalog, false)).toBe(
      "Copying sets all sixteen on this Mac, in both modes.",
    );
    expect(themeBrowserLine(false, builtin, false)).toBe(
      "Godview's own colors for this mode. A color you set in Program colors or your Ghostty file wins over them.",
    );
    expect(themeBrowserLine(false, catalog, false)).toBe(
      "Its sixteen colors come with it while Godview is in this mode; a color you set in Program colors or your Ghostty file still wins. Copy them to use them in both modes.",
    );
    expect(themeBrowserLine(false, catalog, true)).toBe(
      "This Mac already uses these colors, in both modes.",
    );
    expect(themeBrowserLine(false, fewer, false)).toBe(
      "This theme doesn't bring all sixteen program colors, so it can't be copied.",
    );
  });

  it("gives Godview's built-ins their own sixteen, the deck's look for each mode", () => {
    expect(BUILTIN_THEMES.light.palette).toEqual(GODVIEW_TERMINAL_LOOK.light.palette);
    expect(BUILTIN_THEMES.dark.palette).toEqual(GODVIEW_TERMINAL_LOOK.dark.palette);
  });
});
