import { z } from "zod";
import { AgentProfileSetId, AgentProviderId } from "./agent-index";
import { AgentModelSelection, AgentSessionOrigin, SparkId } from "./agent-session";

// The compose plane, version 2 (track CO; `draft/compose-plane/v2/`, ruled by James on its page 2026-10-29
// 09:42–09:57Z; the study's §15 and §16). A spark is an agent session VibeField starts in a folder of its own, under
// the Agent Profiles James checks for it (NS-D5). fieldd serves it one MCP server, `vibefield`, whose tools are rows
// of the tool plane's one catalog (tools.ts, MT-L1), each held to the caller's profiles at every call (TL-D5). fieldd
// knows a caller by its process — the floor's socket, the kernel's pid, the pane that holds it — never by a token
// (CP-L3, CP-D1).
// *Narrowed 2026-10-30 21:19Z by MT-D2 (`draft/thinking-tool-plane.md` §5): this header said "Plain agents hold no
// door (CP-L1): anything else that reaches the server sees an empty tool list". That law now governs the COMPOSE
// rooms alone. A plain run fieldd can name holds the door too and is served the `agent` rows (History, the projects
// list); the agents a spark spawns get no compose tools and never address each other.*
//
// Three projections of one verb set (CP-L2): the MCP tools a caller sees (tools.ts, by audience), the flow API a run
// calls (CP-4), and the `compose.*` doors the window calls (METHODS rows; the sparks' doors are below).
//
// TS-only: field-native reads none of it (gen-jsonschema.ts's agent-plane rule). The floor's door messages, which it
// does read, live in mgmt.ts.

// ── the spark ──

/** NS-D1 — what it is called. One line; names are unique per user, compared without case, because @ finds a spark by
 * its name (EW-D3). */
export const SparkName = z
  .string()
  .min(1)
  .max(32)
  .regex(/^\S(?:.*\S)?$/);
export type SparkName = z.infer<typeof SparkName>;

/** NS-D2 (ruled B, 2026-10-29) — a spark's face is picked apart from its name, by a reroll, and it keeps the face when
 * it is renamed. `seed` is the face's seed in James's spark engine (`agentDNA(seed)`), which DESIGN.md's spark faces
 * section draws. Passthrough, so a newer engine's field rides through. */
export const SparkFace = z.object({ seed: z.number().int().min(0).max(0xffffffff) }).passthrough();
export type SparkFace = z.infer<typeof SparkFace>;

/** CP-3 — a needs-you item's id: fieldd's, minted when it is raised. An agent's own ask has one derived from its run
 * and its blocker, so it is the same on every read. */
export const NeedsItemId = z.string().regex(/^ny-[0-9a-z]{6,32}$/);
export type NeedsItemId = z.infer<typeof NeedsItemId>;

const sparkFields = {
  id: SparkId,
  name: SparkName,
  face: SparkFace,
  /** NS-D1 — the agent it thinks with: Claude Code today, Codex and Grok once they can take the door (CP-5) */
  agent: AgentProviderId,
  /** the model it thinks at, as the sheet asked (opaque, AR-L1); absent: its agent's own default */
  modelSelection: AgentModelSelection.optional(),
  /** NS-D5 — the Agent Profiles it works in: it sees their sessions and starts agents with their sign-ins, and nothing
   * else (TL-D5). Never empty. */
  profiles: z.array(AgentProfileSetId).min(1).max(32),
  /** NS-D5 — the profile its own session runs under; always one of `profiles` (the sheet keeps it checked). Thinking
   * under another starts a fresh session (NS-D6). */
  thinksUnder: AgentProfileSetId,
  /** its home folder, made when it hatched: absolute, under the user's `sparks/` */
  folder: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
};

const thinksUnderItsProfiles = (
  s: { profiles: string[]; thinksUnder: string },
  ctx: z.RefinementCtx,
) => {
  if (!s.profiles.includes(s.thinksUnder))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["thinksUnder"],
      message: "a spark thinks under one of its own profiles",
    });
};

export const SPARK_RECORD_FORMAT = 1;

/** One spark, as fieldd keeps it: one file per spark under the user root (CP-1c adds its LAYOUT row), outside the
 * spark's own folder and signed like a session record, so an agent that edits the file cannot widen its profiles. */
export const SparkRecord = z
  .object({
    format: z.literal(SPARK_RECORD_FORMAT),
    ...sparkFields,
    /** the session it last thought in: a sleeping spark wakes in it (CR-D11, CP-D14) */
    session: z
      .object({ runtimeRunId: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine(thinksUnderItsProfiles);
export type SparkRecord = z.infer<typeof SparkRecord>;

/** One spark, as the window's doors answer it: the record and whether its session is running now. */
export const SparkSummary = z
  .object({
    ...sparkFields,
    session: z
      .object({
        runtimeRunId: z.string().min(1),
        /** the pane its session lives in, while it has one */
        terminalSessionId: z.string().min(1).optional(),
        /** awake: its session's process is running. Asleep otherwise (CP-D14); a message or `open` wakes it. */
        live: z.boolean(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type SparkSummary = z.infer<typeof SparkSummary>;

// ── compose.sparks.* — the window's doors (METHODS rows; `agents.manage`, local, as the other doors that start
// agents for the person at this device) ──

export const ComposeSparksListResult = z.object({ sparks: z.array(SparkSummary) }).passthrough();
export type ComposeSparksListResult = z.infer<typeof ComposeSparksListResult>;

/** NS-D1, NS-D2 B, NS-D5 — the New spark sheet's answers. fieldd refuses a name another spark of this user holds, an
 * agent that cannot take the door yet, and a profile with no sign-in for the agent, each PRECONDITION_FAILED with
 * the reason in its details. */
export const ComposeSparksHatchParams = z
  .object({
    name: SparkName,
    face: SparkFace,
    agent: AgentProviderId,
    modelSelection: AgentModelSelection.optional(),
    profiles: z.array(AgentProfileSetId).min(1).max(32),
    thinksUnder: AgentProfileSetId,
  })
  .passthrough()
  .superRefine(thinksUnderItsProfiles);
export type ComposeSparksHatchParams = z.infer<typeof ComposeSparksHatchParams>;

export const ComposeSparksHatchResult = z.object({ spark: SparkSummary }).passthrough();
export type ComposeSparksHatchResult = z.infer<typeof ComposeSparksHatchResult>;

/** Wake a spark: its last session is resumed when it sleeps (CR-D11), and a live one is answered as it is. */
export const ComposeSparksOpenParams = z.object({ spark: SparkId }).passthrough();
export type ComposeSparksOpenParams = z.infer<typeof ComposeSparksOpenParams>;

export const ComposeSparksOpenResult = z.object({ spark: SparkSummary }).passthrough();
export type ComposeSparksOpenResult = z.infer<typeof ComposeSparksOpenResult>;

// ── the verbs moved to tools.ts in MT-0 (2026-10-30), the tool plane's one catalog: every spark is served
// every row that has landed, and a plain run the `agent` rows (TL-D1 A, narrowed by MT-D2). Their inputs and
// outputs stay below, the compose room's own shapes. ──

// ── CP-1's verbs: inputs and outputs (the MCP tools' schemas; fieldd projects them to JSON Schema) ──

export const ComposeAgentsAvailableInput = z.object({}).passthrough();
export type ComposeAgentsAvailableInput = z.infer<typeof ComposeAgentsAvailableInput>;

/** A model an agent offers, as `agent_spawn` takes it (opaque ids, AR-L1). */
export const ComposeModel = z
  .object({
    /** the agent's own model id */
    id: z.string().min(1).max(1024),
    label: z.string().max(256).optional(),
    /** the values of its effort control, as the agent names them; absent when it has none */
    efforts: z.array(z.string().min(1).max(64)).max(16).optional(),
    default: z.boolean().optional(),
  })
  .passthrough();
export type ComposeModel = z.infer<typeof ComposeModel>;

export const ComposeAvailableAgent = z
  .object({
    agent: AgentProviderId,
    /** the catalog's label (AC-D4) */
    label: z.string().min(1),
    profile: AgentProfileSetId,
    /** the profile as Settings names it */
    profileName: z.string().min(1),
    models: z.array(ComposeModel),
    /** why `models` is empty: one sentence, never the agent's error text */
    modelsNote: z.string().optional(),
  })
  .passthrough();
export type ComposeAvailableAgent = z.infer<typeof ComposeAvailableAgent>;

export const ComposeAgentsAvailableOutput = z
  .object({ agents: z.array(ComposeAvailableAgent) })
  .passthrough();
export type ComposeAgentsAvailableOutput = z.infer<typeof ComposeAgentsAvailableOutput>;

export const ComposeProjectsListInput = z.object({}).passthrough();
export type ComposeProjectsListInput = z.infer<typeof ComposeProjectsListInput>;

export const ComposeProject = z
  .object({
    /** the project's key (PJ's join column) */
    key: z.string().min(1),
    name: z.string(),
    /** this desktop's folders for it, newest first */
    folders: z.array(z.string().min(1)),
  })
  .passthrough();
export type ComposeProject = z.infer<typeof ComposeProject>;

export const ComposeProjectsListOutput = z
  .object({ projects: z.array(ComposeProject) })
  .passthrough();
export type ComposeProjectsListOutput = z.infer<typeof ComposeProjectsListOutput>;

/** A session's state in a spark's words. `working` — a turn is running; `idle` — its turn ended and nothing waits on
 * the user; `asking` — it waits on the user (an approval, a question); `failed` — a blocker that is a failure;
 * `ended` — its process is gone. The waker reads the same five (CP-L5). OPEN on the wire. */
export const COMPOSE_SESSION_STATES = ["working", "idle", "asking", "failed", "ended"] as const;
export type ComposeSessionState = (typeof COMPOSE_SESSION_STATES)[number];

export const ComposeAgentsListInput = z
  .object({
    /** also list the sessions that ended (absent: running ones only) */
    ended: z.boolean().optional(),
  })
  .passthrough();
export type ComposeAgentsListInput = z.infer<typeof ComposeAgentsListInput>;

export const ComposeSession = z
  .object({
    /** what agent_read and the other verbs take */
    id: z.string().min(1),
    agent: AgentProviderId,
    title: z.string().optional(),
    /** `COMPOSE_SESSION_STATES`; OPEN */
    state: z.string().min(1).max(32),
    /** what it waits on while `asking`: a tool's name, or "a question" */
    asking: z.string().optional(),
    folder: z.string(),
    profile: AgentProfileSetId.optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    /** what it has spent, in US dollars, as its agent reports it */
    usd: z.number().nonnegative().optional(),
    startedAt: z.string().optional(),
    origin: AgentSessionOrigin.optional(),
    /** the session is that spark's own */
    spark: SparkId.optional(),
  })
  .passthrough();
export type ComposeSession = z.infer<typeof ComposeSession>;

export const ComposeAgentsListOutput = z
  .object({ sessions: z.array(ComposeSession) })
  .passthrough();
export type ComposeAgentsListOutput = z.infer<typeof ComposeAgentsListOutput>;

/** One turn as a spark reads it: what was asked, or what the agent answered. Arrives as a tool result, which the
 * model treats as content, never as an instruction from the user (the threat table's second row). */
export const ComposeTurn = z
  .object({
    /** `user` or `agent`; OPEN */
    who: z.string().min(1).max(16),
    text: z.string(),
    /** epoch ms */
    at: z.number().finite().optional(),
    /** the text was cut at the read's bound */
    cut: z.boolean().optional(),
  })
  .passthrough();
export type ComposeTurn = z.infer<typeof ComposeTurn>;

export const ComposeAgentReadInput = z
  .object({
    session: z.string().min(1),
    /** how many turns, newest last (absent: 4) */
    turns: z.number().int().min(1).max(20).optional(),
    /** the `before` an earlier read returned */
    before: z.string().min(1).optional(),
  })
  .passthrough();
export type ComposeAgentReadInput = z.infer<typeof ComposeAgentReadInput>;

/** agent_read's and history_read's answer. */
export const ComposeReadOutput = z
  .object({
    session: z.string().min(1),
    turns: z.array(ComposeTurn),
    /** pass it back as `before` for the turns before these; absent at the session's start */
    before: z.string().min(1).optional(),
  })
  .passthrough();
export type ComposeReadOutput = z.infer<typeof ComposeReadOutput>;

export const ComposeHistorySearchInput = z
  .object({
    query: z.string().min(1).max(512),
    /** absent: 20 */
    limit: z.number().int().min(1).max(50).optional(),
    agent: AgentProviderId.optional(),
    /** an ISO date or time: only turns at or after it */
    since: z.string().min(1).optional(),
  })
  .passthrough();
export type ComposeHistorySearchInput = z.infer<typeof ComposeHistorySearchInput>;

export const ComposeHistoryHit = z
  .object({
    /** what history_read takes */
    session: z.string().min(1),
    title: z.string().optional(),
    agent: AgentProviderId.optional(),
    profile: AgentProfileSetId.optional(),
    folder: z.string().optional(),
    /** epoch ms */
    at: z.number().finite().optional(),
    /** the matched words marked with `[` and `]` */
    snippet: z.string(),
  })
  .passthrough();
export type ComposeHistoryHit = z.infer<typeof ComposeHistoryHit>;

/** `answered: false` is the index's honest "no answer" (building, unreachable): say that, never "nothing found". */
export const ComposeHistorySearchOutput = z
  .object({
    answered: z.boolean(),
    hits: z.array(ComposeHistoryHit),
    note: z.string().optional(),
  })
  .passthrough();
export type ComposeHistorySearchOutput = z.infer<typeof ComposeHistorySearchOutput>;

export const ComposeHistoryReadInput = ComposeAgentReadInput;
export type ComposeHistoryReadInput = z.infer<typeof ComposeHistoryReadInput>;

// ── CP-2: start and talk (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31 03:49:24Z, CP2-D1…D7 on their
// leans). A spark's words join the session's one input queue and land at its next idle moment, marked as the spark's
// and sent on the person's behalf (CP-L5, CP2-D1); no call blocks, so every answer here is what was queued or sent,
// never what the other agent did with it.

/** The longest text one send or one task carries. */
export const COMPOSE_TEXT_MAX = 32_000;

/** agent_spawn: one agent under one of the spark's profiles, one level deep (TL-D2). fieldd's spawn takes no first
 * prompt, so each task is queued and lands at the agent's next idle moment (the v2 page's spawn). */
export const ComposeAgentSpawnInput = z
  .object({
    /** the agent, as agents_available names it */
    agent: AgentProviderId,
    /** the profile set it runs under, one of the spark's (absent: the one the spark thinks under) */
    profile: AgentProfileSetId.optional(),
    /** the folder it starts in (absent: the spark's own folder) */
    cwd: z.string().min(1).optional(),
    /** a model the agent offers and its controls, the effort among them (PJ-6) */
    model: AgentModelSelection.optional(),
    /** the first prompts, queued in order */
    tasks: z.array(z.string().min(1).max(COMPOSE_TEXT_MAX)).max(16).optional(),
  })
  .passthrough();
export type ComposeAgentSpawnInput = z.infer<typeof ComposeAgentSpawnInput>;

/** A spawn starts, or past the spark's cap waits in the needs-you queue for the user's OK (CP-D7, CP3-D4 A): one
 * object with one of the two, never a union, because an MCP output schema is an object. */
export const ComposeAgentSpawnOutput = z
  .object({
    /** the new session (absent while it waits for the user's OK, `held`) */
    session: z.string().min(1).optional(),
    /** past the cap: the needs-you item it waits in */
    held: NeedsItemId.optional(),
    /** how many tasks wait: in its queue, or with the held item */
    queued: z.number().int().min(0),
  })
  .passthrough()
  .superRefine((out, ctx) => {
    if ((out.session === undefined) === (out.held === undefined))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a session or a held item, one of them",
      });
  });
export type ComposeAgentSpawnOutput = z.infer<typeof ComposeAgentSpawnOutput>;

/** The one input of agent_watch, agent_unwatch, agent_interrupt and agent_stop: the session it acts on. */
export const ComposeAgentSessionInput = z.object({ session: z.string().min(1) }).passthrough();
export type ComposeAgentSessionInput = z.infer<typeof ComposeAgentSessionInput>;

export const ComposeAgentWatchOutput = z
  .object({ session: z.string().min(1), watching: z.boolean() })
  .passthrough();
export type ComposeAgentWatchOutput = z.infer<typeof ComposeAgentWatchOutput>;

export const ComposeAgentSendInput = z
  .object({ session: z.string().min(1), text: z.string().min(1).max(COMPOSE_TEXT_MAX) })
  .passthrough();
export type ComposeAgentSendInput = z.infer<typeof ComposeAgentSendInput>;

/** A send is queued, never delivered, at the call; the spark is told how it went on its next wake (CP2-D2). Or it is
 * held for the user's OK (CP-D3, CP3-D3 B: the first send into a session the user started), and the answer is a
 * wake too. */
export const ComposeAgentSendOutput = z
  .object({
    session: z.string().min(1),
    /** queued now; false while it waits for the user's OK (CP-D3) */
    queued: z.boolean(),
    /** its place in the session's queue, 1 being next (queued only) */
    position: z.number().int().min(1).optional(),
    /** the needs-you item it waits in (held only) */
    held: NeedsItemId.optional(),
  })
  .passthrough()
  .superRefine((out, ctx) => {
    const ok = out.queued
      ? out.position !== undefined && out.held === undefined
      : out.held !== undefined && out.position === undefined;
    if (!ok)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "queued with a place, or held with an item",
      });
  });
export type ComposeAgentSendOutput = z.infer<typeof ComposeAgentSendOutput>;

/** The stop was delivered to the agent, never that its turn ended (puppeteer's turn stop). */
export const ComposeAgentInterruptOutput = z
  .object({ session: z.string().min(1), sent: z.literal(true) })
  .passthrough();
export type ComposeAgentInterruptOutput = z.infer<typeof ComposeAgentInterruptOutput>;

/** The end has begun (the floor's ladder: a stop, then the signals); the session's row says when it is gone. */
export const ComposeAgentStopOutput = z
  .object({ session: z.string().min(1), ending: z.literal(true) })
  .passthrough();
export type ComposeAgentStopOutput = z.infer<typeof ComposeAgentStopOutput>;

// ── a session's input queue, as fieldd keeps it (CP2-D3; signed since CP-3, LEANS P3) ──

/** Who a kept input is from: a spark, by id and by the name its words are marked with; or fieldd's own wake. CLOSED:
 * an input lands marked by its source (CP2-D1), so one from a source this build cannot mark is never delivered. */
export const AgentInputSender = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("spark"), spark: SparkId, name: SparkName }).passthrough(),
  z.object({ kind: z.literal("fieldd") }).passthrough(),
]);
export type AgentInputSender = z.infer<typeof AgentInputSender>;

/** One input that waits for a session's next idle moment. Its text has no bound here: fieldd's wakes that wait join
 * into one line (CP-D4), and a spark's own words were bounded at its call (COMPOSE_TEXT_MAX). */
export const AgentQueuedInput = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().min(1),
    from: AgentInputSender,
    /** when it was queued (ISO) */
    at: z.string().min(1),
  })
  .passthrough();
export type AgentQueuedInput = z.infer<typeof AgentQueuedInput>;

export const AGENT_INPUT_QUEUE_FORMAT = 1;

/** One session's queue, one file per run under LAYOUT.AGENT_INPUTS_DIR, signed with AGENT_INPUTS_KEY_FILE's secret by
 * fieldd's one record signer. The schema is the unsigned body; the file adds its `signature`. A file a same-uid agent
 * wrote or edited would otherwise speak as a spark or as VibeField into the session at its next idle, so fieldd sets
 * aside, and never delivers, a file that is unsigned, does not verify, does not parse, or names another run. */
export const AgentInputQueueFile = z
  .object({
    format: z.literal(AGENT_INPUT_QUEUE_FORMAT),
    /** the run it waits for, its file's name too: inside the signature, so a file copied to another run's name is
     * refused there */
    run: z.string().min(1),
    /** oldest first; an empty queue keeps no file */
    inputs: z.array(AgentQueuedInput).min(1),
  })
  .passthrough();
export type AgentInputQueueFile = z.infer<typeof AgentInputQueueFile>;

// ── CP-3: the person (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31 06:31:34Z: CP3-D1…D8 at A). The
// needs-you queue (CP-D12) is fieldd's one list of what waits on the person: a spark's question (`ask_user`), its first
// send into a session the person started (CP-D3, CP3-D3 B), a spawn past its cap (CP-D7, CP3-D4 A), and an agent's own
// ask, which is listed with where to answer it and never answered here (CP3-D1 A, CP-L4). Answered once, an item is
// answered for every window, and the spark hears the answer as a wake (CP3-D2 A). The words of every act are DESIGN.md
// §9's ("The person's queue's words"); a window answers by an act's place, never its word. ──

/** ask_user's question, before the card cuts it to three lines */
export const NEEDS_QUESTION_MAX = 500;
/** one choice's label */
export const NEEDS_CHOICE_MAX = 40;
/** a question's own choices; Not now is VibeField's, after them */
export const NEEDS_CHOICES_MAX = 4;
/** an item's words on the wire; fieldd cuts longer ones and says `cut` */
export const NEEDS_WORDS_MAX = 2_000;
/** a name as an item or a fact says it: a run's title is cut here, with "…" (DESIGN.md §9) */
export const NEEDS_NAME_MAX = 64;
/** fieldd's own words for why an act failed or a spark was not told */
export const NEEDS_REASON_MAX = 256;
/** a notify's words, one line, after fieldd collapses its whitespace */
export const NEEDS_NOTICE_CHARS = 140;
/** what notify accepts before that cut */
export const COMPOSE_NOTIFY_MAX = 500;
/** the sends that wait on one held item */
export const NEEDS_HELD_SENDS_MAX = 16;
/** what one spark may have waiting on the person at once, its questions, held sends and spawns together (PF4's
 * watermark): a ninth is refused as the fact `limit` */
export const NEEDS_OPEN_PER_SPARK = 8;

/** The acts' words (DESIGN.md §9 "The person's queue's words"): one authority for fieldd, the window and tests. A
 * question's own choices come first and Not now is always last; a held item's yes is always first. */
export const NEEDS_CHOICE_WORDS = {
  allow: "Allow",
  allowOneMore: "Allow one more",
  notNow: "Not now",
} as const;

/** The kinds and states, OPEN on the wire like COMPOSE_SESSION_STATES: a word this build never heard of must not refuse
 * an item. `ended`: what it waited on ended before an answer (a held send's session), or an allowance's run ended. */
export const NEEDS_ITEM_KINDS = ["question", "held-send", "held-spawn", "agent-ask"] as const;
export type NeedsItemKind = (typeof NEEDS_ITEM_KINDS)[number];
export const NEEDS_ITEM_STATES = ["open", "answered", "ended"] as const;
export type NeedsItemState = (typeof NEEDS_ITEM_STATES)[number];
/** What became of an answer's act, OPEN: done, or failed with fieldd's `reason`. Whether the spark has heard it is
 * apart (`told`), so an act done for a spark that sleeps is still done. */
export const NEEDS_ANSWER_OUTCOMES = ["done", "failed"] as const;
export type NeedsAnswerOutcome = (typeof NEEDS_ANSWER_OUTCOMES)[number];

/** An act's place among an item's choices. */
const NeedsChoiceIndex = z.number().int().min(0).max(NEEDS_CHOICES_MAX);

/** Who asks or tells: as Chat or Godview names it, its session, and the spark when the teller IS that spark. */
export const NeedsFrom = z
  .object({
    name: z.string().min(1).max(NEEDS_NAME_MAX),
    session: z.string().min(1).optional(),
    spark: SparkId.optional(),
  })
  .passthrough();
export type NeedsFrom = z.infer<typeof NeedsFrom>;

/** How an item was answered. The record says the person did it; the audit line says from which window. */
export const NeedsAnswer = z
  .object({
    /** the act's place among the item's choices, never its word */
    choice: NeedsChoiceIndex,
    /** when it was answered (ISO) */
    at: z.string().min(1),
    /** NEEDS_ANSWER_OUTCOMES, OPEN */
    outcome: z.string().min(1).max(32),
    /** why the act failed, in fieldd's words */
    reason: z.string().min(1).max(NEEDS_REASON_MAX).optional(),
    /** the spark has been told: the answer's fact is in its input queue */
    told: z.boolean(),
    /** why it has not been told yet (told false): it hears the answer when it next wakes */
    waits: z.string().min(1).max(NEEDS_REASON_MAX).optional(),
  })
  .passthrough();
export type NeedsAnswer = z.infer<typeof NeedsAnswer>;

export const NeedsItem = z
  .object({
    id: NeedsItemId,
    /** NEEDS_ITEM_KINDS, OPEN */
    kind: z.string().min(1).max(32),
    /** NEEDS_ITEM_STATES, OPEN */
    state: z.string().min(1).max(32),
    from: NeedsFrom,
    /** the spark whose thread shows it: the asker, or the spark that started the asking agent */
    spark: SparkId.optional(),
    /** when it was asked (ISO) */
    asked: z.string().min(1),
    /** the asker's own words: the question, the held words, a held spawn's first task (absent: none) */
    words: z.string().min(1).max(NEEDS_WORDS_MAX).optional(),
    /** `words` was cut at NEEDS_WORDS_MAX */
    cut: z.literal(true).optional(),
    /** what the person may answer, in order; absent: nothing to answer here (an agent's own ask) */
    choices: z
      .array(z.string().min(1).max(NEEDS_CHOICE_MAX))
      .min(1)
      .max(NEEDS_CHOICES_MAX + 1)
      .optional(),
    /** how many wait together: a held send's words, or an agent's asks */
    count: z.number().int().min(1).optional(),
    /** a held send: the session it is for */
    to: z
      .object({ session: z.string().min(1), name: z.string().min(1).max(NEEDS_NAME_MAX) })
      .passthrough()
      .optional(),
    /** a held spawn: the agent, its folder by its last segment, and the spark's live agents when it asked */
    agent: AgentProviderId.optional(),
    folder: z.string().min(1).max(255).optional(),
    live: z.number().int().min(0).optional(),
    /** an agent's own ask: its blocker's kind (permission | question, OPEN), and a permission's tool */
    ask: z.string().min(1).max(32).optional(),
    tool: z.string().min(1).max(128).optional(),
    answer: NeedsAnswer.optional(),
  })
  .passthrough();
export type NeedsItem = z.infer<typeof NeedsItem>;

/** needs.list's answer and every needs.subscribe frame: the open items, oldest first, whole. */
export const NeedsListResult = z.object({ items: z.array(NeedsItem) }).passthrough();
export type NeedsListResult = z.infer<typeof NeedsListResult>;

/** needs.answer: the act by its place among the item's choices (DESIGN.md §9), so rewording an act is no wire change. */
export const NeedsAnswerParams = z
  .object({ item: NeedsItemId, choice: NeedsChoiceIndex })
  .passthrough();
export type NeedsAnswerParams = z.infer<typeof NeedsAnswerParams>;

export const NeedsAnswerResult = z.object({ item: NeedsItem }).passthrough();
export type NeedsAnswerResult = z.infer<typeof NeedsAnswerResult>;

/** A notify, as the window and main hear it (needs.notices.subscribe). Never kept: it is an event. */
export const NeedsNotice = z
  .object({
    id: z.string().regex(/^nt-[0-9a-z]{6,32}$/),
    from: NeedsFrom,
    words: z.string().min(1).max(NEEDS_NOTICE_CHARS),
    /** when it was told (ISO) */
    at: z.string().min(1),
  })
  .passthrough();
export type NeedsNotice = z.infer<typeof NeedsNotice>;

export const NeedsNotices = z.object({ notices: z.array(NeedsNotice).max(16) }).passthrough();
export type NeedsNotices = z.infer<typeof NeedsNotices>;

/** The notices one needs.notices.subscribe frame tells, as main and every window read them: each on its own, so one
 * this build cannot read is passed over and the rest are said (the tolerant reader); a frame with no list tells none. */
export function needsNoticesOf(payload: unknown): NeedsNotice[] {
  const notices =
    typeof payload === "object" && payload !== null
      ? (payload as { notices?: unknown }).notices
      : undefined;
  if (!Array.isArray(notices)) return [];
  const read: NeedsNotice[] = [];
  for (const value of notices) {
    const notice = NeedsNotice.safeParse(value);
    if (notice.success) read.push(notice.data);
  }
  return read;
}

/** One of a question's choices: one line, trimmed. */
const AskChoice = z
  .string()
  .trim()
  .min(1)
  .max(NEEDS_CHOICE_MAX)
  .regex(/^[^\r\n]+$/);

/** ask_user (sparks only, MT-D11): a question with one to four distinct choices of the spark's own. It returns at once
 * and the answer is a wake (CP3-D2 A); Not now is VibeField's, so no choice may be it. */
export const ComposeAskUserInput = z
  .object({
    question: z.string().min(1).max(NEEDS_QUESTION_MAX),
    choices: z.array(AskChoice).min(1).max(NEEDS_CHOICES_MAX),
  })
  .passthrough()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [i, choice] of input.choices.entries()) {
      const key = choice.toLowerCase();
      if (key === NEEDS_CHOICE_WORDS.notNow.toLowerCase() || seen.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices", i],
          message: `"${choice}" is a choice already, or VibeField's own`,
        });
      seen.add(key);
    }
  });
export type ComposeAskUserInput = z.infer<typeof ComposeAskUserInput>;

export const ComposeAskUserOutput = z
  .object({ item: NeedsItemId, queued: z.literal(true) })
  .passthrough();
export type ComposeAskUserOutput = z.infer<typeof ComposeAskUserOutput>;

/** notify (every agent, MT-D11): words for the user, said on one line on every window's status line, and as an OS
 * notice while no window is in front (CP3-D5 A). */
export const ComposeNotifyInput = z
  .object({ text: z.string().min(1).max(COMPOSE_NOTIFY_MAX) })
  .passthrough();
export type ComposeNotifyInput = z.infer<typeof ComposeNotifyInput>;

/** Handed to the windows and to main, never that the user read it (CP-2's house rule). */
export const ComposeNotifyOutput = z.object({ sent: z.literal(true) }).passthrough();
export type ComposeNotifyOutput = z.infer<typeof ComposeNotifyOutput>;

export const NEEDS_RECORD_FORMAT = 1;

/** What a held spawn starts once the user allows it: agent_spawn's launch after its defaults, and its tasks. */
export const NeedsHeldLaunch = z
  .object({
    agent: AgentProviderId,
    profileSet: AgentProfileSetId,
    cwd: z.string().min(1),
    model: AgentModelSelection.optional(),
    tasks: z.array(z.string().min(1).max(COMPOSE_TEXT_MAX)).max(16),
  })
  .passthrough();
export type NeedsHeldLaunch = z.infer<typeof NeedsHeldLaunch>;

/** The record fieldd keeps per item, one file per item under LAYOUT.NEEDS_DIR, signed with NEEDS_KEY_FILE's secret by
 * fieldd's one record signer. The schema is the unsigned body; the file adds its `signature`, and its name is the
 * item's id, inside the signature. What an Allow acts on (the held words, the launch) is kept here and never rides the
 * wire. An agent's own ask is never kept: it is read from its run's blockers. */
export const NeedsRecord = z
  .object({
    format: z.literal(NEEDS_RECORD_FORMAT),
    item: NeedsItem,
    /** a held send: the words, in order, until the Allow queues them */
    texts: z
      .array(z.string().min(1).max(COMPOSE_TEXT_MAX))
      .min(1)
      .max(NEEDS_HELD_SENDS_MAX)
      .optional(),
    /** a held spawn: what Allow one more starts, until it does */
    launch: NeedsHeldLaunch.optional(),
    /** the spark's name its words are marked with (CP2-D1) */
    sender: SparkName.optional(),
    /** the fact owed to its spark, until it is in the spark's input queue */
    owed: z.string().min(1).max(NEEDS_WORDS_MAX).optional(),
    /** the act an answer began and did not record done: after a restart the spark is told it is uncertain, and it is
     * never done again (CP2-D2) */
    acting: z
      .object({ choice: NeedsChoiceIndex, at: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type NeedsRecord = z.infer<typeof NeedsRecord>;
