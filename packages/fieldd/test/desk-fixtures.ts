import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObjectIntent, ObjectIntentAnswer, ObjectRef } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { DeskObjects, type DeskObjectsOptions, type RunState } from "../src/objects/desk-objects";
import type { DeskKind } from "../src/objects/kinds";
import { ObjectsStore } from "../src/objects/store";

// A real DeskObjects over a real signed store in a temp root, and a scripted window: an intent handed to `respond` gets
// the answer it returns, and an intent for which it returns nothing stays pending, as a window that has gone quiet.
//
// OB custody (C4, C5). Who a run is, for a grant, is what THIS fieldd launched (`bornFor`), so a world keeps that apart
// from what a run's record says (`sparkOf`): every run named in `runs` or `sparkRuns` was launched by the fieldd that
// is running when it is named, and a `reopen` is a restart, after which every run named before it came back
// re-attached. A world also has a survivor (`marks`): who outlives fieldd and remembers the grants' count.

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

export type LoggedEvents = { event: string; attrs: LogFields | undefined }[];

/** A logger that keeps what was said at info and above, by its event. */
export function capture(events: LoggedEvents): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: (event, _m, attrs) => void events.push({ event, attrs }),
    warn: (event, _m, attrs) => void events.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void events.push({ event, attrs }),
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  return logger;
}

/** Who outlives fieldd and remembers its marks: the floor's memory, or what the shell hands the next fieldd it spawns
 * (`CustodyHandoff.expect`). The two methods are the store's own shape for it; a mark only rises. */
export interface Survivor {
  /** every count it was told, in the order told */
  readonly noted: [name: string, value: number][];
  get(name: string): number;
  note(name: string, value: number): Promise<number>;
}

export function survivor(expect: Record<string, number> = {}): Survivor {
  const kept = new Map(Object.entries(expect));
  const noted: [string, number][] = [];
  return {
    noted,
    get: (name) => kept.get(name) ?? 0,
    note: async (name, value) => {
      noted.push([name, value]);
      const next = Math.max(kept.get(name) ?? 0, value);
      kept.set(name, next);
      return next;
    },
  };
}

/** What a restart may change about the store: the key it is handed (none: the `files` level), and who remembers. */
export interface Restart {
  key?: Buffer | undefined;
  marks?: Survivor;
}

export interface DeskWorld {
  readonly desk: DeskObjects;
  readonly root: string;
  /** LAYOUT.OBJECTS_GRANTS_FILE, in this world's root: beside the objects' folder */
  readonly grantsPath: string;
  /** who outlives this world's fieldd, across every `reopen` that names no other */
  readonly marks: Survivor;
  /** a new DeskObjects on the same root, as a restart of fieldd: every run named before it is re-attached */
  reopen(over?: Restart): DeskObjects;
  /** a window that answers by `respond`; the intents it was sent */
  window(
    respond: (intent: ObjectIntent) => Answer | undefined,
    docId?: string,
    tokenId?: string,
  ): { readonly seen: ObjectIntent[]; dispose(): void };
  readonly runs: Map<string, RunState>;
  /** which spark fieldd launched a run for: a spark's run id changes each time it sleeps and wakes */
  readonly sparkRuns: Map<string, string>;
  /** the sparks fieldd holds, by id, to their names */
  readonly sparks: Map<string, string>;
  /** runs this fieldd did not launch, beside those a `reopen` found already there */
  readonly reattached: Set<string>;
  /** what a run's RECORD says its spark is, where that is not what fieldd launched it as: a file an agent can rewrite */
  readonly recordSays: Map<string, string>;
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
    /** the record key a spawner handed: the store is at custody's `sealed` level */
    key?: Buffer;
    marks?: Survivor;
    /** the grants file's write beside: a disk that will not take it */
    writeFile?: (path: string, text: string) => void;
    retryMs?: number;
    noteMs?: number;
  } = {},
): DeskWorld {
  const root = mkdtempSync(join(tmpdir(), "vf-desk-"));
  worlds.push(root);
  const grantsPath = join(root, "objects.grants.json");
  const marks = opts.marks ?? survivor();
  const runs = new Map<string, RunState>([
    ["run-a", "live"],
    ["run-b", "live"],
  ]);
  const sparkRuns = new Map<string, string>();
  const sparks = new Map<string, string>();
  const reattached = new Set<string>();
  const recordSays = new Map<string, string>();
  const make = (restart?: Restart): DeskObjects => {
    // a restart: fieldd launched none of the runs that were there before it
    const before = new Set(restart === undefined ? [] : [...runs.keys(), ...sparkRuns.keys()]);
    const key = restart !== undefined && "key" in restart ? restart.key : opts.key;
    const options: DeskObjectsOptions = {
      store: new ObjectsStore({
        dir: join(root, "objects"),
        keyPath: join(root, "objects.key"),
        grantsPath,
        marks: restart?.marks ?? marks,
        ...(key ? { key } : {}),
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(opts.readFile ? { readFile: opts.readFile } : {}),
        ...(opts.writeFile ? { writeFile: opts.writeFile } : {}),
        ...(opts.retryMs !== undefined ? { retryMs: opts.retryMs } : {}),
        ...(opts.noteMs !== undefined ? { noteMs: opts.noteMs } : {}),
      }),
      runState: (run) => runs.get(run) ?? "unknown",
      label: (run) => `claude·${run.slice(-1)}`,
      agentOf: () => "claude",
      bornFor: (run) => {
        if (before.has(run) || reattached.has(run)) return undefined;
        const spark = sparkRuns.get(run);
        if (spark !== undefined) return { spark };
        return runs.has(run) ? {} : undefined;
      },
      sparkOf: (run) => recordSays.get(run) ?? sparkRuns.get(run),
      sparkName: (id) => sparks.get(id),
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
    grantsPath,
    marks,
    runs,
    sparkRuns,
    sparks,
    reattached,
    recordSays,
    reopen: (over = {}) => make(over),
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
