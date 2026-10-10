// THE NOTICE, DRAWN (PT-5a ruling 3) — a failed page's words, rasterised by Canvas 2D as the head's engraving is (the desk's
// text stack: the platform's shaping and fonts), and lent through the same service (`HEAD_RASTER.notice`, head-canvas.ts).
// The raster is the words' LIGHT over black, opaque sRGB rgba8 at the notice's texels: the pass lays it as the pane's page
// and the shader adds it to the FILM (browser.wgsl — a notice is the film with words on it, never a lit page).

import type { HeadCanvas, HeadContext } from "./head-canvas";
import { type NoticeSpec, noticeLayout } from "./notice";

const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`;

/** The Canvas 2D a notice is drawn with: the head's, and a rect to fill. */
export type NoticeContext = HeadContext & Pick<OffscreenCanvasRenderingContext2D, "fillRect">;

/** `text` broken at its spaces into at most two lines no wider than `width` — the second cut short with an ellipsis. */
export function wrapTwo(
  measure: (s: string) => number,
  text: string,
  width: number,
): readonly string[] {
  if (measure(text) <= width) return [text];
  const words = text.split(" ");
  let first = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = first === "" ? (words[i] as string) : `${first} ${words[i]}`;
    if (first !== "" && measure(next) > width) break;
    first = next;
  }
  let second = words.slice(i).join(" ");
  if (second === "") return [first];
  if (measure(second) > width) {
    while (second.length > 1 && measure(`${second}…`) > width) second = second.slice(0, -1);
    second = `${second.trimEnd()}…`;
  }
  return [first, second];
}

/** Draw a notice into `canvas` (resized to its texels): the words' light over black. */
export function drawNotice(
  canvas: HeadCanvas,
  ctx: NoticeContext,
  n: NoticeSpec,
): { readonly width: number; readonly height: number } {
  const [width, height] = n.texels;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const L = noticeLayout(n.viewport);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  // the page's CSS px from here
  ctx.setTransform(width / n.viewport[0], 0, 0, height / n.viewport[1], 0, 0);
  ctx.fillStyle = n.ink;
  ctx.strokeStyle = n.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${L.unit}px ${SANS}`;
  const measure = (s: string): number => ctx.measureText(s).width;
  ctx.fillText(wrapTwo(measure, n.words.headline, L.width)[0] ?? "", L.cx, L.headline, L.width);
  ctx.globalAlpha = 0.64;
  ctx.font = `400 ${L.small}px ${SANS}`;
  wrapTwo(measure, n.words.detail, L.width).forEach((text, i) => {
    ctx.fillText(text, L.cx, L.detail + i * L.line, L.width);
  });
  if (n.retry !== null) {
    const [cx, cy, hx, hy] = L.retry;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(L.small / 11, 1);
    ctx.beginPath();
    ctx.roundRect(cx - hx, cy - hy, 2 * hx, 2 * hy, hy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = `600 ${L.small}px ${SANS}`;
    ctx.textBaseline = "middle";
    ctx.fillText(n.retry, cx, cy + L.small * 0.04, 2 * hx - L.small);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return { width, height };
}

/** A drawn notice read back as the pass lays it: opaque sRGB rgba8 rows from the top. */
export function noticeBytes(
  ctx: Pick<HeadContext, "getImageData">,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const data = ctx.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array(width * height * 4);
  bytes.set(data);
  for (let i = 3; i < bytes.length; i += 4) bytes[i] = 255;
  return bytes;
}
