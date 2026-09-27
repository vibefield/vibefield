// @vitest-environment happy-dom
/**
 * Extensions (AR-S4b). On a profile's page, the design record's pass 24, L2:
 * the lens fieldd sends, worded for the grid — a row per name some agent
 * holds as its own, a cell per agent in pass 24's states, the rest counted
 * beneath — a row's name opening that server's or skill's own page. On an
 * agent's page in a profile, pass 23's three rows, each opening the agent's
 * own list. All read-only, fed by `agents.extensions.subscribe`, with "Read
 * again" asking `agents.extensions.list` to read every agent anew. The lens is
 * the contracts fixture, the one fieldd's shape is checked by. AR-S4c: the
 * acts, and a server's sign-in — the agent's own login in a pane on the page,
 * drawn here with a stand-in pane (the window's terminal pool is not).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentsExtensionsListResult,
  AgentsExtensionsPlanResult,
  AgentsExtensionsSignInResult,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_EXTENSION_PLAN,
  FIXTURE_EXTENSION_RUN,
  FIXTURE_EXTENSION_RUNNING,
  FIXTURE_EXTENSION_SIGNING_IN,
  FIXTURE_EXTENSIONS,
  FIXTURE_EXTENSIONS_NOW,
  FIXTURE_SKILL_PLAN,
} from "../src/design-system/extensions-fixtures";
import {
  AddServer,
  AddSkill,
  ExtensionItem,
  ProfileExtensions,
} from "../src/panels/agents/ExtensionsSection";
import {
  AddServerView,
  AddSkillView,
  AgentExtensionListView,
  AgentExtensionsView,
  ExtensionItemView,
  ProfileExtensionsView,
} from "../src/panels/agents/ExtensionsView";
import {
  actConfirm,
  addServerChips,
  agentExtensions,
  agentList,
  builtFromWords,
  changeLines,
  draftDefinition,
  draftProblem,
  extensionGrid,
  extensionItem,
  holdingWords,
  readWords,
  runWords,
  sharedFolderReaders,
  signInNote,
  splitCommand,
} from "../src/panels/agents/extensions-model";

// The window's terminal pool is not here: a sign-in's pane is a stand-in that
// names the ticket it was handed.
vi.mock("../src/panels/agents/SignInTerminal", () => ({
  SignInTerminal: ({ terminal }: { terminal: TerminalCreateOpenResult }) =>
    createElement("div", { "data-sign-in-pane": terminal.sessionId }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "fixtures",
  "agents-extensions.valid.json",
);
const RAW: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
const LENS = AgentsExtensionsListResult.parse(RAW);
const SIGN_IN = AgentsExtensionsSignInResult.parse(
  JSON.parse(readFileSync(join(dirname(FIXTURE), "agents-extensions-sign-in.valid.json"), "utf8")),
);

it("draws the catalog from the contracts fixture itself", () => {
  expect(FIXTURE_EXTENSIONS).toEqual(RAW);
});

const cellOf = (key: "servers" | "skills", name: string, provider: string) =>
  extensionGrid(LENS, key)
    .rows.find((row) => row.name === name)
    ?.cells.find((cell) => cell.provider === provider)?.cell;

describe("the Extensions model", () => {
  it("lists a name some agent holds as its own, and counts the rest beneath", () => {
    const servers = extensionGrid(LENS, "servers");
    // sentry is only a project's server in Claude: it stays on Claude's own list; context7
    // is one Work keeps though no agent holds it (AR-S4d)
    expect(servers.rows.map((row) => row.name)).toEqual([
      "context7",
      "linear",
      "notion",
      "postgres",
    ]);
    expect(servers.more).toBe(
      "1 more comes with a plugin, an app or one project; it stays on its agent’s own list.",
    );
    const skills = extensionGrid(LENS, "skills");
    // a plugin's skill and a built-in one are not the profile's to list; changelog-writer is
    // one Work keeps in its skills folder (AR-S4d2)
    expect(skills.rows.map((row) => row.name)).toEqual([
      "changelog-writer",
      "release-notes",
      "sql-review",
    ]);
    expect(skills.more).toBe(
      "2 more are built into an agent, or come with a plugin or your organization; they stay on each agent’s own list.",
    );
  });

  it("says what each agent holds, in pass 24's states and words", () => {
    expect(cellOf("servers", "linear", "claude")).toEqual({
      s: "on",
      attn: false,
      why: "On · signed in",
    });
    // Codex reads a variable Claude's does not: the second of two versions
    expect(cellOf("servers", "linear", "codex")).toEqual({
      s: "on",
      attn: true,
      why: "On · a different server under the same name",
    });
    expect(cellOf("servers", "linear", "grok")).toEqual({
      s: "lent",
      from: "claude",
      why: "Grok loads Claude’s linear from This Mac, in every profile",
    });
    expect(cellOf("servers", "linear", "opencode")).toEqual({
      s: "app",
      on: false,
      why: "Off · changed in OpenCode",
    });
    expect(cellOf("servers", "postgres", "codex")).toEqual({
      s: "off",
      why: "Off · Codex keeps its settings",
    });
    expect(cellOf("servers", "postgres", "grok")).toEqual({ s: "off", why: "Off" });
    expect(cellOf("servers", "linear", "kimi")).toMatchObject({
      s: "unread",
      why: "Kimi could not be read: extension inventory failed for kimi",
    });
    // a switchable skill in the shared folder is on or off; one Grok cannot switch is fixed
    expect(cellOf("skills", "release-notes", "codex")).toMatchObject({ s: "on" });
    expect(cellOf("skills", "release-notes", "grok")).toMatchObject({ s: "fixed" });
    expect(cellOf("skills", "sql-review", "claude")).toEqual({
      s: "off",
      why: "Off · Claude keeps its settings",
    });
  });

  it("heads each column with what is particular about the agent", () => {
    const heads = extensionGrid(LENS, "servers").heads;
    expect(heads.map((head) => [head.provider, head.caveat])).toEqual([
      ["claude", ""],
      ["codex", ""],
      ["grok", "+ Claude’s"],
      ["opencode", "in the app"],
      ["kimi", "not read"],
    ]);
    // OpenCode's skills were read but for the ones it downloads at start: what was read shows
    expect(
      extensionGrid(LENS, "skills").heads.find((head) => head.provider === "opencode"),
    ).toMatchObject({
      caveat: "partly read",
      why: "Not all of OpenCode’s skills could be read: skills from `skills.urls` are downloaded when OpenCode starts and are not read here",
    });
    expect(cellOf("skills", "release-notes", "opencode")).toMatchObject({ s: "unread" });
  });

  it("words a row's fact, the I1 line and a holding's detail", () => {
    const servers = extensionGrid(LENS, "servers");
    expect(servers.rows[1]).toMatchObject({
      name: "linear",
      twoVersions: true,
      held: true,
      glyph: "globe",
      fact: "Two versions · https://mcp.linear.app/mcp",
    });
    expect(servers.rows[3]).toMatchObject({ glyph: "prompt", twoVersions: true });
    expect(
      extensionGrid(LENS, "skills").rows.find((row) => row.name === "release-notes")?.fact,
    ).toBe("~/.agents/skills · Drafts release notes from merged pull requests");
    expect(builtFromWords(LENS, "Work")).toEqual({
      text: "Built from what Work’s agents already have: 3 servers and 3 skills. Nothing in the agents changed.",
      twoVersions: ["linear", "postgres"],
    });
    const grok = LENS.servers.find((row) => row.name === "linear")?.cells.grok?.[0];
    expect(holdingWords(LENS, grok!)).toEqual({
      origin: "Loaded from Claude, on This Mac",
      detail: "on · https://mcp.linear.app/mcp · sends Authorization",
      place: "~/.claude.json",
    });
    expect(readWords(LENS, new Date("2026-09-25T09:03:10.000Z"))).toBe("Read 3 minutes ago");
    expect(readWords({ ...LENS, reading: true }, new Date())).toBe("Reading the agents…");
  });
});

describe("one agent's Extensions (pass 23)", () => {
  const rowsOf = (provider: string) =>
    agentExtensions(LENS, provider)?.rows.map((row) => [row.title, row.value, row.fact]);

  it("counts what each agent holds, what it borrows included, and says only the exceptions", () => {
    expect(rowsOf("claude")).toEqual([
      ["Plugins", "1", ""],
      ["MCP servers", "4", ""],
      ["Skills", "4", ""],
    ]);
    // a built-in skill comes with the app: it is not counted; a server asking
    // for a sign-in is set apart
    expect(rowsOf("codex")).toEqual([
      ["Plugins", "1", ""],
      ["MCP servers", "3", ""],
      ["Skills", "1", ""],
    ]);
    expect(agentExtensions(LENS, "codex")?.rows[1]).toMatchObject({
      attention: "notion asks you to sign in",
    });
    expect(rowsOf("grok")).toEqual([
      ["Plugins", "None", ""],
      ["MCP servers", "1", "All from Claude on This Mac"],
      ["Skills", "2", ""],
    ]);
    expect(agentExtensions(LENS, "opencode")).toMatchObject({
      sub: "OpenCode keeps them in one place, shared by every profile",
      lacks: null,
      failure: null,
    });
    expect(rowsOf("opencode")).toEqual([
      ["Plugins", "None", ""],
      ["MCP servers", "None", "Changed only inside OpenCode"],
      ["Skills", "None", "Not all could be read"],
    ]);
    expect(agentExtensions(LENS, "kimi")).toMatchObject({
      rows: [],
      failure:
        "Kimi’s plugins, servers and skills couldn’t be read: extension inventory failed for kimi",
    });
    expect(agentExtensions(LENS, "pi")).toBeNull();
  });

  it("drops a kind the agent lacks and says so beneath (N1); a server asking for a sign-in is set apart", () => {
    const lens = structuredClone(LENS);
    const codex = lens.agents.find((column) => column.provider === "codex")!;
    delete codex.support.plugins;
    delete codex.support.mcpServers;
    const claude = lens.servers.find((row) => row.name === "linear")!.cells.claude![0]!;
    claude.auth = "needs-sign-in";
    expect(agentExtensions(lens, "codex")).toMatchObject({
      rows: [{ key: "skills" }],
      lacks: "Codex has no plugins or MCP servers.",
    });
    expect(agentExtensions(lens, "claude")?.rows[1]).toMatchObject({
      attention: "linear asks you to sign in",
    });
  });

  it("lists an agent's own servers by where each comes from", () => {
    const claude = agentList(LENS, "claude", "servers", "in Work");
    expect(
      claude?.sections.map((section) => [section.title, section.items.map((item) => item.name)]),
    ).toEqual([
      ["Servers", ["linear", "notion", "postgres"]],
      ["Only in one project", ["sentry"]],
    ]);
    expect(claude?.sections[0]?.items[0]).toMatchObject({
      glyph: "globe",
      code: "https://mcp.linear.app/mcp",
      text: "sends Authorization",
      state: "Signed in",
    });
    expect(claude?.sections[0]?.items[2]).toMatchObject({
      glyph: "prompt",
      text: "reads PGPASSWORD",
    });
    expect(claude?.sections[1]?.items[0]).toMatchObject({
      text: "~/Projects/billing",
      state: "Off",
    });
    expect(claude?.sections[1]?.sub).toBe("Added for one folder; Claude keeps them in Work.");
    // borrowed: its own section under the lender's name, and nothing of Grok's own
    const grok = agentList(LENS, "grok", "servers", "in Work");
    expect(grok?.sections.map((section) => section.title)).toEqual(["From Claude on This Mac"]);
    expect(grok?.empty).toBe("Grok has no MCP servers of its own in Work.");
  });

  it("lists skills and plugins: yours, the shared folder, a plugin's, and what is built in counted", () => {
    const claude = agentList(LENS, "claude", "skills", "in Work");
    expect(
      claude?.sections.map((section) => [
        section.title,
        section.items.map((item) => [item.name, item.state]),
      ]),
    ).toEqual([
      [
        "Yours",
        [
          ["changelog-writer", ""],
          ["release-notes", ""],
          ["sql-review", "Off"],
        ],
      ],
      ["From plugins", [["house-style", "review@northlight"]]],
    ]);
    const codex = agentList(LENS, "codex", "skills", "in Work");
    expect(codex?.sections[0]).toMatchObject({
      title: "Your skills",
      sub: "In a folder every profile reads; whether each is on is kept in Work",
      items: [{ name: "release-notes", state: "On" }],
    });
    expect(codex?.sections[1]?.summary).toEqual({
      title: "Built into Codex",
      text: "skill-creator",
      value: "1",
    });
    const plugins = agentList(LENS, "claude", "plugins", "in Work");
    expect(plugins?.sections.map((section) => section.title)).toEqual([
      "Installed",
      "Marketplaces",
    ]);
    expect(plugins?.sections[0]?.items[0]).toMatchObject({
      initial: "R",
      code: "3f9c2a1",
      text: "from northlight · Reviews against the house style",
    });
    expect(plugins?.sections[1]?.items[0]).toMatchObject({ code: "northlight-studio/plugins" });
    // one config for every profile, and a read that could not cover it all
    expect(agentList(LENS, "opencode", "skills", "in Work")).toMatchObject({
      intro: "OpenCode keeps its skills in one place, for every profile.",
      unread:
        "Not all of OpenCode’s skills could be read: skills from `skills.urls` are downloaded when OpenCode starts and are not read here",
      empty: "OpenCode has no skills of its own in Work.",
    });
    expect(agentList(LENS, "kimi", "servers", "in Work")?.unread).toBe(
      "Kimi’s plugins, servers and skills couldn’t be read: extension inventory failed for kimi",
    );
  });
});

describe("a server's or skill's page (pass 24)", () => {
  it("tells two versions apart by what they read, and says how each agent holds the server", () => {
    const linear = extensionItem(LENS, "servers", "linear");
    expect(linear.versions).toEqual({
      title: "Two versions",
      sub: "The agents hold two different servers named linear.",
      entries: [
        {
          code: "https://mcp.linear.app/mcp",
          names: "sends Authorization",
          agents: "Claude and Grok",
        },
        {
          code: "https://mcp.linear.app/mcp",
          names: "reads LINEAR_TOKEN · sends Authorization",
          agents: "Codex",
        },
      ],
    });
    expect(linear.facts.map((fact) => fact.term)).toEqual([
      "Connects to",
      "Kind",
      "LINEAR_TOKEN",
      "Authorization",
      "Kept",
    ]);
    expect(linear.facts[0]).toMatchObject({ text: "Two versions, above", attention: true });
    expect(linear.agents.map((agent) => [agent.label, agent.state, agent.fact])).toEqual([
      ["Claude", "Signed in", "Its own · sends Authorization"],
      ["Codex", "Another version", "Its own · reads LINEAR_TOKEN · sends Authorization"],
      ["Grok", "Claude’s", "Loaded from Claude, on This Mac · sends Authorization"],
      ["OpenCode", "Off", "OpenCode doesn’t have it; it changes its servers only inside its app"],
      ["Kimi", "Not read", "Kimi could not be read: extension inventory failed for kimi"],
    ]);
    expect(linear.agents[2]?.place).toBe("~/.claude.json");
  });

  it("says where a skill lives, and who loads it from the shared folder", () => {
    const notes = extensionItem(LENS, "skills", "release-notes");
    expect(notes.versions?.title).toBe("In two places");
    expect(notes.versions?.entries.map((entry) => [entry.code, entry.agents])).toEqual([
      [
        "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/skills/release-notes",
        "Claude",
      ],
      ["~/.agents/skills/release-notes", "Codex and Grok"],
    ]);
    expect(notes.sharedFolder).toBe(
      "~/.agents/skills is a folder every profile reads; Codex and Grok load release-notes from there. Removing it there removes it for all of them.",
    );
    // AR-S4d2 — still Claude's own folder: the first other agent moves it to Work's
    const sql = extensionItem(LENS, "skills", "sql-review", "Work");
    expect(sql.facts).toEqual([
      { term: "What it does", text: "Reviews a migration before it ships" },
      {
        term: "Folder",
        code: "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/skills/sql-review",
      },
      {
        term: "Each agent",
        text: "It is still Claude’s alone; the first other agent you turn it on for moves it to Work’s skills folder and links it from both",
      },
    ]);
    expect(sql.sharedFolder).toBeNull();
    expect(extensionItem(LENS, "servers", "nothing-here").gone).toBe(true);
  });
});

describe("acts (AR-S4c)", () => {
  const actOf = (key: "servers" | "skills", name: string, provider: string) =>
    extensionGrid(LENS, key)
      .rows.find((row) => row.name === name)
      ?.cells.find((cell) => cell.provider === provider)?.act;

  it("turns an on cell off, an off cell on, and removes where the agent has no switch", () => {
    expect(actOf("servers", "linear", "codex")).toMatchObject({
      act: "disable",
      title: "Turn linear off for Codex",
      runs: "config/value/write mcp_servers.linear.enabled = false",
      reaches: [],
    });
    expect(actOf("servers", "postgres", "codex")).toMatchObject({
      act: "enable",
      title: "Turn postgres on for Codex",
    });
    expect(actOf("servers", "linear", "claude")).toMatchObject({
      act: "remove",
      title: "Remove linear from Claude",
      reaches: ["definition", "sign-in"],
    });
    expect(actOf("skills", "release-notes", "codex")).toMatchObject({
      act: "disable",
      kind: "skill",
    });
    // what the agent borrows, or changes only in its app, offers nothing here
    expect(actOf("servers", "linear", "grok")).toBeNull();
    expect(actOf("servers", "linear", "opencode")).toBeNull();
  });

  it("asks first only when a click reaches further than its cell, and says what goes", () => {
    expect(actConfirm(actOf("servers", "linear", "codex")!, "in Work")).toBeNull();
    expect(actConfirm(actOf("servers", "linear", "claude")!, "in Work")).toEqual({
      question: "Remove linear from Claude in Work?",
      what: "Claude has no switch that turns linear off in Work: this removes it. Its sign-in goes with it. Turning it back on will need its address, and any key it uses, again.",
      action: "Remove linear",
      danger: true,
    });
  });

  it("words the run: running, then what the agent holds now", () => {
    expect(runWords(FIXTURE_EXTENSION_RUNNING, new Date("2026-09-25T08:58:41.000Z"))).toEqual({
      state: "Running…",
      outcome: null,
    });
    expect(runWords(FIXTURE_EXTENSION_RUN, new Date("2026-09-25T09:01:41.000Z"))).toEqual({
      state: "Finished 3 minutes ago",
      outcome: { tone: "neutral", text: "postgres is off for Codex." },
    });
    expect(
      runWords(
        {
          ...FIXTURE_EXTENSION_RUN,
          receipt: {
            status: "failed",
            message: "codex mcp remove postgres exited with 1",
            finishedAt: "2026-09-25T08:58:41.000Z",
          },
        },
        new Date("2026-09-25T08:58:41.000Z"),
      ).outcome,
    ).toEqual({
      tone: "error",
      text: "Codex couldn’t change postgres: codex mcp remove postgres exited with 1.",
    });
  });

  it("offers each agent's own sign-in on a server's page, and a sign-out only where it says signed in", () => {
    const notion = extensionItem(LENS, "servers", "notion");
    const [claude, codex] = notion.agents;
    expect(codex).toMatchObject({
      state: "Asks you to sign in",
      attention: true,
      signIn: {
        label: "Sign in",
        act: {
          act: "sign-in",
          runs: "codex mcp login notion",
          reaches: ["every-profile"],
          terminal: true,
          title: "Sign in to notion for Codex",
        },
      },
      signOut: null,
    });
    // Claude doesn't say whether it is signed in: its sign-in is there, quietly
    expect(claude).toMatchObject({
      state: "On",
      signIn: { label: "Sign in…", act: { act: "sign-in", reaches: [], terminal: true } },
      signOut: null,
    });
    // the grid's cells still turn the server on and off — and, AR-S4d, on for an agent
    // that holds none of it — never sign in; Kimi changes its servers only in its app
    expect(
      extensionGrid(LENS, "servers")
        .rows.find((row) => row.name === "notion")
        ?.cells.map((cell) => cell.act?.act),
    ).toEqual(["remove", "disable", "add", "add", undefined]);

    const signedIn = structuredClone(LENS);
    const held = signedIn.servers.find((row) => row.name === "notion")!.cells.codex![0]!;
    held.auth = "signed-in";
    held.acts = [
      ...(held.acts ?? []).filter((offer) => offer.act !== "sign-in"),
      { act: "sign-out", runs: "codex mcp logout notion", reaches: ["every-profile"] },
    ];
    const after = extensionItem(signedIn, "servers", "notion").agents[1];
    expect(after).toMatchObject({ state: "Signed in", signIn: null });
    expect(after?.signOut).toMatchObject({
      act: "sign-out",
      title: "Sign out of notion for Codex",
    });
  });

  it("asks before a sign-in every profile of the agent shares, and says where one lands", () => {
    const [claude, codex] = extensionItem(LENS, "servers", "notion").agents;
    expect(actConfirm(codex!.signIn!.act, "in Work")).toEqual({
      question: "Sign in to notion for Codex in every profile?",
      what: "Codex keeps one sign-in to notion for every profile on this Mac: every Codex profile that holds notion at this address will use this one, not only Work.",
      action: "Sign in",
      danger: false,
    });
    expect(actConfirm(claude!.signIn!.act, "in Work")).toBeNull();
    expect(signInNote(LENS, FIXTURE_EXTENSION_SIGNING_IN, "in Work")).toBe(
      "Codex opens your browser to finish. The sign-in is Codex’s for every profile on this Mac.",
    );
    expect(
      signInNote(
        LENS,
        { ...FIXTURE_EXTENSION_SIGNING_IN, provider: "claude", label: "Claude" },
        "in Work",
      ),
    ).toBe("Claude opens your browser to finish. The sign-in lands in Work alone.");
  });

  it("words a sign-in: signing in, then what the agent says, or that it doesn't say", () => {
    const at = new Date("2026-09-25T09:01:10.000Z");
    expect(runWords(FIXTURE_EXTENSION_SIGNING_IN, at)).toEqual({
      state: "Signing in…",
      outcome: null,
    });
    const finished = (
      status: "changed" | "unchanged" | "unconfirmed" | "failed",
      message: string,
    ) =>
      runWords(
        {
          ...FIXTURE_EXTENSION_SIGNING_IN,
          state: "finished",
          finishedAt: "2026-09-25T09:01:40.000Z",
          receipt: { status, message, finishedAt: "2026-09-25T09:01:40.000Z" },
        },
        at,
      ).outcome;
    expect(finished("changed", "signed in")).toEqual({
      tone: "neutral",
      text: "Codex is signed in to notion.",
    });
    expect(finished("unchanged", "Codex still asks you to sign in")).toEqual({
      tone: "neutral",
      text: "Codex still asks you to sign in to notion.",
    });
    expect(
      finished("unconfirmed", "Codex says whether it is signed in only inside a session"),
    ).toEqual({
      tone: "neutral",
      text: "Codex doesn’t say whether it’s signed in until a session uses notion.",
    });
    expect(finished("failed", "codex mcp login notion exited with 1")).toEqual({
      tone: "error",
      text: "Codex couldn’t sign in to notion: codex mcp login notion exited with 1.",
    });
  });
});

// ── drawn ──

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

describe("ProfileExtensionsView", () => {
  it("draws two read-only grids, and a row's name opens that server's or skill's page", async () => {
    const onOpenItem = vi.fn();
    await mount(
      createElement(ProfileExtensionsView, {
        lens: LENS,
        profile: "Work",
        onOpenItem,
        now: new Date("2026-09-25T09:00:30.000Z"),
      }),
    );
    const grids = container?.querySelectorAll("[data-ext-grid]");
    expect([...(grids ?? [])].map((grid) => grid.getAttribute("data-ext-grid"))).toEqual([
      "servers",
      "skills",
    ]);
    expect(container?.querySelector("[data-ext-built]")?.textContent).toContain(
      "linear, postgres are two different servers under one name.",
    );
    const cell = container?.querySelector(
      '[aria-label="linear for Grok: Grok loads Claude’s linear from This Mac, in every profile"]',
    );
    expect(cell).not.toBeNull();
    // read-only: nothing in a cell is a control
    expect(container?.querySelectorAll("td button")).toHaveLength(0);
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('[data-ext-row="linear"] button')?.click(),
    );
    expect(onOpenItem).toHaveBeenCalledWith("servers", "linear");
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('[data-ext-row="sql-review"] button')?.click(),
    );
    expect(onOpenItem).toHaveBeenLastCalledWith("skills", "sql-review");
    expect(container?.textContent).toContain("Read just now");
  });

  it("says it is reading before the first read, and keeps the lists beside a refusal", async () => {
    await mount(createElement(ProfileExtensionsView, { lens: null, profile: "Work" }));
    expect(container?.textContent).toContain("Reading what Work’s agents hold…");
    await act(async () =>
      root?.render(
        createElement(ProfileExtensionsView, {
          lens: LENS,
          profile: "Work",
          error: "Could not read the agents again — boom.",
        }),
      ),
    );
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not read the agents again — boom.",
    );
    expect(container?.querySelector('[data-ext-grid="servers"]')).not.toBeNull();
  });
});

describe("an agent's Extensions, its lists and an item's page, drawn", () => {
  it("draws an agent's three rows as doors to its own lists, and a failure in their place", async () => {
    const onOpen = vi.fn();
    await mount(createElement(AgentExtensionsView, { lens: LENS, provider: "grok", onOpen }));
    const rows = [...(container?.querySelectorAll("[data-ext-kind]") ?? [])];
    expect(rows.map((row) => row.getAttribute("data-ext-kind"))).toEqual([
      "plugins",
      "servers",
      "skills",
    ]);
    expect(rows[1]?.textContent).toContain("All from Claude on This Mac");
    expect(rows[1]?.querySelector(".vf-agents-value")?.textContent).toBe("1");
    await act(async () => rows[1]?.querySelector<HTMLButtonElement>("button")?.click());
    expect(onOpen).toHaveBeenCalledWith("servers");
    await act(async () =>
      root?.render(createElement(AgentExtensionsView, { lens: LENS, provider: "kimi", onOpen })),
    );
    expect(container?.querySelectorAll("[data-ext-kind]")).toHaveLength(0);
    expect(container?.textContent).toContain("Kimi’s plugins, servers and skills couldn’t be read");
    await act(async () =>
      root?.render(createElement(AgentExtensionsView, { lens: null, provider: "kimi", onOpen })),
    );
    expect(container?.textContent).toContain("Reading…");
  });

  it("draws an agent's own list by where each comes from, and points at the profile's lists", async () => {
    const onOpenProfile = vi.fn();
    await mount(
      createElement(AgentExtensionListView, {
        lens: LENS,
        provider: "claude",
        agent: "Claude",
        list: "servers",
        profile: "Work",
        where: "in Work",
        onOpenProfile,
        onRefresh: vi.fn(),
        now: new Date("2026-09-25T09:00:30.000Z"),
      }),
    );
    expect(
      [...(container?.querySelectorAll("h3") ?? [])].map((heading) => heading.textContent),
    ).toEqual(["Servers", "Only in one project"]);
    expect(container?.querySelector('[data-ext-item="linear"]')?.textContent).toContain(
      "Signed in",
    );
    // read-only: the only controls are the way to the profile's lists and Read again
    const buttons = [...(container?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(buttons).toEqual(["Open Work", "Read again"]);
    await act(async () =>
      [...(container?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent === "Open Work")
        ?.click(),
    );
    expect(onOpenProfile).toHaveBeenCalled();
    expect(container?.textContent).toContain("Read just now");
  });

  it("draws a server's page: its versions, what it is, and each agent's hold with the grid's mark", async () => {
    await mount(
      createElement(ExtensionItemView, {
        lens: LENS,
        list: "servers",
        name: "linear",
        where: "in Work",
      }),
    );
    expect(container?.querySelectorAll("[data-ext-version]")).toHaveLength(2);
    expect(container?.querySelector(".vf-ext-def")?.textContent).toContain("A server at a URL");
    const codex = container?.querySelector('[data-ext-agent="codex"]');
    expect(codex?.textContent).toContain("Another version");
    expect(codex?.querySelector(".vf-ext-cell--on.vf-ext-cell--attn")).not.toBeNull();
    expect(container?.querySelectorAll("[data-ext-agent]")).toHaveLength(5);
    await act(async () =>
      root?.render(
        createElement(ExtensionItemView, {
          lens: LENS,
          list: "servers",
          name: "gone-away",
          where: "in Work",
        }),
      ),
    );
    expect(container?.textContent).toContain("No agent in Work holds gone-away now.");
  });
});

describe("acts, drawn", () => {
  const cellButton = (label: string) =>
    [...(container?.querySelectorAll<HTMLButtonElement>(".vf-ext-cell-button") ?? [])].find(
      (button) => button.getAttribute("aria-label")?.startsWith(label),
    );

  it("runs a switch at once, and opens P7's confirm first for a click that reaches further", async () => {
    const onAct = vi.fn();
    await mount(createElement(ProfileExtensionsView, { lens: LENS, profile: "Work", onAct }));
    // linear, notion and postgres for Claude and for Codex, and Codex's release-notes;
    // AR-S4d: context7 for the four agents that can take it, notion for Grok and OpenCode;
    // AR-S4d2: changelog-writer's links for Claude and Grok and its offers to Codex and
    // OpenCode, sql-review's offers to Grok, Codex and OpenCode (Claude's own is off)
    expect(container?.querySelectorAll(".vf-ext-cell-button")).toHaveLength(20);
    await act(async () => cellButton("Turn linear off for Codex")?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "codex",
      kind: "mcp-server",
      id: "linear",
      act: "disable",
    });
    onAct.mockClear();
    await act(async () => cellButton("Remove linear from Claude")?.click());
    expect(onAct).not.toHaveBeenCalled();
    const confirm = container?.querySelector("[data-ext-confirm]");
    expect(confirm?.textContent).toContain("Remove linear from Claude in Work?");
    expect(confirm?.textContent).toContain("claude mcp remove --scope user linear");
    const remove = [...(confirm?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Remove linear",
    );
    await act(async () => remove?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "claude",
      kind: "mcp-server",
      id: "linear",
      act: "remove",
    });
    expect(container?.querySelector("[data-ext-confirm]")).toBeNull();
  });

  it("holds every cell while an act runs, and shows its run card with the outcome after", async () => {
    await mount(
      createElement(ProfileExtensionsView, {
        lens: { ...LENS, run: FIXTURE_EXTENSION_RUNNING },
        profile: "Work",
        onAct: vi.fn(),
      }),
    );
    const buttons = [
      ...(container?.querySelectorAll<HTMLButtonElement>(".vf-ext-cell-button") ?? []),
    ];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(container?.querySelector("[data-ext-run]")?.textContent).toContain("Running…");
    await act(async () =>
      root?.render(
        createElement(ProfileExtensionsView, {
          lens: { ...LENS, run: FIXTURE_EXTENSION_RUN },
          profile: "Work",
          onAct: vi.fn(),
          now: new Date("2026-09-25T08:58:50.000Z"),
        }),
      ),
    );
    expect(container?.querySelector('[data-ext-run="finished"]')?.textContent).toContain(
      "postgres is off for Codex.",
    );
  });

  it("gives each agent on an item's page its switch, or its Remove… behind the confirm", async () => {
    const onAct = vi.fn();
    await mount(
      createElement(ExtensionItemView, {
        lens: LENS,
        list: "servers",
        name: "linear",
        where: "in Work",
        onAct,
      }),
    );
    const codexSwitch = container?.querySelector<HTMLButtonElement>(
      '[data-ext-agent="codex"] [role="switch"]',
    );
    expect(codexSwitch?.getAttribute("aria-checked")).toBe("true");
    await act(async () => codexSwitch?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "codex",
      kind: "mcp-server",
      id: "linear",
      act: "disable",
    });
    const remove = container?.querySelector<HTMLButtonElement>(
      '[data-ext-agent="claude"] [aria-label="Remove linear from Claude"]',
    );
    await act(async () => remove?.click());
    expect(container?.querySelector("[data-ext-confirm]")?.textContent).toContain(
      "Its sign-in goes with it.",
    );
  });
});

describe("ProfileExtensions (the controller)", () => {
  it("subscribes for the profile, draws each frame, and reads again when asked", async () => {
    let push: ((frame: unknown) => void) | undefined;
    const request = vi.fn(async (method: string, params?: unknown) => {
      expect(method).toBe("agents.extensions.list");
      expect(params).toEqual({ set: "work", refresh: true });
      push?.(LENS);
      return LENS;
    });
    const subscribe = vi.fn(
      async (method: string, params: unknown, onData: (frame: unknown) => void) => {
        expect(method).toBe("agents.extensions.subscribe");
        expect(params).toEqual({ set: "work" });
        push = onData;
        return {
          subId: "extensions:work",
          snapshot: { ...LENS, reading: true, readAt: undefined, servers: [], skills: [] },
          unsubscribe: () => undefined,
        };
      },
    );
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request,
      subscribe,
    } as unknown as FielddClient;
    await mount(
      createElement(
        FielddProvider,
        { client },
        createElement(ProfileExtensions, { set: "work", profile: "Work" }),
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container?.textContent).toContain("Reading what Work’s agents hold…");
    await act(async () => push?.(LENS));
    expect(container?.querySelector('[data-ext-grid="servers"]')).not.toBeNull();
    const again = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Read again",
    );
    await act(async () => again?.click());
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("asks agents.extensions.act for a cell's act, and says a refusal beside the lists", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      expect(method).toBe("agents.extensions.act");
      expect(params).toEqual({
        set: "work",
        provider: "codex",
        kind: "mcp-server",
        id: "linear",
        act: "disable",
      });
      throw Object.assign(new Error("another change is running"), { kind: "CONFLICT" });
    });
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request,
      subscribe: vi.fn(async () => ({
        subId: "extensions:work",
        snapshot: LENS,
        unsubscribe: (): void => undefined,
      })),
    } as unknown as FielddClient;
    await mount(
      createElement(
        FielddProvider,
        { client },
        createElement(ProfileExtensions, { set: "work", profile: "Work" }),
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const cell = [
      ...(container?.querySelectorAll<HTMLButtonElement>(".vf-ext-cell-button") ?? []),
    ].find((button) => button.getAttribute("aria-label")?.startsWith("Turn linear off for Codex"));
    await act(async () => cell?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(request).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "That change didn’t run",
    );
  });
});

describe("a server's sign-in, drawn", () => {
  const buttonNamed = (label: string) =>
    [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.getAttribute("aria-label") === label || button.textContent === label,
    );

  it("signs in from a server's page: every profile's asks first, the profile's own at once", async () => {
    const onAct = vi.fn();
    await mount(
      createElement(ExtensionItemView, {
        lens: LENS,
        list: "servers",
        name: "notion",
        where: "in Work",
        onAct,
      }),
    );
    expect(buttonNamed("Sign in to notion for Codex")?.textContent).toBe("Sign in");
    expect(buttonNamed("Sign in to notion for Claude")?.textContent).toBe("Sign in…");
    await act(async () => buttonNamed("Sign in to notion for Claude")?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "claude",
      kind: "mcp-server",
      id: "notion",
      act: "sign-in",
    });
    onAct.mockClear();
    await act(async () => buttonNamed("Sign in to notion for Codex")?.click());
    expect(onAct).not.toHaveBeenCalled();
    const confirm = container?.querySelector("[data-ext-confirm]");
    expect(confirm?.textContent).toContain("Sign in to notion for Codex in every profile?");
    expect(confirm?.textContent).toContain("codex mcp login notion");
    await act(async () =>
      [...(confirm?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent === "Sign in")
        ?.click(),
    );
    expect(onAct).toHaveBeenCalledWith({
      provider: "codex",
      kind: "mcp-server",
      id: "notion",
      act: "sign-in",
    });
  });

  it("shows a running sign-in's pane where this window opened it, a line elsewhere, and Cancel", async () => {
    const onCancel = vi.fn();
    const lens = { ...LENS, run: FIXTURE_EXTENSION_SIGNING_IN };
    await mount(
      createElement(ExtensionItemView, {
        lens,
        list: "servers",
        name: "notion",
        where: "in Work",
        onAct: vi.fn(),
        signIn: { pane: createElement("div", { "data-pane": "" }), onCancel },
      }),
    );
    const card = container?.querySelector('[aria-label="Codex sign-in to notion"]');
    expect(card?.querySelector("[data-pane]")).not.toBeNull();
    expect(card?.textContent).toContain("Codex · sign in to notion · Work");
    expect(card?.textContent).toContain("The sign-in is Codex’s for every profile on this Mac.");
    // one act at a time: nothing else starts while the pane is open
    expect(buttonNamed("Sign in to notion for Claude")?.disabled).toBe(true);
    await act(async () => buttonNamed("Cancel")?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);

    await mount(
      createElement(ExtensionItemView, {
        lens,
        list: "servers",
        name: "notion",
        where: "in Work",
        signIn: { onCancel },
      }),
    );
    expect(container?.textContent).toContain(
      "codex mcp login notion is running in a terminal another window opened.",
    );
  });
});

describe("ExtensionItem (the controller)", () => {
  it("asks agents.extensions.signIn, shows the pane it answers with, and cancels it with terminal.terminate", async () => {
    let push: ((frame: unknown) => void) | undefined;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "agents.extensions.signIn") {
        expect(params).toEqual({ set: "work", provider: "claude", id: "notion" });
        return SIGN_IN;
      }
      expect(method).toBe("terminal.terminate");
      expect(params).toEqual({ sessionId: SIGN_IN.terminal.sessionId });
      return { terminated: true };
    });
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request,
      subscribe: vi.fn(
        async (_method: string, _params: unknown, onData: (frame: unknown) => void) => {
          push = onData;
          return { subId: "extensions:work", snapshot: LENS, unsubscribe: (): void => undefined };
        },
      ),
    } as unknown as FielddClient;
    await mount(
      createElement(
        FielddProvider,
        { client },
        createElement(ExtensionItem, {
          set: "work",
          list: "servers",
          name: "notion",
          where: "in Work",
        }),
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const signIn = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.getAttribute("aria-label") === "Sign in to notion for Claude",
    );
    await act(async () => signIn?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(request).toHaveBeenCalledWith("agents.extensions.signIn", {
      set: "work",
      provider: "claude",
      id: "notion",
    });
    // the frame says the sign-in runs: this window holds its pane
    await act(async () => push?.({ ...LENS, run: SIGN_IN.run }));
    expect(
      container?.querySelector(`[data-sign-in-pane="${SIGN_IN.terminal.sessionId}"]`),
    ).not.toBeNull();
    const cancel = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === "Cancel",
    );
    await act(async () => cancel?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(request).toHaveBeenCalledWith("terminal.terminate", {
      sessionId: SIGN_IN.terminal.sessionId,
    });
    // the pane ended: the receipt, and the pane no more
    await act(async () =>
      push?.({
        ...LENS,
        run: {
          ...SIGN_IN.run,
          state: "finished",
          terminal: undefined,
          finishedAt: "2026-09-25T09:01:40.000Z",
          receipt: {
            status: "unchanged",
            message: "Codex still asks you to sign in",
            finishedAt: "2026-09-25T09:01:40.000Z",
          },
        },
      }),
    );
    expect(container?.querySelector("[data-sign-in-pane]")).toBeNull();
    expect(container?.textContent).toContain("Codex still asks you to sign in to notion.");
  });
});

// AR-S4d — adding once: a server kept for the profile, turned on for an agent
// that holds none of it by that agent's own add; a value it reads asked for
// first and kept once in the keychain; Add server with Turn on for.
const PLAN = AgentsExtensionsPlanResult.parse(
  JSON.parse(readFileSync(join(dirname(FIXTURE), "agents-extensions-plan.valid.json"), "utf8")),
);

it("draws Add server's plan from the contracts fixture itself", () => {
  expect(FIXTURE_EXTENSION_PLAN).toEqual(PLAN);
});

describe("adding once (AR-S4d), the model", () => {
  it("offers an empty cell the agent's own add, and says why where the agent cannot take the server", () => {
    const notion = extensionGrid(LENS, "servers").rows.find((row) => row.name === "notion")!;
    const cell = (provider: string) => notion.cells.find((entry) => entry.provider === provider)!;
    expect(cell("grok").act).toMatchObject({
      act: "add",
      id: "notion",
      runs: "grok mcp add --scope user notion https://mcp.notion.com/mcp",
      reaches: [],
      needs: [],
      title: "Turn notion on for Grok",
    });
    expect(cell("grok").cell).toEqual({ s: "off", why: "Off" });
    // OpenCode changes a server only in its app, but its own add takes one: a ring to click
    expect(cell("opencode")).toMatchObject({
      act: { act: "add", reaches: ["every-profile"] },
      cell: { s: "off", why: "Off" },
    });
    // Kimi could not be read: nothing is offered where nothing is known
    expect(cell("kimi")).toMatchObject({ act: null, cell: { s: "unread" } });
    const opencode = cell("opencode").act!;
    expect(actConfirm(opencode, "in Work")).toEqual({
      question: "Turn notion on for OpenCode in every profile?",
      what: "OpenCode keeps one config for every profile: this adds notion to all of them.",
      action: "Turn it on",
      danger: false,
    });
  });

  it("lists a server the profile keeps though no agent holds it, asks for the value it reads, and builds nothing from it", () => {
    const context7 = extensionGrid(LENS, "servers").rows.find((row) => row.name === "context7")!;
    expect(context7).toMatchObject({
      held: false,
      glyph: "prompt",
      fact: "npx -y @upstash/context7-mcp · CONTEXT7_API_KEY",
    });
    expect(context7.cells.map((entry) => entry.act?.needs)).toEqual([
      ["CONTEXT7_API_KEY"],
      ["CONTEXT7_API_KEY"],
      ["CONTEXT7_API_KEY"],
      ["CONTEXT7_API_KEY"],
      undefined,
    ]);
    // the I1 line counts what the agents have: still three servers
    expect(builtFromWords(LENS, "Work")?.text).toContain("3 servers and 3 skills");
    const item = extensionItem(LENS, "servers", "context7");
    expect(item.gone).toBe(false);
    expect(item.facts).toEqual([
      { term: "Connects to", code: "npx -y @upstash/context7-mcp" },
      { term: "Kind", text: "A program on this Mac" },
      {
        term: "CONTEXT7_API_KEY",
        termCode: true,
        text: "Given to the server when it starts. VibeField keeps no value for it yet: turning the server on for an agent asks for one, and keeps it once, in its keychain.",
      },
      { term: "Kept", text: "Once, by VibeField, for this profile; no agent has it on" },
    ]);
    expect(item.agents.map((agent) => [agent.label, agent.act?.act ?? null, agent.state])).toEqual([
      ["Claude", "add", "Off"],
      ["Codex", "add", "Off"],
      ["Grok", "add", "Off"],
      ["OpenCode", "add", "Off"],
      ["Kimi", null, "Not read"],
    ]);
    // a value Work keeps is said to be kept, never shown
    const kept = extensionItem(LENS, "servers", "linear").facts.find(
      (fact) => fact.term === "LINEAR_TOKEN",
    );
    expect(kept?.text).toContain("VibeField keeps its value once, in its keychain");
  });

  it("words an add's run: on for the agent, or why not", () => {
    const run = {
      ...FIXTURE_EXTENSION_RUN,
      act: "add" as const,
      name: "context7",
      item: "context7",
      receipt: {
        status: "changed" as const,
        message: "added",
        finishedAt: FIXTURE_EXTENSION_RUN.finishedAt!,
      },
    };
    const at = new Date(FIXTURE_EXTENSION_RUN.finishedAt!);
    expect(runWords(run, at).outcome).toEqual({
      tone: "neutral",
      text: `context7 is on for ${run.label}.`,
    });
    expect(
      runWords(
        { ...run, receipt: { ...run.receipt, status: "failed", message: "exited with 1" } },
        at,
      ).outcome,
    ).toEqual({ tone: "error", text: `${run.label} couldn’t add context7: exited with 1.` });
  });

  it("reads Add server's form: a command line split as a shell would, a name, a URL, each value given", () => {
    expect(splitCommand(`npx -y "@scope/a server" --dir '/tmp/x y'`)).toEqual([
      "npx",
      "-y",
      "@scope/a server",
      "--dir",
      "/tmp/x y",
    ]);
    expect(splitCommand(`npx "open`)).toBeNull();
    const draft = {
      name: "context7",
      how: "command" as const,
      command: "npx -y @upstash/context7-mcp",
      url: "",
      env: [{ name: "CONTEXT7_API_KEY", value: "ctx7" }],
    };
    expect(draftDefinition(draft)).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: ["CONTEXT7_API_KEY"],
    });
    expect(draftProblem(draft, [])).toBeNull();
    expect(draftProblem(draft, ["context7"])).toBe(
      "This profile already has a server named context7",
    );
    expect(draftProblem({ ...draft, name: "my server" }, [])).toBe(
      "A name is letters, digits, “-” and “_”",
    );
    expect(draftProblem({ ...draft, env: [{ name: "CONTEXT7_API_KEY", value: "" }] }, [])).toBe(
      "Give CONTEXT7_API_KEY its value",
    );
    expect(draftProblem({ ...draft, how: "url", url: "mcp.example.com" }, [])).toBe(
      "A URL starts with https:// or http://",
    );
    expect(draftDefinition({ ...draft, how: "url", url: " https://mcp.figma.com/mcp " })).toEqual({
      transport: "http",
      url: "https://mcp.figma.com/mcp",
    });
  });

  it("chooses an agent whose add runs quietly in this profile, and greys one that cannot take it", () => {
    expect(
      addServerChips(LENS, PLAN.offers).map((chip) => [
        chip.label,
        chip.act !== null,
        chip.preselected,
      ]),
    ).toEqual([
      ["Claude", true, true],
      ["Codex", true, true],
      ["Grok", true, true],
      // OpenCode's one config reaches every profile: it is the person's to choose
      ["OpenCode", true, false],
      ["Kimi", false, false],
    ]);
    expect(
      addServerChips(LENS, PLAN.offers)
        .map((chip) => chip.why)
        .slice(3),
    ).toEqual(["OpenCode would add it for every profile", "Kimi could not be read"]);
  });
});

describe("adding once (AR-S4d), drawn", () => {
  const cellButton = (label: string) =>
    [...(container?.querySelectorAll<HTMLButtonElement>(".vf-ext-cell-button") ?? [])].find(
      (button) => button.getAttribute("aria-label")?.startsWith(label),
    );
  const button = (text: string) =>
    [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (candidate) => candidate.textContent === text,
    );
  const type = async (input: HTMLInputElement | null | undefined, value: string) => {
    if (input === null || input === undefined) throw new Error("no such field");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("turns a server on from an empty cell: at once where it reaches nothing, the value first where it reads one", async () => {
    const onAct = vi.fn();
    await mount(createElement(ProfileExtensionsView, { lens: LENS, profile: "Work", onAct }));
    await act(async () => cellButton("Turn notion on for Grok")?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "grok",
      kind: "mcp-server",
      id: "notion",
      act: "add",
    });
    onAct.mockClear();

    await act(async () => cellButton("Turn context7 on for Codex")?.click());
    expect(onAct).not.toHaveBeenCalled();
    const card = container?.querySelector("[data-ext-confirm]");
    expect(card?.textContent).toContain("Turn context7 on for Codex?");
    expect(card?.textContent).toContain(
      "context7 reads CONTEXT7_API_KEY. VibeField keeps its value once, in its keychain entry for Work: Codex’s settings name the variable, and VibeField gives the value when it starts Codex.",
    );
    const keep = button("Keep and turn on");
    expect(keep?.disabled).toBe(true);
    const field = card?.querySelector<HTMLInputElement>(
      'input[aria-label="Value of CONTEXT7_API_KEY"]',
    );
    expect(field?.type).toBe("password");
    await type(field, "ctx7_value_typed_once");
    expect(button("Keep and turn on")?.disabled).toBe(false);
    // the value is in the field, never in the page's words
    expect(container?.textContent).not.toContain("ctx7_value_typed_once");
    await act(async () => button("Keep and turn on")?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "codex",
      kind: "mcp-server",
      id: "context7",
      act: "add",
      values: { CONTEXT7_API_KEY: "ctx7_value_typed_once" },
    });
    expect(container?.querySelector("[data-ext-confirm]")).toBeNull();
  });

  it("says on This Mac that an agent started outside VibeField gets no value", async () => {
    await mount(
      createElement(ProfileExtensionsView, {
        lens: LENS,
        profile: "This Mac",
        where: "on This Mac",
        onAct: vi.fn(),
      }),
    );
    await act(async () => cellButton("Turn context7 on for Claude")?.click());
    expect(container?.querySelector("[data-ext-confirm]")?.textContent).toContain(
      "An agent started outside VibeField gets none.",
    );
  });

  it("puts Add server… beside Read again, and turns a server on from its page", async () => {
    const onAddServer = vi.fn();
    await mount(
      createElement(ProfileExtensionsView, {
        lens: LENS,
        profile: "Work",
        onAct: vi.fn(),
        onRefresh: vi.fn(),
        onAddServer,
      }),
    );
    await act(async () => button("Add server…")?.click());
    expect(onAddServer).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount());
    const onAct = vi.fn();
    await mount(
      createElement(ExtensionItemView, {
        lens: LENS,
        list: "servers",
        name: "notion",
        where: "in Work",
        onAct,
      }),
    );
    const turnOn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Turn notion on for Grok"]',
    );
    expect(turnOn?.textContent).toBe("Turn on");
    await act(async () => turnOn?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "grok",
      kind: "mcp-server",
      id: "notion",
      act: "add",
    });
  });

  it("Add server: a name, a command and its value, then each chosen agent's own line under Runs", async () => {
    const onAdd = vi.fn();
    const onDraft = vi.fn();
    await mount(
      createElement(AddServerView, {
        lens: LENS,
        profile: "Work",
        where: "in Work",
        offers: PLAN.offers,
        onDraft,
        onAdd,
        onCancel: vi.fn(),
      }),
    );
    expect(button("Add server")?.disabled).toBe(true);
    await type(container?.querySelector('input[aria-label="Name"]'), "figma");
    await act(async () => button("A URL")?.click());
    await type(container?.querySelector('input[aria-label="URL"]'), "https://mcp.figma.com/mcp");
    expect(onDraft).toHaveBeenLastCalledWith("figma", {
      transport: "http",
      url: "https://mcp.figma.com/mcp",
    });
    const chips = [...(container?.querySelectorAll<HTMLButtonElement>(".vf-ext-chip") ?? [])];
    expect(
      chips.map((chip) => [chip.textContent, chip.getAttribute("aria-pressed"), chip.disabled]),
    ).toEqual([
      ["Claude", "true", false],
      ["Codex", "true", false],
      ["Grok", "true", false],
      ["OpenCode", "false", false],
      ["Kimi", "false", true],
    ]);
    const runs = container?.querySelector("[data-ext-runs]")?.textContent ?? "";
    expect(runs).toContain(
      "claude mcp add figma https://mcp.figma.com/mcp --scope user --transport http",
    );
    expect(runs).not.toContain("opencode");
    // Grok left out, by the person
    await act(async () => chips[2]?.click());
    await act(async () => button("Add server")?.click());
    expect(onAdd).toHaveBeenCalledWith({
      name: "figma",
      definition: { transport: "http", url: "https://mcp.figma.com/mcp" },
      values: {},
      agents: ["claude", "codex"],
    });
  });
});

describe("AddServer (the controller)", () => {
  it("plans the form's server with agents.extensions.plan, adds it with agents.extensions.add, then opens its page", async () => {
    let push: ((frame: unknown) => void) | undefined;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "agents.extensions.plan") {
        expect(params).toEqual({
          set: "work",
          name: "figma",
          definition: { transport: "http", url: "https://mcp.figma.com/mcp" },
        });
        return PLAN;
      }
      expect(method).toBe("agents.extensions.add");
      expect(params).toEqual({
        set: "work",
        name: "figma",
        definition: { transport: "http", url: "https://mcp.figma.com/mcp" },
        values: {},
        agents: ["claude", "codex", "grok"],
      });
      return { receipts: [] };
    });
    const subscribe = vi.fn(
      async (_method: string, _params: unknown, onData: (frame: unknown) => void) => {
        push = onData;
        return { subId: "extensions:work", snapshot: LENS, unsubscribe: () => undefined };
      },
    );
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request,
      subscribe,
    } as unknown as FielddClient;
    const onDone = vi.fn();
    await mount(
      createElement(
        FielddProvider,
        { client },
        createElement(AddServer, {
          set: "work",
          profile: "Work",
          where: "in Work",
          onDone,
          onCancel: vi.fn(),
        }),
      ),
    );
    await act(async () => push?.(LENS));
    const field = (label: string) =>
      container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    const typeInto = async (input: HTMLInputElement | null | undefined, value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await typeInto(field("Name"), "figma");
    await act(async () =>
      [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((candidate) => candidate.textContent === "A URL")
        ?.click(),
    );
    await typeInto(field("URL"), "https://mcp.figma.com/mcp");
    // the form rests, then it is planned once
    await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(
      request.mock.calls.filter(([method]) => method === "agents.extensions.plan"),
    ).toHaveLength(1);
    expect(container?.querySelector("[data-ext-runs]")?.textContent).toContain(
      "config/value/write mcp_servers.figma",
    );
    await act(async () =>
      [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((candidate) => candidate.textContent === "Add server")
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(onDone).toHaveBeenCalledWith("figma");
  });
});

describe("skills kept once (AR-S4d2)", () => {
  const LIB = "~/Library/Application Support/VibeField/agents/skills/work";
  const CLAUDE = "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d";
  const cellButton = (label: string) =>
    [...(container?.querySelectorAll<HTMLButtonElement>(".vf-ext-cell-button") ?? [])].find(
      (candidate) => candidate.getAttribute("aria-label")?.startsWith(label),
    );
  const button = (text: string) =>
    [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (candidate) => candidate.textContent === text,
    );

  it("gives a skill a link from an empty cell, takes one away at once, and asks first where the copy moves", () => {
    const row = extensionGrid(LENS, "skills").rows.find(
      (candidate) => candidate.name === "changelog-writer",
    );
    const actOf = (provider: string) => row?.cells.find((cell) => cell.provider === provider)?.act;
    expect(actOf("claude")).toMatchObject({
      act: "remove",
      kind: "skill",
      runs: `unlink ${CLAUDE}/skills/changelog-writer`,
      reaches: [],
      title: "Take changelog-writer away from Claude",
    });
    expect(actConfirm(actOf("claude")!, "in Work")).toBeNull();
    const codex = actOf("codex")!;
    expect(codex).toMatchObject({
      act: "add",
      kind: "skill",
      id: "changelog-writer",
      moves: "~/.agents/skills/changelog-writer",
      reaches: ["shared-folder"],
    });
    const confirm = actConfirm(codex, "in Work", {
      readers: sharedFolderReaders(LENS, "codex"),
      elsewhere: [{ profile: "Personal", agents: ["Kimi"] }],
    });
    expect(confirm).toMatchObject({
      question: "Move changelog-writer into the shared folder for Codex?",
      action: "Move it and turn on for Codex",
      danger: false,
      chips: [
        { provider: "codex", label: "Codex" },
        { provider: "grok", label: "Grok" },
        { provider: "opencode", label: "OpenCode" },
      ],
    });
    expect(confirm?.what).toBe(
      "Codex reads your skills only from ~/.agents/skills, one folder every profile shares. VibeField moves changelog-writer there and leaves a link in Work’s skills folder, so every agent here that has it keeps it. Codex’s own switch turns it on here and off in your other profiles. Other agents read that folder too and have no switch for one skill, so they load it: Grok and OpenCode here; Kimi in Personal.",
    );
    // OpenCode reads one skills folder for every profile
    expect(actConfirm(actOf("opencode")!, "in Work")).toMatchObject({
      question: "Turn changelog-writer on for OpenCode in every profile?",
      action: "Turn it on",
    });
    // still Claude's own: the first other agent moves it to Work's folder, silently
    const sql = extensionGrid(LENS, "skills").rows.find(
      (candidate) => candidate.name === "sql-review",
    );
    expect(sql?.cells.find((cell) => cell.provider === "grok")?.act).toMatchObject({
      act: "add",
      runs: `link ${LIB}/sql-review → ~/Library/Application Support/VibeField/agents/profiles/work/grok-5e3b91d7/skills/sql-review`,
      reaches: [],
    });
  });

  it("draws the move's confirm with who else loads it, and takes Claude's link away at once", async () => {
    const onAct = vi.fn();
    await mount(
      createElement(ProfileExtensionsView, {
        lens: LENS,
        profile: "Work",
        onAct,
        otherProfiles: [{ profile: "Personal", providers: ["codex", "grok"] }],
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    await act(async () => cellButton("Take changelog-writer away from Claude")?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "claude",
      kind: "skill",
      id: "changelog-writer",
      act: "remove",
    });
    onAct.mockClear();
    await act(async () => cellButton("Turn changelog-writer on for Codex")?.click());
    expect(onAct).not.toHaveBeenCalled();
    const card = container?.querySelector("[data-ext-confirm]");
    expect(card?.textContent).toContain("Move changelog-writer into the shared folder for Codex?");
    expect(card?.textContent).toContain("they load it: Grok and OpenCode here; Grok in Personal.");
    expect(
      [...(card?.querySelectorAll(".vf-ext-confirm-chips li") ?? [])].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(["Codex", "Grok", "OpenCode"]);
    await act(async () => button("Move it and turn on for Codex")?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "codex",
      kind: "skill",
      id: "changelog-writer",
      act: "add",
    });
  });

  it("says a change made outside VibeField above its list, and greys that cell's corner", async () => {
    await mount(
      createElement(ProfileExtensionsView, {
        lens: LENS,
        profile: "Work",
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    const lines = container?.querySelectorAll(".vf-ext-section--skills [data-ext-change]");
    expect([...(lines ?? [])].map((line) => line.textContent)).toEqual([
      "Grok dropped sql-review outside VibeField, noticed 2 minutes ago. It shows off for Grok now.",
    ]);
    expect(container?.querySelectorAll(".vf-ext-section--servers [data-ext-change]")).toHaveLength(
      0,
    );
    const marked = container?.querySelectorAll("[data-ext-changed]");
    expect(marked).toHaveLength(1);
    expect(marked?.[0]?.closest("td")?.getAttribute("title")).toBe(
      "Off · Grok dropped sql-review outside VibeField",
    );
    expect(changeLines({ ...LENS, changes: [] }, "skills", FIXTURE_EXTENSIONS_NOW)).toEqual([]);
  });

  it("gives each agent on a skill's page its switch: a link placed, a link taken away", async () => {
    const onAct = vi.fn();
    await mount(
      createElement(ExtensionItemView, {
        lens: LENS,
        list: "skills",
        name: "changelog-writer",
        where: "in Work",
        onAct,
      }),
    );
    expect(container?.textContent).toContain(`${LIB}/changelog-writer`);
    expect(container?.textContent).toContain(
      "Gets a link to this folder where it looks for skills, so an edit is made once",
    );
    const switchOf = (provider: string) =>
      container?.querySelector<HTMLButtonElement>(`[data-ext-agent="${provider}"] [role="switch"]`);
    expect(switchOf("claude")?.getAttribute("aria-checked")).toBe("true");
    expect(switchOf("grok")?.getAttribute("aria-checked")).toBe("true");
    expect(switchOf("codex")?.getAttribute("aria-checked")).toBe("false");
    await act(async () => switchOf("grok")?.click());
    expect(onAct).toHaveBeenCalledWith({
      provider: "grok",
      kind: "skill",
      id: "changelog-writer",
      act: "remove",
    });
    // Codex's move asks first, here too
    onAct.mockClear();
    await act(async () => switchOf("codex")?.click());
    expect(onAct).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-ext-confirm]")?.textContent).toContain(
      "Move changelog-writer into the shared folder for Codex?",
    );
  });

  it("Add skill: a folder, the copy first, then each chosen agent's line under Runs", async () => {
    const onAdd = vi.fn();
    const onSource = vi.fn();
    await mount(
      createElement(AddSkillView, {
        lens: LENS,
        profile: "Work",
        where: "in Work",
        plan: FIXTURE_SKILL_PLAN,
        onSource,
        onAdd,
        onCancel: vi.fn(),
        initial: { from: "~/Downloads/pdf-forms" },
      }),
    );
    expect(onSource).toHaveBeenLastCalledWith("~/Downloads/pdf-forms");
    const chips = [...(container?.querySelectorAll<HTMLButtonElement>(".vf-ext-chip") ?? [])];
    // a link in this profile alone is chosen; Codex's move and OpenCode's every profile are the person's to choose
    expect(
      chips.map((chip) => [chip.textContent, chip.getAttribute("aria-pressed"), chip.disabled]),
    ).toEqual([
      ["Claude", "true", false],
      ["Codex", "false", false],
      ["Grok", "true", false],
      ["OpenCode", "false", false],
      ["Kimi", "false", true],
    ]);
    const runs = () => container?.querySelector("[data-ext-runs]")?.textContent ?? "";
    expect(runs()).toContain(`VibeField copy ~/Downloads/pdf-forms → ${LIB}/pdf-forms`);
    expect(runs()).toContain(`link ${LIB}/pdf-forms → ${CLAUDE}/skills/pdf-forms`);
    expect(runs()).not.toContain("~/.agents/skills");
    expect(container?.textContent).toContain(
      `VibeField copies it into Work’s skills folder, ${LIB}, so the agents share one copy and an edit is made once.`,
    );
    expect(container?.textContent).toContain(
      "Codex would take it into the folder every profile shares; OpenCode would add it for every profile",
    );
    await act(async () => chips[1]?.click());
    expect(runs()).toContain(`move ${LIB}/pdf-forms → ~/.agents/skills/pdf-forms`);
    await act(async () => button("Add skill")?.click());
    expect(onAdd).toHaveBeenCalledWith({
      from: "~/Downloads/pdf-forms",
      agents: ["claude", "codex", "grok"],
    });
  });
});

describe("AddSkill (the controller)", () => {
  it("reads the folder with agents.extensions.planSkill, adds it with agents.extensions.addSkill, then opens its page", async () => {
    let push: ((frame: unknown) => void) | undefined;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "agents.extensions.planSkill") {
        expect(params).toEqual({ set: "work", from: "~/Downloads/pdf-forms" });
        return FIXTURE_SKILL_PLAN;
      }
      expect(method).toBe("agents.extensions.addSkill");
      expect(params).toEqual({
        set: "work",
        from: "~/Downloads/pdf-forms",
        agents: ["claude", "grok"],
      });
      return { name: "pdf-forms", receipts: [] };
    });
    const subscribe = vi.fn(
      async (_method: string, _params: unknown, onData: (frame: unknown) => void) => {
        push = onData;
        return { subId: "extensions:work", snapshot: LENS, unsubscribe: () => undefined };
      },
    );
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request,
      subscribe,
    } as unknown as FielddClient;
    const onDone = vi.fn();
    await mount(
      createElement(
        FielddProvider,
        { client },
        createElement(AddSkill, {
          set: "work",
          profile: "Work",
          where: "in Work",
          onDone,
          onCancel: vi.fn(),
        }),
      ),
    );
    await act(async () => push?.(LENS));
    const field = container?.querySelector<HTMLInputElement>('input[aria-label="Folder"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, "~/Downloads/pdf-forms");
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // the folder rests, then it is read once
    await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(
      request.mock.calls.filter(([method]) => method === "agents.extensions.planSkill"),
    ).toHaveLength(1);
    expect(container?.textContent).toContain(
      "Fills in a PDF form from what the conversation already knows",
    );
    await act(async () =>
      [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((candidate) => candidate.textContent === "Add skill")
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(onDone).toHaveBeenCalledWith("pdf-forms");
  });
});
