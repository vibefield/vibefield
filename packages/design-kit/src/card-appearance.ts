/** Theme-aware colors for CardShell's overlap feedback. */
export interface OverlapFeedbackColors {
  glowLight: string;
  glowDark: string;
  rimLight: string;
  rimDark: string;
}

/** Product-owned tuning for the candidate (`c`) and target (`t`) overlap tiers. */
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

/**
 * The reviewed CardShell appearance. CSS tokens mirror this value so normal
 * app rendering and the UI Bench reset to the same product defaults.
 */
export const OVERLAP_FEEDBACK_DEFAULTS = {
  colors: {
    glowLight: "#FFFFFF",
    glowDark: "#6E6E6E",
    rimLight: "#E0E0E0",
    rimDark: "#5C5C5C",
  },
  glowAlpha: [0.25, 0.5],
  glowSize: [60, 60],
  rimAlpha: [0.55, 0.85],
  rimWidth: 1.5,
  rimRadius: 600,
} as const;

/** Return isolated editable values for consumers such as the UI Bench. */
export function defaultOverlapFeedbackTuning(): OverlapFeedbackTuning {
  return {
    colors: { ...OVERLAP_FEEDBACK_DEFAULTS.colors },
    glowAlpha: [...OVERLAP_FEEDBACK_DEFAULTS.glowAlpha],
    glowSize: [...OVERLAP_FEEDBACK_DEFAULTS.glowSize],
    rimAlpha: [...OVERLAP_FEEDBACK_DEFAULTS.rimAlpha],
    rimWidth: OVERLAP_FEEDBACK_DEFAULTS.rimWidth,
    rimRadius: OVERLAP_FEEDBACK_DEFAULTS.rimRadius,
  };
}
