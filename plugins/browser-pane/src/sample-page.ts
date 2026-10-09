// THE SAMPLE PAGE (PT-1 ruling 9; the photo's procedural `sample.ts` precedent, ICE K5b) — what a pane shows in PT-1: a
// still of the sample web's landing page (BROWSER.md §6's Lumen, "think in light"), made from arithmetic alone — no
// network, no decoder, no PNG in the bundle — so every host (the product, the Node playground's Dawn still, the tray's
// specimen) makes the same bytes. It is laid out for the pane's own VIEWPORT (a phone's narrow page stacks what a laptop's
// sets side by side) and drawn in the page's colour SCHEME, at a texel a CSS px under a cap. Its text is greeked — bars
// where the words would be — because a still of a page is a photograph of it, and the words are PT-2's live frames'.
//
// The FAVICON is the sample's mark — a disc of warm light — drawn the same way, for the head's print.

/** The longest side a page's still is drawn at, texels (a desktop's 1440 fits at a texel a CSS px). */
export const PAGE_TEXELS_MAX = 2048;

/** The texels a viewport's still is drawn at: a texel a CSS px, under the cap. */
export function pageTexels(viewport: readonly [number, number]): readonly [number, number] {
  const s = Math.min(1, PAGE_TEXELS_MAX / Math.max(viewport[0], viewport[1], 1));
  return [Math.max(1, Math.round(viewport[0] * s)), Math.max(1, Math.round(viewport[1] * s))];
}

type RGB = readonly [number, number, number];

/** The sample's colours by scheme, sRGB bytes. */
const SCHEMES: Readonly<
  Record<
    "light" | "dark",
    {
      readonly bg: RGB;
      readonly surface: RGB;
      readonly ink: RGB;
      readonly muted: RGB;
      readonly hairline: RGB;
      readonly accent: RGB;
      readonly accentSoft: RGB;
      readonly cool: RGB;
    }
  >
> = {
  light: {
    bg: [247, 245, 240],
    surface: [255, 255, 255],
    ink: [29, 31, 36],
    muted: [138, 141, 147],
    hairline: [228, 224, 216],
    accent: [242, 140, 64],
    accentSoft: [252, 228, 206],
    cool: [91, 141, 239],
  },
  dark: {
    bg: [17, 18, 20],
    surface: [29, 31, 35],
    ink: [236, 234, 228],
    muted: [112, 115, 122],
    hairline: [44, 47, 53],
    accent: [245, 160, 93],
    accentSoft: [64, 43, 28],
    cool: [120, 162, 245],
  },
};

/** A page drawn into rows of sRGB rgba8, at `s` texels per CSS px. */
class Canvas {
  readonly bytes: Uint8Array<ArrayBuffer>;
  constructor(
    readonly w: number,
    readonly h: number,
    readonly s: number,
  ) {
    this.bytes = new Uint8Array(w * h * 4);
  }

  fill(c: RGB): void {
    const b = this.bytes;
    for (let i = 0; i < b.length; i += 4) {
      b[i] = c[0];
      b[i + 1] = c[1];
      b[i + 2] = c[2];
      b[i + 3] = 255;
    }
  }

  /** Paint over a texel: `cov` of `c` (0…1), source over, in the page's own bytes (as CSS blends). */
  private over(i: number, c: RGB, cov: number): void {
    const b = this.bytes;
    const k = 1 - cov;
    b[i] = Math.round((b[i] as number) * k + c[0] * cov);
    b[i + 1] = Math.round((b[i + 1] as number) * k + c[1] * cov);
    b[i + 2] = Math.round((b[i + 2] as number) * k + c[2] * cov);
  }

  /**
   * A rounded rect in CSS px — filled (`ring` 0) or its outline `ring` px wide — in a colour, or a colour per point
   * (`shade(u, v)`, u and v 0…1 across it), at `alpha`; antialiased over a texel.
   */
  rect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    colour: RGB | ((u: number, v: number) => RGB),
    alpha = 1,
    ring = 0,
  ): void {
    const s = this.s;
    const cx = ((x0 + x1) / 2) * s;
    const cy = ((y0 + y1) / 2) * s;
    const hx = (Math.max(x1 - x0, 0) / 2) * s;
    const hy = (Math.max(y1 - y0, 0) / 2) * s;
    const r = Math.min(radius * s, hx, hy);
    const rw = (ring * s) / 2;
    const tx0 = Math.max(0, Math.floor(cx - hx - 1));
    const tx1 = Math.min(this.w, Math.ceil(cx + hx + 1));
    const ty0 = Math.max(0, Math.floor(cy - hy - 1));
    const ty1 = Math.min(this.h, Math.ceil(cy + hy + 1));
    for (let y = ty0; y < ty1; y++) {
      const py = y + 0.5 - cy;
      for (let x = tx0; x < tx1; x++) {
        const px = x + 0.5 - cx;
        const ax = Math.abs(px) - hx + r;
        const ay = Math.abs(py) - hy + r;
        const d = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - r;
        const e = ring > 0 ? Math.abs(d + rw) - rw : d;
        const cov = Math.min(Math.max(0.5 - e, 0), 1) * alpha;
        if (cov <= 0) continue;
        const c =
          typeof colour === "function"
            ? colour((px + hx) / Math.max(2 * hx, 1e-6), (py + hy) / Math.max(2 * hy, 1e-6))
            : colour;
        this.over((y * this.w + x) * 4, c, cov);
      }
    }
  }

  /** A disc in CSS px, in a colour or a colour per point. */
  disc(
    cx: number,
    cy: number,
    radius: number,
    colour: RGB | ((u: number, v: number) => RGB),
    alpha = 1,
  ): void {
    this.rect(cx - radius, cy - radius, cx + radius, cy + radius, radius, colour, alpha);
  }
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** The sample's mark: warm light, amber to rose across a disc (u, v 0…1). */
const markShade = (u: number, v: number): RGB =>
  mixRGB([255, 190, 92], [244, 96, 112], Math.min(Math.max((u + v) / 2, 0), 1));

/** The hero's picture: a sky of warm light — dawn over a soft horizon, two glows (u, v 0…1). */
function heroShade(dark: boolean): (u: number, v: number) => RGB {
  return (u, v) => {
    const top: RGB = dark ? [36, 33, 58] : [255, 214, 165];
    const low: RGB = dark ? [110, 64, 92] : [244, 132, 120];
    let c = mixRGB(top, low, Math.min(Math.max(v * 1.1, 0), 1));
    const g1 = Math.exp(-((u - 0.68) ** 2 + (v - 0.58) ** 2) * 18);
    const g2 = Math.exp(-((u - 0.25) ** 2 + (v - 0.8) ** 2) * 9) * 0.6;
    c = mixRGB(c, [255, 241, 214], Math.min(g1 * 0.9 + g2 * 0.5, 1));
    if (v > 0.74)
      c = mixRGB(c, dark ? [24, 22, 36] : [168, 92, 104], Math.min((v - 0.74) * 2.2, 0.55));
    return c;
  };
}

/**
 * The sample landing page at `viewport` (CSS px) in a scheme: sRGB rgba8, opaque, rows from the top, at `texels` (the
 * still's size — `pageTexels(viewport)` by default).
 */
export function samplePage(
  viewport: readonly [number, number],
  scheme: "light" | "dark",
  texels: readonly [number, number] = pageTexels(viewport),
): Uint8Array<ArrayBuffer> {
  const [W] = viewport;
  const C = SCHEMES[scheme];
  const cv = new Canvas(texels[0], texels[1], texels[0] / Math.max(W, 1));
  cv.fill(C.bg);
  const narrow = W < 700;
  const content = Math.min(W - (narrow ? 40 : 96), 1120);
  const left = (W - content) / 2;
  const right = left + content;

  // the nav: the mark and its name, the links (a menu's three bars when narrow), the one button
  const navH = narrow ? 56 : 68;
  cv.disc(left + 12, navH / 2, 12, markShade);
  cv.rect(left + 32, navH / 2 - 6, left + 96, navH / 2 + 6, 6, C.ink);
  if (narrow) {
    for (let i = 0; i < 3; i++)
      cv.rect(right - 22, navH / 2 - 8 + i * 7, right, navH / 2 - 6 + i * 7, 1, C.ink, 0.85);
  } else {
    let x = right - 132 - 3 * 76;
    for (let i = 0; i < 3; i++) {
      cv.rect(x, navH / 2 - 4, x + 52, navH / 2 + 4, 4, C.muted, 0.9);
      x += 76;
    }
    cv.rect(right - 112, navH / 2 - 17, right, navH / 2 + 17, 17, C.accent);
    cv.rect(right - 88, navH / 2 - 3, right - 24, navH / 2 + 3, 3, C.surface, 0.95);
  }
  cv.rect(0, navH, W, navH + 1, 0, C.hairline);

  // the hero: an eyebrow, the headline, its subhead, two buttons; the picture beside it (under it when narrow)
  const heroTop = navH + (narrow ? 32 : 72);
  const col = narrow ? content : content * 0.48;
  const big = narrow ? 24 : 34;
  cv.rect(left, heroTop, left + 150, heroTop + 24, 12, C.accentSoft);
  cv.rect(left + 12, heroTop + 9, left + 132, heroTop + 15, 3, C.accent, 0.9);
  let y = heroTop + 48;
  for (const share of [0.94, 0.72]) {
    cv.rect(left, y, left + col * share, y + big, big / 4, C.ink);
    y += big * 1.45;
  }
  y += 12;
  for (const share of [0.92, 0.86, 0.58]) {
    cv.rect(left, y, left + col * share, y + 10, 5, C.muted, 0.8);
    y += 20;
  }
  y += 20;
  cv.rect(left, y, left + 148, y + 44, 22, C.accent);
  cv.rect(left + 28, y + 19, left + 120, y + 25, 3, C.surface, 0.95);
  cv.rect(left + 164, y, left + 300, y + 44, 22, C.ink, 0.3, 1.5);
  cv.rect(left + 190, y + 19, left + 274, y + 25, 3, C.ink, 0.75);
  const pictureTop = narrow ? y + 76 : heroTop;
  const pictureLeft = narrow ? left : left + content * 0.54;
  const pictureH = narrow ? Math.min(content * 0.62, 260) : Math.min(col * 0.78, 380);
  cv.rect(pictureLeft, pictureTop, right, pictureTop + pictureH, 18, heroShade(scheme === "dark"));

  // the features: three cards in a row (stacked when narrow), each an icon, a title and two lines
  let cardTop = Math.max(y + 96, pictureTop + pictureH + 56);
  if (narrow) cardTop = pictureTop + pictureH + 40;
  const gap = 24;
  const cards = narrow ? 1 : 3;
  const cardW = (content - gap * (cards - 1)) / cards;
  const cardH = 164;
  const shades: readonly RGB[] = [C.accent, C.cool, mixRGB(C.accent, C.cool, 0.5)];
  for (let i = 0; i < 3; i++) {
    const cx = narrow ? left : left + i * (cardW + gap);
    const cy = narrow ? cardTop + i * (cardH + 20) : cardTop;
    cv.rect(cx, cy, cx + cardW, cy + cardH, 16, C.surface);
    cv.rect(cx, cy, cx + cardW, cy + cardH, 16, C.hairline, 1, 1);
    cv.rect(cx + 24, cy + 24, cx + 64, cy + 64, 12, shades[i] as RGB, 0.9);
    cv.rect(cx + 24, cy + 84, cx + 24 + cardW * 0.5, cy + 96, 6, C.ink, 0.9);
    cv.rect(cx + 24, cy + 110, cx + cardW * 0.84, cy + 118, 4, C.muted, 0.75);
    cv.rect(cx + 24, cy + 128, cx + cardW * 0.66, cy + 136, 4, C.muted, 0.75);
  }
  const foot = narrow ? cardTop + 3 * (cardH + 20) + 24 : cardTop + cardH + 56;
  cv.rect(0, foot, W, foot + 1, 0, C.hairline);
  cv.rect(left, foot + 28, left + 120, foot + 36, 4, C.muted, 0.6);
  cv.rect(right - 180, foot + 28, right, foot + 36, 4, C.muted, 0.6);
  return cv.bytes;
}

/** The sample's FAVICON: its mark on a clear ground, `size` texels square, sRGB rgba8 straight (not premultiplied). */
export function sampleFavicon(size = 32): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * size * 4);
  const c = size / 2;
  const r = (size * 11) / 24;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;
      const cov = Math.min(Math.max(0.5 - (Math.hypot(px, py) - r), 0), 1);
      const col = markShade((px + r) / (2 * r), (py + r) / (2 * r));
      const i = (y * size + x) * 4;
      out[i] = Math.round(col[0]);
      out[i + 1] = Math.round(col[1]);
      out[i + 2] = Math.round(col[2]);
      out[i + 3] = Math.round(cov * 255);
    }
  return out;
}
