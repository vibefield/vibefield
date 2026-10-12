import { z } from "zod";
import { AgentOffers } from "./agent-catalog";
import { AgentPersona, AgentProfileId, AgentProfileSetId, AgentProviderId } from "./agent-index";
import { TerminalCreateOpenResult } from "./terminal-pipeline";

// AR-3 — the managed-session doors (`agent.*`) and the fold's one row shape,
// SessionSummary v2 (thinking-ar-agent-plane.md §5/§7, AR-D4/AR-D5 as ruled
// 2026-09-12). A managed session is one puppeteer runs INSIDE fieldd in a PTY
// field-native hosts for it; the fold joins puppeteer's monitor projection
// with the floor's terminal inventory and projects ONE row per run for every
// view. Tiers are the ruling's three: managed (born in our panes, management
// guaranteed) · ingested (rosetta reads it; AR-8 puts those rows here) ·
// remote (a peer's rows through the mesh).
//
// The vendor wall (AR-L1) holds at this file: `kind` is puppeteer's OPEN
// provider id and `label` the catalog's label for it (AC-D4; a daemon from before
// AC-3 stamps the adapter's) — nothing here enumerates a
// vendor, and nothing here carries a file path, an argv, or a hook. The
// `monitor` field is a MIRROR of puppeteer's `AgentMonitorState` (its
// schema generation is pinned below) restricted to the fields fieldd's own
// logic reads, `.passthrough()` so the full object rides to the renderer
// verbatim (the tolerant reader), and pinned by a golden fixture transcribed
// from puppeteer's own monitor contract test — a wire change upstream is a
// red gate here, never a runtime surprise (AR-D4, §12).
//
// TS-only in the generation pipeline: field-native never reads an agent row.

/** puppeteer's `AGENT_MONITOR_SCHEMA_VERSION` at the pinned revision
 * (`packages/core/src/monitor/types.ts`). A bump upstream is a deliberate
 * event here: the mirror is re-read against the new shape, the golden
 * regenerated, this constant moved — never a silent drift. Moved 2 → 3 at
 * AR-5 (puppeteer `e32b56b`, 2026-09-13: artifacts, teams and workflows left
 * the state, `subagents[]` shrank to identity, work, usage, and
 * `subagentCount` arrived; the mirror reads none of those, so the fields
 * fieldd names are unchanged and the golden is puppeteer's own fixture
 * transcribed at that revision). */
export const AGENT_MONITOR_SCHEMA_VERSION = 3;

/** The three tiers as ruled (2026-09-12; design-04 §8.4 amended). */
export const AgentTier = z.enum(["managed", "ingested", "remote"]);
export type AgentTier = z.infer<typeof AgentTier>;

/** The one derived status (AR-D4): puppeteer's three-valued headline for a
 * managed row, `unknown` before the first monitor state or when the mirror
 * could not be read. Derived ONCE, in fieldd; never re-derived by a view. */
export const AgentStatus = z.enum(["idle", "working", "blocked", "unknown"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

/** The mirror of puppeteer's `AgentMonitorState`: the fields fieldd reads,
 * every other field carried through. `status` is an OPEN string here (the
 * upstream enum is idle|working|blocked; a fourth value must not fail the
 * parse — it folds to `unknown` at the seam). */
export const AgentMonitorMirror = z
  .object({
    schemaVersion: z.number().int(),
    runtimeEpoch: z.number().int(),
    revision: z.number().int(),
    runtimeRunId: z.string().min(1),
    status: z.string(),
    statusSince: z.string(),
    blockers: z.array(
      z.object({ id: z.string(), kind: z.string(), since: z.string() }).passthrough(),
    ),
    lastAssistantMessage: z.object({}).passthrough().optional(),
    /** TL — what it is doing now. Runtime only (MV-6): nothing records a span's `line`. */
    activity: z
      .object({ kind: z.string(), line: z.string(), since: z.string() })
      .passthrough()
      .optional(),
    usage: z
      .object({
        cumulativeTokens: z.number().optional(),
        burnRatePerMin: z.number().optional(),
      })
      .passthrough()
      .optional(),
    context: z
      .object({
        usedTokens: z.number(),
        capacityTokens: z.number(),
        usedPercent: z.number(),
      })
      .passthrough()
      .optional(),
    model: z
      .object({ id: z.string(), displayName: z.string().optional() })
      .passthrough()
      .optional(),
    environment: z
      .object({
        cwd: z.string().optional(),
        git: z
          .object({ branch: z.string().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
        worktrees: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    session: z
      .object({ nativeSessionId: z.string().optional(), startedAt: z.string().optional() })
      .passthrough()
      .optional(),
    freshness: z
      .object({ lastEvidenceAt: z.string().optional(), level: z.string() })
      .passthrough()
      .optional(),
    alive: z.boolean(),
  })
  .passthrough();
export type AgentMonitorMirror = z.infer<typeof AgentMonitorMirror>;

/** Where the session's terminal is: `local` = a PTY on this device's floor
 * (`runtimeSessionId` is the floor's session id — the pane join, the id a
 * `terminal.openTicket` takes); `remote` = a peer's; `none` = no terminal is
 * known (an ingested row, or a managed run whose PTY is gone). */
export const AgentSessionTerminal = z
  .object({
    hosted: z.enum(["local", "remote", "none"]),
    runtimeSessionId: z.string().optional(),
    /** TC-S3 — the cell hosting it, when the inventory has tagged it */
    cellBootId: z.string().optional(),
    workloadClass: z.string().optional(),
    /** AR-4 — the floor session this run REPLACED at a resume-when-idle: the
     * old PTY the deck may still be showing, which the new one should take
     * the place of. */
    replaced: z.string().optional(),
  })
  .passthrough();
export type AgentSessionTerminal = z.infer<typeof AgentSessionTerminal>;

/** puppeteer's workspace facts for the run (its `AgentWorkspaceInfo`, the
 * fields a view names). `mode` is puppeteer's open vocabulary. */
export const AgentSessionWorkspace = z
  .object({
    mode: z.string(),
    root: z.string().optional(),
    sourcePath: z.string().optional(),
    branch: z.string().optional(),
  })
  .passthrough();
export type AgentSessionWorkspace = z.infer<typeof AgentSessionWorkspace>;

/** AR-7 — where a run came from: design-04 §8.1's provenance word, on the row
 * (`spawnedBy`) and on its record. The vocabulary this build knows: `app` — a
 * run one of our doors started (the spawn button, a resume); `user-shell` —
 * a run adopted in a terminal the person's own shell owns (puppeteer's
 * spawn-through: the agent's name typed at one of our panes' prompts), so its
 * pane is a shell that outlives the agent. OPEN on the wire: a word this build
 * never heard of must not refuse a row. Absent reads `app` — every row and
 * record a daemon from before AR-7 sends. */
export const AGENT_SPAWNED_BY = ["app", "user-shell"] as const;
export type AgentSpawnedBy = (typeof AGENT_SPAWNED_BY)[number];

/** SessionSummary v2 — the fold's row (design-01 §6.2 as amended by AR-D4).
 * `sessionId` is the provider-native session id, THE spine every repo joins
 * on (puppeteer `nativeSession.id`, rosetta `native_session_id`); before an
 * adapter has observed it the id is puppeteer's configured claim, and
 * `sessionIdBasis` says which. `runtimeRunId` is the managed row's identity
 * across epochs (a resumed run is a new run). */
export const AgentSessionSummary = z
  .object({
    sessionId: z.string().min(1),
    sessionIdBasis: z.string().optional(),
    /** puppeteer provider id — OPEN (AR-L1: no vendor is enumerated here) */
    kind: AgentProviderId,
    /** the catalog's label for the provider (AC-D4: ours, on every row since
     * AC-3; a daemon from before it stamps the adapter's own) */
    label: z.string().min(1),
    /** the device this row lives on (its fieldd's device id) */
    device: z.string().min(1),
    tier: AgentTier,
    runtimeRunId: z.string().min(1),
    runtimeEpoch: z.number().int(),
    profileId: AgentProfileId.optional(),
    /** AR-S5 — the Agent Profile the run was born under, when puppeteer knows
     * it (`AgentSessionInfo.profileSetId`: a spawn that chose one or took the
     * default's sign-in, or a run whose sign-in is registered). Absent is
     * unknown, never "This Mac": a reader falls back to the persona's set. */
    profileSet: AgentProfileSetId.optional(),
    terminal: AgentSessionTerminal.optional(),
    workspace: AgentSessionWorkspace.optional(),
    /** puppeteer's monitor projection, verbatim (the mirror above) */
    monitor: AgentMonitorMirror.optional(),
    status: AgentStatus,
    /** puppeteer's `ObservationLevel`, open */
    observationLevel: z.string(),
    createdAt: z.string(),
    stateChangedAt: z.string(),
    lastActivityAt: z.string().optional(),
    title: z.string().optional(),
    /** the persisted continuation (AR-3): whether a record exists and whether
     * `agent.resume` would take it (the provider resumes; the terminal is
     * gone — or, since AR-4, alive but unobserved: a resume then replaces it).
     * AR-4: `reattached` = this run was re-attached across a fieldd restart;
     * `pending` = the row is a live terminal fieldd could NOT re-attach to
     * (`reason` says why) and will resume at its next idle. */
    continuation: z
      .object({
        persisted: z.boolean(),
        resumable: z.boolean(),
        reattached: z.boolean().optional(),
        pending: z.enum(["resume-when-idle"]).optional(),
        reason: z.string().optional(),
        /** MF-1f — the record is STAMPED WITH AN EXIT: this run's process is
         * over. The row still exists because the floor still lists its PTY
         * (the deck is showing that dead pane, and the resume verb belongs on
         * it), so `terminal.hosted` stays `local` and only this says the
         * conversation stopped. It outranks a lagging mirror: fieldd
         * WITNESSED the exit, while `monitor.alive` is a reading that may not
         * have landed yet. */
        exited: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    /** AR-7 — where the run came from (`AGENT_SPAWNED_BY`; OPEN, absent reads
     * `app`). `user-shell`: the pane is the person's shell, which the agent's
     * exit leaves standing. */
    spawnedBy: z.string().min(1).max(32).optional(),
  })
  .passthrough();
export type AgentSessionSummary = z.infer<typeof AgentSessionSummary>;

// ── the persisted continuation (`users/<fuid>/agents/sessions/<runtimeRunId>.json`) ──

export const AGENT_SESSION_RECORD_FORMAT = 1;

/** One managed session's record: puppeteer's OPAQUE continuation (persisted,
 * never inspected — its `state` is adapter-versioned and credential-free by
 * puppeteer's contract) beside the launch facts fieldd itself chose, and the
 * exit once there is one. Written at spawn, refreshed when the native id is
 * learned, stamped at exit; read by `agent.resume` and by AR-4's re-attach. */
export const AgentSessionRecord = z
  .object({
    format: z.literal(AGENT_SESSION_RECORD_FORMAT),
    runtimeRunId: z.string().min(1),
    runtimeEpoch: z.number().int(),
    provider: AgentProviderId,
    profileId: AgentProfileId.optional(),
    /** AR-S5 — the Agent Profile it was born under, as the summary says it */
    profileSet: AgentProfileSetId.optional(),
    cwd: z.string(),
    title: z.string().optional(),
    terminalSessionId: z.string().optional(),
    continuation: z
      .object({
        providerId: AgentProviderId,
        nativeSessionId: z.string().min(1),
        implementation: z.string().optional(),
        state: z.string().optional(),
      })
      .passthrough(),
    workspace: AgentSessionWorkspace.optional(),
    /** AR-4 — the durable identity a re-attach restores against: puppeteer's
     * creation request id (the claim under `AGENT_RUNS_DIR`) and the ingress
     * the process was launched with (the bearer is a per-session secret; the
     * record is 0600 like the registry beside it). Absent on a record written
     * before AR-4 or by an adapter with no ingress. */
    creationRequestId: z.string().min(1).optional(),
    ingress: z
      .object({ port: z.number().int().positive(), token: z.string().min(1) })
      .passthrough()
      .optional(),
    /** AR-4 — what the last fieldd boot did with a live terminal: attached at
     * the next epoch, failed (the reason), unsupported by the adapter, or
     * resumed into a new run — `replacedBy` names the successor run (AR-4b;
     * `replaced`, the old PTY, was the first spelling and is kept readable). */
    reattach: z
      .object({
        state: z.enum(["attached", "failed", "unsupported", "resumed"]),
        at: z.string(),
        reason: z.string().optional(),
        replaced: z.string().optional(),
        replacedBy: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /** AR-4 — the floor session this run replaced at a resume-when-idle */
    replaced: z.string().optional(),
    /** AR-4b — the record's HMAC-SHA256 (hex) over its canonical JSON without
     * this field, keyed by `LAYOUT.AGENT_SESSIONS_KEY_FILE`. fieldd's own acts
     * trust only records that verify; a record without one, or with a wrong
     * one, is set aside (EL7: the record is a control input to a terminate). */
    signature: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    exited: z
      .object({
        at: z.string(),
        exitCode: z.number().int().nullable(),
        signal: z.string().nullable(),
        reason: z.string(),
      })
      .passthrough()
      .optional(),
    /** AR-7 — where the run came from, persisted as the row says it
     * (`AGENT_SPAWNED_BY`; OPEN, absent reads `app`: every record written
     * before AR-7). Both AR-7 fields are optional, so a record without them
     * canonicalises — and so verifies — exactly as it did before. */
    spawnedBy: z.string().min(1).max(32).optional(),
    /** AR-7 — for a run adopted in a caller's terminal (`user-shell`): the
     * adopted process and the time it started, which a later boot compares
     * before it re-attaches — a pid is reused, a start time is not. Absent on
     * a run fieldd spawned itself. */
    process: z
      .object({ pid: z.number().int().positive(), startedAt: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type AgentSessionRecord = z.infer<typeof AgentSessionRecord>;

// ── agent.* doors ──

/** agent.providers — what one can spawn AS on this device: every composed
 * provider, whether an executable resolved for it (`available`; the path
 * itself stays in `agents.installs`, the native.admin door), whether its
 * adapter can resume a continuation, and the personas registered for it. */
export const AgentProviderSummary = z
  .object({
    id: AgentProviderId,
    /** the catalog's label (AC-D4: ours, not the adapter's descriptor) */
    label: z.string().min(1),
    available: z.boolean(),
    resumable: z.boolean(),
    personas: z.array(AgentPersona),
    // AC-1/AC-3 (thinking-ar-agent-catalog.md) — the row's decision and its
    // claims, so a picker badges `preview`/`deprecated` and hides verbs the
    // row does not offer; `history` is present only where the row offers it —
    // the index's state for this agent on this device (`unavailable` = the
    // daemon is down, or its registry disagrees with the catalog on the kind).
    // The catalog's decision and its claims — fieldd ALWAYS sends both since
    // AC-3 (it answers from the catalog), and a READER keeps them optional:
    // a newer shell adopts a running older daemon in production (the
    // `leave-running` policy), and a row without them must draw as before —
    // no badge, no persona control — never blank the list (the review's
    // finding). `status` and `history` are OPEN strings (a closed enum made
    // one unknown word refuse the whole list); the known vocabularies are
    // `AgentCatalogStatus` and `AGENT_HISTORY_STATES`; a word outside them
    // reads as "not offered" / "unknown", never as an error.
    status: z.string().min(1).max(32).optional(),
    // PARTIAL and PASSTHROUGH to a reader as well: a capability this build
    // adds later is a key an older daemon's row lacks, and one a newer daemon
    // sends is a key this build never heard of — neither must refuse the list
    // (absent reads as "not claimed"; unknown rides through, the tolerant
    // reader's rule at every depth)
    offers: AgentOffers.partial().passthrough().optional(),
    history: z.string().min(1).max(32).optional(),
    /** QL (thinking-ql-empty-pane-launcher.md) — epoch ms of this device's
     * newest session record for the agent (a spawn, a resume, or a run adopted
     * in a pane's shell — AR-7), so a launcher can order its agents by use;
     * absent when there is none. A fact about THIS device's records (a
     * sign-out forgets its persona's) — never the agent's history. */
    lastLaunchedAt: z.number().finite().optional(),
  })
  .passthrough();
export type AgentProviderSummary = z.infer<typeof AgentProviderSummary>;

export const AgentProvidersResult = z
  .object({ providers: z.array(AgentProviderSummary) })
  .passthrough();
export type AgentProvidersResult = z.infer<typeof AgentProvidersResult>;

/** PJ-6 (`draft/project-places/build-pj6.md`; PJ-D14 as amended 2026-10-12) —
 * a launch's model, puppeteer's `AgentModelSelection` carried OPAQUE (AR-L1):
 * `modelId` and every control's id and value are the agent's own words from
 * its catalog (`agent.models`), which VibeField passes on and never reads for
 * meaning. Absent, the agent starts at its own settings; a control left out
 * is the agent's own too (puppeteer applies no displayed default). `custom`
 * asks for a model the catalog does not list, only where the catalog says
 * `customModels`. puppeteer discovers again at the launch and refuses a
 * selection its agent no longer offers (`INVALID_MODEL_SELECTION`) or cannot
 * read (`MODEL_DISCOVERY_UNAVAILABLE`). Passthrough at its own depth: the
 * session record keeps it under the record's HMAC, so a key a newer fieldd
 * adds must reach an older reader whole (a stripped key breaks the
 * signature). */
export const AgentModelSelection = z
  .object({
    modelId: z.string().min(1).max(1024),
    custom: z.boolean().optional(),
    controls: z.record(z.string().min(1).max(1024), z.string().min(1).max(1024)).optional(),
  })
  .passthrough();
export type AgentModelSelection = z.infer<typeof AgentModelSelection>;

/** agent.spawn — a managed session born in a PTY on this device's floor
 * (workload class `agent`, a clean allow-listed environment). `cwd` defaults
 * to the OS user's home; `profileId` selects the persona (its root is bound
 * through the provider's own variable by puppeteer — fieldd never spells one).
 * AR-S5 — `profileSet` runs it under that Agent Profile's sign-in for the
 * agent (`native`: the agent's own folder), refused when the profile holds
 * none; with neither, the default profile's sign-in, else the agent's own
 * folder. PJ-6 — `modelSelection` starts it at that model and those controls
 * (absent: the agent's own settings). */
export const AgentSpawnParams = z
  .object({
    provider: AgentProviderId,
    cwd: z.string().optional(),
    profileId: AgentProfileId.optional(),
    profileSet: AgentProfileSetId.optional(),
    title: z.string().max(256).optional(),
    modelSelection: AgentModelSelection.optional(),
  })
  .passthrough();
export type AgentSpawnParams = z.infer<typeof AgentSpawnParams>;

/** The answer to a spawn or a resume: the fold's row as it stands at birth
 * (its monitor trails — the first state arrives on `agent.subscribe`) and the
 * SAME routed ticket `terminal.create` answers, so the pane that asked mounts
 * the agent's PTY with no second round trip (GT-1's point, kept). */
export const AgentSpawnResult = z
  .object({
    session: AgentSessionSummary,
    terminal: TerminalCreateOpenResult,
  })
  .passthrough();
export type AgentSpawnResult = z.infer<typeof AgentSpawnResult>;

/** agent.resume — continue an EXITED managed session from its persisted
 * record: a new run, a new PTY, the vendor's own session continued
 * (`runtime.resume({continuation})`). A record whose terminal is still alive
 * is refused (PRECONDITION_FAILED): re-attaching to a live process is AR-4's. */
export const AgentResumeRunParams = z
  .object({
    runtimeRunId: z.string().min(1),
    cwd: z.string().optional(),
  })
  .passthrough();
export type AgentResumeRunParams = z.infer<typeof AgentResumeRunParams>;

/** QL-D10 (thinking-ql-empty-pane-launcher.md) — continue a conversation the
 * agent index knows by its provider-native id (an `index.recent` row), with no
 * record of ours behind it: `runtime.resume({continuation: {providerId,
 * nativeSessionId, implementation: "native"}})`. `provider` is the catalog id;
 * refused when its row does not offer `resume`. The persona is `profileId`
 * (the row's own — the root that HOLDS the conversation) or `profileSet` (an
 * Agent Profile, resolved to its sign-in for the agent; `native`: the agent's
 * own folder), never both; with neither, the agent's own folder — a resume
 * never takes the default profile (puppeteer's rule). The persona named must
 * be the one the index files the conversation under (none where it is filed
 * in the agent's own folder) — else PRECONDITION_FAILED `other-profile`. A
 * conversation a live run already continues is refused. The answer is
 * `agent.spawn`'s. */
export const AgentResumeNativeParams = z
  .object({
    provider: AgentProviderId,
    nativeSessionId: z.string().min(1).max(256),
    cwd: z.string().optional(),
    profileId: AgentProfileId.optional(),
    profileSet: AgentProfileSetId.optional(),
    title: z.string().max(256).optional(),
  })
  .passthrough()
  .refine((params) => params.profileId === undefined || params.profileSet === undefined, {
    message: "name a profileId or a profileSet, not both",
  });
export type AgentResumeNativeParams = z.infer<typeof AgentResumeNativeParams>;

/** Either form. A body carrying `runtimeRunId` is the record form, whatever
 * else it carries — the run a caller names is the more specific claim. */
export const AgentResumeParams = z.union([AgentResumeRunParams, AgentResumeNativeParams]);
export type AgentResumeParams = z.infer<typeof AgentResumeParams>;

/** Which form a parsed `AgentResumeParams` is (the passthrough index
 * signature defeats `in` narrowing). */
export function isAgentResumeRun(params: AgentResumeParams): params is AgentResumeRunParams {
  return typeof (params as { runtimeRunId?: unknown }).runtimeRunId === "string";
}

/** agent.list result, and the shape of every `agent.subscribe` frame: FULL
 * snapshots (state transfer, never edges — a missed frame is repaired by the
 * next one), at most one per PF5 tick per connection. */
export const AgentListResult = z.object({ sessions: z.array(AgentSessionSummary) }).passthrough();
export type AgentListResult = z.infer<typeof AgentListResult>;

/** agents.profiles.login — the persona login pane: the vendor's own
 * interactive login, in a PTY bound to the persona's root. fieldd verifies
 * the persona when that terminal ends (the identity is native evidence read
 * afterwards, never a screen). */
export const AgentsProfilesLoginParams = z
  .object({
    profileId: AgentProfileId,
    cwd: z.string().optional(),
    /** AR-S2c: one of the agent's routes (the profiles feed's `routes`) to add
     * another sign-in with; absent, its default login. puppeteer refuses a
     * route the agent never declared (PRECONDITION_FAILED). */
    route: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
      .optional(),
  })
  .passthrough();
export type AgentsProfilesLoginParams = z.infer<typeof AgentsProfilesLoginParams>;

export const AgentsProfilesLoginResult = z
  .object({ persona: AgentPersona, terminal: TerminalCreateOpenResult })
  .passthrough();
export type AgentsProfilesLoginResult = z.infer<typeof AgentsProfilesLoginResult>;
