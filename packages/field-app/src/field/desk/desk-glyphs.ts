import { GLYPH_PAD, GLYPHS, type GlyphAtlasMeta } from "@vibecook/ice/desk";

// THE RULERS' GLYPH ATLAS (DK-3; ICE RULER.md — the reference wiring is ICE's `apps/desk/src/glyphs.ts`):
// the desk prints its rulers' labels (and a mini mat's name) from an atlas the HOST renders, here in
// the browser from the product's mono stack (`--vf-font-mono`, DESIGN.md §3) at the ratio the desk
// draws at, so a label is the text the page would set. The glyphs of `GLYPHS` sit in a row of equal
// cells, each drawn `GLYPH_PAD` texels in from its cell's left edge on a baseline `meta.baseline`
// texels under the cell's top; the bytes are the canvas's alpha (coverage — the fill never matters).
// The feed re-renders when the ratio or the text size moves (another display, the browser's zoom).

export interface GlyphAtlas {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly meta: GlyphAtlasMeta;
}

/** The mono stack the page declares — the product's token, read off the root, never a literal here. */
export const monoStack = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue("--vf-font-mono").trim() ||
  "monospace";

/** Render the atlas for a text `size` (CSS px) at `scale` texels per CSS px. */
export function makeGlyphAtlas(size: number, scale: number, family = monoStack()): GlyphAtlas {
  const em = Math.max(1, size * scale);
  const font = `400 ${em}px ${family}`;
  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d");
  if (!probe) throw new Error("desk glyphs: no 2d context");
  probe.font = font;
  const m = probe.measureText("0");
  // whole texels: the layout steps the text by `advance`, and a glyph on a whole texel samples 1:1
  const advance = Math.max(1, Math.round(m.width));
  const cap = Math.ceil(m.actualBoundingBoxAscent);
  const ascent = Math.ceil(m.fontBoundingBoxAscent);
  const descent = Math.ceil(m.fontBoundingBoxDescent);
  const cellW = advance + 2 * GLYPH_PAD;
  const cellH = ascent + descent + 2 * GLYPH_PAD;
  const baseline = GLYPH_PAD + ascent;
  const width = cellW * GLYPHS.length;
  const height = cellH;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("desk glyphs: no 2d context");
  ctx.clearRect(0, 0, width, height);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "white"; // coverage only: the alpha is what is read
  for (let i = 0; i < GLYPHS.length; i++) {
    ctx.fillText(GLYPHS[i] as string, i * cellW + GLYPH_PAD, baseline);
  }
  const img = ctx.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array(width * height);
  for (let i = 0; i < bytes.length; i++) bytes[i] = img[i * 4 + 3] as number;
  return {
    bytes,
    meta: { scale, cellW, cellH, advance, baseline, cap, width, height, count: GLYPHS.length },
  };
}

/** Texels per CSS px the desk draws at: the viewport's ratio under the layer's cap (2). */
export const deskScale = (dpr: number): number => Math.min(dpr > 0 ? dpr : 1, 2);

/** The atlas the desk prints with, kept to the ratio and the rulers' text size. */
export interface GlyphFeed {
  /** Render and upload when the ratio or the size moved since the last upload; true = uploaded. */
  refresh(): boolean;
  /** Whether the ratio or the size moved since the last upload (false before the first) — cheap. */
  stale(): boolean;
}

export interface GlyphFeedOptions {
  /** Whether the mat is here to take an upload (`handle.available()`). */
  readonly ready: () => boolean;
  /** Texels per CSS px (`deskScale` of the viewport's ratio). */
  readonly scale: () => number;
  /** The rulers' text size, CSS px — the atlas's em. */
  readonly size: () => number;
  readonly upload: (atlas: GlyphAtlas) => void;
  /** The renderer: `makeGlyphAtlas` (a test's double in Node). */
  readonly make?: (size: number, scale: number) => GlyphAtlas;
}

export function glyphFeed(opts: GlyphFeedOptions): GlyphFeed {
  const make = opts.make ?? ((size: number, scale: number) => makeGlyphAtlas(size, scale));
  let last: { readonly scale: number; readonly size: number } | null = null;
  return {
    // numbers against numbers: asked every tick, so the answer allocates nothing
    stale: () => last !== null && (opts.scale() !== last.scale || opts.size() !== last.size),
    refresh() {
      if (!opts.ready()) return false;
      const scale = opts.scale();
      const size = opts.size();
      if (last !== null && last.scale === scale && last.size === size) return false;
      opts.upload(make(size, scale));
      last = { scale, size };
      return true;
    },
  };
}
