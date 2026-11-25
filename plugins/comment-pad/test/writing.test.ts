// THE PAD'S WRITING (the kind's local on one desk) on a fake host: a text raster that counts what it is asked, ink layers
// that remember what they were handed, and — IK, 2026-11-25 — the desk's hand's faces (a face of the tests' own,
// test/face.ts) with a run store that remembers what it was written. Two roads:
// - THE PEN, where the pad's face has landed and holds every glyph: one glyph run a pad, built only when its words, their
//   hand or their marks move — never on a pan or a zoom, its rung one at every zoom; nothing written at first sight, a
//   typed glyph written from now at the hand's pace, words that arrive written as words arrive, the desk drawn again
//   while the pen moves and no record remade; its MARKS in the run, a mark drawn when it is made and never when a desk
//   opens; the selection's WASH rewritten alone. A glyph the face lacks, a face not lent or still loading, a store that
//   holds no more: the raster's road.
// - THE RASTER: laid once and kept — a pan lays nothing, a zoom within a rung lays nothing, an edit or a rung crossing
//   lays it again into the pad's OWN layer; a pad gone for good frees its layer; a face still loading lays nothing and the
//   desk is woken when it lands (never polled); with no text raster at all the pad lays no ink, honestly.
// A typing's DRAFT is drawn instead of the cell and the caret stands where the editor's index says.
import {
  caretAt,
  carryInk,
  type Entity,
  encodeMarks,
  encodeSeeds,
  HAND_FACES,
  type HandAtlas,
  type HandFaces,
  type HandMetrics,
  type HandRun,
  handFacesOf,
  type InkWash,
  inkOf,
  mark,
  type PenKey,
  TEXT_RASTER,
  type TextRaster,
  WRITTEN,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { createPadWriting, type InkBitmap, PAD_HAND, type PadRuns, writingBox } from "../src";
import { fixtureFace } from "./face";

const SIZE = { w: 220, h: 280 } as const;
const BOX = writingBox(SIZE.w, SIZE.h);
const e1 = 1 as Entity;
const e2 = 2 as Entity;

function fakeHost(
  opts: { face?: boolean; raster?: boolean; pass?: boolean; faces?: HandFaces } = {},
) {
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
  // the pen's room, remembered: every run written (its base the key's own thousand), freed, washed; the faces bound; the times
  const runs = {
    writes: [] as { key: PenKey; run: HandRun }[],
    frees: [] as PenKey[],
    washes: [] as { key: PenKey; wash: InkWash }[],
    faces: [] as HandAtlas[],
    full: false,
  };
  const room: PadRuns = {
    write: (key, run) => {
      if (runs.full) return -1;
      runs.writes.push({ key, run });
      return 1000 * Number(key);
    },
    free: (key) => {
      runs.frees.push(key);
    },
    wash: (key, wash) => {
      runs.washes.push({ key, wash });
      return true;
    },
    face: (atlas) => {
      runs.faces.push(atlas);
    },
    at: () => {},
    stats: () => ({ runs: 0, given: 0, used: 0, capacity: 0, grown: 0, writes: 0, bytes: 0 }),
  };
  const remade: Entity[] = [];
  let woke = 0;
  let redraws = 0;
  const host = {
    pass: () => (opts.pass === false ? undefined : { ink: () => ink, runs: () => room }),
    use: <T>(key: { name: string }) => {
      if (key.name === TEXT_RASTER.name) return (opts.raster === false ? undefined : raster) as T;
      if (key.name === HAND_FACES.name) return opts.faces as T | undefined;
      return undefined;
    },
    remake: (e: Entity) => {
      remade.push(e);
    },
    wake: () => {
      woke += 1;
    },
    redraw: () => {
      redraws += 1;
    },
  };
  const land = () => {
    faceLoaded = true;
    version += 1;
    for (const fn of listeners) fn();
  };
  return {
    host,
    asked,
    writes,
    runs,
    remade,
    woke: () => woke,
    redraws: () => redraws,
    land,
  };
}

const props = (text: string, marks?: string) => ({
  text,
  seeds: "",
  seed: 3,
  ...(marks !== undefined ? { marks } : {}),
});

/** A host lending the tests' face under the pad's name (`caveat` — the desk's hand). */
const penHost = () => {
  const face = fixtureFace();
  return { face, ...fakeHost({ faces: handFacesOf({ caveat: face }) }) };
};

/** The rects of a wash that cover something (x1 > x0). */
const washed = (w: InkWash): number => {
  let n = 0;
  for (let i = 0; i + 3 < w.lines.length; i += 4)
    if ((w.lines[i + 2] as number) > (w.lines[i] as number)) n += 1;
  return n;
};

describe("the comment pad's writing on the PEN's road", () => {
  it("writes a pad whose face holds every glyph with the pen — one run in the store, its base in the record, no raster and no layer; a pan or a zoom builds none, and its rung is one at every zoom", () => {
    const f = penHost();
    const w = createPadWriting(f.host as never);
    w.tick?.(1000);
    const a = w.draw(e1, props("hello pad"), SIZE, 2);
    expect(w.roadOf(e1)).toBe("pen");
    expect(a.raster).toBeUndefined();
    expect(a.pen).toEqual({ base: 1000, x: BOX.x, y: BOX.y, foot: BOX.y + BOX.h });
    expect(f.asked).toEqual([]); // the raster is asked nothing
    expect(f.writes).toEqual([]); // and no layer is laid
    expect(f.runs.writes).toHaveLength(1);
    expect(f.runs.writes[0]?.run.glyphs).toBe(8); // "hellopad": the space is inkless
    expect(f.runs.faces).toEqual([f.face]);
    w.draw(e1, props("hello pad"), SIZE, 2); // a pan: the same record remade
    w.draw(e1, props("hello pad"), SIZE, 0.3); // a zoom across every rung the raster had
    expect(f.runs.writes).toHaveLength(1);
    expect(w.stats()).toMatchObject({ runs: 1, layers: 0, roads: { pen: 1, raster: 0 } });
    const rung = (zd: number) => w.rungOf(e1, props("hello pad"), zd);
    expect(rung(0.3)).toBe(rung(8));
    expect(w.landed?.(e1)).toBe(1);
  });

  it("writes nothing at first sight; a glyph TYPED in a draft is written from now at the hand's pace — the desk drawn again while it writes, no record remade — and the pen's time held once it is whole", () => {
    const f = penHost();
    const w = createPadWriting(f.host as never);
    w.tick?.(1000);
    w.draw(e1, props("one"), SIZE, 2);
    const first = w.penOf(e1);
    expect(first?.moments.every((m) => m.start === WRITTEN.start)).toBe(true); // a desk opening writes nothing
    w.tick?.(2000);
    // the typing's draft: the cell's ink, one letter typed at its end (the kit's carry), told as typed
    const cell = inkOf({ text: "one", seeds: "", marks: "" }, 3);
    const draft = carryInk(cell, "ones", () => 99, 4).ink;
    w.setDraft(e1, draft, { from: 3, to: 4, how: "typed" });
    expect(f.remade).toContain(e1);
    w.draw(e1, props("one"), SIZE, 2); // the draft is drawn, not the cell
    const m = w.penOf(e1)?.moments ?? [];
    expect(m).toHaveLength(4);
    expect(m.slice(0, 3).every((x) => x.start === WRITTEN.start)).toBe(true); // the letters already there keep their moment
    expect(m[3]?.start).toBe(2000);
    const dur = m[3]?.dur ?? 0;
    expect(dur).toBeGreaterThanOrEqual(100);
    expect(dur).toBeLessThanOrEqual(190);
    expect(f.runs.writes).toHaveLength(2);
    // while it writes: due now, and each tick asks the desk to draw again — never a remade record (the tick answers false)
    expect(w.due?.(2050)).toBe(2050);
    const redrawn = f.redraws();
    expect(w.tick?.(2050)).toBe(false);
    expect(f.redraws()).toBe(redrawn + 1);
    expect(w.penTime()).toBe(2050);
    // whole: the pen's time stands at its last moment, and the desk is due nothing
    w.tick?.(5000);
    expect(w.penTime()).toBe(2000 + dur);
    expect(w.due?.(5001)).toBe(Number.POSITIVE_INFINITY);
    // the draft lands (the cell holds what it held): the cell is drawn again and nothing is built — its glyphs are the same
    w.setDraft(e1, undefined);
    w.draw(e1, { ...props("ones"), seeds: encodeSeeds(draft.seeds) }, SIZE, 2);
    expect(f.runs.writes).toHaveLength(2);
  });

  it("writes words that ARRIVED — a peer's, an agent's, an undo's — as words arrive: the new glyphs from now, the old as they were", () => {
    const f = penHost();
    const w = createPadWriting(f.host as never);
    w.tick?.(1000);
    w.draw(e1, props("one"), SIZE, 2);
    w.tick?.(3000);
    w.draw(e1, props("one two"), SIZE, 2);
    const m = w.penOf(e1)?.moments ?? [];
    expect(m).toHaveLength(6);
    expect(m.slice(0, 3).every((x) => x.start === WRITTEN.start)).toBe(true);
    expect(m.slice(3).every((x) => x.start >= 3000 && Number.isFinite(x.start))).toBe(true);
  });

  it("takes the RASTER's road for a glyph the face lacks — its run's room given back — and back on the pen writes nothing again", () => {
    const f = penHost();
    const w = createPadWriting(f.host as never);
    w.tick?.(1000);
    w.draw(e1, props("one"), SIZE, 2);
    const a = w.draw(e1, props("one 日"), SIZE, 2);
    expect(w.roadOf(e1)).toBe("raster");
    expect(a.pen).toBeUndefined();
    expect(a.raster?.layer).toBe(0);
    expect(f.runs.frees).toEqual([e1]);
    w.tick?.(2000);
    const b = w.draw(e1, props("one"), SIZE, 2);
    expect(w.roadOf(e1)).toBe("pen");
    expect(b.raster).toBeUndefined();
    expect(w.penOf(e1)?.moments.every((x) => x.start === WRITTEN.start)).toBe(true);
    expect(w.stats().layers).toBe(0); // its layer given back
  });

  it("takes the raster's road where no faces are lent and while the face is on its way; when it lands the desk is woken for it and the pad takes the pen", () => {
    const none = fakeHost();
    const w0 = createPadWriting(none.host as never);
    expect(w0.draw(e1, props("one"), SIZE, 2).raster).toBeDefined();
    expect(w0.roadOf(e1)).toBe("raster");
    const face = fixtureFace();
    let landed = false;
    let v = 0;
    const faces: HandFaces = {
      face: () => (landed ? face : undefined),
      loading: () => !landed,
      version: () => v,
    };
    const f = fakeHost({ faces });
    const w = createPadWriting(f.host as never);
    expect(w.draw(e1, props("one"), SIZE, 2).raster).toBeDefined();
    expect(w.roadOf(e1)).toBe("raster");
    expect(w.due?.(10)).toBe(Number.POSITIVE_INFINITY); // nothing polled meanwhile
    landed = true;
    v += 1;
    expect(w.due?.(20)).toBe(20);
    expect(w.tick?.(20)).toBe(true); // every pad's record remade: each takes its road again
    expect(w.draw(e1, props("one"), SIZE, 2).pen?.base).toBe(1000);
    expect(w.stats().layers).toBe(0);
  });

  it("takes the raster's road, honestly, when the device holds no more runs", () => {
    const f = penHost();
    f.runs.full = true;
    const w = createPadWriting(f.host as never);
    const a = w.draw(e1, props("one"), SIZE, 2);
    expect(w.roadOf(e1)).toBe("raster");
    expect(a.raster).toBeDefined();
  });

  it("carries the pad's MARKS in its run — a mark is drawn from the moment it is made and never when a desk opens; a pad stored before the marks reads unmarked", () => {
    const f = penHost();
    const w = createPadWriting(f.host as never);
    const words = inkOf({ text: "one two" }, 3);
    const highlighted = mark(words, 4, 7, { highlight: "yellow" });
    w.tick?.(1000);
    w.draw(e1, props("one two", encodeMarks(highlighted.marks)), SIZE, 2);
    expect(w.penOf(e1)?.run.marks?.strokes).toBe(1);
    expect(w.penOf(e1)?.marked.strokes.every((s) => s.start === Number.NEGATIVE_INFINITY)).toBe(
      true,
    ); // on the paper before
    w.tick?.(2000);
    const struck = mark(highlighted, 0, 3, { strike: true });
    w.draw(e1, props("one two", encodeMarks(struck.marks)), SIZE, 2);
    const strokes = w.penOf(e1)?.marked.strokes ?? [];
    expect(strokes).toHaveLength(2);
    expect(strokes.filter((s) => s.start === Number.NEGATIVE_INFINITY)).toHaveLength(1); // the highlight stands
    expect(strokes.filter((s) => s.start >= 2000 && Number.isFinite(s.start))).toHaveLength(1); // the strike is drawn now
    expect(f.runs.writes).toHaveLength(2);
    // stored before the marks: no `marks` prop at all
    w.draw(e2, { text: "one", seeds: "", seed: 3 }, SIZE, 2);
    expect(w.penOf(e2)?.run.marks?.strokes).toBe(0);
  });

  it("rewrites the selection's WASH alone — no run built, the desk drawn again; a caret washes nothing, and a selection that did not move asks nothing", () => {
    const f = penHost();
    const w = createPadWriting(f.host as never);
    w.tick?.(1000);
    w.draw(e1, props("one two three"), SIZE, 2);
    w.setSelection(e1, 4, 7);
    expect(w.due?.(1001)).toBe(1001);
    const redrawn = f.redraws();
    expect(w.tick?.(1001)).toBe(false);
    expect(f.runs.washes).toHaveLength(1);
    expect(f.runs.washes[0]?.key).toBe(e1);
    expect(washed(f.runs.washes[0]?.wash as InkWash)).toBe(1); // one laid line under "two"
    expect(f.redraws()).toBe(redrawn + 1);
    expect(w.stats()).toMatchObject({ runs: 1, washes: 1 });
    w.setSelection(e1, 5, 5); // a caret
    w.tick?.(1002);
    expect(washed(f.runs.washes[1]?.wash as InkWash)).toBe(0);
    w.setSelection(e1, 6, 6); // another caret: no wash moves
    expect(w.due?.(1003)).toBe(Number.POSITIVE_INFINITY);
    w.tick?.(1003);
    expect(f.runs.washes).toHaveLength(2);
    expect(f.runs.writes).toHaveLength(1);
  });

  it("gives a pad's run back when it leaves the desk for good", () => {
    const f = penHost();
    const w = createPadWriting(f.host as never);
    w.draw(e1, props("one"), SIZE, 2);
    w.forget?.(e1);
    expect(f.runs.frees).toEqual([e1]);
    expect(w.penOf(e1)).toBeUndefined();
  });
});

describe("the comment pad's writing on the RASTER's road", () => {
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
    expect(w.rungOf(e1, props("hello pad"), 1.6)).toBe(1);
    expect(w.rungOf(e1, props("hello pad"), 3)).toBe(2);
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
    expect(a.pen).toBeUndefined();
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

  it("a typing's DRAFT is drawn instead of the cell, its record remade; the CARET stands at the editor's index", () => {
    const f = fakeHost();
    const w = createPadWriting(f.host as never);
    w.setDraft(e1, inkOf({ text: "draft line" }, 3));
    w.setCaret(e1, 5);
    expect(f.remade).toEqual([e1, e1]);
    const a = w.draw(e1, props("the cell"), SIZE, 2);
    expect(f.asked.at(-1)?.text).toBe("draftline");
    expect(w.draft(e1)?.text).toBe("draft line");
    // the caret before glyph 5 of the DRAFT's layout (after "draft", each glyph in its own hand), from the box's edge
    const laid = w.layoutOf(e1);
    if (laid === undefined) throw new Error("the draft was not laid out");
    const c = caretAt(laid, 5);
    expect(a.caret).toEqual({ x: BOX.x + c.x, y: BOX.y + c.y - c.above, h: c.above + c.below });
    expect(c.x).toBeGreaterThan(4 * 0.45 * PAD_HAND.size); // five glyphs in, never at the line's start
    // the draft over: the cell is drawn again, and the caret goes with the lease
    w.setDraft(e1, undefined);
    w.setCaret(undefined);
    const b = w.draw(e1, props("the cell"), SIZE, 2);
    expect(f.asked.at(-1)?.text).toBe("thecell");
    expect(b.caret).toBeUndefined();
    expect(
      w
        .layoutOf(e1)
        ?.glyphs.map((g) => g.ch)
        .join(""),
    ).toBe("thecell");
  });
});
