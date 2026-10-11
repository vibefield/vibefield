// THE NOTICE, DRAWN (PT-5a ruling 3) — a failed page's words, rasterised by Canvas 2D as the head's engraving is (the desk's
// text stack: the platform's shaping and fonts), and lent through the same service (`HEAD_RASTER.notice`, head-canvas.ts).
// The raster is the words' LIGHT over black, opaque sRGB rgba8 — PT-5b: of the words' BLOCK alone (notice.ts `noticeBlock`),
// at the notice's scale: the pass lays it as the pane's NOTICE texture and the shader adds its light over what the page
// shows there (browser.wgsl — the film, or the page's last still dimmed under the words).

import type { HeadCanvas, HeadContext } from "./head-canvas";
import { type NoticeSpec, noticeBlock, noticeLayout } from "./notice";

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

/** Draw a notice into `canvas` (resized to its BLOCK's texels — PT-5b: the words' block alone, never the page's whole
 * area): the words' light over black. Answers the canvas's size and the block of the page (CSS px) it covers. */
export function drawNotice(
  canvas: HeadCanvas,
  ctx: NoticeContext,
  n: NoticeSpec,
): {
  readonly width: number;
  readonly height: number;
  readonly block: readonly [number, number, number, number];
} {
  const L = noticeLayout(n.viewport);
  // the lines as they will be set, measured in the page's CSS px BEFORE the canvas is sized (sizing it clears its state)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const measure = (s: string): number => ctx.measureText(s).width;
  ctx.font = `600 ${L.unit}px ${SANS}`;
  const headline = wrapTwo(measure, n.words.headline, L.width)[0] ?? "";
  let widest = Math.min(measure(headline), L.width);
  ctx.font = `400 ${L.small}px ${SANS}`;
  const detail = wrapTwo(measure, n.words.detail, L.width);
  for (const text of detail) widest = Math.max(widest, Math.min(measure(text), L.width));
  const block = noticeBlock(n.viewport, widest, n.retry !== null);
  const width = Math.max(1, Math.round(2 * block[2] * n.scale));
  const height = Math.max(1, Math.round(2 * block[3] * n.scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  // the page's CSS px from here, the block's corner at the canvas's
  const sx = width / (2 * block[2]);
  const sy = height / (2 * block[3]);
  ctx.setTransform(sx, 0, 0, sy, -(block[0] - block[2]) * sx, -(block[1] - block[3]) * sy);
  ctx.fillStyle = n.ink;
  ctx.strokeStyle = n.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${L.unit}px ${SANS}`;
  ctx.fillText(headline, L.cx, L.headline, L.width);
  ctx.globalAlpha = 0.64;
  ctx.font = `400 ${L.small}px ${SANS}`;
  detail.forEach((text, i) => {
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
  return { width, height, block };
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
