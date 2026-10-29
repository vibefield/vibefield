// THE FIXTURE FEED (PHONE.md §6.3; the prototype's lab/ios-feed.ts — its CONTRACT kept, its picture redrawn; James's choice 5,
// ruled 2026-10-29: this redrawn fixture serves the product's stills and faces, and ios-feed.ts stays the lab's): what a phone's
// screen shows where no Simulator streams to it — the plugin's own frame source, so a still is deterministic and every host
// draws the same bytes (the playground's stills over playground/live.ts; a live desk's through fixture-live.ts). A stand-in for
// the stream, not an emulator, and NO APPLE ARTWORK, ever (PHONE.md Q-9): synthetic shapes alone — a wallpaper of soft light,
// a grid of tiles each marked with a plain figure, a dock, a status bar whose clock is drawn as segment digits (the fixture's
// own figures, no font) — laid out for the model's own screen (its island drawn into the frame as iOS draws its own, its
// notch's ears, or the home-button phones' bar), in light or dark following the desk (the PT-S design §6 Q-4: a real
// Simulator keeps its own appearance). Made from arithmetic alone: no canvas, no decoder, no font.
//
// THE STREAM'S CONTRACT (`FixtureFeed`): frames at the size and the rate the phone's demand asks for (paused: none), and none
// while nothing changed — a frame is due when the clock's minute turns, the screen reshapes (a morph), the size or the scheme
// moves; never more often than the demanded rate.

import { MM, type PhoneShape } from "./law";

/** The screen iOS lays out: its size in points, its status bar's kind, the island (points), a home indicator, the display's corner. */
export interface FeedScreen {
  readonly pt: readonly [number, number];
  readonly kind: "island" | "notch" | "classic";
  /** The island in points — width, height, its top — when the bar is laid round one; drawn into the frame (as iOS does) only when the housing is wholly an island (mid-morph the desk's glass is the housing). */
  readonly pill: readonly [number, number, number] | null;
  readonly drawPill: boolean;
  /** No home button: the home indicator's bar. */
  readonly indicator: boolean;
  /** The display's corner as a radius (its 45° point's), points. */
  readonly corner: number;
}

/** A phone's shape → the screen iOS lays out on it (mid-morph: the in-between one, at the display's own aspect). */
export function feedScreenOf(S: PhoneShape): FeedScreen {
  const k = 1 / (MM * S.ptmm); // points per world unit
  const H = S.housing;
  const c = S.displayCorner;
  const kind = H.presence < 0.5 ? "classic" : H.island >= 0.5 ? "island" : "notch";
  const pill =
    kind === "island" && H.pill
      ? ([2 * H.pill.hw * k, 2 * H.pill.hh * k, H.pill.top * k] as const)
      : null;
  return {
    pt: [S.points[0], S.points[1]],
    kind,
    pill,
    drawPill: pill !== null && H.island >= 1 && H.presence >= 1,
    indicator: S.classic.presence < 0.5,
    corner: c.extent > 0 ? ((c.extent * (1 - 2 ** (-1 / c.n))) / (1 - Math.SQRT1_2)) * k : 0,
  };
}

const sameScreen = (a: FeedScreen, b: FeedScreen): boolean =>
  a.pt[0] === b.pt[0] &&
  a.pt[1] === b.pt[1] &&
  a.kind === b.kind &&
  a.drawPill === b.drawPill &&
  a.indicator === b.indicator &&
  a.corner === b.corner &&
  (a.pill === b.pill ||
    (a.pill !== null && b.pill !== null && a.pill.every((v, i) => v === b.pill?.[i])));

type RGB = readonly [number, number, number];
type Scheme = "light" | "dark";

/** The fixture's PICTURE content, sRGB bytes — what the screen shows, never a desk colour (the pane's sample page's rule). */
const PICTURE: Readonly<
  Record<
    Scheme,
    {
      readonly sky: readonly [RGB, RGB];
      readonly glows: readonly (readonly [number, number, number, RGB])[];
      readonly tiles: readonly RGB[];
      readonly figure: RGB;
      readonly glass: RGB;
      readonly glassAlpha: number;
      readonly text: RGB;
      readonly pill: RGB;
    }
  >
> = {
  light: {
    sky: [
      [176, 206, 238],
      [244, 205, 196],
    ],
    // soft discs of light: x, y (of the screen), radius (of its width), colour
    glows: [
      [0.1, 0.62, 0.8, [255, 236, 214]],
      [0.95, 0.22, 0.7, [206, 226, 255]],
      [0.68, 1.0, 0.6, [255, 214, 222]],
    ],
    tiles: [
      [242, 140, 64],
      [91, 141, 239],
      [76, 182, 140],
      [236, 96, 112],
      [154, 120, 230],
      [250, 196, 66],
      [64, 170, 210],
      [120, 128, 140],
    ],
    figure: [255, 255, 255],
    glass: [255, 255, 255],
    glassAlpha: 0.32,
    text: [255, 255, 255],
    pill: [0, 0, 0],
  },
  dark: {
    sky: [
      [22, 28, 54],
      [70, 36, 64],
    ],
    glows: [
      [0.1, 0.62, 0.8, [92, 64, 110]],
      [0.95, 0.22, 0.7, [40, 70, 128]],
      [0.68, 1.0, 0.6, [110, 52, 74]],
    ],
    tiles: [
      [214, 118, 50],
      [70, 116, 214],
      [52, 150, 112],
      [206, 74, 92],
      [124, 94, 200],
      [220, 168, 44],
      [44, 140, 180],
      [92, 98, 110],
    ],
    figure: [245, 245, 247],
    glass: [40, 42, 52],
    glassAlpha: 0.5,
    text: [236, 236, 240],
    pill: [0, 0, 0],
  },
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** A screen drawn into rows of sRGB rgba8, in points scaled to the frame's texels (each axis its own — a frame of another aspect is stretched here, cropped by the display). */
class Raster {
  readonly bytes: Uint8Array<ArrayBuffer>;
  constructor(
    readonly w: number,
    readonly h: number,
    readonly sx: number,
    readonly sy: number,
  ) {
    this.bytes = new Uint8Array(w * h * 4);
  }

  /** Every texel a colour per point (u, v 0…1 down the screen). */
  shade(colour: (u: number, v: number) => RGB): void {
    const b = this.bytes;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = colour((x + 0.5) / this.w, (y + 0.5) / this.h);
        const i = (y * this.w + x) * 4;
        b[i] = Math.round(c[0]);
        b[i + 1] = Math.round(c[1]);
        b[i + 2] = Math.round(c[2]);
        b[i + 3] = 255;
      }
  }

  /** Paint over a texel: `cov` of `c`, source over. */
  private over(i: number, c: RGB, cov: number): void {
    const b = this.bytes;
    const k = 1 - cov;
    b[i] = Math.round((b[i] ?? 0) * k + c[0] * cov);
    b[i + 1] = Math.round((b[i + 1] ?? 0) * k + c[1] * cov);
    b[i + 2] = Math.round((b[i + 2] ?? 0) * k + c[2] * cov);
  }

  /** A rounded rect in points — filled, in a colour, at `alpha` — antialiased over a texel. */
  rect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    colour: RGB,
    alpha = 1,
  ): void {
    const cx = ((x0 + x1) / 2) * this.sx;
    const cy = ((y0 + y1) / 2) * this.sy;
    const hx = (Math.max(x1 - x0, 0) / 2) * this.sx;
    const hy = (Math.max(y1 - y0, 0) / 2) * this.sy;
    const r = Math.min(radius * Math.min(this.sx, this.sy), hx, hy);
    const tx0 = Math.max(0, Math.floor(cx - hx - 1));
    const tx1 = Math.min(this.w, Math.ceil(cx + hx + 1));
    const ty0 = Math.max(0, Math.floor(cy - hy - 1));
    const ty1 = Math.min(this.h, Math.ceil(cy + hy + 1));
    for (let y = ty0; y < ty1; y++) {
      const py = y + 0.5 - cy;
      for (let x = tx0; x < tx1; x++) {
        const px = x + 0.5 - cx;
        const ax = Math.abs(px) - hx + r;
        const ay = Math.abs(py) - hy + r;
        const d = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - r;
        const cov = Math.min(Math.max(0.5 - d, 0), 1) * alpha;
        if (cov > 0) this.over((y * this.w + x) * 4, colour, cov);
      }
    }
  }

  /** A disc in points. */
  disc(cx: number, cy: number, radius: number, colour: RGB, alpha = 1): void {
    this.rect(cx - radius, cy - radius, cx + radius, cy + radius, radius, colour, alpha);
  }

  /** A triangle in points (its three corners), antialiased over a texel by its edges' distances. */
  triangle(
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
    colour: RGB,
  ): void {
    const P = [a, b, c].map(([x, y]) => [x * this.sx, y * this.sy] as const);
    const xs = P.map((p) => p[0]);
    const ys = P.map((p) => p[1]);
    const tx0 = Math.max(0, Math.floor(Math.min(...xs) - 1));
    const tx1 = Math.min(this.w, Math.ceil(Math.max(...xs) + 1));
    const ty0 = Math.max(0, Math.floor(Math.min(...ys) - 1));
    const ty1 = Math.min(this.h, Math.ceil(Math.max(...ys) + 1));
    // each edge's inward distance (the corners wound either way)
    const area =
      ((P[1]?.[0] ?? 0) - (P[0]?.[0] ?? 0)) * ((P[2]?.[1] ?? 0) - (P[0]?.[1] ?? 0)) -
      ((P[2]?.[0] ?? 0) - (P[0]?.[0] ?? 0)) * ((P[1]?.[1] ?? 0) - (P[0]?.[1] ?? 0));
    const s = area < 0 ? -1 : 1;
    for (let y = ty0; y < ty1; y++)
      for (let x = tx0; x < tx1; x++) {
        let d = Number.POSITIVE_INFINITY;
        for (let i = 0; i < 3; i++) {
          const [x0, y0] = P[i] ?? [0, 0];
          const [x1, y1] = P[(i + 1) % 3] ?? [0, 0];
          const ex = x1 - x0;
          const ey = y1 - y0;
          const len = Math.hypot(ex, ey) || 1;
          d = Math.min(d, (s * (ex * (y + 0.5 - y0) - ey * (x + 0.5 - x0))) / len);
        }
        const cov = Math.min(Math.max(d + 0.5, 0), 1);
        if (cov > 0) this.over((y * this.w + x) * 4, colour, cov);
      }
  }
}

/** Which segments light each digit (a b c d e f g — top, upper right, lower right, bottom, lower left, upper left, middle). */
const SEGMENTS: readonly string[] = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
];

/** A digit as segment bars, `h` points tall at (x, y) its top-left: the fixture's own figures (no font). Answers its width. */
function digit(R: Raster, n: number, x: number, y: number, h: number, colour: RGB): number {
  const w = h * 0.55;
  const t = h * 0.13;
  const lit = SEGMENTS[n] ?? "";
  const bar = (s: string, x0: number, y0: number, x1: number, y1: number): void => {
    if (lit.includes(s)) R.rect(x0, y0, x1, y1, t / 2, colour);
  };
  const mid = y + h / 2;
  bar("a", x + t * 0.6, y, x + w - t * 0.6, y + t);
  bar("b", x + w - t, y + t * 0.6, x + w, mid - t * 0.2);
  bar("c", x + w - t, mid + t * 0.2, x + w, y + h - t * 0.6);
  bar("d", x + t * 0.6, y + h - t, x + w - t * 0.6, y + h);
  bar("e", x, mid + t * 0.2, x + t, y + h - t * 0.6);
  bar("f", x, y + t * 0.6, x + t, mid - t * 0.2);
  bar("g", x + t * 0.6, mid - t / 2, x + w - t * 0.6, mid + t / 2);
  return w;
}

/** The clock "H:MM" in segment digits at (x, y), `h` tall, its time the fixture's (UTC — a still never reads a host's zone). */
function clock(R: Raster, at: number, x: number, y: number, h: number, colour: RGB): void {
  const d = new Date(at);
  const hours = d.getUTCHours() % 12 || 12;
  const minutes = d.getUTCMinutes();
  const gap = h * 0.18;
  let cx = x;
  for (const n of [...String(hours)].map(Number)) cx += digit(R, n, cx, y, h, colour) + gap;
  R.disc(cx + h * 0.06, y + h * 0.3, h * 0.07, colour);
  R.disc(cx + h * 0.06, y + h * 0.7, h * 0.07, colour);
  cx += h * 0.12 + gap;
  for (const n of [Math.floor(minutes / 10), minutes % 10])
    cx += digit(R, n, cx, y, h, colour) + gap;
}

/** A tile's figure — the fixture's own plain shapes, never an app's icon: a ring, a square, a triangle, bars, a dot pair. */
function figure(
  R: Raster,
  which: number,
  cx: number,
  cy: number,
  s: number,
  colour: RGB,
  under: RGB,
): void {
  switch (which % 5) {
    case 0:
      R.disc(cx, cy, s * 0.26, colour);
      R.disc(cx, cy, s * 0.15, under);
      break;
    case 1:
      R.rect(cx - s * 0.2, cy - s * 0.2, cx + s * 0.2, cy + s * 0.2, s * 0.05, colour);
      break;
    case 2:
      R.triangle(
        [cx, cy - s * 0.24],
        [cx + s * 0.24, cy + s * 0.18],
        [cx - s * 0.24, cy + s * 0.18],
        colour,
      );
      break;
    case 3:
      for (let i = 0; i < 3; i++)
        R.rect(
          cx - s * 0.22,
          cy - s * 0.17 + i * s * 0.14,
          cx + s * (0.22 - i * 0.08),
          cy - s * 0.1 + i * s * 0.14,
          s * 0.035,
          colour,
        );
      break;
    default:
      R.disc(cx - s * 0.12, cy, s * 0.11, colour);
      R.disc(cx + s * 0.12, cy, s * 0.11, colour);
  }
}

/**
 * ONE FRAME of the fixture's screen — sRGB rgba8, opaque, rows from the top — `size` texels, laid out for `screen` (points)
 * in a scheme, its clock at `at` (ms since the epoch). Deterministic: the same arguments are the same bytes on every host.
 */
export function fixtureFrame(
  screen: FeedScreen,
  size: readonly [number, number],
  scheme: Scheme,
  at: number,
): Uint8Array<ArrayBuffer> {
  const [W, H] = screen.pt;
  const C = PICTURE[scheme];
  const R = new Raster(Math.max(1, size[0]), Math.max(1, size[1]), size[0] / W, size[1] / H);
  // the wallpaper: a sky of soft light, its discs of glow
  R.shade((u, v) => {
    let c = mixRGB(C.sky[0], C.sky[1], Math.min(Math.max(v * 1.05 - u * 0.08, 0), 1));
    for (const [gx, gy, gr, gc] of C.glows) {
      const d = Math.hypot(u - gx, (v - gy) * (H / W)) / gr;
      c = mixRGB(c, gc, Math.max(0, 1 - d * d) * 0.55);
    }
    return c;
  });
  // the status bar: its clock at the left (beside the island or in the notch's ear), a battery at the right
  const bar =
    screen.kind === "island" && screen.pill
      ? screen.pill[2] + screen.pill[1] / 2
      : screen.kind === "notch"
        ? 22
        : 10;
  const digits = screen.kind === "classic" ? 9 : 12;
  clock(R, at, W * 0.11, bar - digits / 2, digits, C.text);
  R.rect(W * 0.84, bar - 5, W * 0.84 + 22, bar + 5, 3, C.text, 0.85);
  R.rect(W * 0.84 + 23, bar - 2, W * 0.84 + 25, bar + 2, 1, C.text, 0.85);
  // the island, drawn into the frame as iOS draws its own (only once the housing is wholly an island)
  if (screen.drawPill && screen.pill) {
    const [pw, ph, top] = screen.pill;
    R.rect(W / 2 - pw / 2, top, W / 2 + pw / 2, top + ph, ph / 2, C.pill);
  }
  // the grid of tiles: four across, as many rows as fit above the dock; each a plain figure and a greeked name under it
  const ic = Math.min(Math.max(W * 0.158, 54), 68);
  const side = Math.max((W - 4 * ic) / 5, 14);
  const gap = (W - 2 * side - 4 * ic) / 3;
  const top = bar + 34;
  const cellH = ic + 30;
  const dockH = ic + 26;
  const dockY = H - dockH - (screen.indicator ? 14 : 6);
  const rows = Math.max(1, Math.floor((dockY - 46 - top) / cellH));
  const tile = (i: number, x: number, y: number): void => {
    const c = C.tiles[i % C.tiles.length] ?? C.figure;
    R.rect(x, y, x + ic, y + ic, ic * 0.225, c);
    figure(R, i, x + ic / 2, y + ic / 2, ic, C.figure, c);
  };
  for (let i = 0; i < rows * 4; i++) {
    const x = side + (i % 4) * (ic + gap);
    const y = top + Math.floor(i / 4) * cellH;
    tile(i, x, y);
    const name = ic * (0.42 + ((i * 7) % 5) * 0.08);
    R.rect(
      x + ic / 2 - name / 2,
      y + ic + 10,
      x + ic / 2 + name / 2,
      y + ic + 15,
      2.5,
      C.text,
      0.85,
    );
  }
  // the dock — glass — and its four tiles
  R.rect(10, dockY, W - 10, dockY + dockH, Math.min(34, dockH / 2), C.glass, C.glassAlpha);
  for (let i = 0; i < 4; i++) tile(rows * 4 + i, side + i * (ic + gap), dockY + 13);
  // the home indicator, where there is no button
  if (screen.indicator) R.rect(W / 2 - 67, H - 13, W / 2 + 67, H - 8, 2.5, C.text, 0.9);
  return R.bytes;
}

/** A demand the feed takes (ICE's `LiveDemand`, the fields it reads). */
export interface FixtureDemand {
  readonly mode: "live" | "paused";
  readonly fps: number;
  readonly raster: readonly [number, number];
}

/** One frame the feed hands over: its bytes, its size, the points it was laid out at, and its count. */
export interface FixtureFrame {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  /** The screen's size in points (the frame's LOGICAL size — what a host presents it at). */
  readonly logical: readonly [number, number];
  readonly serial: number;
}

/**
 * THE FEED: the stream's contract over `fixtureFrame` — a frame at the demanded size and rate, none while nothing changed. Its
 * clock is the caller's (`now` — ms since the epoch: a still pins it, a host passes its own).
 */
export class FixtureFeed {
  private screen: FeedScreen;
  private scheme: Scheme;
  private size: readonly [number, number];
  private fps = 0;
  private dirty = true;
  private last = Number.NEGATIVE_INFINITY;
  private shownMinute = Number.NaN;
  private count = 0;

  /** A feed for a screen, its frames at `native` (the framebuffer) until a demand says otherwise; paused until one does. */
  constructor(screen: FeedScreen, native: readonly [number, number], scheme: Scheme) {
    this.screen = screen;
    this.size = native;
    this.scheme = scheme;
  }

  /** The demand: the frame's size and rate (paused: none). A new size is a frame due. */
  demand(d: FixtureDemand): void {
    if (d.mode === "live" && (d.raster[0] !== this.size[0] || d.raster[1] !== this.size[1])) {
      this.size = [d.raster[0], d.raster[1]];
      this.dirty = true;
    }
    this.fps = d.mode === "live" ? Math.max(d.fps, 0) : 0;
  }

  /** Another screen to lay out (a phone mid-morph): a frame is due. */
  reshape(screen: FeedScreen): void {
    if (sameScreen(screen, this.screen)) return;
    this.screen = screen;
    this.dirty = true;
  }

  /** The desk's scheme (the fixture follows it): a change is a frame due. */
  follow(scheme: Scheme): void {
    if (scheme === this.scheme) return;
    this.scheme = scheme;
    this.dirty = true;
  }

  /** Is a frame due at `now` (ms)? Something changed — the minute turned, the screen, the size, the scheme — and the rate allows it. */
  due(now: number): boolean {
    if (this.fps <= 0) return false;
    if (now - this.last < 1000 / this.fps - 1) return false;
    return this.dirty || Math.floor(now / 60_000) !== this.shownMinute;
  }

  /**
   * WHEN a frame is next due, ms on the caller's clock — what a live source wakes its face at (fixture-live.ts): `now` when one is
   * due already; else the rate's next slot after the next change — and with nothing told, the only change the feed makes by
   * itself is its clock's minute turning; never while paused. `due(t)` is true at every `t` from this on (until a frame is taken).
   */
  next(now: number): number {
    if (this.fps <= 0) return Number.POSITIVE_INFINITY;
    const slot = this.last + 1000 / this.fps - 1;
    const minute = Math.floor(now / 60_000);
    const changed = this.dirty || minute !== this.shownMinute ? now : (minute + 1) * 60_000;
    return Math.max(changed, slot);
  }

  /** The frame for `now` when one is due, else undefined (nothing changed, or the rate holds it back, or paused). */
  frame(now: number): FixtureFrame | undefined {
    if (!this.due(now)) return undefined;
    const [width, height] = this.size;
    const bytes = fixtureFrame(this.screen, this.size, this.scheme, now);
    this.dirty = false;
    this.last = now;
    this.shownMinute = Math.floor(now / 60_000);
    this.count += 1;
    return { bytes, width, height, logical: this.screen.pt, serial: this.count };
  }

  /** Frames handed over since the feed was made. */
  get frames(): number {
    return this.count;
  }
}
