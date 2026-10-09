// THE COMMITTED HEADS (PT-1 ruling 8) — the head rasters a pane draws where no host lends its head service: a still on
// Node (the playground's Dawn still lends the desk's text raster alone, and Node has no Canvas 2D of the platform's).
// Made ONCE by `scripts/make-head-still.ts` — the very `drawHead` the product's service runs, on a Node canvas — and
// committed as run-length runs (head-still.gen.ts): the engraving's alpha, the print's colour. Each is keyed exactly as
// the record keys a head (head.ts `headKey`), so a pane draws a committed raster only when it says what that raster says
// — a still's pane does; a head nothing committed says nothing, and its glass is drawn clear (never another's words).
//
// What is committed is the still's: the default pane (a laptop's, on the sample), the default pane on a blank page, and a
// phone's pane on the sample — each at the still's band (zoom 1 × dpr 2: 2 texels a world unit).

import { STILL_HEADS } from "./head-still.gen";
import type { HeadBitmap } from "./layout";

/** One committed head: its key, its size and split, its two halves as base64 runs. */
export interface StillHead {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly h: number;
  readonly at: number;
  /** The engraving's rows [0, h): runs of (count 1…255, alpha). */
  readonly engraving: string;
  /** The print's rows [at, height): runs of (count 1…255, r, g, b, a) — premultiplied. */
  readonly print: string;
}

const bytesOf = (base64: string): Uint8Array => {
  const s = atob(base64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** A committed head unpacked into the bitmap the pass lays (premultiplied RGBA, rows top-down). */
export function unpackHead(still: StillHead): HeadBitmap {
  const { width, height, h, at } = still;
  const bytes = new Uint8Array(width * height * 4);
  const eng = bytesOf(still.engraving);
  let px = 0;
  for (let i = 0; i + 1 < eng.length && px < width * h; i += 2) {
    const n = eng[i] as number;
    const a = eng[i + 1] as number;
    for (let k = 0; k < n && px < width * h; k++, px++) {
      const o = px * 4;
      bytes[o] = a;
      bytes[o + 1] = a;
      bytes[o + 2] = a;
      bytes[o + 3] = a;
    }
  }
  const pr = bytesOf(still.print);
  px = at * width;
  for (let i = 0; i + 4 < pr.length && px < width * height; i += 5) {
    const n = pr[i] as number;
    for (let k = 0; k < n && px < width * height; k++, px++) {
      const o = px * 4;
      bytes[o] = pr[i + 1] as number;
      bytes[o + 1] = pr[i + 2] as number;
      bytes[o + 2] = pr[i + 3] as number;
      bytes[o + 3] = pr[i + 4] as number;
    }
  }
  return { bytes, width, height, h, at };
}

/** Run-length runs of a channel's values (count 1…255, value…), `stride` bytes a value — the maker's packing. */
export function packRuns(
  bytes: Uint8Array,
  from: number,
  to: number,
  channels: readonly number[],
): Uint8Array {
  const out: number[] = [];
  let run = 0;
  let prev: number[] = [];
  const flush = () => {
    if (run > 0) out.push(run, ...prev);
  };
  for (let px = from; px < to; px++) {
    const v = channels.map((c) => bytes[px * 4 + c] as number);
    if (run > 0 && run < 255 && v.every((x, i) => x === prev[i])) run++;
    else {
      flush();
      prev = v;
      run = 1;
    }
  }
  flush();
  return Uint8Array.from(out);
}

const cache = new Map<string, HeadBitmap>();

/** The committed head a key names, unpacked once — or undefined: nothing committed says it. */
export function stillHead(key: string): HeadBitmap | undefined {
  const had = cache.get(key);
  if (had !== undefined) return had;
  const still = STILL_HEADS.find((s) => s.key === key);
  if (still === undefined) return undefined;
  const bitmap = unpackHead(still);
  cache.set(key, bitmap);
  return bitmap;
}

/** The split a committed head's key names, without unpacking it (the record's `ink`). */
export function stillSplit(
  key: string,
): { readonly height: number; readonly h: number; readonly at: number } | undefined {
  const still = STILL_HEADS.find((s) => s.key === key);
  return still === undefined ? undefined : { height: still.height, h: still.h, at: still.at };
}
