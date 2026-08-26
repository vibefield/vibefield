import type { GridConfig, GridMagnetConfig } from "@vibecook/ice";
import { hexToRgb01 } from "../appearance/color";

/** Theme-aware colors used by the physical canvas surface. */
export interface CanvasPalette {
  bgLight: string;
  bgDark: string;
  dotLight: string;
  dotDark: string;
  /**
   * The selected magnet grid's dark glyph ink (DESIGN.md §2.1, 2026-08-25).
   * `dotDark` remains the alternate classic implementation's reviewed ink;
   * renderer selection itself is build-time in ICE 0.11.0.
   */
  magnetDotDark: string;
}

/** Shared grid tuning without implementation selection or palette-derived ink. */
export interface WorldGridAppearance {
  spacings: [number, number, number];
  dotAlpha: number;
  fadeIn: [number, number];
  fadeOut: [number, number];
  dotRadius: [number, number];
  levelWeight: [number, number];
}

/** The complete tuning contract of ICE's build-selected magnet grid. */
export type MagnetGridAppearance = GridMagnetConfig;

export interface CanvasAppearance {
  canvasPalette: CanvasPalette;
  worldGrid: WorldGridAppearance;
  magnetGrid: MagnetGridAppearance;
}

/** Glyph tuning exposed by the build-selected magnet implementation. */
export type MagnetGridGlyph = "dot" | "needle";

/**
 * The reviewed product appearance. A factory keeps design-bench edits and
 * imports isolated from the immutable defaults consumed by the app.
 */
export function defaultCanvasAppearance(): CanvasAppearance {
  return {
    canvasPalette: {
      dotLight: "#A6A6A6",
      dotDark: "#1C1C1C",
      magnetDotDark: "#8A8A8A",
      bgLight: "#FAFAFA",
      bgDark: "#171717",
    },
    worldGrid: {
      spacings: [25, 50, 100],
      dotAlpha: 1,
      fadeIn: [20, 30],
      fadeOut: [90, 100],
      dotRadius: [1.5, 1.5],
      levelWeight: [1, 0],
    },
    magnetGrid: {
      glyph: "dot",
      reach: 60,
      polarity: 1,
      widgets: true,
      widgetStrength: 0.1,
      widgetRadius: 12,
      alwaysAlign: false,
      needleLength: 5,
      needleWidth: 0.55,
      maxSources: 256,
      fadeZoom: 0,
    },
  };
}

/**
 * Project editable appearance onto ICE's complete live grid contract.
 *
 * ICE 0.11.0 selects the magnet implementation at build time. Vibe Field lets
 * the viewer tune that implementation's dot/needle glyph while keeping the
 * renderer fixed, and uses the selected implementation's legible dark ink.
 */
export function canvasGridConfig(
  values: CanvasAppearance,
  dark: boolean,
  glyph: MagnetGridGlyph = values.magnetGrid.glyph,
): GridConfig {
  return {
    ...values.worldGrid,
    dotColor: hexToRgb01(dark ? values.canvasPalette.magnetDotDark : values.canvasPalette.dotLight),
    magnet: { ...values.magnetGrid, glyph },
  };
}

/** Stable magnet grid consumed by product and design-bench renderers. */
export function defaultCanvasGridConfig(dark: boolean, glyph: MagnetGridGlyph = "dot"): GridConfig {
  return canvasGridConfig(defaultCanvasAppearance(), dark, glyph);
}
