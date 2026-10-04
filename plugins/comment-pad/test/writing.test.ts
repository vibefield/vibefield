// THE PAD'S WRITING (the kind's local on one desk) on a fake host: a text raster that counts what it is asked
// and ink layers that remember what they were handed. Its INK is laid once and kept — a pan lays nothing, a zoom
// within a rung lays nothing, an edit or a rung crossing lays it again into the pad's OWN layer; a pad gone for
// good frees its layer; a face still loading lays nothing and the desk is woken when it lands (never polled);
// with no text raster at all (the harness's host, the Node oracle) the pad lays no ink, honestly. A session's
// DRAFT is drawn instead of the cell and the caret stands where the editor's index says.
import {
  caretAt,
  type Entity,
  type HandMetrics,
  TEXT_RASTER,
  type TextRaster,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { createPadWriting, type InkBitmap, PAD_HAND, writingBox } from "../src";

const SIZE = { w: 220, h: 280 } as const;
const BOX = writingBox(SIZE.w, SIZE.h);
const e1 = 1 as Entity;
const e2 = 2 as Entity;

function fakeHost(opts: { face?: boolean; raster?: boolean; pass?: boolean } = {}) {
  let version = 1;
  let faceLoaded = opts.face ?? true;
  const listeners: (() => void)[] = [];
  const asked: { band: number; text: string }[] = [];
  const metrics: HandMetrics = { ascent: 0.8, descent: 0.25, advance: () => 0.45 };
  const raster: TextRaster = {
    metrics: () => (faceLoaded ? metrics : undefined),
    version: () => version,
    onVersion: (fn) => {
      listeners.push(fn);
      return () => {};
    },
    raster: (layout, _face, box, band) => {
      asked.push({ band, text: layout.glyphs.map((g) => g.ch).join("") });
      const w = Math.ceil(box.w * band);
      const h = Math.ceil(box.h * band);
      return { bytes: new Uint8Array(w * h), w, h };
    },
  };
  const writes: { layer: number; w: number; h: number }[] = [];
  const ink = {
    size: { w: 1024, h: 1024 },
    ensure: (i: number) => i < 4,
    write: (layer: number, b: InkBitmap) => {
      writes.push({ layer, w: b.w, h: b.h });
    },
  };
  const remade: Entity[] = [];
  let woke = 0;
  const host = {
    pass: () => (opts.pass === false ? undefined : { ink: () => ink }),
    use: <T>(key: { name: string }) =>
      (opts.raster === false || key.name !== TEXT_RASTER.name ? undefined : raster) as
        | T
        | undefined,
    remake: (e: Entity) => {
      remade.push(e);
    },
    wake: () => {
      woke += 1;
    },
  };
  const land = () => {
    faceLoaded = true;
    version += 1;
    for (const fn of listeners) fn();
  };
  return { host, asked, writes, remade, woke: () => woke, land };
}

const props = (text: string) => ({ text, seeds: "", seed: 3 });

describe("the comment pad's writing", () => {
  it("lays a pad's ink into its OWN layer once — a pan or a zoom within the rung lays nothing", () => {
    const f = fakeHost();
    const w = createPadWriting(f.host as never);
    const a = w.draw(e1, props("hello pad"), SIZE, 2);
    expect(a.raster).toMatchObject({ layer: 0, band: 2, x: BOX.x, y: BOX.y, layerW: 1024 });
    expect(f.asked).toEqual([{ band: 2, text: "hellopad" }]);
    expect(f.writes).toEqual([{ layer: 0, w: Math.ceil(BOX.w * 2), h: Math.ceil(BOX.h * 2) }]);
    w.draw(e1, props("hello pad"), SIZE, 2); // a pan: the same record remade
    w.draw(e1, props("hello pad"), SIZE, 1.6); // a zoom within the rung (band 2 still)
    expect(f.asked).toHaveLength(1);
    expect(w.landed?.(e1)).toBe(1);
  });

  it("lays it again on an EDIT or a RUNG crossing — into the same layer; a second pad takes the next", () => {
    const f = fakeHost();
    const w = createPadWriting(f.host as never);
    w.draw(e1, props("one"), SIZE, 2);
    w.draw(e1, props("one two"), SIZE, 2); // an edit
    w.draw(e1, props("one two"), SIZE, 3); // a rung crossing: band 4
    expect(f.asked.map((x) => x.band)).toEqual([2, 2, 4]);
    expect(f.writes.map((x) => x.layer)).toEqual([0, 0, 0]);
    const b = w.draw(e2, props("other"), SIZE, 2);
    expect(b.raster?.layer).toBe(1);
    expect(w.stats()).toMatchObject({ rasters: 4, layers: 2, blanks: 0 });
  });

  it("frees a pad's layer when it leaves the desk for good, for the next pad; with no layer left a pad draws blank, counted", () => {
    const f = fakeHost();
    const w = createPadWriting(f.host as never);
    for (let i = 1; i <= 4; i += 1) w.draw(i as Entity, props(`pad ${i}`), SIZE, 2);
    expect(w.stats().layers).toBe(4);
    const blank = w.draw(5 as Entity, props("pad 5"), SIZE, 2);
    expect(blank.raster).toBeUndefined();
    expect(w.stats().blanks).toBe(1);
    w.forget?.(2 as Entity);
    expect(w.draw(5 as Entity, props("pad 5"), SIZE, 2).raster?.layer).toBe(1);
  });

  it("a face still LOADING lays nothing; when it lands the desk is woken and the next tick is restless — then it lays", () => {
    const f = fakeHost({ face: false });
    const w = createPadWriting(f.host as never);
    const a = w.draw(e1, props("waiting"), SIZE, 2);
    expect(a.raster).toBeUndefined();
    expect(w.due?.(10)).toBe(Number.POSITIVE_INFINITY); // nothing polled meanwhile
    f.land();
    expect(f.woke()).toBe(1);
    expect(w.due?.(10)).toBe(10);
    expect(w.tick?.(10)).toBe(true);
    expect(w.tick?.(11)).toBe(false);
    expect(w.draw(e1, props("waiting"), SIZE, 2).raster?.layer).toBe(0);
  });

  it("with NO text raster on the desk (the harness's host) it lays no ink — the rules stand where the hand would lay its lines", () => {
    const f = fakeHost({ raster: false });
    const w = createPadWriting(f.host as never);
    const a = w.draw(e1, props("unseen"), SIZE, 2);
    expect(a.raster).toBeUndefined();
    expect(a.rules.pitch).toBeCloseTo(PAD_HAND.size * PAD_HAND.lineHeight, 9);
    expect(a.rules.first).toBeGreaterThan(BOX.y);
    expect(a.rules.last).toBeLessThanOrEqual(BOX.y + BOX.h);
  });

  it("before the ground has made its pass it lays nothing and asks for the next step; an empty pad lays no raster", () => {
    const f = fakeHost({ pass: false });
    const w = createPadWriting(f.host as never);
    expect(w.draw(e1, props("soon"), SIZE, 2).raster).toBeUndefined();
    expect(w.tick?.(0)).toBe(true);
    const g = fakeHost();
    const blank = createPadWriting(g.host as never).draw(e1, props(""), SIZE, 2);
    expect(blank.raster).toBeUndefined();
    expect(g.asked).toEqual([]);
  });

  it("a session's DRAFT is drawn instead of the cell, its record remade; the CARET stands at the editor's index", () => {
    const f = fakeHost();
    const w = createPadWriting(f.host as never);
    w.setDraft(e1, { text: "draft line", seeds: "" });
    w.setCaret(e1, 5);
    expect(f.remade).toEqual([e1, e1]);
    const a = w.draw(e1, props("the cell"), SIZE, 2);
    expect(f.asked.at(-1)?.text).toBe("draftline");
    // the caret before glyph 5 of the DRAFT's layout (after "draft", each glyph in its own hand), from the box's edge
    const laid = w.layoutOf(e1);
    if (laid === undefined) throw new Error("the draft was not laid out");
    const c = caretAt(laid, 5);
    expect(a.caret).toEqual({ x: BOX.x + c.x, y: BOX.y + c.y - c.above, h: c.above + c.below });
    expect(c.x).toBeGreaterThan(4 * 0.45 * PAD_HAND.size); // five glyphs in, never at the line's start
    // the session over: the cell is drawn again, and the caret goes with the lease
    w.setDraft(e1, undefined);
    w.setCaret(undefined);
    const b = w.draw(e1, props("the cell"), SIZE, 2);
    expect(f.asked.at(-1)?.text).toBe("thecell");
    expect(b.caret).toBeUndefined();
    // a tap's caret index: the nearest position on the line under it
    const cell = w.layoutOf(e1);
    if (cell === undefined) throw new Error("the cell was not laid out");
    expect(w.caretIndexAt(e1, BOX.x + (cell.positions[6] ?? 0) + 0.5, BOX.y + 10)).toBe(3);
  });
});
