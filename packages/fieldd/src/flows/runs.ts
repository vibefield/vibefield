import { randomBytes } from "node:crypto";
import {
  FLOW_LIMITS,
  FLOW_LOG_MAX,
  FLOW_RUN_STEPS_MAX,
  type FlowInput,
  type FlowJournalHead,
  type FlowRunId,
  type FlowRunRecord,
  type FlowRunRecordStep,
  type FlowRunState,
  type FlowRunStep,
  type FlowStarter,
  type FlowsListResult,
  flowRunStateOf,
  flowsListOf,
  NEEDS_CHOICE_WORDS,
  type NeedsItemId,
  nameWords,
  oneLineWords,
  RECORD_STORES,
  type RunSummary,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { FlowStepTurnEnd } from "../flow-step-events";
import { RpcCallError } from "../native-link";
import { recordsUnreadable, UNREADABLE_WORDS } from "../signed-record";
import type { HoldSender } from "../tool-plane/rooms/talk/verbs";
import type {
  FlowChangedRaise,
  FlowItemActed,
  FlowItemActs,
  FlowItemAnswer,
  FlowItemRaise,
  FlowItemStart,
  FlowItemStarted,
} from "../tool-plane/rooms/you/queue";
import { type FlowForm, matchAnswer } from "./form-check";
import type { FlowJournalEntry } from "./journal";
import type { FlowLibrary } from "./library";
import type { FlowRecords, FlowRunStart } from "./records";
import { FlowReplay } from "./replay";
import { readFlow } from "./static-read";
import {
  FlowStepOrphaned,
  type FlowStepPorts,
  type FlowStepWrite,
  labelOf,
  labelWords,
  NO_FOLDER,
  sendRepair,
  startStep,
  stepFailed,
} from "./steps";
import {
  boundedAnswer,
  type FlowCallHandler,
  type FlowHostAnswer,
  type FlowHostCall,
  type FlowHostEnd,
  type FlowHostOptions,
  type FlowHostRun,
  startFlowHost,
} from "./supervisor";
import * as words from "./words";

// CP-4a2b (§13a slice 7; 13a v2.7, RULED 2026-11-05) — the runs: a person's flows started, from the bytes fieldd kept, and
// each run's host driven to its end. fieldd's own interface (R32): every port is fieldd's, never a vendor's.
// - A start (CP4-Q5 (a)) reads the flow in the library against its approval. A changed flow, or one never approved,
//   starts nothing: it raises the needs queue's `flow-changed` item and answers `{waits}` (N5). An approved one runs
//   the bytes fieldd KEPT under the approval's hash (D8), never the library's file.
// - The item's act (R4–R6, `acts.start`) begins the run its start asked for (Q4: input, starter, scope; a spark's
//   `from`). Run this version runs the library's bytes the item asked about, approved as yours past every refusal
//   ("Run this version (approves it)"), so an act that can't begin approves nothing; Run the one you approved runs the
//   bytes fieldd kept. Its refusals are the start's words, answered as the act's `failed`.
// - Its refusals (DESIGN.md §9 "When a run can't start", words.ts) are PRECONDITION_FAILED with a `reason`, before
//   anything is written: no flow, a file past SCRIPT_MAX_BYTES, an input the flow does not name, a version not kept,
//   an input naming a session or a project VibeField can't find, a step that names no folder in a run whose input
//   names none (CP4-Q20 (a), from the static read's `cwd`), and the bounds (D3): RUNS_LIVE_MAX live runs, or
//   RUNS_PER_SPARK_MAX of a spark's own. Nothing between the bounds' read and the run's begin awaits, so two starts
//   never pass one bound together.
// - The run's record is written first (D18, `FlowRecords.beginRun`), its scope frozen there: the start's profiles
//   that exist then. A read narrows it to the profiles that exist now; it never widens (D8).
// - A host is started only through `#wake`, which replays the run's journal from the top (CP-D9) under the kept
//   bytes. A run's end is journaled, then its record written (D18's cadence).
// - The list and every change (`onChange`) are drawn from the run records (D18; CL-E2-2), never a journal; a live
//   run's latest log line rides with it until its next anchor writes it into the record (D13).
// - A step (slices 8–9): its agent by steps.ts's one spawn road, its slot (CP4-S7), its answer by its turn's end
//   (CP4-S2), checked against its form (D12) and bounded whole (D11); a miss is the repair turn, and a second holds
//   the run on the person (`flow-repair`), whose act the needs queue hands the runs once (`acts`).
// - A step an `in:` hands a live session (slice 9b): the step listener is told of the hand by steps.ts, before the
//   line, and let go at the step's answer (a failed turn among them), at the run's end and at fieldd's own stop; a
//   repair turn keeps it. A later fieldd re-hands it at boot (14, D2's lookup).
// Built later in M-r2: ask() (slice 11; until then it is refused in fieldd's words), the park and its wakes and D2's
// lookup (10a), the one answer writer (10b), the cap (12), Stop (13) and boot (14).

/** fieldd's own interface to the runs (R32): what daemon.ts builds them from. Slice 7's part. */
export interface FlowRunPorts {
  /** the person's library: a run's flow is read here against its approval */
  readonly library: Pick<FlowLibrary, "read">;
  /** fieldd's flow records: approvals, kept bytes, each run's journal and record */
  readonly records: FlowRecords;
  /** the needs queue's changed-flow item (N5) */
  readonly needs: {
    flowChanged(raise: FlowChangedRaise): NeedsItemId;
    /** a run's own item (slice 6's `flowItem`): a repair miss, a gate, the cap, a lost step */
    flowItem(raise: FlowItemRaise): NeedsItemId;
  };
  /** each step's turn end (flow-step-events.ts, CP4-S2's road): a step's answer reaches the runs here; a session an
   * `in:` hands a step is told to it at the hand (9b) */
  readonly stepEnds: FlowStepPorts["stepEnds"] & {
    onTurnEnd(listener: (end: FlowStepTurnEnd) => void): () => void;
  };
  /** the runtime's spawn, for a step's agent (slice 8; steps.ts `startStep` is its one road) */
  readonly agents: FlowStepPorts["agents"];
  /** each session's input queue, for a step's prompt (D5) */
  readonly inputs: FlowStepPorts["inputs"];
  /** the sessions an `in:` may name (D9) */
  readonly sessions: FlowStepPorts["sessions"];
  /** the folder a run's input names (CP4-Q20 (a)) */
  folderOf: FlowStepPorts["folderOf"];
  /** the project folders this desktop knows (D9's `cwd`) */
  projectFolders: FlowStepPorts["projectFolders"];
  /** a spark's own Agent Profile, and the person's default: a step that names none takes one (A2) */
  sparkProfile: FlowStepPorts["sparkProfile"];
  defaultProfile: FlowStepPorts["defaultProfile"];
  /** the Agent Profiles that exist now, by id: a run's frozen scope narrows to them (D8) */
  profiles(): readonly string[];
  /** G2 (CP-L4, TL-D5): a spark's Agent Profiles now, or none for a spark that is gone: a spark's kept start is
   * narrowed again to them at its act, as an Allow is */
  sparkScope(spark: string): readonly string[] | undefined;
  /** how a run's host is started */
  readonly host: Pick<FlowHostOptions, "launch" | "environment" | "timings" | "heapMb" | "rssMb">;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
}

/** A run's start, as a door asks for it. */
export interface FlowRunStartParams {
  readonly flow: string;
  readonly input: FlowInput;
  readonly starter: FlowStarter;
  /** the Agent Profiles the run may use, as the door chose them (CP4-Q20 (a)): frozen at start (D8) */
  readonly scope: readonly string[];
  /** a spark's flow_run: the spark and its session, who a changed flow's item tells (N5) and a spark's bound names */
  readonly from?: HoldSender | undefined;
}

/** A start's answer: the run it started, or the changed-flow item it waits in, having started nothing (CP4-Q5 (a)). */
export type FlowRunStarted = { readonly run: RunSummary } | { readonly waits: NeedsItemId };

/** The runs a list carries (FlowsListResult's `runs` and `earlier`, `flowsListOf`): the doors add the library. */
export type FlowRunsList = Pick<FlowsListResult, "runs" | "earlier">;

/** A run as the doors read it: its summary, who started it (CL-E7-12's check), and its scope as it stands now. */
export interface FlowRunView {
  readonly summary: RunSummary;
  readonly starter: FlowStarter;
  readonly scope: readonly string[];
}

/** A run's end as its journal's `end` line and its record say it. */
interface RunEnd {
  readonly state: FlowRunState;
  readonly threw?: string;
  readonly host?: string;
}

/** A run this fieldd drives: its host while one runs, and its latest log line not yet in its record (D13). */
interface LiveRun {
  host?: FlowHostRun;
  log?: string;
  /** the spark that started it, by the name its steps' words are marked with (Q-B2 (a)); none for yours */
  readonly ran?: string | undefined;
  /** each step's answer, by its call, while its host waits on it (the step's result is slice 9's) */
  readonly waiting: Map<number, StepWaiter>;
  /** each open step's form (D12), checked at its call: its answer is matched against it */
  readonly forms: Map<number, FlowForm>;
  /** each open step's latest miss, in fieldd's words: what Ask once more's repair line says again */
  readonly misses: Map<number, string>;
  /** the run's input and the kinds its meta names them by, read at its wake: the folder a step names none of
   * (CP4-Q20 (a)) */
  inputs?: { readonly values: FlowInput; readonly kinds: Readonly<Record<string, string>> };
  /** the steps waiting for a slot (CP4-S7), in their calls' order: started when one frees (slice 9) */
  readonly slotted: { readonly call: number; readonly args: readonly unknown[] }[];
  /** each open step's handed session, by its call: how to let the step listener go (9b) */
  readonly hands: Map<number, () => void>;
}

/** A step's answer, while its host waits on it: given once (D22); a start that throws gives its refusal (F2). */
interface StepWaiter {
  readonly resolve: (answer: FlowHostAnswer) => void;
}

/** A step's states that hold one of its run's LIVE_STEPS_MAX slots: its agent is starting or alive (CP4-S7). */
const SLOT_STATES: ReadonlySet<string> = new Set(["starting", "working", "repairing", "holding"]);

/** The states a run never leaves. */
const ENDED_STATES: ReadonlySet<FlowRunState> = new Set(["done", "stopped", "failed", "lost"]);

/** Whether a record's run is live: every state but an end, a word this VibeField does not know among them. */
const isLive = (record: FlowRunRecord): boolean => {
  const state = flowRunStateOf(record);
  return state === undefined || !ENDED_STATES.has(state);
};

/** A thrown thing's own words, for fieldd's log alone. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A run whose record `#begin` kept: its id, its mark's name, and its summary as `#begin` wrote it, the door's answer
 * when that record cannot be read back (W1). */
interface Begun {
  readonly run: FlowRunId;
  readonly name: string;
  readonly written: RunSummary;
}

const refused = (reason: string, message: string): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", message, false, { reason });

/** What an ask() is answered until slice 11 builds it: the host refuses it in fieldd's own words ("VibeField could
 * not answer this call."), as it refuses any handler that fails. */
const NO_ASK_YET = "CP-4a2b: a flow's ask() is built in M-r2's slice 11";

/** A call no flow makes (only a host that is not VibeField's sends one), refused in replay.ts's own form (D9). */
const noSuchCall = (what: string): string =>
  `VibeField can't send this ${oneLineWords(what, 32)}: a flow's calls are agent() and ask()`;

/** A record's fields as `writeRunRecord` takes them whole. */
function startOf(record: FlowRunRecord): FlowRunStart {
  return {
    scope: record.scope,
    state: record.state,
    calls: record.calls,
    allowed: record.allowed,
    open: record.open,
    steps: record.steps,
    ...(record.log !== undefined ? { log: record.log } : {}),
    ...(record.earlier !== undefined ? { earlier: record.earlier } : {}),
    ...(record.held !== undefined ? { held: record.held } : {}),
    ...(record.host !== undefined ? { host: record.host } : {}),
    ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
    ...(record.ended !== undefined ? { ended: record.ended } : {}),
  };
}

/** A record's step as a summary's card row carries it. */
function stepOf(step: FlowRunRecordStep): FlowRunStep {
  return {
    call: step.call,
    ...(step.label !== undefined ? { label: step.label } : {}),
    ...(step.agent !== undefined ? { agent: step.agent } : {}),
    ...(step.session !== undefined ? { session: step.session } : {}),
    ...(step.phase !== undefined ? { phase: step.phase } : {}),
    state: step.state,
    ...(step.cut === true ? { cut: true as const } : {}),
  };
}

/** A run's summary, from its record alone (D18): its latest FLOW_RUN_STEPS_MAX steps, answered and open, by call, and
 * `earlier` counting the rest; `log` the live run's latest line when its record does not hold it yet. */
function summaryOf(record: FlowRunRecord, live?: LiveRun): RunSummary {
  const all = [...record.steps, ...record.open].sort((a, b) => a.call - b.call);
  const shown = all.slice(-FLOW_RUN_STEPS_MAX);
  const earlier = (record.earlier ?? 0) + all.length - shown.length;
  const log = live?.log ?? record.log;
  return {
    run: record.run,
    flow: record.flow,
    name: record.name,
    n: record.n,
    hash: record.hash,
    state: record.state,
    calls: record.calls,
    steps: shown.map(stepOf),
    ...(earlier > 0 ? { earlier } : {}),
    ...(log !== undefined ? { log } : {}),
    starter: record.starter,
    startedAt: record.startedAt,
    ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
    ...(record.ended !== undefined ? { ended: record.ended } : {}),
  };
}

export class FlowRuns {
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #live = new Map<FlowRunId, LiveRun>();
  readonly #listeners = new Set<(list: FlowRunsList) => void>();
  #closing = false;
  readonly #offTurns: () => void;
  /** V2 (1b review): the runs whose record was kept, whose begin then failed, and whose ending the disk did not take
   * either: passed by at the bounds until D18's reader settles them at the next boot */
  readonly #unbegun = new Set<FlowRunId>();

  constructor(readonly ports: FlowRunPorts) {
    this.#logger = ports.logger ?? createNoopLogger();
    this.#now = ports.now ?? (() => new Date());
    this.#offTurns = ports.stepEnds.onTurnEnd((end) => this.#turnEnded(end));
  }

  /** Start a run of `flow` (CP4-Q5 (a)): `{run}`, or `{waits}` in the changed-flow item when the library's file is not
   * the approved version; refused, before anything is written, in §9's words. */
  async start(params: FlowRunStartParams): Promise<FlowRunStarted> {
    const { library, records, needs } = this.ports;
    const file = library.read(params.flow);
    if (file === undefined) throw refused("not-found", words.notFound(params.flow));
    if ("tooBig" in file) throw refused("too-big", words.tooBig());
    const approval = records.approval(file.flow);
    if (approval === undefined || approval.hash !== file.hash) {
      const waits = needs.flowChanged({
        script: {
          flow: file.flow,
          hash: file.hash,
          ...(approval !== undefined ? { approved: approval.hash } : {}),
        },
        name: words.markName(readFlow(file.bytes).meta?.name, file.flow),
        ...(params.from !== undefined ? { from: params.from } : {}),
        // Q4 (ruled 2026-11-06 (c)): the start as it was asked, kept on the item's record, so an act begins this same run
        start: { input: params.input, starter: params.starter, scope: [...params.scope] },
      });
      return { waits };
    }
    // W1 (1a review): once the run's record is kept the door answers that run, as the act does, never an error a
    // retry would begin a second run on; one VibeField can't keep is said never to have begun (W3)
    const begun = this.#begin(params, approval.hash);
    const woken = this.#woken(begun);
    if (woken === undefined) throw refused("never-began", words.neverBegan(begun.name));
    return { run: woken };
  }

  /** The runs, from their records: every live run, then the latest ended, to FLOW_RUNS_LISTED_MAX (CL-E2-2). */
  list(): FlowRunsList {
    const live: RunSummary[] = [];
    const ended: RunSummary[] = [];
    for (const record of this.ports.records.runRecords()) {
      const summary = summaryOf(record, this.#live.get(record.run));
      (isLive(record) ? live : ended).push(summary);
    }
    return flowsListOf(live, ended);
  }

  /** Told the list now, then at each change, until the answer is called. */
  onChange(fn: (list: FlowRunsList) => void): () => void {
    this.#listeners.add(fn);
    fn(this.list());
    return () => {
      this.#listeners.delete(fn);
    };
  }

  /** A run as it stands, or nothing for a run no record keeps. Its scope is its frozen one, narrowed to the profiles
   * that exist now (D8). */
  read(run: string): FlowRunView | undefined {
    const record = this.ports.records.runRecord(run);
    if (record === undefined) return undefined;
    const profiles = new Set(this.ports.profiles());
    return {
      summary: summaryOf(record, this.#live.get(record.run)),
      starter: record.starter,
      scope: record.scope.filter((profile) => profiles.has(profile)),
    };
  }

  /** The runs' side of their items (the needs queue's FlowItemActs, bound in slice 15), an answer handed on once. */
  readonly acts: FlowItemActs = {
    answer: (answer) => this.#answered(answer),
    start: async (start) => this.#acted(start),
  };

  /** fieldd's own stop: every host stopped, each run left as its journal and record say, for the next boot. */
  async close(): Promise<void> {
    this.#closing = true;
    this.#offTurns();
    this.#listeners.clear();
    for (const live of this.#live.values()) this.#letGo(live);
    await Promise.all([...this.#live.values()].map((live) => live.host?.stop()));
  }

  /** R4–R6 (CP4-Q5 (a), Q4) — a changed flow's act: the run its start asked for, begun on the version chosen. Its
   * scope is the start's, narrowed at the act to the profiles that exist, never widened (D8, at `#begin`). A refusal
   * is the act's `failed`, in the start's words, with nothing approved and nothing begun; once the run's record is
   * kept, the act is done with that run. */
  #acted(act: FlowItemStart): FlowItemStarted {
    const { start } = act;
    let begun: Begun;
    try {
      // G2 (CP-L4, TL-D5): a spark's start, its own or a Run in its thread (CP4-Q20 (a)), narrows again to the spark's
      // Agent Profiles now, as an Allow does; a spark that is gone starts nothing
      const spark = start.starter.spark;
      const now = spark !== undefined ? this.ports.sparkScope(spark) : undefined;
      if (spark !== undefined && now === undefined) throw refused("no-spark", words.noSpark());
      const scope =
        now !== undefined ? start.scope.filter((profile) => now.includes(profile)) : start.scope;
      const params: FlowRunStartParams = {
        flow: act.flow,
        input: start.input,
        starter: start.starter,
        scope,
        ...(act.from !== undefined ? { from: act.from } : {}),
      };
      if (act.version === "approved") begun = this.#begin(params, act.hash);
      else {
        // Run this version: the library's bytes, while they are still the version the item asked about
        const file = this.ports.library.read(act.flow);
        if (file === undefined) throw refused("not-found", words.notFound(act.flow));
        if ("tooBig" in file) throw refused("too-big", words.tooBig());
        if (file.hash !== act.hash) throw refused("version", words.notAVersion(act.flow));
        begun = this.#begin(params, file.hash, file.bytes);
      }
    } catch (error) {
      if (error instanceof RpcCallError) return { outcome: "failed", reason: error.message };
      throw error;
    }
    // window (c) (ruled 2026-11-06): once the run's record is kept the run has begun, so the act is done with it,
    // unless that record or its journal reads as none this VibeField keeps: then it never began (W3)
    if (this.#woken(begun) === undefined)
      return { outcome: "failed", reason: words.neverBegan(begun.name) };
    return { outcome: "done", run: begun.run };
  }

  /** Begin a run of the version `hash`: its refusals, then the run's begin checked (`checkBegin`), then (`approving`,
   * Run this version's bytes) its approval as yours, then its record and its head (D18). Answers the run, its record
   * kept; `#woken` starts its host. Without `approving` the bytes are the ones fieldd kept under an approval's hash
   * (D8). */
  #begin(params: FlowRunStartParams, hash: string, approving?: Uint8Array): Begun {
    const { records } = this.ports;
    const bytes = approving ?? records.bytes(hash);
    if (bytes === undefined) throw refused("version", words.notAVersion(params.flow));
    const read = readFlow(bytes);
    const meta = read.meta;
    const name = words.markName(meta?.name, params.flow);
    const takes = new Set(Object.keys(meta?.input ?? {}));
    const unknown = Object.keys(params.input).find((input) => !takes.has(input));
    if (unknown !== undefined) throw refused("input", words.noSuchInput(name, unknown));
    // CP4-Q20 (a), R8b: the folder its input names, a session's or a project's, found; and a step the static read
    // says names no folder (none plainly, none computed, no `in:`) needs one, since none is a default
    let folder: string | undefined;
    for (const [input, kind] of Object.entries(meta?.input ?? {})) {
      const value = params.input[input];
      if (value === undefined || value === "" || (kind !== "session" && kind !== "project"))
        continue;
      const found = this.ports.folderOf(kind, value);
      if (found === undefined) throw refused(`input-${kind}`, words.inputNotFound(kind));
      folder ??= found;
    }
    if (
      folder === undefined &&
      read.calls.some((call) => call.in !== true && call.computed !== true && call.cwd !== true)
    )
      throw refused("folder", NO_FOLDER);
    // D3: the bounds, from the records, read with no await before the run begins
    const kept = records.runRecords();
    // V2: a run that never began, its record's ending refused too, is passed by until the next boot settles it
    const live = kept.filter((record) => isLive(record) && !this.#unbegun.has(record.run));
    if (live.length >= FLOW_LIMITS.RUNS_LIVE_MAX) throw refused("runs-live", words.runsLive(name));
    if (params.starter.by === "spark") {
      const spark = params.starter.spark;
      if (spark === undefined || params.from === undefined || params.from.spark !== spark)
        throw new TypeError("a spark's own start names its spark, and the session it asked from");
      const own = live.filter(
        (record) => record.starter.by === "spark" && record.starter.spark === spark,
      );
      if (own.length >= FLOW_LIMITS.RUNS_PER_SPARK_MAX)
        throw refused("runs-per-spark", words.runsPerSpark(nameWords(params.from.name)));
    }
    const n =
      kept
        .filter((record) => record.flow === params.flow)
        .reduce((max, record) => Math.max(max, record.n), 0) + 1;
    const run = `fr-${randomBytes(8).toString("hex")}` as FlowRunId;
    const profiles = new Set(this.ports.profiles());
    const scope = [...new Set(params.scope)].filter((profile) => profiles.has(profile));
    // H2 (R4–R6 review): the run's begin is checked before anything is written, so the store's refusal leaves no
    // approval with no run. Run this version (approves it) is approved past every refusal and that check; the approval
    // keeps its bytes, which the run's host is woken on. A failure that is not the store's own (a disk that refuses a
    // write, a run already kept under the id) is said in §9's words, never its own: until the run's record nothing was
    // changed (the store's sentence); at the record, the run never began, and an approval written before it stands
    this.#written(run, UNREADABLE_WORDS.flows, () => {
      records.checkBegin(run);
      if (approving !== undefined) records.approve(params.flow, approving);
    });
    let head: FlowJournalHead;
    try {
      head = records.beginRun(
        { run, flow: params.flow, name, n, hash, starter: params.starter, input: params.input },
        { scope, state: "running", calls: 0, allowed: FLOW_LIMITS.CALLS_MAX, open: [], steps: [] },
      );
    } catch (error) {
      // V2 (1b review): a record kept before the failure (its head refused) reads as never begun in this life too
      this.#unbegin(run, name);
      throw this.#refusal(run, error, words.neverBegan(name));
    }
    this.#live.set(run, {
      waiting: new Map(),
      forms: new Map(),
      misses: new Map(),
      slotted: [],
      hands: new Map(),
      ...(params.from !== undefined && params.starter.by === "spark"
        ? { ran: nameWords(params.from.name) }
        : {}),
    });
    const written: RunSummary = {
      run,
      flow: head.flow,
      name: head.name,
      n: head.n,
      hash: head.hash,
      state: "running",
      calls: 0,
      steps: [],
      starter: head.starter,
      startedAt: head.at,
    };
    return { run, name, written };
  }

  /** A run whose record `#begin` kept, its host started: the record read back, then woken (`#wake`), then the list
   * told. Past the record nothing throws (W1). A read the disk refuses, or a host that does not start, leaves the run
   * running for the next boot to wake (slice 14): it is answered as its record, or `#begin`, says it, and the list is
   * told (W2). A record that reads back as nothing (set aside, held), or a journal that reads as none VibeField keeps,
   * is no run this VibeField can wake (W3): it answers none, and its record is ended never begun. */
  #woken(begun: Begun): RunSummary | undefined {
    const { run } = begun;
    let record: FlowRunRecord | undefined;
    let woke = false;
    try {
      record = this.ports.records.runRecord(run);
      woke = record !== undefined && this.#wake(run, record);
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.wake",
        "A flow run began, and its host did not start; the next boot wakes it",
        { run, error: messageOf(error) },
      );
      this.#told();
      return record !== undefined ? summaryOf(record, this.#live.get(run)) : begun.written;
    }
    if (record === undefined || !woke) {
      this.#logger.warn(
        "fieldd.flows.run.unkept",
        "A flow run's record or journal reads as none VibeField keeps; the run never began",
        { run, record: record !== undefined },
      );
      const live = this.#live.get(run);
      this.#live.delete(run);
      if (live !== undefined) this.#letGo(live);
      this.#unbegin(run, begun.name);
      return undefined;
    }
    this.#told();
    return summaryOf(record, this.#live.get(run));
  }

  /** V2 (1b review) — a run whose record was kept and whose begin then failed (its head refused, or its record or
   * journal reading as none kept) reads as never begun in this life too: its record ended `failed`, in neverBegan's
   * words, where the disk takes it; where it does not, the bounds pass it by until D18's reader settles it at boot. */
  #unbegin(run: FlowRunId, name: string): void {
    try {
      if (this.ports.records.runRecord(run) === undefined) return;
      this.#rewrite(run, {
        state: "failed",
        endedAt: this.#now().toISOString(),
        log: words.neverBegan(name),
      });
    } catch (error) {
      this.#unbegun.add(run);
      this.#logger.warn(
        "fieldd.flows.run.unbegun",
        "A flow run that never began could not be ended in its record; the bounds pass it by until fieldd restarts",
        { run, error: messageOf(error) },
      );
    }
  }

  /** The list told, as `#changed` tells it, past a run's record, where nothing throws (W2): a list that cannot be read
   * is said in the log. */
  #told(): void {
    try {
      this.#changed();
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.told", "The runs' list could not be told", {
        error: messageOf(error),
      });
    }
  }

  /** H2 — a write of the records at a run's begin, its failure said as `#refusal` says it. */
  #written(run: FlowRunId, said: string, write: () => void): void {
    try {
      write();
    } catch (error) {
      throw this.#refusal(run, error, said);
    }
  }

  /** H2, V4 — a records write's failure at a run's begin, as a person hears it: the store's own refusal as it is, and
   * any other (a disk that refuses a write, a run already kept under the id) logged with its own words and refused in
   * the store's own shape, UNAVAILABLE for the flows (the tolerant reader's law), in `said`, never raw. */
  #refusal(run: FlowRunId, error: unknown, said: string): RpcCallError {
    if (error instanceof RpcCallError) return error;
    this.#logger.warn("fieldd.flows.run.write", "A flow run's begin was not kept", {
      run,
      error: messageOf(error),
    });
    return recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, said, true);
  }

  /** The one way a run's host starts: its journal replayed from the top (CP-D9) under the bytes kept for its hash
   * (D8). Bytes that no longer hash are lost, and so is the run. False for a journal that reads as none kept (W3). */
  #wake(run: FlowRunId, record: FlowRunRecord): boolean {
    const { records } = this.ports;
    const live = this.#live.get(run);
    if (live === undefined) throw new Error(`${run} is not a run this fieldd drives`);
    const read = records.readRun(run);
    if (read.kind !== "kept") return false;
    const bytes = records.bytes(record.hash);
    if (bytes === undefined) {
      this.#finish(run, { state: "lost" });
      return true;
    }
    live.inputs = { values: read.head.input ?? {}, kinds: readFlow(bytes).meta?.input ?? {} };
    const replay = new FlowReplay({
      prior: read.lines,
      append: (entry) => {
        records.appendRun(run, entry);
        this.#journaled(run, entry);
      },
      inner: this.#inner(run, live),
    });
    const host = startFlowHost({
      ...this.ports.host,
      bytes,
      input: read.head.input ?? {},
      handler: replay,
      logger: this.#logger,
    });
    live.host = host;
    void host.ended
      .then((end) => this.#ended(run, end))
      .catch((error: unknown) => {
        this.#logger.error("fieldd.flows.run.ended", "A flow run's host end was not kept", {
          run,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  /** What a run's new calls and log lines reach, past its journal: an `agent()` by the one spawn road (D5), and a
   * `what` no flow calls refused (D9). */
  #inner(run: FlowRunId, live: LiveRun): FlowCallHandler {
    return {
      call: (call) => {
        if (call.what === "agent") return this.#step(run, live, call);
        if (call.what === "ask") return Promise.reject(new Error(NO_ASK_YET));
        return Promise.resolve({ ok: false, refused: noSuchCall(call.what) });
      },
      log: (text) => {
        live.log = text;
        this.#changed();
      },
    };
  }

  /** A step: its agent started by `startStep`, or kept for a slot, and its answer awaited: the step's turn end
   * (`#turnEnded`), or its refusal. */
  async #step(run: FlowRunId, live: LiveRun, call: FlowHostCall): Promise<FlowHostAnswer> {
    const number = call.call;
    if (number === undefined) throw new Error(`a step of ${run} with no call number`);
    // F2 review T5: a read that fails on the step's road, before its waiter, settles the step failed (its answer is
    // journaled as the refusal, and its entry's slot frees), never a rejection that leaves the entry holding one
    let record: FlowRunRecord | undefined;
    try {
      record = this.ports.records.runRecord(run);
    } catch (error) {
      this.#startThrew(run, number, error);
      return { ok: false, refused: stepFailed(labelOf(call.args)) };
    }
    if (record === undefined) return { ok: false, refused: stepFailed(labelOf(call.args)) };
    const answer = new Promise<FlowHostAnswer>((resolve) => live.waiting.set(number, { resolve }));
    // CP4-S7: a step its entry put past the run's slots waits, with no spawn, until one frees
    if (record.open.find((step) => step.call === number)?.state === "waiting")
      live.slotted.push({ call: number, args: call.args });
    else void this.#launch(run, live, number, call.args);
    return answer;
  }

  /** A step's agent started (or its session handed the line) by `startStep`; its refusal is its answer. */
  async #launch(
    run: FlowRunId,
    live: LiveRun,
    number: number,
    args: readonly unknown[],
  ): Promise<void> {
    const waiter = live.waiting.get(number);
    try {
      const record = this.ports.records.runRecord(run);
      if (record === undefined) throw new Error(`no record of ${run}`);
      const started = await this.#startStep(run, live, record, number, args);
      if ("refused" in started) {
        live.waiting.delete(number);
        waiter?.resolve(started);
        return;
      }
      if (started.form !== undefined) live.forms.set(number, started.form);
      // 9b: a handed session is let go at the step's answer; a step its run no longer waits on (answered, or the run
      // ended while the start settled) lets it go now
      if (started.unhand !== undefined) {
        if (this.#live.get(run) === live && live.waiting.has(number))
          live.hands.set(number, started.unhand);
        else started.unhand();
      }
    } catch (error) {
      // F2 (slices 7–9 review): a start that throws is the step's refusal, "‹label› failed.", never the call's
      // rejection, so its answer is journaled, its step settles `failed` and frees its slot (`#unslot`), and the script
      // hears the same on a replay; a rejection would journal nothing and hold the slot forever. Its review's T1: this
      // road does no I/O before the waiter is answered (a store that does not answer is the commonest throw here), and
      // its label is the call's own (T3)
      live.waiting.delete(number);
      waiter?.resolve({ ok: false, refused: stepFailed(labelOf(args)) });
      this.#startThrew(run, number, error);
    }
  }

  /** A step's start that threw, in fieldd's log (F2 review T2): one past its spawn names the agent it leaves running,
   * which slice 13's R42 ends; any other came before any spawn or line. */
  #startThrew(run: FlowRunId, call: number, error: unknown): void {
    if (error instanceof FlowStepOrphaned)
      this.#logger.warn(
        "fieldd.flows.step.orphan",
        "A flow step's agent started, and its line was not queued; the step failed, and its agent is left running",
        { run, call, runtimeRunId: error.runtimeRunId, error: messageOf(error.cause) },
      );
    else
      this.#logger.warn("fieldd.flows.step.start", "A flow step's start threw; the step failed", {
        run,
        call,
        error: messageOf(error),
      });
  }

  #startStep(
    run: FlowRunId,
    live: LiveRun,
    record: FlowRunRecord,
    number: number,
    args: readonly unknown[],
  ) {
    const profiles = new Set(this.ports.profiles());
    return startStep(
      this.ports,
      {
        run,
        flow: record.flow,
        name: record.name,
        ran: live.ran,
        scope: record.scope.filter((profile) => profiles.has(profile)),
        folder: this.#folderOf(live),
        ...(record.starter.by === "spark" && record.starter.spark !== undefined
          ? { spark: record.starter.spark }
          : {}),
      },
      this.#stepWrite(run),
      number,
      args,
    );
  }

  /** A slot freed (CP4-S7): the first step waiting for one, in call order, starts. */
  #unslot(run: FlowRunId, live: LiveRun): void {
    const record = this.ports.records.runRecord(run);
    if (record === undefined) return;
    const used = record.open.filter(
      (step) => SLOT_STATES.has(step.state) && step.handed !== true,
    ).length;
    if (used >= FLOW_LIMITS.LIVE_STEPS_MAX) return;
    const next = live.slotted.shift();
    if (next === undefined) return;
    this.#stepWrite(run)(next.call, (step) => ({ ...step, state: "starting" }));
    void this.#launch(run, live, next.call, next.args);
  }

  /** A step's turn ended (CP4-S2's road): its answer, once (D22), to the call its host waits on. A failed turn is
   * "‹label› failed."; a completed one is `{text}`, a form's fields beside it (Q-A1 (a)), bounded whole (D11). A miss,
   * of its form or of the bound, is the repair turn, and nothing is journaled. A turn end for a step answered, or of a
   * run this fieldd does not drive, is nothing (R24). */
  #turnEnded(end: FlowStepTurnEnd): void {
    const run = end.run as FlowRunId;
    const live = this.#live.get(run);
    const waiter = live?.waiting.get(end.call);
    if (live === undefined || waiter === undefined) return;
    const record = this.ports.records.runRecord(run);
    const step = record?.open.find((open) => open.call === end.call);
    if (record === undefined || step?.session !== end.runtimeRunId) return;
    // held on the person: the step's words wait for their act
    if (step.state === "holding") return;
    if (end.outcome === "failed") {
      this.#answer(live, end.call, waiter, { ok: false, refused: stepFailed(step.label) });
      return;
    }
    const text = end.text ?? "";
    const form = live.forms.get(end.call);
    let value: unknown = { text };
    if (form !== undefined) {
      const match = matchAnswer(form, text);
      if (!match.ok) {
        this.#missed(run, live, record, step, end.runtimeRunId, match.miss);
        return;
      }
      value = { ...(match.value as Readonly<Record<string, unknown>>), text };
    }
    // D11: fields that alone pass the bound are a miss, never a truncation; anything else the one cutter bounds as the
    // replay hands it on (replay.ts), which marks it `cut` for the journal and the script's worker
    const bounded = boundedAnswer({ ok: true, value });
    if (!bounded.ok && bounded.miss === true) {
      this.#missed(run, live, record, step, end.runtimeRunId, bounded.refused);
      return;
    }
    this.#answer(live, end.call, waiter, { ok: true, value });
  }

  /** A step's answer given to its host, once: the replay journals it, then the record settles the step. */
  #answer(live: LiveRun, call: number, waiter: StepWaiter, answer: FlowHostAnswer): void {
    live.waiting.delete(call);
    live.forms.delete(call);
    live.misses.delete(call);
    // 9b: a handed session's later turns are never this step's
    live.hands.get(call)?.();
    live.hands.delete(call);
    waiter.resolve(answer);
  }

  /** Every handed session of a run let go (9b): at its end, and at fieldd's own stop. */
  #letGo(live: LiveRun): void {
    for (const unhand of live.hands.values()) unhand();
    live.hands.clear();
  }

  /** A step's answer missed its form (CP4-Q7 (a)): the repair line once; a miss after it holds the run on the person
   * (`flow-repair`), whose Ask once more sends the line again. Nothing is journaled. */
  #missed(
    run: FlowRunId,
    live: LiveRun,
    record: FlowRunRecord,
    step: FlowRunRecordStep,
    session: string,
    check: string,
  ): void {
    live.misses.set(step.call, check);
    if (step.state !== "repairing") {
      sendRepair(this.ports, this.#stepWrite(run), run, step.call, session, 1, check);
      return;
    }
    const item = this.ports.needs.flowItem({
      kind: "flow-repair",
      run: {
        run,
        flow: record.flow,
        call: step.call,
        ...(step.label !== undefined ? { label: labelWords(step.label) } : {}),
      },
      name: record.name,
      ...(record.starter.by === "spark" && record.starter.spark !== undefined
        ? { spark: record.starter.spark }
        : {}),
      acts: [NEEDS_CHOICE_WORDS.askOnceMore],
    });
    this.#rewriteWith(run, (kept) => ({
      open: kept.open.map((open) =>
        open.call === step.call ? { ...open, state: "holding" } : open,
      ),
      held: { item, kind: "flow-repair" },
    }));
  }

  /** The person's answer to a run's item, handed on once by the needs queue (D22). Slice 9 answers `flow-repair`'s Ask
   * once more: the repair line again, its next `n`. An answer handed on again, its step no longer holding, was acted
   * on, and is answered as done. The gate, the cap and a lost step are slices 11, 12 and 14's; Stop the run is 13's. */
  async #answered(answer: FlowItemAnswer): Promise<FlowItemActed> {
    if (answer.kind !== "flow-repair" || answer.stop)
      throw new Error(`CP-4a2b: a run's ${answer.stop ? "Stop" : answer.kind} is a later slice's`);
    const run = answer.run.run as FlowRunId;
    const live = this.#live.get(run);
    const record = this.ports.records.runRecord(run);
    const step = record?.open.find((open) => open.call === answer.run.call);
    if (live === undefined || record === undefined || step === undefined)
      return { outcome: "failed", reason: words.noSuchRun(run) };
    if (step.state !== "holding") return { outcome: "done" };
    const n =
      Math.max(0, ...(step.lines ?? []).filter((l) => l.line === "repair").map((l) => l.n)) + 1;
    const check = live.misses.get(step.call);
    if (check === undefined || step.session === undefined)
      throw new Error(`the miss of ${run}'s call ${step.call} is not kept`);
    // the hold is answered: the record holds no item
    this.#replace(run, (kept) => {
      const { held: _held, ...rest } = kept;
      return rest;
    });
    sendRepair(this.ports, this.#stepWrite(run), run, step.call, step.session, n, check);
    return { outcome: "done" };
  }

  /** The folder a run's input names, the first of its inputs in its meta's order whose kind names one (CP4-Q20 (a));
   * none when no input does. */
  #folderOf(live: LiveRun): string | undefined {
    for (const [name, kind] of Object.entries(live.inputs?.kinds ?? {})) {
      const value = live.inputs?.values[name];
      const folder = value !== undefined ? this.ports.folderOf(kind, value) : undefined;
      if (folder !== undefined) return folder;
    }
    return undefined;
  }

  /** The record's open step, written through the one writer of a run's record. */
  #stepWrite(run: FlowRunId): FlowStepWrite {
    return (call, patch) =>
      this.#rewriteWith(run, (record) => ({
        open: record.open.map((step) => (step.call === call ? patch(step) : step)),
      }));
  }

  /** A line the run's journal took, as its record follows it (D18's cadence): a call counts (D10), and an agent's
   * call opens its step, `starting` (D5 step 2); an answer settles its step, `failed` for a refusal. */
  #journaled(run: FlowRunId, entry: FlowJournalEntry): void {
    if (entry.kind === "call")
      this.#rewriteWith(run, (record) => ({
        calls: record.calls + 1,
        ...(entry.what === "agent"
          ? {
              open: [
                ...record.open,
                {
                  call: entry.call,
                  ...(entry.label !== undefined ? { label: entry.label } : {}),
                  ...(entry.agent !== undefined ? { agent: entry.agent } : {}),
                  ...(entry.phase !== undefined ? { phase: entry.phase } : {}),
                  // CP4-S7: past the run's LIVE_STEPS_MAX live steps, it waits for a slot
                  state:
                    record.open.filter(
                      (step) => SLOT_STATES.has(step.state) && step.handed !== true,
                    ).length >= FLOW_LIMITS.LIVE_STEPS_MAX
                      ? "waiting"
                      : "starting",
                },
              ],
            }
          : {}),
      }));
    else if (entry.kind === "answer")
      this.#rewriteWith(run, (record) => {
        const step = record.open.find((open) => open.call === entry.call);
        if (step === undefined) return {};
        const settled: FlowRunRecordStep = {
          ...step,
          state: entry.refused !== undefined ? "failed" : "answered",
          ...(entry.cut === true ? { cut: true as const } : {}),
        };
        const steps = [...record.steps, settled];
        const shown = steps.slice(-FLOW_RUN_STEPS_MAX);
        const earlier = (record.earlier ?? 0) + steps.length - shown.length;
        return {
          open: record.open.filter((open) => open.call !== entry.call),
          steps: shown,
          ...(earlier > 0 ? { earlier } : {}),
        };
      });
    // CP4-S7: an answer frees its step's slot
    if (entry.kind === "answer") {
      const live = this.#live.get(run);
      if (live !== undefined) this.#unslot(run, live);
    }
  }

  /** A host's end, as its run ends (or, for a host that left, waits for its next wake: DESIGN.md §9). fieldd's own stop
   * leaves the run to its next boot. */
  #ended(run: FlowRunId, end: FlowHostEnd): void {
    if (this.#closing) return;
    const live = this.#live.get(run);
    if (live !== undefined) delete live.host;
    switch (end.kind) {
      case "done":
        this.#finish(run, { state: "done" });
        return;
      case "threw": {
        const threw = oneLineWords(end.message, FLOW_LOG_MAX);
        this.#finish(run, { state: "failed", ...(threw !== "" ? { threw } : {}) });
        return;
      }
      case "stopped":
        this.#finish(run, { state: "stopped" });
        return;
      case "ended":
        this.#finish(run, { state: "failed", host: end.why });
        return;
      case "left":
        this.#rewrite(run, { state: "waiting" });
        return;
      case "fatal":
      case "refused":
      case "unconfigured":
        this.#logger.warn("fieldd.flows.run.host", "A flow run's host did not run its script", {
          run,
          kind: end.kind,
          reason: end.reason,
        });
        this.#finish(run, { state: "failed" });
        return;
    }
  }

  /** A run's end: its journal's `end` line, then its record (D18), and the run no longer driven. */
  #finish(run: FlowRunId, end: RunEnd): void {
    const live = this.#live.get(run);
    this.#live.delete(run);
    if (live !== undefined) this.#letGo(live);
    try {
      this.ports.records.appendRun(run, {
        kind: "end",
        state: end.state,
        ...(end.host !== undefined ? { host: end.host } : {}),
        ...(end.threw !== undefined ? { threw: end.threw } : {}),
      });
      this.#rewrite(run, {
        state: end.state,
        endedAt: this.#now().toISOString(),
        ...(live?.log !== undefined ? { log: live.log } : {}),
        ...(end.host !== undefined ? { host: end.host } : {}),
      });
    } catch (error) {
      this.#logger.error("fieldd.flows.run.end", "A flow run's end was not kept", {
        run,
        state: end.state,
        error: error instanceof Error ? error.message : String(error),
      });
      this.#changed();
    }
  }

  /** A run's record written again with `fields` over what it holds, then told. */
  #rewrite(run: FlowRunId, fields: Partial<FlowRunStart>): void {
    this.#rewriteWith(run, () => fields);
  }

  /** A run's record written again with what `fields` makes of it over what it holds, then told: the one writer. */
  #rewriteWith(run: FlowRunId, fields: (record: FlowRunRecord) => Partial<FlowRunStart>): void {
    this.#replace(run, (start, record) => ({ ...start, ...fields(record) }));
  }

  /** A run's record written again as `whole` makes it from what it holds (a field it leaves out is gone), then told. */
  #replace(
    run: FlowRunId,
    whole: (start: FlowRunStart, record: FlowRunRecord) => FlowRunStart,
  ): void {
    const { records } = this.ports;
    const record = records.runRecord(run);
    if (record === undefined) throw new Error(`no record of ${run} to write`);
    records.writeRunRecord(run, whole(startOf(record), record));
    this.#changed();
  }

  #changed(): void {
    if (this.#listeners.size === 0) return;
    const list = this.list();
    for (const fn of this.#listeners) fn(list);
  }
}
