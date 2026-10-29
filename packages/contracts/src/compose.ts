import { z } from "zod";
import { AgentProfileSetId, AgentProviderId } from "./agent-index";
import { AgentModelSelection, AgentSessionOrigin, SparkId } from "./agent-session";

// The compose plane, version 2 (track CO; `draft/compose-plane/v2/`, ruled by James on its page 2026-10-29
// 09:42–09:57Z; the study's §15 and §16). A spark is an agent session VibeField starts in a folder of its own, under
// the Agent Profiles James checks for it (NS-D5). fieldd serves it one MCP server, `vibefield`, whose verbs are
// defined here once (CP-L2) and held to the spark's profiles at every call (TL-D5). Plain agents hold no door (CP-L1):
// anything else that reaches the server sees an empty tool list. fieldd knows a caller by its process — the floor's
// socket, the kernel's pid, the pane that holds it — never by a token (CP-L3, CP-D1).
//
// Three projections of one verb set (CP-L2): the MCP tools a spark sees (this catalog), the flow API a run calls
// (CP-4), and the `compose.*` doors the window calls (METHODS rows; the sparks' doors are below).
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

// ── the verbs (TL-D1 A: one server, seven families, every spark gets all of them) ──

export const COMPOSE_FAMILIES = [
  "agents",
  "watch",
  "talk",
  "flows",
  "history",
  "canvas",
  "you",
] as const;
export type ComposeFamily = (typeof COMPOSE_FAMILIES)[number];

/** The slice that builds a verb (the study's §16; the version 2 page's build order). A verb is listed to a spark only
 * once its slice has landed. */
export const COMPOSE_SLICES = ["CP-1", "CP-2", "CP-3", "CP-4"] as const;
export type ComposeSlice = (typeof COMPOSE_SLICES)[number];

export interface ComposeVerbDef {
  /** the tool's name: short and plain, because Grok finds MCP tools by searching their descriptions */
  readonly name: string;
  readonly family: ComposeFamily;
  readonly slice: ComposeSlice;
  /** answers from what fieldd already knows and changes nothing (MCP's `readOnlyHint`) */
  readonly readOnly: boolean;
  /** what the model reads in the tool list; "you" is the spark, "the user" the person it works for */
  readonly description: string;
}

const verb = (
  name: string,
  family: ComposeFamily,
  slice: ComposeSlice,
  readOnly: boolean,
  description: string,
): ComposeVerbDef => ({ name, family, slice, readOnly, description });

/** Every verb, in the version 2 page's order. Each is held to the caller's profiles (TL-D5) and written to the audit
 * log before it acts (CP-L6). None waits: what takes time comes back as a wake (CP-L5). */
export const COMPOSE_VERBS: readonly ComposeVerbDef[] = [
  verb(
    "agents_available",
    "agents",
    "CP-1",
    true,
    "List the agents you can start: each agent signed in under your Agent Profiles, with its models and their efforts.",
  ),
  verb(
    "projects_list",
    "agents",
    "CP-1",
    true,
    "List the user's projects, each with its name and folders.",
  ),
  verb(
    "agent_spawn",
    "agents",
    "CP-2",
    false,
    "Start an agent under one of your profiles, in a folder, with a model, an effort and a first prompt. It asks the user before it acts, as every agent does. Returns its session id, and you are woken when it finishes, asks or fails.",
  ),
  verb(
    "agents_list",
    "watch",
    "CP-1",
    true,
    "List the agent sessions under your profiles: each one's agent, state, folder, model, cost, and who started it.",
  ),
  verb(
    "agent_read",
    "watch",
    "CP-1",
    true,
    "Read the latest turns of one session: what it was asked and what it answered. Bounded; pass `before` for older turns.",
  ),
  verb(
    "agent_watch",
    "watch",
    "CP-2",
    false,
    "Be woken when a session you did not start finishes, asks the user, fails or ends.",
  ),
  verb("agent_unwatch", "watch", "CP-2", false, "Stop being woken by a session you watch."),
  verb(
    "agent_send",
    "talk",
    "CP-2",
    false,
    "Send words to a session the user or you started. They wait for its next idle moment and land there as the user's words.",
  ),
  verb(
    "agent_interrupt",
    "talk",
    "CP-2",
    false,
    "Stop a session's current turn. The session stays, and the stop counts as the user's.",
  ),
  verb("agent_stop", "talk", "CP-2", false, "End a session you started."),
  verb(
    "flow_run",
    "flows",
    "CP-4",
    false,
    "Run a flow the user approved, with its input. You are woken when the run asks or ends.",
  ),
  verb("flow_read", "flows", "CP-4", true, "Read a run's steps, rounds and spend."),
  verb(
    "flow_stop",
    "flows",
    "CP-4",
    false,
    "Stop a run. Its journal stays, and its agents' turns stop.",
  ),
  verb(
    "flow_propose",
    "flows",
    "CP-4",
    false,
    "Propose a flow file you wrote. It goes to the user with what it does, which agents it starts and what it may spend, and it never runs before the user approves it.",
  ),
  verb(
    "history_search",
    "history",
    "CP-1",
    true,
    "Search past agent sessions under your profiles. Returns the matching turns with their session, agent, folder and time.",
  ),
  verb(
    "history_read",
    "history",
    "CP-1",
    true,
    "Read a past session's turns from History. Bounded; pass `before` for older turns.",
  ),
  verb(
    "canvas_place",
    "canvas",
    "CP-4",
    false,
    "Put a board or a note on the user's canvas, only when the user asked for it. The window places it, signed and undoable.",
  ),
  verb(
    "canvas_update",
    "canvas",
    "CP-4",
    false,
    "Change a board or a note you placed, on the user's word.",
  ),
  verb(
    "ask_user",
    "you",
    "CP-3",
    false,
    "Ask the user a question with choices. Returns at once; the answer arrives as a wake.",
  ),
  verb("notify", "you", "CP-3", false, "Tell the user something while they are in another view."),
];

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

/** Each built verb's input and output. A verb the server lists has an entry here; the rest arrive with their slices. */
export const COMPOSE_VERB_SCHEMAS = {
  agents_available: { input: ComposeAgentsAvailableInput, output: ComposeAgentsAvailableOutput },
  projects_list: { input: ComposeProjectsListInput, output: ComposeProjectsListOutput },
  agents_list: { input: ComposeAgentsListInput, output: ComposeAgentsListOutput },
  agent_read: { input: ComposeAgentReadInput, output: ComposeReadOutput },
  history_search: { input: ComposeHistorySearchInput, output: ComposeHistorySearchOutput },
  history_read: { input: ComposeHistoryReadInput, output: ComposeReadOutput },
} as const satisfies Record<string, { input: z.ZodTypeAny; output: z.ZodTypeAny }>;
