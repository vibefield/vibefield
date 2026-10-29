// THE FIXTURE FEED (src/fixture.ts — PHONE.md §6.3's contract, its picture redrawn): the screen iOS lays out on each model's
// shape (its island, its notch's ears, a home-button phone's bar; mid-morph the in-between one); a frame made from arithmetic
// alone — the same bytes for the same arguments, opaque, light and dark, its clock turning only with its minute; and the
// STREAM'S CONTRACT: paused until asked, frames at the demanded size and rate, none while nothing changed.
import { describe, expect, it } from "vitest";
import {
  FixtureFeed,
  feedScreenOf,
  fixtureFrame,
  mixShape,
  morphTracks,
  phoneByName,
  shapeOf,
} from "../src";

const shape = (name: string) => {
  const m = phoneByName(name);
  if (m === undefined) throw new Error(name);
  return shapeOf(m);
};
const PRO = feedScreenOf(shape("iPhone 17 Pro"));
const AT = Date.UTC(2026, 9, 18, 10, 8);
const mean = (bytes: Uint8Array): number => {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4)
    sum += 0.2126 * (bytes[i] ?? 0) + 0.7152 * (bytes[i + 1] ?? 0) + 0.0722 * (bytes[i + 2] ?? 0);
  return sum / (bytes.length / 4);
};
const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("the screen the fixture lays out — each model's own", () => {
  it("lays out a 17 Pro round its island (drawn into the frame, as iOS draws its own), an X round its notch, an 8 under its bar", () => {
    expect(PRO.pt).toEqual([402, 874]);
    expect(PRO.kind).toBe("island");
    expect(PRO.drawPill).toBe(true);
    expect(PRO.indicator).toBe(true);
    expect(PRO.pill?.map((v) => Math.round(v * 100) / 100)).toEqual([125.33, 36.67, 14]);
    const x = feedScreenOf(shape("iPhone X"));
    expect([x.kind, x.pill, x.indicator]).toEqual(["notch", null, true]);
    const eight = feedScreenOf(shape("iPhone 8"));
    expect([eight.kind, eight.indicator, eight.corner]).toEqual(["classic", false, 0]);
    // the display's corner, in points: the 17 Pro's 62
    expect(PRO.corner).toBeCloseTo(62.1, 0);
  });

  it("mid-morph lays out the in-between screen — and draws no island until the housing is wholly one", () => {
    const A = shape("iPhone 14 Plus");
    const B = shape("iPhone 14 Pro");
    // a third of the way: the display growing between the two, its points between theirs; still the notch's bar
    const early = feedScreenOf(mixShape(A, B, morphTracks(0.35)));
    expect(early.kind).toBe("notch");
    expect(early.pt[0]).toBeLessThan(A.points[0]);
    expect(early.pt[0]).toBeGreaterThan(B.points[0]);
    // past the pinch-off the bar is laid round the island — but the island is drawn into the frame only once it is wholly one
    const late = feedScreenOf(mixShape(A, B, morphTracks(0.7)));
    expect(late.kind).toBe("island");
    expect(late.drawPill).toBe(false);
    expect(feedScreenOf(mixShape(A, B, morphTracks(1))).drawPill).toBe(true);
  });
});

describe("a frame — arithmetic alone, no canvas, no font, no Apple artwork", () => {
  it("is the same bytes for the same arguments, opaque, at the size asked", () => {
    const a = fixtureFrame(PRO, [151, 328], "light", AT);
    const b = fixtureFrame(PRO, [151, 328], "light", AT);
    expect(a.length).toBe(151 * 328 * 4);
    expect(same(a, b)).toBe(true);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });

  it("follows the desk into its dark — a darker screen — and shows many colours in both", () => {
    const light = fixtureFrame(PRO, [151, 328], "light", AT);
    const dark = fixtureFrame(PRO, [151, 328], "dark", AT);
    expect(mean(dark)).toBeLessThan(mean(light) * 0.6);
    for (const f of [light, dark]) {
      const colours = new Set<number>();
      for (let i = 0; i < f.length; i += 4)
        colours.add(
          (((f[i] ?? 0) >> 3) << 10) | (((f[i + 1] ?? 0) >> 3) << 5) | ((f[i + 2] ?? 0) >> 3),
        );
      expect(colours.size).toBeGreaterThan(40);
    }
  });

  it("turns its clock with its minute, never its second — and reads UTC, never a host's zone", () => {
    const at = fixtureFrame(PRO, [151, 328], "light", AT);
    expect(same(at, fixtureFrame(PRO, [151, 328], "light", AT + 59_000))).toBe(true);
    expect(same(at, fixtureFrame(PRO, [151, 328], "light", AT + 60_000))).toBe(false);
  });
});

describe("the stream's contract — frames at the size and rate asked, none while nothing changed", () => {
  it("is paused until a demand asks for frames, and paused again when one says so", () => {
    const feed = new FixtureFeed(PRO, [1206, 2622], "light");
    expect(feed.frame(AT)).toBeUndefined();
    feed.demand({ mode: "live", fps: 30, raster: [603, 1311] });
    expect(feed.frame(AT)).toMatchObject({
      width: 603,
      height: 1311,
      logical: [402, 874],
      serial: 1,
    });
    feed.demand({ mode: "paused", fps: 0, raster: [0, 0] });
    feed.reshape(feedScreenOf(shape("iPhone 17")));
    expect(feed.frame(AT + 60_000)).toBeUndefined();
    expect(feed.frames).toBe(1);
  });

  it("sends nothing while nothing changed — a frame when the minute turns, the screen reshapes, the size or the scheme moves", () => {
    const feed = new FixtureFeed(PRO, [1206, 2622], "light");
    feed.demand({ mode: "live", fps: 30, raster: [302, 656] });
    expect(feed.frame(AT)).toBeDefined();
    expect(feed.frame(AT + 1000)).toBeUndefined();
    expect(feed.frame(AT + 30_000)).toBeUndefined();
    // the minute turns
    expect(feed.frame(AT + 60_000)).toBeDefined();
    // the screen reshapes (a morph's frame)
    feed.reshape(
      feedScreenOf(mixShape(shape("iPhone 17 Pro"), shape("iPhone 8"), morphTracks(0.3))),
    );
    expect(feed.frame(AT + 61_000)).toBeDefined();
    // the same screen again: nothing
    feed.reshape(
      feedScreenOf(mixShape(shape("iPhone 17 Pro"), shape("iPhone 8"), morphTracks(0.3))),
    );
    expect(feed.frame(AT + 62_000)).toBeUndefined();
    // a new size: a frame at it
    feed.demand({ mode: "live", fps: 30, raster: [151, 328] });
    expect(feed.frame(AT + 63_000)).toMatchObject({ width: 151, height: 328 });
    // the desk goes dark: a frame
    feed.follow("dark");
    expect(feed.frame(AT + 64_000)).toBeDefined();
    feed.follow("dark");
    expect(feed.frame(AT + 65_000)).toBeUndefined();
    expect(feed.frames).toBe(5);
  });

  it("never sends faster than the rate asked — a change within its interval waits for the next", () => {
    const feed = new FixtureFeed(PRO, [1206, 2622], "light");
    feed.demand({ mode: "live", fps: 12, raster: [151, 328] });
    expect(feed.frame(AT)).toBeDefined();
    feed.follow("dark");
    expect(feed.frame(AT + 40)).toBeUndefined();
    expect(feed.due(AT + 40)).toBe(false);
    expect(feed.due(AT + 1000 / 12)).toBe(true);
    expect(feed.frame(AT + 1000 / 12)).toBeDefined();
  });
});
