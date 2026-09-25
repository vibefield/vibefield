// @vitest-environment happy-dom
/**
 * Extensions (AR-S4b). On a profile's page, the design record's pass 24, L2:
 * the lens fieldd sends, worded for the grid — a row per name some agent
 * holds as its own, a cell per agent in pass 24's states, the rest counted
 * beneath — a row's name opening that server's or skill's own page. On an
 * agent's page in a profile, pass 23's three rows, each opening the agent's
 * own list. All read-only, fed by `agents.extensions.subscribe`, with "Read
 * again" asking `agents.extensions.list` to read every agent anew. The lens is
 * the contracts fixture, the one fieldd's shape is checked by.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentsExtensionsListResult } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_EXTENSIONS } from "../src/design-system/extensions-fixtures";
import { ProfileExtensions } from "../src/panels/agents/ExtensionsSection";
import {
  AgentExtensionListView,
  AgentExtensionsView,
  ExtensionItemView,
  ProfileExtensionsView,
} from "../src/panels/agents/ExtensionsView";
import {
  agentExtensions,
  agentList,
  builtFromWords,
  extensionGrid,
  extensionItem,
  holdingWords,
  readWords,
} from "../src/panels/agents/extensions-model";

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
    // sentry is only a project's server in Claude: it stays on Claude's own list
    expect(servers.rows.map((row) => row.name)).toEqual(["linear", "postgres"]);
    expect(servers.more).toBe(
      "1 more comes with a plugin, an app or one project; it stays on its agent’s own list.",
    );
    const skills = extensionGrid(LENS, "skills");
    // a plugin's skill and a built-in one are not the profile's to list
    expect(skills.rows.map((row) => row.name)).toEqual(["release-notes", "sql-review"]);
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
    expect(servers.rows[0]).toMatchObject({
      name: "linear",
      twoVersions: true,
      glyph: "globe",
      fact: "Two versions · https://mcp.linear.app/mcp",
    });
    expect(servers.rows[1]).toMatchObject({ glyph: "prompt", twoVersions: true });
    expect(extensionGrid(LENS, "skills").rows[0]?.fact).toBe(
      "~/.agents/skills · Drafts release notes from merged pull requests",
    );
    expect(builtFromWords(LENS, "Work")).toEqual({
      text: "Built from what Work’s agents already have: 2 servers and 2 skills. Nothing in the agents changed.",
      twoVersions: ["linear", "postgres"],
    });
    const grok = LENS.servers[0]?.cells.grok?.[0];
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
      ["MCP servers", "3", ""],
      ["Skills", "3", ""],
    ]);
    // a built-in skill comes with the app: it is not counted
    expect(rowsOf("codex")).toEqual([
      ["Plugins", "1", ""],
      ["MCP servers", "2", ""],
      ["Skills", "1", ""],
    ]);
    expect(rowsOf("grok")).toEqual([
      ["Plugins", "None", ""],
      ["MCP servers", "1", "All from Claude on This Mac"],
      ["Skills", "1", ""],
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
    const claude = lens.servers[0]!.cells.claude![0]!;
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
      ["Servers", ["linear", "postgres"]],
      ["Only in one project", ["sentry"]],
    ]);
    expect(claude?.sections[0]?.items[0]).toMatchObject({
      glyph: "globe",
      code: "https://mcp.linear.app/mcp",
      text: "sends Authorization",
      state: "Signed in",
    });
    expect(claude?.sections[0]?.items[1]).toMatchObject({
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
    const sql = extensionItem(LENS, "skills", "sql-review");
    expect(sql.facts).toEqual([
      { term: "What it does", text: "Reviews a migration before it ships" },
      {
        term: "Folder",
        code: "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/skills/sql-review",
      },
      { term: "Each agent", text: "Only Claude has it, in its own folder" },
    ]);
    expect(sql.sharedFolder).toBeNull();
    expect(extensionItem(LENS, "servers", "nothing-here").gone).toBe(true);
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
});
