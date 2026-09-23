import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { AgentProfile, ProfileFailure } from "@vibecook/puppeteer-core";
import type { AgentRuntime, ProfileSetInfo } from "@vibecook/puppeteer-runtime";
import {
  type AgentPersona,
  type AgentProfileSet,
  type AgentsProfileSetsCreateParams,
  type AgentsProfileSetsDeleteResult,
  type AgentsProfileSetsListResult,
  type AgentsProfileSetsRevealParams,
  type AgentsProfileSetsRevealResult,
  type AgentsProfileSetsSetResult,
  type AgentsProfileSetsUpdateParams,
  type AgentsProfilesCreateParams,
  type AgentsProfilesCreateResult,
  type AgentsProfilesDeleteResult,
  type AgentsProfilesListResult,
  type AgentsProfilesVerifyResult,
  LAYOUT,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { RevealPath } from "./agent-distribution";
import type { EnrollRuntimeSpec, IndexService } from "./agent-index";
import { RpcCallError } from "./native-link";

// AGENT PROFILES (AR-S2; AR-D23…D25) — the doors behind Settings → Agent
// Profiles, and the persona lifecycle beneath them.
//
// An Agent Profile is puppeteer's profile SET (RFC 006 "Profile sets"): a
// named place holding at most one sign-in per agent, one default among them,
// and the synthetic native set — "This Mac", each agent's own folder. The
// grouping, the default and the folders are puppeteer's; VibeField adds no
// grouping of its own. What fieldd owns is custody: puppeteer's registry lives
// at `users/<fuid>/agents/profiles.json` and every set's folder under
// `users/<fuid>/agents/profiles/<set>/` (LAYOUT.AGENT_PROFILE_SETS_DIR), so a
// profile's whole data — each agent's config, history, plugins and sign-in —
// is one folder under the VibeField user it belongs to (UA-D1). This Mac is
// the OS user's own folders (UA-D6), the same for every VibeField user.
//
// The persona path is AR-2's, per sign-in (topology §4): creating one
// allocates its root inside its profile's folder and enrolls the root its
// provider's own layout applies to — `observationRoot(profile)`, never
// `dataRoot` — under the kind rosetta's roll call joins it to. What changed is
// the end of a sign-in (AR-D25). SIGN OUT retires it at once — out of its
// profile and out of new spawns — and FINISHES it when no session runs under
// it any more: the vendor's own sign-out where the credential lives outside
// the root (Claude Code's Keychain item is keyed on the root's path, so
// deleting the root alone would leave it behind), the index runtime retired
// (rows kept, AR-D19), the root deleted, the persona unregistered. A session
// ending, and every boot after the re-attach, sweep for the ones waiting.
// DELETE a profile stops its sessions first (the record's words), then
// finishes every sign-in in it and deletes the folder.
//
// This Mac's identities are read, never stored (HOME decides them): by the
// product daemon after its boot inventory, on an explicit refresh, and for
// one persona after its login pane or its sign-out. Never automatically in a
// test or embedded daemon — a native identity read runs the vendor's own
// status command, and those must never be the developer's real agents.
//
// What the doors carry that AR-2's did not: a DISPLAY folder on the profiles
// feed (home-abbreviated, for the page to print beside Show in Finder). No
// door takes a path back — Show in Finder names a profile and an agent, and
// fieldd resolves the path it holds.

const PUBLISH_TICK_MS = 16;
/** vendor status commands at once while This Mac's identities are read */
const IDENTITY_READ_CONCURRENCY = 3;

/** What the profiles need from the fold (agent-runtime.ts owns the sessions). */
export interface PersonaSessions {
  /** Sessions still running under any of these personas: attached, pending
   * (alive, unobserved), or recorded mid-attach. */
  liveUnder(profileIds: ReadonlySet<string>): number;
  /** Stop every session under these personas (the floor's ladder); answers
   * how many were asked to stop. Their records go with them. */
  stopUnder(profileIds: ReadonlySet<string>): Promise<number>;
  /** Drop the records of sessions under these personas: nothing could resume
   * into a root that is gone. */
  forgetUnder(profileIds: ReadonlySet<string>): void;
  /** The persona's open login pane, when it has one. */
  signingIn(profileId: string): { sessionId: string; since: string } | undefined;
}

export interface AgentProfileServiceOptions {
  runtime: AgentRuntime;
  index: IndexService;
  sessions: PersonaSessions;
  /** this user's root: the registry and every profile folder live under it */
  userRoot: string;
  /** the OS user's home, for the `~` fold */
  home: string;
  /** Show in Finder, late-bound; null = no shell provider */
  revealPath: () => RevealPath | null;
  now: () => Date;
  logger: Logger;
}

export class AgentProfileService {
  /** puppeteer's `rootsDirectory`: every set's folder is allocated here */
  readonly profilesDir: string;
  /** where AR-1..S1 allocated `<provider>/<uuid>` roots — adopted in place,
   * and still ours to delete */
  private readonly legacyRootsDir: string;
  /** personas mid-removal: the reconcile a retire's bounce wakes must not
   * re-enroll one it still finds in the registry */
  private readonly deleting = new Set<string>();
  private reconciling: Promise<void> | null = null;
  private sweeping: Promise<void> | null = null;
  private sweepAgain = false;
  private reading: Promise<void> | null = null;
  private readonly subscribers = new Set<(frame: AgentsProfileSetsListResult) => void>();
  private publishTimer: NodeJS.Timeout | null = null;
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly opts: AgentProfileServiceOptions) {
    this.profilesDir = join(opts.userRoot, ...LAYOUT.AGENT_PROFILE_SETS_DIR);
    this.legacyRootsDir = join(opts.userRoot, ...LAYOUT.AGENT_ROOTS_DIR);
    // Every registry change — a set made or renamed, a sign-in added or
    // retired, an identity recorded — is a new frame.
    this.unsubscribe = opts.runtime.onProfilesChanged(() => this.publish());
  }

  // ── the feed ──

  /** Every Agent Profile, This Mac first, with its sign-ins. */
  async sets(): Promise<AgentsProfileSetsListResult> {
    const infos = await this.opts.runtime.profileSets();
    const ids = await this.opts.index.runtimeIdsByRoot();
    const sets: AgentProfileSet[] = [];
    for (const info of infos) sets.push(await this.projectSet(info, ids));
    return {
      sets,
      signIn: this.signInProviders(),
      signOut: this.opts.runtime
        .profileProviders()
        .filter((provider) => provider.support.signOut === true)
        .map((provider) => provider.id),
      reading: this.reading !== null,
    };
  }

  /** `agents.profileSets.subscribe`: whole snapshots, at most one per tick. */
  subscribe(emit: (frame: AgentsProfileSetsListResult) => void): () => void {
    this.subscribers.add(emit);
    return () => this.subscribers.delete(emit);
  }

  /** A frame is owed (a registry change, an identity read, a login pane). */
  publish(): void {
    if (this.disposed || this.subscribers.size === 0 || this.publishTimer !== null) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      void this.sets().then(
        (frame) => {
          for (const emit of this.subscribers) {
            try {
              emit(frame);
            } catch (error) {
              this.logger.warn(
                "fieldd.agents.profiles_emit_failed",
                "A profiles frame was not delivered",
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            }
          }
        },
        (error: unknown) =>
          this.logger.warn(
            "fieldd.agents.profiles_frame_failed",
            "The profiles frame could not be read",
            {
              error: error instanceof Error ? error.message : String(error),
            },
          ),
      );
    }, PUBLISH_TICK_MS);
    this.publishTimer.unref?.();
  }

  // ── Agent Profiles ──

  async createSet(params: AgentsProfileSetsCreateParams): Promise<AgentsProfileSetsSetResult> {
    const made = await this.opts.runtime.createProfileSet({
      label: params.label,
      ...(params.glyph !== undefined ? { glyph: params.glyph } : {}),
    });
    if (isFailure(made)) throw failureToError(made);
    let info = made;
    if (params.default === true) {
      const moved = await this.opts.runtime.setDefaultProfileSet(made.set.id);
      if (isFailure(moved)) throw failureToError(moved);
      info = moved;
    }
    this.logger.info("fieldd.agents.profile_created", "Agent profile created", {
      set: info.set.id,
      default: info.isDefault,
    });
    return { set: await this.projectSet(info, await this.opts.index.runtimeIdsByRoot()) };
  }

  /** Rename, re-mark, or make the default. The folder keeps its name: a path
   * is what a sign-in is keyed on. A rename relabels the sign-ins the index
   * names, so History says the new name (one daemon bounce). */
  async updateSet(params: AgentsProfileSetsUpdateParams): Promise<AgentsProfileSetsSetResult> {
    let info = await this.requireSet(params.set);
    if (params.label !== undefined || params.glyph !== undefined) {
      const updated = await this.opts.runtime.updateProfileSet({
        setId: params.set,
        ...(params.label !== undefined ? { label: params.label } : {}),
        ...(params.glyph !== undefined ? { glyph: params.glyph } : {}),
      });
      if (isFailure(updated)) throw failureToError(updated);
      if (params.label !== undefined && updated.set.label !== info.set.label) {
        await this.relabel(updated);
      }
      info = updated;
    }
    if (params.default === true && !info.isDefault) {
      const moved = await this.opts.runtime.setDefaultProfileSet(params.set);
      if (isFailure(moved)) throw failureToError(moved);
      info = moved;
    }
    return { set: await this.projectSet(info, await this.opts.index.runtimeIdsByRoot()) };
  }

  /** The record's P7 act: stop the sessions running under the profile, sign
   * every sign-in in it out, unregister it, delete its folder. */
  async deleteSet(setId: string): Promise<AgentsProfileSetsDeleteResult> {
    const info = await this.requireSet(setId);
    if (info.set.kind !== "managed") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "This Mac is each agent's own folder; it is never deleted",
        false,
        { set: setId },
      );
    }
    if (info.isDefault) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${info.set.label} is the default for new sessions. Make another profile the default first.`,
        false,
        { set: setId, reason: "default" },
      );
    }
    // every account the set holds — a retired one still waiting on its
    // sessions included: they stop now, like the rest
    const accounts = (await this.opts.runtime.profiles()).filter(
      (profile) => profile.kind === "managed" && profile.set === setId,
    );
    const ids = new Set(accounts.map((profile) => profile.id));
    for (const id of ids) this.deleting.add(id);
    try {
      const stopped = await this.opts.sessions.stopUnder(ids);
      // the vendor's own sign-out needs the registry entry, so it goes first
      for (const account of accounts) await this.signOutNatively(account);
      const removed = await this.opts.runtime.removeProfileSet(setId);
      if (isFailure(removed)) throw failureToError(removed);
      this.opts.sessions.forgetUnder(ids);
      await this.retireIndex(accounts);
      const directory = info.set.directory;
      if (directory !== undefined) this.deleteOwned(directory);
      // an account adopted from before sets keeps its root where it was
      for (const account of accounts) {
        if (directory === undefined || !within(directory, account.dataRoot)) {
          this.deleteOwned(account.dataRoot);
        }
      }
      this.logger.info("fieldd.agents.profile_deleted", "Agent profile deleted", {
        set: setId,
        signIns: accounts.length,
        stopped,
      });
      return { deleted: true, stopped };
    } finally {
      for (const id of ids) this.deleting.delete(id);
    }
  }

  /** Show in Finder: a profile's folder, or one agent's folder in it. */
  async reveal(params: AgentsProfileSetsRevealParams): Promise<AgentsProfileSetsRevealResult> {
    const info = await this.requireSet(params.set);
    let path: string | undefined;
    if (params.provider === undefined) {
      path = info.set.directory;
      if (path === undefined) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          info.set.kind === "native"
            ? "This Mac has no folder of its own; each agent's is shown on its page"
            : `${info.set.label} has no folder yet; it is made with its first sign-in`,
          false,
          { set: params.set },
        );
      }
    } else {
      const persona = info.profiles.find((profile) => profile.provider === params.provider);
      if (persona === undefined) {
        throw new RpcCallError(
          "NOT_FOUND",
          `${info.set.label} has no ${params.provider} sign-in`,
          false,
          { set: params.set, provider: params.provider },
        );
      }
      path = persona.dataRoot;
    }
    if (!existsSync(path)) {
      throw new RpcCallError("NOT_FOUND", "that folder is not on this Mac", false, {
        set: params.set,
      });
    }
    const reveal = this.opts.revealPath();
    if (reveal === null) {
      throw new RpcCallError("UNAVAILABLE", "no desktop shell is attached to reveal a path", true, {
        service: "shell",
        state: "no-shell-provider",
      });
    }
    await reveal(path);
    return { revealed: true };
  }

  // ── sign-ins (personas) ──

  async personas(provider?: string): Promise<AgentsProfilesListResult> {
    const profiles = await this.opts.runtime.profiles(provider);
    const ids = await this.opts.index.runtimeIdsByRoot();
    const personas: AgentPersona[] = [];
    for (const profile of profiles) {
      if (profile.retiredAt !== undefined) continue;
      personas.push(await this.project(profile, ids));
    }
    return { personas };
  }

  /** Allocate the agent's root inside the profile's folder and register it
   * (puppeteer), then enroll its observation root under the joined kind. An
   * enrollment that cannot happen now (daemon down, kind unknown to the roll
   * call) leaves the persona indexed later, not failed. */
  async createPersona(params: AgentsProfilesCreateParams): Promise<AgentsProfilesCreateResult> {
    const created = await this.opts.runtime.createProfile({
      providerId: params.provider,
      set: params.set,
    });
    if (isFailure(created)) throw failureToError(created);
    const spec = await this.enrollmentSpecFor(created);
    if (spec !== undefined) await this.opts.index.enrollRuntimes([spec]);
    return { persona: await this.project(created, await this.opts.index.runtimeIdsByRoot()) };
  }

  /** SIGN OUT (AR-D25). A managed sign-in is retired now and finished when no
   * session runs under it; This Mac's is signed out by the vendor's own
   * command in the agent's own folder, which is never deleted. */
  async signOut(profileId: string): Promise<AgentsProfilesDeleteResult> {
    const profile = await this.requirePersona(profileId);
    if (profile.kind !== "managed") {
      const outcome = await this.opts.runtime.signOutProfile(profileId);
      if (isFailure(outcome)) throw failureToError(outcome);
      // what the vendor's command left is the next identity read
      await this.verifyQuietly(profileId);
      this.logger.info("fieldd.agents.native_signed_out", "Signed out of an agent's own folder", {
        profileId,
        provider: profile.provider,
      });
      return { deleted: true };
    }
    if (profile.retiredAt === undefined) {
      const retired = await this.opts.runtime.retireProfile(profileId);
      if (isFailure(retired)) throw failureToError(retired);
    }
    const waiting = this.opts.sessions.liveUnder(new Set([profileId]));
    if (waiting > 0) {
      this.logger.info(
        "fieldd.agents.persona_signing_out",
        "Sign-in retired; waiting for its sessions",
        {
          profileId,
          provider: profile.provider,
          waiting,
        },
      );
      return { deleted: false, waiting };
    }
    await this.finish(profile);
    return { deleted: true };
  }

  /** Re-read the identity from the provider's own status surface; the result
   * is data either way (the adapter's honest failure rides beside the persona). */
  async verifyPersona(profileId: string): Promise<AgentsProfilesVerifyResult> {
    const profile = await this.requirePersona(profileId);
    const outcome = await this.opts.runtime.verifyProfile(profileId);
    const ids = await this.opts.index.runtimeIdsByRoot();
    if (isFailure(outcome)) {
      if (outcome.status === "not-found") throw failureToError(outcome);
      return {
        persona: await this.project(profile, ids),
        failure: { status: outcome.status, message: outcome.message, retryable: outcome.retryable },
      };
    }
    const fresh = (await this.opts.runtime.profile(profileId)) ?? profile;
    return { persona: await this.project(fresh, ids) };
  }

  /** Finish every retired sign-in no session runs under any more. Called
   * when a managed session ends and after the boot's re-attach; serialized,
   * and a call that lands mid-sweep runs the sweep once more after it. */
  sweep(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.sweeping !== null) {
      this.sweepAgain = true;
      return this.sweeping;
    }
    this.sweeping = (async () => {
      try {
        do {
          this.sweepAgain = false;
          const retired = (await this.opts.runtime.profiles()).filter(
            (profile) =>
              profile.kind === "managed" &&
              profile.retiredAt !== undefined &&
              !this.deleting.has(profile.id),
          );
          for (const profile of retired) {
            if (this.opts.sessions.liveUnder(new Set([profile.id])) > 0) continue;
            await this.finish(profile);
          }
        } while (this.sweepAgain && !this.disposed);
      } catch (error) {
        this.logger.warn(
          "fieldd.agents.sweep_failed",
          "Signed-out sign-ins were not all finished",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      } finally {
        this.sweeping = null;
      }
    })();
    return this.sweeping;
  }

  // ── This Mac's identities ──

  /** Read who is signed in to each installed agent's own folder, for the
   * agents whose adapter can say. Frames land as each read does. */
  readNativeIdentities(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.reading !== null) return this.reading;
    this.reading = (async () => {
      this.publish();
      try {
        let installed = new Set<string>();
        try {
          installed = new Set(
            (await this.opts.runtime.inspectInstallations({})).map((install) => install.provider),
          );
        } catch (error) {
          this.logger.warn("fieldd.agents.inventory_failed", "Agent install inventory failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        const readable = new Set(this.signInProviders());
        const natives = (await this.opts.runtime.profiles()).filter(
          (profile) =>
            profile.kind === "native-default" &&
            installed.has(profile.provider) &&
            readable.has(profile.provider),
        );
        const started = Date.now();
        await eachAtMost(natives, IDENTITY_READ_CONCURRENCY, async (profile) => {
          if (this.disposed) return;
          await this.verifyQuietly(profile.id);
        });
        this.logger.info("fieldd.agents.identities_read", "This Mac's sign-ins read", {
          agents: natives.length,
          ms: Date.now() - started,
        });
      } finally {
        this.reading = null;
        this.publish();
      }
    })();
    return this.reading;
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
        for (const profile of await this.opts.runtime.profiles()) {
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

  /** A persona being finished or deleted right now: a record naming it is not
   * re-attached (its root is about to go). */
  isDeleting(profileId: string): boolean {
    return this.deleting.has(profileId);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.subscribers.clear();
    if (this.publishTimer !== null) clearTimeout(this.publishTimer);
    this.publishTimer = null;
  }

  // ── the projection ──

  /** A persona as the doors carry it: never its root. `withFolder` adds the
   * display folder the profiles feed prints (home-abbreviated). */
  async project(
    profile: AgentProfile,
    ids: ReadonlyMap<string, string>,
    withFolder = false,
  ): Promise<AgentPersona> {
    const observationRoot = await this.opts.runtime.profileObservationRoot(profile.id);
    const key =
      observationRoot === undefined
        ? undefined
        : profile.kind === "managed"
          ? observationRoot
          : this.tilde(observationRoot);
    const runtimeId = key === undefined ? undefined : ids.get(key);
    const signingIn = this.opts.sessions.signingIn(profile.id);
    return {
      profileId: profile.id,
      provider: profile.provider,
      label: profile.label,
      kind: profile.kind,
      createdAt: profile.createdAt,
      ...(profile.identity !== undefined ? { identity: profile.identity } : {}),
      ...(runtimeId !== undefined ? { runtimeId } : {}),
      ...(profile.set !== undefined ? { set: profile.set } : {}),
      ...(withFolder ? { folder: this.tilde(profile.dataRoot) } : {}),
      ...(signingIn !== undefined ? { signingIn } : {}),
    };
  }

  private async projectSet(
    info: ProfileSetInfo,
    ids: ReadonlyMap<string, string>,
  ): Promise<AgentProfileSet> {
    const personas: AgentPersona[] = [];
    for (const profile of info.profiles) personas.push(await this.project(profile, ids, true));
    return {
      id: info.set.id,
      kind: info.set.kind,
      label: info.set.label,
      ...(info.set.glyph !== undefined ? { glyph: info.set.glyph } : {}),
      default: info.isDefault,
      createdAt: info.set.createdAt,
      ...(info.set.directory !== undefined ? { folder: this.tilde(info.set.directory) } : {}),
      personas,
    };
  }

  /** The providers whose adapter can run a sign-in AND read back who signed in. */
  private signInProviders(): string[] {
    return this.opts.runtime
      .profileProviders()
      .filter((provider) => provider.support.supported && provider.support.identity !== "none")
      .map((provider) => provider.id);
  }

  /** puppeteer's absolute path in the `~` spelling (`~/.claude`). */
  private tilde(path: string): string {
    const home = this.opts.home;
    const posix = (p: string) => p.split(sep).join("/");
    if (path === home) return "~";
    return path.startsWith(`${home}${sep}`)
      ? `~/${posix(path.slice(home.length + 1))}`
      : posix(path);
  }

  // ── internals ──

  private get logger(): Logger {
    return this.opts.logger;
  }

  private async requireSet(setId: string): Promise<ProfileSetInfo> {
    const info = await this.opts.runtime.profileSet(setId);
    if (info === undefined) {
      throw new RpcCallError("NOT_FOUND", `no agent profile ${setId}`, false, { set: setId });
    }
    return info;
  }

  private async requirePersona(profileId: string): Promise<AgentProfile> {
    const profile = await this.opts.runtime.profile(profileId);
    if (profile === undefined || profile.retiredAt !== undefined) {
      throw new RpcCallError("NOT_FOUND", `no persona ${profileId}`, false, { profileId });
    }
    return profile;
  }

  /** The end of a sign-in: the vendor's sign-out, the registry, the index,
   * the root — the registry before the retire, because the retire's bounce
   * wakes the reconcile, which must find no persona to re-enroll. */
  private async finish(profile: AgentProfile): Promise<void> {
    this.deleting.add(profile.id);
    try {
      await this.signOutNatively(profile);
      this.opts.sessions.forgetUnder(new Set([profile.id]));
      await this.opts.runtime.removeProfile(profile.id);
      await this.retireIndex([profile]);
      this.deleteOwned(profile.dataRoot);
      this.logger.info("fieldd.agents.persona_signed_out", "Sign-in finished and removed", {
        profileId: profile.id,
        provider: profile.provider,
        ...(profile.set !== undefined ? { set: profile.set } : {}),
      });
    } finally {
      this.deleting.delete(profile.id);
    }
  }

  /** The vendor's own sign-out before a root goes; a refusal is logged, never
   * fatal — the root is still deleted, and what may remain (a Keychain item)
   * is named in the log for a person to clear. */
  private async signOutNatively(profile: AgentProfile): Promise<void> {
    let outcome: Awaited<ReturnType<AgentRuntime["signOutProfile"]>>;
    try {
      outcome = await this.opts.runtime.signOutProfile(profile.id);
    } catch (error) {
      outcome = {
        status: "unavailable",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    if (isFailure(outcome)) {
      this.logger.warn(
        "fieldd.agents.native_sign_out_failed",
        "The agent's own sign-out did not run; a credential kept outside the folder may remain",
        { profileId: profile.id, provider: profile.provider, status: outcome.status },
      );
    }
  }

  /** Watch off, rows kept, the persona still named (AR-D19). */
  private async retireIndex(profiles: readonly AgentProfile[]): Promise<void> {
    for (const row of this.opts.index.record().runtimes) {
      const owner = profiles.find(
        (profile) => row.profile_id === profile.id || within(profile.dataRoot, row.data_root),
      );
      if (owner === undefined) continue;
      try {
        await this.opts.index.retireEnrolled({ kind: row.kind, dataRoot: row.data_root });
      } catch (error) {
        this.logger.warn(
          "fieldd.agents.index_retire_failed",
          "A sign-in's index runtime was not retired",
          {
            profileId: owner.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  /** A rename reaches the index: the enrolled sign-ins of the profile carry
   * its new name (the record's label is what History shows). */
  private async relabel(info: ProfileSetInfo): Promise<void> {
    const specs: EnrollRuntimeSpec[] = [];
    for (const row of this.opts.index.record().runtimes) {
      const member = info.profiles.find((profile) => row.profile_id === profile.id);
      if (member === undefined) continue;
      specs.push({
        kind: row.kind,
        dataRoot: row.data_root,
        label: info.set.label,
        profileId: member.id,
      });
    }
    if (specs.length > 0) await this.opts.index.enrollRuntimes(specs);
  }

  /** Delete a directory ONLY if it is one fieldd allocated for this user: a
   * profile folder or a sign-in root under `agents/profiles/`, or a root
   * adopted from `agents/roots/`. Never a provider's own folder. */
  private deleteOwned(path: string): void {
    const owned =
      (within(this.profilesDir, path) && path !== this.profilesDir) ||
      (within(this.legacyRootsDir, path) && path !== this.legacyRootsDir);
    if (!owned) {
      this.logger.warn(
        "fieldd.agents.persona_root_kept",
        "A folder outside this user's profiles; left in place",
        {
          folder: this.tilde(path),
        },
      );
      return;
    }
    rmSync(path, { recursive: true, force: true });
  }

  private async verifyQuietly(profileId: string): Promise<void> {
    try {
      await this.opts.runtime.verifyProfile(profileId);
    } catch (error) {
      this.logger.warn("fieldd.agents.verify_failed", "An identity could not be read", {
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** The enrollment spec for a managed persona, or undefined when it cannot be
   * enrolled NOW (already named; the daemon is not ready; the provider's layout
   * root is not on the roll call; the adapter names a root outside the profile).
   * Creates the observation root when the adapter binds one level inside the
   * profile root that nothing has written yet (pi). */
  private async enrollmentSpecFor(profile: AgentProfile): Promise<EnrollRuntimeSpec | undefined> {
    const observationRoot = await this.opts.runtime.profileObservationRoot(profile.id);
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
    const native = (await this.opts.runtime.profiles(provider)).find(
      (p) => p.kind === "native-default",
    );
    if (native === undefined) return undefined;
    const layoutRoot = await this.opts.runtime.profileObservationRoot(native.id);
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
}

/** Run `task` over `items`, at most `limit` at a time. */
async function eachAtMost<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await task(item);
    }
  });
  await Promise.all(lanes);
}

export function isFailure(value: object): value is ProfileFailure {
  return "status" in value && typeof (value as { status?: unknown }).status === "string";
}

export function failureToError(failure: ProfileFailure): RpcCallError {
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

export function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
