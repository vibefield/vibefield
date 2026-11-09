import { z } from "zod";

// Objects at Work (track OB; `draft/thinking-objects-at-work.md`). The wire truth of the desk's room: what a chip can be
// (OB-D1), what a desk object's name looks like (OB-L1: a name, never a grant), the eight desk tools' inputs and answers
// (§5.2, OB-D5), and the window's door, by which fieldd asks the one window holding a board to read or change an object
// (CP-D13: fieldd records an intent and the window applies it). TS-only: field-native reads none of it.

/** OB-D1 A — every card face and every chip in a message is exactly one of these. */
export const CHIP_TYPES = ["text", "image", "file", "link", "session", "ref"] as const;
export type ChipType = (typeof CHIP_TYPES)[number];
export const ChipType = z.enum(CHIP_TYPES);

/** OB-L1 — a desk object's address on this desktop. Knowing it grants nothing: only the person's play does. */
export const OBJECT_REF_PATTERN = /^vf:obj\/[a-z0-9]{8}$/;
export const ObjectRef = z
  .string()
  .regex(OBJECT_REF_PATTERN, "must look like vf:obj/ and eight lowercase letters or digits");
export type ObjectRef = z.infer<typeof ObjectRef>;

/** Whether the door can name the process that runs an agent's MCP servers: a pane's own, or a helper of the run's own that
 * puppeteer names to the host before anything can start a server (OB-3d). A string, not puppeteer-core's enum: the installed
 * one does not have `run-helper` yet. The one authority: fieldd's briefing and the window's landing table both read it. */
export function doorCanName(process: string | undefined): boolean {
  return process === "terminal" || process === "run-helper";
}

export const OBJECT_LIMITS = {
  /** A manual's whole answer. MCP clients warn near 10K tokens; at about 3 characters a token this is 8K. */
  MANUAL_BYTES: 24_000,
  /** What `now` may hold of an object: the bounded summary an open returns, marked as the object's own content (MT-L6). */
  NOW_BYTES: 8_000,
  /** A kind's guide, the manual's prose. */
  GUIDE_BYTES: 6_000,
  /** The tools one kind may give an agent. */
  TOOLS_PER_KIND: 24,
  /** One tool call's input, and the most one tool answers. */
  TOOL_BYTES: 64_000,
  /** The objects one `canvas_list` names. */
  LIST_OBJECTS: 200,
  /** The words an approval prompt shows for an act. */
  DOING_CHARS: 120,
  TITLE_CHARS: 200,
  /** How long fieldd waits for the window to answer one intent. */
  INTENT_ANSWER_MS: 15_000,
  /** An agent's changes kept for its separate undo, per agent per object (OB-D11 A); a board has a ceiling of its own. */
  UNDO_KEPT: 100,
} as const;

/** The refusals only the desk room gives (§5.2's facts, errors as results, MT §8). The plane's own (`bad-input`,
 * `unavailable`, `forbidden`) are its own. */
export const OBJECT_FACTS = [
  "not-handed",
  "held",
  "busy",
  "gone",
  "no-tool",
  "needs-you",
  "conflict",
] as const;
export type ObjectFact = (typeof OBJECT_FACTS)[number];

/** §7 — what an agent is doing with an object. An operation stops being in flight when its answer arrives. */
export const AT_WORK_STATES = [
  "open",
  "reading",
  "acting",
  "needs-you",
  "paused",
  "failed",
  "released",
] as const;
export type AtWorkState = (typeof AT_WORK_STATES)[number];
export const AtWorkState = z.enum(AT_WORK_STATES);

/** How a caller holds an object: it placed it, or the person handed it over (MT-L4). */
export const ObjectYours = z.enum(["placed", "handed"]);
export type ObjectYours = z.infer<typeof ObjectYours>;

/** OB-D9 — whether every agent may act at once, or one holder at a time. */
export const ObjectConcurrency = z.enum(["many", "one"]);
export type ObjectConcurrency = z.infer<typeof ObjectConcurrency>;

const Title = z.string().max(OBJECT_LIMITS.TITLE_CHARS);
const ToolName = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, "must be a tool's name, as object_open lists them");
const KindId = z.string().min(1).max(128);
/** A tool's input, as its kind's manual declares it; fieldd checks it against the kind's schema before the window sees it. */
const ToolInput = z.record(z.unknown());

const AgentOnObject = z.object({ handle: z.string().min(1), state: AtWorkState }).passthrough();

/** Where an object stands on the desk, in the desk's units. */
const ObjectPlace = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .passthrough();

// ── The eight desk tools (§5.2) ────────────────────────────────────────────────────────────────

export const CanvasKindsInput = z.object({}).passthrough();
export const CanvasKindsOutput = z
  .object({
    kinds: z.array(
      z
        .object({
          kind: KindId,
          title: Title,
          summary: z.string().optional(),
          /** whether placing one gives you tools */
          tools: z.boolean(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const CanvasListInput = z.object({}).passthrough();
export const CanvasListOutput = z
  .object({
    objects: z.array(
      z
        .object({
          ref: ObjectRef,
          kind: KindId,
          title: Title,
          place: ObjectPlace.optional(),
          agents: z.array(AgentOnObject),
          /** absent: not yours, so it is listed and its contents stay closed */
          yours: ObjectYours.optional(),
        })
        .passthrough(),
    ),
    /** more objects stand on the desk than one list names */
    truncated: z.boolean().optional(),
  })
  .passthrough();

/** One tool of a kind, as the manual teaches it: the JSON Schema is the kind's declaration, unchanged. */
const ManualTool = z
  .object({
    name: ToolName,
    readOnly: z.boolean(),
    destructive: z.boolean().optional(),
    description: z.string().min(1),
    input: z.record(z.unknown()),
  })
  .passthrough();

/** What `object_open` and `canvas_place` answer (§5.4), always with its tools unless the caller opts out: a manual lives
 * in the conversation, and compaction can erase it. `now` is the object's content, never the user's words (MT-L6). */
export const ObjectManual = z
  .object({
    object: z
      .object({
        ref: ObjectRef,
        kind: KindId,
        title: Title,
        yours: ObjectYours,
        agents: z.array(AgentOnObject),
        heldByUser: z.boolean(),
        onScreen: z.boolean(),
      })
      .passthrough(),
    now: z.unknown(),
    /** absent when the caller passed `tools: false` */
    tools: z.array(ManualTool).max(OBJECT_LIMITS.TOOLS_PER_KIND).optional(),
    guide: z.string().max(OBJECT_LIMITS.GUIDE_BYTES).optional(),
    manual: z.object({ kind: KindId, version: z.number().int().min(0) }).passthrough(),
  })
  .passthrough();
export type ObjectManual = z.infer<typeof ObjectManual>;

export const CanvasPlaceInput = z
  .object({
    kind: KindId,
    title: Title.optional(),
    /** the kind's durable props, as its manifest declares them */
    props: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type CanvasPlaceInput = z.infer<typeof CanvasPlaceInput>;

export const ObjectOnlyInput = z.object({ ref: ObjectRef }).passthrough();
export type ObjectOnlyInput = z.infer<typeof ObjectOnlyInput>;

export const CanvasRemoveOutput = z.object({ removed: z.literal(true) }).passthrough();

export const ObjectOpenInput = z
  .object({
    ref: ObjectRef,
    /** false: leave out the tools and guide, when you still have them in front of you */
    tools: z.boolean().optional(),
  })
  .passthrough();
export type ObjectOpenInput = z.infer<typeof ObjectOpenInput>;

export const ObjectReadInput = z
  .object({ ref: ObjectRef, tool: ToolName, input: ToolInput.optional() })
  .passthrough();
export type ObjectReadInput = z.infer<typeof ObjectReadInput>;

/** `doing` comes first because a harness's approval prompt shows these fields in order, and a raw ref tells a person
 * nothing. */
export const ObjectActInput = z
  .object({
    doing: z.string().min(1).max(OBJECT_LIMITS.DOING_CHARS),
    ref: ObjectRef,
    tool: ToolName,
    input: ToolInput.optional(),
  })
  .passthrough();
export type ObjectActInput = z.infer<typeof ObjectActInput>;

/** A tool's answer: what the kind returned, bounded, as the object's content (MT-L6). */
export const ObjectToolOutput = z
  .object({
    result: z.unknown(),
    /** an act's one change: what the user's undo will say */
    changed: z.string().optional(),
  })
  .passthrough();
export type ObjectToolOutput = z.infer<typeof ObjectToolOutput>;

export const ObjectReleaseOutput = z.object({ released: z.literal(true) }).passthrough();

// ── The window's door (CP-D13; §5.5) ───────────────────────────────────────────────────────────

export const ObjectIntentId = z.string().min(1).max(64);
export type ObjectIntentId = z.infer<typeof ObjectIntentId>;
export const DeskDocId = z.string().min(1);
/** An object's durable key on its board (`store.keyOf`). */
export const DeskObjectKey = z.string().min(1);

const IntentBase = {
  intent: ObjectIntentId,
  /** whose act this is: the run, and the name the desk shows */
  run: z.string().min(1),
  handle: z.string().min(1),
  /** ms since the epoch. Past it fieldd has told the caller it does not know what happened, so the window refuses: an
   * act it applied then would be one nobody could undo. */
  expiresAt: z.number().int().min(0),
};

/** One thing fieldd asks the window holding a board to do. Only the window knows the board's meaning and whether the
 * person's hand is on an object, so `held` is answered there. */
export const ObjectIntent = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list"), ...IntentBase }).passthrough(),
  z
    .object({
      op: z.literal("place"),
      ...IntentBase,
      kind: KindId,
      title: Title.optional(),
      props: z.record(z.unknown()).optional(),
    })
    .passthrough(),
  z.object({ op: z.literal("remove"), ...IntentBase, key: DeskObjectKey }).passthrough(),
  z.object({ op: z.literal("open"), ...IntentBase, key: DeskObjectKey }).passthrough(),
  z
    .object({
      op: z.literal("read"),
      ...IntentBase,
      key: DeskObjectKey,
      tool: ToolName,
      input: ToolInput,
    })
    .passthrough(),
  z
    .object({
      op: z.literal("act"),
      ...IntentBase,
      key: DeskObjectKey,
      tool: ToolName,
      input: ToolInput,
      doing: z.string().min(1).max(OBJECT_LIMITS.DOING_CHARS),
    })
    .passthrough(),
  z
    .object({
      op: z.literal("undo"),
      ...IntentBase,
      key: DeskObjectKey,
      /** the change the act made, as the window recorded it */
      inverse: z.unknown(),
    })
    .passthrough(),
]);
export type ObjectIntent = z.infer<typeof ObjectIntent>;

export const ObjectIntentAnswer = z.discriminatedUnion("ok", [
  z
    .object({
      intent: ObjectIntentId,
      ok: z.literal(true),
      /** the op's own answer: list's objects, open's title and now, a tool's result */
      value: z.unknown(),
      /** an act's undo, kept by fieldd newest first: a reload of the window must not lose it */
      inverse: z.unknown().optional(),
      changed: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      intent: ObjectIntentId,
      ok: z.literal(false),
      fact: z.string().min(1),
      text: z.string().min(1),
    })
    .passthrough(),
]);
export type ObjectIntentAnswer = z.infer<typeof ObjectIntentAnswer>;

// What the window's `value` is for each op that fieldd reads (OB-3b); a tool's `read` or `act` value is its result, whole.

export const IntentListValue = z
  .object({
    objects: z.array(
      z
        .object({ key: DeskObjectKey, kind: KindId, title: Title, place: ObjectPlace.optional() })
        .passthrough(),
    ),
  })
  .passthrough();
export type IntentListValue = z.infer<typeof IntentListValue>;

export const IntentOpenValue = z
  .object({
    kind: KindId,
    title: Title,
    /** the object's bounded summary: its content, never the user's words */
    now: z.unknown(),
    heldByUser: z.boolean(),
    onScreen: z.boolean(),
  })
  .passthrough();
export type IntentOpenValue = z.infer<typeof IntentOpenValue>;

export const IntentPlaceValue = IntentOpenValue.extend({ key: DeskObjectKey });
export type IntentPlaceValue = z.infer<typeof IntentPlaceValue>;

/** A remove's undo re-spawns the object under a new key, and fieldd moves its ref there. */
export const IntentUndoValue = z.object({ key: DeskObjectKey.optional() }).passthrough();
export type IntentUndoValue = z.infer<typeof IntentUndoValue>;

export const ObjectsIntentsSubscribeParams = z.object({ docId: DeskDocId }).passthrough();
export const ObjectsIntentAnswerResult = z.object({ taken: z.boolean() }).passthrough();

// ── What fieldd keeps per object (§5.6; OB-L1, EY-D9 B) ────────────────────────────────────────

export const OBJECT_RECORD_FORMAT = 1;

/** Who holds a grant: a plain run by its id, or a spark, whose run id changes each time it sleeps and wakes, as
 * `spark:<id>`. A person's hand is meant to outlast that (§5.6, EY-D9 B). */
export const ObjectGrant = z
  .object({ holder: z.string().min(1), how: ObjectYours, at: z.number().int().min(0) })
  .passthrough();
export type ObjectGrant = z.infer<typeof ObjectGrant>;

/** One object's name and who may work it: a file per object under LAYOUT.OBJECTS_DIR, signed with OBJECTS_KEY_FILE's
 * secret. A grant lets a run work the person's object, so an unsigned or forged record is set aside, never served. */
export const ObjectRecord = z
  .object({
    format: z.literal(OBJECT_RECORD_FORMAT),
    ref: ObjectRef,
    docId: DeskDocId,
    key: DeskObjectKey,
    /** absent until the window has told fieldd what it is */
    kind: KindId.optional(),
    grants: z.array(ObjectGrant),
  })
  .passthrough();
export type ObjectRecord = z.infer<typeof ObjectRecord>;

/** The window names an object it is making a card of, and is told its ref. */
export const ObjectsRefParams = z
  .object({
    docId: DeskDocId,
    key: DeskObjectKey,
    /** the object's kind, when the window knows it: a `one` kind's hand moves it only once fieldd knows it is one */
    kind: KindId.optional(),
  })
  .passthrough();
export const ObjectsRefResult = z.object({ ref: ObjectRef }).passthrough();

/** OB-L1 — the grant: only VibeField's own window may call this, on the person's play. */
export const ObjectsHandParams = z.object({ ref: ObjectRef, run: z.string().min(1) }).passthrough();
export const ObjectsHandResult = z.discriminatedUnion("handed", [
  z
    .object({
      handed: z.literal(true),
      /** the holder held it before this hand: a later play that fails has no grant of its own to take back */
      already: z.literal(true).optional(),
    })
    .passthrough(),
  z.object({ handed: z.literal(false), reason: z.string().min(1) }).passthrough(),
]);
export type ObjectsHandResult = z.infer<typeof ObjectsHandResult>;

/** `run`: a run's id, or a holder as `objects.grants` names it, for a spark with no run now. */
export const ObjectsRunParams = z.object({ ref: ObjectRef, run: z.string().min(1) }).passthrough();
export const ObjectsUndoResult = z.discriminatedUnion("undone", [
  z.object({ undone: z.literal(true), changed: z.string().optional() }).passthrough(),
  z.object({ undone: z.literal(false), reason: z.string().min(1) }).passthrough(),
]);
export const ObjectsTakeBackResult = z.object({ taken: z.literal(true) }).passthrough();

export const ObjectsResolveParams = z.object({ ref: ObjectRef }).passthrough();
export const ObjectsResolveResult = z.discriminatedUnion("found", [
  z.object({ found: z.literal(true), docId: DeskDocId, key: DeskObjectKey }).passthrough(),
  z.object({ found: z.literal(false) }).passthrough(),
]);

/** §11 — every grant still standing, or one object's: a grant outlives the app, so a forgotten one must be findable. */
export const ObjectsGrantsParams = z.object({ ref: ObjectRef.optional() }).passthrough();
export const ObjectGrantRow = z
  .object({
    ref: ObjectRef,
    docId: DeskDocId,
    key: DeskObjectKey,
    kind: KindId.optional(),
    /** what `objects.takeBack` takes as `run` */
    holder: z.string().min(1),
    /** how the desk names the holder */
    name: z.string().min(1),
    how: ObjectYours,
    at: z.number().int().min(0),
  })
  .passthrough();
export type ObjectGrantRow = z.infer<typeof ObjectGrantRow>;
export const ObjectsGrantsResult = z.object({ grants: z.array(ObjectGrantRow) }).passthrough();

/** The window says the person's hand came onto or left an object (OB-L5): every agent on it reads `paused`. */
export const ObjectsHeldParams = z
  .object({ docId: DeskDocId, key: DeskObjectKey, held: z.boolean() })
  .passthrough();

/** §7 — one agent on one object, as the desk shows it. */
export const ObjectAtWork = z
  .object({
    run: z.string().min(1),
    handle: z.string().min(1),
    agent: z.string().min(1),
    state: AtWorkState,
    /** when this state began, so a flickering "reading" can be held on screen */
    since: z.number().int().min(0),
    /** present: the separate undo is available and this says what it undoes */
    lastChange: z
      .object({ label: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ObjectAtWork = z.infer<typeof ObjectAtWork>;

export const ObjectPresence = z
  .object({
    ref: ObjectRef,
    docId: DeskDocId,
    key: DeskObjectKey,
    agents: z.array(ObjectAtWork),
    /** a `one` kind's holder, by run, and who waits */
    holder: z.string().min(1).optional(),
    waiters: z.array(z.string().min(1)).optional(),
  })
  .passthrough();
export type ObjectPresence = z.infer<typeof ObjectPresence>;

export const ObjectsPresenceSnapshot = z.object({ objects: z.array(ObjectPresence) }).passthrough();
export type ObjectsPresenceSnapshot = z.infer<typeof ObjectsPresenceSnapshot>;
