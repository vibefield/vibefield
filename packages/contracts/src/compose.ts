import { z } from "zod";
import { AgentProfileSetId, AgentProviderId } from "./agent-index";
import { AgentModelSelection, AgentSessionOrigin, CrewId, SparkId } from "./agent-session";
import { FLOW_LIMITS, SPARK_CREW_MEMBERS_MAX, SPARK_CREWS_KEPT } from "./registries";

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
  /** TU-1 (Q1) — whether the spark has worked: the time fieldd first saw one of its own sessions take a turn (a
   * resume's, or a native resume's, counts as its session's). `null`: hatched under TU-1 and never worked; NS-D4's
   * hello is for this spark alone. Absent: a spark from before TU-1, unknown, so once started it is never said to be
   * new. */
  turnedAt: z.string().min(1).nullable().optional(),
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

export const SPARK_KEPT_FORMAT = 1;
/** The kept record's file in the spark's own folder under LAYOUT.SPARK_FILES_DIR, beside what later slices keep there
 * (TH-1's run files). */
export const SPARK_KEPT_FILE = "kept.json";

/** SP-1e2 (SPE-Q6′ (b), SPE-Q14 (a), SPE-Q5 (a)) — one agent a spark started, as its crew keeps it after the agent
 * has left the board. Ids, times, the catalog's agent id, a folder's name and model labels: never a task's words and
 * never a path. */
export const SparkCrewMember = z
  .object({
    /** the member's run: the one fieldd started for its `agent_spawn`, or, once it was resumed, the run that continues
     * it (SPE-Q30 (a): one agent, one member) */
    runtimeRunId: z.string().min(1),
    /** when fieldd served its `agent_spawn` (ISO): its place in the crew, by start */
    at: z.string().min(1),
    /** the agent catalog's opaque id (R23): the window reads its mark and label from AGENT_CATALOG */
    agent: AgentProviderId,
    /** the folder's basename, as the board's `project.name`; never a path */
    folder: z.string().min(1).max(255).optional(),
    /** its model's label and its effort, as its board row first named them (`model.displayName`, else `model.id`;
     * `effort.value`); absent until the row names them */
    model: z.string().min(1).max(128).optional(),
    effort: z.string().min(1).max(32).optional(),
    /** when its run ended (ISO): an Ended row. Absent while it runs */
    endedAt: z.string().min(1).optional(),
    /** fieldd's name for the run at its end (CO-Q4 (b)), what an Ended row says. fieldd cuts a run's name at
     * NEEDS_NAME_MAX; the record reads a longer one, so a newer fieldd's name never sets the record aside */
    name: z.string().min(1).max(256).optional(),
    /** the run this member's run resumed (SPE-Q30 (a)): the member follows a resume, and `runtimeRunId` is the newer
     * run's */
    continues: z.string().min(1).optional(),
  })
  .passthrough();
export type SparkCrewMember = z.infer<typeof SparkCrewMember>;

/** SP-1e2 (SPE-Q3 = RU-6, SPE-Q6′ (b); VF-PM 2026-11-04 04:31Z) — a crew: the agents a spark started in one stretch of
 * its own run's work, one card in its thread. `sparkRun` is the spark's own run the crew was made in, so the card
 * stands in that run's conversation (TH-Q14 (b)). It is named for whose run it is: a member's `runtimeRunId` is the
 * member's own run, and `AgentSessionOrigin.run` is a flow run's id. `at` is its first member's start. A member stays
 * after it ends (SPE-Q14 (a)), in the order they started. */
export const SparkCrew = z
  .object({
    id: CrewId,
    sparkRun: z.string().min(1),
    at: z.string().min(1),
    members: z.array(SparkCrewMember).max(SPARK_CREW_MEMBERS_MAX),
  })
  .passthrough();
export type SparkCrew = z.infer<typeof SparkCrew>;

/** SP-1e2 (SR-Q2, VF-PM 2026-11-05 11:03Z) — the model and effort a crew's members share, as their rows first named
 * them: the ONE rule fieldd's act line ("Started 4 agents · Opus 5.5 · high") and Chat's crew card head ("4 agents ·
 * Opus 5.5 · high") both say, so the two never disagree. Null when there is no member, when a member's model is not
 * named yet, or when they differ in model or in effort (one naming an effort and another none is a difference). Every
 * member on one model with no effort named shares the model alone (J2, at its lean until James's pick). */
export function crewSharedModelOf(
  members: readonly { readonly model?: string | undefined; readonly effort?: string | undefined }[],
): { readonly model: string; readonly effort?: string } | null {
  const first = members[0];
  if (first?.model === undefined) return null;
  for (const member of members)
    if (member.model !== first.model || member.effort !== first.effort) return null;
  return first.effort === undefined
    ? { model: first.model }
    : { model: first.model, effort: first.effort };
}

/** Item 159 (TH0-Q11 (b)) — what fieldd keeps for one spark beyond its record, for the slices that keep something per
 * spark across a restart: one file, SPARK_KEPT_FILE, in the spark's folder, signed with SPARK_FILES_KEY_FILE's secret by
 * fieldd's one record signer. The schema is the unsigned body; the file adds its `signature`, and `spark` is inside it
 * and names its folder, so a record copied into another spark's folder is refused there. OPEN: each slice adds its own
 * optional section in its own contracts commit and bounds it there (watches and held wakes, 1′; crews, SP-1e2), and a
 * section this build does not know is kept whole. It holds no transcript bytes, no credential and no vendor's words. */
export const SparkKeptRecord = z
  .object({
    format: z.literal(SPARK_KEPT_FORMAT),
    spark: SparkId,
    /** when it was last written (ISO) */
    updatedAt: z.string().min(1),
    /** SP-1e2 — the spark's crews, oldest first, the newest SPARK_CREWS_KEPT kept (SPE-Q28 (b)), written by fieldd
     * alone and served on `compose.sparks.crews.subscribe`. Absent: no crew yet, or a record from before SP-1e2. */
    crews: z.array(SparkCrew).max(SPARK_CREWS_KEPT).optional(),
  })
  .passthrough();
export type SparkKeptRecord = z.infer<typeof SparkKeptRecord>;

/** IOS-12a (PC-L2) — a desktop, as the spark doors name it: the device id the field and the roster use. */
export const ComposeDevice = z.string().min(1).max(128);
export type ComposeDevice = z.infer<typeof ComposeDevice>;

/** One spark, as the window's doors answer it: the record and whether its session is running now. */
export const SparkSummary = z
  .object({
    ...sparkFields,
    /** IOS-12a (PC-L2) — the desktop the spark lives on, the one that hatched it: what a door carries as `device` to
     * reach it from another screen. Every row of the home's merged list names it; absent on a row from a daemon
     * before IOS-12a, which a reader takes as the desktop it asked. */
    device: ComposeDevice.optional(),
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

// ── compose.sparks.* — the person's doors (METHODS rows). *Corrected 2026-11-04 (IOS-12a; PC-D7 A, the design page
// Chat in a Pocket): this said they were the window's, `agents.manage` and local. They are `sparks.use`, held by the
// window's token and the phone's preset, and every read and act rides the phone's home (PC-L2): the list and
// needs.list merge each self desktop's rows at the home, and open, say and needs.answer carry the spark's `device`,
// which the home forwards to (design-04 §6's `device?`; DS-2). Hatch stays local: a spark is made on the desktop the
// call reaches, which for the phone is its home (PC-D8 A).* ──

/** IOS-12a (PC-L2, PC-L4) — how each self desktop answered the home's merge: OPEN words, so a newer home's word still
 * reads. `answered`; `asleep` (the roster says it is not up, so it was not asked); `timeout` (asked, no answer in
 * time); `incompatible` (its fieldd speaks another major version); `unreachable` (asked, and the link failed).
 * A reader shows a desktop that did not answer as such, never as one with no sparks. */
export const COMPOSE_DESKTOP_STATES = [
  "answered",
  "asleep",
  "timeout",
  "incompatible",
  "unreachable",
] as const;
export type ComposeDesktopState = (typeof COMPOSE_DESKTOP_STATES)[number];
export const ComposeDesktop = z
  .object({ device: ComposeDevice, state: z.string().min(1).max(32) })
  .passthrough();
export type ComposeDesktop = z.infer<typeof ComposeDesktop>;

/** A desktop's state as this build names it, else undefined: a word a newer home may say. */
export function composeDesktopStateOf(desktop: {
  readonly state: string;
}): ComposeDesktopState | undefined {
  return COMPOSE_DESKTOP_STATES.find((known) => known === desktop.state);
}

/** IOS-12a (PC-L2) — which desktops a list answers for: `local` (the default), the desktop the call reaches, as the
 * Mac's Chat has always listed; `mesh`, the home's merge of every self desktop, which the phone asks. A peer daemon
 * asking `mesh` is answered `local` (DS-L4: a daemon never aggregates another's aggregate). */
export const ComposeListScope = z.enum(["local", "mesh"]);
export type ComposeListScope = z.infer<typeof ComposeListScope>;

export const ComposeSparksListParams = z
  .object({ scope: ComposeListScope.optional(), device: ComposeDevice.optional() })
  .passthrough();
export type ComposeSparksListParams = z.infer<typeof ComposeSparksListParams>;

/** The list: the sparks of the desktop it reaches, or (`mesh`) of every self desktop at the home, each naming its
 * `device`, and `desktops` saying how each desktop answered the merge. */
export const ComposeSparksListResult = z
  .object({
    sparks: z.array(SparkSummary),
    desktops: z.array(ComposeDesktop).max(64).optional(),
  })
  .passthrough();
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

/** Wake a spark: its last session is resumed when it sleeps (CR-D11), and a live one is answered as it is. From
 * another screen it carries the spark's `device`, and the home forwards the call there (IOS-12a, PC-L2). */
export const ComposeSparksOpenParams = z
  .object({ spark: SparkId, device: ComposeDevice.optional() })
  .passthrough();
export type ComposeSparksOpenParams = z.infer<typeof ComposeSparksOpenParams>;

export const ComposeSparksOpenResult = z.object({ spark: SparkSummary }).passthrough();
export type ComposeSparksOpenResult = z.infer<typeof ComposeSparksOpenResult>;

/** SP-1e2 (SPE-Q27 (a), SPE-Q40; VF-PM's X2-crews 2026-11-05 01:22Z) — compose.sparks.crews.subscribe: one spark's
 * crews, a snapshot then the whole list at each change, never edges, as needs.subscribe is. From another screen it
 * carries the spark's `device`, and the home forwards it there (IOS-12a, PC-L2). */
export const ComposeSparksCrewsSubscribeParams = z
  .object({ spark: SparkId, device: ComposeDevice.optional() })
  .passthrough();
export type ComposeSparksCrewsSubscribeParams = z.infer<typeof ComposeSparksCrewsSubscribeParams>;

/** SPE-Q32 (a) — how many tasks still wait in a live member's input queue: its row says Done only at none, so an
 * agent idle between two tasks it was given stays Working and the card's count never goes backwards. */
export const SparkCrewWaiting = z
  .object({ runtimeRunId: z.string().min(1), tasks: z.number().int().min(0) })
  .passthrough();
export type SparkCrewWaiting = z.infer<typeof SparkCrewWaiting>;

/** compose.sparks.crews.subscribe's snapshot and every frame: the spark's kept crews, whole, oldest first, and
 * `waiting` for its members still on the board (live state, never kept). A member a frame lacks may still be on the
 * board under its crew's id (`origin.crew`): the card takes the record's members first, then those rows. */
export const ComposeSparksCrewsFrame = z
  .object({
    spark: SparkId,
    crews: z.array(SparkCrew).max(SPARK_CREWS_KEPT),
    waiting: z.array(SparkCrewWaiting).max(SPARK_CREW_MEMBERS_MAX).optional(),
  })
  .passthrough();
export type ComposeSparksCrewsFrame = z.infer<typeof ComposeSparksCrewsFrame>;

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

/** CP-4a2b (Q9 (a)) — VibeField's own lines to a flow's step (DESIGN.md §9 "A flow's lines"), OPEN: the repair turn,
 * a step resumed after a Quit, and an answer VibeField did not hear. */
export const FIELDD_FLOW_LINES = ["repair", "resume", "unheard"] as const;
export type FielddFlowLine = (typeof FIELDD_FLOW_LINES)[number];

/** Which of those lines a `fieldd` input is, to which run's call, and `n`, its sends for that reason (Ask once more is
 * the 2nd). The run and call are in AgentSessionOrigin's bounds; flows.ts holds the strict forms, and its tests hold
 * these to them (C10, as F16 holds NeedsRun). Defined here, not imported, because flows.ts reads this module. */
export const AgentInputFlowLine = z
  .object({
    run: z.string().min(1).max(64),
    call: z.number().int().positive(),
    /** FIELDD_FLOW_LINES, OPEN */
    line: z.string().min(1).max(32),
    n: z.number().int().positive(),
  })
  .passthrough();
export type AgentInputFlowLine = z.infer<typeof AgentInputFlowLine>;

/** Who a kept input is from: a spark, by id and by the name its words are marked with; or fieldd's own wake. CLOSED:
 * an input lands marked by its source (CP2-D1), so one from a source this build cannot mark is never delivered.
 * IOS-12a (PC-D3 A) — or `you`: the person's own words to a spark (`compose.sparks.say`), which land UNMARKED, since
 * they are yours. A queue file an older build reads with a `you` input in it does not parse, so that build sets the
 * file aside and delivers none of it, as it does any file it cannot read (the downgrade edge, said in IOS-12a's
 * record).
 * CP-4a2b (Q-B1 (a), Q-B2 (a); DESIGN.md §9 "When a run can't go on, or waits") — or `flow`: a run's own words, its
 * steps' prompts and its `in:` lines, marked "‹flow› (a flow you ran) on your behalf:", or "(a flow ‹ran› ran)" for a
 * spark's run. `name` is the mark's ‹flow›; `flow`, `run` and `call` are the run's, in the loose forms above. The same
 * downgrade edge: an older build sets aside the whole file a `flow` input is in. VibeField's own three lines to a step
 * stay `fieldd`, with `flow` naming which (an older build reads them as plain VibeField lines). */
export const AgentInputSender = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("spark"), spark: SparkId, name: SparkName }).passthrough(),
  z.object({ kind: z.literal("fieldd"), flow: AgentInputFlowLine.optional() }).passthrough(),
  z.object({ kind: z.literal("you") }).passthrough(),
  z
    .object({
      kind: z.literal("flow"),
      flow: z.string().min(1).max(64),
      // NEEDS_NAME_MAX is declared below with the needs bounds, so it is read when an input is parsed
      name: z.lazy(() => z.string().min(1).max(NEEDS_NAME_MAX)),
      run: z.string().min(1).max(64),
      call: z.number().int().positive(),
      /** the spark that started the run, by the name its mark says (Q-B2 (a)); none for yours */
      ran: SparkName.optional(),
    })
    .passthrough(),
]);
export type AgentInputSender = z.infer<typeof AgentInputSender>;

/** The reason of VibeField's line to a flow's step, as this build names it; undefined for any other input. */
export function flowLineOf(sender: AgentInputSender): FielddFlowLine | undefined {
  return sender.kind === "fieldd" ? knownWord(FIELDD_FLOW_LINES, sender.flow?.line) : undefined;
}

/** The needs-you items one joined wake may carry (item 158, CO-Q9 (b)): twice NEEDS_OPEN_PER_SPARK, for a spark's
 * open items and the facts of their answers. A wake at the bound starts a new input. Stated here, before its use,
 * since the needs bounds are declared below. */
export const NEEDS_JOINED_ITEMS_MAX = 16;

/** One input that waits for a session's next idle moment. Its text has no bound here: fieldd's wakes that wait join
 * into one line (CP-D4), and a spark's own words were bounded at its call (COMPOSE_TEXT_MAX). */
export const AgentQueuedInput = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().min(1),
    from: AgentInputSender,
    /** when it was queued (ISO) */
    at: z.string().min(1),
    /** IOS-12a (PC-D3 A) — the say's request id (`you` only): the queue keeps one input per (run, request id), so a
     * retried say over a dropped leg is queued once, and a second ask reads the first one's receipt */
    requestId: z.string().min(1).max(64).optional(),
    /** when its delivery began (ISO), the head only (item 158, TH-Q32 (a)): kept before it is pasted, so a restart
     * that finds it never sends it again, and its sender is told it is uncertain */
    sending: z.string().min(1).optional(),
    /** the needs-you items whose facts its line carries, a wake's only (CO-Q9 (b)): each is heard once its session
     * confirms it took the line, and owed again when the line is dropped */
    items: z.array(NeedsItemId).min(1).max(NEEDS_JOINED_ITEMS_MAX).optional(),
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

// ── compose.sparks.say — your words to a spark (IOS-12a; PC-D3 A, the design page Chat in a Pocket). They join the
// spark's session's input queue as yours and unmarked (the `you` sender), never pasted, and land at its next idle
// moment as a spark's sends do (CP2-D2). A spark asleep is woken first. The answer is the send's receipt, and asking
// again with the same `requestId` reads that receipt instead of queueing the words twice. ──

/** A say's request id: the caller's, unique per send, kept with the input. */
export const ComposeSayRequestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export type ComposeSayRequestId = z.infer<typeof ComposeSayRequestId>;

/** TH-1 (TH-Q25 (a)) — a chip in your words: where its words stand in `text` (UTF-16 units, as the window counts),
 * and what it stands for, OPEN (agent | session | card). The record keeps it, so your bubble draws a chip from these
 * spans and never from words that look like one. */
export const ComposeSayChip = z
  .object({
    start: z.number().int().min(0),
    length: z.number().int().min(1),
    kind: z.string().min(1).max(32),
  })
  .passthrough();
export type ComposeSayChip = z.infer<typeof ComposeSayChip>;

/** The chips a message carries at most: more than a draft holds. */
export const COMPOSE_SAY_CHIPS_MAX = 64;

/** Every chip stands inside `text`, in order, none overlapping another. */
export function composeChipsFit(
  text: string,
  chips: readonly { readonly start: number; readonly length: number }[],
): boolean {
  let end = 0;
  for (const chip of chips) {
    if (chip.start < end || chip.start + chip.length > text.length) return false;
    end = chip.start + chip.length;
  }
  return true;
}

export const ComposeSparksSayParams = z
  .object({
    spark: SparkId,
    text: z.string().min(1).max(COMPOSE_TEXT_MAX),
    requestId: ComposeSayRequestId,
    /** the spark's desktop, from another screen: the home forwards there (PC-L2) */
    device: ComposeDevice.optional(),
    /** TH-1 — the chips in `text`, in order. A desktop before TH-1 passes them through and keeps none, so its bubble
     * draws the chips' words as words. */
    chips: z.array(ComposeSayChip).max(COMPOSE_SAY_CHIPS_MAX).optional(),
  })
  .passthrough()
  .superRefine((say, ctx) => {
    if (say.chips !== undefined && !composeChipsFit(say.text, say.chips))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chips"],
        message: "each chip stands inside the text, in order, none overlapping",
      });
  });
export type ComposeSparksSayParams = z.infer<typeof ComposeSparksSayParams>;

/** A send's receipt, OPEN words (DESIGN.md §9 "Chat on the phone"): `queued` (in the queue, waiting for the spark's
 * next idle moment), `waking` (queued behind a wake: the spark was asleep), `waiting` (a delivery was turned away, a
 * dialog open or the person typing in its pane, and it waits for the next idle moment), `delivered` (puppeteer
 * confirmed it), `uncertain` (the delivery's answer was lost: never resent, and the person is told to look in its
 * pane), `dropped` (its session ended before it landed). Whether the spark waits on the person ("it lands after you
 * answer") is the needs-you queue's to say, not the receipt's. */
export const COMPOSE_SAY_STATES = [
  "queued",
  "waking",
  "waiting",
  "delivered",
  "uncertain",
  "dropped",
] as const;
export type ComposeSayState = (typeof COMPOSE_SAY_STATES)[number];

/** A receipt's state as this build names it, else undefined. */
export function composeSayStateOf(receipt: {
  readonly state: string;
}): ComposeSayState | undefined {
  return COMPOSE_SAY_STATES.find((known) => known === receipt.state);
}

export const ComposeSparksSayResult = z
  .object({
    spark: SparkId,
    requestId: ComposeSayRequestId,
    /** COMPOSE_SAY_STATES, OPEN */
    state: z.string().min(1).max(32),
    /** the words are fieldd's to deliver: always true, since a person's words are never held (CP-D3 holds a spark's) */
    queued: z.literal(true),
    /** its place in the session's queue, 1 being next, while it waits */
    position: z.number().int().min(1).optional(),
  })
  .passthrough();
export type ComposeSparksSayResult = z.infer<typeof ComposeSparksSayResult>;

// ── CP-3: the person (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31 06:31:34Z: CP3-D1…D8 at A). The
// needs-you queue (CP-D12) is fieldd's one list of what waits on the person: a spark's question (`ask_user`), its first
// send into a session the person started (CP-D3, CP3-D3 B), a spawn past its cap (CP-D7, CP3-D4 A), and an agent's own
// ask, which is listed with where to answer it and never answered here (CP3-D1 A, CP-L4). Answered once, an item is
// answered for every window, and the spark hears the answer as a wake (CP3-D2 A). The words of every act are DESIGN.md
// §9's ("The person's queue's words"); a window answers by an act's place, never its word. ──

/** ask_user's question; the card shows six lines of it, then scrolls (DESIGN.md §8 "Chat's thread") */
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
/** the notices one session may tell the person in a minute (PF4's watermark): one more is the fact `limit` */
export const NOTIFY_PER_MINUTE = 6;
/** the sends that wait on one held item */
export const NEEDS_HELD_SENDS_MAX = 16;
/** what one spark may have waiting on the person at once, its questions, held sends and spawns together (PF4's
 * watermark): a ninth is refused as the fact `limit` */
export const NEEDS_OPEN_PER_SPARK = 8;

/** The acts' words (DESIGN.md §9 "The person's queue's words"): one authority for fieldd, the window and tests. A
 * question's own choices come first and Not now is always last; a held item's yes is always first. CP-4a2b (13b.3's
 * C7; DESIGN.md §9 "When a run can't go on, or waits"): and a flow's seven, its items' acts. Stop the run is a run's
 * every item's last; the cap's Allow lets FLOW_LIMITS.CALLS_MORE more calls through, and says so. */
export const NEEDS_CHOICE_WORDS = {
  allow: "Allow",
  allowOneMore: "Allow one more",
  notNow: "Not now",
  stopRun: "Stop the run",
  allowMore: `Allow ${FLOW_LIMITS.CALLS_MORE} more`,
  askOnceMore: "Ask once more",
  resumeStep: "Resume the step",
  seeChange: "See the change",
  runThisVersion: "Run this version",
  runApproved: "Run the one you approved",
} as const;

/** The kinds and states, OPEN on the wire like COMPOSE_SESSION_STATES: a word this build never heard of must not refuse
 * an item. `ended`: what it waited on ended before an answer (a held send's session), or an allowance's run ended.
 * CP-4 (step0-cp4.md §5.1; CP-D12, one queue) adds a flow run's six, each naming its run (`run`): a spark's proposal
 * (`flow-proposal`, CP4-Q3 (a)), a script's `ask` (`flow-gate`, CP4-Q6 (a)), a flow changed since its approval or never
 * approved (`flow-changed`, CP4-Q5 (a)), a step's second answer out of its form (`flow-repair`, CP4-Q7 (a)), the call
 * cap (`flow-cap`, CP4-Q8 (a)) and a step lost to a Quit (`flow-lost`, CP4-Q11 (a)). Their acts' words are DESIGN.md
 * §9's when the window draws them (CP-4b). */
export const NEEDS_ITEM_KINDS = [
  "question",
  "held-send",
  "held-spawn",
  "agent-ask",
  "flow-proposal",
  "flow-gate",
  "flow-changed",
  "flow-repair",
  "flow-cap",
  "flow-lost",
] as const;
export type NeedsItemKind = (typeof NEEDS_ITEM_KINDS)[number];
export const NEEDS_ITEM_STATES = ["open", "answered", "ended"] as const;
export type NeedsItemState = (typeof NEEDS_ITEM_STATES)[number];
/** What became of an answer's act, OPEN: done, or failed with fieldd's `reason`. Whether the spark has heard it is
 * apart (`told`), so an act done for a spark that sleeps is still done. */
export const NEEDS_ANSWER_OUTCOMES = ["done", "failed"] as const;
export type NeedsAnswerOutcome = (typeof NEEDS_ANSWER_OUTCOMES)[number];

/** An open word as this build names it, else undefined: a word a newer build's record may carry. */
function knownWord<W extends string>(words: readonly W[], word: string | undefined): W | undefined {
  return words.find((known) => known === word);
}

/** An item's kind, state and its answer's outcome as this build names them (undefined: a word it never heard of).
 * fieldd and the window compare these words only through them, so a misspelt word is a type error, never a branch no
 * item takes. */
export function needsKindOf(item: { readonly kind: string }): NeedsItemKind | undefined {
  return knownWord(NEEDS_ITEM_KINDS, item.kind);
}
export function needsStateOf(item: { readonly state: string }): NeedsItemState | undefined {
  return knownWord(NEEDS_ITEM_STATES, item.state);
}
export function needsOutcomeOf(
  answer: { readonly outcome: string } | undefined,
): NeedsAnswerOutcome | undefined {
  return knownWord(NEEDS_ANSWER_OUTCOMES, answer?.outcome);
}

/** An act's place among an item's choices. */
const NeedsChoiceIndex = z.number().int().min(0).max(NEEDS_CHOICES_MAX);

/** Who asks or tells: named as fieldd names it (a spark by its name, a session by its title, else its agent's label in
 * its folder, else that label, else its id; CO-1b), its session, and the spark when the teller IS that spark. */
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
    /** the spark has been told: the answer's fact is in its input queue (a line its session dropped flips it back to
     * false, with `waits`: item 158, CO-Q9 (b)) */
    told: z.boolean(),
    /** why it has not been told yet (told false): it hears the answer when it next wakes */
    waits: z.string().min(1).max(NEEDS_REASON_MAX).optional(),
  })
  .passthrough();
export type NeedsAnswer = z.infer<typeof NeedsAnswer>;

/** CP-4 — the run a flow's item holds, in AgentSessionOrigin's bounds (a run's id, its call counted from 1); flows.ts
 * holds the strict forms (FlowRunId, FlowSlug), and its tests hold these to them. Defined here, not imported, because
 * flows.ts reads this module. */
export const NeedsRun = z
  .object({
    run: z.string().min(1).max(64),
    /** the flow's slug: its file's name in the person's library */
    flow: z.string().min(1).max(64),
    call: z.number().int().positive().optional(),
    label: z.string().min(1).max(NEEDS_NAME_MAX).optional(),
  })
  .passthrough();
export type NeedsRun = z.infer<typeof NeedsRun>;

/** CP-4 — a flow's bytes as an item names them: its slug and the SHA-256 of a version fieldd keeps (flows.ts's
 * FlowHash), hex. */
export const NeedsScript = z
  .object({
    flow: z.string().min(1).max(64),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    approved: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .passthrough();
export type NeedsScript = z.infer<typeof NeedsScript>;

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
    /** IOS-12a (PC-L2) — the desktop whose queue holds it, where an answer goes: every item of the home's merged list
     * names it; absent on an item from a daemon before IOS-12a, which a reader takes as the desktop it asked */
    device: ComposeDevice.optional(),
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
    /** CP-4 — a flow's item: its run (absent while none has started: a proposal, a flow that changed before its run),
     * and the step it holds at (`call`, counted from 1 in the run's journal, with the script's `label`) */
    run: NeedsRun.optional(),
    /** CP-4 — the bytes a proposal or a changed flow is about, for Read the script and See the change
     * (`flows.script` by hash): `hash` is the version the item would approve or run, `approved` the one approved */
    script: NeedsScript.optional(),
    answer: NeedsAnswer.optional(),
  })
  .passthrough();
export type NeedsItem = z.infer<typeof NeedsItem>;

/** needs.list's answer and every needs.subscribe frame: the open items, oldest first, whole. IOS-12a (PC-L2): every
 * item names its `device`; the home's `mesh` list merges every self desktop's items, and `desktops` says how each
 * answered (as the sparks' list does); a needs.subscribe frame is ONE desktop's queue, the one its `device` named. A
 * peer daemon asking is answered its own items alone (DS-L4). */
export const NeedsListResult = z
  .object({ items: z.array(NeedsItem), desktops: z.array(ComposeDesktop).max(64).optional() })
  .passthrough();
export type NeedsListResult = z.infer<typeof NeedsListResult>;

/** needs.list: this desktop's queue, or (`mesh`) the home's merge of every self desktop's (IOS-12a, PC-L2). */
export const NeedsListParams = z
  .object({ scope: ComposeListScope.optional(), device: ComposeDevice.optional() })
  .passthrough();
export type NeedsListParams = z.infer<typeof NeedsListParams>;

/** needs.subscribe: one desktop's queue, through the home when `device` names another (IOS-12a, PC-L2). */
export const NeedsSubscribeParams = z.object({ device: ComposeDevice.optional() }).passthrough();
export type NeedsSubscribeParams = z.infer<typeof NeedsSubscribeParams>;

/** needs.answer: the act by its place among the item's choices (DESIGN.md §9), so rewording an act is no wire change.
 * From another screen it carries the item's `device`, and the home forwards it there (IOS-12a, PC-L2). */
export const NeedsAnswerParams = z
  .object({ item: NeedsItemId, choice: NeedsChoiceIndex, device: ComposeDevice.optional() })
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

/** ask_user (sparks only, MT-D11): a question with 1 to NEEDS_CHOICES_MAX distinct choices of the spark's own. It
 * returns at once and the answer is a wake (CP3-D2 A); Not now is VibeField's, so no choice may be it. */
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
    /** SP-1e2 — the crew its spawn was asked in: Allow one more joins it, even after that crew has closed. Absent on a
     * record from before SP-1e2, whose start joins no crew. */
    crew: CrewId.optional(),
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
    /** the fact owed to its spark, until the spark's session confirms it (item 158, CO-Q9 (b)) */
    owed: z.string().min(1).max(NEEDS_WORDS_MAX).optional(),
    /** the owed fact is in this run's input queue since `at` (ISO): heard once that run confirms it took the line,
     * owed again when the line is dropped, and never told again when its delivery is uncertain (item 158) */
    telling: z
      .object({ run: z.string().min(1), at: z.string().min(1) })
      .passthrough()
      .optional(),
    /** the act an answer began and did not record done: after a restart the spark is told it is uncertain, and it is
     * never done again (CP2-D2) */
    acting: z
      .object({ choice: NeedsChoiceIndex, at: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type NeedsRecord = z.infer<typeof NeedsRecord>;
