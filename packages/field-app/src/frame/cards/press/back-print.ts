import { drawMark } from "./back-mark";
import type { PressColours } from "./press-colours";
import { CARD_DESIGN, PRESS } from "./press-numbers";

/**
 * THE BACK'S PRINTS (CS-D6 C, "Pressed"; DESIGN.md §5 "the press"): what the press lights for a card's back. The field
 * is sage inside the margin, with one cream rule. The mark is pressed into the stock with no ink, its three lights
 * printed. There are three prints at `scale` px a design unit: its colour, its mask (G glossy ink, B the lights' glow)
 * and its height (R, the pressed band), which the press turns into the deboss. Every colour is a token's, handed in by
 * the press as the root held it (§5 "Its colours are tokens").
 */

export type PressSurface = OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface BackPrints {
  readonly color: PressSurface;
  readonly mask: PressSurface;
  readonly height: PressSurface;
}

/** The height print's two levels, the stock flat (R 0) and the band pressed (R 1): data the shader reads, never a colour
 * anyone sees. */
const RELIEF = { flat: "black", pressed: "white" } as const;

/** The mask's lights: glossy (G 150) and glowing (B 255), data the shader reads, never a colour anyone sees. */
const LIGHTS_MASK = "rgb(0,150,255)";

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The signed distance to a rounded rectangle centred on the card, design units. PURE. */
export function sdCard(x: number, y: number, inset: number, r: number): number {
  const { width: W, height: H } = CARD_DESIGN;
  const qx = Math.abs(x - W / 2) - (W / 2 - inset) + r;
  const qy = Math.abs(y - H / 2) - (H / 2 - inset) + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function surface(width: number, height: number): PressSurface {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

const context = (s: PressSurface): Ctx2D => {
  const ctx = (s as { getContext(id: "2d"): Ctx2D | null }).getContext("2d");
  if (ctx === null) throw new Error("the press has no 2D canvas for the back's prints");
  return ctx;
};

/** One pass over every pixel: the margin, the field and the frame's rule. */
function backPixels(color: Ctx2D, mask: Ctx2D, scale: number, colours: PressColours): void {
  const { width: W, height: H } = CARD_DESIGN;
  const { back } = PRESS;
  const w = Math.round(W * scale);
  const h = Math.round(H * scale);
  const cimg = color.createImageData(w, h);
  const mimg = mask.createImageData(w, h);
  const C = cimg.data;
  const M = mimg.data;
  const paper = colours.paper;
  const ground = colours.field;
  const cream = colours.rule;
  const px = 1 / scale;
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const x = (i + 0.5) * px;
      const y = (j + 0.5) * px;
      const o = (j * w + i) * 4;
      const dIn = sdCard(x, y, back.inset, back.corner);
      const inField = 1 - sstep(-0.5 * px, 0.5 * px, dIn);
      // the frame's rule, inside the field's edge
      const frame = 1 - sstep(0.16, 0.16 + 1.2 * px, Math.abs(dIn + back.rule));
      const ink = frame * 0.88;
      for (let ch = 0; ch < 3; ch += 1) {
        const g = ground[ch] ?? 0;
        const field = g + ((cream[ch] ?? 0) - g) * ink;
        const p = paper[ch] ?? 0;
        C[o + ch] = Math.round(p + (field - p) * inField);
      }
      C[o + 3] = 255;
      M[o] = 0;
      M[o + 1] = 0;
      M[o + 2] = 0;
      M[o + 3] = 255;
    }
  }
  color.putImageData(cimg, 0, 0);
  mask.putImageData(mimg, 0, 0);
}

/** `paint` drawn into `g` softened by `blur` design units: a shadow cast from a copy far off the canvas. */
function blurInto(g: Ctx2D, scale: number, paint: (g: Ctx2D) => void, blur: number): void {
  const off = 40000;
  g.save();
  g.shadowColor = RELIEF.pressed;
  g.shadowBlur = blur * scale;
  g.shadowOffsetX = off;
  g.translate(-off / scale, 0);
  paint(g);
  g.restore();
}

/** The back's three prints at `scale` px a design unit, in the press's colours. */
export function paintBack(
  scale: number,
  colours: PressColours,
  make: (w: number, h: number) => PressSurface = surface,
): BackPrints {
  const { width: W, height: H } = CARD_DESIGN;
  const w = Math.round(W * scale);
  const h = Math.round(H * scale);
  const color = make(w, h);
  const mask = make(w, h);
  const height = make(w, h);
  const cx = context(color);
  const mx = context(mask);
  const hx = context(height);
  backPixels(cx, mx, scale, colours);
  hx.fillStyle = RELIEF.flat;
  hx.fillRect(0, 0, w, h);
  for (const g of [cx, mx, hx]) g.setTransform(scale, 0, 0, scale, 0, 0);
  const mid = { x: W / 2, y: H / 2 };
  const mw = PRESS.back.mark;
  // pressed, never inked: the band is relief alone, a little darker where the stock is pressed
  drawMark(cx, mid.x, mid.y, mw, { band: colours.deboss, hair: 0.3 });
  blurInto(
    hx,
    scale,
    (g) => drawMark(g, mid.x, mid.y, mw, { band: RELIEF.pressed, hair: 0.5 }),
    0.32,
  );
  // the lights, each in its token's colour (a light the press holds no colour for is not drawn)
  drawMark(cx, mid.x, mid.y, mw, {
    lights: 1,
    lightInk: (token) => colours.lights.get(token) ?? "transparent",
  });
  // the lights in the mask: glossy, and glowing a little by night
  drawMark(mx, mid.x, mid.y, mw, { lights: 1, lightInk: () => LIGHTS_MASK });
  return { color, mask, height };
}
