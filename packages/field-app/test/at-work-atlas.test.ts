// @vitest-environment node
/**
 * Item 550 (2026-11-18) — THE AT-WORK STICKER ATLAS (DESIGN.md §2.8 "the at-work sticker", §2.10 "printed"). The fields
 * the sticker is cut from, baked in the window: a distance field reads 0.5 at its shape's edge and 1 deep inside; a
 * silhouette's holes are filled (an "O" is one sheet of paper); a crew star sits on its mark's shoulder clear of the
 * mark by `clear`; a count never sets its text wider than `textMost`; a printed star is baked through the kit's typed
 * bake, refused (and its one context let go) where the engine sized its canvas otherwise, and its eyes and outline read
 * where it drew; a window with no 2D canvas, or no Path2D, can bake nothing. Over a 2D surface of the test's own and a
 * stand-in spark engine. Red first: the atlas's commit makes these hold.
 */
import type { Sparklings, SparkPalette } from "@vibefield/design-kit/spark-face";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AT_WORK_ATLAS,
  AT_WORK_STICKER,
  type AtWorkAtlasDeps,
  createAtWorkAtlas,
  distanceField,
  fillHoles,
} from "../src/field/desk/at-work/at-work-atlas";
import { AT_WORK } from "../src/field/desk/at-work/at-work-model";

afterEach(() => {
  vi.unstubAllGlobals();
});

const { cell, spread } = AT_WORK_ATLAS;
const SPARK = "sp-vela0001";

/** A disc's coverage in a cell: centred at (cx, cy) in texel-centre coordinates, `r` texels, its edge anti-aliased. */
function disc(r: number, cx = cell / 2, cy = cell / 2, size = cell): Float32Array {
  const alpha = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      alpha[y * size + x] = Math.min(Math.max(r - d + 0.5, 0), 1);
    }
  return alpha;
}

/** A field's value at a texel, 0–1. */
const at = (field: Uint8Array, x: number, y: number, size = cell): number =>
  (field[y * size + x] ?? 0) / 255;

interface Drawn {
  readonly kind: "text" | "pill";
  readonly text: string;
  /** the text's width as measured at the font it was set in; a pill's width */
  readonly width: number;
}

/**
 * A 2D surface of the test's own: what is drawn on it is noted (its text measured at 0.62 of its font's size a
 * character), and each read gives back the next coverage the test laid (or a picture of a given size), as RGBA.
 */
function surfaces(opts: {
  readonly covers?: Float32Array[];
  readonly pictures?: ReadonlyMap<string, Uint8ClampedArray>;
}) {
  const covers = [...(opts.covers ?? [])];
  const drawn: Drawn[] = [];
  const make = (width: number, height: number): HTMLCanvasElement => {
    let font = "";
    const sizeOf = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);
    const measure = (text: string): number => sizeOf() * 0.62 * text.length;
    const ctx = {
      get font() {
        return font;
      },
      set font(value: string) {
        font = value;
      },
      textAlign: "start",
      textBaseline: "alphabetic",
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      fill: () => {},
      drawImage: () => {},
      measureText: (text: string) => ({ width: measure(text) }),
      fillText: (text: string) => {
        drawn.push({ kind: "text", text, width: measure(text) });
      },
      roundRect: (_x: number, _y: number, w: number) => {
        drawn.push({ kind: "pill", text: "", width: w });
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const picture = opts.pictures?.get(`${w}x${h}`);
        if (picture !== undefined) return { data: picture };
        const data = new Uint8ClampedArray(w * h * 4);
        const cover = covers.shift();
        if (cover !== undefined)
          for (let i = 0; i < w * h; i += 1) data[i * 4 + 3] = Math.round((cover[i] ?? 0) * 255);
        return { data };
      },
    };
    return {
      width,
      height,
      getContext: (kind: string) => (kind === "2d" ? ctx : null),
    } as unknown as HTMLCanvasElement;
  };
  return { make, drawn };
}

function depsOf(overrides: Partial<AtWorkAtlasDeps>): Partial<AtWorkAtlasDeps> {
  return {
    mono: () => "monospace",
    sans: () => "sans-serif",
    ratio: () => 2,
    later: (run) => run(),
    sparklings: () => Promise.reject(new Error("no engine here")),
    stage: () => null,
    ...overrides,
  };
}

/** The bakes in flight land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the fields the sticker is cut from", () => {
  it("a distance field reads 0.5 at its shape's edge and 1 deep inside it, 0 far outside", () => {
    // a disc wider than the spread, so its centre saturates
    const r = 60;
    const field = distanceField(disc(r, 80.5, 80.5), cell, cell);
    expect(Math.abs(at(field, 80, 80) - 1)).toBeLessThanOrEqual(1 / 255);
    // the texel whose centre lies on the edge (its coverage exactly a half)
    expect(Math.abs(at(field, 80 + r, 80) - 0.5)).toBeLessThanOrEqual(1 / 255);
    expect(at(field, 0, 0)).toBe(0);
    expect(spread).toBe(42);
  });

  it("fills an O's hole: the counter is the silhouette's, the outside stays bare", () => {
    const size = 64;
    const ring = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
        ring[y * size + x] = d >= 12 && d <= 20 ? 1 : 0;
      }
    fillHoles(ring, size);
    expect(ring[32 * size + 32]).toBe(1);
    expect(ring[32 * size + 25]).toBe(1);
    expect(ring[2 * size + 2]).toBe(0);
    expect(ring[32 * size + 60]).toBe(0);
  });
});

describe("the atlas's cells", () => {
  it("cuts a sticker to the radius the model seats: half its 15 px mark, its 4.1 of foil and its 1.6 paper edge", () => {
    const { foil, edge, scale } = AT_WORK_STICKER;
    const mark = AT_WORK_ATLAS.units * scale;
    expect(mark).toBe(15);
    expect(AT_WORK.seat.sticker).toBeCloseTo(mark / 2 + foil + edge, 9);
    expect(AT_WORK.seat.sticker).toBeCloseTo(13.2, 9);
  });

  it("can bake only with a 2D canvas and Path2D", () => {
    expect(createAtWorkAtlas(depsOf({ canvas: () => null })).canBake()).toBe(false);
    const { make } = surfaces({});
    expect(createAtWorkAtlas(depsOf({ canvas: make })).canBake()).toBe(false);
    vi.stubGlobal("Path2D", class {});
    expect(createAtWorkAtlas(depsOf({ canvas: make })).canBake()).toBe(true);
  });

  it("stands a crew star on its mark's shoulder, its outline `clear` of the mark's silhouette", () => {
    // a mark of 24 texels' radius (5 ink px: 4.8 texels an ink px) and a star cell of the star's own radius
    const tpx = AT_WORK_ATLAS.mark / AT_WORK_ATLAS.units / AT_WORK_STICKER.scale;
    const markR = 24;
    const { make } = surfaces({ covers: [disc(markR, 80, 80), disc(AT_WORK_ATLAS.star, 80, 80)] });
    const atlas = createAtWorkAtlas(depsOf({ canvas: make }));
    // an id with no paths is its letter: drawn as text, the coverage the test laid
    const mark = atlas.mark("fixture-mark-a");
    const star = atlas.mark("fixture-mark-b");
    if (mark === null || star === null) throw new Error("the cells did not bake");
    const [x, y] = atlas.crewSeat(mark, star);
    const { radius, clear, shoulder } = AT_WORK_STICKER.crew;
    const want = markR / tpx + radius + clear;
    const t = Math.hypot(x, y);
    // the march's step (0.1) and the 8-bit field's rim (about 0.15 ink px either way)
    expect(t).toBeGreaterThanOrEqual(want - 0.3);
    expect(t).toBeLessThanOrEqual(want + 0.4);
    expect((Math.atan2(-y, x) * 180) / Math.PI).toBeCloseTo(shoulder, 3);
    // memoised: the same seat again
    expect(atlas.crewSeat(mark, star)).toBe(atlas.crewSeat(mark, star));
  });

  it("sets a count's text no wider than `textMost`, its pill wide enough for it", () => {
    const { make, drawn } = surfaces({});
    const atlas = createAtWorkAtlas(depsOf({ canvas: make }));
    expect(atlas.count(12)).not.toBeNull();
    const texts = drawn.filter((d) => d.kind === "text");
    const pills = drawn.filter((d) => d.kind === "pill");
    expect(texts.map((d) => d.text)).toEqual(["+12"]);
    for (const d of texts) expect(d.width).toBeLessThanOrEqual(AT_WORK_ATLAS.count.textMost + 1e-9);
    for (const d of pills) {
      expect(d.width).toBeGreaterThanOrEqual(AT_WORK_ATLAS.count.pillWidth);
      expect(d.width).toBeLessThanOrEqual(AT_WORK_ATLAS.count.textMost + 1e-9);
    }
  });
});

// ———————————————————————————————————————————————————————————————— the printed star, through the kit's bake

/** A stand-in for the vendored Buddy: it holds what the bake sets on it. */
class FakeBuddy {
  x = 0;
  y = 0;
  R = 0;
  faceScale = 1;
  rest = "calm";
  cut: unknown = null;
  clip: unknown = null;
  hidden = false;
  alpha = 1;
  look: [number, number] = [0, 0];
  constructor(readonly options: Readonly<Record<string, unknown>>) {}
  feel(): FakeBuddy {
    return this;
  }
  settle(): FakeBuddy {
    return this;
  }
}

/** A palette as the engine carries one: its colours as data, read by the atlas for the star's tone. */
const PALETTE: SparkPalette = {
  name: "stand-in",
  c: ["rgb(10 20 30)", "rgb(0 0 0)", "rgb(40 50 60)", "rgb(0 0 0)", "rgb(70 80 90)"],
  deep: ["rgb(0 0 0)", "rgb(0 0 0)"],
};

/** A stand-in engine that sizes its canvas `width` × `height` device px. */
function enginesSized(width: number, height: number): Sparklings {
  class FakeEngine {
    constructor(canvas: HTMLCanvasElement) {
      canvas.width = width;
      canvas.height = height;
    }
    add(buddy: FakeBuddy): FakeBuddy {
      return buddy;
    }
    remove(): void {}
    clear(): void {}
    resize(): void {}
    render(): void {}
  }
  return {
    Engine: FakeEngine,
    Buddy: FakeBuddy,
    PALETTES: [PALETTE],
    STATUSES: [],
    MOTION: {},
    agentDNA: (seed: number) => ({ seed, palette: 0, body: {}, eyes: {} }),
    makeBody: () => ({ n: 5, core: 0.4, k: 0.2, tip: 0.1, pts: [] }),
    makeEyes: () => ({ gap: 0.4, y: 0.1, w: 0.1, h: 0.2 }),
  } as unknown as Sparklings;
}

/** The bake's canvas, laid out where the engine measures it: its one context, and its release, watched. */
function bakeStage() {
  const lose = vi.fn();
  const release = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) =>
      kind === "webgl2" ? { getExtension: () => ({ loseContext: lose }) } : null,
  } as unknown as HTMLCanvasElement;
  return { stage: () => ({ canvas, release }), lose, release };
}

/** One seed's two renders side by side, as the engine draws them: the star with its eyes, then without. */
function starPicture(): Uint8ClampedArray {
  const width = cell * 2;
  const data = new Uint8ClampedArray(width * cell * 4);
  for (let y = 0; y < cell; y += 1)
    for (let x = 0; x < width; x += 1) {
      const local = x % cell;
      const inside = Math.hypot(local + 0.5 - 80, y + 0.5 - 80) <= AT_WORK_ATLAS.star;
      if (!inside) continue;
      const eye =
        x < cell &&
        (Math.hypot(local + 0.5 - 68, y + 0.5 - 74) <= 5 ||
          Math.hypot(local + 0.5 - 92, y + 0.5 - 74) <= 5);
      const at = (y * width + x) * 4;
      data[at] = eye ? 20 : 200;
      data[at + 1] = eye ? 20 : 200;
      data[at + 2] = eye ? 20 : 200;
      data[at + 3] = 255;
    }
  return data;
}

describe("the printed star is baked through the kit's typed bake (DESIGN.md §2.10 'printed')", () => {
  it("refuses a canvas the engine sized otherwise, and lets its one context go", async () => {
    const { stage, lose, release } = bakeStage();
    const { make } = surfaces({});
    const atlas = createAtWorkAtlas(
      depsOf({
        canvas: make,
        stage,
        sparklings: async () => enginesSized(cell * 2 + 1, cell),
      }),
    );
    expect(atlas.star(SPARK, 7)).toBeUndefined();
    await settle();
    expect(atlas.star(SPARK, 7)).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it("reads its eyes and outline where it drew, its tone its palette's first, third and fifth, and tells the layer", async () => {
    const { stage, lose, release } = bakeStage();
    const { make } = surfaces({ pictures: new Map([[`${cell * 2}x${cell}`, starPicture()]]) });
    const atlas = createAtWorkAtlas(
      depsOf({ canvas: make, stage, sparklings: async () => enginesSized(cell * 2, cell) }),
    );
    const told = vi.fn();
    atlas.subscribe(told);
    expect(atlas.star(SPARK, 7)).toBeUndefined();
    await settle();
    const star = atlas.star(SPARK, 7);
    if (star === null || star === undefined) throw new Error("the star did not bake");
    expect(star.cell).toBe(0);
    for (const [got, want] of [
      [star.tone.c, [10, 20, 30]],
      [star.tone.a, [40, 50, 60]],
      [star.tone.b, [70, 80, 90]],
    ] as const)
      for (const [i, channel] of want.entries()) expect(got[i]).toBeCloseTo(channel / 255, 6);
    expect(told).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(lose).toHaveBeenCalledTimes(1);
    // its cell's G is the outline (0.5 at the star's edge), its R the eyes (inside where they differ)
    const { data, width } = atlas.texels();
    const texel = (x: number, y: number, channel: 0 | 1): number =>
      (data[(y * width + x) * 2 + channel] ?? 0) / 255;
    expect(texel(80, 80, 1)).toBeGreaterThan(0.9);
    expect(texel(2, 2, 1)).toBe(0);
    expect(texel(68, 74, 0)).toBeGreaterThan(0.5);
    expect(texel(80, 100, 0)).toBeLessThan(0.5);
  });

  it("a star that drew nothing is no star", async () => {
    const { stage } = bakeStage();
    const blank = new Uint8ClampedArray(cell * 2 * cell * 4);
    const { make } = surfaces({ pictures: new Map([[`${cell * 2}x${cell}`, blank]]) });
    const atlas = createAtWorkAtlas(
      depsOf({ canvas: make, stage, sparklings: async () => enginesSized(cell * 2, cell) }),
    );
    atlas.star(SPARK, 7);
    await settle();
    expect(atlas.star(SPARK, 7)).toBeNull();
  });
});
