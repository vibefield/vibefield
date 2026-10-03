// The chrome's glyph — DESIGN.md §13. One drawing per meaning, in a 24-unit box,
// painted in `currentColor` and nothing else; the host says the size and the
// colour, the way it says them for text. Turns and the flip are the only
// variation: a chevron is drawn pointing right, redo is undo flipped.
import { type CSSProperties, createElement, type ReactElement } from "react";
import { GLYPHS, type GlyphName, type GlyphShape } from "./data";

export type GlyphTurn = 0 | 90 | 180 | 270;

export interface FieldGlyphProps {
  readonly name: GlyphName;
  /** The rendered box in CSS px; the 24-unit drawing scales to it. */
  readonly size?: number;
  /** Quarter turns clockwise. */
  readonly turn?: GlyphTurn;
  /** Mirror left to right. */
  readonly flip?: boolean;
  /** Give a glyph that stands alone its name; inside a labelled control leave it
   * out and the glyph is decorative (`aria-hidden`). */
  readonly label?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const shape = (s: GlyphShape, key: number): ReactElement => createElement(s[0], { ...s[1], key });

export function FieldGlyph({
  name,
  size = 20,
  turn = 0,
  flip = false,
  label,
  className,
  style,
}: FieldGlyphProps): ReactElement {
  const drawing = GLYPHS[name];
  const transforms: string[] = [];
  if (flip) transforms.push("matrix(-1 0 0 1 24 0)");
  if (turn !== 0) transforms.push(`rotate(${turn} 12 12)`);
  const body =
    drawing.kind === "hardware" ? (
      <path fill="currentColor" fillRule="evenodd" d={drawing.d} />
    ) : (
      <g transform={drawing.transform}>
        {drawing.strokes.length > 0 && (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {drawing.strokes.map(shape)}
          </g>
        )}
        {drawing.fills.length > 0 && <g fill="currentColor">{drawing.fills.map(shape)}</g>}
      </g>
    );
  return (
    <svg
      className={className === undefined ? "vf-glyph" : `vf-glyph ${className}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      data-glyph={name}
    >
      {transforms.length > 0 ? <g transform={transforms.join(" ")}>{body}</g> : body}
    </svg>
  );
}
