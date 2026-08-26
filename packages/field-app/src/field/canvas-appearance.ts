import type { GridConfig, GridMagnetConfig } from "@vibecook/ice";
import { hexToRgb01 } from "./theme-constants";

/** Theme-aware colors used by the physical canvas surface. */
export interface CanvasPalette {
  bgLight: string;
  bgDark: string;
  dotLight: string;
  dotDark: string;
}

/** GridConfig without dotColor, which is derived from the canvas palette. */
export interface WorldGridAppearance {
  spacings: [number, number, number];
  dotAlpha: number;
  fadeIn: [number, number];
  fadeOut: [number, number];
  dotRadius: [number, number];
  levelWeight: [number, number];
  /**
   * The magnet grid (ICE design-010, ice 0.10.0): field-reactive lattice
   * behind the classic grid's interfaces. ABSENT = classic dots, byte-identical
   * to pre-0.10.0 — never write an explicit `{enabled: false}` here (ICE
   * design-010 §10.1: an explicit off block rides this spread through
   * configureGrid and clobbers any factory-level enable). The cursor pole is
   * wired unconditionally (cursor/halo-poles.ts) and inert until this enables.
   * DARK-MODE CAVEAT before enabling as product default: our dark dot ink
   * (#1C1C1C on #171717, 5/255 apart) vanishes as needles/ticks — the magnet
   * experiment used #8A8A8A-class ink in dark. Enabling magnet in dark needs
   * a palette decision (DESIGN.md governs), not just this flag.
   */
  magnet?: Partial<GridMagnetConfig>;
}

export interface CanvasAppearance {
  canvasPalette: CanvasPalette;
  worldGrid: WorldGridAppearance;
}

/**
 * The reviewed product appearance. A factory keeps design-bench edits and
 * imports isolated from the immutable defaults consumed by the app.
 */
export function defaultCanvasAppearance(): CanvasAppearance {
  return {
    canvasPalette: {
      dotLight: "#A6A6A6",
      dotDark: "#1C1C1C",
      bgLight: "#FAFAFA",
      bgDark: "#171717",
    },
    worldGrid: {
      spacings: [20, 100, 500],
      dotAlpha: 0.85,
      fadeIn: [12, 16],
      fadeOut: [120, 200],
      dotRadius: [1.5, 1.5],
      levelWeight: [1, 0],
    },
  };
}

/** Project an editable appearance onto ICE's complete live grid contract. */
export function canvasGridConfig(values: CanvasAppearance, dark: boolean): GridConfig {
  return {
    ...values.worldGrid,
    dotColor: hexToRgb01(dark ? values.canvasPalette.dotDark : values.canvasPalette.dotLight),
  };
}

/**
 * The stable grid consumed by the product renderer. `magnetDots` opts the
 * canvas into the magnet grid's DOT mode (ICE design-010; the device
 * preference lives in use-magnet-dots.ts) — sites stay on the lattice and
 * swell with the field our cursor halo drives, resting at the classic dot
 * radius. OFF omits the block entirely: absence is the off state, and an
 * explicit off block would ride this spread through `configureGrid` and
 * clobber any factory-level enable (design-010 §10.1).
 */
export function defaultCanvasGridConfig(dark: boolean, magnetDots = false): GridConfig {
  const appearance = defaultCanvasAppearance();
  if (magnetDots) {
    appearance.worldGrid.magnet = { enabled: true, glyph: "dot" };
  }
  return canvasGridConfig(appearance, dark);
}
