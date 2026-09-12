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

/** `index.status` — the whole honest picture in one read: the folded phase,
 * the daemon projection, the record, and every runtime the daemon lists
 * (empty until the daemon is ready). */
export const IndexStatus = z
  .object({
    phase: IndexPhase,
    rosettad: IndexDaemonHealth,
    enrollment: IndexEnrollmentSummary,
    runtimes: z.array(IndexRuntimeStatus),
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
    active: z.boolean(),
  })
  .passthrough();
export type AgentInstall = z.infer<typeof AgentInstall>;

export const AgentsInstallsResult = z.object({ installs: z.array(AgentInstall) }).passthrough();
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

export const AgentsReleasesResult = z
  .object({ releases: z.array(z.union([AgentRelease, AgentReleaseFailure])) })
  .passthrough();
export type AgentsReleasesResult = z.infer<typeof AgentsReleasesResult>;

export const AgentsUpdateParams = z.object({ provider: AgentProviderId }).passthrough();
export type AgentsUpdateParams = z.infer<typeof AgentsUpdateParams>;

/** puppeteer `UpdateReceipt`, mirrored: the vendor's own updater ran (or
 * could not); the transcript stays under `machine/agents/updates/`. */
export const AgentUpdateReceipt = z
  .object({
    provider: AgentProviderId,
    status: z.enum(["updated", "already-current", "failed", "unsupported"]),
    startedAt: z.string(),
    finishedAt: z.string(),
    exitCode: z.number().int().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type AgentUpdateReceipt = z.infer<typeof AgentUpdateReceipt>;

export const AgentsUpdateResult = z.object({ receipt: AgentUpdateReceipt }).passthrough();
export type AgentsUpdateResult = z.infer<typeof AgentsUpdateResult>;

export const AgentsSetActiveParams = z
  .object({ provider: AgentProviderId, executable: z.string().min(1) })
  .passthrough();
export type AgentsSetActiveParams = z.infer<typeof AgentsSetActiveParams>;

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
