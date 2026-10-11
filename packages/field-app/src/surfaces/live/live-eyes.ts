// THE CAP'S EYES (PT-5b ruling 3) — what the desk's LIVE service reads of the board to choose which pages are alive: how far
// a pane lies from the view's centre (the six NEAREST come alive; of the seen ones the farthest gives its slot to the page
// in the hand), and whether the document still holds the object behind a face's key (a pane DELETED: its still is forgotten
// when its page's grace lapses — one that only left the mount keeps its own). Read at the plan, never kept.

import { Camera, type CanvasEngine, Position, Size, Viewport } from "@vibecook/ice";

export interface LiveEyes {
  /** World units from the pane's centre to the view's — +Infinity where either is not known. */
  far(key: string): number;
  /** `false`: the open document holds no such object; `undefined`: no document is open to say. */
  exists(key: string): boolean | undefined;
}

export function createLiveEyes(engine: CanvasEngine): LiveEyes {
  /** The key's entity; null: the document holds none; undefined: no document is open. */
  const entityOf = (key: string) => {
    const store = engine.docs.current()?.store;
    if (store === undefined) return undefined;
    const entity = store.resolve(key as never);
    return entity !== undefined && engine.world.isAlive(entity) ? entity : null;
  };
  return {
    exists(key) {
      const entity = entityOf(key);
      return entity === undefined ? undefined : entity !== null;
    },
    far(key) {
      const entity = entityOf(key);
      const camera = engine.world.getResource(Camera);
      const view = engine.world.getResource(Viewport);
      if (entity === undefined || entity === null || camera === undefined || view === undefined)
        return Number.POSITIVE_INFINITY;
      const at = engine.world.get(entity, Position);
      if (at === undefined || !(camera.zoom > 0)) return Number.POSITIVE_INFINITY;
      const size = engine.world.get(entity, Size);
      // the camera is the view's top-left corner in the world (ICE's coords: screen / zoom + camera)
      const cx = camera.x + view.w / (2 * camera.zoom);
      const cy = camera.y + view.h / (2 * camera.zoom);
      return Math.hypot(at.x + (size?.w ?? 0) / 2 - cx, at.y + (size?.h ?? 0) / 2 - cy);
    },
  };
}
