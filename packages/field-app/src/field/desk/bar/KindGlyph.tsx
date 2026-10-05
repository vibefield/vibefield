import type { HeldGlyph } from "@vibecook/ice";
import { FieldGlyph, type GlyphName, type GlyphTurn } from "@vibefield/design-kit/glyphs";
import type { ReactElement } from "react";
import { getRendererLogger } from "../../../logging";

// A KIND'S GLYPH ON THE BAR (DK-11; DESIGN.md §13 "ICE's glyph names, mapped", R2; MC-D8). A kind declares an act's
// (or a tool's) glyph as data — `HeldGlyph = string | { path, fill? }` — and the chrome draws it from the set BY
// THIS TABLE, never by a guess: ICE's names map to the set's drawings (turned or flipped where the set draws one
// meaning once); a kind's own drawing — SVG path data in the set's 24-unit box — is drawn by the bar's ONE path
// renderer below, stroked 2 in the bar's ink as the set's Instrument glyphs are (`currentColor`, round caps and
// joins), or filled; and a name the set lacks draws `missing` and is said once, never another glyph. This file is
// that one renderer: the glyph test's allow-list names it, and nothing else in product code draws an inline svg
// for a kind (§13: "the bar's ONE path renderer for a kind's own drawing … one component, allow-listed").

/** §13's table: ICE's glyph names → the set's drawing, its turn and its flip. */
export const ICE_GLYPHS: Readonly<
  Record<string, { readonly name: GlyphName; readonly turn?: GlyphTurn; readonly flip?: boolean }>
> = {
  chevron: { name: "chevron" },
  "chevron-left": { name: "chevron", turn: 180 },
  undo: { name: "undo" },
  redo: { name: "undo", flip: true },
  pen: { name: "pen" },
  eraser: { name: "eraser" },
  today: { name: "today" },
  duplicate: { name: "duplicate" },
  lock: { name: "tape" },
  unlock: { name: "lift" },
  trash: { name: "trash" },
  agents: { name: "agents" },
  ellipsis: { name: "ellipsis" },
  check: { name: "check" },
};

/** The names already said missing (R2: said once — a kind's declaration error, not a look). */
const saidMissing = new Set<string>();

/** Say once that a kind named a glyph the set does not hold. */
function sayMissing(name: string, label: string): void {
  if (saidMissing.has(name)) return;
  saidMissing.add(name);
  getRendererLogger()
    .child({ component: "canvas.desk.bar" })
    .warn("renderer.desk.glyph-missing", "A kind named a glyph the set does not hold", {
      glyph: name,
      act: label,
    });
}

/** What the bar draws for a kind's glyph: the set's name (mapped), its own drawing, or `missing`. */
export type KindGlyphDrawn =
  | {
      readonly by: "set";
      readonly name: GlyphName;
      readonly turn?: GlyphTurn;
      readonly flip?: boolean;
    }
  | { readonly by: "path"; readonly path: string; readonly fill: boolean }
  | { readonly by: "missing"; readonly name: string };

/** §13's rule, pure: a drawing, a mapped name, or `missing` for a name the table lacks. */
export function kindGlyphOf(glyph: HeldGlyph): KindGlyphDrawn {
  if (typeof glyph !== "string") return { by: "path", path: glyph.path, fill: glyph.fill === true };
  const mapped = ICE_GLYPHS[glyph];
  return mapped === undefined ? { by: "missing", name: glyph } : { by: "set", ...mapped };
}

export function KindGlyph({
  glyph,
  label,
  size = 16,
}: {
  readonly glyph: HeldGlyph;
  /** The act's label — what a missing name is said with. */
  readonly label: string;
  readonly size?: number;
}): ReactElement {
  const drawn = kindGlyphOf(glyph);
  if (drawn.by === "set") {
    return (
      <FieldGlyph
        name={drawn.name}
        size={size}
        {...(drawn.turn === undefined ? {} : { turn: drawn.turn })}
        {...(drawn.flip === undefined ? {} : { flip: drawn.flip })}
      />
    );
  }
  if (drawn.by === "missing") {
    sayMissing(drawn.name, label);
    return <FieldGlyph name="missing" size={size} />;
  }
  // THE ONE PATH RENDERER: the kind's own drawing in the 24-unit box, in the bar's ink and nothing else
  return (
    <svg
      className="vf-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-glyph="kind"
    >
      {drawn.fill ? (
        <path d={drawn.path} fill="currentColor" fillRule="evenodd" />
      ) : (
        <path
          d={drawn.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** Test seam: no name said yet. */
export function resetKindGlyphsForTest(): void {
  saidMissing.clear();
}
