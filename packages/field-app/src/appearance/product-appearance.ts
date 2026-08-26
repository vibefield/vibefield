import {
  defaultOverlapFeedbackTuning,
  type OverlapFeedbackTuning,
} from "@vibefield/design-kit/card-appearance";
import { type CanvasAppearance, defaultCanvasAppearance } from "../field/canvas-appearance";
import { hexToRgb255 } from "./color";

export type {
  OverlapFeedbackColors,
  OverlapFeedbackTuning,
} from "@vibefield/design-kit/card-appearance";
export type {
  CanvasPalette,
  MagnetGridAppearance,
  WorldGridAppearance,
} from "../field/canvas-appearance";

/**
 * Complete product appearance shared by the app, Studio, import/export codec,
 * and deterministic specimens. Keeping the document atomic makes a partial
 * preview or import impossible by construction.
 */
export interface ProductAppearance extends CanvasAppearance {
  overlapFeedback: OverlapFeedbackTuning;
}

/** A factory, rather than a shared mutable object, for React state and resets. */
export function defaultProductAppearance(): ProductAppearance {
  const canvas = defaultCanvasAppearance();
  return {
    ...canvas,
    overlapFeedback: defaultOverlapFeedbackTuning(),
  };
}

/** Pure CSS projection used by both the product shell and Studio specimens. */
export function productAppearanceCssVariables(
  values: ProductAppearance,
  dark: boolean,
): Record<string, string> {
  const { canvasPalette, overlapFeedback } = values;
  return {
    "--vf-canvas-bg": dark ? canvasPalette.bgDark : canvasPalette.bgLight,
    "--ic-glow-color": hexToRgb255(
      dark ? overlapFeedback.colors.glowDark : overlapFeedback.colors.glowLight,
    ),
    "--ic-rim-color": hexToRgb255(
      dark ? overlapFeedback.colors.rimDark : overlapFeedback.colors.rimLight,
    ),
    "--ic-glow-size-c": `${overlapFeedback.glowSize[0]}px`,
    "--ic-glow-size-t": `${overlapFeedback.glowSize[1]}px`,
    "--ic-glow-alpha-c": String(overlapFeedback.glowAlpha[0]),
    "--ic-glow-alpha-t": String(overlapFeedback.glowAlpha[1]),
    "--ic-rim-alpha-c": String(overlapFeedback.rimAlpha[0]),
    "--ic-rim-alpha-t": String(overlapFeedback.rimAlpha[1]),
    "--ic-rim-width": `${overlapFeedback.rimWidth}px`,
    "--ic-rim-radius": `${overlapFeedback.rimRadius}px`,
  };
}
