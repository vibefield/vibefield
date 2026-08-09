import { type CanvasAppearance, defaultCanvasAppearance } from "../../field/canvas-appearance";
import { hexToRgb255 } from "../../field/theme-constants";

export type { CanvasPalette, WorldGridAppearance } from "../../field/canvas-appearance";

/**
 * Editable appearance data owned by the isolated design bench, not the app.
 *
 * Keeping the whole document in one value gives import/reset one atomic seam
 * and makes it impossible for the file format to omit a control accidentally.
 */
export interface OverlapFeedbackColors {
  glowLight: string;
  glowDark: string;
  rimLight: string;
  rimDark: string;
}

export interface OverlapFeedbackTuning {
  colors: OverlapFeedbackColors;
  /** Candidate first, overlap target second. */
  glowAlpha: [number, number];
  /** Candidate first, overlap target second. */
  glowSize: [number, number];
  /** Candidate first, overlap target second. */
  rimAlpha: [number, number];
  rimWidth: number;
  rimRadius: number;
}

export interface VisualTweakValues extends CanvasAppearance {
  overlapFeedback: OverlapFeedbackTuning;
}

/** A factory, rather than a shared mutable object, for React state and resets. */
export function defaultVisualTweakValues(): VisualTweakValues {
  const canvas = defaultCanvasAppearance();
  return {
    ...canvas,
    overlapFeedback: {
      colors: {
        glowLight: "#808080",
        glowDark: "#FFFFFF",
        rimLight: "#808080",
        rimDark: "#FFFFFF",
      },
      // Match design-kit/tokens.css exactly. The retired in-app panel used a
      // second set of defaults, so development and packaged builds disagreed.
      glowAlpha: [0.25, 0.25],
      glowSize: [60, 60],
      rimWidth: 1.5,
      rimAlpha: [0.55, 0.85],
      rimRadius: 600,
    },
  };
}

/** Pure, scoped projection used by the design-bench workbench and tests. */
export function visualTweakCssVariables(
  values: VisualTweakValues,
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
