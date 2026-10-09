// THE STILL PAGE, THE HEAD, THE DEVICE SWITCH — the pane's own pure parts (PT-1 rulings 5, 8, 9): the sample page is the
// same bytes every time and everywhere, laid for its viewport and its scheme; the favicon a disc on clear; the head's key
// moves with what it says and its band and nothing else; the committed heads are exactly what the product's `drawHead`
// laid, packed and unpacked without a texel lost; a device switch re-cuts the pane to that screen about its centre.
import { describe, expect, it } from "vitest";
import {
  BAND,
  bandDensity,
  bandFor,
  cutOf,
  DEVICE_ACTS,
  DEVICES,
  deviceActId,
  deviceById,
  engraveSplit,
  GUTTER,
  headKey,
  headSize,
  headStateOf,
  PAGE_TEXELS_MAX,
  packRuns,
  pageTexels,
  rungFor,
  SAMPLE_URL,
  sampleFavicon,
  samplePage,
  shapeOf,
  stillHead,
  stillSplit,
  switchedRect,
  unpackHead,
  viewportOf,
} from "../src";
import { STILL_HEADS } from "../src/head-still.gen";

const fnv = (bytes: Uint8Array): number => {
  let h = 2166136261;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h;
};
/** Distinct colours, each channel quantized to 32 levels (the desk door's measure). */
const colours = (bytes: Uint8Array): number => {
  const set = new Set<number>();
  for (let i = 0; i < bytes.length; i += 4)
    set.add(
      (((bytes[i] as number) >> 3) << 10) |
        (((bytes[i + 1] as number) >> 3) << 5) |
        ((bytes[i + 2] as number) >> 3),
    );
  return set.size;
};
const luma = (bytes: Uint8Array): number => {
  let s = 0;
  for (let i = 0; i < bytes.length; i += 4)
    s +=
      0.2126 * (bytes[i] as number) +
      0.7152 * (bytes[i + 1] as number) +
      0.0722 * (bytes[i + 2] as number);
  return s / (bytes.length / 4);
};

describe("the sample page — a still made from arithmetic alone", () => {
  it("is drawn at a texel a CSS px under the cap, opaque, the same bytes every time", () => {
    expect(pageTexels([1280, 800])).toEqual([1280, 800]);
    expect(pageTexels([402, 874])).toEqual([402, 874]);
    const big = pageTexels([4000, 2500]);
    expect(Math.max(...big)).toBe(PAGE_TEXELS_MAX);
    const a = samplePage([1280, 800], "light");
    expect(a.length).toBe(1280 * 800 * 4);
    for (let i = 3; i < a.length; i += 4)
      if (a[i] !== 255) throw new Error(`texel ${i >> 2} is not opaque`);
    expect(fnv(samplePage([1280, 800], "light"))).toBe(fnv(a));
  });

  it("is a page, not a fill: many colours, its headline dark on light by day, light on dark in the dark scheme", () => {
    const light = samplePage([1280, 800], "light");
    const dark = samplePage([1280, 800], "dark");
    expect(colours(light)).toBeGreaterThan(60);
    expect(colours(dark)).toBeGreaterThan(60);
    expect(luma(light)).toBeGreaterThan(180);
    expect(luma(dark)).toBeLessThan(60);
    expect(fnv(light)).not.toBe(fnv(dark));
  });

  it("is laid out for its viewport: a phone's narrow page differs from a laptop's, and a resized page from the one before it", () => {
    const phone = samplePage([402, 874], "light");
    expect(phone.length).toBe(402 * 874 * 4);
    // the narrow layout stacks its cards: the third card's top-left corner region is drawn where a wide page has none
    expect(fnv(samplePage([1000, 800], "light"))).not.toBe(fnv(samplePage([1001, 800], "light")));
    expect(colours(phone)).toBeGreaterThan(40);
  });

  it("its favicon is the sample's mark — a disc of warm light on a clear ground", () => {
    const f = sampleFavicon(32);
    const at = (x: number, y: number) => (y * 32 + x) * 4;
    expect(f[at(0, 0) + 3]).toBe(0);
    expect(f[at(16, 16) + 3]).toBe(255);
    expect(f[at(16, 16)]).toBeGreaterThan(200); // warm: red high
  });
});

describe("the head — keyed by what it says and its band", () => {
  const laptop = deviceById("laptop");
  if (laptop === undefined) throw new Error("laptop");
  const S = shapeOf(cutOf(laptop), laptop);

  it("what it says in PT-1: the address as printed, its lock, the sample's favicon, the viewport — never loading, no history", () => {
    expect(headStateOf(SAMPLE_URL, S)).toEqual({
      display: "lumen.example",
      secure: true,
      favicon: "sample",
      loading: false,
      canBack: false,
      canForward: false,
      viewport: [1280, 800],
    });
    expect(headStateOf("about:blank", S).display).toBe("");
    expect(headStateOf("http://example.com/", S).secure).toBe(false);
    expect(headStateOf("https://example.com/", S).favicon).toBeNull();
  });

  it("its key moves with the viewport, the address and the band — and with nothing else", () => {
    const st = headStateOf(SAMPLE_URL, S);
    const k = headKey(S, st, 2);
    expect(headKey(S, st, 2)).toBe(k);
    expect(headKey(S, { ...st, viewport: [1281, 800] }, 2)).not.toBe(k);
    expect(headKey(S, headStateOf("https://example.com/", S), 2)).not.toBe(k);
    expect(headKey(S, st, 4)).not.toBe(k);
  });

  it("a size as the desk STORES it — f32 (201.03 comes back 201.0299…) — keys the same head and cuts the same viewport", () => {
    for (const d of DEVICES) {
      const cut = cutOf(d);
      const stored = { w: Math.fround(cut.w), h: Math.fround(cut.h) };
      const a = shapeOf(cut, d);
      const b = shapeOf(stored, d);
      expect(headKey(b, headStateOf(SAMPLE_URL, b), 2), d.id).toBe(
        headKey(a, headStateOf(SAMPLE_URL, a), 2),
      );
      expect(viewportOf(stored, d), d.id).toEqual([d.width, d.height]);
    }
  });

  it("the band ladder: half-octaves at or past the screen's density, within its ends; the density held under the texel cap", () => {
    expect(bandFor(2)).toBe(2);
    expect(bandFor(1.6)).toBe(2);
    expect(bandFor(2.4)).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(bandFor(0)).toBe(BAND.min);
    expect(bandFor(100)).toBe(BAND.max);
    expect(rungFor(2)).toBe(2);
    expect(rungFor(2.4)).toBe(3);
    // a pane so wide the band would pass 4096 texels across is held under the cap
    const wide = shapeOf({ w: 3000, h: 900 }, laptop);
    expect(bandDensity(wide, 8) * 3000).toBeLessThanOrEqual(4096 + 1e-9);
    const { width, half, height } = headSize(S, 2);
    expect([width, half * 2 + GUTTER]).toEqual([Math.round(S.half[0] * 4), height]);
    expect(engraveSplit(118)).toEqual({ h: 58, at: 60 });
  });

  it("the committed heads are a still's: the default pane on the sample and on a blank page, a phone's on the sample, the default pane on a live page (PT-2), at the still's band", () => {
    const phone = deviceById("phone");
    if (phone === undefined) throw new Error("phone");
    const P = shapeOf(cutOf(phone), phone);
    const want = [
      headKey(S, headStateOf(SAMPLE_URL, S), bandDensity(S, bandFor(2))),
      headKey(S, headStateOf("about:blank", S), bandDensity(S, bandFor(2))),
      headKey(P, headStateOf(SAMPLE_URL, P), bandDensity(P, bandFor(2))),
      // the playground's live state: the face's words (playground/live.ts) say its address
      headKey(
        S,
        headStateOf("https://lumen.example/reader", S, { address: "https://lumen.example/reader" }),
        bandDensity(S, bandFor(2)),
      ),
    ];
    expect(STILL_HEADS.map((h) => h.key)).toEqual(want);
    for (const key of want) {
      const bm = stillHead(key);
      const split = stillSplit(key);
      expect(bm, key).toBeDefined();
      expect(split).toEqual({ height: bm?.height, h: bm?.h, at: bm?.at });
      // the engraving is drawn (frost on the capsule) and its print holds the favicon on the sample's heads
      let frost = 0;
      let print = 0;
      if (bm !== undefined) {
        for (let i = 0; i < bm.width * bm.h; i++)
          if ((bm.bytes[i * 4 + 3] as number) > 128) frost++;
        for (let i = bm.at * bm.width; i < bm.width * bm.height; i++)
          if ((bm.bytes[i * 4 + 3] as number) > 0) print++;
      }
      expect(frost, key).toBeGreaterThan(2000);
      expect(print > 0, key).toBe(key.includes("|sample|"));
    }
    expect(stillHead("a head nothing committed says")).toBeUndefined();
  });

  it("packs and unpacks a head without a texel lost — the runs' two halves, the gutter clear", () => {
    const width = 37;
    const height = 2 * 5 + GUTTER;
    const { h, at } = engraveSplit(height);
    const bytes = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * h; i++) {
      const a = i % 7 === 0 ? 0 : (i * 13) % 256;
      bytes.set([a, a, a, a], i * 4);
    }
    for (let i = at * width; i < width * height; i++)
      if (i % 5 === 0) bytes.set([(i * 3) % 200, (i * 7) % 200, 40, 200], i * 4);
    const still = {
      key: "k",
      width,
      height,
      h,
      at,
      engraving: Buffer.from(packRuns(bytes, 0, width * h, [3])).toString("base64"),
      print: Buffer.from(packRuns(bytes, at * width, width * height, [0, 1, 2, 3])).toString(
        "base64",
      ),
    };
    expect(Buffer.from(unpackHead(still).bytes).equals(Buffer.from(bytes))).toBe(true);
    // a run never passes 255
    const long = new Uint8Array(600 * 4);
    expect(packRuns(long, 0, 600, [3]).length).toBe(6);
  });
});

describe("the device switch — re-cut to that screen about the pane's centre", () => {
  it("each device's act re-cuts to its own viewport at its density, the centre kept, in the document's hundredths", () => {
    const laptop = deviceById("laptop");
    if (laptop === undefined) throw new Error("laptop");
    const at = { x: 100, y: -40 };
    const size = cutOf(laptop);
    for (const d of DEVICES) {
      const r = switchedRect(at, size, d);
      expect(viewportOf(r, d), d.id).toEqual([d.width, d.height]);
      expect(r.x + r.w / 2).toBeCloseTo(at.x + size.w / 2, 9);
      expect(r.y + r.h / 2).toBeCloseTo(at.y + size.h / 2, 9);
      expect(Math.round(r.w * 100) / 100).toBe(r.w);
    }
  });

  it("its acts are the menu's Laptop · Desktop · iPad · iPhone, each a glyph of its own and an op", () => {
    expect(DEVICE_ACTS.map((a) => [a.id, a.label])).toEqual([
      [deviceActId("laptop"), "Laptop"],
      [deviceActId("desktop"), "Desktop"],
      [deviceActId("tablet"), "iPad"],
      [deviceActId("phone"), "iPhone"],
    ]);
    for (const a of DEVICE_ACTS) {
      expect(typeof a.run).toBe("function");
      expect(typeof a.glyph === "object" && a.glyph !== null && a.glyph.path.length > 0).toBe(true);
    }
  });
});
