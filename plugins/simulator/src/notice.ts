// A FACE'S WORDS on the phone's screen (face.ts says which; DESIGN.md §9 says them) — laid out in the screen's own POINTS
// (the device's, as iOS lays out — so a mini's words and a Pro Max's sit alike): the line, set as large as reads on a phone
// at rest (a 18th of the screen's width, between 14 and 24 pt), wrapped to at most three lines; under it, where the state
// offers an act the host can run, its capsule. Pure: where each line and the capsule lie (the raster draws them there —
// notice-canvas.ts — and the hand's press reads the capsule back), the words' BLOCK (all the raster covers: the words are
// their own texture, light added over the screen — the pane's PT-5b), and the key a raster is drawn from.
//
// The words are one light ink (DESIGN.md §5.1's "words on a face") added over the dark panel or a still dimmed to 0.16 under
// them: they read by day and by night.

import { serviceKey } from "@vibefield/plugin-sdk/desk";

/** A face's words as the raster draws them: the line and the act's word (null: none offered). */
export interface NoticeWords {
  readonly line: string;
  readonly act: string | null;
}

/** Where a face's words lie on a screen `points` wide and high (device points). */
export interface NoticeLayout {
  /** The line's size, and the capsule's word's. */
  readonly unit: number;
  readonly small: number;
  /** The lines' centre x, the widest a line may be, the first baseline and the line height. */
  readonly cx: number;
  readonly width: number;
  readonly first: number;
  readonly lineHeight: number;
  /** The most lines the line wraps to. */
  readonly maxLines: number;
  /** The capsule under `lines` lines: its centre x, y and half extents. */
  capsule(lines: number): readonly [number, number, number, number];
}

/** The most lines a face's line wraps to. */
export const NOTICE_LINES = 3;

/** Where a face's words lie on a screen of `points` (portrait, device points): a block centred a little above the middle. */
export function noticeLayout(points: readonly [number, number]): NoticeLayout {
  const [W, H] = points;
  const unit = Math.min(Math.max(W / 18, 14), 24);
  const small = Math.round(unit * 0.78);
  const lineHeight = unit * 1.28;
  // the block's height with its full lines and its capsule — placed so its middle sits at 44 % of the screen
  const capH = small * 1.3;
  const tall = NOTICE_LINES * lineHeight + small * 1.6 + 2 * capH;
  const top = Math.max(H * 0.44 - tall / 2, unit);
  const first = top + unit;
  const cx = W / 2;
  return {
    unit,
    small,
    cx,
    width: Math.max(W - 3 * unit, 1),
    first,
    lineHeight,
    maxLines: NOTICE_LINES,
    capsule: (lines) => [
      cx,
      first + (Math.max(lines, 1) - 1) * lineHeight + small * 1.6 + capH,
      small * 4.6,
      capH,
    ],
  };
}

/** Is a screen point (device points) on the capsule under `lines` lines? (A hair's slop round it: a press is a finger's.) */
export function actAt(
  points: readonly [number, number],
  lines: number,
  x: number,
  y: number,
): boolean {
  const L = noticeLayout(points);
  const [cx, cy, hx, hy] = L.capsule(lines);
  const slop = L.small * 0.3;
  return Math.abs(x - cx) <= hx + slop && Math.abs(y - cy) <= hy + slop;
}

/** The texels a face's words are drawn at, a point: three (a phone's own density — words read in hand at the reading size). */
export const NOTICE_SCALE = 3;

/**
 * The words' BLOCK: the rect of the screen (points — its centre and half extents) their lines and their capsule lie in, and
 * all the raster covers. As wide as the widest line (`widest` — the raster measured it) or the capsule, a margin round; from
 * above the first line to under the capsule (the last line where none is offered); held on the screen.
 */
export function noticeBlock(
  points: readonly [number, number],
  widest: number,
  lines: number,
  act: boolean,
): readonly [number, number, number, number] {
  const L = noticeLayout(points);
  const pad = L.small * 0.6;
  const [, cy, chx, chy] = L.capsule(lines);
  const hx = Math.min(points[0] / 2, Math.max(widest / 2, act ? chx : 0) + pad);
  const top = Math.max(0, L.first - L.unit * 1.1 - pad * 0.5);
  const foot = act
    ? cy + chy + pad
    : L.first + (Math.max(lines, 1) - 1) * L.lineHeight + L.unit * 0.4 + pad;
  const bottom = Math.min(points[1], Math.max(foot, top + 1));
  return [L.cx, (top + bottom) / 2, hx, (bottom - top) / 2];
}

/** What a face's words' raster is drawn from — a new key is a new raster. */
export interface NoticeSpec {
  /** The screen's size in points (the in-between screen's, mid-morph). */
  readonly points: readonly [number, number];
  /** Texels a point (`NOTICE_SCALE`). */
  readonly scale: number;
  readonly words: NoticeWords;
  /** The words' ink, a CSS colour. */
  readonly ink: string;
}

export const noticeKey = (n: NoticeSpec): string =>
  [
    "notice",
    n.points.map((v) => v.toFixed(2)).join("x"),
    `@${n.scale}`,
    n.words.line,
    n.words.act ?? "",
    n.ink,
  ].join("|");

/** A face's words as the raster drew them: opaque sRGB rgba8 rows from the top (the words' light over black), the block of the screen (points) they cover, and how many lines the line took. */
export interface NoticeBitmap {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  readonly block: readonly [number, number, number, number];
  readonly lines: number;
}

/** The words' raster as a service the phone's DOM half lends (object.ts — notice-canvas.ts draws it with Canvas 2D). */
export interface WordsRaster {
  /** A face's words, drawn — undefined where the service cannot draw them (the face then carries no words). */
  notice(spec: NoticeSpec): NoticeBitmap | undefined;
}

/**
 * THE SERVICE'S KEY (ICE K8a): the plugin's DOM half lends it wherever the platform's Canvas 2D is (the product's renderer);
 * where none is lent (a Node still), a face says nothing in words — its dims and its marks still say it.
 */
export const WORDS_RASTER = serviceKey<WordsRaster>("vibefield.simulator.words");
