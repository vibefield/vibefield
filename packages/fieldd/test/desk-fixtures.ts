import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObjectIntent, ObjectIntentAnswer, ObjectRef } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { DeskObjects, type DeskObjectsOptions, type RunState } from "../src/objects/desk-objects";
import type { DeskKind } from "../src/objects/kinds";
import { ObjectsStore } from "../src/objects/store";

// A real DeskObjects over a real signed store in a temp root, and a scripted window: an intent handed to `respond` gets
// the answer it returns, and an intent for which it returns nothing stays pending, as a window that has gone quiet.

export const DOC = "doc-main";
export const NOTE: DeskKind = {
  kind: "desk.note",
  title: "Note",
  summary: "A note on the desk.",
  placeable: true,
  concurrency: "many",
  version: 2,
  guide: "Read it first.",
  tools: [
    {
      name: "read_text",
      readOnly: true,
      description: "Read the note.",
      input: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "write_text",
      readOnly: false,
      destructive: true,
      description: "Replace the note.",
      input: {
        type: "object",
        properties: { text: { type: "string", maxLength: 5 } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  ],
};
export const PAGE: DeskKind = {
  kind: "vibefield.page",
  title: "Page",
  placeable: false,
  concurrency: "one",
  version: 1,
  tools: [
    {
      name: "click",
      readOnly: false,
      description: "Click.",
      input: { type: "object", properties: {} },
    },
  ],
};

export type Answer = Omit<ObjectIntentAnswer, "intent">;

export interface DeskWorld {
  readonly desk: DeskObjects;
  readonly root: string;
  /** a new DeskObjects on the same root, as a restart */
  reopen(): DeskObjects;
  /** a window that answers by `respond`; the intents it was sent */
  window(
    respond: (intent: ObjectIntent) => Answer | undefined,
    docId?: string,
    tokenId?: string,
  ): { readonly seen: ObjectIntent[]; dispose(): void };
  readonly runs: Map<string, RunState>;
  /** every ref a world minted, by minting one for a key on `DOC` */
  refOf(key: string, kind?: string): ObjectRef;
}

const worlds: string[] = [];

export function cleanupWorlds(): void {
  for (const root of worlds.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function world(
  opts: {
    kinds?: readonly DeskKind[];
    logger?: Logger;
    answerMs?: number;
    releasedShownMs?: number;
    readFile?: (path: string) => string;
    now?: () => number;
  } = {},
): DeskWorld {
  const root = mkdtempSync(join(tmpdir(), "vf-desk-"));
  worlds.push(root);
  const runs = new Map<string, RunState>([
    ["run-a", "live"],
    ["run-b", "live"],
  ]);
  const make = (): DeskObjects => {
    const options: DeskObjectsOptions = {
      store: new ObjectsStore({
        dir: join(root, "objects"),
        keyPath: join(root, "objects.key"),
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(opts.readFile ? { readFile: opts.readFile } : {}),
      }),
      runState: (run) => runs.get(run) ?? "unknown",
      label: (run) => `claude·${run.slice(-1)}`,
      agentOf: () => "claude",
      kinds: () => opts.kinds ?? [NOTE, PAGE],
      ...(opts.answerMs !== undefined ? { intents: { answerMs: opts.answerMs } } : {}),
      ...(opts.releasedShownMs !== undefined ? { releasedShownMs: opts.releasedShownMs } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    };
    const objects = new DeskObjects(options);
    objects.boot();
    return objects;
  };
  const desk = make();
  return {
    desk,
    root,
    runs,
    reopen: make,
    refOf: (key, kind) => desk.registry.refFor(DOC, key, kind),
    window: (respond, docId = DOC, tokenId = "tok-window") => {
      const seen: ObjectIntent[] = [];
      const dispose = desk.subscribeDesk(docId, tokenId, (intent) => {
        seen.push(intent);
        const answer = respond(intent);
        if (answer !== undefined)
          queueMicrotask(() =>
            desk.intents.answer(
              { ...answer, intent: intent.intent } as ObjectIntentAnswer,
              tokenId,
            ),
          );
      });
      return { seen, dispose };
    },
  };
}

/** A window's ordinary answers for each op (list and open name a note). */
export const ordinaryWindow = (intent: ObjectIntent): Answer | undefined => {
  switch (intent.op) {
    case "list":
      return {
        ok: true,
        value: { objects: [{ key: "k1", kind: "desk.note", title: "Shopping" }] },
      };
    case "open":
      return {
        ok: true,
        value: {
          kind: "desk.note",
          title: "Shopping",
          now: "eggs",
          heldByUser: false,
          onScreen: true,
        },
      };
    case "place":
      return {
        ok: true,
        value: {
          key: "k9",
          kind: intent.kind,
          title: "Made",
          now: "",
          heldByUser: false,
          onScreen: true,
        },
        inverse: { remove: "k9" },
      };
    case "remove":
      return { ok: true, value: {}, inverse: { respawn: true }, changed: "Removed Made" };
    case "read":
      return { ok: true, value: { text: "eggs" } };
    case "act":
      return {
        ok: true,
        value: { ok: true },
        inverse: { text: "eggs" },
        changed: "Replaced the note",
      };
    case "undo":
      return { ok: true, value: {} };
    default:
      return undefined;
  }
};
