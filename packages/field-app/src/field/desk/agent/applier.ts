import {
  Active,
  Camera,
  type CanvasEngine,
  ChildOf,
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
import {
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
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import {
  type AgentHalf,
  agentActStillHolds,
  agentReadApi,
  recordAgentAct,
} from "@vibefield/plugin-sdk/desk";
import { getActiveView } from "../../../frame/view-state";
import { getRendererLogger } from "../../../logging";
import { agentHalfOf } from "../agent-kinds";
import { currentDesk, type MountedDesk, plainWords, subscribeDesk } from "../desk-door";

// THE WINDOW'S APPLIER (OB-3c; thinking-objects-at-work.md §5.5, CP-D13, OB-L4, OB-L5). fieldd records an intent and this
// window, which alone knows a board's meaning and where the person's hand is, carries it out: one window, the desk it has
// mounted, one intent at a time and every one answered. Reads run a kind's handler over a read API with nothing to write
// with. Acts run over a recording API and commit as ONE transaction `{ undoable: false, meta: { run, intent } }`, so ⌘Z
// skips an agent's change (OB-D11 A) and the answer carries its inverse for fieldd to keep.
//
// THE COVER. Other views freeze the desk (`cover-still.ts`): the loop parks, and with it the frame's `world.sync()`. A
// value write lands in the world at once, so an act on an existing object needs nothing here. A spawn does not: strata
// mints its handle and writes the document at the commit, but the object's structure reaches the world only at a sync, so
// it could not be read, written or removed. `place` and a remove's undo therefore call `world.sync()` once themselves. That
// is the frame's first step alone, no systems and no draw, so a parked desk still costs no frames; strata's guards hold,
// because an intent arrives on a socket message, outside any step or observer. The object is real at once; its first draw
// waits for the desk to come back, and the answer says so (`onScreen: false`).

const log = () => getRendererLogger().child({ component: "desk.agent" });

const objects = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

/** What the window's half of the door needs. */
export interface DeskAgentDoor {
  intents(docId: string, onIntent: (payload: unknown) => void): Promise<() => void>;
  answer(answer: ObjectIntentAnswer): Promise<unknown>;
  /** The objects agents are at work on, whole, on every change. */
  presence(onSnapshot: (payload: unknown) => void): Promise<() => void>;
  held(params: {
    readonly docId: string;
    readonly key: string;
    readonly held: boolean;
  }): Promise<unknown>;
}

export function deskAgentDoorOver(
  client: Pick<FielddClient, "request" | "subscribe">,
): DeskAgentDoor {
  const stream = async (
    method: string,
    params: unknown,
    onEvent: (payload: unknown) => void,
  ): Promise<() => void> => {
    const subscription = await client.subscribe(method, params, (payload, kind) => {
      if (kind !== "snapshot") onEvent(payload);
    });
    return () => subscription.unsubscribe();
  };
  return {
    intents: (docId, onIntent) => stream("objects.intents.subscribe", { docId }, onIntent),
    answer: (answer) => client.request("objects.intent.answer", answer),
    presence: async (onSnapshot) => {
      // whole values: one that arrives before the first answer must not be overwritten by it
      let ready = false;
      const early: unknown[] = [];
      const subscription = await client.subscribe("objects.presence.subscribe", {}, (payload) => {
        if (ready) onSnapshot(payload);
        else early.push(payload);
      });
      onSnapshot(subscription.snapshot);
      ready = true;
      for (const payload of early) onSnapshot(payload);
      return () => subscription.unsubscribe();
    },
    held: (params) => client.request("objects.held", params),
  };
}

export interface ApplierDeps {
  /** a kind's handlers (undefined: the built-ins' and the plugins') */
  readonly halves?: (type: string) => AgentHalf | undefined;
  /** the person's hand on an object (undefined: the desk's own answer) */
  readonly handOn?: (e: Entity) => boolean;
  /** whether Canvas is the view (undefined: the window's) */
  readonly onCanvas?: () => boolean;
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
  off: (label: string): string => `The desk cannot draw this kind right now (${label}).`,
  tooBig: "That answer is larger than an agent can be told.",
  summaryTooBig: "This object's summary is too large to show here. Use its read tools.",
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
  if (!onCanvas()) return false;
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

/** Where an object an agent places lands: the middle of the view, each one a little down and across from the last, so a
 * run placing several does not stack them exactly. */
function spotFor(
  engine: CanvasEngine,
  size: { readonly w: number; readonly h: number },
  nth: number,
): { x: number; y: number } {
  const camera = engine.world.getResource(Camera);
  const view = engine.world.getResource(Viewport);
  const zoom = camera?.zoom ?? 1;
  const cascade = (nth % 8) * 24;
  return {
    x: (camera?.x ?? 0) + ((view?.w ?? 0) / zoom - size.w) / 2 + cascade,
    y: (camera?.y ?? 0) + ((view?.h ?? 0) / zoom - size.h) / 2 + cascade,
  };
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
    const size = widget.defaultSize;
    const spot = spotFor(engine, size, placed);
    let e: Entity;
    try {
      e = engine.ops.spawnWidget(intent.kind, {
        x: spot.x,
        y: spot.y,
        w: size.w,
        h: size.h,
        props: intent.props ?? {},
        undoable: false,
      });
    } catch (cause) {
      return refused(
        intent,
        "bad-input",
        cause instanceof Error ? cause.message : "The desk refused those props.",
      );
    }
    placed += 1;
    project(e);
    const key = session.store.keyOf(e) as string | undefined;
    if (key === undefined || typeOf(e) === undefined)
      return refused(intent, "failed", "The object did not reach the desk.");
    const value: IntentPlaceValue = { key, ...opened(intent.kind, e) };
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
    const inverse: DeskInverse = {
      op: "remove",
      type,
      rect: { x: at.x, y: at.y, w: size.w, h: size.h },
      props: declaredProps(engine, e),
    };
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

  const act = (intent: Extract<ObjectIntent, { op: "act" }>, e: Entity): ObjectIntentAnswer => {
    const type = typeOf(e);
    const handler = type === undefined ? undefined : halves(type)?.act?.[intent.tool];
    if (handler === undefined) return refused(intent, "no-tool", WORDS.noTool(intent.tool));
    const session = engine.docs.current();
    if (session === undefined || session.readOnly)
      return refused(intent, "needs-you", WORDS.readOnly);
    const recording = recordAgentAct(declaredProps(engine, e));
    const result = handler(recording.api, intent.input);
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
    const value = handler(agentReadApi(declaredProps(engine, e)), intent.input);
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
      // the object is gone; it comes back under a new key, and fieldd moves its ref there
      let e: Entity;
      try {
        e = engine.ops.spawnWidget(inverse.type, {
          x: inverse.rect.x,
          y: inverse.rect.y,
          w: inverse.rect.w,
          h: inverse.rect.h,
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

  void door
    .intents(docId, (payload) => {
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
    })
    .then(keep, (cause: unknown) => {
      log().warn("renderer.desk.agent_door_refused", "The desk's agent door did not open", {
        cause: String(cause),
      });
    });

  // the objects a run has open on this board, and which of those the person's hand is on
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
  void door
    .presence((payload) => {
      const snapshot = ObjectsPresenceSnapshot.safeParse(payload);
      if (!snapshot.success) return;
      open = snapshot.data.objects
        .filter((object) => object.docId === docId && object.agents.length > 0)
        .map((object) => object.key);
      for (const key of [...reported]) {
        if (open.includes(key)) continue;
        reported.delete(key);
        say(key, false);
      }
      if (disposed) return;
      if (open.length > 0 && guest === null)
        guest = engine.engine.guests.add({ id: "objects.held", make: () => look });
      else if (open.length === 0 && guest !== null) {
        guest();
        guest = null;
      }
    })
    .then(keep, (cause: unknown) => {
      log().warn("renderer.desk.agent_presence_refused", "The desk's presence feed did not open", {
        cause: String(cause),
      });
    });

  return () => {
    disposed = true;
    guest?.();
    guest = null;
    for (const off of offs) off();
    offs.length = 0;
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
