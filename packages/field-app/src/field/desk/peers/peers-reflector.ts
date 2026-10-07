import {
  Camera,
  type CanvasEngine,
  defineQuery,
  type Entity,
  Local,
  Not,
  PresenceCursor,
  PresencePeer,
  type World,
} from "@vibecook/ice";
import type { CameraState } from "@vibecook/ice/kernel";
import { canvasKey, PeerWhere, peerWhereOf } from "./peer-facet";
import {
  arrowBoxAt,
  nextIdleAt,
  type PeerHidden,
  type PeersHidden,
  type PeerWhereFacts,
  peerHidden,
} from "./peers-model";

// PEERS ON THE MAT, placed (DK-16; DESIGN.md §8 "Peers on the mat", R17). React renders the roster — one element per
// peer, by `usePresencePeers`, which gives only its names — and this controller PLACES them: a REFLECTOR on the engine
// (post-notify, never an ECS write, never a layout read — design-002 §5) reads each peer's `PresenceCursor` world x/y
// through this window's camera on every frame that moved either, and writes the element's transform and its verdict
// imperatively — never a render of React per frame. Its observers are what arm the world now that ICE draws no remote
// cursors (I26: their reflector was the host's one observing reflector). An idle verdict falls due with no frame at all
// (a peer that stopped moving sends nothing), so it is a timer of this window's clock, which writes the DOM and wakes
// nothing. Under a cover the loop is parked and nothing flushes; the layer stands hidden by its own verdict anyway.

const cursorsQ = defineQuery([PresencePeer, PresenceCursor, Not(Local)]);
const wheresQ = defineQuery([PresencePeer, PeerWhere, Not(Local)]);

/** One peer as this window last placed it. */
export interface PeerSeen {
  readonly entity: number;
  /** the pointer in world units, or null */
  readonly cursor: { readonly x: number; readonly y: number } | null;
  readonly where: PeerWhereFacts | null;
  /** ms ago it last moved, by this window's clock */
  readonly idleMs: number;
  readonly hidden: PeerHidden;
  /** where the arrow's box stands (CSS px of the view), or null with no pointer */
  readonly box: { readonly x: number; readonly y: number } | null;
}

/** What the layer did — the door's read (`__vfDesk.peers()`). */
export interface PeersRecord {
  /** why the whole layer is hidden, or null */
  readonly layer: PeersHidden;
  /** this window's canvas (its nav frame's key; "" the root) and camera at the last placement */
  readonly canvas: string;
  readonly camera: CameraState | null;
  readonly peers: readonly PeerSeen[];
  /** the reflector's flushes, the element writes (transform or verdict) and the idle timers that fired */
  readonly flushes: number;
  readonly writes: number;
  readonly idles: number;
}

export interface PeersSeams {
  readonly ce: Pick<CanvasEngine, "world" | "docs" | "engine">;
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

export interface PeersController {
  /** Register the reflector; the returned undo unregisters it and drops the timer. */
  attach(): () => void;
  /** React's element for a peer of the roster; placed at once. Returns the unbind. */
  bind(entity: Entity, el: HTMLElement): () => void;
  /** The layer's verdict moved (the desk, a cover, the board). */
  setLayer(hidden: PeersHidden): void;
  record(): PeersRecord;
}

interface Placed {
  x: number;
  y: number;
  movedAt: number;
  transform: string;
  hidden: string;
}

/** A verdict no element has had written yet. */
const UNWRITTEN = "\u0000";

let latest: PeersController | null = null;

/** The record of the peers layer mounted now, or null. */
export function peersRecord(): PeersRecord | null {
  return latest?.record() ?? null;
}

export function createPeersController(seams: PeersSeams): PeersController {
  const { ce } = seams;
  const els = new Map<Entity, HTMLElement>();
  const placed = new Map<Entity, Placed>();
  let layer: PeersHidden = null;
  let timer: unknown = null;
  let flushes = 0;
  let writes = 0;
  let idles = 0;
  let canvas = "";
  let camera: CameraState | null = null;
  let seen: PeerSeen[] = [];

  const cameraOf = (world: World): CameraState => {
    const cam = world.getResource(Camera);
    return cam === undefined ? { x: 0, y: 0, zoom: 1 } : { x: cam.x, y: cam.y, zoom: cam.zoom };
  };

  /** Read every bound peer, judge it, and write what changed. */
  const place = (world: World): void => {
    const now = seams.now();
    camera = cameraOf(world);
    canvas = canvasKey(ce);
    const next: PeerSeen[] = [];
    for (const [entity, el] of els) {
      const alive = world.isAlive(entity);
      const cursor = alive ? (world.get(entity, PresenceCursor) ?? null) : null;
      const where = alive ? peerWhereOf(world, entity) : null;
      let p = placed.get(entity);
      if (p === undefined) {
        // first seen: its first verdict is always written, and first sight counts as a move
        p = { x: Number.NaN, y: Number.NaN, movedAt: now, transform: "", hidden: UNWRITTEN };
        placed.set(entity, p);
      }
      if (cursor !== null && (p.x !== cursor.x || p.y !== cursor.y)) {
        p.x = cursor.x;
        p.y = cursor.y;
        p.movedAt = now;
      }
      const at = cursor === null ? null : { x: cursor.x, y: cursor.y };
      const hidden = peerHidden({ cursor: at, where, movedAt: p.movedAt }, { canvas, now });
      const box = at === null ? null : arrowBoxAt(at, camera);
      if (box !== null) {
        const transform = `translate(${box.x}px, ${box.y}px)`;
        if (p.transform !== transform) {
          el.style.transform = transform;
          p.transform = transform;
          writes += 1;
        }
      }
      const verdict = hidden ?? "";
      if (p.hidden !== verdict) {
        if (hidden === null) delete el.dataset["hidden"];
        else el.dataset["hidden"] = hidden;
        p.hidden = verdict;
        writes += 1;
      }
      next.push({
        entity: entity as number,
        cursor: at,
        where,
        idleMs: now - p.movedAt,
        hidden,
        box,
      });
    }
    seen = next;
    schedule(now);
  };

  /** The next idle verdict among the peers drawn now, as a timer — the DOM written, nothing woken. */
  const schedule = (now: number): void => {
    if (timer !== null) seams.clearTimer(timer);
    timer = null;
    const due = nextIdleAt(
      seen
        .filter((s) => s.hidden === null)
        .map((s) => placed.get(s.entity as Entity)?.movedAt ?? now),
      now,
    );
    if (due === null) return;
    timer = seams.setTimer(
      () => {
        timer = null;
        idles += 1;
        place(ce.world);
      },
      Math.max(0, due - now),
    );
  };

  const controller: PeersController = {
    attach() {
      latest = controller;
      const off = ce.engine.registerReflector({
        name: "vibefield.peers",
        observe: {
          resources: [Camera],
          queries: [
            { q: cursorsQ, cols: [PresenceCursor] },
            { q: wheresQ, cols: [PeerWhere] },
          ],
        },
        flush: (world) => {
          flushes += 1;
          place(world);
        },
      });
      return () => {
        off();
        if (timer !== null) seams.clearTimer(timer);
        timer = null;
        if (latest === controller) latest = null;
      };
    },
    bind(entity, el) {
      if (els.get(entity) !== el) {
        // a new element for a peer already placed: its place and verdict written to it afresh, its idle clock kept
        const p = placed.get(entity);
        if (p !== undefined) {
          p.transform = "";
          p.hidden = UNWRITTEN;
        }
      }
      els.set(entity, el);
      place(ce.world);
      return () => {
        if (els.get(entity) !== el) return;
        els.delete(entity);
        placed.delete(entity);
      };
    },
    setLayer(hidden) {
      layer = hidden;
    },
    record: () => ({ layer, canvas, camera, peers: seen, flushes, writes, idles }),
  };
  return controller;
}
