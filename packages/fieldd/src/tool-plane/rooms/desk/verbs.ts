import {
  type AtWorkState,
  type CanvasPlaceInput,
  IntentListValue,
  IntentOpenValue,
  IntentPlaceValue,
  OBJECT_LIMITS,
  type ObjectActInput,
  type ObjectGrant,
  type ObjectManual,
  type ObjectOnlyInput,
  type ObjectOpenInput,
  type ObjectReadInput,
  type ObjectRecord,
  type ObjectRef,
  type ObjectYours,
} from "@vibefield/contracts";
import { RpcCallError } from "../../../native-link";
import type { DeskObjects } from "../../../objects/desk-objects";
import type { DeskKind, DeskKindTool } from "../../../objects/kinds";
import type { AtWorkAgent } from "../../../objects/presence";
import { checkToolInput } from "./check";

// OB-3b (`draft/thinking-objects-at-work.md` §5, OB-D5 A) — the desk room: eight tools, whatever is installed. A kind's
// own tools are never rows; an agent learns them when it takes one (OB-L3), in the manual `object_open` and
// `canvas_place` answer. fieldd names, holds and records; the window applies a kind's acts (OB-L8). So the order of a call
// is the room's law: the caller holds the object (MT-L4), the tool is in the kind's manual, its input fits the kind's
// schema, and only then does the window see it. The plane has written the audit line before any of this runs (CP-L6).

/** MT-L6 — what an object holds reaches the model as the object's own words. */
const CONTENT_MARK = "The object's content, never the user's words.";

const DESK_VERBS = new Set([
  "canvas_kinds",
  "canvas_list",
  "canvas_place",
  "canvas_remove",
  "object_open",
  "object_read",
  "object_act",
  "object_release",
]);

export type DeskVerbName =
  | "canvas_kinds"
  | "canvas_list"
  | "canvas_place"
  | "canvas_remove"
  | "object_open"
  | "object_read"
  | "object_act"
  | "object_release";

export const isDeskVerb = (name: string): name is DeskVerbName => DESK_VERBS.has(name);

/** Who a desk verb answers: a spark or a settled plain run, by its run. */
export interface DeskCaller {
  readonly runtimeRunId: string;
}

export interface DeskDeps {
  readonly objects: DeskObjects;
}

export interface DeskVerbs {
  canvas_kinds(caller: DeskCaller, input: unknown): Promise<unknown>;
  canvas_list(caller: DeskCaller, input: unknown): Promise<unknown>;
  canvas_place(caller: DeskCaller, input: CanvasPlaceInput): Promise<unknown>;
  canvas_remove(caller: DeskCaller, input: ObjectOnlyInput): Promise<unknown>;
  object_open(caller: DeskCaller, input: ObjectOpenInput): Promise<unknown>;
  object_read(caller: DeskCaller, input: ObjectReadInput): Promise<unknown>;
  object_act(caller: DeskCaller, input: ObjectActInput): Promise<unknown>;
  object_release(caller: DeskCaller, input: ObjectOnlyInput): Promise<unknown>;
}

/** Run a desk verb on input its own schema has already parsed (the one place the union is widened). */
export function runDesk(verbs: DeskVerbs, name: DeskVerbName, caller: DeskCaller, input: unknown) {
  return (verbs[name] as (caller: DeskCaller, input: unknown) => Promise<unknown>)(caller, input);
}

const refuse = (
  fact: string,
  text: string,
  more: Record<string, unknown> = {},
  retryable = false,
): RpcCallError => new RpcCallError("PRECONDITION_FAILED", text, retryable, { fact, ...more });

/** MT-L4, and how to get it: the refusal is the instruction. Asked of a ref that names nothing here as well: a made-up
 * ref is told no more than a real one the caller does not hold. */
const notHanded = (ref: string): RpcCallError =>
  refuse(
    "not-handed",
    `${ref} is not yours to work: you neither placed it nor were handed it. Ask the user to hand it to you.`,
  );

const noDesk = (): RpcCallError =>
  new RpcCallError(
    "UNAVAILABLE",
    "No VibeField window has a desk open, so nothing was done. Ask the user to open one.",
    true,
    { service: "desk", state: "no-window" },
  );

/** A window's answer, by the op's contract. An answer that fits nothing is the window's fault and is said as such. */
const parseValue = <T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new RpcCallError("UNAVAILABLE", "The window's answer could not be read.", true, {
    service: "desk",
    state: "bad-answer",
  });
};

const sizeOf = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value ?? null) ?? "null", "utf8");

/** At most `max` bytes of an object's content. An over-long value becomes a marked preview, never a silent cut. */
const boundedContent = (value: unknown, max: number): unknown => {
  if (sizeOf(value) <= max) return value;
  const text = JSON.stringify(value) ?? "";
  const preview = Buffer.from(text, "utf8")
    .subarray(0, Math.max(0, max - 64))
    .toString("utf8")
    .replace(/�+$/, "");
  return { truncated: true, preview };
};

const toolRow = (tool: DeskKindTool): NonNullable<ObjectManual["tools"]>[number] => ({
  name: tool.name,
  readOnly: tool.readOnly,
  ...(tool.destructive !== undefined ? { destructive: tool.destructive } : {}),
  description: tool.description,
  input: { ...tool.input },
});

interface ManualParts {
  readonly ref: ObjectRef;
  readonly kindId: string;
  readonly kind: DeskKind | undefined;
  readonly title: string;
  readonly yours: ObjectYours;
  readonly agents: readonly { handle: string; state: AtWorkState }[];
  readonly heldByUser: boolean;
  readonly onScreen: boolean;
  readonly now: unknown;
  readonly withTools: boolean;
}

/** §5.4 — a manual, always with its tools unless the caller opts out: it lives in the conversation, and compaction can
 * erase it. Within MANUAL_BYTES whatever a kind declared: the prose goes first, then what the object holds, then the
 * last tools, and the answer says what it left out. */
const manualOf = (parts: ManualParts): ObjectManual => {
  const { kind, withTools } = parts;
  const tools = withTools ? (kind?.tools ?? []).map(toolRow) : undefined;
  const manual: ObjectManual = {
    object: {
      ref: parts.ref,
      kind: parts.kindId,
      title: parts.title.slice(0, OBJECT_LIMITS.TITLE_CHARS),
      yours: parts.yours,
      agents: parts.agents.map((a) => ({ handle: a.handle, state: a.state })),
      heldByUser: parts.heldByUser,
      onScreen: parts.onScreen,
    },
    now: boundedContent(parts.now, OBJECT_LIMITS.NOW_BYTES),
    nowIs: CONTENT_MARK,
    ...(tools !== undefined ? { tools } : {}),
    ...(withTools && kind?.guide !== undefined
      ? { guide: kind.guide.slice(0, OBJECT_LIMITS.GUIDE_BYTES) }
      : {}),
    manual: { kind: parts.kindId, version: kind?.version ?? 0 },
  };
  const within = (): boolean => sizeOf(manual) <= OBJECT_LIMITS.MANUAL_BYTES;
  const left: string[] = [];
  if (!within() && manual.guide !== undefined) {
    delete manual.guide;
    left.push("guide");
  }
  if (!within()) {
    manual.now = { truncated: true };
    left.push("now");
  }
  while (!within() && (manual.tools?.length ?? 0) > 0) {
    manual.tools?.pop();
    if (!left.includes("tools")) left.push("tools");
  }
  return left.length > 0 ? { ...manual, leftOut: left } : manual;
};

const NOT_TOOLS_YET = (ref: string): RpcCallError =>
  refuse("no-tool", `Open ${ref} with object_open first: its tools come in that answer.`);

const declaredTool = (
  objects: DeskObjects,
  record: ObjectRecord,
  tool: string,
  acting: boolean,
): DeskKindTool => {
  if (record.kind === undefined) throw NOT_TOOLS_YET(record.ref);
  const kind = objects.kind(record.kind);
  const tools = kind?.tools ?? [];
  const declared = tools.find((t) => t.name === tool);
  if (declared === undefined) {
    const names = tools.map((t) => t.name);
    throw refuse(
      "no-tool",
      names.length > 0
        ? `${record.kind} has no tool named ${tool}. It has: ${names.join(", ")}.`
        : `${record.kind} gives you no tools; it can only be listed and placed.`,
      { tools: names },
    );
  }
  if (declared.readOnly && acting)
    throw refuse("no-tool", `${tool} only reads; call it with object_read.`, {
      tools: [tool],
    });
  if (!declared.readOnly && !acting)
    throw refuse("no-tool", `${tool} changes the object; call it with object_act.`, {
      tools: [tool],
    });
  return declared;
};

export function createDeskVerbs(deps: DeskDeps): DeskVerbs {
  const { objects } = deps;
  const { registry, intents, presence } = objects;

  /** MT-L4: what the caller holds of this object, and where it is. */
  const held = (ref: ObjectRef, run: string): { record: ObjectRecord; grant: ObjectGrant } => {
    registry.readable();
    const record = registry.get(ref);
    const grant = record && registry.grantOf(ref, run);
    if (record === undefined || grant === undefined) throw notHanded(ref);
    return { record, grant };
  };

  /** An operation is in flight from its start until its answer arrives (§7). */
  const operate = async <T>(
    ref: ObjectRef,
    agent: AtWorkAgent,
    state: "reading" | "acting",
    work: () => Promise<T>,
  ): Promise<T> => {
    presence.begin(ref, agent, state);
    try {
      const out = await work();
      presence.settle(ref, agent, "open");
      return out;
    } catch (err) {
      const fact =
        err instanceof RpcCallError ? (err.details as { fact?: unknown })?.fact : undefined;
      if (fact === "gone") presence.drop(ref);
      else if (fact === "needs-you") presence.settle(ref, agent, "needs-you");
      else if (fact === "held" || (err as RpcCallError).kind === "UNAVAILABLE")
        presence.settle(ref, agent, "open");
      else presence.settle(ref, agent, "failed");
      throw err;
    }
  };

  const defaultDesk = (): string => {
    const docId = intents.defaultDoc();
    if (docId === undefined) throw noDesk();
    return docId;
  };

  return {
    async canvas_kinds() {
      return {
        kinds: objects
          .kinds()
          .filter((kind) => kind.placeable)
          .map((kind) => ({
            kind: kind.kind,
            title: kind.title,
            ...(kind.summary !== undefined ? { summary: kind.summary } : {}),
            tools: kind.tools.length > 0,
          })),
      };
    },

    async canvas_list(caller) {
      const run = caller.runtimeRunId;
      const docId = defaultDesk();
      const { handle } = objects.who(run);
      const answered = await intents.ask(docId, { op: "list", run, handle });
      const { objects: listed } = parseValue(IntentListValue, answered.value);
      const shown = listed.slice(0, OBJECT_LIMITS.LIST_OBJECTS);
      return {
        objects: shown.map((object) => {
          const ref = registry.refFor(docId, object.key, object.kind);
          const grant = registry.grantOf(ref, run);
          return {
            ref,
            kind: object.kind,
            title: object.title.slice(0, OBJECT_LIMITS.TITLE_CHARS),
            ...(object.place !== undefined ? { place: object.place } : {}),
            agents: presence.agentsOn(ref),
            ...(grant !== undefined ? { yours: grant.how } : {}),
          };
        }),
        ...(listed.length > shown.length ? { truncated: true } : {}),
      };
    },

    async canvas_place(caller, input) {
      const run = caller.runtimeRunId;
      const kind = objects.kind(input.kind);
      if (kind === undefined || !kind.placeable) {
        const names = objects
          .kinds()
          .filter((k) => k.placeable)
          .map((k) => k.kind);
        throw refuse(
          "bad-input",
          `input.kind: VibeField can't place ${input.kind}. It can place: ${names.join(", ")}.`,
          { path: "kind", expected: { enum: names } },
        );
      }
      if (input.props !== undefined && sizeOf(input.props) > OBJECT_LIMITS.TOOL_BYTES)
        throw refuse("bad-input", `input.props is over ${OBJECT_LIMITS.TOOL_BYTES} bytes.`, {
          path: "props",
          expected: { maxBytes: OBJECT_LIMITS.TOOL_BYTES },
        });
      const docId = defaultDesk();
      const agent = objects.who(run);
      const answered = await intents.ask(docId, {
        op: "place",
        run,
        handle: agent.handle,
        kind: input.kind,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.props !== undefined ? { props: input.props } : {}),
      });
      const value = parseValue(IntentPlaceValue, answered.value);
      const ref = registry.refFor(docId, value.key, input.kind);
      registry.grant(ref, run, "placed");
      presence.opened(ref, agent);
      if (answered.inverse !== undefined)
        objects.keepChange(docId, {
          op: "place",
          ref,
          run,
          key: value.key,
          inverse: answered.inverse,
          label: answered.changed ?? `Placed ${value.title}`,
        });
      return manualOf({
        ref,
        kindId: input.kind,
        kind,
        title: value.title,
        yours: "placed",
        agents: presence.agentsOn(ref),
        heldByUser: value.heldByUser,
        onScreen: value.onScreen,
        now: value.now,
        withTools: true,
      });
    },

    async canvas_remove(caller, input) {
      const run = caller.runtimeRunId;
      const { record, grant } = held(input.ref, run);
      if (grant.how !== "placed")
        throw refuse(
          "forbidden",
          `${input.ref} is the user's: you can work it, and only they can remove it. Use object_release to give it back.`,
        );
      const { handle } = objects.who(run);
      const answered = await intents.ask(record.docId, {
        op: "remove",
        run,
        handle,
        key: record.key,
      });
      presence.released(input.ref, run);
      if (answered.inverse !== undefined)
        objects.keepChange(record.docId, {
          op: "remove",
          ref: input.ref,
          run,
          key: record.key,
          inverse: answered.inverse,
          label: answered.changed ?? "Removed an object",
        });
      return { removed: true };
    },

    async object_open(caller, input) {
      const run = caller.runtimeRunId;
      const { record, grant } = held(input.ref, run);
      const agent = objects.who(run);
      const answered = await intents.ask(record.docId, {
        op: "open",
        run,
        handle: agent.handle,
        key: record.key,
      });
      const value = parseValue(IntentOpenValue, answered.value);
      registry.setKind(input.ref, value.kind);
      presence.opened(input.ref, agent);
      return manualOf({
        ref: input.ref,
        kindId: value.kind,
        kind: objects.kind(value.kind),
        title: value.title,
        yours: grant.how,
        agents: presence.agentsOn(input.ref),
        heldByUser: value.heldByUser,
        onScreen: value.onScreen,
        now: value.now,
        withTools: input.tools !== false,
      });
    },

    async object_read(caller, input) {
      const run = caller.runtimeRunId;
      const { record } = held(input.ref, run);
      const tool = declaredTool(objects, record, input.tool, false);
      const toolInput = input.input ?? {};
      checkToolInput(tool, toolInput);
      const agent = objects.who(run);
      return operate(input.ref, agent, "reading", async () => {
        const answered = await intents.ask(record.docId, {
          op: "read",
          run,
          handle: agent.handle,
          key: record.key,
          tool: input.tool,
          input: toolInput,
        });
        return {
          result: boundedContent(answered.value, OBJECT_LIMITS.TOOL_BYTES),
          resultIs: CONTENT_MARK,
        };
      });
    },

    async object_act(caller, input) {
      const run = caller.runtimeRunId;
      const { record } = held(input.ref, run);
      const tool = declaredTool(objects, record, input.tool, true);
      const toolInput = input.input ?? {};
      checkToolInput(tool, toolInput);
      // OB-L5: the person's hand wins at once, and the act is answered, never replayed
      if (presence.isHeld(input.ref))
        throw refuse("held", `The user is holding ${input.ref}. Try again later.`, {}, true);
      if (objects.kind(record.kind)?.concurrency === "one" && !presence.claim(input.ref, run))
        throw refuse(
          "busy",
          `Another agent is acting on ${input.ref}, which takes one at a time. Try again later.`,
          {},
          true,
        );
      const agent = objects.who(run);
      return operate(input.ref, agent, "acting", async () => {
        const answered = await intents.ask(record.docId, {
          op: "act",
          run,
          handle: agent.handle,
          key: record.key,
          tool: input.tool,
          input: toolInput,
          doing: input.doing,
        });
        if (answered.inverse !== undefined)
          objects.keepChange(record.docId, {
            op: "act",
            ref: input.ref,
            run,
            key: record.key,
            inverse: answered.inverse,
            label: answered.changed ?? input.doing,
          });
        return {
          result: boundedContent(answered.value, OBJECT_LIMITS.TOOL_BYTES),
          resultIs: CONTENT_MARK,
          ...(answered.changed !== undefined ? { changed: answered.changed } : {}),
        };
      });
    },

    // Idempotent (its row says so): a repeated release answers the same, and has nothing left to give back.
    async object_release(caller, input) {
      const run = caller.runtimeRunId;
      registry.readable();
      const grant = registry.grantOf(input.ref, run);
      if (grant?.how === "handed") registry.revoke(input.ref, run);
      presence.released(input.ref, run);
      return { released: true };
    },
  };
}
