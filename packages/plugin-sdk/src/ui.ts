// The design kit, as SDK re-exports (§11.3: design-kit primitives reach
// plugins THROUGH the SDK — never a direct @vibefield/shell-ui dependency).
// CURATED, not `export *`: host-side registry writes (setPreviewBackground)
// and spine internals stay out; what's here is exactly the surface the shipped
// plugins render with. Growing this list is a deliberate SDK change.

export {
  CARD_RADIUS,
  CardShell,
  EmptyState,
  GlLiftGroup,
  type GradientStop,
  InlineNotice,
  makeGlCardChrome,
  PlaceholderFace,
  previewBackground,
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
  useDragLift,
} from "@vibefield/shell-ui";
