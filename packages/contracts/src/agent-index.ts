import { z } from "zod";
import { isAbsoluteDesktopPath } from "./paths";
import { INDEX_TICKET } from "./registries";
import { composeRemoteEndpoints, remoteDoorUrl, remoteEndpointSet } from "./remote-endpoints";
import {
  MeshScope,
  RowsDeviceState,
  RowsSubscribeParams,
  rowsDelta,
  rowsOpen,
  rowsSnapshot,
} from "./rows";

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
// profile (a persona) by id. Both stay open strings ON THE WIRE (tolerant
// reader). **Errata 2026-09-22 (AC-D1/AC-D2, thinking-ar-agent-catalog.md):**
// this paragraph said the registries are "never enumerated in this package"
// and that "AR-D3's alias table only ever groups for display". Since AC-1 the
// agents VibeField SUPPORTS are enumerated ONCE, in `agent-catalog.ts`, as
// decisions the gate (wall R23) holds to both siblings' registries: the
// catalog id is puppeteer's provider id, rosetta's kind is a seam column
// fieldd translates where the seam is crossed, and no surface shows a kind.
// The join between the two for SESSIONS is unchanged — the enrollment record
// below: a persona's observation root enrolled under its `profile_id`.
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

/** puppeteer's profile SET id (`ProfileSetIdSchema`, mirrored) — what the
 * Settings sidebar calls an Agent Profile. It is also the name of the set's
 * folder under `agents/profiles/`, so the grammar is a directory name's:
 * lowercase letters and digits joined by single hyphens, at most 48. The
 * synthetic native set ("This Mac") is `native`. */
export const AgentProfileSetId = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/);
export type AgentProfileSetId = z.infer<typeof AgentProfileSetId>;

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
    /** AC-D8 — the daemon REFUSED this root at start (`unknown agent kind`:
     * a catalog/daemon skew) and fieldd subtracted it so the index could come
     * up; `retired_at` is when. The daemon's line, kept whole here (it names
     * the root — this file never leaves fieldd). VibeField-only; the row is
     * re-enrolled by the ready-time reconcile once a daemon's roll call names
     * the kind again. */
    refused: z
      .object({ detail: z.string().max(512) })
      .passthrough()
      .optional(),
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
    /** AC-1 — the catalog id this kind maps to (`catalogIdForKind`); absent
     * when no row maps it, and the row is then shown by its wire `kind` and
     * never selectable (tolerant reader). fieldd fills it from AC-3. */
    agent: AgentProviderId.optional(),
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
 * the secret and stays inside fieldd). *Corrected 2026-10-03 (AR-8b): rosettad
 * authenticates now — the bearer is the secret, and it stays inside fieldd;
 * the origin reaches a window only inside an `IndexOpenTicket`.* */
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
    /** AC-1 — the catalog id for `kind` (absent when no row maps it) */
    agent: AgentProviderId.optional(),
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
          /** AC-D8 — set when the daemon refused the root rather than the user
           * retiring it (`retiredAt` is when): the daemon's reason (`unknown
           * agent kind`) — never its line, which names the root (this
           * projection carries no paths). The record keeps the line. */
          refused: z.object({ reason: z.string() }).passthrough().optional(),
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
    // QL (thinking-ql-empty-pane-launcher.md) — the columns `index.recent`
    // joins on: the runtime (→ its kind → the catalog id, and → the persona
    // an enrolled root was filed under), the project (rosetta's opaque id:
    // the git root, worktrees grouped; null for a session with no workspace)
    // and when the session began. Nullish for the same reason as the display
    // columns above: none of them is identity.
    runtime_id: z.string().nullish(),
    project_id: z.string().nullish(),
    started_at: z.number().finite().nullish(),
  })
  .passthrough();
export type IndexSessionRow = z.infer<typeof IndexSessionRow>;

/** rosetta `SessionsResponse` — the body of `/api/sessions`, the one rosetta
 * read fieldd parses. */
export const IndexSessionsResponse = z.object({ sessions: z.array(IndexSessionRow) }).passthrough();
export type IndexSessionsResponse = z.infer<typeof IndexSessionsResponse>;

/** rosetta `ProjectRow`, NARROWED to what `index.recent` reads: the opaque id
 * (derived from the project's identity root — a linked worktree's original
 * checkout), a display name, and every root the index has SEEN the project at
 * (the identity root and each worktree's own root, normalized, no trailing
 * slash). */
export const IndexProjectRow = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    root_paths: z.array(z.string()),
  })
  .passthrough();
export type IndexProjectRow = z.infer<typeof IndexProjectRow>;

/** rosetta `ProjectsResponse` — the body of `/api/projects`. */
export const IndexProjectsResponse = z.object({ projects: z.array(IndexProjectRow) }).passthrough();
export type IndexProjectsResponse = z.infer<typeof IndexProjectsResponse>;

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

// ── DS-6: how a desktop took part in a mesh answer (the listing's and the
// search's `sources`; the history catalog's rows are further down) ──

/** A desktop's standing in a mesh LISTING (DS-L8 — asleep is a state): its
 * rows are listed either way, and this is how a page greys them. `asOf` is
 * when its rows were last heard (absent: never, this boot or any earlier). */
export const IndexCatalogSource = z
  .object({
    device: z.string().min(1),
    /** the roster's display name, when the roster lists the device */
    name: z.string().optional(),
    self: z.boolean(),
    state: RowsDeviceState,
    asOf: z.string().min(1).optional(),
    /** how many of this desktop's rows the answering table holds */
    rows: z.number().int().nonnegative(),
  })
  .passthrough();
export type IndexCatalogSource = z.infer<typeof IndexCatalogSource>;

/** How one desktop took part in a mesh search: `answered` (its index had an
 * answer — possibly no hits) · `building` (it answered that it has none yet:
 * a building projection, a daemon not ready) · `asleep` (the roster says it
 * is away — never "nothing found") · `timeout` (asked, and no answer: silent
 * past the fan-out budget, its own search timed out, or the link failed while
 * the roster calls it awake or restarting) · `incompatible` (another
 * contracts major, or a build without the door: not asked, DS-L9).
 *
 * Corrected 2026-10-01 (DS-6b): `asleep` also read "its door did not answer",
 * which let a failed call stand for the desktop's state — a retryable refusal
 * or a TIMEOUT from a desktop the roster calls awake or restarting read
 * `asleep`. The error is not the state: whether a desktop is away is the
 * roster's to say (DS-L8), and a silent awake desktop is a `timeout`. */
export const IndexSearchSourceState = z.enum([
  "answered",
  "building",
  "asleep",
  "timeout",
  "incompatible",
]);
export type IndexSearchSourceState = z.infer<typeof IndexSearchSourceState>;

export const IndexSearchSource = z
  .object({
    device: z.string().min(1),
    state: IndexSearchSourceState,
    /** how long its answer took (0 for a desktop that was not asked) */
    tookMs: z.number().int().nonnegative(),
    /** its own answer clipped at the limit */
    clipped: z.boolean().optional(),
    /** one sentence for the foot, never an origin or the query */
    detail: z.string().optional(),
  })
  .passthrough();
export type IndexSearchSource = z.infer<typeof IndexSearchSource>;

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

/** `index.sessions` — two questions on one door.
 *
 * The LOOKUP (AR-5e, unchanged): what the index knows about these live runs,
 * by the provider-native id every repo joins on. 256 is rosetta's own ceiling
 * for a selector list; fieldd chunks the ask and merges the answers.
 *
 * The LISTING (DS-6, design-06 §5 "History"): with no `nativeSessionIds`, a
 * page of the history catalog, newest first by the OWNER's timestamps with
 * the device as tie-break, paged by keyset (`cursor` is the previous answer's,
 * opaque). `scope: "local"` (the default) lists this desktop's own index;
 * `scope: "mesh"` lists the MERGED replica of every self desktop — a sleeping
 * desktop's rows included, greyed by `sources` (DS-L8) — with one row per
 * `{agent kind, native session id}` however many desktops hold it (DS-D10).
 * `family` narrows to one repository family (DS-D9), `devices` to some
 * desktops, `projectId` to one project (rosetta's opaque id; with `devices`
 * naming its owner when the scope is mesh). */
export const IndexSessionsParams = z
  .object({
    nativeSessionIds: z.array(z.string().min(1).max(256)).min(1).max(256).optional(),
    scope: MeshScope.optional(),
    family: z.string().min(1).max(512).optional(),
    devices: z.array(z.string().min(1).max(256)).min(1).max(64).optional(),
    projectId: z.string().min(1).max(256).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
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
    // DS-6 — the listing's columns. Absent from a lookup's rows (they never
    // carried them), present on a listing's: which desktop the row is from,
    // every desktop that holds the same `{agent kind, native session id}`
    // (DS-D10; the owner of the row first), the project and its family
    // (DS-D9), the catalog agent, when the session began.
    device: z.string().min(1).optional(),
    devices: z.array(z.string().min(1)).optional(),
    projectId: z.string().min(1).optional(),
    family: z.string().min(1).optional(),
    provider: AgentProviderId.optional(),
    startedAt: z.number().finite().optional(),
  })
  .passthrough();
export type IndexSession = z.infer<typeof IndexSession>;

/** `index.sessions`' answer. A lookup answers `rows` alone, as it always did;
 * a listing adds the next page's `cursor` (absent on the last page) and the
 * standing of every desktop the page read (`sources`). */
export const IndexSessionsResult = z
  .object({
    rows: z.array(IndexSession),
    cursor: z.string().min(1).optional(),
    sources: z.array(IndexCatalogSource).optional(),
  })
  .passthrough();
export type IndexSessionsResult = z.infer<typeof IndexSessionsResult>;

// ── index.recent (QL — the empty pane launcher's list; thinking-ql-empty-pane-
// launcher.md, QL-D9) ──
//
// A folder's past sessions, newest first: the pane's own project ("here") or
// every project ("all"). "Here" is rosetta's project — the git root, worktrees
// grouped — so a pane in a worktree finds the sessions of every checkout of
// the repo; a pane outside any repo matches by folder instead (the project
// rooted at exactly the cwd — rosetta roots every non-repo cwd's project there,
// so an ancestor's, home's most often, is never this folder's — else the
// sessions run in the cwd or under it). Top-level sessions only: a delegated child is transcript
// structure, never a thing a person resumes.

export const INDEX_RECENT_DEFAULT_LIMIT = 100;

export const IndexRecentParams = z
  .object({
    /** the pane's folder, ABSOLUTE (POSIX, a drive or UNC — a relative path
     * names no folder fieldd could resolve, and would be resolved against
     * fieldd's own cwd); absent = no folder, so nothing is "here" */
    cwd: z
      .string()
      .min(1)
      .max(4096)
      .refine(isAbsoluteDesktopPath, "expected an absolute folder path")
      .optional(),
    scope: z.enum(["here", "all"]),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .passthrough();
export type IndexRecentParams = z.infer<typeof IndexRecentParams>;

/** A rosetta project as the door names it: the opaque id and its name (the
 * identity root's last segment). Never its root paths — the rows carry their
 * own `cwd`, and the list needs a heading, not a directory listing. */
export const IndexRecentProject = z
  .object({ id: z.string().min(1), name: z.string() })
  .passthrough();
export type IndexRecentProject = z.infer<typeof IndexRecentProject>;

/** One past session: `IndexSession`'s columns, plus what a launcher needs to
 * resume it and to group it. `provider` is the CATALOG id the session's
 * runtime kind maps to (absent when no catalog row maps it — shown, never
 * resumable); `profileId` is the persona an ENROLLED root was filed under
 * (absent for the agent's own folder), so a resume continues the conversation
 * in the root that holds it. */
export const IndexRecentSession = IndexSession.extend({
  provider: AgentProviderId.optional(),
  profileId: AgentProfileId.optional(),
  /** epoch ms the session began (rosetta's `started_at`) */
  startedAt: z.number().finite().optional(),
  /** the session belongs to the pane's project (or, outside any project, was
   * run in the pane's folder or under it) */
  here: z.boolean(),
  /** absent for a session with no workspace (rosetta's unassigned bucket) */
  project: IndexRecentProject.optional(),
  /** whether `cwd` is an existing folder on THIS device when fieldd answered:
   * `false` is a conversation whose folder is gone (a resume there is refused
   * `missing-cwd`), so a launcher withholds ↵ and says why. Absent when the
   * row has no cwd — and from an older daemon, which said nothing. */
  cwdExists: z.boolean().optional(),
}).passthrough();
export type IndexRecentSession = z.infer<typeof IndexRecentSession>;

/** `index.recent`'s answer: rosetta's order (conversation activity, newest
 * first). `project` is the project the pane's folder resolved to — present
 * even when it holds no sessions yet, so a list can name the folder it is
 * empty for; absent when the folder belongs to no project the index knows. */
export const IndexRecentResult = z
  .object({
    rows: z.array(IndexRecentSession),
    project: IndexRecentProject.optional(),
  })
  .passthrough();
export type IndexRecentResult = z.infer<typeof IndexRecentResult>;

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
    /** DS-6 — `local` (the default): this desktop's index. `mesh`: ASK every
     * awake self desktop (search by asking, DS-D8) and merge the answers by
     * TIME, never by score (scores are per index, §1.6); `sources` says who
     * answered — a sleeping desktop's silence is never "nothing found". */
    scope: MeshScope.optional(),
    /** with `scope: "mesh"`, ask only these desktops */
    devices: z.array(z.string().min(1).max(256)).min(1).max(64).optional(),
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
    /** DS-6 — the desktop whose index answered it (a mesh search's hits) */
    device: z.string().min(1).optional(),
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
    /** DS-6 — a mesh search's per-desktop account (absent on a local one) */
    sources: z.array(IndexSearchSource).optional(),
  })
  .passthrough();
export type IndexSearchResult = z.infer<typeof IndexSearchResult>;

// ── the history catalog across desktops (DS-6; design-06 §5 "History",
// `thinking-desktop-sync-plane.md` §6.4 — DS-D8/D9/D10 RULED 2026-09-30) ──
//
// Each desktop is the backend of ITS OWN index (one rosettad per user root per
// device). Its fieldd follows rosetta's topology stream (`/ws/meta`) and
// republishes two FACT tables as rows (DS-L3, `rows.ts`): `projects` and
// `sessions` (top-level sessions only — a delegated child is transcript
// structure). rosetta has no machine dimension, so the DEVICE is added here,
// where the mesh lives, and every row carries its owner (DS-L2: keyed
// `{device, id}`; a daemon never edits another device's row, it holds a copy).
// The stream has no resume and no removal event, so fieldd owns the journal:
// it assigns the revisions and finds removals by diffing a fresh snapshot.
//
// Peers list once and watch from their cursor (`index.catalog.subscribe`,
// self peers only); a window or the phone never reads these tables raw — it
// pages the MERGED replica through `index.projects` / `index.sessions`
// (DS-L4: the daemon aggregates, a client never merges).

export const INDEX_CATALOG_TABLES = ["projects", "sessions"] as const;
export const IndexCatalogTable = z.enum(INDEX_CATALOG_TABLES);
export type IndexCatalogTable = (typeof INDEX_CATALOG_TABLES)[number];

/** One project as its OWNER republishes it: rosetta's project (the opaque id
 * is a hash of a LOCAL path — identity stays `{device, path}`, D30), plus the
 * repository FAMILY VibeField computes from `git_repo` (DS-D9: host
 * lowercased, path without `.git`, scheme and userinfo dropped; absent when
 * there is no remote, or the remote is only a folder) and two figures the
 * owner derives from its own sessions. */
export const IndexCatalogProject = z
  .object({
    device: z.string().min(1),
    /** rosetta's opaque project id — the row's key within its owner's table */
    projectId: z.string().min(1),
    name: z.string(),
    /** every root the owner's index has seen the project at (its identity
     * root first, then each worktree's) — paths on THAT desktop */
    rootPaths: z.array(z.string()),
    /** rosetta's `git_repo`: the origin remote as rosetta sanitized it
     * (display metadata — ssh and https spellings stay apart here) */
    gitRepo: z.string().optional(),
    family: z.string().min(1).optional(),
    /** top-level sessions the owner holds for it */
    sessionCount: z.number().int().nonnegative(),
    /** epoch ms, the owner's clock: the newest of its sessions' activity
     * (absent while none has any) */
    lastActivityAt: z.number().finite().optional(),
  })
  .passthrough();
export type IndexCatalogProject = z.infer<typeof IndexCatalogProject>;

/** One top-level session as its OWNER republishes it — `IndexSession`'s
 * columns keyed by rosetta's canonical id within the owner's table, with the
 * agent named twice: rosetta's `kind` (the seam column the duplicate rule
 * joins on, DS-D10) and the catalog `provider` it maps to (what a surface
 * shows; absent when no catalog row maps the kind). */
export const IndexCatalogSession = z
  .object({
    device: z.string().min(1),
    sessionId: z.string().min(1),
    nativeSessionId: z.string(),
    kind: AgentKind.optional(),
    provider: AgentProviderId.optional(),
    projectId: z.string().min(1).optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    cwd: z.string().optional(),
    startedAt: z.number().finite().optional(),
    updatedAt: z.number().finite().optional(),
    activity: z
      .object({ firstAt: z.number().finite(), lastAt: z.number().finite() })
      .passthrough()
      .nullable(),
    streamState: z.string(),
  })
  .passthrough();
export type IndexCatalogSession = z.infer<typeof IndexCatalogSession>;

/** `index.catalog.subscribe` — one of a desktop's two tables, as rows (the
 * base's `rowsOpen` answer, then `.delta` / `.snapshot` frames; a caught-up
 * reader hears a periodic key-digest heartbeat — a delta with `since ===
 * revision`, no rows and a `digest` member). SELF PEERS ONLY: it is the
 * peer-to-peer replication door, admitted to a `peer-fieldd` principal and no
 * other (titles, summaries and folders are the history's content —
 * `index.search` consent — and a window pages the merged replica instead). */
export const IndexCatalogSubscribeParams = RowsSubscribeParams.extend({
  table: IndexCatalogTable,
}).passthrough();
export type IndexCatalogSubscribeParams = z.infer<typeof IndexCatalogSubscribeParams>;

/** Either table's row, for a reader that holds both in one channel. */
export const IndexCatalogRow = z.union([IndexCatalogProject, IndexCatalogSession]);
export type IndexCatalogRow = z.infer<typeof IndexCatalogRow>;

/** The catalog door's wire, with its rows typed (the base's shapes): the open
 * answer, a `.delta` frame (a heartbeat is one with `since === revision` and
 * a `digest`), and a `.snapshot` page — which also says WHICH page of how
 * many (`page`, `pages`; passthrough over the base) so a reader can assemble
 * pages that arrive out of order. */
export const IndexCatalogOpen = rowsOpen(IndexCatalogRow);
export const IndexCatalogDelta = rowsDelta(IndexCatalogRow);
export const IndexCatalogSnapshotPage = rowsSnapshot(IndexCatalogRow);

/** `index.projects` — a page of projects, newest activity first (the owner's
 * clock; the device, then the id, as tie-breaks), by keyset. `scope` as
 * `index.sessions`' listing; `family` narrows to one repository family. A
 * project is never merged across desktops — identity is `{device, path}` —
 * the family is what groups them. */
export const IndexProjectsParams = z
  .object({
    scope: MeshScope.optional(),
    family: z.string().min(1).max(512).optional(),
    devices: z.array(z.string().min(1).max(256)).min(1).max(64).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .passthrough();
export type IndexProjectsParams = z.infer<typeof IndexProjectsParams>;

export const IndexProjectsResult = z
  .object({
    rows: z.array(IndexCatalogProject),
    cursor: z.string().min(1).optional(),
    sources: z.array(IndexCatalogSource),
  })
  .passthrough();
export type IndexProjectsResult = z.infer<typeof IndexProjectsResult>;

/** `index.changes.subscribe` — invalidation pings for a visible History page:
 * a rows subscription whose rows are always EMPTY and whose revision moves
 * whenever the answering scope's catalog moves (a table on any desktop, or a
 * desktop's standing). A reader re-asks the page it shows; the ping says
 * which `tables` and `devices` moved, as a hint. */
export const IndexChangesSubscribeParams = RowsSubscribeParams.extend({
  scope: MeshScope.optional(),
}).passthrough();
export type IndexChangesSubscribeParams = z.infer<typeof IndexChangesSubscribeParams>;

// ── AR-8b — the History room's reads (thinking-ar-history-room.md §3) ──
//
// What a History view asks that no door answered before: one session's header
// row (`index.session`), a project's panels folded into one answer
// (`index.project`: the heatmap, its decomposition by model and by hour, and
// the per-session contribution), and one day of that project's hours
// (`index.projectDay`, lazy). Every one is `federate` on `index.search` — the
// phone and another desktop read them later through the same doors (SP-6).
//
// rosetta's project aggregates are BEARER-ONLY upstream: a grant never opens
// them (AUTH.md §5.4), so they ride fieldd's doors as control-rate JSON — the
// direct plane below is for one session's bodies. fieldd PARSES each body
// against the snake_case readers here (rosetta's protocol-26 shapes, never
// cast; `.passthrough()` at every level) and answers projections in
// VibeField's spelling. A figure rosetta reports as null (an unpriced cost, a
// bill it never saw) stays null — never zero — and an infinite number is
// refused (`JSON.parse("1e999")` is `Infinity`).

/** True when `day` names a real calendar date, `YYYY-MM-DD` — the spelling
 * rosetta's day routes take (it normalizes through SQLite's `date()` and
 * refuses a day that does not round-trip, so `2026-02-30` is no day). */
function isCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day;
}

/** A calendar day as an ASK names one: `YYYY-MM-DD`, and a date that exists. */
export const IndexCalendarDay = z.string().refine(isCalendarDay, "a calendar day, YYYY-MM-DD");

/** A day as rosetta ANSWERS one (its own bucket label): the spelling, without
 * re-proving the calendar — a tolerant reader does not refuse a body over it. */
const AnsweredDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The hour of a day, 0–23, in the timezone the caller asked for. */
const HourOfDay = z.number().int().min(0).max(23);

/** The minutes EAST of UTC a caller's days are bucketed in (the viewer's
 * `-new Date().getTimezoneOffset()`): −840…840, the range rosetta's day route
 * admits — held to it on every door, so no route is asked what one refuses. */
const OffsetMinutes = z.number().int().min(-840).max(840);

/** rosetta's six usage figures, as fieldd READS them (`HeatmapDay`,
 * `ModelDay`, `HourTotal`, `ContributionRow` all carry them). */
const usageFiguresRow = {
  tokens: z.number().finite(),
  /** list-price cost; null when rosetta could not price the usage */
  cost_micro_usd: z.number().finite().nullish(),
  /** the provider's own bill; null when no record carried one */
  billed_micro_usd: z.number().finite().nullish(),
  unpriced_tokens: z.number().finite(),
  /** records with a prompt and no recorded output: the figure is a lower bound */
  unrecorded_output: z.number().finite(),
  reported_cost_adjustment_micro_usd: z.number().finite(),
};

/** rosetta `HeatmapDay`, as fieldd reads it. */
export const IndexHeatmapDayRow = z.object({ day: AnsweredDay, ...usageFiguresRow }).passthrough();
export type IndexHeatmapDayRow = z.infer<typeof IndexHeatmapDayRow>;

/** rosetta `HeatmapResponse` — the body of `/api/projects/{id}/heatmap`. */
export const IndexHeatmapResponse = z.object({ days: z.array(IndexHeatmapDayRow) }).passthrough();
export type IndexHeatmapResponse = z.infer<typeof IndexHeatmapResponse>;

/** rosetta `ModelDay`: one model's figures on one day (`unknown` when the
 * agent never named its model). */
export const IndexModelDayRow = z
  .object({ day: AnsweredDay, model: z.string(), ...usageFiguresRow })
  .passthrough();
export type IndexModelDayRow = z.infer<typeof IndexModelDayRow>;

/** rosetta `HourTotal`: one hour of the day across the window. */
export const IndexHourTotalRow = z.object({ hour: HourOfDay, ...usageFiguresRow }).passthrough();
export type IndexHourTotalRow = z.infer<typeof IndexHourTotalRow>;

/** rosetta `UsageResponse` — the body of `/api/projects/{id}/usage`: the
 * heatmap's figure decomposed over the same window (the model days sum back to
 * the heatmap's exactly). */
export const IndexUsageResponse = z
  .object({ models: z.array(IndexModelDayRow), hours: z.array(IndexHourTotalRow) })
  .passthrough();
export type IndexUsageResponse = z.infer<typeof IndexUsageResponse>;

/** rosetta `ContributionRow`: one top-level session's whole subagent tree,
 * folded into its root. */
export const IndexContributionRow = z
  .object({
    session_id: z.string().min(1),
    project_id: z.string().nullish(),
    commits: z.number().finite(),
    edits: z.number().finite(),
    loc: z.number().finite(),
    messages: z.number().finite(),
    ...usageFiguresRow,
  })
  .passthrough();
export type IndexContributionRow = z.infer<typeof IndexContributionRow>;

/** rosetta `ContributionResponse` — the body of `/api/projects/{id}/contribution`. */
export const IndexContributionResponse = z
  .object({ rows: z.array(IndexContributionRow) })
  .passthrough();
export type IndexContributionResponse = z.infer<typeof IndexContributionResponse>;

/** rosetta `ModelHour`: one model's tokens in one hour of a day. */
export const IndexModelHourRow = z
  .object({ hour: HourOfDay, model: z.string(), tokens: z.number().finite() })
  .passthrough();
export type IndexModelHourRow = z.infer<typeof IndexModelHourRow>;

/** rosetta `DayUsageResponse` — the body of `/api/projects/{id}/usage/day`. */
export const IndexDayUsageResponse = z
  .object({ day: AnsweredDay, models: z.array(IndexModelHourRow) })
  .passthrough();
export type IndexDayUsageResponse = z.infer<typeof IndexDayUsageResponse>;

/** The six figures in VibeField's spelling — what every door below answers. */
const usageFigures = {
  tokens: z.number().finite(),
  costMicroUsd: z.number().finite().nullable(),
  billedMicroUsd: z.number().finite().nullable(),
  unpricedTokens: z.number().finite(),
  unrecordedOutput: z.number().finite(),
  reportedCostAdjustmentMicroUsd: z.number().finite(),
};

/** One heatmap cell: a day's figures. */
export const IndexHeatmapDay = z.object({ day: AnsweredDay, ...usageFigures }).passthrough();
export type IndexHeatmapDay = z.infer<typeof IndexHeatmapDay>;

/** One model's figures on one day. */
export const IndexModelDay = z
  .object({ day: AnsweredDay, model: z.string(), ...usageFigures })
  .passthrough();
export type IndexModelDay = z.infer<typeof IndexModelDay>;

/** One hour of the day's figures across the window. */
export const IndexHourTotal = z.object({ hour: HourOfDay, ...usageFigures }).passthrough();
export type IndexHourTotal = z.infer<typeof IndexHourTotal>;

/** One session's contribution to its project (rosetta's canonical id). */
export const IndexContribution = z
  .object({
    sessionId: z.string().min(1),
    /** null for a session in rosetta's unassigned bucket */
    projectId: z.string().min(1).nullable(),
    commits: z.number().finite(),
    edits: z.number().finite(),
    loc: z.number().finite(),
    messages: z.number().finite(),
    ...usageFigures,
  })
  .passthrough();
export type IndexContribution = z.infer<typeof IndexContribution>;

/** One model's tokens in one hour of a day. */
export const IndexModelHour = z
  .object({ hour: HourOfDay, model: z.string(), tokens: z.number().finite() })
  .passthrough();
export type IndexModelHour = z.infer<typeof IndexModelHour>;

/** `index.session` — one session's header row, by rosetta's canonical id (the
 * id a catalog row, a hit and a ticket name). `device?` routes it (design-04
 * §6): absent or this desktop's id = this desktop's index. */
export const IndexSessionParams = z
  .object({
    sessionId: z.string().min(1).max(1024),
    device: z.string().min(1).optional(),
  })
  .passthrough();
export type IndexSessionParams = z.infer<typeof IndexSessionParams>;

/** The header a transcript's head draws: `IndexSession`'s columns with the
 * join columns filled (`projectId`, `provider` — the catalog id its runtime's
 * kind maps to —, `startedAt`), plus the session it was delegated from, the
 * persona an enrolled root was filed under, and the project's name. */
export const IndexSessionHeader = IndexSession.extend({
  /** the session this one was delegated from; absent for a top-level session */
  parentSessionId: z.string().min(1).optional(),
  profileId: AgentProfileId.optional(),
  /** absent for a session with no workspace (rosetta's unassigned bucket) */
  project: IndexRecentProject.optional(),
}).passthrough();
export type IndexSessionHeader = z.infer<typeof IndexSessionHeader>;

/** `index.session`'s answer; a session the index does not hold is NOT_FOUND. */
export const IndexSessionResult = z.object({ session: IndexSessionHeader }).passthrough();
export type IndexSessionResult = z.infer<typeof IndexSessionResult>;

/** `index.project` — a project's panels in ONE ask (AR-D39 (a)): the heatmap,
 * its decomposition, the contribution rows. `sinceMs` and `offsetMinutes` are
 * the window the figures cover and the timezone their days are bucketed in —
 * a room asks its 53-week grid's first day and the viewer's offset; absent =
 * rosetta's defaults (every recorded day; UTC). `projectId` is rosetta's
 * opaque id, its unassigned bucket's included. */
export const IndexProjectParams = z
  .object({
    projectId: z.string().min(1).max(256),
    sinceMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    offsetMinutes: OffsetMinutes.optional(),
    device: z.string().min(1).optional(),
  })
  .passthrough();
export type IndexProjectParams = z.infer<typeof IndexProjectParams>;

/** `index.project`'s answer. `clipped` is SP-D13's word: the contribution rows
 * were cut at a tailnet caller's bound (`INDEX_TAILNET_LIMITS.MAX_ROWS`); a
 * window's answer carries every row and says false. */
export const IndexProjectResult = z
  .object({
    projectId: z.string().min(1),
    heatmap: z.array(IndexHeatmapDay),
    usage: z
      .object({ models: z.array(IndexModelDay), hours: z.array(IndexHourTotal) })
      .passthrough(),
    contribution: z.array(IndexContribution),
    clipped: z.boolean(),
  })
  .passthrough();
export type IndexProjectResult = z.infer<typeof IndexProjectResult>;

/** `index.projectDay` — one day of a project's hours, by model (the heatmap's
 * drill-down, asked when a person opens a day). */
export const IndexProjectDayParams = z
  .object({
    projectId: z.string().min(1).max(256),
    day: IndexCalendarDay,
    offsetMinutes: OffsetMinutes.optional(),
    device: z.string().min(1).optional(),
  })
  .passthrough();
export type IndexProjectDayParams = z.infer<typeof IndexProjectDayParams>;

export const IndexProjectDayResult = z
  .object({
    projectId: z.string().min(1),
    day: AnsweredDay,
    models: z.array(IndexModelHour),
  })
  .passthrough();
export type IndexProjectDayResult = z.infer<typeof IndexProjectDayResult>;

// ── the direct plane (SP-3 — the ticket template's SECOND instance;
// thinking-sync-planes.md §5.4, thinking-desktop-sync-plane.md §6.4; the
// handler is DS-7's, at rosetta's pin move) ──
//
// *AR-8b (2026-10-03): the handler is built for a window on THIS desktop —
// rosetta's pin moved to the RO-1 merge (`ee6724e`), fieldd starts rosettad
// with a bearer and a grant key, and `index.openTicket` mints the grant. The
// window dials rosettad's own loopback listener (`IndexEndpointSet` below), so
// the tailnet set and its serve are what DS-7 (another desktop) and SP-6 (the
// phone) still owe.*
//
// A session's transcript is rosetta's own stream, read at the OWNER's rosettad:
// history to a stamp, then the live tail, resumable, with `resync` as the gap
// marker (AR-D7). fieldd publishes rosettad's loopback listener as ONE serve on
// `PORTS.INDEX_SERVE` that proxies the whole listener with nothing stripped
// (the floor's `port` serve kind), so a client dials rosetta's own route at the
// ROOT — and the asset paths a timeline names stay dialable as they stand.
// One leg, `session`: `/ws/sessions/{id}`. rosetta's grant (RO-10) opens that
// route, the session's HTTP pages and the assets — never the lists, search,
// `/ws/meta`, or the live-file read — so an HTTP leg is DS-7's to add if a
// reader needs one, not this slice's to guess. *RO-13 (2026-10-04): a grant
// that carries `files` also opens the session's recorded-file read; fieldd
// mints that scope for the desktop window alone, so a tailnet holder's grant
// still reads no file.*

/** rosetta's session socket route, before the session id. */
export const REMOTE_INDEX_SESSION_PATH_PREFIX = "/ws/sessions/" as const;

/** The path a client dials for one session's socket — the ONLY composer.
 * rosetta's session ids are any text (its own grant vectors carry a quote, a
 * backslash, controls, `/` and non-ASCII), so the id is percent-encoded into
 * ONE segment: a `/` in an id must not become a route for another session. */
export function remoteIndexSessionPath(sessionId: string): string {
  return `${REMOTE_INDEX_SESSION_PATH_PREFIX}${encodeURIComponent(sessionId)}`;
}

/** SP-3 — rosettad's remote endpoint set: ONE leg, `session`, a tailnet
 * `ws://`/`wss://` URL at `/ws/sessions/<id>`, no query, no fragment (the grant
 * rides `Authorization: Rosetta-Grant` or the `rosetta.grant.<grant>`
 * subprotocol, never the URL — rosetta AUTH.md §3). */
export const RemoteIndexEndpointSet = remoteEndpointSet(
  ["session"],
  remoteDoorUrl("wss?", String.raw`\/ws\/sessions\/[^/?#\s]+`),
  "a tailnet ws:// rosetta session URL without query/fragment",
);
export type RemoteIndexEndpointSet = z.infer<typeof RemoteIndexEndpointSet>;

/** Compose one session's set from the index serve's own base URL (truffle's
 * `ProxyInfo.url`, e.g. `http://host.ts.net:9424`); `undefined` when the base
 * is unusable or the session id is empty — never a URL nothing can dial. */
export function remoteIndexEndpointsFor(
  serveBaseUrl: string,
  sessionId: string,
): RemoteIndexEndpointSet | undefined {
  if (sessionId.length === 0 || !isWellFormedText(sessionId)) return undefined;
  return composeRemoteEndpoints(RemoteIndexEndpointSet, serveBaseUrl, {
    session: remoteIndexSessionPath(sessionId),
  });
}

/** AR-8b — a lone UTF-16 surrogate is not text: `encodeURIComponent` throws on
 * it (URIError) and rosetta's grant refuses it (RFC 8785 §3.1), so neither
 * composer builds a URL for it — they answer undefined, never throw. */
function isWellFormedText(text: string): boolean {
  return !/\p{Cs}/u.test(text);
}

/** The loopback port a set may name: 1–65535, no leading zero. */
const LOOPBACK_PORT = String.raw`(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])`;
const LOOPBACK_INDEX_SESSION = new RegExp(
  String.raw`^ws:\/\/127\.0\.0\.1:${LOOPBACK_PORT}\/ws\/sessions\/[^/?#\s]+$`,
);
const LOOPBACK_INDEX_ORIGIN = new RegExp(String.raw`^http:\/\/127\.0\.0\.1:${LOOPBACK_PORT}$`);

/** AR-8b — rosettad's LOOPBACK set: its own listener as a window on THIS
 * desktop dials it. Beside `RemoteIndexEndpointSet` exactly as the cell's
 * `CellEndpointSet` stands beside `RemoteCellEndpointSet` — disjoint by host
 * class (D36), never a widening of the remote shape, which still refuses
 * loopback. Two legs in the template's spelling:
 *  - `session`: rosetta's socket for the session, `ws://127.0.0.1:<port>
 *    /ws/sessions/<id>` (the id one percent-encoded segment);
 *  - `rest`: the daemon's origin, `http://127.0.0.1:<port>` — the base a
 *    `RosettaClient` takes, under which the grant opens the session's pages and
 *    the assets its timeline names (AUTH.md §5.4), and nothing else.
 * Exactly `127.0.0.1` with a port, because that is the only origin the
 * supervisor accepts from the daemon (`loopbackOrigin`). No query, no
 * fragment: the grant rides `Authorization: Rosetta-Grant` or the
 * `rosetta.grant.<grant>` subprotocol, never a URL. */
export const IndexEndpointSet = z
  .object({
    sessionUrl: z
      .string()
      .regex(LOOPBACK_INDEX_SESSION, "a loopback ws:// rosetta session URL without query/fragment"),
    restUrl: z.string().regex(LOOPBACK_INDEX_ORIGIN, "rosettad's loopback http origin, no path"),
  })
  .passthrough();
export type IndexEndpointSet = z.infer<typeof IndexEndpointSet>;

/** What a ticket's `endpoints` may be: the loopback set for a window here, the
 * tailnet set for a caller across the tailnet (DS-7 / SP-6). Which one a caller
 * gets is decided by its principal at mint time and by nothing on the wire. */
export const IndexTicketEndpointSet = z.union([IndexEndpointSet, RemoteIndexEndpointSet]);
export type IndexTicketEndpointSet = z.infer<typeof IndexTicketEndpointSet>;

/** Compose one session's loopback set from rosettad's origin (the supervisor's
 * `RosettadState.origin` while ready); `undefined` — never a URL nothing can
 * dial — for anything that is not `http://127.0.0.1:<port>` exactly, or an
 * empty session id. The path is the one composer's (`remoteIndexSessionPath`:
 * rosetta's own route, the same at the root of either listener). */
export function indexEndpointsFor(origin: string, sessionId: string): IndexEndpointSet | undefined {
  if (sessionId.length === 0 || !isWellFormedText(sessionId)) return undefined;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    return undefined;
  const parsed = IndexEndpointSet.safeParse({
    sessionUrl: `ws://127.0.0.1:${url.port}${remoteIndexSessionPath(sessionId)}`,
    restUrl: `http://127.0.0.1:${url.port}`,
  });
  return parsed.success ? parsed.data : undefined;
}

/** `index.openTicket`'s params: the session whose transcript to open, at the
 * device that holds it. `device` is the `device?` convention (design-04 §6):
 * absent or this desktop's own id = this desktop's rosettad; a foreign id
 * forwards the call WHOLE to the owner (the method is `federate`), which
 * answers from its own rule. */
export const IndexOpenTicketParams = z
  .object({
    sessionId: z.string().min(1),
    device: z.string().min(1).optional(),
  })
  .passthrough();
export type IndexOpenTicketParams = z.infer<typeof IndexOpenTicketParams>;

/** The door's two CAPABILITY refusals, as a reader recognizes them
 * (`INDEX_TICKET`, registries.ts — `UnavailableDetails`, retryable false): the
 * half of the plane this desktop does not serve yet, and the plane switched
 * off. A daemon that is merely not ready answers the index's phase instead
 * (`{service: "index", state: "starting" | …}`, retryable), which is not this. */
export const IndexTicketUnavailableDetails = z
  .object({
    service: z.literal(INDEX_TICKET.SERVICE),
    state: z.enum([INDEX_TICKET.STATE_UNBUILT, INDEX_TICKET.STATE_OFF]),
  })
  .passthrough();
export type IndexTicketUnavailableDetails = z.infer<typeof IndexTicketUnavailableDetails>;

/**
 * SP-3 — what `index.openTicket` answers: the template's ticket anatomy
 * (`TerminalOpenTicket`'s) for rosettad — the endpoint set and, BESIDE it, the
 * one grant rosetta verifies. *AR-8b (2026-10-03): ANSWERED, for a window on
 * this desktop — `endpoints` is the loopback set (`index-open-ticket.local.json`
 * is its golden); the tailnet set (`index-open-ticket.valid.json`) stays
 * DS-7's and SP-6's, which may amend it, golden and all.*
 *
 *  - `device`: the desktop whose rosettad holds the session — the cache key's
 *    first part (`{device, session, stamp}`, thinking-sync-planes §5.4).
 *  - `endpoints`: `IndexTicketEndpointSet` — the loopback pair for a window,
 *    the tailnet `session` leg for a caller across the tailnet.
 *  - `grant`: rosetta's RO-10 grant, OPAQUE to a client —
 *    `base64url(JCS {cid, exp, scope, sid, v}) "." base64url(HMAC-SHA256)`,
 *    exact `sid`, `scope` by who asked (rosetta AUTH.md §5; at most 4,096
 *    bytes, its verifier's bound). *RO-13 (2026-10-04): this said
 *    `scope: ["read"]`; the desktop window's grant now carries
 *    `["read", "files"]` — `files` opens the session's recorded-file read
 *    (AUTH.md §5.4) — and every other holder's `["read"]` (fieldd's
 *    `indexTicketScopes`). The shape here is unchanged: the grant stays
 *    opaque.* Carried as `Authorization: Rosetta-Grant <grant>`
 *    or, from a browser, the subprotocol pair `rosetta`, `rosetta.grant.<grant>`
 *    — never in the URL. (§5.4, written before RO-10 was built, called it
 *    `transportGrant` after the cell's; rosetta's is one per-session string,
 *    nearer the cell's attach grant, so it is `grant`.)
 *  - `expiresAt`: the grant's `exp` (ms, the owner's clock) — an ESTABLISHMENT
 *    deadline, as the cell's is: an open socket is not re-checked and outlives
 *    it (AUTH.md §3); a reconnect after it asks for a fresh ticket. AR-8b:
 *    minted `INDEX_TICKET.TTL_MS` ahead, and every answer is a fresh grant.
 */
export const IndexOpenTicket = z
  .object({
    device: z.string().min(1),
    endpoints: IndexTicketEndpointSet,
    grant: z.string().min(1).max(4096),
    expiresAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type IndexOpenTicket = z.infer<typeof IndexOpenTicket>;

// ── agents.* (the distribution and persona doors; handlers land at AR-2 with
// puppeteer's first import — these rows are the contract they will satisfy) ──

/** A persona (puppeteer `AgentProfile`, mirrored WITHOUT `dataRoot` — the
 * path is fieldd's; a client names a persona by id). `identity` is what the
 * provider's own status surface said at the last verify; it never carries a
 * token. `runtimeId` is the index join once the persona's root is enrolled.
 * AR-S2: a persona is one agent's sign-in inside an Agent Profile (`set`);
 * `folder` is where its data lives, home-abbreviated, for a person to READ —
 * display only: Show in Finder names the persona, never the path, and no door
 * takes a path back. `signingIn` is present while its login pane is open
 * (the pane's floor session and when it opened), so every window can say so
 * and the one that opened it can show it. */
/** puppeteer `SignInService`, mirrored: the company a sign-in is billed
 * through ("Anthropic"), never the agent. The id is shared across agents so
 * two agents' sign-ins to one company are known to be one; OPEN (AR-L1). */
export const AgentSignInService = z
  .object({ id: z.string().min(1).max(64), label: z.string().min(1).max(64) })
  .passthrough();
export type AgentSignInService = z.infer<typeof AgentSignInService>;

/** puppeteer `ProfileSignIn`, mirrored: one sign-in a folder holds, for an
 * agent whose folder holds several (Pi, OpenCode, Hermes). Who and which plan
 * appear only when the agent itself reported them; never a token.
 * `borrowedFrom` names the program whose sign-in it is when the folder holds
 * none of its own (the machine's account, not the profile's). */
export const AgentSignIn = z
  .object({
    service: AgentSignInService,
    method: z.string(),
    subscription: z.boolean().optional(),
    inUse: z.boolean().optional(),
    email: z.string().optional(),
    account: z.string().optional(),
    organization: z.string().optional(),
    plan: z.string().optional(),
    borrowedFrom: z.string().optional(),
  })
  .passthrough();
export type AgentSignIn = z.infer<typeof AgentSignIn>;

/** puppeteer `ProfileHolding`, mirrored (AR-S2c): one sign-in a persona holds,
 * placed on its profile's plans — a vendor agent's one sign-in is made from
 * its identity. `key` is a pay-per-use key, on no plan; `planId` names the
 * set's plan it is on; `runsOn` the one the agent runs on. */
export const AgentHolding = AgentSignIn.extend({
  method: z.string().optional(),
  key: z.boolean(),
  planId: z.string().optional(),
  runsOn: z.boolean(),
}).passthrough();
export type AgentHolding = z.infer<typeof AgentHolding>;

/** puppeteer `ProfilePlan`, mirrored (AR-S2c): one plan an Agent Profile runs
 * on, read from its sign-ins — never stored, never matched by a person.
 * `account` is whose it is when an agent in the profile named it; `namedBy`
 * the persona that named it (the plan's usage is that persona's reading);
 * `holders` the personas with a sign-in on it; `alsoIn` the other profiles
 * with the same account (or on the same borrowed sign-in). */
export const AgentPlan = z
  .object({
    id: z.string().min(1).max(80),
    service: AgentSignInService,
    account: z
      .object({
        email: z.string().optional(),
        account: z.string().optional(),
        organization: z.string().optional(),
        plan: z.string().optional(),
      })
      .passthrough()
      .optional(),
    namedBy: AgentProfileId.optional(),
    borrowedFrom: z.string().optional(),
    holders: z.array(AgentProfileId),
    alsoIn: z.array(AgentProfileSetId),
  })
  .passthrough();
export type AgentPlan = z.infer<typeof AgentPlan>;

/** puppeteer `ProfileSignInRoute`, mirrored: one way to add a sign-in to a
 * folder that holds several — the agent's own login, named as a menu item. */
export const AgentSignInRoute = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    label: z.string().min(1).max(64),
    service: AgentSignInService.optional(),
  })
  .passthrough();
export type AgentSignInRoute = z.infer<typeof AgentSignInRoute>;

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
        /** a non-email handle (a GitHub login); shown before the email */
        account: z.string().optional(),
        organization: z.string().optional(),
        plan: z.string().optional(),
        borrowedFrom: z.string().optional(),
        /** every sign-in, for an agent whose folder holds several; the fields
         * above then repeat the one in use */
        signIns: z.array(AgentSignIn).optional(),
        verifiedAt: z.string(),
      })
      .passthrough()
      .optional(),
    runtimeId: z.string().optional(),
    set: AgentProfileSetId.optional(),
    folder: z.string().optional(),
    signingIn: z.object({ sessionId: z.string(), since: z.string() }).passthrough().optional(),
    /** on the profiles feed only (AR-S2c): what it holds, on its set's plans */
    holds: z.array(AgentHolding).optional(),
  })
  .passthrough();
export type AgentPersona = z.infer<typeof AgentPersona>;

export const AgentsProfilesListResult = z.object({ personas: z.array(AgentPersona) }).passthrough();
export type AgentsProfilesListResult = z.infer<typeof AgentsProfilesListResult>;

/** `agents.profiles.create` — sign an agent into an Agent Profile: its root
 * is allocated inside the profile's folder (AR-D24) and registered, empty
 * until the login pane runs. A profile holds one sign-in per agent; the
 * native set ("This Mac") is the agents' own folders and takes none. */
export const AgentsProfilesCreateParams = z
  .object({ set: AgentProfileSetId, provider: AgentProviderId })
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

/** `agents.profiles.delete` — SIGN OUT (AR-D25). A managed sign-in leaves its
 * profile at once, and is FINISHED when no session runs under it any more —
 * now, or when the last one ends: the vendor's own sign-out where the
 * credential lives outside the root, the index runtime retired (rows kept,
 * AR-D19), the root deleted, the persona unregistered. `waiting` counts the
 * sessions it is waiting on. A native default ("This Mac") is signed out by
 * the vendor's own command in the agent's own folder, which is never deleted;
 * a provider without one is refused (PRECONDITION_FAILED). */
export const AgentsProfilesDeleteResult = z
  .object({
    deleted: z.boolean(),
    waiting: z.number().int().nonnegative().optional(),
    /** What the sign-out does to the credential, from the adapter's own
     * declaration: `signed-out` — the vendor's command removes it (run now, or
     * when the sessions end); `in-folder` — it lives in the folder that goes;
     * `unknown` — where the agent keeps it is not established, so the folder
     * going is all that is claimed. */
    credential: z.enum(["signed-out", "in-folder", "unknown"]).optional(),
  })
  .passthrough();
export type AgentsProfilesDeleteResult = z.infer<typeof AgentsProfilesDeleteResult>;

/** `agents.profiles.verify` — the persona with the identity the provider's own
 * status surface reported (persisted), or the persona unchanged beside the
 * adapter's honest failure to learn one. */
export const AgentsProfilesVerifyResult = z
  .object({ persona: AgentPersona, failure: AgentProfileFailure.optional() })
  .passthrough();
export type AgentsProfilesVerifyResult = z.infer<typeof AgentsProfilesVerifyResult>;

// ── agents.profileSets.* (AR-S2 — Agent Profiles; AR-D23…D25) ──
//
// An Agent Profile is puppeteer's profile SET: a named place ("Work") holding
// at most one sign-in per agent, one folder under this user
// (`agents/profiles/<set>/`), and a mark. "This Mac" is the synthetic native
// set — each agent's own folder (`~/.claude`, …), shared by every VibeField
// user of this Mac because it is the OS user's (UA-D6). One set is the
// default: a spawn that names no persona runs under the default set's sign-in
// for its agent, else the agent's own folder. VibeField adds no grouping of
// its own; these doors mirror the registry.

/** One Agent Profile. `glyph` is an open token the views draw (puppeteer
 * `ProfileGlyph`); the native set draws the laptop whatever it says.
 * `folder` is display only (home-abbreviated), like a persona's. `personas`
 * are its sign-ins — for the native set, every agent's own folder whose
 * identity has been read, signed in or not. */
export const AgentProfileSet = z
  .object({
    id: AgentProfileSetId,
    kind: z.enum(["native", "managed"]),
    label: z.string().min(1).max(64),
    glyph: z.string().optional(),
    default: z.boolean(),
    createdAt: z.string(),
    folder: z.string().optional(),
    personas: z.array(AgentPersona),
    /** AR-S2c: the plans it runs on, in the order its agents first hold them
     * (puppeteer's `profileSetPlans`); absent from an older fieldd */
    plans: z.array(AgentPlan).optional(),
  })
  .passthrough();
export type AgentProfileSet = z.infer<typeof AgentProfileSet>;

/** `agents.profileSets.list` and every `agents.profileSets.subscribe` frame
 * (full snapshots at the tick). Each set carries the plans it runs on and each
 * of its personas what it holds (AR-S2c); `routes` names the ways to add a
 * sign-in to an agent whose folder holds several. `signIn` names the providers whose adapter
 * can run a sign-in in a folder here — the "Add agent…" menu's candidates
 * before installs are joined. `identity` names those whose adapter can also
 * read back WHO signed in; a sign-in of any other is known to be there, never
 * whose it is, so a page says exactly that. `signOut` names those whose
 * adapter signs a folder out with the vendor's own command: a sign-in in a
 * profile can always be signed out (its folder goes), one in This Mac only
 * where that command exists. `reading` is true while fieldd is reading the
 * agents' own folders' identities (This Mac's rows fill in as each lands).
 * `refresh: true` reads them again. */
export const AgentsProfileSetsListParams = z
  .object({ refresh: z.boolean().optional() })
  .passthrough();
export type AgentsProfileSetsListParams = z.infer<typeof AgentsProfileSetsListParams>;

export const AgentsProfileSetsListResult = z
  .object({
    sets: z.array(AgentProfileSet),
    signIn: z.array(AgentProviderId),
    identity: z.array(AgentProviderId),
    signOut: z.array(AgentProviderId),
    reading: z.boolean(),
    /** AR-S2c: the ways to add a sign-in, per agent whose folder holds
     * several (puppeteer `support.signInRoutes`); an agent absent here has
     * one login, the default */
    routes: z.record(AgentProviderId, z.array(AgentSignInRoute)).optional(),
  })
  .passthrough();
export type AgentsProfileSetsListResult = z.infer<typeof AgentsProfileSetsListResult>;

/** A glyph token (puppeteer `ProfileGlyphSchema`, mirrored). */
export const AgentProfileGlyph = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/** `agents.profileSets.create` — a new, empty Agent Profile and its folder;
 * `default: true` also makes it the one new sessions use. */
export const AgentsProfileSetsCreateParams = z
  .object({
    label: z.string().trim().min(1).max(64),
    glyph: AgentProfileGlyph.optional(),
    default: z.boolean().optional(),
  })
  .passthrough();
export type AgentsProfileSetsCreateParams = z.infer<typeof AgentsProfileSetsCreateParams>;

export const AgentsProfileSetsSetResult = z.object({ set: AgentProfileSet }).passthrough();
export type AgentsProfileSetsSetResult = z.infer<typeof AgentsProfileSetsSetResult>;

/** `agents.profileSets.update` — rename (the folder keeps its name: a path
 * is what a sign-in is keyed on), change the glyph, or make this the default
 * (`default: true`; there is always exactly one default, so it only ever moves
 * TO a profile). The native set takes only `default`. */
export const AgentsProfileSetsUpdateParams = z
  .object({
    set: AgentProfileSetId,
    label: z.string().trim().min(1).max(64).optional(),
    glyph: AgentProfileGlyph.optional(),
    default: z.literal(true).optional(),
  })
  .passthrough();
export type AgentsProfileSetsUpdateParams = z.infer<typeof AgentsProfileSetsUpdateParams>;

/** `agents.profileSets.delete` — the record's P7 act: the sessions running
 * under it stop first (`stopped` counts them), every sign-in in it is signed
 * out, the profile is unregistered and its folder deleted. Refused for the
 * native set and for the default (PRECONDITION_FAILED: make another the
 * default first). */
export const AgentsProfileSetsDeleteParams = z.object({ set: AgentProfileSetId }).passthrough();
export type AgentsProfileSetsDeleteParams = z.infer<typeof AgentsProfileSetsDeleteParams>;

export const AgentsProfileSetsDeleteResult = z
  .object({ deleted: z.boolean(), stopped: z.number().int().nonnegative() })
  .passthrough();
export type AgentsProfileSetsDeleteResult = z.infer<typeof AgentsProfileSetsDeleteResult>;

/** `agents.profileSets.reveal` — Show in Finder for a profile's folder, or for
 * one agent's folder in it (`provider`; in the native set, the agent's own
 * folder). Named by ids: fieldd resolves the path it holds. */
export const AgentsProfileSetsRevealParams = z
  .object({ set: AgentProfileSetId, provider: AgentProviderId.optional() })
  .passthrough();
export type AgentsProfileSetsRevealParams = z.infer<typeof AgentsProfileSetsRevealParams>;

export const AgentsProfileSetsRevealResult = z.object({ revealed: z.boolean() }).passthrough();
export type AgentsProfileSetsRevealResult = z.infer<typeof AgentsProfileSetsRevealResult>;

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
