// THE HEAD'S ENGRAVING, DRAWN (BROWSER.md §4; the prototype's lab/browser-band.ts `drawBand`, moved) — what is cut into
// the clear glass at the head of a pane, rasterised by Canvas 2D (the desk's text stack: design-015 §6.1 — the
// platform's shaping and fonts, laid into a texture) and laid over the head by the pass, which frosts the glass wherever
// the raster says. Drawn in the pane's own world units under one transform, at the band ladder's density (head.ts
// `bandFor`), so it is crisp at any zoom and re-made only when what it says or the band changes — never per frame.
//
// It is ENGRAVED, as a laser engraves acrylic: back ‹ and forward › (a hairline where there is nowhere to go), reload ↻
// (✕ while loading), the viewport at the right — the dev browser's size readout, which is also what a resize reads — and
// the ADDRESS FIELD: a capsule frosted whole, the address cut back out of it to clear glass, so the letters are the mat
// seen through the pane (PT-5b: and, where the page shown is a photograph of it, the REST MARK — two short bars cut at
// the capsule's leading end). One thing is PRINTED, in colour, on the capsule: the page's favicon — the sample's own, or a live
// page's (PT-4: its bytes from the host's face, decoded here once a key); a page with none carries the GENERIC mark, a
// small globe ENGRAVED in the favicon's place. A narrow pane (a phone's) carries the capsule alone.
//
// THE SERVICE (PT-1 ruling 8): the plugin's DOM half lends `headRaster()` under `HEAD_RASTER` wherever the platform has
// an OffscreenCanvas (the product's renderer); the same `drawHead` makes the committed raster a Node still draws
// (scripts/make-head-still.ts), on a Node canvas.

import { PROMPT } from "./address";
import {
  engraveSplit,
  faviconId,
  GENERIC_FAVICON,
  GUTTER,
  type HeadRaster,
  type HeadState,
  headSize,
  type PageFavicon,
} from "./head";
import { bandLayout, type PaneShape } from "./law";
import type { HeadBitmap } from "./layout";
import { drawNotice, type NoticeContext, noticeBytes } from "./notice-canvas";
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
  | "ellipse"
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

/** Cut a pane's head into `canvas` (resized to fit) at `tpu` texels per world unit; `favicon` is the print's picture, or null
 * — and a head that says the GENERIC mark (`st.favicon`) has a globe engraved where the picture would be printed. */
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
  // PT-5b — AT REST (the page shown is a photograph of it): two short bars cut at the capsule's leading end — on every
  // pane, a phone's too (its head carries the capsule alone); never while the capsule says something else
  const rest = st.rest === true && st.saying === undefined;
  if (rest) {
    const rx = cx - chx + 2.0 * mm;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 0.44 * mm;
    ctx.beginPath();
    ctx.moveTo(rx, cy - 0.82 * mm);
    ctx.lineTo(rx, cy + 0.82 * mm);
    ctx.moveTo(rx + 1.0 * mm, cy - 0.82 * mm);
    ctx.lineTo(rx + 1.0 * mm, cy + 0.82 * mm);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }
  const left = cx - chx + 1.7 * mm + (rest ? 2.3 * mm : 0);
  const right = cx + chx - 1.7 * mm - reserve;
  const size = 2.5 * mm;
  // PT-5a: for a moment the capsule SAYS something instead (a download refused) — alone: no lock, no favicon
  const saying = st.saying !== undefined;
  if (saying) favicon = null;
  const text = st.saying ?? (st.display || PROMPT);
  ctx.font = `${st.display || saying ? 600 : 500} ${size}px ${SANS}`;
  ctx.textBaseline = "middle";
  const generic = !saying && favicon === null && st.favicon === GENERIC_FAVICON;
  const icon = favicon || generic ? 2.8 * mm : 0;
  const gap = favicon || generic ? 1.15 * mm : 0;
  const lock = !saying && st.secure && st.display ? 1.95 * mm : 0;
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
  if (generic) {
    // the generic mark (PT-4): a globe cut out of the capsule's frost — its rim, a meridian, the equator
    const gx = iconAt + icon / 2;
    const r = 1.12 * mm;
    ctx.lineWidth = 0.22 * mm;
    ctx.beginPath();
    ctx.arc(gx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(gx, cy, r * 0.46, r, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx - r, cy);
    ctx.lineTo(gx + r, cy);
    ctx.stroke();
  }
  if (icon) x += icon + gap;
  ctx.globalAlpha = st.display || saying ? 1 : 0.6;
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
export function headRaster(
  decode: (favicon: PageFavicon) => Promise<CanvasImageSource> = decodeFavicon,
): HeadRaster | undefined {
  if (typeof OffscreenCanvas === "undefined") return undefined;
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return undefined;
  let sample: OffscreenCanvas | null | undefined;
  /** The notices' own canvas (a notice's block — made the first time a page fails, never the heads' small one resized). */
  let notices:
    | { readonly canvas: OffscreenCanvas; readonly ctx: OffscreenCanvasRenderingContext2D }
    | null
    | undefined;
  const pictures = createFaviconPictures(decode);
  const icon = (id: string | null): CanvasImageSource | null => {
    if (id === null) return null;
    if (id !== "sample") return pictures.byId(id);
    if (sample === undefined) sample = faviconCanvas();
    return sample;
  };
  return {
    raster(S, st, tpu) {
      const { width, height } = drawHead(canvas, ctx as HeadContext, S, st, tpu, icon(st.favicon));
      return headBitmap(ctx as HeadContext, width, height);
    },
    picture: pictures.offer,
    notice(spec) {
      if (notices === undefined) {
        const c = new OffscreenCanvas(1, 1);
        const cx = c.getContext("2d", { willReadFrequently: true });
        notices = cx === null ? null : { canvas: c, ctx: cx };
      }
      if (notices === null) return undefined;
      const { width, height, block } = drawNotice(
        notices.canvas,
        notices.ctx as NoticeContext,
        spec,
      );
      return {
        bytes: noticeBytes(notices.ctx as NoticeContext, width, height),
        width,
        height,
        block,
      };
    },
  };
}

/** How many pages' pictures are kept decoded (the oldest goes first). */
export const FAVICON_PICTURES_MAX = 64;
/** What a page's own favicon's id begins with (head.ts `faviconId`). */
const FAVICON_ID = faviconId("");

/**
 * A page's favicon as a picture a canvas draws (PT-4): the platform's own decoder over the bytes — PNG, ICO, JPEG, GIF,
 * WebP — and, for what that refuses (an SVG), an image element over a `blob:` of them.
 */
export async function decodeFavicon(favicon: PageFavicon): Promise<CanvasImageSource> {
  const blob = new Blob([favicon.bytes as BlobPart], { type: favicon.type });
  try {
    return await createImageBitmap(blob);
  } catch {
    if (typeof Image === "undefined") throw new Error("the favicon could not be decoded");
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * The pages' favicons, decoded once a key (PT-4): `offer` answers whether a favicon's picture is ready to print — starting its
 * decode the first time it is offered and calling every waiter's `ready` once it is; one that cannot be read is never ready
 * (its head keeps the generic mark). `byId` is the picture a head's `faviconId(key)` names.
 */
export function createFaviconPictures(
  decode: (favicon: PageFavicon) => Promise<CanvasImageSource>,
): {
  offer(favicon: PageFavicon, ready: () => void): boolean;
  byId(id: string): CanvasImageSource | null;
} {
  type Entry =
    | { readonly is: "decoding"; readonly waiting: Set<() => void> }
    | { readonly is: "ready"; readonly picture: CanvasImageSource }
    | { readonly is: "unreadable" };
  const entries = new Map<string, Entry>();
  return {
    offer(favicon, ready) {
      const had = entries.get(favicon.key);
      if (had?.is === "ready") return true;
      if (had?.is === "unreadable") return false;
      if (had?.is === "decoding") {
        had.waiting.add(ready);
        return false;
      }
      const waiting = new Set([ready]);
      const decoding: Entry = { is: "decoding", waiting };
      entries.set(favicon.key, decoding);
      // the oldest picture makes room (a Map keeps the order its keys were set in)
      for (const key of entries.keys()) {
        if (entries.size <= FAVICON_PICTURES_MAX) break;
        if (key !== favicon.key) entries.delete(key);
      }
      // (a decode that lands after its entry made room for newer ones is dropped: its page offers it again if it is still there)
      void decode(favicon).then(
        (picture) => {
          if (entries.get(favicon.key) !== decoding) return;
          entries.set(favicon.key, { is: "ready", picture });
          for (const tell of waiting) tell();
        },
        () => {
          if (entries.get(favicon.key) === decoding) entries.set(favicon.key, { is: "unreadable" });
        },
      );
      return false;
    },
    byId(id) {
      const entry = id.startsWith(FAVICON_ID)
        ? entries.get(id.slice(FAVICON_ID.length))
        : undefined;
      return entry?.is === "ready" ? entry.picture : null;
    },
  };
}
