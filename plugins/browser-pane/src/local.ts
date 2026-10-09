// The pane's DESK STATE — the kind's own state on ONE desk (`ObjectKind.local`): each pane's HEAD raster, drawn by the
// head service its DOM half lends (`HEAD_RASTER` — head-canvas.ts) and cached by what it says and the band it is drawn
// at (head.ts `headKey`): re-drawn when its address, its viewport or its rung moves, never on a pan or a frame. Flux,
// never a world fact: the facts are the pane's props and its size.
//
// And the desk's WAKE for a page the pass deferred (pass.ts `PAGE_REMAKE_MS` — a resize remakes the page as the hand
// pauses, not every frame): while one waits the kind is due a little later, and its tick asks for a frame, in which the
// pass makes it (K7a: nothing polled at rest — with nothing waiting the kind is never due on its own).
//
// A desk lending no head service (a Node still, a bare host) draws no head from here: the record names the committed
// raster its key names instead (head-still.ts), or none.
//
// PT-2 — and each pane's LIVE FACE (live.ts): its page, opened by the object's durable key on the host's `LIVE` service, taken
// when it says something arrived, asked of by the pane's demand law over the desk's SIGHT. Its tick takes and asks; its due is
// the sight's step owed after a drawn frame, or a held-back viewport — nothing polled at rest.

import type {
  Entity,
  KindHost,
  KindLocal,
  LiveBrowserSpec,
  LiveFace,
  LiveInfo,
  LiveState,
  Sight,
} from "@vibefield/plugin-sdk/desk";
import { HEAD_RASTER, type HeadState, headKey } from "./head";
import type { PaneShape } from "./law";
import type { HeadBitmap } from "./layout";
import { createPaneFaces, type PaneFaceStats } from "./live";
import { PAGE_REMAKE_MS } from "./pass";

/** The pass's doors the local reads (the root pass, once the ground has made it). */
interface PaneDoors {
  pending(): number;
  onPending(fn: (() => void) | undefined): void;
  forget(entity: number): void;
  made(entity: number): number;
}

export interface PaneLocal extends KindLocal {
  /** A pane's head for what it says at `tpu`: its key, and the service's raster (none lent: the key alone). */
  head(
    e: Entity,
    S: PaneShape,
    state: HeadState,
    tpu: number,
  ): { readonly key: string; readonly bitmap?: HeadBitmap };
  /** What `e`'s head says now — its address, its viewport readout — as its record last asked (a smoke's witness, read through the desk door). */
  said(e: Entity): HeadState | undefined;
  /** Heads drawn since the desk was made (a test's witness). */
  stats(): { readonly heads: number };
  /** PT-2 — `e`'s live face for the page `spec` names (opened at its first ask; undefined: no `LIVE` lent, no durable key). */
  face(e: Entity, spec: LiveBrowserSpec, S: PaneShape): LiveFace | undefined;
  /** PT-2 — `e`'s face closed: its address is no longer a page. */
  drop(e: Entity): void;
  /** PT-2 — the sight the pass tells, carried on the records of panes with a face. */
  readonly sight: Sight;
  /** PT-2 — `e`'s page's words now (its state and info), or undefined: no face. */
  page(
    e: Entity,
  ): { readonly key: string; readonly state: LiveState; readonly info: LiveInfo } | undefined;
  /** PT-2 — what the faces did (a test's and a smoke's witness). */
  faces(): PaneFaceStats;
}

const doorsOf = (host: KindHost | undefined): PaneDoors | undefined => {
  const pass = host?.pass() as Partial<PaneDoors> | undefined;
  return typeof pass?.pending === "function" && typeof pass.onPending === "function"
    ? (pass as PaneDoors)
    : undefined;
};

export function createPaneLocal(host: KindHost | undefined): PaneLocal {
  const live = createPaneFaces(host);
  const heads = new Map<Entity, { readonly key: string; readonly bitmap: HeadBitmap }>();
  const saying = new Map<Entity, HeadState>();
  let drawn = 0;
  let wired: PaneDoors | undefined;
  /** The root pass's doors, its deferral wired to the desk's wake the first time they are there. */
  const doors = (): PaneDoors | undefined => {
    const d = doorsOf(host);
    if (d !== undefined && d !== wired) {
      d.onPending(() => host?.wake?.());
      wired = d;
    }
    return d;
  };
  const waiting = (): boolean => (doors()?.pending() ?? 0) > 0;
  return {
    head(e, S, state, tpu) {
      doors();
      saying.set(e, state);
      const key = headKey(S, state, tpu);
      const had = heads.get(e);
      if (had?.key === key) return had;
      const bitmap = host?.use?.(HEAD_RASTER)?.raster(S, state, tpu);
      if (bitmap === undefined) return { key };
      const next = { key, bitmap };
      heads.set(e, next);
      drawn += 1;
      return next;
    },
    said: (e) => saying.get(e),
    stats: () => ({ heads: drawn }),
    face: (e, spec, S) => live.face(e, spec, S),
    drop: (e) => live.drop(e),
    sight: live.sight,
    page: (e) => live.words(e),
    faces: () => live.stats(),
    // the faces' takes and asks answer nothing of their own: a landed frame asks a redraw, new words a remake of its pane
    tick: (now) => {
      live.tick(now);
      return waiting();
    },
    due: (now) =>
      Math.min(waiting() ? now + PAGE_REMAKE_MS / 3 : Number.POSITIVE_INFINITY, live.due(now)),
    // a page made after its record (a deferred one) changes how the pane looks with no fact of its own moving
    landed: (e) => doors()?.made(e as number) ?? 0,
    forget(e) {
      heads.delete(e);
      saying.delete(e);
      doors()?.forget(e as number);
      live.forget(e);
    },
    dispose() {
      live.dispose();
      heads.clear();
      saying.clear();
      wired?.onPending(undefined);
      wired = undefined;
    },
  };
}
