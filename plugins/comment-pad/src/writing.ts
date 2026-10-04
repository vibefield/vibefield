// The pad's WRITING — the kind's own state on ONE desk (`ObjectKind.local`): every pad's hand LAYOUT, where its
// INK lies in the ink layers, the DRAFT a typing session holds while it is open, and the CARET the pass draws
// while the desk's editor is on a pad. Flux, never a world fact: the facts are the pad's durable cells (its
// `text` and its `seeds`, one `ink` cell; its `seed`); what is drawn from them is cached here, per entity,
// keyed so that nothing is redone on a frame:
//
// - the LAYOUT (the kit's `layoutText`, pure) is keyed by the text raster's version (a face landing re-lays
//   every pad), the writing box, the pad's seed and the text with its seeds;
// - the RASTER (the host's `TextRaster`, lent as `TEXT_RASTER`) is keyed by that layout and the BAND — the
//   texels per pad unit a zoom asks (`bandFor`, a power of two; the kind's `rung`): re-rastered on an edit or
//   a rung crossing only, never on a pan; laid into the pad's own LAYER of the root pass's ink (pass.ts).
//
// A desk with no text raster (the Node harness, a bare host) lays no ink — every pad draws its paper and rules
// blank, honestly. A face still loading lays nothing and waits: the raster says when it lands (`onVersion`),
// and the desk is woken to lay it then (K7a: nothing is polled at rest).

import {
  caretAt,
  type Entity,
  type HandLayout,
  type KindHost,
  type KindLocal,
  layoutText,
  numberProp,
  seedsFor,
  stringProp,
  TEXT_RASTER,
  type TextRaster,
} from "@vibefield/plugin-sdk/desk";
import { bandFor, PAD, PAD_BLEED, PAD_FACE, PAD_HAND, type PadLaw, writingBox } from "./law";
import type { PadCaret, PadRaster, PadRules } from "./layout";
import type { InkBitmap } from "./pass";

/** The ink layers a writing lays its rasters in — the root pad pass's (`PadPass.ink()`). */
export interface InkLayers {
  ensure(index: number): boolean;
  write(index: number, bitmap: InkBitmap): void;
  readonly size: { readonly w: number; readonly h: number };
}

/** A typing session's text while it is open: what the pad draws instead of its cell. */
export interface PadDraft {
  readonly text: string;
  readonly seeds: string;
}

/** What `draw` answers for one pad's record. */
export interface PadDrawn {
  readonly rules: PadRules;
  readonly raster?: PadRaster;
  readonly caret?: PadCaret;
}

export interface PadWritingStats {
  /** Layouts laid, rasters laid, layers held now, pads that drew blank for want of a layer. */
  readonly layouts: number;
  readonly rasters: number;
  readonly layers: number;
  readonly blanks: number;
}

export interface PadWriting extends KindLocal {
  /** One pad's writing for its record: its rules, its ink (laid if it moved), its caret. */
  draw(
    e: Entity,
    props: Readonly<Record<string, unknown>>,
    size: { readonly w: number; readonly h: number },
    zoomDpr: number,
  ): PadDrawn;
  /** The rung a zoom × dpr puts a pad's ink at (the kind's `rung`): the band's exponent. */
  rungOf(zoomDpr: number): number;
  /** The pad's last laid layout (the chip's greeked lines, a tap's caret index). */
  layoutOf(e: Entity): HandLayout | undefined;
  /** The text a typing session holds for `e` while it is open; undefined between sessions. */
  draft(e: Entity): PadDraft | undefined;
  /** A session's text (undefined: the session ended — the pad draws its cell again). The pad's record is remade. */
  setDraft(e: Entity, draft: PadDraft | undefined): void;
  /** The caret the pass draws: before glyph `index` of `e`'s text — or none (`e` undefined). The record is remade. */
  setCaret(e: Entity | undefined, index?: number): void;
  /** The caret's index nearest a point in the writing box (pad units from the sheet's top-left), by `e`'s last layout. */
  caretIndexAt(e: Entity, x: number, y: number): number | undefined;
  stats(): PadWritingStats;
}

interface Laid {
  layoutKey: string;
  layout: HandLayout;
  rasterKey?: string;
  raster?: PadRaster;
}

/** The ink layers behind a kind host: the root pass's, once the ground has made it. */
const inkOf = (host: KindHost | undefined): InkLayers | undefined => {
  const pass = host?.pass() as { ink?: () => InkLayers } | undefined;
  return typeof pass?.ink === "function" ? pass.ink() : undefined;
};

export function createPadWriting(host: KindHost | undefined, law: PadLaw = PAD): PadWriting {
  const text = (): TextRaster | undefined => host?.use?.(TEXT_RASTER);
  const laid = new Map<Entity, Laid>();
  const drafts = new Map<Entity, PadDraft>();
  const layers = new Map<Entity, number>();
  const free: number[] = [];
  const landedOf = new Map<Entity, number>();
  let nextLayer = 0;
  let caret: { e: Entity; index: number } | undefined;
  let restless = false;
  let counts = { layouts: 0, rasters: 0, blanks: 0 };
  // a face that lands between frames re-lays every pad: the desk is woken for it (never polled)
  const unsubscribe = text()?.onVersion?.(() => {
    restless = true;
    host?.wake?.();
  });
  const remake = (e: Entity): void => {
    host?.remake?.(e);
    host?.wake?.();
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

  const layoutFor = (
    e: Entity,
    raster: TextRaster,
    words: string,
    seeds: string,
    seed: number,
    box: { readonly w: number; readonly h: number },
  ): Laid | undefined => {
    const metrics = raster.metrics(PAD_FACE);
    if (metrics === undefined) return undefined; // the face is loading: lay nothing yet (it says when it lands)
    const layoutKey = `${raster.version()}|${box.w}x${box.h}|${seed}|${seeds}|${words}`;
    const had = laid.get(e);
    if (had?.layoutKey === layoutKey) return had;
    counts = { ...counts, layouts: counts.layouts + 1 };
    const layout = layoutText(words, box, PAD_HAND, metrics, seed, seedsFor(words, seeds, seed));
    const next: Laid = { layoutKey, layout };
    laid.set(e, next);
    return next;
  };

  return {
    draw(e, props, size, zoomDpr) {
      const box = writingBox(size.w, size.h, law);
      const draft = drafts.get(e);
      const words = draft?.text ?? stringProp(props, "text", "");
      const seeds = draft?.seeds ?? stringProp(props, "seeds", "");
      const seed = numberProp(props, "seed", 0);
      const raster = text();
      const entry =
        raster === undefined ? undefined : layoutFor(e, raster, words, seeds, seed, box);
      const pitch = PAD_HAND.size * PAD_HAND.lineHeight;
      // the rules sit on the hand's baselines: the layout's first one, or where the hand would lay it
      const first = box.y + (entry?.layout.ascent ?? PAD_HAND.size * 0.9);
      const rules: PadRules = { first, pitch, last: box.y + box.h - PAD_HAND.size * 0.25 };
      let rasterNow: PadRaster | undefined;
      const ink = inkOf(host);
      if (raster !== undefined && entry !== undefined && words.length > 0) {
        if (ink === undefined)
          restless = true; // the pass is not made yet: lay it at the next step
        else {
          // the densest rung that fits a layer (a pad bigger than the law's still writes, more coarsely)
          let band = bandFor(zoomDpr, law);
          while (band > law.band.min && (box.w * band > ink.size.w || box.h * band > ink.size.h))
            band /= 2;
          const rasterKey = `${entry.layoutKey}|${band}`;
          if (entry.rasterKey === rasterKey && entry.raster !== undefined) rasterNow = entry.raster;
          else {
            const layer = layerFor(e, ink);
            if (layer === undefined) counts = { ...counts, blanks: counts.blanks + 1 };
            else {
              const bitmap = raster.raster(entry.layout, PAD_FACE, box, band, PAD_BLEED);
              ink.write(layer, bitmap);
              counts = { ...counts, rasters: counts.rasters + 1 };
              rasterNow = {
                layer,
                band,
                x: box.x,
                y: box.y,
                w: Math.min(bitmap.w, ink.size.w),
                h: Math.min(bitmap.h, ink.size.h),
                layerW: ink.size.w,
                layerH: ink.size.h,
              };
              entry.rasterKey = rasterKey;
              entry.raster = rasterNow;
              landedOf.set(e, (landedOf.get(e) ?? 0) + 1);
            }
          }
        }
      }
      let caretNow: PadCaret | undefined;
      if (caret !== undefined && caret.e === e) {
        if (entry !== undefined) {
          const c = caretAt(entry.layout, Math.min(caret.index, words.length));
          caretNow = { x: box.x + c.x, y: box.y + c.y - c.above, h: c.above + c.below };
        } else caretNow = { x: box.x, y: box.y + PAD_HAND.size * 0.1, h: PAD_HAND.size * 1.05 };
      }
      return {
        rules,
        ...(rasterNow !== undefined ? { raster: rasterNow } : {}),
        ...(caretNow !== undefined ? { caret: caretNow } : {}),
      };
    },
    rungOf: (zoomDpr) => Math.round(Math.log2(bandFor(zoomDpr, law))),
    layoutOf: (e) => laid.get(e)?.layout,
    draft: (e) => drafts.get(e),
    setDraft(e, draft) {
      if (draft === undefined) drafts.delete(e);
      else drafts.set(e, draft);
      remake(e);
    },
    setCaret(e, index) {
      const was = caret?.e;
      caret = e === undefined ? undefined : { e, index: Math.max(0, index ?? 0) };
      if (was !== undefined && was !== e) remake(was);
      if (e !== undefined) remake(e);
    },
    caretIndexAt(e, x, y) {
      const L = laid.get(e)?.layout;
      if (L === undefined) return undefined;
      const box = { x: law.inset.left, y: law.binding + law.inset.top };
      const lx = x - box.x;
      const ly = y - box.y;
      let line = L.lines[L.lines.length - 1];
      for (const candidate of L.lines) {
        if (ly <= candidate.y + L.descent) {
          line = candidate;
          break;
        }
      }
      if (line === undefined) return undefined;
      let best = line.start;
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = line.start; i <= line.end; i += 1) {
        const d = Math.abs((L.positions[2 * i] ?? 0) - lx);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    stats: () => ({ ...counts, layers: layers.size }),
    tick() {
      const was = restless;
      restless = false;
      return was;
    },
    due: (now) => (restless ? now : Number.POSITIVE_INFINITY),
    landed: (e) => landedOf.get(e) ?? 0,
    forget(e) {
      laid.delete(e);
      drafts.delete(e);
      landedOf.delete(e);
      const layer = layers.get(e);
      if (layer !== undefined) {
        layers.delete(e);
        free.push(layer);
      }
      if (caret?.e === e) caret = undefined;
    },
    dispose() {
      unsubscribe?.();
      laid.clear();
      drafts.clear();
      layers.clear();
      landedOf.clear();
      free.length = 0;
      caret = undefined;
    },
  };
}
