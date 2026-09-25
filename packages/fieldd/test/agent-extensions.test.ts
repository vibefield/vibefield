import type {
  AgentProfile,
  ExtensionActPlan,
  ExtensionActReceipt,
  ExtensionFailure,
  ExtensionInventory,
  ExtensionItem,
  ExtensionProvider,
  McpServerItem,
  SkillItem,
} from "@vibecook/puppeteer-core";
import { AgentsExtensionsActResult, AgentsExtensionsListResult } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  AgentExtensionService,
  abbreviateHome,
  buildExtensionLens,
  type ExtensionLensAgent,
} from "../src/agent-extensions";

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
    items: ReadonlyArray<McpServerItem | SkillItem>,
  ) => Promise<ExtensionActPlan[] | ExtensionFailure>;
  act?: (request: {
    providerId: string;
    profileId?: string;
    target: { kind: "mcp-server" | "skill"; id: string };
    act: "enable" | "disable" | "remove";
    onOutput?: (chunk: string) => void;
  }) => Promise<ExtensionActReceipt>;
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
    extensionActPlans: vi.fn(options.plans ?? (async () => [])),
    runExtensionAct: vi.fn(
      options.act ??
        (async () => {
          throw new Error("no act expected");
        }),
    ),
  };
  return {
    runtime: runtime as unknown as ConstructorParameters<
      typeof AgentExtensionService
    >[0]["runtime"],
    extensionInventory,
    runExtensionAct: runtime.runExtensionAct,
  };
}

const service = (runtime: ReturnType<typeof stubRuntime>["runtime"]) =>
  new AgentExtensionService({ runtime, home: HOME, now: () => new Date(NOW) });

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
      items: ReadonlyArray<McpServerItem | SkillItem>,
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
