// The same drawing as a standalone SVG string — what an export, a test and the
// phone's template assets read, so every plane draws one geometry.
import { GLYPHS, type GlyphName, type GlyphShape } from "./data";
import type { GlyphTurn } from "./FieldGlyph";

export interface GlyphSvgOptions {
  readonly size?: number;
  readonly turn?: GlyphTurn;
  readonly flip?: boolean;
  /** The paint: `currentColor` by default; a template asset wants an opaque one. */
  readonly ink?: string;
}

const attrs = (a: Readonly<Record<string, string>>): string =>
  Object.entries(a)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
const element = (s: GlyphShape): string => `<${s[0]}${attrs(s[1])}/>`;

export function glyphSvg(name: GlyphName, options: GlyphSvgOptions = {}): string {
  const { size = 24, turn = 0, flip = false, ink = "currentColor" } = options;
  const drawing = GLYPHS[name];
  const transforms: string[] = [];
  if (flip) transforms.push("matrix(-1 0 0 1 24 0)");
  if (turn !== 0) transforms.push(`rotate(${turn} 12 12)`);
  let body: string;
  if (drawing.kind === "hardware") {
    body = `<path fill="${ink}" fill-rule="evenodd" d="${drawing.d}"/>`;
  } else {
    const strokes =
      drawing.strokes.length > 0
        ? `<g fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${drawing.strokes.map(element).join("")}</g>`
        : "";
    const fills =
      drawing.fills.length > 0 ? `<g fill="${ink}">${drawing.fills.map(element).join("")}</g>` : "";
    body =
      drawing.transform === undefined
        ? `${strokes}${fills}`
        : `<g transform="${drawing.transform}">${strokes}${fills}</g>`;
  }
  const inner = transforms.length > 0 ? `<g transform="${transforms.join(" ")}">${body}</g>` : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${inner}</svg>`;
}
