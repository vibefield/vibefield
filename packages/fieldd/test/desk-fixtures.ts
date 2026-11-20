import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ObjectAtWorkProject,
  ObjectIntent,
  ObjectIntentAnswer,
  ObjectRef,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { DeskObjects, type DeskObjectsOptions, type RunState } from "../src/objects/desk-objects";
import type { DeskKind } from "../src/objects/kinds";
import { SparkStarts } from "../src/objects/spark-starts";
import { ObjectsStore } from "../src/objects/store";
import { RecordSigner, type SignedRead } from "../src/signed-record";

// A real DeskObjects over a real signed store in a temp root, and a scripted window: an intent handed to `respond` gets
// the answer it returns, and an intent for which it returns nothing stays pending, as a window that has gone quiet.
//
// WHAT IS INJECTED HERE, and so what every row that uses a world shows (OB custody; the spec's §10). A world builds
// the store and the desk itself and hands them their collaborators: `bornFor` (who a run is: a map of this file's
// making), `marks` (who remembers the grants' count: `survivor()` below), `key` (the handed record key, when a row
// gives one), the grants file's write (`writeFile`), the clock (`now`) and the timers (`retryMs`, `noteMs`). So each
// such row is a row GIVEN AN INJECTED `bornFor`, `marks` and `key`: it shows the store's rule given those. None of
// them shows that production hands the store the real ones: that binding is proved by the rows through the real
// daemon, `packages/fieldd/test/custody-boot.test.ts`.
//
// OB custody (C4, C5). Who a run is, for a grant, is what THIS fieldd launched or vouches for (`bornFor`): every run
// named in `runs` or `sparkRuns` was launched by the fieldd that is running when it is named, and a `reopen` is a
// restart, after which every run named before it came back re-attached and unvouched, unless the restart names it
// (`vouched`: the new fieldd's launch memory, rebuilt, says again what the run was launched as). What a run's RECORD
// says is another thing, a file an agent can rewrite (`forgeRecord`), and nothing in objects reads it: a world hands
// its desk no reader of one. A world also has a survivor (`marks`): who outlives fieldd and remembers the grants'
// count.

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

/** A logger that keeps EVERYTHING it is handed at info and above, as handed: the event, the sentence, an error (an
 * error line's third) and the attrs. For a row that must see what a line carries beside its attrs. */
export function captureAll(calls: unknown[][]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: (...call) => void calls.push(call),
    warn: (...call) => void calls.push(call),
    error: (...call) => void calls.push(call),
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

/** What a restart may change: the key the store is handed (none: the `files` level), who remembers, and which of the
 * runs from before it the new fieldd vouches for. */
export interface Restart {
  key?: Buffer | undefined;
  marks?: Survivor;
  /** runs named before the restart that the new fieldd's launch memory names again, each as what it was launched as
   * (the spec's §8.1: rebuilt at the re-attach). Every other run from before it comes back unvouched. */
  vouched?: readonly string[];
}

export interface DeskWorld {
  readonly desk: DeskObjects;
  readonly root: string;
  /** LAYOUT.OBJECTS_GRANTS_FILE, in this world's root: beside the objects' folder */
  readonly grantsPath: string;
  /** who outlives this world's fieldd, across every `reopen` that names no other */
  readonly marks: Survivor;
  /** a new DeskObjects on the same root, as a restart of fieldd: every run named before it is re-attached, and
   * unvouched unless `over.vouched` names it */
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
  /** item 550, 2026-11-18 — what the desk names a run, where a row gives one (else `claude·` and the run's last
   * letter) */
  readonly labels: Map<string, string>;
  /** item 550, 2026-11-18 — the agent a run is, by its catalog id, where a row gives one (else `claude`) */
  readonly agentIds: Map<string, string>;
  /** item 550, 2026-11-18 — the project a run works in, by the ids the desktop deals it */
  readonly projects: Map<string, ObjectAtWorkProject>;
  /** item 550, 2026-11-18 — which spark fieldd started a run for: daemon.ts's own memory of the talk room's spawn */
  readonly starts: SparkStarts;
  /** Rewrite a run's session record to say it is `spark`'s, as an agent that reads the sessions' key can (a 0600 file
   * of the same uid): signed with that key, so it verifies. Answers what whoever reads the record back is told. */
  forgeRecord(run: string, spark: string): SignedRead;
  /** every ref a world minted, by minting one for a key on `DOC` */
  refOf(key: string, kind?: string): ObjectRef;
}

const worlds: string[] = [];
const desks: DeskObjects[] = [];

export function cleanupWorlds(): void {
  // a take-back its disk would not take is written again on a timer: stop it before its root goes
  for (const desk of desks.splice(0)) desk.close();
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
  const labels = new Map<string, string>();
  const agentIds = new Map<string, string>();
  const projects = new Map<string, ObjectAtWorkProject>();
  const starts = new SparkStarts();
  // The sessions' records, as far as a row needs them: a file per run, signed with a key that is a file too.
  const sessions = () =>
    new RecordSigner({ keyPath: join(root, "sessions.key"), keyEncoding: "base64" });
  const recordOf = (run: string) => join(root, "sessions", `${run}.json`);
  const forgeRecord = (run: string, spark: string): SignedRead => {
    const signer = sessions();
    const record = { runtimeRunId: run, spark };
    const signed = { ...record, signature: signer.sign(record) };
    mkdirSync(join(root, "sessions"), { recursive: true, mode: 0o700 });
    writeFileSync(recordOf(run), JSON.stringify(signed), { mode: 0o600 });
    return signer.read(recordOf(run));
  };
  const make = (restart?: Restart): DeskObjects => {
    // a restart: fieldd launched none of the runs that were there before it, and vouches only for those it names
    const before = new Set(restart === undefined ? [] : [...runs.keys(), ...sparkRuns.keys()]);
    for (const run of restart?.vouched ?? []) before.delete(run);
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
      label: (run) => labels.get(run) ?? `claude·${run.slice(-1)}`,
      agentOf: (run) => agentIds.get(run) ?? "claude",
      projectOf: (run) => projects.get(run),
      startedByOf: (run) => starts.of(run),
      bornFor: (run) => {
        if (before.has(run) || reattached.has(run)) return undefined;
        const spark = sparkRuns.get(run);
        if (spark !== undefined) return { spark };
        return runs.has(run) ? {} : undefined;
      },
      sparkName: (id) => sparks.get(id),
      kinds: () => opts.kinds ?? [NOTE, PAGE],
      ...(opts.answerMs !== undefined ? { intents: { answerMs: opts.answerMs } } : {}),
      ...(opts.releasedShownMs !== undefined ? { releasedShownMs: opts.releasedShownMs } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    };
    const objects = new DeskObjects(options);
    desks.push(objects);
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
    labels,
    agentIds,
    projects,
    starts,
    forgeRecord,
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
