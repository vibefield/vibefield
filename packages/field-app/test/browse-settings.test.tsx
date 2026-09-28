// @vitest-environment happy-dom
/**
 * Browse and install (AR-S4e2; the design record's pass 23: B1 one list, D1
 * the plugin's own page). What an agent could install — the plugins its
 * marketplaces list, read from the catalogs it already fetched — with the
 * agent's own install on each: one click, unless the agent asks something
 * first, when the button opens the plugin's page and the install runs from
 * there (in a terminal the person answers, where the agent asks). A
 * marketplace's own acts sit on its group; "Check for updates" and adding from
 * a source sit at the head of the agent's own list. The catalog is the
 * contracts fixture itself.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentsExtensionsCatalogResult,
  AgentsExtensionsListResult,
  AgentsExtensionsTerminalResult,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_CATALOG,
  FIXTURE_CHECK_RUN,
  FIXTURE_EXTENSIONS_NOW,
  FIXTURE_INSTALL_PANE,
  FIXTURE_SOURCE_PLAN,
} from "../src/design-system/extensions-fixtures";
import {
  browsePage,
  checkConfirm,
  installAsksFirst,
  listedPluginPage,
  pluginsHead,
} from "../src/panels/agents/browse-model";
import { AgentBrowse, AgentListedPlugin } from "../src/panels/agents/ExtensionsSection";
import {
  AgentExtensionListView,
  BrowseView,
  ListedPluginView,
} from "../src/panels/agents/ExtensionsView";
import { actConfirm, runWords } from "../src/panels/agents/extensions-model";

// The window's terminal pool is not here: a pane is a stand-in that names the ticket it was handed.
vi.mock("../src/panels/agents/SignInTerminal", () => ({
  SignInTerminal: ({ terminal }: { terminal: TerminalCreateOpenResult }) =>
    createElement("div", { "data-sign-in-pane": terminal.sessionId }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const read = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const LENS = AgentsExtensionsListResult.parse(read("agents-extensions.valid.json"));
const CATALOG = AgentsExtensionsCatalogResult.parse(read("agents-extensions-catalog.valid.json"));
const TERMINAL = AgentsExtensionsTerminalResult.parse(
  read("agents-extensions-terminal.valid.json"),
);

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

const buttons = (): HTMLButtonElement[] => [
  ...(container?.querySelectorAll<HTMLButtonElement>("button") ?? []),
];
const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  buttons().find(
    (button) => button.getAttribute("aria-label") === name || button.textContent === name,
  );
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

it("draws the catalog from the contracts fixture itself", () => {
  expect(FIXTURE_CATALOG).toEqual(read("agents-extensions-catalog.valid.json"));
  expect(FIXTURE_CHECK_RUN).toEqual(
    (read("agents-extensions-check.valid.json") as { run: unknown }).run,
  );
  expect(FIXTURE_INSTALL_PANE).toEqual(TERMINAL.run);
  expect(FIXTURE_SOURCE_PLAN).toEqual(read("agents-extensions-plan-source.valid.json"));
});

describe("browsePage (pass 23's B1)", () => {
  it("lists each marketplace's plugins, each with the agent's install, why not, or that it is installed", () => {
    const model = browsePage(CATALOG, LENS, "in Work", FIXTURE_EXTENSIONS_NOW);
    expect(model.title).toBe("Browse plugins");
    expect(model.placeholder).toBe("Search 4 plugins");
    // one marketplace: no chips to filter by
    expect(model.chips).toEqual([]);
    const [group] = model.groups;
    expect(group).toMatchObject({
      key: "northlight",
      title: "northlight",
      sub: "northlight-studio/plugins · fetched Sep 20",
      count: 4,
    });
    expect(group?.update?.runs).toBe("claude plugin marketplace update northlight");
    expect(group?.remove?.reaches).toEqual(["plugins"]);
    expect(group?.rows.map((row) => [row.name, row.state, row.words])).toEqual([
      ["review", "installed", null],
      ["changelog", "install", null],
      // its source is a command Claude asks the person to accept: its page first
      ["deploy", "look", null],
      ["telemetry", "blocked", "Claude Code flagged it and took it out"],
    ]);
    expect(group?.rows[0]).toMatchObject({ held: "review@northlight", newer: true });
  });

  it("searches names, descriptions, authors and categories, and says when nothing matches", () => {
    const found = browsePage(CATALOG, LENS, "in Work", FIXTURE_EXTENSIONS_NOW, {
      query: "staging",
    });
    expect(found.groups[0]?.rows.map((row) => row.name)).toEqual(["deploy"]);
    const none = browsePage(CATALOG, LENS, "in Work", FIXTURE_EXTENSIONS_NOW, {
      query: "kubernetes",
    });
    expect(none.groups).toEqual([]);
    expect(none.noMatch).toBe("No plugin matches “kubernetes”.");
  });

  it("with no marketplace yet, offers the one the agent adds itself, by its own add", () => {
    const model = browsePage(
      { ...CATALOG, marketplaces: [], plugins: [] },
      LENS,
      "in Work",
      FIXTURE_EXTENSIONS_NOW,
    );
    expect(model.empty).toMatchObject({
      title: "No marketplaces in Work yet",
      text: "Claude Code adds claude-plugins-official the first time it starts in this profile. Add it now to browse before then, or add another from its source.",
    });
    expect(model.empty?.suggest).toMatchObject({
      kind: "marketplace",
      id: "anthropics/claude-plugins-official",
      act: "add",
      runs: "claude plugin marketplace add anthropics/claude-plugins-official",
    });
    expect(model.addMarketplace).toBe(
      "A GitHub repository (owner/repo), a git address, a folder, or the address of a marketplace.json",
    );
  });

  it("says the one reason every listed plugin shares once, above the list", () => {
    const noInstall = {
      ...CATALOG,
      plugins: CATALOG.plugins.map(
        ({ install: _install, held: _held, newer: _newer, blocked: _blocked, ...plugin }) => ({
          ...plugin,
          unavailable: {
            reason: "unsupported",
            message: "Install it with `grok plugin install` in a terminal",
          },
        }),
      ),
    };
    const model = browsePage(noInstall, LENS, "in Work", FIXTURE_EXTENSIONS_NOW);
    expect(model.notice).toBe("Install it with `grok plugin install` in a terminal");
    expect(model.groups[0]?.rows.every((row) => row.state === "none")).toBe(true);
  });
});

describe("listedPluginPage (pass 23's D1, before it is installed)", () => {
  it("says what the agent asks before its code runs, what it would add, and where it comes from", () => {
    const deploy = listedPluginPage(CATALOG, LENS, "deploy@northlight");
    expect(deploy).toMatchObject({
      name: "deploy",
      sub: "Northlight Studio · northlight · Deployment",
      held: null,
      blocked: null,
    });
    expect(deploy.install).toMatchObject({ act: "install", terminal: true });
    expect(deploy.before.map((row) => [row.key, row.title, row.code])).toEqual([
      ["command", "Claude runs a command to fetch it", "npx @northlight/deploy-fetch"],
    ]);
    expect(deploy.parts.map((part) => [part.key, part.names])).toEqual([
      ["servers", ["staging"]],
      ["commands", ["deploy"]],
      ["hooks", ["Stop"]],
    ]);
    expect(deploy.facts).toEqual([
      { term: "Version", code: "0.4.1" },
      { term: "Marketplace", text: "northlight · northlight-studio/plugins" },
      { term: "Category", text: "Deployment" },
    ]);
    expect(installAsksFirst(CATALOG.plugins[2]!, deploy.install!)).toBe(true);
  });

  it("names the plugin the agent holds from it, and says when no marketplace lists it", () => {
    expect(listedPluginPage(CATALOG, LENS, "review@northlight").held).toBe("review@northlight");
    expect(listedPluginPage(CATALOG, LENS, "ghost@northlight", "ghost")).toMatchObject({
      gone: true,
      name: "ghost",
    });
  });
});

describe("pluginsHead (the agent's own list)", () => {
  it("offers Check for updates and Browse where the agent has catalogs, and says when it last checked", () => {
    expect(pluginsHead(LENS, "claude")).toEqual({
      check: { label: "Check for updates", asks: false },
      browse: "Browse plugins…",
      add: null,
      checked: "Updates are checked only when you ask",
    });
    const checked = {
      ...LENS,
      agents: LENS.agents.map((column) =>
        column.provider === "claude"
          ? { ...column, checkedAt: "2026-09-25T09:01:20.000Z" }
          : column,
      ),
      plugins: {
        ...LENS.plugins,
        claude: (LENS.plugins.claude ?? []).map((plugin) =>
          plugin.id === "review@northlight" ? { ...plugin, newer: { version: "1.3.0" } } : plugin,
        ),
      },
    };
    expect(pluginsHead(checked, "claude")?.checked).toMatch(/^Checked \d\d:\d\d · 1 update$/u);
  });

  it("offers an agent that installs from a source its own words, and one without catalogs no check", () => {
    expect(pluginsHead(LENS, "opencode")).toEqual({
      check: null,
      browse: null,
      add: { label: "Add plugin…", words: "An npm package, or a folder with a package.json" },
      checked: "",
    });
  });

  it("asks first where the agent's fetch updates what it installed too, and says so", () => {
    const updatesToo = {
      ...LENS,
      marketplaces: {
        claude: (LENS.marketplaces.claude ?? []).map((market) => ({
          ...market,
          acts: market.acts?.map((act) =>
            act.act === "update" ? { ...act, reaches: ["plugins" as const] } : act,
          ),
        })),
      },
    };
    expect(pluginsHead(updatesToo, "claude")?.check).toEqual({
      label: "Update catalogs…",
      asks: true,
    });
    expect(checkConfirm(updatesToo, "claude", "in Work")).toEqual({
      question: "Update Claude’s catalogs in Work?",
      what: "Claude fetches each of its catalogs and updates the plugin you installed from them as it does. Nothing else changes.",
      action: "Update catalogs",
    });
  });
});

describe("the confirms and the run's words", () => {
  it("asks before a marketplace's removal, naming the plugins that go with it and where it can come back from", () => {
    const model = browsePage(CATALOG, LENS, "in Work", FIXTURE_EXTENSIONS_NOW);
    const confirm = actConfirm(model.groups[0]!.remove!, "in Work", {
      installedFrom: 1,
      source: "northlight-studio/plugins",
    });
    expect(confirm).toEqual({
      question: "Remove northlight from Claude in Work?",
      what: "Its catalog goes, and so does the plugin you installed from it. You can add it again from northlight-studio/plugins.",
      action: "Remove northlight",
      danger: true,
    });
    // a one-click install that stays in this profile asks nothing
    expect(actConfirm(model.groups[0]!.rows[1]!.install!, "in Work")).toBeNull();
  });

  it("words an install, a check and an add from what the agent said", () => {
    expect(runWords(FIXTURE_CHECK_RUN, FIXTURE_EXTENSIONS_NOW).outcome?.text).toBe(
      "Claude fetched its catalog again.",
    );
    expect(
      runWords({ ...FIXTURE_INSTALL_PANE, state: "running" }, FIXTURE_EXTENSIONS_NOW).state,
    ).toBe("Installing…");
    expect(
      runWords(
        {
          ...FIXTURE_INSTALL_PANE,
          state: "finished",
          finishedAt: "2026-09-25T09:02:00.000Z",
          receipt: {
            status: "changed",
            message: "installed 0.4.1",
            finishedAt: "2026-09-25T09:02:00.000Z",
          },
        },
        FIXTURE_EXTENSIONS_NOW,
      ).outcome?.text,
    ).toBe("deploy is installed for Claude.");
  });
});

describe("BrowseView", () => {
  it("installs in one click where the agent asks nothing, opens the page where it does, and removes a marketplace after asking", async () => {
    const onAct = vi.fn();
    const onOpen = vi.fn();
    await mount(
      createElement(BrowseView, {
        lens: LENS,
        catalog: CATALOG,
        provider: "claude",
        where: "in Work",
        onAct,
        onOpen,
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    // review is installed, and its catalog lists a newer one
    expect(container?.textContent).toContain("Update available");
    await act(async () => buttonNamed("Install changelog for Claude")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "claude",
      kind: "plugin",
      id: "changelog@northlight",
      act: "install",
    });
    await act(async () => buttonNamed("Look at deploy first")?.click());
    expect(onOpen).toHaveBeenLastCalledWith({
      id: "deploy@northlight",
      name: "deploy",
      held: null,
    });
    // an installed one opens the installed plugin's page
    await act(async () => buttonNamed("review")?.click());
    expect(onOpen).toHaveBeenLastCalledWith({
      id: "review@northlight",
      name: "review",
      held: "review@northlight",
    });
    // the marketplace's removal asks first, the red one
    await act(async () => buttonNamed("Remove northlight from Claude")?.click());
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain("Remove northlight from Claude in Work?");
    await act(async () => buttonNamed("Remove northlight")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "claude",
      kind: "marketplace",
      id: "northlight",
      act: "remove",
    });
    // its catalog fetched again: no confirm, it reaches nothing else
    await act(async () => buttonNamed("Fetch northlight’s catalog again for Claude")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "claude",
      kind: "marketplace",
      id: "northlight",
      act: "update",
    });
  });

  it("adds a marketplace from a source, saying what the agent would run first", async () => {
    const onAct = vi.fn();
    const onPlanSource = vi.fn(async () => FIXTURE_SOURCE_PLAN.offer);
    await mount(
      createElement(BrowseView, {
        lens: LENS,
        catalog: CATALOG,
        provider: "claude",
        where: "in Work",
        onAct,
        onPlanSource,
        adding: "northlight-studio/labs",
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(onPlanSource).toHaveBeenCalledWith("northlight-studio/labs");
    expect(container?.textContent).toContain(
      "Runs claude plugin marketplace add northlight-studio/labs",
    );
    await act(async () => buttonNamed("Add")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "claude",
      kind: "marketplace",
      id: "northlight-studio/labs",
      act: "add",
      source: "northlight-studio/labs",
    });
  });

  it("offers the official marketplace where the profile has none, by the agent's own add", async () => {
    const onAct = vi.fn();
    await mount(
      createElement(BrowseView, {
        lens: LENS,
        catalog: { ...CATALOG, marketplaces: [], plugins: [] },
        provider: "claude",
        where: "in Work",
        onAct,
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    expect(container?.textContent).toContain("No marketplaces in Work yet");
    await act(async () => buttonNamed("Add claude-plugins-official")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "claude",
      kind: "marketplace",
      id: "anthropics/claude-plugins-official",
      act: "add",
      source: "anthropics/claude-plugins-official",
    });
  });
});

describe("ListedPluginView", () => {
  it("installs from its page in one click, or in a terminal where the agent asks first", async () => {
    const onAct = vi.fn();
    await mount(
      createElement(ListedPluginView, {
        lens: LENS,
        catalog: CATALOG,
        provider: "claude",
        id: "changelog@northlight",
        name: "changelog",
        where: "in Work",
        onAct,
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    expect(container?.textContent).toContain("What it would add");
    await act(async () => buttonNamed("Install changelog for Claude")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "claude",
      kind: "plugin",
      id: "changelog@northlight",
      act: "install",
    });
    await mount(
      createElement(ListedPluginView, {
        lens: LENS,
        catalog: CATALOG,
        provider: "claude",
        id: "deploy@northlight",
        name: "deploy",
        where: "in Work",
        onAct,
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    expect(container?.textContent).toContain("Before it runs");
    expect(buttonNamed("Install deploy for Claude")?.textContent).toBe("Install in a terminal…");
    await act(async () => buttonNamed("Install deploy for Claude")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "claude",
      kind: "plugin",
      id: "deploy@northlight",
      act: "install",
      terminal: true,
    });
  });
});

describe("the agent's own list's head", () => {
  it("checks for updates, browses, and adds from a source with the agent's own words", async () => {
    const onCheck = vi.fn();
    const onBrowse = vi.fn();
    await mount(
      createElement(AgentExtensionListView, {
        lens: LENS,
        provider: "claude",
        agent: "Claude",
        list: "plugins",
        profile: "Work",
        where: "in Work",
        onCheck,
        onBrowse,
        onAct: vi.fn(),
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    expect(container?.textContent).toContain("Updates are checked only when you ask");
    await act(async () => buttonNamed("Check for updates")?.click());
    expect(onCheck).toHaveBeenCalledTimes(1);
    await act(async () => buttonNamed("Browse plugins…")?.click());
    expect(onBrowse).toHaveBeenLastCalledWith();
    // a marketplace's row opens its part of the catalogs
    await act(async () => buttonNamed("northlight")?.click());
    expect(onBrowse).toHaveBeenLastCalledWith("northlight");

    const onAct = vi.fn();
    const onPlanSource = vi.fn(async () => ({
      act: {
        act: "install" as const,
        runs: "opencode plugin opencode-notify --global --pure",
        reaches: ["every-profile" as const],
      },
    }));
    await mount(
      createElement(AgentExtensionListView, {
        lens: LENS,
        provider: "opencode",
        agent: "OpenCode",
        list: "plugins",
        profile: "Work",
        where: "in Work",
        onAct,
        onPlanSource,
        now: FIXTURE_EXTENSIONS_NOW,
      }),
    );
    await act(async () => buttonNamed("Add plugin…")?.click());
    const field = container?.querySelector<HTMLInputElement>("[data-ext-source] input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, "opencode-notify");
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(container?.textContent).toContain(
      "Runs opencode plugin opencode-notify --global --pure",
    );
    // one config for every profile: the button and the words say so
    await act(async () => buttonNamed("Add to every profile")?.click());
    expect(onAct).toHaveBeenLastCalledWith({
      provider: "opencode",
      kind: "plugin",
      id: "opencode-notify",
      act: "install",
      source: "opencode-notify",
    });
  });
});

describe("AgentBrowse and AgentListedPlugin (the controllers)", () => {
  function client(options: { onRequest?: (method: string, params: unknown) => unknown } = {}) {
    let push: ((frame: unknown) => void) | undefined;
    const request = vi.fn(async (method: string, params?: unknown) => {
      const answered = options.onRequest?.(method, params);
      if (answered !== undefined) return answered;
      if (method === "agents.extensions.catalog") return CATALOG;
      if (method === "agents.extensions.act") return {};
      throw new Error(`no ${method} expected`);
    });
    const fake = {
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
    return { client: fake, request, push: (frame: unknown) => push?.(frame) };
  }

  it("reads the agent's catalog, installs through the act door, and reads the catalog again when the install finishes", async () => {
    const fake = client();
    await mount(
      createElement(
        FielddProvider,
        { client: fake.client },
        createElement(AgentBrowse, {
          set: "work",
          provider: "claude",
          where: "in Work",
          onOpen: vi.fn(),
        }),
      ),
    );
    await settle();
    expect(fake.request).toHaveBeenCalledWith("agents.extensions.catalog", {
      set: "work",
      provider: "claude",
    });
    await act(async () => buttonNamed("Install changelog for Claude")?.click());
    await settle();
    expect(fake.request).toHaveBeenCalledWith("agents.extensions.act", {
      set: "work",
      provider: "claude",
      kind: "plugin",
      id: "changelog@northlight",
      act: "install",
    });
    const reads = () =>
      fake.request.mock.calls.filter(([method]) => method === "agents.extensions.catalog").length;
    expect(reads()).toBe(1);
    await act(async () =>
      fake.push({
        ...LENS,
        run: {
          ...FIXTURE_INSTALL_PANE,
          item: "changelog@northlight",
          name: "changelog",
          state: "finished",
          terminal: undefined,
          finishedAt: "2026-09-25T09:02:00.000Z",
          receipt: {
            status: "changed",
            message: "installed 2.0.0",
            finishedAt: "2026-09-25T09:02:00.000Z",
          },
        },
      }),
    );
    await settle();
    expect(reads()).toBe(2);
  });

  it("opens an install that asks first in a pane through agents.extensions.terminal, and shows the pane it answers with", async () => {
    const fake = client({
      onRequest: (method) => (method === "agents.extensions.terminal" ? TERMINAL : undefined),
    });
    await mount(
      createElement(
        FielddProvider,
        { client: fake.client },
        createElement(AgentListedPlugin, {
          set: "work",
          provider: "claude",
          id: "deploy@northlight",
          name: "deploy",
          where: "in Work",
        }),
      ),
    );
    await settle();
    await act(async () => buttonNamed("Install deploy for Claude")?.click());
    await settle();
    expect(fake.request).toHaveBeenCalledWith("agents.extensions.terminal", {
      set: "work",
      provider: "claude",
      kind: "plugin",
      id: "deploy@northlight",
      act: "install",
    });
    await act(async () => fake.push({ ...LENS, run: TERMINAL.run }));
    expect(
      container?.querySelector(`[data-sign-in-pane="${TERMINAL.terminal.sessionId}"]`),
    ).not.toBeNull();
    expect(container?.textContent).toContain("Claude · install deploy · Work");
  });
});
