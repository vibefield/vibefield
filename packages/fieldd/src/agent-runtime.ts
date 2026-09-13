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
import type { BuiltinExecutableAgentKind } from "@vibecook/puppeteer-builtin-providers";
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
  createAgentRuntime,
  createFileCreationRequestRegistry,
  type ProfileStore,
  parseProfileRegistrySnapshot,
  type SpawnAgentResult,
} from "@vibecook/puppeteer-runtime";
import {
  AGENT_DISTRIBUTION_FORMAT,
  type AgentDistributionRecord,
  AgentDistributionRecord as AgentDistributionRecordSchema,
  type AgentInstall,
  type AgentListResult,
  type AgentMonitorMirror,
  type AgentPersona,
  type AgentProfileFailure,
  type AgentProvidersResult,
  type AgentResumeParams,
  type AgentSessionRecord,
  type AgentSessionSummary,
  type AgentSpawnParams,
  type AgentSpawnResult,
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
  summarizeManaged,
  summarizePending,
} from "./agent-sessions";
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
const RESUME_POLL_MS = 5_000;
const REPLACE_GRACE_MS = 5_000;

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
}

/** The `agents.*`/`agent.*` doors' service, the runtime's owner and the fold.
 * Auditing is the caller's (the daemon wraps the mutations in `audit.required`). */
export class AgentRuntimeService {
  /** puppeteer's runtime — typed as the open surface, not the built-in
   * family's: the composed providers are the built-ins plus whatever the
   * `providers` seam adds, and `spawn` takes any composed id. */
  readonly runtime: AgentRuntime;
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
  private readonly byTerminal = new Map<string, string>();
  /** the FIRST inventory of this boot is the re-attach; once */
  private reattachStarted = false;
  private readonly idleAfterMs: number;
  private readonly pollMs: number;
  /** login panes awaiting their exit, by the floor's session id */
  private readonly logins = new Map<string, { profileId: string; timer: NodeJS.Timeout }>();
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
      now: this.now,
      logger: this.logger,
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
    // The active executable per provider is bound at construction (RFC 006's
    // `executables`; puppeteer's own PUPPETEER_<KIND>_BIN convention is its
    // fallback). A `setActive` therefore reaches spawns from the next boot —
    // stated at the door's contract.
    const executables: Partial<Record<BuiltinExecutableAgentKind, string>> = {};
    if (this.distribution !== null) {
      for (const [provider, entry] of Object.entries(this.distribution.read().providers)) {
        if (entry.activeExecutable !== undefined)
          executables[provider as BuiltinExecutableAgentKind] = entry.activeExecutable;
      }
    }
    const builtin = createBuiltinProviders({ executables });
    const runtimeOptions: AgentRuntimeOptions = {
      host: this.host,
      defaultCwd: this.home,
      providers: opts.providers === undefined ? builtin : opts.providers(builtin),
      // AR-4 — the durable creation registry a run is restored against
      // (`agents/runs/`: the claims and the installation key, puppeteer's own
      // schema and modes, 0700/0600 — PU-8 again). Every birth names a
      // creation request so the next boot can re-attach at the next epoch.
      creationRegistry: createFileCreationRequestRegistry({
        directory: join(opts.userRoot, ...LAYOUT.AGENT_RUNS_DIR),
      }),
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

  /** What one can spawn AS here: every composed provider, whether an install
   * resolved for it, whether its adapter resumes, and its personas. */
  async providers(): Promise<AgentProvidersResult> {
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
    const providers = [];
    for (const descriptor of this.runtime.providers()) {
      const personas: AgentPersona[] = [];
      for (const profile of profiles) {
        if (profile.provider === descriptor.id) personas.push(await this.project(profile, ids));
      }
      providers.push({
        id: descriptor.id,
        label: descriptor.label,
        available: installs.some((install) => install.provider === descriptor.id),
        resumable: launch.get(descriptor.id)?.resume === true,
        personas,
      });
    }
    return { providers };
  }

  /** A managed session born in a PTY on this device's floor. The answer is
   * the fold's row at birth and the routed ticket the pane mounts. */
  async spawn(params: AgentSpawnParams, principal: GrantPrincipal): Promise<AgentSpawnResult> {
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
    const pending = this.pending.get(record.runtimeRunId);
    if (pending !== undefined) {
      const entry = await this.replacePending(pending, params.cwd, "manual");
      return this.ticketed(entry, principal, terminals);
    }
    const live = this.managed.get(record.runtimeRunId);
    const terminalAlive =
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
    const entry = await this.resumeFromRecord(record, params.cwd, undefined);
    return this.ticketed(entry, principal, terminals);
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
      for (const record of this.records.list()) {
        if (record.profileId === profileId) this.records.remove(record.runtimeRunId);
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
    const installations = await this.runtime.inspectInstallations({
      ...(provider !== undefined ? { providerId: provider } : {}),
      refresh: true,
    });
    return { installs: this.projectInstalls(installations, this.distribution?.read()) };
  }

  /** The agent's own oracle always; the declared network detectors only when
   * this call or the provider's recorded preference says so. */
  async releases(params: AgentsReleasesParams): Promise<AgentsReleasesResult> {
    const record = this.distribution?.read();
    const providers =
      params.provider !== undefined
        ? [params.provider]
        : this.runtime.distributionProviders().map((p) => p.id);
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
   * or before this fieldd) is enrolled now under the kind the roll call joins.
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
    this.subscribers.clear();
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
   * alive → attached at the next epoch (or held pending); gone → stamped. */
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
      if (record.exited !== undefined) continue;
      if (this.managed.has(record.runtimeRunId) || this.pending.has(record.runtimeRunId)) continue;
      const terminalId = record.terminalSessionId;
      const row = terminalId === undefined ? undefined : rows.get(terminalId);
      if (row === undefined || terminalId === undefined) {
        // the PTY did not outlive the gap (the floor restarted too, or the
        // process ended while no fieldd was there to see it): an unknown
        // exit — the record resumes from the door like any other
        this.records.stampExit(record.runtimeRunId, {
          at: this.now().toISOString(),
          exitCode: null,
          signal: null,
          reason: "unknown",
        });
        this.logger.info(
          "fieldd.agents.session_gone",
          "A managed session's PTY did not survive the restart; its record is stamped",
          { runtimeRunId: record.runtimeRunId, provider: record.provider },
        );
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

  /** One record, one live PTY: puppeteer's `attach` at the next epoch, or a
   * pending row when the adapter cannot (or the record predates AR-4). */
  private async attachRecord(
    record: AgentSessionRecord,
    row: TerminalInfo,
    terminalId: string,
  ): Promise<void> {
    const mutation: AuditMutation = {
      action: "agent.session.reattach",
      target: { kind: "agent-session", id: record.runtimeRunId },
      attrs: {
        provider: record.provider,
        sessionId: terminalId,
        runtimeEpoch: record.runtimeEpoch,
      },
    };
    const outcome = await this.audited(
      mutation,
      async () => {
        if (record.creationRequestId === undefined) {
          return {
            state: "failed" as const,
            reason:
              "the record predates the durable run identity (AR-4); there is no claim to restore against",
          };
        }
        let result: CreateAgentSessionResult;
        try {
          result = await this.runtime.attach({
            agent: record.provider,
            creationRequestId: record.creationRequestId,
            runtimeRunId: record.runtimeRunId,
            expectedRuntimeEpoch: record.runtimeEpoch,
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
          return {
            state: "failed" as const,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        if (isSessionFailure(result)) {
          return {
            state:
              result.error.code === "ATTACH_UNSUPPORTED"
                ? ("unsupported" as const)
                : ("failed" as const),
            reason: result.error.message,
          };
        }
        const agent = this.runtime.agent(result.terminalSessionId);
        if (agent === undefined) {
          return {
            state: "failed" as const,
            reason: "the runtime restored the run but holds no agent for it",
          };
        }
        return { state: "attached" as const, agent };
      },
      (value) =>
        value.state === "attached"
          ? { outcome: "succeeded", attrs: { runtimeEpoch: value.agent.info.runtimeEpoch } }
          : {
              outcome: "failed",
              reasonCode: value.state === "unsupported" ? "ATTACH_UNSUPPORTED" : "ATTACH_FAILED",
              attrs: { state: value.state, reason: value.reason },
            },
    );
    if (outcome.state === "attached") {
      this.enter(outcome.agent, {
        cwd: record.cwd,
        title: record.title,
        creationRequestId: record.creationRequestId,
        ingress: record.ingress,
        reattached: { record, terminal: row },
      });
      return;
    }
    this.hold(record, row, terminalId, outcome.state, outcome.reason);
  }

  /** A live PTY this boot could not re-attach to: the record says what
   * happened, the fold carries a pending row, and resume-when-idle is armed. */
  private hold(
    record: AgentSessionRecord,
    row: TerminalInfo,
    terminalId: string,
    state: "failed" | "unsupported",
    reason: string,
  ): void {
    const now = this.now().toISOString();
    const held: AgentSessionRecord = {
      ...record,
      reattach: { state, at: now, reason },
      updatedAt: now,
    };
    this.records.write(held);
    const entry: PendingEntry = {
      record: held,
      reason,
      since: now,
      terminal: row,
      seenInInventory: true,
      resuming: false,
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
    entry.poll = setTimeout(() => void this.pollPending(entry), this.pollMs);
    entry.poll.unref();
  }

  private async pollPending(entry: PendingEntry): Promise<void> {
    entry.poll = undefined;
    const runtimeRunId = entry.record.runtimeRunId;
    if (this.disposed || entry.resuming || this.pending.get(runtimeRunId) !== entry) return;
    const idle = await this.isIdle(entry.record);
    if (this.disposed || entry.resuming || this.pending.get(runtimeRunId) !== entry) return;
    if (!idle) {
      this.armPending(entry);
      return;
    }
    try {
      await this.replacePending(entry, undefined, "idle");
    } catch (error) {
      // the entry is gone either way (the old PTY was replaced, or the
      // terminate itself failed and the poll was re-armed); the record says
      // which, and the door's resume takes it next
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
   * person resumes it; an index that is down answers nothing, not "idle". */
  private async isIdle(record: AgentSessionRecord): Promise<boolean> {
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
      return false;
    }
    if (facts === undefined || facts.activity === null) return false;
    return this.now().getTime() - facts.activity.lastAt >= this.idleAfterMs;
  }

  /** The replacement: the old PTY terminated and gone from the inventory,
   * the record stamped, then the continuation resumed into a new run whose
   * row names the PTY it replaced. */
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
    entry.resuming = true;
    if (entry.poll !== undefined) {
      clearTimeout(entry.poll);
      entry.poll = undefined;
    }
    if (entry.backstop !== undefined) {
      clearTimeout(entry.backstop);
      entry.backstop = undefined;
    }
    const terminals = this.requireTerminals();
    const oldId = record.terminalSessionId;
    const mutation: AuditMutation = {
      action: "agent.session.resume",
      target: { kind: "agent-session", id: record.runtimeRunId },
      attrs: {
        provider: record.provider,
        how,
        ...(oldId !== undefined ? { replaced: oldId } : {}),
        ...(cwdOverride !== undefined ? { cwd: cwdOverride } : {}),
      },
    };
    return await this.audited(
      mutation,
      async () => {
        // 1. the old PTY leaves first, and is gone before the new run is born
        if (oldId !== undefined && this.listed(terminals, oldId)) {
          try {
            await terminals.terminate(oldId);
          } catch (error) {
            entry.resuming = false;
            this.armPending(entry);
            throw error;
          }
          await this.awaitGone(terminals, oldId, REPLACE_GRACE_MS);
        }
        // the pending row leaves the fold now; the floor's own exit for the
        // old PTY, when it lands, finds nothing — the record says why
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
          // the old PTY is gone and the record says so; the resume itself did
          // not happen — noted, and the door's ordinary resume takes it next
          const now = this.now().toISOString();
          const current = this.records.read(record.runtimeRunId) ?? record;
          this.records.write({
            ...current,
            reattach: {
              state: "failed",
              at: now,
              reason: error instanceof Error ? error.message : String(error),
            },
            updatedAt: now,
          });
          throw error;
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
      },
      (next) => ({
        outcome: "succeeded",
        attrs: { runtimeRunId: next.info.runtimeRunId, sessionId: next.info.terminalSessionId },
      }),
    );
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

  private async awaitGone(
    terminals: TerminalService,
    sessionId: string,
    ms: number,
  ): Promise<void> {
    const deadline = Date.now() + ms;
    while (this.listed(terminals, sessionId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

  private summarizePending(entry: PendingEntry): AgentSessionSummary {
    return summarizePending({
      record: entry.record,
      label:
        this.runtime.providers().find((p) => p.id === entry.record.provider)?.label ??
        entry.record.provider,
      device: this.opts.deviceId?.() ?? "local",
      terminal: entry.terminal,
      reason: entry.reason,
      since: entry.since,
    });
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

  private summarize(entry: ManagedEntry): AgentSessionSummary {
    let observationLevel = "unknown";
    try {
      observationLevel = entry.agent.observationLevel;
    } catch {
      // a disposed adapter has no level to report
    }
    return summarizeManaged({
      info: entry.info,
      monitor: entry.mirror,
      observationLevel,
      device: this.opts.deviceId?.() ?? "local",
      terminal: entry.terminal,
      hosted: !entry.exiting,
      record: {
        persisted: true,
        resumable: false,
        ...(entry.reattached ? { reattached: true } : {}),
      },
      replaced: entry.replaced,
      createdAt: entry.createdAt,
      stateChangedAt: entry.stateChangedAt,
      lastActivityAt: entry.lastActivityAt,
      title: entry.title,
    });
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

  /** rosetta's kind for a puppeteer provider: the provider's native layout
   * root, folded to `~/…`, looked up on the roll call. */
  private async kindFor(provider: string): Promise<string | undefined> {
    const kinds = await this.opts.index.kindsByLayoutRoot();
    if (kinds.size === 0) return undefined;
    const native = (await this.runtime.profiles(provider)).find((p) => p.kind === "native-default");
    if (native === undefined) return undefined;
    const layoutRoot = await this.runtime.profileObservationRoot(native.id);
    const kind = layoutRoot === undefined ? undefined : kinds.get(this.tilde(layoutRoot));
    if (kind === undefined) {
      this.logger.info(
        "fieldd.agents.kind_unresolved",
        "Provider's layout root is not on the index's roll call; personas of it are not indexed",
        { provider, ...(layoutRoot !== undefined ? { layoutRoot: this.tilde(layoutRoot) } : {}) },
      );
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
