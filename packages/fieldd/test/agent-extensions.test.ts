import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentProfile,
  ExtensionActPlan,
  ExtensionActReceipt,
  ExtensionCatalog,
  ExtensionFailure,
  ExtensionInventory,
  ExtensionItem,
  ExtensionProvider,
  MarketplaceItem,
  McpServerDefinition,
  McpServerItem,
  PluginItem,
  SkillItem,
} from "@vibecook/puppeteer-core";
import type { StartedExtensionAct } from "@vibecook/puppeteer-runtime";
import {
  AGENT_CATALOG_READERS,
  AgentsExtensionsActResult,
  AgentsExtensionsCatalogResult,
  AgentsExtensionsCheckResult,
  AgentsExtensionsListResult,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExtensionStore } from "../src/agent-extension-store";
import {
  AgentExtensionService,
  abbreviateHome,
  buildExtensionLens,
  type ExtensionLensAgent,
  type ExtensionSignInPanes,
} from "../src/agent-extensions";
import type { GrantPrincipal } from "../src/terminal-grants";

// AR-S4b — the Extensions lens: what each agent in an Agent Profile holds,
// grouped by name. The builder is pure; the service is measured against a
// stub runtime, so no agent is ever read here.

const HOME = "/Users/test";
const ROOT = `${HOME}/Library/Application Support/VibeField/agents/profiles/work`;
const NOW = "2026-09-25T09:00:02.000Z";

const SUPPORT: Record<string, ExtensionProvider["support"]> = {
  claude: {
    plugins: { store: "profile", changes: "command", read: true },
    marketplaces: { store: "profile", changes: "command", read: true },
    mcpServers: { store: "profile", changes: "command", read: true },
    skills: { store: "profile", changes: "folder", read: true },
  },
  codex: {
    plugins: { store: "profile", changes: "command", read: true },
    marketplaces: { store: "mixed", changes: "command", read: false },
    mcpServers: { store: "profile", changes: "command", read: true },
    skills: { store: "mixed", changes: "folder", read: true },
  },
  grok: {
    mcpServers: { store: "mixed", changes: "command", read: true },
    skills: { store: "mixed", changes: "folder", read: true },
  },
};

function inventory(
  provider: string,
  items: ExtensionItem[],
  extra: Partial<ExtensionInventory> = {},
): ExtensionInventory {
  return {
    provider,
    profileId: `work-${provider}`,
    fetchedAt: "2026-09-25T09:00:00.000Z",
    items,
    source: { kind: "native-store", stability: "experimental" },
    ...extra,
  };
}

const agent = (
  provider: string,
  result: ExtensionInventory | ExtensionFailure,
  label = provider[0]!.toUpperCase() + provider.slice(1),
): ExtensionLensAgent => ({
  provider,
  label,
  profileId: `work-${provider}`,
  support: SUPPORT[provider] ?? {},
  result,
});

const linear = (id: string, extra: Partial<ExtensionItem> = {}): ExtensionItem =>
  ({
    kind: "mcp-server",
    id,
    name: "linear",
    origin: "own",
    enabled: true,
    transport: "http",
    target: "https://mcp.linear.app/mcp",
    headers: ["Authorization"],
    ...extra,
  }) as ExtensionItem;

const WORK: ExtensionLensAgent[] = [
  agent(
    "claude",
    inventory("claude", [
      linear("linear", {
        location: `${ROOT}/claude-0b7e2c4d/.claude.json`,
      } as Partial<ExtensionItem>),
      {
        kind: "mcp-server",
        id: "postgres",
        name: "postgres",
        origin: "own",
        enabled: true,
        transport: "stdio",
        target: "npx -y @modelcontextprotocol/server-postgres postgresql://•••@localhost/dev",
        env: ["PGPASSWORD"],
      },
      {
        kind: "mcp-server",
        id: "plugin:review@northlight:postgres",
        name: "postgres",
        origin: "plugin",
        plugin: "review@northlight",
        enabled: true,
        transport: "stdio",
        target: "npx -y @modelcontextprotocol/server-postgres postgresql://•••@localhost/dev",
        env: ["PGPASSWORD"],
      },
      {
        kind: "mcp-server",
        id: "project:/Users/test/Projects/billing:sentry",
        name: "sentry",
        origin: "project",
        project: `${HOME}/Projects/billing`,
        enabled: false,
        transport: "http",
        target: "https://mcp.sentry.dev/mcp",
      },
      {
        kind: "skill",
        id: "release-notes",
        name: "release-notes",
        origin: "own",
        enabled: true,
        description: "Drafts release notes",
        location: `${ROOT}/claude-0b7e2c4d/skills/release-notes`,
      },
      {
        kind: "plugin",
        id: "review@northlight",
        name: "review",
        origin: "own",
        enabled: true,
        version: "3f9c2a1b7d04",
        marketplace: "northlight",
        location: `${ROOT}/claude-0b7e2c4d/plugins/cache/northlight/review/3f9c2a1b7d04`,
      },
      {
        kind: "marketplace",
        id: "northlight",
        name: "northlight",
        origin: "own",
        enabled: true,
        source: "northlight-studio/plugins",
      },
    ]),
  ),
  agent(
    "codex",
    inventory("codex", [
      linear("linear", { env: ["LINEAR_TOKEN"] } as Partial<ExtensionItem>),
      {
        kind: "mcp-server",
        id: "postgres",
        name: "postgres",
        origin: "own",
        enabled: false,
        transport: "stdio",
        target: "uvx postgres-mcp --access-mode=restricted",
        env: ["DATABASE_URI"],
      },
      {
        kind: "skill",
        id: "release-notes",
        name: "release-notes",
        origin: "own",
        shared: true,
        switchable: true,
        enabled: true,
        location: `${HOME}/.agents/skills/release-notes`,
      },
    ]),
  ),
  agent(
    "grok",
    inventory("grok", [
      linear("claude:linear", {
        origin: "borrowed",
        lender: "claude",
        shared: true,
        location: `${HOME}/.claude.json`,
      } as Partial<ExtensionItem>),
      {
        kind: "skill",
        id: "agents:release-notes",
        name: "release-notes",
        origin: "own",
        shared: true,
        enabled: true,
        location: `${HOME}/.agents/skills/release-notes`,
      },
    ]),
  ),
];

const lensOf = (agents: readonly ExtensionLensAgent[]) =>
  AgentsExtensionsListResult.parse(
    buildExtensionLens({ set: "work", readAt: NOW, agents, home: HOME }),
  );

describe("the Extensions lens (buildExtensionLens)", () => {
  it("groups servers by name, a cell per agent in the profile's order, the most its own first", () => {
    const lens = lensOf(WORK);
    expect(lens.servers.map((row) => row.name)).toEqual(["linear", "postgres", "sentry"]);
    const postgres = lens.servers.find((row) => row.name === "postgres")!;
    expect(Object.keys(postgres.cells)).toEqual(["claude", "codex"]);
    expect(postgres.cells.claude!.map((holding) => [holding.id, holding.origin])).toEqual([
      ["postgres", "own"],
      ["plugin:review@northlight:postgres", "plugin"],
    ]);
    expect(lens.servers.find((row) => row.name === "sentry")!.cells.claude![0]).toMatchObject({
      origin: "project",
      project: "~/Projects/billing",
      enabled: false,
    });
  });

  it("counts two versions by the masked target and the names it reads, and marks each holding's", () => {
    const lens = lensOf(WORK);
    const linearRow = lens.servers.find((row) => row.name === "linear")!;
    // Claude's and Grok's read no variable; Codex's reads LINEAR_TOKEN — another definition.
    expect(linearRow.versions).toBe(2);
    expect(linearRow.cells.claude![0]!.version).toBe(0);
    expect(linearRow.cells.codex![0]!.version).toBe(1);
    expect(linearRow.cells.grok![0]).toMatchObject({
      origin: "borrowed",
      lender: "claude",
      shared: true,
      place: "~/.claude.json",
      version: 0,
    });
    const postgres = lens.servers.find((row) => row.name === "postgres")!;
    expect(postgres.versions).toBe(2);
    // A server with a single definition carries no version marks.
    expect(lens.servers.find((row) => row.name === "sentry")!.cells.claude![0]).not.toHaveProperty(
      "version",
    );
  });

  it("counts a skill's versions by its folder, so one shared folder is one copy", () => {
    const lens = lensOf(WORK);
    const row = lens.skills.find((skill) => skill.name === "release-notes")!;
    expect(row.description).toBe("Drafts release notes");
    expect(row.versions).toBe(2);
    expect(row.cells.codex![0]).toMatchObject({
      shared: true,
      switchable: true,
      place: "~/.agents/skills/release-notes",
      version: 1,
    });
    expect(row.cells.grok![0]!.version).toBe(1);
    expect(row.cells.claude![0]!.version).toBe(0);
  });

  it("keeps plugins and marketplaces on each agent's own list, and counts what each holds", () => {
    const lens = lensOf(WORK);
    expect(lens.plugins).toEqual({
      claude: [
        {
          id: "review@northlight",
          name: "review",
          origin: "own",
          enabled: true,
          version: "3f9c2a1b7d04",
          marketplace: "northlight",
          place:
            "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/plugins/cache/northlight/review/3f9c2a1b7d04",
        },
      ],
    });
    expect(lens.marketplaces.claude!.map((row) => row.id)).toEqual(["northlight"]);
    expect(lens.agents.map((column) => [column.provider, column.counts])).toEqual([
      ["claude", { plugins: 1, marketplaces: 1, mcpServers: 4, skills: 1 }],
      ["codex", { plugins: 0, marketplaces: 0, mcpServers: 2, skills: 1 }],
      ["grok", { plugins: 0, marketplaces: 0, mcpServers: 1, skills: 1 }],
    ]);
    expect(lens.agents[1]!.support.marketplaces).toEqual({
      store: "mixed",
      changes: "command",
      read: false,
    });
  });

  it("gives an agent that could not be read an empty column with the reason, and says what a read left out", () => {
    const lens = lensOf([
      WORK[0]!,
      agent("codex", {
        status: "unavailable",
        provider: "codex",
        message: "the Codex app-server could not be read for this profile",
        retryable: true,
      }),
      agent(
        "grok",
        inventory("grok", [], {
          unread: [{ kind: "mcp-server", message: "config.toml could not be read" }],
        }),
      ),
    ]);
    expect(lens.agents[1]).toMatchObject({
      provider: "codex",
      counts: { plugins: 0, marketplaces: 0, mcpServers: 0, skills: 0 },
      failure: { status: "unavailable", retryable: true },
    });
    expect(lens.agents[1]).not.toHaveProperty("fetchedAt");
    expect(lens.agents[2]!.unread).toEqual([
      { kind: "mcp-server", message: "config.toml could not be read" },
    ]);
    expect(lens.servers.flatMap((row) => Object.keys(row.cells))).not.toContain("codex");
  });

  it("abbreviates the home only at a path boundary", () => {
    expect(abbreviateHome("/Users/test", HOME)).toBe("~");
    expect(abbreviateHome("/Users/test/.claude.json", HOME)).toBe("~/.claude.json");
    expect(abbreviateHome("/Users/tester/.claude.json", HOME)).toBe("/Users/tester/.claude.json");
  });
});

// ── the service, over a stub runtime ──

const profile = (provider: string, set = "work"): AgentProfile => ({
  id: set === "native" ? `${provider}:native-default` : `${set}-${provider}`,
  provider,
  label: provider,
  kind: set === "native" ? "native-default" : "managed",
  dataRoot: `${ROOT}/${provider}`,
  createdAt: "2026-09-23T00:00:00.000Z",
  ...(set === "native" ? {} : { set }),
});

function stubRuntime(options: {
  sets?: Record<string, string[]>;
  read?: (provider: string, profileId: string) => Promise<ExtensionInventory | ExtensionFailure>;
  plans?: (
    provider: string,
    profileId: string | undefined,
    items: ReadonlyArray<McpServerItem | SkillItem | PluginItem>,
    adds?: ReadonlyArray<{ name: string; definition: McpServerDefinition }>,
    skills?: unknown,
    offers?: {
      installs?: ReadonlyArray<ExtensionCatalog["plugins"][number]>;
      sources?: { plugins?: readonly string[]; marketplaces?: readonly string[] };
      only?: boolean;
    },
  ) => Promise<ExtensionActPlan[] | ExtensionFailure>;
  act?: (request: {
    providerId: string;
    profileId?: string;
    target: { kind: "mcp-server" | "skill" | "plugin" | "marketplace"; id: string };
    act: "enable" | "disable" | "remove" | "sign-out" | "add" | "update" | "purge" | "install";
    definition?: McpServerDefinition;
    source?: string;
    onOutput?: (chunk: string) => void;
  }) => Promise<ExtensionActReceipt>;
  start?: (request: {
    providerId: string;
    profileId?: string;
    target: { kind: "mcp-server" | "skill" | "plugin" | "marketplace"; id: string };
    act: "sign-in" | "install" | "update" | "enable";
    source?: string;
  }) => Promise<StartedExtensionAct | ExtensionActReceipt>;
  catalog?: (
    provider: string,
    profileId: string,
    options?: { fresh?: boolean },
  ) => Promise<ExtensionCatalog | ExtensionFailure>;
  settle?: (
    started: StartedExtensionAct,
    ended?: { exitCode?: number | null; stopped?: boolean },
  ) => Promise<ExtensionActReceipt>;
}) {
  const sets = options.sets ?? { work: ["claude", "codex", "copilot"] };
  const extensionInventory = vi.fn(
    options.read ??
      (async (provider: string, profileId: string) =>
        provider === "copilot"
          ? ({
              status: "unsupported",
              provider,
              message: `agent provider does not expose extensions: ${provider}`,
              retryable: false,
            } satisfies ExtensionFailure)
          : { ...inventory(provider, []), profileId }),
  );
  const runtime = {
    profileSet: vi.fn(async (setId: string) =>
      sets[setId] === undefined
        ? undefined
        : {
            set: {
              id: setId,
              kind: "managed",
              label: setId,
              createdAt: "2026-09-23T00:00:00.000Z",
            },
            isDefault: false,
            profiles: sets[setId]!.map((provider) => profile(provider, setId)),
          },
    ),
    profileProviders: () => [
      { id: "claude", label: "Claude" },
      { id: "codex", label: "Codex" },
      { id: "copilot", label: "GitHub Copilot" },
    ],
    extensionProviders: () => [
      { id: "claude", label: "Claude", support: SUPPORT.claude! },
      { id: "codex", label: "Codex", support: SUPPORT.codex! },
    ],
    extensionInventory,
    extensionCatalog: vi.fn(
      options.catalog ??
        (async (provider: string) =>
          ({
            status: "unsupported",
            provider,
            message: `${provider} has no catalog to read`,
            retryable: false,
          }) satisfies ExtensionFailure),
    ),
    extensionActPlans: vi.fn(options.plans ?? (async () => [])),
    runExtensionAct: vi.fn(
      options.act ??
        (async () => {
          throw new Error("no act expected");
        }),
    ),
    startExtensionAct: vi.fn(
      options.start ??
        (async () => {
          throw new Error("no sign-in expected");
        }),
    ),
    settleExtensionAct: vi.fn(
      options.settle ??
        (async () => {
          throw new Error("no sign-in expected");
        }),
    ),
  };
  return {
    runtime: runtime as unknown as ConstructorParameters<
      typeof AgentExtensionService
    >[0]["runtime"],
    extensionInventory,
    extensionCatalog: runtime.extensionCatalog,
    extensionActPlans: runtime.extensionActPlans,
    runExtensionAct: runtime.runExtensionAct,
    startExtensionAct: runtime.startExtensionAct,
    settleExtensionAct: runtime.settleExtensionAct,
  };
}

const service = (runtime: ReturnType<typeof stubRuntime>["runtime"]) =>
  new AgentExtensionService({
    runtime,
    catalog: AGENT_CATALOG_READERS,
    home: HOME,
    now: () => new Date(NOW),
  });

describe("AgentExtensionService", () => {
  it("reads a profile's agents once, answers again from that read, and reads again when asked", async () => {
    const { runtime, extensionInventory } = stubRuntime({});
    const extensions = service(runtime);
    const first = AgentsExtensionsListResult.parse(await extensions.list("work"));
    expect(first.agents.map((column) => [column.provider, column.label])).toEqual([
      ["claude", "Claude"],
      ["codex", "Codex"],
      ["copilot", "GitHub Copilot"],
    ]);
    // An agent with no extension reader is a column that says so, never a guess.
    expect(first.agents[2]).toMatchObject({ support: {}, failure: { status: "unsupported" } });
    expect(extensionInventory.mock.calls).toEqual([
      ["claude", "work-claude"],
      ["codex", "work-codex"],
      ["copilot", "work-copilot"],
    ]);
    await extensions.list("work");
    expect(extensionInventory).toHaveBeenCalledTimes(3);
    await extensions.list("work", true);
    expect(extensionInventory).toHaveBeenCalledTimes(6);
  });

  it("shares one read between concurrent asks", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runtime, extensionInventory } = stubRuntime({
      read: async (provider, profileId) => {
        await gate;
        return { ...inventory(provider, []), profileId };
      },
    });
    const extensions = service(runtime);
    const asks = [extensions.list("work"), extensions.list("work", true)];
    release();
    const [a, b] = await Promise.all(asks);
    expect(a).toBe(b);
    expect(extensionInventory).toHaveBeenCalledTimes(3);
  });

  it("answers NOT_FOUND for a profile that does not exist", async () => {
    const extensions = service(stubRuntime({}).runtime);
    await expect(extensions.list("gone")).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await expect(extensions.subscribe("gone", () => undefined)).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
  });

  it("subscribes with the profile's agents while the first read runs, then sends the read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runtime } = stubRuntime({
      read: async (provider, profileId) => {
        await gate;
        if (provider === "copilot")
          return { status: "unsupported", provider, message: "no extensions", retryable: false };
        return { ...inventory(provider, [linear("linear")]), profileId };
      },
    });
    const extensions = service(runtime);
    const frames: unknown[] = [];
    const { snapshot, dispose } = await extensions.subscribe("work", (frame) => frames.push(frame));
    expect(AgentsExtensionsListResult.parse(snapshot)).toMatchObject({
      set: "work",
      reading: true,
      servers: [],
      agents: [{ provider: "claude" }, { provider: "codex" }, { provider: "copilot" }],
    });
    expect(snapshot).not.toHaveProperty("readAt");
    release();
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    const frame = AgentsExtensionsListResult.parse(frames[0]);
    expect(frame).toMatchObject({ reading: false, readAt: NOW });
    expect(Object.keys(frame.servers[0]!.cells)).toEqual(["claude", "codex"]);

    // A later subscriber gets the kept read as its snapshot, with no read of its own.
    const again = await extensions.subscribe("work", () => undefined);
    expect(again.snapshot).toBe(frames[0]);
    again.dispose();
    dispose();
  });

  it("reads a watched profile again when the registry changes, and forgets the rest", async () => {
    const { runtime, extensionInventory } = stubRuntime({
      sets: { work: ["claude"], home: ["codex"] },
    });
    const extensions = service(runtime);
    await extensions.list("home");
    const frames: unknown[] = [];
    const { dispose } = await extensions.subscribe("work", (frame) => frames.push(frame));
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    extensionInventory.mockClear();

    extensions.profilesChanged();
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect(extensionInventory.mock.calls).toEqual([["claude", "work-claude"]]);
    // The unwatched profile's read was dropped: the next ask reads it again.
    await extensions.list("home");
    expect(extensionInventory.mock.calls.at(-1)).toEqual(["codex", "home-codex"]);
    dispose();
  });
});

describe("AgentExtensionService acts (AR-S4c)", () => {
  /** Codex's own `linear`, on or off as the stub's "config" says, planned the way the adapter would. */
  function codexWithLinear() {
    let enabled = true;
    let release: (() => void) | undefined;
    const plans = async (
      _provider: string,
      _profileId: string | undefined,
      items: ReadonlyArray<McpServerItem | SkillItem | PluginItem>,
    ): Promise<ExtensionActPlan[]> =>
      items.flatMap((item) =>
        (["enable", "disable", "remove"] as const).map((act) => ({
          target: { kind: item.kind, id: item.id },
          act,
          available: true as const,
          runs:
            act === "remove"
              ? { kind: "command" as const, argv: ["codex", "mcp", "remove", item.id] }
              : { kind: "protocol" as const, method: "config/value/write" },
          display:
            act === "remove"
              ? `codex mcp remove ${item.id}`
              : `config/value/write mcp_servers.${item.id}.enabled = ${act === "enable"}`,
          reaches: act === "remove" ? (["definition"] as const) : [],
        })),
      ) as ExtensionActPlan[];
    const { runtime, runExtensionAct } = stubRuntime({
      sets: { work: ["codex"] },
      read: async (provider, profileId) => ({
        ...inventory(provider, [linear("linear", { enabled })]),
        profileId,
      }),
      plans,
      act: async (request) => {
        request.onOutput?.("config/value/write mcp_servers.linear.enabled = false\n");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        enabled = request.act === "enable";
        return {
          provider: "codex",
          profileId: request.profileId ?? "work-codex",
          target: request.target,
          act: request.act,
          status: "changed",
          startedAt: NOW,
          finishedAt: NOW,
          display: "config/value/write mcp_servers.linear.enabled = false",
          message: "turned off",
        };
      },
    });
    return { runtime, runExtensionAct, release: () => release?.() };
  }

  it("offers on each holding what its agent planned, leaving out the act that would change nothing", async () => {
    const { runtime } = codexWithLinear();
    const lens = AgentsExtensionsListResult.parse(await service(runtime).list("work"));
    expect(lens.servers[0]?.cells.codex?.[0]?.acts).toEqual([
      {
        act: "disable",
        runs: "config/value/write mcp_servers.linear.enabled = false",
        reaches: [],
      },
      { act: "remove", runs: "codex mcp remove linear", reaches: ["definition"] },
    ]);
  });

  it("runs one act at a time, its output on the frames, then reads the profile again", async () => {
    const { runtime, runExtensionAct, release } = codexWithLinear();
    const extensions = service(runtime);
    const frames: Array<ReturnType<typeof AgentsExtensionsListResult.parse>> = [];
    const { dispose } = await extensions.subscribe("work", (frame) =>
      frames.push(AgentsExtensionsListResult.parse(frame)),
    );
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    const acting = extensions.act({
      set: "work",
      provider: "codex",
      kind: "mcp-server",
      id: "linear",
      act: "disable",
    });
    await vi.waitFor(() =>
      expect(frames.at(-1)?.run).toMatchObject({
        provider: "codex",
        label: "Codex",
        name: "linear",
        act: "disable",
        state: "running",
        // rendered as a terminal would leave it
        output: "config/value/write mcp_servers.linear.enabled = false",
      }),
    );
    expect(runExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "codex",
        profileId: "work-codex",
        target: { kind: "mcp-server", id: "linear" },
        act: "disable",
      }),
    );
    // a second act for the profile while one runs is refused, not raced
    await expect(
      extensions.act({
        set: "work",
        provider: "codex",
        kind: "mcp-server",
        id: "linear",
        act: "remove",
      }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });

    release();
    const answered = AgentsExtensionsActResult.parse(await acting);
    expect(answered.receipt).toMatchObject({ status: "changed", message: "turned off" });
    expect(answered.run).toMatchObject({ state: "finished", finishedAt: NOW });
    // the read after the act: the cell says what Codex holds now, and offers the way back
    await vi.waitFor(() =>
      expect(frames.at(-1)?.servers[0]?.cells.codex?.[0]).toMatchObject({
        enabled: false,
        acts: [
          {
            act: "enable",
            runs: "config/value/write mcp_servers.linear.enabled = true",
            reaches: [],
          },
          { act: "remove", runs: "codex mcp remove linear", reaches: ["definition"] },
        ],
      }),
    );
    expect(frames.at(-1)?.run).toMatchObject({ state: "finished", receipt: { status: "changed" } });
    dispose();
  });

  it("refuses an act the agent does not offer, and a holding the profile does not have", async () => {
    const { runtime, runExtensionAct } = codexWithLinear();
    const extensions = service(runtime);
    await expect(
      extensions.act({
        set: "work",
        provider: "codex",
        kind: "mcp-server",
        id: "linear",
        act: "enable",
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    await expect(
      extensions.act({
        set: "work",
        provider: "codex",
        kind: "mcp-server",
        id: "sentry",
        act: "disable",
      }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "mcp-server",
        id: "linear",
        act: "disable",
      }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect(runExtensionAct).not.toHaveBeenCalled();
  });
});

describe("AgentExtensionService plugins (AR-S4e)", () => {
  /** Claude's own review plugin, at the version the stub's "store" says, and the account's synced one. */
  function claudeWithPlugins() {
    let version = "1.2.0";
    const review = (): PluginItem => ({
      kind: "plugin",
      id: "review@northlight",
      name: "review",
      origin: "own",
      enabled: true,
      version,
      marketplace: "northlight",
      location: `${ROOT}/claude/plugins/cache/northlight/review/${version}`,
      author: "Northlight Studio",
      homepage: "https://github.com/northlight-studio/plugins",
      brings: { commands: ["review"], hooks: ["PreToolUse"] },
    });
    const synced: PluginItem = {
      kind: "plugin",
      id: "security-guidance@synced",
      name: "security-guidance",
      origin: "managed",
      enabled: true,
    };
    const plans = async (
      _provider: string,
      _profileId: string | undefined,
      items: ReadonlyArray<McpServerItem | SkillItem | PluginItem>,
    ): Promise<ExtensionActPlan[]> =>
      items.flatMap((item) =>
        (["enable", "disable", "remove", "purge", "update"] as const).map(
          (act): ExtensionActPlan =>
            item.origin !== "own"
              ? {
                  target: { kind: item.kind, id: item.id },
                  act,
                  available: false,
                  reason: "not-own",
                  message: "It comes with your Claude account, from claude.ai, and changes there",
                }
              : {
                  target: { kind: item.kind, id: item.id },
                  act,
                  available: true,
                  runs: { kind: "command", argv: ["claude", "plugin", act, item.id] },
                  display: `claude plugin ${act} ${item.id}`,
                  reaches: [],
                },
        ),
      );
    const { runtime, runExtensionAct } = stubRuntime({
      sets: { work: ["claude"] },
      read: async (provider, profileId) => ({
        ...inventory(provider, [review(), synced]),
        profileId,
      }),
      plans,
      act: async (request) => {
        request.onOutput?.("Updating review@northlight…\n");
        version = "1.3.0";
        return {
          provider: "claude",
          profileId: request.profileId ?? "work-claude",
          target: request.target,
          act: request.act,
          status: "changed",
          startedAt: NOW,
          finishedAt: NOW,
          display: `claude plugin ${request.act} ${request.target.id}`,
          message: "updated 1.2.0 → 1.3.0",
        };
      },
    });
    return { runtime, runExtensionAct };
  }

  it("keeps each plugin on its agent's list with what it brings, the acts its agent offers, and why not the rest", async () => {
    const lens = AgentsExtensionsListResult.parse(
      await service(claudeWithPlugins().runtime).list("work"),
    );
    const [review, synced] = lens.plugins.claude ?? [];
    expect(review).toMatchObject({
      id: "review@northlight",
      author: "Northlight Studio",
      homepage: "https://github.com/northlight-studio/plugins",
      brings: { commands: ["review"], hooks: ["PreToolUse"] },
      place:
        "~/Library/Application Support/VibeField/agents/profiles/work/claude/plugins/cache/northlight/review/1.2.0",
    });
    // turning on one that is on changes nothing, so it is neither offered nor explained
    expect(review?.acts?.map((act) => act.act)).toEqual(["disable", "remove", "purge", "update"]);
    expect(review?.acts?.[3]).toEqual({
      act: "update",
      runs: "claude plugin update review@northlight",
      reaches: [],
    });
    expect(review).not.toHaveProperty("unavailable");
    expect(synced).not.toHaveProperty("acts");
    expect(synced?.unavailable?.map((entry) => [entry.act, entry.reason])).toEqual([
      ["disable", "not-own"],
      ["remove", "not-own"],
      ["purge", "not-own"],
      ["update", "not-own"],
    ]);
  });

  it("updates a plugin through its agent's own command, then reads the profile again", async () => {
    const { runtime, runExtensionAct } = claudeWithPlugins();
    const extensions = service(runtime);
    const answered = AgentsExtensionsActResult.parse(
      await extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "review@northlight",
        act: "update",
      }),
    );
    expect(runExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "claude",
        profileId: "work-claude",
        target: { kind: "plugin", id: "review@northlight" },
        act: "update",
      }),
    );
    expect(answered.run).toMatchObject({
      kind: "plugin",
      item: "review@northlight",
      name: "review",
      act: "update",
      runs: "claude plugin update review@northlight",
      state: "finished",
      output: "Updating review@northlight…",
    });
    expect(answered.receipt).toMatchObject({ status: "changed", message: "updated 1.2.0 → 1.3.0" });
    const after = AgentsExtensionsListResult.parse(await extensions.list("work"));
    expect(after.plugins.claude?.[0]?.version).toBe("1.3.0");
  });

  it("refuses an act the agent offers none of in its own words, a plugin it does not hold, and values", async () => {
    const { runtime, runExtensionAct } = claudeWithPlugins();
    const extensions = service(runtime);
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "security-guidance@synced",
        act: "remove",
      }),
    ).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      message:
        "Claude offers no remove for security-guidance here: It comes with your Claude account, from claude.ai, and changes there",
    });
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "gone@northlight",
        act: "update",
      }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "review@northlight",
        act: "update",
        values: { TOKEN: "x" },
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(runExtensionAct).not.toHaveBeenCalled();
  });
});

describe("AgentExtensionService sign-ins (AR-S4c)", () => {
  const PRINCIPAL = { kind: "shell-main" } as GrantPrincipal;
  const TICKET = { sessionId: "pty-sign-in" } as unknown as TerminalCreateOpenResult;
  const LINEAR = { kind: "mcp-server" as const, id: "linear" };

  /** Codex's own remote `linear`, which asks for a sign-in until the "person" finishes one. */
  function codexAsking(options: { enabled?: boolean } = {}) {
    const state = { auth: "needs-sign-in" as "needs-sign-in" | "signed-in" };
    const plans = async (
      _provider: string,
      _profileId: string | undefined,
      items: ReadonlyArray<McpServerItem | SkillItem | PluginItem>,
    ): Promise<ExtensionActPlan[]> =>
      items.flatMap((item) =>
        (["enable", "disable", "remove", "sign-in", "sign-out"] as const).map((act) => {
          const verb = act === "sign-in" ? "login" : act === "sign-out" ? "logout" : act;
          return {
            target: { kind: item.kind, id: item.id },
            act,
            available: true as const,
            runs: {
              kind: act === "sign-in" ? ("terminal" as const) : ("command" as const),
              argv: ["codex", "mcp", verb, item.id],
            },
            display: `codex mcp ${verb} ${item.id}`,
            reaches:
              act === "sign-in" || act === "sign-out"
                ? (["every-profile"] as const)
                : act === "remove"
                  ? (["definition"] as const)
                  : [],
          };
        }),
      ) as ExtensionActPlan[];
    const started: StartedExtensionAct = {
      runtimeSessionId: "pty-sign-in",
      providerId: "codex",
      profileId: "work-codex",
      target: LINEAR,
      act: "sign-in",
      display: "codex mcp login linear",
      reaches: ["every-profile"],
      startedAt: NOW,
      before: linear("linear", { auth: "needs-sign-in" }) as McpServerItem,
    };
    const stub = stubRuntime({
      sets: { work: ["codex"] },
      read: async (provider, profileId) => ({
        ...inventory(provider, [
          linear("linear", { auth: state.auth, enabled: options.enabled ?? true }),
        ]),
        profileId,
      }),
      plans,
      start: async () => started,
      settle: async (_started, ended) => ({
        provider: "codex",
        profileId: "work-codex",
        target: LINEAR,
        act: "sign-in",
        status: state.auth === "signed-in" ? "changed" : "unchanged",
        startedAt: NOW,
        finishedAt: NOW,
        display: "codex mcp login linear",
        ...(typeof ended?.exitCode === "number" ? { exitCode: ended.exitCode } : {}),
        message: state.auth === "signed-in" ? "signed in" : "Codex still asks you to sign in",
      }),
    });
    const panes = {
      open: vi.fn<ExtensionSignInPanes["open"]>(() => TICKET),
      close: vi.fn<ExtensionSignInPanes["close"]>(async () => undefined),
    };
    const make = (extra: { panes?: ExtensionSignInPanes | null; signInWaitMs?: number } = {}) =>
      new AgentExtensionService({
        runtime: stub.runtime,
        catalog: AGENT_CATALOG_READERS,
        home: HOME,
        now: () => new Date(NOW),
        ...(extra.panes === null ? {} : { panes: extra.panes ?? panes }),
        ...(extra.signInWaitMs !== undefined ? { signInWaitMs: extra.signInWaitMs } : {}),
      });
    return { ...stub, state, panes, make, signIn: () => state };
  }

  const exit = (
    sessionId: string,
    fields: { exitCode: number | null; requestedTermination: string | null },
  ) =>
    ({ type: "session-exited", sessionId, ...fields }) as unknown as Parameters<
      AgentExtensionService["handleTerminalExit"]
    >[0];

  it("offers a sign-in where the agent asks, a sign-out only where it says signed in, and marks the one that needs a terminal", async () => {
    const t = codexAsking();
    const asking = AgentsExtensionsListResult.parse(await t.make().list("work"));
    expect(asking.servers[0]?.cells.codex?.[0]?.acts?.map((act) => act.act)).toEqual([
      "disable",
      "remove",
      "sign-in",
    ]);
    expect(asking.servers[0]?.cells.codex?.[0]?.acts?.[2]).toEqual({
      act: "sign-in",
      runs: "codex mcp login linear",
      reaches: ["every-profile"],
      terminal: true,
    });
    t.state.auth = "signed-in";
    const signedIn = AgentsExtensionsListResult.parse(await t.make().list("work"));
    expect(signedIn.servers[0]?.cells.codex?.[0]?.acts?.map((act) => act.act)).toEqual([
      "disable",
      "remove",
      "sign-out",
    ]);
    // a server the agent does not load is not signed in to
    const off = codexAsking({ enabled: false });
    const lens = AgentsExtensionsListResult.parse(await off.make().list("work"));
    expect(lens.servers[0]?.cells.codex?.[0]?.acts?.map((act) => act.act)).toEqual([
      "enable",
      "remove",
    ]);
  });

  it("opens the sign-in in a pane for the caller, holds the profile while it runs, and settles it when the pane ends", async () => {
    const t = codexAsking();
    const extensions = t.make();
    const frames: Array<ReturnType<typeof AgentsExtensionsListResult.parse>> = [];
    const { dispose } = await extensions.subscribe("work", (frame) =>
      frames.push(AgentsExtensionsListResult.parse(frame)),
    );
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    const answered = await extensions.signIn(
      { set: "work", provider: "codex", id: "linear" },
      PRINCIPAL,
    );
    expect(answered.terminal).toBe(TICKET);
    expect(answered.run).toMatchObject({
      act: "sign-in",
      name: "linear",
      runs: "codex mcp login linear",
      state: "running",
      terminal: { sessionId: "pty-sign-in" },
    });
    expect(t.panes.open).toHaveBeenCalledWith("pty-sign-in", PRINCIPAL);
    expect(t.startExtensionAct).toHaveBeenCalledWith({
      providerId: "codex",
      profileId: "work-codex",
      target: LINEAR,
      act: "sign-in",
    });
    await vi.waitFor(() =>
      expect(frames.at(-1)?.run).toMatchObject({
        state: "running",
        terminal: { sessionId: "pty-sign-in" },
      }),
    );
    // the profile is held while the pane is open
    await expect(
      extensions.act({
        set: "work",
        provider: "codex",
        kind: "mcp-server",
        id: "linear",
        act: "remove",
      }),
    ).rejects.toMatchObject({
      kind: "CONFLICT",
      message: "Codex is still signing in to linear in this Agent Profile",
    });

    // the person finishes in the browser; the pane ends
    t.state.auth = "signed-in";
    expect(
      await extensions.handleTerminalExit(
        exit("pty-sign-in", { exitCode: 0, requestedTermination: null }),
      ),
    ).toBe(true);
    expect(t.settleExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeSessionId: "pty-sign-in" }),
      {
        exitCode: 0,
        stopped: false,
      },
    );
    expect(t.panes.close).toHaveBeenCalledWith("pty-sign-in");
    await vi.waitFor(() =>
      expect(frames.at(-1)?.servers[0]?.cells.codex?.[0]).toMatchObject({ auth: "signed-in" }),
    );
    const run = frames.at(-1)?.run;
    expect(run).toMatchObject({
      state: "finished",
      receipt: { status: "changed", message: "signed in" },
    });
    expect(run?.terminal).toBeUndefined();
    // a pane that was never a sign-in's is not this service's
    expect(
      await extensions.handleTerminalExit(
        exit("pty-other", { exitCode: 0, requestedTermination: null }),
      ),
    ).toBe(false);
    dispose();
  });

  it("says a pane the person closed was stopped, not refused", async () => {
    const t = codexAsking();
    const extensions = t.make();
    await extensions.signIn({ set: "work", provider: "codex", id: "linear" }, PRINCIPAL);
    await extensions.handleTerminalExit(
      exit("pty-sign-in", { exitCode: null, requestedTermination: "api" }),
    );
    expect(t.settleExtensionAct).toHaveBeenCalledWith(expect.anything(), {
      exitCode: null,
      stopped: true,
    });
  });

  it("refuses without a floor, ends a pane no ticket can reach, and says when the agent no longer offers it", async () => {
    const t = codexAsking();
    await expect(
      t.make({ panes: null }).signIn({ set: "work", provider: "codex", id: "linear" }, PRINCIPAL),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    expect(t.startExtensionAct).not.toHaveBeenCalled();

    t.panes.open.mockImplementationOnce(() => {
      throw new Error("no ticket");
    });
    await expect(
      t.make().signIn({ set: "work", provider: "codex", id: "linear" }, PRINCIPAL),
    ).rejects.toThrow("no ticket");
    expect(t.panes.close).toHaveBeenCalledWith("pty-sign-in");

    t.startExtensionAct.mockImplementationOnce(async () => ({
      provider: "codex",
      profileId: "work-codex",
      target: LINEAR,
      act: "sign-in",
      status: "unavailable",
      startedAt: NOW,
      finishedAt: NOW,
      message: "Codex has no sign-in for linear: it sends a key, or asks for none",
    }));
    await expect(
      t.make().signIn({ set: "work", provider: "codex", id: "linear" }, PRINCIPAL),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    // signed in already: the lens offers no sign-in, so none is started
    t.state.auth = "signed-in";
    await expect(
      t.make().signIn({ set: "work", provider: "codex", id: "linear" }, PRINCIPAL),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  });

  it("leaves a pane nobody finished to the person once the wait runs out, and reads again when it ends", async () => {
    const t = codexAsking();
    const extensions = t.make({ signInWaitMs: 5 });
    await extensions.signIn({ set: "work", provider: "codex", id: "linear" }, PRINCIPAL);
    await vi.waitFor(() =>
      expect(t.settleExtensionAct).toHaveBeenCalledWith(expect.anything(), undefined),
    );
    // still the person's: nothing closed it, and the profile is free again
    expect(t.panes.close).not.toHaveBeenCalled();
    await vi.waitFor(async () =>
      expect(AgentsExtensionsListResult.parse(await extensions.list("work")).run).toMatchObject({
        state: "finished",
        receipt: { status: "unchanged" },
      }),
    );
    const reads = t.extensionInventory.mock.calls.length;
    t.state.auth = "signed-in";
    expect(
      await extensions.handleTerminalExit(
        exit("pty-sign-in", { exitCode: 0, requestedTermination: null }),
      ),
    ).toBe(true);
    expect(t.panes.close).toHaveBeenCalledWith("pty-sign-in");
    expect(t.extensionInventory.mock.calls.length).toBeGreaterThan(reads);
    expect(t.settleExtensionAct).toHaveBeenCalledTimes(1);
  });
});

describe("AgentExtensionService adding once (AR-S4d)", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const CONTEXT7: McpServerDefinition = {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: ["CONTEXT7_API_KEY"],
  };
  const NOTION: McpServerDefinition = { transport: "http", url: "https://mcp.notion.com/mcp" };
  const SECRET = "ctx7_secret_value_never_on_the_wire";

  /**
   * Work: Claude holds its own context7 (a definition that can travel), Codex
   * holds nothing, and the profile keeps notion that no agent holds. Each
   * agent's add is planned the way its adapter would; the "config" is the map
   * the stub's act edits.
   */
  async function workAdding() {
    dir = await mkdtemp(join(tmpdir(), "fieldd-extensions-adding-"));
    const entries = new Map<string, string>();
    const keychain = {
      get: vi.fn(async (_service: string, account: string) => entries.get(account) ?? null),
      set: vi.fn(async (_service: string, account: string, value: string) => {
        entries.set(account, value);
      }),
      delete: vi.fn(async (_service: string, account: string) => {
        entries.delete(account);
      }),
    };
    const store = new AgentExtensionStore({
      dir,
      skillsDir: join(dir, "skills"),
      secrets: keychain,
      now: () => new Date(NOW),
    });
    await store.keep("work", "notion", NOTION);
    const holds = new Map<string, Map<string, McpServerDefinition>>([
      ["claude", new Map([["context7", CONTEXT7]])],
      ["codex", new Map()],
    ]);
    let release: (() => void) | undefined;
    let hold = false;
    const stub = stubRuntime({
      sets: { work: ["claude", "codex"] },
      read: async (provider, profileId) => ({
        ...inventory(
          provider,
          [...(holds.get(provider) ?? new Map())].map(
            ([name, definition]) =>
              ({
                kind: "mcp-server",
                id: name,
                name,
                origin: "own",
                enabled: true,
                transport: definition.transport,
                target:
                  definition.transport === "stdio"
                    ? [definition.command, ...definition.args].join(" ")
                    : definition.url,
                ...(definition.transport === "stdio" && definition.env !== undefined
                  ? { env: definition.env }
                  : {}),
                definition,
              }) as ExtensionItem,
          ),
        ),
        profileId,
      }),
      plans: async (provider, _profileId, items, adds = []) => [
        ...items.map(
          (item): ExtensionActPlan => ({
            target: { kind: item.kind, id: item.id },
            act: "remove",
            available: true,
            runs: { kind: "command", argv: [provider, "mcp", "remove", item.id] },
            display: `${provider} mcp remove ${item.id}`,
            reaches: ["definition"],
          }),
        ),
        ...adds.map(
          ({ name }): ExtensionActPlan => ({
            target: { kind: "mcp-server", id: name },
            act: "add",
            available: true,
            runs: { kind: "command", argv: [provider, "mcp", "add", name] },
            display: `${provider} mcp add ${name}`,
            reaches: [],
          }),
        ),
      ],
      act: async (request) => {
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        const agent = holds.get(request.providerId)!;
        if (request.act === "add") agent.set(request.target.id, request.definition!);
        if (request.act === "remove") agent.delete(request.target.id);
        return {
          provider: request.providerId,
          profileId: request.profileId ?? `work-${request.providerId}`,
          target: request.target,
          act: request.act,
          status: "changed",
          startedAt: NOW,
          finishedAt: NOW,
          display: `${request.providerId} mcp ${request.act} ${request.target.id}`,
          message: request.act === "add" ? "added" : "removed",
        };
      },
    });
    const extensions = new AgentExtensionService({
      runtime: stub.runtime,
      catalog: AGENT_CATALOG_READERS,
      home: HOME,
      store,
      now: () => new Date(NOW),
    });
    return {
      ...stub,
      extensions,
      store,
      keychain,
      holds,
      holdNext: () => {
        hold = true;
      },
      release: () => {
        hold = false;
        release?.();
      },
    };
  }

  it("offers each agent that holds none of a server its own add, from the definition its row gives", async () => {
    const t = await workAdding();
    const lens = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    const context7 = lens.servers.find((row) => row.name === "context7")!;
    expect(context7).toMatchObject({
      definition: CONTEXT7,
      needs: ["CONTEXT7_API_KEY"],
      offers: { codex: { act: { act: "add", runs: "codex mcp add context7", reaches: [] } } },
    });
    expect(context7.kept).toBeUndefined();
    // Claude holds it: its cell offers its own acts, and no add
    expect(context7.offers?.claude).toBeUndefined();
    expect(context7.cells.claude?.[0]?.acts?.map((act) => act.act)).toEqual(["remove"]);
    // a server the profile keeps shows though no agent holds it, offered to both
    expect(lens.servers.find((row) => row.name === "notion")).toMatchObject({
      versions: 0,
      cells: {},
      kept: true,
      definition: NOTION,
      offers: {
        claude: { act: { act: "add", runs: "claude mcp add notion" } },
        codex: { act: { act: "add", runs: "codex mcp add notion" } },
      },
    });
    // each agent was asked to plan only what it holds none of — and where a
    // skill of its own would be kept, the profile's skills folder
    const keep = { keep: join(dir!, "skills", "work") };
    expect(t.extensionActPlans).toHaveBeenCalledWith(
      "codex",
      "work-codex",
      [],
      [
        { name: "context7", definition: CONTEXT7 },
        { name: "notion", definition: NOTION },
      ],
      keep,
    );
    expect(t.extensionActPlans).toHaveBeenCalledWith(
      "claude",
      "work-claude",
      expect.any(Array),
      [{ name: "notion", definition: NOTION }],
      keep,
    );
  });

  it("turns a server on for an agent that holds none of it: the value kept first, then its own add, then what it was given", async () => {
    const t = await workAdding();
    const frames: string[] = [];
    const { dispose } = await t.extensions.subscribe("work", (frame) =>
      frames.push(JSON.stringify(frame)),
    );
    const answered = AgentsExtensionsActResult.parse(
      await t.extensions.act({
        set: "work",
        provider: "codex",
        kind: "mcp-server",
        id: "context7",
        act: "add",
        values: { CONTEXT7_API_KEY: SECRET },
      }),
    );
    expect(answered.receipt).toMatchObject({ status: "changed", message: "added" });
    expect(t.runExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "codex",
        target: { kind: "mcp-server", id: "context7" },
        act: "add",
        definition: CONTEXT7,
      }),
    );
    // the value in the keychain entry; the keep names it, the definition and who has it
    expect(JSON.parse((await t.keychain.get("", "work"))!)).toEqual({ CONTEXT7_API_KEY: SECRET });
    await expect(t.store.read("work")).resolves.toMatchObject({
      servers: { context7: { definition: CONTEXT7 } },
      values: ["CONTEXT7_API_KEY"],
      given: { codex: { context7: ["CONTEXT7_API_KEY"] } },
    });
    await expect(t.store.launchValues("work", "codex")).resolves.toEqual({
      CONTEXT7_API_KEY: SECRET,
    });
    // Claude kept its own value in its own config, and is started with nothing of ours
    await expect(t.store.launchValues("work", "claude")).resolves.toBeUndefined();
    // the lens says what is kept, by name, and needs nothing now
    const lens = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    expect(lens.values).toEqual(["CONTEXT7_API_KEY"]);
    const row = lens.servers.find((candidate) => candidate.name === "context7")!;
    expect(row.kept).toBe(true);
    expect(row.needs).toBeUndefined();
    expect(row.cells.codex?.[0]).toMatchObject({ id: "context7" });
    // never a value on the wire
    expect(JSON.stringify(answered)).not.toContain(SECRET);
    expect(frames.join("\n")).not.toContain(SECRET);
    dispose();
  });

  it("asks for a value the server reads before any agent is given it, and takes no stray name", async () => {
    const t = await workAdding();
    const turn = (values?: Record<string, string>, provider = "codex") =>
      t.extensions.act({
        set: "work",
        provider,
        kind: "mcp-server",
        id: "context7",
        act: "add",
        ...(values === undefined ? {} : { values }),
      });
    await expect(turn()).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      message: "context7 needs a value for CONTEXT7_API_KEY",
    });
    await expect(turn({ CONTEXT7_API_KEY: SECRET, OTHER_KEY: "x" })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      message: "context7 does not read OTHER_KEY",
    });
    // Claude holds it already: no add is offered there
    await expect(turn({ CONTEXT7_API_KEY: SECRET }, "claude")).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    // values ride only an add
    await expect(
      t.extensions.act({
        set: "work",
        provider: "claude",
        kind: "mcp-server",
        id: "context7",
        act: "remove",
        values: { CONTEXT7_API_KEY: SECRET },
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(t.runExtensionAct).not.toHaveBeenCalled();
    expect(t.keychain.set).not.toHaveBeenCalled();
  });

  it("Add server keeps the definition once, then runs each agent's add in turn, holding the profile until the last", async () => {
    const t = await workAdding();
    await t.extensions.list("work");
    t.holdNext();
    const linear: McpServerDefinition = { transport: "http", url: "https://mcp.linear.app/mcp" };
    const adding = t.extensions.add({
      set: "work",
      name: "linear",
      definition: linear,
      agents: ["claude", "codex"],
    });
    await vi.waitFor(() => expect(t.runExtensionAct).toHaveBeenCalledTimes(1));
    // no other act lands between two of the Add's
    await expect(
      t.extensions.act({
        set: "work",
        provider: "claude",
        kind: "mcp-server",
        id: "context7",
        act: "remove",
      }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    t.release();
    const result = await adding;
    expect(result.receipts.map((entry) => [entry.provider, entry.receipt.status])).toEqual([
      ["claude", "changed"],
      ["codex", "changed"],
    ]);
    expect(t.runExtensionAct.mock.calls.map(([request]) => request.providerId)).toEqual([
      "claude",
      "codex",
    ]);
    await expect(t.store.read("work")).resolves.toMatchObject({
      servers: { linear: { definition: linear } },
      given: { claude: { linear: [] }, codex: { linear: [] } },
    });
    // a name the profile already has is the person's to rename
    await expect(
      t.extensions.add({ set: "work", name: "linear", definition: linear, agents: [] }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
  });

  it("keeps no definition that hides a key, and no value under a name an agent's environment keeps", async () => {
    const t = await workAdding();
    await expect(
      t.extensions.add({
        set: "work",
        name: "search",
        definition: {
          transport: "stdio",
          command: "uvx",
          args: ["search-mcp", "--api-key", "abc123"],
        },
        agents: ["codex"],
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED", details: { reason: "hides-a-value" } });
    await expect(
      t.extensions.add({
        set: "work",
        name: "search",
        definition: { transport: "http", url: "https://mcp.example.com/mcp?key=abc123" },
        agents: [],
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED", details: { reason: "hides-a-value" } });
    for (const name of ["PATH", "NODE_OPTIONS", "CODEX_HOME", "FIELDD_TOKEN"]) {
      await expect(
        t.extensions.add({
          set: "work",
          name: "search",
          definition: { transport: "stdio", command: "npx", args: ["search-mcp"], env: [name] },
          values: { [name]: "x" },
          agents: [],
        }),
      ).rejects.toMatchObject({
        kind: "PRECONDITION_FAILED",
        details: { reason: "reserved-name" },
      });
    }
    expect(t.keychain.set).not.toHaveBeenCalled();
    expect(t.runExtensionAct).not.toHaveBeenCalled();
  });

  it("plans an Add on each agent before anything is kept", async () => {
    const t = await workAdding();
    const linear: McpServerDefinition = { transport: "http", url: "https://mcp.linear.app/mcp" };
    await expect(
      t.extensions.plan({ set: "work", name: "linear", definition: linear }),
    ).resolves.toEqual({
      offers: {
        claude: { act: { act: "add", runs: "claude mcp add linear", reaches: [] } },
        codex: { act: { act: "add", runs: "codex mcp add linear", reaches: [] } },
      },
    });
    // an agent that holds the name says so
    await expect(
      t.extensions.plan({ set: "work", name: "context7", definition: CONTEXT7 }),
    ).resolves.toMatchObject({
      offers: {
        claude: { unavailable: { reason: "held" } },
        codex: { act: { act: "add" } },
      },
    });
    await expect(t.store.read("work")).resolves.toMatchObject({ servers: { notion: {} } });
    expect(Object.keys((await t.store.read("work")).servers)).toEqual(["notion"]);
  });

  it("keeps the definition of a server an agent lets go, so turning it on again is one click", async () => {
    const t = await workAdding();
    await t.extensions.act({
      set: "work",
      provider: "claude",
      kind: "mcp-server",
      id: "context7",
      act: "remove",
    });
    await expect(t.store.read("work")).resolves.toMatchObject({
      servers: { context7: { definition: CONTEXT7 } },
    });
    const lens = AgentsExtensionsListResult.parse(await t.extensions.list("work"));
    // no agent holds it, the profile still does, and both agents are offered it back
    expect(lens.servers.find((row) => row.name === "context7")).toMatchObject({
      kept: true,
      cells: {},
      offers: { claude: { act: { act: "add" } }, codex: { act: { act: "add" } } },
    });
  });
});

describe("AgentExtensionService catalogs and installs (AR-S4e2)", () => {
  const PRINCIPAL = { kind: "shell-main" } as GrantPrincipal;
  const TICKET = { sessionId: "pty-install" } as unknown as TerminalCreateOpenResult;

  /**
   * Claude holding one marketplace and the review plugin from it; its catalog
   * lists review newer, lint to install, telemetry its organization blocks, and
   * shell-helper, whose install asks the person to accept a command. The stub's
   * "store" moves the way Claude's own commands would.
   */
  function claudeWithCatalog() {
    const state = {
      updatedAt: "2026-09-26T09:00:00.000Z",
      plugins: new Map<string, string>([["review@northlight", "1.2.0"]]),
      marketplaces: new Map<string, string>([["northlight", "northlight/plugins"]]),
    };
    const items = (): ExtensionItem[] => [
      ...[...state.marketplaces].map(
        ([id, source]): MarketplaceItem => ({
          kind: "marketplace",
          id,
          name: id,
          origin: "own",
          enabled: true,
          source,
          updatedAt: state.updatedAt,
        }),
      ),
      ...[...state.plugins].map(
        ([id, version]): PluginItem => ({
          kind: "plugin",
          id,
          name: id.split("@")[0]!,
          origin: "own",
          enabled: true,
          version,
          marketplace: "northlight",
        }),
      ),
    ];
    const catalog = async (_provider: string, profileId: string): Promise<ExtensionCatalog> => ({
      provider: "claude",
      profileId,
      fetchedAt: NOW,
      marketplaces: [...state.marketplaces].map(([id, source]) => ({
        id,
        name: id,
        source,
        origin: "own" as const,
        updatedAt: state.updatedAt,
      })),
      plugins: (
        [
          {
            id: "review@northlight",
            name: "review",
            marketplace: "northlight",
            version: "1.3.0",
            held: "review@northlight",
            ...(state.plugins.get("review@northlight") !== "1.3.0" ? { newer: true as const } : {}),
          },
          {
            id: "lint@northlight",
            name: "lint",
            marketplace: "northlight",
            version: "2.0.0",
            description: "Lints what you write",
            brings: { commands: ["lint"], skills: ["style"] },
            ...(state.plugins.has("lint@northlight") ? { held: "lint@northlight" } : {}),
          },
          {
            id: "telemetry@northlight",
            name: "telemetry",
            marketplace: "northlight",
            blocked: "Your organization turned it off in Claude Code",
          },
          {
            id: "shell-helper@northlight",
            name: "shell-helper",
            marketplace: "northlight",
            asks: [{ kind: "command", command: "npx shell-helper fetch" }],
          },
        ] satisfies ExtensionCatalog["plugins"]
      ).filter((plugin) => state.marketplaces.has(plugin.marketplace)),
      suggested: [
        {
          name: "claude-plugins-official",
          source: "anthropics/claude-plugins-official",
          message:
            "Claude Code adds claude-plugins-official the first time it starts in this profile",
        },
      ],
      source: { kind: "native-store", stability: "documented" },
    });
    const command = (
      target: { kind: "plugin" | "marketplace"; id: string },
      act: ExtensionActPlan["act"],
      argv: string[],
      reaches: Array<"plugins"> = [],
      terminal = false,
    ): ExtensionActPlan => ({
      target,
      act,
      available: true,
      runs: { kind: terminal ? "terminal" : "command", argv },
      display: argv.join(" "),
      reaches,
    });
    const plans = async (
      _provider: string,
      _profileId: string | undefined,
      held: ReadonlyArray<McpServerItem | SkillItem | PluginItem | MarketplaceItem>,
      _adds?: unknown,
      _skills?: unknown,
      offers?: {
        installs?: ReadonlyArray<ExtensionCatalog["plugins"][number]>;
        sources?: { plugins?: readonly string[]; marketplaces?: readonly string[] };
        only?: boolean;
      },
    ): Promise<ExtensionActPlan[]> => {
      const out: ExtensionActPlan[] = [];
      if (offers?.only !== true) {
        for (const item of held) {
          if (item.kind !== "marketplace") continue;
          const target = { kind: "marketplace" as const, id: item.id };
          out.push(
            command(target, "update", ["claude", "plugin", "marketplace", "update", item.id]),
          );
          out.push(
            command(
              target,
              "remove",
              ["claude", "plugin", "marketplace", "remove", item.id],
              ["plugins"],
            ),
          );
        }
      }
      for (const listed of offers?.installs ?? []) {
        const target = { kind: "plugin" as const, id: listed.id };
        if (listed.held !== undefined) {
          out.push({
            target,
            act: "install",
            available: false,
            reason: "held",
            message: "Claude already has it",
          });
        } else if (listed.blocked !== undefined) {
          out.push({
            target,
            act: "install",
            available: false,
            reason: "blocked",
            message: listed.blocked,
          });
        } else {
          const asks = listed.asks?.some((ask) => ask.kind === "command") === true;
          out.push(
            command(
              target,
              "install",
              [
                "claude",
                "plugin",
                "install",
                listed.id,
                "--scope",
                "user",
                ...(asks ? [] : ["-y"]),
              ],
              [],
              asks,
            ),
          );
        }
      }
      for (const source of offers?.sources?.plugins ?? []) {
        out.push({
          target: { kind: "plugin", id: source },
          act: "install",
          available: false,
          reason: "unsupported",
          message: "Claude installs a plugin from a marketplace",
        });
      }
      for (const source of offers?.sources?.marketplaces ?? []) {
        const target = { kind: "marketplace" as const, id: source };
        out.push(
          [...state.marketplaces.values()].includes(source)
            ? {
                target,
                act: "add",
                available: false,
                reason: "held",
                message: "Claude already has it",
              }
            : command(target, "add", ["claude", "plugin", "marketplace", "add", source]),
        );
      }
      return out;
    };
    const stub = stubRuntime({
      sets: { work: ["claude"] },
      read: async (provider, profileId) => ({ ...inventory(provider, items()), profileId }),
      plans,
      catalog,
      act: async (request) => {
        const base = {
          provider: "claude",
          profileId: request.profileId ?? "work-claude",
          target: request.target,
          act: request.act,
          startedAt: NOW,
          finishedAt: NOW,
        };
        if (request.target.kind === "plugin" && request.act === "install") {
          state.plugins.set(request.target.id, "2.0.0");
          return {
            ...base,
            status: "changed",
            display: `claude plugin install ${request.target.id}`,
            message: "installed 2.0.0",
          };
        }
        if (request.target.kind === "marketplace" && request.act === "update") {
          state.updatedAt = "2026-09-27T09:00:00.000Z";
          state.plugins.set("review@northlight", "1.3.0");
          return { ...base, status: "changed", message: "fetched its catalog again" };
        }
        if (request.target.kind === "marketplace" && request.act === "add") {
          state.marketplaces.set("northlight-extra", request.source!);
          return { ...base, status: "changed", message: "added northlight-extra" };
        }
        if (request.target.kind === "marketplace" && request.act === "remove") {
          state.marketplaces.delete(request.target.id);
          return { ...base, status: "changed", message: "removed" };
        }
        throw new Error(`no ${request.act} expected`);
      },
      start: async (request) => ({
        runtimeSessionId: "pty-install",
        providerId: "claude",
        profileId: "work-claude",
        target: request.target,
        act: request.act,
        display: `claude plugin install ${request.target.id} --scope user`,
        reaches: [],
        startedAt: NOW,
        known: [...state.plugins.keys()],
      }),
    });
    const panes = {
      open: vi.fn<ExtensionSignInPanes["open"]>(() => TICKET),
      close: vi.fn<ExtensionSignInPanes["close"]>(async () => undefined),
    };
    const make = () =>
      new AgentExtensionService({
        runtime: stub.runtime,
        catalog: AGENT_CATALOG_READERS,
        home: HOME,
        now: () => new Date(NOW),
        panes,
      });
    return { ...stub, state, panes, make };
  }

  it("reads an agent's catalog: each plugin with its install or why not, the ones it holds, what each marketplace lists", async () => {
    const { make, extensionCatalog, extensionActPlans } = claudeWithCatalog();
    const extensions = make();
    const catalog = AgentsExtensionsCatalogResult.parse(
      await extensions.catalog({ set: "work", provider: "claude" }),
    );
    expect(catalog.marketplaces).toEqual([
      {
        id: "northlight",
        name: "northlight",
        origin: "own",
        source: "northlight/plugins",
        updatedAt: "2026-09-26T09:00:00.000Z",
        count: 4,
      },
    ]);
    const byId = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]));
    // one it holds is installed, with a newer version listed: no install, and nothing to explain
    expect(byId.get("review@northlight")).toMatchObject({ held: "review@northlight", newer: true });
    expect(byId.get("review@northlight")).not.toHaveProperty("install");
    expect(byId.get("review@northlight")).not.toHaveProperty("unavailable");
    expect(byId.get("lint@northlight")).toMatchObject({
      brings: { commands: ["lint"], skills: ["style"] },
      install: {
        act: "install",
        runs: "claude plugin install lint@northlight --scope user -y",
        reaches: [],
      },
    });
    expect(byId.get("telemetry@northlight")).toMatchObject({
      unavailable: { reason: "blocked", message: "Your organization turned it off in Claude Code" },
    });
    expect(byId.get("shell-helper@northlight")?.install).toMatchObject({ terminal: true });
    // the official marketplace it lacks can be added now, by Claude's own add
    expect(catalog.suggested).toEqual([
      {
        name: "claude-plugins-official",
        source: "anthropics/claude-plugins-official",
        message:
          "Claude Code adds claude-plugins-official the first time it starts in this profile",
        add: {
          act: "add",
          runs: "claude plugin marketplace add anthropics/claude-plugins-official",
          reaches: [],
        },
      },
    ]);
    expect(extensionCatalog).toHaveBeenCalledWith("claude", "work-claude", { fresh: true });
    // installs were planned from what the lens holds, without planning acts on it again
    expect(extensionActPlans).toHaveBeenLastCalledWith(
      "claude",
      "work-claude",
      expect.any(Array),
      undefined,
      undefined,
      expect.objectContaining({ only: true }),
    );
    // the profile's plugin rows say what the catalog lists newer
    const lens = AgentsExtensionsListResult.parse(await extensions.list("work"));
    expect(lens.plugins.claude?.[0]).toMatchObject({
      id: "review@northlight",
      newer: { version: "1.3.0" },
    });
  });

  it("installs a listed plugin through its agent's own command, then reads the profile and the catalog again", async () => {
    const { make, runExtensionAct, extensionCatalog } = claudeWithCatalog();
    const extensions = make();
    await extensions.catalog({ set: "work", provider: "claude" });
    const answered = AgentsExtensionsActResult.parse(
      await extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "lint@northlight",
        act: "install",
      }),
    );
    expect(runExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "plugin", id: "lint@northlight" },
        act: "install",
      }),
    );
    expect(answered.run).toMatchObject({
      kind: "plugin",
      item: "lint@northlight",
      name: "lint",
      act: "install",
    });
    expect(answered.receipt).toMatchObject({ status: "changed", message: "installed 2.0.0" });
    expect(extensionCatalog).toHaveBeenCalledTimes(2);
    const lens = AgentsExtensionsListResult.parse(await extensions.list("work"));
    expect(lens.plugins.claude?.map((plugin) => plugin.id)).toContain("lint@northlight");
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "ghost@northlight",
        act: "install",
      }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "telemetry@northlight",
        act: "install",
      }),
    ).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      message:
        "Claude offers no install for telemetry here: Your organization turned it off in Claude Code",
    });
  });

  it("runs an install that asks first in a pane the person answers, never on the act door", async () => {
    const { make, runExtensionAct, startExtensionAct, panes } = claudeWithCatalog();
    const extensions = make();
    await extensions.catalog({ set: "work", provider: "claude" });
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "shell-helper@northlight",
        act: "install",
      }),
    ).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: expect.objectContaining({ reason: "terminal" }),
    });
    expect(runExtensionAct).not.toHaveBeenCalled();
    const opened = await extensions.terminal(
      {
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "shell-helper@northlight",
        act: "install",
      },
      PRINCIPAL,
    );
    expect(startExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "plugin", id: "shell-helper@northlight" },
        act: "install",
      }),
    );
    expect(panes.open).toHaveBeenCalledWith("pty-install", PRINCIPAL);
    expect(opened.run).toMatchObject({
      kind: "plugin",
      name: "shell-helper",
      act: "install",
      state: "running",
      terminal: { sessionId: "pty-install" },
    });
    // one act at a time: the profile is held while the pane is open
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "plugin",
        id: "lint@northlight",
        act: "install",
      }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
  });

  it("plans a typed source against what the agent holds, and adds a marketplace from one", async () => {
    const { make, runExtensionAct } = claudeWithCatalog();
    const extensions = make();
    expect(
      await extensions.planSource({
        set: "work",
        provider: "claude",
        kind: "plugin",
        source: "npm:x",
      }),
    ).toEqual({
      offer: {
        unavailable: {
          reason: "unsupported",
          message: "Claude installs a plugin from a marketplace",
        },
      },
    });
    expect(
      await extensions.planSource({
        set: "work",
        provider: "claude",
        kind: "marketplace",
        source: "northlight/plugins",
      }),
    ).toEqual({ offer: { unavailable: { reason: "held", message: "Claude already has it" } } });
    const added = AgentsExtensionsActResult.parse(
      await extensions.act({
        set: "work",
        provider: "claude",
        kind: "marketplace",
        id: "northlight/extra",
        source: "northlight/extra",
        act: "add",
      }),
    );
    expect(runExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "marketplace", id: "northlight/extra" },
        act: "add",
        source: "northlight/extra",
      }),
    );
    expect(added.run).toMatchObject({
      kind: "marketplace",
      name: "northlight/extra",
      runs: "claude plugin marketplace add northlight/extra",
    });
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "marketplace",
        id: "northlight/extra",
        source: "northlight/other",
        act: "add",
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  });

  it("checks for updates with each marketplace's own fetch in one run, then says when and how many are newer", async () => {
    const { make, runExtensionAct } = claudeWithCatalog();
    const extensions = make();
    const checked = AgentsExtensionsCheckResult.parse(
      await extensions.check({ set: "work", provider: "claude" }),
    );
    expect(runExtensionAct).toHaveBeenCalledTimes(1);
    expect(runExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "marketplace", id: "northlight" }, act: "update" }),
    );
    expect(checked.run).toMatchObject({
      kind: "marketplace",
      item: "northlight",
      act: "update",
      state: "finished",
    });
    expect(checked.receipt).toMatchObject({
      status: "changed",
      message: "fetched its catalog again",
    });
    // the fetch took review to 1.3.0 by itself: nothing is listed newer now
    expect(checked.updates).toBe(0);
    const lens = AgentsExtensionsListResult.parse(await extensions.list("work"));
    expect(lens.agents[0]?.checkedAt).toBe(NOW);
    expect(lens.plugins.claude?.[0]).not.toHaveProperty("newer");
  });

  it("removes a marketplace only as its agent offers, and refuses one it does not have", async () => {
    const { make, runExtensionAct } = claudeWithCatalog();
    const extensions = make();
    const lens = AgentsExtensionsListResult.parse(await extensions.list("work"));
    expect(lens.marketplaces.claude?.[0]?.acts?.map((act) => [act.act, act.reaches])).toEqual([
      ["update", []],
      ["remove", ["plugins"]],
    ]);
    const removed = AgentsExtensionsActResult.parse(
      await extensions.act({
        set: "work",
        provider: "claude",
        kind: "marketplace",
        id: "northlight",
        act: "remove",
      }),
    );
    expect(removed.receipt).toMatchObject({ status: "changed", message: "removed" });
    expect(runExtensionAct).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "marketplace", id: "northlight" }, act: "remove" }),
    );
    await expect(
      extensions.act({
        set: "work",
        provider: "claude",
        kind: "marketplace",
        id: "gone",
        act: "remove",
      }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });
});
