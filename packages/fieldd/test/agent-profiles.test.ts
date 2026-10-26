/**
 * The profile service's own guards (AR-S2b), on stubs: what it will delete,
 * what it keeps when a vendor's sign-out fails, and that a fire-and-forget
 * read never becomes an unhandled rejection. The doors, the real runtime and
 * the real floor are agent-runtime.test.ts and agent-session.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_CATALOG_READERS, AgentsProfileSetsListResult, LAYOUT } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import type { AgentProfile } from "@vibefield/puppeteer-core";
import type { AgentRuntime, ProfileSetInfo } from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexService } from "../src/agent-index";
import { AgentProfileService, type PersonaSessions } from "../src/agent-profiles";

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

function service(root: string, runtime: AgentRuntime, sessions: PersonaSessions = idleSessions) {
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
    now: () => new Date(NOW),
    logger,
  });
  return { profiles, warn };
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
