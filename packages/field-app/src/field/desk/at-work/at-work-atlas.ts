import type { SparkId } from "@vibefield/contracts";
import {
  bakeFlatStars,
  type FlatStarBake,
  type FlatStarBakeStage,
  loadSparklings,
  type Sparklings,
} from "@vibefield/design-kit/spark-face";
import { agentMark } from "@vibefield/puppeteer-view-sdk/toolkit";
import { colourOf, rootToken } from "../../../frame/cards/press/press-colours";
import { monoStack } from "../desk-glyphs";
import type { Rgb01 } from "./at-work-ink";

// THE AT-WORK STICKER ATLAS (item 550, 2026-11-18; DESIGN.md §2.8 "the at-work sticker", §2.10 "printed"). The die-cut
// sticker is cut from distance fields the window bakes itself: one cell of 160 texels per mark, a spread of 42 texels,
// R the mark itself and G its silhouette with every hole filled (where the sticker's paper is cut). The swarm's
// AGENT_MARK_ATLAS is not used: its 8-texel spread reaches about 2.5 ink px past a 15 px mark, short of the 4.1 px foil
// and the 1.6 px paper edge.
//
// - A MARK is baked from the view SDK toolkit's `agentMark(id)` on first sight: its paths through Path2D, or, for an
//   id with no paths, its letter in the product's monospace stack (`--vf-font-mono`), as `agentMarkSvg` sets it. The
//   id is only ever looked up, never compared (wall R23b).
// - A COUNT ("+N", the third seat past three agents, or the merged band's) is its text on a paper pill, no foil.
// - A PRINTED STAR (a crew run's sticker wears its spark's star) is baked once per spark through the kit's typed bake
//   (`bakeFlatStars`: the engine's Flat style, drawn with its face and without it, in one transient context): the
//   outline is the face-less star's alpha (G), the eyes where the two differ (R). Its tone is its palette's first
//   colour leaning to its third and fifth.
//
// Cells are appended in a grid `cols` wide; the layer uploads `texels()` as an RG8 texture whenever its revision
// moves. Nothing here holds a colour of its own: a mark is coverage (the canvas's default fill, never read as a
// colour), and a star's tone is its palette's, which the engine carries as data. Where the window has no 2D canvas
// (or no Path2D) it can bake nothing (`canBake`), and the layer keeps to its DOM form.

/** Item 550 (2026-11-18): the atlas's geometry, in texels (DESIGN.md §2.8). */
export const AT_WORK_ATLAS = {
  /** one cell's side, and how far its fields reach either side of an edge */
  cell: 160,
  spread: 42,
  /** a mark's 24-unit box is laid 72 texels across (3 a unit), centred in its cell */
  units: 24,
  mark: 72,
  /** a printed star's radius in its cell */
  star: 36,
  /** cells a row of the texture (1280 texels) */
  cols: 8,
  /** an id with no paths: its letter as the view SDK's `agentMarkSvg` sets it, in units */
  letter: { weight: 800, size: 21, x: 12, y: 19.5 },
  /** a count: its text at 52 texels on a pill 62 × 36; a longer count is set smaller, so its text is never wider than
   * `textMost`, and its pill widens with it */
  count: { weight: 800, size: 52, lift: 2.5, pillWidth: 62, pillHeight: 36, textMost: 82 },
} as const;

/** Item 550 (2026-11-18): the sticker, in ink px (DESIGN.md §2.8 "the at-work sticker", §2.10 "printed"). */
export const AT_WORK_STICKER = {
  /** ink px a mark unit: a 24-unit mark is 15 ink px across */
  scale: 0.625,
  /** the foil past the mark's silhouette, the paper edge past the foil, the cut line past the paper */
  foil: 4.1,
  edge: 1.6,
  cut: 0.7,
  /** a worn star: its radius, how far its outline stands clear of the mark's, the shoulder it sits on (degrees above
   * the mark's right), the bare paper between it and the agent's foil, the fillet where the two join, its own lean */
  crew: { radius: 6.6, clear: 2, shoulder: 40, channel: 1.1, fillet: 2.6, tilt: -6 },
} as const;

/** A spark's printed star in the atlas: its cell (eyes in R, outline in G) and its tone, sRGB-encoded 0–1. */
export interface AtWorkPrintedStar {
  readonly cell: number;
  /** the palette's first colour (the flat body), and the two its foil leans to (its third and fifth) */
  readonly tone: { readonly c: Rgb01; readonly a: Rgb01; readonly b: Rgb01 };
}

/** The atlas as the layer uploads it: RG8, `width` × `height` texels, row 0 at the top. */
export interface AtWorkAtlasTexels {
  readonly data: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  /** moves whenever a cell is added: upload again */
  readonly revision: number;
}

export interface AtWorkAtlas {
  /** whether this window can bake a cell at all (a 2D canvas and Path2D): without, the GL form cannot draw a sticker */
  canBake(): boolean;
  /** the cell carrying agent `agent`'s mark, baked on first sight; null where this window cannot draw one */
  mark(agent: string): number | null;
  /** the cell carrying "+`n`" on its paper pill, baked on first need; null where this window cannot draw one */
  count(n: number): number | null;
  /** spark `spark`'s printed star, its face dealt by `seed` (the spark's face seed, as Chat reads its record):
   * undefined while it bakes (the first ask starts it), null where it cannot be baked (no engine, no WebGL2, or the
   * star did not draw) */
  star(spark: SparkId, seed: number): AtWorkPrintedStar | null | undefined;
  /** where a printed star sits on a mark, ink px from the mark's centre, at its full size (memoised) */
  crewSeat(markCell: number, starCell: number): readonly [number, number];
  texels(): AtWorkAtlasTexels;
  /** told when a star's bake lands (the layer then uploads and draws again); returns the unsubscribe */
  subscribe(listener: () => void): () => void;
}

/** A canvas laid out out of sight, for the engine to measure (its `resize` reads the element's box): the kit's own. */
export type AtWorkBakeStage = FlatStarBakeStage;

/** What the atlas draws with (a test hands its doubles). */
export interface AtWorkAtlasDeps {
  /** a 2D surface `width` × `height` texels, or null where the window has none */
  readonly canvas: (width: number, height: number) => HTMLCanvasElement | null;
  /** the product's font stacks, read off the root */
  readonly mono: () => string;
  readonly sans: () => string;
  /** the spark engine, through the kit's one door */
  readonly sparklings: () => Promise<Sparklings>;
  /** a canvas laid out out of sight, `width` × `height` CSS px, or null where there is no document */
  readonly stage: (width: number, height: number) => AtWorkBakeStage | null;
  /** the engine's pixel ratio: the window's, under the engine's own cap of 2 */
  readonly ratio: () => number;
  /** when queued bakes run: after the frame that asked, never in the desk's flush (the engine measures the bake's
   * canvas as it is made) */
  readonly later: (run: () => void) => void;
}

const DEFAULT_DEPS: AtWorkAtlasDeps = {
  canvas: (width, height) => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  mono: monoStack,
  sans: () => rootToken("--vf-font-sans") || "sans-serif",
  sparklings: loadSparklings,
  stage: bakeStage,
  ratio: () => (typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2)),
  later: (run) => {
    setTimeout(run, 0);
  },
};

/** The engine's canvas laid out where it is measured and never seen: fixed, wholly left of the window, never hit,
 * silent to a screen reader. */
function bakeStage(width: number, height: number): AtWorkBakeStage | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "fixed";
  canvas.style.left = `${-(width + 600)}px`;
  canvas.style.top = "0px";
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.pointerEvents = "none";
  document.body.append(canvas);
  return { canvas, release: () => canvas.remove() };
}

// ———————————————————————————————————————————————————————————————— the distance field

const INF = 1e20;

/** One line of the squared Euclidean distance transform, in place (Felzenszwalb & Huttenlocher). */
function edt1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array,
): void {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset]!;
  let k = 0;
  for (let q = 1; q < length; q += 1) {
    f[q] = grid[offset + q * stride]!;
    const q2 = q * q;
    let r = v[k]!;
    let s = (f[q]! - f[r]! + q2 - r * r) / (q - r) / 2;
    while (s <= z[k]!) {
      k -= 1;
      if (k < 0) break;
      r = v[k]!;
      s = (f[q]! - f[r]! + q2 - r * r) / (q - r) / 2;
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (z[k + 1]! < q) k += 1;
    const r = v[k]!;
    const qr = q - r;
    grid[offset + q * stride] = f[r]! + qr * qr;
  }
}

/** A coverage map (0–1 a texel) as an 8-bit signed distance field: 0.5 at the edge, `spread` texels to either end.
 * PURE. */
export function distanceField(
  alpha: Float32Array,
  width: number,
  height: number,
  spread: number = AT_WORK_ATLAS.spread,
): Uint8Array<ArrayBuffer> {
  const size = width * height;
  const outer = new Float64Array(size);
  const inner = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const a = alpha[i]!;
    if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const v = new Uint16Array(n);
  const z = new Float64Array(n + 1);
  for (const grid of [outer, inner]) {
    for (let x = 0; x < width; x += 1) edt1d(grid, x, width, height, f, v, z);
    for (let y = 0; y < height; y += 1) edt1d(grid, y * width, 1, width, f, v, z);
  }
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    const d = Math.sqrt(outer[i]!) - Math.sqrt(inner[i]!);
    out[i] = Math.round(Math.min(Math.max(0.5 - d / (2 * spread), 0), 1) * 255);
  }
  return out;
}

/** Fills a silhouette's holes in place: every empty texel the cell's border cannot reach belongs to it. PURE but for
 * `sil`. */
export function fillHoles(sil: Float32Array, size: number): void {
  const seen = new Uint8Array(size * size);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const k = y * size + x;
    if (seen[k] === 1 || sil[k]! >= 0.5) return;
    seen[k] = 1;
    stack.push(k);
  };
  for (let t = 0; t < size; t += 1) {
    push(t, 0);
    push(t, size - 1);
    push(0, t);
    push(size - 1, t);
  }
  let k = stack.pop();
  while (k !== undefined) {
    const x = k % size;
    const y = (k - x) / size;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
    k = stack.pop();
  }
  for (let i = 0; i < size * size; i += 1) if (seen[i] === 0 && sil[i]! < 0.5) sil[i] = 1;
}

// ———————————————————————————————————————————————————————————————— drawing a cell

type Mark = ReturnType<typeof agentMark>;

/** A cell's coverage as `draw` lays it, 0–1 a texel, or null where the window has no 2D canvas. The canvas's default
 * fill is used: only the alpha is read. */
function coverage(
  deps: AtWorkAtlasDeps,
  draw: (ctx: CanvasRenderingContext2D) => boolean,
): Float32Array | null {
  const size = AT_WORK_ATLAS.cell;
  const ctx = deps.canvas(size, size)?.getContext("2d", { willReadFrequently: true }) ?? null;
  if (ctx === null) return null;
  ctx.clearRect(0, 0, size, size);
  if (!draw(ctx)) return null;
  const px = ctx.getImageData(0, 0, size, size).data;
  const alpha = new Float32Array(size * size);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = px[i * 4 + 3]! / 255;
  return alpha;
}

/** A mark in its cell: 3 texels a unit, centred (a letter as `agentMarkSvg` sets it). */
function drawMark(ctx: CanvasRenderingContext2D, mark: Mark, family: string): boolean {
  const { cell, mark: across, units, letter } = AT_WORK_ATLAS;
  const pad = (cell - across) / 2;
  const k = across / units;
  ctx.save();
  ctx.translate(pad, pad);
  ctx.scale(k, k);
  if (mark.kind === "path") {
    if (typeof Path2D === "undefined") {
      ctx.restore();
      return false;
    }
    // each path filled on its own under the mark's rule, as an SVG's paths are
    for (const d of mark.paths) ctx.fill(new Path2D(d), mark.evenOdd ? "evenodd" : "nonzero");
  } else {
    ctx.font = `${letter.weight} ${letter.size}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(mark.letter, letter.x, letter.y);
  }
  ctx.restore();
  return true;
}

/** A count's text, or its paper pill. */
function drawCount(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  sheet: boolean,
): boolean {
  const { cell, count } = AT_WORK_ATLAS;
  const mid = cell / 2;
  ctx.font = `${count.weight} ${count.size}px ${family}`;
  const wide = ctx.measureText(text).width;
  // a count wider than `textMost` at the count's size is set smaller, so it never is; its pill widens to the text
  const size = wide > count.textMost ? (count.size * count.textMost) / wide : count.size;
  ctx.font = `${count.weight} ${size}px ${family}`;
  if (sheet) {
    const width = Math.max(count.pillWidth, ctx.measureText(text).width);
    ctx.beginPath();
    ctx.roundRect(
      mid - width / 2,
      mid - count.pillHeight / 2,
      width,
      count.pillHeight,
      count.pillHeight / 2,
    );
    ctx.fill();
  } else {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, mid, mid + count.lift);
  }
  return true;
}

// ———————————————————————————————————————————————————————————————— the printed star's bake

/** The printed star's pose (DESIGN.md §2.10 "printed"): calm and still, its eyes a little larger as the kit draws them
 * at small sizes, glancing down at the mark beside it. */
const STAR_POSE = { faceScale: 1.25, look: [-0.55, -0.4] as const } as const;

/** A baked star that drew nothing is no star: under `area` texels of outline, or eyes fainter than `eyes`. */
const STAR_DREW = { area: 400, eyes: 0.05 } as const;

/** At most this many sparks a bake, two engine cells each. */
const BATCH = 32;

interface Baked {
  readonly eyes: Uint8Array<ArrayBuffer>;
  readonly outline: Uint8Array<ArrayBuffer>;
  readonly tone: AtWorkPrintedStar["tone"];
}

const toneOf = (spelled: string | undefined): Rgb01 | null => {
  const colour = spelled === undefined ? null : colourOf(spelled);
  if (colour === null) return null;
  const [r, g, b] = colour.rgb;
  return [r / 255, g / 255, b / 255];
};

/** A bake's two renders as the atlas's fields: the outline from the face-less star's alpha, the eyes where the two
 * renders differ inside it (normalised to the strongest), or null where the star did not draw. PURE. */
export function starFieldsOf(bake: FlatStarBake): Baked | null {
  const { cell } = AT_WORK_ATLAS;
  if (bake.size !== cell) return null;
  const size = cell * cell;
  const sil = new Float32Array(size);
  const eye = new Float32Array(size);
  let ref = 0;
  let area = 0;
  for (let n = 0; n < size; n += 1) {
    const at = n * 4;
    sil[n] = bake.bare[at + 3]! / 255;
    area += sil[n]!;
    if (sil[n]! > 0.98) {
      const d = Math.max(
        Math.abs(bake.face[at]! - bake.bare[at]!),
        Math.abs(bake.face[at + 1]! - bake.bare[at + 1]!),
        Math.abs(bake.face[at + 2]! - bake.bare[at + 2]!),
      );
      eye[n] = d / 255;
      ref = Math.max(ref, eye[n]!);
    }
  }
  if (area < STAR_DREW.area || ref < STAR_DREW.eyes) return null;
  for (let n = 0; n < size; n += 1) eye[n] = Math.min(eye[n]! / ref, 1);
  const c = toneOf(bake.palette.c[0]);
  const a = toneOf(bake.palette.c[2]);
  const b = toneOf(bake.palette.c[4]);
  if (c === null || a === null || b === null) return null;
  return {
    eyes: distanceField(eye, cell, cell),
    outline: distanceField(sil, cell, cell),
    tone: { c, a, b },
  };
}

/** Bakes each spark's printed star through the kit's typed bake: one transient context, let go before it returns. */
async function bakeStars(
  batch: readonly { readonly seed: number }[],
  deps: AtWorkAtlasDeps,
): Promise<readonly (Baked | null)[]> {
  const none = batch.map((): Baked | null => null);
  const engines = await deps.sparklings().catch(() => null);
  if (engines === null) return none;
  const bakes = bakeFlatStars(
    engines,
    batch.map(({ seed }) => seed),
    {
      cell: AT_WORK_ATLAS.cell,
      radius: AT_WORK_ATLAS.star,
      faceScale: STAR_POSE.faceScale,
      look: STAR_POSE.look,
      ratio: deps.ratio(),
      stage: deps.stage,
      surface: deps.canvas,
    },
  );
  return batch.map((_, i) => {
    const bake = bakes[i] ?? null;
    return bake === null ? null : starFieldsOf(bake);
  });
}

// ———————————————————————————————————————————————————————————————— the atlas

/** The window's sticker atlas. Cells are appended as marks, counts and stars are first asked for. */
export function createAtWorkAtlas(overrides: Partial<AtWorkAtlasDeps> = {}): AtWorkAtlas {
  const deps: AtWorkAtlasDeps = { ...DEFAULT_DEPS, ...overrides };
  const { cell, cols } = AT_WORK_ATLAS;
  const width = cols * cell;
  let data = new Uint8Array(width * cell * 2);
  let rows = 1;
  let cells = 0;
  let revision = 0;
  let bakeable: boolean | null = null;
  const marks = new Map<string, number | null>();
  const counts = new Map<number, number | null>();
  const stars = new Map<SparkId, AtWorkPrintedStar | null | undefined>();
  const seats = new Map<string, readonly [number, number]>();
  const rims = new Map<number, Float32Array>();
  const listeners = new Set<() => void>();
  let queue: { readonly spark: SparkId; readonly seed: number }[] = [];
  let queued = false;
  // one bake at a time: a second waits for the first, so the window never holds two bake contexts
  let baking: Promise<void> = Promise.resolve();

  const index = (c: number, x: number, y: number): number =>
    ((Math.floor(c / cols) * cell + y) * width + (c % cols) * cell + x) * 2;

  /** A new cell from its two fields: R and G. */
  const append = (r: Uint8Array, g: Uint8Array): number => {
    const c = cells;
    const need = Math.floor(c / cols) + 1;
    if (need > rows) {
      const grown = new Uint8Array(width * cell * need * 2);
      grown.set(data);
      data = grown;
      rows = need;
    }
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const k = index(c, x, y);
        data[k] = r[y * cell + x]!;
        data[k + 1] = g[y * cell + x]!;
      }
    }
    cells += 1;
    revision += 1;
    return c;
  };

  const bakeMark = (agent: string): number | null => {
    const mark = agentMark(agent);
    const family = deps.mono();
    const ink = coverage(deps, (ctx) => drawMark(ctx, mark, family));
    if (ink === null) return null;
    const sil = ink.slice();
    fillHoles(sil, cell);
    return append(distanceField(ink, cell, cell), distanceField(sil, cell, cell));
  };

  const bakeCount = (n: number): number | null => {
    const text = `+${n}`;
    const family = deps.sans();
    const ink = coverage(deps, (ctx) => drawCount(ctx, text, family, false));
    const sil = coverage(deps, (ctx) => drawCount(ctx, text, family, true));
    if (ink === null || sil === null) return null;
    fillHoles(sil, cell);
    return append(distanceField(ink, cell, cell), distanceField(sil, cell, cell));
  };

  const schedule = (): void => {
    if (queued) return;
    queued = true;
    deps.later(() => {
      // a listener that throws must not stop the bakes after it
      baking = baking.then(flush).catch(() => undefined);
    });
  };

  const flush = async (): Promise<void> => {
    queued = false;
    const batch = queue.slice(0, BATCH);
    queue = queue.slice(BATCH);
    if (queue.length > 0) schedule();
    if (batch.length === 0) return;
    const baked = await bakeStars(batch, deps);
    for (const [i, { spark }] of batch.entries()) {
      const one = baked[i] ?? null;
      stars.set(
        spark,
        one === null ? null : { cell: append(one.eyes, one.outline), tone: one.tone },
      );
    }
    for (const listener of listeners) listener();
  };

  /** The star cell's outline points, in the star's radii. */
  const rimOf = (starCell: number): Float32Array => {
    const known = rims.get(starCell);
    if (known !== undefined) return known;
    const { star } = AT_WORK_ATLAS;
    const pts: number[] = [];
    for (let y = 1; y < cell - 1; y += 1) {
      for (let x = 1; x < cell - 1; x += 1) {
        if (Math.abs(data[index(starCell, x, y) + 1]! - 127.5) <= 2.5)
          pts.push((x + 0.5 - cell / 2) / star, (y + 0.5 - cell / 2) / star);
      }
    }
    const rim = Float32Array.from(pts);
    rims.set(starCell, rim);
    return rim;
  };

  /** Where the star sits on a mark: out along the mark's shoulder until the star's outline stands `clear` of the
   * mark's silhouette (DESIGN.md §2.10 "printed": one sheet, the star on the mark's shoulder). */
  const crewSeatOf = (markCell: number, starCell: number): readonly [number, number] => {
    const { spread, mark: across, units } = AT_WORK_ATLAS;
    const { radius, clear, shoulder, tilt } = AT_WORK_STICKER.crew;
    const tpx = across / units / AT_WORK_STICKER.scale; // a mark's texels an ink px
    const rim = rimOf(starCell);
    /** the mark's silhouette's distance at an ink-px point from its centre (bilinear on G) */
    const markAt = (px: number, py: number): number => {
      const fx = px * tpx + cell / 2 - 0.5;
      const fy = py * tpx + cell / 2 - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= cell - 1 || iy >= cell - 1) return spread / tpx;
      const tx = fx - ix;
      const ty = fy - iy;
      const g = (x: number, y: number): number => data[index(markCell, x, y) + 1]!;
      const top = g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx;
      const foot = g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx;
      const v = top * (1 - ty) + foot * ty;
      return (((127.5 - v) / 255) * 2 * spread) / tpx;
    };
    const a = (shoulder * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = -Math.sin(a);
    const ct = Math.cos((tilt * Math.PI) / 180);
    const st = Math.sin((tilt * Math.PI) / 180);
    let seat: readonly [number, number] = [ux * 24, uy * 24];
    for (let t = 3; t < 24; t += 0.1) {
      let near = 1e9;
      for (let i = 0; i < rim.length && near >= clear; i += 2) {
        const bx = rim[i]! * radius;
        const by = rim[i + 1]! * radius;
        near = Math.min(near, markAt(t * ux + ct * bx - st * by, t * uy + st * bx + ct * by));
      }
      if (near >= clear) {
        seat = [t * ux, t * uy];
        break;
      }
    }
    return seat;
  };

  return {
    canBake() {
      if (bakeable === null) {
        const probe = deps.canvas(1, 1)?.getContext("2d") ?? null;
        bakeable = probe !== null && typeof Path2D !== "undefined";
      }
      return bakeable;
    },
    mark(agent) {
      if (!marks.has(agent)) marks.set(agent, bakeMark(agent));
      return marks.get(agent) ?? null;
    },
    count(n) {
      if (!counts.has(n)) counts.set(n, bakeCount(n));
      return counts.get(n) ?? null;
    },
    star(spark, seed) {
      if (stars.has(spark)) return stars.get(spark);
      stars.set(spark, undefined);
      queue.push({ spark, seed });
      schedule();
      return undefined;
    },
    crewSeat(markCell, starCell) {
      const key = `${markCell}|${starCell}`;
      const known = seats.get(key);
      if (known !== undefined) return known;
      const seat = crewSeatOf(markCell, starCell);
      seats.set(key, seat);
      return seat;
    },
    texels: () => ({ data, width, height: rows * cell, revision }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
