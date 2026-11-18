import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentExtensionStore,
  changeKey,
  EXTENSION_VALUES_SERVICE,
} from "../src/agent-extension-store";
import type { SecretStore } from "../src/plugin-settings";

// AR-S4d — what a profile keeps once for its agents: definitions and value
// NAMES in a 0600 file, the values in a keychain entry (a map, faked here —
// no test opens the real keychain), and which names each agent was given.

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

function memoryKeychain() {
  const entries = new Map<string, string>();
  const secrets: SecretStore = {
    get: vi.fn(async (service, account) => entries.get(`${service}\u0000${account}`) ?? null),
    set: vi.fn(async (service, account, value) => {
      entries.set(`${service}\u0000${account}`, value);
    }),
    delete: vi.fn(async (service, account) => {
      entries.delete(`${service}\u0000${account}`);
    }),
  };
  return {
    secrets,
    entry: (account: string) => entries.get(`${EXTENSION_VALUES_SERVICE}\u0000${account}`),
  };
}

async function setup() {
  dir = await mkdtemp(join(tmpdir(), "fieldd-extension-store-"));
  const keychain = memoryKeychain();
  const home = join(dir, "home");
  const skillsDir = join(dir, "skills");
  const store = new AgentExtensionStore({
    dir,
    skillsDir,
    home,
    secrets: keychain.secrets,
    // a folder of 41 entries is too big here; production's is 2,000
    skillLimits: { entries: 40, bytes: 64 * 1024 },
    now: () => new Date("2026-09-27T10:00:00.000Z"),
  });
  return { store, keychain, dir, home, skillsDir };
}

/** Item 548, 2026-11-18 — a keychain that answers a read as the keychain tool's `-w` read does: a value of printable
 * ASCII as its text, any other value as the hex of its UTF-8 bytes (item 542's probes). */
function toolFormKeychain() {
  const entries = new Map<string, string>();
  const key = (service: string, account: string) => `${service}\u0000${account}`;
  const secrets: SecretStore = {
    get: vi.fn(async (service, account) => {
      const value = entries.get(key(service, account));
      if (value === undefined) return null;
      return /^[\x20-\x7e]*$/u.test(value) ? value : Buffer.from(value, "utf8").toString("hex");
    }),
    set: vi.fn(async (service, account, value) => {
      entries.set(key(service, account), value);
    }),
    delete: vi.fn(async (service, account) => {
      entries.delete(key(service, account));
    }),
  };
  return {
    secrets,
    /** the profile's entry as it was written */
    entry: (account: string) => entries.get(key(EXTENSION_VALUES_SERVICE, account)),
    /** the profile's entry as an earlier build wrote it */
    plant: (account: string, raw: string) => {
      entries.set(key(EXTENSION_VALUES_SERVICE, account), raw);
    },
  };
}

async function toolFormSetup() {
  dir = await mkdtemp(join(tmpdir(), "fieldd-extension-store-"));
  const keychain = toolFormKeychain();
  const store = new AgentExtensionStore({
    dir,
    skillsDir: join(dir, "skills"),
    home: join(dir, "home"),
    secrets: keychain.secrets,
  });
  return { store, keychain };
}

async function skillFolder(folder: string, description = "Drafts release notes") {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "SKILL.md"),
    `---\nname: ${folder.split("/").pop()}\ndescription: ${description}\n---\nThe steps.\n`,
  );
}

const CONTEXT7 = {
  transport: "stdio" as const,
  command: "npx",
  args: ["-y", "@upstash/context7-mcp"],
  env: ["CONTEXT7_API_KEY"],
};

describe("AgentExtensionStore", () => {
  it("keeps a definition and the names of its values in a file only its user reads, the values in the keychain", async () => {
    const { store, keychain, dir } = await setup();
    await expect(store.read("work")).resolves.toEqual({
      version: 1,
      servers: {},
      values: [],
      given: {},
    });
    await store.keep("work", "context7", CONTEXT7);
    await store.keepValues("work", { CONTEXT7_API_KEY: "ctx7_secret_value" });

    const file = join(dir, "work.json");
    const text = await readFile(file, "utf8");
    expect(JSON.parse(text)).toEqual({
      version: 1,
      servers: { context7: { definition: CONTEXT7, keptAt: "2026-09-27T10:00:00.000Z" } },
      values: ["CONTEXT7_API_KEY"],
      given: {},
    });
    expect(text).not.toContain("ctx7_secret_value");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(keychain.entry("work")!)).toEqual({ CONTEXT7_API_KEY: "ctx7_secret_value" });

    // a second value joins the first in the one entry
    await store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" });
    expect(JSON.parse(keychain.entry("work")!)).toEqual({
      CONTEXT7_API_KEY: "ctx7_secret_value",
      LINEAR_API_KEY: "lin_api_value",
    });
    // another store over the same folder reads what the first wrote
    const again = new AgentExtensionStore({
      dir,
      skillsDir: join(dir, "skills"),
      secrets: keychain.secrets,
    });
    await expect(again.read("work")).resolves.toMatchObject({
      values: ["CONTEXT7_API_KEY", "LINEAR_API_KEY"],
    });
  });

  it("gives an agent only the values of the servers it was given, and opens the keychain for nothing else", async () => {
    const { store, keychain } = await setup();
    await expect(store.launchValues("work", "codex")).resolves.toBeUndefined();
    expect(keychain.secrets.get).not.toHaveBeenCalled();

    await store.keepValues("work", {
      CONTEXT7_API_KEY: "ctx7_secret_value",
      LINEAR_API_KEY: "lin_api_value",
    });
    await store.give("work", "codex", "context7", ["CONTEXT7_API_KEY"]);
    await expect(store.launchValues("work", "codex")).resolves.toEqual({
      CONTEXT7_API_KEY: "ctx7_secret_value",
    });
    // Claude was given nothing here: it is started with nothing
    await expect(store.launchValues("work", "claude")).resolves.toBeUndefined();

    // the agent let the server go: its value goes with it
    await store.take("work", "codex", "context7");
    await expect(store.launchValues("work", "codex")).resolves.toBeUndefined();
    await expect(store.read("work")).resolves.toMatchObject({ given: {} });
  });

  it("forgets a deleted profile's keep and its keychain entry, and takes only an Agent Profile's id", async () => {
    const { store, keychain, dir } = await setup();
    await store.keep("work", "context7", CONTEXT7);
    await store.keepValues("work", { CONTEXT7_API_KEY: "ctx7_secret_value" });
    await store.forgetProfile("work");
    expect(keychain.entry("work")).toBeUndefined();
    await expect(stat(join(dir, "work.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.read("work")).resolves.toMatchObject({ servers: {}, values: [] });

    await expect(store.keep("../elsewhere", "context7", CONTEXT7)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    await expect(store.launchValues("../elsewhere", "codex")).resolves.toBeUndefined();
  });

  it("makes one change at a time per profile, so two values kept together are both kept", async () => {
    const { store, keychain } = await setup();
    await Promise.all([
      store.keepValues("work", { A_KEY: "a" }),
      store.keepValues("work", { B_KEY: "b" }),
      store.give("work", "codex", "one", ["A_KEY"]),
      store.give("work", "codex", "two", ["B_KEY"]),
    ]);
    expect(JSON.parse(keychain.entry("work")!)).toEqual({ A_KEY: "a", B_KEY: "b" });
    await expect(store.read("work")).resolves.toMatchObject({
      values: ["A_KEY", "B_KEY"],
      given: { codex: { one: ["A_KEY"], two: ["B_KEY"] } },
    });
  });

  it("keeps a skill once in the profile's folder: a copy of the folder a person names, links inside it kept as links", async () => {
    const { store, home, skillsDir } = await setup();
    const source = join(home, "Downloads", "changelog-writer");
    await skillFolder(source, "Writes the changelog entry");
    await mkdir(join(source, "scripts"));
    await writeFile(join(source, "scripts", "run.sh"), "echo hi\n");
    await symlink("/usr/bin/true", join(source, "scripts", "tool"));

    const found = await store.inspectSkill("work", "~/Downloads/changelog-writer");
    expect(found).toEqual({
      name: "changelog-writer",
      folder: source,
      description: "Writes the changelog entry",
    });
    const kept = await store.keepSkill("work", found);
    expect(kept).toBe(join(skillsDir, "work", "changelog-writer"));
    expect(await readFile(join(kept, "scripts", "run.sh"), "utf8")).toBe("echo hi\n");
    expect(await readlink(join(kept, "scripts", "tool"))).toBe("/usr/bin/true");
    // the person's folder stays where it was
    expect((await stat(join(source, "SKILL.md"))).isFile()).toBe(true);
    await expect(store.keepSkill("work", found)).rejects.toMatchObject({ kind: "CONFLICT" });

    // a link in the folder (Codex took the copy to the shared folder) is kept too, with where it points
    const shared = join(home, ".agents", "skills", "release-notes");
    await skillFolder(shared);
    await symlink(shared, join(skillsDir, "work", "release-notes"), "dir");
    await mkdir(join(skillsDir, "work", "not-a-skill"));
    expect(await store.keptSkills("work")).toEqual([
      {
        name: "changelog-writer",
        folder: kept,
        description: "Writes the changelog entry",
      },
      {
        name: "release-notes",
        folder: join(skillsDir, "work", "release-notes"),
        linkTarget: shared,
        description: "Drafts release notes",
      },
    ]);
    // a folder already in the profile's folder is not taken again
    await expect(store.inspectSkill("work", kept)).rejects.toMatchObject({
      details: { reason: "kept" },
    });
    // one named through a link is copied from where it is: a copy, never the link
    await symlink(source, join(home, "Downloads", "writer-link"));
    const linked = await store.inspectSkill("work", "~/Downloads/writer-link");
    const copy = await store.keepSkill("work", linked);
    expect((await lstat(copy)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(copy, "SKILL.md"), "utf8")).toContain("Writes the changelog entry");
  });

  it("names why a folder is not taken: not a full path, not there, a file, no SKILL.md, too big", async () => {
    const { store, home } = await setup();
    await mkdir(join(home, "empty"), { recursive: true });
    await writeFile(join(home, "notes.txt"), "x");
    const big = join(home, "big");
    await skillFolder(big);
    for (let index = 0; index < 41; index += 1) {
      if (index % 20 === 0) await mkdir(join(big, `d${index}`));
      await writeFile(join(big, `d${index - (index % 20)}`, `f${index}`), "");
    }
    const heavy = join(home, "heavy");
    await skillFolder(heavy);
    await writeFile(join(heavy, "model.bin"), Buffer.alloc(65 * 1024));
    for (const [from, reason] of [
      ["Downloads/x", "no-folder"],
      ["~/missing", "no-folder"],
      ["~/notes.txt", "no-folder"],
      ["~/empty", "no-skill"],
      ["~/big", "too-big"],
      ["~/heavy", "too-big"],
    ] as const) {
      await expect(store.inspectSkill("work", from), from).rejects.toMatchObject({
        kind: "PRECONDITION_FAILED",
        details: { reason },
      });
    }
  });

  it("says what changed outside VibeField between two reads, and nothing for a cell VibeField turned", async () => {
    const { store } = await setup();
    const first = await store.noticeChanges(
      "work",
      "2026-09-27T10:00:00.000Z",
      {
        codex: { servers: { linear: true, notion: true }, skills: { "release-notes": true } },
        claude: { servers: { linear: true }, skills: {} },
      },
      new Set(),
    );
    // the first read sees what is there, and says nothing
    expect(first).toEqual([]);

    const second = await store.noticeChanges(
      "work",
      "2026-09-27T10:05:00.000Z",
      {
        codex: { servers: { notion: false }, skills: { "release-notes": true, pdf: true } },
        claude: { servers: {}, skills: {} },
        grok: { servers: { linear: true }, skills: {} },
      },
      // VibeField took linear from Claude itself
      new Set([changeKey("claude", "mcp-server", "linear")]),
    );
    const since = "2026-09-27T10:00:00.000Z";
    const at = "2026-09-27T10:05:00.000Z";
    expect(second).toEqual([
      { provider: "codex", kind: "mcp-server", name: "linear", change: "removed", since, at },
      { provider: "codex", kind: "mcp-server", name: "notion", change: "off", since, at },
      { provider: "codex", kind: "skill", name: "pdf", change: "added", since, at },
    ]);

    // turning a cell settles its line; a newer change to a cell replaces its older line
    const third = await store.noticeChanges(
      "work",
      "2026-09-27T10:09:00.000Z",
      {
        codex: { servers: { notion: true, linear: true }, skills: { "release-notes": true } },
      },
      new Set([changeKey("codex", "mcp-server", "linear")]),
    );
    expect(third).toEqual([
      {
        provider: "codex",
        kind: "mcp-server",
        name: "notion",
        change: "on",
        since: at,
        at: "2026-09-27T10:09:00.000Z",
      },
      {
        provider: "codex",
        kind: "skill",
        name: "pdf",
        change: "removed",
        since: at,
        at: "2026-09-27T10:09:00.000Z",
      },
    ]);
    // an agent not read this time keeps what was seen of it
    expect((await store.read("work")).seen?.agents.grok).toEqual({
      servers: { linear: true },
      skills: {},
    });

    // three days on, the lines have gone
    const later = await store.noticeChanges(
      "work",
      "2026-09-30T10:10:00.000Z",
      { codex: { servers: { notion: true, linear: true }, skills: { "release-notes": true } } },
      new Set(),
    );
    expect(later).toEqual([]);
  });

  it("forgets a deleted profile's skills folder, and never what a link in it points at", async () => {
    const { store, home, skillsDir } = await setup();
    const shared = join(home, ".agents", "skills", "release-notes");
    await skillFolder(shared);
    await skillFolder(join(skillsDir, "work", "changelog-writer"));
    await symlink(shared, join(skillsDir, "work", "release-notes"), "dir");
    await store.forgetProfile("work");
    await expect(lstat(join(skillsDir, "work"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(shared, "SKILL.md"))).isFile()).toBe(true);
  });
});

describe("item 548: a profile's values the keychain hands back in another form", () => {
  // a value outside printable ASCII: an accent, a check mark and a key (one character in two UTF-16 halves)
  const WIDE = "cl\u00e9-\u2713-\u{1f511}";
  // a kept entry that is neither JSON nor the keychain's hex of it: one cut off
  const CUT = '{"CONTEXT7_API_KEY":"ctx7_secret_val';

  it("keeps the values as printable ASCII, so one outside it reads back whole and the next add keeps it", async () => {
    const { store, keychain } = await toolFormSetup();
    await store.keepValues("work", { CONTEXT7_API_KEY: WIDE });
    expect(keychain.entry("work")).toMatch(/^[\x20-\x7e]*$/u);
    await store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" });
    expect(JSON.parse(keychain.entry("work")!)).toEqual({
      CONTEXT7_API_KEY: WIDE,
      LINEAR_API_KEY: "lin_api_value",
    });
    await store.give("work", "codex", "context7", ["CONTEXT7_API_KEY"]);
    await expect(store.launchValues("work", "codex")).resolves.toEqual({ CONTEXT7_API_KEY: WIDE });
  });

  it("refuses an add over a kept entry that is neither JSON nor the keychain's hex of it, and changes nothing", async () => {
    const { store, keychain } = await toolFormSetup();
    keychain.plant("work", CUT);
    await expect(
      store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" }),
    ).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { reason: "kept-values-unreadable" },
    });
    expect(keychain.entry("work")).toBe(CUT);
    await expect(store.read("work")).resolves.toMatchObject({ values: [] });
    // the person is told why, in the words kept in one place
    const said: unknown = Reflect.get(
      await import("../src/agent-extension-store"),
      "KEPT_VALUES_UNREADABLE",
    );
    expect(said).toEqual(expect.any(String));
    await expect(store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" })).rejects.toThrow(
      said as string,
    );
  });

  it("reads a kept entry the keychain hands back as hex, and the next add keeps every value as printable ASCII", async () => {
    const { store, keychain } = await toolFormSetup();
    await store.keepValues("work", { CONTEXT7_API_KEY: "ctx7_secret_value" });
    // then the entry is one an earlier build wrote, outside printable ASCII: the keychain hands it back as hex
    const earlier = JSON.stringify({ CONTEXT7_API_KEY: WIDE });
    keychain.plant("work", earlier);
    expect(keychain.entry("work")).toBe(earlier);
    await store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" });
    expect(keychain.entry("work")).toBe(
      '{"CONTEXT7_API_KEY":"cl\\u00e9-\\u2713-\\ud83d\\udd11","LINEAR_API_KEY":"lin_api_value"}',
    );
    await expect(store.read("work")).resolves.toMatchObject({
      values: ["CONTEXT7_API_KEY", "LINEAR_API_KEY"],
    });
  });

  it("refuses an add over a kept entry holding a member that is not text, and changes nothing", async () => {
    const { store, keychain } = await toolFormSetup();
    const earlier = JSON.stringify({ CONTEXT7_API_KEY: "ctx7_secret_value", LIMIT: 3 });
    keychain.plant("work", earlier);
    await expect(
      store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" }),
    ).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { reason: "kept-values-unreadable" },
    });
    expect(keychain.entry("work")).toBe(earlier);
  });

  it("refuses an add over hex that is not a JSON map of text, or not UTF-8, and writes nothing", async () => {
    const { store, keychain } = await toolFormSetup();
    // each is handed back as hex digits: the first two as the hex of their bytes, the third as itself, whose bytes
    // (c3 28) are no UTF-8
    for (const earlier of [JSON.stringify(["cl\u00e9"]), "cl\u00e9", "c328"]) {
      keychain.plant("work", earlier);
      await expect(
        store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" }),
      ).rejects.toMatchObject({
        kind: "PRECONDITION_FAILED",
        details: { reason: "kept-values-unreadable" },
      });
      expect(keychain.entry("work")).toBe(earlier);
    }
    await expect(store.read("work")).resolves.toMatchObject({ values: [] });
  });

  it("gives an agent the values of a kept entry the keychain hands back as hex", async () => {
    const { store, keychain } = await toolFormSetup();
    await store.keepValues("work", { CONTEXT7_API_KEY: "ctx7_secret_value" });
    await store.give("work", "codex", "context7", ["CONTEXT7_API_KEY"]);
    // then the entry is one an earlier build wrote, which the keychain hands back as hex
    keychain.plant("work", JSON.stringify({ CONTEXT7_API_KEY: WIDE }));
    await expect(store.launchValues("work", "codex")).resolves.toEqual({ CONTEXT7_API_KEY: WIDE });
  });

  it("starts an agent over a kept entry that is neither JSON nor its hex with no values, as before", async () => {
    const { store, keychain } = await toolFormSetup();
    await store.keepValues("work", { CONTEXT7_API_KEY: "ctx7_secret_value" });
    await store.give("work", "codex", "context7", ["CONTEXT7_API_KEY"]);
    keychain.plant("work", CUT);
    await expect(store.launchValues("work", "codex")).resolves.toBeUndefined();
    expect(keychain.secrets.get).toHaveBeenCalled();
  });
});
