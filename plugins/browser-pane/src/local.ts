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

import type { Entity, KindHost, KindLocal } from "@vibefield/plugin-sdk/desk";
import { HEAD_RASTER, type HeadState, headKey } from "./head";
import type { PaneShape } from "./law";
import type { HeadBitmap } from "./layout";
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
  /** Heads drawn since the desk was made (a test's witness). */
  stats(): { readonly heads: number };
}

const doorsOf = (host: KindHost | undefined): PaneDoors | undefined => {
  const pass = host?.pass() as Partial<PaneDoors> | undefined;
  return typeof pass?.pending === "function" && typeof pass.onPending === "function"
    ? (pass as PaneDoors)
    : undefined;
};

export function createPaneLocal(host: KindHost | undefined): PaneLocal {
  const heads = new Map<Entity, { readonly key: string; readonly bitmap: HeadBitmap }>();
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
    stats: () => ({ heads: drawn }),
    tick: () => waiting(),
    due: (now) => (waiting() ? now + PAGE_REMAKE_MS / 3 : Number.POSITIVE_INFINITY),
    // a page made after its record (a deferred one) changes how the pane looks with no fact of its own moving
    landed: (e) => doors()?.made(e as number) ?? 0,
    forget(e) {
      heads.delete(e);
      doors()?.forget(e as number);
    },
    dispose() {
      heads.clear();
      wired?.onPending(undefined);
      wired = undefined;
    },
  };
}
