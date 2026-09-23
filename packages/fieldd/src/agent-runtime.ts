import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { SessionExitedEvent } from "@vibecook/ghosttea-client";
import type { BuiltinProviderOptions } from "@vibecook/puppeteer-builtin-providers";
import { createBuiltinProviders } from "@vibecook/puppeteer-builtin-providers";
import type {
  AgentContinuation,
  AgentHost,
  AgentInstallation,
  AgentMonitorState,
  AgentProfile,
  BoundIngress,
  HostIngress,
  ProfileFailure,
  UpdateReceipt,
} from "@vibecook/puppeteer-core";
import {
  type Agent,
  type AgentProvider,
  type AgentRuntime,
  type AgentRuntimeOptions,
  type AgentSessionFailure,
  type AgentSessionInfo,
  type AgentWorkspaceRequest,
  type CreateAgentSessionResult,
  type CreationRequestRegistry,
  createAgentRuntime,
  createFileCreationRequestRegistry,
  type ProfileStore,
  parseProfileRegistrySnapshot,
  type SpawnAgentResult,
} from "@vibecook/puppeteer-runtime";
import {
  AGENT_CATALOG,
  AGENT_DISTRIBUTION_FORMAT,
  type AgentCapability,
  type AgentCatalogEntry,
  type AgentCatalogReaders,
  type AgentCatalogResult,
  type AgentDistributionRecord,
  AgentDistributionRecord as AgentDistributionRecordSchema,
  type AgentHistoryState,
  type AgentInstall,
  type AgentInterruptParams,
  type AgentInterruptResult,
  type AgentListResult,
  type AgentMonitorMirror,
  type AgentPersona,
  type AgentProfileFailure,
  type AgentProviderSummary,
  type AgentProvidersResult,
  type AgentResumeParams,
  type AgentSessionRecord,
  type AgentSessionSummary,
  type AgentSpawnParams,
  type AgentSpawnResult,
  type AgentSurface,
  type AgentsInstallsResult,
  type AgentsProfilesCreateParams,
  type AgentsProfilesCreateResult,
  type AgentsProfilesDeleteResult,
  type AgentsProfilesListResult,
  type AgentsProfilesLoginParams,
  type AgentsProfilesLoginResult,
  type AgentsProfilesVerifyResult,
  type AgentsReleasesParams,
  type AgentsReleasesResult,
  type AgentsSetActiveParams,
  type AgentsSetActiveResult,
  type AgentsUpdateResult,
  type AgentUpdateReceipt,
  createAgentCatalogReaders,
  LAYOUT,
  type TerminalInfo,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { withUsersLock } from "@vibefield/users";
import { createTerminalAgentHost, type TerminalAgentHost } from "./agent-host";
import type { EnrollRuntimeSpec, IndexService } from "./agent-index";
import {
  foldStatus,
  mirrorOf,
  recordForRun,
  SessionRecordStore,
  summarizeExitedRecord,
  summarizeManaged,
  summarizePending,
} from "./agent-sessions";
import type { AccountUsageRuntime } from "./agent-usage";
import type { AuditMutation, AuditMutationOutcome } from "./audit-service";
import { RpcCallError } from "./native-link";
import type { RosettadState, RosettadSupervisor } from "./rosettad-supervisor";
import type { GrantPrincipal } from "./terminal-grants";
import type { TerminalService } from "./terminal-service";

// The agent runtime THROUGH fieldd (AR-2; thinking-ar-data-topology.md §2–§4,
// AR-D15/D16/D19/D22): puppeteer's first import. One runtime per fieldd, built
// from puppeteer's built-in providers with everything it would otherwise keep
// under `~/.puppeteer` injected from THIS user's root (PU-8: fieldd owns every
// byte, puppeteer every schema) — the profile registry at
// `users/<fuid>/agents/profiles.json`, managed roots under
// `users/<fuid>/agents/roots/<provider>/<uuid>`, update transcripts under the
// machine scope `machine/agents/updates/`.
//
// The persona path (topology §4 "Persona create"): a persona IS a puppeteer
// profile; creating one allocates its immutable root and registers it, and
// fieldd then enrolls the root the provider's OWN layout applies to —
// `observationRoot(profile)` (PU-7), never `dataRoot`, which differs for pi and
// OpenCode — in this user's enrollment record under the KIND rosetta's roll
// call joins it to. Deleting one stops its sessions, retires the runtime
// (rows kept, AR-D19), unregisters the profile and deletes the root with its
// credentials. Every daemon ready re-applies the record to the personas (R4),
// so a persona made while the index was down is indexed at the next ready.
//
// The machine scope (AR-D15/D16, R2/R6): `machine/agents/distribution.json` is
// the ONLY product state outside a user root — which executable new spawns use
// per provider, the release-check preferences, the last update receipt —
// rewritten under the root lock and published atomically. A daemon booted
// without a VibeField root above its user root (an embedded or unit daemon)
// has no machine scope and says so at the doors that would write it.
//
// MANAGED SESSIONS (AR-3; thinking-ar-agent-plane.md §0/§7/§9 as ruled
// 2026-09-12): the runtime is lent the floor — `agent-host.ts` is puppeteer's
// AgentHost over the agent cell, every agent PTY born with a clean allow-listed
// environment (EL7) — and this service is the FOLD: it subscribes to
// puppeteer's monitor projection, joins it with the floor's inventory and
// projects one SessionSummary v2 row per run (`agent.list`/`agent.subscribe`,
// full snapshots, one frame per tick). Each spawn persists its opaque
// continuation beside the launch facts (`agents/sessions/<run>.json`) so an
// exited session resumes from the record (`agent.resume`) and AR-4 can
// re-attach across a fieldd restart. The floor's `session-exited` is
// puppeteer's `handleProcessExit`; the inventory diff is the backstop.
//
// STABLE INGRESS (AR-4; PU-1 upstream as landed 2026-09-12; AR-D6 as
// amended): a managed session OUTLIVES fieldd. Every birth names a creation
// request (puppeteer's durable claim under `agents/runs/`) and gives the
// adapter a say over its loopback ingress, whose bound port and bearer the
// record keeps; a graceful stop RELEASES the runs (`dispose({detach})` — no
// exit dispatched, the claims kept) and the next boot's FIRST inventory is
// the re-attach: every un-exited record whose PTY the floor still lists is
// attached at its next epoch through the provider's own `attachSession`
// (the bridge re-bound to the pinned port, the transcript located). A
// provider that cannot attach — or a record from before AR-4 — leaves the
// run in the fold as a PENDING row (live, unobserved, resumable) that
// resume-when-idle replaces: once the index says the conversation has been
// still long enough, the old PTY is terminated and the continuation resumed
// into a new run in a new PTY, the row naming the PTY it replaced so the
// deck can hand the pane over. `agent.resume` on a pending run is the same
// replacement by hand. A record whose PTY did NOT survive is stamped as an
// unknown exit and resumes from the door like any other.
//
// What the doors never carry: a persona's root (a client names a persona by
// id; where fieldd keeps its root is fieldd's business), the daemon's origin
// (EL7), an update transcript (opaque, 0600, machine scope), a continuation's
// state (opaque, persisted, never projected), an agent's argv or environment.

/** puppeteer's persisted registry (`ProfileRegistrySnapshot` — its schema) in
 * fieldd's custody: 0600, temp + durable rename, the directory 0700. An
 * unreadable file is set aside for a human and the registry starts empty —
 * never silently overwritten (its entries name credential roots), never a
 * boot failure (the personas are one feature, not the daemon). */
export function createProfileStore(opts: { path: string; logger: Logger }): ProfileStore {
  return {
    async load() {
      let text: string;
      try {
        text = readFileSync(opts.path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      try {
        return parseProfileRegistrySnapshot(JSON.parse(text));
      } catch (error) {
        const aside = `${opts.path}.unreadable-${Date.now()}`;
        opts.logger.error(
          "fieldd.agents.profiles_unreadable",
          "Persona registry is unreadable; set aside, starting from an empty registry",
          error,
          { aside },
        );
        try {
          renameSync(opts.path, aside);
        } catch {
          // the next save overwrites it
        }
        return undefined;
      }
    },
    async save(snapshot) {
      mkdirSync(dirname(opts.path), { recursive: true, mode: 0o700 });
      const tmp = `${opts.path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      durableRenameSync(tmp, opts.path);
    },
  };
}

function emptyDistributionRecord(now: () => Date): AgentDistributionRecord {
  return { format: AGENT_DISTRIBUTION_FORMAT, providers: {}, updatedAt: now().toISOString() };
}

/** `machine/agents/distribution.json` (AR-D16): read tolerantly by anyone,
 * written by ONE writer at a time under the root lock (R6), published
 * atomically. Reads re-read the file every time — a resident fieldd's
 * "refresh" is simply the next read; no watcher is needed to be current. */
export class DistributionRecordStore {
  constructor(private readonly opts: { rootReal: string; now: () => Date; logger: Logger }) {}

  path(): string {
    return join(this.opts.rootReal, ...LAYOUT.MACHINE_DISTRIBUTION_FILE);
  }

  updatesDir(): string {
    return join(this.opts.rootReal, ...LAYOUT.MACHINE_UPDATES_DIR);
  }

  read(): AgentDistributionRecord {
    let text: string;
    try {
      text = readFileSync(this.path(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return emptyDistributionRecord(this.opts.now);
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = AgentDistributionRecordSchema.safeParse(parsed);
    if (record.success) return record.data;
    const aside = `${this.path()}.unreadable-${Date.now()}`;
    this.opts.logger.error(
      "fieldd.agents.distribution_unreadable",
      "Distribution record is unreadable; set aside, starting from an empty record",
      undefined,
      { aside, issue: record.error.issues[0]?.message ?? "invalid json" },
    );
    try {
      renameSync(this.path(), aside);
    } catch {
      // the next publish overwrites it
    }
    return emptyDistributionRecord(this.opts.now);
  }

  /** Read-modify-write under the root lock. `fn` returns whether it changed
   * anything; unchanged records are not rewritten. */
  async mutate(
    fn: (record: AgentDistributionRecord) => boolean,
  ): Promise<{ changed: boolean; record: AgentDistributionRecord }> {
    return await withUsersLock(this.opts.rootReal, "mutate", {}, () => {
      const record = this.read();
      const changed = fn(record);
      if (changed) {
        record.updatedAt = this.opts.now().toISOString();
        this.publish(record);
      }
      return { changed, record };
    });
  }

  private publish(record: AgentDistributionRecord): void {
    mkdirSync(dirname(this.path()), { recursive: true, mode: 0o700 });
    const tmp = `${this.path()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    durableRenameSync(tmp, this.path());
  }
}

/** A host that lends no terminal: the typed refusal an embedded or unit
 * daemon answers with (AR-2's posture, kept for the seams that build the
 * service without a floor). Production lends the floor (`agent-host.ts`). */
export function noTerminalHost(): AgentHost {
  return {
    async spawnTerminal() {
      throw new RpcCallError(
        "UNAVAILABLE",
        "agent terminals are not hosted: this daemon lends no terminal floor",
        false,
        { service: "agents", state: "no-terminal-host" },
      );
    },
    async automateTerminal() {
      return { accepted: false, reason: "no-terminal-host" };
    },
  };
}

/** PF5 — one fold frame per tick per subscriber, trailing-edge. */
const PUBLISH_TICK_MS = 16;
/** The inventory backstop's grace: a PTY that left the inventory is closed
 * as an unknown exit only after the floor's own `session-exited` — which
 * carries the real outcome and code — has had one bounded turn to arrive
 * (puppeteer's Godview keeps the same grace for its PID poller). */
const EXIT_GRACE_MS = 1_500;
/** A login pane left open indefinitely still gets one verification. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;
/** AR-4 — resume-when-idle. A pending run (a live PTY this boot could not
 * re-attach to) is resumed into a new run once the index says its
 * conversation has been still for `RESUME_IDLE_AFTER_MS`, asked every
 * `RESUME_POLL_MS`; the PTY it replaces is given `REPLACE_GRACE_MS` to leave
 * the inventory before the new run is born — two processes on one native
 * session is the one thing a resume must never make. */
const RESUME_IDLE_AFTER_MS = 30_000;
/** AC-3 — how long an enrollment waits for a ready daemon's first census
 * (the roll call fills in behind the ready line); the ready-time reconcile
 * and a persona create both wait, a door that only reports waits briefly */
const ROLL_CALL_WAIT_MS = 30_000;
const HISTORY_STATE_WAIT_MS = 3_000;
const RESUME_POLL_MS = 5_000;
const REPLACE_GRACE_MS = 5_000;
/** AR-4b — the idle poll backs off while the index cannot answer (doubling
 * per unanswered poll, capped), and returns to its cadence on the first answer. */
const RESUME_POLL_MAX_MS = 60_000;
/** AR-4b — a stop waits this long for a replacement in flight (the old PTY
 * already terminated, its successor not yet born) before releasing the rest. */
const DISPOSE_REPLACEMENT_WAIT_MS = 10_000;

/** The audit ledger's system-actor entry (`AuditService.requiredSystem`):
 * the daemon's own acts — a re-attach at boot, a resume-when-idle — are
 * mutations of a session a person will want to find in the ledger. */
export type SystemAudit = <T>(
  mutation: AuditMutation,
  effect: () => Promise<T>,
  describeOutcome?: (value: T) => AuditMutationOutcome,
) => Promise<T>;

export interface AgentRuntimeServiceOptions {
  /** this user's root (`FielddConfig.dataDir`): the registry, the managed roots and the session records live under it */
  userRoot: string;
  /** the VibeField root above it — the machine scope; null = none (embedded/unit daemons) */
  vibefieldRoot: string | null;
  index: IndexService;
  /** the index daemon's supervisor, for the reconcile on every ready; null = no daemon */
  supervisor: RosettadSupervisor | null;
  /** AR-3 — the terminal service the host spawns through, LATE-BOUND (the
   * daemon builds the runtime before the floor's service); null = no floor,
   * and every spawn refuses typed. Ignored when `host` is given. */
  terminals?: () => TerminalService | null;
  /** test seam: a host of the caller's own (AR-2's typed refusal, a fake) */
  host?: AgentHost;
  /** the device the fold's rows live on (default: "local" until a device service answers) */
  deviceId?: () => string;
  /** test seam: compose providers beside (or instead of) puppeteer's built-ins */
  providers?: (builtin: AgentProvider[]) => AgentProvider[];
  /** AC-3 test seam: the catalog (default: THE table, `AGENT_CATALOG`) — a
   * test composes rows for its scripted provider beside the real ones, which
   * is how the catalog's rules are exercised without a vendor literal */
  catalog?: readonly AgentCatalogEntry[];
  /** the daemon's environment the agent allow-list reads from (default process.env) */
  environment?: NodeJS.ProcessEnv;
  /** the OS user's home: puppeteer's default cwd and the `~` fold. Default os.homedir() */
  home?: string;
  /** test seam: the PATH the install inventory searches (default: the process PATH) */
  searchPath?: string;
  /** test seam: the fetch release detectors use (default: global fetch) */
  fetchFn?: typeof fetch;
  /** AR-4 — the ledger's system-actor entry for the daemon's own acts;
   * absent = the acts are logged, not audited (unit seams) */
  audit?: SystemAudit;
  /** AR-4 test seam: the resume-when-idle thresholds (defaults above) */
  resumeWhenIdle?: { afterMs?: number; pollMs?: number };
  now?: () => Date;
  logger?: Logger;
}

/** One managed run as the fold holds it. */
interface ManagedEntry {
  agent: Agent;
  info: AgentSessionInfo;
  cwd: string;
  title?: string | undefined;
  createdAt: string;
  stateChangedAt: string;
  lastActivityAt?: string | undefined;
  status: AgentSessionSummary["status"];
  mirror?: AgentMonitorMirror | undefined;
  mirrorIssueLogged: boolean;
  /** the floor's inventory row, once observed */
  terminal?: TerminalInfo | undefined;
  /** the inventory has carried this terminal at least once — from then on its
   * absence means the PTY is gone (the exit backstop) */
  seenInInventory: boolean;
  /** the backstop's pending close, while the floor's own exit is awaited */
  backstop?: NodeJS.Timeout | undefined;
  exiting: boolean;
  /** AR-4 — the durable identity and the ingress the run was launched with */
  creationRequestId?: string | undefined;
  ingress?: BoundIngress | undefined;
  /** AR-4 — this run was re-attached across a fieldd restart */
  reattached: boolean;
  /** AR-4 — the floor session this run replaced at a resume-when-idle */
  replaced?: string | undefined;
}

/** AR-4 — a run whose PTY outlived a fieldd that could NOT re-attach to it:
 * held in the fold as a pending row (live, unobserved) until its
 * conversation goes idle or a person resumes it. */
interface PendingEntry {
  record: AgentSessionRecord;
  /** why this boot could not re-attach (the adapter's or the runtime's words) */
  reason: string;
  since: string;
  terminal?: TerminalInfo | undefined;
  seenInInventory: boolean;
  backstop?: NodeJS.Timeout | undefined;
  /** the next idle check */
  poll?: NodeJS.Timeout | undefined;
  /** the replacement is under way: the old PTY is leaving, the new run being born */
  resuming: boolean;
  /** consecutive idle polls the index could not answer (the backoff) */
  failures: number;
}

/** MF-1f — a run whose PROCESS ended while its PTY is still on the floor.
 *
 * The deck is still showing that pane, and §07's resume verb belongs ON it —
 * so the fold keeps the row instead of withdrawing it the instant the process
 * dies. Before this, `closeRun` deleted the run outright and a pane holding a
 * dead agent had NO fold row at all: the verb that would bring it back existed
 * for the one beat between the exit and the withdrawal.
 *
 * Two provenances, one row. `entry` is present when THIS fieldd watched the
 * run exit (it keeps the mirror's last state, so the card still shows what the
 * agent had been doing); after a restart there is only the record, and the row
 * says so with `status: unknown` / `observationLevel: none`. The row leaves
 * when the floor stops listing the PTY (the pane was closed or killed) or when
 * a resume supersedes the record — never on a timer. */
interface ExitedEntry {
  /** the run as this fieldd held it, when it saw the exit itself */
  entry?: ManagedEntry | undefined;
  record: AgentSessionRecord;
  /** the floor session the record named — the pane the deck is showing */
  terminalSessionId: string;
  terminal?: TerminalInfo | undefined;
  /** the withdrawal grace, armed when an inventory stops listing the PTY */
  backstop?: NodeJS.Timeout | undefined;
  /** when this daemon learned the run had ended */
  since: string;
}

/** AR-4b — a record whose PTY the boot's first inventory did not list: held
 * for one grace, attached if the PTY appears (a cell that had not published
 * yet), stamped as an unknown exit if it does not. */
interface AwaitingBoot {
  record: AgentSessionRecord;
  deadline: number;
}

/** The `agents.*`/`agent.*` doors' service, the runtime's owner and the fold.
 * Auditing is the caller's (the daemon wraps the mutations in `audit.required`). */
export class AgentRuntimeService {
  /** puppeteer's runtime — typed as the open surface, not the built-in
   * family's: the composed providers are the built-ins plus whatever the
   * `providers` seam adds, and `spawn` takes any composed id. */
  readonly runtime: AgentRuntime;
  /** AC-3 — the catalog's readers: the truth of what is offered here */
  private readonly catalog: AgentCatalogReaders;
  private readonly host: AgentHost;
  private readonly terminalHost: TerminalAgentHost | null;
  private readonly distribution: DistributionRecordStore | null;
  private readonly records: SessionRecordStore;
  private readonly rootsDir: string;
  private readonly home: string;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly onTransition: ((state: RosettadState) => void) | null;
  private readonly unsubscribeMonitor: Array<() => void> = [];
  private reconciling: Promise<void> | null = null;
  /** personas mid-deletion: a reconcile racing the retire's bounce must not
   * re-enroll one it still finds in the registry */
  private readonly deleting = new Set<string>();
  /** the fold: managed runs by runtimeRunId, the pending ones beside them
   * (AR-4), and the terminal → run index over both */
  private readonly managed = new Map<string, ManagedEntry>();
  private readonly pending = new Map<string, PendingEntry>();
  /** MF-1f — runs whose process ended while the floor still lists their PTY */
  private readonly exited = new Map<string, ExitedEntry>();
  private readonly byTerminal = new Map<string, string>();
  /** the FIRST inventory of this boot is the re-attach; once */
  private reattachStarted = false;
  /** AC-3 — pending runs whose idle resume was withheld, said once each */
  private readonly idleWithheld = new Set<string>();
  /** puppeteer's durable claims — the authority on a run's epoch (AR-4b) */
  private readonly claims: CreationRequestRegistry;
  /** records whose PTY the first inventory lacked, within their grace */
  private readonly awaitingBoot = new Map<string, AwaitingBoot>();
  private awaitingSweep: NodeJS.Timeout | null = null;
  /** replacements in flight (an old PTY terminated, its successor not yet born) */
  private readonly replacements = new Set<Promise<unknown>>();
  private readonly idleAfterMs: number;
  private readonly pollMs: number;
  /** login panes awaiting their exit, by the floor's session id */
  private readonly logins = new Map<string, { profileId: string; timer: NodeJS.Timeout }>();
  /** MF-1g — every login pane this daemon opened, until its PTY is reaped.
   * The agent class is `keep-until-explicit-close` now, so a login pane's
   * husk needs an explicit end where the old class gave it one for free. */
  private readonly loginPanes = new Set<string>();
  private readonly subscribers = new Set<(rows: AgentListResult) => void>();
  private publishTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly opts: AgentRuntimeServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
    this.home = opts.home ?? homedir();
    this.rootsDir = join(opts.userRoot, ...LAYOUT.AGENT_ROOTS_DIR);
    this.records = new SessionRecordStore({
      dir: join(opts.userRoot, ...LAYOUT.AGENT_SESSIONS_DIR),
      keyPath: join(opts.userRoot, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
      now: this.now,
      logger: this.logger,
    });
    // AR-4 — the durable creation registry a run is restored against
    // (`agents/runs/`: the claims and the installation key, puppeteer's own
    // schema and modes, 0700/0600 — PU-8 again). Every birth names a
    // creation request so the next boot can re-attach at the next epoch.
    this.claims = createFileCreationRequestRegistry({
      directory: join(opts.userRoot, ...LAYOUT.AGENT_RUNS_DIR),
    });
    this.idleAfterMs = opts.resumeWhenIdle?.afterMs ?? RESUME_IDLE_AFTER_MS;
    this.pollMs = opts.resumeWhenIdle?.pollMs ?? RESUME_POLL_MS;
    this.distribution =
      opts.vibefieldRoot === null
        ? null
        : new DistributionRecordStore({
            rootReal: canonical(opts.vibefieldRoot),
            now: this.now,
            logger: this.logger,
          });
    // The host: the floor's agent cell (AR-3), late-bound through `terminals`;
    // a caller-supplied host (tests, AR-2's refusal) replaces it whole.
    if (opts.host !== undefined) {
      this.host = opts.host;
      this.terminalHost = null;
    } else {
      const terminals = opts.terminals;
      this.terminalHost = createTerminalAgentHost({
        terminals: terminals === undefined ? () => null : terminals,
        ...(opts.environment !== undefined ? { environment: opts.environment } : {}),
        home: this.home,
        logger: this.logger,
      });
      this.host = this.terminalHost;
    }
    this.catalog = createAgentCatalogReaders(opts.catalog ?? AGENT_CATALOG);
    // The active executable per provider is bound at construction (RFC 006's
    // `executables`; puppeteer's own PUPPETEER_<KIND>_BIN convention is its
    // fallback). A `setActive` therefore reaches spawns from the next boot —
    // stated at the door's contract. AC-3: over CATALOG ids (the record's keys
    // are catalog ids by AC-D2), so fieldd no longer names the sibling's closed
    // kind union; a record entry for an id the catalog never decided on stays
    // where it is and is ignored.
    const executables: Record<string, string> = {};
    if (this.distribution !== null) {
      for (const [provider, entry] of Object.entries(this.distribution.read().providers)) {
        if (entry.activeExecutable !== undefined && this.catalog.entry(provider) !== undefined)
          executables[provider] = entry.activeExecutable;
      }
    }
    const builtin = createBuiltinProviders({
      executables: executables as BuiltinProviderOptions["executables"],
    });
    const runtimeOptions: AgentRuntimeOptions = {
      host: this.host,
      defaultCwd: this.home,
      providers: opts.providers === undefined ? builtin : opts.providers(builtin),
      creationRegistry: this.claims,
      profiles: {
        store: createProfileStore({
          path: join(opts.userRoot, ...LAYOUT.AGENT_PROFILES_FILE),
          logger: this.logger,
        }),
        rootsDirectory: this.rootsDir,
      },
      distribution: {
        // puppeteer's default is ~/.puppeteer/updates; without a machine scope
        // the update door refuses before a transcript could be opened
        ...(this.distribution !== null
          ? { transcriptsDirectory: this.distribution.updatesDir() }
          : {}),
        ...(opts.fetchFn !== undefined ? { fetch: opts.fetchFn } : {}),
        ...(opts.searchPath !== undefined ? { searchPath: opts.searchPath } : {}),
      },
      // PF5's tick: the fold publishes one frame per tick anyway, so the
      // runtime's own coalescing matches it rather than adding a 100 ms stage
      monitorCoalesceMs: PUBLISH_TICK_MS,
      onError: (error) =>
        this.logger.warn("fieldd.agents.runtime_error", "Agent runtime reported an error", {
          error: error.message,
        }),
    };
    // createBuiltinAgentRuntime's own two steps, spelled out because it does
    // not thread `executables` through to the providers.
    this.runtime = createAgentRuntime(runtimeOptions);
    // AC-3 — the catalog is the truth of support: a provider the runtime
    // composes with no visible row is never offered. A `declined` row makes
    // that silent (a decision); no row at all is a decision owed — wall R23
    // says so at the gate, this says so at boot.
    for (const descriptor of this.runtime.providers()) {
      if (this.catalog.entry(descriptor.id) !== undefined) continue;
      this.logger.warn(
        "fieldd.agents.uncatalogued",
        "Composed provider has no catalog row; not offered (a decision is owed)",
        { provider: descriptor.id },
      );
    }
    // The fold's inputs (AR-3): puppeteer's monitor projection, verbatim.
    this.unsubscribeMonitor.push(
      this.runtime.onMonitorState((state) => this.onMonitorState(state)),
      this.runtime.onMonitorRemoved((runtimeRunId) => this.onMonitorRemoved(runtimeRunId)),
      this.runtime.onMonitorNotification((notice) => {
        const entry = this.managed.get(notice.runtimeRunId);
        if (entry === undefined) return;
        entry.lastActivityAt = notice.at;
        this.publish();
      }),
    );
    // R4 — every daemon ready re-applies the record to the personas.
    if (opts.supervisor !== null) {
      this.onTransition = (state) => {
        if (state.phase === "ready") void this.reconcile();
      };
      opts.supervisor.on("transition", this.onTransition);
    } else {
      this.onTransition = null;
    }
  }

  /** Whether the doors that write the machine scope can. */
  hasMachineScope(): boolean {
    return this.distribution !== null;
  }

  // ── managed sessions (AR-3) ──

  /** What one can spawn AS here — the CATALOG's visible rows (AC-3), each
   * decorated with this device's facts: whether an install resolved for it
   * (`available`), whether its adapter resumes AND the row offers it
   * (`resumable`), the index's state for it where the row offers history,
   * and its personas. A provider the runtime composes with no visible row is
   * absent; a row the runtime does not compose is listed unavailable. */
  async providers(): Promise<AgentProvidersResult> {
    const composed = new Set(this.runtime.providers().map((p) => p.id));
    const launch = new Map(this.runtime.launchProviders().map((p) => [p.id, p]));
    let installs: readonly AgentInstallation[] = [];
    try {
      installs = await this.runtime.inspectInstallations({});
    } catch (error) {
      this.logger.warn("fieldd.agents.inventory_failed", "Agent install inventory failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const ids = await this.opts.index.runtimeIdsByRoot();
    const profiles = await this.runtime.profiles();
    const history = await this.historyStates();
    const providers: AgentProviderSummary[] = [];
    for (const row of this.catalog.visible("desktop")) {
      const personas: AgentPersona[] = [];
      for (const profile of profiles) {
        if (profile.provider === row.id) personas.push(await this.project(profile, ids));
      }
      const state = history.get(row.id);
      providers.push({
        id: row.id,
        label: row.label,
        available: composed.has(row.id) && installs.some((install) => install.provider === row.id),
        resumable: row.offers.resume && launch.get(row.id)?.resume === true,
        personas,
        status: row.status,
        offers: row.offers,
        ...(state !== undefined ? { history: state } : {}),
      });
    }
    return { providers };
  }

  /** agent.catalog — the visible rows for the caller's surface (AC-3;
   * `declined` never leaves fieldd). */
  visibleCatalog(surface?: string): AgentCatalogResult {
    // an OPEN word on the wire (tolerant reader): a surface this build never
    // heard of gets every visible row rather than a refusal
    const known: AgentSurface | undefined =
      surface === "desktop" || surface === "phone" ? surface : undefined;
    return { catalog: this.catalog.visible(known) };
  }

  /** AC-D4 — our label for a session row: the catalog's, else the adapter's. */
  private labelFor(provider: string, fallback: string): string {
    return this.catalog.entry(provider)?.label ?? fallback;
  }

  /** AC-3 — a row of an agent the catalog does not show continues nothing:
   * its `continuation.resumable` says so, the way `agent.resume` would. */
  private withCatalogWord(row: AgentSessionSummary): AgentSessionSummary {
    const label = this.labelFor(row.kind, row.label);
    const visible = this.catalog.isVisible(row.kind);
    if (label === row.label && (visible || row.continuation === undefined)) return row;
    return {
      ...row,
      label,
      ...(row.continuation !== undefined && !visible
        ? { continuation: { ...row.continuation, resumable: false } }
        : {}),
    };
  }

  /** AC-3 — the runtime surface the usage service reads, with the catalog's
   * word applied: only providers whose row offers usage are polled. */
  usageRuntime(): AccountUsageRuntime {
    const runtime = this.runtime;
    return {
      accountUsageProviders: () =>
        runtime
          .accountUsageProviders()
          .filter((p) => this.catalog.isOffered(p.id, "usage"))
          .map((p) => ({ ...p, label: this.labelFor(p.id, p.label) })),
      accountUsage: runtime.accountUsage.bind(runtime),
      // a push from a provider the row does not offer usage for is dropped
      // here — the monitor was never given that provider, and a push it
      // cannot file would be a thrown-at warning per push
      onAccountUsage: (listener) =>
        runtime.onAccountUsage((provider, result) => {
          if (this.catalog.isOffered(provider.id, "usage")) listener(provider, result);
        }),
      onProfilesChanged: runtime.onProfilesChanged.bind(runtime),
      profiles: runtime.profiles.bind(runtime),
    };
  }

  /** AC-3 — the index's state per agent that offers history: `unavailable`
   * while the daemon is not ready, its census has not answered within a short
   * wait (it fills in behind the ready line), or its roll call disagrees with
   * the catalog on the kind (the skew AC-D8 subtracts at start); `indexed`
   * when the record consents to the kind or enrolls a root of it; else
   * `unindexed`. */
  private async historyStates(): Promise<ReadonlyMap<string, AgentHistoryState>> {
    const out = new Map<string, AgentHistoryState>();
    const ready = (this.opts.supervisor?.health().phase ?? "unconfigured") === "ready";
    const witness = ready
      ? await this.opts.index.kindsByLayoutRoot({ waitMs: HISTORY_STATE_WAIT_MS })
      : new Map<string, string>();
    const record = this.opts.index.record();
    for (const row of this.catalog.visible()) {
      if (!row.offers.history || row.seams.rosetta === null || row.layoutRoot === null) continue;
      const kind = row.seams.rosetta.kind;
      if (!ready || witness.get(row.layoutRoot) !== kind) {
        out.set(row.id, "unavailable");
        continue;
      }
      const named =
        record.enabled_kinds.includes(kind) || record.runtimes.some((rt) => rt.kind === kind);
      out.set(row.id, named ? "indexed" : "unindexed");
    }
    return out;
  }

  /** AC-3 — the catalog's word on an id before a door acts: no row is
   * NOT_FOUND (no such agent here); a row that does not offer the capability
   * is PRECONDITION_FAILED `{reason: "unsupported-agent", status}`. */
  private requireOffered(provider: string, capability: AgentCapability): AgentCatalogEntry {
    const row = this.catalog.entry(provider);
    if (row === undefined) {
      throw new RpcCallError("NOT_FOUND", `no agent ${provider} in the catalog`, false, {
        provider,
        reason: "unsupported-agent",
      });
    }
    if (!this.catalog.isOffered(provider, capability)) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${row.label} is ${row.status} here and does not offer ${capability}`,
        false,
        { provider, reason: "unsupported-agent", status: row.status, capability },
      );
    }
    return row;
  }

  /** AC-3 — a door that CONTINUES something (a resume, a login) needs the
   * agent visible, not offered: a deprecated agent's sessions still resume. */
  private requireVisible(provider: string, act: string): void {
    if (this.catalog.isVisible(provider)) return;
    const row = this.catalog.entry(provider);
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      `${row?.label ?? provider} is ${row?.status ?? "not in the catalog"} here; cannot ${act}`,
      false,
      { provider, reason: "unsupported-agent", status: row?.status ?? "no-row" },
    );
  }

  /** A managed session born in a PTY on this device's floor. The answer is
   * the fold's row at birth and the routed ticket the pane mounts. */
  async spawn(params: AgentSpawnParams, principal: GrantPrincipal): Promise<AgentSpawnResult> {
    this.requireOffered(params.provider, "spawn");
    const terminals = this.requireTerminals();
    const cwd = params.cwd ?? this.home;
    const identity = this.newIdentity();
    const result = await this.runtime.spawn({
      agent: params.provider,
      cwd,
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.profileId !== undefined ? { profile: params.profileId } : {}),
      creationRequestId: identity.creationRequestId,
      ingress: identity.ingress,
    });
    if (isSessionFailure(result)) throw this.sessionFailureToError(result, params.provider);
    const entry = this.enter(result, { cwd, title: params.title, ...identity.launched() });
    return this.ticketed(entry, principal, terminals);
  }

  /** Continue a managed session from its record: a new run in a new PTY,
   * the vendor's own conversation continued. For an EXITED session the
   * ordinary path; for a PENDING one (AR-4: its PTY alive but unobserved,
   * because this boot could not re-attach) the resume IS the replacement,
   * by hand instead of at the next idle. A live, attached run is refused. */
  async resume(params: AgentResumeParams, principal: GrantPrincipal): Promise<AgentSpawnResult> {
    const terminals = this.requireTerminals();
    const record = this.records.read(params.runtimeRunId);
    if (record === undefined) {
      throw new RpcCallError("NOT_FOUND", `no managed session ${params.runtimeRunId}`, false, {
        runtimeRunId: params.runtimeRunId,
      });
    }
    this.requireVisible(record.provider, "resume it");
    // AR-4b — a record already continued into another run is not continued
    // again: two runs on one native conversation is the state a resume must
    // never make, and the successor is the one to resume
    if (record.reattach?.state === "resumed") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the session was already resumed into another run; resume that one",
        false,
        {
          runtimeRunId: record.runtimeRunId,
          state: "replaced",
          ...(record.reattach.replacedBy !== undefined
            ? { replacedBy: record.reattach.replacedBy }
            : {}),
        },
      );
    }
    const pending = this.pending.get(record.runtimeRunId);
    if (pending !== undefined) {
      const entry = await this.track(this.replacePending(pending, params.cwd, "manual"));
      return this.ticketed(entry, principal, terminals);
    }
    const live = this.managed.get(record.runtimeRunId);
    // MF-1f — a STAMPED record means the process is over, so its PTY still
    // being listed is a dead pane, not a running session. Before this, that
    // husk made `resume` refuse `terminal-alive` and the exited row's own verb
    // could not be used; the guard now asks whether the RUN is alive, which is
    // what it always meant. A live or pending row is refused exactly as before.
    const terminalAlive =
      record.exited === undefined &&
      record.terminalSessionId !== undefined &&
      terminals.observation() !== undefined &&
      terminals.get(record.terminalSessionId) !== undefined;
    if ((live !== undefined && !live.exiting) || terminalAlive) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the session's terminal is still running and its run is attached; resume is for an exited or an unobserved session",
        false,
        { runtimeRunId: record.runtimeRunId, state: "terminal-alive" },
      );
    }
    // MF-1g — the husk this resume replaces, if there is one. Naming it here
    // puts `terminal.replaced` on the SUCCESSOR's row, which is AR-4's
    // hand-over shape and exactly what the deck's resume verb reads
    // (`GodviewDeck.tsx`: the answer's ticket lands in the pane the verb was
    // pressed in, replacing the exited one).
    const husk = this.exited.get(record.runtimeRunId)?.terminalSessionId;
    const entry = await this.resumeFromRecord(record, params.cwd, husk);
    // MF-1f — the record names its successor, and the exited row goes: two
    // runs on one native conversation is the state AR-4b forbids, and without
    // this mark a second `agent.resume` on the same record would have made
    // exactly that (the `already resumed` guard above only ever saw the
    // pending path's own stamp), while a later boot would re-list the dead
    // pane beside the run that replaced it.
    this.supersede(record, entry.info.runtimeRunId);
    this.dropExited(record.runtimeRunId, "a resume continued the conversation");
    // The ticket FIRST: the successor exists and is answerable before anything
    // is destroyed, so a birth that failed above leaves the dead pane and its
    // final screen exactly where they were.
    const answer = this.ticketed(entry, principal, terminals);
    // MF-1g — then the husk goes. Ordered like AR-4b's own replacement (the
    // pending path terminates the old PTY before its door answers, and the
    // deck's hand-over is built for precisely that), so nothing lingers once
    // the pane has been handed over. The id is the RECORD's own PTY, never one
    // a caller named — the `agent.resume` scope argument, unchanged.
    if (husk !== undefined) await this.reapHusk(husk, terminals);
    return answer;
  }

  /** MF-1g — close a login pane's husk. Login panes have no resume verb and
   * nothing comes back for them, so their end is the floor's ladder. */
  private async reapLoginPane(sessionId: string): Promise<void> {
    if (!this.loginPanes.delete(sessionId)) return;
    const terminals = this.opts.terminals?.() ?? null;
    if (terminals === null) return;
    await this.reapHusk(sessionId, terminals);
  }

  /** MF-1g — end a pane whose run is over and whose successor now holds it.
   * A husk the floor has already forgotten is not an error: the pane is gone,
   * which is the state this was asking for. */
  private async reapHusk(sessionId: string, terminals: TerminalService): Promise<void> {
    try {
      const { terminated } = await terminals.terminate(sessionId);
      this.logger.info("fieldd.agents.husk_reaped", "An exited agent pane was closed", {
        sessionId,
        terminated,
      });
    } catch (error) {
      // the floor is gone, or the cell that held it is: the husk dies with
      // whichever of them went, and no caller waits on that
      this.logger.warn(
        "fieldd.agents.husk_reap_failed",
        "An exited agent pane could not be closed",
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /** Stamp a record as continued into a named successor (AR-4b's one-run law).
   * Re-read first: the resume may have rewritten it. */
  private supersede(record: AgentSessionRecord, replacedBy: string): void {
    const current = this.records.read(record.runtimeRunId);
    if (current === undefined) return;
    const at = this.now().toISOString();
    this.records.write({
      ...current,
      reattach: { state: "resumed", at: current.reattach?.at ?? at, replacedBy },
      updatedAt: at,
    });
  }

  /** AR-6-0 (MF-1 §10.2) — the stop verb: interrupt what a run is DOING without
   * ending it, the ⎋ a person at the keyboard would press. One semantic input
   * through the floor's own epoch-ordered path, so it cannot race a human's
   * typing into the same PTY.
   *
   * The PTY is always the RECORD'S OWN. The params name a RUN, and the id sent
   * to the floor comes from the managed entry fieldd wrote when it spawned
   * that run — never a terminal id a caller chose, and never a PTY this daemon
   * did not mint. That is what keeps the act inside `agent.control` rather than
   * making it a `terminal.attach`-class power (the `agent.resume` scope
   * argument in methods.ts, applied here).
   *
   * Three answers, all honest:
   *  - an unknown run is NOT_FOUND;
   *  - a run that is gone (its record stamped) or PENDING (AR-4: a live PTY
   *    nothing observes, which fieldd holds no adapter for) is
   *    PRECONDITION_FAILED `{state: "not-alive"}` — refusing to type into a
   *    terminal we cannot claim to be steering;
   *  - otherwise the FLOOR's answer, verbatim. `accepted` means the floor took
   *    the interrupt, never that the agent obeyed it. */
  async interrupt(params: AgentInterruptParams): Promise<AgentInterruptResult> {
    const entry = this.managed.get(params.runtimeRunId);
    if (entry === undefined || entry.exiting) {
      const known =
        entry !== undefined ||
        this.pending.has(params.runtimeRunId) ||
        this.records.read(params.runtimeRunId) !== undefined;
      if (!known) {
        throw new RpcCallError("NOT_FOUND", `no managed session ${params.runtimeRunId}`, false, {
          runtimeRunId: params.runtimeRunId,
        });
      }
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the session is not running under this daemon; interrupt is for a live, observed run",
        false,
        { runtimeRunId: params.runtimeRunId, state: "not-alive" },
      );
    }
    const host = this.terminalHost;
    if (host === null) {
      // the same words the host itself would answer with — no floor, no act
      return { accepted: false, reason: "no-terminal-host" };
    }
    const result = await host.automateTerminal(entry.info.terminalSessionId, {
      kind: "interrupt",
    });
    this.logger.info("fieldd.agents.interrupted", "An agent run was interrupted", {
      runtimeRunId: params.runtimeRunId,
      sessionId: entry.info.terminalSessionId,
      accepted: result.accepted,
      ...(result.accepted ? {} : { reason: result.reason }),
    });
    return result.accepted ? { accepted: true } : { accepted: false, reason: result.reason };
  }

  /** The persona login pane: the vendor's own interactive login in a PTY
   * bound to the persona's root; the persona is verified when it ends. */
  async login(
    params: AgentsProfilesLoginParams,
    principal: GrantPrincipal,
  ): Promise<AgentsProfilesLoginResult> {
    const terminals = this.requireTerminals();
    const profile = await this.runtime.profile(params.profileId);
    if (profile === undefined) {
      throw new RpcCallError("NOT_FOUND", `no persona ${params.profileId}`, false, {
        profileId: params.profileId,
      });
    }
    this.requireVisible(profile.provider, "log its persona in");
    const result = await this.runtime.startProfileLogin({
      profileId: params.profileId,
      cwd: params.cwd ?? this.home,
    });
    if (isFailure(result)) throw this.refusalOr(failureToError(result));
    const born = this.terminalHost?.born(result.runtimeSessionId);
    if (born === undefined) {
      throw new RpcCallError(
        "INTERNAL",
        "the login terminal was spawned outside the floor host; no ticket can be minted for it",
        false,
      );
    }
    const timer = setTimeout(
      () => void this.finishLogin(result.runtimeSessionId, "timeout"),
      LOGIN_TIMEOUT_MS,
    );
    timer.unref();
    this.logins.set(result.runtimeSessionId, { profileId: params.profileId, timer });
    this.loginPanes.add(result.runtimeSessionId);
    this.logger.info("fieldd.agents.login_started", "Persona login pane opened", {
      profileId: params.profileId,
      provider: profile.provider,
      sessionId: result.runtimeSessionId,
    });
    return {
      persona: await this.project(result.profile, await this.opts.index.runtimeIdsByRoot()),
      terminal: terminals.createOpenResult(principal, born),
    };
  }

  /** The fold, now: one row per managed run — attached or pending — oldest first. */
  list(): AgentListResult {
    const rows = [
      ...[...this.managed.values()].map((entry) => ({
        createdAt: entry.createdAt,
        row: this.summarize(entry),
      })),
      ...[...this.pending.values()].map((entry) => ({
        createdAt: entry.record.createdAt,
        row: this.summarizePending(entry),
      })),
      // MF-1f — a run whose process ended while its pane is still on the floor
      ...[...this.exited.values()].map((exited) => ({
        createdAt: exited.record.createdAt,
        row: this.summarizeExited(exited),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return { sessions: rows.map((r) => r.row) };
  }

  /** `agent.subscribe`: full snapshots, at most one per tick. */
  subscribe(emit: (rows: AgentListResult) => void): () => void {
    this.subscribers.add(emit);
    return () => this.subscribers.delete(emit);
  }

  /** The floor's exit facts (TerminalService `session-exited`): a managed
   * run's PTY ended → puppeteer's `handleProcessExit`, the record stamped, the
   * row withdrawn; a login pane ended → the persona is verified. */
  async handleTerminalExit(event: SessionExitedEvent): Promise<void> {
    if (this.logins.has(event.sessionId)) {
      await this.finishLogin(event.sessionId, "exited");
      return;
    }
    // MF-1g — a login pane whose wait TIMED OUT and which has now ended: the
    // login was abandoned long ago, so nothing is listening, and under
    // `keep-until-explicit-close` its husk would otherwise stand forever.
    if (this.loginPanes.has(event.sessionId)) {
      await this.reapLoginPane(event.sessionId);
      return;
    }
    const runtimeRunId = this.byTerminal.get(event.sessionId);
    if (runtimeRunId === undefined) return;
    const exit = {
      exitCode: event.exitCode,
      signal: event.exitSignal,
      reason: event.exitOutcome,
      requestedTermination: event.requestedTermination,
    };
    if (this.pending.has(runtimeRunId)) {
      this.closePending(runtimeRunId, exit);
      return;
    }
    await this.closeRun(runtimeRunId, exit);
  }

  /** The floor's inventory (TerminalService `onInventory`): the join for the
   * row's cell, and the exit backstop — a terminal the inventory carried and
   * no longer does is gone, whether or not its cell's connection said so. */
  handleInventory(terminals: readonly TerminalInfo[]): void {
    const rows = new Map(terminals.map((row) => [row.sessionId, row]));
    // AR-4 — the FIRST inventory of a boot is the re-attach: the records left
    // by the last fieldd, against the PTYs this floor still lists.
    if (!this.reattachStarted) {
      this.reattachStarted = true;
      void this.reattach(rows);
    } else if (this.awaitingBoot.size > 0) {
      this.sweepAwaiting(rows);
    }
    let changed = false;
    for (const [runtimeRunId, entry] of this.pending) {
      const id = entry.record.terminalSessionId;
      const row = id === undefined ? undefined : rows.get(id);
      if (row !== undefined) {
        if (!entry.seenInInventory || entry.terminal?.cell?.cellBootId !== row.cell?.cellBootId)
          changed = true;
        entry.seenInInventory = true;
        entry.terminal = row;
        if (entry.backstop !== undefined) {
          clearTimeout(entry.backstop);
          entry.backstop = undefined;
        }
      } else if (entry.seenInInventory && !entry.resuming && entry.backstop === undefined) {
        // a pending PTY that left: the process ended on its own — stamped
        // after the same grace the attached runs get
        entry.backstop = setTimeout(() => {
          entry.backstop = undefined;
          this.closePending(runtimeRunId, { exitCode: null, signal: null, reason: "unknown" });
        }, EXIT_GRACE_MS);
        entry.backstop.unref();
      }
    }
    for (const [runtimeRunId, entry] of this.managed) {
      const row = rows.get(entry.info.terminalSessionId);
      if (row !== undefined) {
        if (!entry.seenInInventory || entry.terminal?.cell?.cellBootId !== row.cell?.cellBootId)
          changed = true;
        entry.seenInInventory = true;
        entry.terminal = row;
        if (entry.backstop !== undefined) {
          // listed again: a reading that briefly lacked it, not an exit
          clearTimeout(entry.backstop);
          entry.backstop = undefined;
        }
      } else if (entry.seenInInventory && !entry.exiting && entry.backstop === undefined) {
        entry.backstop = setTimeout(() => {
          entry.backstop = undefined;
          void this.closeRun(runtimeRunId, { exitCode: null, signal: null, reason: "unknown" });
        }, EXIT_GRACE_MS);
        entry.backstop.unref();
      }
    }
    // MF-1f — an exited run's row lives exactly as long as its PANE. Listed:
    // keep it (and follow the cell, so a card's join stays exact). Unlisted:
    // the same grace the live rows get, because one reading that briefly
    // lacked a PTY is not a closed pane — then the row goes.
    for (const [runtimeRunId, exited] of this.exited) {
      const row = rows.get(exited.terminalSessionId);
      if (row !== undefined) {
        if (exited.terminal?.cell?.cellBootId !== row.cell?.cellBootId) changed = true;
        exited.terminal = row;
        if (exited.backstop !== undefined) {
          clearTimeout(exited.backstop);
          exited.backstop = undefined;
        }
      } else if (exited.backstop === undefined) {
        exited.backstop = setTimeout(() => {
          exited.backstop = undefined;
          if (this.dropExited(runtimeRunId, "the floor stopped listing the pane")) this.publish();
        }, EXIT_GRACE_MS);
        exited.backstop.unref();
      }
    }
    if (changed) this.publish();
  }

  // ── personas ──

  async personas(provider?: string): Promise<AgentsProfilesListResult> {
    const profiles = await this.runtime.profiles(provider);
    const ids = await this.opts.index.runtimeIdsByRoot();
    const personas: AgentPersona[] = [];
    for (const profile of profiles) personas.push(await this.project(profile, ids));
    return { personas };
  }

  /** Allocate + register (puppeteer), then enroll the observation root under
   * the joined kind. An enrollment that cannot happen now (daemon down, kind
   * unknown to the roll call) leaves the persona indexed later, not failed. */
  async createPersona(params: AgentsProfilesCreateParams): Promise<AgentsProfilesCreateResult> {
    this.requireOffered(params.provider, "personas");
    const created = await this.runtime.createProfile({
      providerId: params.provider,
      label: params.label,
    });
    if (isFailure(created)) throw failureToError(created);
    const spec = await this.enrollmentSpecFor(created);
    if (spec !== undefined) await this.opts.index.enrollRuntimes([spec]);
    return { persona: await this.project(created, await this.opts.index.runtimeIdsByRoot()) };
  }

  /** Stop its sessions → unregister → retire → delete the root (topology §4
   * "Persona delete"; the registry goes before the retire because the
   * retire's bounce wakes the reconcile, which must find no persona to
   * re-enroll). The persona's session records go with its root: nothing could
   * resume into a root that no longer exists. */
  async deletePersona(profileId: string): Promise<AgentsProfilesDeleteResult> {
    const profile = await this.runtime.profile(profileId);
    if (profile === undefined) {
      throw new RpcCallError("NOT_FOUND", `no persona ${profileId}`, false, { profileId });
    }
    if (profile.kind !== "managed") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the provider's own default root is not a persona VibeField owns; retire its kind through index.retire instead",
        false,
        { profileId, kind: profile.kind },
      );
    }
    this.deleting.add(profileId);
    try {
      // 0. its sessions (AR-3): the floor's ladder, the exit closes the run
      const terminals = this.opts.terminals?.() ?? null;
      const owned: Array<{ profileId: string | undefined; terminalSessionId: string | undefined }> =
        [
          ...[...this.managed.values()].map((entry) => ({
            profileId: entry.info.profileId,
            terminalSessionId: entry.info.terminalSessionId,
          })),
          ...[...this.pending.values()].map((entry) => ({
            profileId: entry.record.profileId,
            terminalSessionId: entry.record.terminalSessionId,
          })),
        ];
      for (const entry of owned) {
        if (
          entry.profileId !== profileId ||
          entry.terminalSessionId === undefined ||
          terminals === null
        )
          continue;
        try {
          await terminals.terminate(entry.terminalSessionId);
        } catch (error) {
          this.logger.warn(
            "fieldd.agents.persona_session_stop_failed",
            "A persona's session could not be terminated before deletion",
            { profileId, error: error instanceof Error ? error.message : String(error) },
          );
        }
      }
      // AR-4b — a run mid-attach is in neither map: the records name its PTY
      for (const record of this.records.list()) {
        if (record.profileId !== profileId) continue;
        const id = record.terminalSessionId;
        if (
          terminals !== null &&
          record.exited === undefined &&
          id !== undefined &&
          !owned.some((entry) => entry.terminalSessionId === id) &&
          this.listed(terminals, id)
        ) {
          try {
            await terminals.terminate(id);
          } catch (error) {
            this.logger.warn(
              "fieldd.agents.persona_session_stop_failed",
              "A persona's recorded session could not be terminated before deletion",
              { profileId, error: error instanceof Error ? error.message : String(error) },
            );
          }
        }
        this.records.remove(record.runtimeRunId);
      }
      // 1. the registry
      const deleted = await this.runtime.removeProfile(profileId);
      try {
        // 2. the index: watch off, rows kept, the persona still named (AR-D19)
        for (const row of this.opts.index.record().runtimes) {
          if (row.profile_id === profileId || within(profile.dataRoot, row.data_root)) {
            await this.opts.index.retireEnrolled({ kind: row.kind, dataRoot: row.data_root });
          }
        }
      } finally {
        // 3. the root and its credentials — only ever a directory fieldd
        // allocated; even when the retire could not settle (the daemon then
        // finds the root gone at its next start and the record retires it)
        if (within(this.rootsDir, profile.dataRoot) && profile.dataRoot !== this.rootsDir) {
          rmSync(profile.dataRoot, { recursive: true, force: true });
        } else {
          this.logger.warn(
            "fieldd.agents.persona_root_kept",
            "Persona root lies outside this user's managed roots; left in place",
            { profileId },
          );
        }
      }
      this.logger.info("fieldd.agents.persona_deleted", "Persona deleted", {
        profileId,
        provider: profile.provider,
      });
      return { deleted };
    } finally {
      this.deleting.delete(profileId);
    }
  }

  /** Re-read the identity from the provider's own status surface; the result
   * is data either way (the adapter's honest failure rides beside the persona). */
  async verifyPersona(profileId: string): Promise<AgentsProfilesVerifyResult> {
    const profile = await this.runtime.profile(profileId);
    if (profile === undefined) {
      throw new RpcCallError("NOT_FOUND", `no persona ${profileId}`, false, { profileId });
    }
    const outcome = await this.runtime.verifyProfile(profileId);
    const ids = await this.opts.index.runtimeIdsByRoot();
    if (isFailure(outcome)) {
      if (outcome.status === "not-found") throw failureToError(outcome);
      return {
        persona: await this.project(profile, ids),
        failure: { status: outcome.status, message: outcome.message, retryable: outcome.retryable },
      };
    }
    const fresh = (await this.runtime.profile(profileId)) ?? profile;
    return { persona: await this.project(fresh, ids) };
  }

  // ── distribution ──

  /** A FRESH inspection (the vendor's version command runs per candidate) with
   * the machine record's choice folded over puppeteer's own `active`. */
  async installs(provider?: string): Promise<AgentsInstallsResult> {
    // AC-3 — an agent the catalog does not show has no installs here: a
    // `declined` id never leaves fieldd, and no vendor command runs for it
    if (provider !== undefined && !this.catalog.isVisible(provider)) return { installs: [] };
    const installations = (
      await this.runtime.inspectInstallations({
        ...(provider !== undefined ? { providerId: provider } : {}),
        refresh: true,
      })
    ).filter((install) => this.catalog.isVisible(install.provider));
    return { installs: this.projectInstalls(installations, this.distribution?.read()) };
  }

  /** The agent's own oracle always; the declared network detectors only when
   * this call or the provider's recorded preference says so. */
  async releases(params: AgentsReleasesParams): Promise<AgentsReleasesResult> {
    // AC-3 — an explicit provider the catalog does not offer distribution for
    // is answered as this door's honest failure row, and the vendor's oracle
    // and the network detectors never run for it
    if (params.provider !== undefined && !this.catalog.isOffered(params.provider, "distribution")) {
      const row = this.catalog.entry(params.provider);
      return {
        releases: [
          {
            provider: params.provider,
            status: "unsupported",
            message: `${row?.label ?? params.provider} is ${row?.status ?? "not in the catalog"} here and offers no distribution`,
            retryable: false,
          },
        ],
      };
    }
    const record = this.distribution?.read();
    const providers =
      params.provider !== undefined
        ? [params.provider]
        : this.runtime
            .distributionProviders()
            .map((p) => p.id)
            .filter((id) => this.catalog.isOffered(id, "distribution"));
    const results = await Promise.all(
      providers.map((providerId) =>
        this.runtime.checkReleases({
          providerId,
          network: params.network === true || record?.providers[providerId]?.network === true,
        }),
      ),
    );
    return {
      releases: results.flatMap((result) => [
        ...result.releases.map((release) => ({ ...release })),
        ...result.failures.map((failure) => ({ ...failure })),
      ]),
    };
  }

  /** The vendor's own updater, then the receipt into the machine record. The
   * root lock is held for the record's read-modify-write only, never across
   * the updater (minutes): the lock is the users file's, shared by every
   * fieldd on this device, and its deadline is short by law. */
  async update(provider: string): Promise<AgentsUpdateResult> {
    this.requireOffered(provider, "distribution");
    const store = this.requireMachineScope();
    const receipt = await this.runtime.updateInstallation({ providerId: provider });
    await store.mutate((record) => {
      record.providers[provider] = { ...record.providers[provider], lastUpdate: receipt };
      return true;
    });
    this.logger.info("fieldd.agents.updated", "Agent update ran", {
      provider,
      status: receipt.status,
      ...(receipt.exitCode !== undefined ? { exitCode: receipt.exitCode } : {}),
    });
    return { receipt: projectReceipt(receipt) };
  }

  /** Record which of the provider's installs new spawns use (from the next
   * boot: the runtime binds it at construction). */
  async setActive(params: AgentsSetActiveParams): Promise<AgentsSetActiveResult> {
    this.requireOffered(params.provider, "distribution");
    const store = this.requireMachineScope();
    const installations = await this.runtime.inspectInstallations({
      providerId: params.provider,
      refresh: true,
    });
    const chosen = installations.find(
      (i) => i.executable === params.executable || i.realPath === params.executable,
    );
    if (chosen === undefined) {
      throw new RpcCallError(
        "NOT_FOUND",
        `no ${params.provider} install at ${params.executable}`,
        false,
        { provider: params.provider, executable: params.executable },
      );
    }
    const { changed, record } = await store.mutate((r) => {
      const current = r.providers[params.provider];
      if (current?.activeExecutable === chosen.executable) return false;
      r.providers[params.provider] = { ...current, activeExecutable: chosen.executable };
      return true;
    });
    return { changed, installs: this.projectInstalls(installations, record) };
  }

  // ── the reconcile (R4) ──

  /** Every daemon ready re-applies the record to the personas: a managed
   * persona the record does not name yet (created while the daemon was down,
   * or before this fieldd) is enrolled now under the catalog's kind, with the
   * roll call as witness (`kindFor` waits for the census the daemon publishes
   * behind its ready line).
   * Serialized; a change publishes and bounces the daemon ONCE — the ready
   * that follows finds nothing to do. */
  reconcile(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.reconciling ??= (async () => {
      try {
        const specs: EnrollRuntimeSpec[] = [];
        for (const profile of await this.runtime.profiles()) {
          if (profile.kind !== "managed" || this.deleting.has(profile.id)) continue;
          const spec = await this.enrollmentSpecFor(profile);
          if (spec !== undefined) specs.push(spec);
        }
        if (specs.length > 0) {
          this.logger.info(
            "fieldd.agents.reconcile",
            "Enrolling personas the record did not name",
            {
              count: specs.length,
            },
          );
          await this.opts.index.enrollRuntimes(specs);
        }
      } catch (error) {
        this.logger.warn("fieldd.agents.reconcile_failed", "Persona reconcile did not complete", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.reconciling = null;
      }
    })();
    return this.reconciling;
  }

  /** Tear the runtime down — and RELEASE the runs rather than close them
   * (AR-4, PU-1's `dispose({detach})`): the PTYs are the floor's and outlive
   * this fieldd (EL1), their claims stay allocated, no exit is dispatched and
   * no record is stamped; the next boot finds the records and re-attaches. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.onTransition !== null) this.opts.supervisor?.off("transition", this.onTransition);
    for (const unsubscribe of this.unsubscribeMonitor) unsubscribe();
    if (this.publishTimer !== null) {
      clearTimeout(this.publishTimer);
      this.publishTimer = null;
    }
    for (const login of this.logins.values()) clearTimeout(login.timer);
    this.logins.clear();
    for (const entry of this.managed.values()) {
      if (entry.backstop !== undefined) clearTimeout(entry.backstop);
    }
    for (const entry of this.pending.values()) {
      if (entry.backstop !== undefined) clearTimeout(entry.backstop);
      if (entry.poll !== undefined) clearTimeout(entry.poll);
    }
    for (const exited of this.exited.values()) {
      if (exited.backstop !== undefined) clearTimeout(exited.backstop);
    }
    this.exited.clear();
    // the login panes are the floor's from here: a stop RELEASES panes, it
    // does not kill them (AR-4 — the PTYs outlive us)
    this.loginPanes.clear();
    if (this.awaitingSweep !== null) {
      clearTimeout(this.awaitingSweep);
      this.awaitingSweep = null;
    }
    this.awaitingBoot.clear();
    this.subscribers.clear();
    // AR-4b — a replacement in flight has terminated a PTY and not yet born
    // its successor: it is given a bounded moment to finish, so a stop does
    // not leave the user's agent dead with no run to come back to
    if (this.replacements.size > 0) {
      const settled = Promise.allSettled([...this.replacements]);
      await Promise.race([
        settled,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, DISPOSE_REPLACEMENT_WAIT_MS);
          timer.unref();
        }),
      ]);
    }
    try {
      await this.runtime.dispose({ detach: true });
    } catch (error) {
      this.logger.warn("fieldd.agents.dispose_failed", "Agent runtime did not dispose cleanly", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.managed.clear();
    this.pending.clear();
    this.byTerminal.clear();
  }

  // ── internals: the fold ──

  /** AR-4 — what a birth is given so the next boot can find it again: a
   * creation request id (puppeteer's durable claim) and a say over the
   * ingress, whose bound port and bearer the adapter reports BEFORE the
   * process launches (an adapter without an ingress reports nothing). */
  private newIdentity(): {
    creationRequestId: string;
    ingress: HostIngress;
    launched(): { creationRequestId: string; ingress?: BoundIngress | undefined };
  } {
    const creationRequestId = randomUUID();
    let bound: BoundIngress | undefined;
    return {
      creationRequestId,
      ingress: {
        onBound: (b) => {
          bound = b;
        },
      },
      launched: () => ({
        creationRequestId,
        ...(bound !== undefined ? { ingress: bound } : {}),
      }),
    };
  }

  /** A run puppeteer just started (spawned, resumed, or — AR-4 — re-attached)
   * enters the fold: its record written (or, re-attached, brought to the new
   * epoch), its row published. */
  private enter(
    agent: Agent,
    launch: {
      cwd: string;
      title?: string | undefined;
      creationRequestId?: string | undefined;
      ingress?: BoundIngress | undefined;
      /** the floor session this run replaced (resume-when-idle) */
      replaced?: string | undefined;
      /** AR-4 — the record already exists: this run was re-attached, and the
       * inventory row that proved its PTY alive rides along */
      reattached?: { record: AgentSessionRecord; terminal: TerminalInfo } | undefined;
    },
  ): ManagedEntry {
    const info = agent.info;
    const now = this.now().toISOString();
    if (launch.reattached === undefined) {
      this.records.write(
        recordForRun({
          info,
          cwd: launch.cwd,
          title: launch.title,
          now,
          creationRequestId: launch.creationRequestId,
          ingress: launch.ingress,
          replaced: launch.replaced,
        }),
      );
    } else {
      this.records.write({
        ...launch.reattached.record,
        runtimeEpoch: info.runtimeEpoch,
        continuation: { ...info.continuation },
        reattach: { state: "attached", at: now },
        updatedAt: now,
      });
    }
    const entry: ManagedEntry = {
      agent,
      info,
      cwd: launch.cwd,
      title: launch.title,
      createdAt: launch.reattached?.record.createdAt ?? now,
      stateChangedAt: now,
      status: "unknown",
      mirrorIssueLogged: false,
      terminal: launch.reattached?.terminal,
      seenInInventory: launch.reattached !== undefined,
      exiting: false,
      creationRequestId: launch.creationRequestId,
      ingress: launch.ingress,
      reattached: launch.reattached !== undefined,
      replaced: launch.replaced,
    };
    if (this.disposed) {
      // the service stopped while this run was being born or attached: the
      // record above is what the next boot needs; the fold is gone
      this.logger.warn(
        "fieldd.agents.enter_after_stop",
        "A run entered after the service stopped; recorded for the next boot, not held",
        { runtimeRunId: info.runtimeRunId, sessionId: info.terminalSessionId },
      );
      return entry;
    }
    this.managed.set(info.runtimeRunId, entry);
    this.byTerminal.set(info.terminalSessionId, info.runtimeRunId);
    const current = this.runtime.monitorState(info.runtimeRunId);
    if (current !== undefined) this.applyMonitor(entry, current);
    this.logger.info(
      launch.reattached === undefined
        ? "fieldd.agents.session_started"
        : "fieldd.agents.session_reattached",
      launch.reattached === undefined
        ? "Managed agent session started"
        : "Managed agent session re-attached across the restart",
      {
        runtimeRunId: info.runtimeRunId,
        runtimeEpoch: info.runtimeEpoch,
        provider: info.provider.id,
        sessionId: info.terminalSessionId,
        ...(info.profileId !== undefined ? { profileId: info.profileId } : {}),
        ...(launch.replaced !== undefined ? { replaced: launch.replaced } : {}),
      },
    );
    this.publish();
    return entry;
  }

  /** The door's answer for a run born THIS call: the row, and the same routed
   * ticket `terminal.create` answers, minted from the host's birth facts. */
  private ticketed(
    entry: ManagedEntry,
    principal: GrantPrincipal,
    terminals: TerminalService,
  ): AgentSpawnResult {
    const born = this.terminalHost?.born(entry.info.terminalSessionId);
    if (born === undefined) {
      throw new RpcCallError(
        "INTERNAL",
        "the agent's terminal was spawned outside the floor host; no ticket can be minted for it",
        false,
        { runtimeRunId: entry.info.runtimeRunId },
      );
    }
    return {
      session: this.summarize(entry),
      terminal: terminals.createOpenResult(principal, born),
    };
  }

  /** `runtime.resume` from a record: a new run in a new PTY with its own
   * identity; `replaced` names the PTY the new run takes the place of. */
  private async resumeFromRecord(
    record: AgentSessionRecord,
    cwdOverride: string | undefined,
    replaced: string | undefined,
  ): Promise<ManagedEntry> {
    const continuation: AgentContinuation = {
      providerId: record.continuation.providerId,
      nativeSessionId: record.continuation.nativeSessionId,
      implementation: record.continuation.implementation === "imposter" ? "imposter" : "native",
      ...(record.continuation.state !== undefined ? { state: record.continuation.state } : {}),
    };
    const cwd = cwdOverride ?? record.cwd;
    const identity = this.newIdentity();
    const result = await this.runtime.resume({
      continuation,
      cwd,
      ...(record.title !== undefined ? { title: record.title } : {}),
      ...(record.profileId !== undefined ? { profile: record.profileId } : {}),
      workspace: restoredWorkspaceRequest(record.workspace, record.cwd),
      creationRequestId: identity.creationRequestId,
      ingress: identity.ingress,
    });
    if (isSessionFailure(result)) throw this.sessionFailureToError(result, record.provider);
    return this.enter(result, { cwd, title: record.title, ...identity.launched(), replaced });
  }

  // ── internals: the re-attach (AR-4) ──

  /** The records the last fieldd left, against the PTYs this floor lists:
   * listed → attached at the next epoch (or held pending); unlisted → held
   * for one grace (a cell may not have published yet), then stamped. */
  private async reattach(rows: ReadonlyMap<string, TerminalInfo>): Promise<void> {
    let records: AgentSessionRecord[];
    try {
      records = this.records.list();
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.reattach_unreadable",
        "The session records could not be listed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }
    for (const record of records) {
      if (this.disposed) return;
      // MF-1f — a record STAMPED WITH AN EXIT whose PTY this floor still lists
      // is a dead pane the deck will show again after the restart, so the row
      // comes back with it (unobserved: no fieldd held this run's adapter).
      // A record already continued into a successor is NOT re-listed — the
      // successor is the row, and its husk pane is nobody's session.
      if (record.exited !== undefined) {
        const id = record.terminalSessionId;
        const row = id === undefined ? undefined : rows.get(id);
        if (row !== undefined && id !== undefined && record.reattach?.state !== "resumed") {
          this.exited.set(record.runtimeRunId, {
            record,
            terminalSessionId: id,
            terminal: row,
            since: this.now().toISOString(),
          });
          this.publish();
        }
        continue;
      }
      if (this.managed.has(record.runtimeRunId) || this.pending.has(record.runtimeRunId)) continue;
      const terminalId = record.terminalSessionId;
      const row = terminalId === undefined ? undefined : rows.get(terminalId);
      if (row === undefined || terminalId === undefined) {
        this.awaitBoot(record);
        continue;
      }
      try {
        await this.attachRecord(record, row, terminalId);
      } catch (error) {
        this.logger.warn(
          "fieldd.agents.reattach_failed",
          "A managed session could not be re-attached or held; its record stands",
          {
            runtimeRunId: record.runtimeRunId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  /** A record whose PTY the first inventory lacked (AR-4b): the same grace
   * the exit backstop gives, so a cell that had not published its rows yet
   * is not read as a dead process — then attached or stamped. */
  private awaitBoot(record: AgentSessionRecord): void {
    this.awaitingBoot.set(record.runtimeRunId, {
      record,
      deadline: Date.now() + EXIT_GRACE_MS,
    });
    if (this.awaitingSweep === null) {
      this.awaitingSweep = setTimeout(() => {
        this.awaitingSweep = null;
        if (this.disposed) return;
        const terminals = this.opts.terminals?.() ?? null;
        const listed = terminals?.observation() !== undefined ? terminals.list() : [];
        this.sweepAwaiting(new Map(listed.map((row) => [row.sessionId, row])));
      }, EXIT_GRACE_MS + 100);
      this.awaitingSweep.unref();
    }
  }

  private sweepAwaiting(rows: ReadonlyMap<string, TerminalInfo>): void {
    const now = Date.now();
    for (const [runtimeRunId, waiting] of [...this.awaitingBoot]) {
      const { record } = waiting;
      const terminalId = record.terminalSessionId;
      const row = terminalId === undefined ? undefined : rows.get(terminalId);
      if (row !== undefined && terminalId !== undefined) {
        this.awaitingBoot.delete(runtimeRunId);
        void this.attachRecord(record, row, terminalId).catch((error: unknown) => {
          this.logger.warn(
            "fieldd.agents.reattach_failed",
            "A managed session could not be re-attached or held; its record stands",
            { runtimeRunId, error: error instanceof Error ? error.message : String(error) },
          );
        });
        continue;
      }
      if (now < waiting.deadline) continue;
      this.awaitingBoot.delete(runtimeRunId);
      // the PTY did not outlive the gap (the floor restarted too, or the
      // process ended while no fieldd was there to see it): an unknown exit —
      // the record resumes from the door like any other
      this.records.stampExit(runtimeRunId, {
        at: this.now().toISOString(),
        exitCode: null,
        signal: null,
        reason: "unknown",
      });
      this.logger.info(
        "fieldd.agents.session_gone",
        "A managed session's PTY did not survive the restart; its record is stamped",
        { runtimeRunId, provider: record.provider },
      );
    }
  }

  /** One record, one live PTY: puppeteer's `attach` at the claim's epoch, or a
   * pending row when the adapter cannot. The fold is updated INSIDE the audited
   * act, so a ledger that fails after the effect leaves nothing orphaned. */
  private async attachRecord(
    record: AgentSessionRecord,
    row: TerminalInfo,
    terminalId: string,
  ): Promise<void> {
    if (this.disposed) return;
    // EL7 (AR-4b): the daemon re-attaches only to PTYs born on the agent cell.
    // A record naming any other terminal — a shell of the user's — is not a
    // run this daemon ever spawned, whatever the file says.
    if (row.cell?.workloadClass !== "agent") {
      this.logger.warn(
        "fieldd.agents.reattach_refused_cell",
        "A session record names a terminal that is not on the agent cell; not attached, not held",
        {
          runtimeRunId: record.runtimeRunId,
          sessionId: terminalId,
          ...(row.cell?.workloadClass !== undefined
            ? { workloadClass: row.cell.workloadClass }
            : {}),
        },
      );
      return;
    }
    if (record.profileId !== undefined && this.deleting.has(record.profileId)) {
      this.logger.info(
        "fieldd.agents.reattach_skipped_deleting",
        "A session record belongs to a persona being deleted; not attached",
        { runtimeRunId: record.runtimeRunId, profileId: record.profileId },
      );
      return;
    }
    // The durable claim is the authority on the epoch (AR-4b): a restore that
    // failed AFTER advancing it (upstream increments first) leaves the record
    // behind, and a boot that kept asking with the old epoch would be refused
    // every time. Re-sync before asking.
    let expectedEpoch = record.runtimeEpoch;
    let claimState: "allocated" | "terminal" | "missing" | "unread" = "allocated";
    if (record.creationRequestId !== undefined) {
      try {
        const claim = await this.claims.lookup({
          creationRequestId: record.creationRequestId,
          runtimeRunId: record.runtimeRunId,
        });
        if (claim === undefined) claimState = "missing";
        else if (claim.state === "terminal") claimState = "terminal";
        else if (claim.runtimeEpoch !== record.runtimeEpoch) {
          expectedEpoch = claim.runtimeEpoch;
          this.logger.info(
            "fieldd.agents.epoch_resynced",
            "The run's durable claim is ahead of its record; attaching at the claim's epoch",
            {
              runtimeRunId: record.runtimeRunId,
              recorded: record.runtimeEpoch,
              claim: claim.runtimeEpoch,
            },
          );
        }
      } catch (error) {
        claimState = "unread";
        this.logger.warn(
          "fieldd.agents.claim_unreadable",
          "The run's durable claim could not be read; attaching at the recorded epoch",
          {
            runtimeRunId: record.runtimeRunId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    const mutation: AuditMutation = {
      action: "agent.session.reattach",
      target: { kind: "agent-session", id: record.runtimeRunId },
      attrs: {
        provider: record.provider,
        sessionId: terminalId,
        runtimeEpoch: expectedEpoch,
      },
    };
    await this.audited(
      mutation,
      async () => {
        const outcome = await this.tryAttach(record, terminalId, expectedEpoch, claimState);
        if (outcome.state === "attached") {
          const entry = this.enter(outcome.agent, {
            cwd: record.cwd,
            title: record.title,
            creationRequestId: record.creationRequestId,
            ingress: record.ingress,
            reattached: { record, terminal: row },
          });
          return { state: "attached" as const, runtimeEpoch: entry.info.runtimeEpoch };
        }
        this.hold(record, row, terminalId, outcome.state, outcome.reason, expectedEpoch);
        return outcome;
      },
      (value) =>
        value.state === "attached"
          ? { outcome: "succeeded", attrs: { runtimeEpoch: value.runtimeEpoch } }
          : {
              outcome: "failed",
              reasonCode: value.state === "unsupported" ? "ATTACH_UNSUPPORTED" : "ATTACH_FAILED",
              attrs: { state: value.state, reason: value.reason },
            },
    );
  }

  private async tryAttach(
    record: AgentSessionRecord,
    terminalId: string,
    expectedEpoch: number,
    claimState: "allocated" | "terminal" | "missing" | "unread",
  ): Promise<
    { state: "attached"; agent: Agent } | { state: "failed" | "unsupported"; reason: string }
  > {
    if (record.creationRequestId === undefined) {
      return {
        state: "failed",
        reason:
          "the record predates the durable run identity (AR-4); there is no claim to restore against",
      };
    }
    if (claimState === "missing") {
      return {
        state: "failed",
        reason: "the record's creation request has no claim in the registry",
      };
    }
    if (claimState === "terminal") {
      return {
        state: "failed",
        reason:
          "the run's durable claim is terminal (a previous restore failed after advancing it); it can only be resumed into a new run",
      };
    }
    let result: CreateAgentSessionResult;
    try {
      result = await this.runtime.attach({
        agent: record.provider,
        creationRequestId: record.creationRequestId,
        runtimeRunId: record.runtimeRunId,
        expectedRuntimeEpoch: expectedEpoch,
        sessionId: record.continuation.nativeSessionId,
        terminalSessionId: terminalId,
        cwd: record.cwd,
        ...(record.ingress !== undefined
          ? { ingress: { port: record.ingress.port, token: record.ingress.token } }
          : {}),
        ...(record.profileId !== undefined ? { profile: record.profileId } : {}),
        workspace: restoredWorkspaceRequest(record.workspace, record.cwd),
      });
    } catch (error) {
      return { state: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    if (isSessionFailure(result)) {
      return {
        state: result.error.code === "ATTACH_UNSUPPORTED" ? "unsupported" : "failed",
        reason: result.error.message,
      };
    }
    const agent = this.runtime.agent(result.terminalSessionId);
    if (agent === undefined) {
      return { state: "failed", reason: "the runtime restored the run but holds no agent for it" };
    }
    return { state: "attached", agent };
  }

  /** A live PTY this boot could not re-attach to: the record says what
   * happened (and carries the claim's epoch, re-synced), the fold carries a
   * pending row, and resume-when-idle is armed. */
  private hold(
    record: AgentSessionRecord,
    row: TerminalInfo,
    terminalId: string,
    state: "failed" | "unsupported",
    reason: string,
    runtimeEpoch: number,
  ): void {
    const now = this.now().toISOString();
    const held: AgentSessionRecord = {
      ...record,
      runtimeEpoch,
      reattach: { state, at: now, reason },
      updatedAt: now,
    };
    this.records.write(held);
    if (this.disposed) return;
    const entry: PendingEntry = {
      record: held,
      reason,
      since: now,
      terminal: row,
      seenInInventory: true,
      resuming: false,
      failures: 0,
    };
    this.pending.set(record.runtimeRunId, entry);
    this.byTerminal.set(terminalId, record.runtimeRunId);
    this.logger.warn(
      "fieldd.agents.reattach_held",
      "A managed session's PTY survived the restart but could not be re-attached; held pending, resumes when idle",
      {
        runtimeRunId: record.runtimeRunId,
        provider: record.provider,
        sessionId: terminalId,
        state,
        reason,
      },
    );
    this.armPending(entry);
    this.publish();
  }

  private armPending(entry: PendingEntry): void {
    if (this.disposed || entry.resuming) return;
    const delay = Math.min(this.pollMs * 2 ** entry.failures, RESUME_POLL_MAX_MS);
    entry.poll = setTimeout(() => void this.pollPending(entry), delay);
    entry.poll.unref();
  }

  private async pollPending(entry: PendingEntry): Promise<void> {
    entry.poll = undefined;
    const runtimeRunId = entry.record.runtimeRunId;
    if (this.disposed || entry.resuming || this.pending.get(runtimeRunId) !== entry) return;
    const verdict = await this.idleVerdict(entry.record);
    if (this.disposed || entry.resuming || this.pending.get(runtimeRunId) !== entry) return;
    if (!verdict.answered) {
      entry.failures += 1;
      this.armPending(entry);
      return;
    }
    entry.failures = 0;
    if (!verdict.idle) {
      this.armPending(entry);
      return;
    }
    // AC-3 — the daemon's own act follows the same word as the human's door:
    // an agent the catalog does not show is not continued at idle; the row
    // stays pending, said once, and a later catalog can pick it up
    if (!this.catalog.isVisible(entry.record.provider)) {
      if (!this.idleWithheld.has(runtimeRunId)) {
        this.idleWithheld.add(runtimeRunId);
        this.logger.warn(
          "fieldd.agents.resume_when_idle_withheld",
          "A pending managed session is not resumed at idle: the catalog does not show its agent",
          { runtimeRunId, provider: entry.record.provider },
        );
      }
      return;
    }
    try {
      await this.track(this.replacePending(entry, undefined, "idle"));
    } catch (error) {
      // a refusal before the point of no return re-armed the poll itself;
      // a failure after it stamped the record, and the door's resume takes it
      this.logger.warn(
        "fieldd.agents.resume_when_idle_failed",
        "A pending managed session could not be resumed at idle",
        { runtimeRunId, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /** Whether the index says the session's conversation has been still long
   * enough: known to rosetta, with timestamped evidence older than the
   * threshold. NO evidence is NOT idle — a session the index has never read
   * (an unenrolled root, a provider it does not index) stays pending until a
   * person resumes it; an index that is down answers nothing (`answered:
   * false`, and the poll backs off); a stamp that is not a finite past time
   * is no evidence either. */
  private async idleVerdict(
    record: AgentSessionRecord,
  ): Promise<{ answered: boolean; idle: boolean }> {
    let facts: Awaited<ReturnType<IndexService["sessionByNativeId"]>>;
    try {
      facts = await this.opts.index.sessionByNativeId(record.continuation.nativeSessionId);
    } catch (error) {
      this.logger.debug(
        "fieldd.agents.idle_unanswered",
        "The index could not say whether a pending session is idle",
        {
          runtimeRunId: record.runtimeRunId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return { answered: false, idle: false };
    }
    if (facts === undefined || facts.activity === null) return { answered: true, idle: false };
    const now = this.now().getTime();
    const lastAt = facts.activity.lastAt;
    if (!Number.isFinite(lastAt) || lastAt > now) return { answered: true, idle: false };
    return { answered: true, idle: now - lastAt >= this.idleAfterMs };
  }

  /** Keep a replacement in flight where `dispose` can wait for it. */
  private track<T>(work: Promise<T>): Promise<T> {
    const tracked: Promise<unknown> = work.then(
      () => undefined,
      () => undefined,
    );
    this.replacements.add(tracked);
    void tracked.then(() => this.replacements.delete(tracked));
    return work;
  }

  /** The replacement: the old PTY terminated and GONE from the inventory —
   * a verdict, not a delay: a PTY that outlives the grace refuses the
   * replacement and the run stays pending — then the record stamped, then
   * the continuation resumed into a new run whose row names the PTY it
   * replaced and whose id the old record names in turn. Every throw before
   * the point of no return puts the entry back the way it was. A manual
   * resume is ledgered by its door with the caller as the actor; only the
   * daemon's own idle resume is ledgered here, as the system. */
  private async replacePending(
    entry: PendingEntry,
    cwdOverride: string | undefined,
    how: "idle" | "manual",
  ): Promise<ManagedEntry> {
    const { record } = entry;
    if (entry.resuming) {
      throw new RpcCallError("PRECONDITION_FAILED", "the session is being resumed already", false, {
        runtimeRunId: record.runtimeRunId,
        state: "resuming",
      });
    }
    if (this.disposed) {
      throw new RpcCallError("UNAVAILABLE", "the agent service is stopping", true, {
        service: "agents",
        state: "stopping",
        runtimeRunId: record.runtimeRunId,
      });
    }
    entry.resuming = true;
    if (entry.poll !== undefined) {
      clearTimeout(entry.poll);
      entry.poll = undefined;
    }
    if (entry.backstop !== undefined) {
      clearTimeout(entry.backstop);
      entry.backstop = undefined;
    }
    const restore = (): void => {
      entry.resuming = false;
      if (this.pending.get(record.runtimeRunId) === entry) this.armPending(entry);
    };
    const oldId = record.terminalSessionId;
    const work = async (): Promise<ManagedEntry> => {
      // ── before the point of no return: every throw restores the entry ──
      try {
        const terminals = this.requireTerminals();
        if (oldId !== undefined) {
          const row = this.listed(terminals, oldId) ? terminals.get(oldId) : undefined;
          if (row !== undefined) {
            if (row.cell?.workloadClass !== "agent") {
              throw new RpcCallError(
                "PRECONDITION_FAILED",
                "the session's terminal is not on the agent cell; it is not this daemon's to end",
                false,
                { runtimeRunId: record.runtimeRunId, sessionId: oldId, state: "not-agent-cell" },
              );
            }
            // 1. the old PTY leaves first, and is GONE before the new run is
            // born — two processes on one native session is the one thing a
            // resume must never make
            const ended = await terminals.terminate(oldId);
            const gone = ended.terminated
              ? await this.awaitGone(terminals, oldId, REPLACE_GRACE_MS)
              : true;
            if (!gone) {
              throw new RpcCallError(
                "PRECONDITION_FAILED",
                "the session's terminal did not exit within the grace; the run stays pending",
                true,
                {
                  runtimeRunId: record.runtimeRunId,
                  sessionId: oldId,
                  state: "terminal-alive",
                  graceMs: REPLACE_GRACE_MS,
                },
              );
            }
          }
        }
      } catch (error) {
        restore();
        throw error;
      }
      // ── the point of no return: the old PTY is gone ──
      this.pending.delete(record.runtimeRunId);
      if (oldId !== undefined) this.byTerminal.delete(oldId);
      const at = this.now().toISOString();
      this.records.write({
        ...record,
        reattach: { state: "resumed", at, ...(oldId !== undefined ? { replaced: oldId } : {}) },
        exited: { at, exitCode: null, signal: null, reason: "replaced" },
        updatedAt: at,
      });
      this.publish();
      // 2. the new run: the vendor's own conversation continued in a new PTY
      let next: ManagedEntry;
      try {
        next = await this.resumeFromRecord(record, cwdOverride, oldId);
      } catch (error) {
        // the old PTY is gone; the resume did not happen — the record says
        // exactly that, and the door's ordinary resume takes it next
        const now = this.now().toISOString();
        const current = this.records.read(record.runtimeRunId) ?? record;
        this.records.write({
          ...current,
          reattach: {
            state: "failed",
            at: now,
            reason: error instanceof Error ? error.message : String(error),
          },
          exited: { at: now, exitCode: null, signal: null, reason: "replace-failed" },
          updatedAt: now,
        });
        throw error;
      }
      // the old record names its successor
      const current = this.records.read(record.runtimeRunId);
      if (current !== undefined) {
        this.records.write({
          ...current,
          reattach: {
            state: "resumed",
            at: current.reattach?.at ?? at,
            ...(oldId !== undefined ? { replaced: oldId } : {}),
            replacedBy: next.info.runtimeRunId,
          },
          updatedAt: this.now().toISOString(),
        });
      }
      this.logger.info(
        "fieldd.agents.session_resumed",
        "A pending managed session was resumed into a new run",
        {
          runtimeRunId: record.runtimeRunId,
          next: next.info.runtimeRunId,
          provider: record.provider,
          how,
          ...(oldId !== undefined ? { replaced: oldId } : {}),
        },
      );
      return next;
    };
    if (how === "manual") return await work();
    const mutation: AuditMutation = {
      action: "agent.session.resume",
      target: { kind: "agent-session", id: record.runtimeRunId },
      attrs: {
        provider: record.provider,
        how,
        ...(oldId !== undefined ? { replaced: oldId } : {}),
      },
    };
    return await this.audited(mutation, work, (next) => ({
      outcome: "succeeded",
      attrs: { runtimeRunId: next.info.runtimeRunId, sessionId: next.info.terminalSessionId },
    }));
  }

  private closePending(
    runtimeRunId: string,
    exit: { exitCode: number | null; signal: string | null; reason: string },
  ): void {
    const entry = this.pending.get(runtimeRunId);
    if (entry === undefined || entry.resuming) return;
    if (entry.poll !== undefined) clearTimeout(entry.poll);
    if (entry.backstop !== undefined) clearTimeout(entry.backstop);
    this.pending.delete(runtimeRunId);
    if (entry.record.terminalSessionId !== undefined)
      this.byTerminal.delete(entry.record.terminalSessionId);
    this.records.stampExit(runtimeRunId, { at: this.now().toISOString(), ...exit });
    this.logger.info("fieldd.agents.session_exited", "Pending managed session's PTY exited", {
      runtimeRunId,
      provider: entry.record.provider,
      pending: true,
      reason: exit.reason,
      ...(exit.exitCode !== null ? { exitCode: exit.exitCode } : {}),
      ...(exit.signal !== null ? { signal: exit.signal } : {}),
    });
    this.publish();
  }

  /** Whether the floor lists the session — false, never a throw, before the
   * first observation (an unobserved floor lists nothing). */
  private listed(terminals: TerminalService, sessionId: string): boolean {
    return terminals.observation() !== undefined && terminals.get(sessionId) !== undefined;
  }

  /** True once the session has left the inventory; false when it is still
   * listed at the deadline — a verdict the caller must act on. */
  private async awaitGone(
    terminals: TerminalService,
    sessionId: string,
    ms: number,
  ): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (this.listed(terminals, sessionId)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return true;
  }

  /** The daemon's own act, in the ledger as the system actor when the daemon
   * has one; run plain otherwise (unit seams). */
  private audited<T>(
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describe: (value: T) => AuditMutationOutcome,
  ): Promise<T> {
    return this.opts.audit === undefined ? effect() : this.opts.audit(mutation, effect, describe);
  }

  /** MF-1f — hold an exited run's row while its pane is still on the floor.
   * Called at the exit this daemon watched; the restart path (`reattach`)
   * builds the same row from the record alone. */
  private holdExited(entry: ManagedEntry): void {
    if (this.disposed) return;
    const terminalSessionId = entry.info.terminalSessionId;
    const terminals = this.opts.terminals?.() ?? null;
    // The floor's OWN listing is the only evidence that the pane is there. No
    // observation yet (the link is down, the inventory has not arrived) is not
    // evidence of a pane, so the row is withdrawn as before.
    const listed =
      terminals !== null &&
      terminals.observation() !== undefined &&
      terminals.get(terminalSessionId) !== undefined;
    if (!listed) return;
    const record = this.records.read(entry.info.runtimeRunId);
    if (record === undefined) return; // no record, nothing to resume — no row
    this.exited.set(entry.info.runtimeRunId, {
      entry,
      record,
      terminalSessionId,
      terminal: entry.terminal,
      since: this.now().toISOString(),
    });
  }

  /** Withdraw an exited row and say why. Answers whether it was there. */
  private dropExited(runtimeRunId: string, why: string): boolean {
    const exited = this.exited.get(runtimeRunId);
    if (exited === undefined) return false;
    if (exited.backstop !== undefined) clearTimeout(exited.backstop);
    this.exited.delete(runtimeRunId);
    this.logger.info("fieldd.agents.exited_row_withdrawn", "An exited run's row left the fold", {
      runtimeRunId,
      sessionId: exited.terminalSessionId,
      why,
    });
    return true;
  }

  private summarizeExited(exited: ExitedEntry): AgentSessionSummary {
    // Seen by THIS daemon: the run keeps everything it had, with the pane
    // still joined and the continuation saying the conversation stopped.
    if (exited.entry !== undefined) {
      return this.summarize(exited.entry, {
        hosted: true,
        terminal: exited.terminal ?? exited.entry.terminal,
        record: { persisted: true, resumable: this.resumableNow(exited.record), exited: true },
      });
    }
    return this.withCatalogWord(
      summarizeExitedRecord({
        record: exited.record,
        label:
          this.runtime.providers().find((p) => p.id === exited.record.provider)?.label ??
          exited.record.provider,
        device: this.opts.deviceId?.() ?? "local",
        terminalSessionId: exited.terminalSessionId,
        terminal: exited.terminal,
        since: exited.since,
      }),
    );
  }

  /** Whether `agent.resume` would take this record right now: it exists and no
   * successor has already continued its conversation (AR-4b's one-run law). */
  private resumableNow(record: AgentSessionRecord): boolean {
    const current = this.records.read(record.runtimeRunId) ?? record;
    return current.reattach?.state !== "resumed";
  }

  private summarizePending(entry: PendingEntry): AgentSessionSummary {
    return this.withCatalogWord(
      summarizePending({
        record: entry.record,
        label:
          this.runtime.providers().find((p) => p.id === entry.record.provider)?.label ??
          entry.record.provider,
        device: this.opts.deviceId?.() ?? "local",
        terminal: entry.terminal,
        reason: entry.reason,
        since: entry.since,
      }),
    );
  }

  private onMonitorState(state: AgentMonitorState): void {
    const entry = this.managed.get(state.runtimeRunId);
    if (entry === undefined) return;
    this.applyMonitor(entry, state);
    this.publish();
  }

  private applyMonitor(entry: ManagedEntry, state: AgentMonitorState): void {
    const { mirror, issue } = mirrorOf(state);
    if (mirror === undefined && issue !== undefined && !entry.mirrorIssueLogged) {
      entry.mirrorIssueLogged = true;
      this.logger.warn(
        "fieldd.agents.monitor_shape_drift",
        "puppeteer's monitor state does not match the pinned mirror; the row reads unknown",
        { runtimeRunId: entry.info.runtimeRunId, schemaVersion: state.schemaVersion, issue },
      );
    }
    entry.mirror = mirror;
    const status = foldStatus(mirror);
    if (status !== entry.status) {
      entry.status = status;
      entry.stateChangedAt = mirror?.statusSince ?? this.now().toISOString();
    }
    const evidence = mirror?.freshness?.lastEvidenceAt;
    if (evidence !== undefined) entry.lastActivityAt = evidence;
    this.refreshContinuation(entry);
  }

  /** puppeteer learns the native session id after the launch; the record
   * follows it (a resume needs the id the vendor announced). */
  private refreshContinuation(entry: ManagedEntry): void {
    let info: AgentSessionInfo;
    try {
      info = entry.agent.info;
    } catch {
      return;
    }
    if (
      JSON.stringify(info.continuation) === JSON.stringify(entry.info.continuation) &&
      info.nativeSession.id === entry.info.nativeSession.id
    )
      return;
    entry.info = info;
    const record = this.records.read(info.runtimeRunId);
    if (record === undefined) return;
    this.records.write({
      ...record,
      continuation: { ...info.continuation },
      updatedAt: this.now().toISOString(),
    });
  }

  private onMonitorRemoved(runtimeRunId: string): void {
    const entry = this.managed.get(runtimeRunId);
    if (entry === undefined || entry.exiting) return;
    // puppeteer withdrew the run (terminal, or the runtime is disposing): the
    // row leaves; the record stays for a resume
    this.managed.delete(runtimeRunId);
    this.byTerminal.delete(entry.info.terminalSessionId);
    this.terminalHost?.forget(entry.info.terminalSessionId);
    this.publish();
  }

  private async closeRun(
    runtimeRunId: string,
    exit: {
      exitCode: number | null;
      signal: string | null;
      reason: string;
      requestedTermination?: string | null;
    },
  ): Promise<void> {
    const entry = this.managed.get(runtimeRunId);
    if (entry === undefined || entry.exiting) return;
    entry.exiting = true;
    if (entry.backstop !== undefined) {
      clearTimeout(entry.backstop);
      entry.backstop = undefined;
    }
    try {
      await this.runtime.handleProcessExit(entry.info.terminalSessionId, {
        exitCode: exit.exitCode,
        signal: exit.signal,
        reason: exit.reason,
        ...(exit.requestedTermination !== undefined
          ? { requestedTermination: exit.requestedTermination }
          : {}),
      });
    } catch (error) {
      this.logger.warn("fieldd.agents.exit_cleanup_failed", "Agent exit cleanup failed", {
        runtimeRunId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.records.stampExit(runtimeRunId, {
      at: this.now().toISOString(),
      exitCode: exit.exitCode,
      signal: exit.signal,
      reason: exit.reason,
    });
    this.managed.delete(runtimeRunId);
    this.byTerminal.delete(entry.info.terminalSessionId);
    this.terminalHost?.forget(entry.info.terminalSessionId);
    // MF-1f — the process is over, but the PANE may not be: while the floor
    // still lists this PTY the deck is showing it, so the row stays (carrying
    // the mirror's last state and the resume verb) until the pane goes.
    this.holdExited(entry);
    this.logger.info("fieldd.agents.session_exited", "Managed agent session exited", {
      runtimeRunId,
      provider: entry.info.provider.id,
      reason: exit.reason,
      ...(exit.exitCode !== null ? { exitCode: exit.exitCode } : {}),
      ...(exit.signal !== null ? { signal: exit.signal } : {}),
    });
    this.publish();
  }

  private async finishLogin(sessionId: string, how: "exited" | "timeout"): Promise<void> {
    const login = this.logins.get(sessionId);
    if (login === undefined) return;
    this.logins.delete(sessionId);
    clearTimeout(login.timer);
    this.terminalHost?.forget(sessionId);
    // MF-1g — the pane the vendor's login ran in. On an EXIT it is a husk and
    // is closed here, because MF-1g's `keep-until-explicit-close` stopped the
    // floor from doing it: the resume verb belongs to agent runs, and nothing
    // would ever come back for this one. On a TIMEOUT the pane is still LIVE
    // and the person may still be typing into it, so it is left exactly as
    // before — `reapAbandonedLoginPane` takes it when it does end.
    if (how === "exited") await this.reapLoginPane(sessionId);
    if (this.disposed) return;
    let outcome: string;
    try {
      const verified = await this.runtime.verifyProfile(login.profileId);
      outcome = isFailure(verified)
        ? `${verified.status}: ${verified.message}`
        : verified.loggedIn
          ? "logged-in"
          : "logged-out";
    } catch (error) {
      outcome = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.logger.info("fieldd.agents.login_finished", "Persona login pane ended; identity re-read", {
      profileId: login.profileId,
      sessionId,
      how,
      outcome,
    });
  }

  /** MF-1f — `overrides` is how an EXITED-but-hosted row reuses this: the pane
   * is still the floor's (`hosted`), and the continuation says the
   * conversation stopped and can be continued. Everything else — the mirror's
   * last state, the clocks, the title — is the run's own, unchanged. */
  private summarize(
    entry: ManagedEntry,
    overrides?: {
      hosted?: boolean;
      terminal?: TerminalInfo | undefined;
      record?: NonNullable<AgentSessionSummary["continuation"]>;
    },
  ): AgentSessionSummary {
    let observationLevel = "unknown";
    try {
      observationLevel = entry.agent.observationLevel;
    } catch {
      // a disposed adapter has no level to report
    }
    return this.withCatalogWord(
      summarizeManaged({
        info: entry.info,
        monitor: entry.mirror,
        observationLevel,
        device: this.opts.deviceId?.() ?? "local",
        terminal: overrides?.terminal ?? entry.terminal,
        hosted: overrides?.hosted ?? !entry.exiting,
        record: overrides?.record ?? {
          persisted: true,
          resumable: false,
          ...(entry.reattached ? { reattached: true } : {}),
        },
        replaced: entry.replaced,
        createdAt: entry.createdAt,
        stateChangedAt: entry.stateChangedAt,
        lastActivityAt: entry.lastActivityAt,
        title: entry.title,
      }),
    );
  }

  private publish(): void {
    if (this.disposed || this.publishTimer !== null || this.subscribers.size === 0) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.disposed) return;
      const rows = this.list();
      for (const emit of [...this.subscribers]) {
        try {
          emit(rows);
        } catch (error) {
          this.logger.warn("fieldd.agents.publish_failed", "A fold subscriber threw", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, PUBLISH_TICK_MS);
    this.publishTimer.unref();
  }

  private requireTerminals(): TerminalService {
    const terminals = this.opts.terminals?.() ?? null;
    if (terminals === null || this.terminalHost === null) {
      throw new RpcCallError(
        "UNAVAILABLE",
        "agent terminals are not hosted: this daemon lends no terminal floor",
        false,
        { service: "agents", state: "no-terminal-host" },
      );
    }
    return terminals;
  }

  /** puppeteer folds a host refusal into `AGENT_SESSION_CREATE_FAILED` with
   * the message; a typed refusal from the floor (no cell, the cap, an absent
   * executable) is worth more than the message, so the door says it. */
  private sessionFailureToError(failure: AgentSessionFailure, provider: string): RpcCallError {
    const details = { provider, code: failure.error.code, runtimeRunId: failure.runtimeRunId };
    switch (failure.error.code) {
      case "AGENT_NOT_FOUND":
      case "AGENT_PROFILE_NOT_FOUND":
        return new RpcCallError("NOT_FOUND", failure.error.message, false, details);
      case "AGENT_SESSION_CREATE_FAILED":
        return this.refusalOr(
          new RpcCallError("UNAVAILABLE", failure.error.message, true, {
            service: "agents",
            state: "spawn-failed",
            ...details,
          }),
        );
      case "RUNTIME_RESTORE_FAILED":
        return new RpcCallError("UNAVAILABLE", failure.error.message, true, {
          service: "agents",
          state: "restore-failed",
          ...details,
        });
      default:
        return new RpcCallError("PRECONDITION_FAILED", failure.error.message, false, details);
    }
  }

  /** The floor's own typed refusal, when the last spawn attempt had one. */
  private refusalOr(fallback: RpcCallError): RpcCallError {
    const refusal = this.terminalHost?.lastRefusal();
    return refusal ?? fallback;
  }

  // ── internals: personas ──

  /** The enrollment spec for a managed persona, or undefined when it cannot be
   * enrolled NOW (already named; the daemon is not ready; the provider's layout
   * root is not on the roll call; the adapter names a root outside the profile).
   * Creates the observation root when the adapter binds one level inside the
   * profile root that nothing has written yet (pi). */
  private async enrollmentSpecFor(profile: AgentProfile): Promise<EnrollRuntimeSpec | undefined> {
    const observationRoot = await this.runtime.profileObservationRoot(profile.id);
    if (observationRoot === undefined) return undefined;
    if (!within(profile.dataRoot, observationRoot)) {
      this.logger.warn(
        "fieldd.agents.observation_root_outside_profile",
        "Adapter names an observation root outside the persona's own root; not enrolled",
        { profileId: profile.id, provider: profile.provider },
      );
      return undefined;
    }
    if (this.opts.index.record().runtimes.some((rt) => rt.data_root === observationRoot)) {
      return undefined;
    }
    const kind = await this.kindFor(profile.provider);
    if (kind === undefined) return undefined;
    mkdirSync(observationRoot, { recursive: true, mode: 0o700 });
    return { kind, dataRoot: observationRoot, label: profile.label, profileId: profile.id };
  }

  /** rosetta's kind for a catalog id (AC-3): the row's seam column, with the
   * roll call as WITNESS — the daemon is ready and spells the row's layout
   * root under that kind. The witness is mandatory: the catalog is the SOURCE
   * of the kind, the roll call the proof this daemon registers it, and an
   * enrollment written on the catalog's word alone would be refused at the
   * daemon's next start. So while the daemon is not ready, or its census has
   * not answered within the wait (it fills in behind the ready line), or it
   * spells the root under another kind (or not at all), nothing is enrolled:
   * the persona is indexed at the next ready's reconcile (R4) and the drift
   * is logged. AC-D8 (agent-index.ts) stays for the record that outlives its
   * binary — a daemon swapped under an enrolled kind. */
  private async kindFor(provider: string): Promise<string | undefined> {
    const row = this.catalog.entry(provider);
    const kind = row?.seams.rosetta?.kind;
    if (
      row === undefined ||
      kind === undefined ||
      row.layoutRoot === null ||
      !row.offers.history ||
      !this.catalog.isVisible(provider)
    ) {
      this.logger.info(
        "fieldd.agents.kind_unresolved",
        "The catalog shows no history for this agent; personas of it are not indexed",
        { provider, ...(row !== undefined ? { status: row.status } : {}) },
      );
      return undefined;
    }
    const ready = (this.opts.supervisor?.health().phase ?? "unconfigured") === "ready";
    if (!ready) {
      this.logger.info(
        "fieldd.agents.kind_unwitnessed",
        "The index daemon is not ready; the persona is enrolled at its next ready",
        { provider, phase: this.opts.supervisor?.health().phase ?? "unconfigured" },
      );
      return undefined;
    }
    const witness = await this.opts.index.kindsByLayoutRoot({ waitMs: ROLL_CALL_WAIT_MS });
    const daemonKind = witness.get(row.layoutRoot);
    if (daemonKind !== kind) {
      this.logger.warn(
        "fieldd.agents.catalog_drift",
        witness.size === 0
          ? "The daemon is ready but its roll call did not answer in time; not enrolled until it does"
          : "The daemon's roll call disagrees with the catalog on this agent's kind; not enrolled",
        {
          provider,
          layoutRoot: row.layoutRoot,
          catalogKind: kind,
          daemonKind: daemonKind ?? null,
        },
      );
      return undefined;
    }
    return kind;
  }

  /** puppeteer's absolute native root in rosetta's spelling (`~/.claude`). */
  private tilde(path: string): string {
    const posix = (p: string) => p.split(sep).join("/");
    if (path === this.home) return "~";
    return path.startsWith(`${this.home}${sep}`)
      ? `~/${posix(path.slice(this.home.length + 1))}`
      : posix(path);
  }

  private async project(
    profile: AgentProfile,
    ids: ReadonlyMap<string, string>,
  ): Promise<AgentPersona> {
    const observationRoot = await this.runtime.profileObservationRoot(profile.id);
    const key =
      observationRoot === undefined
        ? undefined
        : profile.kind === "managed"
          ? observationRoot
          : this.tilde(observationRoot);
    const runtimeId = key === undefined ? undefined : ids.get(key);
    return {
      profileId: profile.id,
      provider: profile.provider,
      label: profile.label,
      kind: profile.kind,
      createdAt: profile.createdAt,
      ...(profile.identity !== undefined ? { identity: profile.identity } : {}),
      ...(runtimeId !== undefined ? { runtimeId } : {}),
    };
  }

  private projectInstalls(
    installations: readonly AgentInstallation[],
    record: AgentDistributionRecord | undefined,
  ): AgentInstall[] {
    // per provider: the record's choice when it names one of the installs,
    // else puppeteer's own resolution
    const chosen = new Map<string, string>();
    for (const install of installations) {
      const active = record?.providers[install.provider]?.activeExecutable;
      if (active !== undefined && (install.executable === active || install.realPath === active))
        chosen.set(install.provider, install.realPath);
    }
    return installations.map((install) => ({
      ...install,
      active: chosen.has(install.provider)
        ? chosen.get(install.provider) === install.realPath
        : install.active,
    }));
  }

  private requireMachineScope(): DistributionRecordStore {
    if (this.distribution === null) {
      throw new RpcCallError(
        "UNAVAILABLE",
        "this daemon has no machine scope (no VibeField root above its user root); agent distribution is read-only here",
        false,
        { service: "agents", state: "no-machine-scope" },
      );
    }
    return this.distribution;
  }
}

/** puppeteer's workspace request for a resumed run (Godview's own rule): a
 * clean worktree is destroyed when its session closes, so only the branch is
 * reliably reusable; a retained root is offered only when it still exists. */
function restoredWorkspaceRequest(
  workspace: AgentSessionSummary["workspace"] | undefined,
  cwd: string,
): AgentWorkspaceRequest {
  if (workspace === undefined) return { mode: "direct", path: cwd };
  const request: AgentWorkspaceRequest = {
    mode: workspace.mode as AgentWorkspaceRequest["mode"],
    path: workspace.sourcePath ?? cwd,
  };
  if ((workspace.mode === "worktree" || workspace.mode === "copy") && workspace.branch) {
    request.resumeBranch = workspace.branch;
    if (workspace.root !== undefined && existsSync(workspace.root))
      request.resumeRoot = workspace.root;
  }
  return request;
}

function isSessionFailure(
  value: SpawnAgentResult | CreateAgentSessionResult,
): value is AgentSessionFailure {
  return "error" in value && typeof (value as { error?: unknown }).error === "object";
}

function isFailure(value: AgentProfile | ProfileFailure | object): value is ProfileFailure {
  return "status" in value && typeof (value as { status?: unknown }).status === "string";
}

function failureToError(failure: ProfileFailure): RpcCallError {
  const details = {
    status: failure.status,
    ...(failure.provider !== undefined ? { provider: failure.provider } : {}),
  };
  switch (failure.status) {
    case "not-found":
      return new RpcCallError("NOT_FOUND", failure.message, false, details);
    case "unavailable":
      return new RpcCallError("UNAVAILABLE", failure.message, failure.retryable, {
        service: "agents",
        state: "provider-unavailable",
        ...details,
      });
    default:
      return new RpcCallError("PRECONDITION_FAILED", failure.message, false, details);
  }
}

/** The contract's receipt: the outcome, never the transcript path or the
 * before/after inspections (those stay in the machine record). */
function projectReceipt(receipt: UpdateReceipt): AgentUpdateReceipt {
  return {
    provider: receipt.provider,
    status: receipt.status,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt,
    ...(receipt.exitCode !== undefined ? { exitCode: receipt.exitCode } : {}),
    ...(receipt.message !== undefined ? { message: receipt.message } : {}),
  };
}

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonical(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : path;
  } catch {
    return path;
  }
}

export type { AgentProfileFailure };
