import {
  GHOSTTY_COLOR_THEMES,
  type GhostteaColorTheme,
  type GhostteaWorkspaceProps,
  TERMINAL_THEMES,
} from "@vibecook/ghosttea-react/workspace";
import { hexToRgb01 } from "../field/theme-constants";
import { type DeckAppearance, deckThemeNameForMode } from "./deck-appearance";
import type { GodviewTheme } from "./GodviewTuningPanel";

// The deck's terminal palette projection. Each Godview mode resolves its OWN
// catalog selection; without one it uses the exact Daylight/Midnight terminal
// palette from the Chopsticks reference rather than borrowing the other mode's
// choice.
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

function hex(value: string, alpha: number): Rgba {
  const [r, g, b] = hexToRgb01(value);
  return [r, g, b, alpha];
}

/** The named theme, or `undefined` for the deck's own palette. A name that no
 * longer exists in the catalog resolves to `undefined` too — a pinned catalog
 * can drop an entry between releases, and falling back to this design system is
 * a better answer than a pane with no colors. */
export function findDeckColorTheme(themeName: string | null): GhostteaColorTheme | undefined {
  if (themeName === null) return undefined;
  return GHOSTTY_COLOR_THEMES.find((theme) => theme.name === themeName);
}

/** Built per appearance so the current mode's independent catalog choice and
 * the shared renderer-native alpha are projected together. */
export function godviewTerminalTheme(
  appearance: DeckAppearance,
  godviewTheme: GodviewTheme = "light",
): TerminalTheme {
  const chosen = findDeckColorTheme(deckThemeNameForMode(appearance, godviewTheme));
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
  const reference = godviewTheme === "dark" ? TERMINAL_THEMES.midnight : TERMINAL_THEMES.daylight;
  return {
    ...reference,
    // Keep VibeField's renderer-native pane alpha while taking every color from
    // the exact light/dark terminal palettes used by the reference app.
    background: [
      reference.background[0],
      reference.background[1],
      reference.background[2],
      appearance.opacity,
    ],
    backgroundOpacityCells: appearance.opacityCells,
  };
}
