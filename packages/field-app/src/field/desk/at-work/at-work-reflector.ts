import {
  Active,
  Camera,
  type CanvasEngine,
  type Entity,
  heldEntity,
  makeDefaultMayDiverge,
  Position,
  PrefabId,
  Size,
  selectedEntities,
} from "@vibecook/ice";
import {
  type DeskLayerHandle,
  objectKindOf,
  rectFrame,
  rectOf,
  type SelectionAnchor,
} from "@vibecook/ice/desk";
import type { MatLight } from "@vibecook/ice/desk/kit";
import { deskTheme } from "@vibecook/ice/desk/objects";
import { currentDesk, type MountedDesk, subscribeDesk } from "../desk-door";
import { type AtWorkExtent, atWorkCarriedOf, atWorkHeldFrame, atWorkPoseOf } from "./at-work-hand";
import type { AtWorkLayer, AtWorkPlaced } from "./at-work-layer";
import { type AtWorkCamera, type ScreenFrame, screenFrameOf } from "./at-work-model";
import {
  AT_WORK_NO_PENCIL,
  AT_WORK_PENCIL,
  type AtWorkPencil,
  atWorkPencilOf,
  atWorkPencilOfUnion,
} from "./at-work-shader";
import { type AtWorkStore, atWorkStore } from "./at-work-store";

// THE AT-WORK MARK, placed (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat", "Where"). Each frame the desk
// steps, this reflector turns every marked object's key into its silhouette ON SCREEN and hands the layer the lot
// (`at-work-layer.ts`), which draws them in the same pass. So the marks are exact to the camera and to the object as
// the desk drew it — its lift, its hover, its tilt and its corner.
//
// THE ORDER. ICE's `<Desk>` registers its compose reflector (`always: true`) in its own effect, and reflectors flush in
// registration order. A `<Desk>` child's effect runs BEFORE its parent's, so a reflector registered there (the peers'
// pattern) flushes before the compose and reads the previous frame's geometry. This one is registered from
// `subscribeDesk` instead: `publishDesk` runs inside the stage's `onReady`, after ICE has registered the compose, so it
// flushes after it in the same pass — and it is registered again on every publish (every remount).
//
// ALWAYS, WHILE MARKS STAND. An object's drawn frame moves with the builder's springs (lift, hover, fade), which no
// column reports, so the reflector flushes on every frame the desk steps (`always: true`) — but only while a mark is on
// the board or still leaving; with none it is not registered at all. It adds no flush of its own: a reflector flushes
// only on frames the engine steps (M5). A change of the board while the desk sleeps is placed at once, outside a step,
// rather than waking the desk (the camera has not moved, so the last drawn frames stand). While the layer stands hidden
// (the desk not drawing, a cover, the board out) nothing is placed at all; the verdict lifting places it at once.
//
// PER OBJECT: key → entity as the applier resolves it (`store.resolve`, alive, in the canvas shown); its type's kind
// (`objectKindOf(ce.catalog.widget(type))`); its frame `kind.frame(geometryOf(e))` when both exist, else
// `rectFrame(rectOf(pos, size))` (a missing kind: the marks go round its rect); then ICE's `frameOnScreen` through the
// camera, which ICE 0.17.0 does not export — ported (`screenFrameOf`). The object IN HAND follows the hand's pose
// (`heldPose`, or the hand build's own frame while it flies home): its kind's silhouette carried by the pose, never
// the open extent the pose publishes (2026-11-24, `atWorkHeldFrame`); while anything is in hand every other object's
// marks fade with the out-of-focus desk, and the silhouette of the object the hand draws, marked or not, through the
// pickup and the put-back, is the scene's `hand`: it covers the marks behind it (DESIGN.md §8 When not; the layer masks
// them out of it). The selection
// anchor goes with them, for the pencil's band the overlay keeps off (DESIGN.md §7: the mark never covers the
// pencil): a sole selection's brackets round its object's own frame, several's union its box.

export { screenFrameOf } from "./at-work-model";

/** Item 550 (2026-11-18): the pencil's clocks (ICE 0.17.0's `MARKS.clocks`, which ICE does not export): a sole
 * selection's brackets lock on over `lockOnMs` from `AT_WORK_PENCIL.arrive` further out; several's union arrives over
 * `unionMs`. */
export const AT_WORK_PLACE = {
  lockOnMs: 180,
  unionMs: 220,
} as const;

/** What placement reads of the desk, one door per fact, so a test stands one in. */
export interface AtWorkDeskReads {
  /** the object's entity: alive, and in the canvas shown (core's `Active`), else undefined */
  resolve(key: string): Entity | undefined;
  /** its silhouette as the desk drew it, world units: its kind's frame, else its rect; null without a rect */
  worldFrame(e: Entity): ScreenFrame | null;
  /** where the hand draws it while it is in hand, CSS px, or null */
  heldFrame(e: Entity, world: ScreenFrame): ScreenFrame | null;
  /** the person's hand is on it: in hand, or a gesture's divergence (a drag, a fly-back, a note being written) */
  handOn(e: Entity): boolean;
  /** the object in hand, if any (the fact: it goes the moment the put-down starts) */
  inHand(): Entity | undefined;
  /** the object the hand draws: in hand, or still flying home after the put-down (2026-11-24) */
  carried(): Entity | undefined;
  /** the objects selected now (a sole one's brackets go round its own frame) */
  selection(): readonly Entity[];
  /** the desk's own fade of it (a delete's ghost), 0–1 */
  fade(e: Entity): number;
  camera(): AtWorkCamera;
}

/** Every key's placement this frame, in the order given (the board's, then the marks still leaving). PURE but for
 * `reads`. */
export function placeAtWork(keys: Iterable<string>, reads: AtWorkDeskReads): AtWorkPlaced[] {
  const camera = reads.camera();
  // the desk dims behind the fact; the hand's place and its cover follow the object it draws, home included
  const inHand = reads.inHand();
  const carried = reads.carried();
  const out: AtWorkPlaced[] = [];
  for (const key of keys) {
    const e = reads.resolve(key);
    if (e === undefined) continue;
    const frame = atWorkScreenFrame(e, reads, camera, carried);
    if (frame === null) continue;
    out.push({
      key,
      frame,
      heldByYou: reads.handOn(e),
      fade: Math.min(Math.max(reads.fade(e), 0), 1),
      dimmed: inHand !== undefined && e !== inHand,
      held: carried !== undefined && e === carried,
    });
  }
  return out;
}

/** Item 550 (2026-11-24): the silhouette of the object the hand draws on screen, marked or not — the cover of every
 * other object's marks through the pickup and the put-back (DESIGN.md §8 When not) — or null with nothing in hand or
 * flying home. PURE but for `reads`. */
export function atWorkHandFrame(reads: AtWorkDeskReads): ScreenFrame | null {
  const held = reads.carried();
  if (held === undefined) return null;
  return atWorkScreenFrame(held, reads, reads.camera(), held);
}

/** One object's silhouette on screen: at the hand's pose while it is in hand, else through the camera. PURE but for
 * `reads`. */
export function atWorkScreenFrame(
  e: Entity,
  reads: AtWorkDeskReads,
  camera: AtWorkCamera,
  held: Entity | undefined,
): ScreenFrame | null {
  const world = reads.worldFrame(e);
  if (world === null) return null;
  const pose = held !== undefined && e === held ? reads.heldFrame(e, world) : null;
  return pose ?? screenFrameOf(world, camera);
}

/** The part of ICE's `ObjectKind` placement reads: the silhouette its marks go round. */
export interface AtWorkFramedKind {
  frame?(geometry: never): ScreenFrame;
}

/** An object's silhouette in world units: `kind.frame` over the geometry the desk drew, when both exist, else the rect
 * square to the mat. PURE but for its arguments. */
export function atWorkWorldFrame(
  kind: AtWorkFramedKind | undefined,
  geometry: unknown,
  pos: { readonly x: number; readonly y: number } | undefined,
  size: { readonly w: number; readonly h: number } | undefined,
): ScreenFrame | null {
  if (kind?.frame !== undefined && geometry !== undefined) return kind.frame(geometry as never);
  if (pos === undefined || size === undefined) return null;
  return rectFrame(rectOf(pos, size));
}

/** Where the overlay keeps off the pencil this frame: a sole selection's brackets round its own frame (`sole`, on
 * screen), several's union round the anchor's box, standing further out while they arrive; `arrivedAt` is when this
 * selection began. ICE tells a host no lock-on's progress, so while one runs the band is kept the whole arrival wide
 * (`arrive × √2`, for a turned box's corners), then the rest band alone. A sole selection whose object placement
 * cannot frame is kept off along its box. PURE. */
export function atWorkPencilFor(
  anchor: SelectionAnchor | null,
  sole: ScreenFrame | null,
  arrivedAt: number,
  now: number,
): AtWorkPencil {
  const box = anchor?.box ?? null;
  if (anchor === null || box === null) return AT_WORK_NO_PENCIL;
  const several = anchor.count > 1;
  const arriving = now - arrivedAt < (several ? AT_WORK_PLACE.unionMs : AT_WORK_PLACE.lockOnMs);
  const travel = arriving ? AT_WORK_PENCIL.arrive * Math.SQRT2 : 0;
  if (!several && sole !== null) return atWorkPencilOf(sole, travel);
  const union = atWorkPencilOfUnion(box);
  return { box: union.box, turn: [union.turn[0], union.turn[1], union.turn[2], travel] };
}

/** A selection's identity for its arrival: which objects, and how many the anchor counts. Selecting another object —
 * one for one — is a new lock-on, as a new count or a box from none is. PURE. */
export function atWorkSelectionKey(
  anchor: SelectionAnchor | null,
  selection: readonly Entity[],
): string {
  if (anchor === null || anchor.box === null) return "";
  const ids = [...selection].sort((a, b) => a - b);
  return `${anchor.count}:${ids.join(",")}`;
}

/** The mat's light for a theme (ICE's `matLight`: its night, 0 by day … 1 by night, and its night model), read once
 * per theme. */
const lights = new Map<string, MatLight>();
function lightOf(theme: MountedDesk["theme"]): MatLight {
  const known = lights.get(theme);
  if (known !== undefined) return known;
  const light = deskTheme(theme).matLight;
  lights.set(theme, light);
  return light;
}

/** The desk's own reads for placement, over one mounted desk. */
export function deskReadsOf(desk: MountedDesk): AtWorkDeskReads {
  const ce: CanvasEngine = desk.engine;
  const { world } = ce;
  const handle = desk.handle as Partial<DeskLayerHandle>;
  const mayDiverge = divergeOf(ce);
  return {
    resolve(key) {
      const e = ce.docs.current()?.store.resolve(key as never) as Entity | undefined;
      return e !== undefined && world.isAlive(e) && world.hasTag(e, Active) ? e : undefined;
    },
    worldFrame(e) {
      const type = world.get(e, PrefabId)?.id;
      const kind = typeof type === "string" ? objectKindOf(ce.catalog.widget(type)) : undefined;
      return atWorkWorldFrame(
        kind,
        handle.geometryOf?.(e),
        world.get(e, Position),
        world.get(e, Size),
      );
    },
    heldFrame(e, w) {
      // the hand's pose is its OPEN EXTENT on screen; the marks go round the kind's silhouette, carried by that pose
      // (2026-11-24, DESIGN.md §8 Where): a pane's extent leaves out its border. While it flies home the pose seam
      // answers none, so the hand build's own frame is read, landing included
      const pose = atWorkPoseOf(e, handle.hand?.(), () => ce.stack.heldPose.current?.frame(e));
      if (pose === undefined) return null;
      const pos = world.get(e, Position);
      const size = world.get(e, Size);
      const rect = pos === undefined || size === undefined ? null : rectOf(pos, size);
      return atWorkHeldFrame(pose, w, rect, rect === null ? null : openExtentOf(ce, e, rect));
    },
    handOn: (e) => heldEntity(world) === e || mayDiverge(e),
    inHand: () => heldEntity(world),
    carried: () => atWorkCarriedOf(handle.hand?.(), heldEntity(world)),
    selection: () => selectedEntities(world),
    fade: (e) => handle.fluxOf?.(e)?.fade ?? 1,
    camera() {
      const c = world.getResource(Camera);
      return { x: c?.x ?? 0, y: c?.y ?? 0, zoom: c?.zoom ?? 1 };
    },
  };
}

/** Item 550 (2026-11-24): an object's open extent as its kind declares it (ICE's `OpenBinding.extent`, over its rect and
 * its props read as ICE reads them: each of its widget type's groups), or null where it has none or the kind throws. */
function openExtentOf(
  ce: CanvasEngine,
  e: Entity,
  rect: ReturnType<typeof rectOf>,
): AtWorkExtent | null {
  const type = ce.world.get(e, PrefabId)?.id;
  if (typeof type !== "string") return null;
  const widget = ce.catalog.widget(type);
  const open = objectKindOf(widget)?.open;
  if (widget === undefined || open === undefined) return null;
  const props: Record<string, unknown> = {};
  for (const group of widget.groups) {
    const value = ce.world.get(e, group.component) as Record<string, unknown> | undefined;
    if (value !== undefined)
      for (const name of Object.keys(group.fields)) props[name] = value[name];
  }
  try {
    return open.extent({ rect, props });
  } catch {
    // a kind's strike is ICE's to tell; the marks keep the pose's own frame
    return null;
  }
}

/** One divergence check per engine (ICE's own, as the applier asks it). */
const diverges = new WeakMap<CanvasEngine, (e: Entity) => boolean>();
function divergeOf(ce: CanvasEngine): (e: Entity) => boolean {
  const known = diverges.get(ce);
  if (known !== undefined) return known;
  const made = makeDefaultMayDiverge(ce.world);
  diverges.set(ce, made);
  return made;
}

export interface AtWorkReflectorSeams {
  readonly layer: AtWorkLayer;
  readonly now: () => number;
  readonly store?: AtWorkStore;
  /** the desk mounted now, and told when it changes (the desk door's, a test's) */
  readonly current?: () => MountedDesk | null;
  readonly subscribe?: (fn: () => void) => () => void;
  /** the reads over a desk (the desk's own, a test's) */
  readonly readsOf?: (desk: MountedDesk) => AtWorkDeskReads;
  /** a task after this flush (the registry is mid-flush when a mark finishes leaving) */
  readonly later?: (fn: () => void) => void;
  /** the layer's verdict stands (the desk not drawing, a cover, the board out): nothing is placed while it does */
  readonly hidden?: () => boolean;
}

/** What the reflector did — the door's read. */
export interface AtWorkReflectorRecord {
  /** registered on the desk mounted now, `always: true` */
  readonly registered: boolean;
  readonly registrations: number;
  readonly flushes: number;
  /** placements made outside a step: a board change while the desk slept, a verdict lifted */
  readonly direct: number;
  readonly placed: number;
}

export interface AtWorkReflector {
  /** Follow the mounted desk and the store. Returns the undo. */
  attach(): () => void;
  /** Place at once, outside a step: the layer's verdict lifted, so it draws the desk as it stands now. */
  refresh(): void;
  record(): AtWorkReflectorRecord;
}

/** The reflector's name on the engine (telemetry, faults). */
export const AT_WORK_REFLECTOR = "vibefield.at-work";

export function createAtWorkReflector(seams: AtWorkReflectorSeams): AtWorkReflector {
  const store = seams.store ?? atWorkStore;
  const current = seams.current ?? currentDesk;
  const subscribe = seams.subscribe ?? subscribeDesk;
  const readsOf = seams.readsOf ?? deskReadsOf;
  const later = seams.later ?? ((fn: () => void) => queueMicrotask(fn));
  const hidden = seams.hidden ?? (() => false);
  const { layer } = seams;
  let on: MountedDesk | null = null;
  let off: (() => void) | null = null;
  let reads: AtWorkDeskReads | null = null;
  let selection = "";
  let arrivedAt = Number.NEGATIVE_INFINITY;
  const counts = { registrations: 0, flushes: 0, direct: 0, placed: 0 };

  /** Place every marked object of `desk` now and hand the layer the frame. */
  const place = (desk: MountedDesk): void => {
    const docId = desk.docId;
    if (docId === undefined) return;
    const board = store.current(docId);
    reads ??= readsOf(desk);
    const keys = new Set<string>(board.objects.keys());
    for (const key of layer.drawing()) keys.add(key);
    const placed = placeAtWork(keys, reads);
    counts.placed += placed.length;
    const anchor = (desk.handle as Partial<DeskLayerHandle>).selection?.anchor() ?? null;
    const now = seams.now();
    const chosen = anchor === null ? [] : reads.selection();
    const said = atWorkSelectionKey(anchor, chosen);
    if (said !== selection) {
      selection = said;
      arrivedAt = now;
    }
    const camera = reads.camera();
    const one =
      anchor !== null && anchor.count === 1 && chosen.length === 1 ? chosen[0] : undefined;
    const sole = one === undefined ? null : atWorkScreenFrame(one, reads, camera, reads.carried());
    layer.show({
      board,
      placed,
      hand: atWorkHandFrame(reads),
      zoom: camera.zoom,
      view: anchor?.view ?? null,
      light: lightOf(desk.theme),
      pencil: atWorkPencilFor(anchor, sole, arrivedAt, now),
      theme: desk.theme,
    });
  };

  /** Registered on the mounted desk while a mark stands on its board (or still leaves), else not at all. */
  const sync = (): void => {
    const desk = current();
    const docId = desk?.docId;
    const want =
      desk !== null &&
      docId !== undefined &&
      (store.current(docId).objects.size > 0 || layer.busy());
    if (!want || desk === null) {
      const had = on !== null;
      off?.();
      off = null;
      on = null;
      reads = null;
      // the desk went: what the layer drew goes with it, at once
      if (desk === null && (had || layer.busy())) layer.drop();
      return;
    }
    if (on === desk && off !== null) return;
    off?.();
    on = desk;
    reads = null;
    counts.registrations += 1;
    off = desk.engine.engine.registerReflector({
      name: AT_WORK_REFLECTOR,
      always: true,
      flush: () => {
        counts.flushes += 1;
        // hidden, nothing is drawn: no placement either
        if (!hidden()) place(desk);
        // the last mark has left: unregistered after this pass, never inside the registry's own walk
        const left = desk.docId === undefined || store.current(desk.docId).objects.size === 0;
        if (left && !layer.busy()) later(sync);
      },
    });
  };

  /** Place `on` now, outside a step, when the layer can draw it. */
  const placeDirect = (): void => {
    const desk = on;
    if (desk === null || hidden()) return;
    counts.direct += 1;
    place(desk);
  };

  /** The board moved: registered (or not), and placed at once while the desk sleeps (no wake: M5). */
  const onBoard = (): void => {
    sync();
    if (on?.engine.engine.frame.sleepStats().asleep) placeDirect();
  };

  return {
    attach() {
      const offDesk = subscribe(() => {
        // every publish: the new mount's compose reflector is registered by now, so ours goes again, after it
        off?.();
        off = null;
        selection = "";
        sync();
      });
      const offStore = store.subscribe(onBoard);
      sync();
      return () => {
        offDesk();
        offStore();
        off?.();
        off = null;
        on = null;
        reads = null;
      };
    },
    refresh: placeDirect,
    record: () => ({
      registered: off !== null,
      registrations: counts.registrations,
      flushes: counts.flushes,
      direct: counts.direct,
      placed: counts.placed,
    }),
  };
}
