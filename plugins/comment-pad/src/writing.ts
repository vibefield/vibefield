// The pad's WRITING — the kind's own state on ONE desk (`ObjectKind.local`): every pad's hand LAYOUT, where its
// INK lies, the DRAFT its typing holds while it is open, the CARET and the SELECTION the desk's editor stands at
// while it is on a pad, and the PEN's clock. Flux, never a world fact: the facts are the pad's durable cells (its
// `text`, its `seeds` and its `marks`, one `ink` cell; its `seed`); what is drawn from them is cached here, per
// entity, keyed so that nothing is redone on a frame.
//
// TWO ROADS a pad (IK, 2026-11-25 — the desk's pen, ICE petitions I59 and I60):
//
// - THE PEN, when the desk lends its hand's faces (`HAND_FACES`) and the pad's face has landed and holds every glyph
//   of its words: the words are a GLYPH RUN (the kit's `handRun`, built from the pad's INK — its marks with it) in the
//   kind's run store, read in the pad's own shader by the kit's `hand_ink` and `ink_marks` at any zoom (no raster,
//   no rung). Each glyph's MOMENT and each mark's is asked of the desk's pen clock (`createPenClock`): a glyph the
//   typing wrote is written at the hand's pace ("typed"), one that arrived — a paste, a peer, an agent, an undo — is
//   written as words arrive ("arrived"), and nothing at all at first sight (a desk opening, a face landing); a mark
//   is drawn when it is made, never when a desk opens. The run is built and written only when the words, their hand
//   or their marks change — never on a pan, a zoom or a redraw; while the pen moves only its time moves (the pass's
//   knobs) and the desk is asked to DRAW AGAIN with no record remade (`KindHost.redraw`). The selection's WASH is
//   rewritten alone (`HandRuns.wash` — a few texels, never a run rebuilt).
// - THE RASTER (the road the pad had before the pen) for a glyph the face lacks (an emoji, CJK), while its face is
//   still on its way, where no faces are lent, and where the device holds no more runs: the host's `TextRaster`
//   (`TEXT_RASTER`), keyed by the layout and the BAND — the texels per pad unit a zoom asks (`bandFor`, a power of
//   two; the kind's `rung`) — re-rastered on an edit or a rung crossing only, never on a pan; laid into the pad's own
//   LAYER of the root pass's ink (pass.ts). The raster draws the words in the sheet's pen; their marks are the pen's.
//
// A desk with neither (the Node harness, a bare host) lays no ink — every pad draws its paper and rules blank,
// honestly. A face that lands between frames re-takes every pad's road; the desk is woken for it, as it is for a
// text raster's face (K7a: nothing is polled at rest).

import {
  caretAt,
  createPenClock,
  type Entity,
  encodeMarks,
  encodeSeeds,
  glyphOf,
  HAND_FACES,
  HAND_WEIGHT,
  type HandAtlas,
  type HandFaces,
  type HandLayout,
  type HandMetrics,
  type HandRun,
  handMetricsOf,
  handRun,
  type InkArrival,
  type InkSpan,
  type InkValue,
  inkOf,
  inkWash,
  type KindHost,
  type KindLocal,
  layoutText,
  numberProp,
  type PenClock,
  type PenHow,
  type PenMarks,
  type PenMoment,
  spansOf,
  stringProp,
  strokesOf,
  TEXT_RASTER,
  type TextRaster,
  washRun,
} from "@vibefield/plugin-sdk/desk";
import { bandFor, PAD, PAD_BLEED, PAD_FACE, PAD_HAND, type PadLaw, writingBox } from "./law";
import type { PadCaret, PadPenRun, PadRaster, PadRules } from "./layout";
import type { InkBitmap, PadRuns } from "./pass";

/** The ink layers a writing lays its rasters in — the root pad pass's (`PadPass.ink()`). */
export interface InkLayers {
  ensure(index: number): boolean;
  write(index: number, bitmap: InkBitmap): void;
  readonly size: { readonly w: number; readonly h: number };
}

/** The road a pad's words take now: the PEN's glyph run, or the RASTER's layer. */
export type PadRoad = "pen" | "raster";

/** What `draw` answers for one pad's record. */
export interface PadDrawn {
  readonly rules: PadRules;
  readonly raster?: PadRaster;
  readonly pen?: PadPenRun;
  readonly caret?: PadCaret;
}

/** A pen-road pad's run as last written (a witness — the raster's twin): its base, the run, the face, its moments and marks. */
export interface PadPenInfo {
  readonly base: number;
  readonly run: HandRun;
  readonly atlas: HandAtlas;
  readonly moments: readonly PenMoment[];
  readonly marked: PenMarks;
}

export interface PadWritingStats {
  /** Layouts laid, rasters laid, layers held now, pads that drew blank for want of a layer. */
  readonly layouts: number;
  readonly rasters: number;
  readonly layers: number;
  readonly blanks: number;
  /** Glyph runs built, washes rewritten alone, and the pads on each road now. */
  readonly runs: number;
  readonly washes: number;
  readonly roads: { readonly pen: number; readonly raster: number };
}

export interface PadWriting extends KindLocal {
  /** One pad's writing for its record: its rules, its ink (its run or its raster, laid if it moved), its caret. */
  draw(
    e: Entity,
    props: Readonly<Record<string, unknown>>,
    size: { readonly w: number; readonly h: number },
    zoomDpr: number,
  ): PadDrawn;
  /**
   * The rung a zoom × dpr puts a pad's ink at (the kind's `rung`): the raster's band's exponent — and one rung for every zoom on
   * the pen's road, whose record reads no zoom.
   */
  rungOf(e: Entity, props: Readonly<Record<string, unknown>>, zoomDpr: number): number;
  /** The road pad `e` took at its last draw (undefined before). */
  roadOf(e: Entity): PadRoad | undefined;
  /** Pad `e`'s run as last written on the pen's road; undefined off it. */
  penOf(e: Entity): PadPenInfo | undefined;
  /** The pad's last laid layout (the chip's greeked lines, the written part's geometry), in the writing box's units. */
  layoutOf(e: Entity): HandLayout | undefined;
  /** The ink a typing's DRAFT holds for `e` while it is open; undefined between drafts. */
  draft(e: Entity): InkValue | undefined;
  /**
   * The typing's DRAFT (the kit's `InkSink.draft`): drawn instead of the cell (undefined: it closed — the cell is drawn again), with
   * how its glyphs arrived (the pen writes a typed glyph at the hand's pace, a pasted one as words arrive). The record is remade.
   */
  setDraft(e: Entity, ink: InkValue | undefined, arrived?: InkArrival): void;
  /** The caret the pass draws: before glyph `index` of `e`'s words — or none (`e` undefined). The record is remade. */
  setCaret(e: Entity | undefined, index?: number): void;
  /** The editor's SELECTION on `e` (`from` = `to`: a caret; `e` undefined: none) — the wash under the words, rewritten alone. */
  setSelection(e: Entity | undefined, from?: number, to?: number): void;
  /** The pen's time the slots draw at, ms: the clock's now while a glyph or a mark is being written, else the last moment written. */
  penTime(): number;
  stats(): PadWritingStats;
}

interface Laid {
  readonly layoutKey: string;
  readonly layout: HandLayout;
  rasterKey?: string;
  raster?: PadRaster;
}

/** A pad on the pen's road: what its run was built from, and where it lies. */
interface Pen {
  /** The layout and the marks the clock last looked at (a look is asked only when they move). */
  lookKey?: string;
  layout?: HandLayout;
  moments?: readonly PenMoment[];
  marked?: PenMarks;
  run?: HandRun;
  atlas?: HandAtlas;
  /** The run's base in the store; undefined while nothing is written (an empty pad, a pad of spaces). */
  base?: number;
}

/** The rung every pen-road pad stands at: its record reads no zoom (a power of two's exponent is never this). */
const PEN_RUNG = 1_000;

type PassDoors = { ink?: () => InkLayers; runs?: () => PadRuns };
/** The root pass's doors, once the ground has made it: the ink layers and the pen's room. */
const passOf = (host: KindHost | undefined): PassDoors | undefined =>
  host?.pass() as PassDoors | undefined;
const inkOfHost = (host: KindHost | undefined): InkLayers | undefined => {
  const pass = passOf(host);
  return typeof pass?.ink === "function" ? pass.ink() : undefined;
};
const roomOfHost = (host: KindHost | undefined): PadRuns | undefined => {
  const pass = passOf(host);
  return typeof pass?.runs === "function" ? pass.runs() : undefined;
};

/** Does `text` hold a glyph the face lacks (a break and a space are no glyph's; an emoji's surrogates are two units)? */
function lacksIn(text: string, atlas: HandAtlas): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === " " || ch === "\n") continue;
    if (glyphOf(atlas, ch.codePointAt(0) ?? 0) === undefined) return true;
  }
  return false;
}

export function createPadWriting(host: KindHost | undefined, law: PadLaw = PAD): PadWriting {
  const text = (): TextRaster | undefined => host?.use?.(TEXT_RASTER);
  const faces = (): HandFaces | undefined => host?.use?.(HAND_FACES);
  const clock: PenClock = createPenClock();
  const laid = new Map<Entity, Laid>();
  const pens = new Map<Entity, Pen>();
  const roads = new Map<Entity, PadRoad>();
  const drafts = new Map<Entity, InkValue>();
  /** The typing's word on how a pad's newest glyphs came, for its next look (a typed glyph, else words arriving). */
  const told = new Map<Entity, PenHow>();
  /** Pads whose words moved since their last draw (their run is built then, with the wash as it stands). */
  const stale = new Set<Entity>();
  /** Pads whose selection's wash is owed to their run (rewritten at the next tick, before the frame's prepares). */
  const owed = new Set<Entity>();
  const layers = new Map<Entity, number>();
  const free: number[] = [];
  const landedOf = new Map<Entity, number>();
  const atlasIds = new WeakMap<HandAtlas, number>();
  const metricsOf = new WeakMap<HandAtlas, HandMetrics>();
  let nextAtlas = 0;
  let nextLayer = 0;
  let caret: { e: Entity; index: number } | undefined;
  let selection: { readonly e: Entity; readonly from: number; readonly to: number } | undefined;
  let restless = false;
  let now = 0;
  /** The latest moment the clock has handed out (ms): the pen's time is the clock's `now` up to it and held there after. */
  let horizon = 0;
  let seenFaces = faces()?.version() ?? 0;
  let counts = { layouts: 0, rasters: 0, blanks: 0, runs: 0, washes: 0 };
  // a face that lands between frames re-lays every pad: the desk is woken for it (never polled)
  const unsubscribe = text()?.onVersion?.(() => {
    restless = true;
    host?.wake?.();
  });
  const remake = (e: Entity): void => {
    host?.remake?.(e);
    host?.wake?.();
  };
  const land = (e: Entity): void => {
    landedOf.set(e, (landedOf.get(e) ?? 0) + 1);
  };
  const penTime = (): number => Math.min(now, horizon);
  const reach = (moments: readonly PenMoment[], marked: PenMarks): void => {
    for (const m of [...moments, ...marked.reinks, ...marked.strokes])
      if (m.start > Number.NEGATIVE_INFINITY) horizon = Math.max(horizon, m.start + m.dur);
  };
  const idOf = (atlas: HandAtlas): number => {
    let id = atlasIds.get(atlas);
    if (id === undefined) {
      id = nextAtlas;
      nextAtlas += 1;
      atlasIds.set(atlas, id);
    }
    return id;
  };
  const metricsFor = (atlas: HandAtlas): HandMetrics => {
    let m = metricsOf.get(atlas);
    if (m === undefined) {
      m = handMetricsOf(atlas);
      metricsOf.set(atlas, m);
    }
    return m;
  };

  /** The pad's ink now: the typing's draft while one is open on it, else its cell's (a cell stored before the marks reads unmarked). */
  const inkNow = (e: Entity, props: Readonly<Record<string, unknown>>, seed: number): InkValue =>
    drafts.get(e) ??
    inkOf(
      {
        text: stringProp(props, "text", ""),
        seeds: stringProp(props, "seeds", ""),
        marks: stringProp(props, "marks", ""),
      },
      seed,
    );

  /** The face a pad's words are written in by the pen, when it has landed and holds every glyph of `words`. */
  const penFace = (words: string): HandAtlas | undefined => {
    const atlas = faces()?.face(PAD_FACE);
    return atlas === undefined || lacksIn(words, atlas) ? undefined : atlas;
  };

  /** The words' wash on `e` as the selection stands: one rect a laid line it touches; none for a caret or another pad's. */
  const washOf = (e: Entity, L: HandLayout): InkSpan[] =>
    selection !== undefined && selection.e === e && selection.to > selection.from
      ? spansOf(L, selection.from, selection.to)
      : [];

  /** Pad `e` off the pen's road (or gone): its run's room given back and its moments forgotten — back on it, it writes nothing at first. */
  const dropPen = (e: Entity): void => {
    if (!pens.has(e)) return;
    if (pens.get(e)?.base !== undefined) roomOfHost(host)?.free(e);
    pens.delete(e);
    clock.forget(e);
  };
  /** Pad `e` off the raster's road (or gone): its layer given back for the next pad. */
  const dropRaster = (e: Entity): void => {
    const layer = layers.get(e);
    if (layer !== undefined) {
      layers.delete(e);
      free.push(layer);
    }
    const had = laid.get(e);
    if (had !== undefined) {
      delete had.raster;
      delete had.rasterKey;
    }
  };

  const layerFor = (e: Entity, ink: InkLayers): number | undefined => {
    const had = layers.get(e);
    if (had !== undefined) return had;
    const index = free.pop() ?? nextLayer;
    if (!ink.ensure(index)) {
      if (index !== nextLayer) free.push(index);
      return undefined;
    }
    if (index === nextLayer) nextLayer += 1;
    layers.set(e, index);
    return index;
  };

  /** `e`'s layout for `ink` in `box`, by `metrics` laid by `by` (a raster's version, a face): re-laid only when one of them moves. */
  const layoutFor = (
    e: Entity,
    by: string,
    metrics: HandMetrics,
    ink: InkValue,
    seed: number,
    box: { readonly w: number; readonly h: number },
  ): Laid => {
    const layoutKey = `${by}|${box.w}x${box.h}|${seed}|${encodeSeeds(ink.seeds)}|${ink.text}`;
    const had = laid.get(e);
    if (had?.layoutKey === layoutKey) return had;
    counts = { ...counts, layouts: counts.layouts + 1 };
    const next: Laid = {
      layoutKey,
      layout: layoutText(ink.text, box, PAD_HAND, metrics, seed, ink.seeds),
    };
    laid.set(e, next);
    return next;
  };

  /**
   * THE PEN's draw: the layout by the face's own metrics; the clock looked at only when the words, their hand or their marks move,
   * and the run built and written only when what the clock answers moves; the record told the run's base. Undefined: the device
   * holds no more runs — the raster's road.
   */
  const penDraw = (
    e: Entity,
    atlas: HandAtlas,
    ink: InkValue,
    seed: number,
    box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ): { readonly entry: Laid; readonly pen?: PadPenRun } | undefined => {
    const entry = layoutFor(e, `pen:${idOf(atlas)}`, metricsFor(atlas), ink, seed, box);
    const L = entry.layout;
    const R = roomOfHost(host);
    if (R === undefined) {
      restless = true; // the pass is not made yet: nothing to write into — the next step writes it
      return { entry };
    }
    let p = pens.get(e);
    if (p === undefined) {
      p = {};
      pens.set(e, p);
    }
    const lookKey = `${entry.layoutKey}|${encodeMarks(ink.marks)}`;
    if (p.lookKey !== lookKey) {
      p.lookKey = lookKey;
      const how = told.get(e) ?? "arrived";
      told.delete(e);
      const moments = clock.look(e, { layout: L, seeds: ink.seeds, atlas, now, how });
      const strokes = strokesOf(L, ink);
      const marked = clock.marks(e, { layout: L, ink, strokes, atlas, now });
      reach(moments, marked);
      if (p.run === undefined || p.layout !== L || p.moments !== moments || p.marked !== marked) {
        const run = handRun(L, atlas, {
          moments,
          epoch: now,
          bleed: PAD_BLEED,
          weight: HAND_WEIGHT,
          ink,
          strokes,
          marked,
          wash: washOf(e, L),
        });
        counts = { ...counts, runs: counts.runs + 1 };
        if (run.glyphs === 0 && strokes.length === 0) {
          // nothing inked (an empty pad, a pad of spaces): no run written — and the clock has seen it, so its first glyph is typed
          if (p.base !== undefined) R.free(e);
          delete p.base;
        } else {
          const base = R.write(e, run);
          if (base < 0) {
            dropPen(e);
            return undefined;
          }
          R.face(atlas);
          R.at(penTime());
          p.base = base;
          land(e);
        }
        Object.assign(p, { layout: L, moments, marked, run, atlas });
      }
    }
    return p.base === undefined
      ? { entry }
      : { entry, pen: { base: p.base, x: box.x, y: box.y, foot: box.y + box.h } };
  };

  /** THE RASTER's draw (the road the pad had before the pen): its layout by the raster's metrics, its ink at the band the view asks. */
  const rasterDraw = (
    e: Entity,
    ink: InkValue,
    seed: number,
    box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
    zoomDpr: number,
  ): { readonly entry?: Laid; readonly raster?: PadRaster } => {
    const raster = text();
    const metrics = raster?.metrics(PAD_FACE);
    if (raster === undefined || metrics === undefined) return {}; // no raster, or its face is loading: lay nothing yet (it says when it lands)
    const entry = layoutFor(e, `raster:${raster.version()}`, metrics, ink, seed, box);
    if (ink.text.length === 0) return { entry };
    const layersNow = inkOfHost(host);
    if (layersNow === undefined) {
      restless = true; // the pass is not made yet: lay it at the next step
      return { entry };
    }
    // the densest rung that fits a layer (a pad bigger than the law's still writes, more coarsely)
    let band = bandFor(zoomDpr, law);
    while (
      band > law.band.min &&
      (box.w * band > layersNow.size.w || box.h * band > layersNow.size.h)
    )
      band /= 2;
    const rasterKey = `${entry.layoutKey}|${band}`;
    if (entry.rasterKey === rasterKey && entry.raster !== undefined)
      return { entry, raster: entry.raster };
    const layer = layerFor(e, layersNow);
    if (layer === undefined) {
      counts = { ...counts, blanks: counts.blanks + 1 };
      return { entry };
    }
    const bitmap = raster.raster(entry.layout, PAD_FACE, box, band, PAD_BLEED);
    layersNow.write(layer, bitmap);
    counts = { ...counts, rasters: counts.rasters + 1 };
    const laidNow: PadRaster = {
      layer,
      band,
      x: box.x,
      y: box.y,
      w: Math.min(bitmap.w, layersNow.size.w),
      h: Math.min(bitmap.h, layersNow.size.h),
      layerW: layersNow.size.w,
      layerH: layersNow.size.h,
    };
    entry.rasterKey = rasterKey;
    entry.raster = laidNow;
    land(e);
    return { entry, raster: laidNow };
  };

  /** The washes owed, rewritten alone in the runs that stand (a pad whose words moved builds its run with the wash at its draw). */
  const washOwed = (): boolean => {
    let any = false;
    const R = roomOfHost(host);
    for (const e of owed) {
      const p = pens.get(e);
      if (R === undefined || p?.run === undefined || p.layout === undefined || p.base === undefined)
        continue;
      if (stale.has(e) || roads.get(e) !== "pen") continue;
      const wash = inkWash(p.run, washOf(e, p.layout));
      if (R.wash(e, wash)) {
        p.run = washRun(p.run, wash);
        counts = { ...counts, washes: counts.washes + 1 };
        any = true;
      } else remake(e); // a wash its room cannot hold: the run is built again, with it
    }
    owed.clear();
    return any;
  };

  return {
    draw(e, props, size, zoomDpr) {
      stale.delete(e);
      const box = writingBox(size.w, size.h, law);
      const seed = numberProp(props, "seed", 0);
      const ink = inkNow(e, props, seed);
      let entry: Laid | undefined;
      let rasterNow: PadRaster | undefined;
      let penNow: PadPenRun | undefined;
      const atlas = penFace(ink.text);
      const drawn = atlas === undefined ? undefined : penDraw(e, atlas, ink, seed, box);
      if (drawn !== undefined) {
        roads.set(e, "pen");
        dropRaster(e);
        entry = drawn.entry;
        penNow = drawn.pen;
      } else {
        roads.set(e, "raster");
        dropPen(e);
        const r = rasterDraw(e, ink, seed, box, zoomDpr);
        entry = r.entry;
        rasterNow = r.raster;
      }
      const pitch = PAD_HAND.size * PAD_HAND.lineHeight;
      // the rules sit on the hand's baselines: the layout's first one, or where the hand would lay it
      const first = box.y + (entry?.layout.ascent ?? PAD_HAND.size * 0.9);
      const rules: PadRules = { first, pitch, last: box.y + box.h - PAD_HAND.size * 0.25 };
      let caretNow: PadCaret | undefined;
      if (caret !== undefined && caret.e === e) {
        if (entry !== undefined) {
          const c = caretAt(entry.layout, Math.min(caret.index, ink.text.length));
          caretNow = { x: box.x + c.x, y: box.y + c.y - c.above, h: c.above + c.below };
        } else caretNow = { x: box.x, y: box.y + PAD_HAND.size * 0.1, h: PAD_HAND.size * 1.05 };
      }
      return {
        rules,
        ...(rasterNow !== undefined ? { raster: rasterNow } : {}),
        ...(penNow !== undefined ? { pen: penNow } : {}),
        ...(caretNow !== undefined ? { caret: caretNow } : {}),
      };
    },
    rungOf(e, props, zoomDpr) {
      const words = drafts.get(e)?.text ?? stringProp(props, "text", "");
      return penFace(words) !== undefined ? PEN_RUNG : Math.round(Math.log2(bandFor(zoomDpr, law)));
    },
    roadOf: (e) => roads.get(e),
    penOf(e) {
      const p = pens.get(e);
      if (
        p?.base === undefined ||
        p.run === undefined ||
        p.atlas === undefined ||
        p.moments === undefined ||
        p.marked === undefined
      )
        return undefined;
      return { base: p.base, run: p.run, atlas: p.atlas, moments: p.moments, marked: p.marked };
    },
    layoutOf: (e) => laid.get(e)?.layout,
    draft: (e) => drafts.get(e),
    setDraft(e, ink, arrived) {
      if (ink === undefined) drafts.delete(e);
      else drafts.set(e, ink);
      if (arrived !== undefined) told.set(e, arrived.how);
      stale.add(e);
      remake(e);
    },
    setCaret(e, index) {
      const was = caret?.e;
      caret = e === undefined ? undefined : { e, index: Math.max(0, index ?? 0) };
      if (was !== undefined && was !== e) remake(was);
      if (e !== undefined) remake(e);
    },
    setSelection(e, from, to) {
      const was = selection;
      const a = Math.max(0, Math.min(from ?? 0, to ?? 0));
      const b = Math.max(0, from ?? 0, to ?? 0);
      selection = e === undefined ? undefined : { e, from: a, to: b };
      const key = (s: typeof selection): string =>
        s === undefined || s.to <= s.from ? "" : `${s.e}:${s.from}:${s.to}`;
      if (key(was) === key(selection)) return;
      if (was !== undefined) owed.add(was.e);
      if (e !== undefined) owed.add(e);
      host?.wake?.();
    },
    penTime,
    stats() {
      let pen = 0;
      let raster = 0;
      for (const r of roads.values()) {
        if (r === "pen") pen += 1;
        else raster += 1;
      }
      return { ...counts, layers: layers.size, roads: { pen, raster } };
    },
    tick(t) {
      now = t;
      let want = restless;
      restless = false;
      // a face landed (or was found missing): every pad takes its road again
      const v = faces()?.version() ?? seenFaces;
      if (v !== seenFaces) {
        seenFaces = v;
        want = true;
      }
      const washed = washOwed();
      // THE PEN moved since the last tick: the run holds every moment, so only its time moves — the frame drawn again with no
      // record remade (`KindHost.redraw`); a host without the door has the records remade instead
      const moved = clock.tick(t);
      if (moved || washed) {
        if (host?.redraw !== undefined) host.redraw();
        else want = true;
      }
      roomOfHost(host)?.at(penTime());
      return want;
    },
    due: (t) =>
      restless || owed.size > 0 || (faces()?.version() ?? seenFaces) !== seenFaces
        ? t
        : clock.due(t),
    landed: (e) => landedOf.get(e) ?? 0,
    forget(e) {
      laid.delete(e);
      drafts.delete(e);
      told.delete(e);
      stale.delete(e);
      owed.delete(e);
      roads.delete(e);
      landedOf.delete(e);
      dropRaster(e);
      dropPen(e);
      if (caret?.e === e) caret = undefined;
      if (selection?.e === e) selection = undefined;
    },
    dispose() {
      unsubscribe?.();
      const R = roomOfHost(host);
      for (const [e, p] of pens) if (p.base !== undefined) R?.free(e);
      pens.clear();
      clock.clear();
      laid.clear();
      drafts.clear();
      told.clear();
      stale.clear();
      owed.clear();
      roads.clear();
      layers.clear();
      landedOf.clear();
      free.length = 0;
      caret = undefined;
      selection = undefined;
    },
  };
}
