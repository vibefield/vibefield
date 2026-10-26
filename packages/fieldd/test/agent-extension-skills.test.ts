import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CATALOG_READERS,
  AgentsExtensionsAddSkillResult,
  AgentsExtensionsListResult,
  AgentsExtensionsPlanSkillResult,
} from "@vibefield/contracts";
import {
  type AgentProfile,
  type ExtensionInventory,
  type ExtensionService,
  extensionActUnavailable,
  extensionFilesPlan,
  extensionSkillFolderPlan,
  type SkillItem,
} from "@vibefield/puppeteer-core";
import {
  createExtensionActRunner,
  createExtensionInventoryReader,
} from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExtensionStore } from "../src/agent-extension-store";
import { AgentExtensionService } from "../src/agent-extensions";

// AR-S4d2 — skills kept once: one copy in the profile's skills folder, a link
// to it where each agent looks. The service runs through puppeteer's own act
// runner and file steps on a temp home, with three fake agents that read
// real folders — Claude and Grok a skills folder of their own per profile,
// Codex only the shared `~/.agents/skills` with a switch per profile — so
// every cell below is what a folder holds after the steps, never a stub's say.

const NOW = "2026-09-27T12:00:00.000Z";

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function writeSkill(folder: string, description = "Drafts release notes") {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "SKILL.md"),
    `---\nname: ${folder.split("/").pop()}\ndescription: ${description}\n---\nThe steps.\n`,
  );
}

/** Every `<name>/SKILL.md` in a folder, links followed, as the agents read theirs. */
async function skillsIn(
  folder: string,
  fields: (name: string, location: string) => Partial<SkillItem> = () => ({}),
): Promise<SkillItem[]> {
  const items: SkillItem[] = [];
  let names: string[] = [];
  try {
    names = (await readdir(folder)).sort();
  } catch {
    return items;
  }
  for (const name of names) {
    const location = join(folder, name);
    try {
      await readFile(join(location, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const linked = (await lstat(location)).isSymbolicLink();
    items.push({
      kind: "skill",
      id: name,
      name,
      origin: "own",
      enabled: true,
      location,
      ...(linked ? { linkTarget: await readlink(location) } : {}),
      ...fields(name, location),
    });
  }
  return items;
}

async function world() {
  dir = await realpath(await mkdtemp(join(tmpdir(), "fieldd-extension-skills-")));
  const home = join(dir, "home");
  const shared = join(home, ".agents", "skills");
  await mkdir(shared, { recursive: true });
  const sets: Record<string, { label: string; providers: string[] }> = {
    work: { label: "Work", providers: ["claude", "codex", "grok"] },
    personal: { label: "Personal", providers: ["codex"] },
  };
  const profiles: AgentProfile[] = Object.entries(sets).flatMap(([set, { providers }]) =>
    providers.map((provider) => ({
      id: `${set}-${provider}`,
      provider,
      label: sets[set]!.label,
      kind: "managed" as const,
      set,
      dataRoot: join(dir!, "profiles", set, provider),
      createdAt: "2026-09-23T00:00:00.000Z",
    })),
  );
  const inventory = (
    provider: string,
    profile: AgentProfile,
    items: SkillItem[],
  ): ExtensionInventory => ({
    provider,
    profileId: profile.id,
    fetchedAt: NOW,
    items,
    source: { kind: "native-store", stability: "documented" },
  });
  /** An agent that reads a person's skills from its own folder per profile. */
  const folderAgent = (id: string, label: string): ExtensionService => ({
    provider: {
      id,
      label,
      support: { skills: { store: "profile", changes: "folder", read: true } },
    },
    inventory: async (profile) =>
      inventory(id, profile, await skillsIn(join(profile.dataRoot, "skills"))),
    plan: (profile, item, act, options) =>
      item.kind === "skill" && (act === "add" || act === "remove")
        ? extensionSkillFolderPlan({
            label,
            folder: join(profile.dataRoot, "skills"),
            item,
            act,
            ...(options?.keepIn !== undefined ? { keepIn: options.keepIn } : {}),
            home,
          })
        : extensionActUnavailable(
            { kind: item.kind, id: item.id },
            act,
            "no-command",
            `${label} has no switch`,
          ),
  });
  /** Codex: the shared folder only, and a switch per profile its protocol writes. */
  const off = new Map<string, Set<string>>();
  const codex: ExtensionService = {
    provider: {
      id: "codex",
      label: "Codex",
      support: { skills: { store: "mixed", changes: "folder", read: true } },
    },
    inventory: async (profile) =>
      inventory(
        "codex",
        profile,
        await skillsIn(shared, (name) => ({
          shared: true,
          switchable: true,
          enabled: !(off.get(profile.id)?.has(name) ?? false),
        })),
      ),
    plan: (_profile, item, act) => {
      const target = { kind: item.kind, id: item.id };
      if (act === "add" && item.kind === "skill" && item.linkTarget !== undefined) {
        return extensionFilesPlan({
          target,
          act,
          steps: [
            { op: "move", from: item.linkTarget, to: join(shared, item.id) },
            { op: "link", path: item.linkTarget, target: join(shared, item.id) },
          ],
          reaches: ["shared-folder"],
          home,
        });
      }
      if (act === "enable" || act === "disable") {
        return {
          target,
          act,
          available: true,
          runs: { kind: "protocol", method: "skills/config/write", params: { name: item.id } },
          display: `skills/config/write ${item.id} enabled = ${act === "enable"}`,
          reaches: [],
        };
      }
      return extensionActUnavailable(target, act, "no-command", "it is in ~/.agents/skills");
    },
    perform: async (profile, plan) => {
      const names = off.get(profile.id) ?? new Set<string>();
      if (plan.act === "disable") names.add(plan.target.id);
      else names.delete(plan.target.id);
      off.set(profile.id, names);
      return { ok: true };
    },
  };
  const services = [folderAgent("claude", "Claude"), codex, folderAgent("grok", "Grok")];
  const providers = new Map(
    services.map((service) => [service.provider.id, { provider: service.provider, service }]),
  );
  const resolveProfile = async (_providerId: string, profileId: string) => {
    const found = profiles.find((candidate) => candidate.id === profileId);
    return found === undefined ? { error: `unknown profile ${profileId}` } : { profile: found };
  };
  const reader = createExtensionInventoryReader({
    providers,
    resolveProfile,
    nativeDefaultProfileId: () => undefined,
  });
  const command = vi.fn();
  const runner = createExtensionActRunner({
    providers,
    reader,
    resolveProfile,
    nativeDefaultProfileId: () => undefined,
    run: command,
    env: { PATH: "/usr/bin", HOME: home },
  });
  const infoOf = (set: string) => ({
    set: {
      id: set,
      kind: "managed",
      label: sets[set]!.label,
      createdAt: "2026-09-23T00:00:00.000Z",
    },
    isDefault: false,
    profiles: profiles.filter((profile) => profile.set === set),
  });
  const runtime = {
    profileSet: async (set: string) => (sets[set] === undefined ? undefined : infoOf(set)),
    profileSets: async () => Object.keys(sets).map(infoOf),
    profileProviders: () => services.map((service) => service.provider),
    extensionProviders: () => services.map((service) => service.provider),
    extensionInventory: (provider: string, profileId?: string) =>
      reader.inventory(provider, profileId, { fresh: true }),
    extensionActPlans: (
      providerId: string,
      profileId: string | undefined,
      items: Parameters<typeof runner.plans>[0]["items"],
      adds?: Parameters<typeof runner.plans>[0]["adds"],
      skills?: { adds?: Array<{ name: string; folder: string }>; keep?: string },
    ) =>
      runner.plans({
        providerId,
        ...(profileId !== undefined ? { profileId } : {}),
        items,
        ...(adds !== undefined ? { adds } : {}),
        ...(skills?.adds !== undefined ? { skills: skills.adds } : {}),
        ...(skills?.keep !== undefined ? { keep: skills.keep } : {}),
      }),
    runExtensionAct: (request: Parameters<typeof runner.run>[0]) => runner.run(request),
    startExtensionAct: async () => {
      throw new Error("no sign-in expected");
    },
    settleExtensionAct: async () => {
      throw new Error("no sign-in expected");
    },
  };
  const entries = new Map<string, string>();
  const store = new AgentExtensionStore({
    dir: join(dir, "extensions"),
    skillsDir: join(dir, "skills"),
    home,
    secrets: {
      get: async (_service, account) => entries.get(account) ?? null,
      set: async (_service, account, value) => {
        entries.set(account, value);
      },
      delete: async (_service, account) => {
        entries.delete(account);
      },
    },
    now: () => new Date(NOW),
  });
  const extensions = new AgentExtensionService({
    runtime: runtime as unknown as ConstructorParameters<
      typeof AgentExtensionService
    >[0]["runtime"],
    catalog: AGENT_CATALOG_READERS,
    home,
    store,
    now: () => new Date(NOW),
  });
  const skills = (set: string, provider: string) => join(dir!, "profiles", set, provider, "skills");
  return {
    dir,
    home,
    shared,
    extensions,
    store,
    off,
    command,
    skills,
    library: join(dir, "skills", "work"),
  };
}

const row = (lens: AgentsExtensionsListResult, name: string) =>
  lens.skills.find((candidate) => candidate.name === name);

describe("AgentExtensionService, skills kept once (AR-S4d2)", () => {
  it("gives an agent a skill still another agent's own: it moves to the profile's folder, is linked back, then linked", async () => {
    const t = await world();
    await writeSkill(join(t.skills("work", "claude"), "release-notes"));
    const lens = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    // the profile's skills folder is under VibeField's user root, not the home
    expect(lens.library).toBe(t.library);
    expect(row(lens, "release-notes")).toMatchObject({
      versions: 1,
      owner: "claude",
      folder: `${t.skills("work", "claude")}/release-notes`,
      offers: {
        grok: {
          act: {
            act: "add",
            runs: `link ${t.library}/release-notes → ${t.skills("work", "grok")}/release-notes`,
            reaches: [],
          },
        },
        codex: { act: { act: "add", reaches: ["shared-folder"] } },
      },
    });
    // Claude's own folder moves to the profile's when it goes
    expect(row(lens, "release-notes")?.cells.claude?.[0]?.acts).toEqual([
      {
        act: "remove",
        runs: `move ${t.skills("work", "claude")}/release-notes → ${t.library}/release-notes`,
        reaches: [],
        moves: `${t.library}/release-notes`,
      },
    ]);

    const result = await t.extensions.act({
      set: "work",
      provider: "grok",
      kind: "skill",
      id: "release-notes",
      act: "add",
    });
    expect(result.receipt).toMatchObject({ status: "changed", message: "added" });
    expect(result.run.output).toBe(
      [
        `move ${t.skills("work", "claude")}/release-notes → ${t.library}/release-notes`,
        `link ${t.library}/release-notes → ${t.skills("work", "claude")}/release-notes`,
        `link ${t.library}/release-notes → ${t.skills("work", "grok")}/release-notes`,
      ].join("\n"),
    );
    // one copy, in the profile's folder; each agent a link to it
    expect((await lstat(join(t.library, "release-notes"))).isDirectory()).toBe(true);
    expect(await readlink(join(t.skills("work", "claude"), "release-notes"))).toBe(
      join(t.library, "release-notes"),
    );
    expect(await readlink(join(t.skills("work", "grok"), "release-notes"))).toBe(
      join(t.library, "release-notes"),
    );
    const after = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    expect(row(after, "release-notes")).toMatchObject({
      versions: 1,
      kept: true,
      folder: `${t.library}/release-notes`,
    });
    expect(row(after, "release-notes")?.owner).toBeUndefined();
    expect(Object.keys(row(after, "release-notes")?.cells ?? {})).toEqual(["claude", "grok"]);
    // no agent command ran: the runtime placed every link itself
    expect(t.command).not.toHaveBeenCalled();
    // and VibeField's own turns are no change made outside it
    expect(after.changes).toBeUndefined();
  });

  it("moves a kept skill to the shared folder for Codex, keeps every link whole, and turns Codex off in the other profiles", async () => {
    const t = await world();
    await writeSkill(join(t.library, "release-notes"));
    await mkdir(t.skills("work", "claude"), { recursive: true });
    await symlink(
      join(t.library, "release-notes"),
      join(t.skills("work", "claude"), "release-notes"),
    );
    const lens = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    expect(row(lens, "release-notes")?.offers?.codex?.act).toMatchObject({
      runs: [
        `move ${t.library}/release-notes → ~/.agents/skills/release-notes`,
        `link ~/.agents/skills/release-notes → ${t.library}/release-notes`,
      ].join("\n"),
      moves: "~/.agents/skills/release-notes",
    });

    const result = await t.extensions.act({
      set: "work",
      provider: "codex",
      kind: "skill",
      id: "release-notes",
      act: "add",
    });
    expect(result.receipt).toMatchObject({ status: "changed" });
    expect(result.run.output).toContain("Off for Codex in Personal");
    // the copy lives in the shared folder; the profile's folder keeps a link, so Claude's link still resolves
    expect((await lstat(join(t.shared, "release-notes"))).isDirectory()).toBe(true);
    expect(await readlink(join(t.library, "release-notes"))).toBe(join(t.shared, "release-notes"));
    expect(
      await readFile(join(t.skills("work", "claude"), "release-notes", "SKILL.md"), "utf8"),
    ).toContain("The steps.");
    expect(t.off.get("personal-codex")).toEqual(new Set(["release-notes"]));
    expect(t.off.get("work-codex")).toBeUndefined();

    const after = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    expect(row(after, "release-notes")).toMatchObject({
      versions: 1,
      kept: true,
      shared: true,
      folder: "~/.agents/skills/release-notes",
    });
    expect(row(after, "release-notes")?.cells.codex?.[0]).toMatchObject({
      enabled: true,
      shared: true,
    });
    // Personal's Codex was turned off by VibeField, not outside it
    const personal = AgentsExtensionsListResult.parse(await t.extensions.list("personal"));
    expect(row(personal, "release-notes")?.cells.codex?.[0]).toMatchObject({ enabled: false });
    expect(personal.changes).toBeUndefined();
  });

  it("takes a skill from an agent: its link goes, and a folder of its own moves to the profile's folder", async () => {
    const t = await world();
    await writeSkill(join(t.library, "release-notes"));
    await mkdir(t.skills("work", "grok"), { recursive: true });
    await symlink(
      join(t.library, "release-notes"),
      join(t.skills("work", "grok"), "release-notes"),
    );
    await writeSkill(join(t.skills("work", "claude"), "changelog"), "Writes the changelog");
    await t.extensions.list("work");

    const unlinked = await t.extensions.act({
      set: "work",
      provider: "grok",
      kind: "skill",
      id: "release-notes",
      act: "remove",
    });
    expect(unlinked.receipt).toMatchObject({ status: "changed", message: "removed" });
    await expect(lstat(join(t.skills("work", "grok"), "release-notes"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await lstat(join(t.library, "release-notes"))).isDirectory()).toBe(true);

    const kept = await t.extensions.act({
      set: "work",
      provider: "claude",
      kind: "skill",
      id: "changelog",
      act: "remove",
    });
    expect(kept.receipt).toMatchObject({ status: "changed" });
    expect(await readFile(join(t.library, "changelog", "SKILL.md"), "utf8")).toContain(
      "Writes the changelog",
    );
    const after = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    // both are the profile's now, and no agent holds either: one click turns each on again
    for (const name of ["changelog", "release-notes"]) {
      expect(row(after, name)).toMatchObject({ kept: true, versions: 0, cells: {} });
      expect(row(after, name)?.offers?.claude?.act?.act).toBe("add");
    }
  });

  it("Add skill copies a folder into the profile's folder, then gives it to each agent; its plan says each one's line first", async () => {
    const t = await world();
    const source = join(t.home, "Downloads", "changelog-writer");
    await writeSkill(source, "Writes the changelog entry");

    const plan = AgentsExtensionsPlanSkillResult.parse(
      await t.extensions.planSkill({ set: "work", from: "~/Downloads/changelog-writer" }),
    );
    expect(plan).toMatchObject({
      name: "changelog-writer",
      description: "Writes the changelog entry",
      offers: {
        claude: {
          act: {
            runs: `link ${t.library}/changelog-writer → ${t.skills("work", "claude")}/changelog-writer`,
          },
        },
        codex: { act: { reaches: ["shared-folder"] } },
      },
    });
    // nothing was copied for a plan
    await expect(lstat(join(t.library, "changelog-writer"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const added = AgentsExtensionsAddSkillResult.parse(
      await t.extensions.addSkill({
        set: "work",
        from: "~/Downloads/changelog-writer",
        agents: ["claude", "grok"],
      }),
    );
    expect(added).toMatchObject({
      name: "changelog-writer",
      receipts: [
        { provider: "claude", receipt: { status: "changed" } },
        { provider: "grok", receipt: { status: "changed" } },
      ],
    });
    // a copy: the person's folder is where it was
    expect(await readFile(join(source, "SKILL.md"), "utf8")).toContain(
      "Writes the changelog entry",
    );
    const after = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    expect(row(after, "changelog-writer")).toMatchObject({ kept: true, versions: 1 });
    expect(Object.keys(row(after, "changelog-writer")?.cells ?? {})).toEqual(["claude", "grok"]);
    // a name the profile already has is refused, before anything is copied
    await expect(
      t.extensions.addSkill({ set: "work", from: "~/Downloads/changelog-writer", agents: [] }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    await expect(
      t.extensions.planSkill({ set: "work", from: "~/Downloads" }),
    ).rejects.toMatchObject({
      details: { reason: "no-skill" },
    });
  });

  it("says what changed outside VibeField since the last read, and forgets it when VibeField turns that cell", async () => {
    const t = await world();
    await writeSkill(join(t.library, "release-notes"));
    await mkdir(t.skills("work", "grok"), { recursive: true });
    await symlink(
      join(t.library, "release-notes"),
      join(t.skills("work", "grok"), "release-notes"),
    );
    const first = AgentsExtensionsListResult.parse(await t.extensions.list("work", true));
    expect(first.changes).toBeUndefined();

    // someone took it away in a terminal
    await unlink(join(t.skills("work", "grok"), "release-notes"));
    const second = AgentsExtensionsListResult.parse(await t.extensions.list("work", true));
    expect(second.changes).toEqual([
      {
        provider: "grok",
        kind: "skill",
        name: "release-notes",
        change: "removed",
        since: NOW,
        at: NOW,
      },
    ]);

    // turning it back on is VibeField's own: the line goes
    await t.extensions.act({
      set: "work",
      provider: "grok",
      kind: "skill",
      id: "release-notes",
      act: "add",
    });
    const third = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    expect(third.changes).toBeUndefined();
  });
});
