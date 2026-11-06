// AR-5d — the scripted agent's account-usage capability, shared by the usage
// suites (agent-usage.test.ts, and since UM-D8 agent-usage-tailnet.test.ts):
// an adapter that owns nothing but a quota (and, when asked, accounts),
// composed through `agentProviders` to REPLACE puppeteer's built-ins rather
// than join them — the built-in claude reads a real account's OAuth root, and
// a unit test must never depend on (or touch) the developer's own credentials.
// Its readings come from a JSON file named by an env var and re-read per
// request (the `FAKE_ROSETTAD_SESSIONS` pattern in
// test/fixtures/fake-rosettad.mjs), so a row flips an account's state between
// two polls by writing a file. Test-only.
import { readFileSync } from "node:fs";
import type {
  AccountUsageFetchResult,
  AgentProfile,
  AccountUsageService as CoreAccountUsageService,
  ProfileFailure,
  ProfileIdentity,
  ProfileService,
  TerminalSpec,
} from "@vibefield/puppeteer-core";
import type { AgentProvider } from "@vibefield/puppeteer-runtime";

/** The env var naming the scripted provider's readings file. */
export const USAGE_FILE = "FAKE_ACCOUNT_USAGE_FILE";

/** One reading per account, as the file spells them. `"throw"` is an adapter
 * that blew up rather than answering — the runtime folds that into an
 * `unavailable` result, which is a different path from a typed refusal. */
export type UsageScript = Record<string, AccountUsageFetchResult | "throw">;

export const available = (
  provider: string,
  at: string,
  usedPercent = 42,
): AccountUsageFetchResult => ({
  status: "available",
  snapshot: {
    provider,
    fetchedAt: at,
    scope: "subscription",
    source: { kind: "native-protocol", stability: "experimental" },
    metrics: [
      {
        id: "five-hour",
        label: "5H",
        description: "Rolling five-hour window",
        kind: "window",
        usedPercent,
        durationMinutes: 300,
        resetsAt: "2026-09-13T14:00:00.000Z",
      },
      {
        id: "seven-day",
        label: "7D",
        kind: "window",
        usedPercent: 12,
        durationMinutes: 10_080,
        group: { id: "reserve", label: "Luna Reserve", standby: true },
      },
    ],
    credits: { balance: "$12.40", hasCredits: true },
  },
});

/** A quota refusal. `retryAt` is the provider's own authorization to ask
 * again, and the monitor obeys it — a far-future one would park the row, so a
 * test that flips the account afterwards passes a near one. */
export const rateLimited = (provider: string, retryAt: string): AccountUsageFetchResult => ({
  status: "unavailable",
  provider,
  message: "the account is rate limited",
  retryable: true,
  code: "rate-limited",
  retryAt,
});

/** A retryable refusal with no provider-authorized retry time: the backoff
 * LADDER's input (a `retryAt` outranks the ladder — its own row below). */
export const refused = (provider: string): AccountUsageFetchResult => ({
  status: "unavailable",
  provider,
  message: "the account could not be read",
  retryable: true,
});

export const unauthenticated = (provider: string): AccountUsageFetchResult => ({
  status: "unauthenticated",
  provider,
  message: "no account is signed in",
  retryable: false,
});

export interface ScriptedProvider {
  provider: AgentProvider;
  /** a provider PUSH (the runtime's `onAccountUsage` path), on demand */
  push(result: AccountUsageFetchResult): void;
  /** how many readings the adapter has been asked for, per account key */
  fetches(): Record<string, number>;
}

/** An adapter that owns nothing but a quota (and, when asked, accounts). */
export function scriptedProvider(options: {
  id: string;
  label: string;
  profiles?: boolean;
  pollIntervalMs?: number;
}): ScriptedProvider {
  const counts: Record<string, number> = {};
  let pushTo: ((result: AccountUsageFetchResult) => void) | undefined;
  const read = (key: string): AccountUsageFetchResult | "throw" => {
    const path = process.env[USAGE_FILE];
    if (path === undefined) throw new Error(`${USAGE_FILE} is not set`);
    // re-read per request: the test rewrites this file between polls
    const script = JSON.parse(readFileSync(path, "utf8")) as UsageScript;
    return script[key] ?? script["default"] ?? "throw";
  };
  const accountUsage: CoreAccountUsageService = {
    provider: {
      id: options.id,
      label: options.label,
      refresh: { pollIntervalMs: options.pollIntervalMs ?? 60_000 },
    },
    async fetch(fetchOptions?: { profile?: AgentProfile }) {
      const key = fetchOptions?.profile?.id ?? "default";
      counts[key] = (counts[key] ?? 0) + 1;
      const answer = read(key);
      if (answer === "throw") throw new Error("scripted account usage failure");
      return answer;
    },
    subscribe(listener) {
      pushTo = listener;
      return () => {
        pushTo = undefined;
      };
    },
  };
  const profiles: ProfileService = {
    provider: {
      id: options.id,
      label: options.label,
      support: { supported: true, identity: "none", sharedSurfaces: [] },
    },
    bindingEnvironment: () => ({}),
    observationRoot: (profile: AgentProfile) => profile.dataRoot,
    loginInvocation: (_profile: AgentProfile, opts: { cwd: string }): TerminalSpec => ({
      command: "/bin/sh",
      args: ["-c", "exit 0"],
      cwd: opts.cwd,
    }),
    async verify(): Promise<ProfileIdentity | ProfileFailure> {
      return {
        status: "unsupported",
        message: "the scripted provider has no identity to read",
        retryable: false,
      };
    },
  };
  return {
    provider: {
      descriptor: { id: options.id, label: options.label },
      createSession() {
        // this adapter exists to be ASKED about a quota; it spawns nothing
        return Promise.reject(new Error("the usage provider spawns no sessions"));
      },
      accountUsage,
      ...(options.profiles === true ? { profiles } : {}),
    },
    push: (result) => pushTo?.(result),
    fetches: () => ({ ...counts }),
  };
}
