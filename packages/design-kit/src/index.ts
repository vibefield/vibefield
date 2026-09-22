export { CARD_BG, CARD_RADIUS, CardShell, LIFT_OPACITY, RING_COLOR } from "./CardShell";
export {
  defaultOverlapFeedbackTuning,
  OVERLAP_FEEDBACK_DEFAULTS,
  type OverlapFeedbackColors,
  type OverlapFeedbackTuning,
} from "./card-appearance";
// The GL-card surface (GlLiftGroup, makeGlCardChrome) lives in "./gl" — its
// runtime @vibecook/ice/r3f import reaches three/R3F, and this barrel stays
// GL-free by construction so a boot-reachable import can never pull the 3D
// world (2026-08-28; the 2026-08-10 splash-bundle incident's class).
export {
  FACE_THRESHOLDS,
  faceLiftHostClass,
  faceTilt,
  stickerEdgePx,
  type UserFaceFrame,
  UserFaceView,
  type UserFaceViewProps,
} from "./face";
export { previewBackground, setPreviewBackground } from "./preview";
export {
  EmptyState,
  InlineNotice,
  PlaceholderFace,
  SegmentedControl,
  StatusDot,
  UiButton,
  type UiButtonVariant,
  UiIconButton,
  UiPill,
  UiSwitch,
  UnavailableState,
  uiButtonClass,
  uiFieldClass,
  uiIconButtonClass,
  uiLabelClass,
} from "./primitives";
export { useDragLift } from "./use-drag-lift";
export { type GradientStop, gradientCss } from "./visuals";
