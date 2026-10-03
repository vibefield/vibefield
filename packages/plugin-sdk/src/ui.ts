// The design kit, as SDK re-exports (§11.3: design-kit primitives reach
// plugins THROUGH the SDK — never a direct @vibefield/design-kit dependency).
// CURATED, not `export *`: host-side registry writes (setPreviewBackground)
// and spine internals stay out; what's here is exactly the surface the shipped
// plugins render with. Growing this list is a deliberate SDK change.

export {
  CARD_RADIUS,
  CardShell,
  EmptyState,
  type GradientStop,
  InlineNotice,
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
} from "@vibefield/design-kit";
// The GL-card surface rides the kit's dedicated /gl entry (2026-08-28: kept
// out of the kit's root barrel so DOM-only consumers never reach three/R3F).
// The SDK door re-exports it unchanged — plugin imports stay exactly as they
// were; a plugin that mounts GL cards is a lazy chunk and pays for the 3D
// world only when it loads.
export { GlLiftGroup, makeGlCardChrome } from "@vibefield/design-kit/gl";
// The chrome's glyph set (DESIGN.md §13) rides the kit's dedicated /glyphs leaf;
// a plugin draws its icons with the same drawings the shell does, through this door.
export {
  FieldGlyph,
  type FieldGlyphProps,
  GLYPH_NAMES,
  type GlyphName,
  glyphSvg,
} from "@vibefield/design-kit/glyphs";
