// The design kit, as SDK re-exports (§11.3: design-kit primitives reach
// plugins THROUGH the SDK — never a direct @vibefield/design-kit dependency).
// CURATED, not `export *`: host-side registry writes (setPreviewBackground)
// and spine internals stay out; what's here is exactly the surface the shipped
// plugins render with. Growing this list is a deliberate SDK change.
//
// DK-2 (desk/landing, ICE 0.14.0): the CARD FACE half is CUT — `CardShell` and
// `useDragLift` (they lifted a DOM card under the camera through ICE's removed
// `WidgetHiddenContext`) and the GL card surface `GlLiftGroup`/`makeGlCardChrome`
// (ICE's R3F islands — its `/r3f` entry — are gone). The desk draws every
// object under the camera; a plugin's canvas face is an object KIND
// (`contributes.objects`, the `/desk` door at DK-6). The primitives below are
// screen-space chrome and stay.

export {
  CARD_RADIUS,
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
} from "@vibefield/design-kit";
// The chrome's glyph set (DESIGN.md §13) rides the kit's dedicated /glyphs leaf;
// a plugin draws its icons with the same drawings the shell does, through this door.
export {
  FieldGlyph,
  type FieldGlyphProps,
  GLYPH_NAMES,
  type GlyphName,
  glyphSvg,
} from "@vibefield/design-kit/glyphs";
