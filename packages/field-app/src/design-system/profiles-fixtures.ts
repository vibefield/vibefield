import type {
  AgentAccountUsageEntry,
  AgentInstall,
  AgentPersona,
  AgentProfileSet,
  AgentProviderSummary,
} from "@vibefield/contracts";
import type { ProfilesContext } from "../panels/agents/profiles-model";

// Deterministic doors' answers for the catalog's Agent Profiles (the design
// record's R1, pass 16): what `agents.profileSets.subscribe`, `agent.providers`,
// `agents.installs` and `agents.usage.subscribe` would answer on a Mac with
// This Mac, Work and an empty Client demo. Fixture DATA only — every view is
// the shipping one. Names, logins and paths are examples.

export type ProfilesFixtureState =
  | "profile"
  | "this mac"
  | "empty"
  | "signing in"
  | "agent"
  | "new";

export const PROFILES_FIXTURE_STATES: readonly ProfilesFixtureState[] = [
  "profile",
  "this mac",
  "empty",
  "signing in",
  "agent",
  "new",
];

/** The catalog's "now": the usage lines' now line stays put whatever day it is opened. */
export const FIXTURE_PROFILES_NOW = new Date(2026, 8, 23, 12, 0, 0);
const READ = new Date(2026, 8, 23, 11, 20, 0).toISOString();
const inHours = (hours: number): string =>
  new Date(FIXTURE_PROFILES_NOW.getTime() + hours * 3_600_000).toISOString();

const PROVIDERS: AgentProviderSummary[] = [
  { id: "claude", label: "Claude Code", available: true, resumable: true, personas: [] },
  { id: "codex", label: "Codex", available: true, resumable: true, personas: [] },
  { id: "grok", label: "Grok", available: true, resumable: false, personas: [] },
];

const install = (provider: string, version: string): AgentInstall => ({
  provider,
  executable: `/Users/james/.local/bin/${provider}`,
  realPath: `/Users/james/.local/bin/${provider}`,
  version,
  method: "native-installer",
  autoUpdate: "enabled",
  active: true,
});

const signedIn = (email: string, plan: string) => ({
  loggedIn: true,
  email,
  plan,
  verifiedAt: READ,
});

const PROFILES_HOME = "~/Library/Application Support/VibeField/users/1/agents/profiles";

function persona(
  over: Partial<AgentPersona> & Pick<AgentPersona, "profileId" | "provider">,
): AgentPersona {
  return { label: "Work", kind: "managed", createdAt: READ, set: "work", ...over };
}

export const FIXTURE_NATIVE: AgentProfileSet = {
  id: "native",
  kind: "native",
  label: "This Mac",
  default: true,
  createdAt: new Date(0).toISOString(),
  personas: [
    persona({
      profileId: "claude:native-default",
      provider: "claude",
      kind: "native-default",
      label: "Default",
      set: "native",
      folder: "~/.claude",
      identity: signedIn("james@example.com", "Max 20×"),
    }),
    persona({
      profileId: "codex:native-default",
      provider: "codex",
      kind: "native-default",
      label: "Default",
      set: "native",
      folder: "~/.codex",
      identity: signedIn("james@example.com", "Pro"),
    }),
    persona({
      profileId: "grok:native-default",
      provider: "grok",
      kind: "native-default",
      label: "Default",
      set: "native",
      folder: "~/.grok",
      identity: { loggedIn: false, verifiedAt: READ },
    }),
  ],
};

export const FIXTURE_WORK: AgentProfileSet = {
  id: "work",
  kind: "managed",
  label: "Work",
  glyph: "briefcase",
  default: false,
  createdAt: READ,
  folder: `${PROFILES_HOME}/work`,
  personas: [
    persona({
      profileId: "work-claude",
      provider: "claude",
      folder: `${PROFILES_HOME}/work/claude-0b7e2c4d`,
      identity: signedIn("james@work.example", "Team"),
    }),
    persona({
      profileId: "work-codex",
      provider: "codex",
      folder: `${PROFILES_HOME}/work/codex-9a1f3e58`,
      identity: signedIn("james@work.example", "Business"),
    }),
  ],
};

export const FIXTURE_DEMO: AgentProfileSet = {
  id: "client-demo",
  kind: "managed",
  label: "Client demo",
  glyph: "flask",
  default: false,
  createdAt: READ,
  folder: `${PROFILES_HOME}/client-demo`,
  personas: [],
};

export const FIXTURE_PROFILE_SETS: AgentProfileSet[] = [FIXTURE_NATIVE, FIXTURE_WORK, FIXTURE_DEMO];

const USAGE: AgentAccountUsageEntry[] = [
  {
    provider: "claude",
    label: "Claude Code",
    profileId: "work-claude",
    state: "available",
    fetchedAt: READ,
    metrics: [
      {
        id: "5h",
        label: "5H",
        kind: "window",
        usedPercent: 91,
        durationMinutes: 300,
        resetsAt: inHours(1),
      },
      {
        id: "7d",
        label: "7D",
        kind: "window",
        usedPercent: 38,
        durationMinutes: 10_080,
        resetsAt: inHours(70),
      },
    ],
  },
  {
    provider: "codex",
    label: "Codex",
    profileId: "work-codex",
    state: "available",
    fetchedAt: READ,
    metrics: [
      {
        id: "5h",
        label: "5H",
        kind: "window",
        usedPercent: 12,
        durationMinutes: 300,
        resetsAt: inHours(4),
      },
    ],
  },
  {
    provider: "claude",
    label: "Claude Code",
    state: "available",
    fetchedAt: READ,
    metrics: [
      {
        id: "5h",
        label: "5H",
        kind: "window",
        usedPercent: 44,
        durationMinutes: 300,
        resetsAt: inHours(2.5),
      },
    ],
  },
];

export const FIXTURE_PROFILES_CONTEXT: ProfilesContext = {
  providers: PROVIDERS,
  installs: [install("claude", "2.3.0"), install("codex", "0.154.0"), install("grok", "1.0.41")],
  usage: USAGE,
  signIn: ["claude", "codex", "grok"],
  identity: ["claude", "codex"],
  signOut: ["claude"],
  reading: false,
};

/** What the catalog's sign-in terminal (Grok, into Work) shows while the
 * vendor's login waits on a browser — the record's still, not Grok's words. */
export const FIXTURE_SIGN_IN_OUTPUT = [
  "$ grok login",
  "Opening your browser to finish signing in…",
].join("\n");
