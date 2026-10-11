// THE CAP'S EYES (PT-5b ruling 3) — what the desk's LIVE service reads of the board to choose which pages are alive: how far
// a pane lies from the view's centre (the six NEAREST come alive; of the seen ones the farthest gives its slot to the page
// in the hand), and whether the document still holds the object behind a face's key (a pane DELETED: its still is forgotten
// when its page's grace lapses — one that only left the mount keeps its own). Read at the plan, never kept.
// PT-5b2 (ruling 2) — and the objects that STAND: the durable keys of everything on the open document's board, which is
// what the shelf's sweep keeps the stills of (`sweepDocumentStills`).

import {
  Camera,
  type CanvasEngine,
  defineQuery,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
  Viewport,
} from "@vibecook/ice";
import { type PageStills, pageStills } from "./page-stills";

/** The board's objects (never a pegboard's specimen) — the desk door's own query. */
const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

export interface LiveEyes {
  /** World units from the pane's centre to the view's — +Infinity where either is not known. */
  far(key: string): number;
  /** `false`: the open document holds no such object; `undefined`: no document is open to say. */
  exists(key: string): boolean | undefined;
  /** PT-5b2 — the durable keys of the objects the open document holds; `undefined`: no document is open to say. */
  standing(): readonly string[] | undefined;
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
    standing() {
      const store = engine.docs.current()?.store;
      if (store === undefined) return undefined;
      const keys: string[] = [];
      engine.world.query(objectsQ).each((batch) => {
        for (const row of batch) {
          const key = store.keyOf(batch.entity(row)) as string | undefined;
          if (key !== undefined) keys.push(key);
        }
      });
      return keys;
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

/**
 * PT-5b2 (ruling 2) — THE SWEEP of an open document's page stills: the shelf forgets those under this document's id that
 * no standing object's name makes (a pane deleted and the app quit inside its grace; one deleted with no face open — its
 * kind off, a peer's delete while this device had the board closed). The CALLER says when: only for a document that is
 * open and WHOLE — an object that has only not arrived yet reads exactly as a deleted one. With no document open, or a
 * board with no id, nothing is asked. Answers how many stills went.
 */
export async function sweepDocumentStills(
  engine: CanvasEngine,
  docId: string,
  stills: Pick<PageStills, "sweep"> = pageStills(),
): Promise<number> {
  const standing = docId.length === 0 ? undefined : createLiveEyes(engine).standing();
  return standing === undefined ? 0 : stills.sweep(docId, standing);
}
