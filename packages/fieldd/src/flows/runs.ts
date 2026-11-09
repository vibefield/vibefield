import { randomBytes } from "node:crypto";
import {
  type AgentQueuedInput,
  FLOW_HOST,
  FLOW_HOST_ENDINGS,
  FLOW_LIMITS,
  FLOW_LOG_MAX,
  FLOW_RUN_STEPS_MAX,
  type FlowHostEnding,
  type FlowInput,
  type FlowJournalHead,
  type FlowRunId,
  type FlowRunRecord,
  type FlowRunRecordStep,
  type FlowRunState,
  type FlowRunStep,
  type FlowStarter,
  type FlowsListResult,
  type FlowsStopResult,
  flowRunStateOf,
  flowsListOf,
  NEEDS_CHOICE_WORDS,
  type NeedsItem,
  type NeedsItemId,
  nameWords,
  oneLineWords,
  RECORD_STORES,
  type RunSummary,
  SPARK_TRANSCRIPT_SERVICE,
  type SparkId,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { FlowStepResumed, FlowStepTurnEnd } from "../flow-step-events";
import { RpcCallError } from "../native-link";
import { recordsUnreadable, UNREADABLE_WORDS } from "../signed-record";
import type { HoldSender } from "../tool-plane/rooms/talk/verbs";
import type {
  FlowChangedRaise,
  FlowItemActed,
  FlowItemActs,
  FlowItemAnswer,
  FlowItemRaise,
  FlowItemRaised,
  FlowItemStart,
  FlowItemStarted,
  FlowRunItemKind,
} from "../tool-plane/rooms/you/queue";
import { type FlowForm, matchAnswer } from "./form-check";
import { checkGate } from "./gate-check";
import type { FlowJournalEntry } from "./journal";
import type { FlowLibrary } from "./library";
import { FlowJournalFull, type FlowRecords, type FlowRunRead, type FlowRunStart } from "./records";
import {
  type FlowCallStarter,
  FlowReplay,
  type FlowReplayStuck,
  flowAnswerLine,
  JOURNAL_REFUSED,
} from "./replay";
import { readFlow } from "./static-read";
import {
  boundStep,
  type FlowStepOf,
  FlowStepOrphaned,
  type FlowStepPorts,
  type FlowStepRun,
  type FlowStepSession,
  type FlowStepWrite,
  formOf,
  fromOf,
  handedOf,
  labelOf,
  labelWords,
  NO_FOLDER,
  repairLine,
  requeueLine,
  resumeLine,
  sendLine,
  sendRepair,
  startStep,
  stepFailed,
  unheardLine,
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
//   ("Run this version (approves it)"), so an act that can't begin approves nothing, and one that already stands is
//   never approved again (H3); Run the one you approved runs the approval standing at the act, the bytes fieldd kept
//   for it (H1). Its refusals are the start's words, answered as the act's `failed`.
// - A copy of VibeField that can't start a flow's host refuses every start and act first, UNAVAILABLE in §9's host
//   sentence (Q-b, FLOW_HOST), before anything is raised or written.
// - Its refusals (DESIGN.md §9 "When a run can't start", words.ts) are PRECONDITION_FAILED with a `reason`, before
//   anything is written: no flow, a file past SCRIPT_MAX_BYTES, an input the flow does not name, a version not kept
//   (or, for the one you approved, none standing), a script its static read refuses, in the read's own words (Q-a),
//   an input naming a session or a project VibeField can't find, or the first one, whose folder the run holds, with a
//   folder it can't run in (empty, or past FLOW_LIMITS.FOLDER_CHARS, which its journal's head can't hold; JJ1), a
//   step that names no folder in a run whose input names none (CP4-Q20 (a), from the static read's `cwd`), and the
//   bounds (D3): RUNS_LIVE_MAX live runs, or RUNS_PER_SPARK_MAX of a spark's own. Nothing between the bounds' read and
//   the run's begin awaits, so two starts never pass one bound together.
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
// - A run that waits has no process (slice 10a, D1): a host with a call out and no frame but pongs for HOST_IDLE_MS is
//   parked, by a `stop()` the runs ask for, read as `waiting`, never an end, and the journal gains no line. A step's
//   answer journaled wakes it, and so does a host that left on its own with no call out; a woken host replays the
//   journal from the top on the bytes its record names (D8), once its old host has left, and at most
//   FLOW_LIMITS.HOSTS_LIVE_MAX run at once, a wake past them waiting its turn in order. A host that leaves twice with
//   no new journal line between is never started a third time. A call made again at a wake is looked up first (D2):
//   its step's state on the record, then its session, so a step whose agent lives is bound to it, never started (or
//   counted) again, and one whose agent exited fails.
// - A gate (slice 11a; Q1–Q8): `ask(question, choices)` is held at its call to the one rule the static read holds
//   (gate-check.ts, Q6), and one it refuses is answered by the one writer, journaled and counted, in "An ask refused"'s
//   words (DESIGN.md §9: "VibeField didn't ask you: ‹the read's words›."). Else its item is raised on the one raise
//   road (`#hold`), where every hold of any kind is raised: the run held on you, `running` while its host is up and
//   `holding` once D1's idle parks it (UU2), its `held` the first of its holds still open (EE3). Your answer is
//   journaled as the act's own words, byte for byte, and `await ask()` resolves to that string (Q1): the script's
//   `=== "Push"` reads it as written. A gate made again at a wake is re-bound by the needs queue to its item, never
//   minted again (D2, Q5), and one the journal answers is answered from it at every later wake, never raised (R36). A
//   raise that throws is the ask's answer, "VibeField couldn't ask you: it couldn't keep the question." (Q8).
// - The spark's facts (slice 11b; Q9, Q10): a run a spark started (its starter `by: "spark"`, the spark named) tells
//   that spark, through the `waker` port, in DESIGN.md §9's words ("What VibeField tells a spark", words.ts), when it
//   holds on you, once for each hold the needs queue MINTED (a gate or a step's second miss; a hold re-bound at a wake
//   tells nothing, nor your answer to it), and when it ends, once its `end` line is kept (#finish's
//   #closeEnd, whether or not the record's write lands), in the words END_FACTS keys by the end's
//   state: done, failed, set aside, or stopped (W1's "was stopped", `words.factStopped`).
//   A fact is built from the spark's name, ‹flow› and the run's id alone. A spark `sparkOf` no longer finds is told
//   nothing, and a Run you start in a spark's thread is yours, and tells it nothing (T3b).
//   *Words (2026-11-07; ruled 2026-11-07, orders §K): it said "done, failed or set aside", and a
//   Stop's end tells its spark too. #finishStop's kept-`end` road appends none: it tells nothing.*
// - Stop and the end (slice 13; D4, D19): a person's Stop (`stop`, on any of a run's items too) writes `stopping`
//   first, withdraws the run's lines, ends its items and pauses a handed turn its own line began, then ends its host;
//   and EVERY end of a run, in D4's order (#finish), ends the agents its steps started, by their origin
//   (`sessions.ofRun`) and its orphans, never a session it was handed, then journals one `end` with `ended` and moves
//   its open steps to `ended` (#closeEnd), its items ended and its lines withdrawn. One ending at a time (`live.ending`,
//   set by #endWith alone): the first set stands. A run this fieldd no longer drives is finished by its Stop, from its
//   journal (#finishStop).
// - The boot (slice 14; D1's third wake, D5, D18): two phases. `restore()`, sync, before the API listens: every live run
//   read and adopted, its holds seeded from the queue's own items, its lines read against the kept queues before a
//   poke can take them, and rested; a run forged or never begun said so, and journals past RESTORE_READ_MAX_BYTES left
//   for the next phase. `settled()`, once the runtime has re-attached: the `stopping` runs and a kept `end`'s finished,
//   then every live run woken, in `startedAt` order, one wake per macrotask. A lost step (`flow-lost`, Resume the step)
//   is raised at its re-make and by the mid-life road (`agents.onRunEnded`); a step's session replaced binds by its
//   `begun: "resume"` (`stepEnds.onResumed`).
// *Corrected 2026-11-09 (slice 14's green; RR:737, §D staging 5): it said "Built later in M-r2: boot (14): its wake, a
// session read by its origin once the runtime has re-attached, and a step lost to a Quit (`flow-lost`, Resume the
// step)". Built here; the agent runtime's own half is the re-cut's (Q17's leg, `replacing`) and slice 15 binds the
// ports. A step lost is not always a Quit's: §9's W1 is cause-free.*

/** A spark as a run's start reads it at its act (G2): its name, and its Agent Profiles now. */
export interface FlowRunSpark {
  readonly name: string;
  readonly profiles: readonly string[];
}

/** CP-4a2b slice 13 (Q4 (a)) — a session a run's steps started, as `sessions.ofRun` reads it by its origin
 * (`{by: "flow", run, call}`): its call, and whether it lives. One read for slices 13 and 14. */
export interface FlowRunSession {
  readonly runtimeRunId: string;
  readonly call: number;
  readonly live: boolean;
}

/** fieldd's own interface to the runs (R32): what daemon.ts builds them from. Slice 7's part. Slice 13's six ports
 * (`needs.onFlowRunEnded`, `inputs.withdraw`, `agents.end`, `agents.pause`, `sessions.ofRun`, `began`) are
 * intersected here, as `stepEnds` is (N9), so FlowStepPorts does not widen for ports only the runs call; slice 15
 * binds them. Each is called at a run's end or its Stop, each call caught and logged, so no port refuses an end (Q6). */
export interface FlowRunPorts {
  /** the person's library: a run's flow is read here against its approval */
  readonly library: Pick<FlowLibrary, "read">;
  /** fieldd's flow records: approvals, kept bytes, each run's journal and record */
  readonly records: FlowRecords;
  /** the needs queue's changed-flow item (N5) */
  readonly needs: {
    flowChanged(raise: FlowChangedRaise): NeedsItemId;
    /** a run's own item (slice 6's `flowItem`): a repair miss, a gate, a lost step; its id, and whether the
     * raise minted it (slice 11a's seam, Q5: a hold wakes the run's spark only for an item minted) */
    flowItem(raise: FlowItemRaise): FlowItemRaised;
    /** slice 13 (Q9): a run ended, so its open items end, and an answer after is refused `ended` (queue.ts's
     * `onFlowRunEnded`, built); idempotent */
    onFlowRunEnded(run: string): void;
    /** slice 14 (Q3 (a)): the open items the queue holds that hold a flow run, oldest asked first (`list()`, slice 15's
     * binding): a booted run's holds, every kind, are seeded from them before its first write, and the sweep reads them */
    flowItems(): readonly NeedsItem[];
    /** slice 14 (Q3, Q20; queue.ts's `endFlowItem`): one item ended; whether it ended one */
    endFlowItem(id: NeedsItemId): boolean;
  };
  /** each step's turn end (flow-step-events.ts, CP4-S2's road): a step's answer reaches the runs here; a session an
   * `in:` hands a step is told to it at the hand (9b) */
  readonly stepEnds: FlowStepPorts["stepEnds"] & {
    onTurnEnd(listener: (end: FlowStepTurnEnd) => void): () => void;
    /** slice 14 (Q8 (a), Q17): a step's session resumed, whoever resumed it (FlowStepEvents, `begun: "resume"`) */
    onResumed(listener: (step: FlowStepResumed) => void): () => void;
  };
  /** the runtime's spawn, for a step's agent (slice 8; steps.ts `startStep` is its one road) */
  readonly agents: FlowStepPorts["agents"] & {
    /** slice 13 (Q5 (b)): a session the run started, ended: `endRun` as built, so a resolve is "taken, or already
     * gone" and counts, and a rejection is "could not ask" and does not. Its costs, stated (ruled
     * 2026-11-07, §H 2): an agent that exits in the instant of its end counts one too many, a race (`ofRun` reads
     * `live` first), and an orphan a lagging or throwing read cannot show exited (#agentsOf; fold 2); and `endRun`
     * reads the runtime's `managed` sessions alone (agent-runtime.ts:2179–2180), so a resolve counts `ended` over a
     * `pending` session that still works. Slice 14 carries that leg (K9) */
    end(runtimeRunId: string): Promise<void>;
    /** slice 13 (Q11 (a′), D19): a handed session's working turn the run began, paused at Stop alone:
     * AgentRuntimeService.pause, NEVER `interrupt`, which escalates to an end (ruled 2026-11-07) */
    pause(runtimeRunId: string): Promise<unknown>;
    /** slice 14 (Q8 (a)): a lost step's session resumed, a NEW run the listener hears as `begun: "resume"`. A rejection
     * is the runtime's refusal: the act throws it in W4's words, and its item waits on */
    resume(runtimeRunId: string): Promise<unknown>;
    /** slice 14 (Q7): an agent's session ended, `closeRun`'s tell; slice 15 binds it, and on main it tells a pending
     * session's end and a replacement's too (Q29) */
    onRunEnded(listener: (runtimeRunId: string) => void): () => void;
    /** slice 14 (Q29 (i), ruled 2026-11-08) — whether a replacement of this session is in flight now, read
     * synchronously at the end's tell: from the resume's entry (agent-runtime.ts:4460@a08b28f5d) until the successor
     * has entered (`managed.set`, :3203) or the replacement failed. A step whose session a replacement took waits,
     * for `begun: "resume"`: no false card, no false fact. It is NEVER `plainStopCensus()`'s unkeyed `replacements`
     * count (agent-runtime.ts:1120@a08b28f5d; F4), which says how many and of whom not. Slice 15 binds it; main's read
     * is the re-cut's, a second hunk beside Q17's leg. A session handed a step never reads it (§J 2's origin law). */
    replacing(runtimeRunId: string): boolean;
  };
  /** each session's input queue, for a step's prompt (D5) */
  readonly inputs: FlowStepPorts["inputs"] & {
    /** slice 13 (Q10): a run's lines still waiting in any session's queue, withdrawn at every end (aiq.ts's
     * `withdraw`, built for W2) */
    withdraw(run: string): readonly { readonly runtimeRunId: string }[];
    /** slice 14 (Q10, D5's four rows): a session's kept queue as it stands, read in `restore()` before any poke can
     * shift a stamped head */
    pending(runtimeRunId: string): readonly AgentQueuedInput[];
  };
  /** the sessions an `in:` may name (D9) */
  readonly sessions: FlowStepPorts["sessions"] & {
    /** slice 13 (Q4 (a)): the sessions the run's steps started, by their origin, live or exited; never one it was
     * handed, whose origin is not this run's (K8) */
    ofRun(run: string): readonly FlowRunSession[];
  };
  /** slice 13 (Q11 (a′)): whether `runtimeRunId`'s turn working now is one this step's own line began (slice 15's
   * accessor, beside Q9's `started`); top-level, never in `stepEnds`, which tests bind to the real FlowStepEvents */
  began(runtimeRunId: string, step: FlowStepOf): boolean;
  /** slice 14 (Q31, §H; slice 15's G6): fieldd has passed its stop's point of no return,
   * `(nativeStopping ?? plainStopping) !== null` as daemon.ts's `oneStopAtATime` reads it. A step's start that settles
   * then journals nothing: the next life starts it, once */
  fielddStopping(): boolean;
  /** the folder a run's input names (CP4-Q20 (a)) */
  folderOf: FlowStepPorts["folderOf"];
  /** the project folders this desktop knows (D9's `cwd`) */
  projectFolders: FlowStepPorts["projectFolders"];
  /** a spark's thinksUnder, and the person's default: a step that names none takes one (A2), the spark's in its own
   * run or a Run from its thread (F8) */
  sparkProfile: FlowStepPorts["sparkProfile"];
  defaultProfile: FlowStepPorts["defaultProfile"];
  /** the Agent Profiles that exist now, by id: a run's frozen scope narrows to them (D8) */
  profiles(): readonly string[];
  /** G2 (CP-L4, TL-D5): a spark as it is now, or none for a spark that is gone: a spark's kept start is narrowed
   * again to its Agent Profiles at its act, as an Allow is, and a start left with none is said in its name (V5) */
  sparkOf(spark: string): FlowRunSpark | undefined;
  /** CP-4a2b slice 11 (Q9, Q10): the spark that started a run (its starter, `by: "spark"`), told what the run did: a
   * hold the needs queue minted, and its end once its `end` line is kept. Declared inline, as `needs` is, so flows/
   * never depends on the waker's class; slice 15 binds it to daemon.ts's AgentWaker. Called by `#tell` alone. */
  readonly waker: {
    /** a fact for `spark`, in the runs' words (flows/words.ts): its live session takes it, or it waits for one */
    flowFact(spark: SparkId, fact: string): void;
  };
  /** how a run's host is started (`spawn`: a test's own, to reach the child it started) */
  readonly host: Pick<
    FlowHostOptions,
    "launch" | "environment" | "timings" | "heapMb" | "rssMb" | "spawn"
  >;
  /** D1's idle before a waiting host is parked, ms: HOST_IDLE_MS by default; tests lower it */
  readonly hostIdleMs?: number | undefined;
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

/** The states a run ends in (ENDED_STATES' four): every one a word a spark is told (END_FACTS). */
type EndState = Extract<FlowRunState, "done" | "stopped" | "failed" | "lost">;

/** A run's end as its journal's `end` line and its record say it. */
interface RunEnd {
  readonly state: EndState;
  readonly threw?: string;
  readonly host?: string;
  /** fieldd's own words for the end, on its record in place of the run's latest log line (a host that left twice) */
  readonly log?: string;
}

/** A run this fieldd drives: its host while one runs, and its latest log line not yet in its record (D13). */
interface LiveRun {
  host?: FlowHostRun;
  log?: string;
  /** the spark that started it, by the name its steps' words are marked with (Q-B2 (a)); none for yours */
  readonly ran?: string | undefined;
  /** the calls a host waits on with no answer yet, in any host's life: a turn end, a refusal or a start's settle
   * answers one once (D22, #answer) */
  readonly waiting: Set<number>;
  /** each open step's form (D12), checked at its call: its answer is matched against it */
  readonly forms: Map<number, FlowForm>;
  /** each open step's latest miss, in fieldd's words: what Ask once more's repair line says again */
  readonly misses: Map<number, string>;
  /** the run's folder, a step that names none runs in (CP4-Q20 (a)), held at its start (F6; R8b): its journal's head's,
   * frozen as its scope is; for a head from before it, the one its input names at each wake, the same within one
   * life, though a restart may derive another (GG2) */
  folder?: string | undefined;
  /** the steps waiting for a slot (CP4-S7), in their calls' order: started when one frees (slice 9) */
  readonly slotted: { readonly call: number; readonly args: readonly unknown[] }[];
  /** each open step's handed session, by its call: how to let the step listener go (9b) */
  readonly hands: Map<number, () => void>;
  /** 1c review Y1 — each step's agent left running when its line was never queued, by its call: its session, for
   * slice 13's R42 to end in this fieldd's life (after a restart it is the person's to end).
   * *Corrected 2026-11-07 (slice 13's green; S10): "after a restart it is the person's to end" no longer holds. Its
   * origin names the run, so its run's end ends it by `sessions.ofRun`, after a restart too (#finishStop); this map is
   * read beside that port (AA3), so an end ends it though the port's read lags.*
   * *Fold 1 (2026-11-07; the green skeptic's #2): a step's agent that landed past its run's end is kept here too, from
   * its start's refusal (`landed`, #launched), so the end's tail, which waits for that start, ends it.* */
  readonly orphans: Map<number, string>;
  /** D2 in one life: the steps whose start is in flight, by call. One made again while it starts is never started
   * twice: its start answers the call, once, when it settles (#answer) */
  readonly starting: Set<number>;
  /** slice 13 (Q8 (a)) — each start in flight, while it settles: an end waits for them before it reads the agents
   * its steps started, so one that lands past the end is found and ended (#finish's tail) */
  readonly starts: Set<Promise<void>>;
  /** D1: the host's calls out, made and not yet answered (each host its own count) */
  calls?: HostCalls | undefined;
  /** D1: the timer that parks a host with a call out and no frame for HOST_IDLE_MS; losing it loses nothing */
  idle?: ReturnType<typeof setTimeout> | undefined;
  /** D1: the host is being parked by the runs' own `stop()`, so its `stopped` is a wait, never an end */
  parking?: boolean;
  /** D1 (R27d): a wake asked while the parked host was still leaving: it starts once that host has left */
  owed?: boolean;
  /** CL-H13 (R30): the journal lines this life wrote, and how many it had at its host's last leave on its own */
  lines: number;
  leftAt?: number | undefined;
  /** D22, P14 — the calls the journal answers, each as its record settles it: read from the journal at every wake,
   * and one more at each answer the runs journal. The journal is the truth; this is never its only witness */
  answered: Map<number, Answered>;
  /** D22 — the host generation's replay, current while its host is up: the runs hand an answer to it, read at the
   * hand-on; none while the run is parked or waits for a host */
  replay?: FlowReplay | undefined;
  /** D7, slice 13 (Q2 (a), N3) — the end fieldd chose for its run while its host leaves: D7's set-aside (`lost`, in
   * its words), a person's Stop (`stopped`) or J1's flood (#full). *Words (2026-11-08; J1's green, Q17): it said
   * "later J1's flood".* Set by #endWith alone, which keeps one already set,
   * so the first set stands (N1); the host's end then ends the run as it says, whatever end its script chose
   * (#hostEnded reads it first, Q18 (a)), and nothing is journaled, answered or parked in that leave */
  ending?: RunEnd | undefined;
  /** Q3 (a), VV1 — every hold of the run, of any kind, by the call it holds at, in raise order (a hold raised again
   * keeps its place): the run's `held` is the first still open, projected by the one writer (#replace) */
  readonly holds: Map<number, Hold>;
  /** Slice 11a (its green's review, MED-1) — the run's flow, its mark's name and its starter, as its journal's head
   * keeps them: set at #begin, and again at each wake from the head the wake reads, so a raise (#hold) and the fact it
   * tells (#tell) read no record before the item */
  head: RunHead;
  /** slice 14 (Q6 item 3) — adopted at a boot, so a step with no session asks its origin (`sessions.ofRun`) before a
   * spawn: a kill may have landed between the spawn and the session's write. A fresh call never reads that port */
  readonly booted: boolean;
  /** slice 14 (Q9) — the calls a boot found with a session and no `unheard` line, asked once when idle: seeded at
   * adoption, left at the send and at a turn end heard first */
  readonly unheard: Set<number>;
  /** slice 14 (Q10, D5's first row) — each call's lines kept `sending` that no queue holds, re-queued at its re-make,
   * which holds the text */
  readonly unsent: Map<number, readonly UnsentLine[]>;
  /** slice 14 (Q8, Q17, Q29 (i)) — the args of a call made again while its session waits (`pending`, or a replacement
   * in flight), for the successor's bind to send what is owed */
  readonly made: Map<number, readonly unknown[]>;
  /** slice 14 (Q8 (a)) — the calls whose Resume act is in flight, so `#resumed` leaves that item to the queue */
  readonly acting: Set<number>;
}

/** Slice 14 (Q10) — a step's line by its reason and its number, as the record and the queue's `flow` name it. */
interface UnsentLine {
  readonly line: string;
  readonly n: number;
}

/** Slice 14 (Q10, D5's table) — what `restore()` read of a run's lines against the kept queues: the lines to queue at
 * the re-make, and the lines to write `queued` or `uncertain`. Held past the budget's walk, for its adoption. */
interface LinesRead {
  readonly unsent: ReadonlyMap<number, readonly UnsentLine[]>;
  readonly marks: readonly (UnsentLine & { readonly call: number; readonly sent: string })[];
}

/** A journal that reads `kept`, as the boot and #finishStop hold it. */
type KeptRead = Extract<FlowRunRead, { readonly kind: "kept" }>;

/** Slice 14 (Q12) — a run forged or cut, as its record or its head names it. */
interface ForgedRun {
  readonly run: FlowRunId;
  readonly head: RunHead;
}

/** A run's own facts, fixed for the run (MED-1): its flow, its mark's name (markName's) and who started it. */
interface RunHead {
  readonly flow: FlowRunRecord["flow"];
  readonly name: string;
  readonly starter: FlowStarter;
}

/** The facts a LiveRun keeps of its journal's head, read at #begin and again at each wake, and nothing more of it. */
const headOf = (head: RunHead): RunHead => ({
  flow: head.flow,
  name: head.name,
  starter: head.starter,
});

/** A run's hold on you (Q3): the needs queue's item, and its kind. */
interface Hold {
  readonly item: NeedsItemId;
  readonly kind: FlowRunItemKind;
}

/** Q3 (b), Q8 — a hold as the one raise road (`#hold`) raises it: its item, the call it holds at, and what that call
 * hears when its item can't be raised. */
interface Raising {
  readonly call: number;
  /** the call's own kind (`ask`, `agent`), as its answer is journaled */
  readonly what: string;
  readonly kind: FlowRunItemKind;
  /** the step's label, as the item shows it */
  readonly label?: string | undefined;
  /** what it asks: a gate's question, the script's own string as written (Q1; the queue's `shown()` cuts it) */
  readonly words?: string | undefined;
  /** the acts before Stop the run */
  readonly acts: readonly string[];
  /** the call's answer when its item can't be raised, refused in its kind's words (§9) */
  readonly unkept: string;
  /** fieldd's log, when its item can't be raised: its event and its sentence */
  readonly event: string;
  readonly said: string;
  /** what the hold's record write sets beside the hold (a repair's step `holding`), over what the record holds */
  readonly fields?: (record: FlowRunRecord) => Partial<FlowRunStart>;
}

/** What the one writer did with an answer (Q2): journaled (`kept`); journaled already (`had`, P14); refused by the
 * disk (`refused`); or nothing, for a run no longer driven or set aside (`undriven`).
 * CP-4a2b J1 (orders §B JB5b, Q13; Proposed 2026-11-08): refused as a full journal, its run ended `flood` by that
 * refusal (`full`, #full): the disk did answer, so it is never the retryable `refused`. A full refusal #full did not
 * end the run by (past close(), Q11) is `refused`. */
type Wrote = "kept" | "had" | "refused" | "undriven" | "full";

/** CP-4a2b J1 (F2, Q13, Q16 under the board's (a), 2026-11-08; Proposed) — THE ONE BUILDER of a full journal's
 * end: `failed`, `host: "flood"`, its record's `log` §9's flood sentence for the run's flow as its head names it, as
 * the supervisor's flood end says it (#hostEnded's `ended`). #full sets it as the run's ending, and an act whose answer
 * was the line refused (`full`) answers in its words. */
const floodEnd = (head: RunHead): RunEnd & { readonly log: string } => ({
  state: "failed",
  host: "flood",
  log: words.hostEnded(head.name, "flood"),
});

/** Slice 13 (Q7) — what a record write settles and projects (#replace): the calls the journal answers, the agents
 * failed starts left (Y1), and the holds. A LiveRun's, or, for a run no LiveRun drives, one built from its journal
 * (#finishStop: its answers, no orphan and no hold). */
type Settles = Pick<LiveRun, "answered" | "orphans" | "holds">;

/** What a run's record write reads beside its `whole` (#replace): what it settles and projects, the driven run's
 * LiveRun when none is named (#finish names the one it no longer drives, #finishStop its journal's); and the call
 * whose hold this write releases (#releasing, Q3 (d)). */
interface Replacing {
  readonly live?: Settles | undefined;
  readonly releases?: number | undefined;
}

/** Slice 13 (Q1, Q6) — a run whose end has begun and is not closed: a Stop's leave, D7's once a Stop waits on it, or
 * #finish's tail. A Stop reads it first and waits for `done`, which #closeEnd settles (and close(), Q17 (a)). */
interface Ending {
  readonly done: Promise<void>;
  readonly settle: () => void;
}

/** Slice 13 — a run's end as #closeEnd writes it: the end, the run's head (who is told), what its write settles and
 * projects, its log, and (#finishStop's) `calls` from its journal. */
interface Closing {
  readonly run: FlowRunId;
  readonly end: RunEnd;
  readonly head: RunHead | undefined;
  readonly settles: Settles | undefined;
  readonly log: string | undefined;
  readonly calls?: number | undefined;
}

/** Slice 13's fold 3 (the fold 2 skeptic's #2) — the agents an end ends, as its ONE read finds them (#agentsOf), each
 * with its call (`agentOf`): the run's orphans, and every live `sessions.ofRun` row by its `call`. It travels from
 * that read to #closeEnd, so endSteps finds the agent of a step whose session was never written at
 * a LiveRun's end and on #finishStop's no-`end` road (a run no LiveRun drives). #finishStop's
 * kept-`end` road reads no agents and matches nothing: it hands endSteps an empty `agentOf` and an
 * empty `refused`. Never a handed session: `ofRun` reads by origin.
 * *Words (2026-11-07; ruled 2026-11-07, orders §K): it named every road, and it covers these two; the
 * kept-`end` road's gap is the fold 3 skeptic's LOW #1 (#finishStop's doc).*
 * *Corrected 2026-11-09 (the fold's P13; the skeptic's #11, LOW): "reads no agents and matches nothing" is the one-life
 * Stop's (BB6's) alone. At the boot that road reads the run's agents once (#settleKept, `#agentsOf`, Q2 (c)(ii)) and hands
 * endSteps every live one as `refused`, with its `agentOf`, so a step whose agent works on stays open.* */
interface EndAgents {
  readonly agents: readonly string[];
  readonly agentOf: ReadonlyMap<number, string>;
}

/** Slice 13 (Q7, Q12 (b)) — what a run no LiveRun drives settles from its journal (#finishStop, the boot's kept `end`):
 * its answers, no orphan, no hold. */
const settlesOf = (read: KeptRead): Settles => ({
  answered: new Map(
    read.lines.flatMap((line) =>
      line.kind === "answer" ? [[line.call, answeredOf(line)] as const] : [],
    ),
  ),
  orphans: new Map(),
  holds: new Map(),
});

/** Slice 13 (Q12 (b)) — what #finishStop hands #finish for a run no LiveRun drives: the head and the answers its
 * journal holds, and the call lines it counts. */
interface Unlived {
  readonly head: RunHead;
  readonly settles: Settles;
  readonly calls: number;
}

/** A port's call as a promise, its throw a rejection, so an end awaits it whole and nothing refuses that end (Q6). */
const asked = <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return call();
  } catch (error) {
    return Promise.reject(error);
  }
};

/** An answer's settle on its record (D18): `failed` for a refusal, `cut` for a text cut to fit. */
interface Answered {
  readonly failed: boolean;
  readonly cut: boolean;
}

/** A journal answer line's settle: a line as the one writer appends it (FlowJournalEntry), or as a wake reads it back
 * (contracts' FlowJournalAnswer, whose optional fields zod types `| undefined`, under exactOptionalPropertyTypes). */
const answeredOf = (line: {
  readonly refused?: string | undefined;
  readonly cut?: true | undefined;
}): Answered => ({
  failed: line.refused !== undefined,
  cut: line.cut === true,
});

/** An open step settled on the record by its answer (D18's cadence): moved to `steps`, `failed` for a refusal, `cut`
 * for a text cut short; a step its failed start left an agent running for names that session (Y1). None open: as it
 * was. A step held on its repair takes its hold with it in the same write, by #replace's projection (Q3 (e); F5). */
function settleStep(
  start: FlowRunStart,
  call: number,
  answered: Answered,
  orphan?: string,
): FlowRunStart {
  const step = start.open.find((open) => open.call === call);
  if (step === undefined) return start;
  const settled: FlowRunRecordStep = {
    ...step,
    ...(step.session === undefined && orphan !== undefined ? { session: orphan } : {}),
    state: answered.failed ? "failed" : "answered",
    ...(answered.cut ? { cut: true as const } : {}),
  };
  return movedOut(start, [settled]);
}

/** Open steps moved to `steps` (D18), as they now read: the latest FLOW_RUN_STEPS_MAX shown, `earlier` counting the
 * rest. settleStep's fold and endSteps' one. */
function movedOut(start: FlowRunStart, moved: readonly FlowRunRecordStep[]): FlowRunStart {
  const calls = new Set(moved.map((step) => step.call));
  const steps = [...start.steps, ...moved];
  const shown = steps.slice(-FLOW_RUN_STEPS_MAX);
  const earlier = (start.earlier ?? 0) + steps.length - shown.length;
  return {
    ...start,
    open: start.open.filter((open) => !calls.has(open.call)),
    steps: shown,
    ...(earlier > 0 ? { earlier } : {}),
  };
}

/** Slice 13 (Q7, ZZ2 (i)) — a run's open steps at its end, in the end's own write: each moved to `steps`, `ended`
 * (a step with no agent, or handed a session, counts none in `ended`, which counts sessions), but two. A step its
 * journal answers (`answered`) is skipped, so the write's settle reads it answered, never ended (XX4: #replace settles
 * after `whole`); and one whose agent's end the floor refused (`refused`) stays open in its true state, uncounted
 * (Q5 (b), the review's reading: the interim `working` is the honest one). A step's agent is its session, or, for a step
 * whose session was never written, the agent of its call in the end's one read (`agentOf`, EndAgents): an agent that
 * landed past the end (Q8 (a), fold 1's `landed`), one a failed start left (Y1), or any live row of that read
 * (`sessions.ofRun`, by its `call`). A handed session is never in it.
 * *Fold 2 (2026-11-07; the fold skeptic's #1): it matched a step's session alone, so a landed agent whose end the floor
 * refused left its step `ended` while it worked on; the run's orphan is matched now, as R40f has it for a session.*
 * *Fold 3 (2026-11-07; the fold 2 skeptic's #2): it matched the run's orphans alone, and a run no LiveRun drives has
 * none (#finishStop's no-`end` road, which slice 14's boot reaches), so there it matched by session alone again; the
 * end's one read now names each agent's call.* */
function endSteps(
  start: FlowRunStart,
  answered: ReadonlyMap<number, Answered> | undefined,
  refused: ReadonlySet<string>,
  agentOf: ReadonlyMap<number, string>,
): FlowRunStart {
  const ending = start.open.filter(
    (step) => answered?.has(step.call) !== true && !refusedOf(step, refused, agentOf),
  );
  return ending.length === 0
    ? start
    : movedOut(
        start,
        ending.map((step) => ({ ...step, state: "ended" })),
      );
}

/** Slice 14 (Q21, C8): the agents an end's write reads a step against: its session, and its call's live row, either
 * refused keeps the step open. */
const refusedOf = (
  step: FlowRunRecordStep,
  refused: ReadonlySet<string>,
  agentOf: ReadonlyMap<number, string>,
): boolean =>
  [step.session, agentOf.get(step.call)].some((agent) => agent !== undefined && refused.has(agent));

/** A host's calls out (D1's wait is at least one, and no frame but pongs). */
interface HostCalls {
  out: number;
}

/** D1 — how long a host may wait with a call out and no frame but pongs before the runs park it: fieldd's own timing,
 * as the supervisor's HOST_READY_MS is, never a FLOW_LIMITS row. */
const HOST_IDLE_MS = 10_000;

/** A step's states that hold one of its run's LIVE_STEPS_MAX slots: its agent is starting or alive (CP4-S7). */
const SLOT_STATES: ReadonlySet<string> = new Set([
  "starting",
  "working",
  "repairing",
  "holding",
  // slice 14 (Q7): a lost step keeps its slot, so a Resume never makes one more live
  "lost",
]);

/** The slots a run's open steps hold: each in a slot state, a step handed a session by `in:` none (F9). */
const slotsTaken = (open: readonly FlowRunRecordStep[]): number =>
  open.filter((step) => SLOT_STATES.has(step.state) && step.handed !== true).length;

/** The states a run never leaves. */
const ENDED_STATES: ReadonlySet<FlowRunState> = new Set(["done", "stopped", "failed", "lost"]);

/** TT1 — the states of a run at rest, its host gone (D1): `waiting`, or `holding` while the person holds it. */
const AT_REST: ReadonlySet<string> = new Set(["waiting", "holding"]);

/** Whether a record's run is live: every state but an end, a word this VibeField does not know among them. */
const isLive = (record: FlowRunRecord): boolean => {
  const state = flowRunStateOf(record);
  return state === undefined || !ENDED_STATES.has(state);
};

/** A thrown thing's own words, for fieldd's log alone. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A thrown thing's code, for fieldd's log alone: a refusal's own reason where it carries one (the needs queue's
 * `fact`, as `bad-input`), else its kind; a system error's (`ENOSPC`). */
const codeOf = (error: unknown): string | undefined => {
  if (error instanceof RpcCallError) {
    const { details } = error;
    const fact =
      typeof details === "object" && details !== null && "fact" in details
        ? details.fact
        : undefined;
    return typeof fact === "string" ? fact : error.kind;
  }
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
};

/** Q3 (c), VV1, EE3 — a write's `held`, projected from its run's holds: the first, in raise order, whose call the
 * journal has not answered and that this write does not release (`releases`); none when there is none. Written by
 * the one writer (#replace) alone. */
function withHeld(start: FlowRunStart, live: Settles, releases: number | undefined): FlowRunStart {
  const { held: _held, ...rest } = start;
  for (const [call, hold] of live.holds)
    if (call !== releases && !live.answered.has(call))
      return { ...rest, held: { item: hold.item, kind: hold.kind } };
  return rest;
}

/** Q9, R35 — a fact a run tells the spark that started it, in words.ts's words: built from the spark's name, ‹flow›
 * (the record's, `markName`'s) and the run's id alone. */
type SparkFact = (spark: string, flow: string, run: string) => string;

/** Q9 (b) — the fact a run's end tells the spark that started it, by the end's state: none yet for `stopped`, whose
 * words are slice 13's (its Stop); a run's other states are no end.
 * *Corrected 2026-11-07 (slice 13's green; K21, W1): "none yet for `stopped`" no longer holds. A Stop's end tells
 * `factStopped`, §9's Proposed line (W1, ruled 2026-11-07), so every end has its words, keyed by EndState.* */
const END_FACTS: Readonly<Record<EndState, SparkFact>> = {
  done: words.factDone,
  failed: words.factFailed,
  lost: words.factSetAside,
  stopped: words.factStopped,
};

/** A run whose record `#begin` kept: its id, its mark's name, and its summary as `#begin` wrote it, the door's answer
 * when that record cannot be read back (W1). */
interface Begun {
  readonly run: FlowRunId;
  readonly name: string;
  readonly written: RunSummary;
}

const refused = (reason: string, message: string): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", message, false, { reason });

/** Q-b: a copy of VibeField that can't start a flow's host refuses every start in §9's host sentence, as the flows'
 * doors say it (FLOW_HOST: UNAVAILABLE, never retryable), before anything is raised or written. */
const hostless = (): RpcCallError =>
  new RpcCallError("UNAVAILABLE", words.hostUnconfigured(), false, {
    service: FLOW_HOST.SERVICE,
    state: FLOW_HOST.STATE_UNCONFIGURED,
  });

/** Slice 13's fold 1 (the green skeptic's #3) — an act the runs refuse while fieldd stops (#stopAct's no-record road):
 * UNAVAILABLE {flows, stopping}, retryable, so its item waits on for the next life.
 * *Fold 2 (2026-11-07; ruled 2026-11-07, the builder's #3): it is the house's shape (made-app-service.ts's `stopping()`,
 * "the made app service is stopping"; agent-runtime.ts's adopt, "the agent service is stopping"): fieldd's own
 * retryable UNAVAILABLE, never a §9 sentence. A surface that ever shows it to a person says §9's words there, not this
 * string.*
 * *J1 (Q11; ruled 2026-11-08 (1)): #gateAnswered's refused road answers it too past close(), a
 * plain disk refusal or a full one #full did not end.* */
const closingRefused = (): RpcCallError =>
  new RpcCallError("UNAVAILABLE", "the flow service is stopping", true, {
    service: RECORD_STORES.SERVICE_FLOWS,
    state: "stopping",
  });

/** Slice 14 (Q35; ruled 2026-11-08, §M) — a Stop between `restore()` and `settled()`: fieldd's own retryable
 * UNAVAILABLE, in closingRefused's shape, never a §9 sentence (its item waits on, and the run ends once its sessions
 * are attached). `state` is registries.ts's word: no flows row holds it, so it is read from a table that does. */
const startingRefused = (): RpcCallError =>
  new RpcCallError("UNAVAILABLE", "the flow service is starting", true, {
    service: RECORD_STORES.SERVICE_FLOWS,
    state: SPARK_TRANSCRIPT_SERVICE.STATE_STARTING,
  });

/** A call no flow makes (only a host that is not VibeField's sends one), refused in replay.ts's own form (D9). */
const noSuchCall = (what: string): string =>
  `VibeField can't send this ${oneLineWords(what, 32)}: a flow's calls are agent() and ask()`;

/** A record's fields as `writeRunRecord` takes them whole. */
function startOf(record: FlowRunRecord): FlowRunStart {
  return {
    scope: record.scope,
    state: record.state,
    calls: record.calls,
    open: record.open,
    steps: record.steps,
    ...(record.log !== undefined ? { log: record.log } : {}),
    ...(record.earlier !== undefined ? { earlier: record.earlier } : {}),
    ...(record.held !== undefined ? { held: record.held } : {}),
    ...(record.host !== undefined ? { host: record.host } : {}),
    ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
    ...(record.ended !== undefined ? { ended: record.ended } : {}),
    // F4: the agents its steps started, which every write keeps (steps.ts reserves and gives them back)
    ...(record.agents !== undefined ? { agents: record.agents } : {}),
  };
}

/** A step held on you (Q8; MED-2, R22h, R22i): its record says `holding`, or its run keeps the hold of its repair
 * whose write the record refused, the step still `repairing` there. The one rule #turnEnded, #answered and #resumed
 * ask. */
const heldOnYou = (live: LiveRun, step: FlowRunRecordStep): boolean =>
  step.state === "holding" || live.holds.get(step.call)?.kind === "flow-repair";

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

/** Slice 14 (Q10, D5) — whether a kept input is this step's line: a run's own words by its run and call (`prompt`,
 * `in`); VibeField's by `flow.{run, call, line, n}`. */
const isLineOf = (
  input: AgentQueuedInput,
  run: string,
  call: number,
  line: string,
  n: number,
): boolean =>
  input.from.kind === "flow"
    ? (line === "prompt" || line === "in") && input.from.run === run && input.from.call === call
    : input.from.kind === "fieldd" &&
      input.from.flow?.run === run &&
      input.from.flow.call === call &&
      input.from.flow.line === line &&
      input.from.flow.n === n;

/** Whether an item's kind is one a run's hold can be (Q3 (a)). */
const isRunItem = (kind: string): kind is FlowRunItemKind =>
  kind === "flow-gate" || kind === "flow-repair" || kind === "flow-lost";

/** A step's lines with D5's marks applied. */
const marked = (
  call: number,
  kept: NonNullable<FlowRunRecordStep["lines"]>,
  { marks }: LinesRead,
): NonNullable<FlowRunRecordStep["lines"]> =>
  kept.map((line) => {
    const mark = marks.find((m) => m.call === call && m.line === line.line && m.n === line.n);
    return mark !== undefined ? { ...line, sent: mark.sent } : line;
  });

export class FlowRuns {
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #live = new Map<FlowRunId, LiveRun>();
  readonly #listeners = new Set<(list: FlowRunsList) => void>();
  #closing = false;
  readonly #offTurns: () => void;
  /** V2 (1b review): the runs whose record was kept, whose begin then failed, and whose ending the disk did not take
   * either, each with when it was found never begun: passed by at the bounds, and read as failed (Z3), until D18's
   * reader settles them at the next boot */
  readonly #unbegun = new Map<FlowRunId, string>();
  /** D1, CL-K-d (R29): the runs whose host waits for one of HOSTS_LIVE_MAX, in the order they asked */
  readonly #hostQueue: FlowRunId[] = [];
  /** Slice 13 (Q1 (a)) — the runs whose end has begun and is not closed (a Stop's leave, D7's once a Stop waits on
   * it, or #finish's tail), each settled by #closeEnd: a Stop reads this first, and waits */
  readonly #ends = new Map<FlowRunId, Ending>();
  /** Slice 14 (Q7, Q29; Q34) — the agent runtime's ends and resumes heard: dropped by close() in the turn it sets
   * `#closing` */
  readonly #offEnded: () => void;
  readonly #offResumed: () => void;
  /** Slice 14 (Q25): `restore()` is once per FlowRuns; (Q5) so is `settled()` */
  #restored = false;
  #settledOnce = false;
  /** Slice 14 (Q5, Q35): between `restore()` and `settled()` nothing wakes a run (#rouse), no end is heard (Q29) and no
   * Stop acts (stop): the runtime has not re-attached. False in a FlowRuns never told `restore()` */
  #booting = false;
  /** Slice 14 (Q2 (a)) — the runs `settled()` must finish, unadopted till then: a `stopping` record (#finishStop), and
   * a journal holding a kept `end` line, the read in hand (the settle's helper). The method `#stopping` is the record's
   * write; this is the boot's own */
  readonly #stopsOwed = new Map<FlowRunId, KeptRead | undefined>();
  /** Slice 14 (Q33 (b), §K) — the runs restore() did not read within RESTORE_READ_MAX_BYTES, with their lines read */
  readonly #pastBudget = new Map<FlowRunId, LinesRead>();
  /** Slice 14 (Q19, Q33) — the runs this life has not read: a read that threw or a newer VibeField's (for good), and
   * those past the budget until adopted or, with no record, read. An act on one is refused retryably, ahead of its Stop
   * (#answered), and the sweep leaves its items: its read sets a journal aside, and `settled()` names the run from it */
  readonly #unread = new Set<FlowRunId>();
  /** Slice 14 (Q5, Q33 (c)) — the runs `settled()` wakes, in `startedAt` order, each by a macrotask */
  readonly #adopting: FlowRunId[] = [];
  /** The fold's P5 (the skeptic's #7; ruling 2, §P) — the journals with no record restore() did not read within
   * RESTORE_READ_MAX_BYTES: `settled()` reads each, and `#unread` holds them till then */
  readonly #unrecordedOwed: FlowRunId[] = [];

  constructor(readonly ports: FlowRunPorts) {
    this.#logger = ports.logger ?? createNoopLogger();
    this.#now = ports.now ?? (() => new Date());
    this.#offTurns = ports.stepEnds.onTurnEnd((end) => this.#turnEnded(end));
    this.#offEnded = ports.agents.onRunEnded((session) => this.#sessionEnded(session));
    this.#offResumed = ports.stepEnds.onResumed((step) => this.#resumed(step));
  }

  /** CP-4a2b slice 14 (Q1 (b), Q2–Q4, Q10, Q12, Q19, Q25, Q33 (b)) — the boot's first phase, sync, before the API
   * listens and before a monitor row can poke a queue: once per FlowRuns (Q25). Each live run, oldest first:
   * a `stopping` record is left for `settled()`; else its lines are read against the kept queues (D5, Q10); its
   * journal's size is read first, and one that would take the walk past RESTORE_READ_MAX_BYTES waits for `settled()`
   * and the walk goes on (Q33 (b), §K, ruled 2026-11-08: a near-full journal, about 32 MiB, never rides here); else it is
   * read whole, and adopted (#adoptRead's table), each in its own try. A `runRecords()` that throws is a whole-store
   * failure and throws: a boot that rejects binds nothing, and its items wait on `flows-unbound`, nothing spent (Q2).
   * Then the journals with no record, each read once (Q12) and counted in the same budget, then the sweep (Q3).
   * *Corrected 2026-11-09 (the fold's P5, the skeptic's #7; ruling 2, §P):* the journals with no record were read
   * outside `total`, so the budget's "IN ALL" (§K) did not hold of them. One past the budget now waits for `settled()`,
   * and a listing the disk refuses is said and rejects nothing. */
  restore(): void {
    if (this.#restored) return;
    this.#restored = true;
    this.#booting = true;
    const { records } = this.ports;
    const lives = records
      .runRecords()
      .filter((record) => this.#isLive(record))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.run.localeCompare(b.run));
    const items = this.#openItems();
    let total = 0;
    for (const record of lives) {
      const run = record.run;
      try {
        if (record.state === "stopping") {
          this.#stopsOwed.set(run, undefined);
          continue;
        }
        this.#adopting.push(run);
        const lines = this.#linesRead(run, record);
        const bytes = records.journalBytes(run) ?? 0;
        if (total + bytes > FLOW_LIMITS.RESTORE_READ_MAX_BYTES) {
          this.#pastBudget.set(run, lines);
          this.#unread.add(run);
          continue;
        }
        total += bytes;
        this.#adoptRead(record, records.readRun(run), lines, items);
      } catch (error) {
        this.#unread.add(run);
        this.#logger.warn(
          "fieldd.flows.run.restore",
          "A flow run could not be read at the boot; its next boot reads it, and its items wait",
          { run, error: messageOf(error) },
        );
      }
    }
    let unrecorded: FlowRunId[] = [];
    try {
      unrecorded = records.unrecorded();
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.restore",
        "The flow journals with no record could not be listed at the boot; the next boot lists them",
        { error: messageOf(error) },
      );
    }
    for (const run of unrecorded)
      total += this.#readUnrecorded(run, FLOW_LIMITS.RESTORE_READ_MAX_BYTES - total);
    this.#sweep(items);
  }

  /** CP-4a2b slice 14 (Q1, Q5, Q13, Q30, Q33 (c)) — the boot's second phase, once, called when the agents have
   * re-attached (slice 15's `bootWhenReady`). `#booting` clears first. Then the owed Stops are handed over, each `void`,
   * its rejection logged, so a hung `agents.end` holds no wake (Q5); then every adopted run, oldest first (R32c): a run
   * past the budget is read and adopted now (Q33); NN5's newer read comes first and a run it refuses ends through the
   * one setter, then the wake (Q30), each by one macrotask, `#closing` re-read before each (§H's (c)): so a stall is
   * one read. Last, the journals with no record past the budget, one read to a macrotask (the fold's P5). A step is
   * lost only at its re-make (Q7 (a)): no walk here, so a run NN5 ends mints no card. */
  async settled(): Promise<void> {
    if (this.#settledOnce) return;
    this.#settledOnce = true;
    this.#booting = false;
    if (this.#closing) return;
    for (const run of [...this.#stopsOwed.keys()]) {
      if (!(await this.#paced())) return;
      this.#handOver(run);
    }
    for (const run of this.#adopting) {
      if (!(await this.#paced())) return;
      // the fold's P3 (the skeptic's #3): a journal past the budget is read whole here and again by its wake, one to a
      // macrotask (Q33 (c)); these are the fullest journals fieldd keeps
      if (this.#adoptLate(run) && !(await this.#paced())) return;
      if (this.#stopsOwed.has(run)) this.#handOver(run);
      else this.#wakeBooted(run);
    }
    for (const run of this.#unrecordedOwed) {
      if (!(await this.#paced())) return;
      this.#unread.delete(run);
      this.#readUnrecorded(run);
    }
  }

  /** CP-4a2b slice 14 (Q9) — a session's turn went idle (slice 15's `onRunMonitor`): the unheard asker for each step on
   * it, however often it is said. Returns at once while no run has an unheard call. */
  sessionIdle(runtimeRunId: string): void {
    for (const [run, live] of this.#live) {
      if (live.unheard.size === 0) continue;
      try {
        for (const step of this.ports.records.runRecord(run)?.open ?? [])
          if (step.session === runtimeRunId) this.#askUnheard(run, live, step);
      } catch (error) {
        this.#logger.warn("fieldd.flows.run.idle", "A flow run's idle step could not be read", {
          run,
          error: messageOf(error),
        });
      }
    }
  }

  /** Start a run of `flow` (CP4-Q5 (a)): `{run}`, or `{waits}` in the changed-flow item when the library's file is not
   * the approved version; refused, before anything is written, in §9's words. */
  async start(params: FlowRunStartParams): Promise<FlowRunStarted> {
    const { library, records, needs } = this.ports;
    if (this.ports.host.launch.kind === "unconfigured") throw hostless();
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
      (this.#isLive(record) ? live : ended).push(this.#summaryOf(record));
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
      summary: this.#summaryOf(record),
      starter: record.starter,
      scope: record.scope.filter((profile) => profiles.has(profile)),
    };
  }

  /** CP-4a2b slice 13 (Q1 (a); M-d's seam, `stop(run): Promise<FlowsStopResult>`) — a person's Stop of a run,
   * answered once the run's end leaves it (about 25 s at the worst, by the read: the host's grace, then the ends; K6),
   * as its record then reads. In order:
   * 1. an end begun and not closed (`#ends`: a Stop's leave, D7's once a Stop waits on it, or #finish's tail) is
   *    waited for, and answered as it leaves the run: a second Stop takes no end of its own, nor a Stop in an end's
   *    tail;
   * 2. a run no record keeps is NOT_FOUND, in noSuchRun's words; one that has ended, or was found never begun, is
   *    answered as it is, writing nothing (BB6: judged by #isLive, never by `record.state` alone; R44);
   * 3. N1: a LiveRun whose ending is already set (D7's set-aside, J1's flood) writes no `stopping` and takes no
   *    end of its own: the Stop waits, and answers the run as that end leaves it (`lost` for D7; `failed`, `host:
   *    "flood"` for J1's, F8's second half). *Words (2026-11-08; J1's green, Q17): it said "later J1's flood".*
   * 4. Q17 (a): past fieldd's own stop, a Stop writes `stopping` alone and acts on nothing; the boot finishes it (D4);
   * 5. a run no LiveRun drives (a fresh FlowRuns', or one whose `end` the disk refused, BB6) is #finishStop's;
   * 6. else Stop's turn (Q3, D4), one synchronous turn: `stopping` first, a refusal acting on nothing (UNAVAILABLE, in
   *    the store's words, retryable, as #gateAnswered refuses); then its ending, through the one setter (#endWith: the
   *    idle cleared, the replay dropped); then its lines withdrawn, its items ended and a handed turn its own line began
   *    paused (D19), before the ends, since an idle session takes a waiting line at the first await; then the host
   *    stopped, or, with none, #finish at once.
   * Q18 (a): a script's end chosen in the instant before the Stop reads `stopped` (`stopping` was kept and told, and you
   * asked); a script's `threw` words are lost in that window, inside one grace.
   * *Added 2026-11-09 (slice 14's green; Q35, ruled 2026-11-08, §M): between `restore()` and `settled()` a Stop is refused
   * retryably (startingRefused): unguarded it would end a run whose agents have not re-attached. D132–133's "needs no
   * line here" takes its dated correction in the records.* */
  async stop(run: string): Promise<FlowsStopResult> {
    if (this.#booting) throw startingRefused();
    const id = run as FlowRunId;
    const ending = this.#ends.get(id);
    if (ending !== undefined) {
      await ending.done;
      return this.#stopped(id);
    }
    const record = this.ports.records.runRecord(id);
    if (record === undefined)
      throw new RpcCallError("NOT_FOUND", words.noSuchRun(run), false, { run });
    if (!this.#isLive(record)) return { run: this.#summaryOf(record) };
    const live = this.#live.get(id);
    if (live?.ending !== undefined) {
      // N2: past close() nothing settles this wait, so the run is answered as its record reads, as close() answers one
      if (!this.#closing) await this.#endOf(id).done;
      return this.#stopped(id);
    }
    if (this.#closing) {
      this.#stopping(id, record);
      return this.#stopped(id);
    }
    if (live === undefined) return this.#finishStop(id, record);
    this.#stopping(id, record);
    const end = this.#endOf(id);
    this.#endWith(id, live, { state: "stopped" }, () => {
      this.#letGoOf(id);
      this.#pause(id, live, record);
    });
    await end.done;
    return this.#stopped(id);
  }

  /** A Stop's answer: the run as its record reads now. */
  #stopped(run: FlowRunId): FlowsStopResult {
    const record = this.ports.records.runRecord(run);
    if (record === undefined)
      throw new RpcCallError("NOT_FOUND", words.noSuchRun(run), false, { run });
    return { run: this.#summaryOf(record) };
  }

  /** D4's first step (Q3): the record's `stopping`, unless it reads so already. A write that throws acts on nothing:
   * said in fieldd's log, and refused retryably in the store's words, so the item waits on and a second Stop works. */
  #stopping(run: FlowRunId, record: FlowRunRecord): void {
    if (record.state === "stopping") return;
    try {
      this.#rewrite(run, { state: "stopping" });
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.stop",
        "A flow run's Stop could not be kept in its record; nothing was stopped",
        { run, error: messageOf(error) },
      );
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    }
  }

  /** A run's end begun, waited on by its Stops: the one standing, or a new one. */
  #endOf(run: FlowRunId): Ending {
    const standing = this.#ends.get(run);
    if (standing !== undefined) return standing;
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const ending: Ending = { done, settle };
    this.#ends.set(run, ending);
    return ending;
  }

  /** A run's end closed (#closeEnd), or left at fieldd's own stop: every Stop waiting on it answers. */
  #endClosed(run: FlowRunId, ending?: Ending): void {
    const standing = this.#ends.get(run);
    if (standing !== undefined && (ending === undefined || standing === ending))
      this.#ends.delete(run);
    ending?.settle();
    standing?.settle();
  }

  /** Slice 13 (N3) — THE ONE SETTER of a run's ending (a Stop's, D7's set-aside, J1's flood: #full): one already set is
   * kept, so the first set stands (N1). *Words (2026-11-08; J1's green, Q17): it said "later J1's flood".*
   * Else the ending is set, D1's idle cleared (so no park fires in the leave, and
   * `#rest` never writes `waiting` over `stopping`: `#park` reads no ending, and needs none past this clear) and the
   * host's replay dropped (it hears nothing more, D22); then `first`, a Stop's own step before its ends (Q3 step 3:
   * its lines, its items, its pause); then the host is stopped, and the run ends once it has left (#hostEnded), or,
   * with no host, it ends at once (#finish). */
  #endWith(run: FlowRunId, live: LiveRun, ending: RunEnd, first?: () => void): void {
    if (live.ending !== undefined) return;
    live.ending = ending;
    clearTimeout(live.idle);
    live.idle = undefined;
    live.replay = undefined;
    first?.();
    const host = live.host;
    if (host !== undefined) void host.stop();
    else this.#finish(run, ending);
  }

  /** CP-4a2b J1 (board `co-journal-byte-bound` (a), 2026-11-07: "byte bound → flood", nobody asked
   * anything; ruled 2026-11-07, seam B; orders §C, §D, §F; Proposed 2026-11-08) — a run whose journal refused its next
   * line as full (FlowJournalFull, read by `instanceof` alone: F10) ends `flood`, through the one setter (#endWith: the
   * idle cleared, the replay dropped, the host stopped, or with none #finish at once), its ending floodEnd's, so its
   * record's `log` is §9's flood sentence (F2). Said once in fieldd's log as the runs' `fieldd.flows.run.full`,
   * never the supervisor's `fieldd.flows.host.flood` (Q14). True when it ended the run; false, doing nothing, for a
   * LiveRun no longer the run's, an ending already set (Q1, F10: at most once), or past fieldd's own stop (Q11), where
   * the caller takes today's road: an act's item waits on, the refused line is not kept, and once slice 14's boot
   * wakes the run it floods again at the first line that would cross (the red skeptic's #4's words).
   * - F8 (as narrowed 2026-11-08): an ending set already stands, between the endings the runs set (`live.ending`). A
   *   supervisor's own end (`memory`, or a kill kind before its exit is heard) never reaches `live.ending`, so a line
   *   that crosses first floods over it; the window is the child's exit latency, not measured.
   * - K31 (Q12, ruled 2026-11-08 (iii)): a flood end pauses nothing and withdraws its lines only at its end (#finish), so a
   *   handed turn its line began, or a line delivered in its leave, runs on.
   * - Q21: it is the first ending set inside the supervisor's own frame handling (a call's #unhold, a log line), and
   *   `host.stop()` chooses the end in that turn, so the refused call is answered nothing, and no frame is heard
   *   after. */
  #full(run: FlowRunId, live: LiveRun, full: FlowJournalFull): boolean {
    if (this.#closing || this.#live.get(run) !== live || live.ending !== undefined) return false;
    this.#logger.warn(
      "fieldd.flows.run.full",
      "A flow run's journal would pass its bound; the run ends as a flood",
      { run, bytes: full.bytes, max: full.max },
    );
    this.#endWith(run, live, floodEnd(live.head));
    return true;
  }

  /** Q9, Q10 — a run's items ended (an answer after is refused `ended`) and its lines still waiting withdrawn, from
   * every session's queue: at every end (#finish), and earlier in Stop's turn. Each is idempotent, and each throw is
   * said in fieldd's log, so nothing refuses an end (Q6). */
  #letGoOf(run: FlowRunId): void {
    try {
      this.ports.inputs.withdraw(run);
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.withdraw",
        "A flow run's waiting lines could not be withdrawn at its end",
        { run, error: messageOf(error) },
      );
    }
    try {
      this.ports.needs.onFlowRunEnded(run);
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.items",
        "A flow run's items could not be ended at its end",
        { run, error: messageOf(error) },
      );
    }
  }

  /** D19, Q11 (a′) — at Stop alone, in its turn, before #finish lets the hands go: a handed session whose working (or
   * repairing) turn this run's own line began (`began`) is paused, once (`agents.pause`, NEVER `interrupt`, which
   * escalates to an end; a flow never ends a person's own session, ruled 2026-11-07). Never a session the run started,
   * which its end ends, and never your own turn, which no line of the run began. A pause refused is said in fieldd's
   * log and never holds the Stop. A non-Stop end pauses nothing (K31). The window, stated and OWED: a run's line in
   * flight at the Stop lands after this read, and its turn runs on, unpaused and unheard. */
  #pause(run: FlowRunId, live: LiveRun, record: FlowRunRecord): void {
    const started = new Set(this.#agentsOf(run, live.orphans).agents);
    const paused = new Set<string>();
    for (const step of record.open) {
      const session = step.session;
      if (step.handed !== true || session === undefined) continue;
      if (step.state !== "working" && step.state !== "repairing") continue;
      if (started.has(session) || paused.has(session)) continue;
      let began = false;
      try {
        began = this.ports.began(session, { run, call: step.call });
      } catch (error) {
        this.#logger.warn("fieldd.flows.step.pause", "A handed turn's start could not be read", {
          run,
          call: step.call,
          error: messageOf(error),
        });
      }
      if (!began) continue;
      paused.add(session);
      void asked(() => this.ports.agents.pause(session)).catch((error: unknown) => {
        this.#logger.warn(
          "fieldd.flows.step.pause",
          "A handed turn the Stopped run began could not be paused",
          { run, call: step.call, session, error: messageOf(error) },
        );
      });
    }
  }

  /** Q4 (a) — the agents an end ends: each session the run's steps started, by its origin (`sessions.ofRun`, one
   * port with slice 14), that lives; with the agents its failed starts left (`live.orphans`, AA3), for a read that
   * lags. Never a session it was handed: its origin is not this run's (K8). Deduped: `ended` counts sessions. A read
   * that throws is said in fieldd's log, and the end goes on (Q6).
   * *Fold 1 (2026-11-07; the green skeptic's #1): an orphan the same read lists as exited is gone already, so it is
   * neither ended nor counted, as an exited `ofRun` row is not. An orphan the read omits (it lags), or every orphan when
   * the read throws, is ended and counted as it stands: so one that exited unseen counts one too many, the read's lag
   * (AA3).*
   * *Fold 3 (2026-11-07; the fold 2 skeptic's #2): the same one read also names each agent's call (EndAgents'
   * `agentOf`): each live row's `call`, and each orphan's own, which stands over a row of its call. An exited agent is
   * in neither list: it is never ended, so never refused. No end reads `ofRun` twice.* */
  #agentsOf(run: FlowRunId, orphans: ReadonlyMap<number, string> | undefined): EndAgents {
    const agents = new Set<string>();
    const exited = new Set<string>();
    const agentOf = new Map<number, string>();
    try {
      for (const session of this.ports.sessions.ofRun(run)) {
        (session.live ? agents : exited).add(session.runtimeRunId);
        if (session.live) agentOf.set(session.call, session.runtimeRunId);
      }
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.agents",
        "A flow run's agents could not be read at its end",
        { run, error: messageOf(error) },
      );
    }
    for (const [call, orphan] of orphans ?? []) {
      if (exited.has(orphan)) continue;
      agents.add(orphan);
      agentOf.set(call, orphan);
    }
    return { agents: [...agents], agentOf };
  }

  /** Q5 (b) — each agent ended, at once (`Promise.allSettled`): the sessions whose end the floor refused, each said
   * in fieldd's log (`fieldd.flows.step.end`), uncounted. */
  async #endAgents(run: FlowRunId, agents: readonly string[]): Promise<ReadonlySet<string>> {
    const settled = await Promise.allSettled(
      agents.map((agent) => asked(() => this.ports.agents.end(agent))),
    );
    const refused = new Set<string>();
    settled.forEach((result, i) => {
      const agent = agents[i];
      if (result.status === "fulfilled" || agent === undefined) return;
      refused.add(agent);
      this.#logger.warn(
        "fieldd.flows.step.end",
        "A flow run's agent could not be ended at its end; its step stays as it stands",
        { run, runtimeRunId: agent, error: messageOf(result.reason) },
      );
    });
    return refused;
  }

  /** Slice 13 (Q12 (b), Q14 (b)) — the Stop of a run no LiveRun drives, read from its journal: a fresh FlowRuns' (the
   * boot's half of D4; slice 14 hands each `stopping` run here), and in one life a run whose end the disk refused (BB6).
   * - A journal that does not read `kept` is answered as its record stands, and said in fieldd's log; one read `lost`
   *   raises its item first (#forged, Q12 (a)).
   *   *Corrected 2026-11-09 (the fold's P13; the skeptic's #11, LOW): it said "is slice 14's forged road: until then it is
   *   answered as its record stands". Slice 14 built that road.*
   * - A kept `end` line: the record alone takes its state, `ended` and `host` from it (D4's reason for the record), its
   *   open steps ended, every one its journal does not answer, a refused agent's step among them
   *   (the `end` names no refusal), and `calls` from the journal; no second `end`, nothing ended,
   *   no tell. N5: a line that names the host fieldd ended takes §9's sentence for it as `log`; leftTwice's words and
   *   D7's, which no `end` line holds, are lost on this road. Its items and lines are let go BEFORE the record write
   *   (fold 1, the green skeptic's #5): a write the disk refuses is refused retryably, but leaves the record in its
   *   state before the end with its items already ended, so only the door's Stop (or the boot) writes it, never an
   *   item; its lines, which an ended run must never deliver, are withdrawn either way.
   *   *Words (2026-11-07; ruled 2026-11-07, orders §K): it said its open steps were ended "as the
   *   end's write would have". They are not: the end's own write keeps a refused agent's step open
   *   (endSteps' `refused`), and this road has no refusal to match. Slice 14 rules it (the fold 3
   *   skeptic's LOW #1).*
   *   *Dated 2026-11-09 (slice 14's green; Q2 (e), RR:314–315): "nothing ended" holds. At the boot this road (#settleKept,
   *   Q2 (b), (c)) reads the run's agents once, `#agentsOf(run, undefined)`, and hands endSteps every live agent as
   *   refused, so a step whose agent works on stays open; BB6's one-life Stop keeps today's empty sets, stated. It ends
   *   none: the read only keeps a step open. And `endedAt` is the line's own `at` (Q2 (d)), never this clock.*
   * - No `end` line: `stopping`, unless the record reads it (refused as Stop's turn refuses), then #finish, its
   *   head and its answers from the journal, which ends the agents its steps started, by their origin, then #closeEnd,
   *   `calls` from its journal (Q7: this road closes ZZ3's window for each run it ends).
   * Items and lines are withdrawn on both roads (a kill may have come first). Never a `flowItem`, never a wake.
   * BB6's window, stated: #finish deletes the LiveRun before its `end` append, so a refused `end` line loses an ending
   * set first (D7's `lost`, J1's `flood`), and this Stop ends the run `stopped`. *Words (2026-11-08; J1's green,
   * Q17): it said "later J1's `flood`".* Only a disk refusal reaches it (J1's bound never refuses an `end`, Q5),
   * and such a run holds its bound until a Stop or the boot: `#unkept`, which would free it sooner, is OWED. */
  async #finishStop(
    run: FlowRunId,
    record: FlowRunRecord,
    booting = false,
  ): Promise<FlowsStopResult> {
    const read = this.ports.records.readRun(run);
    if (read.kind !== "kept") {
      // slice 14 (Q12 (a)): "slice 14's forged road": its item, named from the record in hand
      if (read.kind === "lost") this.#forged({ run, head: headOf(record) });
      this.#logger.warn(
        "fieldd.flows.run.stop",
        "A flow run's journal reads as none VibeField keeps; its Stop answers it as it stands",
        { run, read: read.kind },
      );
      return { run: this.#summaryOf(record) };
    }
    if (read.lines.some((line) => line.kind === "end")) {
      this.#settleKept(run, read, booting);
      return this.#stopped(run);
    }
    const head = headOf(read.head);
    const settles = settlesOf(read);
    const calls = read.lines.filter((line) => line.kind === "call").length;
    this.#stopping(run, record);
    const end = this.#endOf(run);
    this.#finish(run, { state: "stopped" }, { head, settles, calls });
    await end.done;
    return this.#stopped(run);
  }

  /** Slice 14 (Q2 (b), (c), (d)) — a kept `end` line settled on the record: THE ONE helper, its read in hand, for
   * #finishStop's kept-`end` road and the boot. No second `end`, no agent ended, no tell. Its items and lines are let go
   * before the write (fold 1's #5: a refused write leaves these items ended). At the boot (`booting`, Q2 (c)(ii)) a step
   * whose agent the run's one read lists live stays open in its true state, and the read is why this settle waits for
   * `settled()`: `ofRun` reads an empty fold before the re-attach. Its one-life gap, stated: BB6's Stop reads no agents,
   * so a step whose agent's end was refused reads `ended`. */
  #settleKept(run: FlowRunId, read: KeptRead, booting: boolean): void {
    const kept = read.lines.find((line) => line.kind === "end");
    if (kept?.kind !== "end") return;
    const head = headOf(read.head);
    const settles = settlesOf(read);
    const calls = read.lines.filter((line) => line.kind === "call").length;
    const { agents, agentOf } = booting
      ? this.#agentsOf(run, undefined)
      : { agents: [], agentOf: new Map<number, string>() };
    const refused = new Set(agents);
    this.#letGoOf(run);
    const host = kept.host;
    const named = (FLOW_HOST_ENDINGS as readonly string[]).includes(host ?? "")
      ? (host as FlowHostEnding)
      : undefined;
    try {
      this.#replace(
        run,
        (start) => ({
          ...endSteps(start, settles.answered, refused, agentOf),
          state: kept.state,
          calls,
          endedAt: kept.at,
          ...(host !== undefined ? { host } : {}),
          ...(kept.ended !== undefined && kept.ended > 0 ? { ended: kept.ended } : {}),
          ...(named !== undefined ? { log: words.hostEnded(head.name, named) } : {}),
        }),
        { live: settles },
      );
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.stop",
        "A flow run's kept end could not be written in its record; its next Stop writes it",
        { run, error: messageOf(error) },
      );
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    }
  }

  /** The runs' side of their items (the needs queue's FlowItemActs, bound in slice 15), an answer handed on once. */
  readonly acts: FlowItemActs = {
    answer: (answer) => this.#answered(answer),
    start: async (start) => this.#acted(start),
  };

  /** fieldd's own stop: every host stopped, each run left as its journal and record say, for the next boot.
   * Slice 13 (Q17 (a)): every Stop waiting on an end is settled here, and answers the run as its record reads: a Stop
   * in its leave reads `stopping` (durable short of a power loss, item 231), which the boot finishes (D4). N2, stated:
   * a Stop that waits on ANOTHER ending's leave (N1) answers `running`, since no end is written at #closing; that run
   * replays, and ends as its next life does. And a Stop past close() on a run whose non-Stop end is still in its tail
   * (no `#ends` entry, no LiveRun) writes `stopping` over the record's pre-end state, so the boot then finishes it
   * `stopped` (fold 1, the green skeptic's #9). An end's tail past this leaves at its next await (#tail). */
  async close(): Promise<void> {
    this.#closing = true;
    this.#offTurns();
    // slice 14 (Q34): in the turn that sets `#closing`, so past it neither is heard
    this.#offEnded();
    this.#offResumed();
    this.#listeners.clear();
    for (const [run, live] of this.#live) {
      this.#letGo(run, live);
      clearTimeout(live.idle);
    }
    for (const run of [...this.#ends.keys()]) this.#endClosed(run);
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
      if (this.ports.host.launch.kind === "unconfigured") throw hostless();
      // G2 (CP-L4, TL-D5): a spark's start, its own or a Run in its thread (CP4-Q20 (a)), narrows again to the spark's
      // Agent Profiles now, as an Allow does; a spark that is gone starts nothing
      const spark = start.starter.spark;
      const known = spark !== undefined ? this.ports.sparkOf(spark) : undefined;
      if (spark !== undefined && known === undefined) throw refused("no-spark", words.noSpark());
      const now = known?.profiles;
      const scope =
        now !== undefined ? start.scope.filter((profile) => now.includes(profile)) : start.scope;
      // V5, AA1 (the 1b and 1e reviews): a start the spark's narrowing leaves no Agent Profile starts nothing, before
      // any approval, as an Allow refuses its spawn; it is said in the spark's words, since that narrowing is the cause
      if (known !== undefined && start.scope.length > 0 && scope.length === 0)
        throw refused("no-profiles", words.noSparkProfiles(nameWords(known.name)));
      const params: FlowRunStartParams = {
        flow: act.flow,
        input: start.input,
        starter: start.starter,
        scope,
        ...(act.from !== undefined ? { from: act.from } : {}),
      };
      // H1 (R4–R6 review): the one you approved is the approval standing NOW, read at the act, never the one that
      // stood at the ask (the item's `hash`); a flow with none standing starts nothing
      const standing = this.ports.records.approval(act.flow);
      if (act.version === "approved") {
        if (standing === undefined) throw refused("version", words.notAVersion(act.flow));
        begun = this.#begin(params, standing.hash);
      } else {
        // Run this version: the library's bytes, while they are still the version the item asked about
        const file = this.ports.library.read(act.flow);
        if (file === undefined) throw refused("not-found", words.notFound(act.flow));
        if ("tooBig" in file) throw refused("too-big", words.tooBig());
        if (file.hash !== act.hash) throw refused("version", words.notAVersion(act.flow));
        // H3: a version that already stands runs as it stands, never approved again, so its approval keeps its
        // approvedAt and the proposal it came from. NN3 (the version review; ruled 2026-11-06): its bytes are
        // kept again first, from the library's file, whose hash IS the standing one, so kept bytes edited in place
        // (set aside as forged) never refuse the version the library holds, as approve's keep did before H3. The keep
        // approves nothing and writes only bytes not kept
        const stands = standing?.hash === file.hash;
        if (stands) this.ports.records.keep(file.bytes);
        begun = this.#begin(params, file.hash, stands ? undefined : file.bytes);
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
    // Q-a (ruled 2026-11-06): a script its static read refuses, by a rule newer than its approval, starts nothing,
    // in the read's own words (the sentence flows.read gives it): one reader, one gate. Its approval stands. NN1
    // (the version review; ruled 2026-11-06): those words are said in §9's frame, the flow named as the
    // start's other refusals name it, with the line the read names, or none for a whole-file refusal
    const unread = read.refusals[0];
    if (unread !== undefined)
      throw refused("read", words.readRefused(name, unread.words, unread.line));
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
      // GG1 (the F6 review), JJ1 (its 1l review): the folder the run holds, its first input's, is checked: one its
      // head can't hold, empty or past FLOW_LIMITS.FOLDER_CHARS, is the input's refusal here, before the begin is
      // checked and any approval kept, never passed over for the next input's. A later input's folder, which nothing
      // of the run's uses, is not checked
      if (folder === undefined) {
        if (found === "" || found.length > FLOW_LIMITS.FOLDER_CHARS)
          throw refused(`input-${kind}`, words.folderUnusable(kind));
        folder = found;
      }
    }
    if (
      folder === undefined &&
      read.calls.some((call) => call.in !== true && call.computed !== true && call.cwd !== true)
    )
      throw refused("folder", NO_FOLDER);
    // D3: the bounds, from the records, read with no await before the run begins
    const kept = records.runRecords();
    // V2: a run that never began, its record's ending refused too, is passed by until the next boot settles it
    const live = kept.filter((record) => this.#isLive(record));
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
    // V5, AA1: a start the profiles that exist leave none starts nothing, whoever's it is, said by that cause
    if (params.scope.length > 0 && scope.length === 0)
      throw refused("no-profiles", words.noProfiles());
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
        {
          run,
          flow: params.flow,
          name,
          n,
          hash,
          starter: params.starter,
          input: params.input,
          // F6 (slices 7–9 review): the folder its input names, found above, held on its head for its steps
          ...(folder !== undefined ? { folder } : {}),
        },
        { scope, state: "running", calls: 0, open: [], steps: [] },
      );
    } catch (error) {
      // V2 (1b review): a record kept before the failure (its head refused) reads as never begun in this life too
      this.#unbegin(run, name);
      throw this.#refusal(run, error, words.neverBegan(name));
    }
    this.#live.set(
      run,
      this.#liveRun(
        headOf(head),
        params.from !== undefined && params.starter.by === "spark"
          ? nameWords(params.from.name)
          : undefined,
        false,
      ),
    );
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

  /** Slice 14 (Q3) — one LiveRun factory for `#begin` and the boot: `orphans`, `starting`, `starts` and the rest empty,
   * no start being in flight at either. */
  #liveRun(head: RunHead, ran: string | undefined, booted: boolean): LiveRun {
    return {
      waiting: new Set(),
      forms: new Map(),
      misses: new Map(),
      slotted: [],
      hands: new Map(),
      orphans: new Map(),
      starting: new Set(),
      starts: new Set(),
      lines: 0,
      answered: new Map(),
      holds: new Map(),
      head,
      ...(ran !== undefined ? { ran } : {}),
      booted,
      unheard: new Set(),
      unsent: new Map(),
      made: new Map(),
      acting: new Set(),
    };
  }

  /** Slice 14 (Q3 (a)) — the queue's open flow items; a queue that does not answer seeds nothing, said in fieldd's log. */
  #openItems(): readonly NeedsItem[] {
    try {
      return this.ports.needs.flowItems();
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.items", "The needs queue's items could not be read", {
        error: messageOf(error),
      });
      return [];
    }
  }

  /** Slice 14 (Q10, D5's four rows) — each open step's lines against its session's kept queue, read in `restore()`
   * before a poke can shift a stamped head. A line `sending` that no queue holds is kept for its re-make; one the queue
   * holds unstamped writes `queued`, stamped `uncertain` (never sent again); `queued` and absent is left. A queue that
   * can't be read decides nothing for that step: the next boot does. */
  #linesRead(run: FlowRunId, record: FlowRunRecord): LinesRead {
    const unsent = new Map<number, readonly UnsentLine[]>();
    const marks: (UnsentLine & { readonly call: number; readonly sent: string })[] = [];
    for (const step of record.open) {
      if (step.session === undefined || step.lines === undefined) continue;
      let queued: readonly AgentQueuedInput[];
      try {
        queued = this.ports.inputs.pending(step.session);
      } catch (error) {
        this.#logger.warn("fieldd.flows.run.lines", "A flow step's queue could not be read", {
          run,
          call: step.call,
          error: messageOf(error),
        });
        continue;
      }
      for (const { line, n, sent } of step.lines) {
        if (sent !== "sending" && sent !== "queued") continue;
        const held = queued.find((input) => isLineOf(input, run, step.call, line, n));
        if (held === undefined) {
          if (sent === "sending")
            unsent.set(step.call, [...(unsent.get(step.call) ?? []), { line, n }]);
        } else if (held.sending !== undefined)
          marks.push({ call: step.call, line, n, sent: "uncertain" });
        else if (sent === "sending") marks.push({ call: step.call, line, n, sent: "queued" });
      }
    }
    return { unsent, marks };
  }

  /** Slice 14 (D2's table, Q2) — a live record as its journal reads: adopted (kept); a kept `end` left for `settled()`,
   * unadopted, as a `stopping` record is (Q2 (c)); never begun (Z2, BB5); forged or cut (Q12); or a newer VibeField's,
   * unread (Q19). */
  #adoptRead(
    record: FlowRunRecord,
    read: FlowRunRead,
    lines: LinesRead,
    items: readonly NeedsItem[],
  ): void {
    const run = record.run;
    switch (read.kind) {
      case "kept":
        if (read.lines.some((line) => line.kind === "end")) this.#stopsOwed.set(run, read);
        else this.#adopt(record, read, lines, items);
        return;
      case "unbegun":
        this.#unbegin(run, record.name);
        return;
      case "lost":
        this.#forged({ run, head: headOf(record) });
        return;
      case "newer":
        this.#unread.add(run);
        return;
      case "absent":
        return;
    }
  }

  /** Slice 14 (Q3, Q4, Q9–Q11) — a run adopted: its LiveRun seeded from what its journal and the queue hold (`head`,
   * `answered`, each kind's holds, `misses`, `unheard`, `unsent`, `ran`); an item its journal answers ended (R36's boot
   * case); then one write, its rest (Q4): `waiting` (`holding` while held), `calls` counted from the journal it read, the
   * lines D5 marked. A state word this VibeField does not know is not rested. A write that throws is logged and left to
   * the next (T4's shape). `ran`, for a spark since deleted, is none, and the mark reads "a flow you ran": false, rare,
   * OWED (D204). */
  #adopt(
    record: FlowRunRecord,
    read: KeptRead,
    lines: LinesRead,
    items: readonly NeedsItem[],
  ): void {
    const run = record.run;
    const head = headOf(read.head);
    const spark = head.starter.by === "spark" ? head.starter.spark : undefined;
    const known = spark !== undefined ? this.ports.sparkOf(spark) : undefined;
    const live = this.#liveRun(head, known !== undefined ? nameWords(known.name) : undefined, true);
    live.answered = settlesOf(read).answered;
    for (const item of items) {
      const call = item.run?.call;
      if (item.run?.run !== run || call === undefined || !isRunItem(item.kind)) continue;
      if (live.answered.has(call)) this.#endItem(run, item.id);
      else live.holds.set(call, { item: item.id, kind: item.kind });
    }
    for (const step of record.open) {
      if (step.miss !== undefined) live.misses.set(step.call, step.miss);
      if (step.session !== undefined && !(step.lines ?? []).some((l) => l.line === "unheard"))
        live.unheard.add(step.call);
      const unsent = lines.unsent.get(step.call);
      if (unsent !== undefined) live.unsent.set(step.call, unsent);
    }
    this.#live.set(run, live);
    const rests = flowRunStateOf(record) !== undefined;
    const calls = read.lines.filter((line) => line.kind === "call").length;
    try {
      this.#replace(run, (start) => ({
        ...start,
        ...(rests ? { state: "waiting" } : {}),
        calls,
        open: start.open.map((step) => ({
          ...step,
          ...(step.lines !== undefined ? { lines: marked(step.call, step.lines, lines) } : {}),
        })),
      }));
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.rest", "A booted flow run's rest was not kept", {
        run,
        error: messageOf(error),
      });
    }
  }

  /** Slice 14 (Q12 (a)) — a run whose journal, or its record, reads as none VibeField kept: its one item (`flow-lost`,
   * whole-run, Stop its one act), named from what its head kept, its spark told `factSetAside` when minted (Q15); its
   * other items ended. No LiveRun and no hold: the record went first (`#lost`), so a raise that throws is said at error
   * and the run is gone with no card, a stated window (D553–554). */
  #forged({ run, head }: ForgedRun): void {
    const { needs } = this.ports;
    let raised: FlowItemRaised;
    try {
      raised = needs.flowItem({
        kind: "flow-lost",
        run: { run, flow: head.flow },
        name: head.name,
        ...(head.starter.by === "spark" && head.starter.spark !== undefined
          ? { spark: head.starter.spark }
          : {}),
        words: words.cantTrust(head.name),
        acts: [],
      });
    } catch (error) {
      this.#logger.error(
        "fieldd.flows.run.forged",
        "A forged flow run's item could not be raised",
        {
          run,
          error: messageOf(error),
        },
      );
      return;
    }
    for (const item of this.#openItems())
      if (item.run?.run === run && item.id !== raised.id) this.#endItem(run, item.id);
    if (raised.minted) this.#tell(run, "lost", words.factSetAside, head);
  }

  /** Slice 14 (Q3) — the open flow items of runs the walk did not adopt: ended when its run's record reads ended (a
   * needs store that refused that item's write), and when its run reads absent, but a gone run's whole-run `flow-lost`
   * (Q12's card), and never a run unread or a newer VibeField's (Q19): `runRecord` reads undefined for that, so
   * `recordIsNewer` is read first. An adopted run's items were swept at its adoption. */
  #sweep(items: readonly NeedsItem[]): void {
    const { records } = this.ports;
    for (const item of items) {
      const run = item.run?.run as FlowRunId | undefined;
      if (run === undefined || this.#live.has(run)) continue;
      if (this.#unread.has(run) || this.#stopsOwed.has(run)) continue;
      try {
        if (records.recordIsNewer(run)) continue;
        const record = records.runRecord(run);
        const ended =
          record !== undefined
            ? !this.#isLive(record)
            : !(item.kind === "flow-lost" && item.run?.call === undefined) &&
              records.readRun(run).kind === "absent";
        if (ended) this.#endItem(run, item.id);
      } catch (error) {
        this.#logger.warn("fieldd.flows.run.sweep", "A flow item's run could not be read", {
          run,
          error: messageOf(error),
        });
      }
    }
  }

  /** One item ended, said in fieldd's log if it can't be (Q3, Q20). */
  #endItem(run: FlowRunId, item: NeedsItemId): void {
    try {
      this.ports.needs.endFlowItem(item);
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.item", "A flow run's item could not be ended", {
        run,
        item,
        error: messageOf(error),
      });
    }
  }

  /** Slice 14 (Q12 (a)) — a journal with no record, read once, which sets it aside, and its run raised by its head
   * (#forged). The fold's P5: its size is read first, and a journal past `left`, the budget restore() has left, waits
   * for `settled()`, which passes none. The bytes to count, none for one left waiting. Each in its own try. */
  #readUnrecorded(run: FlowRunId, left = Number.POSITIVE_INFINITY): number {
    const { records } = this.ports;
    let bytes = 0;
    try {
      bytes = records.journalBytes(run) ?? 0;
      if (bytes > left) {
        this.#unrecordedOwed.push(run);
        this.#unread.add(run);
        return 0;
      }
      const read = records.readRun(run);
      if (read.kind === "lost" && read.head !== undefined)
        this.#forged({ run, head: headOf(read.head) });
      else
        this.#logger.warn(
          "fieldd.flows.run.restore",
          "A flow journal with no record names no flow; nothing can be raised for it",
          { run, read: read.kind },
        );
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.restore",
        "A flow journal with no record could not be read at the boot",
        { run, error: messageOf(error) },
      );
    }
    return bytes;
  }

  /** One macrotask between the boot's steps (Q33 (c)): false once fieldd is closing. */
  async #paced(): Promise<boolean> {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    return !this.#closing;
  }

  /** Slice 14 (Q2, Q5, Q14) — a run `restore()` left `stopping` or holding a kept `end`, finished: never awaited, its
   * refusal logged, unless a Stop has reached it first. */
  #handOver(run: FlowRunId): void {
    const kept = this.#stopsOwed.get(run);
    this.#stopsOwed.delete(run);
    try {
      const record = this.ports.records.runRecord(run);
      if (record === undefined || !this.#isLive(record) || this.#ends.has(run)) return;
      if (kept !== undefined) this.#settleKept(run, kept, true);
      else
        void this.#finishStop(run, record, true).catch((error: unknown) => {
          this.#logger.warn("fieldd.flows.run.stop", "A boot's owed Stop did not finish", {
            run,
            error: messageOf(error),
          });
        });
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.stop", "A boot's owed Stop did not finish", {
        run,
        error: messageOf(error),
      });
    }
  }

  /** Slice 14 (Q33 (b), §K) — a run past the budget, adopted by `settled()` alone, its lines as `restore()` read them:
   * unless a Stop reached it, or a read throws (it stays unread, its items waiting). True when it read and adopted the
   * run, so `settled()` takes a macrotask before the wake reads the journal again (the fold's P3). */
  #adoptLate(run: FlowRunId): boolean {
    const lines = this.#pastBudget.get(run);
    if (lines === undefined) return false;
    this.#pastBudget.delete(run);
    this.#unread.delete(run);
    try {
      const { records } = this.ports;
      const record = records.runRecord(run);
      if (record !== undefined && this.#isLive(record) && !this.#ends.has(run)) {
        this.#adoptRead(record, records.readRun(run), lines, this.#openItems());
        return true;
      }
    } catch (error) {
      this.#unread.add(run);
      this.#logger.warn(
        "fieldd.flows.run.restore",
        "A flow run past the boot's budget could not be read; its next boot reads it, and its items wait",
        { run, error: messageOf(error) },
      );
    }
    return false;
  }

  /** Slice 14 (Q5, Q13, Q30) — NN5's newer read, then the wake. Bytes a read rule newer than their approval refuses end
   * the run `failed` in §9's words, through the one setter, no host; `log`'s bound is FLOW_LOG_MAX. */
  #wakeBooted(run: FlowRunId): void {
    const live = this.#live.get(run);
    if (live === undefined) return;
    try {
      const { records } = this.ports;
      const record = records.runRecord(run);
      if (record === undefined || !this.#isLive(record)) return;
      const bytes = records.bytes(record.hash);
      const unread = bytes !== undefined ? readFlow(bytes).refusals[0] : undefined;
      if (unread !== undefined) {
        const log = words.readRefused(live.head.name, unread.words, unread.line);
        this.#endWith(run, live, { state: "failed", log: oneLineWords(log, FLOW_LOG_MAX) });
        return;
      }
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.wake", "A booted flow run could not be read", {
        run,
        error: messageOf(error),
      });
      return;
    }
    this.#rouse(run);
  }

  /** A run whose record `#begin` kept, its host started: the record read back, then woken (`#wake`), then the list
   * told. Past the record nothing throws (W1). A read the disk refuses, or a host that does not start, leaves the run
   * running for the next boot to wake (slice 14): it is answered as its record, or `#begin`, says it, and the list is
   * told (W2). A record that reads back as nothing (set aside, held), or a journal that reads as none VibeField keeps,
   * is no run this VibeField can wake (W3): it answers none, and its record is ended never begun. A woken run is
   * answered as `#wake` left its record (Z4): one whose bytes are gone was ended lost there.
   * The split (Z5, 1d review): a disk that refuses a write is the store degraded, UNAVAILABLE {service: flows} in the
   * store's sentence (V4, `#refusal`); the run's own files read as none VibeField keeps while the store answers is
   * PRECONDITION_FAILED never-began, in §9's words (W3, here). */
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
      return record !== undefined ? this.#summaryOf(record) : begun.written;
    }
    if (record === undefined || !woke) {
      this.#logger.warn(
        "fieldd.flows.run.unkept",
        "A flow run's record or journal reads as none VibeField keeps; the run never began",
        { run, record: record !== undefined },
      );
      const live = this.#live.get(run);
      this.#live.delete(run);
      if (live !== undefined) this.#letGo(run, live);
      this.#unbegin(run, begun.name);
      return undefined;
    }
    let woken = record;
    try {
      woken = this.ports.records.runRecord(run) ?? record;
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.reread",
        "A woken flow run's record could not be read again",
        { run, error: messageOf(error) },
      );
    }
    this.#told();
    return this.#summaryOf(woken);
  }

  /** V2 (1b review) — a run whose record was kept and whose begin then failed (its head refused, or its record or
   * journal reading as none kept) reads as never begun in this life too: its record ended `failed`, in neverBegan's
   * words, where the disk takes it; where it does not, the bounds pass it by until D18's reader settles it at boot. */
  #unbegin(run: FlowRunId, name: string): void {
    const { records } = this.ports;
    const endedAt = this.#now().toISOString();
    const ending = { state: "failed", endedAt, log: words.neverBegan(name) } as const;
    try {
      // Z2 (1d review): a record with no journal (its head refused) names no synced line, so it is ended by the store's
      // never-began end; one whose journal stands is written as every record is
      const read = records.readRun(run);
      if (read.kind === "unbegun") {
        records.endUnbegun(run, { ...startOf(read.record), ...ending });
        this.#told();
        return;
      }
      if (records.runRecord(run) === undefined) return;
      this.#rewrite(run, ending);
    } catch (error) {
      this.#unbegun.set(run, endedAt);
      this.#logger.warn(
        "fieldd.flows.run.unbegun",
        "A flow run that never began could not be ended in its record; the bounds pass it by until fieldd restarts",
        { run, error: messageOf(error) },
      );
      // BB1 (1f+1g review): its subscribers hear it as list() now reads it, failed, as the ended road tells them
      this.#told();
    }
  }

  /** Whether a record's run is live in this life: its record says so, and it is no run found never begun (V2). */
  #isLive(record: FlowRunRecord): boolean {
    return isLive(record) && !this.#unbegun.has(record.run);
  }

  /** A run's summary as this life reads it (Z3, 1d review): its record's, and a run found never begun whose ending
   * the disk did not take failed, in §9's words, its record left as the disk keeps it. */
  #summaryOf(record: FlowRunRecord): RunSummary {
    const summary = summaryOf(record, this.#live.get(record.run));
    const endedAt = this.#unbegun.get(record.run);
    if (endedAt === undefined) return summary;
    return { ...summary, state: "failed", log: words.neverBegan(record.name), endedAt };
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
   * (D8). Bytes that no longer hash are lost, and so is the run. False for a journal that reads as none kept (W3).
   * D1, CL-K-d (R29): at most HOSTS_LIVE_MAX hosts run at once; a wake past them waits, in the order it asked, its run
   * at rest (`waiting`, or `holding` while the person holds it: `#rest`), and starts when one leaves (`#nextHost`). */
  #wake(run: FlowRunId, record: FlowRunRecord): boolean {
    const { records } = this.ports;
    const live = this.#live.get(run);
    if (live === undefined) throw new Error(`${run} is not a run this fieldd drives`);
    const read = records.readRun(run);
    if (read.kind !== "kept") return false;
    // slice 14 (Q13, NN5): a copy that can't start a host rests a booted run in §9's sentence: a reinstall keeps it
    if (this.ports.host.launch.kind === "unconfigured") {
      this.#rewrite(run, { state: "waiting", log: words.hostUnconfigured() });
      return true;
    }
    // MED-1: the run's own facts again, from the head this wake read, for its raises (#hold)
    live.head = headOf(read.head);
    // P14 (D22): the calls the journal answers, read from it at every wake: the one writer journals none of them again,
    // and the wake's own record write settles a step its journal answers (XX4)
    live.answered = new Map(
      read.lines.flatMap((line) => (line.kind === "answer" ? [[line.call, answeredOf(line)]] : [])),
    );
    const bytes = records.bytes(record.hash);
    if (bytes === undefined) {
      this.#finish(run, { state: "lost", log: words.cantTrust(live.head.name) });
      return true;
    }
    if (this.#hostsLive() >= FLOW_LIMITS.HOSTS_LIVE_MAX) {
      if (!this.#hostQueue.includes(run)) this.#hostQueue.push(run);
      this.#rest(run);
      return true;
    }
    // F6: the head's folder, held at the run's start; a head from before it derives one from its input here, at each
    // wake, so a restart may derive another (GG2)
    live.folder =
      read.head.folder ?? this.#folderOf(read.head.input ?? {}, readFlow(bytes).meta?.input ?? {});
    // D10, R13e: the record counts every call line its journal holds, one a kill kept from its record among them; a
    // woken run reads `running` again
    const counted = read.lines.filter((line) => line.kind === "call").length;
    if (record.state !== "running" || record.calls !== counted)
      this.#rewrite(run, { state: "running", calls: counted });
    const calls: HostCalls = { out: 0 };
    const replay = new FlowReplay({
      prior: read.lines,
      append: (entry, args) => this.#appended(run, live, entry, args),
      inner: this.#inner(run, live),
    });
    // D1: every frame the host sends but its pongs reaches the runs here, so its idle is read here, by its own count
    const handler: FlowCallHandler = {
      call: async (call) => {
        calls.out += 1;
        this.#heard(run, live, calls);
        try {
          // D21 (the 10b fix's delta review, #8): every answer takes the same hops from `replay.call` to the pipe, and
          // the supervisor's `then` is attached as this returns; a hop on one answer's road alone reorders what the
          // script hears (R28c)
          return await replay.call(call);
        } finally {
          calls.out -= 1;
          this.#heard(run, live, calls);
        }
      },
      log: (text) => {
        this.#heard(run, live, calls);
        replay.log(text);
      },
    };
    const host = startFlowHost({
      ...this.ports.host,
      bytes,
      input: read.head.input ?? {},
      handler,
      logger: this.#logger,
    });
    live.host = host;
    live.calls = calls;
    live.replay = replay;
    void host.ended
      .then((end) => this.#ended(run, end, calls))
      .catch((error: unknown) => {
        this.#logger.error("fieldd.flows.run.ended", "A flow run's host end was not kept", {
          run,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  /** The hosts running now, one leaving among them: a run never holds two, so HOSTS_LIVE_MAX counts true (R27d). */
  #hostsLive(): number {
    let hosts = 0;
    for (const live of this.#live.values()) if (live.host !== undefined) hosts += 1;
    return hosts;
  }

  /** CL-K-d (R29): a host left, so the runs waiting for one start, in the order they asked, while one is free. */
  #nextHost(): void {
    while (
      !this.#closing &&
      this.#hostQueue.length > 0 &&
      this.#hostsLive() < FLOW_LIMITS.HOSTS_LIVE_MAX
    ) {
      const run = this.#hostQueue.shift();
      if (run !== undefined) this.#rouse(run);
    }
  }

  /** D1 — a frame heard from the host `calls` counts for, or an answer it was sent: its idle starts again. A host with
   * a call out and no frame but pongs for HOST_IDLE_MS is parked; one with none out is never parked by its idle. */
  #heard(run: FlowRunId, live: LiveRun, calls: HostCalls): void {
    if (live.calls !== calls || live.parking === true || live.ending !== undefined) return;
    clearTimeout(live.idle);
    live.idle =
      calls.out > 0
        ? setTimeout(() => this.#park(run, live, calls), this.ports.hostIdleMs ?? HOST_IDLE_MS)
        : undefined;
  }

  /** D1 — a waiting host parked: a `stop()` the runs ask for, its run read as `waiting` (`holding`, while the person
   * holds it), never stopped or failed, and its journal given no line, though synced as it stands, its log lines with
   * it (D13). Its step's answer, journaled, wakes it. D22: its replay hears nothing more. D7: this is the ONE moment
   * that decides, park or set aside (`#aside`), never both. */
  #park(run: FlowRunId, live: LiveRun, calls: HostCalls): void {
    const host = live.host;
    if (this.#closing || host === undefined || live.calls !== calls || live.parking === true)
      return;
    if (calls.out === 0) return;
    live.idle = undefined;
    const stuck = live.replay?.stuck();
    if (stuck !== undefined) {
      this.#aside(run, live, stuck);
      return;
    }
    live.parking = true;
    live.replay = undefined;
    try {
      this.ports.records.syncRun(run);
      this.#rest(run);
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.park",
        "A parked flow run's record could not say it waits",
        { run, error: messageOf(error) },
      );
    }
    void host.stop();
  }

  /** D7 — a quiet host whose replay can't go on: its run set aside `lost`, in §9's words (a new call held is what the
   * script asked instead; else it didn't ask again what it asked before), said in fieldd's log at warn
   * (`fieldd.flows.run.aside`) and kept on its record at its end, as leftTwice's are. Its host is stopped, and the run
   * ends when it has left (`#hostEnded`), so it holds its place among HOSTS_LIVE_MAX until then; nothing is journaled
   * for it in that leave (`#answer`), and it is never carried on by a spawn. Slice 13 (N3): its ending is set through
   * the one setter (#endWith), as a Stop's is. */
  #aside(run: FlowRunId, live: LiveRun, stuck: FlowReplayStuck): void {
    const name = this.#nameOf(run);
    const log = stuck === "new" ? words.asideNew(name) : words.asideUnmatched(name);
    this.#endWith(run, live, { state: "lost", log });
    this.#logger.warn(
      "fieldd.flows.run.aside",
      "A flow run's script, run again, can't match its journal; the run is set aside",
      { run, stuck, log },
    );
  }

  /** A run's mark's name, as its record keeps it; its id where the record can't be read (a timer's road never
   * throws). */
  #nameOf(run: FlowRunId): string {
    try {
      return this.ports.records.runRecord(run)?.name ?? run;
    } catch {
      return run;
    }
  }

  /** D1 — a run woken in this life: its step's answer journaled, or its host left with no call out. A parked host
   * still leaving is waited for (R27d), and a wake past HOSTS_LIVE_MAX waits its turn (`#wake`). A wake that can't
   * read its run is said in fieldd's log, never thrown into the journal's road: its next answer, or the next boot,
   * wakes it. */
  #rouse(run: FlowRunId): void {
    const live = this.#live.get(run);
    if (live === undefined || this.#closing || this.#booting || this.#hostQueue.includes(run))
      return;
    if (live.host !== undefined) {
      if (live.parking === true) live.owed = true;
      return;
    }
    try {
      const record = this.ports.records.runRecord(run);
      if (record === undefined || !this.#isLive(record)) return;
      if (!this.#wake(run, record))
        this.#logger.warn(
          "fieldd.flows.run.wake",
          "A flow run's journal reads as none kept; it was not woken",
          { run },
        );
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.wake",
        "A flow run could not be woken; its next answer, or the next boot, wakes it",
        { run, error: messageOf(error) },
      );
    }
  }

  /** What a run's new calls and log lines reach, past its journal: an `agent()` by the one spawn road (D5), an `ask()`
   * by its gate (`#gate`, slice 11a), and a `what` no flow calls refused (D9), its refusal journaled by the one writer.
   * Each answer reaches the host's replay through `#answer` (D22), never through what `call` returns. */
  #inner(run: FlowRunId, live: LiveRun): FlowCallStarter {
    return {
      call: (call) => {
        if (call.what === "agent") this.#step(run, live, call);
        else if (call.what === "ask") this.#gate(run, live, call);
        else
          this.#answer(run, live, call.call, call.what, {
            ok: false,
            refused: noSuchCall(call.what),
          });
      },
      log: (text) => {
        live.log = text;
        this.#changed();
      },
    };
  }

  /** Slice 11a (Q1, Q6–Q8) — a gate, `ask(question, choices)`: waited on from its call, and held to its one rule
   * (gate-check.ts, Q6), the static read's own. One it refuses is answered by the one writer in "An ask refused"'s
   * words, the read's unchanged inside them (§9: journaled, counted, and heard at every later wake). Else its item is
   * raised on the one raise road (`#hold`), its question and its choices exactly as the script passed them (Q1); an
   * item that can't be raised is "VibeField couldn't ask you: …" (Q8). It never throws: a rejection would journal
   * nothing, and the next life would raise the gate this one refused. */
  #gate(run: FlowRunId, live: LiveRun, call: FlowHostCall & { readonly call: number }): void {
    live.waiting.add(call.call);
    const gate = checkGate(call.args[0], call.args[1]);
    if ("refused" in gate) {
      this.#answer(run, live, call.call, call.what, {
        ok: false,
        refused: words.askRefused(gate.refused),
      });
      return;
    }
    this.#hold(run, live, {
      call: call.call,
      what: call.what,
      kind: "flow-gate",
      words: gate.question,
      acts: gate.choices,
      unkept: words.askUnkept(),
      event: "fieldd.flows.gate.raise",
      said: "A flow run's ask could not be put in what waits on you; its script hears it was not asked",
    });
  }

  /** Q3 (b), Q8 — THE ONE RAISE ROAD: a run held on you, for every kind of hold (a gate, a step's second miss, a lost
   * step: `#lost`). *Corrected 2026-11-09 (the fold's P13; the skeptic's #11, LOW): it said "a lost step is slice 14's";
   * slice 14 built it.* In order:
   * 1. its item, raised by the needs queue (`flowItem`), named from the run's head as its LiveRun keeps it (MED-1), so
   *    nothing is read before it. The queue answers whether this raise MINTED it: a call already held, made again at a
   *    wake, is re-bound to its item, never minted again (D2, Q5);
   * 2. the hold, set in the run's holds by its call (Q3 (a)): `held` names it while it is the first still open;
   * 3. the spark that started the run told it holds on you (`#tell`, slice 11b), from the same head, only for a hold
   *    this raise MINTED (`raised.minted`), the one place that knows it: a hold re-bound at a wake tells nothing
   *    (Q9 (a), Q5);
   * 4. the record, through the one writer, with `fields` (a repair's step `holding`) and `held` projected. A write that
   *    throws is logged (`fieldd.flows.run.hold`) and nothing else: the hold stays in the run's holds, the call waits
   *    on, and the run's next write projects `held` from it. A repair's step stays `repairing` on its record, and its
   *    Ask once more reads the hold from the run's holds (#answered, MED-2).
   * `flowItem` is the only thing in the raise's try. One that throws kept nothing (`bad-input` throws before the queue
   * keeps, a store that refuses before it holds): nothing is held, and the call is answered by the one writer in
   * `unkept`, journaled and counted, never a silent wait (Q8, and its repair rider). It is logged at error for a cause
   * the gate's rule keeps from the queue (`bad-input`, a ZodError: an invariant broken), else at warn; nothing else
   * branches on what threw. */
  #hold(run: FlowRunId, live: LiveRun, raising: Raising): void {
    const { head } = live;
    let raised: FlowItemRaised;
    try {
      raised = this.ports.needs.flowItem({
        kind: raising.kind,
        run: {
          run,
          flow: head.flow,
          call: raising.call,
          ...(raising.label !== undefined ? { label: raising.label } : {}),
        },
        name: head.name,
        ...(head.starter.by === "spark" && head.starter.spark !== undefined
          ? { spark: head.starter.spark }
          : {}),
        ...(raising.words !== undefined ? { words: raising.words } : {}),
        acts: raising.acts,
      });
    } catch (error) {
      const code = codeOf(error);
      const fields = {
        run,
        call: raising.call,
        error: messageOf(error),
        ...(code !== undefined ? { code } : {}),
      };
      if (code === "bad-input" || (error instanceof Error && error.name === "ZodError"))
        this.#logger.error(raising.event, raising.said, fields);
      else this.#logger.warn(raising.event, raising.said, fields);
      this.#answer(run, live, raising.call, raising.what, { ok: false, refused: raising.unkept });
      return;
    }
    live.holds.set(raising.call, { item: raised.id, kind: raising.kind });
    // slice 11b (Q9 (a), Q3 (b) step 3): HERE, and only here, a hold is known MINTED (`raised.minted`), so its run's
    // spark is told here, before the record follows; a hold re-bound at a wake (minted false) tells nothing
    if (raised.minted) this.#tell(run, "asking", words.factAsking, head);
    try {
      this.#rewriteWith(run, raising.fields ?? (() => ({})));
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.hold",
        "A flow run's record could not say it holds on you; its next write says so",
        { run, call: raising.call, error: messageOf(error) },
      );
    }
  }

  /** A step: its agent started by `startStep`, or kept for a slot, and its answer journaled by the one writer when it
   * comes: the step's turn end (`#turnEnded`), or its refusal. A call its journal answers never reaches here (D22: the
   * replay releases it), so a step is never started twice for one answer (R13, MM3). */
  #step(run: FlowRunId, live: LiveRun, call: FlowHostCall & { readonly call: number }): void {
    const number = call.call;
    const failed: FlowHostAnswer = { ok: false, refused: stepFailed(labelOf(call.args)) };
    live.waiting.add(number);
    // F2 review T5: a read that fails on the step's road settles the step failed (its answer is journaled as the
    // refusal, and its entry's slot frees), never a rejection that leaves the entry holding one
    let record: FlowRunRecord | undefined;
    try {
      record = this.ports.records.runRecord(run);
    } catch (error) {
      this.#startThrew(run, number, error);
      this.#answer(run, live, number, call.what, failed);
      return;
    }
    if (record === undefined) {
      this.#answer(run, live, number, call.what, failed);
      return;
    }
    // D2: a call is looked up first, by its step's state on the record. CP4-S7: one its entry put past the run's slots
    // waits, with no spawn, until one frees, put in line once; a start in flight answers the call when it settles;
    // a step that names its session is bound to it (or lost, its agent gone), never started again; a call the journal
    // holds with no entry reads as starting (R13e); any other starts, by the one spawn road
    const step = record.open.find((open) => open.call === number);
    try {
      if (step?.state === "waiting") {
        if (!live.slotted.some((slotted) => slotted.call === number))
          live.slotted.push({ call: number, args: call.args });
        // slice 14 (Q6 item 4): a kill past an answer's line and before its #unslot boots with slots free and no
        // answer to come
        this.#unslot(run, live);
      } else if (!live.starting.has(number)) {
        if (step?.session !== undefined) this.#bind(run, live, step, call.args);
        else if (step === undefined) this.#entered(run, live, record, number, call.args);
        else if (live.booted) this.#madeAgain(run, live, step, call.args);
        else this.#launch(run, live, number, call.args);
      }
    } catch (error) {
      // F2 review T5's road: a lookup the store refused settles the step failed
      this.#startThrew(run, number, error);
      this.#answer(run, live, number, call.what, failed);
    }
  }

  /** D2 — a step made again at a wake whose record names its session: bound to it while its agent lives, so its turn
   * end answers the call made again, and nothing is started or counted (MM3, the F4 logic review; ruled 2026-11-06).
   * *Corrected 2026-11-09 (slice 14's green; Q6, Q7, Q17, Q29 (i)): it said an agent that exited fails its step, "a step
   * lost to a Quit, with its Resume, is slice 14's". By the session as `sessions.of` reads it (D's table):
   * - live: `#bindLive`;
   * - `pending` (Q17, D:297): it waits: no failure, no item, no line. For a handed session too: it fails at the next wake
   *   once its old id is gone (D:722–723);
   * - no row, and a replacement of THIS run's own in flight (`replacing`, §J 2's origin law: `step.handed` reads it): it
   *   waits for `begun: "resume"`, the spawn gap's law. A handed session is never kept on it;
   * - gone or exited: its successor `ofRun` names by its call, bound as `#resumed` binds; a handed session 10a's
   *   "‹label› failed."; else `#lost`.*
   * *Corrected 2026-11-09 (slice 14's fold, P1; the skeptic's #1, HIGH): the form is held first, on every road above
   * (`#holdForm`). It was held only on the live road, so a step re-made `pending`, `replacing`, on a successor not yet
   * live or lost, had none: its answer was journaled unchecked, and §9's line said no `in its form`.* */
  #bind(run: FlowRunId, live: LiveRun, step: FlowRunRecordStep, args: readonly unknown[]): void {
    const session = step.session;
    if (session === undefined) return;
    if (!this.#holdForm(run, live, step.call, args)) return;
    const row = this.ports.sessions.of(session);
    if (row?.live === true) {
      this.#bindLive(run, live, step, session, row, args);
      return;
    }
    if (row?.pending === true) {
      live.made.set(step.call, args);
      return;
    }
    const own = step.handed !== true;
    if (own && this.ports.agents.replacing(session)) {
      live.made.set(step.call, args);
      return;
    }
    const successor = own ? this.#successorOf(run, step) : undefined;
    if (successor !== undefined) {
      const bound = this.#boundTo(run, live, step, successor);
      const next = this.ports.sessions.of(successor);
      if (next?.live === true) this.#bindLive(run, live, bound, successor, next, args);
      else live.made.set(step.call, args);
      return;
    }
    if (own) this.#lost(run, live, step);
    else this.#handedGone(run, live, step);
  }

  /** Slice 14 (Q6 item 1; the fold's P1) — a step's form read from its call's own args at its re-make, on whichever road
   * the re-make takes, so `#turnEnded`, `#askUnheard`, `#sendResumed` and `#queueUnsent` read it. `#bind`'s head and
   * `#madeAgain`'s `pending` road call it; `#launched` holds a started step's form itself. False for a form that no
   * longer checks: the call is answered in §9's words, while its run waits on it, and the road stops. The step is
   * settled, so nothing is written to a session and no card is raised; a replacement or successor that lands after is
   * the run's by origin, and its end takes it. */
  #holdForm(run: FlowRunId, live: LiveRun, call: number, args: readonly unknown[]): boolean {
    const formed = formOf(args);
    if ("refused" in formed) {
      if (live.waiting.has(call))
        this.#answer(run, live, call, "agent", { ok: false, refused: formed.refused });
      return false;
    }
    if (formed.form !== undefined) live.forms.set(call, formed.form);
    return true;
  }

  /** Slice 14 (Q6, Q9, Q10, Q18) — a step's session lives at its re-make (its form held already, `#bind`'s head): a handed
   * session handed again (item 2), `inTurn` while it is not idle and no line of the step waits, so a turn in flight is
   * the step's; a `holding` repair with no hold raised again (item 5), the queue deduping; a line kept `sending` queued
   * (Q10), which starts its own turn; and an idle session asked once (Q9). */
  #bindLive(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    session: string,
    row: FlowStepSession,
    args: readonly unknown[],
  ): void {
    const { call } = step;
    if (step.handed === true && !live.hands.has(call)) {
      const inTurn = row.idle !== true && !this.#waitsInQueue(run, call, session);
      const unhand = this.ports.stepEnds.hand(
        session,
        { run, call },
        inTurn ? { inTurn: true } : undefined,
      );
      if (unhand === undefined) {
        if (live.waiting.has(call))
          this.#answer(run, live, call, "agent", { ok: false, refused: stepFailed(step.label) });
        return;
      }
      live.hands.set(call, unhand);
    }
    if (step.state === "holding" && !live.holds.has(call)) {
      if (step.miss !== undefined) live.misses.set(call, step.miss);
      this.#holdRepair(run, live, step, step.miss);
      return;
    }
    if (this.#queueUnsent(run, live, step, args)) {
      live.unheard.delete(call);
      return;
    }
    if (row.idle === true) this.#askUnheard(run, live, step);
  }

  /** Slice 14 (Q17, Q22) — the agent `ofRun` lists live for a step's call past the session its record names: a kill
   * between a replacement and its record write. None for a handed step, whose origin is not this run's. */
  #successorOf(run: FlowRunId, step: FlowRunRecordStep): string | undefined {
    try {
      return this.ports.sessions
        .ofRun(run)
        .find((row) => row.call === step.call && row.live && row.runtimeRunId !== step.session)
        ?.runtimeRunId;
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.agents", "A flow run's agents could not be read", {
        run,
        call: step.call,
        error: messageOf(error),
      });
      return undefined;
    }
  }

  /** Slice 14 (Q6 item 3) — a booted step with no session on its record: its origin read once, so a spawn that landed
   * before a kill is bound, never spawned twice. Found live: the session written and the prompt sent; found `pending`:
   * its form held (`#holdForm`; the fold's P1), the session written and the prompt unsent, for its replacement; none:
   * `#launch`, as a fresh start. */
  #madeAgain(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    args: readonly unknown[],
  ): void {
    const found = this.#successorOf(run, step);
    if (found === undefined) {
      this.#launch(run, live, step.call, args);
      return;
    }
    if (this.ports.sessions.of(found)?.pending !== true) {
      this.#launch(run, live, step.call, args, found);
      return;
    }
    if (!this.#holdForm(run, live, step.call, args)) return;
    this.#stepWrite(run)(step.call, (kept) => ({
      ...kept,
      session: found,
      state: "working",
      lines: [...(kept.lines ?? []), { line: "prompt", n: 1, sent: "sending" }],
    }));
    live.unsent.set(step.call, [{ line: "prompt", n: 1 }]);
    live.made.set(step.call, args);
  }

  /** Slice 14 (Q7, Q20; W1) — a step whose own session is gone: its item, `flow-lost`, on the one raise road, the step
   * `lost`, Resume the step its act, its spark told when minted (Q15). One item per call: a repair held on the call has
   * its item ended first. A gate has no session, so this never meets one. Nothing for a run whose ending is set or
   * no longer driven (D349–350): a Stop's own ends raise nothing (S14-26; K19's class gains no road). */
  #lost(run: FlowRunId, live: LiveRun, step: FlowRunRecordStep): void {
    if (this.#live.get(run) !== live || live.ending !== undefined) return;
    const hold = live.holds.get(step.call);
    if (hold?.kind === "flow-repair") {
      this.#endItem(run, hold.item);
      live.holds.delete(step.call);
    }
    const label = labelWords(step.label);
    this.#hold(run, live, {
      call: step.call,
      what: "agent",
      kind: "flow-lost",
      ...(step.label !== undefined ? { label } : {}),
      words: words.stepLost(live.head.name, label),
      acts: [NEEDS_CHOICE_WORDS.resumeStep],
      unkept: stepFailed(step.label),
      event: "fieldd.flows.step.lost",
      said: "A flow step's lost agent could not be put in what waits on you; the step failed",
      fields: (kept) => ({
        open: kept.open.map((open) =>
          open.call === step.call ? { ...open, state: "lost" } : open,
        ),
      }),
    });
  }

  /** Slice 14 (D343, Q20) — a session handed a step, gone: 10a's "‹label› failed.": it is no agent the run started, and
   * Resume has no origin to bind. A repair held on the call has its item ended first. */
  #handedGone(run: FlowRunId, live: LiveRun, step: FlowRunRecordStep): void {
    this.#logger.warn(
      "fieldd.flows.step.exited",
      "A flow step's handed session ended while its run waited; the step failed",
      { run, call: step.call, session: step.session },
    );
    const hold = live.holds.get(step.call);
    if (hold?.kind === "flow-repair") this.#endItem(run, hold.item);
    if (live.waiting.has(step.call))
      this.#answer(run, live, step.call, "agent", {
        ok: false,
        refused: stepFailed(step.label),
      });
  }

  /** Slice 14 (Q7, Q29 (i), Q35; `agents.onRunEnded`) — the mid-life road: an agent's end told, for each open step on
   * it. A run with no call out parks, and no wake would come. Nothing between `restore()` and `settled()` (Q29's
   * `#booting` return: nothing ends before the sessions attach) or past close() (Q34). A session a replacement of this
   * run's took is skipped (`replacing`, read here and synchronously, §J), never a handed one, by the record's `handed`
   * (§J 2). `#lost` itself returns on a set ending (S14-26), so this reads none. A row's failure is said, never thrown
   * into the runtime's own loop. Its stated costs (§J 5): a `replace-failed` tells nothing more, so the next wake's
   * `#lost` mints the true card; a runtime disposed mid-spawn tells no `begun`. */
  #sessionEnded(session: string): void {
    if (this.#booting || this.#closing) return;
    for (const [run, live] of this.#live) {
      try {
        for (const step of this.ports.records.runRecord(run)?.open ?? []) {
          if (step.session !== session) continue;
          if (step.handed === true) this.#handedGone(run, live, step);
          else if (!this.ports.agents.replacing(session)) this.#lost(run, live, step);
        }
      } catch (error) {
        this.#logger.warn("fieldd.flows.step.lost", "A flow step's ended agent could not be read", {
          run,
          session,
          error: messageOf(error),
        });
      }
    }
  }

  /** Slice 14 (Q34; C4) — the one condition both new sending roads return on: this LiveRun no longer the run's; an
   * ending set; or fieldd closing. */
  #quiet(run: FlowRunId, live: LiveRun): boolean {
    return this.#live.get(run) !== live || live.ending !== undefined || this.#closing;
  }

  /** Slice 14 (Q8 (a), Q17, Q34) — a step's session resumed, `begun: "resume"`, whoever resumed it. Past the one
   * condition (#quiet) nothing is written or sent; a successor of a run whose end has begun (`#ends`, or its ending set)
   * is ended, caught, against R42's law, and never one of a run long ended, which is the person's. Else the open step
   * is bound (`#boundTo`: session, `working`, a hold released in the same write), `agents` unchanged: a resume starts no
   * new agent (AR-4b), and then one line: an unsent one first (Q10: the prompt it still lacks); else, for a step read
   * `lost`, §9's resumed line (W2), waiting as `unsent` for a call not made again, whose form is not known (Q8's one
   * case); else the unheard asker (Q9), a replacement starting idle. Said in fieldd's log, never thrown into the
   * listener's.
   * *Corrected 2026-11-09 (slice 14's fold, P4; the skeptic's #4, MEDIUM; CP4-Q7 (a)): a step held on you (`heldOnYou`)
   * is bound and asked nothing, neither an unsent line nor the unheard asker. `#boundTo` keeps its `flow-repair` hold
   * and item; it was released, and the successor told "did not hear your answer" of two answers VibeField heard and
   * held. The person's Ask once more is what speaks to the successor (`step.session`).*
   * *Corrected 2026-11-09 (the fold's P6; the skeptic's #5, LOW; Q9): the one line sent here ends the call's `unheard`, as
   * `#bindLive`'s does: `sessionIdle` asked "did not hear your answer" over it, a line after the prompt just sent.* */
  #resumed({ run: runId, call, runtimeRunId }: FlowStepResumed): void {
    const run = runId as FlowRunId;
    const live = this.#live.get(run);
    if (live === undefined || this.#quiet(run, live)) {
      if (this.#ends.has(run) || live?.ending !== undefined)
        void asked(() => this.ports.agents.end(runtimeRunId)).catch((error: unknown) => {
          this.#logger.warn(
            "fieldd.flows.step.end",
            "A resumed step's successor could not be ended as its run ended",
            { run, runtimeRunId, error: messageOf(error) },
          );
        });
      return;
    }
    try {
      const step = this.ports.records.runRecord(run)?.open.find((open) => open.call === call);
      if (step === undefined || step.session === runtimeRunId) return;
      const bound = this.#boundTo(run, live, step, runtimeRunId);
      if (heldOnYou(live, bound)) return;
      const args = live.made.get(call);
      if (args !== undefined && this.#queueUnsent(run, live, bound, args)) {
        live.unheard.delete(call);
        return;
      }
      if (step.state === "lost") {
        this.#sendResumed(run, live, bound);
        live.unheard.delete(call);
      } else this.#askUnheard(run, live, bound);
    } catch (error) {
      this.#logger.warn("fieldd.flows.step.resumed", "A resumed flow step could not be bound", {
        run,
        call,
        runtimeRunId,
        error: messageOf(error),
      });
    }
  }

  /** Slice 14 (Q8, Q17) — a step's record moved onto its successor: its session, `working`, its hold released in the
   * same write (F5), and that hold's item ended, unless its act is in flight (the queue then writes it).
   * *Corrected 2026-11-09 (slice 14's fold, P4; the skeptic's #4, MEDIUM; CP4-Q7 (a)): that is a `flow-lost` hold's
   * road, and a step with none. A `flow-repair` hold is the person's, and a new session does not answer it: the session
   * alone moves, the step keeps its state and its item. It released every hold, so the card went and the step read
   * `working`.* */
  #boundTo(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    session: string,
  ): FlowRunRecordStep {
    const hold = live.holds.get(step.call);
    if (hold?.kind === "flow-repair") {
      this.#stepWrite(run)(step.call, (kept) => ({ ...kept, session }));
      return { ...step, session };
    }
    const write = hold !== undefined ? this.#releasing(run) : this.#stepWrite(run);
    write(step.call, (kept) => ({ ...kept, session, state: "working" }));
    if (hold !== undefined && !live.acting.has(step.call)) this.#endItem(run, hold.item);
    return { ...step, session, state: "working" };
  }

  /** Whether a line of this step waits in `session`'s kept queue. A queue that can't be read reads as one that holds it,
   * so nothing is asked on a guess; said in fieldd's log. */
  #waitsInQueue(run: FlowRunId, call: number, session: string): boolean {
    try {
      return this.ports.inputs
        .pending(session)
        .some((input) =>
          input.from.kind === "flow"
            ? input.from.run === run && input.from.call === call
            : input.from.kind === "fieldd" &&
              input.from.flow?.run === run &&
              input.from.flow.call === call,
        );
    } catch (error) {
      this.#logger.warn("fieldd.flows.run.lines", "A flow step's queue could not be read", {
        run,
        call,
        error: messageOf(error),
      });
      return true;
    }
  }

  /** Slice 14 (Q9; §9 "An answer VibeField did not hear") — THE unheard asker: `#bind` when the session is idle, `sessionIdle`,
   * and `#resumed`. Its gate, all true: past the one condition (#quiet, Q34), the call unheard and made again (its form
   * known), the step `working` or `repairing`, no line of it waiting in the session's queue, and its last line not
   * `uncertain` (the prompt may never have landed). Once sent or refused its call leaves the set: asked once. */
  #askUnheard(run: FlowRunId, live: LiveRun, step: FlowRunRecordStep): void {
    const { call, session } = step;
    if (this.#quiet(run, live) || session === undefined) return;
    if (!live.unheard.has(call) || !live.waiting.has(call)) return;
    if (step.state !== "working" && step.state !== "repairing") return;
    if (this.#waitsInQueue(run, call, session)) return;
    if (step.lines?.at(-1)?.sent === "uncertain") return;
    live.unheard.delete(call);
    const text = unheardLine(labelWords(step.label), live.forms.has(call));
    this.#ownLine(run, live, step, { line: "unheard", n: 1, text, state: "repairing" });
  }

  /** Slice 14 (Q8 (a); W2) — §9's resumed line to a lost step's successor. */
  #sendResumed(run: FlowRunId, live: LiveRun, step: FlowRunRecordStep): void {
    const { call } = step;
    const n =
      Math.max(0, ...(step.lines ?? []).filter((l) => l.line === "resume").map((l) => l.n)) + 1;
    if (!live.waiting.has(call)) {
      this.#stepWrite(run)(call, (kept) => ({
        ...kept,
        lines: [...(kept.lines ?? []), { line: "resume", n, sent: "sending" }],
      }));
      live.unsent.set(call, [...(live.unsent.get(call) ?? []), { line: "resume", n }]);
      return;
    }
    const text = resumeLine(labelWords(step.label), live.forms.has(call));
    this.#ownLine(run, live, step, { line: "resume", n, text, state: "working" });
  }

  /** Slice 14 (Q9, Q8) — VibeField's own line by `sendLine`; or, where it can't be, as `#repair`'s: a record past
   * STEP_LINES_MAX or a refused line fails the step in §9's words, never a silent wait (F5). */
  #ownLine(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    line: {
      readonly line: string;
      readonly n: number;
      readonly text: string;
      readonly state: string;
    },
  ): void {
    const { call, session } = step;
    if (session === undefined) return;
    try {
      if ((step.lines?.length ?? 0) < FLOW_LIMITS.STEP_LINES_MAX) {
        sendLine(this.ports, this.#stepWrite(run), run, call, session, line);
        return;
      }
      this.#logger.warn(
        "fieldd.flows.step.line",
        "A flow step's record keeps as many lines as it may; its line was not sent, and the step failed",
        { run, call, line: line.line, lines: FLOW_LIMITS.STEP_LINES_MAX },
      );
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.step.line",
        "A flow step's line could not be kept or queued; the step failed",
        { run, call, line: line.line, error: messageOf(error) },
      );
    }
    if (live.waiting.has(call))
      this.#answer(run, live, call, "agent", { ok: false, refused: stepFailed(step.label) });
  }

  /** Slice 14 (Q10, D5's first row) — the lines a boot kept `sending` that no queue holds, queued now the re-make holds
   * their text: the args' for `prompt` and `in`, §9's for `unheard` and `resume`, `repairLine(miss)` for `repair` (Q11).
   * An `enqueue` that throws (the queues unreadable at boot) is said and left `sending`, for the next boot to decide:
   * never a retry here. True when the call had any. */
  #queueUnsent(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    args: readonly unknown[],
  ): boolean {
    const { call, session } = step;
    const owed = live.unsent.get(call);
    if (owed === undefined || session === undefined) return false;
    live.unsent.delete(call);
    const write = this.#stepWrite(run);
    const label = labelWords(step.label);
    const form = live.forms.has(call);
    const flowLine = (line: string, n: number) => ({
      kind: "fieldd" as const,
      flow: { run, call, line, n },
    });
    for (const { line, n } of owed) {
      const miss = live.misses.get(call) ?? step.miss;
      const said =
        line === "unheard"
          ? { text: unheardLine(label, form), from: flowLine(line, n) }
          : line === "resume"
            ? { text: resumeLine(label, form), from: flowLine(line, n) }
            : line === "repair"
              ? miss !== undefined
                ? { text: repairLine(miss), from: flowLine(line, n) }
                : undefined
              : typeof args[0] === "string"
                ? { text: args[0], from: fromOf(this.#stepRunHead(run, live), call) }
                : undefined;
      if (said === undefined) continue;
      try {
        requeueLine(this.ports, write, call, session, { line, n, text: said.text }, said.from);
      } catch (error) {
        this.#logger.warn(
          "fieldd.flows.step.requeue",
          "A flow step's line could not be queued at its re-make; the next boot decides",
          { run, call, line, n, error: messageOf(error) },
        );
      }
    }
    return true;
  }

  /** A run's facts as a line's sender names them, from its LiveRun. */
  #stepRunHead(run: FlowRunId, live: LiveRun): Pick<FlowStepRun, "run" | "flow" | "name" | "ran"> {
    return { run, flow: live.head.flow, name: live.head.name, ran: live.ran };
  }

  /** R13e (D2's last row, [BR] MED) — a call the journal holds with no step entry: a kill between D5's first two
   * steps. It reads as starting, its entry written now from its journal line as `#journaled` writes one (a slot wait
   * past the run's slots), then it starts once by the one spawn road: no spawn can have happened, since D5 spawns
   * after the entry. */
  #entered(
    run: FlowRunId,
    live: LiveRun,
    record: FlowRunRecord,
    number: number,
    args: readonly unknown[],
  ): void {
    const read = this.ports.records.readRun(run);
    const line =
      read.kind === "kept"
        ? read.lines.find((kept) => kept.kind === "call" && kept.call === number)
        : undefined;
    const card = line?.kind === "call" ? line : undefined;
    const waits =
      handedOf(args) === undefined && slotsTaken(record.open) >= FLOW_LIMITS.LIVE_STEPS_MAX;
    this.#rewriteWith(run, (kept) => ({
      open: [
        ...kept.open,
        {
          call: number,
          ...(card?.label !== undefined ? { label: card.label } : {}),
          ...(card?.agent !== undefined ? { agent: card.agent } : {}),
          ...(card?.phase !== undefined ? { phase: card.phase } : {}),
          state: waits ? "waiting" : "starting",
        },
      ],
    }));
    if (waits) live.slotted.push({ call: number, args });
    else this.#launch(run, live, number, args);
  }

  /** A step's start, kept among its run's starts in flight while it settles (Q8 (a)), so an end waits for it. `session`
   * (slice 14, Q6 item 3): a booted step's agent found by its origin, bound by `boundStep`, never spawned. */
  #launch(
    run: FlowRunId,
    live: LiveRun,
    number: number,
    args: readonly unknown[],
    session?: string,
  ): void {
    const start = this.#launched(run, live, number, args, session);
    live.starts.add(start);
    void start.finally(() => live.starts.delete(start));
  }

  /** A step's agent started (or its session handed the line) by `startStep`; its refusal is its answer.
   * *Added 2026-11-09 (slice 14's green; Q31, §H o:568–572 (X#2, X#11); red-a's check #1): while fieldd stops (`#closing`,
   * or `fielddStopping()`, slice 15's), a start's refusal and its catch journal nothing, on BOTH roads, the guard AFTER
   * each orphan keep (so an agent that landed is still ended by the end's tail): the call stays unanswered, and the
   * next life makes it again, once. Its stated cost: a spawn that fails for good inside a stop window is answered in
   * the next life, once. Not guarded, as read at the fold's check #5: a spawn that LANDS past close() is queued its
   * prompt (`gone()` reads no `#closing`), and `sent` wrote `session` and `working` first, so the next life finds the
   * step named: `#step` routes to `#bind`, never a second agent, and the line reads as D5's rows say.* */
  async #launched(
    run: FlowRunId,
    live: LiveRun,
    number: number,
    args: readonly unknown[],
    session?: string,
  ): Promise<void> {
    // D2 in one life: a call made again while this start is in flight finds it here, and is answered by it: each
    // answer below is the one writer's, to the call while the run still waits on it when the start settles
    live.starting.add(number);
    try {
      const record = this.ports.records.runRecord(run);
      if (record === undefined) throw new Error(`no record of ${run}`);
      const started =
        session !== undefined
          ? boundStep(
              this.ports,
              this.#stepRun(run, live, record),
              this.#stepWrite(run),
              number,
              args,
              session,
            )
          : await this.#startStep(run, live, record, number, args);
      if ("refused" in started) {
        // fold 1 (the green skeptic's #2): an agent that landed past its run's end is kept among the run's orphans
        // before anything else, so the end's tail, which waits for this start, ends it though `sessions.ofRun` lags
        if (started.landed !== undefined) live.orphans.set(number, started.landed);
        // slice 14 (Q31): AFTER the keep
        if (this.#closing || this.ports.fielddStopping()) return;
        if (live.waiting.has(number)) this.#answer(run, live, number, "agent", started);
        return;
      }
      if (started.form !== undefined) live.forms.set(number, started.form);
      // 9b: a handed session is let go at the step's answer; a step its run no longer waits on (answered, or the run
      // ended while the start settled) lets it go now, through the one caught let-go (fold 2): a throw here is said as
      // a let-go, never read by the catch below as a start that threw
      if (started.unhand !== undefined) {
        if (this.#live.get(run) === live && live.waiting.has(number))
          live.hands.set(number, started.unhand);
        else this.#unhand(run, number, started.unhand);
      }
    } catch (error) {
      // F2 (slices 7–9 review): a start that throws is the step's refusal, "‹label› failed.", never the call's
      // rejection, so its answer is journaled, its step settles `failed` and frees its slot (`#unslot`), and the script
      // hears the same on a replay; a rejection would journal nothing and hold the slot forever. Its review's T1: this
      // road does no I/O before the step is answered (a store that does not answer is the commonest throw here), and
      // its label is the call's own (T3)
      // Y1: an agent its failed start leaves running is kept, in memory, before the answer settles the step, so the
      // settle's own write names its session even when the write that would have did not take
      if (error instanceof FlowStepOrphaned) live.orphans.set(number, error.runtimeRunId);
      // slice 14 (Q31): AFTER the keep, on this road too
      if (!this.#closing && !this.ports.fielddStopping() && live.waiting.has(number))
        this.#answer(run, live, number, "agent", { ok: false, refused: stepFailed(labelOf(args)) });
      this.#startThrew(run, number, error);
    } finally {
      live.starting.delete(number);
    }
  }

  /** A step's start that threw, in fieldd's log (F2 review T2): one past its spawn names the agent it leaves running,
   * which slice 13's R42 ends; any other came before any spawn or line.
   * *Corrected 2026-11-07 (slice 13's green; S10): the warn said its agent is "the person's to end after a restart".
   * Its origin names its run, so its run's end ends it, after a restart too (#finishStop's `sessions.ofRun`).* */
  #startThrew(run: FlowRunId, call: number, error: unknown): void {
    if (error instanceof FlowStepOrphaned)
      this.#logger.warn(
        "fieldd.flows.step.orphan",
        "A flow step's agent started, and its line was not queued; the step failed, and its agent is left running until its run's end ends it",
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
    return startStep(
      this.ports,
      this.#stepRun(run, live, record),
      this.#stepWrite(run),
      number,
      args,
    );
  }

  /** The run a step is of, as `startStep` and `boundStep` read it. */
  #stepRun(run: FlowRunId, live: LiveRun, record: FlowRunRecord): FlowStepRun {
    const profiles = new Set(this.ports.profiles());
    return {
      run,
      flow: record.flow,
      name: record.name,
      ran: live.ran,
      scope: record.scope.filter((profile) => profiles.has(profile)),
      folder: live.folder,
      // F8 (Q3): a spark's own run, or a Run from its thread, gives a step that names no profile its thinksUnder
      ...(record.starter.spark !== undefined ? { spark: record.starter.spark } : {}),
      // slice 13 (Q8 (a)): the run no longer driven, or its ending set (a Stop, D7's set-aside, J1's flood), read
      // after each await of the start, so a start in flight at an end reserves nothing more and queues nothing
      gone: () => this.#live.get(run) !== live || live.ending !== undefined,
    };
  }

  /** A slot freed (CP4-S7): the first step waiting for one, in call order, starts. Only a spawned step waits, so the
   * one slot an answer frees is a spawn's (F9).
   * CP-4a2b J1 (orders §C F9, re-read Q8; Proposed 2026-11-08): a run whose ending is set starts no slotted step, so an
   * ending set inside an answer's own turn (J1's flood, a held call refused at its re-entrant hand-on) reserves and
   * spawns nothing; J1 does not lean on s13 Q8 (a)'s `gone()` for it. */
  #unslot(run: FlowRunId, live: LiveRun): void {
    if (live.ending !== undefined) return;
    const record = this.ports.records.runRecord(run);
    if (record === undefined) return;
    if (slotsTaken(record.open) >= FLOW_LIMITS.LIVE_STEPS_MAX) return;
    const next = live.slotted[0];
    if (next === undefined) return;
    // T4c: the call leaves the line once the write that starts it lands; a write that throws keeps it in line
    this.#stepWrite(run)(next.call, (step) => ({ ...step, state: "starting" }));
    live.slotted.shift();
    this.#launch(run, live, next.call, next.args);
  }

  /** A step's turn ended (CP4-S2's road): its answer, once (D22), to the call its host waits on. A failed turn is
   * "‹label› failed."; a completed one is `{text}`, a form's fields beside it (Q-A1 (a)), bounded whole (D11). A miss,
   * of its form or of the bound, is the repair turn, and nothing is journaled. A turn end for a step answered, or of a
   * run this fieldd does not drive, is nothing (R24). */
  #turnEnded(end: FlowStepTurnEnd): void {
    const run = end.run as FlowRunId;
    const live = this.#live.get(run);
    if (live === undefined || live.ending !== undefined || !live.waiting.has(end.call)) return;
    const record = this.ports.records.runRecord(run);
    const step = record?.open.find((open) => open.call === end.call);
    if (record === undefined || step?.session !== end.runtimeRunId) return;
    // slice 14 (Q9): a turn end heard: the step spoke, so it is asked nothing
    live.unheard.delete(end.call);
    // held on you: the step's words wait for their act
    if (heldOnYou(live, step)) return;
    if (end.outcome === "failed") {
      this.#answer(run, live, end.call, "agent", { ok: false, refused: stepFailed(step.label) });
      return;
    }
    const text = end.text ?? "";
    const form = live.forms.get(end.call);
    let value: unknown = { text };
    if (form !== undefined) {
      const match = matchAnswer(form, text);
      if (!match.ok) {
        this.#missed(run, live, step, end.runtimeRunId, match.miss);
        return;
      }
      value = { ...(match.value as Readonly<Record<string, unknown>>), text };
    }
    // D11: fields that alone pass the bound are a miss, never a truncation; anything else is bounded as the one writer
    // journals it (`#answer` → `flowAnswerLine`, D22), which marks it `cut` for the journal and the script's worker
    const bounded = boundedAnswer({ ok: true, value });
    if (!bounded.ok && bounded.miss === true) {
      this.#missed(run, live, step, end.runtimeRunId, bounded.refused);
      return;
    }
    this.#answer(run, live, end.call, "agent", { ok: true, value });
  }

  /** D22 — THE ONE WRITER of a call's answer: a turn end, a refusal, a start's settle, and one that lands while no
   * host is up, each journaled AT MOST ONCE, keyed by its call.
   * - P14: the journal's answered calls (`answered`, read from it at every wake) are checked, and the line appended,
   *   in one synchronous turn: a second answer to a call writes nothing and hands nothing on.
   * - XX1(a): `flowAnswerLine` is the one cutter, called here alone: JSON's own value, the depth refusal, the bound
   *   and its `cut`, which the hand-on carries (R28b: a cut answer reaches the script marked, in any window).
   * - The DELTA to D22's wording ("waiters per host generation"): the generation IS the replay. The answer is handed
   *   to `live.replay`, read at the hand-on, never captured at the call; a parked or stopped generation's replay is no
   *   longer `live.replay`, so it hears nothing (its waiters are dropped, never resolved); with no host up, the answer
   *   is only journaled, and the woken host hears it from its journal, in journal order (D21, R28).
   * - P13: the hand-on comes BEFORE the record follows the line (`#lagging`). A line that lands with no host up wakes
   *   its run there (`#lagging`, `#rouse`, `#wake`), and the generation that wake starts read the line from its
   *   journal, so it is never handed the line as well. An answer the record's follow-up journals in its turn (a
   *   slot's start that throws, `#unslot`) is handed on after this one, in the journal's order (D21).
   * - T4: once the line has landed nothing refuses it: the record's settle that throws is the record lagging the
   *   journal (D18), said in fieldd's log, and the next record write settles it (XX4, `#replace`). The line's own
   *   consequences, the slot it frees and D1's wake, never wait on that write (T4c). A line the disk
   *   refuses is not kept, so the script hears JOURNAL_REFUSED and a restart asks the step again.
   * - A run no longer driven, or whose ending is set (D7's set-aside, a Stop: `live.ending`), journals nothing: no
   *   answer lands past its decided end.
   * - Q2, Q3 (slice 11a): it answers what it did (`Wrote`). A line the disk refuses for an answer you can give again
   *   (`again`: a gate's, its item standing open) is no JOURNAL_REFUSED: it is handed to no replay, and its call is put
   *   back among those waiting, so the script never hears a refusal a later life would answer otherwise (D21).
   * - A kept line releases its call's hold, if it held one. The record write that follows the line (`#lagging`)
   *   projects `held` past it, since #replace skips a call the journal answers; a write that lags leaves that to the
   *   next (T4). The hold's entry then leaves the run's holds, whether or not that write landed.
   * - CP-4a2b J1 (orders §C F10, §B JB5b; re-read Q11, Q13; Proposed 2026-11-08): a line refused as a full journal
   *   ends its run `flood` (#full), and is `full`: nothing hears JOURNAL_REFUSED (the replay is dropped), and a gate's
   *   call is never put back among those waiting. A full refusal #full did not end the run by (past close()) takes
   *   today's road, as every other refusal does. */
  #answer(
    run: FlowRunId,
    live: LiveRun,
    call: number,
    what: string,
    said: FlowHostAnswer,
    { again = false }: { readonly again?: boolean } = {},
  ): Wrote {
    if (this.#live.get(run) !== live || live.ending !== undefined) return "undriven";
    live.waiting.delete(call);
    live.forms.delete(call);
    live.misses.delete(call);
    // 9b: a handed session's later turns are never this step's; its let-go is the one caught let-go (fold 2)
    const unhand = live.hands.get(call);
    live.hands.delete(call);
    if (unhand !== undefined) this.#unhand(run, call, unhand);
    if (live.answered.has(call)) return "had";
    const line = flowAnswerLine(call, what, said);
    try {
      this.ports.records.appendRun(run, line.entry);
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.step.answer",
        "A flow step's answer was not kept in its journal",
        { run, call, error: messageOf(error) },
      );
      if (error instanceof FlowJournalFull && this.#full(run, live, error)) return "full";
      if (again) live.waiting.add(call);
      else live.replay?.answered(call, { ok: false, refused: JOURNAL_REFUSED });
      return "refused";
    }
    live.answered.set(call, answeredOf(line.entry));
    live.lines += 1;
    live.replay?.answered(call, line.heard);
    this.#lagging(run, line.entry);
    live.holds.delete(call);
    return "kept";
  }

  /** T4 (the F2 review) — a line the journal took, followed by its record: a record write that throws there is the
   * record lagging its journal (D18), said in fieldd's log and carried by the next write, never the line refused.
   * An answer's own consequences go on whatever its record did (the 10b fix's delta review, #2; T4c): the slot it
   * frees (CP4-S7) and D1's wake of a run whose host is parked or still leaving. Behind a settle that threw, a parked
   * run would wait for a boot with its answer in its journal. */
  #lagging(run: FlowRunId, entry: FlowJournalEntry, args?: readonly unknown[]): void {
    this.#following(run, entry, () => this.#journaled(run, entry, args));
    if (entry.kind !== "answer") return;
    const live = this.#live.get(run);
    if (live === undefined) return;
    this.#following(run, entry, () => this.#unslot(run, live));
    if (live.host === undefined || live.parking === true) this.#rouse(run);
  }

  /** The record following its journal's `entry`: a write that throws is the record lagging (D18), said in fieldd's log
   * and carried by the next write (XX4). */
  #following(run: FlowRunId, entry: FlowJournalEntry, follow: () => void): void {
    try {
      follow();
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.lag",
        "A flow run's record could not follow its journal",
        { run, kind: entry.kind, error: messageOf(error) },
      );
    }
  }

  /** A call or log line a host's replay journals (D22: never an answer, which is `#answer`'s), its record following
   * it; a line the disk refuses throws, and the replay refuses the call (nothing landed).
   * CP-4a2b J1 (draft §2's one guard; orders §D; re-read Q1, Q10; Proposed 2026-11-08): once its run's ending is set,
   * it refuses every line with a plain Error before the store is asked (never a FlowJournalFull, so #full is never
   * reached from here twice), so a smaller held call behind a refused one in #unhold's one loop is never kept nor
   * handed on: J1 adds no road to K19's class. A line refused as a full journal ends the run `flood` (#full), and is
   * ALWAYS rethrown, never swallowed, so a refused call line is never read as kept (replay hands nothing on) and a
   * refused log line is said nowhere (replay.log). */
  #appended(
    run: FlowRunId,
    live: LiveRun,
    entry: FlowJournalEntry,
    args: readonly unknown[] | undefined,
  ): void {
    if (live.ending !== undefined)
      throw new Error(`${run} is ending: its journal keeps no ${entry.kind} line`);
    try {
      this.ports.records.appendRun(run, entry);
    } catch (error) {
      if (error instanceof FlowJournalFull) this.#full(run, live, error);
      throw error;
    }
    live.lines += 1;
    this.#lagging(run, entry, args);
  }

  /** Every handed session of a run let go (9b), each through #unhand. Its three callers: #finish, at the run's end;
   * #woken's unkept road, for a run whose record or journal reads as none VibeField keeps; and close(), at fieldd's own
   * stop.
   * *Fold 1 (2026-11-07; the green skeptic's #6): each let-go is caught and said in fieldd's log, so a throw never
   * leaves #finish past its `#live.delete` with #closeEnd skipped (its Stop then waiting on to close()), nor close()
   * before it has settled its Stops and stopped its hosts.* */
  #letGo(run: FlowRunId, live: LiveRun): void {
    for (const [call, unhand] of live.hands) this.#unhand(run, call, unhand);
    live.hands.clear();
  }

  /** A handed session's let-go (9b), caught: a throw is said in fieldd's log (`fieldd.flows.step.unhand`) and never
   * thrown into the road that let it go. Every let-go in the runs goes through it: #letGo's (#finish, #woken's unkept
   * road, close()); #answer's, at the step's answer, so the answer is journaled and the turn end that answered it
   * returns; and #launched's, for a start that settles on a step its run no longer waits on, inside that start's `try`,
   * so a let-go that throws is never a start that threw. The one let-go outside the runs, startStep's for a handed start
   * whose send threw, is caught in steps.ts and said as the same event, and that start rethrows the send's error.
   * *Fold 2 (2026-11-07; the builder's #14): #answer's and #launched's let-gos were uncaught.*
   * *Fold 3 (2026-11-07; the fold 2 skeptic's #1): this said it was "THE ONE LET-GO", with three users, while startStep's
   * own let-go was a fourth, uncaught; and it placed #letGo at an end and at fieldd's own stop, leaving out #woken's
   * unkept road.* */
  #unhand(run: FlowRunId, call: number, unhand: () => void): void {
    try {
      unhand();
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.step.unhand",
        "A flow step's handed session could not be let go",
        { run, call, error: messageOf(error) },
      );
    }
  }

  /** A step's answer missed its form (CP4-Q7 (a)): the repair line once; a miss after it holds the run on the person
   * (`flow-repair`) on the one raise road (`#hold`), its step `holding` in the hold's own write, and its Ask once more
   * sends the line again. Nothing is journaled, but for an item that can't be raised: the step fails in §9's words
   * ("‹label› failed."), as F5's repair that can't be sent fails it, never a silent wait (Q8's repair rider). */
  #missed(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    session: string,
    check: string,
  ): void {
    live.misses.set(step.call, check);
    // slice 14 (Q9 (i)): by a `repair` line sent, never by `repairing`, which the unheard line writes too: a miss after
    // that line is the repair turn's (§9)
    if (!(step.lines ?? []).some((line) => line.line === "repair")) {
      this.#repair(run, live, step, session, 1, check, this.#stepWrite(run));
      return;
    }
    this.#holdRepair(run, live, step, check);
  }

  /** Slice 14 (Q6 item 5, Q11 (a), §I 2) — a step's second miss held on the person, on the one raise road, the step
   * `holding` and its latest `miss` in the hold's own write (`#missed`'s; `#bind`'s for a `holding` repair with no hold,
   * the queue deduping it). */
  #holdRepair(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    check: string | undefined,
  ): void {
    this.#hold(run, live, {
      call: step.call,
      what: "agent",
      kind: "flow-repair",
      ...(step.label !== undefined ? { label: labelWords(step.label) } : {}),
      acts: [NEEDS_CHOICE_WORDS.askOnceMore],
      unkept: stepFailed(step.label),
      event: "fieldd.flows.step.raise",
      said: "A flow step's second miss could not be put in what waits on you; the step failed",
      fields: (kept) => ({
        open: kept.open.map((open) =>
          open.call === step.call
            ? { ...open, state: "holding", ...(check !== undefined ? { miss: check } : {}) }
            : open,
        ),
      }),
    });
  }

  /** The person's answer to a run's item, handed on once by the needs queue (D22). A gate's is its act's own words
   * (slice 11a, `#gateAnswered`). Slice 9 answers `flow-repair`'s Ask once more: the repair line again, its next `n`.
   * A step holds while its record says `holding`, or while the run's holds keep its repair (MED-2, Q8's second F-a
   * half): a repair whose hold write failed after its item was minted is still `repairing` on its record, and its Ask
   * once more acts on it, releasing it as any other. An answer handed on again, its step holding neither way, was acted
   * on, and is answered as done. A lost step is slice 14's. Slice 13 (Q9): Stop the run, on an item of ANY kind, is
   * read ahead of the kind, and is the run's Stop (#stopAct).
   * CP-4a2b J1 (Q9, #10; ruled 2026-11-08 (i); Proposed 2026-11-08): a run whose ending is set answers an act of either
   * kind `failed`, in its ending's words, read right after `live` (one read for both kinds, and for slice 14's
   * `flow-lost`; it was #gateAnswered's alone): J1's flood in §9's flood sentence, D7's set-aside in its own words (the
   * D7 leave's Ask once more answers "VibeField set ‹flow› aside: …", C13), a Stop's, which has none, in noSuchRun's
   * (unreached: its turn ended every item first). So no repair line is sent into a session whose run is leaving. It
   * sits after `answer.stop`, so a Stop on any item still reaches #stopAct.
   * *Dated 2026-11-09 (slice 14's green; Q8, Q19, C15, Q32): "A lost step is slice 14's", and now is, as #lostAnswered,
   * behind J1's hoisted ending read. Q19's ONE check comes first, ahead of `answer.stop`: with no LiveRun, a run this
   * life has not read (`#unread`) or a newer VibeField's (its record alone: `recordIsNewer`, never its journal) throws
   * the store's retryable refusal, so its item waits on and nothing acts on the run. `stop()`'s own NOT_FOUND is owed to
   * M-d's door.* */
  async #answered(answer: FlowItemAnswer): Promise<FlowItemActed> {
    const run = answer.run.run as FlowRunId;
    if (!this.#live.has(run) && (this.#unread.has(run) || this.ports.records.recordIsNewer(run)))
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    if (answer.stop) return this.#stopAct(run);
    if (answer.kind !== "flow-repair" && answer.kind !== "flow-gate" && answer.kind !== "flow-lost")
      throw new Error(`CP-4a2b: a run's ${answer.kind} is no kind of a run's item`);
    const live = this.#live.get(run);
    if (live?.ending !== undefined)
      return { outcome: "failed", reason: live.ending.log ?? words.noSuchRun(run) };
    if (answer.kind === "flow-gate") return this.#gateAnswered(run, live, answer);
    if (answer.kind === "flow-lost") return this.#lostAnswered(run, live, answer);
    const record = this.ports.records.runRecord(run);
    const step = record?.open.find((open) => open.call === answer.run.call);
    if (live === undefined || record === undefined || step === undefined)
      return { outcome: "failed", reason: words.noSuchRun(run) };
    if (!heldOnYou(live, step)) return { outcome: "done" };
    const n =
      Math.max(0, ...(step.lines ?? []).filter((l) => l.line === "repair").map((l) => l.n)) + 1;
    const check = live.misses.get(step.call);
    if (check === undefined || step.session === undefined)
      throw new Error(`the miss of ${run}'s call ${step.call} is not kept`);
    // F5 (slices 7–9 review): the hold is answered in the write that sends its repair, never before it; a repair that
    // can't be sent fails the step, and its settle takes the hold with it
    if (!this.#repair(run, live, step, step.session, n, check, this.#releasing(run)))
      return { outcome: "failed", reason: stepFailed(step.label) };
    return { outcome: "done" };
  }

  /** Slice 13 (Q9) — Stop the run, through any of its items: the run's Stop, awaited, answered `done`; a retryable
   * refusal (its `stopping` refused) is thrown, so the item waits on (queue.ts:868). A run no record keeps (a forged
   * run's item, whose one act is Stop, s14 Q12) is `done` too, never noSuchRun: its items ended, and the agents its
   * steps started, by their origin, ended; past fieldd's own stop it acts on nothing and is refused retryably
   * (closingRefused, fold 1). Re-entrance, read and safe: the Stop's turn ends this item while the queue answers it, and
   * the queue's own answer then stands over it (#stand), its siblings `ended`. */
  async #stopAct(run: FlowRunId): Promise<FlowItemActed> {
    if (this.ports.records.runRecord(run) === undefined) {
      // fold 1 (the green skeptic's #3): past fieldd's own stop it acts on nothing, as stop() does past close() (Q17
      // (a)), and is refused retryably, so the item waits on for the next life, as a refused `stopping` does
      if (this.#closing) throw closingRefused();
      this.#letGoOf(run);
      await this.#endAgents(run, this.#agentsOf(run, undefined).agents);
      return { outcome: "done" };
    }
    await this.stop(run);
    return { outcome: "done" };
  }

  /** Slice 14 (Q8 (a), Q32; W4) — Resume the step, on its `flow-lost` item: past close() refused retryably before the
   * runtime is asked (closingRefused, Q32), and with no step lost on the call nothing is done again. The runtime makes
   * a NEW run, which `#resumed` binds, by `begun: "resume"`; so this asks and answers, marking the act in flight so
   * `#resumed` leaves the item to the queue. A runtime that refuses throws in W4's words: the item waits on, since
   * returning `failed` would spend the only act that can move the run. A line's form may not be known here: `#resumed`
   * then keeps it `unsent` for the re-make (Q8's one case). */
  async #lostAnswered(
    run: FlowRunId,
    live: LiveRun | undefined,
    answer: FlowItemAnswer,
  ): Promise<FlowItemActed> {
    if (this.#closing) throw closingRefused();
    const step = this.ports.records
      .runRecord(run)
      ?.open.find((open) => open.call === answer.run.call);
    if (live === undefined || step === undefined)
      return { outcome: "failed", reason: words.noSuchRun(run) };
    const { session } = step;
    if (step.state !== "lost" || session === undefined) return { outcome: "done" };
    live.acting.add(step.call);
    // the fold's P2 (the skeptic's #2): a Resume in flight is a start in flight, its rejection caught, so an end waits for
    // it and its tail reads what lands (#launch's three lines)
    const resuming = asked(() => this.ports.agents.resume(session));
    const start = resuming.then(
      () => undefined,
      () => undefined,
    );
    live.starts.add(start);
    void start.finally(() => live.starts.delete(start));
    try {
      await resuming;
    } catch (error) {
      throw refused(
        "resume-refused",
        words.resumeRefused(labelWords(step.label), oneLineWords(messageOf(error), FLOW_LOG_MAX)),
      );
    } finally {
      live.acting.delete(step.call);
    }
    return { outcome: "done" };
  }

  /** Q1, Q2 (slice 11a) — your answer to a gate: its act's own words, byte for byte, journaled by the one writer as the
   * ask's answer, so the script's `await ask()` resolves to them (R33), and every later wake hears them from the
   * journal, never raising the gate again (R36). Its hold is released in that answer's own record write (#replace). A
   * run this fieldd does not drive fails in noSuchRun's words, and one set aside (D7) in its own; an answer its journal
   * holds already (P14) is done, writing nothing; one the disk refuses hands nothing on, and is refused in the store's
   * words, retryably, so its item waits on and your next answer journals cleanly.
   * CP-4a2b J1 (Q9's hoist; orders §B JB5b, Q11, Q13; ruled 2026-11-08 (i), (ii); Proposed 2026-11-08): a run whose
   * ending is set is answered by #answered, before this (its own read moved there). An answer that was the line a
   * full journal refused (`full`) ended the run `flood`, and the act answers `failed` in §9's flood sentence
   * (floodEnd's, the one builder), never the retryable refusal: the disk did answer. Past fieldd's own stop a refusal
   * says closingRefused's "the flow service is stopping", never the store's words, and its item waits on. */
  #gateAnswered(run: FlowRunId, live: LiveRun | undefined, answer: FlowItemAnswer): FlowItemActed {
    if (live === undefined || answer.run.call === undefined)
      return { outcome: "failed", reason: words.noSuchRun(run) };
    const said: FlowHostAnswer = { ok: true, value: answer.act };
    switch (this.#answer(run, live, answer.run.call, "ask", said, { again: true })) {
      case "kept":
      case "had":
        return { outcome: "done" };
      case "full":
        return { outcome: "failed", reason: floodEnd(live.head).log };
      case "refused":
        if (this.#closing) throw closingRefused();
        throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
      case "undriven":
        return { outcome: "failed", reason: words.noSuchRun(run) };
    }
  }

  /** A step's repair line, sent by `sendRepair` through `write`; or, where it can't be, the step failed in §9's words
   * ("‹label› failed."), as F2's catch fails a start that throws, never a silent wait (F5): a step whose record keeps
   * FLOW_LIMITS.STEP_LINES_MAX lines already (Q2), or a line its record or its session's queue refuses. Its answer is
   * journaled as the refusal, and the settle takes the run's hold with it (`#journaled`). False when it failed. */
  #repair(
    run: FlowRunId,
    live: LiveRun,
    step: FlowRunRecordStep,
    session: string,
    n: number,
    check: string,
    write: FlowStepWrite,
  ): boolean {
    if ((step.lines?.length ?? 0) >= FLOW_LIMITS.STEP_LINES_MAX) {
      // EE1 (F5 review): the bound's road says its cause in fieldd's log, as the refusal's road does
      this.#logger.warn(
        "fieldd.flows.step.repair",
        "A flow step's record keeps as many lines as it may; its repair line was not sent, and the step failed",
        { run, call: step.call, n, lines: FLOW_LIMITS.STEP_LINES_MAX },
      );
    } else {
      try {
        sendRepair(this.ports, write, run, step.call, session, n, check);
        return true;
      } catch (error) {
        this.#logger.warn(
          "fieldd.flows.step.repair",
          "A flow step's repair line could not be kept or queued; the step failed",
          { run, call: step.call, n, error: messageOf(error) },
        );
      }
    }
    if (live.waiting.has(step.call))
      this.#answer(run, live, step.call, "agent", { ok: false, refused: stepFailed(step.label) });
    return false;
  }

  /** The folder a run's input `values` name, the first of its inputs in its meta's order (`kinds`) whose kind names
   * one (CP4-Q20 (a)); none when no input does. Read at each wake of a run whose head holds no folder (F6, GG2). */
  #folderOf(values: FlowInput, kinds: Readonly<Record<string, string>>): string | undefined {
    for (const [name, kind] of Object.entries(kinds)) {
      const value = values[name];
      const folder = value !== undefined ? this.ports.folderOf(kind, value) : undefined;
      if (folder !== undefined) return folder;
    }
    return undefined;
  }

  /** The record's open step, written through the one writer of a run's record, with the run's count of its agents
   * (`fields`, F4) in the same write. */
  #stepWrite(run: FlowRunId): FlowStepWrite {
    return (call, patch, fields) =>
      this.#rewriteWith(run, (record) => ({
        open: record.open.map((step) => (step.call === call ? patch(step) : step)),
        ...fields?.(record),
      }));
  }

  /** The record's open step, written as `#stepWrite` writes it, with its call's hold released in the same write: the
   * person's answer to a hold is acted on in the write that acts on it, never before it (F5). Its entry in the run's
   * holds goes once that write is made (Q3 (d)), and `held` moves to the first hold still open (EE3). */
  #releasing(run: FlowRunId): FlowStepWrite {
    return (call, patch, fields) => {
      this.#replace(
        run,
        (start, record) => ({
          ...start,
          open: record.open.map((step) => (step.call === call ? patch(step) : step)),
          ...fields?.(record),
        }),
        { releases: call },
      );
      this.#live.get(run)?.holds.delete(call);
    };
  }

  /** A line the run's journal took, as its record follows it (D18's cadence): a call counts (D10), and an agent's
   * call opens its step, `starting` (D5 step 2); an answer settles its step, `failed` for a refusal. A call's `args`
   * are its own, as its host sent them. The record alone: an answer's slot and wake are `#lagging`'s, after it.
   * ZZ3 (slice 12, C2 (b)): `calls` is the call line's own number, which is the journal's count (replay takes a number
   * only once its line is kept, Q3 (a)), never the record's count plus one: a record write the disk refused would
   * leave that one short for good, where the next call line's write sets it right. The window that stays: a run's
   * last call whose write is refused reads one short until its next wake, or for good on an ended run. */
  #journaled(run: FlowRunId, entry: FlowJournalEntry, args?: readonly unknown[]): void {
    // F9 (slices 7–9 review): a step handed a session by `in:` is no spawn, so it never waits for a slot; that is
    // decided here, at its call line, so no "waiting" reaches its record and it is never put in line
    const hands = args !== undefined && handedOf(args) !== undefined;
    if (entry.kind === "call")
      this.#rewriteWith(run, (record) => ({
        calls: entry.call,
        ...(entry.what === "agent"
          ? {
              open: [
                ...record.open,
                {
                  call: entry.call,
                  ...(entry.label !== undefined ? { label: entry.label } : {}),
                  ...(entry.agent !== undefined ? { agent: entry.agent } : {}),
                  ...(entry.phase !== undefined ? { phase: entry.phase } : {}),
                  // CP4-S7: past the run's LIVE_STEPS_MAX live steps, a spawned step waits for a slot
                  state:
                    !hands && slotsTaken(record.open) >= FLOW_LIMITS.LIVE_STEPS_MAX
                      ? "waiting"
                      : "starting",
                },
              ],
            }
          : {}),
      }));
    else if (entry.kind === "answer")
      // Y1: a step whose agent was left running names its session, in this same write, though its own did not take
      this.#replace(run, (start) => {
        const orphan = this.#live.get(run)?.orphans.get(entry.call);
        return settleStep(start, entry.call, answeredOf(entry), orphan);
      });
  }

  /** A host's end, as its run ends (or, for a host that left, waits for its next wake: DESIGN.md §9). fieldd's own stop
   * leaves the run to its next boot. A host gone frees its place for the next run waiting for one (R29). */
  #ended(run: FlowRunId, end: FlowHostEnd, calls?: HostCalls): void {
    if (this.#closing) return;
    const live = this.#live.get(run);
    if (live !== undefined) {
      delete live.host;
      live.calls = undefined;
      live.replay = undefined;
      clearTimeout(live.idle);
      live.idle = undefined;
    }
    try {
      this.#hostEnded(run, live, end, calls);
    } finally {
      this.#nextHost();
    }
  }

  /** How a host's end leaves its run: D1's park is a wait, never an end, and a wake asked while it left starts now
   * (R27d); any other end is the run's. */
  #hostEnded(
    run: FlowRunId,
    live: LiveRun | undefined,
    end: FlowHostEnd,
    calls: HostCalls | undefined,
  ): void {
    // D7: a run set aside at D1's park ends when its host has left, lost, in its words. Slice 13 (Q18 (a)): so does
    // any ending fieldd set (a Stop's, J1's flood), read FIRST, over whatever end the script chose meanwhile:
    // the supervisor chooses once (supervisor.ts:574), so a `done`, `threw` or `ended` chosen in the instant before
    // reads as that ending. The host leaves under its grace for `done`, `threw`, `fatal` and `memory`, and at once
    // for the kills, `protocol`, `flood` and `unanswered` (K17; fold 1, the green skeptic's #7). *Words (2026-11-08;
    // J1's green, Q17): it said "later J1's flood". J1's flood is the runs' (#full), its host stopped under its grace.*
    if (live?.ending !== undefined) {
      this.#finish(run, live.ending);
      return;
    }
    if (live?.parking === true) {
      const owed = live.owed === true;
      live.parking = false;
      live.owed = false;
      if (end.kind === "stopped") {
        if (owed) this.#rouse(run);
        return;
      }
    }
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
        // slice 13 (Q13, R43): §9's sentence for why fieldd ended it, said once on its record, in place of the
        // script's latest line, its flow named as its head names it (K14)
        this.#finish(run, {
          state: "failed",
          host: end.why,
          log: words.hostEnded(live?.head.name ?? run, end.why),
        });
        return;
      case "left":
        this.#left(run, live, calls);
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

  /** A host that left on its own (its pipe closed under it, killed alone): its run waits, woken at once when it had no
   * call out (D1's 4th wake), else by its answer. One that leaves twice with no new journal line between is never
   * started a third time, and its run fails in DESIGN.md §9's words (CL-H13). */
  #left(run: FlowRunId, live: LiveRun | undefined, calls: HostCalls | undefined): void {
    if (live !== undefined && live.leftAt === live.lines) {
      const name = this.ports.records.runRecord(run)?.name ?? run;
      this.#finish(run, { state: "failed", log: words.leftTwice(name) });
      return;
    }
    if (live !== undefined) live.leftAt = live.lines;
    this.#rest(run);
    if ((calls?.out ?? 0) === 0) this.#rouse(run);
  }

  /** TT1 (the 10a review) — a run at rest, its host gone, written as a rest: `waiting`, which the one writer
   * (#replace) writes `holding` while the person holds it. Every road that rests a run writes it here: #park, #wake's
   * queue road and #left. */
  #rest(run: FlowRunId): void {
    this.#rewrite(run, { state: "waiting" });
  }

  /** A run's end: its journal's `end` line, then its record (D18), and the run no longer driven. Once the line is kept,
   * the spark that started the run is told (`#tell`, slice 11b; Q9 (b)), after the record's write, whether or not that
   * write lands: the journal is the truth. An `end` line the disk refuses tells nothing. The tell reads the run's head
   * from the LiveRun the end took (MED-1), never its record, so a kept line tells though its record then reads as none
   * or can't be read; an end of a run this fieldd no longer drives (no LiveRun) tells nothing.
   * *Corrected 2026-11-07 (slice 13's green; S11): "an end of a run this fieldd no longer drives tells nothing" no
   * longer holds. #finishStop ends such a run through here, handing the head its journal holds, and its end tells.*
   * Slice 13 (Q6 (a)): THE ONE END, in D4's order at EVERY end (a Stop, done, failed, lost), never two orders:
   * - its synchronous part: the run no longer driven, its hands let go, its idle cleared, off #hostQueue, its holds
   *   cleared (so the end's write projects no `held`, Q7), its items ended and its lines withdrawn (Q9, Q10);
   * - then the agents its steps started, ended (#tail), once the starts in flight have settled (Q8 (a)); then the
   *   `end` line with `ended`, the record, the tell (#closeEnd). With no start in flight and no agent to end, #closeEnd
   *   runs at once, so an end with none (R6i's, R6j's) reads as it always did.
   * No port refuses an end: each call is caught and logged. The windows, stated: a non-Stop end killed after its
   * agents ended and before its `end` line reads at the boot as a run whose sessions exited (s14's R13 raises
   * `flow-lost` there), and a spawn that never answers holds the tail, the record in its state before the end (a
   * Stop's `stopping`) until it settles, or fieldd's own stop. `calls` is not counted again here (N10): ZZ3's window
   * stands on a run's last call (#journaled). */
  #finish(run: FlowRunId, end: RunEnd, unlived?: Unlived): void {
    const live = this.#live.get(run);
    this.#live.delete(run);
    if (live !== undefined) {
      this.#letGo(run, live);
      clearTimeout(live.idle);
      live.holds.clear();
    }
    const queued = this.#hostQueue.indexOf(run);
    if (queued >= 0) this.#hostQueue.splice(queued, 1);
    this.#letGoOf(run);
    const closing: Closing = {
      run,
      end,
      head: live?.head ?? unlived?.head,
      settles: live ?? unlived?.settles,
      log: end.log ?? live?.log,
      calls: unlived?.calls,
    };
    const starts = [...(live?.starts ?? [])];
    if (starts.length === 0) {
      const read = this.#agentsOf(run, live?.orphans);
      if (read.agents.length === 0) {
        this.#closeEnd(closing, 0, new Set(), read.agentOf);
        return;
      }
      void this.#tail(closing, starts, read, live?.orphans);
      return;
    }
    void this.#tail(closing, starts, undefined, live?.orphans);
  }

  /** Slice 13 (Q6, Q8 (a)) — an end's tail: its run among `#ends`, so a Stop waits for it; the starts in flight
   * settled, then the agents its steps started read (by origin, a landed agent among them) and ended at once; then
   * #closeEnd. After each await it reads `#closing`, and leaves at fieldd's own stop (Q17): a Stop's run stays
   * `stopping` for the boot, any other its state before the end, and replays. Waiting there would let a hung end hang
   * fieldd's stop. The agents are read once, here or in #finish (`read`), and each one's call goes on to #closeEnd with
   * them (EndAgents, fold 3). */
  async #tail(
    closing: Closing,
    starts: readonly Promise<void>[],
    read: EndAgents | undefined,
    orphans: ReadonlyMap<number, string> | undefined,
  ): Promise<void> {
    const { run } = closing;
    const ending = this.#endOf(run);
    try {
      if (starts.length > 0) await Promise.allSettled(starts);
      if (!this.#closing) {
        const { agents, agentOf } = read ?? this.#agentsOf(run, orphans);
        const refused = await this.#endAgents(run, agents);
        if (!this.#closing) {
          this.#closeEnd(closing, agents.length - refused.size, refused, agentOf);
          return;
        }
      }
      this.#endClosed(run, ending);
    } catch (error) {
      this.#logger.error("fieldd.flows.run.end", "A flow run's end did not close", {
        run,
        state: closing.end.state,
        error: messageOf(error),
      });
      this.#endClosed(run, ending);
    }
  }

  /** Slice 13 (Q6) — an end closed, the `end` line's one site: the line, with `ended` (the agents its end took, only
   * when above 0), then the record (D18) in the end's own write: its open steps `ended` but those its journal answers
   * and those whose agent's end was refused, each step's agent its session or its call's in the end's one read
   * (`agentOf`; endSteps, Q7), its `held` dropped, `ended` again, and `calls` from the journal on #finishStop's road.
   * Once the line is kept the spark that started the run is told, whether or not the record's write lands: the journal
   * is the truth. Then every Stop waiting on the end answers. */
  #closeEnd(
    closing: Closing,
    ended: number,
    refused: ReadonlySet<string>,
    agentOf: ReadonlyMap<number, string>,
  ): void {
    const { run, end, head, settles, log, calls } = closing;
    let kept = false;
    try {
      this.ports.records.appendRun(run, {
        kind: "end",
        state: end.state,
        ...(end.host !== undefined ? { host: end.host } : {}),
        ...(end.threw !== undefined ? { threw: end.threw } : {}),
        ...(ended > 0 ? { ended } : {}),
      });
      kept = true;
      // XX4: the run it no longer drives still settles, in this last write, a step its journal answers
      this.#replace(
        run,
        (start) => ({
          ...endSteps(start, settles?.answered, refused, agentOf),
          state: end.state,
          endedAt: this.#now().toISOString(),
          ...(log !== undefined ? { log } : {}),
          ...(end.host !== undefined ? { host: end.host } : {}),
          ...(ended > 0 ? { ended } : {}),
          ...(calls !== undefined ? { calls } : {}),
        }),
        { live: settles },
      );
    } catch (error) {
      this.#logger.error("fieldd.flows.run.end", "A flow run's end was not kept", {
        run,
        state: end.state,
        error: error instanceof Error ? error.message : String(error),
      });
      // 1o (the F4b fix review): told as every write is (#told), so a list that can't be read here is said as a
      // tell's, never thrown out of the end in place of the end's own failure
      this.#told();
    }
    if (kept && head !== undefined) this.#tell(run, end.state, END_FACTS[end.state], head);
    this.#endClosed(run);
  }

  /** Slice 11b (Q9, Q10) — a fact for the spark that started `run` (its starter `by: "spark"`, the spark named),
   * through the `waker` port: `fact`'s words, from the spark's name as `sparkOf` reads it now, the run's ‹flow› and
   * the run's id alone. `what` is the hold (`asking`) or the end's state, for fieldd's log; `head` the run's starter
   * and name as its LiveRun keeps them (MED-1), so a tell reads no record. A run you start, in a spark's thread or not,
   * tells no one (T3b). A spark `sparkOf` no longer finds is told nothing, and an end with no words yet (`stopped`,
   * slice 13's) tells nothing: each is said in fieldd's log (`fieldd.flows.run.fact`). It never throws: a fact is told
   * past what the run kept (an item minted, an `end` line), which nothing may then refuse, so one that can't be told
   * is said in that log and lost.
   * *Corrected 2026-11-07 (slice 13's green; K21): "an end with no words yet (`stopped`, slice 13's) tells nothing"
   * no longer holds. Every end has its words (END_FACTS, `factStopped` among them, W1), so that branch is gone.* */
  #tell(run: FlowRunId, what: "asking" | FlowRunState, fact: SparkFact, head: RunHead): void {
    if (head.starter.by !== "spark") return;
    const { spark } = head.starter;
    if (spark === undefined) return;
    try {
      const known = this.ports.sparkOf(spark);
      if (known === undefined) {
        this.#logger.warn(
          "fieldd.flows.run.fact",
          "A flow run's spark is gone; it was not told what its run did",
          { run, spark, what },
        );
        return;
      }
      this.ports.waker.flowFact(spark, fact(known.name, head.name, run));
    } catch (error) {
      this.#logger.warn(
        "fieldd.flows.run.fact",
        "A flow run's spark could not be told what its run did",
        { run, spark, what, error: messageOf(error) },
      );
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

  /** A run's record written again as `whole` makes it from what it holds (a field it leaves out is gone), then told.
   * TT1 (the 10a review; ruled 2026-11-06): a record written AT REST (`waiting` or `holding`) is written `holding`
   * exactly while the written record holds (`held`, after the write's own fields), else `waiting`; `running` and the
   * ends are written as they are. So a road that rests a run writes a rest (#rest), and a hold set or released while
   * the run rests (#missed, #releasing, an answer's settle) leaves its state true to the hold.
   * MM2 (the F4b review): it is told as `#told` tells it, past the write, so the one writer throws only when its
   * write did NOT land; a list that can't be read then is said in fieldd's log, never read by a caller as its write's
   * failure (a reservation kept for an agent never started, a step failed whose record says it works).
   * XX4 (the 10b read), by invariant: the record never keeps an answered call's step open past the run's next write.
   * Each write settles every open step the journal answers (`live.answered`, the one writer's), so a settle that
   * lagged (T4) is carried by the next write, #finish's among them.
   * Q3 (slice 11a; VV1, EE3): every hold, of any kind, is an entry of the run's holds (`live.holds`, by its call);
   * `held` names the first still open, released only by its own item's act (`releases`, #releasing) or its call's
   * answer (`live.answered`), and is written HERE alone, after the settle, projected from the holds (`withHeld`); with
   * no LiveRun it stays as the record has it. UU2 (Q4): a held run whose host is up reads `running` until D1's idle
   * parks it, then `holding`: the rest words are the park's.
   * *Added 2026-11-07 (slice 13's green; Q7): with no LiveRun, #finishStop names what its journal holds (`Settles`:
   * its answers, no orphan, no hold), so its end's write settles a step its journal answers and drops `held`.* */
  #replace(
    run: FlowRunId,
    whole: (start: FlowRunStart, record: FlowRunRecord) => FlowRunStart,
    { live = this.#live.get(run), releases }: Replacing = {},
  ): void {
    const { records } = this.ports;
    const record = records.runRecord(run);
    if (record === undefined) throw new Error(`no record of ${run} to write`);
    let written = whole(startOf(record), record);
    for (const step of written.open) {
      const answered = live?.answered.get(step.call);
      if (answered !== undefined)
        written = settleStep(written, step.call, answered, live?.orphans.get(step.call));
    }
    if (live !== undefined) written = withHeld(written, live, releases);
    const rest = written.held !== undefined ? "holding" : "waiting";
    records.writeRunRecord(run, AT_REST.has(written.state) ? { ...written, state: rest } : written);
    this.#told();
  }

  #changed(): void {
    if (this.#listeners.size === 0) return;
    const list = this.list();
    for (const fn of this.#listeners) fn(list);
  }
}
