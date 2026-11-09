import { z } from "zod";
import type { ObjectConcurrency } from "./objects";
import type { ObjectAgentFace, ObjectAgentTool } from "./plugins";

// THE BUILT-IN KINDS' DURABLE HALVES (OB-2, §5.3, OB-L2: a kind declares its faces and tools once). A plugin's kind says
// this in its manifest. A built-in has no manifest, so it says it here: fieldd reads this to teach an agent a kind and to
// check a call against it, and a kind's handlers live in the window (`field/desk/agent-kinds/`). A test there pins every
// `type` below to ICE's own constant. No dependency beyond the plugin contract's types, so fieldd can read it as it reads
// the agent catalog.

/** A built-in's agent half: a guide is its text, where a plugin's is a file in its bundle. */
export interface DeskKindAgent {
  readonly summary: string;
  readonly concurrency: ObjectConcurrency;
  readonly faces: readonly ObjectAgentFace[];
  readonly guide?: string;
  readonly tools: readonly ObjectAgentTool[];
}

export interface DeskKind {
  /** ICE's type string, the object's `kind` to an agent */
  readonly type: string;
  /** the name a person and an agent know it by */
  readonly title: string;
  /** the manual's version: bumped when a tool or the guide changes meaning */
  readonly version: number;
  /** false: an agent cannot make one, only be handed it */
  readonly placeable: boolean;
  readonly agent: DeskKindAgent;
}

const NO_INPUT = { type: "object", properties: {}, additionalProperties: false } as const;

const LIVE: ObjectAgentFace = { type: "ref", id: "live", label: "Live" };
const PICTURE: ObjectAgentFace = { type: "image", id: "picture", label: "Picture" };

/** The most a note's `write_text` takes. */
export const NOTE_TEXT_MAX = 20_000;

/** The most a mini mat's name holds. */
export const MINIMAT_NAME_MAX = 200;

const NOTE_TOOLS: readonly ObjectAgentTool[] = [
  {
    name: "read_text",
    readOnly: true,
    description: "Read everything written on this note, as plain text.",
    input: NO_INPUT,
    output: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "write_text",
    readOnly: false,
    destructive: true,
    description:
      "Replace everything written on this note with this text. The user can undo it. Read it first if the words already on it matter.",
    input: {
      type: "object",
      properties: { text: { type: "string", maxLength: NOTE_TEXT_MAX } },
      required: ["text"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { chars: { type: "integer", minimum: 0 } },
      required: ["chars"],
    },
  },
];

const MINIMAT_TOOLS: readonly ObjectAgentTool[] = [
  {
    name: "rename",
    readOnly: false,
    description: "Give this mini mat a new name. The user can undo it.",
    input: {
      type: "object",
      properties: { name: { type: "string", maxLength: MINIMAT_NAME_MAX } },
      required: ["name"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

export const DESK_KINDS: readonly DeskKind[] = [
  {
    type: "desk.note",
    title: "Note",
    version: 1,
    placeable: true,
    agent: {
      summary: "A paper note: a few lines written by hand.",
      concurrency: "many",
      faces: [LIVE, { type: "text", id: "words", label: "Its words", format: "plain" }, PICTURE],
      guide:
        "A note holds one piece of plain text. `object_open` shows what it says now; `read_text` gives you all of it. `write_text` replaces the whole note, so read it first and write back everything you want to keep. Keep it short: a note is a small square of paper.",
      tools: [...NOTE_TOOLS],
    },
  },
  {
    type: "desk.photo",
    title: "Print",
    version: 1,
    placeable: false,
    agent: {
      summary: "A printed picture lying on the desk.",
      concurrency: "many",
      faces: [LIVE, PICTURE],
      guide:
        "A print is a picture on paper. It has no tools. Its size is in `now`, and the user can hand you its picture as a file.",
      tools: [],
    },
  },
  {
    type: "desk.board",
    title: "Whiteboard",
    version: 1,
    placeable: true,
    agent: {
      summary: "A whiteboard the user draws on.",
      concurrency: "many",
      faces: [LIVE, PICTURE],
      guide:
        "A whiteboard holds what the user drew. It has no tools yet: you can place an empty one, and the user can hand you its picture as a file.",
      tools: [],
    },
  },
  {
    type: "desk.minimat",
    title: "Mini mat",
    version: 1,
    placeable: true,
    agent: {
      summary: "A small mat with a desk of its own inside, for keeping objects together.",
      concurrency: "many",
      faces: [LIVE, PICTURE],
      guide:
        "A mini mat holds other objects on its own small desk, under a name. You can rename it with `rename`. What lies inside stays the user's.",
      tools: [...MINIMAT_TOOLS],
    },
  },
];

/** An agent's change, as the window recorded it and fieldd keeps it (OB-D11 A): what undoing it needs. The window reads it
 * back; to fieldd it is opaque (`ObjectIntentAnswer.inverse`). */
export const DeskInverse = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("props"),
    after: z.record(z.unknown()),
    before: z.record(z.unknown()),
  }),
  z.object({ op: z.literal("place"), after: z.record(z.unknown()) }),
  z.object({
    op: z.literal("remove"),
    type: z.string().min(1),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    props: z.record(z.unknown()),
  }),
]);
export type DeskInverse = z.infer<typeof DeskInverse>;

/** The built-in kind of this type, if it is one. */
export function deskKind(type: string): DeskKind | undefined {
  return DESK_KINDS.find((kind) => kind.type === type);
}
