import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import {
  type AgentInputSender,
  ErrorData,
  FLOW_HOST_ENDINGS,
  FLOW_LABEL_MAX,
  FLOW_LIMITS,
  FLOW_RUNS_LISTED_MAX,
  type FlowRunRecordStep,
  type FlowStarter,
  NEEDS_CHOICE_WORDS,
  type NeedsItemId,
  RECORD_STORES,
  RunSummary,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowStepEvents, type FlowStepTurnEnd } from "../src/flow-step-events";
import { type FlowJournalEntry, JOURNAL_SUFFIX, RUNS_DIR } from "../src/flows/journal";
import type { FlowsHostLaunch } from "../src/flows/launch";
import { FlowLibrary } from "../src/flows/library";
import { FlowJournalFull, FlowRecords, flowHashOf } from "../src/flows/records";
import { FlowReplay, flowCallKey } from "../src/flows/replay";
import {
  type FlowRunSpark,
  type FlowRunStarted,
  type FlowRunStartParams,
  FlowRuns,
  type FlowRunsList,
} from "../src/flows/runs";
import { readFlow } from "../src/flows/static-read";
import {
  type FlowStepLaunch,
  type FlowStepOrigin,
  type FlowStepSession,
  stepFailed,
} from "../src/flows/steps";
import type { FlowHostTimings } from "../src/flows/supervisor";
import * as words from "../src/flows/words";
import { RpcCallError } from "../src/native-link";
import { recordsUnreadable, UNREADABLE_WORDS } from "../src/signed-record";
import type { GrantPrincipal } from "../src/terminal-grants";
import {
  type FlowChangedRaise,
  type FlowItemRaise,
  type FlowItemRaised,
  type FlowItemStarted,
  type NeedsAnswered,
  NeedsQueue,
} from "../src/tool-plane/rooms/you/queue";
import { NeedsStore } from "../src/tool-plane/rooms/you/store";
import { fakeAgent } from "./flow-step-agent";
import { flowsHostLaunch, standInSource } from "./flows-host-bundle";
import { beganRun } from "./flows-run-records";

// CP-4a2b (§13a slice 7; 13a v2.7, RULED 2026-11-05; D3, D8, D18, CP4-Q5 (a), CP4-Q20 (a)) — the runs: a start, its
// refusals, the bytes it runs, its scope and its bounds, over the REAL flow host and fieldd's real flow records, the
// ports faked. A start reads the flow against its approval and runs the bytes fieldd kept, its record first (D18); a
// changed or new flow asks before any run (N5's item); the bounds are held before any journal line (D3).

const PATH_ONLY = { PATH: process.env["PATH"] ?? "/usr/bin:/bin" };
const VELA = "sp-7k2m9q4x";
const VELA_FROM = { spark: VELA, name: "Vela", session: "run-vela" };
const WAIT_MS = 20_000;

/** A flow that logs one line and returns: no step, no gate. */
const HELLO = [
  'export const meta = { name: "Hello" };',
  "export default async function () {",
  '  log("hi");',
  '  return "done";',
  "}",
  "",
].join("\n");
/** The same flow, edited after its approval. */
const HELLO_EDITED = HELLO.replace('log("hi")', 'log("hello again")');
/** A flow its static read refuses (the sandbox's eval shape, Q-B3 (a)), as a newer read rule refuses a script
 * approved before it (Q-a). */
const EVALS = [
  'export const meta = { name: "Evals" };',
  "export default async function () {",
  '  log(String(eval("1 + 1")));',
  "}",
  "",
].join("\n");
/** A flow that takes one input. */
const TAKES_TARGET = [
  'export const meta = { name: "Targets", input: { target: "session" } };',
  "export default async function ({ target }) {",
  '  log("target: " + target);',
  "}",
  "",
].join("\n");

const roots: string[] = [];
const opened: FlowRuns[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((runs) => runs.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A step's spawn as the runtime was asked for it, and the run's open steps when it was asked (D5: entry first). */
interface Spawned {
  readonly launch: FlowStepLaunch;
  readonly origin: FlowStepOrigin;
  readonly open: readonly FlowRunRecordStep[];
}
/** A line queued for a session, and its step's record when it was queued (D5: the intent first). */
interface Enqueued {
  readonly runtimeRunId: string;
  readonly text: string;
  readonly from: AgentInputSender;
  readonly step: FlowRunRecordStep | undefined;
}
/** A host child the runs started (slice 10a): when it started, and when it left. */
interface Host {
  readonly child: ChildProcess;
  readonly at: number;
  leftAt?: number;
  /** J1 (F3) — the ids of the call frames its child sent on fd 3, as it sent them, when the row counts them
   * (`frames`); none else */
  readonly calls: number[];
}

/** J1 (F3) — each call frame `child` sends fieldd on its fd 3 (protocol.ts: one JSON message a line), its id pushed to
 * `calls`. A second listener beside the supervisor's own reader, attached before it (the supervisor attaches its own
 * in the same turn as its spawn, supervisor.ts), so a frame is counted before fieldd hears it. */
function countCalls(child: ChildProcess, calls: number[]): void {
  let rest = "";
  (child.stdio[3] as Duplex | null | undefined)?.on("data", (chunk: Buffer) => {
    const lines = `${rest}${chunk.toString("utf8")}`.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const frame = JSON.parse(line) as { readonly t?: unknown; readonly id?: unknown };
        if (frame.t === "call" && typeof frame.id === "number") calls.push(frame.id);
      } catch {
        // a line that is no frame is fieldd's to refuse (`protocol`), not this count's
      }
    }
  });
}
/** A session an `in:` handed a step, as the runs told the step listener (9b): how many lines were queued at the hand,
 * and whether the runs let it go. */
interface Handed {
  readonly runtimeRunId: string;
  readonly run: string;
  readonly call: number;
  readonly at: number;
  gone: boolean;
}

/** UU3 (the 1p review) — D1's idle for every row that passes none: long past any row, so no park enters a row that
 * isn't about one. No row exercises fieldd's own HOST_IDLE_MS (10 s) by timing: a row that parks passes IDLE_MS or
 * HOLD_IDLE_MS. */
const NO_PARK_MS = 600_000;

/** Slice 11a (Q5 §4) — a REAL needs queue in `root`, as fieldd keeps one: its signed store in the row's root, and every
 * option a flow run's item never reads throwing, so a row that reaches one fails saying which. */
function needsQueueIn(root: string): NeedsQueue {
  const unread = (what: string) => (): never => {
    throw new Error(`a flow run's item never reads the needs queue's ${what}`);
  };
  return new NeedsQueue({
    store: new NeedsStore({ dir: join(root, "needs"), keyPath: join(root, "needs.key") }),
    inputs: { wake: unread("inputs"), enqueue: unread("inputs") },
    run: unread("runs"),
    personaSets: unread("persona map"),
    sparkSession: unread("spark sessions"),
    spark: unread("sparks"),
    open: unread("spark wake"),
    spawn: unread("spawn"),
    agentLabel: unread("catalog"),
  });
}

async function harness(
  opts: {
    readonly profiles?: readonly string[];
    /** the host a run starts: fieldd's own build, or a stand-in's */
    readonly launch?: FlowsHostLaunch;
    /** a copy of VibeField that can't start a flow's host, and why (Q-b) */
    readonly unconfigured?: string;
    /** the runtime's refusal of every spawn, in its words */
    readonly spawnRefuses?: string;
    /** the sessions fieldd knows, by their runtime run id */
    readonly sessions?: Readonly<Record<string, FlowStepSession>>;
    /** the folders inputs name, by `<kind>:<value>` */
    readonly folders?: Readonly<Record<string, string>>;
    /** the agents the catalog offers, by id, to the catalog's name for each */
    readonly offers?: Readonly<Record<string, string>>;
    /** the models the runtime discovers, by agent */
    readonly models?: Readonly<Record<string, readonly string[]>>;
    /** the runtime's models held until this settles, each ask counted (RA2: both starts parked at their await) */
    readonly modelsHeld?: Promise<unknown>;
    /** D1's idle before a waiting host is parked: NO_PARK_MS, unless a row that parks lowers it (slice 10a) */
    readonly hostIdleMs?: number;
    /** the host's clock, a `shutdown`'s grace among it (R27d) */
    readonly timings?: Partial<FlowHostTimings>;
    /** the project folders this desktop knows */
    readonly projectFolders?: readonly string[];
    /** each spark's own Agent Profile */
    readonly sparkProfiles?: Readonly<Record<string, string>>;
    /** the person's default Agent Profile; null for none */
    readonly defaultProfile?: string | null;
    /** the sessions the step listener never heard enter: a hand on one answers none (review F3) */
    readonly unheard?: readonly string[];
    /** the step listener itself (flow-step-events.ts), for a row whose turn ends go through it (slices 7–9 review F3):
     * the harness's endTurn then reaches nothing */
    readonly stepEvents?: FlowStepEvents;
    /** slice 11a (Q5 §4, on F3's precedent): the needs port a REAL NeedsQueue (`needsQueueIn`), bound to the runs'
     * acts as slice 15 binds them and answered as a window answers it, so a gate's re-bind (D2) and `minted` are the
     * queue's own. The fake stays the default: it mints every raise, and is never taught the re-bind */
    readonly needsQueue?: boolean;
    /** slice 11a (Q8's repair rider): what the needs port's flowItem throws at every raise, once `items` counts it, as
     * a needs queue whose store refuses the item throws its refusal; nothing is minted */
    readonly flowItemThrows?: Error;
    /** slice 13 (R41 (i), R40e): every agent's end held until this settles, each asked counted first (`ends`) */
    readonly endHeld?: Promise<unknown>;
    /** slice 13 (R40f): the session whose end the floor refuses: its `agents.end` rejects, and it lives on */
    readonly endRejects?: string;
    /** slice 13 (R42d, on modelsHeld's precedent): every spawn held, once asked and counted, until this settles */
    readonly spawnHeld?: Promise<unknown>;
    /** slice 13 (R42b, AA3): the sessions `sessions.ofRun` leaves out, as a fold read that lags */
    readonly ofRunOmits?: readonly string[];
    /** slice 13 (R40, D19): the sessions whose working turn a run's own line began (`began` answers true) */
    readonly beganIn?: readonly string[];
    /** J1: the store's bound on a journal's bytes, lowered (FlowRecordsOptions.journalMaxBytes); its default else */
    readonly journalMaxBytes?: number;
    /** J1 (F3): each host's call frames counted as its child sends them (`Host.calls`) */
    readonly frames?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "vf-flow-runs-"));
  roots.push(root);
  const libraryDir = join(root, "flows");
  mkdirSync(libraryDir);
  const records = new FlowRecords({
    dir: join(root, "fieldd", "flows"),
    keyPath: join(root, "fieldd", "flows.key"),
    journalMaxBytes: opts.journalMaxBytes,
  });
  const library = new FlowLibrary({ dir: libraryDir, records });
  const raised: FlowChangedRaise[] = [];
  let profiles: readonly string[] = opts.profiles ?? ["work", "review"];
  /** each spark by its name and its Agent Profiles now (CP-L4): a spark not here is gone */
  const sparks = new Map<string, FlowRunSpark>([
    [VELA, { name: "Vela", profiles: ["work", "review"] }],
  ]);
  const spawned: Spawned[] = [];
  const enqueued: Enqueued[] = [];
  const hands: Handed[] = [];
  const items: FlowItemRaise[] = [];
  /** slice 11a — what the needs port answered each raise in `items`, in order: its item, and whether the raise minted
   * it (Q5: the hold-wake's witness) */
  const raisedAs: FlowItemRaised[] = [];
  const needs = opts.needsQueue === true ? needsQueueIn(root) : undefined;
  /** slice 11b (Q10) — each fact the runs told a spark through their `waker` port, in order: the recording fake */
  const facts: { readonly spark: string; readonly fact: string }[] = [];
  const turnListeners = new Set<(end: FlowStepTurnEnd) => void>();
  /** how many times a step asked the runtime for its models */
  let modelAsks = 0;
  /** each host child the runs started, in order, with when it started and when it left (slice 10a) */
  const hosts: Host[] = [];
  /** the spawned sessions a row ended: the runtime holds them no longer live */
  const exited = new Set<string>();
  /** slice 13 — the sessions each spawn that returned started, by their origin (K24: a refused spawn started none) */
  const started: { readonly runtimeRunId: string; readonly run: string; readonly call: number }[] =
    [];
  /** slice 13 — what the runs' new ports were asked, in order: each agent's end and each pause, by session; each run
   * whose lines were withdrawn, and whose items were ended */
  const ends: string[] = [];
  const paused: string[] = [];
  const withdrawn: string[] = [];
  const itemsEnded: string[] = [];
  /** slice 13 (R40, D4) — the ports' asks in one ordered log, `withdraw:‹run›`, `items:‹run›`, `pause:‹session›`,
   * `end:‹session›`; a row adds what it reads beside them (its record's states, the `end` line) */
  const order: string[] = [];
  /** what fieldd's log was told at warn, in order */
  const warned: { event: string; fields: LogFields | undefined }[] = [];
  /** what fieldd's log was told at error, in order, its third argument as given */
  const errored: { event: string; error: unknown }[] = [];
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event, _message, fields) => void warned.push({ event, fields }),
    error: (event, _message, error) => void errored.push({ event, error }),
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  /** a step's turn ended, as flow-step-events.ts tells it */
  const endTurn = (end: FlowStepTurnEnd) => {
    for (const listener of turnListeners) listener(end);
  };
  const openOf = (run: string): readonly FlowRunRecordStep[] => records.runRecord(run)?.open ?? [];
  const runs = new FlowRuns({
    library,
    records,
    needs: {
      flowChanged: (raise) => {
        raised.push(raise);
        return `ny-changed${raised.length}aaaa` as NeedsItemId;
      },
      flowItem: (raise) => {
        items.push(raise);
        if (opts.flowItemThrows !== undefined) throw opts.flowItemThrows;
        const answered = needs?.flowItem(raise) ?? {
          id: `ny-item${items.length}aaaaaa` as NeedsItemId,
          minted: true,
        };
        raisedAs.push(answered);
        return answered;
      },
      onFlowRunEnded: (run) => {
        itemsEnded.push(run);
        order.push(`items:${run}`);
        needs?.onFlowRunEnded(run);
      },
    },
    waker: { flowFact: (spark, fact) => void facts.push({ spark, fact }) },
    began: (runtimeRunId) => opts.beganIn?.includes(runtimeRunId) === true,
    stepEnds: opts.stepEvents ?? {
      onTurnEnd: (listener) => {
        turnListeners.add(listener);
        return () => turnListeners.delete(listener);
      },
      hand: (runtimeRunId, step) => {
        if (opts.unheard?.includes(runtimeRunId)) return undefined;
        const handed: Handed = { runtimeRunId, ...step, at: enqueued.length, gone: false };
        hands.push(handed);
        return () => {
          handed.gone = true;
        };
      },
    },
    profiles: () => profiles,
    sparkOf: (spark) => sparks.get(spark),
    agents: {
      spawn: async (launch, origin) => {
        spawned.push({ launch, origin, open: openOf(origin.run) });
        const runtimeRunId = `rt-step${spawned.length}`;
        if (opts.spawnRefuses !== undefined) throw new Error(opts.spawnRefuses);
        if (opts.spawnHeld !== undefined) await opts.spawnHeld;
        started.push({ runtimeRunId, run: origin.run, call: origin.call });
        return { runtimeRunId };
      },
      end: async (runtimeRunId) => {
        ends.push(runtimeRunId);
        order.push(`end:${runtimeRunId}`);
        if (opts.endHeld !== undefined) await opts.endHeld;
        if (runtimeRunId === opts.endRejects)
          throw new Error(`the floor could not be asked to end ${runtimeRunId}`);
        exited.add(runtimeRunId);
      },
      pause: async (runtimeRunId) => {
        paused.push(runtimeRunId);
        order.push(`pause:${runtimeRunId}`);
        return { accepted: true };
      },
      offers: (agent) => {
        const label = (opts.offers ?? { claude: "Claude Code" })[agent];
        return label !== undefined ? { label } : undefined;
      },
      models: async (agent) => {
        modelAsks += 1;
        if (opts.modelsHeld !== undefined) await opts.modelsHeld;
        return (opts.models ?? { claude: ["opus", "sonnet"] })[agent];
      },
    },
    inputs: {
      enqueue: (runtimeRunId, text, from) => {
        const step =
          from.kind === "flow" ? openOf(from.run).find((s) => s.call === from.call) : undefined;
        enqueued.push({ runtimeRunId, text, from, step });
        return { id: `in-${enqueued.length}`, position: 1 };
      },
      withdraw: (run) => {
        withdrawn.push(run);
        order.push(`withdraw:${run}`);
        return [];
      },
    },
    sessions: {
      // a step's session the runtime spawned is live until a row ends it (D2's lookup reads it at a wake)
      of: (runtimeRunId) =>
        opts.sessions?.[runtimeRunId] ??
        (spawned.some((_, i) => `rt-step${i + 1}` === runtimeRunId)
          ? { live: !exited.has(runtimeRunId), onPermission: false }
          : undefined),
      // slice 13 (Q4 (a)): the sessions the run's spawns started, by origin, live until ended; never a handed one
      ofRun: (run) =>
        started
          .filter((at) => at.run === run && opts.ofRunOmits?.includes(at.runtimeRunId) !== true)
          .map(({ runtimeRunId, call }) => ({
            runtimeRunId,
            call,
            live: !exited.has(runtimeRunId),
          })),
    },
    folderOf: (kind, value) => opts.folders?.[`${kind}:${value}`],
    projectFolders: () => opts.projectFolders ?? ["/work"],
    sparkProfile: (spark) => (opts.sparkProfiles ?? { [VELA]: "work" })[spark],
    defaultProfile: () =>
      opts.defaultProfile === null ? undefined : (opts.defaultProfile ?? "work"),
    host: {
      launch:
        opts.unconfigured !== undefined
          ? { kind: "unconfigured", reason: opts.unconfigured }
          : { kind: "launch", launch: opts.launch ?? (await flowsHostLaunch()) },
      environment: PATH_ONLY,
      ...(opts.timings !== undefined ? { timings: opts.timings } : {}),
      spawn: (command, args, options) => {
        const child = spawnChild(command, args, options);
        const host: Host = { child, at: Date.now(), calls: [] };
        if (opts.frames === true) countCalls(child, host.calls);
        child.once("exit", () => {
          host.leftAt = Date.now();
        });
        hosts.push(host);
        return child;
      },
    },
    hostIdleMs: opts.hostIdleMs ?? NO_PARK_MS,
    logger,
  });
  opened.push(runs);
  needs?.bindFlowActs(runs.acts);
  /** a flow's file in the person's library, as they saved it */
  const write = (flow: string, text: string): Uint8Array => {
    writeFileSync(join(libraryDir, `${flow}.flow.js`), text);
    return new TextEncoder().encode(text);
  };
  /** a flow saved and approved as it stands */
  const approved = (flow: string, text: string) => records.approve(flow, write(flow, text));
  const start = (params: Partial<FlowRunStartParams> = {}): Promise<FlowRunStarted> =>
    runs.start({ flow: "hello", input: {}, starter: { by: "you" }, scope: ["work"], ...params });
  const setProfiles = (next: readonly string[]) => {
    profiles = next;
  };
  /** a spark's Agent Profiles from now on, or (undefined) the spark gone */
  const setSparkScope = (spark: string, scope: readonly string[] | undefined) => {
    const known = sparks.get(spark);
    if (scope === undefined) sparks.delete(spark);
    else sparks.set(spark, { name: known?.name ?? spark, profiles: scope });
  };
  /** the run's journal's lines' kinds, as the store reads it now */
  const kinds = (run: string): string[] => {
    const read = records.readRun(run);
    return read.kind === "kept" ? read.lines.map((line) => line.kind) : [read.kind];
  };
  return {
    root,
    records,
    library,
    runs,
    raised,
    items,
    raisedAs,
    /** slice 11a: the row's real needs queue, when it asked for one (`needsQueue`) */
    needs,
    /** slice 11b: whom the runs told, and what, through their `waker` port (Q10) */
    facts,
    endTurn,
    spawned,
    enqueued,
    hands,
    write,
    approved,
    start,
    setProfiles,
    setSparkScope,
    kinds,
    warned,
    errored,
    modelAsks: () => modelAsks,
    hosts,
    /** the runtime's session `runtimeRunId` ends: D2's lookup reads it exited */
    exit: (runtimeRunId: string) => void exited.add(runtimeRunId),
    /** slice 13: what the runs' new ports were asked (agents ended and paused, lines withdrawn, items ended), and in
     * what order */
    ends,
    paused,
    withdrawn,
    itemsEnded,
    order,
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** The run a start started, or the row fails saying what it got instead. */
function startedRun(started: FlowRunStarted): RunSummary {
  if (!("run" in started)) throw new Error(`the start waits in ${started.waits}`);
  return started.run;
}

/** Slice 11a — the row's real needs queue (`needsQueue`), or the row fails saying it has none. */
function needsOf(h: Harness): NeedsQueue {
  if (h.needs === undefined) throw new Error("this row's harness has no needs queue");
  return h.needs;
}

/** Slice 11a — the person, as a window's answer to an item names them. */
const PRINCIPAL: GrantPrincipal = { kind: "local-token" };

/** The summary `run` reads once it reads `state`, as onChange says it. */
function settled(runs: FlowRuns, run: string, state: string): Promise<RunSummary> {
  return new Promise((resolve, reject) => {
    let done = false;
    let off: (() => void) | undefined;
    const timer = setTimeout(() => {
      done = true;
      off?.();
      reject(new Error(`${run} never read ${state}`));
    }, WAIT_MS);
    off = runs.onChange((list) => {
      const found = list.runs.find((summary) => summary.run === run);
      if (done || found?.state !== state) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => off?.());
      resolve(found);
    });
  });
}

/** A start's refusal: its reason and its words, or "started". */
async function refusalOf(
  start: Promise<unknown>,
): Promise<{ reason?: string; message: string } | "started"> {
  try {
    await start;
    return "started";
  } catch (err) {
    const e = err as RpcCallError;
    const details = e.details as { reason?: string } | undefined;
    return {
      ...(details?.reason !== undefined ? { reason: details.reason } : {}),
      message: e.message,
    };
  }
}

/** A run kept in the store as the runs keep one, with no host: what the bounds and the list count. */
function seeded(h: Harness, i: number, state: string, starter: FlowStarter = { by: "you" }) {
  return beganRun(
    h.records,
    {
      run: `fr-seed${String(i).padStart(4, "0")}x`,
      flow: "hello",
      name: "Hello",
      n: i + 1,
      hash: "a".repeat(64),
      starter,
    },
    {
      state,
      ...(state === "running"
        ? {}
        : { endedAt: new Date(Date.UTC(2026, 10, 5, 0, i)).toISOString() }),
    },
  );
}

describe("CP-4a2b — a run starts from the bytes fieldd kept, or asks first; its scope and its bounds (§13a slice 7)", () => {
  it("R1: a run starts from the approved bytes, its record first, through the one wake, and its host runs the script to its end", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const summary = startedRun(await h.start());
    expect(RunSummary.parse(summary)).toMatchObject({
      flow: "hello",
      name: "Hello",
      n: 1,
      hash: approval.hash,
      state: "running",
      calls: 0,
      steps: [],
      starter: { by: "you" },
    });
    // D18: the run's own record stands from its start, with what the runs chose of it
    expect(h.records.runRecord(summary.run)).toMatchObject({
      scope: ["work"],
      calls: 0,
      open: [],
      steps: [],
    });
    // slice 12, the cap out (the C ruling, 2026-11-07): the record keeps no allowance
    expect(h.records.runRecord(summary.run)).not.toHaveProperty("allowed");
    // the host runs it: its log line is journaled, the run ends done, and its last log line is its summary's
    const done = await settled(h.runs, summary.run, "done");
    expect(done.log).toBe("hi");
    expect(done.endedAt).toBeDefined();
    const read = h.records.readRun(summary.run);
    expect(read.kind === "kept" ? read.lines.map((line) => line.kind) : read.kind).toEqual([
      "head",
      "log",
      "end",
    ]);
    expect(h.records.runRecord(summary.run)).toMatchObject({ state: "done", log: "hi" });
    // the same flow run again is its 2nd on this desktop
    const second = startedRun(await h.start());
    expect(second.n).toBe(2);
    await settled(h.runs, second.run, "done");
  });

  it("R1b (Q-a, ruled 2026-11-06; NN1, 2026-11-06): a once-approved script the static read now refuses is refused at its start, before any journal line, its read's own words in §9's frame with the line they name, none for a whole-file refusal; its approval stands, and Run this version of one approves nothing", async () => {
    const h = await harness();
    const approval = h.approved("evals", EVALS);
    const evals = "VibeField can't start Evals: it calls eval(), which a flow may not (line 3).";
    expect(await refusalOf(h.start({ flow: "evals" }))).toEqual({ reason: "read", message: evals });
    // one reader, one gate: Run this version of a version the read refuses is refused there too, before its approval
    const edited = h.write("evals", `${EVALS}// edited\n`);
    const waits = waitsOf(await h.start({ flow: "evals" }));
    const act = h.runs.acts.start({
      id: waits,
      flow: "evals",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    expect(await act).toEqual({ outcome: "failed", reason: evals });
    expect(h.records.approval("evals")?.hash).toBe(approval.hash);
    // a whole-file refusal names no line, so its frame says none (NN1, ruled 2026-11-06): Run this version of one
    const hello = h.approved("hello", HELLO);
    const whole = h.write("hello", 'export const meta = { name: "Hello" };\n');
    const asked = waitsOf(await h.start());
    const wholeAct = h.runs.acts.start({
      id: asked,
      flow: "hello",
      hash: flowHashOf(whole),
      version: "this",
      start: askedOf(h, 1),
    });
    expect(await wholeAct).toEqual({
      outcome: "failed",
      reason: "VibeField can't start Hello: it exports no default function to run.",
    });
    expect(h.records.approval("hello")?.hash).toBe(hello.hash);
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
  });

  it("R1c (Q-b): a copy of VibeField that can't start a flow's host refuses a run at its start in §9's host words, UNAVAILABLE as the flows' doors say it, and records nothing; an act on a kept start is refused the same way", async () => {
    const h = await harness({ unconfigured: "no flows host beside fieldd" });
    const approval = h.approved("hello", HELLO);
    // EL9 (the version review NN4): the refusal's data is the contract's, as its fixture pins it, never restated
    const fixture = join(
      import.meta.dirname,
      "../../contracts/fixtures/error-data.flows-host-unavailable.json",
    );
    const unavailable = ErrorData.parse(JSON.parse(readFileSync(fixture, "utf8")));
    const refusal = await h.start().then(
      () => undefined,
      (error: RpcCallError) => error,
    );
    expect(refusal?.message).toBe(words.hostUnconfigured());
    const data = ErrorData.parse({
      kind: refusal?.kind,
      retryable: refusal?.retryable,
      details: refusal?.details,
    });
    expect(data).toEqual(unavailable);
    // an item raised before the host went missing is acted on now: refused, nothing begun
    const act = h.runs.acts.start({
      id: "ny-0f2e4d6c8b0a1928" as NeedsItemId,
      flow: "hello",
      hash: approval.hash,
      version: "approved",
      start: { input: {}, starter: { by: "you" }, scope: ["work"] },
    });
    expect(await act).toEqual({ outcome: "failed", reason: words.hostUnconfigured() });
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
  });

  it("R1d: an approval whose kept bytes no longer hash to it (an agent edited them) starts nothing, refused at its start in §9's version words before any journal line", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const kept = join(h.root, "fieldd", "flows", "bytes", `${approval.hash}.flow.js`);
    writeFileSync(kept, 'export const meta = { name: "Edited" };\n');
    expect(await refusalOf(h.start())).toEqual({
      reason: "version",
      message: words.notAVersion("hello"),
    });
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
  });

  it("R2/R3: a flow changed since its approval, and one never approved, ask before any run: the item names the bytes, and nothing is journaled or kept", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    expect(await h.start()).toEqual({ waits: "ny-changed1aaaa" });
    // Q4 (ruled 2026-11-06 (c)): the item's record keeps the start as it was asked, so an act begins this same run
    expect(h.raised).toEqual([
      {
        script: { flow: "hello", hash: flowHashOf(edited), approved: approval.hash },
        name: "Hello",
        start: { input: {}, starter: { by: "you" }, scope: ["work"] },
      },
    ]);
    // a spark's flow_run of a flow never approved: its item tells that spark
    const fresh = h.write("targets", TAKES_TARGET);
    expect(
      await h.start({
        flow: "targets",
        starter: { by: "spark", spark: VELA },
        from: VELA_FROM,
        scope: ["work"],
      }),
    ).toEqual({ waits: "ny-changed2aaaa" });
    expect(h.raised[1]).toEqual({
      script: { flow: "targets", hash: flowHashOf(fresh) },
      name: "Targets",
      from: VELA_FROM,
      start: { input: {}, starter: { by: "spark", spark: VELA }, scope: ["work"] },
    });
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
    expect(h.runs.list().runs).toEqual([]);
  });

  it("R7 (D8): a run's scope is frozen at its start, and narrows to the profiles that exist now, never widening", async () => {
    const h = await harness({ profiles: ["work", "review", "home"] });
    h.approved("hello", HELLO);
    const summary = startedRun(await h.start({ scope: ["work", "review"] }));
    expect(h.runs.read(summary.run)).toMatchObject({
      starter: { by: "you" },
      scope: ["work", "review"],
    });
    h.setProfiles(["work", "home"]);
    expect(h.runs.read(summary.run)?.scope).toEqual(["work"]);
    h.setProfiles(["work", "review", "home", "play"]);
    expect(h.runs.read(summary.run)?.scope).toEqual(["work", "review"]);
    expect(h.records.runRecord(summary.run)?.scope).toEqual(["work", "review"]);
    expect(h.runs.read("fr-nosuchrun")).toBeUndefined();
    await settled(h.runs, summary.run, "done");
  });

  it("R8: a start is refused, in §9's words, for a flow not in the library, a file past its bound, and an input the flow does not take", async () => {
    // the session its input names is one VibeField can find (R8b)
    const h = await harness({ folders: { "session:run-1": "/work/one" } });
    expect(await refusalOf(h.start({ flow: "nowhere" }))).toEqual({
      reason: "not-found",
      message: "VibeField can't find nowhere in your flows.",
    });
    h.write("huge", `// ${"x".repeat(FLOW_LIMITS.SCRIPT_MAX_BYTES)}\n`);
    expect(await refusalOf(h.start({ flow: "huge" }))).toEqual({
      reason: "too-big",
      message: "Its file is larger than a flow may be (64 KiB).",
    });
    h.approved("targets", TAKES_TARGET);
    expect(
      await refusalOf(h.start({ flow: "targets", input: { target: "run-1", branch: "main" } })),
    ).toEqual({
      reason: "input",
      message: "Targets takes no input named branch; nothing was started.",
    });
    expect(h.records.runs()).toEqual([]);
    // the input it does take is its run's, as the journal's head keeps it
    const summary = startedRun(await h.start({ flow: "targets", input: { target: "run-1" } }));
    const read = h.records.readRun(summary.run);
    expect(read.kind === "kept" ? read.head.input : read.kind).toEqual({ target: "run-1" });
    expect((await settled(h.runs, summary.run, "done")).log).toBe("target: run-1");
  });

  it("R9: onChange tells a snapshot, then each change, from the records; list() holds at most 64, the live runs first and the rest counted", async () => {
    const h = await harness();
    for (let i = 0; i < 70; i += 1) seeded(h, i, "done");
    for (let i = 70; i < 73; i += 1) seeded(h, i, "running");
    const list = h.runs.list();
    for (const summary of list.runs) RunSummary.parse(summary);
    expect(list.runs).toHaveLength(FLOW_RUNS_LISTED_MAX);
    expect(list.runs.slice(0, 3).map((summary) => summary.state)).toEqual([
      "running",
      "running",
      "running",
    ]);
    expect(list.runs[3]?.run).toBe("fr-seed0069x");
    expect(list.earlier).toBe(73 - FLOW_RUNS_LISTED_MAX);
    const frames: FlowRunsList[] = [];
    const off = h.runs.onChange((frame) => frames.push(frame));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(list);
    h.approved("hello", HELLO);
    const summary = startedRun(await h.start());
    await settled(h.runs, summary.run, "done");
    off();
    const seen = frames.length;
    expect(seen).toBeGreaterThan(1);
    expect(frames.some((frame) => frame.runs.some((run) => run.run === summary.run))).toBe(true);
    // once off, it is told nothing more
    await settled(h.runs, startedRun(await h.start()).run, "done");
    expect(frames).toHaveLength(seen);
  });

  it("R11 (D3): a 9th run, and a spark's 3rd of its own, are refused before any journal line, in §9's words", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    for (let i = 0; i < FLOW_LIMITS.RUNS_LIVE_MAX; i += 1) seeded(h, i, "running");
    expect(await refusalOf(h.start())).toEqual({
      reason: "runs-live",
      message:
        "VibeField is running 8 flows, as many as it runs at once. Stop one, or run Hello when one ends.",
    });
    expect(h.records.runs()).toHaveLength(FLOW_LIMITS.RUNS_LIVE_MAX);

    const s = await harness();
    s.approved("hello", HELLO);
    const own = { by: "spark", spark: VELA } as const;
    for (let i = 0; i < FLOW_LIMITS.RUNS_PER_SPARK_MAX; i += 1) seeded(s, i, "running", own);
    // one ended run of its own does not count
    seeded(s, 9, "done", own);
    expect(await refusalOf(s.start({ starter: own, from: VELA_FROM }))).toEqual({
      reason: "runs-per-spark",
      message: "Vela is running 2 flows, as many as a spark may.",
    });
    expect(s.records.runs()).toHaveLength(FLOW_LIMITS.RUNS_PER_SPARK_MAX + 1);
    // a run you start in Vela's thread is yours, not the spark's own
    const yours = startedRun(await s.start({ starter: { by: "you", spark: VELA } }));
    await settled(s.runs, yours.run, "done");
  });

  it("says each refusal in DESIGN.md's own words (§9 \"When a run can't start\")", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      words.notFound("‹flow›"),
      words.tooBig(),
      words.noSuchInput("‹flow›", "‹name›"),
      words.runsLive("‹flow›"),
      words.runsPerSpark("‹spark›"),
      words.noSparkProfiles("‹spark›"),
      words.noProfiles(),
      words.notAVersion("‹flow›"),
      words.hostUnconfigured(),
      words.readRefused("‹flow›", "‹the read's words›"),
      // ‹n› is the line the read names: said here at 7, and read back as §9 writes it
      words.readRefused("‹flow›", "‹the read's words›", 7).replace("(line 7)", "(line ‹n›)"),
    ]) {
      expect(said).not.toBe("");
      expect(design, said).toContain(`"${said}"`);
    }
    // ‹flow› is the meta name, and a name that is or starts with "VibeField" shows the slug (R18's rule, at the start)
    expect(words.markName("Release check", "release-check")).toBe("Release check");
    expect(words.markName("  vibefield release", "release-check")).toBe("release-check");
    expect(words.markName(undefined, "release-check")).toBe("release-check");
  });
});

// CP-4a2b (§13a slice 8a; D5, D9) — a step's agent, by the ONE spawn road (steps.ts `startStep`): the record's step
// entry before the spawn, the session on the record and the prompt's `sending` intent before it is queued, and
// `queued` in the tick the queue takes it; the prompt is the run's own words, marked as the flow's (Q-B1 (a)).

/** A flow with one step, its every option a step's card shows. */
const REVIEW = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  '  return await agent("Review the diff", {',
  '    agent: "claude",',
  '    label: "Diff",',
  '    phase: "check",',
  '    profile: "work",',
  '    cwd: "/work/app",',
  "  });",
  "}",
  "",
].join("\n");
/** The same step, its refusal caught and said as the run's log line. */
const REVIEW_CATCHES = REVIEW.replace(
  '  return await agent("Review the diff", {',
  '  try { await agent("Review the diff", {',
).replace("  });\n}", "  }); } catch (e) { log(e.message); }\n}");
/** A flow whose meta name would speak as VibeField: its mark is its slug (R18). */
const SPEAKS_AS_VIBEFIELD = REVIEW.replace('name: "Review"', 'name: "VibeField release"').replace(
  'label: "Diff"',
  'label: "Notes"',
);

/** A stand-in host that calls a `what` no flow has, and says the answer it got as its one log line. */
function unknownCallHost(root: string): FlowsHostLaunch {
  const file = join(root, "unknown-call.cjs");
  writeFileSync(
    file,
    standInSource([
      "say({ t: 'ready', pid: process.pid });",
      "on((m) => {",
      "  if (m && m.t === 'run') say({ t: 'call', id: 1, what: 'spawn', args: ['rm -rf /'] });",
      "  if (m && m.t === 'answer') say({ t: 'log', text: String(m.refused) });",
      "  if (m && m.t === 'ping') say({ t: 'pong', n: m.n });",
      "  if (m && m.t === 'shutdown') process.exit(0);",
      "});",
    ]),
  );
  return { command: process.execPath, args: [file] };
}

const waitFor = (check: () => void): Promise<void> =>
  vi.waitFor(check, { timeout: WAIT_MS, interval: 20 });

describe("CP-4a2b — a step's agent, by the one spawn road: entry first, then the spawn, then the prompt queued (§13a slice 8a)", () => {
  it("R12 (D5): one spawn, origin {by: flow, run, call: 1}, after the step's entry; the prompt queued as the flow's words after its sending intent, and queued in the same tick", async () => {
    const h = await harness();
    h.approved("review", REVIEW);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.spawned).toHaveLength(1);
    const [spawn] = h.spawned;
    expect(spawn?.launch).toEqual({
      agent: "claude",
      profileSet: "work",
      cwd: "/work/app",
      title: "Review · Diff",
    });
    expect(spawn?.origin).toEqual({ by: "flow", run, call: 1 });
    // D5 step 2: the step's entry is on the record before the spawn
    expect(spawn?.open).toEqual([
      { call: 1, label: "Diff", agent: "claude", phase: "check", state: "starting" },
    ]);
    // D5 steps 4–6: the session and the prompt's intent are on the record before the queue takes it
    const [line] = h.enqueued;
    expect(line).toEqual({
      runtimeRunId: "rt-step1",
      text: "Review the diff",
      from: { kind: "flow", flow: "review", name: "Review", run, call: 1 },
      step: {
        call: 1,
        label: "Diff",
        agent: "claude",
        phase: "check",
        session: "rt-step1",
        state: "working",
        lines: [{ line: "prompt", n: 1, sent: "sending" }],
      },
    });
    // D5 step 7: `queued`, in the tick the queue took it; the call counted (D10)
    expect(h.records.runRecord(run)).toMatchObject({
      calls: 1,
      open: [
        {
          call: 1,
          session: "rt-step1",
          state: "working",
          lines: [{ line: "prompt", n: 1, sent: "queued" }],
        },
      ],
    });
    expect(h.runs.read(run)?.summary.steps).toEqual([
      {
        call: 1,
        label: "Diff",
        agent: "claude",
        session: "rt-step1",
        phase: "check",
        state: "working",
      },
    ]);
    expect(h.kinds(run)).toEqual(["head", "call"]);

    // a run a spark started: its step's words are marked as that spark's flow (Q-B2 (a))
    const s = await harness();
    s.approved("review", REVIEW);
    const sparks = startedRun(
      await s.start({ flow: "review", starter: { by: "spark", spark: VELA }, from: VELA_FROM }),
    ).run;
    await waitFor(() => expect(s.enqueued).toHaveLength(1));
    expect(s.enqueued[0]?.from).toEqual({
      kind: "flow",
      flow: "review",
      name: "Review",
      run: sparks,
      call: 1,
      ran: "Vela",
    });
  });

  it("R12b: a spawn the runtime refuses is the step's refusal, in §9's words: journaled, the step failed, nothing queued", async () => {
    const h = await harness({ spawnRefuses: "the floor is not answering" });
    h.approved("review", REVIEW_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    const done = await settled(h.runs, run, "done");
    expect(done.log).toBe("VibeField couldn't start Diff: the floor is not answering");
    expect(h.spawned).toHaveLength(1);
    expect(h.enqueued).toEqual([]);
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
    expect(h.records.runRecord(run)).toMatchObject({
      calls: 1,
      open: [],
      steps: [{ call: 1, label: "Diff", state: "failed" }],
    });
  });

  it("R17 (D9): a call no flow makes is refused at fieldd's side and journaled as the refusal; nothing is spawned", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-flow-standin-"));
    roots.push(root);
    const h = await harness({ launch: unknownCallHost(root) });
    h.approved("hello", HELLO);
    const run = startedRun(await h.start()).run;
    await waitFor(() => expect(h.kinds(run)).toEqual(["head", "call", "answer", "log"]));
    const read = h.records.readRun(run);
    const lines = read.kind === "kept" ? read.lines : [];
    expect(lines[1]).toMatchObject({ kind: "call", call: 1, what: "spawn" });
    expect(lines[2]).toMatchObject({
      kind: "answer",
      call: 1,
      refused: "VibeField can't send this spawn: a flow's calls are agent() and ask()",
    });
    expect(lines[3]).toMatchObject({
      kind: "log",
      text: "VibeField can't send this spawn: a flow's calls are agent() and ask()",
    });
    expect(h.spawned).toEqual([]);
    expect(h.records.runRecord(run)).toMatchObject({ calls: 1, open: [], steps: [] });
  });

  it("R18 (D9; CL-E7-14): a flow whose meta name reads as VibeField is marked by its slug, in its steps' title and its words' mark", async () => {
    const h = await harness();
    h.approved("release-check", SPEAKS_AS_VIBEFIELD);
    const run = startedRun(await h.start({ flow: "release-check" }));
    expect(run.name).toBe("release-check");
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.spawned[0]?.launch.title).toBe("release-check · Notes");
    expect(h.enqueued[0]?.from).toMatchObject({ kind: "flow", name: "release-check" });
  });
});

// CP-4a2b (§13a slice 8b; CP4-S7) — a run's steps that hold a slot at once: LIVE_STEPS_MAX, a run's own. One more
// waits for a slot, visibly, and is never spawned past the bound. (Its start when a slot frees is slice 9's: an answer
// frees it.)

/** A fan-out of `n` steps at once, each its own label. */
const fanOut = (n: number): string =>
  [
    'export const meta = { name: "Fan" };',
    "export default async function () {",
    "  const steps = [];",
    `  for (let i = 1; i <= ${n}; i += 1)`,
    '    steps.push(agent("look at part " + i, { agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app" }));',
    "  return await Promise.all(steps);",
    "}",
    "",
  ].join("\n");

/** `n` spawned steps at once, then one handed your session by `in:`, then one more spawned (F9). */
const slotsAndAHand = (n: number): string =>
  [
    'export const meta = { name: "Slots" };',
    "export default async function () {",
    "  const steps = [];",
    `  for (let i = 1; i <= ${n}; i += 1)`,
    '    steps.push(agent("look at part " + i, { agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app" }));',
    '  steps.push(agent("Review this", { in: "run-yours", label: "Yours" }));',
    '  steps.push(agent("one more", { agent: "claude", label: "More", profile: "work", cwd: "/work/app" }));',
    "  return await Promise.all(steps);",
    "}",
    "",
  ].join("\n");

describe("CP-4a2b — a run's live steps, LIVE_STEPS_MAX at once (§13a slice 8b)", () => {
  it("R14 (CP4-S7): of 9 steps at once, 8 are spawned and the 9th waits for a slot on the record, never spawned; another run's steps are its own", async () => {
    const h = await harness();
    h.approved("fan", fanOut(FLOW_LIMITS.LIVE_STEPS_MAX + 1));
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.records.runRecord(run)?.open).toHaveLength(9));
    await waitFor(() => expect(h.enqueued).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX));
    expect(h.spawned).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX);
    const open = h.records.runRecord(run)?.open ?? [];
    expect(open.filter((step) => step.state === "working")).toHaveLength(
      FLOW_LIMITS.LIVE_STEPS_MAX,
    );
    expect(open.find((step) => step.call === 9)).toEqual({
      call: 9,
      label: "Part 9",
      agent: "claude",
      state: "waiting",
    });
    expect(h.spawned.map((spawn) => spawn.origin.call)).not.toContain(9);
    expect(h.runs.read(run)?.summary.steps.at(-1)).toMatchObject({ call: 9, state: "waiting" });
    expect(h.records.runRecord(run)?.calls).toBe(9);
    // a second run's steps are counted against its own bound, never the first's
    h.approved("review", REVIEW);
    const other = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() =>
      expect(h.spawned.filter((spawn) => spawn.origin.run === other)).toHaveLength(1),
    );
    expect(h.spawned).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX + 1);
  });
});

// CP-4a2b (§13a slice 8c-1; D9, CP4-Q20 (a)) — what a step's call may be, held at the call with nothing spawned, in
// DESIGN.md §9's words ("A step's call refused"): its option keys, its Agent Profile within the run's scope, an `in:`
// that names a live session within scope that is no spark's own and no other flow's and waits on no permission; and
// the folder a step with none runs in, the one its run's input names.

/** A flow that calls a step with each of `calls`' options in turn, keeping each refusal; then awaits `last`'s. */
const callsEach = (calls: readonly object[], last?: object): string =>
  [
    'export const meta = { name: "Checks", input: { target: "session" } };',
    "export default async function () {",
    `  for (const options of ${JSON.stringify(calls)}) {`,
    '    try { await agent("go", options); } catch (e) { log(e.message); }',
    "  }",
    ...(last !== undefined
      ? [`  return await agent("Review this", ${JSON.stringify(last)});`]
      : []),
    "}",
    "",
  ].join("\n");

/** The refusals a run's journal kept, in its calls' order. */
function refusalsOf(h: Harness, run: string): string[] {
  const read = h.records.readRun(run);
  return read.kind === "kept"
    ? read.lines.flatMap((line) =>
        line.kind === "answer" && line.refused !== undefined ? [line.refused] : [],
      )
    : [];
}

const IN_REFUSED =
  "VibeField didn't send ‹label›: that session is outside this run's Agent Profiles, isn't running, is a spark's or another flow's, or is waiting on a permission.";
const NO_FOLDER =
  "None of its steps names a folder, and its input names none. Run it from a session or a project, or name a folder in it.";

describe("CP-4a2b — what a step's call may be, held at the call with nothing spawned (§13a slice 8c-1)", () => {
  it("R16 (D9): a key a step may not set, and an Agent Profile outside the run's scope, are refused in §9's words with no spawn", async () => {
    const h = await harness();
    h.approved(
      "checks",
      callsEach([
        { agent: "claude", label: "Budget", cwd: "/work/app", profile: "work", budget: 5 },
        { agent: "claude", label: "Review", cwd: "/work/app", profile: "review" },
        { agent: "claude", label: "Gone", cwd: "/work/app", profile: "nowhere" },
      ]),
    );
    const run = startedRun(await h.start({ flow: "checks", scope: ["work"] })).run;
    await settled(h.runs, run, "done");
    expect(refusalsOf(h, run)).toEqual([
      "VibeField didn't start Budget: it asks for budget, which a step may not set.",
      "VibeField didn't start Review: it names an Agent Profile this run can't use (review).",
      "VibeField didn't start Gone: it names an Agent Profile this run can't use (nowhere).",
    ]);
    expect(h.spawned).toEqual([]);
    expect(h.records.runRecord(run)).toMatchObject({ calls: 3, open: [] });
    expect(h.records.runRecord(run)?.steps.map((step) => step.state)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
  });

  it("R15 (D9): an in: that names a session gone, outside the scope, another flow's step, a spark's own, or one on a permission is refused, nothing sent; your own session in scope is handed the line", async () => {
    const yours: FlowStepSession = { live: true, profile: "work", onPermission: false };
    const h = await harness({
      folders: { "session:run-yours": "/work/yours" },
      sessions: {
        "run-yours": yours,
        "run-exited": { ...yours, live: false },
        "run-home": { ...yours, profile: "home" },
        "run-other-flow": { ...yours, origin: { by: "flow", run: "fr-0ther0ther0ther0" } },
        "run-vela": { ...yours, spark: VELA },
        "run-asking": { ...yours, onPermission: true },
      },
    });
    const refused = [
      "run-nowhere",
      "run-exited",
      "run-home",
      "run-other-flow",
      "run-vela",
      "run-asking",
    ];
    h.approved(
      "checks",
      callsEach(
        refused.map((session) => ({ in: session, label: session })),
        { in: "run-yours", label: "Yours" },
      ),
    );
    const run = startedRun(
      await h.start({ flow: "checks", input: { target: "run-yours" }, scope: ["work"] }),
    ).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(refusalsOf(h, run)).toEqual(
      refused.map((session) => IN_REFUSED.replace("‹label›", session)),
    );
    expect(h.spawned).toEqual([]);
    expect(h.enqueued[0]).toEqual({
      runtimeRunId: "run-yours",
      text: "Review this",
      from: { kind: "flow", flow: "checks", name: "Checks", run, call: refused.length + 1 },
      step: {
        call: refused.length + 1,
        label: "Yours",
        session: "run-yours",
        handed: true,
        state: "working",
        lines: [{ line: "in", n: 1, sent: "sending" }],
      },
    });
    expect(h.records.runRecord(run)?.open).toEqual([
      {
        call: refused.length + 1,
        label: "Yours",
        session: "run-yours",
        handed: true,
        state: "working",
        lines: [{ line: "in", n: 1, sent: "queued" }],
      },
    ]);
  });

  it("the folder (CP4-Q20 (a)): a step with no folder runs in the one its run's input names, a session's or a project's; with none named, its call is refused in §9's words", async () => {
    const h = await harness({
      folders: { "session:run-yours": "/work/yours", "project:pj-1": "/work/pj1" },
    });
    const noFolder = (name: string, input: string) =>
      [
        `export const meta = { name: "${name}", input: ${input} };`,
        "export default async function () {",
        "  const none = {};",
        '  try { await agent("go", { agent: "claude", profile: "work", label: "Here", cwd: none.cwd }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n");
    h.approved("in-session", noFolder("In session", '{ target: "session" }'));
    h.approved("in-project", noFolder("In project", '{ where: "project" }'));
    h.approved("nowhere", noFolder("Nowhere", '{ note: "text" }'));
    const inSession = startedRun(
      await h.start({ flow: "in-session", input: { target: "run-yours" } }),
    ).run;
    const inProject = startedRun(
      await h.start({ flow: "in-project", input: { where: "pj-1" } }),
    ).run;
    await waitFor(() => expect(h.spawned).toHaveLength(2));
    const cwdOf = (run: string) => h.spawned.find((spawn) => spawn.origin.run === run)?.launch.cwd;
    expect(cwdOf(inSession)).toBe("/work/yours");
    expect(cwdOf(inProject)).toBe("/work/pj1");
    const nowhere = startedRun(await h.start({ flow: "nowhere", input: { note: "hello" } })).run;
    expect((await settled(h.runs, nowhere, "done")).log).toBe(NO_FOLDER);
    expect(h.spawned).toHaveLength(2);
  });
});

// CP-4a2b (§13a slice 8c-2; D9, A1–A3, ruled 2026-11-06, confirmed) — the rest of what a step's call
// may be, in §9's PROPOSED lines (dd7eb1c53): its agent, offered by the catalog's door; its model, a model's name the
// runtime discovered for that agent; its folder, within its run's folder or a project this desktop knows; its
// prompt, words; its Agent Profile when it names none, the spark's own or your default, held to the run's scope, and
// never the runtime's own default; and an `in:` that sets none of a spawn's keys.

const W = (label: string, why: string) => `VibeField didn't start ${label}: ${why}`;

describe("CP-4a2b — a step's agent, model, folder, prompt and profile, held at the call with nothing spawned (§13a slice 8c-2)", () => {
  it("R16 (D9; W-a…W-f, A1, A3): no agent, one not offered, a model it doesn't offer or not written as a name, a folder outside the bound, and a spawn's key beside in:, each refused with no spawn; a discovered model starts", async () => {
    const h = await harness({
      folders: { "session:run-yours": "/work/yours" },
      sessions: { "run-yours": { live: true, profile: "work", onPermission: false } },
    });
    const at = { cwd: "/work/app", profile: "work" };
    h.approved(
      "checks",
      callsEach(
        [
          { ...at, label: "No agent" },
          { ...at, label: "Seven", agent: 7 },
          { ...at, label: "Nobody", agent: "nobody" },
          { ...at, label: "Flag", agent: "claude", model: "--dangerously-skip-permissions" },
          { ...at, label: "Shape", agent: "claude", model: { modelId: "opus" } },
          { label: "Outside", agent: "claude", profile: "work", cwd: "/etc" },
          { label: "Climbs", agent: "claude", profile: "work", cwd: "/work/../etc" },
          { label: "Relative", agent: "claude", profile: "work", cwd: "app" },
          { label: "Both", in: "run-yours", agent: "claude" },
        ],
        { ...at, label: "Opus", agent: "claude", model: "opus" },
      ),
    );
    const run = startedRun(
      await h.start({ flow: "checks", input: { target: "run-yours" }, scope: ["work"] }),
    ).run;
    await waitFor(() => expect(h.spawned).toHaveLength(1));
    expect(refusalsOf(h, run)).toEqual([
      W("No agent", "it names no agent."),
      W("Seven", "it names no agent."),
      W("Nobody", "it names an agent VibeField doesn't start (nobody)."),
      W("Flag", "it names a model Claude Code doesn't offer (--dangerously-skip-permissions)."),
      W("Shape", "its model isn't written as a model's name."),
      W("Outside", "its folder (etc) is outside this run's folder and your projects."),
      W("Climbs", "its folder (etc) is outside this run's folder and your projects."),
      W("Relative", "its folder (app) is outside this run's folder and your projects."),
      W("Both", "it asks for agent, which a step may not set."),
    ]);
    expect(h.enqueued).toHaveLength(1);
    expect(h.spawned[0]?.launch).toEqual({
      agent: "claude",
      cwd: "/work/app",
      profileSet: "work",
      model: { modelId: "opus" },
      title: "Checks · Opus",
    });
  });

  it("W-e: a prompt that isn't words is refused, with nothing spawned", async () => {
    const h = await harness();
    h.approved(
      "numbers",
      [
        'export const meta = { name: "Numbers" };',
        "export default async function () {",
        '  try { await agent(42, { agent: "claude", label: "Count", profile: "work", cwd: "/work/app" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n"),
    );
    const run = startedRun(await h.start({ flow: "numbers" })).run;
    expect((await settled(h.runs, run, "done")).log).toBe(W("Count", "its prompt isn't words."));
    expect(h.spawned).toEqual([]);
  });

  /** A flow whose one step names no Agent Profile, its refusal logged (A2, A2b). */
  const unnamed = (name: string) =>
    [
      `export const meta = { name: "${name}" };`,
      "export default async function () {",
      '  try { await agent("go", { agent: "claude", label: "Go", cwd: "/work/app" }); }',
      "  catch (e) { log(e.message); }",
      "}",
      "",
    ].join("\n");

  it("A2 (W-g): a step that names no Agent Profile takes your default, or the spark's own for its run, each held to the run's scope; with none to give it, it is refused, never the runtime's own default", async () => {
    // yours takes your default, and the spark's run its own
    const h = await harness({ sparkProfiles: { [VELA]: "review" } });
    h.approved("unnamed", unnamed("Unnamed"));
    const yours = startedRun(await h.start({ flow: "unnamed", scope: ["work", "review"] })).run;
    const velas = startedRun(
      await h.start({
        flow: "unnamed",
        starter: { by: "spark", spark: VELA },
        from: VELA_FROM,
        scope: ["work", "review"],
      }),
    ).run;
    await waitFor(() => expect(h.spawned).toHaveLength(2));
    const profileOf = (run: string) =>
      h.spawned.find((spawn) => spawn.origin.run === run)?.launch.profileSet;
    expect(profileOf(yours)).toBe("work");
    expect(profileOf(velas)).toBe("review");
    // a default outside the run's scope is none to give it: the step named none, so it is never said to name one (F8)
    const outside = await harness({ defaultProfile: "home", profiles: ["work", "home"] });
    outside.approved("unnamed", unnamed("Unnamed"));
    const homeless = startedRun(await outside.start({ flow: "unnamed", scope: ["work"] })).run;
    expect((await settled(outside.runs, homeless, "done")).log).toBe(
      W("Go", "it names no Agent Profile, and this run has none to give it."),
    );
    // no default at all: refused, never the runtime's own
    const none = await harness({ defaultProfile: null });
    none.approved("unnamed", unnamed("Unnamed"));
    const bare = startedRun(await none.start({ flow: "unnamed" })).run;
    expect((await settled(none.runs, bare, "done")).log).toBe(
      W("Go", "it names no Agent Profile, and this run has none to give it."),
    );
    expect([...outside.spawned, ...none.spawned]).toEqual([]);
  });

  it("A2b (slices 7–9 review F8, Q3): a step that names no Agent Profile, in a Run from a spark's thread, takes the spark's thinksUnder, as the spark's own run does, and yours takes your default; a thinksUnder outside the run's scope is none to give it", async () => {
    // Vela thinks under review, and your default is home
    const h = await harness({
      sparkProfiles: { [VELA]: "review" },
      defaultProfile: "home",
      profiles: ["work", "review", "home"],
    });
    h.approved("unnamed", unnamed("Unnamed"));
    /** the Agent Profile its step was spawned under, or, once its run has ended in any way (its `endedAt`, which every
     * end writes; the F8 review KK2), how: a done run's log, the words its step was refused in, or another end's
     * state, so a run ended another way fails on the value, never on a timeout */
    const stepOf = (run: string) => {
      const spawn = h.spawned.find((spawned) => spawned.origin.run === run);
      if (spawn !== undefined) return spawn.launch.profileSet;
      const summary = h.runs.read(run)?.summary;
      if (summary?.endedAt === undefined) return undefined;
      if (summary.state === "done" && summary.log !== undefined) return summary.log;
      return `${summary.state}: ${summary.log ?? "no log"}`;
    };
    const ran = async (params: Partial<FlowRunStartParams>) => {
      const run = startedRun(await h.start({ flow: "unnamed", ...params })).run;
      await waitFor(() => expect(stepOf(run)).toBeDefined());
      return stepOf(run);
    };
    const thread: Partial<FlowRunStartParams> = {
      starter: { by: "you", spark: VELA },
      scope: ["work", "review"],
    };
    // a Run in Vela's thread, under Vela's Agent Profiles: Vela's thinksUnder, never your default
    expect(await ran(thread)).toBe("review");
    // the guards: Vela's own run takes its thinksUnder, and yours your default
    const own: Partial<FlowRunStartParams> = {
      starter: { by: "spark", spark: VELA },
      from: VELA_FROM,
      scope: ["work", "review"],
    };
    expect(await ran(own)).toBe("review");
    expect(await ran({ scope: ["work", "home"] })).toBe("home");
    // review since removed: the thread's run is narrowed to work, so Vela's thinksUnder is none to give it
    h.setProfiles(["work", "home"]);
    expect(await ran(thread)).toBe(
      W("Go", "it names no Agent Profile, and this run has none to give it."),
    );
  });

  it("says each step refusal in DESIGN.md's own words (§9 \"A step's call refused\")", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      W("‹label›", "it names no agent."),
      W("‹label›", "it names an agent VibeField doesn't start (‹agent›)."),
      W("‹label›", "it names a model ‹agent› doesn't offer (‹model›)."),
      W("‹label›", "its model isn't written as a model's name."),
      W("‹label›", "it names no Agent Profile, and this run has none to give it."),
      W("‹label›", "its folder (‹folder›) is outside this run's folder and your projects."),
      W("‹label›", "its prompt isn't words."),
      W("‹label›", "it names an Agent Profile this run can't use (‹profile›)."),
      W("‹label›", "it asks for ‹key›, which a step may not set."),
      W("‹label›", words.agentsStarted()),
    ])
      expect(design, said).toContain(`"${said}"`);
  });
});

// CP-4a2b (§13a slice 9; CP4-S2, CP4-Q7 (a), D11, D12, D22, CL-H6) — a step's answer: its turn's end, heard through
// flow-step-events.ts, answered once ({text}, and a form's fields beside it, Q-A1 (a)), bounded WHOLE by the one
// cutter (boundedAnswer, U-a), checked against its form (form-check.ts); a miss is the repair turn, once, with
// nothing journaled, and a second miss holds the run on the person (`flow-repair`), whose Ask once more sends the line
// again. A late turn end journals nothing; a failed turn is "‹label› failed."; an answer frees its slot (R14b).

const STEP_AT = '{ agent: "claude", label: "Diff", profile: "work", cwd: "/work/app" }';
const FORM =
  '{ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] }';
/** One step, its answer's text said as the run's log line, and returned. */
const ANSWERED = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  `  const said = await agent("Review the diff", ${STEP_AT});`,
  "  log(said.text);",
  "  return said;",
  "}",
  "",
].join("\n");
/** One step with a form, its verdict said as the run's log line. */
const FORMED = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  `  const said = await agent("Review the diff", { ...${STEP_AT}, schema: ${FORM} });`,
  '  log(said.verdict + " " + (said.text.length < 70000));',
  "  return said;",
  "}",
  "",
].join("\n");
/** FORMED, its step's refusal caught and said as the run's log line. */
const FORMED_CATCHES = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  `  try { await agent("Review the diff", { ...${STEP_AT}, schema: ${FORM} }); } catch (e) { log(e.message); }`,
  "}",
  "",
].join("\n");
const fenced = (json: string) => `\`\`\`json\n${json}\n\`\`\``;
const repairLine = (check: string) =>
  `your last message did not match this step's form (${check}). Answer once more in that form.`;

/** A FORMED_CATCHES run whose step missed its form twice, so the run is held on the person (CP4-Q7 (a)). */
async function heldOnRepair(h: Harness): Promise<string> {
  h.approved("review", FORMED_CATCHES);
  const run = startedRun(await h.start({ flow: "review" })).run;
  await waitFor(() => expect(h.enqueued).toHaveLength(1));
  const at = { run, call: 1, runtimeRunId: "rt-step1", outcome: "completed" } as const;
  h.endTurn({ ...at, turn: "t1", text: "no json here" });
  await waitFor(() => expect(h.enqueued).toHaveLength(2));
  h.endTurn({ ...at, turn: "t2", text: "still none" });
  await waitFor(() => expect(h.items).toHaveLength(1));
  return run;
}

/** The person's Ask once more on a held run's first item. */
const askOnceMore = (h: Harness, run: string) =>
  h.runs.acts.answer({
    id: "ny-item1aaaaaa" as NeedsItemId,
    kind: "flow-repair",
    run: { run, flow: "review", call: 1, label: "Diff" },
    choice: 0,
    stop: false,
    act: NEEDS_CHOICE_WORDS.askOnceMore,
  });

/** The run's journal's answer lines, in order. */
function answersOf(h: Harness, run: string) {
  const read = h.records.readRun(run);
  return read.kind === "kept" ? read.lines.filter((line) => line.kind === "answer") : [];
}

describe("CP-4a2b — a step's answer: heard once, bounded whole, checked against its form, repaired once (§13a slice 9)", () => {
  it("R19 (D22; slices 7–9 review F3): a step's turn end is its answer, journaled once; the same turn told again journals nothing, and a missed end told twice with no turn id is one repair", async () => {
    const h = await harness();
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const end = {
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
    } as const;
    h.endTurn({ ...end, text: "all clean" });
    h.endTurn({ ...end, text: "all clean" });
    expect((await settled(h.runs, run, "done")).log).toBe("all clean");
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
    expect(answersOf(h, run)[0]).toMatchObject({ call: 1, value: { text: "all clean" } });
    expect(h.records.runRecord(run)).toMatchObject({
      open: [],
      steps: [{ call: 1, label: "Diff", session: "rt-step1", state: "answered" }],
    });
    // F3: a form step's missed end told twice with no turn id, through the step listener itself, is one repair: no
    // item, the step still repairing, and the repaired answer settles it
    const events = new FlowStepEvents();
    const f = await harness({ stepEvents: events });
    f.approved("review", FORMED);
    const formed = startedRun(await f.start({ flow: "review" })).run;
    await waitFor(() => expect(f.enqueued).toHaveLength(1));
    const step = fakeAgent();
    events.entered({
      agent: step.agent,
      runtimeRunId: "rt-step1",
      begun: "spawn",
      origin: { by: "flow", run: formed, call: 1 },
    });
    step.emit("turn:started", {});
    step.emit("turn:completed", { lastAssistantMessage: "no json here" });
    step.emit("turn:completed", { lastAssistantMessage: "no json here" });
    await waitFor(() => expect(f.enqueued).toHaveLength(2));
    expect(f.items).toEqual([]);
    expect(f.records.runRecord(formed)?.open[0]?.state).toBe("repairing");
    step.emit("turn:started", {});
    step.emit("turn:completed", { lastAssistantMessage: fenced('{"verdict":"clean"}') });
    expect((await settled(f.runs, formed, "done")).log).toBe("clean true");
    expect(f.enqueued).toHaveLength(2);
    expect(f.items).toEqual([]);
  });

  it("R24: a turn end for a step already answered journals nothing, while its run goes on", async () => {
    const h = await harness();
    h.approved(
      "two",
      [
        'export const meta = { name: "Two" };',
        "export default async function () {",
        `  const a = await agent("one", { ...${STEP_AT}, label: "One" });`,
        `  const b = await agent("two", { ...${STEP_AT}, label: "Two" });`,
        '  log(a.text + " " + b.text);',
        "}",
        "",
      ].join("\n"),
    );
    const run = startedRun(await h.start({ flow: "two" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "first",
    });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t2",
      outcome: "completed",
      text: "late",
    });
    h.endTurn({
      run,
      call: 2,
      runtimeRunId: "rt-step2",
      turn: "t1",
      outcome: "completed",
      text: "second",
    });
    expect((await settled(h.runs, run, "done")).log).toBe("first second");
    expect(answersOf(h, run).map((line) => line.value)).toEqual([
      { text: "first" },
      { text: "second" },
    ]);
  });

  it("R20 (Q-A1 (a)): a step with a form answers its fields beside its text, the form's JSON read from the last fenced block", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const text = `Looked at it.\n${fenced('{"verdict":"clean"}')}`;
    h.endTurn({ run, call: 1, runtimeRunId: "rt-step1", turn: "t1", outcome: "completed", text });
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
    expect(answersOf(h, run)[0]?.value).toEqual({ verdict: "clean", text });
  });

  it("R20b (D12): a form the run can't check is refused at the call, in §9's words, with nothing spawned", async () => {
    const h = await harness();
    h.approved(
      "forms",
      callsEach([
        {
          agent: "claude",
          label: "Pattern",
          profile: "work",
          cwd: "/work/app",
          schema: { type: "object", pattern: "x" },
        },
        {
          agent: "claude",
          label: "Top",
          profile: "work",
          cwd: "/work/app",
          schema: { type: "string" },
        },
      ]),
    );
    const run = startedRun(await h.start({ flow: "forms" })).run;
    await settled(h.runs, run, "done");
    expect(refusalsOf(h, run)).toEqual([
      "VibeField can't check Pattern's form: it uses pattern, which a flow's form may not. A form takes type, properties, required, items and enum.",
      "VibeField can't check Top's form: a form's top takes type object.",
    ]);
    expect(h.spawned).toEqual([]);
  });

  it("R21/R22 (CP4-Q7 (a)): a miss is the repair line once, naming no field, nothing journaled; a 2nd miss holds the run on flow-repair, whose Ask once more sends the line again (n: 2)", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const at = { run, call: 1, runtimeRunId: "rt-step1", outcome: "completed" } as const;
    h.endTurn({ ...at, turn: "t1", text: "no json here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    const repair = repairLine("the answer holds no JSON the form can read");
    expect(h.enqueued[1]).toMatchObject({
      runtimeRunId: "rt-step1",
      text: repair,
      from: { kind: "fieldd", flow: { run, call: 1, line: "repair", n: 1 } },
    });
    expect(h.enqueued[1]?.text).not.toContain("verdict");
    expect(h.records.runRecord(run)?.open[0]).toMatchObject({
      state: "repairing",
      lines: [
        { line: "prompt", n: 1, sent: "queued" },
        { line: "repair", n: 1, sent: "queued" },
      ],
    });
    expect(h.kinds(run)).toEqual(["head", "call"]);
    // a second miss holds the run on the person
    h.endTurn({ ...at, turn: "t2", text: "still none" });
    await waitFor(() => expect(h.items).toHaveLength(1));
    expect(h.items[0]).toEqual({
      kind: "flow-repair",
      run: { run, flow: "review", call: 1, label: "Diff" },
      name: "Review",
      acts: ["Ask once more"],
    });
    expect(h.records.runRecord(run)).toMatchObject({
      held: { item: "ny-item1aaaaaa", kind: "flow-repair" },
      open: [{ call: 1, state: "holding" }],
    });
    expect(h.enqueued).toHaveLength(2);
    // Ask once more sends the same line again, its 2nd
    expect(
      await h.runs.acts.answer({
        id: "ny-item1aaaaaa" as NeedsItemId,
        kind: "flow-repair",
        run: { run, flow: "review", call: 1, label: "Diff" },
        choice: 0,
        stop: false,
        act: NEEDS_CHOICE_WORDS.askOnceMore,
      }),
    ).toEqual({ outcome: "done" });
    expect(h.enqueued[2]).toMatchObject({
      text: repair,
      from: { kind: "fieldd", flow: { run, call: 1, line: "repair", n: 2 } },
    });
    expect(h.records.runRecord(run)?.held).toBeUndefined();
    expect(h.records.runRecord(run)?.open[0]?.state).toBe("repairing");
    h.endTurn({ ...at, turn: "t3", text: fenced('{"verdict":"clean"}') });
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
  });

  it("R22b (1c review Y2): Ask once more whose repair line is queued, and whose record can't say so, is done: the refusal is logged, never thrown, and the agent's answer settles the step", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const at = { run, call: 1, runtimeRunId: "rt-step1", outcome: "completed" } as const;
    h.endTurn({ ...at, turn: "t1", text: "no json here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    h.endTurn({ ...at, turn: "t2", text: "still none" });
    await waitFor(() => expect(h.items).toHaveLength(1));
    // the record refuses the write that marks Ask once more's line queued
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const again = (line: { line: string; n: number; sent: string }) =>
        line.line === "repair" && line.n === 2 && line.sent === "queued";
      const queued = fields.open.some((step) => step.lines?.some(again));
      if (!refused && queued) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(kept, fields);
    });
    expect(
      await h.runs.acts.answer({
        id: "ny-item1aaaaaa" as NeedsItemId,
        kind: "flow-repair",
        run: { run, flow: "review", call: 1, label: "Diff" },
        choice: 0,
        stop: false,
        act: NEEDS_CHOICE_WORDS.askOnceMore,
      }),
    ).toEqual({ outcome: "done" });
    expect(h.enqueued).toHaveLength(3);
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.queued");
    expect(h.records.runRecord(run)?.open[0]?.state).toBe("repairing");
    h.endTurn({ ...at, turn: "t3", text: fenced('{"verdict":"clean"}') });
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
  });

  it("R22c (slices 7–9 review F5): Ask once more whose repair line can't be recorded fails its step in §9's words, its hold dropped with it: no item held, no line queued, never a silent wait", async () => {
    const h = await harness();
    const run = await heldOnRepair(h);
    // the record refuses the write that would say Ask once more's line is being sent
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const again = fields.open.some((step) =>
        step.lines?.some((line) => line.line === "repair" && line.n === 2),
      );
      if (!refused && again) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(kept, fields);
    });
    expect(await askOnceMore(h, run)).toEqual({ outcome: "failed", reason: stepFailed("Diff") });
    expect(refused).toBe(true);
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.enqueued).toHaveLength(2);
    expect(h.items).toHaveLength(1);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps).toMatchObject([{ call: 1, label: "Diff", state: "failed" }]);
  });

  it("R22d (slices 7–9 review F5, Q2): Ask once more at FLOW_LIMITS.STEP_LINES_MAX lines fails its step in §9's words, its hold dropped with it, and nothing is written or queued past the bound", async () => {
    const h = await harness();
    const run = await heldOnRepair(h);
    // the step's record at the bound: its prompt and STEP_LINES_MAX − 1 repair lines, as Ask once more said again
    const kept = h.records.runRecord(run);
    if (kept === undefined) throw new Error("the run's record was not kept");
    const lines = [
      { line: "prompt", n: 1, sent: "queued" },
      ...Array.from({ length: FLOW_LIMITS.STEP_LINES_MAX - 1 }, (_, i) => ({
        line: "repair",
        n: i + 1,
        sent: "queued",
      })),
    ];
    h.records.writeRunRecord(kept.run, {
      ...kept,
      open: kept.open.map((step) => ({ ...step, lines })),
    });
    // every write from here on: none holds a line past the bound
    const write = h.records.writeRunRecord.bind(h.records);
    const most: number[] = [];
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      most.push(Math.max(0, ...fields.open.map((step) => step.lines?.length ?? 0)));
      write(at, fields);
    });
    expect(await askOnceMore(h, run)).toEqual({ outcome: "failed", reason: stepFailed("Diff") });
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(Math.max(0, ...most)).toBeLessThanOrEqual(FLOW_LIMITS.STEP_LINES_MAX);
    // EE1 (F5 review): the bound's road says its cause in fieldd's log, as the refusal's road does
    expect(h.warned.filter((said) => said.event === "fieldd.flows.step.repair")).toEqual([
      {
        event: "fieldd.flows.step.repair",
        fields: {
          run,
          call: 1,
          n: FLOW_LIMITS.STEP_LINES_MAX,
          lines: FLOW_LIMITS.STEP_LINES_MAX,
        },
      },
    ]);
    expect(h.enqueued).toHaveLength(2);
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps).toMatchObject([{ call: 1, label: "Diff", state: "failed" }]);
  });

  it("R22e (F5 review EE2): Ask once more whose repair line is kept, and which its session's queue refuses, fails its step in §9's words, the line kept as sending and the hold dropped", async () => {
    const h = await harness();
    const run = await heldOnRepair(h);
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce(() => {
      throw new Error("the session's queue is full");
    });
    expect(await askOnceMore(h, run)).toEqual({ outcome: "failed", reason: stepFailed("Diff") });
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.repair");
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.enqueued).toHaveLength(2);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps[0]).toMatchObject({ call: 1, label: "Diff", state: "failed" });
    expect(record?.steps[0]?.lines?.at(-1)).toEqual({ line: "repair", n: 2, sent: "sending" });
  });

  it("R22f (F5 review EE2): a first repair line kept, and refused by its session's queue, fails its step in §9's words, the line kept as sending and no item raised", async () => {
    const h = await harness();
    h.approved("review", FORMED_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce(() => {
      throw new Error("the session's queue is full");
    });
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "no json here",
    });
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.repair");
    expect(h.enqueued).toHaveLength(1);
    expect(h.items).toEqual([]);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps[0]).toMatchObject({ call: 1, label: "Diff", state: "failed" });
    expect(record?.steps[0]?.lines?.at(-1)).toEqual({ line: "repair", n: 1, sent: "sending" });
  });

  it("R23 (D11): an answer is bounded whole: its text is cut to what its fields leave, marked cut; fields alone past the bound are a miss, never a truncation", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const long = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const text = `${fenced('{"verdict":"clean"}')}\n${"x".repeat(70 * 1024)}`;
    h.endTurn({
      run: long,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text,
    });
    expect((await settled(h.runs, long, "done")).log).toBe("clean true");
    expect(answersOf(h, long)[0]).toMatchObject({ cut: true, value: { verdict: "clean" } });
    expect(h.records.runRecord(long)?.steps[0]).toMatchObject({ state: "answered", cut: true });
    // fields that alone leave no room for the text: the repair turn, in the bounder's words
    const wide = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    const fields = `{"verdict":"${"y".repeat(FLOW_LIMITS.RESULT_MAX_BYTES - 20)}"}`;
    h.endTurn({
      run: wide,
      call: 1,
      runtimeRunId: "rt-step2",
      turn: "t1",
      outcome: "completed",
      text: fields,
    });
    await waitFor(() => expect(h.enqueued).toHaveLength(3));
    expect(h.enqueued[2]?.text).toBe(
      repairLine("the answer's fields are longer than a flow may keep"),
    );
    expect(h.kinds(wide)).toEqual(["head", "call"]);
  });

  it('R25: a failed turn is the step\'s refusal, "‹label› failed."', async () => {
    const h = await harness();
    h.approved("review", REVIEW_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    h.endTurn({ run, call: 1, runtimeRunId: "rt-step1", turn: "t1", outcome: "failed" });
    expect((await settled(h.runs, run, "done")).log).toBe("Diff failed.");
    expect(h.records.runRecord(run)?.steps[0]).toMatchObject({ call: 1, state: "failed" });
  });

  it("R14b (CP4-S7; slices 7–9 review F10): an answer frees its step's slot, and of the two steps waiting for one, the first in call order starts", async () => {
    const h = await harness();
    h.approved("fan", fanOut(FLOW_LIMITS.LIVE_STEPS_MAX + 2));
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX));
    h.endTurn({
      run,
      call: 3,
      runtimeRunId: "rt-step3",
      turn: "t1",
      outcome: "completed",
      text: "part 3",
    });
    await waitFor(() => expect(h.enqueued).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX + 1));
    expect(h.spawned.at(-1)?.origin).toEqual({ by: "flow", run, call: 9 });
    expect(h.records.runRecord(run)?.open.find((step) => step.call === 9)).toMatchObject({
      state: "working",
      session: "rt-step9",
    });
    // F10: the one slot went to call 9, never 10, which waits for the next
    expect(h.records.runRecord(run)?.open.find((step) => step.call === 10)?.state).toBe("waiting");
    expect(h.spawned).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX + 1);
  });

  it('R14c (slices 7–9 review F2): a step whose start throws is refused "‹label› failed." and frees its slot: past LIVE_STEPS_MAX caught ones, a valid step starts, never waits', async () => {
    const h = await harness();
    const stuck = FLOW_LIMITS.LIVE_STEPS_MAX + 1;
    // W-h's stub throws at a folder that is no name: a start that throws, as an enqueue guard or a record refusal does
    const bad = Array.from({ length: stuck }, () => ({ label: "Bad", cwd: "" }));
    const good = { agent: "claude", label: "Good", cwd: "/work/app", profile: "work" };
    h.approved("stuck", callsEach(bad, good));
    const run = startedRun(await h.start({ flow: "stuck", scope: ["work"] })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // each is journaled as its refusal, so its step settles failed, and the script hears it (on a replay too)
    expect(refusalsOf(h, run)).toEqual(Array.from({ length: stuck }, () => "Bad failed."));
    const record = h.records.runRecord(run);
    expect(record?.steps.map((step) => [step.label, step.state])).toEqual(
      Array.from({ length: stuck }, () => ["Bad", "failed"]),
    );
    expect(record?.open.map((step) => [step.call, step.state])).toEqual([[stuck + 1, "working"]]);
    expect(h.spawned.map((spawn) => spawn.origin.call)).toEqual([stuck + 1]);
  });

  it("R14i (slices 7–9 review F9): an in: step never waits for a slot: past LIVE_STEPS_MAX spawned steps it is handed at once, and the next answer starts the first spawned step waiting", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("slots", slotsAndAHand(FLOW_LIMITS.LIVE_STEPS_MAX));
    const max = FLOW_LIMITS.LIVE_STEPS_MAX;
    // every state the in: step's record is written with, from its call line on
    const states: string[] = [];
    const write = h.records.writeRunRecord.bind(h.records);
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const state = fields.open.find((step) => step.call === max + 1)?.state;
      if (state !== undefined) states.push(state);
      write(kept, fields);
    });
    const run = startedRun(await h.start({ flow: "slots" })).run;
    await waitFor(() => expect(h.records.runRecord(run)?.open).toHaveLength(max + 2));
    // decided at its call line: no "waiting" ever reaches its record, and its hand is at once
    expect(states).not.toContain("waiting");
    expect(h.hands).toMatchObject([{ runtimeRunId: "run-yours", run, call: max + 1, gone: false }]);
    const open = h.records.runRecord(run)?.open ?? [];
    expect(open.find((step) => step.call === max + 1)).toMatchObject({ handed: true });
    // the spawned step after it waits: every slot is a spawn's (that the in: step holds none, the answer below shows)
    expect(open.find((step) => step.call === max + 2)?.state).toBe("waiting");
    await waitFor(() => expect(h.enqueued).toHaveLength(max + 1));
    expect(h.spawned).toHaveLength(max);
    // an answer's one slot starts the first SPAWNED step waiting
    h.endTurn({
      run,
      call: 3,
      runtimeRunId: "rt-step3",
      turn: "t1",
      outcome: "completed",
      text: "part 3",
    });
    await waitFor(() => expect(h.spawned).toHaveLength(max + 1));
    expect(h.spawned.at(-1)?.origin).toEqual({ by: "flow", run, call: max + 2 });
  });

  it("R14j (F9 review CC1): under the bound, the spawned step after an in: step's hand is written starting and spawned at once: the hand is on the record before the next call line", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    const max = FLOW_LIMITS.LIVE_STEPS_MAX;
    h.approved("slots", slotsAndAHand(max - 1));
    // every state the last spawned step's record is written with, from its call line on
    const states: string[] = [];
    const write = h.records.writeRunRecord.bind(h.records);
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const state = fields.open.find((step) => step.call === max + 1)?.state;
      if (state !== undefined) states.push(state);
      write(kept, fields);
    });
    const run = startedRun(await h.start({ flow: "slots" })).run;
    await waitFor(() => expect(h.spawned).toHaveLength(max));
    // max − 1 spawned, the handed one counted for none: its call line found a slot
    expect(states[0]).toBe("starting");
    expect(states).not.toContain("waiting");
    expect(h.spawned.map((spawn) => spawn.origin.call)).toContain(max + 1);
    expect(h.hands).toMatchObject([{ runtimeRunId: "run-yours", run, call: max, gone: false }]);
  });

  it("R14d (F2 review T1, T3, T6): a start that throws while the runs store does not answer settles its step with no read on the failure road: no rejection escapes, its call's own label names it, and its slot frees", async () => {
    const h = await harness();
    // past FLOW_LABEL_MAX, so the record's entry keeps no label: only the call's own names the step (T3)
    const long = "Look ".repeat(26).trim();
    const good = { agent: "claude", label: "Good", cwd: "/work/app", profile: "work" };
    const look = { agent: "claude", label: long, profile: "work", cwd: "/work/app", model: "opus" };
    h.approved("broken", callsEach([look], good));
    // the start throws as the disk stops answering, and the store's next read before the answer's line refuses
    const read = h.records.runRecord.bind(h.records);
    let refusing = false;
    vi.spyOn(h.records, "runRecord").mockImplementation((run) => {
      if (!refusing) return read(run);
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const append = h.records.appendRun.bind(h.records);
    vi.spyOn(h.records, "appendRun").mockImplementation((run, entry) => {
      if (entry.kind === "answer") refusing = false;
      return append(run, entry);
    });
    vi.spyOn(h.runs.ports.agents, "models").mockImplementation(async () => {
      refusing = true;
      throw new Error("EIO: i/o error, read");
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const run = startedRun(await h.start({ flow: "broken" })).run;
      await waitFor(() => expect(h.enqueued).toHaveLength(1));
      expect(refusalsOf(h, run)).toEqual([stepFailed(long)]);
      expect(stepFailed(long)).not.toBe(stepFailed(undefined));
      const record = h.records.runRecord(run);
      expect(record?.steps.map((step) => [step.call, step.state])).toEqual([[1, "failed"]]);
      expect(record?.open.map((step) => [step.call, step.state])).toEqual([[2, "working"]]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("R14e (F2 review T5; 1c review Y3): a read that throws on a step's own road, before its waiter, settles the step failed: no rejection escapes, and its entry never holds a slot", async () => {
    const h = await harness();
    const good = { agent: "claude", label: "Good", cwd: "/work/app", profile: "work" };
    const look = { agent: "claude", label: "Look", profile: "work", cwd: "/work/app" };
    h.approved("unread", callsEach([look], good));
    // a subscriber, so each write's list is read too (Y3): it never takes the refusal meant for the step's road
    h.runs.onChange(() => undefined);
    // the step's entry is on the record; the step's own read, the next one no list makes, is the disk's to refuse
    const read = h.records.runRecord.bind(h.records);
    const write = h.records.writeRunRecord.bind(h.records);
    const listed = h.records.runRecords.bind(h.records);
    let entered = false;
    let refusing = false;
    let listing = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      write(run, fields);
      if (!entered && fields.open.some((step) => step.call === 1)) {
        entered = true;
        refusing = true;
      }
    });
    vi.spyOn(h.records, "runRecords").mockImplementation(() => {
      listing = true;
      try {
        return listed();
      } finally {
        listing = false;
      }
    });
    vi.spyOn(h.records, "runRecord").mockImplementation((run) => {
      if (!refusing || listing) return read(run);
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const run = startedRun(await h.start({ flow: "unread" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(refusalsOf(h, run)).toEqual([stepFailed("Look")]);
    const record = h.records.runRecord(run);
    expect(record?.steps.map((step) => [step.label, step.state])).toEqual([["Look", "failed"]]);
    expect(record?.open.map((step) => [step.call, step.state])).toEqual([[2, "working"]]);
  });

  it("R14f (F2 review T2): a start that throws after its agent started and before its line was queued fails the step, and fieldd's warn names the agent it leaves (slice 13's R42 ends it)", async () => {
    const h = await harness();
    h.approved("review", REVIEW_CATCHES);
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce(() => {
      throw new Error("the input queue refused it");
    });
    const run = startedRun(await h.start({ flow: "review" })).run;
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.spawned.map((spawn) => spawn.origin.call)).toEqual([1]);
    expect(h.records.runRecord(run)?.steps).toMatchObject([
      { call: 1, session: "rt-step1", state: "failed" },
    ]);
    expect(h.warned.filter((said) => said.event === "fieldd.flows.step.orphan")).toEqual([
      {
        event: "fieldd.flows.step.orphan",
        fields: expect.objectContaining({ run, call: 1, runtimeRunId: "rt-step1" }),
      },
    ]);
  });

  it("R14h (1c review Y1): a step whose session never reached its record, the write that names it refused after its spawn, settles failed naming that session in the settle's own write, and fieldd keeps it for the run's end", async () => {
    const h = await harness();
    h.approved("review", REVIEW_CATCHES);
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      const working = fields.open.some((step) => step.call === 1 && step.state === "working");
      if (!refused && working) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(run, fields);
    });
    const run = startedRun(await h.start({ flow: "review" })).run;
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.records.runRecord(run)?.steps).toMatchObject([
      { call: 1, session: "rt-step1", state: "failed" },
    ]);
    expect(h.warned.filter((said) => said.event === "fieldd.flows.step.orphan")).toEqual([
      {
        event: "fieldd.flows.step.orphan",
        fields: expect.objectContaining({ run, call: 1, runtimeRunId: "rt-step1" }),
      },
    ]);
  });

  it("R42b (slice 13, AA3; Q4 (a), Q6): the run's end ends the agents its failed starts left running, R14f's and R14h's write-#1 orphan, though `sessions.ofRun` omits both: `live.orphans` is read beside it, and each counts in `ended`", async () => {
    // red-a: no end ends an agent yet, so `ends` is empty and the record has no `ended`. Each run ends done by itself
    // (REVIEW_CATCHES logs its step's refusal), so `settled(…, "done")` is its wait
    /** A REVIEW_CATCHES run whose start throws past its spawn by `refuse`, read at its end. */
    const orphaned = async (refuse: (h: Harness) => void) => {
      const h = await harness({ ofRunOmits: ["rt-step1"] });
      h.approved("review", REVIEW_CATCHES);
      refuse(h);
      const run = startedRun(await h.start({ flow: "review" })).run;
      const done = await settled(h.runs, run, "done");
      return { state: done.state, ends: h.ends, ended: h.records.runRecord(run)?.ended };
    };
    // R14f's road: the queue refuses the step's line, its agent started
    const queueRefused = await orphaned((h) => {
      vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce(() => {
        throw new Error("the input queue refused it");
      });
    });
    // R14h's road: the write that names the step's session (write #1 past its spawn) refused
    const writeRefused = await orphaned((h) => {
      const write = h.records.writeRunRecord.bind(h.records);
      let refused = false;
      vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
        const working = fields.open.some((step) => step.call === 1 && step.state === "working");
        if (!refused && working) {
          refused = true;
          throw new Error("ENOSPC: no space left on device, write");
        }
        write(at, fields);
      });
    });
    const each = { state: "done", ends: ["rt-step1"], ended: 1 };
    expect({ queueRefused, writeRefused }).toEqual({ queueRefused: each, writeRefused: each });
  });

  it("R42b-2 (slice 13's fold 1; the green skeptic's #1): an orphan whose agent exited before its run's end, as the same `sessions.ofRun` read lists it, is neither ended nor counted in `ended`", async () => {
    // red at the unfixed green: #agentsOf keeps an `ofRun` row only when it lives, yet adds every orphan unread, so
    // the end asks `agents.end` of the exited agent and counts it (`ended: 1`)
    const h = await harness();
    h.approved("review", REVIEW_CATCHES);
    // R14f's road: the queue refuses the step's line, its agent started; that agent then exits on its own
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce((runtimeRunId) => {
      h.exit(runtimeRunId);
      throw new Error("the input queue refused it");
    });
    const run = startedRun(await h.start({ flow: "review" })).run;
    const done = await settled(h.runs, run, "done");
    expect({
      state: done.state,
      listed: h.runs.ports.sessions.ofRun(run),
      ends: h.ends,
      ended: h.records.runRecord(run)?.ended,
    }).toEqual({
      state: "done",
      listed: [{ runtimeRunId: "rt-step1", call: 1, live: false }],
      ends: [],
      ended: undefined,
    });
  });

  it("R14g (F2 review T2): a record that can't say a queued line was queued is logged, never thrown: the step works on, and its agent's answer settles it", async () => {
    const h = await harness();
    h.approved("review", ANSWERED);
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      const queued = fields.open.some((step) => step.lines?.some((line) => line.sent === "queued"));
      if (!refused && queued) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(run, fields);
    });
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() =>
      expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.queued"),
    );
    expect(refusalsOf(h, run)).toEqual([]);
    expect(h.records.runRecord(run)?.open).toMatchObject([
      {
        call: 1,
        session: "rt-step1",
        state: "working",
        lines: [{ line: "prompt", sent: "sending" }],
      },
    ]);
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "all clean",
    });
    expect((await settled(h.runs, run, "done")).log).toBe("all clean");
  });
});

// CP-4a2b (slice 7's R8b; D9, CP4-Q20 (a); Q2 (a), ruled 2026-11-06) — the folder at the start, read from the
// static read's `cwd` (one reader): a script with a step that names no folder, whose input names none, is refused
// before any journal line; an input that names a session or a project VibeField can't find is refused too (§9's
// PROPOSED lines, 804c16ed3). A step whose folder is computed passes, to its call.

describe("CP-4a2b — a run's folder, held at its start (slice 7's R8b)", () => {
  /** A one-step flow: its step names its folder plainly, computes it, or names none. */
  const stepWith = (cwd: string, input = "{}") =>
    [
      `export const meta = { name: "Folder", input: ${input} };`,
      "export default async function () {",
      "  const none = {};",
      `  await agent("go", { agent: "claude", label: "Go", profile: "work"${cwd} });`,
      "}",
      "",
    ].join("\n");

  it("R8c (slices 7–9 review F6): a run's folder is held at its start, on its journal's head: a step after its input's folder moved runs in the begin's; a head that holds one is read at the wake, and one from before it falls back to the input", async () => {
    const folders: Record<string, string> = { "session:run-yours": "/work/yours" };
    const h = await harness({ folders });
    h.approved(
      "held",
      [
        'export const meta = { name: "Held", input: { target: "session" } };',
        "export default async function () {",
        "  const none = {};",
        '  await agent("go", { agent: "claude", profile: "work", label: "Here", cwd: none.cwd });',
        "}",
        "",
      ].join("\n"),
    );
    const cwdOf = (run: string) => h.spawned.find((spawn) => spawn.origin.run === run)?.launch.cwd;
    const folderOf = (run: string) => {
      const read = h.records.readRun(run);
      return read.kind === "kept" ? read.head.folder : read.kind;
    };
    const start = async () =>
      startedRun(await h.start({ flow: "held", input: { target: "run-yours" } })).run;
    // the input's folder moves after the begin: the step runs in the begin's, as the head keeps it
    const moved = await start();
    folders["session:run-yours"] = "/work/moved";
    await waitFor(() => expect(cwdOf(moved)).toBeDefined());
    expect(cwdOf(moved)).toBe("/work/yours");
    expect(folderOf(moved)).toBe("/work/yours");
    // a head that holds a folder is read at the wake, whatever its input names now
    const begin = h.records.beginRun.bind(h.records);
    const beginning = vi.spyOn(h.records, "beginRun");
    beginning.mockImplementationOnce((entry, at) => begin({ ...entry, folder: "/work/held" }, at));
    const held = await start();
    await waitFor(() => expect(cwdOf(held)).toBeDefined());
    expect(cwdOf(held)).toBe("/work/held");
    // a head from before F6 holds none: its wake falls back to the folder its input names then
    beginning.mockImplementationOnce(({ folder: _folder, ...entry }, at) => begin(entry, at));
    const old = await start();
    expect(folderOf(old)).toBeUndefined();
    await waitFor(() => expect(cwdOf(old)).toBeDefined());
    expect(cwdOf(old)).toBe("/work/moved");
  });

  it("R8b: a step that names no folder, in a run whose input names none, is refused at the start in §9's words, nothing journaled; a session or project its input names that VibeField can't find is refused too, and one whose folder it can't run in (GG1), before any approval; only the folder the run holds, its first input's, is checked (JJ1)", async () => {
    const h = await harness({
      folders: {
        "session:run-yours": "/work/yours",
        "project:pj-1": "/work/pj1",
        // GG1: folders VibeField finds and can't run in, one past the head's bound and empty ones
        "session:run-long": `/${"a".repeat(FLOW_LIMITS.FOLDER_CHARS)}`,
        "session:run-blank": "",
        "project:pj-0": "",
      },
    });
    h.approved("bare", stepWith(""));
    expect(await refusalOf(h.start({ flow: "bare" }))).toEqual({
      reason: "folder",
      message: NO_FOLDER,
    });
    h.approved("in-session", stepWith("", '{ target: "session" }'));
    expect(await refusalOf(h.start({ flow: "in-session", input: { target: "run-gone" } }))).toEqual(
      {
        reason: "input-session",
        message: "VibeField can't find the session its input names.",
      },
    );
    h.approved("in-project", stepWith("", '{ where: "project" }'));
    expect(await refusalOf(h.start({ flow: "in-project", input: { where: "pj-9" } }))).toEqual({
      reason: "input-project",
      message: "VibeField can't find the project its input names.",
    });
    // GG1 (the F6 review; ruled 2026-11-06): one whose folder is past FLOW_LIMITS.FOLDER_CHARS, or empty, is the
    // input's refusal at the start, in §9's PROPOSED words, never the store's degraded words from inside its begin
    const long = h.start({ flow: "in-session", input: { target: "run-long" } });
    expect(await refusalOf(long)).toEqual({
      reason: "input-session",
      message: "VibeField can't run in the folder of the session its input names.",
    });
    const empty = h.start({ flow: "in-project", input: { where: "pj-0" } });
    expect(await refusalOf(empty)).toEqual({
      reason: "input-project",
      message: "VibeField can't run in the folder of the project its input names.",
    });
    // on Run this version too, which approves the bytes it runs: it is refused before the approval, so none is kept
    const asked = stepWith("", '{ target: "session" }');
    const approval = h.approved("in-long", asked);
    const edited = h.write("in-long", `${asked}// edited\n`);
    const waits = waitsOf(await h.start({ flow: "in-long", input: { target: "run-long" } }));
    const act = h.runs.acts.start({
      id: waits,
      flow: "in-long",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    expect(await act).toEqual({
      outcome: "failed",
      reason: "VibeField can't run in the folder of the session its input names.",
    });
    expect(h.records.approval("in-long")?.hash).toBe(approval.hash);
    expect(h.warned.map((said) => said.event)).not.toContain("fieldd.flows.run.write");
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
    expect(h.spawned).toEqual([]);
    // what the start lets through: the input's folder, one written plainly, one computed (held at its call)
    startedRun(await h.start({ flow: "in-session", input: { target: "run-yours" } }));
    startedRun(await h.start({ flow: "in-project", input: { where: "pj-1" } }));
    h.approved("named", stepWith(', cwd: "/work/app"'));
    startedRun(await h.start({ flow: "named" }));
    h.approved("computed", stepWith(", cwd: none.cwd"));
    startedRun(await h.start({ flow: "computed" }));
    await waitFor(() => expect(h.spawned).toHaveLength(3));
    expect(h.spawned.map((spawn) => spawn.launch.cwd).sort()).toEqual([
      "/work/app",
      "/work/pj1",
      "/work/yours",
    ]);
    // JJ1 (the 1l review; ruled 2026-11-06): only the folder the run holds, its first input's, is checked. An
    // unusable first folder is refused, never passed over for the next input's (no silent fallback)
    h.approved("two", stepWith("", '{ target: "session", other: "session" }'));
    const passed = h.start({ flow: "two", input: { target: "run-long", other: "run-yours" } });
    expect(await refusalOf(passed)).toEqual({
      reason: "input-session",
      message: "VibeField can't run in the folder of the session its input names.",
    });
    // and a later input's folder, which nothing of the run's uses, refuses nothing, empty or past the bound
    for (const other of ["run-blank", "run-long"]) {
      const started = h.start({ flow: "two", input: { target: "run-yours", other } });
      expect(await refusalOf(started), other).toBe("started");
      const read = h.records.readRun(startedRun(await started).run);
      expect(read.kind === "kept" ? read.head.folder : read.kind, other).toBe("/work/yours");
    }
  });

  it("says R8b's refusals in DESIGN.md's own words (§9 \"When a run can't start\")", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      words.inputNotFound("session"),
      words.inputNotFound("project"),
      words.folderUnusable("session"),
      words.folderUnusable("project"),
      NO_FOLDER,
    ]) {
      expect(said).not.toBe("");
      expect(design, said).toContain(`"${said}"`);
    }
  });
});

// CP-4a2b (§13a slice 9b; ruled 2026-11-06) — a step handed a live session by `in:` (D9). The runs tell the step listener
// at the hand (`stepEnds.hand`, flow-step-events.ts), before the step's line is queued, so the session's turn ends are
// heard as the step's; they let it go at the answer, at a failed turn and at the run's end, and keep it through a
// miss's repair turn. The harness's endTurn stands for the listener; flow-step-events.test.ts's SH rows hold its side.

const HANDED_YOURS: FlowStepSession = { live: true, profile: "work", onPermission: false };
/** One step handed your session, its answer's text the run's log line; `more` adds to its options. */
const handedTo = (more = "") =>
  [
    'export const meta = { name: "Handed" };',
    "export default async function () {",
    `  const said = await agent("Review this", { in: "run-yours", label: "Yours"${more} });`,
    "  log(said.text);",
    "}",
    "",
  ].join("\n");
/** Slice 13's fold 1 (R19h-6; shared since fold 2, R19h-7 and R19h-8) — the harness's hand, its let-go throwing the
 * first time it is called, as a listener that throws would. */
const letGoThrows = (h: Harness) => {
  const { stepEnds } = h.runs.ports;
  const hand = stepEnds.hand.bind(stepEnds);
  vi.spyOn(stepEnds, "hand").mockImplementation((runtimeRunId, step) => {
    const unhand = hand(runtimeRunId, step);
    if (unhand === undefined) return undefined;
    let thrown = false;
    return () => {
      unhand();
      if (thrown) return;
      thrown = true;
      throw new Error("the step listener could not let go");
    };
  });
};
/** How many times fieldd's log said a handed session could not be let go (slice 13's fold 1). */
const unhandWarns = (h: Harness) =>
  h.warned.filter((said) => said.event === "fieldd.flows.step.unhand").length;
/** Slice 13's fold 3 (the fold 2 skeptic's #6) — what each of those warns named: its run and call, and the let-go's
 * own words, so a let-go said of the wrong step goes red. */
const unhandSaid = (h: Harness) =>
  h.warned.filter((said) => said.event === "fieldd.flows.step.unhand").map((said) => said.fields);

describe("CP-4a2b — a step handed a session: heard from the hand, let go at the answer (§13a slice 9b)", () => {
  it("R19h (9b): the runs hand the step listener your session before the step's line is queued; its turn's end answers, and the hand is let go at the answer", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.enqueued[0]).toMatchObject({ runtimeRunId: "run-yours", text: "Review this" });
    expect(h.hands).toEqual([{ runtimeRunId: "run-yours", run, call: 1, at: 0, gone: false }]);
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "run-yours",
      turn: "t1",
      outcome: "completed",
      text: "looks good",
    });
    expect(h.hands.map((hand) => hand.gone)).toEqual([true]);
    expect((await settled(h.runs, run, "done")).log).toBe("looks good");
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
  });

  it("R19h-2 (9b, CP4-Q7 (a)): a handed step's miss keeps the hand through its repair turn, sent to the same session; the answer lets it go", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo(`, schema: ${FORM}`));
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const at = { run, call: 1, runtimeRunId: "run-yours", outcome: "completed" } as const;
    h.endTurn({ ...at, turn: "t1", text: "no fenced block here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    expect(h.enqueued[1]).toMatchObject({
      runtimeRunId: "run-yours",
      text: repairLine("the answer holds no JSON the form can read"),
    });
    expect(h.hands.map((hand) => hand.gone)).toEqual([false]);
    h.endTurn({ ...at, turn: "t2", text: fenced('{"verdict":"clean"}') });
    expect(h.hands.map((hand) => hand.gone)).toEqual([true]);
    await settled(h.runs, run, "done");
  });

  it("R19h-3 (9b): a failed turn lets the hand go, and so does the run's end with its handed step unanswered", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved(
      "fails",
      [
        'export const meta = { name: "Fails" };',
        "export default async function () {",
        '  try { await agent("Review this", { in: "run-yours", label: "Yours" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n"),
    );
    h.approved(
      "leaves",
      [
        'export const meta = { name: "Leaves" };',
        "export default async function () {",
        '  agent("Look later", { in: "run-yours", label: "Later" });',
        '  return "early";',
        "}",
        "",
      ].join("\n"),
    );
    const fails = startedRun(await h.start({ flow: "fails" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    h.endTurn({ run: fails, call: 1, runtimeRunId: "run-yours", turn: "t1", outcome: "failed" });
    expect(h.hands).toEqual([
      { runtimeRunId: "run-yours", run: fails, call: 1, at: 0, gone: true },
    ]);
    expect((await settled(h.runs, fails, "done")).log).toBe("Yours failed.");
    const leaves = startedRun(await h.start({ flow: "leaves" })).run;
    await settled(h.runs, leaves, "done");
    expect(h.hands.filter((hand) => hand.run === leaves)).toEqual([
      { runtimeRunId: "run-yours", run: leaves, call: 1, at: 1, gone: true },
    ]);
  });

  it('R19h-4 (9b, review F3): a step handed a session the step listener never heard enter is refused "‹label› failed." before its line is queued, never left waiting', async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS }, unheard: ["run-yours"] });
    h.approved(
      "unheard",
      [
        'export const meta = { name: "Unheard" };',
        "export default async function () {",
        '  try { await agent("Review this", { in: "run-yours", label: "Yours" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n"),
    );
    const run = startedRun(await h.start({ flow: "unheard" })).run;
    await waitFor(() => expect(h.enqueued.length + refusalsOf(h, run).length).toBeGreaterThan(0));
    expect(h.enqueued).toEqual([]);
    expect(refusalsOf(h, run)).toEqual(["Yours failed."]);
    expect((await settled(h.runs, run, "done")).log).toBe("Yours failed.");
    expect(h.hands).toEqual([]);
  });

  it("R19h-5 (9b): fieldd's own stop lets a handed step's hand go, the run left as it stands for the next boot", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.hands.map((hand) => hand.gone)).toEqual([false]);
    await h.runs.close();
    expect(h.hands.map((hand) => hand.gone)).toEqual([true]);
    expect(h.records.runRecord(run)?.state).toBe("running");
  });

  it("R19h-6 (slice 13's fold 1; the green skeptic's #6): a hand whose let-go throws is said in fieldd's log and never skips the end: a Stop of a run whose handed step works ends it `stopped`, its `end` kept, and answers; and fieldd's own stop lets the hand go and resolves", async () => {
    // red at the unfixed green: #letGo calls each unhand() uncaught, so the throw leaves #finish past its
    // `#live.delete` and skips #closeEnd: the host's end is "not kept" in fieldd's log, the record stays `stopping`, no
    // `end` is journaled, and the Stop never answers; and close() rejects with the throw
    /** "not kept", once fieldd's log says a host's end of `h`'s runs was not kept: what a throw out of #finish reads as. */
    const notKept = (h: Harness) =>
      new Promise<string>((resolve) => {
        const logger = h.runs.ports.logger;
        if (logger === undefined) return;
        const error = logger.error.bind(logger);
        vi.spyOn(logger, "error").mockImplementation((...args) => {
          error(...args);
          if (args[0] === "fieldd.flows.run.ended") resolve("not kept");
        });
      });
    // the Stop's road: the end's own #letGo meets the throw
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    letGoThrows(h);
    const lost = notKept(h);
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const stopped = await Promise.race([h.runs.stop(run).then((answer) => answer.run.state), lost]);
    const stopLeg = {
      stopped,
      record: h.records.runRecord(run)?.state,
      hands: h.hands.map((hand) => hand.gone),
      ends: h.kinds(run).filter((kind) => kind === "end").length,
      warned: unhandWarns(h),
    };
    // fieldd's own stop: close()'s #letGo meets it
    const c = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    c.approved("handed", handedTo());
    letGoThrows(c);
    const left = startedRun(await c.start({ flow: "handed" })).run;
    await waitFor(() => expect(c.enqueued).toHaveLength(1));
    const closed = await c.runs.close().then(
      () => "closed",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const closeLeg = {
      closed,
      record: c.records.runRecord(left)?.state,
      hands: c.hands.map((hand) => hand.gone),
      warned: unhandWarns(c),
    };
    expect({ stopLeg, closeLeg }).toEqual({
      stopLeg: { stopped: "stopped", record: "stopped", hands: [true], ends: 1, warned: 1 },
      closeLeg: { closed: "closed", record: "running", hands: [true], warned: 1 },
    });
  });

  it("R19h-7 (slice 13's fold 2; the builder's #14): a hand whose let-go throws at its step's answer is said once in fieldd's log: the answer is journaled, the turn end that answered it returns, and the run ends done", async () => {
    // red at fold 1: #answer called the let-go uncaught, after the call left `waiting` and before its line, so the
    // throw left the turn end, nothing was journaled, and the run waited on an answer no turn would give again
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    letGoThrows(h);
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    let turn = "returned";
    try {
      h.endTurn({
        run,
        call: 1,
        runtimeRunId: "run-yours",
        turn: "t1",
        outcome: "completed",
        text: "looks good",
      });
    } catch (error) {
      turn = error instanceof Error ? error.message : String(error);
    }
    // read in the turn end's own tick: the answer's line is appended there, and the host has heard nothing back yet
    expect({
      turn,
      kinds: h.kinds(run),
      hands: h.hands.map((hand) => hand.gone),
      warned: unhandWarns(h),
    }).toEqual({ turn: "returned", kinds: ["head", "call", "answer"], hands: [true], warned: 1 });
    expect((await settled(h.runs, run, "done")).log).toBe("looks good");
    expect(unhandWarns(h)).toBe(1);
    // fold 3 (the fold 2 skeptic's #6): the warn names the step whose hand it let go
    expect(unhandSaid(h)).toEqual([{ run, call: 1, error: "the step listener could not let go" }]);
  });

  it("R19h-8 (slice 13's fold 2; the builder's #14): a handed start that settles on a step its run no longer waits on lets the hand go through the one caught let-go: a let-go that throws is said once as a let-go, never as a start that threw, and lands no \"‹label› failed.\"", async () => {
    // red at fold 1: #launched's `else started.unhand()` sat uncaught inside its `try`, so the throw reached the
    // catch and fieldd's log said "A flow step's start threw; the step failed" (`fieldd.flows.step.start`) of a step
    // whose agent answered it. The catch's own answer was already undriven on this road (the call no longer waits),
    // so no "Yours failed." line landed then either; that half is pinned green at both.
    // The road, seen deterministically: a handed start awaits nothing, so its run can stop waiting on the step only in
    // the start's own turn. Here the queue's take of the line ends the step's turn in that turn, as a port that
    // re-enters would: the turn's answer lands before the start settles, and the start then lets the hand go itself.
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    letGoThrows(h);
    const { inputs } = h.runs.ports;
    const enqueue = inputs.enqueue.bind(inputs);
    vi.spyOn(inputs, "enqueue").mockImplementation((runtimeRunId, text, from) => {
      const queued = enqueue(runtimeRunId, text, from);
      if (from.kind === "flow")
        h.endTurn({
          run: from.run,
          call: from.call,
          runtimeRunId,
          turn: "t1",
          outcome: "completed",
          text: "looks good",
        });
      return queued;
    });
    const run = startedRun(await h.start({ flow: "handed" })).run;
    const log = (await settled(h.runs, run, "done")).log;
    expect({
      log,
      refusals: refusalsOf(h, run),
      hands: h.hands.map((hand) => hand.gone),
      unhand: unhandWarns(h),
      threw: h.warned.filter((said) => said.event === "fieldd.flows.step.start").length,
    }).toEqual({ log: "looks good", refusals: [], hands: [true], unhand: 1, threw: 0 });
    // fold 3 (the fold 2 skeptic's #6): the warn names the step whose hand it let go
    expect(unhandSaid(h)).toEqual([{ run, call: 1, error: "the step listener could not let go" }]);
  });

  it("R19h-9 (slice 13's fold 3; the fold 2 skeptic's #1): a handed start whose send throws, and whose own let-go throws too, is said once as a let-go, and its failed start keeps the send's cause in fieldd's log", async () => {
    // red at fold 2: startStep's handed road let go uncaught when `sent` threw (steps.ts's `unhand(); throw error;`),
    // so the let-go's error replaced the send's: `fieldd.flows.step.start` named the let-go, and no
    // `fieldd.flows.step.unhand` was said
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved(
      "handed",
      [
        'export const meta = { name: "Handed" };',
        "export default async function () {",
        '  try { await agent("Review this", { in: "run-yours", label: "Yours" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n"),
    );
    letGoThrows(h);
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementation(() => {
      throw new Error("the queue refused the line");
    });
    const run = startedRun(await h.start({ flow: "handed" })).run;
    const log = (await settled(h.runs, run, "done")).log;
    expect({
      log,
      hands: h.hands.map((hand) => hand.gone),
      start: h.warned
        .filter((said) => said.event === "fieldd.flows.step.start")
        .map((said) => said.fields),
      unhand: unhandSaid(h),
    }).toEqual({
      log: "Yours failed.",
      hands: [true],
      start: [{ run, call: 1, error: "the queue refused the line" }],
      unhand: [{ run, call: 1, error: "the step listener could not let go" }],
    });
  });
});

// CP-4a2b (§13a slice 7's R4–R6; CP4-Q5 (a), Q4, D8) — a changed flow's acts, as the needs queue hands the runs the
// person's choice (`acts.start`): the version chosen, the start as it was asked (the item record's, Q4) and a spark's
// `from`. Run this version approves the bytes the item asked about, as yours ("Run this version (approves it)",
// round-flows CP4-Q5 (a)), then begins the asked-for run on them; Run the one you approved begins it on the approved
// bytes fieldd kept. The start's scope is narrowed to the profiles that exist at the act, never widened (D8). An act
// that can't begin is failed in §9's start words, with nothing approved and nothing begun. Not now is the queue's
// alone (needs-queue N5): no act reaches the runs.

/** A flow with an input whose version changed since its approval. */
const TARGETS_EDITED = TAKES_TARGET.replace('log("target: " + target)', 'log("aim: " + target)');

/** The item a start waits in, or the row fails saying what it got instead. */
function waitsOf(started: FlowRunStarted): NeedsItemId {
  if (!("waits" in started)) throw new Error(`the start began ${started.run.run}`);
  return started.waits;
}

/** The start the n-th raise kept, as the queue hands it back with the act (Q4). */
function askedOf(h: { readonly raised: readonly FlowChangedRaise[] }, n: number) {
  const raised = h.raised[n];
  if (raised === undefined) throw new Error(`no raise ${n}: ${h.raised.length} were raised`);
  return raised.start;
}

/** The run an act began, or the row fails saying why it did not. */
function ranOf(started: FlowItemStarted): string {
  if (started.outcome !== "done") throw new Error(`the act failed: ${started.reason}`);
  return started.run;
}

describe("CP-4a2b — a changed flow's acts begin the asked-for run (§13a slice 7's R4–R6)", () => {
  it("R4 (CP4-Q5 (a), Q4, D8): Run this version approves the asked-about bytes as yours and begins the asked-for run on them, its input carried and its scope narrowed to the profiles that exist", async () => {
    const h = await harness({ folders: { "session:run-yours": "/work/yours" } });
    h.approved("targets", TAKES_TARGET);
    const edited = h.write("targets", TARGETS_EDITED);
    const waits = waitsOf(
      await h.start({ flow: "targets", input: { target: "run-yours" }, scope: ["work", "review"] }),
    );
    // D8: the scope is the start's, narrowed at the act to the profiles that exist, never widened by a new one
    h.setProfiles(["work", "home"]);
    const run = ranOf(
      await h.runs.acts.start({
        id: waits,
        flow: "targets",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    );
    expect(h.records.approval("targets")).toMatchObject({ hash: flowHashOf(edited), by: "you" });
    expect(h.records.runRecord(run)).toMatchObject({
      flow: "targets",
      hash: flowHashOf(edited),
      starter: { by: "you" },
      scope: ["work"],
    });
    const read = h.records.readRun(run);
    expect(read.kind === "kept" ? read.head.input : read.kind).toEqual({ target: "run-yours" });
    expect((await settled(h.runs, run, "done")).log).toBe("aim: run-yours");
  });

  it("R5 (CP4-Q5 (a), Q4): Run the one you approved begins a spark's asked-for run on the approved bytes fieldd kept, its approval unchanged", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    h.write("hello", HELLO_EDITED);
    const waits = waitsOf(
      await h.start({ starter: { by: "spark", spark: VELA }, from: VELA_FROM }),
    );
    const run = ranOf(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: approval.hash,
        version: "approved",
        start: askedOf(h, 0),
        from: VELA_FROM,
      }),
    );
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    expect(h.records.runRecord(run)).toMatchObject({
      hash: approval.hash,
      starter: { by: "spark", spark: VELA },
    });
    expect((await settled(h.runs, run, "done")).log).toBe("hi");
  });

  it("R5b (R4–R6 review H1): Run the one you approved runs the approval standing at the act, never the one that stood at the ask", async () => {
    const h = await harness();
    const first = h.approved("hello", HELLO);
    h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the approval moves on after the ask: a third version is approved, as the library's or a proposal's is
    const standing = h.approved("hello", `${HELLO}// a third version\n`);
    const act = h.runs.acts.start({
      id: waits,
      flow: "hello",
      hash: first.hash,
      version: "approved",
      start: askedOf(h, 0),
    });
    const run = ranOf(await act);
    expect(h.records.runRecord(run)?.hash).toBe(standing.hash);
    await settled(h.runs, run, "done");
  });

  it("R5c (R4–R6 review H1): Run the one you approved, for a flow with no approval standing at the act, is refused in §9's version words and begins nothing, though bytes are kept under its hash", async () => {
    const h = await harness();
    // a proposal keeps its bytes, and approves nothing
    const kept = h.records.keep(h.write("fresh", HELLO));
    const waits = waitsOf(await h.start({ flow: "fresh" }));
    const act = h.runs.acts.start({
      id: waits,
      flow: "fresh",
      hash: kept,
      version: "approved",
      start: askedOf(h, 0),
    });
    expect(await act).toEqual({ outcome: "failed", reason: words.notAVersion("fresh") });
    expect(h.records.approval("fresh")).toBeUndefined();
    expect(h.records.runRecords()).toEqual([]);
  });

  it("R4d (R4–R6 review H3): Run this version, on a version that already stands, approves nothing again: its approval keeps its approvedAt and the proposal it came from", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the version asked about is approved meanwhile, from a spark's proposal
    const standing = h.records.approve("hello", edited, { proposal: "fp-k3v9q2m7" });
    const act = h.runs.acts.start({
      id: waits,
      flow: "hello",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    const run = ranOf(await act);
    expect(h.records.approval("hello")).toEqual(standing);
    expect(h.records.runRecord(run)?.hash).toBe(standing.hash);
    await settled(h.runs, run, "done");
  });

  it("R4e (the version review NN3, ruled 2026-11-06): Run this version, on a version that stands whose kept bytes were edited in place, runs it: the library's file, whose hash is the standing one, keeps its bytes again, and approves nothing", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the version asked about is approved meanwhile, and then its kept bytes are edited in place (an agent's)
    const standing = h.records.approve("hello", edited, { proposal: "fp-k3v9q2m7" });
    const kept = join(h.root, "fieldd", "flows", "bytes", `${standing.hash}.flow.js`);
    writeFileSync(kept, 'export const meta = { name: "Edited" };\n');
    const acted = await h.runs.acts.start({
      id: waits,
      flow: "hello",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    expect(acted).toMatchObject({ outcome: "done" });
    expect(readFileSync(kept, "utf8")).toBe(HELLO_EDITED);
    expect(h.records.approval("hello")).toEqual(standing);
    const run = ranOf(acted);
    expect(h.records.runRecord(run)?.hash).toBe(standing.hash);
    await settled(h.runs, run, "done");
  });

  it("R4b (R4–R6 review G2; CP-L4, TL-D5): a spark's kept start, its own or a Run in its thread, narrows again at its act to the spark's Agent Profiles now; a spark that is gone starts nothing, nothing approved", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const own = waitsOf(
      await h.start({
        starter: { by: "spark", spark: VELA },
        from: VELA_FROM,
        scope: ["work", "review"],
      }),
    );
    // Vela is under review alone since it asked, as an Allow re-reads it
    h.setSparkScope(VELA, ["review"]);
    const run = ranOf(
      await h.runs.acts.start({
        id: own,
        flow: "hello",
        hash: approval.hash,
        version: "approved",
        start: askedOf(h, 0),
        from: VELA_FROM,
      }),
    );
    expect(h.records.runRecord(run)?.scope).toEqual(["review"]);
    await settled(h.runs, run, "done");
    // a Run in Vela's thread is yours, its scope Vela's (CP4-Q20 (a)): acted on once Vela is gone
    const thread = waitsOf(
      await h.start({ starter: { by: "you", spark: VELA }, scope: ["review"] }),
    );
    h.setSparkScope(VELA, undefined);
    expect(
      await h.runs.acts.start({
        id: thread,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 1),
      }),
    ).toEqual({ outcome: "failed", reason: words.noSpark() });
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    expect(h.records.runRecords().map((record) => record.run)).toEqual([run]);
  });

  it("R4c (the 1b review V5; 1e review AA1): a start whose asked Agent Profiles, narrowed as it starts, leave none starts nothing, before any approval, in §9's words by cause: the spark's narrowing at the act, or none that exists as it begins", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const act = (id: string, n: number, from?: typeof VELA_FROM) =>
      h.runs.acts.start({
        id,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, n),
        ...(from !== undefined ? { from } : {}),
      });
    // Vela's own, asked under work: Vela is under review alone since, so none it asked for is Vela's now
    const own = waitsOf(
      await h.start({ starter: { by: "spark", spark: VELA }, from: VELA_FROM, scope: ["work"] }),
    );
    h.setSparkScope(VELA, ["review"]);
    expect(await act(own, 0, VELA_FROM)).toEqual({
      outcome: "failed",
      reason: words.noSparkProfiles("Vela"),
    });
    // a Run in Vela's thread, asked under work, is narrowed by Vela the same way (G2): Vela's words
    const spun = waitsOf(await h.start({ starter: { by: "you", spark: VELA }, scope: ["work"] }));
    expect(await act(spun, 1)).toEqual({
      outcome: "failed",
      reason: words.noSparkProfiles("Vela"),
    });
    // one asked under review, which Vela keeps, once review exists no more: that is the cause, whoever's run it is
    // (AA1), so none it asked for exists now
    const thread = waitsOf(
      await h.start({ starter: { by: "you", spark: VELA }, scope: ["review"] }),
    );
    h.setProfiles(["work"]);
    expect(await act(thread, 2)).toEqual({ outcome: "failed", reason: words.noProfiles() });
    // yours, under review: the same
    const yours = waitsOf(await h.start({ scope: ["review"] }));
    expect(await act(yours, 3)).toEqual({ outcome: "failed", reason: words.noProfiles() });
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    expect(h.records.runRecords()).toEqual([]);
    // the door, on the approved version: none that exists, for yours and a spark's own alike (AA1), before any record
    h.approved("hello", HELLO);
    expect(await refusalOf(h.start({ scope: ["review"] }))).toEqual({
      reason: "no-profiles",
      message: words.noProfiles(),
    });
    expect(
      await refusalOf(
        h.start({ starter: { by: "spark", spark: VELA }, from: VELA_FROM, scope: ["review"] }),
      ),
    ).toEqual({ reason: "no-profiles", message: words.noProfiles() });
    expect(h.records.runRecords()).toEqual([]);
    // a scope that keeps one it asked for starts, narrowed to it (D8)
    const run = startedRun(await h.start({ scope: ["review", "work"] }));
    expect(h.records.runRecord(run.run)?.scope).toEqual(["work"]);
    await settled(h.runs, run.run, "done");
  });

  it("R6 (CP4-Q5 (a); R4–R6 review H5): an act that can't begin is failed in §9's start words, nothing approved and nothing begun: a version changed again since it asked, an input the version no longer takes, and a bound reached since", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    h.write("hello", `${HELLO_EDITED}// and again\n`);
    expect(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    ).toEqual({ outcome: "failed", reason: words.notAVersion("hello") });
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    // a version that takes no input, asked to run with one: refused before its approval is written
    const targets = h.approved("targets", TAKES_TARGET);
    const bare = h.write(
      "targets",
      'export const meta = { name: "Targets" };\nexport default async function () {}\n',
    );
    const asked = waitsOf(await h.start({ flow: "targets", input: { target: "run-yours" } }));
    expect(
      await h.runs.acts.start({
        id: asked,
        flow: "targets",
        hash: flowHashOf(bare),
        version: "this",
        start: askedOf(h, 1),
      }),
    ).toEqual({ outcome: "failed", reason: words.noSuchInput("Targets", "target") });
    expect(h.records.approval("targets")?.hash).toBe(targets.hash);
    expect(h.records.runRecords()).toEqual([]);
    // a bound reached since it asked (D3): refused before its approval is written, as every refusal is
    const bound = waitsOf(await h.start({ flow: "targets" }));
    for (let i = 0; i < FLOW_LIMITS.RUNS_LIVE_MAX; i += 1) seeded(h, i, "running");
    expect(
      await h.runs.acts.start({
        id: bound,
        flow: "targets",
        hash: flowHashOf(bare),
        version: "this",
        start: askedOf(h, 2),
      }),
    ).toEqual({ outcome: "failed", reason: words.runsLive("Targets") });
    expect(h.records.approval("targets")?.hash).toBe(targets.hash);
  });

  it("R6c (R4–R6 review H2): Run this version checks the run's begin before it approves, so the store's refusal leaves no approval; a disk's refusal is said in §9's words, never its own, and past the checks the run never began", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const act = async () => {
      const waits = waitsOf(await h.start());
      return h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, h.raised.length - 1),
      });
    };
    // the runs store refuses the run's begin (item 172's guard): refused before the approval is written
    const refusing = vi.spyOn(h.records, "checkBegin").mockImplementation(() => {
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    expect(await act()).toEqual({ outcome: "failed", reason: UNREADABLE_WORDS.flows });
    refusing.mockRestore();
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    // a disk that refuses the approval: nothing was changed, so the store's sentence says it, never the disk's words
    const approving = vi.spyOn(h.records, "approve").mockImplementation(() => {
      throw new Error("EIO: i/o error, write");
    });
    expect(await act()).toEqual({ outcome: "failed", reason: UNREADABLE_WORDS.flows });
    approving.mockRestore();
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    // the one window past the checks, at its REAL write (1b review V2): a disk that takes the approval and the run's
    // record and refuses its head (the journals' folder is a file). The run never began, in §9's words, in this life
    // too: its record is ended `failed` in them. The approval, the person's own, stands
    writeFileSync(join(h.root, "fieldd", "flows", RUNS_DIR), "not a folder");
    expect(await act()).toEqual({ outcome: "failed", reason: words.neverBegan("Hello") });
    expect(h.records.approval("hello")?.hash).toBe(flowHashOf(edited));
    expect(h.records.runRecords()).toMatchObject([
      { state: "failed", log: words.neverBegan("Hello") },
    ]);
  });

  it("R6d (ruled 2026-11-06, window (c)): once the run's record is kept the run has begun, so the act is done with it; a read-back that throws past it is logged, and the run is listed as its record says", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the record is kept, and the read that follows it is the disk's to refuse
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "runRecord").mockImplementationOnce(() => {
        throw new Error("EIO: i/o error, read");
      });
      return head;
    });
    const run = ranOf(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    );
    expect(h.records.approval("hello")?.hash).toBe(flowHashOf(edited));
    expect(h.runs.list().runs.map((summary) => summary.run)).toEqual([run]);
    // its host never started: the record says it runs, and slice 14's boot wakes it
    expect(h.records.runRecord(run)?.state).toBe("running");
  });

  it("R6e (1a review W1, W2): a door's start whose run's record is kept answers that run, as #begin wrote it, though its read-back throws; the list its subscribers hear holds it", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const told: FlowRunsList[] = [];
    h.runs.onChange((list) => void told.push(list));
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "runRecord").mockImplementationOnce(() => {
        throw new Error("EIO: i/o error, read");
      });
      return head;
    });
    const summary = startedRun(await h.start());
    expect(summary).toMatchObject({
      flow: "hello",
      name: "Hello",
      n: 1,
      state: "running",
      calls: 0,
      steps: [],
      starter: { by: "you" },
    });
    expect(told.at(-1)?.runs.map((run) => run.run)).toEqual([summary.run]);
    // its host never started: the record says it runs, and slice 14's boot wakes it
    expect(h.records.runRecord(summary.run)?.state).toBe("running");
  });

  it("R6f (1a review W3): a run whose record reads back as nothing, or whose journal reads as none VibeField keeps, is no run it can wake: the door and the act answer that it never began, and its record ends so", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // the door's start: the record is kept, and reads back as nothing (set aside, or held)
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "runRecord").mockReturnValueOnce(undefined);
      return head;
    });
    await expect(h.start()).rejects.toMatchObject({ message: words.neverBegan("Hello") });
    expect(h.records.runRecords()).toMatchObject([
      { state: "failed", log: words.neverBegan("Hello") },
    ]);
    // the act: the record reads back, and its journal reads as no journal
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    vi.spyOn(h.records, "readRun").mockReturnValueOnce({ kind: "absent" });
    expect(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    ).toEqual({ outcome: "failed", reason: words.neverBegan("Hello") });
    expect(h.records.runRecords().map((record) => record.state)).toEqual(["failed", "failed"]);
  });

  it("R6g (1b review V2; 1d review Z3; 1f+1g review BB1): a run that never began, its record kept and its ending refused too, is passed by at the bounds until a restart settles it, and reads in this life as never begun, its subscribers told", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const told: FlowRunsList[] = [];
    h.runs.onChange((list) => void told.push(list));
    const journals = join(h.root, "fieldd", "flows", RUNS_DIR);
    writeFileSync(journals, "not a folder");
    vi.spyOn(h.records, "endUnbegun").mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device, write");
    });
    await expect(h.start()).rejects.toMatchObject({ message: words.neverBegan("Hello") });
    expect(h.records.runRecords()).toMatchObject([{ state: "running" }]);
    // Z3: the record stands as the disk keeps it, and this life reads the run failed, in §9's words
    const unbegun = h.records.runRecords()[0]?.run ?? "";
    const said = { state: "failed", log: words.neverBegan("Hello"), endedAt: expect.any(String) };
    expect(h.runs.list().runs).toMatchObject([{ run: unbegun, ...said }]);
    expect(h.runs.read(unbegun)?.summary).toMatchObject(said);
    // BB1: its subscribers' last frame holds it so too
    expect(told.at(-1)?.runs).toMatchObject([{ run: unbegun, ...said }]);
    // the journals' folder answers again: RUNS_LIVE_MAX running records, the one that never began among them
    rmSync(journals);
    for (let i = 0; i < FLOW_LIMITS.RUNS_LIVE_MAX - 1; i += 1) seeded(h, i, "running");
    expect(startedRun(await h.start()).state).toBe("running");
  });

  it("R6i (1d review Z4): a run whose bytes are gone by its wake is ended lost there, and the door answers it lost, as its record says", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // its begin reads the approved bytes; by its wake they are gone (D8: bytes that no longer hash are lost)
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "bytes").mockReturnValue(undefined);
      return head;
    });
    const summary = startedRun(await h.start());
    expect(summary.state).toBe("lost");
    expect(h.records.runRecord(summary.run)?.state).toBe("lost");
  });

  it("R6j (1f+1g review BB3): a woken run whose record can't be read again is answered as it was read: the door says running, fieldd's warn says why, and the record reads lost", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // R6i's road: its bytes are gone by its wake, so the wake ends it lost
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "bytes").mockReturnValue(undefined);
      return head;
    });
    // the read after the wake, the first to find it lost, is the disk's to refuse. This holds only while nothing
    // subscribes: a subscriber's list() would take the spied throw into #finish's catch (1h review DD2)
    const read = h.records.runRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "runRecord").mockImplementation((run) => {
      const record = read(run);
      if (!refused && record?.state === "lost") {
        refused = true;
        throw new Error("EIO: i/o error, read");
      }
      return record;
    });
    const summary = startedRun(await h.start());
    expect(refused).toBe(true);
    expect(summary.state).toBe("running");
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.run.reread");
    expect(h.records.runRecord(summary.run)?.state).toBe("lost");
  });

  it("R6h (1b review V4): a records write the disk refuses at a run's begin is said in the store's own shape, UNAVAILABLE for the flows, in its sentence", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    vi.spyOn(h.records, "checkBegin").mockImplementationOnce(() => {
      throw new Error("EIO: i/o error, stat");
    });
    await expect(h.start()).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: UNREADABLE_WORDS.flows,
      details: { service: RECORD_STORES.SERVICE_FLOWS, state: RECORD_STORES.STATE_UNREADABLE },
    });
    expect(h.records.runRecords()).toEqual([]);
  });

  it("R6k (the F4b fix review; ruled 2026-11-06): a run's end the disk refuses, its list then unreadable too, is said in fieldd's log as the end's own failure, never the list's; the list's is said as a tell's", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // a subscriber, so the end's catch reads the list; the store refuses that one read, just after the end's line
    h.runs.onChange(() => undefined);
    const append = h.records.appendRun.bind(h.records);
    const listed = h.records.runRecords.bind(h.records);
    const full = "ENOSPC: no space left on device, write";
    let refusing = false;
    vi.spyOn(h.records, "appendRun").mockImplementation((run, entry) => {
      if (entry.kind !== "end") return append(run, entry);
      refusing = true;
      throw new Error(full);
    });
    vi.spyOn(h.records, "runRecords").mockImplementation(() => {
      if (!refusing) return listed();
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const run = startedRun(await h.start()).run;
    const errors = () => h.errored.map(({ event }) => event);
    await waitFor(() => expect(errors()).toContain("fieldd.flows.run.end"));
    const told = h.warned.filter(({ event }) => event === "fieldd.flows.run.told");
    expect(h.errored).toEqual([
      { event: "fieldd.flows.run.end", error: expect.objectContaining({ run, error: full }) },
    ]);
    expect(told).toEqual([
      { event: "fieldd.flows.run.told", fields: { error: UNREADABLE_WORDS.flows } },
    ]);
  });

  // slice 13 (Q1, Q14; BB6: "flows.stop judges 'ended' by #isLive or the summary, never by record.state"): Stop of a
  // run that has ended answers it as it is, and a run whose end the disk refused, live on its record with no LiveRun,
  // is healed by its Stop (`#finishStop`)

  it("R44 (a pin, green at red-a; slice 13, Q1, BB6): Stop of a done, failed, stopped or lost run, and of one that never began, answers it as it is: it writes nothing and journals nothing", async () => {
    // the pin's mutation: Stop writes on an ended run (a `stopping`, or an `end` line), as a stub that writes would
    const h = await harness();
    const states = ["done", "failed", "stopped", "lost"];
    states.forEach((state, i) => void seeded(h, i, state));
    const runs = states.map((_, i) => `fr-seed${String(i).padStart(4, "0")}x`);
    const kindsBefore = runs.map((run) => h.kinds(run));
    const writes = vi.spyOn(h.records, "writeRunRecord");
    const appends = vi.spyOn(h.records, "appendRun");
    const answered: string[] = [];
    for (const run of runs) answered.push((await h.runs.stop(run)).run.state);
    // R6g's road: a run that never began, its ending refused too, reads failed in this life, in §9's words
    const never = await harness();
    never.approved("hello", HELLO);
    const journals = join(never.root, "fieldd", "flows", RUNS_DIR);
    writeFileSync(journals, "not a folder");
    vi.spyOn(never.records, "endUnbegun").mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device, write");
    });
    await expect(never.start()).rejects.toMatchObject({ message: words.neverBegan("Hello") });
    const unbegun = never.records.runRecords()[0]?.run ?? "";
    const neverWrites = vi.spyOn(never.records, "writeRunRecord");
    const neverAppends = vi.spyOn(never.records, "appendRun");
    const stopped = (await never.runs.stop(unbegun)).run;
    expect({
      answered,
      kinds: runs.map((run) => h.kinds(run)),
      written: writes.mock.calls.length + appends.mock.calls.length,
      never: { state: stopped.state, log: stopped.log },
      neverWritten: neverWrites.mock.calls.length + neverAppends.mock.calls.length,
    }).toEqual({
      answered: states,
      kinds: kindsBefore,
      written: 0,
      never: { state: "failed", log: words.neverBegan("Hello") },
      neverWritten: 0,
    });
  });

  it("R44's BB6 leg (slice 13, Q14 (b)): a run whose `end` line the disk refused is live on its record with no LiveRun, and its Stop ends it stopped with one `end`; one whose record's write was refused after a kept `done` line is answered done from that line, with one `end`", async () => {
    // red-a: the stub answers each run as its record stands, `running`
    /** A HELLO run whose end `refuse` refuses once, then Stopped once fieldd's log says the end was not kept. */
    const refusedThenStopped = async (refuse: (h: Harness) => void) => {
      const h = await harness();
      h.approved("hello", HELLO);
      refuse(h);
      const run = startedRun(await h.start()).run;
      await waitFor(() =>
        expect(h.errored.map(({ event }) => event)).toContain("fieldd.flows.run.end"),
      );
      const stopped = (await h.runs.stop(run)).run;
      return {
        state: stopped.state,
        record: h.records.runRecord(run)?.state,
        ends: h.kinds(run).filter((kind) => kind === "end").length,
      };
    };
    // the end's `end` line refused once: no line, and the record still reads running
    const lineRefused = await refusedThenStopped((h) => {
      const append = h.records.appendRun.bind(h.records);
      let refused = false;
      vi.spyOn(h.records, "appendRun").mockImplementation((at, entry) => {
        if (refused || entry.kind !== "end") return append(at, entry);
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      });
    });
    // the record's write after a kept `done` line refused once: the line stands, the record reads running
    const recordRefused = await refusedThenStopped((h) => {
      const write = h.records.writeRunRecord.bind(h.records);
      let refused = false;
      vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
        if (refused || fields.state !== "done") return write(at, fields);
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      });
    });
    expect({ lineRefused, recordRefused }).toEqual({
      lineRefused: { state: "stopped", record: "stopped", ends: 1 },
      recordRefused: { state: "done", record: "done", ends: 1 },
    });
  });
});

// CP-4a2b (§13a slice 11b; Q9, Q10, Q5; the slice 11 rulings, ruled 2026-11-06, and its rulings for red-a's
// revision, 2026-11-06) — the spark's facts: a run a spark started (its starter `by: "spark"`) tells that spark when the
// run holds on you, once for each hold the needs queue MINTED (Q5: a hold made again, at a wake or a restart, is
// re-bound, and tells nothing more), and when it ends, once its `end` line is kept: done, failed or lost. Your answer
// to a hold tells nothing (the run goes on), a spark that is gone is told nothing, and a Run you start in a spark's
// thread (`{by: "you", spark}`) is yours, and tells the spark nothing (T3b). The runs tell through their `waker` port
// (Q10), which the harness records. A row reads each fact it tells whole, whom and what, and how often (red-b): a fact
// is its words.ts sentence (§9's Proposed "What VibeField tells a spark", bafdcd544), built from the spark's name,
// ‹flow› and the run's id alone, and never holds the gate's question, a step's answer, a log line or what the script
// threw. A hold row runs on the real needs queue (`needsQueue`), whose `minted` decides its tell, and reads that tell
// once told (`within`); the counts across a wake are the host's life's rows, on R13d's and R13e-ask's roads.

/** Vela's own run, from its thread, as its flow_run starts one (slice 11b). */
const VELAS: Partial<FlowRunStartParams> = {
  starter: { by: "spark", spark: VELA },
  from: VELA_FROM,
};

/** The sparks the runs told (slice 11b), one per fact, in order, from the `from`th fact on: whom, never what. */
const toldOf = (h: Harness, from = 0): string[] => h.facts.slice(from).map(({ spark }) => spark);

/** The facts the runs told (slice 11b's red-b), each whole, whom and what, in order, from the `from`th fact on. */
const factsOf = (h: Harness, from = 0) => h.facts.slice(from);

/** What Vela's run `run` of `flow`, whose `meta` names it `name`, tells Vela (slice 11b's red-b, R35, Q9): `fact`, one
 * of words.ts's four, said of Vela by the name the runs know it by (the harness's `sparkOf`, and its start's `from`:
 * both "Vela"), of ‹flow› (`markName`'s) and of the run's id; the whole pair the `waker` port takes. */
const toVela = (fact: typeof words.factAsking, name: string, flow: string, run: string) => ({
  spark: VELA,
  fact: fact(VELA_FROM.name, words.markName(name, flow), run),
});

describe("CP-4a2b — the spark's facts: a run a spark started tells it when the run holds on you, and when it ends (§13a slice 11b)", () => {
  /** A gate whose refusal its script catches and logs: until ask() is built (slice 11a) its run ends done; once it
   * is, the run holds on you. */
  const GATE_CAUGHT = [
    'export const meta = { name: "Gate" };',
    "export default async function () {",
    '  try { log(await ask("Ship it?", ["Ship", "Hold"])); } catch (e) { log(e.message); }',
    "}",
    "",
  ].join("\n");
  /** A script that throws: its run ends failed. */
  const THROWS = [
    'export const meta = { name: "Throws" };',
    "export default async function () {",
    '  throw new Error("no");',
    "}",
    "",
  ].join("\n");
  /** a Run you start in Vela's thread: yours, Vela beside it (T3b) */
  const THREAD: Partial<FlowRunStartParams> = { starter: { by: "you", spark: VELA } };
  /** Whether `run` raised its gate's item. */
  const gated = (h: Harness, run: string): boolean =>
    h.items.some((item) => item.kind === "flow-gate" && item.run.run === run);
  /** Whether `run` has ended, in any way (every end writes its `endedAt`). */
  const ended = (h: Harness, run: string): boolean =>
    h.runs.read(run)?.summary.endedAt !== undefined;
  /** Whether fieldd's log said a run's end was not kept (#finish's catch, R6k). */
  const notKept = (h: Harness): boolean =>
    h.errored.some(({ event }) => event === "fieldd.flows.run.end");

  it("R35 (Q9 (a) and (3), Q5, Q2; slice 11b): a gate a spark's run holds tells that spark once, at its raise on the needs queue; your answer to it tells nothing, the run going on to its step, and the run's end then tells it once", async () => {
    const h = await harness({ needsQueue: true });
    h.approved("ship", GATE_THEN_STEP);
    const run = startedRun(await h.start({ flow: "ship", ...VELAS })).run;
    // its hold, read once told. At this red its ask is refused at its call, and the script's throw ends the run
    // failed: nothing raised, nothing told
    await within(WAIT_MS, () => h.facts.length > 0 || ended(h, run));
    expect({ raised: h.raisedAs.map(({ minted }) => minted), told: factsOf(h) }).toEqual({
      raised: [true],
      told: [toVela(words.factAsking, "Gate then step", "ship", run)],
    });
    // your answer, on the needs queue as a window gives it: the run goes on to its step A, and tells nothing
    const held = h.facts.length;
    await needsOf(h).answer(h.raisedAs[0]?.id ?? "", 0, PRINCIPAL);
    await within(WAIT_MS, () => h.enqueued.length > 0 || ended(h, run));
    const answered = factsOf(h, held);
    // A's answer ends the run, and its end tells once
    h.endTurn({
      run,
      call: 2,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "a",
    });
    await within(WAIT_MS, () => ended(h, run));
    expect({ answered, end: factsOf(h, held), state: h.runs.read(run)?.summary.state }).toEqual({
      answered: [],
      end: [toVela(words.factDone, "Gate then step", "ship", run)],
      state: "done",
    });
  });

  it("R35 (Q9 (a), Q5; slice 11b): a step's second miss, held on you on the needs queue, tells the spark that started its run once; your Ask once more tells nothing, the run going on", async () => {
    // heldOnRepair's road, the run Vela's
    const h = await harness({ needsQueue: true });
    h.approved("review", FORMED_CATCHES);
    const run = startedRun(await h.start({ flow: "review", ...VELAS })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const at = { run, call: 1, runtimeRunId: "rt-step1", outcome: "completed" } as const;
    h.endTurn({ ...at, turn: "t1", text: "no json here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    h.endTurn({ ...at, turn: "t2", text: "still none" });
    await waitFor(() => expect(h.items).toHaveLength(1));
    // its hold, read once told: the wake rides the raise's own road (Q3 (b)), so PARK_MS is ample, and at this red,
    // where nothing tells, the row reads its value inside vitest's budget, never past it
    await within(PARK_MS, () => h.facts.length > 0 || ended(h, run));
    const held = factsOf(h);
    // your Ask once more: the run goes on, and tells nothing
    expect(await askOnceMore(h, run)).toEqual({ outcome: "done" });
    expect({
      raised: h.raisedAs.map(({ minted }) => minted),
      held,
      answered: factsOf(h, held.length),
    }).toEqual({
      raised: [true],
      held: [toVela(words.factAsking, "Review", "review", run)],
      answered: [],
    });
  });

  it("R35 (Q9 (b), D18; slice 11b): a run a spark started tells that spark once when it ends, once its `end` line is kept, whether or not the record's write after it lands: done, failed (its script threw), and lost (its bytes gone by its wake); an `end` line the disk refuses tells nothing, nor an end whose spark is gone", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    h.approved("throws", THROWS);
    /** a run of `flow`, Vela's own, to its end in `state`, and the facts told from its start */
    const toldAtEnd = async (flow: string, state: string) => {
      const from = h.facts.length;
      const run = startedRun(await h.start({ flow, ...VELAS })).run;
      await settled(h.runs, run, state);
      return { run, told: factsOf(h, from) };
    };
    const done = await toldAtEnd("hello", "done");
    const failed = await toldAtEnd("throws", "failed");
    // R6i's road, last in this harness (its bytes stay gone): its begin reads the approved bytes, and by its wake
    // they are gone
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "bytes").mockReturnValue(undefined);
      return head;
    });
    const lost = await toldAtEnd("hello", "lost");
    /** Vela's run of HELLO, its store refusing its `end` line (`line`, R6k's road) or the record's write after
     * that line (`record`), and the facts it told: read once fieldd's log says its end was not kept */
    const refused = async (what: "line" | "record") => {
      const r = await harness();
      r.approved("hello", HELLO);
      const full = new Error("ENOSPC: no space left on device, write");
      const append = r.records.appendRun.bind(r.records);
      const write = r.records.writeRunRecord.bind(r.records);
      vi.spyOn(r.records, "appendRun").mockImplementation((run, entry) => {
        if (what === "line" && entry.kind === "end") throw full;
        return append(run, entry);
      });
      vi.spyOn(r.records, "writeRunRecord").mockImplementation((run, fields) => {
        if (what === "record" && fields.endedAt !== undefined) throw full;
        write(run, fields);
      });
      const run = startedRun(await r.start({ flow: "hello", ...VELAS })).run;
      await within(WAIT_MS, () => notKept(r));
      return { run, told: factsOf(r) };
    };
    // the record's write after the `end` line refused: the line is kept, so the end is told
    const unrecorded = await refused("record");
    // a pin: the `end` line refused tells nothing. It reddens a tell made before the line is kept
    const unkept = await refused("line");
    // a pin: Vela gone by its run's end, so sparkOf finds no one to tell. It reddens a wake with no sparkOf check; and
    // Q9 (1): the spark not told is logged, once (ruled 2026-11-06, from 11b's green skeptic)
    const g = await harness();
    g.approved("review", ANSWERED);
    const run = startedRun(await g.start({ flow: "review", ...VELAS })).run;
    await within(WAIT_MS, () => g.enqueued.length > 0 || ended(g, run));
    g.setSparkScope(VELA, undefined);
    g.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "ok",
    });
    await within(WAIT_MS, () => ended(g, run));
    const gone = {
      state: g.runs.read(run)?.summary.state,
      told: factsOf(g),
      logged: g.warned.filter(({ event }) => event === "fieldd.flows.run.fact").length,
    };
    expect({
      done: done.told,
      failed: failed.told,
      lost: lost.told,
      unrecorded: unrecorded.told,
      unkept: unkept.told,
      gone,
    }).toEqual({
      done: [toVela(words.factDone, "Hello", "hello", done.run)],
      failed: [toVela(words.factFailed, "Throws", "throws", failed.run)],
      lost: [toVela(words.factSetAside, "Hello", "hello", lost.run)],
      unrecorded: [toVela(words.factDone, "Hello", "hello", unrecorded.run)],
      unkept: [],
      gone: { state: "done", told: [], logged: 1 },
    });
  });

  it("R35's Stop leg (slice 13, Q15, W1; red-b): a run a spark started that a Stop ends tells that spark once, in §9's words, \"VibeField: Vela's run of ‹flow› (‹run›) was stopped\"; a second Stop of the ended run tells nothing more", async () => {
    // §9's sentence (W1, DESIGN.md at 48f3216ac), said of §9's Vela, ‹flow› and ‹run›, past its "VibeField: ", which
    // the input queue's mark adds, and with no closing stop: green at red-b, whose words.ts declares it unsaid
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    const said = words.factStopped("Vela", "‹flow›", "‹run›");
    expect(design, said).toContain(`"VibeField: ${said}"`);
    // Vela's run, its step's agent at work and its host live, stopped: a Stop row's one wait is the Stop itself, and
    // what was told is the harness's recording, read after
    const h = await harness();
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review", ...VELAS })).run;
    await within(WAIT_MS, () => h.enqueued.length > 0 || ended(h, run));
    const from = h.facts.length;
    const stopped = (await h.runs.stop(run)).run.state;
    const again = (await h.runs.stop(run)).run.state;
    // red-b: the stub answers the run as it stands (running) and acts on nothing, so nothing ends and nothing is told.
    // Its mutation at the green: END_FACTS without `stopped` (#tell's warn), and the run tells Vela nothing
    expect({ stopped, again, told: factsOf(h, from) }).toEqual({
      stopped: "stopped",
      again: "stopped",
      told: [toVela(words.factStopped, "Review", "review", run)],
    });
  });

  it("R35 (Q9; slice 11b's red-b): a fact is built from the spark's name, ‹flow› and the run's id alone: none holds the gate's question, a step's answer, a log line or what the script threw", async () => {
    // a gate raced against a step: the step's answer wins the race, and the script logs a line and throws, its gate
    // still waiting, so the run tells Vela it holds on you, then that it failed. At this red its ask is refused at its
    // call, the race's refusal ends the run failed, and nothing tells
    const UNSAID = [
      'export const meta = { name: "Unsaid" };',
      "export default async function () {",
      `  await Promise.race([ask("Feed the zebra?", ["Feed", "Wait"]), agent("Review the diff", ${STEP_AT})]);`,
      '  log("the quokka line");',
      '  throw new Error("the narwhal throw");',
      "}",
      "",
    ].join("\n");
    // what the run said or heard, each by a word only it holds: the gate's question, the step's answer, the log line
    // and what the script threw
    const marks = ["zebra", "otter", "quokka", "narwhal"];
    const h = await harness({ needsQueue: true });
    h.approved("unsaid", UNSAID);
    const run = startedRun(await h.start({ flow: "unsaid", ...VELAS })).run;
    await within(WAIT_MS, () => h.enqueued.length > 0 || ended(h, run));
    h.endTurn({
      run,
      call: 2,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "the otter answer",
    });
    await within(WAIT_MS, () => ended(h, run));
    // its end's tell read once told: at this red, where nothing tells, inside vitest's budget, never past it
    await within(PARK_MS, () => h.facts.length >= 2);
    // where the run keeps each: its item's question, its journal's answer and `end` line, and its record's log line
    const kept = JSON.stringify([h.items, h.records.readRun(run), h.records.runRecord(run)]);
    const told = factsOf(h);
    expect({
      told,
      kept: marks.filter((mark) => kept.includes(mark)),
      marked: told.filter(({ fact }) => marks.some((mark) => fact.includes(mark))),
      state: h.runs.read(run)?.summary.state,
    }).toEqual({
      told: [
        toVela(words.factAsking, "Unsaid", "unsaid", run),
        toVela(words.factFailed, "Unsaid", "unsaid", run),
      ],
      kept: marks,
      marked: [],
      state: "failed",
    });
  });

  it("R35c (Q9 (1), T3b; slice 11b): a Run you start in a spark's thread is yours: its gate and its end tell that spark nothing", async () => {
    // two runs, as ruled (2026-11-06): a gate's run ends only through your answer, which this pin can't give
    // at the red (nothing is raised), so the gate is GATE_CAUGHT's run and the end HELLO's. The mutation it catches,
    // a wake on `starter.spark` alone, reddens both halves at 11b's green: the end's, and the gate's, which 11a's
    // green holds
    const h = await harness();
    h.approved("gate", GATE_CAUGHT);
    h.approved("hello", HELLO);
    // its gate: held on you once ask() is built (until then refused, caught, and its run ends)
    const gate = startedRun(await h.start({ flow: "gate", ...THREAD })).run;
    await within(WAIT_MS, () => gated(h, gate) || ended(h, gate));
    // its end
    const run = startedRun(await h.start({ flow: "hello", ...THREAD })).run;
    await settled(h.runs, run, "done");
    expect(toldOf(h)).toEqual([]);
  });

  it("R35c's Stop leg (slice 13, Q15, T3b; red-b): a Run you start in a spark's thread is yours: a Stop that ends it tells that spark nothing", async () => {
    // your run in Vela's thread, its step's agent at work and its host live, stopped
    const h = await harness();
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review", ...THREAD })).run;
    await within(WAIT_MS, () => h.enqueued.length > 0 || ended(h, run));
    const stopped = (await h.runs.stop(run)).run.state;
    // red-b: the stub answers the run as it stands (running) and acts on nothing, so it reds on `stopped` alone; its
    // `told` is green here by construction, and its mutation at the green is a tell on `starter.spark` alone
    expect({ stopped, told: toldOf(h) }).toEqual({ stopped: "stopped", told: [] });
  });
});

// CP-4a2b (the slices 7–9 review's F4; Q1 (b), ruled 2026-11-06; the record's count at the refined (A),
// 2026-11-06; LL1's words, 2026-11-06) — a run starts FLOW_LIMITS.RUN_AGENTS_MAX agents at most, counted until its end
// whatever becomes of them: a step that would start one more is refused at its spawn, in DESIGN.md §9's PROPOSED words,
// never made to wait. The count is the run's record's (`agents`), reserved in the one write that reads it, so two
// starts at once never both pass, and a run woken on its record counts as it did. An `in:` starts none.

/** `n` spawned steps at once, each refusal caught and logged; `model` names one, so each start awaits the runtime's
 * models before its spawn; `hand` adds one handed your session by `in:` after them. */
const agentsAtOnce = (
  n: number,
  opts: { readonly model?: string; readonly hand?: boolean } = {},
): string => {
  const model = opts.model !== undefined ? `, model: "${opts.model}"` : "";
  return [
    'export const meta = { name: "Agents" };',
    "export default async function () {",
    "  const steps = [];",
    `  for (let i = 1; i <= ${n}; i += 1)`,
    `    steps.push(agent("look at part " + i, { agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app"${model} }).catch((e) => log(e.message)));`,
    ...(opts.hand === true
      ? ['  steps.push(agent("Review this", { in: "run-yours", label: "Yours" }));']
      : []),
    "  return await Promise.all(steps);",
    "}",
    "",
  ].join("\n");
};

/** §9's PROPOSED reason (LL1's words), after "VibeField didn't start ‹label›:". */
const AGENTS_STARTED = "this run has already started as many agents as a run may.";

describe("CP-4a2b — a run's agents, RUN_AGENTS_MAX started, counted until its end (the slices 7–9 review's F4)", () => {
  /** The line step `call` of `run` was given, once its agent is working. */
  const lineOf = (h: Harness, run: string, call: number) =>
    h.enqueued.find(({ from }) => from.kind === "flow" && from.run === run && from.call === call);
  /** Step `call` of `run`: "spawned" once its agent was, the words it was refused in once its journal keeps them,
   * "answered" for an answer, and none before any. */
  const outcomeOf = (h: Harness, run: string, call: number): string | undefined => {
    if (h.spawned.some(({ origin }) => origin.run === run && origin.call === call))
      return "spawned";
    const read = h.records.readRun(run);
    if (read.kind !== "kept") return read.kind;
    const answer = read.lines.find((line) => line.kind === "answer" && line.call === call);
    if (answer?.kind !== "answer") return undefined;
    return answer.refused ?? "answered";
  };
  /** Step `call`'s turn ends "ok", in the session its line went to. */
  const answer = (h: Harness, run: string, call: number) =>
    h.endTurn({
      run,
      call,
      runtimeRunId: lineOf(h, run, call)?.runtimeRunId ?? "",
      turn: "t1",
      outcome: "completed",
      text: "ok",
    });
  /** The next run begun with its record keeping `agents` already, as a run woken on its record reads it. */
  const keeping = (h: Harness, agents: number) => {
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) =>
      begin(entry, { ...start, agents }),
    );
  };

  it("RA1: a run's 17th agent is refused at its spawn in §9's words, never spawned and never made to wait; the 16 its steps started are counted on its record", async () => {
    const h = await harness();
    const max = FLOW_LIMITS.RUN_AGENTS_MAX;
    const slots = FLOW_LIMITS.LIVE_STEPS_MAX;
    h.approved("agents", agentsAtOnce(max + 1));
    const run = startedRun(await h.start({ flow: "agents" })).run;
    // each answer frees its slot (CP4-S7) for the next step, and the agent it answered lives on
    for (let call = 1; call <= max - slots + 1; call += 1) {
      await waitFor(() => expect(lineOf(h, run, call)).toBeDefined());
      answer(h, run, call);
    }
    await waitFor(() => expect(outcomeOf(h, run, max + 1)).toBeDefined());
    expect(outcomeOf(h, run, max + 1)).toBe(W(`Part ${max + 1}`, AGENTS_STARTED));
    expect(h.spawned).toHaveLength(max);
    // its record says so: the step failed, never waiting, and the run keeps its 16
    const record = h.records.runRecord(run);
    expect(record?.steps.find((step) => step.call === max + 1)?.state).toBe("failed");
    expect(record).toMatchObject({ agents: max });
  });

  it("R40f (slice 13, Q5 (b)): an end the floor can't be asked to take, one of three, counts none: `ended: 2`, that step stays open in its true state, `working`, the run still ends stopped, and fieldd's log warns once", async () => {
    // red-a: the stub answers the run running, and nothing is ended
    const h = await harness({ endRejects: "rt-step2" });
    h.approved("fan", fanOut(3));
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(3));
    const stopped = (await h.runs.stop(run)).run;
    expect({
      state: stopped.state,
      ended: stopped.ended,
      steps: stopped.steps.map((step) => [step.call, step.state]),
      warned: h.warned.filter(({ event }) => event === "fieldd.flows.step.end").length,
    }).toEqual({
      state: "stopped",
      ended: 2,
      steps: [
        [1, "ended"],
        [2, "working"],
        [3, "ended"],
      ],
      warned: 1,
    });
  });

  it("RA2: two steps started together at RUN_AGENTS_MAX − 1, each awaiting the runtime's models before its spawn: exactly one is spawned, and the other refused", async () => {
    let free: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      free = resolve;
    });
    const h = await harness({ modelsHeld: held });
    const max = FLOW_LIMITS.RUN_AGENTS_MAX;
    h.approved("agents", agentsAtOnce(2, { model: "opus" }));
    keeping(h, max - 1);
    const run = startedRun(await h.start({ flow: "agents" })).run;
    // the race, held (the F4b review MM1): both starts wait at their models() await, and neither has reserved, so
    // the two reserve after it whatever the host's pipe makes of the two calls. The gate opens whatever the reads say
    // (its fix review's nit), so a start that never asks fails on its count, never parked past the row
    try {
      await waitFor(() => expect(h.modelAsks()).toBe(2));
      expect(h.records.runRecord(run)).toMatchObject({ agents: max - 1 });
    } finally {
      free();
    }
    const outcomes = () => [outcomeOf(h, run, 1), outcomeOf(h, run, 2)];
    await waitFor(() => expect(outcomes()).not.toContain(undefined));
    const refused = [1, 2].filter((call) => outcomeOf(h, run, call) !== "spawned");
    expect(refused).toHaveLength(1);
    const [call = 0] = refused;
    expect(outcomeOf(h, run, call)).toBe(W(`Part ${call}`, AGENTS_STARTED));
    expect(h.spawned).toHaveLength(1);
    expect(h.records.runRecord(run)).toMatchObject({ agents: max });
  });

  it("R42d (slice 13, Q8 (a)): a Stop while a step's spawn is in flight waits for it: the agent that lands past the end is found and ended (`ended: 1`), no prompt is queued, and the ended record is never written again", async () => {
    // red-a: the stub answers before the released start settles: the step reads starting, and nothing is ended
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await harness({ spawnHeld: held });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.spawned).toHaveLength(1));
    const stopping = h.runs.stop(run);
    release();
    const stopped = (await stopping).run;
    const record = h.records.runRecord(run);
    expect({
      state: stopped.state,
      enqueued: h.enqueued.length,
      ends: h.ends,
      ended: record?.ended,
      steps: record?.steps.map((step) => [step.call, step.state, step.session]),
      open: record?.open,
    }).toEqual({
      state: "stopped",
      enqueued: 0,
      ends: ["rt-step1"],
      ended: 1,
      steps: [[1, "ended", undefined]],
      open: [],
    });
  });

  it("R42d-2 (slice 13's fold 1; the green skeptic's #2): R42d's road with a `sessions.ofRun` that has not yet listed the agent that landed past the end: the start hands that agent back to the run's orphans, so the end ends it and counts it all the same", async () => {
    // red at the unfixed green: startStep's second gone() drops the landed agent's id, so the tail finds it only if
    // `ofRun` lists it; here it does not, and that agent is never ended (`ends: []`) and never counted
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await harness({ spawnHeld: held, ofRunOmits: ["rt-step1"] });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.spawned).toHaveLength(1));
    const stopping = h.runs.stop(run);
    release();
    const stopped = (await stopping).run;
    const record = h.records.runRecord(run);
    expect({
      state: stopped.state,
      enqueued: h.enqueued.length,
      ends: h.ends,
      ended: record?.ended,
      steps: record?.steps.map((step) => [step.call, step.state, step.session]),
      open: record?.open,
    }).toEqual({
      state: "stopped",
      enqueued: 0,
      ends: ["rt-step1"],
      ended: 1,
      steps: [[1, "ended", undefined]],
      open: [],
    });
  });

  it("R42d-3 (slice 13's fold 2; the fold skeptic's #1): R42d-2's road with the landed agent's end refused by the floor: its step, which has no session, stays open in its true state, `starting`, never `ended`, and `ended` counts none, as R40f has it for a step with a session", async () => {
    // red at fold 1: endSteps matched a step's own session alone against the refused ends, and a landed agent's step
    // has none (Q8 (a)), so the step read `ended` while its agent worked on
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await harness({ spawnHeld: held, ofRunOmits: ["rt-step1"], endRejects: "rt-step1" });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.spawned).toHaveLength(1));
    const stopping = h.runs.stop(run);
    release();
    const stopped = (await stopping).run;
    const record = h.records.runRecord(run);
    expect({
      state: stopped.state,
      enqueued: h.enqueued.length,
      ends: h.ends,
      ended: record?.ended,
      steps: record?.steps.map((step) => [step.call, step.state, step.session]),
      open: record?.open.map((step) => [step.call, step.state, step.session]),
      warned: h.warned.filter(({ event }) => event === "fieldd.flows.step.end").length,
    }).toEqual({
      state: "stopped",
      enqueued: 0,
      ends: ["rt-step1"],
      ended: undefined,
      steps: [],
      open: [[1, "starting", undefined]],
      warned: 1,
    });
  });

  it("R42d-4 (slice 13's fold 3; the fold 2 skeptic's #2): the Stop of a run no LiveRun drives (#finishStop's no-`end` road, which slice 14's boot reaches), its open step with no session and `sessions.ofRun` listing that step's agent live by its call, whose end the floor refuses: the step stays open in its true state, `starting`, never `ended`, and `ended` counts none", async () => {
    // red at fold 2: endSteps matched a step's session or the run's orphans, and a run no LiveRun drives has no
    // orphans, so the step read `ended` while its agent worked on
    // the road: the run's one spawn is in flight when fieldd stops (never settled here), so its record keeps the step
    // `starting` with no session; the runs fieldd starts again then take its Stop (R41's road), and their one read of
    // the run's agents, forged as R40g-2's is, lists the agent its spawn started, by its origin's call
    const h = await harness({ spawnHeld: new Promise<never>(() => {}), endRejects: "rt-step1" });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.spawned).toHaveLength(1));
    await h.runs.close();
    const fresh = new FlowRuns(h.runs.ports);
    opened.push(fresh);
    vi.spyOn(h.runs.ports.sessions, "ofRun").mockReturnValue([
      { runtimeRunId: "rt-step1", call: 1, live: true },
    ]);
    const stopped = (await fresh.stop(run)).run;
    const record = h.records.runRecord(run);
    expect({
      state: stopped.state,
      kinds: h.kinds(run),
      ends: h.ends,
      ended: record?.ended,
      steps: record?.steps.map((step) => [step.call, step.state, step.session]),
      open: record?.open.map((step) => [step.call, step.state, step.session]),
      warned: h.warned.filter(({ event }) => event === "fieldd.flows.step.end").length,
    }).toEqual({
      state: "stopped",
      kinds: ["head", "call", "end"],
      ends: ["rt-step1"],
      ended: undefined,
      steps: [],
      open: [[1, "starting", undefined]],
      warned: 1,
    });
  });

  it("RA3: a run whose record counts RUN_AGENTS_MAX at its wake, as a run woken on its record does, refuses its next spawn; a step it hands your session by in: starts none, and is handed", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    const max = FLOW_LIMITS.RUN_AGENTS_MAX;
    h.approved("agents", agentsAtOnce(1, { hand: true }));
    keeping(h, max);
    const run = startedRun(await h.start({ flow: "agents" })).run;
    await waitFor(() => expect(outcomeOf(h, run, 1)).toBeDefined());
    expect(outcomeOf(h, run, 1)).toBe(W("Part 1", AGENTS_STARTED));
    expect(h.spawned).toEqual([]);
    // the guard: the in: at RUN_AGENTS_MAX is handed, never refused, and the count stands
    await waitFor(() => expect(h.hands).toHaveLength(1));
    expect(h.hands).toMatchObject([{ runtimeRunId: "run-yours", run, call: 2, gone: false }]);
    expect(h.records.runRecord(run)).toMatchObject({ agents: max });
  });

  it("RA4 (the F4b review MM2): a list the store refuses just after a reservation's write landed is said in fieldd's log, never thrown out of the write: the step still spawns, and its run counts the one agent it started", async () => {
    const h = await harness();
    h.approved("agents", agentsAtOnce(1));
    // a subscriber, so each write's list is read; the store refuses the one read just after the reservation lands
    h.runs.onChange(() => undefined);
    const write = h.records.writeRunRecord.bind(h.records);
    const listed = h.records.runRecords.bind(h.records);
    let reserved = false;
    let refusing = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      write(run, fields);
      if (!reserved && fields.agents === 1) {
        reserved = true;
        refusing = true;
      }
    });
    vi.spyOn(h.records, "runRecords").mockImplementation(() => {
      if (!refusing) return listed();
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const run = startedRun(await h.start({ flow: "agents" })).run;
    await waitFor(() => expect(outcomeOf(h, run, 1)).toBeDefined());
    const events = h.warned.map(({ event }) => event);
    expect(reserved).toBe(true);
    expect(outcomeOf(h, run, 1)).toBe("spawned");
    expect(h.records.runRecord(run)).toMatchObject({ agents: 1 });
    expect(events).toContain("fieldd.flows.run.told");
    expect(events).not.toContain("fieldd.flows.step.start");
  });
});

// CP-4a2b (§13a slice 10a; D1, D2, CL-L5a, CL-L5c, CL-H13, CL-H14, CL-K-d) — the host's life: a run that waits has no
// process. A host with a call out and no frame but pongs for HOST_IDLE_MS (lowered here) is parked: its `stop()` is
// the runs' own, read as `waiting`, never `stopped`, and its journal gains no line. A step's answer journaled wakes
// it: a host started again replays the journal from the top, on the bytes its record names (D8), and a call it makes
// again is looked up first (D2): the record's state for that call, then its session, never spawned again while it
// lives. Moved on (ruled 2026-11-06): R27b and R13e's `ask` leg to slice 11, R27c to 12, R32's wake
// and the exited session's item to 14.

/** D1's idle, lowered for these rows, and the longest a row waits for a park, an end or a host's leaving. */
const IDLE_MS = 250;
const PARK_MS = 5_000;
/** D1's idle for a row whose run is held before its host parks (steps 1p, 1q): long past the two turn ends a hold
 * takes, so the park reads the hold. */
const HOLD_IDLE_MS = 1_000;

/** Resolves once `ready()` holds, or after `ms` whatever it reads: a row then fails on what it reads, never on a
 * wait's own timeout. */
const within = async (ms: number, ready: () => boolean): Promise<void> => {
  const until = Date.now() + ms;
  while (!ready() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
};

/** A step's options, labelled `label`, as STEP_AT's are. */
const stepAt = (label: string): string =>
  `{ agent: "claude", label: "${label}", profile: "work", cwd: "/work/app" }`;

/** Two steps at once, A and B, their answers' texts said as the run's one log line. */
const TWO = [
  'export const meta = { name: "Two" };',
  "export default async function () {",
  `  const [a, b] = await Promise.all([agent("look at a", ${stepAt("A")}), agent("look at b", ${stepAt("B")})]);`,
  "  log(a.text + b.text);",
  "}",
  "",
].join("\n");

/** Two steps, A then B, their answers' texts said as the run's one log line. */
const SEQ = [
  'export const meta = { name: "Seq" };',
  "export default async function () {",
  `  const a = await agent("look at a", ${stepAt("A")});`,
  `  const b = await agent("look at b", ${stepAt("B")});`,
  "  log(a.text + b.text);",
  "}",
  "",
].join("\n");

/** B's call in SEQ, as its host journals it: what a kill between D5's first two steps leaves with no record entry. */
const seqB = () => ({
  kind: "call" as const,
  call: 2,
  what: "agent",
  key: flowCallKey("agent", [
    "look at b",
    { agent: "claude", label: "B", profile: "work", cwd: "/work/app" },
  ]),
  n: 1,
  label: "B",
  agent: "claude",
});

/** A flow that says one line, then waits on nothing: its host has no call out. */
const STUCK = [
  'export const meta = { name: "Stuck" };',
  "export default async function () {",
  '  log("waiting on nothing");',
  "  await new Promise(() => {});",
  "}",
  "",
].join("\n");

/** Two steps at once: A with a form, whose second miss holds the run on the person (CP4-Q7 (a)), and B. */
const HELD_TWO = [
  'export const meta = { name: "Held" };',
  "export default async function () {",
  `  const [a, b] = await Promise.all([agent("look at a", { ...${stepAt("A")}, schema: ${FORM} }), agent("look at b", ${stepAt("B")})]);`,
  "  log(a.verdict + b.text);",
  "}",
  "",
].join("\n");

/** Two steps at once, A and B; its one log line says A's text, and whether B's came cut short (FLOW_CUT_MARK). */
const CUT_TWO = [
  'export const meta = { name: "Cut" };',
  "export default async function () {",
  `  const [a, b] = await Promise.all([agent("look at a", ${stepAt("A")}), agent("look at b", ${stepAt("B")})]);`,
  '  log(a.text + " " + b.text.endsWith("…"));',
  "}",
  "",
].join("\n");

/** Two steps raced, A and B: the run's one log line is the text of the answer the race took. */
const RACE = [
  'export const meta = { name: "Race" };',
  "export default async function () {",
  `  const first = await Promise.race([agent("look at a", ${stepAt("A")}), agent("look at b", ${stepAt("B")})]);`,
  "  log(first.text);",
  "}",
  "",
].join("\n");

/** One step: its answer's text said as the run's one log line, or the words of its refusal when it is refused. */
const CATCHES = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  `  try { log((await agent("Review the diff", ${STEP_AT})).text); } catch (e) { log(e.message); }`,
  "}",
  "",
].join("\n");

/** A call line no flow here makes, as its host would journal it: what a journal its script, run again, can't match
 * holds (D7's rows, slice 10b). */
const unmade = (call: number) => ({
  kind: "call" as const,
  call,
  what: "agent",
  key: flowCallKey("agent", [
    "look at x",
    { agent: "claude", label: "X", profile: "work", cwd: "/work/app" },
  ]),
  n: 1,
  label: "X",
  agent: "claude",
});

// slice 11a's flows (Q1, Q3, Q4, Q5, Q13): ask() as `flow-gate`, alone, beside a step either side, twice at once,
// after a step and before one; and steps held on their repairs beside one another, or beside a gate (EE3)

/** One gate: the act the person chose, said between brackets as the run's one log line, so a space it holds shows
 * (Q1: an ask resolves to the act's own words, byte for byte). */
const GATE = [
  'export const meta = { name: "Gate" };',
  "export default async function () {",
  '  const said = await ask("Push the fix?", [" Push", "Hold"]);',
  '  log("[" + said + "]");',
  "}",
  "",
].join("\n");

/** The question, and the choices, every other gate here asks. */
const SHIP = '"Ship it?", ["Ship", "Hold"]';

/** A gate (call 1) and a step A (call 2) at once. */
const GATE_AND_STEP = [
  'export const meta = { name: "Gate and step" };',
  "export default async function () {",
  `  const [go, a] = await Promise.all([ask(${SHIP}), agent("look at a", ${stepAt("A")})]);`,
  '  log(go + " " + a.text);',
  "}",
  "",
].join("\n");

/** The same the other way about: a step A (call 1) and a gate (call 2) at once. */
const STEP_AND_GATE = [
  'export const meta = { name: "Step and gate" };',
  "export default async function () {",
  `  const [a, go] = await Promise.all([agent("look at a", ${stepAt("A")}), ask(${SHIP})]);`,
  '  log(a.text + " " + go);',
  "}",
  "",
].join("\n");

/** Two gates at once, A's (call 1) and B's (call 2). */
const TWO_GATES = [
  'export const meta = { name: "Gates" };',
  "export default async function () {",
  '  const [a, b] = await Promise.all([ask("Ship A?", ["Ship", "Hold"]), ask("Ship B?", ["Go", "Wait"])]);',
  '  log(a + " " + b);',
  "}",
  "",
].join("\n");

/** TWO_GATES with a step C beside them (call 3), whose answer wakes the run while both gates are open. */
const TWO_GATES_AND_STEP = [
  'export const meta = { name: "Gates and step" };',
  "export default async function () {",
  `  const [a, b, c] = await Promise.all([ask("Ship A?", ["Ship", "Hold"]), ask("Ship B?", ["Go", "Wait"]), agent("look at c", ${stepAt("C")})]);`,
  '  log(a + " " + b + " " + c.text);',
  "}",
  "",
].join("\n");

/** SEQ with its second call a gate: a step A (call 1), then a gate (call 2) once A has answered. */
const SEQ_ASK = [
  'export const meta = { name: "Seq ask" };',
  "export default async function () {",
  `  const a = await agent("look at a", ${stepAt("A")});`,
  `  const go = await ask(${SHIP});`,
  '  log(a.text + " " + go);',
  "}",
  "",
].join("\n");

/** SEQ_ASK's gate, as its host journals it: what a kill between D5's gate steps leaves (R13e's ask leg, Q5 §5). */
const seqAsk = () => ({
  kind: "call" as const,
  call: 2,
  what: "ask",
  key: flowCallKey("ask", ["Ship it?", ["Ship", "Hold"]]),
  n: 1,
});

/** A gate (call 1), then a step A (call 2) once it is answered. */
const GATE_THEN_STEP = [
  'export const meta = { name: "Gate then step" };',
  "export default async function () {",
  `  const go = await ask(${SHIP});`,
  `  const a = await agent("look at a", ${stepAt("A")});`,
  '  log(go + " " + a.text);',
  "}",
  "",
].join("\n");

/** Two steps at once, A (call 1) and B (call 2), each with a form whose second miss holds the run (HELD_TWO forms only
 * A). */
const TWO_FORMED = [
  'export const meta = { name: "Held two" };',
  "export default async function () {",
  `  const [a, b] = await Promise.all([agent("look at a", { ...${stepAt("A")}, schema: ${FORM} }), agent("look at b", { ...${stepAt("B")}, schema: ${FORM} })]);`,
  "  log(a.verdict + b.verdict);",
  "}",
  "",
].join("\n");

/** A gate (call 1) beside a step A with a form (call 2). */
const GATE_BESIDE_FORM = [
  'export const meta = { name: "Gate beside" };',
  "export default async function () {",
  `  const [go, a] = await Promise.all([ask(${SHIP}), agent("look at a", { ...${stepAt("A")}, schema: ${FORM} })]);`,
  '  log(go + " " + a.verdict);',
  "}",
  "",
].join("\n");

/** A step A with a form (call 1) beside a step B (call 2), and a gate (call 3) asked once B has answered. */
const FORM_THEN_GATE = [
  'export const meta = { name: "Form then gate" };',
  "export default async function () {",
  `  const [a, go] = await Promise.all([agent("look at a", { ...${stepAt("A")}, schema: ${FORM} }), agent("look at b", ${stepAt("B")}).then(() => ask(${SHIP}))]);`,
  '  log(a.verdict + " " + go);',
  "}",
  "",
].join("\n");

describe("CP-4a2b — the host's life: parked and woken, D2's lookup at a wake, replay's order, and a gate's hold (§13a slices 10a, 10b, 11a, 12)", () => {
  /** Whether host `i` the runs started has left. */
  const left = (h: Harness, i: number): boolean => h.hosts[i]?.leftAt !== undefined;
  /** The run's state, as its summary reads it now. */
  const stateOf = (h: Harness, run: string) => h.runs.read(run)?.summary.state;
  /** The session step `call`'s record names, or none. */
  const sessionOf = (h: Harness, run: string, call: number): string =>
    h.records.runRecord(run)?.open.find((step) => step.call === call)?.session ?? "";
  /** Step `call`'s turn ends with `text`, in the session its record names. */
  const answerStep = (h: Harness, run: string, call: number, text: string) =>
    h.endTurn({
      run,
      call,
      runtimeRunId: sessionOf(h, run, call),
      turn: `t${call}`,
      outcome: "completed",
      text,
    });
  /** The run parked: host `i` gone and the run reading `waiting`, or what it reads after PARK_MS. */
  const parkedAt = async (h: Harness, run: string, i = 0) => {
    await within(PARK_MS, () => left(h, i) && stateOf(h, run) === "waiting");
    return { state: stateOf(h, run), left: left(h, i) };
  };
  const PARKED = { state: "waiting", left: true };
  /** R13e's and MM3's journal, in D21's causal order (R31's road): SEQ's host can't hear its shutdown, so it leaves
   * only at its grace's SIGKILL (KILL_GRACE_MS, its harness's stopGraceMs); A's answer is journaled in that grace,
   * then B's call line with no record entry, as a kill between D5's first two steps leaves it, and the run wakes on
   * both once the host has left. B's call journaled BEFORE A's answer is no journal SEQ can write: D21 holds A's
   * answer behind a call its script makes only once it hears A, and D7 sets that run aside (P12's journal). */
  const KILL_GRACE_MS = 2_000;
  /** T4's arm: `h`'s next record write throws once, just after its journal takes a line of `kind`; of call `at` alone,
   * when one is named (slice 12, F12: in a fan-out the first line of a kind is call 1's). */
  const lagsOnce = (h: Harness, kind: "call" | "answer", at?: number) => {
    const append = h.records.appendRun.bind(h.records);
    const write = h.records.writeRunRecord.bind(h.records);
    let armed = false;
    vi.spyOn(h.records, "appendRun").mockImplementation((run, entry) => {
      const kept = append(run, entry);
      if (entry.kind === kind && (at === undefined || ("call" in entry && entry.call === at)))
        armed = true;
      return kept;
    });
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      if (!armed) return write(run, fields);
      armed = false;
      throw new Error("ENOSPC: no space left on device, write");
    });
  };
  /** Slice 11a (Q5 §5): `line` is the call line the kill left with no record entry (SEQ's B, or an ask's: R13e's ask
   * leg), and `woken` the wake's witness: B's prompt queued, or the ask's item raised. */
  const killedBeforeEntry = async (
    h: Harness,
    run: string,
    line: FlowJournalEntry = seqB(),
    woken: () => boolean = () => h.enqueued.length === 2,
  ) => {
    h.hosts[0]?.child.kill("SIGSTOP");
    await within(PARK_MS, () => stateOf(h, run) === "waiting");
    expect(stateOf(h, run)).toBe("waiting");
    answerStep(h, run, 1, "a");
    await within(PARK_MS, () => answersOf(h, run).length === 1);
    h.records.appendRun(run, line);
    // one host still, so the wake to come reads B's line. A second here is a wake A's answer fired inside host 0's
    // grace (#rouse's parking wait broken, R27d's rule): B, journaled again with its entry, would pass this row
    // without ever meeting D2's last row. (The idle can't park host 0 before its SIGSTOP: the enqueue's poll runs
    // first; the 10b fix's delta review, #4 and #9.)
    const journal = { kinds: h.kinds(run), hosts: h.hosts.length };
    expect(journal).toEqual({ kinds: ["head", "call", "answer", "call"], hosts: 1 });
    await within(PARK_MS + KILL_GRACE_MS, woken);
    // PARKED's `left`, and R27d's order: the run woke only once its old host had left
    const [old, next] = h.hosts;
    expect({
      hosts: h.hosts.length,
      left: old?.leftAt !== undefined,
      after: (next?.at ?? 0) >= (old?.leftAt ?? Number.POSITIVE_INFINITY),
    }).toEqual({ hosts: 2, left: true, after: true });
  };
  /** DESIGN.md, its runs of white space as one space (hoisted here in slice 13, for R43 beside R30). */
  const designText = () =>
    readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");

  // slice 13 (Stop and the end; its read discipline, so a red-a row fails on a value, an AssertionError with no
  // timeout): a Stop row's one wait for the end is `await h.runs.stop(run)`, which red-a's stub answers at once; it
  // never waits on `settled(…, "stopped")` or `settled(…, "stopping")`, nor on `within` past an awaited Stop; and a
  // row that reads what was told collects it in a listener and reads it after, since `stopping` is transient

  /** Whether `run` has ended, in any way: every end writes its `endedAt`. */
  const endedOf = (h: Harness, run: string): boolean =>
    h.runs.read(run)?.summary.endedAt !== undefined;
  /** The `end` lines `run`'s journal holds, each as its state and `ended` (and `host`, where fieldd ended it). */
  const endLinesOf = (h: Harness, run: string) => {
    const read = h.records.readRun(run);
    return read.kind === "kept"
      ? read.lines.flatMap((line) =>
          line.kind === "end"
            ? [
                {
                  state: line.state,
                  ...(line.ended !== undefined ? { ended: line.ended } : {}),
                  ...(line.host !== undefined ? { host: line.host } : {}),
                },
              ]
            : [],
        )
      : [];
  };
  /** Each state `run` was told in, from now on, a state told again in a row kept once (`stopping` is transient). */
  const toldStates = (h: Harness, run: string): string[] => {
    const told: string[] = [];
    h.runs.onChange((list) => {
      const state = list.runs.find((summary) => summary.run === run)?.state;
      if (state !== undefined && told.at(-1) !== state) told.push(state);
    });
    told.splice(0);
    return told;
  };
  /** The run's steps, answered and open, by call, as its record holds them. */
  const stepsOf = (h: Harness, run: string) => {
    const record = h.records.runRecord(run);
    return [...(record?.steps ?? []), ...(record?.open ?? [])]
      .sort((a, b) => a.call - b.call)
      .map((step) => [step.call, step.state]);
  };

  it("R27 (D1): a run whose step waits past HOST_IDLE_MS with no frame is parked: its host has left, it reads waiting, never stopped, and its journal gains no line; the step's answer wakes it, and it ends done", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    expect(h.kinds(run)).toEqual(["head", "call"]);
    answerStep(h, run, 1, "all clean");
    expect((await settled(h.runs, run, "done")).log).toBe("all clean");
    expect(h.hosts).toHaveLength(2);
  });

  it("R40b (slice 13, Q3 step 4): a Stop with no host, the common Stop of a run waiting on its agent, ends it at once: parked, it is stopped with its agent ended and never woken; queued for a host past HOSTS_LIVE_MAX, it is stopped at once, and its place goes to the next run waiting", async () => {
    // red-a: the stub answers each run as it stands (waiting) and acts on nothing, so the queued run takes the host
    // (red-a skeptic F3) `#finish` leaving `#hostQueue` is held by construction, not by this row: a stale id left there
    // is harmless (`#nextHost` shifts past it, `#rouse` returns for a run with no LiveRun), so no read of the runs'
    // public face sees the splice, and the mutant pass lists the splice's mutation as an expected survivor
    // parked: its host has left, and its step's agent works on
    const parked = await harness({ hostIdleMs: IDLE_MS });
    parked.approved("review", ANSWERED);
    const run = startedRun(await parked.start({ flow: "review" })).run;
    await waitFor(() => expect(parked.enqueued).toHaveLength(1));
    expect(await parkedAt(parked, run)).toEqual(PARKED);
    const stopped = (await parked.runs.stop(run)).run;
    const atRest = {
      state: stopped.state,
      ended: stopped.ended,
      ends: parked.ends,
      hosts: parked.hosts.length,
      kinds: parked.kinds(run),
    };
    // queued: HOSTS_LIVE_MAX runs hold every host (no park: UU3), and two more wait in #hostQueue's order
    const max = FLOW_LIMITS.HOSTS_LIVE_MAX;
    const h = await harness();
    h.approved("review", ANSWERED);
    const runs: string[] = [];
    for (let i = 0; i < max + 2; i += 1)
      runs.push(startedRun(await h.start({ flow: "review" })).run);
    await within(PARK_MS, () => h.enqueued.length >= max);
    const [first, queued, next] = [runs[0] ?? "", runs[max] ?? "", runs[max + 1] ?? ""];
    const queuedStop = (await h.runs.stop(queued)).run.state;
    // the first run ends, and its host's place goes to the first run still waiting
    answerStep(h, first, 1, "one");
    await settled(h.runs, first, "done");
    const inQueue = {
      stopped: queuedStop,
      record: stateOf(h, queued),
      next: stateOf(h, next),
      hosts: h.hosts.length,
    };
    expect({ atRest, inQueue }).toEqual({
      atRest: {
        state: "stopped",
        ended: 1,
        ends: ["rt-step1"],
        hosts: 1,
        kinds: ["head", "call", "end"],
      },
      inQueue: { stopped: "stopped", record: "stopped", next: "running", hosts: max + 1 },
    });
  });

  it("R10 (L7a): a run parked on the version it began on wakes on that version's bytes, though another was approved while it waited", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    const first = h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    h.approved("review", ANSWERED.replace("log(said.text);", 'log("v2: " + said.text);'));
    answerStep(h, run, 1, "all clean");
    const ended = await settled(h.runs, run, "done");
    expect({ hosts: h.hosts.length, log: ended.log, hash: ended.hash }).toEqual({
      hosts: 2,
      log: "all clean",
      hash: first.hash,
    });
  });

  it("R27d (D1): a wake inside the parked host's leave grace starts its new host only once the old one has left", async () => {
    const grace = 1_000;
    const h = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: grace } });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // the old host can't hear its shutdown, so it leaves only at the grace's SIGKILL
    h.hosts[0]?.child.kill("SIGSTOP");
    await within(PARK_MS, () => stateOf(h, run) === "waiting");
    answerStep(h, run, 1, "all clean");
    await within(PARK_MS, () => stateOf(h, run) === "done");
    const [old, next] = h.hosts;
    expect({
      state: stateOf(h, run),
      left: old?.leftAt !== undefined,
      after: (next?.at ?? 0) >= (old?.leftAt ?? Number.POSITIVE_INFINITY),
    }).toEqual({ state: "done", left: true, after: true });
  });

  it("R32a (R32 as 10a pins it; its wake is slice 14's boot): a parked run is found where it was by the runs fieldd starts again: waiting, its step working in its session, its journal as it was, and no host started", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) === "waiting");
    await h.runs.close();
    const again = new FlowRuns(h.runs.ports);
    opened.push(again);
    const found = again.read(run)?.summary;
    expect({
      state: found?.state,
      steps: found?.steps.map((step) => [step.call, step.session, step.state]),
      hosts: h.hosts.length,
    }).toEqual({ state: "waiting", steps: [[1, "rt-step1", "working"]], hosts: 1 });
    expect(h.kinds(run)).toEqual(["head", "call"]);
  });

  it("R41 (slice 13, K-c, D4; Q12 (b), Q17 (a)): a run fieldd stopped before its Stop's end is finished by its next Stop, read from its journal by the runs fieldd starts again: (i) one `end`, stopped, no item raised and no host, its first Stop answered `stopping` at close() and a Stop past close() writing `stopping` alone; (ii) every step gone, stopped with no `ended`; (iii) a record write refused after the `end` line, then one `end`; (iv) a step its journal answers reads answered, no `held`, `calls` the journal's", async () => {
    // red-a: each Stop answers the run as its record stands, and the fresh runs' stub finishes nothing
    /** The runs fieldd starts again over `h`'s ports, after its own stop (R32a's road; the reopen leg is slice 14's). */
    const again = async (h: Harness): Promise<FlowRuns> => {
      await h.runs.close();
      const fresh = new FlowRuns(h.runs.ports);
      opened.push(fresh);
      return fresh;
    };
    // (i) a Stop whose agents' ends are held when fieldd stops: its Stop answers at close() as the record reads, and
    // a second run's Stop past close() writes `stopping` and acts on nothing
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await harness({ endHeld: held });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    const other = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    /** run's own agent, as its step's line was queued to it */
    const runsAgent = h.enqueued.find(
      ({ from }) => from.kind === "flow" && from.run === run,
    )?.runtimeRunId;
    const pending = h.runs.stop(run);
    await within(PARK_MS, () => h.ends.length > 0);
    const fresh = await again(h);
    const atClose = (await pending).run.state;
    const hostsAtClose = h.hosts.length;
    const past = (await h.runs.stop(other)).run.state;
    const pastActed = [...h.withdrawn, ...h.itemsEnded].filter((at) => at === other);
    // (red-a skeptic F4) past close(), `other`'s record reads `stopping`, its agent is never ended (run's alone, asked
    // before close()), and nothing is paused
    const pastRead = {
      record: h.records.runRecord(other)?.state,
      ends: [...h.ends],
      paused: [...h.paused],
    };
    release();
    const items = h.items.length;
    const finished = (await fresh.stop(run)).run;
    const first = {
      atClose,
      past,
      pastActed,
      pastRead,
      state: finished.state,
      ends: endLinesOf(h, run).length,
      items: h.items.length - items,
      hosts: h.hosts.length - hostsAtClose,
    };
    // (ii) every step gone before fieldd stopped: nothing to end, so no `ended`
    const gone = await harness();
    gone.approved("review", ANSWERED);
    const goneRun = startedRun(await gone.start({ flow: "review" })).run;
    await waitFor(() => expect(gone.enqueued).toHaveLength(1));
    gone.exit("rt-step1");
    const goneFresh = await again(gone);
    // (red-a skeptic F5) the states `#finishStop` writes, in order: `stopping` first (Q3), then `stopped`
    const written: string[] = [];
    const goneWrite = gone.records.writeRunRecord.bind(gone.records);
    const goneSpy = vi.spyOn(gone.records, "writeRunRecord").mockImplementation((at, fields) => {
      written.push(fields.state);
      return goneWrite(at, fields);
    });
    const goneStop = (await goneFresh.stop(goneRun)).run;
    goneSpy.mockRestore();
    const second = {
      state: goneStop.state,
      ended: goneStop.ended,
      ends: gone.ends,
      steps: stepsOf(gone, goneRun),
      lines: endLinesOf(gone, goneRun),
      written,
    };
    // (iii) the record's write after the `end` line refused once: the next Stop writes the record alone
    const lag = await harness();
    lag.approved("review", ANSWERED);
    const lagRun = startedRun(await lag.start({ flow: "review" })).run;
    await waitFor(() => expect(lag.enqueued).toHaveLength(1));
    const lagFresh = await again(lag);
    const write = lag.records.writeRunRecord.bind(lag.records);
    let refused = false;
    vi.spyOn(lag.records, "writeRunRecord").mockImplementation((at, fields) => {
      if (refused || fields.state !== "stopped") return write(at, fields);
      refused = true;
      throw new Error("ENOSPC: no space left on device, write");
    });
    await lagFresh.stop(lagRun).catch(() => undefined);
    const lagStop = (await lagFresh.stop(lagRun)).run;
    // the mutation for (iii): `#finishStop` reads `record.state` alone, so a second `end` is journaled
    const third = {
      state: lagStop.state,
      record: lag.records.runRecord(lagRun)?.state,
      ends: endLinesOf(lag, lagRun).length,
    };
    // (iv) N6: the last call's own record write refused (ZZ3's window), so the record counts one call short; a gate
    // holds the run; and the journal answers the step whose settle a kill took (its line kept, its record not)
    const lags = await harness();
    lags.approved("gate", GATE_AND_STEP);
    lagsOnce(lags, "call", 2);
    const lagsRun = startedRun(await lags.start({ flow: "gate" })).run;
    await waitFor(() => expect(lags.enqueued).toHaveLength(1));
    await within(PARK_MS, () => lags.items.length === 1);
    const lagsFresh = await again(lags);
    lags.records.appendRun(lagsRun, { kind: "answer", call: 2, value: { text: "a" } });
    const lagsStop = (await lagsFresh.stop(lagsRun)).run;
    const lagsRecord = lags.records.runRecord(lagsRun);
    // the mutation for (iv)'s `calls`: drop `#finishStop`'s `calls` line, and the record keeps ZZ3's one short
    const fourth = {
      state: lagsStop.state,
      calls: lagsRecord?.calls,
      steps: stepsOf(lags, lagsRun),
      held: lagsRecord?.held,
    };
    expect({ first, second, third, fourth }).toEqual({
      first: {
        atClose: "stopping",
        past: "stopping",
        pastActed: [],
        pastRead: { record: "stopping", ends: [runsAgent], paused: [] },
        state: "stopped",
        ends: 1,
        items: 0,
        hosts: 0,
      },
      second: {
        state: "stopped",
        ended: undefined,
        ends: [],
        steps: [[1, "ended"]],
        lines: [{ state: "stopped" }],
        written: ["stopping", "stopped"],
      },
      third: { state: "stopped", record: "stopped", ends: 1 },
      fourth: { state: "stopped", calls: 2, steps: [[2, "answered"]], held: undefined },
    });
  });

  it("R13 (D2): at a wake, a call made again whose step's session lives binds to it, never spawned again; one whose start is in flight spawns once, and the next wake binds it; one whose session exited fails the step in §9's words, nothing spawned", async () => {
    // a live session binds: B's answer wakes the run, and A, made again, is bound to its session
    const live = await harness({ hostIdleMs: IDLE_MS });
    live.approved("two", TWO);
    const bound = startedRun(await live.start({ flow: "two" })).run;
    await waitFor(() => expect(live.enqueued).toHaveLength(2));
    expect(await parkedAt(live, bound)).toEqual(PARKED);
    answerStep(live, bound, 2, "b");
    await within(PARK_MS, () => live.hosts.length === 2);
    answerStep(live, bound, 1, "a");
    await within(PARK_MS, () => stateOf(live, bound) === "done");
    expect({
      state: stateOf(live, bound),
      log: live.runs.read(bound)?.summary.log,
      spawned: live.spawned.length,
      hosts: live.hosts.length,
    }).toEqual({ state: "done", log: "ab", spawned: 2, hosts: 2 });
    // starting with no session: A's start waits on the runtime's models through the park and the wake, so it is made
    // again while it starts; it spawns once, and the next wake binds it
    let free: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      free = resolve;
    });
    const starting = await harness({ hostIdleMs: IDLE_MS, modelsHeld: held });
    const modelled = TWO.replace(stepAt("A"), stepAt("A").replace(" }", ', model: "opus" }'));
    starting.approved("two", modelled);
    const once = startedRun(await starting.start({ flow: "two" })).run;
    try {
      await waitFor(() => expect(starting.enqueued).toHaveLength(1));
      expect(await parkedAt(starting, once)).toEqual(PARKED);
      answerStep(starting, once, 2, "b");
      await within(PARK_MS, () => starting.hosts.length === 2);
    } finally {
      free();
    }
    await within(PARK_MS, () => starting.enqueued.length === 2);
    expect(await parkedAt(starting, once, 1)).toEqual(PARKED);
    answerStep(starting, once, 1, "a");
    await within(PARK_MS, () => stateOf(starting, once) === "done");
    expect({
      state: stateOf(starting, once),
      spawned: starting.spawned.map(({ origin }) => origin.call),
      hosts: starting.hosts.length,
    }).toEqual({ state: "done", spawned: [2, 1], hosts: 3 });
    // an exited one (ruled 2026-11-06, its item slice 14's): A's session ends while the run is parked, so A made again
    // fails in "‹label› failed.", and nothing spawns and no item is raised
    const gone = await harness({ hostIdleMs: IDLE_MS });
    gone.approved("two", TWO);
    const lost = startedRun(await gone.start({ flow: "two" })).run;
    await waitFor(() => expect(gone.enqueued).toHaveLength(2));
    expect(await parkedAt(gone, lost)).toEqual(PARKED);
    gone.exit(sessionOf(gone, lost, 1));
    answerStep(gone, lost, 2, "b");
    await within(PARK_MS, () => refusalsOf(gone, lost).length > 0);
    expect({
      refused: refusalsOf(gone, lost),
      spawned: gone.spawned.length,
      items: gone.items,
      hosts: gone.hosts.length,
    }).toEqual({ refused: [stepFailed("A")], spawned: 2, items: [], hosts: 2 });
  });

  it("R13b (D2): a wake while a step waits for a slot makes its 9 sessions in all, never more than LIVE_STEPS_MAX live, and the waiting step's prompt is queued once", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    const slots = FLOW_LIMITS.LIVE_STEPS_MAX;
    h.approved("fan", fanOut(slots + 1));
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(slots));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // the first step's answer frees its slot for the 9th, and wakes the run
    answerStep(h, run, 1, "one");
    await within(PARK_MS, () => h.hosts.length === 2 && h.enqueued.length === slots + 1);
    const lines = h.enqueued.filter(({ from }) => from.kind === "flow" && from.call === slots + 1);
    const live = h.spawned.map(
      ({ open }) =>
        open.filter((step) => ["starting", "working"].includes(step.state) && step.handed !== true)
          .length,
    );
    expect({ hosts: h.hosts.length, spawned: h.spawned.length, lines: lines.length }).toEqual({
      hosts: 2,
      spawned: slots + 1,
      lines: 1,
    });
    expect(Math.max(...live)).toBeLessThanOrEqual(slots);
  });

  it("R13e (D2, [BR] MED): a journal call line with no record entry, as a kill between D5's first two steps leaves it, reads starting at the wake: its agent spawns once, the record counts its call, and the run is never lost", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
    h.approved("seq", SEQ);
    const run = startedRun(await h.start({ flow: "seq" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // A's answer, then B's call, journaled as the first life would have before B's record entry, and no entry written
    await killedBeforeEntry(h, run);
    const woken = h.records.runRecord(run);
    expect({
      spawned: h.spawned.map(({ origin }) => origin.call),
      calls: woken?.calls,
      open: woken?.open.map((step) => [step.call, step.state]),
      state: woken?.state,
    }).toEqual({ spawned: [1, 2], calls: 2, open: [[2, "working"]], state: "running" });
    answerStep(h, run, 2, "b");
    expect((await settled(h.runs, run, "done")).log).toBe("ab");
  });

  it("R40c (slice 13, Q2 (a)): a Stop's leave, its host frozen as R13e's is so it leaves only at its grace's SIGKILL, past D1's idle: a step's turn end in the leave journals nothing, every tell in it reads stopping, and nothing wakes", async () => {
    // red-a: the stub answers at once, so there is no leave: the turn end is journaled, and no tell says stopping.
    // The mutations: drop Stop's clear of the idle timer, and the idle parks the leaving host, `#rest` telling
    // `waiting` over `stopping`; drop the ending's guard in #turnEnded (and #answer's behind it), and an answer line
    // appears. HOLD_IDLE_MS, not IDLE_MS: the Stop must come before the idle parks the frozen host, and the leave
    // (KILL_GRACE_MS) still outlasts it
    const h = await harness({ hostIdleMs: HOLD_IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
    h.approved("two", TWO);
    const run = startedRun(await h.start({ flow: "two" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    h.hosts[0]?.child.kill("SIGSTOP");
    const told = toldStates(h, run);
    const stopping = h.runs.stop(run);
    answerStep(h, run, 1, "a");
    const stopped = (await stopping).run;
    expect({
      state: stopped.state,
      told,
      kinds: h.kinds(run),
      hosts: h.hosts.length,
    }).toEqual({
      state: "stopped",
      told: ["stopping", "stopped"],
      kinds: ["head", "call", "call", "end"],
      hosts: 1,
    });
  });

  it("MM3 (the F4 logic review; ruled 2026-11-06): D2's lookup that binds a step's live agent at a wake reserves no agent, and a journaled call with no record entry starts once and reserves one, as LL1 counts a start", async () => {
    // the bind: two agents started, and a wake that binds A keeps the count at 2
    const bound = await harness({ hostIdleMs: IDLE_MS });
    bound.approved("two", TWO);
    const two = startedRun(await bound.start({ flow: "two" })).run;
    await waitFor(() => expect(bound.enqueued).toHaveLength(2));
    expect(await parkedAt(bound, two)).toEqual(PARKED);
    answerStep(bound, two, 2, "b");
    await within(PARK_MS, () => bound.hosts.length === 2);
    answerStep(bound, two, 1, "a");
    await within(PARK_MS, () => stateOf(bound, two) === "done");
    expect({
      state: stateOf(bound, two),
      hosts: bound.hosts.length,
      agents: bound.records.runRecord(two)?.agents,
    }).toEqual({ state: "done", hosts: 2, agents: 2 });
    // the first start: R13e's journaled call with no entry, never started, spawns once and counts one more
    const again = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
    again.approved("seq", SEQ);
    const seq = startedRun(await again.start({ flow: "seq" })).run;
    await waitFor(() => expect(again.enqueued).toHaveLength(1));
    await killedBeforeEntry(again, seq);
    const counted = { spawned: again.spawned.length, agents: again.records.runRecord(seq)?.agents };
    expect(counted).toEqual({ spawned: 2, agents: 2 });
  });

  it("R29 (D1, CL-K-d): of the runs ready at once, HOSTS_LIVE_MAX hosts start; the runs past it read waiting, their records kept, and each starts its host when one leaves, in the order they began", async () => {
    const max = FLOW_LIMITS.HOSTS_LIVE_MAX;
    // TT5 (the 10a review): no park in a row about the cap, at the harness's NO_PARK_MS (UU3); at fieldd's 10 s
    // idle, runs 2 and 3's steps, never answered here, would park on a loaded host and start run 5 early
    const h = await harness();
    h.approved("review", ANSWERED);
    const started: RunSummary[] = [];
    for (let i = 0; i < max + 2; i += 1)
      started.push(startedRun(await h.start({ flow: "review" })));
    const runs = started.map(({ run }) => run);
    /** the run step `i`'s prompt was queued for */
    const runOf = (i: number) => {
      const from = h.enqueued[i]?.from;
      return from?.kind === "flow" ? from.run : undefined;
    };
    await within(PARK_MS, () => h.enqueued.length >= max);
    expect({ hosts: h.hosts.length, states: started.map(({ state }) => state) }).toEqual({
      hosts: max,
      states: [...Array.from({ length: max }, () => "running"), "waiting", "waiting"],
    });
    // the first run's step answers and its run ends: its host's place goes to the first run that waits
    answerStep(h, runs[0] ?? "", 1, "one");
    await within(PARK_MS, () => h.enqueued.length > max);
    const lastRun = runs[max + 1] ?? "";
    const freed = { hosts: h.hosts.length, next: runOf(max), last: stateOf(h, lastRun) };
    expect(freed).toEqual({ hosts: max + 1, next: runs[max], last: "waiting" });
    answerStep(h, runs[1] ?? "", 1, "two");
    await within(PARK_MS, () => h.enqueued.length > max + 1);
    expect({ hosts: h.hosts.length, next: runOf(max + 1) }).toEqual({
      hosts: max + 2,
      next: runs[max + 1],
    });
  });

  it("R30 (CL-H13): a host that left on its own with no call out is started again at once; one that leaves twice with no new journal line between is not started a third time, and its run fails in DESIGN.md §9's words", async () => {
    const h = await harness();
    h.approved("stuck", STUCK);
    const run = startedRun(await h.start({ flow: "stuck" })).run;
    await within(PARK_MS, () => h.kinds(run).includes("log"));
    h.hosts[0]?.child.kill("SIGKILL");
    await within(PARK_MS, () => h.hosts.length === 2);
    // the host started again holds its log line in the journal, so it writes nothing new before it leaves too
    h.hosts[1]?.child.kill("SIGKILL");
    await within(PARK_MS, () => stateOf(h, run) === "failed");
    const ended = h.runs.read(run)?.summary;
    expect({ state: ended?.state, log: ended?.log, hosts: h.hosts.length }).toEqual({
      state: "failed",
      log: "VibeField ended Stuck: its script stopped twice before it could go on.",
      hosts: 2,
    });
    expect(h.kinds(run)).toEqual(["head", "log", "end"]);
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(design).toContain(`"${words.leftTwice("‹flow›")}"`);
  });

  // slice 13 (Q13, R43): a host fieldd ended ends its run failed, its record's `log` §9's sentence for why, said once
  // in place of the script's latest line; the run is never woken again

  /** Two steps, A and B, and a gate, made at once; once A answers, `after` runs (a flood, or a wait forever). */
  const hostEndsAfterA = (after: string): string =>
    [
      'export const meta = { name: "Hosts" };',
      "export default async function () {",
      `  const a = agent("look at a", ${stepAt("A")});`,
      `  agent("look at b", ${stepAt("B")}).catch(() => undefined);`,
      `  ask(${SHIP}).catch(() => undefined);`,
      "  await a;",
      `  ${after}`,
      "}",
      "",
    ].join("\n");
  /** HOST_LOG_LINES_MAX log lines and one more: the supervisor ends the host `flood` (its `log lines` bound). */
  const FLOODS = `for (let i = 0; i <= ${FLOW_LIMITS.HOST_LOG_LINES_MAX}; i += 1) log("line " + i);`;
  /** A `hostEndsAfterA` run whose host fieldd ended for `why`: by its log lines (`flood`), or (`unanswered`) frozen past
   * its pings, read once it has ended. */
  const endedByFieldd = async (why: "flood" | "unanswered") => {
    const h = await harness({
      ...(why === "unanswered" ? { timings: { pingMs: 250, pingMisses: 3 } } : {}),
    });
    h.approved("hosts", hostEndsAfterA(why === "flood" ? FLOODS : "await new Promise(() => {});"));
    const run = startedRun(await h.start({ flow: "hosts" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    await within(PARK_MS, () => h.items.length === 1);
    if (why === "flood") answerStep(h, run, 1, "a");
    else h.hosts[0]?.child.kill("SIGSTOP");
    await within(WAIT_MS, () => endedOf(h, run));
    return { h, run };
  };

  it("R43 (slice 13, Q13): a host fieldd ended, by a flood of log lines past HOST_LOG_LINES_MAX or by its missed pings (`unanswered`), ends its run failed, its record's `log` §9's sentence for why, once", async () => {
    // red-a: `case "ended"` writes `{failed, host}` and no sentence, so `log` stays the script's latest line
    const read = async (why: "flood" | "unanswered") => {
      const { h, run } = await endedByFieldd(why);
      const record = h.records.runRecord(run);
      return {
        state: record?.state,
        host: record?.host,
        log: record?.log,
        lines: endLinesOf(h, run).length,
      };
    };
    const flood = await read("flood");
    const unanswered = await read("unanswered");
    expect({ flood, unanswered }).toEqual({
      flood: { state: "failed", host: "flood", log: words.hostEnded("Hosts", "flood"), lines: 1 },
      unanswered: {
        state: "failed",
        host: "unanswered",
        log: words.hostEnded("Hosts", "unanswered"),
        lines: 1,
      },
    });
  });

  it("R43's never-woken leg (a pin, green at red-a; slice 13, Q13): a run whose host fieldd ended is never woken again: a later turn end and a late gate answer journal nothing, and no host starts", async () => {
    // the pin's mutation: `#finish` keeps the LiveRun, so the late gate answer is journaled (and, while the record
    // still holds the step open, the turn end too)
    const { h, run } = await endedByFieldd("flood");
    const kinds = h.kinds(run);
    const hosts = h.hosts.length;
    answerStep(h, run, 2, "b");
    const late = await h.runs.acts.answer({
      id: h.raisedAs[0]?.id ?? ("ny-item1aaaaaa" as NeedsItemId),
      kind: "flow-gate",
      run: { run, flow: "hosts", call: 3 },
      choice: 0,
      stop: false,
      act: "Ship",
    });
    expect({ late: late.outcome, kinds: h.kinds(run), hosts: h.hosts.length }).toEqual({
      late: "failed",
      kinds,
      hosts,
    });
  });

  it.each(FLOW_HOST_ENDINGS)(
    "R43's words (slice 13; green at red-a, `words.hostEnded` is real): a host fieldd ended for %s is said in DESIGN.md's own words (§9 \"When a run's script cannot go on\")",
    (why) => {
      expect(designText()).toContain(`"${words.hostEnded("‹flow›", why)}"`);
    },
  );

  // step 1p (the 10a review, TT1; ruled 2026-11-06): a run at rest, its host gone, reads `holding` while the person
  // holds it, on every road that rests it, as #park's road reads it

  it("TT1 (the 10a review): a held run woken while HOSTS_LIVE_MAX hosts run waits its turn reading holding, never waiting", async () => {
    const max = FLOW_LIMITS.HOSTS_LIVE_MAX;
    const h = await harness({ hostIdleMs: HOLD_IDLE_MS });
    h.approved("held", HELD_TWO);
    const run = startedRun(await h.start({ flow: "held" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    const a = sessionOf(h, run, 1);
    const missed = { run, call: 1, runtimeRunId: a, outcome: "completed" } as const;
    h.endTurn({ ...missed, turn: "t1", text: "no json here" });
    await within(PARK_MS, () => h.enqueued.length === 3);
    h.endTurn({ ...missed, turn: "t2", text: "still none" });
    // held on the person, then parked: #park's own road reads the hold (step 1q folds its check in here)
    await within(PARK_MS, () => h.items.length === 1 && left(h, 0));
    expect({ state: stateOf(h, run), left: left(h, 0) }).toEqual({ state: "holding", left: true });
    // every host taken, by runs with no call out, which never park
    h.approved("stuck", STUCK);
    for (let i = 0; i < max; i += 1) await h.start({ flow: "stuck" });
    await within(PARK_MS, () => h.hosts.length === max + 1);
    answerStep(h, run, 2, "b");
    await within(PARK_MS, () => answersOf(h, run).length === 1);
    const held = h.records.runRecord(run)?.held?.kind;
    const queued = { state: stateOf(h, run), hosts: h.hosts.length, held };
    expect(queued).toEqual({ state: "holding", hosts: max + 1, held: "flow-repair" });
  });

  it("TT1 (at the 10a review): a held run whose host left on its own reads holding, never waiting", async () => {
    const h = await harness();
    const run = await heldOnRepair(h);
    h.hosts[0]?.child.kill("SIGKILL");
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) !== "running");
    const held = h.records.runRecord(run)?.held?.kind;
    const rests = { state: stateOf(h, run), hosts: h.hosts.length, held };
    expect(rests).toEqual({ state: "holding", hosts: 1, held: "flow-repair" });
  });

  // step 1q (the builder's read of 1p; ruled 2026-11-06): a hold set, or released, while the run is parked is a write
  // of a run at rest too, so it reads `holding` exactly while the person holds it

  it("TT1 (road 4; ruled 2026-11-06): a hold set while the run is parked reads holding, never waiting", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("review", FORMED_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // the step's agent works on while its host is parked, and misses its form twice
    const a = sessionOf(h, run, 1);
    const missed = { run, call: 1, runtimeRunId: a, outcome: "completed" } as const;
    h.endTurn({ ...missed, turn: "t1", text: "no json here" });
    await within(PARK_MS, () => h.enqueued.length === 2);
    h.endTurn({ ...missed, turn: "t2", text: "still none" });
    await within(PARK_MS, () => h.items.length === 1);
    const held = h.records.runRecord(run)?.held?.kind;
    const rests = { state: stateOf(h, run), hosts: h.hosts.length, held };
    expect(rests).toEqual({ state: "holding", hosts: 1, held: "flow-repair" });
  });

  it("TT1 (road 5; ruled 2026-11-06): a hold released while the run is parked reads waiting again, never holding", async () => {
    const h = await harness({ hostIdleMs: HOLD_IDLE_MS });
    const run = await heldOnRepair(h);
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) !== "running");
    expect({ state: stateOf(h, run), left: left(h, 0) }).toEqual({ state: "holding", left: true });
    // the person's Ask once more: the repair line again, and the hold dropped in the same write (F5)
    expect(await askOnceMore(h, run)).toEqual({ outcome: "done" });
    const held = h.records.runRecord(run)?.held;
    const rests = { state: stateOf(h, run), hosts: h.hosts.length, held };
    expect(rests).toEqual({ state: "waiting", hosts: 1, held: undefined });
  });

  // slice 10b (D21, D22, D7; ruled 2026-11-06): a woken host hears its answers in its journal's order, from one
  // writer, the runs, each journaled once and handed to the host whose replay is current; a script that, run again,
  // can't match its journal is set aside lost at D1's park, in §9's words, on its record and in fieldd's log

  /** The words fieldd's log said `run` was set aside in (`fieldd.flows.run.aside`, ruled 2026-11-06), or none. */
  const toldAside = (h: Harness, run: string): unknown => {
    const told = h.warned.find(({ event, fields }) => {
      return event === "fieldd.flows.run.aside" && fields?.["run"] === run;
    });
    return told?.fields?.["log"];
  };

  it("P12 (D7, D21; slice 10b): a woken run whose journal holds a call its script never makes again is set aside lost at HOST_IDLE_MS, in §9's Proposed words, with nothing spawned", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // a call line the script never makes, kept while the run waits; its step's answer, after it, wakes the run
    h.records.appendRun(run, unmade(2));
    answerStep(h, run, 1, "all clean");
    await within(PARK_MS, () => stateOf(h, run) === "lost");
    const said = words.asideUnmatched("Review");
    const ended = h.runs.read(run)?.summary;
    const aside = { state: ended?.state, log: ended?.log, told: toldAside(h, run) };
    expect({ ...aside, spawned: h.spawned.length }).toEqual({
      state: "lost",
      log: said,
      told: said,
      spawned: 1,
    });
    expect(h.kinds(run)).toEqual(["head", "call", "call", "answer", "end"]);
    expect(designText()).toContain(`"${words.asideUnmatched("‹flow›")}"`);
  });

  /** N1's road, P12's (D7): a woken run set aside lost, its woken host frozen once it has made its call again, so the
   * set-aside's leave lasts its grace (KILL_GRACE_MS); answered once the set-aside is said, inside that leave. */
  const asideInItsLeave = async (h: Harness): Promise<string> => {
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    h.records.appendRun(run, unmade(2));
    const made = vi.spyOn(FlowReplay.prototype, "call");
    try {
      answerStep(h, run, 1, "all clean");
      await within(PARK_MS, () => made.mock.calls.length > 0);
    } finally {
      made.mockRestore();
    }
    h.hosts[1]?.child.kill("SIGSTOP");
    await within(PARK_MS, () => toldAside(h, run) !== undefined);
    return run;
  };

  it("R40e (slice 13, Q1 (a), N1): a second Stop answers what the first did, with one `end` and its agent ended once; a Stop in an end's tail waits for it and answers that end, with one `end`; and a Stop in D7's leave answers lost", async () => {
    // red-a: the stub answers each run as it stands at once: running, and done with no `ended` (no tail yet)
    // a second Stop: the first's turn sets the ending, and the second waits on `#ends`
    const twice = await harness();
    twice.approved("review", ANSWERED);
    const run = startedRun(await twice.start({ flow: "review" })).run;
    await waitFor(() => expect(twice.enqueued).toHaveLength(1));
    const [first, second] = await Promise.all([twice.runs.stop(run), twice.runs.stop(run)]);
    const twiceRead = {
      first: first.run.state,
      second: second.run.state,
      lines: endLinesOf(twice, run),
      ends: twice.ends,
    };
    // a Stop in a tail: the run ended done by itself, and its agent's end is held, so `#finish`'s tail waits; the
    // Stop reads `#ends` first (Fact 6: without it, #finishStop would journal a second `end`)
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = await harness({ endHeld: held });
    tail.approved("review", ANSWERED);
    const tailRun = startedRun(await tail.start({ flow: "review" })).run;
    await waitFor(() => expect(tail.enqueued).toHaveLength(1));
    answerStep(tail, tailRun, 1, "all clean");
    await within(PARK_MS, () => tail.ends.length > 0);
    const inTail = tail.runs.stop(tailRun);
    release();
    const tailStop = (await inTail).run;
    const tailRead = {
      state: tailStop.state,
      ended: tailStop.ended,
      lines: endLinesOf(tail, tailRun),
    };
    // N1's leg: a Stop in D7's leave takes no end of its own, and answers the run as its end leaves it
    const aside = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
    const asideRun = await asideInItsLeave(aside);
    const asideStop = (await aside.runs.stop(asideRun)).run.state;
    expect({ second: twiceRead, tail: tailRead, aside: asideStop }).toEqual({
      second: {
        first: "stopped",
        second: "stopped",
        lines: [{ state: "stopped", ended: 1 }],
        ends: ["rt-step1"],
      },
      tail: { state: "done", ended: 1, lines: [{ state: "done", ended: 1 }] },
      aside: "lost",
    });
  });

  it("R40e's N1 leg (a pin, green at red-a; slice 13, N1, J1's F8): a Stop on a run whose ending is already set, D7's set-aside in its leave, takes no end of its own: its record never reads stopping, it ends lost in its set-aside's words, and its journal holds one `end`", async () => {
    // the pin's mutation: `stop()` sets its own ending over the one set, and the run reads stopping, then stopped.
    // What the Stop answers, `lost`, is R40e's red leg: red-a's stub answers at once, as the run stands mid-leave
    const h = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
    const run = await asideInItsLeave(h);
    const told = toldStates(h, run);
    const stopping = h.runs.stop(run);
    await within(PARK_MS + KILL_GRACE_MS, () => endedOf(h, run));
    await stopping;
    const ended = h.runs.read(run)?.summary;
    expect({
      told,
      state: ended?.state,
      log: ended?.log,
      lines: endLinesOf(h, run).map((line) => line.state),
    }).toEqual({
      told: ["lost"],
      state: "lost",
      log: words.asideUnmatched("Review"),
      lines: ["lost"],
    });
  });

  it("R31 (D7; slice 10b): a woken script's new call, made while a call its journal holds is never made again, is never journaled, counted or spawned, and the run is set aside lost in §9's words", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
    h.approved("seq", SEQ);
    const run = startedRun(await h.start({ flow: "seq" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // the host can't hear its shutdown, so it leaves only at its grace's SIGKILL (R27d): A's answer is journaled in
    // that grace, then a call line the script never makes, and the run wakes on both once the host has left
    h.hosts[0]?.child.kill("SIGSTOP");
    await within(PARK_MS, () => stateOf(h, run) === "waiting");
    answerStep(h, run, 1, "a");
    await within(PARK_MS, () => answersOf(h, run).length === 1);
    h.records.appendRun(run, unmade(2));
    await within(PARK_MS + KILL_GRACE_MS, () => stateOf(h, run) === "lost");
    const said = words.asideNew("Seq");
    const ended = h.runs.read(run)?.summary;
    const aside = { state: ended?.state, log: ended?.log, told: toldAside(h, run) };
    const counted = { calls: h.records.runRecord(run)?.calls, spawned: h.spawned.length };
    expect({ ...aside, ...counted }).toEqual({
      state: "lost",
      log: said,
      told: said,
      calls: 2,
      spawned: 1,
    });
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "call", "end"]);
    expect(designText()).toContain(`"${words.asideNew("‹flow›")}"`);
  });

  // slice 13 (Q4–Q7, Q9, Q10, Q16; 9b F6, ZZ2): every end of a run, not only a Stop, ends each agent its steps started
  // (an answered step's among them, D3's erratum), never a session it was handed; moves its open steps to `ended`;
  // ends its items and withdraws its lines; and journals one `end`. One fixture for every class (Q16): step A
  // answered, step B open, step H handed your session, its line waiting, and a gate open

  /** Slice 13's common end (Q16): A, B, H and a gate made at once (calls 1–4); once A answers, `end` ends the run. */
  const endsAs = (end: string): string =>
    [
      'export const meta = { name: "Ends" };',
      "export default async function () {",
      `  const a = agent("look at a", ${stepAt("A")});`,
      `  agent("look at b", ${stepAt("B")}).catch(() => undefined);`,
      '  agent("Review this", { in: "run-yours", label: "Yours" }).catch(() => undefined);',
      `  ask(${SHIP}).catch(() => undefined);`,
      "  await a;",
      `  ${end}`,
      "}",
      "",
    ].join("\n");
  /** Each class of end (9b F6: a row for each kind; N4 (a): the flood by log lines, on this same fixture): how its
   * script ends once A answers, or (`parks`) how its run ends at the wake A's answer, kept while it waits, starts. */
  const END_CLASSES: readonly {
    readonly name: string;
    readonly end: string;
    readonly parks?: "aside" | "bytes";
    readonly ended: { readonly state: string; readonly host?: string };
  }[] = [
    {
      name: "done, its other calls left open (a race's losers)",
      end: 'return "done";',
      ended: { state: "done" },
    },
    { name: "failed, its script threw", end: 'throw new Error("no");', ended: { state: "failed" } },
    {
      name: "failed, a flood of log lines past HOST_LOG_LINES_MAX (N4 (a))",
      end: FLOODS,
      ended: { state: "failed", host: "flood" },
    },
    {
      name: "lost, D7's set-aside (ZZ2 by name): its woken script never makes a call its journal holds",
      end: 'return "done";',
      parks: "aside",
      ended: { state: "lost" },
    },
    {
      name: "lost, its bytes gone by its wake",
      end: 'return "done";',
      parks: "bytes",
      ended: { state: "lost" },
    },
  ];
  /** A run of `endsAs(cls.end)` driven to its end its class's way, by itself (no Stop), read once its `endedAt` is;
   * `beganIn` the handed sessions whose working turn the run's own line began (D19), and `handed` H's state just
   * before the end. */
  const endedAs = async (cls: (typeof END_CLASSES)[number], beganIn: readonly string[] = []) => {
    const h = await harness({
      sessions: { "run-yours": HANDED_YOURS },
      beganIn,
      ...(cls.parks !== undefined ? { hostIdleMs: IDLE_MS } : {}),
    });
    h.approved("ends", endsAs(cls.end));
    const run = startedRun(await h.start({ flow: "ends" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(3));
    await within(PARK_MS, () => h.items.length === 1);
    if (cls.parks !== undefined) {
      // parked held on its gate (UU2), then woken by A's answer, kept while it waits
      await within(PARK_MS, () => left(h, 0) && stateOf(h, run) === "holding");
      if (cls.parks === "aside") h.records.appendRun(run, unmade(5));
      else vi.spyOn(h.records, "bytes").mockReturnValue(undefined);
    }
    const handed = h.records.runRecord(run)?.open.find((step) => step.session === "run-yours");
    answerStep(h, run, 1, "a");
    await within(WAIT_MS, () => endedOf(h, run));
    return { h, run, handed: handed?.state };
  };

  it.each(END_CLASSES)(
    "R42 (slice 13, Q4–Q7, Q9, Q10, Q16), every end class, $name: its started agents ended, the answered one's among them (`ended: 2`), never the handed one; its open steps `ended`; no `held`; its items ended and its lines withdrawn; one `end` line",
    async (cls) => {
      // red-a: `#finish` ends no agent, keeps `open` (ZZ2's phantom) and `held`, and ends no item or line
      const { h, run } = await endedAs(cls);
      const record = h.records.runRecord(run);
      expect({
        state: record?.state,
        host: record?.host,
        ends: [...h.ends].sort(),
        ended: record?.ended,
        lines: endLinesOf(h, run),
        steps: stepsOf(h, run),
        open: record?.open.length,
        held: record?.held,
        items: h.itemsEnded.includes(run),
        withdrawn: h.withdrawn.includes(run),
      }).toEqual({
        state: cls.ended.state,
        host: cls.ended.host,
        ends: ["rt-step1", "rt-step2"],
        ended: 2,
        lines: [{ ...cls.ended, ended: 2 }],
        steps: [
          [1, "answered"],
          [2, "ended"],
          [3, "ended"],
        ],
        open: 0,
        held: undefined,
        items: true,
        withdrawn: true,
      });
    },
  );

  it("R42's never-a-handed-one leg (a pin, green at red-a; slice 13, Q4 (a), K8): an end never ends, nor pauses, a session the run was handed: its origin is not the run's", async () => {
    // the pin's mutation: `sessions.ofRun` admits it (or the end ends every open step's session), and the end ends
    // your session; or (Q11 (a′), K31: the pause is at Stop alone) the end pauses the handed turn the run's own line
    // began, which it reads working here (`beganIn`), and your session is paused
    const [done] = END_CLASSES;
    if (done === undefined) throw new Error("R42's table has no class");
    const { h, handed } = await endedAs(done, ["run-yours"]);
    expect({ handed, ends: h.ends.includes("run-yours"), paused: h.paused }).toEqual({
      handed: "working",
      ends: false,
      paused: [],
    });
  });

  it("P13 (D22; slice 10b): an answer journaled after a woken host read its journal is handed to that host's replay alone; the parked host's replay hears nothing after its park", async () => {
    const made = vi.spyOn(FlowReplay.prototype, "call");
    const heard = vi.spyOn(FlowReplay.prototype, "answered");
    try {
      const h = await harness({ hostIdleMs: IDLE_MS });
      h.approved("two", TWO);
      const run = startedRun(await h.start({ flow: "two" })).run;
      await waitFor(() => expect(h.enqueued).toHaveLength(2));
      expect(await parkedAt(h, run)).toEqual(PARKED);
      const parked = made.mock.contexts[0];
      // A's answer wakes the run; B's lands at once, after the woken host's read and before it makes B again
      answerStep(h, run, 1, "a");
      answerStep(h, run, 2, "b");
      await within(PARK_MS, () => stateOf(h, run) === "done");
      const to = heard.mock.contexts.map((replay) => (replay === parked ? "parked" : "woken"));
      const calls = heard.mock.calls.map(([call]) => call);
      expect({ state: stateOf(h, run), to, calls }).toEqual({
        state: "done",
        to: ["woken"],
        calls: [2],
      });
    } finally {
      made.mockRestore();
      heard.mockRestore();
    }
  });

  it("R28 (D22, D21; slice 10b): an answer that lands while a woken host starts is journaled once and heard once, and starts no second agent", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("two", TWO);
    const run = startedRun(await h.start({ flow: "two" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // A's answer wakes the run; B's lands at once, in the window before the woken host makes B again
    answerStep(h, run, 1, "a");
    answerStep(h, run, 2, "b");
    await within(PARK_MS, () => stateOf(h, run) === "done");
    const ended = h.runs.read(run)?.summary;
    const lines = answersOf(h, run).map(({ call }) => call);
    expect({ state: ended?.state, log: ended?.log, lines, spawned: h.spawned.length }).toEqual({
      state: "done",
      log: "ab",
      lines: [1, 2],
      spawned: 2,
    });
  });

  it("R28b (D22, TT4; slice 10b): an answer cut at RESULT_MAX_BYTES that lands while a woken host starts reaches its script cut short, and its one journal line carries the mark", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("cut", CUT_TWO);
    const run = startedRun(await h.start({ flow: "cut" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    answerStep(h, run, 1, "a");
    answerStep(h, run, 2, "x".repeat(FLOW_LIMITS.RESULT_MAX_BYTES + 100));
    await within(PARK_MS, () => stateOf(h, run) === "done");
    const ended = h.runs.read(run)?.summary;
    const marks = answersOf(h, run)
      .filter(({ call }) => call === 2)
      .map((line) => line.cut);
    expect({ state: ended?.state, log: ended?.log, marks }).toEqual({
      state: "done",
      log: "a true",
      marks: [true],
    });
  });

  it("R28c (D21; the 10b fix's delta review, #8): a race whose answers land B then A while its run is parked takes B once woken, as the journal orders them, through the runs' handler and the host's pipe", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("race", RACE);
    const run = startedRun(await h.start({ flow: "race" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // B's answer wakes the run; A's lands at once, before the woken host makes A and B again, so B's call releases both
    answerStep(h, run, 2, "b");
    answerStep(h, run, 1, "a");
    await within(PARK_MS, () => stateOf(h, run) === "done");
    const ended = h.runs.read(run)?.summary;
    const lines = answersOf(h, run).map(({ call }) => call);
    expect({ state: ended?.state, log: ended?.log, lines, spawned: h.spawned.length }).toEqual({
      state: "done",
      log: "b",
      lines: [2, 1],
      spawned: 2,
    });
  });

  it("P14 (D22, CL-H6; slice 10b): a turn end told again, while its run is parked and once its woken host made the call again, journals one answer line", async () => {
    const made = vi.spyOn(FlowReplay.prototype, "call");
    try {
      const h = await harness({ hostIdleMs: IDLE_MS });
      h.approved("two", TWO);
      const run = startedRun(await h.start({ flow: "two" })).run;
      await waitFor(() => expect(h.enqueued).toHaveLength(2));
      expect(await parkedAt(h, run)).toEqual(PARKED);
      const parked = made.mock.contexts[0];
      const a = { run, call: 1, runtimeRunId: sessionOf(h, run, 1), turn: "t1" } as const;
      const endA = () => h.endTurn({ ...a, outcome: "completed", text: "a" });
      // A's turn end told twice at once, the first waking the run; then again, once the woken host made A and B again
      endA();
      endA();
      const woken = () => made.mock.contexts.filter((replay) => replay !== parked).length;
      await within(PARK_MS, () => woken() === 2);
      endA();
      answerStep(h, run, 2, "b");
      await within(PARK_MS, () => stateOf(h, run) === "done");
      const lines = answersOf(h, run).map(({ call }) => call);
      const ended = { state: stateOf(h, run), log: h.runs.read(run)?.summary.log, lines };
      expect(ended).toEqual({ state: "done", log: "ab", lines: [1, 2] });
    } finally {
      made.mockRestore();
    }
  });

  it("T4 (the F2 review; ruled 2026-11-06; slice 10b): a record write that throws after its journal line landed is the record lagging, never the line refused: the call goes on and its answer is heard, as a replay of that journal hears them", async () => {
    /** A CATCHES run whose record write throws once, just after its journal takes a line of `kind`. */
    const lagging = async (kind: "call" | "answer") => {
      const h = await harness();
      h.approved("review", CATCHES);
      lagsOnce(h, kind);
      const run = startedRun(await h.start({ flow: "review" })).run;
      // XX3 (the 10b read): the first boot waits as every row's does
      await waitFor(() => expect(h.enqueued).toHaveLength(1));
      answerStep(h, run, 1, "all clean");
      await within(PARK_MS, () => stateOf(h, run) === "done");
      const ended = h.runs.read(run)?.summary;
      const spawned = h.spawned.length;
      // XX4: the record never keeps an answered call's step working past the run's next record write
      const working = (h.records.runRecord(run)?.open ?? [])
        .filter((step) => step.call === 1 && step.state === "working")
        .map((step) => step.call);
      return { state: ended?.state, log: ended?.log, spawned, kinds: h.kinds(run), working };
    };
    const kinds = ["head", "call", "answer", "log", "end"];
    const heard = { state: "done", log: "all clean", spawned: 1, kinds, working: [] };
    // the call line landed and its record's write threw: the call goes on, never refused
    expect(await lagging("call")).toEqual(heard);
    // the answer line landed and its record's settle threw: the script hears the answer the journal holds, and the
    // run's next record write settles the step its settle missed (XX4)
    expect(await lagging("answer")).toEqual(heard);
  });

  it("R40d (slice 13, Q3 step 1): a Stop whose `stopping` the disk refuses acts on nothing: it is refused retryably in the store's words, nothing is ended, the host is up, and a second Stop works", async () => {
    // red-a: the stub writes no `stopping`, so the refusal never comes, and neither Stop stops the run
    const h = await harness();
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      if (refused || fields.state !== "stopping") return write(at, fields);
      refused = true;
      throw new Error("ENOSPC: no space left on device, write");
    });
    const said = await h.runs.stop(run).then(
      (stopped) => ({ answered: stopped.run.state }),
      (error: unknown) => {
        const e = error as RpcCallError;
        return { kind: e.kind, message: e.message, retryable: e.retryable };
      },
    );
    // (red-a skeptic F6) acting on nothing also reads no line withdrawn, no item ended and no turn paused
    const after = {
      ends: [...h.ends],
      withdrawn: [...h.withdrawn],
      items: [...h.itemsEnded],
      paused: [...h.paused],
      up: !left(h, 0),
      state: stateOf(h, run),
      kinds: h.kinds(run),
    };
    const again = (await h.runs.stop(run)).run;
    expect({
      said,
      after,
      again: { state: again.state, ended: again.ended, kinds: h.kinds(run) },
    }).toEqual({
      said: { kind: "UNAVAILABLE", message: UNREADABLE_WORDS.flows, retryable: true },
      after: {
        ends: [],
        withdrawn: [],
        items: [],
        paused: [],
        up: true,
        state: "running",
        kinds: ["head", "call"],
      },
      again: { state: "stopped", ended: 1, kinds: ["head", "call", "end"] },
    });
  });

  it("T4c (D1, T4; the 10b fix's delta review, #2): an answer whose record settle throws still wakes its run, parked or its host still leaving: the woken host hears the answer its journal holds, the run ends done, and the wake's own write settles the step (XX4)", async () => {
    /** An ANSWERED run, parked or (`leaving`) its host stopped inside its leave grace, whose answer's settle throws. */
    const lagged = async (leaving: boolean) => {
      const h = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
      h.approved("review", ANSWERED);
      const run = startedRun(await h.start({ flow: "review" })).run;
      await waitFor(() => expect(h.enqueued).toHaveLength(1));
      if (leaving) {
        // the host can't hear its shutdown, so it leaves only at its grace's SIGKILL (R27d)
        h.hosts[0]?.child.kill("SIGSTOP");
        await within(PARK_MS, () => stateOf(h, run) === "waiting");
      } else await parkedAt(h, run);
      lagsOnce(h, "answer");
      answerStep(h, run, 1, "all clean");
      await within(PARK_MS + KILL_GRACE_MS, () => stateOf(h, run) === "done");
      const ended = h.runs.read(run)?.summary;
      const working = (h.records.runRecord(run)?.open ?? [])
        .filter((step) => step.call === 1 && step.state === "working")
        .map((step) => step.call);
      return {
        state: ended?.state,
        log: ended?.log,
        hosts: h.hosts.length,
        kinds: h.kinds(run),
        working,
      };
    };
    const kinds = ["head", "call", "answer", "log", "end"];
    const woken = { state: "done", log: "all clean", hosts: 2, kinds, working: [] };
    // parked: no host up, so the answer's own wake starts one
    expect(await lagged(false)).toEqual(woken);
    // still leaving: the answer owes the wake, which the old host's end pays (R27d)
    expect(await lagged(true)).toEqual(woken);
  });

  it("R42c (slice 13, Q7, XX4): an end's write moves every open step to `ended` but one its journal answers, whose own settle lagged: that one reads answered, never ended", async () => {
    // red-a: the end's write settles A (XX4, as built) and keeps B open, working. The mutation (Q7's trap): the end's
    // `whole` marks every open step `ended` with no skip of the calls its journal answers, and A reads ended
    const h = await harness();
    h.approved("race", RACE);
    lagsOnce(h, "answer");
    const run = startedRun(await h.start({ flow: "race" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    answerStep(h, run, 1, "a");
    await within(PARK_MS, () => endedOf(h, run));
    expect({
      state: stateOf(h, run),
      steps: stepsOf(h, run),
      open: h.records.runRecord(run)?.open.length,
    }).toEqual({
      state: "done",
      steps: [
        [1, "answered"],
        [2, "ended"],
      ],
      open: 0,
    });
  });

  it("P8r (XX1(b), the 10b read; slice 10b): through the runs, a step's answer nested past ARGS_DEPTH_MAX is refused to its script and journaled as that refusal, so its journal reads back", async () => {
    const h = await harness();
    h.approved("review", FORMED_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // the form names its verdict alone, so a field it does not name passes, however deep (form-check.ts)
    let deep = '"x"';
    for (let i = 0; i < FLOW_LIMITS.ARGS_DEPTH_MAX + 1; i += 1) deep = `[${deep}]`;
    const text = fenced(`{"verdict":"clean","deep":${deep}}`);
    h.endTurn({ run, call: 1, runtimeRunId: "rt-step1", turn: "t1", outcome: "completed", text });
    const said = `VibeField can't hand this agent's answer on: it nests deeper than ${FLOW_LIMITS.ARGS_DEPTH_MAX}`;
    expect((await settled(h.runs, run, "done")).log).toBe(said);
    const read = h.records.readRun(run);
    expect({ kept: read.kind, answers: answersOf(h, run) }).toMatchObject({
      kept: "kept",
      answers: [{ kind: "answer", call: 1, refused: said }],
    });
  });

  // slice 11a (Q1–Q5, Q13; the slice 11 rulings, ruled 2026-11-06): ask() as `flow-gate`. Its item is raised on
  // the one raise road and held at its call; a held run reads running while its host is up and holding once D1's idle
  // parks it (UU2); `held` names the first of its holds still open, of any kind, released only by its own item's act or
  // its call's answer (EE3); a gate made again at a wake is re-bound by the needs queue, never minted again (D2, Q5).
  // Each row reads its state at a tell or once parked, never by `settled(…, "holding")` (M1). At this red an ask is
  // still refused (NO_ASK_YET): every gate row reads red on its values.

  /** Whether `run` has ended, or reads as no run: what a hold row's wait stops on when no hold comes. */
  const over = (h: Harness, run: string): boolean => {
    const state = stateOf(h, run);
    return state === undefined || ["done", "stopped", "failed", "lost"].includes(state);
  };
  /** The run's state and its hold, as its summary and its record read them now (VV1: `held` beside the state). */
  const heldOf = (h: Harness, run: string) => ({
    state: stateOf(h, run),
    held: h.records.runRecord(run)?.held,
  });
  /** The items the row's real needs queue (`needsQueue`) holds open now, by id, in its order. */
  const openOf = (h: Harness) =>
    needsOf(h)
      .list()
      .map((item) => item.id);

  it("R33 (D1, D22, Q1, Q4's UU2; slice 11a): a gate holds its run at its raise, running while its host is up and holding once parked by the idle; the person's answer is journaled by the runs as the act's own words, byte for byte, and wakes the run, whose ask resolves to them", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
    const needs = needsOf(h);
    h.approved("gate", GATE);
    // every tell, as the run's record and the needs queue read at it: the raise is read at its own tell (UU2), never
    // by a poll, so no idle can come between
    const tells: { state: string; held: unknown; open: string[] }[] = [];
    h.runs.onChange((list) => {
      const told = list.runs.find((summary) => summary.flow === "gate");
      if (told === undefined) return;
      const held = h.records.runRecord(told.run)?.held;
      tells.push({ state: told.state, held, open: needs.list().map((item) => item.id) });
    });
    const run = startedRun(await h.start({ flow: "gate" })).run;
    await within(PARK_MS, () => h.items.length > 0 || over(h, run));
    const id = h.raisedAs[0]?.id ?? "";
    // at its raise: the call line, the item and the hold in one turn of the host's frame, its host up
    expect(tells.find(({ open }) => open.length > 0)).toEqual({
      state: "running",
      held: { item: id, kind: "flow-gate" },
      open: [id],
    });
    // parked by D1's idle, it rests holding on the same item
    await within(PARK_MS, () => left(h, 0) || over(h, run));
    expect({ ...heldOf(h, run), left: left(h, 0) }).toEqual({
      state: "holding",
      held: { item: id, kind: "flow-gate" },
      left: true,
    });
    // the person's answer: its settle rests the run waiting, the hold released in that write; the wake runs it, and the
    // script hears " Push", as the journal keeps it
    const from = tells.length;
    await needs.answer(id, 0, PRINCIPAL);
    await within(PARK_MS, () => over(h, run));
    // each change once: the tells in a row that say the same are one
    const after = tells.slice(from).map(({ state, held }) => JSON.stringify({ state, held }));
    const said = after.filter((tell, i) => tell !== after[i - 1]);
    const changes = said.map((tell): unknown => JSON.parse(tell));
    expect({
      changes,
      log: h.runs.read(run)?.summary.log,
      answers: answersOf(h, run).map(({ call, value }) => [call, value]),
    }).toEqual({
      changes: [
        { state: "waiting", held: undefined },
        { state: "running", held: undefined },
        { state: "done", held: undefined },
      ],
      log: "[ Push]",
      answers: [[1, " Push"]],
    });
  });

  it("R40g (slice 13, Q9, N8; board `co-flow-asks-fan-out` (a), 2026-11-07: \"256 is the limit, Stop clears them\"): Stop through any of a run's items stops the run: through one of two gates, both end; through a repair's, it ends; and through an item whose run no record keeps, done, its items ended", async () => {
    // red-a: a run's item's Stop still throws (`#answered`, "a later slice's"), so each answer is read through its
    // refusal, and fails on that value (M1)
    /** An answer's outcome as the item keeps it (Q9: the Stop answers `done`, never `failed`), or the words it was
     * refused in. */
    const outcomeOf = (answer: Promise<NeedsAnswered>) =>
      answer.then(
        (answered) => answered.item.answer?.outcome,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    // N8's leg: two gates open at once, on the real needs queue; Stop through the first ends both
    const gates = await harness({ needsQueue: true });
    const needs = needsOf(gates);
    gates.approved("gates", TWO_GATES);
    const run = startedRun(await gates.start({ flow: "gates" })).run;
    await within(PARK_MS, () => gates.raisedAs.length === 2);
    const [one = "", two = ""] = gates.raisedAs.map(({ id }) => id);
    // each gate's acts are its choices, then Stop the run (the queue's last)
    const stopped = await outcomeOf(needs.answer(one as NeedsItemId, 2, PRINCIPAL));
    const sibling = await refusalOf(needs.answer(two as NeedsItemId, 0, PRINCIPAL));
    const gateLeg = {
      stopped,
      state: stateOf(gates, run),
      open: needs.list().filter((item) => item.run?.run === run).length,
      sibling: sibling === "started" ? sibling : sibling.reason,
    };
    // a repair's item: a step whose answer missed its form twice holds the run on you; Stop through it
    const repair = await harness({ needsQueue: true });
    const repairRun = await heldOnRepair(repair);
    const repairId = repair.raisedAs[0]?.id ?? ("" as NeedsItemId);
    const repairLeg = {
      stopped: await outcomeOf(needsOf(repair).answer(repairId, 1, PRINCIPAL)),
      state: stateOf(repair, repairRun),
      open: needsOf(repair).list().length,
    };
    // no record: a forged run's item, whose one act is Stop (s14 Q12): done, never noSuchRun, its items ended
    const gone = "fr-0000000000000000";
    const noRecordLeg = {
      acted: await repair.runs.acts
        .answer({
          id: "ny-item9aaaaaa" as NeedsItemId,
          kind: "flow-gate",
          run: { run: gone, flow: "gates", call: 1 },
          choice: 2,
          stop: true,
          act: NEEDS_CHOICE_WORDS.stopRun,
        })
        .then(
          (acted) => acted.outcome,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
      items: repair.itemsEnded.includes(gone),
    };
    expect({ gateLeg, repairLeg, noRecordLeg }).toEqual({
      gateLeg: { stopped: "done", state: "stopped", open: 0, sibling: "ended" },
      repairLeg: { stopped: "done", state: "stopped", open: 0 },
      noRecordLeg: { acted: "done", items: true },
    });
  });

  it("R40g-2 (slice 13's fold 1; the green skeptic's #3): past fieldd's own stop, the Stop of a forged run's `flow-lost` item (its run no record keeps) acts on nothing and is refused retryably, so the item waits for the next life", async () => {
    // red at the unfixed green: #stopAct's no-record road reads no #closing, so on a fieldd that is stopping it
    // withdraws the run's lines, ends its items and answers `done`
    const h = await harness();
    await h.runs.close();
    const gone = "fr-0000000000000000";
    // fold 2 (the fold skeptic's #2): the forged run lists one live agent, so a refusal that ended its agents first
    // would read `ends: ["rt-forged"]`; with none listed, `ends: []` could not go red
    vi.spyOn(h.runs.ports.sessions, "ofRun").mockReturnValue([
      { runtimeRunId: "rt-forged", call: 1, live: true },
    ]);
    const acted = await h.runs.acts
      .answer({
        id: "ny-item9aaaaaa" as NeedsItemId,
        kind: "flow-lost",
        run: { run: gone, flow: "review", call: 1 },
        choice: 1,
        stop: true,
        act: NEEDS_CHOICE_WORDS.stopRun,
      })
      .then(
        (answer): unknown => answer.outcome,
        (error: unknown) =>
          error instanceof RpcCallError
            ? { kind: error.kind, retryable: error.retryable, details: error.details }
            : String(error),
      );
    expect({ acted, withdrawn: h.withdrawn, items: h.itemsEnded, ends: h.ends }).toEqual({
      acted: {
        kind: "UNAVAILABLE",
        retryable: true,
        details: { service: RECORD_STORES.SERVICE_FLOWS, state: "stopping" },
      },
      withdrawn: [],
      items: [],
      ends: [],
    });
  });

  it("R27b (D1, Q4's UU2, its fourth leg; slice 11a): a gate beside a step parks by D1's idle, whichever the script made first: the run rests holding on the gate while the step's agent works on", async () => {
    /** A run of `text`, its gate and its step at once, read once parked */
    const parked = async (flow: string, text: string) => {
      const h = await harness({ hostIdleMs: IDLE_MS });
      h.approved(flow, text);
      const run = startedRun(await h.start({ flow })).run;
      const ready = () => h.items.length > 0 && h.enqueued.length > 0 && left(h, 0);
      await within(PARK_MS, () => ready() || over(h, run));
      return {
        ...heldOf(h, run),
        items: h.items.map((item) => [item.kind, item.run.call]),
        steps: h.records.runRecord(run)?.open.map((step) => [step.call, step.state]),
        spawned: h.spawned.length,
      };
    };
    const held = { item: "ny-item1aaaaaa", kind: "flow-gate" };
    expect(await parked("gate", GATE_AND_STEP)).toEqual({
      state: "holding",
      held,
      items: [["flow-gate", 1]],
      steps: [[2, "working"]],
      spawned: 1,
    });
    expect(await parked("step", STEP_AND_GATE)).toEqual({
      state: "holding",
      held,
      items: [["flow-gate", 2]],
      steps: [[1, "working"]],
      spawned: 1,
    });
  });

  it("R13d (D2, Q5; slice 11a): a gate open across a wake keeps its one item: the woken script's ask, made again, is re-bound to it by the needs queue, never minted again, and the run rests holding on it; two gates are each minted once", async () => {
    // one gate beside a step: the step's answer wakes the run, and its gate, made again, is the item it was
    const h = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
    h.approved("gate", GATE_AND_STEP);
    const run = startedRun(await h.start({ flow: "gate" })).run;
    const parked = () => h.items.length > 0 && h.enqueued.length > 0 && left(h, 0);
    await within(PARK_MS, () => parked() || over(h, run));
    answerStep(h, run, 2, "a");
    await within(PARK_MS, () => (h.items.length > 1 && left(h, 1)) || over(h, run));
    const gate = h.raisedAs[0]?.id ?? "";
    expect({
      ...heldOf(h, run),
      raised: h.raisedAs.map(({ id, minted }) => [id, minted]),
      open: openOf(h),
      hosts: h.hosts.length,
    }).toEqual({
      state: "holding",
      held: { item: gate, kind: "flow-gate" },
      raised: [
        [gate, true],
        [gate, false],
      ],
      open: [gate],
      hosts: 2,
    });
    // two gates beside a step: each minted in the first life, each re-bound at the wake, so two minted in all
    const two = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
    two.approved("gates", TWO_GATES_AND_STEP);
    const both = startedRun(await two.start({ flow: "gates" })).run;
    const ready = () => two.items.length > 1 && two.enqueued.length > 0 && left(two, 0);
    await within(PARK_MS, () => ready() || over(two, both));
    answerStep(two, both, 3, "c");
    await within(PARK_MS, () => (two.items.length > 3 && left(two, 1)) || over(two, both));
    const [a, b] = two.raisedAs.map(({ id }) => id);
    expect({
      ...heldOf(two, both),
      raised: two.raisedAs.map(({ id, minted }) => [id, minted]),
      open: openOf(two),
    }).toEqual({
      state: "holding",
      held: { item: a, kind: "flow-gate" },
      raised: [
        [a, true],
        [b, true],
        [a, false],
        [b, false],
      ],
      open: [a, b],
    });
  });

  it("R13e-ask (i) (D2's last row, [BR] MED, Q5 §5; slice 11a): an ask() journaled with no item, as a kill between D5's gate steps leaves it, raises its item once at the wake, minted, and the run rests holding on it", async () => {
    const h = await harness({
      hostIdleMs: IDLE_MS,
      timings: { stopGraceMs: KILL_GRACE_MS },
      needsQueue: true,
    });
    h.approved("seq-ask", SEQ_ASK);
    const run = startedRun(await h.start({ flow: "seq-ask" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // A's answer, then the ask's call line, as the first life would have journaled it before its item
    await killedBeforeEntry(h, run, seqAsk(), () => h.items.length > 0 || over(h, run));
    await within(PARK_MS, () => left(h, 1) || over(h, run));
    const id = h.raisedAs[0]?.id ?? "";
    const woken = h.records.runRecord(run);
    expect({
      ...heldOf(h, run),
      raised: h.raisedAs.map(({ minted }) => minted),
      open: openOf(h),
      calls: woken?.calls,
    }).toEqual({
      state: "holding",
      held: { item: id, kind: "flow-gate" },
      raised: [true],
      open: [id],
      calls: 2,
    });
  });

  it("R13e-ask (ii) (D2's last row, [BR] MED, Q5 §5; slice 11a): an ask() journaled whose item the needs queue kept, as a kill between D5's gate steps 2 and 3 leaves it, is re-bound to that item at the wake, never a second and never minted, and the run rests holding on it", async () => {
    const h = await harness({
      hostIdleMs: IDLE_MS,
      timings: { stopGraceMs: KILL_GRACE_MS },
      needsQueue: true,
    });
    const needs = needsOf(h);
    h.approved("seq-ask", SEQ_ASK);
    const run = startedRun(await h.start({ flow: "seq-ask" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // the item the first life raised for the ask before its kill, which the needs queue keeps
    const kept = needs.flowItem({
      kind: "flow-gate",
      run: { run, flow: "seq-ask", call: 2 },
      name: "Seq ask",
      words: "Ship it?",
      acts: ["Ship", "Hold"],
    }).id;
    await killedBeforeEntry(h, run, seqAsk(), () => h.items.length > 0 || over(h, run));
    await within(PARK_MS, () => left(h, 1) || over(h, run));
    expect({
      ...heldOf(h, run),
      raised: h.raisedAs.map(({ id, minted }) => [id, minted]),
      open: needs.list().map((item) => item.id),
      calls: h.records.runRecord(run)?.calls,
    }).toEqual({
      state: "holding",
      held: { item: kept, kind: "flow-gate" },
      raised: [[kept, false]],
      open: [kept],
      calls: 2,
    });
  });

  it("R36 (D21, D22; slice 11a): a gate journaled through its own raise and answer is answered from the journal at every later wake, never raised again: its ask hears the same act in each life", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
    const needs = needsOf(h);
    h.approved("ship", GATE_THEN_STEP);
    const run = startedRun(await h.start({ flow: "ship" })).run;
    await within(PARK_MS, () => (needs.list().length > 0 && left(h, 0)) || over(h, run));
    const id = h.raisedAs[0]?.id ?? "";
    expect({ ...heldOf(h, run), open: needs.list().map((item) => item.id) }).toEqual({
      state: "holding",
      held: { item: id, kind: "flow-gate" },
      open: [id],
    });
    // the gate's answer wakes the run, whose script then makes its step; the step's answer wakes it again
    await needs.answer(id, 0, PRINCIPAL);
    await within(PARK_MS, () => (h.enqueued.length > 0 && left(h, 1)) || over(h, run));
    answerStep(h, run, 2, "a");
    await within(PARK_MS, () => over(h, run));
    expect({
      ...heldOf(h, run),
      log: h.runs.read(run)?.summary.log,
      raised: h.raisedAs.map(({ id: item, minted }) => [item, minted]),
      answers: answersOf(h, run).map(({ call, value }) => [call, value]),
      open: needs.list().length,
      hosts: h.hosts.length,
    }).toEqual({
      state: "done",
      held: undefined,
      log: "Ship a",
      raised: [[id, true]],
      answers: [
        [1, "Ship"],
        [2, { text: "a" }],
      ],
      open: 0,
      hosts: 3,
    });
  });

  it("EE3-a (Q3, VV1; slice 11a): two steps held on their repairs at once each hold their own item: the second's raise leaves the run's hold on the first, and Ask once more on the first moves it to the second, the run still holding, in either order", async () => {
    /** TWO_FORMED's steps each missing their form twice, in `order`; then Ask once more on the first held */
    const twoHeld = async (order: readonly [number, number]) => {
      const h = await harness({ hostIdleMs: IDLE_MS });
      h.approved("held", TWO_FORMED);
      const run = startedRun(await h.start({ flow: "held" })).run;
      await waitFor(() => expect(h.enqueued).toHaveLength(2));
      for (const [i, call] of order.entries()) {
        const at = {
          run,
          call,
          runtimeRunId: sessionOf(h, run, call),
          outcome: "completed",
        } as const;
        h.endTurn({ ...at, turn: "t1", text: "no json here" });
        await within(PARK_MS, () => h.enqueued.length === 3 + i);
        h.endTurn({ ...at, turn: "t2", text: "still none" });
        await within(PARK_MS, () => h.items.length === i + 1);
      }
      await within(PARK_MS, () => left(h, 0));
      const [first, second] = h.raisedAs.map(({ id }) => id);
      const both = heldOf(h, run);
      const acted = await h.runs.acts.answer({
        id: first ?? "",
        kind: "flow-repair",
        run: { run, flow: "held", call: order[0], label: order[0] === 1 ? "A" : "B" },
        choice: 0,
        stop: false,
        act: NEEDS_CHOICE_WORDS.askOnceMore,
      });
      return { first, second, read: { both, acted, again: heldOf(h, run) } };
    };
    for (const order of [
      [1, 2],
      [2, 1],
    ] as const) {
      const { first, second, read } = await twoHeld(order);
      expect(read).toEqual({
        both: { state: "holding", held: { item: first, kind: "flow-repair" } },
        acted: { outcome: "done" },
        again: { state: "holding", held: { item: second, kind: "flow-repair" } },
      });
    }
  });

  it("EE3-b (Q3, Q5, VV1; slice 11a): of two gates at once, the second answered first leaves the run held on the first: its wake runs holding that item, the woken ask is re-bound to it, and the run rests holding it until its answer ends the run", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
    const needs = needsOf(h);
    h.approved("gates", TWO_GATES);
    const run = startedRun(await h.start({ flow: "gates" })).run;
    await within(PARK_MS, () => (h.items.length > 1 && left(h, 0)) || over(h, run));
    const [first, second] = h.raisedAs.map(({ id }) => id);
    expect({ ...heldOf(h, run), open: needs.list().map((item) => item.id) }).toEqual({
      state: "holding",
      held: { item: first, kind: "flow-gate" },
      open: [first, second],
    });
    // B's answer first: its settle, and the wake it starts, leave the hold on A's gate
    const tells: { state: string; held: unknown }[] = [];
    h.runs.onChange((list) => {
      const told = list.runs.find((summary) => summary.run === run);
      if (told === undefined) return;
      tells.push({ state: told.state, held: h.records.runRecord(run)?.held });
    });
    await needs.answer(second ?? "", 0, PRINCIPAL);
    await within(PARK_MS, () => left(h, 1) || over(h, run));
    expect({
      woke: tells.find(({ state }) => state === "running"),
      ...heldOf(h, run),
      raised: h.raisedAs.map(({ id, minted }) => [id, minted]),
      open: needs.list().map((item) => item.id),
    }).toEqual({
      woke: { state: "running", held: { item: first, kind: "flow-gate" } },
      state: "holding",
      held: { item: first, kind: "flow-gate" },
      raised: [
        [first, true],
        [second, true],
        [first, false],
      ],
      open: [first],
    });
    // A's answer: its settle releases the last hold, and the run ends
    await needs.answer(first ?? "", 1, PRINCIPAL);
    await within(PARK_MS, () => over(h, run));
    expect({ ...heldOf(h, run), log: h.runs.read(run)?.summary.log }).toEqual({
      state: "done",
      held: undefined,
      log: "Hold Go",
    });
  });

  it("EE3-c (Q3, VV1; slice 11a): a gate and a step's repair held at once: the first held keeps the run's hold through the other's raise and its Ask once more; Ask once more on a repair held first moves the hold to the gate; each read once parked", async () => {
    // the gate first: the step's second miss, and its Ask once more, leave the hold on the gate
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("beside", GATE_BESIDE_FORM);
    const run = startedRun(await h.start({ flow: "beside" })).run;
    await within(PARK_MS, () => (h.items.length > 0 && h.enqueued.length > 0) || over(h, run));
    const a = { run, call: 2, runtimeRunId: sessionOf(h, run, 2), outcome: "completed" } as const;
    h.endTurn({ ...a, turn: "t1", text: "no json here" });
    await within(PARK_MS, () => h.enqueued.length > 1 || over(h, run));
    h.endTurn({ ...a, turn: "t2", text: "still none" });
    await within(PARK_MS, () => (h.items.length > 1 && left(h, 0)) || over(h, run));
    const [gate, repair] = h.raisedAs.map(({ id }) => id);
    const raised = heldOf(h, run);
    const acted = await h.runs.acts.answer({
      id: repair ?? "",
      kind: "flow-repair",
      run: { run, flow: "beside", call: 2, label: "A" },
      choice: 0,
      stop: false,
      act: NEEDS_CHOICE_WORDS.askOnceMore,
    });
    expect({ raised, acted, again: heldOf(h, run) }).toEqual({
      raised: { state: "holding", held: { item: gate, kind: "flow-gate" } },
      acted: { outcome: "done" },
      again: { state: "holding", held: { item: gate, kind: "flow-gate" } },
    });
    // the repair first, the gate asked once another step has answered: Ask once more moves the hold to the gate
    const later = await harness({ hostIdleMs: IDLE_MS });
    later.approved("later", FORM_THEN_GATE);
    const asks = startedRun(await later.start({ flow: "later" })).run;
    await waitFor(() => expect(later.enqueued).toHaveLength(2));
    const stepA = {
      run: asks,
      call: 1,
      runtimeRunId: sessionOf(later, asks, 1),
      outcome: "completed",
    } as const;
    later.endTurn({ ...stepA, turn: "t1", text: "no json here" });
    await within(PARK_MS, () => later.enqueued.length > 2);
    later.endTurn({ ...stepA, turn: "t2", text: "still none" });
    await within(PARK_MS, () => later.items.length > 0);
    answerStep(later, asks, 2, "b");
    const lastLeft = () => left(later, later.hosts.length - 1);
    await within(PARK_MS, () => (later.items.length > 1 && lastLeft()) || over(later, asks));
    const [held, asked] = later.raisedAs.map(({ id }) => id);
    const both = heldOf(later, asks);
    const moved = await later.runs.acts.answer({
      id: held ?? "",
      kind: "flow-repair",
      run: { run: asks, flow: "later", call: 1, label: "A" },
      choice: 0,
      stop: false,
      act: NEEDS_CHOICE_WORDS.askOnceMore,
    });
    expect({ both, moved, again: heldOf(later, asks) }).toEqual({
      both: { state: "holding", held: { item: held, kind: "flow-repair" } },
      moved: { outcome: "done" },
      again: { state: "holding", held: { item: asked, kind: "flow-gate" } },
    });
  });

  // Q8's repair rider (F-a; the slice 11 rulings): a step's second miss raises its item on the one raise road,
  // so an item the needs queue can't raise fails the step in F5's words. Until the green, the raise's throw leaves the
  // runs' listener, the step listener catches and says it (flow-step-events.ts), and the step waits on, repairing with
  // no item: a silent wait.

  it("R22g (Q8's repair rider, F-a, F5; slice 11a): a step's second miss whose item the needs queue can't raise fails the step in §9's words, never a silent wait: its answer journaled as the refusal, no hold, and the script hears it", async () => {
    // the turn ends go through the step listener itself (F3's precedent), so what the runs' listener throws is caught
    // there, never thrown into the row
    const events = new FlowStepEvents();
    const h = await harness({
      stepEvents: events,
      flowItemThrows: new Error("ENOSPC: no space left on device, write"),
    });
    h.approved("review", FORMED_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const step = fakeAgent();
    events.entered({
      agent: step.agent,
      runtimeRunId: "rt-step1",
      begun: "spawn",
      origin: { by: "flow", run, call: 1 },
    });
    step.emit("turn:started", {});
    step.emit("turn:completed", { lastAssistantMessage: "no json here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    step.emit("turn:started", {});
    step.emit("turn:completed", { lastAssistantMessage: "still none" });
    await within(PARK_MS, () => over(h, run));
    const record = h.records.runRecord(run);
    // the step as the record keeps it: open while it works, among the settled steps once answered
    const kept = [...(record?.open ?? []), ...(record?.steps ?? [])].find((s) => s.call === 1);
    expect({
      step: { label: kept?.label, state: kept?.state },
      ...heldOf(h, run),
      refused: refusalsOf(h, run),
      log: h.runs.read(run)?.summary.log,
      raises: h.items.map(({ kind, run: { call } }) => [kind, call]),
      queued: h.enqueued.length,
    }).toEqual({
      step: { label: "Diff", state: "failed" },
      state: "done",
      held: undefined,
      refused: [stepFailed("Diff")],
      log: stepFailed("Diff"),
      raises: [["flow-repair", 1]],
      queued: 2,
    });
  });

  it("R22h (Q8's repair rider, F-a's second half, F5; ruled 2026-11-06, MED-2; slice 11a): a step's second miss whose hold its run's record refuses after the needs queue raised its item still holds on you: Ask once more on it sends the repair line again, the hold released in that act's own write, and fieldd's log says the refused write at warn", async () => {
    // the turn ends go through the step listener itself (R22g's precedent), so what the runs' listener throws is caught
    // there, never thrown into the row
    const events = new FlowStepEvents();
    const h = await harness({ stepEvents: events });
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const step = fakeAgent();
    events.entered({
      agent: step.agent,
      runtimeRunId: "rt-step1",
      begun: "spawn",
      origin: { by: "flow", run, call: 1 },
    });
    /** the step's next turn, its answer `text` */
    const turn = (text: string) => {
      step.emit("turn:started", {});
      step.emit("turn:completed", { lastAssistantMessage: text });
    };
    turn("no json here");
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    // T4's arm at the raise: the run's record write just after the needs port raised the repair's item throws once, as
    // a full disk at that moment refuses it
    const { needs } = h.runs.ports;
    const raise = needs.flowItem.bind(needs);
    const write = h.records.writeRunRecord.bind(h.records);
    let armed = false;
    let refused = false;
    vi.spyOn(needs, "flowItem").mockImplementation((item) => {
      const raised = raise(item);
      armed = true;
      return raised;
    });
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      if (!armed) return write(at, fields);
      armed = false;
      refused = true;
      throw new Error("ENOSPC: no space left on device, write");
    });
    turn("still none");
    await waitFor(() => expect(h.items).toHaveLength(1));
    // its item raised and its hold's write refused, the record still says the step repairs (its `holding` rode that
    // write): green v1's Ask once more, reading `step.state !== "holding"`, acted on nothing, the agent left waiting
    const before = h.records.runRecord(run);
    expect({ refused, step: before?.open[0]?.state, held: before?.held }).toEqual({
      refused: true,
      step: "repairing",
      held: undefined,
    });
    const acted = await askOnceMore(h, run);
    const repair = repairLine("the answer holds no JSON the form can read");
    expect({
      acted,
      sent: h.enqueued.slice(2).map(({ text, from }) => ({ text, from })),
      held: h.records.runRecord(run)?.held,
      logged: {
        warn: h.warned.filter(({ event }) => event === "fieldd.flows.run.hold").length,
        error: h.errored.filter(({ event }) => event === "fieldd.flows.run.hold").length,
      },
    }).toEqual({
      acted: { outcome: "done" },
      sent: [
        { text: repair, from: { kind: "fieldd", flow: { run, call: 1, line: "repair", n: 2 } } },
      ],
      held: undefined,
      logged: { warn: 1, error: 0 },
    });
    // the agent answers the line sent again, and the run goes on to its end
    turn(fenced('{"verdict":"clean"}'));
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
  });

  it("R22i (Q8's repair rider, F-a's second half, F5; ruled 2026-11-06, from green v2's skeptic; slice 11a): a step held on you on a repair whose hold its run's record refused keeps its agent's words waiting for their act, as a step the record says holds: a turn that ends before Ask once more is never its answer, and Ask once more then sends the repair line again", async () => {
    // the turn ends go through the step listener itself (R22g's precedent), so what the runs' listener throws is caught
    // there, never thrown into the row
    const events = new FlowStepEvents();
    const h = await harness({ stepEvents: events });
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const step = fakeAgent();
    events.entered({
      agent: step.agent,
      runtimeRunId: "rt-step1",
      begun: "spawn",
      origin: { by: "flow", run, call: 1 },
    });
    /** the step's next turn, its answer `text` */
    const turn = (text: string) => {
      step.emit("turn:started", {});
      step.emit("turn:completed", { lastAssistantMessage: text });
    };
    turn("no json here");
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    // T4's arm at the raise: the run's record write just after the needs port raised the repair's item throws once, as
    // a full disk at that moment refuses it
    const { needs } = h.runs.ports;
    const raise = needs.flowItem.bind(needs);
    const write = h.records.writeRunRecord.bind(h.records);
    let armed = false;
    let refused = false;
    vi.spyOn(needs, "flowItem").mockImplementation((item) => {
      const raised = raise(item);
      armed = true;
      return raised;
    });
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      if (!armed) return write(at, fields);
      armed = false;
      refused = true;
      throw new Error("ENOSPC: no space left on device, write");
    });
    turn("still none");
    await waitFor(() => expect(h.items).toHaveLength(1));
    // its item raised and its hold's write refused, the record still says the step repairs (its `holding` rode that
    // write): green v1's Ask once more, reading `step.state !== "holding"`, acted on nothing, the agent left waiting
    const before = h.records.runRecord(run);
    expect({ refused, step: before?.open[0]?.state, held: before?.held }).toEqual({
      refused: true,
      step: "repairing",
      held: undefined,
    });
    // the step's agent ends a turn before you act: held on you, its words wait for their act, never the step's answer
    turn(fenced('{"verdict":"clean"}'));
    const acted = await askOnceMore(h, run);
    const repair = repairLine("the answer holds no JSON the form can read");
    expect({
      acted,
      answered: answersOf(h, run).length,
      sent: h.enqueued.slice(2).map(({ text, from }) => ({ text, from })),
    }).toEqual({
      acted: { outcome: "done" },
      answered: 0,
      sent: [
        { text: repair, from: { kind: "fieldd", flow: { run, call: 1, line: "repair", n: 2 } } },
      ],
    });
    // the agent answers the line sent again, and the run goes on to its end
    turn(fenced('{"verdict":"clean"}'));
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
  });

  // slice 11a's red-b (Q6–Q8, Q13; the slice 11 rulings, ruled 2026-11-06; §9's Proposed words, bafdcd544): an ask
  // is held at its call to the gate's one rule, the read's rules and the needs queue's two (Q6). One the rule refuses,
  // or whose item the needs queue can't raise (Q8), is answered refused through the one writer, in §9's "An ask
  // refused": the script's `await` throws the words, the run's journal keeps them and the call counts, as a step's
  // refused call does, and the runs' starter never throws for an ask. At this red the starter still throws
  // (NO_ASK_YET), so the script hears the supervisor's "VibeField could not answer this call." and nothing is
  // journaled: every row reads red on its values.

  /** The gate's rule's words, as §9 says them ("What a flow's read refuses", PROPOSED): the read's, which the run's
   * refusal frames (Q7) */
  const GATE_RULE = {
    question: "an ask's question is not words",
    none: "an ask offers no choice",
    notAList: "an ask's choices are not a list",
    many: (n: number) => `an ask offers ${n} choices; a gate takes at most 4`,
    notOneLine: "an ask's choice is not one line of words",
    long: "an ask's choice is longer than 40 characters",
    stop: "an ask offers Stop the run, which is VibeField's own",
    twice: "an ask offers the same choice twice",
  };
  /** R34's asks, each as its script calls ask() and with the words the rule refuses it in: Q6's rows and the rule's
   * others, in its order (Q6 §2), then three that break two of its rules and take the first's words. Each, written
   * plainly, is refused by the read in the same words: one rule, one refusal per gate, in the rule's order */
  const REFUSED_ASKS: readonly { readonly args: readonly unknown[]; readonly read: string }[] = [
    { args: ["", ["a"]], read: GATE_RULE.question },
    { args: [42, ["a"]], read: GATE_RULE.question },
    { args: ["Go?"], read: GATE_RULE.none },
    { args: ["Go?", "Yes"], read: GATE_RULE.notAList },
    { args: ["Go?", []], read: GATE_RULE.none },
    { args: ["Go?", ["a", "b", "c", "d", "e"]], read: GATE_RULE.many(5) },
    { args: ["Go?", ["a\nb"]], read: GATE_RULE.notOneLine },
    { args: ["Go?", ["a", 7]], read: GATE_RULE.notOneLine },
    { args: ["Go?", ["c".repeat(41)]], read: GATE_RULE.long },
    { args: ["Go?", ["Ship", "stop the run"]], read: GATE_RULE.stop },
    { args: ["Go?", ["Yes", "yes"]], read: GATE_RULE.twice },
    { args: ["Go?", ["Yes", "Yes "]], read: GATE_RULE.twice },
    { args: ["", "Yes"], read: GATE_RULE.question },
    { args: ["Go?", ["c".repeat(41), " "]], read: GATE_RULE.notOneLine },
    { args: ["Go?", ["Yes", "yes", "Stop the run"]], read: GATE_RULE.stop },
  ];
  /** A flow that asks with each of `asks` in turn, its arguments made as it runs (a spread the read can't see into),
   * saying what each `await` heard */
  const asksEach = (asks: readonly (readonly unknown[])[]): string =>
    [
      'export const meta = { name: "Asks" };',
      "export default async function () {",
      `  for (const args of ${JSON.stringify(asks)}) {`,
      '    try { log("asked: " + (await ask(...args))); } catch (e) { log(e.message); }',
      "  }",
      "}",
      "",
    ].join("\n");
  /** What the read refuses, in its words, of the ask `args` makes written plainly: its plain twin */
  const plainRefusals = (args: readonly unknown[]): string[] => {
    const plain = [
      'export const meta = { name: "Asks" };',
      "export default async function () {",
      `  await ask(${args.map((arg) => JSON.stringify(arg)).join(", ")});`,
      "}",
      "",
    ].join("\n");
    return readFlow(plain).refusals.map((refusal) => refusal.words);
  };
  /** What the run's script said, in order: its journal's log lines */
  const logsOf = (h: Harness, run: string): string[] => {
    const read = h.records.readRun(run);
    return read.kind === "kept"
      ? read.lines.flatMap((line) => (line.kind === "log" ? [line.text] : []))
      : [];
  };
  /** How often fieldd's log said a call's handler threw, for which the supervisor answers "VibeField could not answer
   * this call.": the runs' starter never throws for an ask (Q8) */
  const handlerThrew = (h: Harness): number =>
    h.warned.filter(({ event }) => event === "fieldd.flows.host.handler").length;
  /** fieldd's log of a raise that threw (Q8's `fieldd.flows.gate.raise`), counted at each level */
  const gateRaiseLogged = (h: Harness) => ({
    warn: h.warned.filter(({ event }) => event === "fieldd.flows.gate.raise").length,
    error: h.errored.filter(({ event }) => event === "fieldd.flows.gate.raise").length,
  });
  /** A gate at the rule's bounds, 4 choices of 40 characters each, made as it runs so the read can't see them; what
   * it heard said */
  const AT_BOUNDS = [
    'export const meta = { name: "Bounds" };',
    "export default async function () {",
    '  const forty = ["a", "b", "c", "d"].map((x) => x.repeat(40));',
    '  try { log(await ask("Which one?", forty)); } catch (e) { log(e.message); }',
    "}",
    "",
  ].join("\n");
  /** A gate (call 1) whose refusal its script catches and says, then a step A (call 2): once A answers, the run's last
   * log line says what the ask heard beside A's text, in whichever life it ends */
  const UNKEPT = [
    'export const meta = { name: "Unkept" };',
    "export default async function () {",
    '  let heard = "";',
    `  try { heard = "asked: " + (await ask(${SHIP})); } catch (e) { heard = e.message; }`,
    "  log(heard);",
    `  const a = await agent("look at a", ${stepAt("A")});`,
    '  log(heard + " / " + a.text);',
    "}",
    "",
  ].join("\n");

  it("R34 (Q6, Q7, D22; slice 11a): an ask the gate's rule refuses at its call, its values unseen by the read, is refused in the read's own words in §9's frame: its `await` throws them, the journal keeps them as its answer and the call counts, no item is raised and the runs' starter never throws; the same ask written plainly is refused by the read in the same words; a gate at the rule's bounds is raised", async () => {
    const h = await harness();
    h.approved("asks", asksEach(REFUSED_ASKS.map(({ args }) => args)));
    const run = startedRun(await h.start({ flow: "asks" })).run;
    // the run ends once every ask is refused; a gate raised instead holds it, and the wait stops there
    await within(WAIT_MS, () => over(h, run) || h.items.length > 0);
    const refused = REFUSED_ASKS.map(({ read }) => words.askRefused(read));
    expect({
      state: stateOf(h, run),
      heard: logsOf(h, run),
      journaled: refusalsOf(h, run),
      calls: h.records.runRecord(run)?.calls,
      raises: h.items.length,
      threw: handlerThrew(h),
      plain: REFUSED_ASKS.map(({ args }) => plainRefusals(args)),
    }).toEqual({
      state: "done",
      heard: refused,
      journaled: refused,
      calls: REFUSED_ASKS.length,
      raises: 0,
      threw: 0,
      plain: REFUSED_ASKS.map(({ read }) => [read]),
    });
    // the rule's bounds refuse nothing: the gate's item is raised with its question and its choices as written (Q1)
    const b = await harness();
    b.approved("bounds", AT_BOUNDS);
    const bounds = startedRun(await b.start({ flow: "bounds" })).run;
    await within(PARK_MS, () => b.items.length > 0 || over(b, bounds));
    const forty = ["a", "b", "c", "d"].map((x) => x.repeat(40));
    const raised = b.items.map((item) => [item.kind, item.run.call, item.words, item.acts]);
    expect({ raised, journaled: refusalsOf(b, bounds) }).toEqual({
      raised: [["flow-gate", 1, "Which one?", forty]],
      journaled: [],
    });
  });

  it("R34b (Q8, D22; slice 11a): an ask whose item the needs queue can't raise, its store refusing the item or the item refused as bad input, is refused in §9's words: its `await` throws them, the journal keeps them as its answer and the call counts, nothing holds the run and its spark is told nothing; woken, the ask made again hears the same from the journal, never raised again", async () => {
    /** Vela's run of UNKEPT, the needs port throwing `error` at every raise: read once parked, and once A's answer has
     * woken it to its end */
    const unkeptBy = async (error: Error) => {
      const h = await harness({ hostIdleMs: IDLE_MS, flowItemThrows: error });
      h.approved("unkept", UNKEPT);
      const run = startedRun(await h.start({ flow: "unkept", ...VELAS })).run;
      const parked = await parkedAt(h, run);
      const record = h.records.runRecord(run);
      const atPark = {
        parked,
        held: record?.held,
        calls: record?.calls,
        heard: logsOf(h, run),
        journaled: refusalsOf(h, run),
        told: toldOf(h),
      };
      answerStep(h, run, 2, "a");
      await within(PARK_MS, () => over(h, run));
      return {
        ...atPark,
        raises: h.items.length,
        state: stateOf(h, run),
        log: h.runs.read(run)?.summary.log,
        hosts: h.hosts.length,
        threw: handlerThrew(h),
        logged: gateRaiseLogged(h),
      };
    };
    const said = words.askUnkept();
    const unkept = {
      parked: PARKED,
      held: undefined,
      calls: 2,
      heard: [said],
      journaled: [said],
      told: [],
      raises: 1,
      state: "done",
      log: `${said} / a`,
      hosts: 2,
      threw: 0,
    };
    // the needs store's refusal (item 172's UNAVAILABLE), logged at warn; and a raise refused as bad input, as the
    // needs queue refuses acts the gate's rule refuses first (Q6 §2), an invariant broken, logged at error (Q8)
    const store = recordsUnreadable(RECORD_STORES.SERVICE_NEEDS, UNREADABLE_WORDS.needs, false);
    const badInput = new RpcCallError(
      "PRECONDITION_FAILED",
      "acts: each is 1 to 40 characters",
      false,
      { fact: "bad-input" },
    );
    expect({ store: await unkeptBy(store), badInput: await unkeptBy(badInput) }).toEqual({
      store: { ...unkept, logged: { warn: 1, error: 0 } },
      badInput: { ...unkept, logged: { warn: 0, error: 1 } },
    });
  });

  it("R34b (Q8's second leg, VV1, T4; slice 11a): a gate whose hold its run's record can't keep after its raise is the record lagging, never the ask refused: its item stays open and its call waits, nothing journaled, and the run's next write rests it holding on that item", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
    const needs = needsOf(h);
    h.approved("gate", GATE);
    // T4's arm at the raise: the run's record write just after the needs queue raised its item throws once, as a full
    // disk at that moment refuses it
    const raise = needs.flowItem.bind(needs);
    const write = h.records.writeRunRecord.bind(h.records);
    let armed = false;
    vi.spyOn(needs, "flowItem").mockImplementation((item) => {
      const raised = raise(item);
      armed = true;
      return raised;
    });
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      if (!armed) return write(at, fields);
      armed = false;
      throw new Error("ENOSPC: no space left on device, write");
    });
    const run = startedRun(await h.start({ flow: "gate" })).run;
    // parked by D1's idle, whose rest is the run's next record write
    await within(PARK_MS, () => left(h, 0) || over(h, run));
    const id = h.raisedAs[0]?.id ?? "";
    expect({
      ...heldOf(h, run),
      left: left(h, 0),
      open: openOf(h),
      kinds: h.kinds(run),
      raised: h.raisedAs.map(({ minted }) => minted),
    }).toEqual({
      state: "holding",
      held: { item: id, kind: "flow-gate" },
      left: true,
      open: [id],
      kinds: ["head", "call"],
      raised: [true],
    });
  });

  it("R34c (Q8, Q5; ruled 2026-11-06, MED-1, its fix (a); slice 11a): a gate open across a wake, its run's record unreadable once as the woken ask is made again, keeps waiting on its open item: never answered unkept, the run rests holding on it, and the person's later answer reaches the script", async () => {
    // the woken host's ask, made again (the second ask any host makes), finds its run's record unreadable once in that
    // call's own turn, as a disk refuses a read (the store's own refusal): a raise reads nothing before the needs queue
    // (the run's flow, name and starter are its LiveRun's, kept at its begin), so a read that throws past the raise is
    // the record lagging, never the ask unkept, and its item, open in what waits on you, holds the run still
    const make = FlowReplay.prototype.call;
    let asks = 0;
    let armed = false;
    let threw = false;
    const made = vi.spyOn(FlowReplay.prototype, "call");
    made.mockImplementation(function (this: unknown, asked) {
      if (asked.what !== "ask") return make.call(this as FlowReplay, asked);
      asks += 1;
      armed = asks === 2;
      try {
        return make.call(this as FlowReplay, asked);
      } finally {
        armed = false;
      }
    });
    try {
      const h = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
      const needs = needsOf(h);
      const read = h.records.runRecord.bind(h.records);
      vi.spyOn(h.records, "runRecord").mockImplementation((at) => {
        if (!armed) return read(at);
        armed = false;
        threw = true;
        throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
      });
      h.approved("gate", GATE_AND_STEP);
      const run = startedRun(await h.start({ flow: "gate" })).run;
      const parked = () => h.items.length > 0 && h.enqueued.length > 0 && left(h, 0);
      await within(PARK_MS, () => parked() || over(h, run));
      // the step's answer wakes the run, and its gate, made again as the read throws, is re-bound to its item
      answerStep(h, run, 2, "a");
      await within(PARK_MS, () => (h.items.length > 1 && left(h, 1)) || over(h, run));
      const gate = h.raisedAs[0]?.id ?? "";
      expect({
        threw,
        ...heldOf(h, run),
        refused: refusalsOf(h, run),
        raised: h.raisedAs.map(({ id, minted }) => [id, minted]),
        open: openOf(h),
      }).toEqual({
        threw: true,
        state: "holding",
        held: { item: gate, kind: "flow-gate" },
        refused: [],
        raised: [
          [gate, true],
          [gate, false],
        ],
        open: [gate],
      });
      // the person's answer reaches the script: it wakes the run, whose ask resolves to the act, and the run ends done
      await needs.answer(gate, 0, PRINCIPAL);
      await within(PARK_MS, () => over(h, run));
      expect({
        state: stateOf(h, run),
        log: h.runs.read(run)?.summary.log,
        answers: answersOf(h, run).map(({ call, value }) => [call, value]),
        open: openOf(h),
      }).toEqual({
        state: "done",
        log: "Ship a",
        answers: [
          [2, { text: "a" }],
          [1, "Ship"],
        ],
        open: [],
      });
    } finally {
      made.mockRestore();
    }
  });

  // §9's literal pins (ruled 2026-11-06), as the step refusals' are: a seed that drifts from §9 reads red here
  it("says an ask's refusals and a spark's facts in DESIGN.md's own words (§9's An ask refused, and What VibeField tells a spark)", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    // the two frames, each said whole as §9 quotes it
    for (const said of [words.askRefused("‹the read's words›"), words.askUnkept()]) {
      expect(said).not.toBe("");
      expect(design, said).toContain(`"${said}"`);
    }
    // each fact, said of §9's Vela, ‹flow› and ‹run›, is §9's quoted sentence past its "VibeField: ", which the input
    // queue's mark adds (markedText), and with no closing stop: a fact that says "VibeField: " itself, or ends in a
    // stop, reads red
    for (const fact of [words.factAsking, words.factDone, words.factFailed, words.factSetAside]) {
      const said = fact("Vela", "‹flow›", "‹run›");
      expect(design, said).toContain(`"VibeField: ${said}"`);
    }
  });

  // slice 11b (Q5, Q9 (a); the rulings for red-a's revision, 2026-11-06): the wake counts. A spark's own run tells
  // it once for each hold the needs queue MINTED: a gate made again at a wake is re-bound (D2) and tells nothing more.
  // Vela's runs, on the real queue; each row reads the facts the runs told, whole (`factsOf`: whom and what, red-b),
  // and how often, once parked and once parked again, so a park or a wake that told shows in its reads too. At this
  // red an ask is still refused and nothing tells: each row reads red on its counts and its facts.

  it("R35 (Q5, Q9 (a): the wake counts on R13d's road; slice 11b): a gate a spark's run holds across a wake tells that spark once, at its mint, and nothing more at its re-bind; two gates beside a step tell it twice in all", async () => {
    /** Vela's run of `text` on the real queue, its `gates` held beside step `call` and parked; then that step's answer
     * wakes it, and its gates, made again, are re-bound. The run, its raises, and the facts it told by the park and
     * after the wake */
    const acrossWake = async (flow: string, text: string, gates: number, call: number) => {
      const h = await harness({ hostIdleMs: IDLE_MS, needsQueue: true });
      h.approved(flow, text);
      const run = startedRun(await h.start({ flow, ...VELAS })).run;
      const parked = () => h.items.length >= gates && h.enqueued.length > 0 && left(h, 0);
      // parked, its holds' tells read once told
      await within(PARK_MS, () => (parked() && h.facts.length >= gates) || over(h, run));
      const held = factsOf(h);
      answerStep(h, run, call, "ok");
      await within(PARK_MS, () => (h.items.length >= 2 * gates && left(h, 1)) || over(h, run));
      return { run, read: { raises: h.items.length, held, woken: factsOf(h, held.length) } };
    };
    const one = await acrossWake("gate", GATE_AND_STEP, 1, 2);
    const two = await acrossWake("gates", TWO_GATES_AND_STEP, 2, 3);
    // what each run tells Vela of a gate it holds: once for GATE_AND_STEP's, and once for each of TWO_GATES_AND_STEP's
    const ofOne = toVela(words.factAsking, "Gate and step", "gate", one.run);
    const ofTwo = toVela(words.factAsking, "Gates and step", "gates", two.run);
    expect({ one: one.read, two: two.read }).toEqual({
      one: { raises: 2, held: [ofOne], woken: [] },
      two: { raises: 4, held: [ofTwo, ofTwo], woken: [] },
    });
  });

  it("R35 (Q5 §5, Q9 (a): the wake counts on R13e-ask's roads; slice 11b): an ask journaled with no item tells the spark whose run it is once, at the wake that mints its item; one whose item the needs queue kept is re-bound there, and tells nothing", async () => {
    /** Vela's run of SEQ_ASK killed between its ask's call line and its item (R13e-ask's road), the item `kept` by the
     * needs queue before the kill or not. The run, its raises, and the facts it told once woken and parked again */
    const woken = async (kept: boolean) => {
      const h = await harness({
        hostIdleMs: IDLE_MS,
        timings: { stopGraceMs: KILL_GRACE_MS },
        needsQueue: true,
      });
      h.approved("seq-ask", SEQ_ASK);
      const run = startedRun(await h.start({ flow: "seq-ask", ...VELAS })).run;
      await waitFor(() => expect(h.enqueued).toHaveLength(1));
      if (kept)
        needsOf(h).flowItem({
          kind: "flow-gate",
          run: { run, flow: "seq-ask", call: 2 },
          name: "Seq ask",
          spark: VELA,
          words: "Ship it?",
          acts: ["Ship", "Hold"],
        });
      await killedBeforeEntry(h, run, seqAsk(), () => h.items.length > 0 || over(h, run));
      // parked again: a mint's tell read once told, and a re-bind's, were there one, told by then
      await within(PARK_MS, () => (left(h, 1) && (kept || h.facts.length > 0)) || over(h, run));
      return { run, read: { raises: h.items.length, told: factsOf(h) } };
    };
    const fresh = await woken(false);
    const rebound = await woken(true);
    expect({ minted: fresh.read, kept: rebound.read }).toEqual({
      minted: { raises: 1, told: [toVela(words.factAsking, "Seq ask", "seq-ask", fresh.run)] },
      kept: { raises: 1, told: [] },
    });
  });

  // slice 12, the cap out (the C ruling, 2026-11-07; the orders over the adopted draft, with the
  // rulings): there is no call cap, so no row here holds a run at a count. What slice 12 keeps that was never the
  // cap's: the record's `calls` is the journal's count, even past a record write the disk refused (ZZ3, C2 (b)), and
  // two pins no row held before, an answer heard in the journal's order across a slot's start that throws (R28d) and
  // a 300-wide fan-out that ends `flood` with its record whole (R39b). Before slice 12's green, runs.ts counted `calls`
  // as the record's count plus one at each call line's write: ZZ3 read red on its count, and the two pins read green.

  const SLOTS = FLOW_LIMITS.LIVE_STEPS_MAX;
  /** A step's options in a script's loop, labelled by its `i`. */
  const PART = '{ agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app" }';
  /** `n` steps at once: each answer it hears, a refusal among them (F20), says the calls heard so far as a log line. */
  const heardInOrder = (n: number): string =>
    [
      'export const meta = { name: "Heard" };',
      "export default async function () {",
      "  const heard = [];",
      "  const said = (i) => () => {",
      "    heard.push(i);",
      '    log(heard.join(" "));',
      "  };",
      "  const steps = [];",
      `  for (let i = 1; i <= ${n}; i += 1)`,
      `    steps.push(agent("look at part " + i, ${PART}).then(said(i), said(i)));`,
      "  await Promise.all(steps);",
      "}",
      "",
    ].join("\n");
  /** `n` steps at once, each label and phase at FLOW_LABEL_MAX (F15: what bounds an open step's size). */
  const wideFan = (n: number): string =>
    [
      'export const meta = { name: "Wide" };',
      "export default async function () {",
      `  const label = "L".repeat(${FLOW_LABEL_MAX - 3});`,
      `  const phase = "P".repeat(${FLOW_LABEL_MAX});`,
      "  const steps = [];",
      `  for (let i = 1; i <= ${n}; i += 1)`,
      '    steps.push(agent("look at part " + i, { agent: "claude", label: label + String(1000 + i).slice(1), phase, profile: "work", cwd: "/work/app" }));',
      "  return await Promise.all(steps);",
      "}",
      "",
    ].join("\n");
  /** The calls the run's journal holds, in order. */
  const callsOf = (h: Harness, run: string): number[] => {
    const read = h.records.readRun(run);
    return read.kind === "kept"
      ? read.lines.flatMap((line) => (line.kind === "call" ? [line.call] : []))
      : [];
  };
  /** Each distinct width in `open`, as "‹label› ‹phase›" (F15). */
  const widthsOf = (open: readonly FlowRunRecordStep[] = []): string[] => [
    ...new Set(open.map(({ label, phase }) => `${label?.length} ${phase?.length}`)),
  ];

  it("ZZ3 (C2 (b), Q3 (a); slice 12): a call whose own record write the disk refused is counted at the next call's write, as the journal counts it: `calls` is the journal's count, never one short of it", async () => {
    const h = await harness();
    h.approved("fan", fanOut(2));
    // call 1's record write throws once, just after its line lands (T4's arm, of call 1 alone); call 2's write follows.
    // The stated window: a run's LAST call whose write is refused stays one short until the next wake, or for good on
    // an ended run
    lagsOnce(h, "call", 1);
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    expect({ calls: h.records.runRecord(run)?.calls, journaled: callsOf(h, run) }).toEqual({
      calls: 2,
      journaled: [1, 2],
    });
  });

  it("R28d (D21; #3 of the 10b fix's delta review, Q12; slice 12; a pin, green here): an answer journaled inside another's own record follow-up, a slot's start that throws, is heard after it, in the journal's order", async () => {
    const h = await harness();
    h.approved("heard", heardInOrder(SLOTS + 1));
    const run = startedRun(await h.start({ flow: "heard" })).run;
    await within(PARK_MS, () => h.enqueued.length === SLOTS);
    // profiles() alone (F20): the records read that heads #launch comes after #unslot's own, whose throw would land in
    // the lag log and never start step 9, and #startStep's read is the first thing past it that throws synchronously
    vi.spyOn(h.runs.ports, "profiles").mockImplementationOnce(() => {
      throw new Error("the Agent Profiles can't be read");
    });
    answerStep(h, run, 1, "one");
    await within(PARK_MS, () => logsOf(h, run).length >= 2);
    // the pin's mutation: swap the hand-on and #lagging in #answer, and the script hears 9 first
    expect({
      journal: answersOf(h, run).map(({ call }) => call),
      heard: logsOf(h, run),
    }).toEqual({
      journal: [1, SLOTS + 1],
      heard: ["1", `1 ${SLOTS + 1}`],
    });
  });

  it("R39b (§13a.0b, [BR] MED, Q14, F4, F15; slice 12; a pin, green here): a run with 256 steps open makes a 257th call: its host ends flood, its record held all 256 in `open`, none lost, each at its full label and phase, and it reads back whole with no `held`", async () => {
    const most = FLOW_LIMITS.HOST_CALLS_WAITING_MAX;
    const h = await harness();
    // `open` as it reads back at the write that takes it to 256: #finish keeps `open`, ZZ2's phantom, slice 13's. Set
    // before the start, so its first life's writes are all read. The pin's mutation: FlowRunRecord's `open` bound
    // (HOST_CALLS_WAITING_MAX) lowered by one, so the write at 256 throws and `full` reads empty. It reds in about the
    // green's time, not WAIT_MS (measured 2026-11-07: 2,244 ms, the green 2,191 ms): the run still ends `flood`, and
    // the record's `calls` stays 255, ZZ3's window on an ended run
    // *Corrected 2026-11-07 (slice 13's green; N7, K11): "#finish keeps `open`, ZZ2's phantom, slice 13's" no longer
    // holds. Every end now moves its open steps to `ended` in its own write (Q7), so `lost` below reads an empty `open`
    // and pins nothing; `full` keeps this row's pin, and R42's flood class asserts the open steps read `ended`.*
    const write = h.records.writeRunRecord.bind(h.records);
    const full: { open: number; lost: number; widths: string[] }[] = [];
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      write(at, fields);
      if (fields.open.length !== most || full.length > 0) return;
      const open = h.records.runRecord(at)?.open ?? [];
      const lost = open.filter((step) => step.state === "lost").length;
      full.push({ open: open.length, lost, widths: widthsOf(open) });
    });
    h.approved("wide", wideFan(300));
    const run = startedRun(await h.start({ flow: "wide" })).run;
    await within(WAIT_MS, () => over(h, run));
    const ended = h.records.runRecord(run);
    expect({
      full,
      state: ended?.state,
      host: ended?.host,
      calls: ended?.calls,
      journaled: callsOf(h, run).length,
      lost: ended?.open.filter((step) => step.state === "lost").length,
      held: ended?.held,
      hosts: h.hosts.length,
    }).toEqual({
      full: [{ open: most, lost: 0, widths: [`${FLOW_LABEL_MAX} ${FLOW_LABEL_MAX}`] }],
      state: "failed",
      host: "flood",
      calls: most,
      journaled: most,
      lost: 0,
      held: undefined,
      hosts: 1,
    });
  });

  // slice 13 (D4, D19; Q1–Q3, Q11 (a′)): a person's Stop, in D4's order: the record's `stopping` first; the run's lines
  // withdrawn, its items ended, and a handed session's turn the run's own line began paused (`agents.pause`, never
  // `interrupt`); then each agent its steps started ended; then the `end` line with `ended`; then the record's
  // `stopped`. The person's own working turn is never paused

  /** Three steps the run starts, and two it hands: `run-began`, whose turn its line began, and `run-yours`. */
  const STOPS = [
    'export const meta = { name: "Stops" };',
    "export default async function () {",
    "  await Promise.all([",
    `    agent("look at a", ${stepAt("A")}),`,
    `    agent("look at b", ${stepAt("B")}),`,
    `    agent("look at c", ${stepAt("C")}),`,
    '    agent("Review this", { in: "run-began", label: "Began" }),',
    '    agent("Review that", { in: "run-yours", label: "Yours" }),',
    "  ]);",
    "}",
    "",
  ].join("\n");

  it("R40 (slice 13, D4, D19; Q1 (a), Q3, Q11 (a′)): Stop answers once the run has ended stopped, in D4's order: stopping, then its lines withdrawn, its items ended and the turn its line began paused, then its three agents ended, then `end {stopped, ended: 3}`, then the record's stopped", async () => {
    // red-a: the stub answers the run running at once, and nothing is told, withdrawn, paused or ended
    const h = await harness({
      sessions: { "run-began": HANDED_YOURS, "run-yours": HANDED_YOURS },
      beganIn: ["run-began"],
    });
    h.approved("stops", STOPS);
    const run = startedRun(await h.start({ flow: "stops" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(5));
    // one ordered log: the ports' asks (the harness's), the record's states as told, and the `end` line
    let last: string | undefined;
    h.runs.onChange((list) => {
      const state = list.runs.find((summary) => summary.run === run)?.state;
      if (state === undefined || state === last) return;
      last = state;
      h.order.push(`record:${state}`);
    });
    const append = h.records.appendRun.bind(h.records);
    vi.spyOn(h.records, "appendRun").mockImplementation((at, entry) => {
      const kept = append(at, entry);
      if (entry.kind === "end") h.order.push("end-line");
      return kept;
    });
    const stopped = (await h.runs.stop(run)).run;
    /** each entry's step in D4's order; a step asked again in a row is one (the ends' sync part withdraws again) */
    const phase = (entry: string): string =>
      entry === "record:stopping"
        ? "stopping"
        : /^(withdraw|items|pause):/.test(entry)
          ? "lines, items, the pause"
          : entry.startsWith("end:")
            ? "ends"
            : entry === "end-line"
              ? "end line"
              : entry === "record:stopped"
                ? "stopped"
                : "";
    const phases = h.order.map(phase).filter((at) => at !== "");
    expect({
      phases: phases.filter((at, i) => at !== phases[i - 1]),
      state: stopped.state,
      ended: stopped.ended,
      lines: endLinesOf(h, run),
      ends: [...h.ends].sort(),
      paused: h.paused,
      withdrawn: h.withdrawn.includes(run),
      items: h.itemsEnded.includes(run),
    }).toEqual({
      phases: ["stopping", "lines, items, the pause", "ends", "end line", "stopped"],
      state: "stopped",
      ended: 3,
      lines: [{ state: "stopped", ended: 3 }],
      ends: ["rt-step1", "rt-step2", "rt-step3"],
      paused: ["run-began"],
      withdrawn: true,
      items: true,
    });
  });

  it("R40's own-turn leg (a pin, green at red-a; slice 13, D19, Q11 (a′)): a Stop never pauses the person's own working turn in a session the run was handed, which no line of the run began", async () => {
    // the pin's mutation: Stop pauses every handed step reading `working`, `began` unread, and your turn is paused
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.records.runRecord(run)?.open.map((step) => [step.session, step.state])).toEqual([
      ["run-yours", "working"],
    ]);
    await h.runs.stop(run);
    expect(h.paused).toEqual([]);
  });

  // CP-4a2b (J1; board `co-journal-byte-bound` (a), 2026-11-07: "byte bound → flood", nobody asked
  // anything; ruled 2026-11-07, seam B): a run whose journal's next line would pass its bound ends through slice 13's
  // `live.ending`, `failed` with `host: "flood"`, its record's `log` §9's sentence (F2), said by the runs as
  // `fieldd.flows.run.full`, never the supervisor's `fieldd.flows.host.flood` (Q14). The first ending set stands
  // (F8, as narrowed 2026-11-08): a Stop in J1's leave takes no end of its own, and answers the flood (`stop()`'s read).
  // J1's red: the harness lowers the store's `journalMaxBytes`, which the red reads nowhere, so no line is refused and
  // each row below reds on a value, never a timeout; JB6 is green there

  /** JB3's flow: 100 log lines in a bounded loop, then done; under HOST_LOG_LINES_MAX, so the supervisor never floods
   * it (Q14). */
  const LOGS = [
    'export const meta = { name: "Logs" };',
    "export default async function () {",
    '  for (let i = 1; i <= 100; i += 1) log("line " + i);',
    '  return "done";',
    "}",
    "",
  ].join("\n");
  /** JB4's flow: a silent loop of 200 steps, each refusal caught, then done; bounded, so a mutant reds on a value. */
  const LOOPS = [
    'export const meta = { name: "Loops" };',
    "export default async function () {",
    "  for (let i = 1; i <= 200; i += 1) {",
    `    try { await agent("look again", ${stepAt("Loop")}); } catch (e) {}`,
    "  }",
    '  return "done";',
    "}",
    "",
  ].join("\n");
  /** The bytes `run`'s journal holds before its `end` line: its file's lines, but the `end` it ends with. */
  const bytesBeforeEnd = (h: Harness, run: string): number =>
    readFileSync(join(h.root, "fieldd", "flows", RUNS_DIR, `${run}${JOURNAL_SUFFIX}`), "utf8")
      .split("\n")
      .filter((line) => line !== "" && (JSON.parse(line) as { kind?: unknown }).kind !== "end")
      .reduce((bytes, line) => bytes + Buffer.byteLength(line, "utf8") + 1, 0);
  /** The red skeptic's #2 (orders §H) — `run`'s journal's first `count` lines as its file holds them: their bytes, and
   * the kind of the line after them, for JB4's twin calibration. */
  const linesThrough = (h: Harness, run: string, count: number) => {
    const file = join(h.root, "fieldd", "flows", RUNS_DIR, `${run}${JOURNAL_SUFFIX}`);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const kept = lines.slice(0, count);
    return {
      bytes: kept.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0),
      next: (JSON.parse(lines[count] ?? "{}") as { kind?: unknown }).kind,
    };
  };
  /** JB4's twin calibration: the turns its bounded run keeps, each a call line and its refused answer. */
  const LOOP_TURNS = 15;
  /** Q14 — how often fieldd's log said `run`'s journal was full (the runs' `fieldd.flows.run.full`), and how often the
   * supervisor said a host flooded (`fieldd.flows.host.flood`): J1's flood is the runs', never the host's. */
  const floodsSaid = (h: Harness, run: string) => {
    const full = ({ event, fields }: (typeof h.warned)[number]) =>
      event === "fieldd.flows.run.full" && fields?.["run"] === run;
    return {
      full: h.warned.filter(full).length,
      host: h.warned.filter(({ event }) => event === "fieldd.flows.host.flood").length,
    };
  };
  /** A step's turn end that misses its form, in the session its record names. */
  const missOf = (h: Harness, run: string, call: number, turn: string, text: string) =>
    h.endTurn({
      run,
      call,
      runtimeRunId: sessionOf(h, run, call),
      turn,
      outcome: "completed",
      text,
    });
  /** The person's Ask once more on HELD_TWO's step A, held on its repair (its first item). */
  const askHeldOnceMore = (h: Harness, run: string) =>
    h.runs.acts.answer({
      id: h.raisedAs[0]?.id ?? ("ny-item1aaaaaa" as NeedsItemId),
      kind: "flow-repair",
      run: { run, flow: "held", call: 1, label: "A" },
      choice: 0,
      stop: false,
      act: NEEDS_CHOICE_WORDS.askOnceMore,
    });

  it("JB3 (J1; F2, Q14): the log road: a run whose log lines reach its journal's bound ends `flood`, its record's `log` §9's sentence, said once by the runs and never by the host; its journal holds at most the bound before its one `end` line", async () => {
    // red: no bound is read, so the script logs its 100 lines and returns: `done`, no `host`, its latest line its
    // `log`. Kills: `#appended`'s catch dropped, which leaves `replay.log` to swallow the refusal (replay.ts:269–279);
    // and F2's `log` left off `#full`'s ending, so the record keeps the script's latest line
    const max = 4_096;
    const h = await harness({ journalMaxBytes: max });
    h.approved("logs", LOGS);
    const run = startedRun(await h.start({ flow: "logs" })).run;
    await within(WAIT_MS, () => endedOf(h, run));
    const record = h.records.runRecord(run);
    expect({
      state: record?.state,
      host: record?.host,
      log: record?.log,
      lines: endLinesOf(h, run),
      past: Math.max(0, bytesBeforeEnd(h, run) - max),
      hosts: h.hosts.length,
      said: floodsSaid(h, run),
    }).toEqual({
      state: "failed",
      host: "flood",
      log: words.hostEnded("Logs", "flood"),
      lines: [{ state: "failed", host: "flood" }],
      past: 0,
      hosts: 1,
      said: { full: 1, host: 0 },
    });
  });

  it("JB4 (J1; F3, Q14): the call and answer roads: a silent refused loop ends `flood`, no agent is asked for a call its journal refused, and its host's child sends no call after the refused line", async () => {
    // red: no bound is read, so the loop runs its 200 turns and returns `done`; no line is refused, so `after` reads
    // none. Kills: the catch rethrowing without ending, so the script hears JOURNAL_REFUSED, catches it and loops on;
    // and (F3) `#full` without `host.stop()` (or bypassing `#endWith`): `#chosen` unset, the supervisor answers the
    // refused call, and the child sends up to 200 − k calls more, each refused by the ending guard, for ever with an
    // unbounded loop.
    // The red skeptic's #2 (orders §H): the line that crosses is a CALL line, so the call road is pinned too. Kills:
    // a swallowing catch in `#appended` (it ends the run and returns), so replay reads the refused line as kept and
    // hands its call on, and its spawn is asked (`unasked` -1); and a store that exempts `call` as well as `end`, so
    // the call line is kept past the bound and its answer is the line refused (`kind` "answer", `past` above 0)
    // the calibration, as JB5b's: a first run of the same flow at the default bound, its journal's bytes through its
    // first LOOP_TURNS turns; 10 bytes past them, call LOOP_TURNS + 1's line (about 277 B, est.) crosses, nothing
    // before it does
    const first = await harness({ spawnRefuses: "the floor is full" });
    first.approved("loops", LOOPS);
    const calibrated = startedRun(await first.start({ flow: "loops" })).run;
    await within(WAIT_MS, () => endedOf(first, calibrated) && left(first, 0));
    const through = linesThrough(first, calibrated, 1 + 2 * LOOP_TURNS);
    const max = through.bytes + 10;
    const h = await harness({
      spawnRefuses: "the floor is full",
      journalMaxBytes: max,
      frames: true,
    });
    // the first line the store refused, and how many call frames host 0's child had sent then (its count runs first)
    const refusal: { sent?: number; kind?: string; full?: boolean } = {};
    const append = h.records.appendRun.bind(h.records);
    vi.spyOn(h.records, "appendRun").mockImplementation((at, entry) => {
      try {
        return append(at, entry);
      } catch (error) {
        if (refusal.sent === undefined) {
          refusal.sent = h.hosts[0]?.calls.length ?? 0;
          refusal.kind = entry.kind;
          refusal.full = error instanceof FlowJournalFull;
        }
        throw error;
      }
    });
    h.approved("loops", LOOPS);
    const run = startedRun(await h.start({ flow: "loops" })).run;
    await within(WAIT_MS, () => endedOf(h, run) && left(h, 0));
    const record = h.records.runRecord(run);
    const calls = h.kinds(run).filter((kind) => kind === "call").length;
    const sent = h.hosts[0]?.calls.length ?? 0;
    expect({
      next: through.next,
      twin: linesThrough(h, run, 1 + 2 * LOOP_TURNS).bytes - through.bytes,
      state: record?.state,
      host: record?.host,
      lines: endLinesOf(h, run),
      past: Math.max(0, bytesBeforeEnd(h, run) - max),
      unasked: calls - h.spawned.length,
      refused: refusal.full === true && ["call", "answer"].includes(refusal.kind ?? ""),
      // the refused line's own kind, read where the store refused it (the spy's `refusal`, orders §H #2): no field of
      // `fieldd.flows.run.full` names it (the draft's `{run, bytes, max}`), and no refused line is recorded
      kind: refusal.kind ?? "no line refused",
      after: refusal.sent === undefined ? "no line refused" : sent - refusal.sent,
      hosts: h.hosts.length,
      said: floodsSaid(h, run),
    }).toEqual({
      next: "call",
      twin: 0,
      state: "failed",
      host: "flood",
      lines: [{ state: "failed", host: "flood" }],
      past: 0,
      unasked: 0,
      refused: true,
      kind: "call",
      after: 0,
      hosts: 1,
      said: { full: 1, host: 0 },
    });
  });

  it("JB5 (J1; F6, Q4, Q15): with no host up, an answer that would cross ends the run: no host is started for it, its crossed step reads `ended`, and its agent is ended once", async () => {
    // red: no bound is read, so the 40 KiB answer is kept and wakes the run (a 2nd host), which ends `done`. Kills
    // (Q15, D320 as corrected): `#full` sets `live.ending` itself, and stops only a host that is up, so with none up
    // the run waits on for ever; `#endWith`'s own line (runs.ts:912) is shared with R40b
    const h = await harness({ hostIdleMs: IDLE_MS, journalMaxBytes: 32_768 });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // F6: the answer is delivered only once the parked host has LEFT, never at `waiting` alone: #park writes `waiting`
    // before its `host.stop()`, and a host still leaving is up, so a mutant that stops only a host would pass here too
    expect(await parkedAt(h, run)).toEqual(PARKED);
    answerStep(h, run, 1, "x".repeat(40 * 1024));
    // Q15 (D318 as corrected): the step's agent lives, so the end waits on its ending (#endAgents): any end, read
    await within(PARK_MS, () => over(h, run));
    const record = h.records.runRecord(run);
    expect({
      state: record?.state,
      host: record?.host,
      hosts: h.hosts.length,
      lines: endLinesOf(h, run),
      ended: record?.ended,
      ends: h.ends,
      steps: stepsOf(h, run),
    }).toEqual({
      state: "failed",
      host: "flood",
      hosts: 1,
      lines: [{ state: "failed", ended: 1, host: "flood" }],
      ended: 1,
      ends: ["rt-step1"],
      steps: [[1, "ended"]],
    });
  });

  it("JB5b (J1; §B, Q13): the gate's leg: your act whose answer would cross ends the run `flood`, and the act answers `failed` in §9's flood sentence, never the store's retryable refusal", async () => {
    // red: no bound is read, so your answer is kept, the act is done and the run wakes and ends `done`. Kills: a
    // `"full"` read as `"refused"` (the retryable "can't read the flows it keeps", runs.ts:2259–2260, false here: the
    // disk did answer), and any other words for it than §9's flood sentence (Q13's one helper)
    // the calibration: a first run of the same flow, at the default bound, parked on its gate; its journal's bytes
    const first = await harness({ hostIdleMs: IDLE_MS });
    first.approved("gate", GATE);
    const calibrated = startedRun(await first.start({ flow: "gate" })).run;
    await within(PARK_MS, () => left(first, 0) && stateOf(first, calibrated) === "holding");
    const parked = bytesBeforeEnd(first, calibrated);
    // 10 bytes past the parked journal: the act's answer line (about 200 B, est.) crosses it; nothing before it does
    const h = await harness({ hostIdleMs: IDLE_MS, journalMaxBytes: parked + 10 });
    h.approved("gate", GATE);
    const run = startedRun(await h.start({ flow: "gate" })).run;
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) === "holding");
    const twin = bytesBeforeEnd(h, run) - parked;
    const acted = await h.runs.acts.answer({
      id: h.raisedAs[0]?.id ?? ("ny-item1aaaaaa" as NeedsItemId),
      kind: "flow-gate",
      run: { run, flow: "gate", call: 1 },
      choice: 0,
      stop: false,
      act: " Push",
    });
    await within(PARK_MS, () => over(h, run));
    const record = h.records.runRecord(run);
    expect({
      twin,
      acted,
      state: record?.state,
      host: record?.host,
      hosts: h.hosts.length,
    }).toEqual({
      twin: 0,
      acted: { outcome: "failed", reason: words.hostEnded("Gate", "flood") },
      state: "failed",
      host: "flood",
      hosts: 1,
    });
  });

  it("JB6 (J1; F12, a pin, green at the red): a run under its bound is untouched: JB3's flow at 1 MiB ends done, its 100 lines kept, nothing said of a full journal", async () => {
    // the pin's mutation: a check that refuses under the bound (an inverted comparison, a small constant), so JB3's
    // flow ends `flood` here too. JB3–JB5 kill "the option ignored"
    const h = await harness({ journalMaxBytes: 1_048_576 });
    h.approved("logs", LOGS);
    const run = startedRun(await h.start({ flow: "logs" })).run;
    await within(WAIT_MS, () => endedOf(h, run));
    const record = h.records.runRecord(run);
    expect({
      state: record?.state,
      host: record?.host,
      log: record?.log,
      logs: h.kinds(run).filter((kind) => kind === "log").length,
      lines: endLinesOf(h, run),
      said: floodsSaid(h, run),
    }).toEqual({
      state: "done",
      host: undefined,
      log: "line 100",
      logs: 100,
      lines: [{ state: "done" }],
      said: { full: 0, host: 0 },
    });
  });

  it("Q9's J1 leg (J1; ruled 2026-11-08 (i), #10): in J1's leave, a step held on its repair is answered `failed` in §9's flood sentence by its Ask once more, and no repair line is sent into the session of a run that is leaving", async () => {
    // red: no bound is read, so B's answer is kept, no ending is set, and the Ask once more sends A's repair line
    // again and answers `done`. At the base, `#answered`'s repair road reads no ending (runs.ts:2203–2220): the fix
    // reads `live.ending` right after `live`, for both kinds (Q9's hoist)
    const max = 8_192;
    const h = await harness({ timings: { stopGraceMs: KILL_GRACE_MS }, journalMaxBytes: max });
    h.approved("held", HELD_TWO);
    const run = startedRun(await h.start({ flow: "held" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    // step A misses its form twice with its host up: held on its repair
    missOf(h, run, 1, "t1", "no json here");
    await within(PARK_MS, () => h.enqueued.length === 3);
    missOf(h, run, 1, "t2", "still none");
    await within(PARK_MS, () => h.items.length === 1);
    // the calibration: what the journal holds before B's answer, which B's answer line alone passes the bound beside
    const before = bytesBeforeEnd(h, run);
    const text = "b".repeat(16 * 1024);
    // R31's way: the host can't hear its shutdown, so its leave lasts its grace (KILL_GRACE_MS)
    h.hosts[0]?.child.kill("SIGSTOP");
    answerStep(h, run, 2, text);
    // the red skeptic's #6 (orders §H): ONE act on a step NOT held, B's, whose answer was the line that crossed (its
    // step still open at the green): it answers the ending's words too, so the read is pinned ahead of heldOnYou and
    // #repair. Kills an ending read placed after `heldOnYou`, or just before `#repair` (B is not held: `done`). Red:
    // B's answer is kept and settles its step, so `#answered` finds no open step and answers noSuchRun's words
    const unheld = await h.runs.acts.answer({
      id: "ny-unheldb0000" as NeedsItemId,
      kind: "flow-repair",
      run: { run, flow: "held", call: 2, label: "B" },
      choice: 0,
      stop: false,
      act: NEEDS_CHOICE_WORDS.askOnceMore,
    });
    const sent = h.enqueued.length;
    const acted = await askHeldOnceMore(h, run);
    expect({
      fits: before <= max,
      crosses: before + text.length > max,
      unheld,
      acted,
      repairs: h.enqueued.length - sent,
    }).toEqual({
      fits: true,
      crosses: true,
      unheld: { outcome: "failed", reason: words.hostEnded("Held", "flood") },
      acted: { outcome: "failed", reason: words.hostEnded("Held", "flood") },
      repairs: 0,
    });
  });

  it("Q9's D7 leg (J1; ruled 2026-11-08 (i), C13): in D7's leave, a step held on its repair is answered `failed` in the set-aside's own words by its Ask once more, and no second repair line is sent", async () => {
    // red: at the base, `#answered`'s repair road reads no ending, so the Ask once more in the set-aside's leave sends
    // A's repair line again into a session whose run is leaving and answers `done`. Q9's hoist changes D7 too (C13):
    // the act answers in the set-aside's words, exactly these, `words.asideUnmatched("Held")` (DESIGN.md §9)
    const said = "VibeField set Held aside: run again, its script didn't ask what it asked before.";
    const h = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: KILL_GRACE_MS } });
    h.approved("held", HELD_TWO);
    const run = startedRun(await h.start({ flow: "held" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // A misses its form twice while its run is parked (TT1's road 4): the hold set, the run at rest holding
    missOf(h, run, 1, "t1", "no json here");
    await within(PARK_MS, () => h.enqueued.length === 3);
    missOf(h, run, 1, "t2", "still none");
    await within(PARK_MS, () => h.items.length === 1);
    // asideInItsLeave's form (N1's road, P12's): a call line its script never makes, kept while it waits; B's answer
    // wakes it, its woken host is frozen once it has made its call again, and D7 sets it aside at the idle, so the
    // set-aside's leave lasts its grace
    h.records.appendRun(run, unmade(3));
    const made = vi.spyOn(FlowReplay.prototype, "call");
    try {
      answerStep(h, run, 2, "b");
      await within(PARK_MS, () => made.mock.calls.length > 0);
    } finally {
      made.mockRestore();
    }
    h.hosts[1]?.child.kill("SIGSTOP");
    await within(PARK_MS, () => toldAside(h, run) !== undefined);
    const sent = h.enqueued.length;
    const acted = await askHeldOnceMore(h, run);
    expect({ told: toldAside(h, run), acted, repairs: h.enqueued.length - sent }).toEqual({
      told: said,
      acted: { outcome: "failed", reason: said },
      repairs: 0,
    });
  });

  // CP-4a2b J1's cut fold (Q11, ruled 2026-11-08 (1); ruled 2026-11-08 (a), (b); the mutant pass's
  // Findings 1 and 2): past fieldd's own stop (close(), `#closing` set), every refusal of your gate
  // act says closingRefused's "the flow service is stopping", retryable UNAVAILABLE {flows,
  // stopping}, never the store's words, and its item waits on for the next life: a plain disk
  // refusal (JB7), and a full one `#full` did not end (JB7b). And JB8: an ending set inside an
  // answer's own turn starts no slotted step (F9's wake road, `#unslot`'s return, the re-read's Q8)

  /** closingRefused's refusal, as a row past close() reads it (R40g-2's read, with its words). */
  const STOPPING = {
    kind: "UNAVAILABLE",
    message: "the flow service is stopping",
    retryable: true,
    details: { service: RECORD_STORES.SERVICE_FLOWS, state: "stopping" },
  };
  /** Your act on `flow`'s gate (call 1), choosing `act`: its outcome, or its refusal as a value (an
   * RpcCallError's kind, words, retryable and details), so a row reds on what it reads, never on a
   * rejection. */
  const gateActed = (h: Harness, run: string, flow: string, act: string) =>
    h.runs.acts
      .answer({
        id: h.raisedAs[0]?.id ?? ("ny-item1aaaaaa" as NeedsItemId),
        kind: "flow-gate",
        run: { run, flow, call: 1 },
        choice: 0,
        stop: false,
        act,
      })
      .then(
        (answer): unknown => answer,
        (error: unknown) =>
          error instanceof RpcCallError
            ? {
                kind: error.kind,
                message: error.message,
                retryable: error.retryable,
                details: error.details,
              }
            : String(error),
      );

  it("JB7 (J1; Q11, ruled 2026-11-08 (1)): past fieldd's own stop, your gate act whose answer the disk refuses (a plain refusal, not a full journal) is refused in closingRefused's words, retryable UNAVAILABLE {flows, stopping}, never the store's, and nothing is written", async () => {
    // red at the cut (3961d54c6): `#gateAnswered`'s `refused` road reads no `#closing`, so the act
    // is refused in the store's words (UNREADABLE_WORDS.flows, its state `records-unreadable`).
    // The road: #answered → #gateAnswered → #answer with `again` → the store refuses →
    // `refused` → closingRefused (runs.ts:2339@b3a6c6435); the act is no Stop, so #stopAct's own
    // (:2308@b3a6c6435) is never reached. Kills: closingRefused dropped there (m30)
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("gate", GATE);
    const run = startedRun(await h.start({ flow: "gate" })).run;
    // held on your gate and parked: its LiveRun stays in this fieldd, and close() has no host to
    // wait on
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) === "holding");
    const before = h.kinds(run);
    await h.runs.close();
    // the disk refuses your answer's line, in the harness's way (R14d, R6c): the store's own
    // refusal, never full
    const refused: string[] = [];
    const append = h.records.appendRun.bind(h.records);
    vi.spyOn(h.records, "appendRun").mockImplementation((at, entry) => {
      if (entry.kind !== "answer") return append(at, entry);
      refused.push(entry.kind);
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const acted = await gateActed(h, run, "gate", " Push");
    expect({
      refused,
      acted,
      state: stateOf(h, run),
      journal: { before, after: h.kinds(run) },
    }).toEqual({
      refused: ["answer"],
      acted: STOPPING,
      state: "holding",
      journal: { before: ["head", "call"], after: ["head", "call"] },
    });
  });

  it("JB7b (J1; Q11, ruled 2026-11-08 (a)): past fieldd's own stop, your gate act whose answer would cross is refused retryably in closingRefused's words: the run is not ended (no `flood`, no `end` line, its state as before), and fieldd's log never says its journal full", async () => {
    // red at the cut: no bound is read, so your answer is kept and the act is done. Kills
    // (the mutant pass's Finding 1): `#full` without its `#closing` return (m28: the run ends
    // `flood` in fieldd's stop, and the act answers §9's flood sentence); `"full"` returned whether
    // or not `#full` ended the run (m29: the act answers `failed` while the run lives on); and
    // closingRefused dropped from the `refused` road (m30: the store's words)
    // JB5b's calibration: a first run of the same flow, at the default bound, parked on its gate;
    // its journal's bytes
    const first = await harness({ hostIdleMs: IDLE_MS });
    first.approved("gate", GATE);
    const calibrated = startedRun(await first.start({ flow: "gate" })).run;
    await within(PARK_MS, () => left(first, 0) && stateOf(first, calibrated) === "holding");
    const parked = bytesBeforeEnd(first, calibrated);
    // 10 bytes past the parked journal: your answer's line crosses it; nothing before it does
    const h = await harness({ hostIdleMs: IDLE_MS, journalMaxBytes: parked + 10 });
    h.approved("gate", GATE);
    const run = startedRun(await h.start({ flow: "gate" })).run;
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) === "holding");
    const twin = bytesBeforeEnd(h, run) - parked;
    const before = h.kinds(run);
    await h.runs.close();
    // the store's refusal of your answer's line, read where it refused it (JB4's spy): full, by
    // `instanceof`
    const refused: string[] = [];
    const append = h.records.appendRun.bind(h.records);
    vi.spyOn(h.records, "appendRun").mockImplementation((at, entry) => {
      try {
        return append(at, entry);
      } catch (error) {
        refused.push(`${entry.kind} ${error instanceof FlowJournalFull ? "full" : "refused"}`);
        throw error;
      }
    });
    const acted = await gateActed(h, run, "gate", " Push");
    // with no host up, a run #full ended would end at once (#endWith's #finish): read once it had
    // time to
    await within(IDLE_MS, () => over(h, run));
    const record = h.records.runRecord(run);
    expect({
      twin,
      refused,
      acted,
      state: stateOf(h, run),
      host: record?.host,
      lines: endLinesOf(h, run),
      journal: { before, after: h.kinds(run) },
      said: floodsSaid(h, run),
      hosts: h.hosts.length,
    }).toEqual({
      twin: 0,
      refused: ["answer full"],
      acted: STOPPING,
      state: "holding",
      host: undefined,
      lines: [],
      journal: { before: ["head", "call"], after: ["head", "call"] },
      said: { full: 0, host: 0 },
      hosts: 1,
    });
  });

  /** JB8's flow: a gate, then LIVE_STEPS_MAX − 1 steps, then S, N and E at once, each refusal
   * caught. In its first life the disk refuses S's and N's call lines (the row's spy), so E takes
   * the last slot as call 9. */
  const SLOT_WAKE = [
    'export const meta = { name: "Slots" };',
    "export default async function () {",
    '  const gate = ask("Go on?", ["Go", "Hold"]);',
    "  const parts = [];",
    `  for (let i = 1; i < ${FLOW_LIMITS.LIVE_STEPS_MAX}; i += 1)`,
    '    parts.push(agent("look at part " + i, { agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app" }));',
    `  const s = agent("look at s", ${stepAt("S")}).catch(() => "refused");`,
    `  const n = agent("look at n", ${stepAt("N")}).catch(() => "refused");`,
    `  const e = agent("look at e", ${stepAt("E")}).catch(() => "refused");`,
    "  await Promise.all([gate, ...parts, s, n, e]);",
    '  return "done";',
    "}",
    "",
  ].join("\n");
  /** S's call line, as its host would journal it: kept while the run is parked, with no record
   * entry (R13e's road). */
  const slotS = (call: number) => ({
    kind: "call" as const,
    call,
    what: "agent",
    key: flowCallKey("agent", [
      "look at s",
      { agent: "claude", label: "S", profile: "work", cwd: "/work/app" },
    ]),
    n: 1,
    label: "S",
    agent: "claude",
  });
  /** SLOT_WAKE's run in `h` to its wake (F9's road, the re-read's Q8): its first life journals the
   * gate, the parts and E (S's and N's call lines refused by the disk, each logged in `refused`),
   * all LIVE_STEPS_MAX slots taken, parked holding; then S's line is kept with no entry, E's
   * session exits, and your gate act wakes it. Each state S's entry takes on the record's `open`,
   * in order, is kept in `states`. */
  const slotWake = async (h: Harness, refused: string[], states: string[]) => {
    let firstLife = true;
    const write = h.records.writeRunRecord.bind(h.records);
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      const s = fields.open.find((step) => step.call === FLOW_LIMITS.LIVE_STEPS_MAX + 2);
      if (s !== undefined && states.at(-1) !== s.state) states.push(s.state);
      return write(at, fields);
    });
    const append = h.records.appendRun.bind(h.records);
    vi.spyOn(h.records, "appendRun").mockImplementation((at, entry) => {
      if (firstLife && entry.kind === "call" && (entry.label === "S" || entry.label === "N")) {
        refused.push(`${entry.label} refused`);
        throw new Error("EIO: i/o error, write");
      }
      try {
        return append(at, entry);
      } catch (error) {
        refused.push(`${entry.kind} ${error instanceof FlowJournalFull ? "full" : "refused"}`);
        throw error;
      }
    });
    h.approved("slots", SLOT_WAKE);
    const run = startedRun(await h.start({ flow: "slots" })).run;
    await waitFor(() => expect(h.spawned).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX));
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) === "holding");
    const parked = { state: stateOf(h, run), left: left(h, 0), kinds: h.kinds(run) };
    firstLife = false;
    h.records.appendRun(run, slotS(FLOW_LIMITS.LIVE_STEPS_MAX + 2));
    h.exit(sessionOf(h, run, FLOW_LIMITS.LIVE_STEPS_MAX + 1));
    const acted = await gateActed(h, run, "slots", "Go");
    return { run, parked, acted };
  };
  /** SLOT_WAKE's journal through E's answer at the wake: head, 10 calls, your answer, E's. */
  const THROUGH_E = 1 + (FLOW_LIMITS.LIVE_STEPS_MAX + 2) + 2;

  it("JB8 (J1; F9, the re-read's Q8; ruled 2026-11-08 (b)): an ending set inside an answer's own turn starts no slotted step: at a wake, E's session exited, so #bind answers E made again at once; that answer releases N, held, whose call line crosses, so the run ends `flood` in E's turn, and S, waiting for the slot E's answer freed, is never started", async () => {
    // red at the cut: no bound is read, so N's line is kept and the run goes on: S starts in the
    // slot E freed (its entry `waiting`, `starting`, then `working`; `spawned` gains call 10; the
    // record's `agents` reads 9), and the run never ends `flood`. Kills (the mutant pass's
    // Finding 2): `#unslot` without its return on `live.ending` (m27): E's answer settles its step,
    // a slot frees, and #unslot starts S for a run that is leaving: its entry written `starting`,
    // one more of the run's `agents` reserved and its agent spawned (`spawned` gains call 10), and
    // the end's tail ends that agent too (`ended` 8, by read). The road, by read at b3a6c6435: S,
    // made again, is entered `waiting` (#entered: every slot taken);
    // N, new, is held (D7: E's line not yet made again); E, made again last, is handed on
    // (replay.ts's call), and #bind answers it (runs.ts's #bind); #answer keeps E's line, and its
    // `replay.answered` drains N (#unhold): N's line refused full, #full ends the run; #lagging's
    // #unslot then reads the ending (its first line). No src hook: the run's own roads, its store
    // and its sessions are the harness's
    // the calibration, as JB4's: a first run at the default bound, its journal's bytes through E's
    // answer
    const first = await harness({ hostIdleMs: IDLE_MS });
    const twin = await slotWake(first, [], []);
    await within(PARK_MS, () => first.kinds(twin.run).length > THROUGH_E);
    const through = linesThrough(first, twin.run, THROUGH_E);
    const h = await harness({ hostIdleMs: IDLE_MS, journalMaxBytes: through.bytes + 10 });
    const refused: string[] = [];
    const states: string[] = [];
    const woken = await slotWake(h, refused, states);
    await within(PARK_MS, () => over(h, woken.run));
    const record = h.records.runRecord(woken.run);
    expect({
      next: through.next,
      twin: linesThrough(h, woken.run, THROUGH_E).bytes - through.bytes,
      parked: woken.parked,
      acted: woken.acted,
      refused,
      state: record?.state,
      host: record?.host,
      spawned: h.spawned.map(({ origin }) => origin.call),
      agents: record?.agents,
      ended: record?.ended,
      states,
      said: floodsSaid(h, woken.run),
      hosts: h.hosts.length,
    }).toEqual({
      next: "call",
      twin: 0,
      parked: {
        state: "holding",
        left: true,
        kinds: ["head", ...Array<string>(FLOW_LIMITS.LIVE_STEPS_MAX + 1).fill("call")],
      },
      acted: { outcome: "done" },
      refused: ["S refused", "N refused", "call full"],
      state: "failed",
      host: "flood",
      spawned: Array.from({ length: FLOW_LIMITS.LIVE_STEPS_MAX }, (_, i) => i + 2),
      agents: FLOW_LIMITS.LIVE_STEPS_MAX,
      // the flood's end takes the parts' agents alone: E's exited, and S's never started
      ended: FLOW_LIMITS.LIVE_STEPS_MAX - 1,
      states: ["waiting"],
      said: { full: 1, host: 0 },
      hosts: 2,
    });
  });
});
