import { hexToRgb255 } from "./theme-constants";

/**
 * Live renderer tuning that belongs to the development surface, not Settings.
 *
 * Keeping the whole document in one value gives import/reset one atomic seam
 * and makes it impossible for the file format to omit a control accidentally.
 */
export interface CanvasPalette {
  bgLight: string;
  bgDark: string;
  dotLight: string;
  dotDark: string;
}

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

/** GridConfig without dotColor, which is derived from the canvas palette. */
export interface WorldGridTuning {
  spacings: [number, number, number];
  dotAlpha: number;
  fadeIn: [number, number];
  fadeOut: [number, number];
  dotRadius: [number, number];
  levelWeight: [number, number];
}

export interface VisualTweakValues {
  canvasPalette: CanvasPalette;
  worldGrid: WorldGridTuning;
  overlapFeedback: OverlapFeedbackTuning;
}

/** A factory, rather than a shared mutable object, for React state and resets. */
export function defaultVisualTweakValues(): VisualTweakValues {
  return {
    canvasPalette: {
      dotLight: "#BFC4CC",
      dotDark: "#595E66",
      bgLight: "#FAFAFA",
      bgDark: "#171717",
    },
    worldGrid: {
      spacings: [20, 100, 500],
      dotAlpha: 1,
      fadeIn: [8, 16],
      fadeOut: [120, 200],
      dotRadius: [0.75, 0.75],
      levelWeight: [1, 0],
    },
    overlapFeedback: {
      colors: {
        glowLight: "#808080",
        glowDark: "#FFFFFF",
        rimLight: "#808080",
        rimDark: "#FFFFFF",
      },
      glowAlpha: [0.25, 0.45],
      glowSize: [60, 80],
      rimWidth: 1,
      rimAlpha: [0.3, 0.5],
      rimRadius: 40,
    },
  };
}

/** Pure projection used by BootRoot and tests; one entry per live CSS seam. */
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
