// THE HEAD'S ENGRAVING, DRAWN (BROWSER.md §4; the prototype's lab/browser-band.ts `drawBand`, moved) — what is cut into
// the clear glass at the head of a pane, rasterised by Canvas 2D (the desk's text stack: design-015 §6.1 — the
// platform's shaping and fonts, laid into a texture) and laid over the head by the pass, which frosts the glass wherever
// the raster says. Drawn in the pane's own world units under one transform, at the band ladder's density (head.ts
// `bandFor`), so it is crisp at any zoom and re-made only when what it says or the band changes — never per frame.
//
// It is ENGRAVED, as a laser engraves acrylic: back ‹ and forward › (a hairline where there is nowhere to go), reload ↻
// (✕ while loading), the viewport at the right — the dev browser's size readout, which is also what a resize reads — and
// the ADDRESS FIELD: a capsule frosted whole, the address cut back out of it to clear glass, so the letters are the mat
// seen through the pane. One thing is PRINTED, in colour, on the capsule: the page's favicon. A narrow pane (a phone's)
// carries the capsule alone.
//
// THE SERVICE (PT-1 ruling 8): the plugin's DOM half lends `headRaster()` under `HEAD_RASTER` wherever the platform has
// an OffscreenCanvas (the product's renderer); the same `drawHead` makes the committed raster a Node still draws
// (scripts/make-head-still.ts), on a Node canvas.

import { PROMPT } from "./address";
import { engraveSplit, GUTTER, type HeadRaster, type HeadState, headSize } from "./head";
import { bandLayout, type PaneShape } from "./law";
import type { HeadBitmap } from "./layout";
import { sampleFavicon } from "./sample-page";

const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`;
const MONO = `ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace`;

/** The Canvas 2D a head is drawn with — the browser's OffscreenCanvas's, or a Node canvas's (the maker script's). */
export type HeadContext = Pick<
  OffscreenCanvasRenderingContext2D,
  | "setTransform"
  | "clearRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "roundRect"
  | "fill"
  | "arc"
  | "closePath"
  | "measureText"
  | "fillText"
  | "save"
  | "restore"
  | "clip"
  | "drawImage"
  | "getImageData"
> & {
  globalCompositeOperation: string;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

/** A canvas a head is drawn on: resized to fit, its 2D context. */
export interface HeadCanvas {
  width: number;
  height: number;
}

/** Cut a pane's head into `canvas` (resized to fit) at `tpu` texels per world unit; `favicon` is the print's picture, or null. */
export function drawHead(
  canvas: HeadCanvas,
  ctx: HeadContext,
  S: PaneShape,
  st: HeadState,
  tpu: number,
  favicon: CanvasImageSource | null,
): { readonly width: number; readonly height: number } {
  const L = bandLayout(S);
  const hx = S.half[0];
  const top = -S.half[1];
  const { width, half, height } = headSize(S, tpu);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  const mm = L.glyph / 4.2;
  // the engraving: coverage in alpha, the pane's own frame
  const sx = width / (2 * hx);
  const sy = half / (S.band - top);
  ctx.setTransform(sx, 0, 0, sy, hx * sx, -top * sy);
  ctx.strokeStyle = "white";
  ctx.fillStyle = "white";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const chevron = (c: readonly [number, number], dir: -1 | 1, on: boolean) => {
    ctx.globalAlpha = on ? 1 : 0.34;
    ctx.lineWidth = 0.42 * mm;
    ctx.beginPath();
    ctx.moveTo(c[0] - dir * 0.66 * mm, c[1] - 1.3 * mm);
    ctx.lineTo(c[0] + dir * 0.66 * mm, c[1]);
    ctx.lineTo(c[0] - dir * 0.66 * mm, c[1] + 1.3 * mm);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  if (L.back) chevron(L.back, -1, st.canBack);
  if (L.forward) chevron(L.forward, 1, st.canForward);

  // the address field: a capsule frosted whole
  const [cx, cy, chx, chy] = L.address;
  ctx.beginPath();
  ctx.roundRect(cx - chx, cy - chy, chx * 2, chy * 2, chy);
  ctx.fill();

  if (L.reload) {
    // the reload sits at the capsule's end, cut back out of its frost
    const [x, y] = L.reload;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 0.36 * mm;
    ctx.beginPath();
    if (st.loading) {
      const r = 1.05 * mm;
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
    } else {
      const r = 1.18 * mm;
      const a0 = -Math.PI * 0.32;
      const a1 = Math.PI * 1.36;
      ctx.arc(x, y, r, a0, a1);
      ctx.stroke();
      const ax = x + r * Math.cos(a0);
      const ay = y + r * Math.sin(a0);
      ctx.beginPath();
      ctx.moveTo(ax + 0.98 * mm, ay - 0.05 * mm);
      ctx.lineTo(ax - 0.32 * mm, ay - 0.82 * mm);
      ctx.lineTo(ax - 0.12 * mm, ay + 0.66 * mm);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // the address, cut back out of the capsule to clear glass: [lock] [favicon's place] address, centred clear of the reload
  const reserve = L.reload ? L.glyph * 1.25 : 0;
  const left = cx - chx + 1.7 * mm;
  const right = cx + chx - 1.7 * mm - reserve;
  const size = 2.5 * mm;
  const text = st.display || PROMPT;
  ctx.font = `${st.display ? 600 : 500} ${size}px ${SANS}`;
  ctx.textBaseline = "middle";
  const icon = favicon ? 2.8 * mm : 0;
  const gap = favicon ? 1.15 * mm : 0;
  const lock = st.secure && st.display ? 1.95 * mm : 0;
  const room = right - left - icon - gap - lock;
  let shown = text;
  if (ctx.measureText(shown).width > room) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > room)
      shown = shown.slice(0, -1);
    shown = `${shown}…`;
  }
  const tw = ctx.measureText(shown).width;
  let x = Math.max(left, (left + right) / 2 - (tw + icon + gap + lock) / 2);
  ctx.globalCompositeOperation = "destination-out";
  if (lock) {
    ctx.lineWidth = 0.24 * mm;
    ctx.beginPath();
    ctx.arc(x + 0.56 * mm, cy - 0.34 * mm, 0.43 * mm, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(x, cy - 0.3 * mm, 1.12 * mm, 0.98 * mm, 0.18 * mm);
    ctx.fill();
    x += lock;
  }
  const iconAt = x;
  if (icon) x += icon + gap;
  ctx.globalAlpha = st.display ? 1 : 0.6;
  ctx.fillText(shown, x, cy + 0.08 * mm);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // the viewport, flush right, engraved: the dev browser's size readout
  if (L.size !== null) {
    ctx.font = `500 ${2.0 * mm}px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(`${st.viewport[0]} × ${st.viewport[1]}`, L.size - 0.4 * mm, cy + 0.08 * mm);
    ctx.textAlign = "left";
  }

  // the print: the favicon, in colour, in the lower half
  if (favicon) {
    ctx.setTransform(sx, 0, 0, sy, hx * sx, half + GUTTER - top * sy);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(iconAt, cy - icon / 2, icon, icon, 0.6 * mm);
    ctx.clip();
    ctx.drawImage(favicon, iconAt, cy - icon / 2, icon, icon);
    ctx.restore();
  }
  return { width, height };
}

/** A drawn head read back as the pass lays it: premultiplied RGBA rows (the engraving's alpha and the print's colour), its split. */
export function headBitmap(
  ctx: Pick<HeadContext, "getImageData">,
  width: number,
  height: number,
): HeadBitmap {
  const data = ctx.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    const a = data[i + 3] as number;
    bytes[i] = Math.round(((data[i] as number) * a) / 255);
    bytes[i + 1] = Math.round(((data[i + 1] as number) * a) / 255);
    bytes[i + 2] = Math.round(((data[i + 2] as number) * a) / 255);
    bytes[i + 3] = a;
  }
  return { bytes, width, height, ...engraveSplit(height) };
}

/** The favicon PT-1 knows — the sample's mark — as a picture a canvas draws (`ImageData` on its own small canvas). */
function faviconCanvas(): OffscreenCanvas | null {
  const c = new OffscreenCanvas(64, 64);
  const ctx = c.getContext("2d");
  if (ctx === null) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(sampleFavicon(64)), 64, 64), 0, 0);
  return c;
}

/**
 * THE HEAD RASTER the DOM half lends (`HEAD_RASTER`): one reused OffscreenCanvas (read back often), the platform's
 * fonts; undefined where the platform has no OffscreenCanvas (Node — a still draws its committed raster instead).
 */
export function headRaster(): HeadRaster | undefined {
  if (typeof OffscreenCanvas === "undefined") return undefined;
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return undefined;
  let sample: OffscreenCanvas | null | undefined;
  const icon = (id: string | null): CanvasImageSource | null => {
    if (id !== "sample") return null;
    if (sample === undefined) sample = faviconCanvas();
    return sample;
  };
  return {
    raster(S, st, tpu) {
      const { width, height } = drawHead(canvas, ctx as HeadContext, S, st, tpu, icon(st.favicon));
      return headBitmap(ctx as HeadContext, width, height);
    },
  };
}
