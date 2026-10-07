// The design kit, as SDK re-exports (§11.3: design-kit primitives reach
// plugins THROUGH the SDK — never a direct @vibefield/design-kit dependency).
// CURATED, not `export *`: host-side writes and spine internals stay out;
// what's here is exactly the surface the shipped plugins render with. Growing
// (or shrinking) this list is a deliberate SDK change. DK-13: `previewBackground`
// — the widget era's preview-silhouette read, never written since DK-8 retired
// the widget rows' `preview` — left with the Objects sheet that read it; an
// object's specimen is its kind's own drawing on the desk's pegboard.
//
// DK-2 cut this door's card face half (the DOM card and the GL card surface it lifted), and DK-17
// its last two card exports — the card's corner radius and its content gradient's stop type — with
// the design kit's card dressing (the retire table's design-kit and SDK rows). The desk draws every
// object under the camera; a plugin's canvas face is an object KIND (`contributes.objects`, the
// `/desk` door). The primitives below are screen-space chrome — the HUD surface kit — and stay.

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
