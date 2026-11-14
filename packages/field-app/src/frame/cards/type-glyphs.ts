import type { ChipType } from "@vibefield/contracts";
import type { GlyphName } from "@vibefield/design-kit/glyphs";

/** The glyph each of the six types wears (DESIGN.md §13 "The six types", CS-D10 A): on a card's head and along its
 * foot, on its chip in a message, and on its bloom's buds once the bloom comes (OB-1b). */
export const TYPE_GLYPH: Readonly<Record<ChipType, GlyphName>> = {
  text: "type-text",
  image: "type-image",
  file: "document",
  link: "link",
  session: "agents",
  ref: "type-ref",
};
