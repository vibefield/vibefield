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
import type {
  BuiltinAgentRuntime,
  BuiltinExecutableAgentKind,
} from "@vibecook/puppeteer-builtin-providers";
import { createBuiltinProviders } from "@vibecook/puppeteer-builtin-providers";
import type {
  AgentHost,
  AgentInstallation,
  AgentProfile,
  ProfileFailure,
  UpdateReceipt,
} from "@vibecook/puppeteer-core";
import {
  type AgentRuntimeOptions,
  createAgentRuntime,
  type ProfileStore,
  parseProfileRegistrySnapshot,
} from "@vibecook/puppeteer-runtime";
import {
  AGENT_DISTRIBUTION_FORMAT,
  type AgentDistributionRecord,
  AgentDistributionRecord as AgentDistributionRecordSchema,
  type AgentInstall,
  type AgentPersona,
  type AgentProfileFailure,
  type AgentsInstallsResult,
  type AgentsProfilesCreateParams,
  type AgentsProfilesCreateResult,
  type AgentsProfilesDeleteResult,
  type AgentsProfilesListResult,
  type AgentsProfilesVerifyResult,
  type AgentsReleasesParams,
  type AgentsReleasesResult,
  type AgentsSetActiveParams,
  type AgentsSetActiveResult,
  type AgentsUpdateResult,
  type AgentUpdateReceipt,
  LAYOUT,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import { withUsersLock } from "@vibefield/users";
import type { EnrollRuntimeSpec, IndexService } from "./agent-index";
import { RpcCallError } from "./native-link";
import type { RosettadState, RosettadSupervisor } from "./rosettad-supervisor";

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
// call joins it to. Deleting one retires the runtime (rows kept, AR-D19),
// unregisters the profile and deletes the root with its credentials. Every
// daemon ready re-applies the record to the personas (R4), so a persona made
// while the index was down is indexed at the next ready, not lost.
//
// The machine scope (AR-D15/D16, R2/R6): `machine/agents/distribution.json` is
// the ONLY product state outside a user root — which executable new spawns use
// per provider, the release-check preferences, the last update receipt —
// rewritten under the root lock and published atomically. A daemon booted
// without a VibeField root above its user root (an embedded or unit daemon)
// has no machine scope and says so at the doors that would write it.
//
// What the doors never carry: a persona's root (a client names a persona by
// id; where fieldd keeps its root is fieldd's business), the daemon's origin
// (EL7), an update transcript (opaque, 0600, machine scope). Install rows are
// native evidence about the OS user's own executables and carry their paths.

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

/** The host puppeteer asks for a terminal from. AR-2 constructs the runtime
 * without one to lend: agent PTYs are born by `agent.spawn` over the native
 * floor with a clean, allow-listed environment (AR-3), and the persona login
 * pane rides the same path. Until then the refusal is typed and names the
 * slice — never a shell-door spawn with an inherited environment (EL7). */
export function noTerminalHost(): AgentHost {
  return {
    async spawnTerminal() {
      throw new RpcCallError(
        "UNAVAILABLE",
        "agent terminals are not hosted yet: agent.spawn and the persona login pane land with AR-3",
        false,
        { service: "agents", state: "no-terminal-host" },
      );
    },
    async automateTerminal() {
      return { accepted: false, reason: "no-terminal-host" };
    },
  };
}

export interface AgentRuntimeServiceOptions {
  /** this user's root (`FielddConfig.dataDir`): the registry and the managed roots live under it */
  userRoot: string;
  /** the VibeField root above it — the machine scope; null = none (embedded/unit daemons) */
  vibefieldRoot: string | null;
  index: IndexService;
  /** the index daemon's supervisor, for the reconcile on every ready; null = no daemon */
  supervisor: RosettadSupervisor | null;
  /** AR-3's terminal host; default: the typed refusal */
  host?: AgentHost;
  /** the OS user's home: puppeteer's default cwd and the `~` fold. Default os.homedir() */
  home?: string;
  /** test seam: the PATH the install inventory searches (default: the process PATH) */
  searchPath?: string;
  /** test seam: the fetch release detectors use (default: global fetch) */
  fetchFn?: typeof fetch;
  now?: () => Date;
  logger?: Logger;
}

/** The `agents.*` doors' service and the runtime's owner. Auditing is the
 * caller's (the daemon wraps the mutations in `audit.required`). */
export class AgentRuntimeService {
  readonly runtime: BuiltinAgentRuntime;
  private readonly distribution: DistributionRecordStore | null;
  private readonly rootsDir: string;
  private readonly home: string;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly onTransition: ((state: RosettadState) => void) | null;
  private reconciling: Promise<void> | null = null;
  /** personas mid-deletion: a reconcile racing the retire's bounce must not
   * re-enroll one it still finds in the registry */
  private readonly deleting = new Set<string>();
  private disposed = false;

  constructor(private readonly opts: AgentRuntimeServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
    this.home = opts.home ?? homedir();
    this.rootsDir = join(opts.userRoot, ...LAYOUT.AGENT_ROOTS_DIR);
    this.distribution =
      opts.vibefieldRoot === null
        ? null
        : new DistributionRecordStore({
            rootReal: canonical(opts.vibefieldRoot),
            now: this.now,
            logger: this.logger,
          });
    // The active executable per provider is bound at construction (RFC 006's
    // `executables`; puppeteer's own PUPPETEER_<KIND>_BIN convention is its
    // fallback). A `setActive` therefore reaches spawns from the next boot —
    // stated at the door's contract; AR-3 may move the choice to per-spawn.
    const executables: Partial<Record<BuiltinExecutableAgentKind, string>> = {};
    if (this.distribution !== null) {
      for (const [provider, entry] of Object.entries(this.distribution.read().providers)) {
        if (entry.activeExecutable !== undefined)
          executables[provider as BuiltinExecutableAgentKind] = entry.activeExecutable;
      }
    }
    const runtimeOptions: AgentRuntimeOptions = {
      host: opts.host ?? noTerminalHost(),
      defaultCwd: this.home,
      providers: createBuiltinProviders({ executables }),
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
      onError: (error) =>
        this.logger.warn("fieldd.agents.runtime_error", "Agent runtime reported an error", {
          error: error.message,
        }),
    };
    // createBuiltinAgentRuntime's own two steps, spelled out because it does
    // not thread `executables` through to the providers.
    this.runtime = createAgentRuntime(runtimeOptions) as BuiltinAgentRuntime;
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

  /** Unregister → retire → delete the root (topology §4 "Persona delete";
   * the registry goes first because the retire's bounce wakes the reconcile,
   * which must find no persona to re-enroll). With no sessions to stop yet
   * (AR-3), the order is otherwise the topology's. */
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

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.onTransition !== null) this.opts.supervisor?.off("transition", this.onTransition);
    try {
      await this.runtime.dispose();
    } catch (error) {
      this.logger.warn("fieldd.agents.dispose_failed", "Agent runtime did not dispose cleanly", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── internals ──

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
