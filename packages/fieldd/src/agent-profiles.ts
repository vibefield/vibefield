import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type AgentProfile,
  type ProfileFailure,
  type ProfileSetPlans,
  profileSetPlans,
} from "@vibecook/puppeteer-core";
import type { AgentRuntime, ProfileSetInfo } from "@vibecook/puppeteer-runtime";
import {
  type AgentPersona,
  type AgentProfileSet,
  type AgentSignInRoute,
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
import type { AuditMutation, AuditMutationOutcome } from "./audit-service";
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
/** the only folder names fieldd ever allocates, and so the only ones it deletes */
const SET_FOLDER = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const SIGN_IN_FOLDER = /^[a-z0-9][a-z0-9-]{0,62}-[0-9a-f]{8}$/;
const LEGACY_PROVIDER_FOLDER = /^[a-z0-9][a-z0-9-]{0,62}$/;
const LEGACY_ROOT_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the profiles need from the fold (agent-runtime.ts owns the sessions). */
export interface PersonaSessions {
  /** Sessions still running under any of these personas: attached, pending
   * (alive, unobserved), or recorded mid-attach. */
  liveUnder(profileIds: ReadonlySet<string>): number;
  /** Stop every session under these personas (the floor's ladder, login
   * panes included) and wait for them to be gone: `stopped` were asked to
   * stop, `remaining` still run (or could not be known) at the deadline.
   * Their records go only when nothing remains. */
  stopUnder(profileIds: ReadonlySet<string>): Promise<{ stopped: number; remaining: number }>;
  /** End the login panes open on these personas, and wait for them to go. */
  endLogins(profileIds: ReadonlySet<string>): Promise<void>;
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
  /** the ledger's system-actor entry: a sign-out finished after its sessions
   * ended is the daemon's own act on a person's data; absent = logged only */
  audit?: <T>(
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describe?: (value: T) => AuditMutationOutcome,
  ) => Promise<T>;
  now: () => Date;
  logger: Logger;
}

/** What a sign-out does to an agent's credential, from its adapter. */
type CredentialClaim = "signed-out" | "in-folder" | "unknown";

export class AgentProfileService {
  /** puppeteer's `rootsDirectory`: every set's folder is allocated here */
  readonly profilesDir: string;
  /** where AR-1..S1 allocated `<provider>/<uuid>` roots — adopted in place,
   * and still ours to delete */
  private readonly legacyRootsDir: string;
  /** personas mid-removal: the reconcile a retire's bounce wakes must not
   * re-enroll one it still finds in the registry */
  private readonly deleting = new Set<string>();
  /** profiles mid-delete: nothing new is signed in to them */
  private readonly deletingSets = new Set<string>();
  /** frames are read asynchronously; only the newest read is emitted */
  private frameSeq = 0;
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

  /** Every Agent Profile, This Mac first, with its sign-ins and the plans it
   * runs on (AR-S2c: puppeteer reads them from the identities; nothing here
   * is stored or matched). */
  async sets(): Promise<AgentsProfileSetsListResult> {
    const infos = await this.opts.runtime.profileSets();
    const plans = this.plansOf(infos);
    const ids = await this.opts.index.runtimeIdsByRoot();
    const sets: AgentProfileSet[] = [];
    for (const info of infos) sets.push(await this.projectSet(info, ids, plans.get(info.set.id)));
    const routes: Record<string, AgentSignInRoute[]> = {};
    for (const provider of this.opts.runtime.profileProviders()) {
      const declared = provider.support.signInRoutes;
      if (!provider.support.supported || declared === undefined) continue;
      routes[provider.id] = declared.map((route) => ({
        id: route.id,
        label: route.label,
        ...(route.service !== undefined ? { service: { ...route.service } } : {}),
      }));
    }
    return {
      sets,
      signIn: this.signInProviders(),
      identity: this.identityProviders(),
      signOut: this.opts.runtime
        .profileProviders()
        .filter((provider) => provider.support.signOut === true)
        .map((provider) => provider.id),
      reading: this.reading !== null,
      routes,
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
      const seq = ++this.frameSeq;
      void this.sets().then(
        (frame) => {
          // a read that an older one overtook is stale: the newer was emitted
          if (this.disposed || seq !== this.frameSeq) return;
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
    return { set: await this.projectOne(info) };
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
    return { set: await this.projectOne(info) };
  }

  /** The record's P7 act: stop the sessions running under the profile, sign
   * every sign-in in it out, unregister it, delete its folder. In that order,
   * and each step only once the one before it held: nothing is deleted while
   * a process still runs in the folder or a vendor's sign-out failed. */
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
    if (this.deletingSets.has(setId)) {
      throw new RpcCallError("PRECONDITION_FAILED", `${info.set.label} is being deleted`, true, {
        set: setId,
        state: "deleting",
      });
    }
    this.deletingSets.add(setId);
    // every account the set holds, a retired one still waiting included
    const members = () =>
      this.opts.runtime
        .profiles()
        .then((profiles) =>
          profiles.filter((profile) => profile.kind === "managed" && profile.set === setId),
        );
    let ids = new Set<string>();
    try {
      // 1. out of new work first: no spawn, resume or login lands in it while it goes
      for (const account of await members()) {
        if (account.retiredAt !== undefined) continue;
        const retired = await this.opts.runtime.retireProfile(account.id);
        if (isFailure(retired)) throw failureToError(retired);
      }
      const accounts = await members();
      ids = new Set(accounts.map((profile) => profile.id));
      for (const id of ids) this.deleting.add(id);
      // 2. the sessions stop, and are GONE before anything is deleted
      const { stopped, remaining } = await this.opts.sessions.stopUnder(ids);
      if (remaining > 0) {
        throw new RpcCallError(
          "UNAVAILABLE",
          `${remaining} session${remaining === 1 ? "" : "s"} under ${info.set.label} did not stop; nothing was deleted. Its sign-ins are signed out and finish when those sessions end.`,
          true,
          { service: "agents", state: "sessions-running", set: setId, remaining },
        );
      }
      // 3. the vendors' own sign-outs, which need the registry entries
      for (const account of accounts) {
        const outcome = await this.signOutNatively(account);
        if (outcome.failed !== undefined) {
          throw new RpcCallError(
            "UNAVAILABLE",
            `${outcome.failed} Nothing was deleted; try again.`,
            true,
            { service: "agents", state: "sign-out-failed", set: setId, provider: account.provider },
          );
        }
      }
      // 4. unregister — what the registry removed is what goes, a sign-in
      // added since the list above included
      const removed = await this.opts.runtime.removeProfileSet(setId);
      if (isFailure(removed)) throw failureToError(removed);
      const gone = new Set(removed.profiles.map((profile) => profile.id));
      for (const id of gone) this.deleting.add(id);
      this.opts.sessions.forgetUnder(gone);
      await this.retireIndex(removed.profiles);
      // 5. the folder, and any adopted root that sat outside it
      const directory = removed.set.directory ?? info.set.directory;
      if (directory !== undefined) this.deleteOwned(directory);
      for (const account of removed.profiles) {
        if (directory === undefined || !within(directory, account.dataRoot)) {
          this.deleteOwned(account.dataRoot);
        }
      }
      for (const id of gone) ids.add(id);
      this.logger.info("fieldd.agents.profile_deleted", "Agent profile deleted", {
        set: setId,
        signIns: removed.profiles.length,
        stopped,
      });
      return { deleted: true, stopped };
    } finally {
      for (const id of ids) this.deleting.delete(id);
      this.deletingSets.delete(setId);
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
    if (this.deletingSets.has(params.set)) {
      throw new RpcCallError("PRECONDITION_FAILED", "that profile is being deleted", false, {
        set: params.set,
        state: "deleting",
      });
    }
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
   * command in the agent's own folder, which is never deleted. A login pane
   * open on it is ended first: the sign-out takes the root that login would
   * write into. `credential` says what the sign-out does to the credential. */
  async signOut(profileId: string): Promise<AgentsProfilesDeleteResult> {
    const profile = await this.requirePersona(profileId);
    const credential = this.credentialClaim(profile.provider);
    await this.opts.sessions.endLogins(new Set([profileId]));
    if (profile.kind !== "managed") {
      const outcome = await this.opts.runtime.signOutProfile(profileId);
      // what the vendor's command left is the next identity read, either way
      await this.verifyQuietly(profileId);
      if (isFailure(outcome)) throw failureToError(outcome);
      this.logger.info("fieldd.agents.native_signed_out", "Signed out of an agent's own folder", {
        profileId,
        provider: profile.provider,
      });
      return { deleted: true, credential: "signed-out" };
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
        { profileId, provider: profile.provider, waiting },
      );
      return { deleted: false, waiting, credential };
    }
    const failed = await this.finish(profile);
    if (failed !== undefined) {
      // the sign-in is out of its profile and out of new work; its folder and
      // the credential stay until the vendor's sign-out works (the next sweep)
      throw new RpcCallError("UNAVAILABLE", `${failed} Its folder is kept until it works.`, true, {
        service: "agents",
        state: "sign-out-failed",
        profileId,
        provider: profile.provider,
      });
    }
    return { deleted: true, credential };
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
            if (this.disposed) break;
            if (this.opts.sessions.liveUnder(new Set([profile.id])) > 0) continue;
            // one sign-in's trouble never holds the others back
            try {
              await this.audited(
                {
                  action: "agents.profiles.finish",
                  target: { kind: "agent-persona", id: profile.id },
                  attrs: {
                    provider: profile.provider,
                    ...(profile.set !== undefined ? { set: profile.set } : {}),
                  },
                },
                () => this.finish(profile),
                (failed) =>
                  failed === undefined
                    ? { outcome: "succeeded" }
                    : { outcome: "failed", attrs: { reason: "sign-out-failed" } },
              );
            } catch (error) {
              this.logger.warn(
                "fieldd.agents.finish_failed",
                "A signed-out sign-in was not finished",
                {
                  profileId: profile.id,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            }
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
        if (this.disposed) return;
        const readable = new Set(this.identityProviders());
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
      } catch (error) {
        // callers fire and forget (the boot warm, a refresh): a runtime that
        // stopped mid-read or a registry that cannot be read is a warning, never
        // an unhandled rejection that ends the daemon
        if (!this.disposed) {
          this.logger.warn("fieldd.agents.identities_unread", "This Mac's sign-ins were not read", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
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
          if (
            profile.kind !== "managed" ||
            profile.retiredAt !== undefined ||
            this.deleting.has(profile.id)
          )
            continue;
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

  /** puppeteer's reading of every set's plans, by set id. It reads all the
   * sets at once, because a plan says where else its account is used. */
  private plansOf(infos: readonly ProfileSetInfo[]): Map<string, ProfileSetPlans> {
    const read = profileSetPlans(infos, this.opts.runtime.profileProviders());
    return new Map(read.map((set) => [set.setId, set]));
  }

  /** One set as a door answers it, its plans read against every set. */
  private async projectOne(info: ProfileSetInfo): Promise<AgentProfileSet> {
    const plans = this.plansOf(await this.opts.runtime.profileSets());
    return this.projectSet(info, await this.opts.index.runtimeIdsByRoot(), plans.get(info.set.id));
  }

  private async projectSet(
    info: ProfileSetInfo,
    ids: ReadonlyMap<string, string>,
    plans?: ProfileSetPlans,
  ): Promise<AgentProfileSet> {
    const personas: AgentPersona[] = [];
    for (const profile of info.profiles) {
      const persona = await this.project(profile, ids, true);
      const holds = plans?.holdings[profile.id];
      personas.push(holds === undefined ? persona : { ...persona, holds });
    }
    return {
      id: info.set.id,
      kind: info.set.kind,
      label: info.set.label,
      ...(info.set.glyph !== undefined ? { glyph: info.set.glyph } : {}),
      default: info.isDefault,
      createdAt: info.set.createdAt,
      ...(info.set.directory !== undefined ? { folder: this.tilde(info.set.directory) } : {}),
      personas,
      plans: plans?.plans ?? [],
    };
  }

  /** The providers whose adapter can run a sign-in in a folder here. */
  private signInProviders(): string[] {
    return this.opts.runtime
      .profileProviders()
      .filter((provider) => provider.support.supported)
      .map((provider) => provider.id);
  }

  /** Of those, the ones whose adapter reads back WHO signed in. */
  private identityProviders(): string[] {
    return this.opts.runtime
      .profileProviders()
      .filter((provider) => provider.support.supported && provider.support.identity !== "none")
      .map((provider) => provider.id);
  }

  /** What signing an agent out does to its credential, as its adapter says. */
  private credentialClaim(providerId: string): CredentialClaim {
    const support = this.opts.runtime.profileProviders().find((p) => p.id === providerId)?.support;
    if (support?.signOut === true) return "signed-out";
    return support?.credential === "root" ? "in-folder" : "unknown";
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

  /** The end of a sign-in: the vendor's sign-out, the root, the records, the
   * registry, the index — each only once the step before it held. A vendor
   * sign-out that failed where the credential lives outside the root keeps
   * everything (retired) for the next sweep; a root that could not be deleted
   * keeps the registry entry, so nothing forgets a folder still on disk. The
   * registry goes before the index retire, because the retire's bounce wakes
   * the reconcile, which must find no persona to re-enroll. Answers why it
   * stopped, or undefined when the sign-in is gone. */
  private async finish(profile: AgentProfile): Promise<string | undefined> {
    this.deleting.add(profile.id);
    try {
      const outcome = await this.signOutNatively(profile);
      if (outcome.failed !== undefined) return outcome.failed;
      this.deleteOwned(profile.dataRoot);
      this.opts.sessions.forgetUnder(new Set([profile.id]));
      await this.opts.runtime.removeProfile(profile.id);
      await this.retireIndex([profile]);
      this.logger.info("fieldd.agents.persona_signed_out", "Sign-in finished and removed", {
        profileId: profile.id,
        provider: profile.provider,
        ...(profile.set !== undefined ? { set: profile.set } : {}),
        credential: outcome.claim,
      });
      return undefined;
    } finally {
      this.deleting.delete(profile.id);
    }
  }

  /** The vendor's own sign-out before a root goes. Where the adapter keeps
   * the credential outside the root (a keychain item keyed on its path), a
   * sign-out that did not take is a FAILURE: deleting the root would leave a
   * live credential nothing could ever sign out again. Elsewhere the root's
   * deletion is the sign-out — or, where the adapter never said, all that
   * can be claimed. */
  private async signOutNatively(
    profile: AgentProfile,
  ): Promise<{ claim: CredentialClaim; failed?: string }> {
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
    if (!isFailure(outcome)) {
      return {
        claim: outcome.ran ? "signed-out" : outcome.credential === "root" ? "in-folder" : "unknown",
      };
    }
    this.logger.warn(
      "fieldd.agents.native_sign_out_failed",
      "The agent's own sign-out did not complete; its folder and credential are kept",
      { profileId: profile.id, provider: profile.provider, status: outcome.status },
    );
    return {
      claim: "signed-out",
      failed: `${this.labelOf(profile.provider)}'s own sign-out did not complete (${outcome.message}).`,
    };
  }

  private labelOf(providerId: string): string {
    return (
      this.opts.runtime.profileProviders().find((p) => p.id === providerId)?.label ?? providerId
    );
  }

  /** The daemon's own act, in the ledger as the system actor when there is one. */
  private audited<T>(
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describe: (value: T) => AuditMutationOutcome,
  ): Promise<T> {
    return this.opts.audit === undefined ? effect() : this.opts.audit(mutation, effect, describe);
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

  /** Delete a directory ONLY if it is one fieldd allocated for this user, by
   * its exact shape: a profile folder `agents/profiles/<set>`, a sign-in root
   * `agents/profiles/<set>/<provider>-<8 hex>`, or a root adopted from
   * `agents/roots/<provider>/<uuid>` — resolved, and never through a symlink,
   * so a tampered registry path (`profiles/.`, `profiles/work/..`) can never
   * name the container or anything beyond it. Never a provider's own folder.
   * A folder that is already gone is fine; one that could not be deleted
   * throws, so its owner keeps it registered. */
  private deleteOwned(path: string): void {
    const target = resolve(path);
    if (!this.ownedShape(target)) {
      this.logger.warn(
        "fieldd.agents.persona_root_kept",
        "A folder outside this user's profiles; left in place",
        { folder: this.tilde(target) },
      );
      return;
    }
    if (!existsSync(target)) return;
    if (lstatSync(target).isSymbolicLink() || !this.ownedShape(realpathSync(target), true)) {
      this.logger.warn(
        "fieldd.agents.persona_root_kept",
        "A profile folder that resolves elsewhere; left in place",
        { folder: this.tilde(target) },
      );
      return;
    }
    rmSync(target, { recursive: true, force: true });
  }

  /** Whether a resolved path has one of the shapes fieldd allocates. `real`
   * compares against the containers' real paths (a VibeField root reached
   * through a symlink is still ours; a folder that leaves it is not). */
  private ownedShape(target: string, real = false): boolean {
    const container = (dir: string) => (real && existsSync(dir) ? realpathSync(dir) : resolve(dir));
    const inProfiles = relative(container(this.profilesDir), target);
    if (inProfiles !== "" && !inProfiles.startsWith("..") && !isAbsolute(inProfiles)) {
      const parts = inProfiles.split(sep);
      if (parts.length === 1) return SET_FOLDER.test(parts[0]!);
      if (parts.length === 2) return SET_FOLDER.test(parts[0]!) && SIGN_IN_FOLDER.test(parts[1]!);
      return false;
    }
    const inLegacy = relative(container(this.legacyRootsDir), target);
    if (inLegacy !== "" && !inLegacy.startsWith("..") && !isAbsolute(inLegacy)) {
      const parts = inLegacy.split(sep);
      return (
        parts.length === 2 &&
        LEGACY_PROVIDER_FOLDER.test(parts[0]!) &&
        LEGACY_ROOT_FOLDER.test(parts[1]!)
      );
    }
    return false;
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
