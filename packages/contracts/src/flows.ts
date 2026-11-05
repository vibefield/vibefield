import { z } from "zod";
import { SparkId } from "./agent-session";
import {
  NEEDS_CHOICE_MAX,
  NEEDS_CHOICES_MAX,
  NEEDS_NAME_MAX,
  NEEDS_QUESTION_MAX,
  NEEDS_REASON_MAX,
  NeedsItemId,
} from "./compose";
import { FLOW_LIMITS } from "./registries";

// CP-4 — flows (track CO; `draft/compose-plane/v2/` §flows, FL-D1…FL-D5 and CP-D8…CP-D13 ruled 2026-10-29/30; the
// round's CP-4 marks ruled 2026-11-04 at the leans; the build plan is the CO lead's step0-cp4.md §5.1). A flow is a
// `.flow.js` ES module in the person's library (LAYOUT.FLOWS_LIBRARY_DIR): `export const meta` names it and its input,
// and its default export runs its steps through the flow API, `agent(prompt, opts)`, `ask(question, choices)` and
// `log(text)`, with `phase(name, fn)` and plain JavaScript for its lanes and loops. fieldd runs only the bytes the
// person approved (CP-D10), kept by their SHA-256 (CP4-Q18 (a)), in a child of its own (CP-D8; CP-4a2), and a run's
// gates, its changed flow, its repair miss, its cap and its lost step wait in the person's one queue (compose.ts's
// NEEDS_ITEM_KINDS, CP-D12). No budget and no money (James, 2026-11-02 13:08Z): `meta.budget` is not read, shown or
// refused (CP4-S11), so FlowMeta has no field for it.
//
// What lands in CP-4a1: the ids, the static read (FlowRead, CP4-Q3 (a)), the library's row (FlowEntry), the two kept
// records (approvals and proposals), a run's summary and the five window doors' params and results (methods.ts). What
// CP-4a2a adds: a run's journal, its head and its lines (the last section), and why fieldd ended a run's host.
//
// TS-only like compose.ts and tools.ts: field-native reads none of it, so EL9's two sides are fieldd and the window.
// Every state word is OPEN on the wire: a word this build never heard of reads, as none it names.

// ── ids ──

/** A flow file's name in the library: `<slug>.flow.js`. */
export const FLOW_FILE_SUFFIX = ".flow.js";

/** A flow's slug: its file's name without FLOW_FILE_SUFFIX, lowercase letters, digits and dashes. A library file whose
 * name is not one is passed over, and fieldd logs it. */
export const FlowSlug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62})$/);
export type FlowSlug = z.infer<typeof FlowSlug>;

/** A version of a flow: the SHA-256 of its bytes, lowercase hex. fieldd keeps each approved or proposed version's
 * bytes under this name, and reads them back only while it is still their hash. */
export const FlowHash = z.string().regex(/^[0-9a-f]{64}$/);
export type FlowHash = z.infer<typeof FlowHash>;

/** A run's id: fieldd's, minted when the run starts. Within AgentSessionOrigin's `run` bound, which a step's session
 * record carries. */
export const FlowRunId = z.string().regex(/^fr-[0-9a-z]{6,32}$/);
export type FlowRunId = z.infer<typeof FlowRunId>;

/** A proposal's id: fieldd's, minted when a spark proposes a flow. */
export const FlowProposalId = z.string().regex(/^fp-[0-9a-z]{6,32}$/);
export type FlowProposalId = z.infer<typeof FlowProposalId>;

/** One of a run's calls, counted from 1 in its journal, as a step's session record names it (`origin.call`). */
export const FlowCallNumber = z.number().int().positive();

/** A name in a script's `meta.input`: a JavaScript identifier, as the default export destructures it. */
export const FlowInputName = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/);

// ── bounds of the read and of a run's summary (wire bounds, not run limits: those are FLOW_LIMITS) ──

/** A step's label, a phase's name, as the script wrote them. Said cut at NEEDS_NAME_MAX (DESIGN.md §9 "A flow's lines");
 * kept whole up to here. */
export const FLOW_LABEL_MAX = 120;
/** The phases a script's `meta.phases` may list. */
export const FLOW_PHASES_MAX = 16;
/** The names a script's `meta.input` may list. */
export const FLOW_INPUTS_MAX = 8;
/** One input's value on the wire (a session, a folder, words). */
export const FLOW_INPUT_VALUE_MAX = 4_000;
/** The `agent(…)` calls the static read lists; one past it sets `unlisted`. */
export const FLOW_READ_CALLS_MAX = 64;
/** The `ask(…)` calls the static read lists; one past it sets `unlisted`. */
export const FLOW_READ_GATES_MAX = 16;
/** The refusals one read reports. */
export const FLOW_READ_REFUSALS_MAX = 16;
/** A `log(…)` line as a run's summary carries it. */
export const FLOW_LOG_MAX = 200;
/** The steps a run's summary carries, the latest; `earlier` counts the rest. */
export const FLOW_RUN_STEPS_MAX = 64;
/** The library rows and the runs one `flows.list` answers. */
export const FLOW_LIBRARY_MAX = 256;
export const FLOW_RUNS_LISTED_MAX = 64;

/** The format of every record CP-4 keeps; a record of another is set aside, never read as this one. */
export const FLOW_RECORD_FORMAT = 1;

/** An open word as this build names it, else undefined: a word a newer build's record may carry. */
function knownWord<W extends string>(words: readonly W[], word: string | undefined): W | undefined {
  return words.find((known) => known === word);
}

// ── the static read (CP4-Q3 (a)) ──

/** What the script's `meta` says, read as plain values and nothing else: its name, its phases and its input, each
 * input's kind an open word (`session` in v2's example). `budget` is not read (CP4-S11). */
export const FlowMeta = z
  .object({
    name: z.string().min(1).max(NEEDS_NAME_MAX),
    phases: z.array(z.string().min(1).max(FLOW_LABEL_MAX)).max(FLOW_PHASES_MAX).optional(),
    input: z
      .record(FlowInputName, z.string().min(1).max(32))
      .refine((input) => Object.keys(input).length <= FLOW_INPUTS_MAX, {
        message: `at most ${FLOW_INPUTS_MAX} inputs`,
      })
      .optional(),
  })
  .passthrough();
export type FlowMeta = z.infer<typeof FlowMeta>;

/** An `agent(…)` call as the bytes say it, without running them. `agent`, `model` and `label` are present only where
 * the script writes them plainly; `computed` says one of them is chosen as it runs (a template's label reads with "…"
 * where its expressions stand). `inLoop`: the call sits in a loop. `in`: it sends to a session the run already has
 * rather than starting an agent. `phase`: the `phase(…)` it sits in. `line`: where it is, from 1. */
export const FlowCall = z
  .object({
    line: z.number().int().positive(),
    agent: z.string().min(1).max(64).optional(),
    model: z.string().min(1).max(128).optional(),
    phase: z.string().min(1).max(FLOW_LABEL_MAX).optional(),
    label: z.string().min(1).max(FLOW_LABEL_MAX).optional(),
    computed: z.literal(true).optional(),
    inLoop: z.literal(true).optional(),
    in: z.literal(true).optional(),
  })
  .passthrough();
export type FlowCall = z.infer<typeof FlowCall>;

/** An `ask(…)` gate as the bytes say it: its question and its choices where the script writes them plainly (at most
 * NEEDS_CHOICES_MAX, since Stop the run takes the item's last place, CP4-Q6 (a)), `computed` where it does not. */
export const FlowGate = z
  .object({
    line: z.number().int().positive(),
    question: z.string().min(1).max(NEEDS_QUESTION_MAX).optional(),
    choices: z
      .array(z.string().min(1).max(NEEDS_CHOICE_MAX))
      .min(1)
      .max(NEEDS_CHOICES_MAX)
      .optional(),
    phase: z.string().min(1).max(FLOW_LABEL_MAX).optional(),
    computed: z.literal(true).optional(),
    inLoop: z.literal(true).optional(),
  })
  .passthrough();
export type FlowGate = z.infer<typeof FlowGate>;

/** Why the read refuses a script, OPEN: it does not parse as a module (`syntax`); its `meta` is missing or not plain
 * values (`meta`); it has no default export to run (`default`); an `ask` offers more than NEEDS_CHOICES_MAX choices, or
 * none (`choices`); its bytes are past SCRIPT_MAX_BYTES (`size`). A refused script never runs. */
export const FLOW_READ_REFUSALS = ["syntax", "meta", "default", "choices", "size"] as const;
export type FlowReadRefusalReason = (typeof FLOW_READ_REFUSALS)[number];

export const FlowRefusal = z
  .object({
    /** FLOW_READ_REFUSALS, OPEN */
    reason: z.string().min(1).max(32),
    /** fieldd's own words for it, for the card */
    words: z.string().min(1).max(NEEDS_REASON_MAX),
    line: z.number().int().positive().optional(),
  })
  .passthrough();
export type FlowRefusal = z.infer<typeof FlowRefusal>;

export function flowRefusalOf(refusal: {
  readonly reason: string;
}): FlowReadRefusalReason | undefined {
  return knownWord(FLOW_READ_REFUSALS, refusal.reason);
}

/** The static read of a script's bytes (CP4-Q3 (a)): what a proposal's card and a library row show, never a run.
 * `meta` is absent when the read could not take it. `unlisted`: the script starts agents or asks the read cannot
 * list (`agent` passed on as a value, a call past the read's bound), so the card says "This script starts agents the
 * card can't list — read it". `refusals` is empty for a script the read takes. */
export const FlowRead = z
  .object({
    meta: FlowMeta.optional(),
    calls: z.array(FlowCall).max(FLOW_READ_CALLS_MAX),
    gates: z.array(FlowGate).max(FLOW_READ_GATES_MAX),
    unlisted: z.boolean(),
    refusals: z.array(FlowRefusal).max(FLOW_READ_REFUSALS_MAX),
  })
  .passthrough();
export type FlowRead = z.infer<typeof FlowRead>;

// ── the library (CP4-Q18 (a), CP4-Q5 (a)) ──

/** A library file against fieldd's approvals, OPEN: `approved` (its bytes are the approved version), `changed` (an
 * approval stands for other bytes), `new` (never approved), `too-big` (past SCRIPT_MAX_BYTES: never read or run). */
export const FLOW_ENTRY_STATES = ["approved", "changed", "new", "too-big"] as const;
export type FlowEntryState = (typeof FLOW_ENTRY_STATES)[number];

export function flowEntryStateOf(entry: { readonly state: string }): FlowEntryState | undefined {
  return knownWord(FLOW_ENTRY_STATES, entry.state);
}

/** One flow in the person's library. `hash` is the file's bytes' (absent for one too big to read); `approved` is the
 * version the person approved, when one stands; `name` is its `meta.name` from the static read, when it reads. */
export const FlowEntry = z
  .object({
    flow: FlowSlug,
    name: z.string().min(1).max(NEEDS_NAME_MAX).optional(),
    hash: FlowHash.optional(),
    approved: FlowHash.optional(),
    /** FLOW_ENTRY_STATES, OPEN */
    state: z.string().min(1).max(32),
    /** the file's size */
    bytes: z.number().int().min(0),
  })
  .passthrough();
export type FlowEntry = z.infer<typeof FlowEntry>;

// ── the kept records (CP4-Q18 (a)): one per file, signed by fieldd's one record signer under LAYOUT.FLOWS_KEY_FILE,
// its own name inside; the signature rides the passthrough ──

/** Who approved a version: OPEN, `you` today (a board's light edit is approved as the person's own, FL-D3). */
export const FLOW_APPROVERS = ["you"] as const;

/** A flow's approval: the version the person approved, by its hash, its bytes kept beside it under that name. The
 * record's `flow` names its file (`approvals/<slug>.json`): one copied to another flow's name is set aside as forged.
 * `proposal` names the spark's proposal it came from, when one did. */
export const FlowApprovalRecord = z
  .object({
    format: z.literal(FLOW_RECORD_FORMAT),
    flow: FlowSlug,
    hash: FlowHash,
    approvedAt: z.string().min(1),
    /** FLOW_APPROVERS, OPEN */
    by: z.string().min(1).max(32),
    proposal: FlowProposalId.optional(),
  })
  .passthrough();
export type FlowApprovalRecord = z.infer<typeof FlowApprovalRecord>;

/** A spark's proposal (`flow_propose`, CP4-Q3 (a)): the bytes it sent, kept by their hash, under the slug it would
 * be saved as, until the person answers its item. The record's `id` names its file (`proposals/<id>.json`). */
export const FlowProposalRecord = z
  .object({
    format: z.literal(FLOW_RECORD_FORMAT),
    id: FlowProposalId,
    flow: FlowSlug,
    /** `meta.name` from the static read, when it reads */
    name: z.string().min(1).max(NEEDS_NAME_MAX).optional(),
    hash: FlowHash,
    /** the spark that proposed it */
    spark: SparkId,
    proposedAt: z.string().min(1),
    /** the needs-you item it waits in (`flow-proposal`) */
    item: NeedsItemId.optional(),
  })
  .passthrough();
export type FlowProposalRecord = z.infer<typeof FlowProposalRecord>;

// ── a run, as the window reads it ──

/** Who started a run, OPEN: `you` (the board's Start, a Run in Chat) or `spark` (its `flow_run`; `spark` names it).
 * A Run in a spark's thread is yours, with `spark` naming the thread whose scope it takes (CP4-Q20 (a)). */
export const FLOW_STARTERS = ["you", "spark"] as const;
export type FlowStarterBy = (typeof FLOW_STARTERS)[number];

export const FlowStarter = z
  .object({
    /** FLOW_STARTERS, OPEN */
    by: z.string().min(1).max(32),
    spark: SparkId.optional(),
  })
  .passthrough();
export type FlowStarter = z.infer<typeof FlowStarter>;

/** A run's state, OPEN: `running` (its script moves), `waiting` (on a step's agent), `holding` (on the person: a gate,
 * the cap, a repair miss, a changed flow, a lost step), then `done`, `stopped` (by a Stop), `failed` (the script threw)
 * or `lost` (its journal did not verify, set aside and never replayed; CP4-S15). */
export const FLOW_RUN_STATES = [
  "running",
  "waiting",
  "holding",
  "done",
  "stopped",
  "failed",
  "lost",
] as const;
export type FlowRunState = (typeof FLOW_RUN_STATES)[number];

export function flowRunStateOf(run: { readonly state: string }): FlowRunState | undefined {
  return knownWord(FLOW_RUN_STATES, run.state);
}

/** A step's state, OPEN: `waiting` (for an agent slot, LIVE_STEPS_MAX; CP4-S7), `working`, `repairing` (its one repair
 * turn, "Answering again"; CP4-Q7 (a)), `answered`, `holding` (on the person), `lost` (to a Quit; CP4-Q11 (a)),
 * `ended` (by the run's Stop or end) or `failed`. */
export const FLOW_STEP_STATES = [
  "waiting",
  "working",
  "repairing",
  "answered",
  "holding",
  "lost",
  "ended",
  "failed",
] as const;
export type FlowStepState = (typeof FLOW_STEP_STATES)[number];

export function flowStepStateOf(step: { readonly state: string }): FlowStepState | undefined {
  return knownWord(FLOW_STEP_STATES, step.state);
}

/** One agent call of a run, a row of its card (CP4-Q1 (a)): its call, the script's label, its agent, the session it
 * runs in (the runtime's run id, when it has one) and its state. */
export const FlowRunStep = z
  .object({
    call: FlowCallNumber,
    label: z.string().min(1).max(FLOW_LABEL_MAX).optional(),
    agent: z.string().min(1).max(64).optional(),
    session: z.string().min(1).max(128).optional(),
    phase: z.string().min(1).max(FLOW_LABEL_MAX).optional(),
    /** FLOW_STEP_STATES, OPEN */
    state: z.string().min(1).max(32),
  })
  .passthrough();
export type FlowRunStep = z.infer<typeof FlowRunStep>;

/** A run as `flows.list` and `flows.subscribe` carry it. `n` counts the flow's runs on this desktop, from 1; `hash` is
 * the version it runs; `calls` the calls it has made (the cap's count); `steps` the latest FLOW_RUN_STEPS_MAX agent
 * calls and `earlier` how many came before them; `log` its latest `log` line; `ended` the step agents its end or Stop
 * ended (CP4-Q10 (a): "Ended its 5 agents"). No spend (James, 2026-11-02 13:08Z). */
export const RunSummary = z
  .object({
    run: FlowRunId,
    flow: FlowSlug,
    name: z.string().min(1).max(NEEDS_NAME_MAX),
    n: z.number().int().positive(),
    hash: FlowHash,
    /** FLOW_RUN_STATES, OPEN */
    state: z.string().min(1).max(32),
    calls: z.number().int().min(0),
    steps: z.array(FlowRunStep).max(FLOW_RUN_STEPS_MAX),
    earlier: z.number().int().min(0).optional(),
    log: z.string().min(1).max(FLOW_LOG_MAX).optional(),
    starter: FlowStarter,
    startedAt: z.string().min(1),
    endedAt: z.string().min(1).optional(),
    ended: z.number().int().min(0).optional(),
  })
  .passthrough();
export type RunSummary = z.infer<typeof RunSummary>;

// ── the window's doors (methods.ts: agents.manage, local; VF-PM 2026-11-05 01:22Z) ──

/** flows.list and flows.subscribe: this desktop's library and runs. */
export const FlowsListParams = z.object({}).passthrough();
export type FlowsListParams = z.infer<typeof FlowsListParams>;

/** flows.list's answer and every flows.subscribe frame, whole (state transfer, as needs.subscribe's is): the library,
 * by slug, and the runs, latest first. */
export const FlowsListResult = z
  .object({
    flows: z.array(FlowEntry).max(FLOW_LIBRARY_MAX),
    runs: z.array(RunSummary).max(FLOW_RUNS_LISTED_MAX),
  })
  .passthrough();
export type FlowsListResult = z.infer<typeof FlowsListResult>;

/** A run's input: each `meta.input` name's value. */
export const FlowInput = z
  .record(FlowInputName, z.string().max(FLOW_INPUT_VALUE_MAX))
  .refine((input) => Object.keys(input).length <= FLOW_INPUTS_MAX, {
    message: `at most ${FLOW_INPUTS_MAX} inputs`,
  });
export type FlowInput = z.infer<typeof FlowInput>;

/** flows.run: a run as the person, from the approved bytes. `spark` is the thread a Run starts in, whose Agent
 * Profiles it takes; none, every profile the person has (CP4-Q20 (a)). */
export const FlowsRunParams = z
  .object({
    flow: FlowSlug,
    input: FlowInput.optional(),
    spark: SparkId.optional(),
  })
  .passthrough();
export type FlowsRunParams = z.infer<typeof FlowsRunParams>;

/** flows.run's answer: the run it started, or (`waits`) the `flow-changed` item a changed or never-approved flow waits
 * in, having started nothing (CP4-Q5 (a)). */
export const FlowsRunResult = z
  .object({
    run: RunSummary.optional(),
    waits: NeedsItemId.optional(),
  })
  .passthrough();
export type FlowsRunResult = z.infer<typeof FlowsRunResult>;

/** flows.stop: declarative; a run that has ended is answered as it is (CP4-Q9 (a)). */
export const FlowsStopParams = z.object({ run: FlowRunId }).passthrough();
export type FlowsStopParams = z.infer<typeof FlowsStopParams>;

export const FlowsStopResult = z.object({ run: RunSummary }).passthrough();
export type FlowsStopResult = z.infer<typeof FlowsStopResult>;

/** flows.script: a script's text, the library's file by `flow` or a kept version by `hash` (CP4-S10). One of the two;
 * both names the kept version, which must be one of that flow's. */
export const FlowsScriptParams = z
  .object({
    flow: FlowSlug.optional(),
    hash: FlowHash.optional(),
  })
  .passthrough();
export type FlowsScriptParams = z.infer<typeof FlowsScriptParams>;

/** Its answer: the bytes as text, at most SCRIPT_MAX_BYTES (a UTF-8 script's characters never outnumber its bytes),
 * and the hash they have. */
export const FlowsScriptResult = z
  .object({
    hash: FlowHash,
    text: z.string().max(FLOW_LIMITS.SCRIPT_MAX_BYTES),
    flow: FlowSlug.optional(),
  })
  .passthrough();
export type FlowsScriptResult = z.infer<typeof FlowsScriptResult>;

// ── a run's journal (CP-4a2a; CP4-S15, CP-D9; DESIGN.md §9 "What VibeField keeps, when it cannot read it", its
// CP-4a2a note): one JSONL file per run beside the approvals, under LAYOUT.FLOWS_DIR (fieldd's `flows/journal.ts`
// names it), written by fieldd alone and never by the run's host. Its first line is the head: the run, the flow, the
// approved bytes' hash, who started it. Then, in their order, each call the script made, each answer it was given, its
// `log` lines, and the end. Every line carries `mac` in the passthrough: fieldd's record signer's HMAC-SHA256 under
// FLOWS_KEY_FILE's secret, hex, over the canonical JSON of {run, prev, line}, with the line's own `mac` left out and
// `prev` the line before's `mac` ("" for the head). So a line copied from another run, dropped, or moved does not
// verify, and its run is set aside as lost (CP4-S15). The key and the MACs never reach the host.
//
// Replay (CP-D9): a host started again runs the script from the top, and each call the journal already answered is
// answered from it again by the call's key and its `#n` (the n-th call with that key), never handed on twice. The
// key is fieldd's SHA-256 over what the call is and every argument the script passed it (an agent call's prompt and its
// options, its agent and model among them; a gate's question and choices; fieldd's `flows/replay.ts`). ──

/** What a run's call is, OPEN: an agent step (`agent(…)`) or a gate (`ask(…)`). `log(…)` is a line of its own. */
export const FLOW_CALL_WHATS = ["agent", "ask"] as const;
export type FlowCallWhat = (typeof FLOW_CALL_WHATS)[number];

/** A call's replay key: SHA-256, hex. */
export const FlowCallKey = z.string().regex(/^[0-9a-f]{64}$/);
export type FlowCallKey = z.infer<typeof FlowCallKey>;

/** The line kinds this build writes, OPEN. */
export const FLOW_JOURNAL_KINDS = ["head", "call", "answer", "log", "end"] as const;
export type FlowJournalKind = (typeof FLOW_JOURNAL_KINDS)[number];

/** Why fieldd ended a run's host, OPEN (4A2-Q7; DESIGN.md §9 "When a run's script cannot go on"): `unanswered`
 * (it missed FLOW_LIMITS.HOST_PING_MISSES pings: a script that spins), `memory` (V8 ended its worker past
 * FLOW_LIMITS.HOST_HEAP_MB, or the host's resident memory passed HOST_RSS_MB; bth's re-read N1) or `protocol` (its pipe carried a frame past its bound, or one that is not JSON: the child
 * no longer holds its own bounds; bth's review P2, ruled 2026-11-05 11:46Z) or `flood` (more calls waiting at once
 * than FLOW_LIMITS.HOST_CALLS_WAITING_MAX, or more log lines than HOST_LOG_LINES_MAX; bth's review P1). A run whose
 * host fieldd ended is never started again; a new run starts from the top. */
export const FLOW_HOST_ENDINGS = ["unanswered", "memory", "protocol", "flood"] as const;
export type FlowHostEnding = (typeof FLOW_HOST_ENDINGS)[number];

/** Every line's head. `format` is the line's (FLOW_RECORD_FORMAT); one above it was written by a newer VibeField and
 * is kept for it, never read as this one. `seq` counts the file's lines from 1, the head's 1, with no gap. `kind` is
 * OPEN: FLOW_JOURNAL_KINDS. */
export const FlowJournalLine = z
  .object({
    format: z.number().int().min(1),
    seq: z.number().int().min(1),
    kind: z.string().min(1).max(32),
    /** when fieldd wrote it (ISO) */
    at: z.string().min(1),
  })
  .passthrough();
export type FlowJournalLine = z.infer<typeof FlowJournalLine>;

/** The file's first line: the run, its flow, the version it runs (the approval's hash; the bytes fieldd kept, never
 * the library's file, CP-D10), its name and number as a card says them (RunSummary's `name` and `n`), who started it
 * and its input. */
export const FlowJournalHead = FlowJournalLine.extend({
  kind: z.literal("head"),
  seq: z.literal(1),
  run: FlowRunId,
  flow: FlowSlug,
  name: z.string().min(1).max(NEEDS_NAME_MAX),
  n: z.number().int().positive(),
  hash: FlowHash,
  starter: FlowStarter,
  input: FlowInput.optional(),
});
export type FlowJournalHead = z.infer<typeof FlowJournalHead>;

/** A call the script made, journaled BEFORE fieldd does it: its number in the run (from 1, `origin.call`), what it is
 * (FLOW_CALL_WHATS, OPEN), its replay key and `n`, and, for a card, the label, agent and phase the script gave it. */
export const FlowJournalCall = FlowJournalLine.extend({
  kind: z.literal("call"),
  call: FlowCallNumber,
  what: z.string().min(1).max(32),
  key: FlowCallKey,
  n: z.number().int().positive(),
  label: z.string().min(1).max(FLOW_LABEL_MAX).optional(),
  agent: z.string().min(1).max(64).optional(),
  phase: z.string().min(1).max(FLOW_LABEL_MAX).optional(),
});
export type FlowJournalCall = z.infer<typeof FlowJournalCall>;

/** A call's answer, as the script receives it: `value` (any JSON, at most FLOW_LIMITS.RESULT_MAX_BYTES as UTF-8 JSON;
 * `cut` when the step's message was longer and `value` is its text, cut there, CP4-Q17 (a)), or `refused`, the words
 * the script's `await` throws with. One of the two. */
export const FlowJournalAnswer = FlowJournalLine.extend({
  kind: z.literal("answer"),
  call: FlowCallNumber,
  value: z.unknown().optional(),
  cut: z.literal(true).optional(),
  refused: z.string().min(1).max(FLOW_LOG_MAX).optional(),
});
export type FlowJournalAnswer = z.infer<typeof FlowJournalAnswer>;

/** A `log(…)` line, cut at FLOW_LOG_MAX. */
export const FlowJournalLog = FlowJournalLine.extend({
  kind: z.literal("log"),
  text: z.string().min(1).max(FLOW_LOG_MAX),
});
export type FlowJournalLog = z.infer<typeof FlowJournalLog>;

/** The run's end, the file's last line: its state (FLOW_RUN_STATES' `done`, `stopped`, `failed` or `lost`, OPEN), why
 * fieldd ended its host when it did (FLOW_HOST_ENDINGS, OPEN), what the script threw (its own words, cut at
 * FLOW_LOG_MAX) and the step agents its end ended (RunSummary's `ended`). */
export const FlowJournalEnd = FlowJournalLine.extend({
  kind: z.literal("end"),
  state: z.string().min(1).max(32),
  host: z.string().min(1).max(32).optional(),
  threw: z.string().min(1).max(FLOW_LOG_MAX).optional(),
  ended: z.number().int().min(0).optional(),
});
export type FlowJournalEnd = z.infer<typeof FlowJournalEnd>;

export const FlowJournalKnownLine = z.discriminatedUnion("kind", [
  FlowJournalHead,
  FlowJournalCall,
  FlowJournalAnswer,
  FlowJournalLog,
  FlowJournalEnd,
]);
export type FlowJournalKnownLine = z.infer<typeof FlowJournalKnownLine>;

const utf8 = new TextEncoder();

/** An answer's value as the pipe and the journal bound it: its JSON's UTF-8 bytes. */
export function flowAnswerBytes(value: unknown): number {
  return utf8.encode(JSON.stringify(value ?? null)).byteLength;
}

/** A line as one of this build's kinds, else undefined: a format or a kind it does not know, a body that does not
 * parse, an answer with both a value and a refusal or neither, or a value past FLOW_LIMITS.RESULT_MAX_BYTES. The MAC
 * is not this function's: fieldd verifies it, and the chain, before it reads a line as known. */
export function flowJournalLineOf(line: unknown): FlowJournalKnownLine | undefined {
  const parsed = FlowJournalKnownLine.safeParse(line);
  if (!parsed.success || parsed.data.format !== FLOW_RECORD_FORMAT) return undefined;
  const known = parsed.data;
  if (known.kind === "answer") {
    const hasValue = "value" in known && known.value !== undefined;
    if (hasValue === (known.refused !== undefined)) return undefined;
    if (hasValue && flowAnswerBytes(known.value) > FLOW_LIMITS.RESULT_MAX_BYTES) return undefined;
    if (known.cut === true && typeof known.value !== "string") return undefined;
  }
  return known;
}
