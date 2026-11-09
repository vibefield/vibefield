import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { ReactElement } from "react";

/**
 * THE PAPER CARD (CS-D12 E, ruled by James 2026-11-09; DESIGN.md §13): Make a card wears the thing it makes, a tiny card
 * in the hand's own stock with the live object's mark printed on it. The one thing on the chrome that is not a glyph: the
 * only paper on the glass. Decoration beside the button's word, so it says nothing to a screen reader.
 */
export function PaperCard(): ReactElement {
  return (
    <span className="vf-paper-card" aria-hidden="true">
      <FieldGlyph name="type-ref" size={9} />
    </span>
  );
}
