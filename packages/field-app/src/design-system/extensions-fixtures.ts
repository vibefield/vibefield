import type { AgentExtensionRun, AgentsExtensionsListResult } from "@vibefield/contracts";

// Extensions on fixture data (AR-S4b): the lens fieldd sends for the "Work"
// profile — the same document as the contracts fixture
// (packages/contracts/fixtures/agents-extensions.valid.json; a test keeps them
// equal). Fixture DATA only — every view is the shipping one. Names, logins
// and paths are examples. AR-S4c: its holdings carry the acts their agents
// offer, and FIXTURE_EXTENSION_RUN is an act's run as the act fixture
// (agents-extensions-act.valid.json) has it; FIXTURE_EXTENSION_SIGNING_IN is a
// server's sign-in while its pane is open (agents-extensions-sign-in.valid.json).

/** The catalog's "now" for the lists: two minutes after the read. */
export const FIXTURE_EXTENSIONS_NOW = new Date("2026-09-25T09:02:10.000Z");

export const FIXTURE_EXTENSIONS: AgentsExtensionsListResult = {
  set: "work",
  reading: false,
  readAt: "2026-09-25T09:00:02.000Z",
  agents: [
    {
      provider: "claude",
      label: "Claude",
      profileId: "work-claude",
      support: {
        plugins: {
          store: "profile",
          changes: "command",
          read: true,
        },
        marketplaces: {
          store: "profile",
          changes: "command",
          read: true,
        },
        mcpServers: {
          store: "profile",
          changes: "command",
          read: true,
        },
        skills: {
          store: "profile",
          changes: "folder",
          read: true,
        },
      },
      counts: {
        plugins: 1,
        marketplaces: 1,
        mcpServers: 4,
        skills: 3,
      },
      fetchedAt: "2026-09-25T09:00:00.000Z",
    },
    {
      provider: "codex",
      label: "Codex",
      profileId: "work-codex",
      support: {
        plugins: {
          store: "profile",
          changes: "command",
          read: true,
        },
        marketplaces: {
          store: "mixed",
          changes: "command",
          read: false,
        },
        mcpServers: {
          store: "profile",
          changes: "command",
          read: true,
        },
        skills: {
          store: "mixed",
          changes: "folder",
          read: true,
        },
      },
      counts: {
        plugins: 1,
        marketplaces: 0,
        mcpServers: 3,
        skills: 2,
      },
      fetchedAt: "2026-09-25T09:00:02.000Z",
    },
    {
      provider: "grok",
      label: "Grok",
      profileId: "work-grok",
      support: {
        plugins: {
          store: "mixed",
          changes: "command",
          read: true,
        },
        marketplaces: {
          store: "mixed",
          changes: "command",
          read: false,
        },
        mcpServers: {
          store: "mixed",
          changes: "command",
          read: true,
        },
        skills: {
          store: "mixed",
          changes: "folder",
          read: true,
        },
      },
      counts: {
        plugins: 0,
        marketplaces: 0,
        mcpServers: 1,
        skills: 1,
      },
      fetchedAt: "2026-09-25T09:00:00.000Z",
    },
    {
      provider: "opencode",
      label: "OpenCode",
      profileId: "work-opencode",
      support: {
        plugins: {
          store: "shared",
          changes: "command",
          read: true,
        },
        mcpServers: {
          store: "shared",
          changes: "in-app",
          read: true,
        },
        skills: {
          store: "shared",
          changes: "folder",
          read: true,
        },
      },
      counts: {
        plugins: 0,
        marketplaces: 0,
        mcpServers: 0,
        skills: 0,
      },
      unread: [
        {
          kind: "skill",
          message:
            "skills from `skills.urls` are downloaded when OpenCode starts and are not read here",
        },
      ],
      fetchedAt: "2026-09-25T09:00:00.000Z",
    },
    {
      provider: "kimi",
      label: "Kimi",
      profileId: "work-kimi",
      support: {
        plugins: {
          store: "profile",
          changes: "in-app",
          read: true,
        },
        mcpServers: {
          store: "profile",
          changes: "in-app",
          read: true,
        },
        skills: {
          store: "mixed",
          changes: "folder",
          read: true,
        },
      },
      counts: {
        plugins: 0,
        marketplaces: 0,
        mcpServers: 0,
        skills: 0,
      },
      failure: {
        status: "unavailable",
        message: "extension inventory failed for kimi",
        retryable: true,
      },
    },
  ],
  servers: [
    {
      name: "linear",
      versions: 2,
      cells: {
        claude: [
          {
            id: "linear",
            origin: "own",
            enabled: true,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/.claude.json",
            transport: "http",
            target: "https://mcp.linear.app/mcp",
            headers: ["Authorization"],
            auth: "signed-in",
            version: 0,
            acts: [
              {
                act: "remove",
                runs: "claude mcp remove --scope user linear",
                reaches: ["definition", "sign-in"],
              },
            ],
          },
        ],
        codex: [
          {
            id: "linear",
            origin: "own",
            enabled: true,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/codex-7a10c3e2/config.toml",
            transport: "http",
            target: "https://mcp.linear.app/mcp",
            env: ["LINEAR_TOKEN"],
            headers: ["Authorization"],
            version: 1,
            acts: [
              {
                act: "disable",
                runs: "config/value/write mcp_servers.linear.enabled = false",
                reaches: [],
              },
              {
                act: "remove",
                runs: "codex mcp remove linear",
                reaches: ["definition"],
              },
            ],
          },
        ],
        grok: [
          {
            id: "claude:linear",
            origin: "borrowed",
            lender: "claude",
            shared: true,
            enabled: true,
            place: "~/.claude.json",
            transport: "http",
            target: "https://mcp.linear.app/mcp",
            headers: ["Authorization"],
            version: 0,
          },
        ],
      },
    },
    {
      name: "notion",
      versions: 1,
      cells: {
        claude: [
          {
            id: "notion",
            origin: "own",
            enabled: true,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/.claude.json",
            transport: "http",
            target: "https://mcp.notion.com/mcp",
            acts: [
              {
                act: "remove",
                runs: "claude mcp remove --scope user notion",
                reaches: ["definition", "sign-in"],
              },
              {
                act: "sign-in",
                runs: "claude mcp login notion",
                reaches: [],
                terminal: true,
              },
            ],
          },
        ],
        codex: [
          {
            id: "notion",
            origin: "own",
            enabled: true,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/codex-7a10c3e2/config.toml",
            transport: "http",
            target: "https://mcp.notion.com/mcp",
            auth: "needs-sign-in",
            acts: [
              {
                act: "disable",
                runs: "config/value/write mcp_servers.notion.enabled = false",
                reaches: [],
              },
              {
                act: "remove",
                runs: "codex mcp remove notion",
                reaches: ["definition"],
              },
              {
                act: "sign-in",
                runs: "codex mcp login notion",
                reaches: ["every-profile"],
                terminal: true,
              },
            ],
          },
        ],
      },
    },
    {
      name: "postgres",
      versions: 2,
      cells: {
        claude: [
          {
            id: "postgres",
            origin: "own",
            enabled: true,
            transport: "stdio",
            target: "npx -y @modelcontextprotocol/server-postgres postgresql://•••@localhost/dev",
            env: ["PGPASSWORD"],
            version: 0,
            acts: [
              {
                act: "remove",
                runs: "claude mcp remove --scope user postgres",
                reaches: ["definition"],
              },
            ],
          },
        ],
        codex: [
          {
            id: "postgres",
            origin: "own",
            enabled: false,
            transport: "stdio",
            target: "uvx postgres-mcp --access-mode=restricted",
            env: ["DATABASE_URI"],
            version: 1,
            acts: [
              {
                act: "enable",
                runs: "config/value/write mcp_servers.postgres.enabled = true",
                reaches: [],
              },
              {
                act: "remove",
                runs: "codex mcp remove postgres",
                reaches: ["definition"],
              },
            ],
          },
        ],
      },
    },
    {
      name: "sentry",
      versions: 1,
      cells: {
        claude: [
          {
            id: "project:/Users/james/Projects/billing:sentry",
            origin: "project",
            project: "~/Projects/billing",
            enabled: false,
            transport: "http",
            target: "https://mcp.sentry.dev/mcp",
          },
        ],
      },
    },
  ],
  skills: [
    {
      name: "house-style",
      description: "Northlight naming and formatting",
      versions: 1,
      cells: {
        claude: [
          {
            id: "plugin:review@northlight:house-style",
            origin: "plugin",
            plugin: "review@northlight",
            enabled: true,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/plugins/cache/northlight/review/3f9c2a1b7d04/skills/house-style",
          },
        ],
      },
    },
    {
      name: "release-notes",
      description: "Drafts release notes from merged pull requests",
      versions: 2,
      cells: {
        claude: [
          {
            id: "release-notes",
            origin: "own",
            enabled: true,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/skills/release-notes",
            version: 0,
          },
        ],
        codex: [
          {
            id: "release-notes",
            origin: "own",
            shared: true,
            switchable: true,
            enabled: true,
            place: "~/.agents/skills/release-notes",
            version: 1,
            acts: [
              {
                act: "disable",
                runs: "skills/config/write release-notes enabled = false",
                reaches: [],
              },
            ],
          },
        ],
        grok: [
          {
            id: "agents:release-notes",
            origin: "own",
            shared: true,
            enabled: true,
            place: "~/.agents/skills/release-notes",
            version: 1,
          },
        ],
      },
    },
    {
      name: "skill-creator",
      description: "Creates a skill",
      versions: 1,
      cells: {
        codex: [
          {
            id: "system:skill-creator",
            origin: "bundled",
            enabled: true,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/codex-7a10c3e2/skills/.system/skill-creator",
          },
        ],
      },
    },
    {
      name: "sql-review",
      description: "Reviews a migration before it ships",
      versions: 1,
      cells: {
        claude: [
          {
            id: "sql-review",
            origin: "own",
            enabled: false,
            place:
              "~/Library/Application Support/VibeField/agents/profiles/work/claude-0b7e2c4d/skills/sql-review",
          },
        ],
      },
    },
  ],
  plugins: {
    claude: [
      {
        id: "review@northlight",
        name: "review",
        origin: "own",
        enabled: true,
        version: "3f9c2a1b7d04",
        marketplace: "northlight",
        description: "Reviews against the house style",
      },
    ],
    codex: [
      {
        id: "documents@openai-primary-runtime",
        name: "documents",
        origin: "own",
        enabled: true,
        version: "26.909.12148",
        marketplace: "openai-primary-runtime",
        description: "Create and edit documents",
      },
    ],
  },
  marketplaces: {
    claude: [
      {
        id: "northlight",
        name: "northlight",
        origin: "own",
        enabled: true,
        source: "northlight-studio/plugins",
        updatedAt: "2026-09-20T10:00:00.000Z",
      },
    ],
  },
};

/** An act the catalog shows finished: Codex's postgres turned off (the act fixture's run). */
export const FIXTURE_EXTENSION_RUN: AgentExtensionRun = {
  id: "act-7f3a",
  provider: "codex",
  label: "Codex",
  kind: "mcp-server",
  item: "postgres",
  name: "postgres",
  act: "disable",
  runs: "config/value/write mcp_servers.postgres.enabled = false",
  state: "finished",
  startedAt: "2026-09-25T08:58:40.000Z",
  finishedAt: "2026-09-25T08:58:41.000Z",
  output:
    "config/value/write mcp_servers.postgres.enabled = false\nCodex wrote it to its config.\n",
  truncated: false,
  receipt: {
    status: "changed",
    message: "turned off",
    finishedAt: "2026-09-25T08:58:41.000Z",
  },
};

/** The same act while it runs. */
export const FIXTURE_EXTENSION_RUNNING: AgentExtensionRun = {
  id: "act-7f3a",
  provider: "codex",
  label: "Codex",
  kind: "mcp-server",
  item: "postgres",
  name: "postgres",
  act: "disable",
  runs: "config/value/write mcp_servers.postgres.enabled = false",
  state: "running",
  startedAt: "2026-09-25T08:58:40.000Z",
  output: "config/value/write mcp_servers.postgres.enabled = false\n",
  truncated: false,
};

/** A server's sign-in while its pane is open: Codex's own login to notion (the sign-in fixture's run). */
export const FIXTURE_EXTENSION_SIGNING_IN: AgentExtensionRun = {
  id: "act-9c2e",
  provider: "codex",
  label: "Codex",
  kind: "mcp-server",
  item: "notion",
  name: "notion",
  act: "sign-in",
  runs: "codex mcp login notion",
  state: "running",
  startedAt: "2026-09-25T09:01:10.000Z",
  output: "",
  truncated: false,
  terminal: {
    sessionId: "sess-01J8Z3K9",
  },
};
