// A FACE'S WORDS, DRAWN — rasterised by Canvas 2D as the pane's notice is (the desk's text stack: the platform's shaping and
// fonts), and lent by the phone's DOM half under `WORDS_RASTER` (object.ts). The raster is the words' LIGHT over black, opaque
// sRGB rgba8, of their BLOCK alone (notice.ts `noticeBlock`), at three texels a point: the pass lays it as the phone's notice
// texture and the shader adds its light over what the screen shows there (phone.wgsl `ph_face`).

import {
  type NoticeBitmap,
  type NoticeSpec,
  noticeBlock,
  noticeLayout,
  type WordsRaster,
} from "./notice";

const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`;

/** The Canvas 2D a face's words are drawn with — an OffscreenCanvas's (the product's), or a Node canvas's (a test's). */
export type WordsContext = Pick<
  OffscreenCanvasRenderingContext2D,
  | "setTransform"
  | "fillRect"
  | "beginPath"
  | "roundRect"
  | "stroke"
  | "measureText"
  | "fillText"
  | "getImageData"
> & {
  globalCompositeOperation: string;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

/** A canvas a face's words are drawn on: resized to their block. */
export interface WordsCanvas {
  width: number;
  height: number;
}

/** `text` broken at its spaces into at most `max` lines no wider than `width` — the last cut short with an ellipsis. */
export function wrapLines(
  measure: (s: string) => number,
  text: string,
  width: number,
  max: number,
): readonly string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  let i = 0;
  for (; i < words.length && lines.length < max; i++) {
    const word = words[i] ?? "";
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (lines.length < max) {
    if (line !== "") lines.push(line);
    return lines;
  }
  // more words than lines: the last line carries the rest, cut to an ellipsis
  let last = [lines.pop() ?? "", line, ...words.slice(i)].filter((w) => w !== "").join(" ");
  if (measure(last) > width) {
    while (last.length > 1 && measure(`${last}…`) > width) last = last.slice(0, -1);
    last = `${last.trimEnd()}…`;
  }
  return [...lines, last];
}

/** Draw a face's words into `canvas` (resized to their block's texels): their light over black. Answers its size, the block of the screen (points) it covers and its lines. */
export function drawWords(
  canvas: WordsCanvas,
  ctx: WordsContext,
  n: NoticeSpec,
): Omit<NoticeBitmap, "bytes"> {
  const L = noticeLayout(n.points);
  // the lines as they will be set, measured in points BEFORE the canvas is sized (sizing it clears its state)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const measure = (s: string): number => ctx.measureText(s).width;
  ctx.font = `600 ${L.unit}px ${SANS}`;
  const lines = wrapLines(measure, n.words.line, L.width, L.maxLines);
  let widest = 0;
  for (const text of lines) widest = Math.max(widest, Math.min(measure(text), L.width));
  const act = n.words.act;
  const block = noticeBlock(n.points, widest, lines.length, act !== null);
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
  // the screen's points from here, the block's corner at the canvas's
  const sx = width / (2 * block[2]);
  const sy = height / (2 * block[3]);
  ctx.setTransform(sx, 0, 0, sy, -(block[0] - block[2]) * sx, -(block[1] - block[3]) * sy);
  ctx.fillStyle = n.ink;
  ctx.strokeStyle = n.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${L.unit}px ${SANS}`;
  lines.forEach((text, i) => {
    ctx.fillText(text, L.cx, L.first + i * L.lineHeight, L.width);
  });
  if (act !== null) {
    const [cx, cy, hx, hy] = L.capsule(lines.length);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(L.small / 11, 1);
    ctx.beginPath();
    ctx.roundRect(cx - hx, cy - hy, 2 * hx, 2 * hy, hy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = `600 ${L.small}px ${SANS}`;
    ctx.textBaseline = "middle";
    ctx.fillText(act, cx, cy + L.small * 0.04, 2 * hx - L.small);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return { width, height, block, lines: lines.length };
}

/** Drawn words read back as the pass lays them: opaque sRGB rgba8 rows from the top. */
export function wordsBytes(
  ctx: Pick<WordsContext, "getImageData">,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const data = ctx.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array(width * height * 4);
  bytes.set(data);
  for (let i = 3; i < bytes.length; i += 4) bytes[i] = 255;
  return bytes;
}

/**
 * THE WORDS' RASTER the DOM half lends (`WORDS_RASTER`): one reused OffscreenCanvas (read back each time words change), the
 * platform's fonts; undefined where the platform has no OffscreenCanvas (Node — a still's faces draw the committed words,
 * face-words.ts).
 */
export function wordsRaster(): WordsRaster | undefined {
  if (typeof OffscreenCanvas === "undefined") return undefined;
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return undefined;
  return {
    notice(spec) {
      const drawn = drawWords(canvas, ctx, spec);
      return { ...drawn, bytes: wordsBytes(ctx, drawn.width, drawn.height) };
    },
  };
}
