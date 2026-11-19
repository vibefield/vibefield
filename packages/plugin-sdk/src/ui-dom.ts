// The DOM door (item 570, 2026-11-19): the design kit's glyphs and control classes for a plugin that draws its own DOM
// (an object's dialog through `ObjectDomHost`) and has no React. `./ui` carries the kit's React primitives as .tsx
// source, which a plugin with no `jsx` in its tsconfig cannot type-check through (TS6142); this door reaches no .tsx,
// only the glyphs' SVG leaf (DESIGN.md §13, the same drawings `FieldGlyph` draws) and the classes' own module.
// CURATED, as `./ui` is: growing (or shrinking) this list is a deliberate SDK change.
export {
  GLYPH_NAMES,
  type GlyphName,
  type GlyphSvgOptions,
  type GlyphTurn,
  glyphSvg,
} from "@vibefield/design-kit/glyphs/svg";
export {
  uiButtonClass,
  uiFieldClass,
  uiIconButtonClass,
  uiLabelClass,
} from "@vibefield/design-kit/primitive-classes";
