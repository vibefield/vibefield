import type { GhostteaWorkspaceProps } from "@vibecook/ghosttea-react/workspace";
import { hexToRgb01 } from "../field/theme-constants";

// The deck's palette, READ FROM THE TOKENS rather than transcribed.
//
// Ghosttea ships `TERMINAL_THEMES.midnight`, which is Ghostty's One Dark
// (`#282c34`) — a color from another design system, and DESIGN.md §1 is explicit
// that the control room "may commit to dark" but that "its palette still derives
// from §2". Transcribing token hexes into float tuples here would satisfy the
// letter and break the spirit: the numbers would drift the first time §2 moved.
// So the values come out of the live custom properties, which is what
// `--vf-*` being the single source actually means (§10).
//
// Terminal TEXT is not ours to color (§3: it belongs to Ghosttea's renderer and
// to the program running). What these five values set is the surface the text
// sits on, the caret, and the selection — chrome, in other words.

type TerminalTheme = NonNullable<GhostteaWorkspaceProps["theme"]>;
type Rgba = TerminalTheme["background"];

/** A `--vf-*` hex token as the renderer's float tuple. An absent token pads to
 * black, which for a terminal surface is a safe floor rather than a surprise. */
function token(name: string, alpha: number): Rgba {
  const value =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const [r, g, b] = hexToRgb01(value);
  return [r, g, b, alpha];
}

const WHITE: Rgba = [1, 1, 1, 1];

/** Built per mount, not per module: the tokens are only readable once the
 * stylesheet is in the document, and a module-scope constant would freeze
 * whatever was there at import time. */
export function godviewTerminalTheme(): TerminalTheme {
  return {
    // §2.2 — `--vf-card-deep` is the surface for data-dense content, and a
    // terminal is the densest thing this app draws.
    background: token("--vf-card-deep", 1),
    // §2.4 — primary text on a dark surface is white; the program's own colors
    // ride over this as they always have.
    foreground: WHITE,
    cursor: WHITE,
    // §2.5 — `--vf-select` is the selection color and ONLY the selection color.
    selection: token("--vf-select", 0.3),
    selectionForeground: WHITE,
  };
}
