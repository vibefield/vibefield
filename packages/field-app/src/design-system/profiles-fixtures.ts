import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentHolding,
  AgentInstall,
  AgentPersona,
  AgentPlan,
  AgentProfileSet,
  AgentProviderSummary,
  AgentSignInService,
} from "@vibefield/contracts";
import type { ProfilesContext } from "../panels/agents/profiles-model";

// Deterministic doors' answers for the catalog's Agent Profiles (the design
// record's R1, pass 16, with pass 19's plans on top): what
// `agents.profileSets.subscribe`, `agent.providers`, `agents.installs` and
// `agents.usage.subscribe` would answer on a Mac with This Mac, Work and an
// empty Client demo. The plans and each sign-in's holdings are written as
// fieldd sends them — puppeteer's reading of these identities. Fixture DATA
// only — every view is the shipping one. Names, logins and paths are examples.

export type ProfilesFixtureState =
  | "profile"
  | "this mac"
  | "empty"
  | "signing in"
  | "agent"
  | "sign-ins"
  | "new";

export const PROFILES_FIXTURE_STATES: readonly ProfilesFixtureState[] = [
  "profile",
  "this mac",
  "empty",
  "signing in",
  "agent",
  "sign-ins",
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
  { id: "opencode", label: "OpenCode", available: true, resumable: true, personas: [] },
  { id: "copilot", label: "GitHub Copilot", available: true, resumable: false, personas: [] },
  { id: "hermes", label: "Hermes", available: true, resumable: false, personas: [] },
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

const ANTHROPIC: AgentSignInService = { id: "anthropic", label: "Anthropic" };
const OPENAI: AgentSignInService = { id: "openai", label: "OpenAI" };
const GITHUB: AgentSignInService = { id: "github", label: "GitHub" };
const NOUS: AgentSignInService = { id: "nous", label: "Nous Research" };
const OPENCODE: AgentSignInService = { id: "opencode", label: "OpenCode" };

const signedIn = (email: string, plan: string) => ({
  loggedIn: true,
  email,
  plan,
  verifiedAt: READ,
});

/** A vendor agent's one sign-in, on its company's plan. */
const vendor = (service: AgentSignInService, who: Partial<AgentHolding>): AgentHolding[] => [
  { service, ...who, key: false, planId: service.id, runsOn: true },
];

const PROFILES_HOME = "~/Library/Application Support/VibeField/users/1/agents/profiles";

function persona(
  over: Partial<AgentPersona> & Pick<AgentPersona, "profileId" | "provider">,
): AgentPersona {
  return { label: "Work", kind: "managed", createdAt: READ, set: "work", ...over };
}

function native(provider: string, folder: string, over: Partial<AgentPersona> = {}): AgentPersona {
  return persona({
    profileId: `${provider}:native-default`,
    provider,
    kind: "native-default",
    label: "Default",
    set: "native",
    folder,
    ...over,
  });
}

export const FIXTURE_NATIVE: AgentProfileSet = {
  id: "native",
  kind: "native",
  label: "This Mac",
  default: true,
  createdAt: new Date(0).toISOString(),
  personas: [
    native("claude", "~/.claude", {
      identity: signedIn("james@example.com", "max"),
      holds: vendor(ANTHROPIC, { email: "james@example.com", plan: "max" }),
    }),
    native("codex", "~/.codex", {
      identity: signedIn("james@example.com", "pro"),
      holds: vendor(OPENAI, { email: "james@example.com", plan: "pro" }),
    }),
    native("grok", "~/.grok", { identity: { loggedIn: false, verifiedAt: READ } }),
    native("copilot", "~/.copilot", {
      identity: {
        loggedIn: true,
        method: "user",
        account: "jamesdev",
        plan: "individual",
        verifiedAt: READ,
      },
      holds: vendor(GITHUB, { method: "user", account: "jamesdev", plan: "individual" }),
    }),
  ],
  plans: [
    {
      id: "anthropic",
      service: ANTHROPIC,
      account: { email: "james@example.com", plan: "max" },
      namedBy: "claude:native-default",
      holders: ["claude:native-default"],
      alsoIn: [],
    },
    {
      id: "openai",
      service: OPENAI,
      account: { email: "james@example.com", plan: "pro" },
      namedBy: "codex:native-default",
      holders: ["codex:native-default"],
      alsoIn: [],
    },
    {
      id: "github",
      service: GITHUB,
      account: { account: "jamesdev", plan: "individual" },
      namedBy: "copilot:native-default",
      holders: ["copilot:native-default"],
      alsoIn: ["work"],
    },
  ],
};

const WORK_EMAIL = "james@work.example";

const WORK_PLANS: AgentPlan[] = [
  {
    id: "anthropic",
    service: ANTHROPIC,
    account: { email: WORK_EMAIL, plan: "max" },
    namedBy: "work-claude",
    holders: ["work-claude"],
    alsoIn: [],
  },
  {
    id: "openai",
    service: OPENAI,
    account: { email: WORK_EMAIL, plan: "pro" },
    namedBy: "work-codex",
    holders: ["work-codex", "work-opencode"],
    alsoIn: [],
  },
  {
    id: "opencode",
    service: OPENCODE,
    account: { email: WORK_EMAIL, organization: "Northlight" },
    namedBy: "work-opencode",
    holders: ["work-opencode"],
    alsoIn: [],
  },
  {
    id: "github",
    service: GITHUB,
    account: { account: "jamesdev" },
    namedBy: "work-copilot",
    borrowedFrom: "GitHub CLI",
    holders: ["work-copilot"],
    alsoIn: ["native"],
  },
  {
    id: "nous",
    service: NOUS,
    account: { email: WORK_EMAIL, organization: "Northlight", plan: "Plus" },
    namedBy: "work-hermes",
    holders: ["work-hermes"],
    alsoIn: [],
  },
];

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
      identity: signedIn(WORK_EMAIL, "max"),
      holds: vendor(ANTHROPIC, { email: WORK_EMAIL, plan: "max" }),
    }),
    persona({
      profileId: "work-codex",
      provider: "codex",
      folder: `${PROFILES_HOME}/work/codex-9a1f3e58`,
      identity: signedIn(WORK_EMAIL, "pro"),
      holds: vendor(OPENAI, { email: WORK_EMAIL, plan: "pro" }),
    }),
    persona({
      profileId: "work-opencode",
      provider: "opencode",
      folder: `${PROFILES_HOME}/work/opencode-5d20a7c1`,
      identity: {
        loggedIn: true,
        signIns: [
          { service: OPENCODE, method: "console", email: WORK_EMAIL, organization: "Northlight" },
          { service: OPENAI, method: "oauth", subscription: true },
          { service: ANTHROPIC, method: "api-key" },
        ],
        verifiedAt: READ,
      },
      holds: [
        {
          service: OPENCODE,
          method: "console",
          email: WORK_EMAIL,
          organization: "Northlight",
          key: false,
          planId: "opencode",
          runsOn: false,
        },
        {
          service: OPENAI,
          method: "oauth",
          subscription: true,
          key: false,
          planId: "openai",
          runsOn: true,
        },
        { service: ANTHROPIC, method: "api-key", key: true, runsOn: false },
      ],
    }),
    persona({
      profileId: "work-copilot",
      provider: "copilot",
      folder: `${PROFILES_HOME}/work/copilot-e41b9c02`,
      identity: {
        loggedIn: true,
        method: "gh-cli",
        account: "jamesdev",
        borrowedFrom: "GitHub CLI",
        verifiedAt: READ,
      },
      holds: vendor(GITHUB, { method: "gh-cli", account: "jamesdev", borrowedFrom: "GitHub CLI" }),
    }),
    persona({
      profileId: "work-hermes",
      provider: "hermes",
      folder: `${PROFILES_HOME}/work/hermes-7c3f0e9a`,
      identity: {
        loggedIn: true,
        method: "oauth",
        email: WORK_EMAIL,
        organization: "Northlight",
        plan: "Plus",
        signIns: [
          {
            service: NOUS,
            method: "oauth",
            subscription: true,
            inUse: true,
            email: WORK_EMAIL,
            organization: "Northlight",
            plan: "Plus",
          },
        ],
        verifiedAt: READ,
      },
      holds: [
        {
          service: NOUS,
          method: "oauth",
          subscription: true,
          inUse: true,
          email: WORK_EMAIL,
          organization: "Northlight",
          plan: "Plus",
          key: false,
          planId: "nous",
          runsOn: true,
        },
      ],
    }),
  ],
  plans: WORK_PLANS,
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
  plans: [],
};

export const FIXTURE_PROFILE_SETS: AgentProfileSet[] = [FIXTURE_NATIVE, FIXTURE_WORK, FIXTURE_DEMO];

const window = (
  id: string,
  label: string,
  usedPercent: number,
  resetsInHours: number,
  durationMinutes: number,
): AgentAccountUsageMetric => ({
  id,
  label,
  kind: "window",
  usedPercent,
  durationMinutes,
  resetsAt: inHours(resetsInHours),
});

const USAGE: AgentAccountUsageEntry[] = [
  {
    provider: "claude",
    label: "Claude Code",
    profileId: "work-claude",
    state: "available",
    fetchedAt: READ,
    metrics: [
      window("5h", "5H", 91, 1, 300),
      window("7d", "7D", 38, 70, 10_080),
      // a window over part of the plan: a heading in the provider's words (pass 20)
      {
        ...window("7d-opus", "OPUS", 22, 70, 10_080),
        group: { id: "scope:opus", label: "Opus only" },
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
      window("5h", "5H", 12, 4, 300),
      window("7d", "7D", 18, 92, 10_080),
      // held in standby and untouched: out of sight until the plan's own limits run out
      {
        ...window("reserve", "RESERVE 7D", 0, 160, 10_080),
        group: { id: "reserve", label: "Luna Reserve", standby: true },
      },
    ],
  },
  {
    provider: "claude",
    label: "Claude Code",
    state: "available",
    fetchedAt: READ,
    metrics: [
      window("5h", "5H", 44, 2.5, 300),
      window("7d", "7D", 27, 44, 10_080),
      { id: "credit", label: "CR", kind: "budget", usedPercent: 25 },
    ],
  },
  {
    provider: "codex",
    label: "Codex",
    state: "available",
    fetchedAt: READ,
    metrics: [window("5h", "5H", 64, 2.75, 300), window("7d", "7D", 18, 118, 10_080)],
  },
];

export const FIXTURE_PROFILES_CONTEXT: ProfilesContext = {
  providers: PROVIDERS,
  installs: [
    install("claude", "2.3.0"),
    install("codex", "0.154.0"),
    install("grok", "1.0.41"),
    install("opencode", "1.18.32"),
    install("copilot", "1.0.88"),
    install("hermes", "0.21.4"),
  ],
  usage: USAGE,
  signIn: ["claude", "codex", "grok", "opencode", "copilot", "hermes"],
  identity: ["claude", "codex", "grok", "opencode", "copilot", "hermes"],
  signOut: ["claude"],
  reading: false,
  sets: FIXTURE_PROFILE_SETS,
  routes: {
    opencode: [
      { id: "provider", label: "Another provider…" },
      { id: "console", label: "OpenCode Console", service: OPENCODE },
    ],
    hermes: [
      { id: "portal", label: "Nous Portal", service: NOUS },
      { id: "provider", label: "Another provider…" },
    ],
  },
};

/** What the catalog's sign-in terminal (Grok, into Work) shows while the
 * vendor's login waits on a browser — the record's still, not Grok's words. */
export const FIXTURE_SIGN_IN_OUTPUT = [
  "$ grok login",
  "Opening your browser to finish signing in…",
].join("\n");
