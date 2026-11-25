// A FACE OF THE TESTS' OWN in the kit's `ice-hand/1` (IK, 2026-11-25): every printable ASCII letter one small box of ink — its
// edge at the box, its arrival running left to right — so the pad's pen road has a face to write in with no baker and no
// file. Read back through the kit's own reader (`readHandAtlas`), so a fixture the reader would refuse fails here first.
// What a glyph looks like is the kit's to hold (its own fixture and the desk's baked faces); the pad's rows hold what the pad
// does with a face: its road, its run, its moments, its marks and its wash.
import { type HandAtlas, readHandAtlas } from "@vibefield/plugin-sdk/desk";

/** Texels per em, and one glyph's box (texels): the ink fills it, the pen's origin on its baseline at its left edge. */
const EM = 16;
const BOX = { w: 8, h: 12, baseline: 10 } as const;

/**
 * The face: `ascent` 0.8 em, `descent` 0.25; every code point from `!` to `~` a glyph advancing half an em over the one box (no
 * kerning); the space an inkless glyph; nothing else — a letter past ASCII (an emoji, CJK) is one the face lacks.
 */
export function fixtureFace(): HandAtlas {
  const glyphs: Record<string, unknown> = {
    "32": { advance: 0.3, length: 0, strokes: [] },
  };
  for (let code = 33; code <= 126; code += 1)
    glyphs[String(code)] = {
      advance: 0.5,
      rect: [0, 0, BOX.w, BOX.h],
      origin: [0, BOX.baseline],
      length: 0.5,
      strokes: [[0.05, -0.3, 0.45, -0.3]],
    };
  const bin = new Uint8Array(BOX.w * BOX.h * 2);
  for (let y = 0; y < BOX.h; y += 1)
    for (let x = 0; x < BOX.w; x += 1) {
      const i = 2 * (y * BOX.w + x);
      bin[i] = 255; // inside the ink
      bin[i + 1] = Math.round((255 * x) / (BOX.w - 1)); // written left to right
    }
  const atlas = readHandAtlas(
    {
      format: "ice-hand/1",
      family: "Pad Test",
      weight: 400,
      em: EM,
      range: 0.25,
      ascent: 0.8,
      descent: 0.25,
      width: BOX.w,
      height: BOX.h,
      glyphs,
      kerning: {},
      source: { file: "pad-test.ttf", sha256: "0".repeat(64) },
      corrections: [],
    },
    bin,
  );
  if ("error" in atlas) throw new Error(`the test face: ${atlas.error}`);
  return atlas;
}
