import type {
  AgentInstall,
  AgentOperation,
  AgentPersona,
  AgentProviderSummary,
  AgentsReleasesResult,
} from "@vibefield/contracts";
import { type AgentShelfItem, agentShelf } from "../panels/agents/agents-model";

// Deterministic doors' answers for the catalog's Agents settings (the design
// record's R1, pass 16): what `agent.providers`, `agents.installs`,
// `agents.releases` and the operations feed would answer on a Mac with three
// agents. Fixture DATA only — the join is the shipping `agentShelf`, every
// view the shipping one. Paths, versions and logins are examples.

export type AgentsFixtureState =
  | "installed"
  | "updating"
  | "updated"
  | "empty"
  | "loading"
  | "unavailable";

export const AGENTS_FIXTURE_STATES: readonly AgentsFixtureState[] = [
  "installed",
  "updating",
  "updated",
  "empty",
  "loading",
  "unavailable",
];

const at = (hours: number, minutes: number, seconds = 0): string =>
  new Date(2026, 8, 22, hours, minutes, seconds).toISOString();

/** The catalog's "now": the checked-at words stay "09:41:20" whatever day it is opened. */
export const FIXTURE_AGENTS_NOW = new Date(2026, 8, 22, 9, 45, 0);

const CHECKED = at(9, 41, 20);
const HOME = "/Users/james";

function persona(
  provider: string,
  profileId: string,
  label: string,
  identity: AgentPersona["identity"],
  kind: AgentPersona["kind"] = "managed",
): AgentPersona {
  return {
    profileId,
    provider,
    label,
    kind,
    createdAt: at(8, 0),
    ...(identity !== undefined ? { identity } : {}),
  };
}

const signedIn = (plan: string, email: string) => ({
  loggedIn: true,
  plan,
  email,
  verifiedAt: at(9, 30),
});

const PROVIDERS: AgentProviderSummary[] = [
  {
    id: "claude",
    label: "Claude Code",
    available: true,
    resumable: true,
    personas: [
      persona(
        "claude",
        "claude:default",
        "Default",
        signedIn("Max 20×", "james@example.com"),
        "native-default",
      ),
      persona("claude", "claude:work", "Work", signedIn("Team", "james@work.example")),
    ],
  },
  {
    id: "codex",
    label: "Codex",
    available: true,
    resumable: true,
    personas: [
      persona(
        "codex",
        "codex:default",
        "Default",
        signedIn("Pro", "james@example.com"),
        "native-default",
      ),
    ],
  },
  { id: "grok", label: "Grok", available: true, resumable: false, personas: [] },
  // composed but not installed: never on the shelf
  { id: "kimi", label: "Kimi", available: false, resumable: false, personas: [] },
];

function installs(claudeVersion: string): AgentInstall[] {
  return [
    {
      provider: "claude",
      executable: `${HOME}/.local/bin/claude`,
      realPath: `${HOME}/.local/share/claude/versions/${claudeVersion}`,
      version: claudeVersion,
      method: "native-installer",
      autoUpdate: "enabled",
      releaseChannel: "stable",
      active: true,
      update: { kind: "native-self-update", command: [`${HOME}/.local/bin/claude`, "update"] },
    },
    {
      provider: "claude",
      executable: "/opt/homebrew/bin/claude",
      realPath: "/opt/homebrew/lib/node_modules/claude-code/cli.js",
      version: "2.1.221",
      method: "npm-global",
      autoUpdate: "disabled",
      releaseChannel: "preview",
      active: false,
      update: {
        kind: "npm-global",
        command: ["/opt/homebrew/bin/npm", "install", "-g", "claude-code@latest"],
      },
    },
    {
      provider: "codex",
      executable: "/opt/homebrew/bin/codex",
      realPath: "/opt/homebrew/lib/node_modules/codex/bin/codex.js",
      version: "0.153.4",
      method: "npm-global",
      autoUpdate: "unknown",
      releaseChannel: "stable",
      active: true,
      update: {
        kind: "npm-global",
        command: ["/opt/homebrew/bin/npm", "install", "-g", "codex@latest"],
      },
    },
    {
      provider: "grok",
      executable: `${HOME}/.grok/bin/grok`,
      realPath: `${HOME}/.grok/bin/grok`,
      version: "1.0.13",
      method: "vendor-downloader",
      autoUpdate: "unknown",
      releaseChannel: "stable",
      active: true,
      update: { kind: "manual", instructions: "Run the vendor's installer again." },
    },
  ];
}

function release(provider: string, version: string) {
  return {
    provider,
    channel: "stable",
    version,
    publishedAt: at(7, 12),
    url: `https://example.com/${provider}/releases/${version}`,
    fetchedAt: CHECKED,
    source: { kind: "text", id: `${provider}-stable` },
  };
}

function releases(offer: boolean): AgentsReleasesResult {
  return {
    releases: [release("claude", "2.3.0"), release("codex", "0.153.4"), release("grok", "1.0.13")],
    available: offer ? [{ provider: "claude", channel: "stable", version: "2.3.0" }] : [],
    checked: ["claude", "codex", "grok"].map((provider) => ({ provider, at: CHECKED })),
  };
}

const UPDATE_OUTPUT = [
  "Checking for updates…",
  "Current version: 2.2.0",
  "New version available: 2.3.0 (stable)",
  "Downloading 2.3.0 — 41.2 MB",
  "Verifying checksum",
].join("\n");

function operation(state: AgentOperation["state"]): AgentOperation {
  const running: AgentOperation = {
    provider: "claude",
    kind: "update",
    state,
    startedAt: at(9, 42, 5),
    output: `${UPDATE_OUTPUT}\n`,
    truncated: false,
  };
  if (state === "running") return running;
  return {
    ...running,
    finishedAt: at(9, 42, 31),
    output: `${UPDATE_OUTPUT}\nInstalled 2.3.0\nSuccessfully updated from 2.2.0 to 2.3.0\n`,
    receipt: {
      provider: "claude",
      status: "updated",
      startedAt: at(9, 42, 5),
      finishedAt: at(9, 42, 31),
      exitCode: 0,
      fromVersion: "2.2.0",
      toVersion: "2.3.0",
    },
  };
}

/** What `agents.installs` answers on the catalog's Mac (AO-5's Agents pane
 * joins it with the agent catalog). */
export function fixtureAgentInstalls(): AgentInstall[] {
  return installs("2.2.0");
}

/** The shelf the catalog draws for one production state. */
export function fixtureAgentShelf(state: AgentsFixtureState): AgentShelfItem[] {
  if (state === "empty" || state === "loading" || state === "unavailable") return [];
  if (state === "updated") {
    return agentShelf({
      providers: PROVIDERS,
      installs: installs("2.3.0"),
      releases: releases(false),
      operations: [operation("finished")],
    });
  }
  return agentShelf({
    providers: PROVIDERS,
    installs: installs("2.2.0"),
    releases: releases(true),
    operations: state === "updating" ? [operation("running")] : [],
  });
}
