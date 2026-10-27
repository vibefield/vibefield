/**
 * The profile service's own guards (AR-S2b), on stubs: what it will delete,
 * what it keeps when a vendor's sign-out fails, and that a fire-and-forget
 * read never becomes an unhandled rejection. The doors, the real runtime and
 * the real floor are agent-runtime.test.ts and agent-session.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_CATALOG_READERS, AgentsProfileSetsListResult, LAYOUT } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import type { AgentProfile } from "@vibefield/puppeteer-core";
import type { AgentRuntime, ProfileSetInfo } from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexService } from "../src/agent-index";
import { AgentProfileService, type PersonaSessions } from "../src/agent-profiles";
import { ProfileDraftsStore } from "../src/profile-drafts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function userRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fieldd-agent-profiles-"));
  roots.push(root);
  return root;
}

const NOW = "2026-09-23T10:00:00.000Z";

function account(root: string, set: string, id: string, provider = "claude"): AgentProfile {
  return {
    id,
    provider,
    label: set,
    kind: "managed",
    dataRoot: join(root, ...LAYOUT.AGENT_PROFILE_SETS_DIR, set, `${provider}-0b7e2c4d`),
    createdAt: NOW,
    set,
  };
}

/** A runtime that holds one registry in memory; `overrides` replace any door. */
function stubRuntime(
  state: { sets: ProfileSetInfo[]; profiles: AgentProfile[] },
  overrides: Partial<Record<keyof AgentRuntime, unknown>> = {},
): AgentRuntime {
  const runtime = {
    onProfilesChanged: () => () => undefined,
    profileProviders: () => [
      {
        id: "claude",
        label: "Claude Code",
        support: {
          supported: true,
          identity: "native-status",
          sharedSurfaces: [],
          signOut: true,
          credential: "external",
        },
      },
      {
        id: "kimi",
        label: "Kimi",
        support: { supported: true, identity: "none", sharedSurfaces: [] },
      },
    ],
    profileSets: async () => state.sets,
    profileSet: async (id: string) => state.sets.find((info) => info.set.id === id),
    profiles: async () => state.profiles,
    profile: async (id: string) => state.profiles.find((profile) => profile.id === id),
    retireProfile: async (id: string) => {
      const profile = state.profiles.find((entry) => entry.id === id)!;
      profile.retiredAt = NOW;
      return profile;
    },
    signOutProfile: async () => ({ ran: true }),
    removeProfile: async (id: string) => {
      state.profiles = state.profiles.filter((entry) => entry.id !== id);
      return true;
    },
    removeProfileSet: async (id: string) => {
      const info = state.sets.find((entry) => entry.set.id === id)!;
      const profiles = state.profiles.filter((entry) => entry.set === id);
      state.sets = state.sets.filter((entry) => entry.set.id !== id);
      state.profiles = state.profiles.filter((entry) => entry.set !== id);
      return { set: info.set, profiles };
    },
    verifyProfile: async () => ({ loggedIn: false, verifiedAt: NOW }),
    profileObservationRoot: async () => undefined,
    inspectInstallations: async () => [],
    ...overrides,
  };
  return runtime as unknown as AgentRuntime;
}

const index = {
  runtimeIdsByRoot: async () => new Map<string, string>(),
  record: () => ({ runtimes: [] }),
  retireEnrolled: async () => ({}),
  enrollRuntimes: async () => ({}),
  kindsByLayoutRoot: async () => new Map<string, string>(),
} as unknown as IndexService;

const idleSessions: PersonaSessions = {
  liveUnder: () => 0,
  stopUnder: async () => ({ stopped: 0, remaining: 0 }),
  endLogins: async () => undefined,
  forgetUnder: () => undefined,
  signingIn: () => undefined,
};

function service(
  root: string,
  runtime: AgentRuntime,
  sessions: PersonaSessions = idleSessions,
  drafts?: ProfileDraftsStore,
) {
  const logger = createNoopLogger();
  const warn = vi.spyOn(logger, "warn");
  const profiles = new AgentProfileService({
    runtime,
    catalog: AGENT_CATALOG_READERS,
    index,
    supervisor: null,
    sessions,
    userRoot: root,
    home: "/Users/nobody",
    revealPath: () => null,
    ...(drafts !== undefined ? { drafts } : {}),
    now: () => new Date(NOW),
    logger,
  });
  return { profiles, warn };
}

/** AO-5a — the drafts note, under the user root as fieldd keeps it. */
function draftsAt(root: string): { drafts: ProfileDraftsStore; path: string } {
  const path = join(root, ...LAYOUT.AGENT_PROFILE_DRAFTS_FILE);
  return { drafts: new ProfileDraftsStore({ path, now: () => new Date(NOW) }), path };
}

function managedSet(root: string, id: string, directory?: string): ProfileSetInfo {
  return {
    set: {
      id,
      kind: "managed",
      label: id,
      createdAt: NOW,
      directory: directory ?? join(root, ...LAYOUT.AGENT_PROFILE_SETS_DIR, id),
    },
    isDefault: false,
    profiles: [],
  };
}

describe("AgentProfileService — what it deletes, and what it keeps", () => {
  it("never deletes a tampered folder: the container itself, a parent, or a path through a symlink", async () => {
    const root = userRoot();
    const profilesDir = join(root, ...LAYOUT.AGENT_PROFILE_SETS_DIR);
    const keep = join(profilesDir, "keep", "claude-0b7e2c4d");
    mkdirSync(keep, { recursive: true });
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(profilesDir, "linked"));
    for (const directory of [
      `${profilesDir}/.`,
      `${profilesDir}/keep/..`,
      `${profilesDir}/../roots`,
      join(profilesDir, "linked"),
      join(root, "outside"),
    ]) {
      const state = { sets: [managedSet(root, "tampered", directory)], profiles: [] };
      const { profiles, warn } = service(root, stubRuntime(state));
      await expect(profiles.deleteSet("tampered")).resolves.toMatchObject({ deleted: true });
      expect(warn).toHaveBeenCalledWith(
        "fieldd.agents.persona_root_kept",
        expect.any(String),
        expect.any(Object),
      );
    }
    expect(existsSync(keep)).toBe(true);
    expect(existsSync(outside)).toBe(true);
  });

  it("keeps a sign-in's folder when the vendor's own sign-out fails, and says so", async () => {
    const root = userRoot();
    const work = account(root, "work", "p-claude");
    mkdirSync(work.dataRoot, { recursive: true });
    const state = { sets: [managedSet(root, "work")], profiles: [work] };
    const failing = stubRuntime(state, {
      signOutProfile: async () => ({
        status: "unavailable",
        message: "`claude auth logout` did not complete",
        retryable: true,
      }),
    });
    const { profiles } = service(root, failing);
    await expect(profiles.signOut("p-claude")).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: expect.stringContaining("Its folder is kept until it works"),
    });
    // out of its profile and new work, but its folder and registry entry stay
    expect(existsSync(work.dataRoot)).toBe(true);
    expect(state.profiles.map((profile) => [profile.id, profile.retiredAt])).toEqual([
      ["p-claude", NOW],
    ]);

    // a profile delete refuses the same way, before anything is removed
    await expect(profiles.deleteSet("work")).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: expect.stringContaining("Nothing was deleted"),
    });
    expect(state.sets).toHaveLength(1);
    expect(existsSync(work.dataRoot)).toBe(true);
  });

  it("refuses a profile delete while its sessions still run, deleting nothing", async () => {
    const root = userRoot();
    const work = account(root, "work", "p-kimi", "kimi");
    mkdirSync(work.dataRoot, { recursive: true });
    const state = { sets: [managedSet(root, "work")], profiles: [work] };
    const stubborn: PersonaSessions = {
      ...idleSessions,
      liveUnder: () => 1,
      stopUnder: async () => ({ stopped: 1, remaining: 1 }),
    };
    const { profiles } = service(root, stubRuntime(state), stubborn);
    await expect(profiles.deleteSet("work")).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: expect.stringContaining("did not stop; nothing was deleted"),
    });
    expect(state.sets).toHaveLength(1);
    expect(existsSync(work.dataRoot)).toBe(true);
    // its sign-ins are signed out, and finish when those sessions end
    expect(state.profiles[0]?.retiredAt).toBe(NOW);
  });

  it("answers what a sign-out does to the credential, from the adapter's own word", async () => {
    const root = userRoot();
    const kimi = account(root, "work", "p-kimi", "kimi");
    mkdirSync(kimi.dataRoot, { recursive: true });
    const state = { sets: [managedSet(root, "work")], profiles: [kimi] };
    const { profiles } = service(
      root,
      stubRuntime(state, { signOutProfile: async () => ({ ran: false, credential: "unknown" }) }),
    );
    // Kimi never said where it keeps one: the folder goes, and nothing more is claimed
    await expect(profiles.signOut("p-kimi")).resolves.toEqual({
      deleted: true,
      credential: "unknown",
    });
    expect(existsSync(kimi.dataRoot)).toBe(false);
  });

  it("finishes the other signed-out sign-ins when one of them cannot be", async () => {
    const root = userRoot();
    const stuck = { ...account(root, "work", "p-stuck"), retiredAt: NOW };
    const done = { ...account(root, "play", "p-done", "kimi"), retiredAt: NOW };
    mkdirSync(stuck.dataRoot, { recursive: true });
    mkdirSync(done.dataRoot, { recursive: true });
    const state = {
      sets: [managedSet(root, "work"), managedSet(root, "play")],
      profiles: [stuck, done],
    };
    const runtime = stubRuntime(state, {
      signOutProfile: async (id: string) =>
        id === "p-stuck"
          ? { status: "unavailable", message: "keychain locked", retryable: true }
          : { ran: false, credential: "unknown" },
    });
    const { profiles } = service(root, runtime);
    await profiles.sweep();
    expect(state.profiles.map((profile) => profile.id)).toEqual(["p-stuck"]);
    expect(existsSync(stuck.dataRoot)).toBe(true);
    expect(existsSync(done.dataRoot)).toBe(false);
  });

  it("never lets a fire-and-forget read of This Mac's sign-ins reject, whatever the runtime does", async () => {
    const root = userRoot();
    const state = { sets: [], profiles: [] };
    const gone = stubRuntime(state, {
      profiles: async () => {
        throw new Error("agent runtime is disposed");
      },
    });
    const { profiles, warn } = service(root, gone);
    await expect(profiles.readNativeIdentities()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "fieldd.agents.identities_unread",
      expect.any(String),
      expect.objectContaining({ error: "agent runtime is disposed" }),
    );
  });
});

describe("AgentProfileService — what each profile runs on (AR-S2c)", () => {
  const ANTHROPIC = { id: "anthropic", label: "Anthropic" };
  const OPENAI = { id: "openai", label: "OpenAI" };
  const NOUS = { id: "nous", label: "Nous Research" };
  const read = { verifiedAt: NOW, source: { kind: "native-status", stability: "documented" } };

  it("carries puppeteer's plans on each set, what each sign-in holds, and the ways to add one", async () => {
    const root = userRoot();
    const claude = {
      ...account(root, "work", "w-claude"),
      identity: { loggedIn: true, email: "kim@work.example", plan: "max", ...read },
    } as AgentProfile;
    const hermes = {
      ...account(root, "work", "w-hermes", "hermes"),
      identity: {
        loggedIn: true,
        method: "oauth",
        signIns: [
          {
            service: NOUS,
            method: "oauth",
            subscription: true,
            inUse: true,
            email: "kim@work.example",
          },
          { service: ANTHROPIC, method: "oauth", subscription: true },
          { service: OPENAI, method: "api-key" },
        ],
        ...read,
      },
    } as AgentProfile;
    const native = {
      ...account(root, "native", "claude:native-default"),
      kind: "native-default",
      identity: { loggedIn: true, email: "KIM@work.example", plan: "max", ...read },
    } as AgentProfile;
    const work = { ...managedSet(root, "work"), profiles: [claude, hermes] };
    const mac: ProfileSetInfo = {
      set: { id: "native", kind: "native", label: "This Mac", createdAt: NOW },
      isDefault: true,
      profiles: [native],
    };
    const state = { sets: [mac, work], profiles: [native, claude, hermes] };
    const runtime = stubRuntime(state, {
      profileProviders: () => [
        {
          id: "claude",
          label: "Claude Code",
          support: {
            supported: true,
            identity: "native-status",
            sharedSurfaces: [],
            service: ANTHROPIC,
          },
        },
        {
          id: "hermes",
          label: "Hermes Agent",
          support: {
            supported: true,
            identity: "native-protocol",
            sharedSurfaces: [],
            service: NOUS,
            signInRoutes: [
              { id: "portal", label: "Nous Portal", service: NOUS },
              { id: "provider", label: "Another provider…" },
            ],
          },
        },
      ],
    });
    const { profiles } = service(root, runtime);
    const feed = AgentsProfileSetsListResult.parse(await profiles.sets());

    const workSet = feed.sets.find((set) => set.id === "work")!;
    expect(workSet.plans).toEqual([
      {
        id: "anthropic",
        service: ANTHROPIC,
        account: { email: "kim@work.example", plan: "max" },
        namedBy: "w-claude",
        holders: ["w-claude", "w-hermes"],
        alsoIn: ["native"],
      },
      {
        id: "nous",
        service: NOUS,
        account: { email: "kim@work.example" },
        namedBy: "w-hermes",
        holders: ["w-hermes"],
        alsoIn: [],
      },
    ]);
    const hermesHolds = workSet.personas.find((persona) => persona.provider === "hermes")!.holds;
    expect(
      hermesHolds?.map((held) => [held.service.id, held.planId ?? null, held.key, held.runsOn]),
    ).toEqual([
      ["nous", "nous", false, true],
      ["anthropic", "anthropic", false, false],
      ["openai", null, true, false],
    ]);
    // This Mac's plan is the same account, whatever its case
    expect(feed.sets.find((set) => set.id === "native")!.plans?.[0]?.alsoIn).toEqual(["work"]);
    // the ways to add a sign-in, for the agent whose folder holds several
    expect(feed.routes).toEqual({
      hermes: [
        { id: "portal", label: "Nous Portal", service: NOUS },
        { id: "provider", label: "Another provider…" },
      ],
    });
  });

  it("answers an empty profile with no plans, and a persona that holds nothing without a list", async () => {
    const root = userRoot();
    const unread = account(root, "work", "w-claude");
    const state = {
      sets: [{ ...managedSet(root, "work"), profiles: [unread] }],
      profiles: [unread],
    };
    const { profiles } = service(root, stubRuntime(state));
    const feed = AgentsProfileSetsListResult.parse(await profiles.sets());
    expect(feed.sets[0]?.plans).toEqual([]);
    expect(feed.sets[0]?.personas[0]).not.toHaveProperty("holds");
    expect(feed.routes).toEqual({});
  });
});

describe("AO-5a — a profile Add a profile… made is kept at its first sign-in (AO-D14)", () => {
  it("notes a draft at create, marks it in the feed, and Cancel deletes it only while it is one", async () => {
    const root = userRoot();
    const state = { sets: [] as ProfileSetInfo[], profiles: [] as AgentProfile[] };
    const runtime = stubRuntime(state, {
      createProfileSet: async ({ label }: { label: string }) => {
        const info = {
          ...managedSet(root, "work"),
          set: { ...managedSet(root, "work").set, label },
        };
        mkdirSync(info.set.directory as string, { recursive: true });
        state.sets.push(info);
        return info;
      },
    });
    const { drafts, path } = draftsAt(root);
    const { profiles } = service(root, runtime, idleSessions, drafts);
    const made = await profiles.createSet({ label: "Work", draft: true });
    expect(made.set.draft).toBe(true);
    expect(drafts.list()).toEqual(["work"]);
    // fieldd's own, private, written whole
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // Cancel: deleted as a delete deletes, folder and all
    expect(await profiles.discardSet("work")).toEqual({ discarded: true, stopped: 0 });
    expect(state.sets).toEqual([]);
    expect(existsSync(join(root, ...LAYOUT.AGENT_PROFILE_SETS_DIR, "work"))).toBe(false);
    expect(drafts.list()).toEqual([]);
  });

  it("is kept once its first sign-in says who, and a Cancel after that leaves it alone", async () => {
    const root = userRoot();
    const claude = account(root, "work", "p-claude");
    const state = { sets: [managedSet(root, "work")], profiles: [claude] };
    const { drafts } = draftsAt(root);
    drafts.note("work");
    const signedIn = { loggedIn: true, email: "kim@work.example", verifiedAt: NOW };
    const runtime = stubRuntime(state, {
      verifyProfile: async () => {
        claude.identity = signedIn as AgentProfile["identity"];
        return signedIn;
      },
    });
    const { profiles } = service(root, runtime, idleSessions, drafts);
    // the agent says who signed in: the profile is kept
    await profiles.verifyPersona("p-claude");
    expect(drafts.has("work")).toBe(false);
    const feed = AgentsProfileSetsListResult.parse(await profiles.sets());
    expect(feed.sets.find((set) => set.id === "work")).not.toHaveProperty("draft");
    // a Cancel that arrives after it is read as kept deletes nothing
    expect(await profiles.discardSet("work")).toEqual({ discarded: false, stopped: 0 });
    expect(state.sets.map((info) => info.set.id)).toEqual(["work"]);
  });

  it("every start deletes a draft no sign-in kept, keeps one that was, forgets a gone one, and never touches a profile it never noted", async () => {
    const root = userRoot();
    const kept = account(root, "client", "p-client");
    kept.identity = { loggedIn: true, verifiedAt: NOW } as AgentProfile["identity"];
    // a set's info carries its sign-ins, as puppeteer's does
    const state = {
      sets: [
        managedSet(root, "abandoned"),
        { ...managedSet(root, "client"), profiles: [kept] },
        managedSet(root, "older"),
      ],
      profiles: [kept],
    };
    for (const info of state.sets) mkdirSync(info.set.directory as string, { recursive: true });
    const { drafts } = draftsAt(root);
    drafts.note("abandoned");
    drafts.note("client");
    drafts.note("vanished");
    const { profiles } = service(root, stubRuntime(state), idleSessions, drafts);
    await profiles.sweepDrafts();
    // the abandoned draft is deleted, folder and all; the kept one stays and
    // leaves the note; a profile made before AO-5a ("older") was never noted
    expect(state.sets.map((info) => info.set.id)).toEqual(["client", "older"]);
    expect(existsSync(join(root, ...LAYOUT.AGENT_PROFILE_SETS_DIR, "abandoned"))).toBe(false);
    expect(drafts.list()).toEqual([]);
  });

  it("notes nothing in a daemon that keeps no drafts: create makes an ordinary profile, and discard deletes nothing", async () => {
    const root = userRoot();
    const state = { sets: [managedSet(root, "work")], profiles: [] as AgentProfile[] };
    const { profiles } = service(root, stubRuntime(state));
    expect(await profiles.discardSet("work")).toEqual({ discarded: false, stopped: 0 });
    expect(state.sets).toHaveLength(1);
  });
});
