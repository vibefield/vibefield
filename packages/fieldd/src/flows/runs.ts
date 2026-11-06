import { randomBytes } from "node:crypto";
import {
  FLOW_LIMITS,
  FLOW_LOG_MAX,
  FLOW_RUN_STEPS_MAX,
  type FlowInput,
  type FlowRunId,
  type FlowRunRecord,
  type FlowRunRecordStep,
  type FlowRunState,
  type FlowRunStep,
  type FlowStarter,
  type FlowsListResult,
  flowRunStateOf,
  flowsListOf,
  type NeedsItemId,
  nameWords,
  oneLineWords,
  type RunSummary,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "../native-link";
import type { HoldSender } from "../tool-plane/rooms/talk/verbs";
import type { FlowChangedRaise } from "../tool-plane/rooms/you/queue";
import type { FlowJournalEntry } from "./journal";
import type { FlowLibrary } from "./library";
import type { FlowRecords, FlowRunStart } from "./records";
import { FlowReplay } from "./replay";
import { readFlow } from "./static-read";
import { type FlowStepPorts, type FlowStepWrite, startStep } from "./steps";
import {
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
// - Its refusals (DESIGN.md §9 "When a run can't start", words.ts) are PRECONDITION_FAILED with a `reason`, before
//   anything is written: no flow, a file past SCRIPT_MAX_BYTES, an input the flow does not name, a version not kept,
//   and the bounds (D3): RUNS_LIVE_MAX live runs, or RUNS_PER_SPARK_MAX of a spark's own. Nothing between the bounds'
//   read and the run's begin awaits, so two starts never pass one bound together.
// - The run's record is written first (D18, `FlowRecords.beginRun`), its scope frozen there: the start's profiles
//   that exist then. A read narrows it to the profiles that exist now; it never widens (D8).
// - A host is started only through `#wake`, which replays the run's journal from the top (CP-D9) under the kept
//   bytes. A run's end is journaled, then its record written (D18's cadence).
// - The list and every change (`onChange`) are drawn from the run records (D18; CL-E2-2), never a journal; a live
//   run's latest log line rides with it until its next anchor writes it into the record (D13).
// Built later in M-r2: agent() and ask() (slices 8 and 11; until then a call is refused in fieldd's words), the
// park and its wakes (10a), the cap (12), Stop (13) and boot (14).

/** fieldd's own interface to the runs (R32): what daemon.ts builds them from. Slice 7's part. */
export interface FlowRunPorts {
  /** the person's library: a run's flow is read here against its approval */
  readonly library: Pick<FlowLibrary, "read">;
  /** fieldd's flow records: approvals, kept bytes, each run's journal and record */
  readonly records: FlowRecords;
  /** the needs queue's changed-flow item (N5) */
  readonly needs: { flowChanged(raise: FlowChangedRaise): NeedsItemId };
  /** the runtime's spawn, for a step's agent (slice 8; steps.ts `startStep` is its one road) */
  readonly agents: FlowStepPorts["agents"];
  /** each session's input queue, for a step's prompt (D5) */
  readonly inputs: FlowStepPorts["inputs"];
  /** the sessions an `in:` may name (D9) */
  readonly sessions: FlowStepPorts["sessions"];
  /** the folder a run's input names (CP4-Q20 (a)) */
  folderOf: FlowStepPorts["folderOf"];
  /** the Agent Profiles that exist now, by id: a run's frozen scope narrows to them (D8) */
  profiles(): readonly string[];
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
  readonly waiting: Map<number, (answer: FlowHostAnswer) => void>;
  /** the run's input and the kinds its meta names them by, read at its wake: the folder a step names none of
   * (CP4-Q20 (a)) */
  inputs?: { readonly values: FlowInput; readonly kinds: Readonly<Record<string, string>> };
  /** the steps waiting for a slot (CP4-S7), in their calls' order: started when one frees (slice 9) */
  readonly slotted: { readonly call: number; readonly args: readonly unknown[] }[];
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

  constructor(readonly ports: FlowRunPorts) {
    this.#logger = ports.logger ?? createNoopLogger();
    this.#now = ports.now ?? (() => new Date());
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
      });
      return { waits };
    }
    return { run: this.#begin(params, approval.hash) };
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

  /** fieldd's own stop: every host stopped, each run left as its journal and record say, for the next boot. */
  async close(): Promise<void> {
    this.#closing = true;
    this.#listeners.clear();
    await Promise.all([...this.#live.values()].map((live) => live.host?.stop()));
  }

  /** Begin a run of the approved bytes `hash`: its refusals, then its record and its head (D18), then its host. */
  #begin(params: FlowRunStartParams, hash: string): RunSummary {
    const { records } = this.ports;
    const bytes = records.bytes(hash);
    if (bytes === undefined) throw refused("version", words.notAVersion(params.flow));
    const meta = readFlow(bytes).meta;
    const name = words.markName(meta?.name, params.flow);
    const takes = new Set(Object.keys(meta?.input ?? {}));
    const unknown = Object.keys(params.input).find((input) => !takes.has(input));
    if (unknown !== undefined) throw refused("input", words.noSuchInput(name, unknown));
    // D3: the bounds, from the records, read with no await before the run begins
    const kept = records.runRecords();
    const live = kept.filter(isLive);
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
    records.beginRun(
      { run, flow: params.flow, name, n, hash, starter: params.starter, input: params.input },
      { scope, state: "running", calls: 0, allowed: FLOW_LIMITS.CALLS_MAX, open: [], steps: [] },
    );
    this.#live.set(run, {
      waiting: new Map(),
      slotted: [],
      ...(params.from !== undefined && params.starter.by === "spark"
        ? { ran: nameWords(params.from.name) }
        : {}),
    });
    const begun = records.runRecord(run);
    if (begun === undefined) throw new Error(`the record of ${run} did not read back`);
    this.#wake(run, begun);
    this.#changed();
    return summaryOf(begun, this.#live.get(run));
  }

  /** The one way a run's host starts: its journal replayed from the top (CP-D9) under the bytes kept for its hash
   * (D8). Bytes that no longer hash are lost, and so is the run. */
  #wake(run: FlowRunId, record: FlowRunRecord): void {
    const { records } = this.ports;
    const live = this.#live.get(run);
    if (live === undefined) throw new Error(`${run} is not a run this fieldd drives`);
    const read = records.readRun(run);
    if (read.kind !== "kept") throw new Error(`the journal of ${run} reads ${read.kind}`);
    const bytes = records.bytes(record.hash);
    if (bytes === undefined) {
      this.#finish(run, { state: "lost" });
      return;
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

  /** A step: its agent started by `startStep`, then its answer awaited (slice 9's). */
  async #step(run: FlowRunId, live: LiveRun, call: FlowHostCall): Promise<FlowHostAnswer> {
    const number = call.call;
    const record = this.ports.records.runRecord(run);
    if (number === undefined || record === undefined)
      throw new Error(`a step of ${run} with no call number or no record`);
    const answer = new Promise<FlowHostAnswer>((resolve) => live.waiting.set(number, resolve));
    // CP4-S7: a step its entry put past the run's slots waits, with no spawn, until one frees
    if (record.open.find((step) => step.call === number)?.state === "waiting") {
      live.slotted.push({ call: number, args: call.args });
      return answer;
    }
    const profiles = new Set(this.ports.profiles());
    const started = await startStep(
      this.ports,
      {
        run,
        flow: record.flow,
        name: record.name,
        ran: live.ran,
        scope: record.scope.filter((profile) => profiles.has(profile)),
        folder: this.#folderOf(live),
      },
      this.#stepWrite(run),
      number,
      call.args,
    );
    if ("refused" in started) {
      live.waiting.delete(number);
      return started;
    }
    return answer;
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
    const { records } = this.ports;
    const record = records.runRecord(run);
    if (record === undefined) throw new Error(`no record of ${run} to write`);
    records.writeRunRecord(run, { ...startOf(record), ...fields(record) });
    this.#changed();
  }

  #changed(): void {
    if (this.#listeners.size === 0) return;
    const list = this.list();
    for (const fn of this.#listeners) fn(list);
  }
}
