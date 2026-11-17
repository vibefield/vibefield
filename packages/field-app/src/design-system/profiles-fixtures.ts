import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentHolding,
  AgentInstall,
  AgentPersona,
  AgentPlan,
  AgentPlanTier,
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
  | "reading extensions"
  | "act confirm"
  | "turn on"
  | "skill to codex"
  | "act running"
  | "act finished"
  | "this mac"
  /** AO-5 — This Mac while it is the only profile: it explains itself */
  | "this mac, alone"
  /** AO-5a — a profile New profile… just made: a draft, kept once an agent signs in */
  | "draft"
  | "loading usage"
  | "refreshing usage"
  /** UM-3 — a window read before its reset says the reading's age where its reset stood, unlit */
  | "read before reset"
  /** item 274 (UM-274-D7 A) — a push over a meter kept from an older read: each line says its own read */
  | "kept meters"
  /** Studio, whose plans carry made-up tiers: a badge, an empty capsule, none */
  | "plan tiers"
  | "empty"
  | "signing in"
  | "agent"
  | "sign-ins"
  | "agent's plugins"
  | "agent's servers"
  | "agent's skills"
  | "server"
  | "server sign-in"
  | "server signing in"
  | "skill"
  | "kept skill"
  | "plugin"
  | "plugin updated"
  | "plugin removal"
  | "plugin, no command"
  | "plugins, checked"
  | "add package"
  | "browse"
  | "browse, no marketplaces"
  | "marketplace removal"
  | "add marketplace"
  | "plugin to install"
  | "install in a terminal"
  | "add server"
  | "add skill"
  | "new";

export const PROFILES_FIXTURE_STATES: readonly ProfilesFixtureState[] = [
  "profile",
  "reading extensions",
  "act confirm",
  "turn on",
  "skill to codex",
  "act running",
  "act finished",
  "this mac",
  "this mac, alone",
  "draft",
  "loading usage",
  "refreshing usage",
  "read before reset",
  "kept meters",
  "plan tiers",
  "empty",
  "signing in",
  "agent",
  "sign-ins",
  "agent's plugins",
  "agent's servers",
  "agent's skills",
  "server",
  "server sign-in",
  "server signing in",
  "skill",
  "kept skill",
  "plugin",
  "plugin updated",
  "plugin removal",
  "plugin, no command",
  "plugins, checked",
  "add package",
  "browse",
  "browse, no marketplaces",
  "marketplace removal",
  "add marketplace",
  "plugin to install",
  "install in a terminal",
  "add server",
  "add skill",
  "new",
];

/** AR-S4e2 — deploy's install in its pane: a still of Claude Code asking to run the command its source names. */
export const FIXTURE_INSTALL_PANE_OUTPUT = [
  "Installing deploy@northlight…",
  "This plugin's source runs a command to fetch it:",
  "  npx @northlight/deploy-fetch",
  "Run it? (y/N) ",
].join("\n");

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

// Studio (DESIGN.md §8 "A plan's tier"): a profile whose plans carry tiers, made up, as no agent sends one yet (the
// contract's `planTier`, beside `plan`). Its two Claude Max plans are one family: one read at
// "20x", one its agent says has none. Its two ChatGPT Pro plans are another: one read at "200",
// one not read, which wears the empty capsule. xAI's label is the contract's longest, 8
// characters, and GitHub's tier, not read, stands alone in its family. Studio is in none of
// the lists above, so every other plate reads as it did.

const XAI: AgentSignInService = { id: "xai", label: "xAI" };
const STUDIO_HOME = `${PROFILES_HOME}/studio`;

/** One of Studio's sign-ins, on a plan of its own. A sign-in with no `tier` is one whose tier was
 * not read. */
interface StudioSignIn {
  plan: string;
  service: AgentSignInService;
  who: { email?: string; account?: string; plan: string };
  tier?: AgentPlanTier;
  /** its reading: the five hours' percent and when they reset */
  used: number;
  resetsInHours: number;
}

/** In `PROVIDERS`' order: the agent at the same place signs in, names the plan and reads its
 * usage, so Studio names no agent of its own (R23b). */
const STUDIO_SIGN_INS: readonly StudioSignIn[] = [
  {
    plan: "anthropic",
    service: ANTHROPIC,
    who: { email: "ada@example.com", plan: "max" },
    tier: { label: "20x" },
    used: 58,
    resetsInHours: 2,
  },
  {
    plan: "openai",
    service: OPENAI,
    who: { email: "ada@example.com", plan: "pro" },
    tier: { label: "200" },
    used: 34,
    resetsInHours: 1.5,
  },
  {
    plan: "xai",
    service: XAI,
    who: { email: "ada@example.com", plan: "supergrok" },
    tier: { label: "Business" },
    used: 47,
    resetsInHours: 2.25,
  },
  {
    plan: "openai-2",
    service: OPENAI,
    who: { email: "bo@example.com", plan: "pro" },
    used: 12,
    resetsInHours: 4,
  },
  {
    plan: "github",
    service: GITHUB,
    who: { account: "studio-dev", plan: "individual" },
    used: 8,
    resetsInHours: 3,
  },
  {
    plan: "anthropic-2",
    service: ANTHROPIC,
    who: { email: "cy@example.com", plan: "max" },
    tier: {},
    used: 21,
    resetsInHours: 3.5,
  },
];

type StudioRow = StudioSignIn & { agent: AgentProviderSummary };

const STUDIO: readonly StudioRow[] = STUDIO_SIGN_INS.flatMap((signIn, index): StudioRow[] => {
  const agent = PROVIDERS[index];
  return agent === undefined ? [] : [{ ...signIn, agent }];
});

/** A Studio sign-in's persona: its agent's folder, its identity, and the one plan it holds. */
const studioPersona = ({ agent, plan, service, who }: StudioRow): AgentPersona =>
  persona({
    profileId: `studio-${agent.id}`,
    provider: agent.id,
    label: "Studio",
    set: "studio",
    folder: `${STUDIO_HOME}/${agent.id}`,
    identity: { loggedIn: true, ...who, verifiedAt: READ },
    holds: [{ service, ...who, key: false, planId: plan, runsOn: true }],
  });

/** A Studio plan, named by its one holder, its tier beside the plan word when there is one. */
const studioPlan = ({ agent, plan, service, who, tier }: StudioRow): AgentPlan => ({
  id: plan,
  service,
  account: { ...who, ...(tier !== undefined ? { planTier: tier } : {}) },
  namedBy: `studio-${agent.id}`,
  holders: [`studio-${agent.id}`],
  alsoIn: [],
});

export const FIXTURE_STUDIO: AgentProfileSet = {
  id: "studio",
  kind: "managed",
  label: "Studio",
  glyph: "star",
  default: false,
  createdAt: READ,
  folder: STUDIO_HOME,
  personas: STUDIO.map(studioPersona),
  plans: STUDIO.map(studioPlan),
};

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

/** UM-3 — Work's Claude read three hours ago: its five hours, spent, reset ten minutes ago; its week still runs. */
export const FIXTURE_PROFILES_CONTEXT_READ_BEFORE_RESET: ProfilesContext = {
  ...FIXTURE_PROFILES_CONTEXT,
  usage: USAGE.map((entry) =>
    entry.profileId === "work-claude"
      ? {
          ...entry,
          fetchedAt: inHours(-3),
          metrics: entry.metrics.map((metric) =>
            metric.id === "5h"
              ? { ...metric, usedPercent: 100, resetsAt: inHours(-1 / 6) }
              : metric,
          ),
        }
      : entry,
  ),
};

/** Item 274 (UM-274-D7 A; DESIGN.md §8 "A meter a later reading did not carry") — Work's Claude pushed a minute ago,
 * carrying its week; its five hours, spent, reset ten minutes ago and was kept from a read three hours ago, so its line
 * says its own read, "as of 3h ago", where the push alone would say a minute. */
export const FIXTURE_PROFILES_CONTEXT_KEPT_METERS: ProfilesContext = {
  ...FIXTURE_PROFILES_CONTEXT,
  usage: USAGE.map((entry) =>
    entry.profileId === "work-claude"
      ? {
          ...entry,
          fetchedAt: inHours(-1 / 60),
          metrics: entry.metrics.map((metric) =>
            metric.id === "5h"
              ? { ...metric, usedPercent: 100, resetsAt: inHours(-1 / 6), fetchedAt: inHours(-3) }
              : metric,
          ),
        }
      : entry,
  ),
};

/** Studio's readings: every sign-in read, so each plan has a row in the popover. */
const studioReading = ({ agent, used, resetsInHours }: StudioRow): AgentAccountUsageEntry => ({
  provider: agent.id,
  label: agent.label,
  profileId: `studio-${agent.id}`,
  state: "available",
  fetchedAt: READ,
  metrics: [
    window("5h", "5H", used, resetsInHours, 300),
    window("7d", "7D", Math.round(used / 2), 96, 10_080),
  ],
});
const STUDIO_USAGE: AgentAccountUsageEntry[] = STUDIO.map(studioReading);

/** The doors' answers with Studio among the profiles: the plan tiers' plates. */
export const FIXTURE_PROFILES_CONTEXT_TIERS: ProfilesContext = {
  ...FIXTURE_PROFILES_CONTEXT,
  usage: [...USAGE, ...STUDIO_USAGE],
  sets: [...FIXTURE_PROFILE_SETS, FIXTURE_STUDIO],
};

/** What the catalog's sign-in terminal (Grok, into Work) shows while the
 * vendor's login waits on a browser — the record's still, not Grok's words. */
export const FIXTURE_SIGN_IN_OUTPUT = [
  "$ grok login",
  "Opening your browser to finish signing in…",
].join("\n");

/** AR-S4c — what the catalog's server sign-in (Codex, to notion, in Work)
 * shows while Codex's own login waits on a browser: the record's still. */
export const FIXTURE_SERVER_SIGN_IN_OUTPUT = [
  "$ codex mcp login notion",
  "Opening your browser to finish signing in…",
].join("\n");
