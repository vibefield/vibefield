import { z } from "zod";

// AR-1 — the agent index (rosetta) and the agent runtime's distribution and
// persona doors (puppeteer): the wire shapes behind `index.*` and `agents.*`
// (design-01 §5.1; thinking-ar-data-topology.md, AR-D15…D22 RATIFIED
// 2026-09-12). One principle binds every shape here: ownership by construction
// decides consent by construction. A root under `users/<fuid>/` is managed ⇒
// enrolled, never discovered; the OS user's own vendor roots (`~/.claude`, …)
// are discovered by every user's rosettad and consented per user (AR-D18).
//
// Two vocabularies meet here and are deliberately NOT merged. rosetta names an
// agent by its adapter KIND (`claude-code`, `codex`, `pi`, …) and a runtime by
// `(kind, data_root)`; puppeteer names a PROVIDER (`claude`, `codex`, …) and a
// profile (a persona) by id. Both are open strings — the registries are the
// siblings', read at the seam, never enumerated in this package (tolerant
// reader; AR-D3's alias table only ever groups for display). The join between
// them is the enrollment record below: a persona's observation root enrolled
// under its `profile_id`.
//
// TS-only in the generation pipeline (design-01 §7): field-native reads none
// of these files — fieldd is the one writer of the enrollment record and the
// one client of rosettad; the shell reads projections through fieldd's doors.

/** rosetta's agent kind — the adapter's registry name. Open (the roll call is
 * the authority); the pattern is the adapter-directory grammar. */
export const AgentKind = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
export type AgentKind = z.infer<typeof AgentKind>;

/** puppeteer's provider id (`AgentProviderIdSchema`, mirrored: the same
 * grammar, so a value that passes here passes there). Open. */
export const AgentProviderId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export type AgentProviderId = z.infer<typeof AgentProviderId>;

/** puppeteer's profile id grammar (`AgentProfileIdSchema`, mirrored). */
export const AgentProfileId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/);
export type AgentProfileId = z.infer<typeof AgentProfileId>;

// ── the enrollment record (`users/<fuid>/index/enrollment.json`, AR-D17) ──
//
// VibeField's truth for "what this user consented to" and "which persona maps
// to which runtime", and — the same bytes — rosettad's `--enroll FILE` input
// (rosetta `crates/rosettad/src/enroll.rs`, format 1). fieldd writes it BEFORE
// every spawn and restarts the daemon when it changes (RO-2's start-time
// scoping; live mutation is rosetta's open decision). rosetta ignores unknown
// fields at every level, which is what lets one file carry both sides: the
// keys rosetta reads are spelled its way (snake_case), and so — for one
// consistent file — are the keys only VibeField reads.
//
// What rosetta enforces at start (a refusal is a non-zero exit before the
// daemon binds, so fieldd validates the same rules before writing — never
// write what the daemon refuses): `format` is 1; every `runtimes[].kind` is a
// registered adapter; every `data_root` is absolute (no `~`), an existing
// directory, not a duplicate, not nested with another enrolled root or with
// the kind's native root, and never the native root itself. `enabled_kinds`
// entries that are unknown or not installed are warned about, never fatal.

export const INDEX_ENROLLMENT_FORMAT = 1;

/** An absolute root as rosetta admits it: POSIX `/…` or a Windows drive
 * path, never a `~` form (a `~` root is a DISCOVERED runtime's spelling and
 * would make the file's identity rule lie). Grammar only — existence is
 * fieldd's check at write time. */
export const AbsoluteDataRoot = z
  .string()
  .min(2)
  .max(4096)
  .refine((path) => /^(\/|[A-Za-z]:[\\/])/.test(path) && !path.startsWith("~"), {
    message: "data_root must be an absolute path (`~` forms are refused)",
  });

/** One managed runtime: a persona's OBSERVATION root (puppeteer PU-7 —
 * `ProfileService.observationRoot(profile)`, the directory rosetta's layout
 * applies to; never the profile's `dataRoot`, which differs for pi and
 * OpenCode). `label` is the persona's name, a serve-time presentation fact
 * (rosetta `RuntimeRow.label`); `profile_id` is VibeField's join. */
export const IndexEnrolledRuntime = z
  .object({
    kind: AgentKind,
    /** absolute, exactly as spelled at enrollment — the spelling IS the
     * runtime's identity (rosetta derives `runtime_id(kind, data_root)`) */
    data_root: AbsoluteDataRoot,
    label: z.string().min(1).max(64).optional(),
    profile_id: AgentProfileId.optional(),
  })
  .passthrough();
export type IndexEnrolledRuntime = z.infer<typeof IndexEnrolledRuntime>;

/** A runtime the user retired (AR-D19: watch off, rows kept, never purged).
 * VibeField-only — rosetta never reads it. Kept so the History room can still
 * name the persona after its profile and root are gone. */
export const IndexRetiredRuntime = z
  .object({
    kind: AgentKind,
    data_root: AbsoluteDataRoot,
    label: z.string().min(1).max(64).optional(),
    profile_id: AgentProfileId.optional(),
    retired_at: z.string(),
  })
  .passthrough();
export type IndexRetiredRuntime = z.infer<typeof IndexRetiredRuntime>;

export const IndexEnrollmentRecord = z
  .object({
    format: z.literal(INDEX_ENROLLMENT_FORMAT),
    /** consent for DISCOVERED kinds — the roll call answered headlessly; the
     * whole set, every start (RO-2c: the file is authoritative) */
    enabled_kinds: z.array(AgentKind),
    /** managed roots, consented by construction; never on the roll call */
    runtimes: z.array(IndexEnrolledRuntime),
    retired: z.array(IndexRetiredRuntime).optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type IndexEnrollmentRecord = z.infer<typeof IndexEnrollmentRecord>;

// ── index.* projections (fieldd → product clients) ──

/** One roll-call row (rosetta `DiscoveryRow`, mirrored): census facts only —
 * counts, sizes, a newest-touch stamp — never content. Managed roots are
 * absent by construction (they are never on the roll call). */
export const IndexDiscovery = z
  .object({
    kind: AgentKind,
    /** the layout's `~/...` form — machine-independent, names no home */
    dataRoot: z.string(),
    /** the root exists and holds at least one file the layout claims */
    installed: z.boolean(),
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    newestModifiedMs: z.number().int().nonnegative(),
    /** THIS user's consent per the enrollment record (AR-D17). The daemon's
     * own `enabled` flag is the cache and is not projected: the two differ
     * only across the restart that follows a change. */
    consented: z.boolean(),
  })
  .passthrough();
export type IndexDiscovery = z.infer<typeof IndexDiscovery>;

export const IndexDiscoveriesResult = z
  .object({ discoveries: z.array(IndexDiscovery) })
  .passthrough();
export type IndexDiscoveriesResult = z.infer<typeof IndexDiscoveriesResult>;

/** The index's one phase, folded in fieldd: the supervisor's phase until the
 * daemon is ready, then rosetta's `IngestPhase` (`discovering` →
 * `awaiting_consent` | `backfilling` → … → `live`). `unknown` is the tolerant
 * reader's answer to a phase this build has never heard of. */
export const INDEX_PHASES = [
  "unconfigured",
  "starting",
  "restarting",
  "failed",
  "stopped",
  "discovering",
  "awaiting_consent",
  "backfilling",
  "metadata_ready",
  "restoring",
  "finalizing",
  "publishing",
  "live",
  "unknown",
] as const;
export const IndexPhase = z.enum(INDEX_PHASES).catch("unknown");
export type IndexPhase = (typeof INDEX_PHASES)[number];

/** fieldd's projection of the index daemon (`FielddHealth.rosettad`, the
 * same four fields): the phase and its reason, the pid, the wire version —
 * never the loopback origin (EL7: rosettad is unauthenticated; the origin is
 * the secret and stays inside fieldd). */
export const IndexDaemonHealth = z
  .object({
    phase: z.string(),
    detail: z.string().nullable(),
    pid: z.number().int().nullable(),
    protocolVersion: z.number().int().nullable(),
  })
  .passthrough();
export type IndexDaemonHealth = z.infer<typeof IndexDaemonHealth>;

/** Cold-backfill meters for one runtime (rosetta `RuntimeBackfill`, mirrored;
 * skims measure in files, streams in bytes). */
export const IndexRuntimeBackfill = z
  .object({
    state: z.string(),
    filesTotal: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative(),
    filesSkimmed: z.number().int().nonnegative(),
    bytesStreamed: z.number().int().nonnegative(),
    sessionsTotal: z.number().int().nonnegative(),
    records: z.number().int().nonnegative(),
  })
  .passthrough();
export type IndexRuntimeBackfill = z.infer<typeof IndexRuntimeBackfill>;

/** Live-ingest counters for one watched runtime (rosetta
 * `RuntimeIngestStatus`, mirrored; cumulative since the daemon started). */
export const IndexRuntimeLive = z
  .object({
    events: z.number().int().nonnegative(),
    liveRows: z.number().int().nonnegative(),
    /** the last tick that moved data; idle polling does not count */
    lastActivityMs: z.number().int().nullable(),
  })
  .passthrough();
export type IndexRuntimeLive = z.infer<typeof IndexRuntimeLive>;

/** One runtime the daemon knows (rosetta `RuntimeRow`, folded with the
 * record). A discovered runtime carries its `~` root; an ENROLLED one carries
 * no path — its root is under this user's root, which is fieldd's business,
 * and the persona is named by `profileId` and `label`. */
export const IndexRuntimeStatus = z
  .object({
    /** rosetta's canonical runtime id — the join key with every session row */
    runtimeId: z.string().min(1),
    kind: AgentKind,
    provenance: z.enum(["discovered", "enrolled"]),
    dataRoot: z.string().optional(),
    label: z.string().optional(),
    profileId: AgentProfileId.optional(),
    /** the record still names it (consent in force). false = retired: rows
     * kept and public, watch off (AR-D19) */
    watched: z.boolean(),
    backfill: IndexRuntimeBackfill.optional(),
    live: IndexRuntimeLive.optional(),
  })
  .passthrough();
export type IndexRuntimeStatus = z.infer<typeof IndexRuntimeStatus>;

/** The record, projected (no paths). */
export const IndexEnrollmentSummary = z
  .object({
    enabledKinds: z.array(AgentKind),
    runtimes: z.array(
      z
        .object({
          kind: AgentKind,
          label: z.string().optional(),
          profileId: AgentProfileId.optional(),
        })
        .passthrough(),
    ),
    retired: z.array(
      z
        .object({
          kind: AgentKind,
          label: z.string().optional(),
          profileId: AgentProfileId.optional(),
          retiredAt: z.string(),
        })
        .passthrough(),
    ),
    updatedAt: z.string().nullable(),
  })
  .passthrough();
export type IndexEnrollmentSummary = z.infer<typeof IndexEnrollmentSummary>;

/** rosetta's `SearchState.readiness` (`SearchReadiness`, mirrored) plus the
 * tolerant reader's own answer (AR-5e). Readiness is SEPARATE from canonical
 * readiness and a non-ready state is never a successful empty search — so a
 * readiness this build has never heard of folds to `unknown`, which does not
 * answer, rather than being believed as "ready with no matches". */
export const INDEX_SEARCH_READINESS = [
  "ready",
  "building",
  "catching-up",
  "stale",
  "failed",
  "unknown",
] as const;
export const IndexSearchReadiness = z.enum(INDEX_SEARCH_READINESS).catch("unknown");
export type IndexSearchReadiness = (typeof INDEX_SEARCH_READINESS)[number];

/** What this daemon generation can do, derived from the protocol fieldd
 * speaks to it (18 added the session scope and prefix widening; fieldd
 * refuses any other version at the wire, so these are facts about the pinned
 * pair, not a negotiation). */
export const IndexSearchCapabilities = z
  .object({ sessionScope: z.boolean(), prefix: z.boolean() })
  .passthrough();
export type IndexSearchCapabilities = z.infer<typeof IndexSearchCapabilities>;

/** The find sheet's foot (AR-5e): whether the index answered at all, what it
 * can do, and how ready its search projection is. It rides `index.status`
 * because the `/api/status` read it is folded from is one fieldd already
 * makes — and the protocol version stays where AR-1 put it
 * (`IndexStatus.rosettad.protocolVersion`) rather than being said twice. */
export const IndexSearchHealth = z
  .object({
    /** the daemon answered this read (false while it is not ready) */
    reachable: z.boolean(),
    capabilities: IndexSearchCapabilities,
    canonicalReady: z.boolean().optional(),
    readiness: IndexSearchReadiness.optional(),
    progress: z
      .object({ done: z.number().finite(), total: z.number().finite() })
      .passthrough()
      .optional(),
    /** one sentence for the foot — never the daemon's origin (EL7) */
    detail: z.string().optional(),
  })
  .passthrough();
export type IndexSearchHealth = z.infer<typeof IndexSearchHealth>;

/** `index.status` — the whole honest picture in one read: the folded phase,
 * the daemon projection, the record, every runtime the daemon lists (empty
 * until the daemon is ready), and the search projection's own readiness.
 * `search` is optional so an answer from a build before AR-5e still parses. */
export const IndexStatus = z
  .object({
    phase: IndexPhase,
    rosettad: IndexDaemonHealth,
    enrollment: IndexEnrollmentSummary,
    runtimes: z.array(IndexRuntimeStatus),
    search: IndexSearchHealth.optional(),
  })
  .passthrough();
export type IndexStatus = z.infer<typeof IndexStatus>;

/** `index.enroll` — the COMPLETE set of discovered kinds this user consents
 * to (declarative: the roll call's checkboxes, not a delta). The record is
 * rewritten, the act audited, the daemon restarted when the set changed. */
export const IndexEnrollParams = z.object({ kinds: z.array(AgentKind).max(64) }).passthrough();
export type IndexEnrollParams = z.infer<typeof IndexEnrollParams>;

/** `index.retire` — stop watching one runtime; its rows stay (AR-D19). A
 * discovered runtime's kind leaves `enabled_kinds`; an enrolled runtime moves
 * to `retired`. Purge is a separate act and waits on rosetta (RO-8). */
export const IndexRetireParams = z.object({ runtimeId: z.string().min(1) }).passthrough();
export type IndexRetireParams = z.infer<typeof IndexRetireParams>;

export const IndexMutationResult = z
  .object({
    /** false = the record already said so; nothing was written or restarted */
    changed: z.boolean(),
    status: IndexStatus,
  })
  .passthrough();
export type IndexMutationResult = z.infer<typeof IndexMutationResult>;

// ── rosetta's session rows, as fieldd READS them (AR-4) ──
//
// The one INBOUND rosetta shape VibeField parses instead of casting. It is the
// evidence resume-when-idle decides on, and that act TERMINATES a live PTY
// before it resumes the run — so the columns fieldd joins on are strict here,
// and the tolerant reader's other half is `.passthrough()` at every level:
// rosetta's own `SessionRow` is far wider than this reading, and a column it
// adds must never make a session unreadable.
//
// Timestamps are epoch ms and must be FINITE — `JSON.parse("1e999")` is
// `Infinity`, and an infinite `last_at` answers every idle question the same
// way forever. Nothing here is a projection: these are rosetta's own keys,
// snake_case, the way the enrollment record above spells its side.

/** rosetta `SessionActivity`, mirrored: the bounds of recorded CONVERSATION
 * activity (descendants included) — never ingestion progress or file dates.
 * Order is NOT enforced here: bounds that contradict each other (`first_at`
 * after `last_at`) are nonsense a reader folds to "no evidence", not a body to
 * refuse — the rest of the row is still a usable identity. */
export const IndexSessionActivity = z
  .object({ first_at: z.number().finite(), last_at: z.number().finite() })
  .passthrough();
export type IndexSessionActivity = z.infer<typeof IndexSessionActivity>;

/** rosetta `SessionRow`, NARROWED to the columns fieldd joins on. An absent
 * `activity` reads as null — the same safe answer as an explicit null (no
 * evidence is never idle), so a serializer that ever skips the field cannot
 * make every pending run unresumable. */
export const IndexSessionRow = z
  .object({
    /** rosetta's canonical session id */
    id: z.string().min(1),
    /** the provider-native id every repo joins on (fieldd's continuation) */
    native_session_id: z.string(),
    /** `== id` for a top-level session; a subagent's row rolls up to its root */
    root_session_id: z.string(),
    activity: IndexSessionActivity.nullable().default(null),
    /** rosetta `StreamState` (`pending` | `streaming` | `indexed` today) —
     * open vocabulary: a state this build never heard of is carried, not
     * refused */
    stream_state: z.string(),
    // AR-5e — the columns the find sheet's facts lane DISPLAYS. Every one is
    // nullish: rosetta sends them as `T | null`, they decide nothing (no
    // terminate rides on a title), and a serializer that drops one must never
    // cost a reader the identity columns above. `updated_at` is SOURCE
    // freshness, not conversation activity — `activity` is the evidence.
    parent_session_id: z.string().nullish(),
    title: z.string().nullish(),
    summary: z.string().nullish(),
    cwd: z.string().nullish(),
    updated_at: z.number().finite().nullish(),
  })
  .passthrough();
export type IndexSessionRow = z.infer<typeof IndexSessionRow>;

/** rosetta `SessionsResponse` — the body of `/api/sessions`, the one rosetta
 * read fieldd parses. */
export const IndexSessionsResponse = z.object({ sessions: z.array(IndexSessionRow) }).passthrough();
export type IndexSessionsResponse = z.infer<typeof IndexSessionsResponse>;

/** rosetta `SessionResponse` — the body of `/api/sessions/<id>`, read only to
 * walk a hit's session UP to the root a reader navigates to (AR-5e). */
export const IndexSessionResponse = z.object({ session: IndexSessionRow }).passthrough();
export type IndexSessionResponse = z.infer<typeof IndexSessionResponse>;

/** rosetta `SearchBuildProgress`, narrowed: the two counters a foot shows. */
export const IndexSearchProgressRow = z
  .object({ documents_done: z.number().finite(), documents_total: z.number().finite() })
  .passthrough();
export type IndexSearchProgressRow = z.infer<typeof IndexSearchProgressRow>;

/** rosetta `SearchState` as fieldd READS it. `readiness` stays an open string
 * here and is folded by `IndexSearchReadiness` in the projection: refusing the
 * body over a word this build does not know would turn a degraded index into
 * an error, when the honest answer is "it did not answer". */
export const IndexSearchWireState = z
  .object({ readiness: z.string(), progress: IndexSearchProgressRow.nullish() })
  .passthrough();
export type IndexSearchWireState = z.infer<typeof IndexSearchWireState>;

/** rosetta `SearchHit`, NARROWED to what the sheet draws. `at` is the matched
 * row's stamp when the source reported one (never coerced to epoch zero), so
 * it is nullable AND must be finite — an infinite stamp would sort a hit past
 * the end of time. `score` rides through untouched (it is diagnostic and has
 * no cross-backend meaning). */
export const IndexSearchHitRow = z
  .object({
    timeline_id: z.string().min(1),
    session_id: z.string().min(1),
    kind: z.string(),
    at: z.number().finite().nullish(),
    snippet: z.string(),
  })
  .passthrough();
export type IndexSearchHitRow = z.infer<typeof IndexSearchHitRow>;

/** rosetta `SearchResponse` — the body of `/api/search`, parsed (not cast):
 * the sheet's whole answer rides on it and a shape fieldd cannot vouch for is
 * an honest UNAVAILABLE, never a silent "no matches". */
export const IndexSearchResponse = z
  .object({ state: IndexSearchWireState, hits: z.array(IndexSearchHitRow) })
  .passthrough();
export type IndexSearchResponse = z.infer<typeof IndexSearchResponse>;

// ── index.sessions / index.search (AR-5e — the history port's doors; the find
// sheet's two questions, and AR-8's first brick) ──
//
// The renderer asks in VibeField's vocabulary (camelCase, provider-native ids)
// and fieldd answers PROJECTIONS, exactly as `index.discoveries` and
// `index.status` do: rosetta's snake_case rows above are what fieldd READS,
// never what a door hands on. The two doors are one keystroke: the facts
// lookup resolves the live runs' canonical ids, and the search is scoped by
// them (rosetta widens each to its subagent tree, so a hit inside a delegated
// child still answers for the root the reader navigates to).

/** `index.sessions` — what the index knows about these live runs, by the
 * provider-native id every repo joins on. 256 is rosetta's own ceiling for a
 * selector list; fieldd chunks the ask and merges the answers. */
export const IndexSessionsParams = z
  .object({ nativeSessionIds: z.array(z.string().min(1).max(256)).min(1).max(256) })
  .passthrough();
export type IndexSessionsParams = z.infer<typeof IndexSessionsParams>;

/** One session as the door answers it. `activity` is AR-4's evidence already
 * folded (bounds that contradict each other are no evidence); `updatedAt` is
 * SOURCE freshness, not conversation activity, and is absent when rosetta
 * reported none. A row the index has never read is simply absent from the
 * answer — never a placeholder that would read as "known and empty". */
export const IndexSession = z
  .object({
    /** rosetta's canonical session id */
    sessionId: z.string().min(1),
    nativeSessionId: z.string(),
    /** `== sessionId` for a top-level session; a subagent rolls up to its root */
    rootSessionId: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
    cwd: z.string().optional(),
    updatedAt: z.number().finite().optional(),
    activity: z
      .object({ firstAt: z.number().finite(), lastAt: z.number().finite() })
      .passthrough()
      .nullable(),
    /** rosetta's ingest state for the session's source (open vocabulary) */
    streamState: z.string(),
  })
  .passthrough();
export type IndexSession = z.infer<typeof IndexSession>;

export const IndexSessionsResult = z.object({ rows: z.array(IndexSession) }).passthrough();
export type IndexSessionsResult = z.infer<typeof IndexSessionsResult>;

/** `index.search` — one question over the transcript history. `q` is plain
 * text (no backend query syntax); `nativeSessionIds` scopes it to the live
 * runs a reader can jump to (absent = everything the index knows); `kind`
 * picks one side of the conversation — rosetta indexes prompts and replies
 * today and answers 400 for any other kind, so the door admits only those two
 * rather than passing a refusal on. */
export const IndexSearchParams = z
  .object({
    q: z.string().min(1).max(512),
    nativeSessionIds: z.array(z.string().min(1).max(256)).max(256).optional(),
    /** epoch ms; only rows at or after it */
    afterMs: z.number().int().finite().nonnegative().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    /** widen word fragments to the tokens they begin (on by default) */
    prefix: z.boolean().optional(),
    kind: z.enum(["user", "agent"]).optional(),
  })
  .passthrough();
export type IndexSearchParams = z.infer<typeof IndexSearchParams>;

/** The projection of rosetta's `SearchState`: why an answer is the answer it
 * is. `detail` is one sentence for the sheet's foot — never the daemon's
 * origin (EL7) and never the query. */
export const IndexSearchState = z
  .object({
    readiness: IndexSearchReadiness,
    /** the canonical projection is serveable (rosetta's `canonical_ready`) */
    canonicalReady: z.boolean().optional(),
    progress: z
      .object({ done: z.number().finite(), total: z.number().finite() })
      .passthrough()
      .optional(),
    detail: z.string().optional(),
  })
  .passthrough();
export type IndexSearchState = z.infer<typeof IndexSearchState>;

/** One matched row, attributed to the root a reader navigates to. The join
 * key to a live run is `nativeSessionId` — absent when fieldd could not reach
 * the hit's root (the answer says so rather than guessing an attribution). */
export const IndexSearchHit = z
  .object({
    sessionId: z.string().min(1),
    /** the root this row rolls up to — ABSENT when fieldd could not attribute
     * it (the walk clipped, the index had no row); never the hit's own id in
     * its place, which read a subagent transcript as top-level (AR-5b) */
    rootSessionId: z.string().min(1).optional(),
    nativeSessionId: z.string().optional(),
    title: z.string().optional(),
    timelineId: z.string().min(1),
    /** `user` or `agent` today; anything else is shown as itself */
    kind: z.string(),
    at: z.number().finite().optional(),
    /** matches marked with `[` and `]`, the way rosetta marks them */
    snippet: z.string(),
  })
  .passthrough();
export type IndexSearchHit = z.infer<typeof IndexSearchHit>;

/** `index.search`'s answer. `answered: false` is the honest "the index had no
 * answer" — a building projection, an unreachable daemon, a readiness this
 * build does not know — and a sheet keeps what it last showed rather than
 * saying "no matches". `clipped` means the daemon stopped at its limit (or a
 * hit's root could not be resolved), so some sessions may be under-reported. */
export const IndexSearchResult = z
  .object({
    answered: z.boolean(),
    state: IndexSearchState,
    hits: z.array(IndexSearchHit),
    clipped: z.boolean(),
  })
  .passthrough();
export type IndexSearchResult = z.infer<typeof IndexSearchResult>;

// ── agents.* (the distribution and persona doors; handlers land at AR-2 with
// puppeteer's first import — these rows are the contract they will satisfy) ──

/** A persona (puppeteer `AgentProfile`, mirrored WITHOUT `dataRoot` — the
 * path is fieldd's; a client names a persona by id). `identity` is what the
 * provider's own status surface said at the last verify; it never carries a
 * token. `runtimeId` is the index join once the persona's root is enrolled. */
export const AgentPersona = z
  .object({
    profileId: AgentProfileId,
    provider: AgentProviderId,
    label: z.string().min(1).max(64),
    kind: z.enum(["native-default", "managed"]),
    createdAt: z.string(),
    identity: z
      .object({
        loggedIn: z.boolean(),
        method: z.string().optional(),
        email: z.string().optional(),
        organization: z.string().optional(),
        plan: z.string().optional(),
        verifiedAt: z.string(),
      })
      .passthrough()
      .optional(),
    runtimeId: z.string().optional(),
  })
  .passthrough();
export type AgentPersona = z.infer<typeof AgentPersona>;

export const AgentsProfilesListResult = z.object({ personas: z.array(AgentPersona) }).passthrough();
export type AgentsProfilesListResult = z.infer<typeof AgentsProfilesListResult>;

export const AgentsProfilesCreateParams = z
  .object({ provider: AgentProviderId, label: z.string().min(1).max(64) })
  .passthrough();
export type AgentsProfilesCreateParams = z.infer<typeof AgentsProfilesCreateParams>;

export const AgentsProfilesDeleteParams = z.object({ profileId: AgentProfileId }).passthrough();
export type AgentsProfilesDeleteParams = z.infer<typeof AgentsProfilesDeleteParams>;

export const AgentsProfilesVerifyParams = z.object({ profileId: AgentProfileId }).passthrough();
export type AgentsProfilesVerifyParams = z.infer<typeof AgentsProfilesVerifyParams>;

export const AgentsProfilesListParams = z
  .object({ provider: AgentProviderId.optional() })
  .passthrough();
export type AgentsProfilesListParams = z.infer<typeof AgentsProfilesListParams>;

/** puppeteer `ProfileFailure`, mirrored: what an adapter could not do for a
 * persona, as data (a `verify` that cannot read an identity is an answer,
 * never an exception). `not-found` and `invalid` requests are refused at the
 * door instead (NOT_FOUND / PRECONDITION_FAILED). */
export const AgentProfileFailure = z
  .object({
    status: z.enum(["unsupported", "unavailable", "not-found", "invalid"]),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .passthrough();
export type AgentProfileFailure = z.infer<typeof AgentProfileFailure>;

/** `agents.profiles.create` — the persona as registered. `runtimeId` rides
 * once the daemon LISTS the enrolled root: fieldd enrolls it in the record
 * when the daemon is ready and the provider's layout root is on the roll
 * call, bounces the daemon, and the daemon's runtime rows can trail its ready
 * line by a moment — so an absent id here means "not listed yet", and the list
 * door carries it as soon as the projection does. A persona the index could
 * not take now is enrolled at the next daemon ready (topology R4). */
export const AgentsProfilesCreateResult = z.object({ persona: AgentPersona }).passthrough();
export type AgentsProfilesCreateResult = z.infer<typeof AgentsProfilesCreateResult>;

/** `agents.profiles.delete` — AR-D19: the runtime is retired (rows kept), the
 * profile unregistered, the managed root deleted with its credentials. */
export const AgentsProfilesDeleteResult = z.object({ deleted: z.boolean() }).passthrough();
export type AgentsProfilesDeleteResult = z.infer<typeof AgentsProfilesDeleteResult>;

/** `agents.profiles.verify` — the persona with the identity the provider's own
 * status surface reported (persisted), or the persona unchanged beside the
 * adapter's honest failure to learn one. */
export const AgentsProfilesVerifyResult = z
  .object({ persona: AgentPersona, failure: AgentProfileFailure.optional() })
  .passthrough();
export type AgentsProfilesVerifyResult = z.infer<typeof AgentsProfilesVerifyResult>;

/** What an update of one install would run (puppeteer `UpdatePlan`,
 * projected): the recipe's kind and the vendor's own command as argv — the
 * exact command the Update button runs, named before anyone presses it — or,
 * for an install script, the script's URL (fetched over https and run with
 * bash, as its vendor documents), or, for a manual recipe, the vendor's
 * instructions in their own words. */
export const AgentUpdatePlan = z
  .object({
    /** puppeteer's recipe kind (`native-self-update` · `npm-global` · `brew` ·
     * `installer-script` · `manual`), open */
    kind: z.string().min(1),
    command: z.array(z.string()).optional(),
    url: z.string().optional(),
    instructions: z.string().optional(),
  })
  .passthrough();
export type AgentUpdatePlan = z.infer<typeof AgentUpdatePlan>;

/** One classified install (puppeteer `InstalledAgent`, mirrored — every
 * field native evidence) plus VibeField's one choice: whether it is the
 * ACTIVE executable new spawns use (AR-D16, `machine/agents/distribution.json`). */
export const AgentInstall = z
  .object({
    provider: AgentProviderId,
    executable: z.string().min(1),
    realPath: z.string().min(1),
    version: z.string().optional(),
    method: z.string(),
    packageName: z.string().optional(),
    location: z.string().optional(),
    autoUpdate: z.enum(["enabled", "disabled", "unknown"]),
    channel: z.string().optional(),
    /** which declared release line the install's own updater follows, as the
     * ADAPTER maps its vendor's setting (`stable` · `preview`, open); absent =
     * the adapter could not tell, and puppeteer compares against stable */
    releaseChannel: z.string().optional(),
    active: z.boolean(),
    /** what Update would run for this install; absent when the plan could not
     * be formed (the adapter's honest failure is logged, never guessed at) */
    update: AgentUpdatePlan.optional(),
  })
  .passthrough();
export type AgentInstall = z.infer<typeof AgentInstall>;

/** `agents.installs` — every provider's classified installs, or one
 * provider's. The default answers the inventory fieldd read when it started
 * (or since: an update re-reads its own provider) — a page opens on it at
 * once. `refresh: true` reads the Mac again: the vendor's own version command
 * runs per candidate, which takes seconds, so it is an act a person asks for. */
export const AgentsInstallsParams = z
  .object({ provider: AgentProviderId.optional(), refresh: z.boolean().optional() })
  .passthrough();
export type AgentsInstallsParams = z.infer<typeof AgentsInstallsParams>;

export const AgentsInstallsResult = z
  .object({
    installs: z.array(AgentInstall),
    /** whether this daemon holds the machine scope the update and active-
     * executable doors write (false: an embedded or unit daemon — the installs
     * still answer, but nothing updates from here). Absent from older daemons. */
    machineScope: z.boolean().optional(),
  })
  .passthrough();
export type AgentsInstallsResult = z.infer<typeof AgentsInstallsResult>;

/** A release fact (puppeteer `ReleaseSnapshot`, mirrored), or the honest
 * failure to learn one (`DistributionFailure`). */
export const AgentRelease = z
  .object({
    provider: AgentProviderId,
    channel: z.string(),
    version: z.string().min(1),
    publishedAt: z.string().optional(),
    url: z.string().optional(),
    fetchedAt: z.string(),
    source: z.object({ kind: z.string(), id: z.string() }).passthrough(),
  })
  .passthrough();
export type AgentRelease = z.infer<typeof AgentRelease>;

export const AgentReleaseFailure = z
  .object({
    provider: AgentProviderId,
    status: z.enum(["unsupported", "unavailable"]),
    message: z.string(),
    retryable: z.boolean(),
  })
  .passthrough();
export type AgentReleaseFailure = z.infer<typeof AgentReleaseFailure>;

/** `agents.releases` — the agent's own oracle always; the declared network
 * detectors only when THIS call says so or the provider's recorded preference
 * does (AR-D22: release checks are attended acts; the default reaches nothing).
 * `cached: true` runs NOTHING — no oracle, no network — and answers the last
 * check the machine record kept, re-judged against the installs as they are
 * now, so a page can open on "checked 09:41:20" without checking on its own. */
export const AgentsReleasesParams = z
  .object({
    provider: AgentProviderId.optional(),
    network: z.boolean().optional(),
    cached: z.boolean().optional(),
  })
  .passthrough();
export type AgentsReleasesParams = z.infer<typeof AgentsReleasesParams>;

/** The one update a provider's ACTIVE install would take (puppeteer
 * `ReleaseCheckResult.available`): the newest release on the line its own
 * updater follows, when newer. Absent for a provider = current, or unknown. */
export const AgentAvailableUpdate = z
  .object({ provider: AgentProviderId, channel: z.string(), version: z.string().min(1) })
  .passthrough();
export type AgentAvailableUpdate = z.infer<typeof AgentAvailableUpdate>;

export const AgentsReleasesResult = z
  .object({
    releases: z.array(z.union([AgentRelease, AgentReleaseFailure])),
    available: z.array(AgentAvailableUpdate).optional(),
    /** when each provider in the answer was checked — a cached answer's own
     * time, never implied fresh; a provider never checked is absent */
    checked: z
      .array(z.object({ provider: AgentProviderId, at: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();
export type AgentsReleasesResult = z.infer<typeof AgentsReleasesResult>;

export const AgentsUpdateParams = z.object({ provider: AgentProviderId }).passthrough();
export type AgentsUpdateParams = z.infer<typeof AgentsUpdateParams>;

/** puppeteer `UpdateReceipt`, mirrored: the vendor's own updater ran (or
 * could not); the transcript stays under `machine/agents/updates/`.
 * `unchanged` = the updater exited 0 and the version did not move — current,
 * or an updater that declined; a reader that knows of a newer release says
 * which. `already-current` is kept for receipts written before `unchanged`. */
export const AgentUpdateReceipt = z
  .object({
    provider: AgentProviderId,
    status: z.enum(["updated", "unchanged", "already-current", "failed", "unsupported"]),
    startedAt: z.string(),
    finishedAt: z.string(),
    exitCode: z.number().int().optional(),
    message: z.string().optional(),
    /** the install's version before and after, as re-inspected — never the updater's claim */
    fromVersion: z.string().optional(),
    toVersion: z.string().optional(),
    /** the person stopped it (`agents.update.stop`) */
    stopped: z.boolean().optional(),
  })
  .passthrough();
export type AgentUpdateReceipt = z.infer<typeof AgentUpdateReceipt>;

export const AgentsUpdateResult = z.object({ receipt: AgentUpdateReceipt }).passthrough();
export type AgentsUpdateResult = z.infer<typeof AgentsUpdateResult>;

export const AgentsSetActiveParams = z
  .object({ provider: AgentProviderId, executable: z.string().min(1) })
  .passthrough();
export type AgentsSetActiveParams = z.infer<typeof AgentsSetActiveParams>;

/** `agents.setActive` — the record rewritten (false = it already said so) and
 * the provider's installs with `active` as the record now reads. The choice
 * reaches spawns from the next fieldd boot (the runtime binds its launch
 * executable at construction; AR-3 may move it to per-spawn). */
export const AgentsSetActiveResult = z
  .object({ changed: z.boolean(), installs: z.array(AgentInstall) })
  .passthrough();
export type AgentsSetActiveResult = z.infer<typeof AgentsSetActiveResult>;

/** The bound on an operation's kept output: the vendor command's last words
 * are what a person reads while it runs; the whole transcript stays 0600
 * under `machine/agents/updates/`, never on this wire. */
export const AGENT_OPERATION_OUTPUT_BYTES = 16 * 1024;

/** One distribution act in flight or just finished on this device — today an
 * update (`agents.update`) — with the vendor command's own output as it runs:
 * display text, ANSI-stripped, the last `AGENT_OPERATION_OUTPUT_BYTES`, NEVER
 * parsed (RFC 006: the outcome is the receipt's re-inspection). */
export const AgentOperation = z
  .object({
    provider: AgentProviderId,
    /** `update` today; an open word so a later act (an install) is a value, not a break */
    kind: z.string().min(1),
    state: z.enum(["running", "finished"]),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    output: z.string(),
    /** earlier output was dropped to keep the tail bounded */
    truncated: z.boolean(),
    receipt: AgentUpdateReceipt.optional(),
  })
  .passthrough();
export type AgentOperation = z.infer<typeof AgentOperation>;

/** `agents.operations.subscribe` — the running and last-finished operation per
 * provider; whole snapshots (state transfer, never edges), coalesced to the
 * tick. Kept in fieldd's memory only: a restart forgets the output, and the
 * receipt the machine record kept is the durable fact. */
export const AgentsOperationsResult = z
  .object({ operations: z.array(AgentOperation) })
  .passthrough();
export type AgentsOperationsResult = z.infer<typeof AgentsOperationsResult>;

/** `agents.update.stop` — stop the update running for a provider: its whole
 * process tree, SIGTERM then SIGKILL (an update can run long — a large fetch,
 * a service drained). The update's own call then answers its receipt, marked
 * `stopped`. `stopped: false` = nothing was running. */
export const AgentsUpdateStopParams = z.object({ provider: AgentProviderId }).passthrough();
export type AgentsUpdateStopParams = z.infer<typeof AgentsUpdateStopParams>;

export const AgentsUpdateStopResult = z.object({ stopped: z.boolean() }).passthrough();
export type AgentsUpdateStopResult = z.infer<typeof AgentsUpdateStopResult>;

/** `agents.reveal` — show one of a provider's installs in the OS file manager.
 * Names the install the way `agents.installs` answered it; fieldd reveals only
 * a path its own inventory holds, never a path a caller spells. */
export const AgentsRevealParams = z
  .object({ provider: AgentProviderId, executable: z.string().min(1) })
  .passthrough();
export type AgentsRevealParams = z.infer<typeof AgentsRevealParams>;

export const AgentsRevealResult = z.object({ revealed: z.literal(true) }).passthrough();
export type AgentsRevealResult = z.infer<typeof AgentsRevealResult>;

// ── the distribution record (`machine/agents/distribution.json`, AR-D15/D16) ──
//
// The only machine-scope product state (UA-D1's one named exception): installs
// are OS-user-global by nature, and VibeField owns nothing there but a choice
// (which executable is active, per provider) and a preference (channel,
// network opt-in), plus the receipts. Root-locked JSON published atomically by
// the ATTACHED user's fieldd (R6); resident fieldds watch and refresh. Never a
// settings-doc scope. An active-executable flip reaches NEW spawns only.

export const AGENT_DISTRIBUTION_FORMAT = 1;

export const AgentDistributionProvider = z
  .object({
    /** the executable new spawns use; absent = the provider's own resolution */
    activeExecutable: z.string().min(1).optional(),
    channel: z.string().optional(),
    /** release checks may reach the network (attended; off by default) */
    network: z.boolean().optional(),
    lastCheckedAt: z.string().optional(),
    /** the rows the last check learned (releases and honest failures), kept so
     * a page opens on them without checking again (AR-D22) */
    lastReleases: z.array(z.union([AgentRelease, AgentReleaseFailure])).optional(),
    lastUpdate: AgentUpdateReceipt.optional(),
  })
  .passthrough();
export type AgentDistributionProvider = z.infer<typeof AgentDistributionProvider>;

export const AgentDistributionRecord = z
  .object({
    format: z.literal(AGENT_DISTRIBUTION_FORMAT),
    providers: z.record(AgentProviderId, AgentDistributionProvider),
    updatedAt: z.string(),
  })
  .passthrough();
export type AgentDistributionRecord = z.infer<typeof AgentDistributionRecord>;
