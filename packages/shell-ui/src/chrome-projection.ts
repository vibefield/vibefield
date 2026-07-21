/**
 * App-owned projection from ICE interaction truth into stable React chrome
 * snapshots. The ECS remains authoritative; this bridge only derives and
 * publishes visual state after world.notify(). One projection is shared by
 * every CardShell/GlLiftGroup attached to the same World.
 */
import {
  Captures,
  ChromeSettings,
  Drag,
  defineQuery,
  type Entity,
  GesturePhases,
  Grab,
  HadSequence,
  OverlapCandidate,
  OverlapRejected,
  Position,
  Selected,
  Size,
  type World,
} from "@vibecook/ice";
import { WidgetHiddenContext } from "@vibecook/ice/react";
import { useCallback, useContext, useRef, useSyncExternalStore } from "react";

export type OverlapTier = "none" | "accept" | "reject";

export interface DragLiftSnapshot {
  readonly lifted: boolean;
  readonly scale: number;
}

export interface CardChromeSnapshot {
  readonly lift: DragLiftSnapshot;
  readonly soleSelected: boolean;
  readonly overlap: OverlapTier;
  readonly hot: Readonly<{ x: number; y: number }>;
}

interface Entry {
  snapshot: CardChromeSnapshot;
  readonly listeners: Set<() => void>;
}

interface ChromeProjection {
  getSnapshot(entity: Entity): CardChromeSnapshot;
  subscribe(entity: Entity, listener: () => void): () => void;
}

const CENTER = { x: 0.5, y: 0.5 } as const;
const grabQ = defineQuery([Grab]);
const selectedQ = defineQuery([Selected]);
const overlapCandidateQ = defineQuery([OverlapCandidate]);
const overlapRejectedQ = defineQuery([OverlapRejected]);
const armedPossibleQ = defineQuery([Drag, HadSequence, GesturePhases.tags.Possible, Captures]);
const armedActiveQ = defineQuery([Drag, HadSequence, GesturePhases.tags.Active, Captures]);

const projections = new WeakMap<World, ChromeProjection>();

function armedByHold(world: World, entity: Entity): boolean {
  for (const recognizer of world.getReverse(entity, Captures)) {
    if (!world.has(recognizer, Drag) || !world.hasTag(recognizer, HadSequence)) continue;
    if (
      world.hasTag(recognizer, GesturePhases.tags.Possible) ||
      world.hasTag(recognizer, GesturePhases.tags.Active)
    ) {
      return true;
    }
  }
  return false;
}

function selectedCount(world: World): number {
  let count = 0;
  world.query(selectedQ).each((batch) => {
    count += batch.count;
  });
  return count;
}

/** v1 hot point: centroid of dragged rect intersection in card-local coordinates. */
function hotPoint(world: World, entity: Entity): Readonly<{ x: number; y: number }> {
  let dragged: Entity | undefined;
  world.query(grabQ).each((batch) => {
    for (const row of batch) {
      dragged = batch.entity(row);
      return;
    }
  });
  if (dragged === undefined) return CENTER;
  const draggedPosition = world.get(dragged, Position);
  const draggedSize = world.get(dragged, Size);
  const cardPosition = world.get(entity, Position);
  const cardSize = world.get(entity, Size);
  if (
    draggedPosition === undefined ||
    draggedSize === undefined ||
    cardPosition === undefined ||
    cardSize === undefined
  ) {
    return CENTER;
  }
  const intersectionX =
    (Math.max(draggedPosition.x, cardPosition.x) +
      Math.min(draggedPosition.x + draggedSize.w, cardPosition.x + cardSize.w)) /
    2;
  const intersectionY =
    (Math.max(draggedPosition.y, cardPosition.y) +
      Math.min(draggedPosition.y + draggedSize.h, cardPosition.y + cardSize.h)) /
    2;
  const x = cardSize.w > 0 ? (intersectionX - cardPosition.x) / cardSize.w : 0.5;
  const y = cardSize.h > 0 ? (intersectionY - cardPosition.y) / cardSize.h : 0.5;
  return {
    x: Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000,
    y: Math.round(Math.min(1, Math.max(0, y)) * 1000) / 1000,
  };
}

function sameHot(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
): boolean {
  return a.x === b.x && a.y === b.y;
}

function createChromeProjection(world: World): ChromeProjection {
  const entries = new Map<Entity, Entry>();
  const hotEntities = new Set<Entity>();
  let subscriberCount = 0;
  let observerDisposers: Array<() => void> = [];
  let hotTimer: ReturnType<typeof setInterval> | undefined;

  const derive = (
    entity: Entity,
    previous: CardChromeSnapshot | undefined,
    selectionSize: number,
  ): CardChromeSnapshot => {
    const lifted = world.isAlive(entity) && (world.has(entity, Grab) || armedByHold(world, entity));
    const scale = world.getResource(ChromeSettings)?.liftScale ?? 1.05;
    const lift =
      previous?.lift.lifted === lifted && previous.lift.scale === scale
        ? previous.lift
        : { lifted, scale };
    const soleSelected =
      world.isAlive(entity) && selectionSize === 1 && world.hasTag(entity, Selected);
    const overlap: OverlapTier = !world.isAlive(entity)
      ? "none"
      : world.hasTag(entity, OverlapCandidate)
        ? "accept"
        : world.hasTag(entity, OverlapRejected)
          ? "reject"
          : "none";
    const hot = overlap === "none" ? (previous?.hot ?? CENTER) : hotPoint(world, entity);

    if (
      previous !== undefined &&
      previous.lift === lift &&
      previous.soleSelected === soleSelected &&
      previous.overlap === overlap &&
      sameHot(previous.hot, hot)
    ) {
      return previous;
    }
    return { lift, soleSelected, overlap, hot };
  };

  const emit = (entry: Entry): void => {
    for (const listener of [...entry.listeners]) listener();
  };

  const syncHotTimer = (): void => {
    if (hotEntities.size > 0 && hotTimer === undefined) {
      hotTimer = setInterval(() => {
        for (const entity of hotEntities) {
          const entry = entries.get(entity);
          if (entry === undefined || entry.snapshot.overlap === "none") continue;
          const hot = hotPoint(world, entity);
          if (sameHot(entry.snapshot.hot, hot)) continue;
          entry.snapshot = { ...entry.snapshot, hot };
          emit(entry);
        }
      }, 60);
    } else if (hotEntities.size === 0 && hotTimer !== undefined) {
      clearInterval(hotTimer);
      hotTimer = undefined;
    }
  };

  const syncAll = (): void => {
    const selectionSize = selectedCount(world);
    for (const [entity, entry] of entries) {
      if (entry.listeners.size === 0) continue;
      const next = derive(entity, entry.snapshot, selectionSize);
      if (next.overlap === "none") hotEntities.delete(entity);
      else hotEntities.add(entity);
      if (next === entry.snapshot) continue;
      entry.snapshot = next;
      emit(entry);
    }
    syncHotTimer();
  };

  const start = (): void => {
    if (observerDisposers.length > 0) return;
    const wake = (): void => syncAll();
    observerDisposers = [
      world.reactive.observeQuery(grabQ, wake),
      world.reactive.observeQuery(armedPossibleQ, wake),
      world.reactive.observeQuery(armedActiveQ, wake),
      world.reactive.observeQuery(selectedQ, wake),
      world.reactive.observeQuery(overlapCandidateQ, wake),
      world.reactive.observeQuery(overlapRejectedQ, wake),
      world.reactive.observeResource(ChromeSettings, wake),
    ];
  };

  const stop = (): void => {
    for (const dispose of observerDisposers) dispose();
    observerDisposers = [];
    if (hotTimer !== undefined) clearInterval(hotTimer);
    hotTimer = undefined;
    hotEntities.clear();
    entries.clear();
  };

  const ensureEntry = (entity: Entity): Entry => {
    const existing = entries.get(entity);
    if (existing !== undefined) return existing;
    const entry: Entry = {
      snapshot: derive(entity, undefined, selectedCount(world)),
      listeners: new Set(),
    };
    entries.set(entity, entry);
    return entry;
  };

  return {
    getSnapshot(entity) {
      return ensureEntry(entity).snapshot;
    },
    subscribe(entity, listener) {
      const entry = ensureEntry(entity);
      entry.snapshot = derive(entity, entry.snapshot, selectedCount(world));
      entry.listeners.add(listener);
      subscriberCount += 1;
      if (entry.snapshot.overlap !== "none") hotEntities.add(entity);
      if (subscriberCount === 1) {
        start();
        syncAll();
      } else {
        syncHotTimer();
      }
      return () => {
        if (!entry.listeners.delete(listener)) return;
        subscriberCount -= 1;
        if (entry.listeners.size === 0) {
          entries.delete(entity);
          hotEntities.delete(entity);
          syncHotTimer();
        }
        if (subscriberCount === 0) stop();
      };
    },
  };
}

function projectionFor(world: World): ChromeProjection {
  const existing = projections.get(world);
  if (existing !== undefined) return existing;
  const projection = createChromeProjection(world);
  projections.set(world, projection);
  return projection;
}

export function useCardChromeProjection(world: World, entity: Entity): CardChromeSnapshot {
  const hidden = useContext(WidgetHiddenContext);
  const projection = projectionFor(world);
  const last = useRef(projection.getSnapshot(entity));
  const subscribe = useCallback(
    (listener: () => void) => (hidden ? () => undefined : projection.subscribe(entity, listener)),
    [projection, entity, hidden],
  );
  const getSnapshot = useCallback(() => {
    if (hidden) return last.current;
    last.current = projection.getSnapshot(entity);
    return last.current;
  }, [projection, entity, hidden]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useProjectedDragLift(world: World, entity: Entity): DragLiftSnapshot {
  return useCardChromeProjection(world, entity).lift;
}
