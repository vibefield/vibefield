// THE COMMITTED WORDS (the orchestrator's R2 Q1, 2026-10-29 — the pane's committed heads, PT-1 ruling 8, are its model): the
// rasters of a face's words a phone draws where no host lends its words' raster — a still on Node (the playground lends none,
// and Node has no Canvas 2D of the platform's). Made ONCE by `scripts/make-face-words.ts` — the very `drawWords` the product's
// raster runs (notice-canvas.ts), on a Node canvas — and committed as run-length runs of their colour (face-words.gen.ts).
// Each is keyed exactly as the phone keys its words (notice.ts `noticeKey`), so a phone draws a committed raster only when it
// says what that raster says — a still's faces do; words nothing committed says are not drawn (never another's).
//
// What is committed is the still's: each face with words the playground stages (playground/fixture-mac.ts), on its own
// device, in the words' ink (one by day and by night).

import { STILL_WORDS } from "./face-words.gen";
import type { NoticeBitmap } from "./notice";

/** One committed raster: its key, its size, the block of the screen (points) it covers, its lines, its colour as base64 runs. */
export interface StillWords {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** The block of the screen it covers (points: centre x, y and half extents) — notice.ts `noticeBlock`. */
  readonly block: readonly [number, number, number, number];
  readonly lines: number;
  /** Its rows from the top: runs of (count 1…255, r, g, b) — opaque (the words' light over black). */
  readonly runs: string;
}

const bytesOf = (base64: string): Uint8Array => {
  const s = atob(base64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** A committed raster unpacked into the bitmap the pass lays (opaque sRGB rgba8, rows from the top). */
export function unpackWords(still: StillWords): NoticeBitmap {
  const { width, height } = still;
  const bytes = new Uint8Array(width * height * 4);
  const runs = bytesOf(still.runs);
  let px = 0;
  for (let i = 0; i + 3 < runs.length && px < width * height; i += 4) {
    const n = runs[i] as number;
    for (let k = 0; k < n && px < width * height; k++, px++) {
      const o = px * 4;
      bytes[o] = runs[i + 1] as number;
      bytes[o + 1] = runs[i + 2] as number;
      bytes[o + 2] = runs[i + 3] as number;
      bytes[o + 3] = 255;
    }
  }
  return { bytes, width, height, block: still.block, lines: still.lines };
}

/** Run-length runs of an rgba8 raster's colour (count 1…255, r, g, b — its alpha dropped: it is opaque) — the maker's packing. */
export function packWords(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let run = 0;
  let r = -1;
  let g = -1;
  let b = -1;
  for (let o = 0; o + 3 < bytes.length; o += 4) {
    const [pr, pg, pb] = [bytes[o] as number, bytes[o + 1] as number, bytes[o + 2] as number];
    if (run > 0 && run < 255 && pr === r && pg === g && pb === b) run++;
    else {
      if (run > 0) out.push(run, r, g, b);
      [r, g, b, run] = [pr, pg, pb, 1];
    }
  }
  if (run > 0) out.push(run, r, g, b);
  return Uint8Array.from(out);
}

const cache = new Map<string, NoticeBitmap>();

/** The committed raster a key names, unpacked once — or undefined: nothing committed says it. */
export function stillWords(key: string): NoticeBitmap | undefined {
  const had = cache.get(key);
  if (had !== undefined) return had;
  const still = STILL_WORDS.find((s) => s.key === key);
  if (still === undefined) return undefined;
  const bitmap = unpackWords(still);
  cache.set(key, bitmap);
  return bitmap;
}
