// THE MORPH'S CLOCKS (src/morph.ts, its local and its record — PHONE.md §13, the PT-S1 brief): a phone morphs ONLY on an
// explicit change of its `model` — never on its own: first seen it settles at once, and the same model asked again restarts
// nothing — over the law's 0.72 s, staged in its tracks; a change mid-morph morphs on from the blend; the finish rides the
// material track; while one runs the kind's tick asks every record again and the kind is due at once; two desks shown the same
// prop change at the same clocks show the same shapes (a collaborator sees the same morph). A still pins a morph instead.
import type { Entity } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  createMorphs,
  createSimulatorLocal,
  mixFinish,
  mixShape,
  morphTracks,
  PHONE,
  phoneByName,
  pinnedMorph,
  shapeOf,
  simulatorKind,
} from "../src";
import { ctxOf, fakeHost, LOOK, TYPE } from "./fakes";

const model = (name: string) => {
  const m = phoneByName(name);
  if (m === undefined) throw new Error(name);
  return m;
};
const PRO = model("iPhone 17 Pro");
const EIGHT = model("iPhone 8");
const X = model("iPhone X");
const e1 = 1 as Entity;
const MS = PHONE.morph.ms;

describe("the morph's clocks — a change of model, and nothing else", () => {
  it("settles a phone first seen at its model at once: no morph runs on its own", () => {
    const m = createMorphs();
    m.step(0);
    const shown = m.shown(e1, PRO, need("cosmic-orange"));
    expect(shown.shape).toBe(shapeOf(PRO));
    expect(shown.tracks).toBeUndefined();
    expect(m.running()).toBe(false);
    // asked again, later, with the same model: still nothing runs
    m.step(5000);
    expect(m.shown(e1, PRO, need("cosmic-orange")).shape).toBe(shapeOf(PRO));
    expect(m.stats()).toEqual({ running: 0, begun: 0 });
  });

  it("morphs on a change of model over 0.72 s, staged — from the shape it showed, ending exactly the new model's", () => {
    const m = createMorphs();
    m.step(1000);
    m.shown(e1, PRO, need("cosmic-orange"));
    // the model changes: the morph begins at this clock, at the old shape
    m.step(2000);
    const start = m.shown(e1, EIGHT, need("silver-8"));
    expect(start.shape).toBe(shapeOf(PRO));
    expect(m.running()).toBe(true);
    // half way: the staged blend at its time
    m.step(2000 + MS / 2);
    const mid = m.shown(e1, EIGHT, need("silver-8"));
    const tracks = morphTracks(0.5, PHONE.morph.staged);
    expect(mid.tracks).toEqual(tracks);
    expect(mid.shape.half[1]).toBeCloseTo(
      mixShape(shapeOf(PRO), shapeOf(EIGHT), tracks).half[1],
      9,
    );
    // the finish rides the material track
    expect(mid.finish).toEqual(mixFinish(need("cosmic-orange"), need("silver-8"), tracks.material));
    // done: the new model's own shape, exactly, and its own finish
    m.step(2000 + MS);
    const end = m.shown(e1, EIGHT, need("silver-8"));
    expect(end.shape).toBe(shapeOf(EIGHT));
    expect(end.finish).toEqual(need("silver-8"));
    expect(m.running()).toBe(false);
    expect(m.stats().begun).toBe(1);
  });

  it("morphs on from the BLEND when the model changes again mid-morph — never cut short, never a pop", () => {
    const m = createMorphs();
    m.step(0);
    m.shown(e1, EIGHT, need("silver-8"));
    m.step(100);
    m.shown(e1, X, need("silver-x"));
    m.step(100 + MS * 0.4);
    const blend = m.shown(e1, X, need("silver-x")).shape;
    expect(blend).not.toBe(shapeOf(EIGHT));
    expect(blend).not.toBe(shapeOf(X));
    // on to the 17 Pro from where it stands: its first frame is the blend itself
    const next = m.shown(e1, PRO, need("cosmic-orange")).shape;
    expect(next).toBe(blend);
    expect(m.stats().begun).toBe(2);
  });

  it("pops the finish alone (a finish is a look, not a shape): no morph on a change of finish", () => {
    const m = createMorphs();
    m.step(0);
    m.shown(e1, PRO, need("cosmic-orange"));
    m.step(16);
    const now = m.shown(e1, PRO, need("deep-blue"));
    expect(now.tracks).toBeUndefined();
    expect(now.finish).toEqual(need("deep-blue"));
    expect(m.running()).toBe(false);
  });

  it("shows two desks the same morph from the same prop change at the same clocks (a collaborator's desk)", () => {
    const a = createMorphs();
    const b = createMorphs();
    for (const m of [a, b]) {
      m.step(0);
      m.shown(e1, PRO, need("cosmic-orange"));
      m.step(40);
      m.shown(e1, X, need("silver-x"));
    }
    for (const t of [100, 300, 500, 700]) {
      a.step(t);
      b.step(t);
      expect(a.shown(e1, X, need("silver-x")).shape).toEqual(
        b.shown(e1, X, need("silver-x")).shape,
      );
    }
  });

  it("through the kind: a model's change remakes every record each frame while it runs, the kind due at once, then sleeps", () => {
    const kind = simulatorKind();
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const at = (name: string) => ctxOf({ model: `${TYPE}${name}` }, { local });
    local.tick?.(0);
    expect(kind.resolve(at("iPhone-17-Pro")).shape).toBe(shapeOf(PRO));
    expect(local.tick?.(16)).toBe(false);
    expect(local.due?.(16)).toBe(Number.POSITIVE_INFINITY);
    // the prop changes (a peer's write, PT-S2's attach): the record made for it begins the morph
    local.tick?.(32);
    expect(kind.resolve(at("iPhone-X")).shape).toBe(shapeOf(PRO));
    // every frame of it the tick answers true (every record of the kind remade) and the kind is due now
    expect(local.tick?.(32 + MS / 3)).toBe(true);
    expect(local.due?.(32 + MS / 3)).toBe(32 + MS / 3);
    const mid = kind.resolve(at("iPhone-X"));
    expect(mid.shape).not.toBe(shapeOf(PRO));
    expect(local.morphs().running).toBe(1);
    // it lands: the tick answers true ONCE MORE — the record drawn last was a blend, and the desk remakes a record only on a
    // frame its kind's tick answered true — and that record is the new model's shape exactly; then quiet, nothing due
    expect(local.tick?.(32 + MS)).toBe(true);
    expect(local.morphs().running).toBe(0);
    expect(kind.resolve(at("iPhone-X")).shape).toBe(shapeOf(X));
    expect(local.tick?.(32 + MS + 16)).toBe(false);
    expect(local.due?.(32 + MS + 16)).toBe(Number.POSITIVE_INFINITY);
  });

  it("through the kind: a long last frame (a stall, a window hidden mid-morph) still lands it exactly — the landing frame is remade", () => {
    const kind = simulatorKind();
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const at = (name: string) => ctxOf({ model: `${TYPE}${name}` }, { local });
    local.tick?.(0);
    kind.resolve(at("iPhone-8"));
    // the change: the morph begins at 32; one frame at 0.6 of it — a blend, visibly mid-morph (the size track done, the
    // housing and the material not)
    local.tick?.(32);
    kind.resolve(at("iPhone-X"));
    expect(local.tick?.(32 + MS * 0.6)).toBe(true);
    const blend = kind.resolve(at("iPhone-X")).shape;
    expect(blend).not.toBe(shapeOf(EIGHT));
    expect(blend).not.toBe(shapeOf(X));
    // then a stall: the next frame comes long past the end — it is still remade, and it is the X itself, not the blend
    expect(local.tick?.(32 + MS * 3)).toBe(true);
    expect(kind.resolve(at("iPhone-X")).shape).toBe(shapeOf(X));
    expect(local.tick?.(32 + MS * 3 + 16)).toBe(false);
    // and a morph whose very next frame is past its end (the window hidden as it began) lands on that frame too
    kind.resolve(at("iPhone-17-Pro"));
    expect(local.tick?.(32 + MS * 10)).toBe(true);
    expect(kind.resolve(at("iPhone-17-Pro")).shape).toBe(shapeOf(PRO));
    expect(local.tick?.(32 + MS * 10 + 16)).toBe(false);
  });
});

describe("a still's pinned morph (the desk's asset door — a still never reads a clock)", () => {
  it("draws the phone at the pinned time between `from` and its own model — and ignores an asset it cannot read", () => {
    const kind = simulatorKind();
    const asset = { morph: { from: `${TYPE}iPhone-8`, t: 0.5 } };
    expect(pinnedMorph(asset)).toEqual({ from: EIGHT, t: 0.5 });
    const G = kind.resolve(ctxOf({ model: `${TYPE}iPhone-X` }, { asset }));
    expect(G.shape.half[1]).toBeCloseTo(
      mixShape(shapeOf(EIGHT), shapeOf(X), morphTracks(0.5, PHONE.morph.staged)).half[1],
      9,
    );
    for (const bad of [
      undefined,
      null,
      7,
      {},
      { morph: null },
      { morph: { from: "x", t: 0.5 } },
      { morph: { from: `${TYPE}iPhone-8`, t: "half" } },
    ])
      expect(pinnedMorph(bad), JSON.stringify(bad)).toBeUndefined();
    // the time is held to the morph's own: before it, A; past it, B
    expect(pinnedMorph({ morph: { from: `${TYPE}iPhone-8`, t: -2 } })?.t).toBe(0);
    expect(pinnedMorph({ morph: { from: `${TYPE}iPhone-8`, t: 9 } })?.t).toBe(1);
  });
});

/** A finish's colours under the product's day look. */
function need(name: string) {
  const f = LOOK.light.finishes[name];
  if (f === undefined) throw new Error(name);
  return f;
}
