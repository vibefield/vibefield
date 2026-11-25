import {
  Active,
  BoardRoot,
  Camera,
  type CanvasEngine,
  ChildOf,
  currentNavFrame,
  defineQuery,
  type Entity,
  guardedTransaction,
  heldEntity,
  makeDefaultMayDiverge,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
  setWidgetProps,
  Viewport,
} from "@vibecook/ice";
import { inkTypingOn } from "@vibecook/ice/desk/kit";
import {
  AGENT_PLACEABLE_LIVE,
  DeskInverse,
  deskKind,
  type IntentListValue,
  type IntentOpenValue,
  type IntentPlaceValue,
  OBJECT_LIMITS,
  type ObjectFact,
  ObjectIntent,
  type ObjectIntentAnswer,
  ObjectsPresenceSnapshot,
  PAGES_PANE_ADDRESS_PROP,
  simulatorBindingOf,
} from "@vibefield/contracts";
import { type FielddClient, reaskDelayMs, refusedForRoom } from "@vibefield/fieldd-client";
import {
  type AgentHalf,
  agentActStillHolds,
  agentReadApi,
  isAgentToolRefusal,
  recordAgentAct,
} from "@vibefield/plugin-sdk/desk";
import { getActiveView } from "../../../frame/view-state";
import { getRendererLogger } from "../../../logging";
import { typeDefinition } from "../../../plugin-host/build-widget";
import { askAgain } from "../../../reconnect";
import { agentHalfOf } from "../agent-kinds";
import { atWorkStore } from "../at-work/at-work-store";
import { currentDesk, type MountedDesk, plainWords, subscribeDesk } from "../desk-door";
import { publishPresence } from "./presence-store";

// THE WINDOW'S APPLIER (OB-3c; thinking-objects-at-work.md §5.5, CP-D13, OB-L4, OB-L5). fieldd records an intent and this
// window, which alone knows a board's meaning and where the person's hand is, carries it out: one window, the desk it has
// mounted, one intent at a time and every one answered. Reads run a kind's handler over a read API with nothing to write
// with. Acts run over a recording API and commit as ONE transaction `{ undoable: false, meta: { run, intent } }`, so ⌘Z
// skips an agent's change (OB-D11 A) and the answer carries its inverse for fieldd to keep.
//
// PROVENANCE. An act, a remove, and the undo of an act or a place commit with `meta: { run, intent }`. A place and a remove's
// undo go through ICE's `ops.spawnWidget`, which takes `undoable` and drops `meta`, so those two commits carry none in the
// document. They are still `undoable: false`, and fieldd's audit and undo shelf name the run.
//
// THE COVER. Other views freeze the desk (`cover-still.ts`): the loop parks, and with it the frame's `world.sync()`. A
// value write lands in the world at once, so an act on an existing object needs nothing here. A spawn does not: strata
// mints its handle and writes the document at the commit, but the object's structure reaches the world only at a sync, so
// it could not be read, written or removed. `place` and a remove's undo therefore call `world.sync()` once themselves. That
// is the frame's first step alone, no systems and no draw, so a parked desk still costs no frames; strata's guards hold,
// because an intent arrives on a socket message, outside any step or observer. The object is real at once; its first draw
// waits for the desk to come back, and the answer says so (`onScreen: false`).

const log = () => getRendererLogger().child({ component: "desk.agent" });

/** The space, in world units, between a mat and an object placed beside it. */
const PLACE_GAP = 24;

const objects = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

/** What the window's half of the door needs. A feed's `onEnded`: the client ended it for good (a replay refused). */
export interface DeskAgentDoor {
  intents(
    docId: string,
    onIntent: (payload: unknown) => void,
    onEnded?: (error: unknown) => void,
  ): Promise<() => void>;
  answer(answer: ObjectIntentAnswer): Promise<unknown>;
  /** The objects agents are at work on, whole, on every change. */
  presence(
    onSnapshot: (payload: unknown) => void,
    onEnded?: (error: unknown) => void,
  ): Promise<() => void>;
  held(params: {
    readonly docId: string;
    readonly key: string;
    readonly held: boolean;
  }): Promise<unknown>;
  /** Item 550 (2026-11-18): whether the client is ready, told at each change of its status (absent: never told) */
  ready?(onChange: (ready: boolean) => void): () => void;
}

/** What the door reads of the client: its two calls, and its status where it says one (item 550, 2026-11-18). */
type DoorClient = Pick<FielddClient, "request" | "subscribe"> &
  Partial<Pick<FielddClient, "status" | "onStatusChange">>;

/** The door's `ready`, where the client says its status: ready, or not (connecting, reconnecting, closed, failed). */
function readyOver(client: DoorClient): Pick<DeskAgentDoor, "ready"> {
  const listen = client.onStatusChange?.bind(client);
  if (listen === undefined) return {};
  return { ready: (onChange) => listen(() => onChange(client.status === "ready")) };
}

export function deskAgentDoorOver(client: DoorClient): DeskAgentDoor {
  const stream = async (
    method: string,
    params: unknown,
    onEvent: (payload: unknown) => void,
    onEnded?: (error: unknown) => void,
  ): Promise<() => void> => {
    const subscription = await client.subscribe(
      method,
      params,
      (payload, kind) => {
        if (kind !== "snapshot") onEvent(payload);
      },
      onEnded === undefined ? undefined : { onEnded },
    );
    return () => subscription.unsubscribe();
  };
  return {
    intents: (docId, onIntent, onEnded) =>
      stream("objects.intents.subscribe", { docId }, onIntent, onEnded),
    answer: (answer) => client.request("objects.intent.answer", answer),
    presence: async (onSnapshot, onEnded) => {
      // whole values: one that arrives before the first answer must not be overwritten by it
      let ready = false;
      const early: unknown[] = [];
      const subscription = await client.subscribe(
        "objects.presence.subscribe",
        {},
        (payload) => {
          if (ready) onSnapshot(payload);
          else early.push(payload);
        },
        onEnded === undefined ? undefined : { onEnded },
      );
      onSnapshot(subscription.snapshot);
      ready = true;
      for (const payload of early) onSnapshot(payload);
      return () => subscription.unsubscribe();
    },
    held: (params) => client.request("objects.held", params),
    ...readyOver(client),
  };
}

export interface ApplierDeps {
  /** a kind's handlers (undefined: the built-ins' and the plugins') */
  readonly halves?: (type: string) => AgentHalf | undefined;
  /** the person's hand on an object (undefined: the desk's own answer) */
  readonly handOn?: (e: Entity) => boolean;
  /** whether Canvas is the view (undefined: the window's) */
  readonly onCanvas?: () => boolean;
  /** the clock an intent's deadline is read against (undefined: the window's) */
  readonly now?: () => number;
}

type Fact = ObjectFact | "bad-input" | "failed";

const WORDS = {
  gone: "That object is no longer on the desk.",
  held: "The user is holding that object. Try again later.",
  conflict: "That object has changed since. It was left as it is.",
  noTool: (tool: string): string => `This object has no tool called ${tool}.`,
  readOnly: "This board is read-only in this window.",
  noPrint: "A print is made from a picture. The user has to place it.",
  holds: "That object holds things the user put there. The user has to remove it.",
  noContainer: "What that object lay in is no longer on the desk, so it was not put back.",
  late: "That request came too late, so nothing was changed.",
  noTitle: (name: string): string =>
    `A ${name} has no title. Leave out \`title\`, and put what it should say in \`props\`.`,
  twoTitles: (prop: string): string =>
    `\`title\` and \`props.${prop}\` name it differently. Give one.`,
  off: (label: string): string => `The desk cannot draw this kind right now (${label}).`,
  tooBig: "That answer is larger than an agent can be told.",
  summaryTooBig: "This object's summary is too large to show here. Use its read tools.",
  notOwnDevice:
    "An iOS Simulator you place shows a device of its own, never one of the user's. Leave out its binding, or give it `dedicated: true`.",
  // EY-1 (1f, 2026-11-19): the agent's words for a full desk (the room's own, as the pages tools say them)
  deskFull:
    "The desk has no room for another live page right now. Close a page you no longer need, or carry on in this one.",
  noLive: "This window cannot show live pages right now.",
  roomPlaces: (name: string, room: string): string =>
    `${name} is placed by the ${room} room's own tools, with the page they open, never with canvas_place.`,
} as const;

const refused = (intent: ObjectIntent, fact: Fact, text: string): ObjectIntentAnswer => ({
  intent: intent.intent,
  ok: false,
  fact,
  text: text || "The desk could not do that.",
});

const answered = (
  intent: ObjectIntent,
  value: unknown,
  extra: { readonly inverse?: DeskInverse; readonly changed?: string | undefined } = {},
): ObjectIntentAnswer => ({
  intent: intent.intent,
  ok: true,
  value,
  ...(extra.inverse === undefined ? {} : { inverse: extra.inverse }),
  ...(extra.changed === undefined ? {} : { changed: extra.changed }),
});

const bytesOf = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;

const metaOf = (intent: ObjectIntent) => ({ run: intent.run, intent: intent.intent });

/** An object's durable props as its manifest declares them: a `json` prop is parsed, as `setWidgetProps` takes it. */
export function declaredProps(engine: CanvasEngine, e: Entity): Record<string, unknown> {
  const type = engine.world.get(e, PrefabId)?.id;
  const widget = typeof type === "string" ? engine.catalog.widget(type) : undefined;
  const props: Record<string, unknown> = {};
  for (const group of widget?.groups ?? []) {
    const cell = engine.world.get(e, group.component) as Record<string, unknown> | undefined;
    for (const [name, field] of Object.entries(group.fields)) {
      const value = cell?.[name];
      props[name] = field.kind === "json" && typeof value === "string" ? JSON.parse(value) : value;
    }
  }
  return props;
}

function isOnScreen(engine: CanvasEngine, e: Entity, onCanvas: () => boolean): boolean {
  // in a frame the person is not in (a mat they are not inside, the board while they are): not on the screen
  if (!onCanvas() || !engine.world.hasTag(e, Active)) return false;
  const at = engine.world.get(e, Position);
  const size = engine.world.get(e, Size);
  const camera = engine.world.getResource(Camera);
  const view = engine.world.getResource(Viewport);
  if (at === undefined || size === undefined || camera === undefined || view === undefined)
    return false;
  const right = camera.x + view.w / camera.zoom;
  const bottom = camera.y + view.h / camera.zoom;
  return at.x + size.w > camera.x && at.x < right && at.y + size.h > camera.y && at.y < bottom;
}

/** L8 (2026-11-24): how far from its first spot, in its own sizes, a free place is looked for; and the most of the board's
 * objects near that spot whose edges make the places looked at (the nearest first). Bounds on the search, not looks. */
const FREE_REACH = 4;
const FREE_EDGES_MAX = 64;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The objects lying on the board itself (never inside a mat, never a pegboard's specimen), as rects in the world. */
function boardRects(engine: CanvasEngine): Rect[] {
  const { world } = engine;
  const board = world.getResource(BoardRoot)?.root;
  const rects: Rect[] = [];
  world.query(objects).each((batch) => {
    for (const row of batch) {
      const e = batch.entity(row);
      if (board !== undefined && world.getRelation(e, ChildOf) !== board) continue;
      const at = world.get(e, Position);
      const size = world.get(e, Size);
      if (at === undefined || size === undefined) continue;
      rects.push({ x: at.x, y: at.y, w: size.w, h: size.h });
    }
  });
  return rects;
}

/**
 * L8 (2026-11-24; DESIGN.md §8, "where an agent's object lands") — THE FREE PLACE nearest `start` for an object of `size`:
 * over no object on the board, PLACE_GAP clear of each. The places looked at are `start` and those that put the object
 * one gap beside an edge of a nearby object, on either axis; the free one nearest `start` wins. Undefined: none within
 * FREE_REACH of its own sizes.
 */
function freeSpot(
  rects: readonly Rect[],
  start: { readonly x: number; readonly y: number },
  size: { readonly w: number; readonly h: number },
): { x: number; y: number } | undefined {
  const clear = (x: number, y: number): boolean =>
    rects.every(
      (r) =>
        x >= r.x + r.w + PLACE_GAP ||
        r.x >= x + size.w + PLACE_GAP ||
        y >= r.y + r.h + PLACE_GAP ||
        r.y >= y + size.h + PLACE_GAP,
    );
  if (clear(start.x, start.y)) return start;
  const reachX = FREE_REACH * size.w;
  const reachY = FREE_REACH * size.h;
  const cx = start.x + size.w / 2;
  const cy = start.y + size.h / 2;
  const near = rects
    .filter(
      (r) =>
        r.x + r.w >= start.x - reachX &&
        r.x <= start.x + size.w + reachX &&
        r.y + r.h >= start.y - reachY &&
        r.y <= start.y + size.h + reachY,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) -
        Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy),
    )
    .slice(0, FREE_EDGES_MAX);
  const xs = [start.x];
  const ys = [start.y];
  for (const r of near) {
    xs.push(r.x + r.w + PLACE_GAP, r.x - PLACE_GAP - size.w, r.x);
    ys.push(r.y + r.h + PLACE_GAP, r.y - PLACE_GAP - size.h, r.y);
  }
  let best: { x: number; y: number; d: number } | undefined;
  for (const x of xs) {
    if (Math.abs(x - start.x) > reachX) continue;
    for (const y of ys) {
      if (Math.abs(y - start.y) > reachY) continue;
      const d = Math.hypot(x - start.x, y - start.y);
      if (best !== undefined && d >= best.d) continue;
      if (clear(x, y)) best = { x, y, d };
    }
  }
  return best === undefined ? undefined : { x: best.x, y: best.y };
}

/** Where an object an agent places lands on the board: the middle of the view, or, while the person is inside a mat (whose
 * camera says nothing of the board), beside the object on the board they went in through. L8 (2026-11-24): in the free
 * place nearest there, over no object already on the board (`freeSpot`). Where none is near, it lands there as before,
 * a little down and across from the last, so a run placing several does not stack them exactly. */
function spotFor(
  engine: CanvasEngine,
  size: { readonly w: number; readonly h: number },
  nth: number,
): { x: number; y: number } {
  const { world } = engine;
  const cascade = (nth % 8) * 24;
  const frame = currentNavFrame(world);
  let start: { x: number; y: number };
  if (frame !== undefined) {
    const board = world.getResource(BoardRoot)?.root;
    let top = frame;
    for (
      let up = world.getRelation(top, ChildOf);
      up !== undefined && up !== board;
      up = world.getRelation(top, ChildOf)
    )
      top = up;
    const at = world.get(top, Position);
    const across = world.get(top, Size);
    start = { x: (at?.x ?? 0) + (across?.w ?? 0) + PLACE_GAP, y: at?.y ?? 0 };
  } else {
    const camera = world.getResource(Camera);
    const view = world.getResource(Viewport);
    const zoom = camera?.zoom ?? 1;
    start = {
      x: (camera?.x ?? 0) + ((view?.w ?? 0) / zoom - size.w) / 2,
      y: (camera?.y ?? 0) + ((view?.h ?? 0) / zoom - size.h) / 2,
    };
  }
  return (
    freeSpot(boardRects(engine), start, size) ?? {
      x: start.x + cascade,
      y: start.y + cascade,
    }
  );
}

export interface DeskApplier {
  apply(intent: ObjectIntent): ObjectIntentAnswer;
  handOn(e: Entity): boolean;
}

/** The applier over one mounted desk. Every intent is answered synchronously and never throws. */
export function createDeskApplier(desk: MountedDesk, deps: ApplierDeps = {}): DeskApplier {
  const { engine } = desk;
  const { world } = engine;
  const halves = deps.halves ?? agentHalfOf;
  const mayDiverge = makeDefaultMayDiverge(world);
  const handOn = deps.handOn ?? ((e: Entity) => heldEntity(world) === e || mayDiverge(e));
  const words = desk.words ?? plainWords;
  const onCanvas = deps.onCanvas ?? (() => getActiveView() === "canvas");
  const now = deps.now ?? Date.now;
  let placed = 0;

  const typeOf = (e: Entity): string | undefined => {
    const id = world.get(e, PrefabId)?.id;
    return typeof id === "string" ? id : undefined;
  };

  const resolve = (key: string): Entity | undefined => {
    const e = engine.docs.current()?.store.resolve(key as never) as Entity | undefined;
    return e !== undefined && world.isAlive(e) ? e : undefined;
  };

  const summaryOf = (type: string, e: Entity): unknown => {
    const half = halves(type);
    if (half === undefined) return null;
    const now = half.summary(agentReadApi(declaredProps(engine, e)));
    return bytesOf(now) > OBJECT_LIMITS.NOW_BYTES ? { note: WORDS.summaryTooBig } : now;
  };

  const opened = (type: string, e: Entity): IntentOpenValue => ({
    kind: type,
    title: words(type).title,
    now: summaryOf(type, e),
    heldByUser: handOn(e),
    onScreen: isOnScreen(engine, e, onCanvas),
  });

  const list = (intent: ObjectIntent): ObjectIntentAnswer => {
    const store = engine.docs.current()?.store;
    const rows: IntentListValue["objects"][number][] = [];
    let truncated = false;
    world.query(objects).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        const type = typeOf(e);
        const key = store?.keyOf(e) as string | undefined;
        if (type === undefined || key === undefined || engine.catalog.retiredWidget(type)) continue;
        if (rows.length >= OBJECT_LIMITS.LIST_OBJECTS) {
          truncated = true;
          continue;
        }
        const at = world.get(e, Position);
        const size = world.get(e, Size);
        rows.push({
          key,
          kind: type,
          // the kind's name, never the words on it: the contents of an object that is not yours stay closed
          title: words(type).title,
          // the place of one on the board itself; one inside a mini mat has none on the desk
          ...(at !== undefined && size !== undefined && world.hasTag(e, Active)
            ? { place: { x: at.x, y: at.y, width: size.w, height: size.h } }
            : {}),
        });
      }
    });
    return answered(intent, { objects: rows, ...(truncated ? { truncated } : {}) });
  };

  /** Make it real now, covered or not: a spawn reaches the world only at a sync (the note at the head of this file). */
  const project = (e: Entity): void => {
    if (world.get(e, PrefabId) === undefined) world.sync();
  };

  const place = (intent: Extract<ObjectIntent, { op: "place" }>): ObjectIntentAnswer => {
    const session = engine.docs.current();
    const widget = engine.catalog.widget(intent.kind);
    if (session === undefined || session.readOnly)
      return refused(intent, "needs-you", WORDS.readOnly);
    if (widget === undefined || engine.catalog.retiredWidget(intent.kind) !== undefined)
      return refused(intent, "bad-input", `The desk has no kind called ${intent.kind}.`);
    const said = words(intent.kind);
    if (said.state !== null) return refused(intent, "needs-you", WORDS.off(said.label));
    if (deskKind(intent.kind)?.placeable === false)
      return refused(intent, "needs-you", WORDS.noPrint);
    // item 581 overturned (2026-11-24): an iOS Simulator an agent places shows a device of its own, never one of the
    // person's. fieldd's desk door holds its binding so; the window refuses one that would still bind the person's
    if (
      AGENT_PLACEABLE_LIVE["ios-simulator"].includes(intent.kind) &&
      simulatorBindingOf(intent.props?.["binding"]).device === "person"
    )
      return refused(intent, "bad-input", WORDS.notOwnDevice);
    // EY-1 (1f, 2026-11-24): a kind whose tools are a room's (R-2; the browser pane is the pages room's) is placed by that
    // room, with the page main made for the run (`made`), never by a bare place. So no door, today's or a later one, puts
    // a pane on the desk that would open in the person's own signed-in profile: its face mints into its run's session only
    const room = typeDefinition(intent.kind)?.agent?.room;
    if (room !== undefined && intent.made === undefined)
      return refused(intent, "no-tool", WORDS.roomPlaces(said.title, room));
    const props: Record<string, unknown> = { ...intent.props };
    if (intent.title !== undefined) {
      const titleProp = deskKind(intent.kind)?.titleProp;
      if (titleProp === undefined) return refused(intent, "bad-input", WORDS.noTitle(said.title));
      if (props[titleProp] !== undefined && props[titleProp] !== intent.title)
        return refused(intent, "bad-input", WORDS.twoTitles(titleProp));
      props[titleProp] = intent.title;
    }
    // EY-1 (1f, 2026-11-19) — A PAGE A RUN MADE (`made`): placed only where the desk has room for one more agent's page
    // without resting one of the person's (item 581: `agentRoom`, the plan's own count). No room: nothing is placed and
    // main lets the page go at once; a window that shows no live pages places none (main's grace lets it go).
    const made = intent.made;
    const live = desk.live;
    // PI-1 (2026-11-24): a run's address never rides `url`, which a reader that does not know the run opens live in the
    // person's signed-in profile. On a made pane of a kind that declares the address prop, the address the room opened
    // (its own prop, else its `url`) is written there, `url` is left at the kind's default (no page), and a pane the room
    // placed with no address is at about:blank
    if (
      made !== undefined &&
      widget.groups.some((group) => PAGES_PANE_ADDRESS_PROP in group.fields)
    ) {
      const asked = props[PAGES_PANE_ADDRESS_PROP] ?? props["url"];
      delete props["url"];
      props[PAGES_PANE_ADDRESS_PROP] =
        typeof asked === "string" && asked !== "" ? asked : "about:blank";
    }
    if (made !== undefined) {
      if (live === undefined) return refused(intent, "failed", WORDS.noLive);
      if (live.agentRoom() < 1) {
        live.declineMade(made);
        return refused(intent, "desk-full", WORDS.deskFull);
      }
    }
    const size = widget.defaultSize;
    const spot = spotFor(engine, size, placed);
    // always the board: "on the user's desk", never inside a mat the person happens to be in
    const board = world.getResource(BoardRoot)?.root;
    let e: Entity;
    try {
      e = engine.ops.spawnWidget(intent.kind, {
        x: spot.x,
        y: spot.y,
        w: size.w,
        h: size.h,
        ...(board === undefined ? {} : { parent: board }),
        props,
        undoable: false,
      });
    } catch (cause) {
      if (made !== undefined) live?.declineMade(made);
      return refused(
        intent,
        "bad-input",
        cause instanceof Error ? cause.message : "The desk refused those props.",
      );
    }
    placed += 1;
    project(e);
    const key = session.store.keyOf(e) as string | undefined;
    if (key === undefined || typeOf(e) === undefined) {
      if (made !== undefined) live?.declineMade(made);
      return refused(intent, "failed", "The object did not reach the desk.");
    }
    // its face's first mint adopts the made page (its spawn opens the face later in this tick: the mint reads it then)
    if (made !== undefined) live?.adoptMade(key, made);
    const value: IntentPlaceValue = {
      key,
      ...opened(intent.kind, e),
      ...(intent.title === undefined ? {} : { title: intent.title }),
    };
    return answered(intent, value, {
      inverse: { op: "place", after: declaredProps(engine, e) },
      changed: `Placed a ${words(intent.kind).title}`,
    });
  };

  const remove = (
    intent: Extract<ObjectIntent, { op: "remove" }>,
    e: Entity,
  ): ObjectIntentAnswer => {
    const session = engine.docs.current();
    if (session === undefined || session.readOnly)
      return refused(intent, "needs-you", WORDS.readOnly);
    if (world.getReverse(e, ChildOf).length > 0) return refused(intent, "needs-you", WORDS.holds);
    const type = typeOf(e);
    const at = world.get(e, Position);
    const size = world.get(e, Size);
    if (type === undefined || at === undefined || size === undefined)
      return refused(intent, "gone", WORDS.gone);
    const container = world.getRelation(e, ChildOf);
    const parent =
      container === undefined ? undefined : (session.store.keyOf(container) as string | undefined);
    const inverse: DeskInverse = {
      op: "remove",
      type,
      ...(parent === undefined ? {} : { parent }),
      rect: { x: at.x, y: at.y, w: size.w, h: size.h },
      props: declaredProps(engine, e),
    };
    // A run's own close (2026-11-24): a pane a room placed for a run (the pages room's browser pane) leaves by the
    // host's one path where this mount has one (the live service's leaveMade). It waits out the pane's at-work mark
    // (DESIGN.md §8, "At work on the mat"), which fieldd releases as this answer reaches it, and never takes the pane
    // from under the person's hand. The answer says removed: fieldd closes the pane's page on it
    const key = session.store.keyOf(e) as string | undefined;
    if (
      key !== undefined &&
      typeDefinition(type)?.agent?.room !== undefined &&
      desk.live?.leaveMade?.(key) === true
    )
      return answered(
        intent,
        { removed: true },
        { inverse, changed: `Removed a ${words(type).title}` },
      );
    guardedTransaction(session.store, world, (tx) => tx.destroy(e), {
      undoable: false,
      meta: metaOf(intent),
    });
    world.sync();
    return answered(
      intent,
      { removed: true },
      {
        inverse,
        changed: `Removed a ${words(type).title}`,
      },
    );
  };

  /** IK (2026-11-25): the words a person is typing into an object are its typing's DRAFT, not yet its cell's. They land
   * first, as the person's own step (undone as theirs), so an act reads, and quotes, the words the person sees, and the
   * draft's later landing cannot write over the act. A kind with no written part has no typing to find. */
  const landDrafts = (type: string, e: Entity): void => {
    for (const group of engine.catalog.widget(type)?.groups ?? []) {
      const typing = inkTypingOn(world, e, group.name);
      if (typing?.open() === true) typing.commit();
    }
  };

  /** A handler run: its honest no (`AgentToolRefusal`) is the agent's bad input, in its words; any other throw is the
   * desk's failure (`apply`'s). */
  const run = <T>(
    intent: ObjectIntent,
    handler: () => T,
  ): { readonly said: T } | { readonly refusal: ObjectIntentAnswer } => {
    try {
      return { said: handler() };
    } catch (cause) {
      if (isAgentToolRefusal(cause))
        return { refusal: refused(intent, "bad-input", cause.message) };
      throw cause;
    }
  };

  const act = (intent: Extract<ObjectIntent, { op: "act" }>, e: Entity): ObjectIntentAnswer => {
    const type = typeOf(e);
    const handler = type === undefined ? undefined : halves(type)?.act?.[intent.tool];
    if (type === undefined || handler === undefined)
      return refused(intent, "no-tool", WORDS.noTool(intent.tool));
    const session = engine.docs.current();
    if (session === undefined || session.readOnly)
      return refused(intent, "needs-you", WORDS.readOnly);
    landDrafts(type, e);
    const recording = recordAgentAct(declaredProps(engine, e));
    const ran = run(intent, () => handler(recording.api, intent.input));
    if ("refusal" in ran) return ran.refusal;
    const result = ran.said;
    if (bytesOf(result?.value) > OBJECT_LIMITS.TOOL_BYTES)
      return refused(intent, "failed", WORDS.tooBig);
    const change = recording.inverse();
    if (change === undefined) return answered(intent, result?.value ?? null);
    setWidgetProps(session.store, world, e, change.after, {
      undoable: false,
      meta: metaOf(intent),
    });
    return answered(intent, result?.value ?? null, {
      inverse: { op: "props", ...change },
      changed: result?.changed ?? intent.doing,
    });
  };

  const read = (intent: Extract<ObjectIntent, { op: "read" }>, e: Entity): ObjectIntentAnswer => {
    const type = typeOf(e);
    const handler = type === undefined ? undefined : halves(type)?.read?.[intent.tool];
    if (handler === undefined) return refused(intent, "no-tool", WORDS.noTool(intent.tool));
    // a read writes nothing, so an open draft stays the person's: the read is of the words the board holds
    const ran = run(intent, () => handler(agentReadApi(declaredProps(engine, e)), intent.input));
    if ("refusal" in ran) return ran.refusal;
    const value = ran.said;
    if (bytesOf(value) > OBJECT_LIMITS.TOOL_BYTES) return refused(intent, "failed", WORDS.tooBig);
    return answered(intent, value ?? null);
  };

  const undo = (intent: Extract<ObjectIntent, { op: "undo" }>): ObjectIntentAnswer => {
    const parsed = DeskInverse.safeParse(intent.inverse);
    if (!parsed.success) return refused(intent, "conflict", WORDS.conflict);
    const inverse = parsed.data;
    const session = engine.docs.current();
    if (session === undefined || session.readOnly)
      return refused(intent, "needs-you", WORDS.readOnly);

    if (inverse.op === "remove") {
      // it goes back where it lay, never where the person happens to be looking
      const parent = inverse.parent === undefined ? undefined : resolve(inverse.parent);
      if (inverse.parent !== undefined && parent === undefined)
        return refused(intent, "conflict", WORDS.noContainer);
      // the object is gone; it comes back under a new key, and fieldd moves its ref there
      let e: Entity;
      try {
        e = engine.ops.spawnWidget(inverse.type, {
          x: inverse.rect.x,
          y: inverse.rect.y,
          w: inverse.rect.w,
          h: inverse.rect.h,
          ...(parent === undefined ? {} : { parent }),
          props: inverse.props,
          undoable: false,
        });
      } catch {
        return refused(intent, "gone", WORDS.gone);
      }
      project(e);
      const key = session.store.keyOf(e) as string | undefined;
      return key === undefined
        ? refused(intent, "failed", "The object did not reach the desk.")
        : answered(intent, { key });
    }

    const e = resolve(intent.key);
    if (e === undefined) return refused(intent, "gone", WORDS.gone);
    if (handOn(e)) return refused(intent, "held", WORDS.held);
    const props = declaredProps(engine, e);
    if (!agentActStillHolds(props, inverse)) return refused(intent, "conflict", WORDS.conflict);

    if (inverse.op === "place") {
      if (world.getReverse(e, ChildOf).length > 0)
        return refused(intent, "conflict", WORDS.conflict);
      guardedTransaction(session.store, world, (tx) => tx.destroy(e), {
        undoable: false,
        meta: metaOf(intent),
      });
      world.sync();
      return answered(intent, {});
    }
    setWidgetProps(session.store, world, e, inverse.before, {
      undoable: false,
      meta: metaOf(intent),
    });
    return answered(intent, {});
  };

  const dispatch = (intent: ObjectIntent): ObjectIntentAnswer => {
    if (intent.op === "list") return list(intent);
    if (intent.op === "place") return place(intent);
    if (intent.op === "undo") return undo(intent);
    const e = resolve(intent.key);
    if (e === undefined) return refused(intent, "gone", WORDS.gone);
    const type = typeOf(e);
    if (intent.op === "open")
      return type === undefined
        ? refused(intent, "gone", WORDS.gone)
        : answered(intent, opened(type, e));
    if (intent.op === "read") return read(intent, e);
    // your hand wins (OB-L5): an object in the person's hand is read as it stands, and changed by nobody else
    if (handOn(e)) return refused(intent, "held", WORDS.held);
    return intent.op === "act" ? act(intent, e) : remove(intent, e);
  };

  return {
    handOn,
    apply(intent) {
      // fieldd has stopped waiting: a change made now would land with no answer to carry its undo
      const deadline = intent["expiresAt"];
      if (typeof deadline === "number" && now() >= deadline)
        return refused(intent, "failed", WORDS.late);
      try {
        return dispatch(intent);
      } catch (cause) {
        log().error("renderer.desk.agent_intent_failed", "A desk intent failed", cause, {
          op: intent.op,
        });
        return refused(
          intent,
          "failed",
          cause instanceof Error ? cause.message : "The desk could not do that.",
        );
      }
    },
  };
}

const FEED_REFUSED = {
  door: "The desk's agent door did not open",
  presence: "The desk's presence feed did not open",
} as const;
const FEED_ENDED = {
  door: "The desk's agent door was ended for good",
  presence: "The desk's presence feed was ended for good",
} as const;

/** A refusal as the log keeps it: its kind, never its words. */
const kindOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as { kind?: unknown }).kind === "string"
    ? (error as { kind: string }).kind
    : error instanceof Error
      ? error.name
      : typeof error;

/** One mounted desk's door: its intents carried out and answered, and the hand reported onto objects agents have open. */
function startApplier(
  desk: MountedDesk,
  docId: string,
  door: DeskAgentDoor,
  deps: ApplierDeps,
): () => void {
  const applier = createDeskApplier(desk, deps);
  const { engine } = desk;
  let disposed = false;
  const offs: (() => void)[] = [];
  const keep = (off: () => void): void => {
    if (disposed) off();
    else offs.push(off);
  };
  // Item 521 (2026-11-18): a feed refused on its way is asked again while its desk stays mounted, so an open desk is
  // never "not open" to an agent for want of one more ask. A refusal as the socket closed under the ask (`askAgain`) or
  // for room (item 476) is asked again on the client's re-ask steps, and the ask waits for the client to be ready. One
  // refused for good, or ended by the client, stands, and the log says it by its kind, never in fieldd's words.
  const waits = new Set<ReturnType<typeof setTimeout>>();
  const feed = (
    name: "door" | "presence",
    open: (onEnded: (error: unknown) => void) => Promise<() => void>,
  ): void => {
    let step = 0;
    // item 550 (2026-11-18): while the presence feed is down nothing on the desk claims work
    const down = (): void => {
      if (name === "presence" && !disposed) atWorkStore.clear();
    };
    const ask = (): void => {
      if (disposed) return;
      void open((error) => {
        log().warn(`renderer.desk.agent_${name}_ended`, FEED_ENDED[name], { kind: kindOf(error) });
        down();
      }).then(
        (off) => {
          step = 0;
          keep(off);
        },
        (cause: unknown) => {
          const again = askAgain(cause) || refusedForRoom(cause);
          log().warn(`renderer.desk.agent_${name}_refused`, FEED_REFUSED[name], {
            kind: kindOf(cause),
            again,
          });
          down();
          if (!again || disposed) return;
          const wait = setTimeout(() => {
            waits.delete(wait);
            ask();
          }, reaskDelayMs(step));
          waits.add(wait);
          step += 1;
        },
      );
    };
    ask();
  };

  feed("door", (onEnded) =>
    door.intents(
      docId,
      (payload) => {
        const intent = ObjectIntent.safeParse(payload);
        if (!intent.success) {
          log().warn("renderer.desk.agent_intent_unread", "A desk intent could not be read");
          return;
        }
        void door.answer(applier.apply(intent.data)).catch((cause: unknown) => {
          log().warn("renderer.desk.agent_answer_failed", "A desk intent's answer was not taken", {
            cause: String(cause),
          });
        });
      },
      onEnded,
    ),
  );

  // the objects a run has open on this board, and which of those the person's hand is on; item 550 (2026-11-18): the
  // same feed publishes who is at work on them to the at-work store, cleared when it ends, is refused or stops
  let open: readonly string[] = [];
  const reported = new Set<string>();
  const say = (key: string, held: boolean): void => {
    void door.held({ docId, key, held }).catch((cause: unknown) => {
      log().warn("renderer.desk.agent_held_failed", "The hand on an object was not reported", {
        cause: String(cause),
      });
    });
  };
  const look = (): void => {
    const store = engine.docs.current()?.store;
    for (const key of open) {
      const e = store?.resolve(key as never) as Entity | undefined;
      const on = e !== undefined && engine.world.isAlive(e) && applier.handOn(e);
      if (on && !reported.has(key)) {
        reported.add(key);
        say(key, true);
      } else if (!on && reported.has(key)) {
        reported.delete(key);
        say(key, false);
      }
    }
  };
  let guest: (() => void) | null = null;
  feed("presence", (onEnded) =>
    door.presence((payload) => {
      const snapshot = ObjectsPresenceSnapshot.safeParse(payload);
      if (!snapshot.success) return;
      // OB-D16 — the window's copy, whole, for Godview's panes (this is the window's one subscription)
      publishPresence(snapshot.data.objects);
      open = snapshot.data.objects
        .filter((object) => object.docId === docId && object.agents.length > 0)
        .map((object) => object.key);
      for (const key of [...reported]) {
        if (open.includes(key)) continue;
        reported.delete(key);
        say(key, false);
      }
      if (disposed) return;
      atWorkStore.publish(docId, snapshot.data);
      if (open.length > 0 && guest === null)
        guest = engine.engine.guests.add({ id: "objects.held", make: () => look });
      else if (open.length === 0 && guest !== null) {
        guest();
        guest = null;
      }
    }, onEnded),
  );
  // a client that leaves ready holds no feed until its replay, so nothing on the desk claims work meanwhile
  const offReady = door.ready?.((ready) => {
    if (!ready && !disposed) atWorkStore.clear();
  });
  if (offReady !== undefined) keep(offReady);

  return () => {
    disposed = true;
    publishPresence([]);
    for (const wait of waits) clearTimeout(wait);
    waits.clear();
    guest?.();
    guest = null;
    for (const off of offs) off();
    offs.length = 0;
    atWorkStore.clear();
  };
}

/** The window's applier, following the desk mounted now (a new generation, a reload, another board). */
export function followDeskAgent(door: DeskAgentDoor, deps: ApplierDeps = {}): () => void {
  let live: { readonly desk: MountedDesk; readonly stop: () => void } | null = null;
  const follow = (): void => {
    const desk = currentDesk();
    const docId = desk?.docId;
    const mounted = docId === undefined ? null : desk;
    if (mounted === (live?.desk ?? null)) return;
    live?.stop();
    live =
      mounted === null || docId === undefined
        ? null
        : { desk: mounted, stop: startApplier(mounted, docId, door, deps) };
  };
  const off = subscribeDesk(follow);
  follow();
  return () => {
    off();
    live?.stop();
    live = null;
  };
}
