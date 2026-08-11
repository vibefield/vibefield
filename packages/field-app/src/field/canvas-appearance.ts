import type { GridConfig } from "@vibecook/ice";
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

/** The stable grid consumed by the product renderer. */
export function defaultCanvasGridConfig(dark: boolean): GridConfig {
  return canvasGridConfig(defaultCanvasAppearance(), dark);
}
