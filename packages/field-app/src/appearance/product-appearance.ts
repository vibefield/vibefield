import { type CanvasAppearance, defaultCanvasAppearance } from "../field/canvas-appearance";

export type { CanvasPalette } from "../field/canvas-appearance";

/**
 * Complete product appearance shared by the app, Studio, import/export codec,
 * and deterministic specimens. Keeping the document atomic makes a partial
 * preview or import impossible by construction. DK-17: the plain ground's palette
 * alone — the magnet and world grid's tuning left with the 0.11 ground, and the DOM
 * card's overlap feedback (the `--ic-*` glow and rim) with the card itself (the
 * retire table's design-kit row): the desk draws every object under the camera.
 */
export type ProductAppearance = CanvasAppearance;

/** A factory, rather than a shared mutable object, for React state and resets. */
export function defaultProductAppearance(): ProductAppearance {
  return defaultCanvasAppearance();
}

/** Pure CSS projection used by both the product shell and Studio specimens. */
export function productAppearanceCssVariables(
  values: ProductAppearance,
  dark: boolean,
): Record<string, string> {
  const { canvasPalette } = values;
  return {
    "--vf-canvas-bg": dark ? canvasPalette.bgDark : canvasPalette.bgLight,
  };
}
