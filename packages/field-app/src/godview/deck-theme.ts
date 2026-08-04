import {
  GHOSTTY_COLOR_THEMES,
  type GhostteaColorTheme,
  type GhostteaWorkspaceProps,
} from "@vibecook/ghosttea-react/workspace";
import { hexToRgb01 } from "../field/theme-constants";
import type { DeckAppearance } from "./deck-appearance";

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
// to the program running). These values give the renderer its ground, caret and
// selection; the ALPHA on that ground is what 0.9.0 turned into real
// transparency — `terminalThemeFromConfig` premultiplies the background into
// the WebGPU clear color, and the Canvas2D path now asks for an alpha context,
// so a background below 1 lets the overlay's glass through the pane itself.
// GT-3's interim screen-blend over the whole canvas is retired with it.
//
// This projection is handed to the workspace as its `theme` prop, which
// OVERRIDES the config-derived theme entirely (Workspace.tsx: `theme ??
// terminalThemeFromConfig(...)`). That is deliberate and is what makes GT-D12's
// viewer-local appearance possible at all: the colors a pane draws come from
// this viewer's own choice, not from the floor's configuration document.

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

function hex(value: string, alpha: number): Rgba {
  const [r, g, b] = hexToRgb01(value);
  return [r, g, b, alpha];
}

const WHITE: Rgba = [1, 1, 1, 1];

/** The named theme, or `undefined` for the deck's own palette. A name that no
 * longer exists in the catalog resolves to `undefined` too — a pinned catalog
 * can drop an entry between releases, and falling back to this design system is
 * a better answer than a pane with no colors. */
export function findDeckColorTheme(themeName: string | null): GhostteaColorTheme | undefined {
  if (themeName === null) return undefined;
  return GHOSTTY_COLOR_THEMES.find((theme) => theme.name === themeName);
}

/** Built per appearance, not per module: the tokens are only readable once the
 * stylesheet is in the document, and a module-scope constant would freeze
 * whatever was there at import time. */
export function godviewTerminalTheme(appearance: DeckAppearance): TerminalTheme {
  const chosen = findDeckColorTheme(appearance.themeName);
  if (chosen !== undefined) {
    // A catalog theme is a whole palette from another vocabulary, taken whole:
    // picking "Solarized Dark" and getting this app's selection color would be
    // the transcription mistake in the other direction.
    return {
      background: hex(chosen.background, appearance.opacity),
      foreground: hex(chosen.foreground, 1),
      cursor: hex(chosen.cursor, 1),
      cursorText: hex(chosen.cursorText, 1),
      selection: hex(chosen.selection, 1),
      selectionForeground: hex(chosen.selectionForeground, 1),
      backgroundOpacityCells: appearance.opacityCells,
    };
  }
  return {
    // §2.2 — the deck's own ground, now carrying the viewer's alpha. At 1 this
    // is exactly the surface GT-2 chose; below it, the same surface with the
    // stage behind it.
    background: token("--vf-card-deep", appearance.opacity),
    // §2.4 — primary text on a dark surface is white; the program's own colors
    // ride over this as they always have.
    foreground: WHITE,
    cursor: WHITE,
    // §2.5 — `--vf-select` is the selection color and ONLY the selection color.
    selection: token("--vf-select", 0.3),
    selectionForeground: WHITE,
    backgroundOpacityCells: appearance.opacityCells,
  };
}
