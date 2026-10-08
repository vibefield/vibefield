// THE CAPTURE TOOL'S PIXEL DIFF (MV-3c; build-mv M30) — pure, so a test can
// hold it (`electron-shell/test/godview-capture-diff.test.ts`);
// `capture-godview.mjs` reads the arms' captures and calls these.
//
// A capture is the compositor's raw BGRA bitmap (`capturePage().toBitmap()`).
// A pixel DIFFERS when any channel moved by more than `tolerance` (0–255): the
// compositor's own dithering and anti-aliasing stay under it. A capture's
// difference is the share of pixels that differ, judged against a threshold
// AND against the same capture's A/A control (the same build captured twice):
// a view that does not draw the same pixels twice (the swarm's physics, the
// rain) cannot be judged below its own A/A level, and says so.

import { crc32, deflateSync } from "node:zlib";

/** The share of pixels whose largest channel delta exceeds `tolerance`. */
export function diffBitmaps(a, b, width, height, tolerance) {
  const total = width * height;
  if (a.length !== total * 4 || b.length !== total * 4) {
    return { differing: total, total, fraction: 1, maxDelta: 255, box: null, sizeMismatch: true };
  }
  let differing = 0;
  let maxDelta = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let index = 0, pixel = 0; pixel < total; pixel += 1, index += 4) {
    const delta = Math.max(
      Math.abs(a[index] - b[index]),
      Math.abs(a[index + 1] - b[index + 1]),
      Math.abs(a[index + 2] - b[index + 2]),
      Math.abs(a[index + 3] - b[index + 3]),
    );
    if (delta > maxDelta) maxDelta = delta;
    if (delta <= tolerance) continue;
    differing += 1;
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return {
    differing,
    total,
    fraction: total === 0 ? 0 : differing / total,
    maxDelta,
    box: differing === 0 ? null : { x0, y0, x1, y1 },
    sizeMismatch: false,
  };
}

/** A picture of the difference, RGBA: differing pixels red, the rest `a`
 * dimmed to a grey ghost. */
export function diffImage(a, b, width, height, tolerance) {
  const out = Buffer.alloc(width * height * 4);
  for (let index = 0; index < out.length; index += 4) {
    const delta = Math.max(
      Math.abs(a[index] - b[index]),
      Math.abs(a[index + 1] - b[index + 1]),
      Math.abs(a[index + 2] - b[index + 2]),
    );
    if (delta > tolerance) {
      out[index] = 255;
      out[index + 1] = 0;
      out[index + 2] = 0;
    } else {
      // BGRA in, a 30 % grey ghost of the luminance out
      const grey = Math.round(
        0.3 * (0.114 * a[index] + 0.587 * a[index + 1] + 0.299 * a[index + 2]),
      );
      out[index] = grey;
      out[index + 1] = grey;
      out[index + 2] = grey;
    }
    out[index + 3] = 255;
  }
  return out;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** An 8-bit RGBA PNG (filter 0 on every row). */
export function encodePng(rgba, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * One capture's reading. `aa` is the A/A control's diff (A against A′), `ab`
 * A against B (absent in an A/A-only run). `blank` when a capture carries
 * almost no content (a blank compares equal to a blank); `unstable` names a
 * capture whose A/A already differs past the threshold — its A/B reads
 * `differs` only past twice its A/A level.
 */
export function judgeCapture({ aa, ab, threshold, contents, minColours = 8 }) {
  if (contents.some((content) => content.colours < minColours)) return { verdict: "blank" };
  if (aa.sizeMismatch || ab?.sizeMismatch) return { verdict: "size" };
  const stable = aa.fraction <= threshold;
  if (ab === undefined) return { verdict: stable ? "stable" : "unstable", stable };
  const bar = stable ? threshold : Math.max(threshold, 2 * aa.fraction);
  return { verdict: ab.fraction > bar ? "differs" : stable ? "same" : "same-within-aa", stable };
}
