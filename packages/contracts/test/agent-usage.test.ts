import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_ACCOUNT_USAGE_STATES,
  AgentAccountUsageBatch,
  AgentAccountUsageEntry,
} from "../src/agent-usage";
import { METHODS } from "../src/methods";

// AR-5d — account usage (thinking-ar-views-port.md §6.2). The batch is a
// PROJECTION of puppeteer's fetch result, so the fixtures are what fieldd
// actually publishes rather than a transcription of the upstream union: one
// batch carrying the three states a person will meet (a good reading, a
// quota refusal, a signed-out account) and the honest empty one the door
// answers before its first refresh.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

describe("the agents.usage rows (AR-5d)", () => {
  it("both doors read on agent.observe, stay local, and exactly one subscribes", () => {
    const rows = METHODS.filter((m) => m.method.startsWith("agents.usage")).map((m) => ({
      method: m.method,
      scope: m.scope,
      idempotent: m.idempotent,
      locality: m.locality,
      subscription: m.subscription ?? false,
    }));
    expect(rows).toEqual([
      {
        method: "agents.usage",
        scope: "agent.observe",
        idempotent: true,
        locality: "local",
        subscription: false,
      },
      {
        method: "agents.usage.subscribe",
        scope: "agent.observe",
        idempotent: true,
        locality: "local",
        subscription: true,
      },
    ]);
  });
});

describe("the account-usage batch (AR-5d)", () => {
  it("parses the three-state batch and keeps the adapter's metric order", () => {
    const batch = AgentAccountUsageBatch.parse(fixture("agent-usage.valid.json"));
    expect(batch.entries.map((entry) => entry.state)).toEqual([
      "available",
      "rate-limited",
      "unauthenticated",
    ]);
    const [available, limited, signedOut] = batch.entries;
    // the reading: two window meters in the adapter's own order, plus credits
    expect(available?.metrics.map((metric) => metric.label)).toEqual(["5H", "7D"]);
    expect(available?.metrics[1]?.usedPercent).toBeGreaterThan(100); // an exceeded budget is valid
    expect(available?.credits?.balance).toBe("$12.40"); // the provider's own formatting, verbatim
    expect(available?.profileId).toBe("claude:native-default");
    // the refusals carry a sentence and their retry facts, never metrics
    expect(limited?.metrics).toEqual([]);
    expect(limited?.retryable).toBe(true);
    expect(limited?.retryAt).toBe("2026-09-13T12:30:00.000Z");
    expect(signedOut?.retryable).toBe(false);
    // a reading for the provider's native default account names no profile
    expect(signedOut?.profileId).toBeUndefined();
  });

  it("the empty batch is a batch: entries [] with a stamp, never a null or a throw", () => {
    const batch = AgentAccountUsageBatch.parse(fixture("agent-usage.empty.json"));
    expect(batch.entries).toEqual([]);
    expect(batch.generatedAt).toBe("2026-09-13T12:00:00.000Z");
  });

  it("an unknown state folds to `unknown` — the row survives, and says what it knows", () => {
    // The tolerant reader's choice (see the comment on AgentAccountUsageState):
    // a newer fieldd's sixth state must not drop the row, and must not be
    // relabelled `unavailable` — that would claim a refusal nobody reported.
    const entry = AgentAccountUsageEntry.parse({
      provider: "claude",
      label: "Claude",
      state: "throttled-by-org",
      metrics: [],
      message: "the org's administrator paused this account",
      fetchedAt: "2026-09-13T12:00:00.000Z",
    });
    expect(entry.state).toBe("unknown");
    expect(AGENT_ACCOUNT_USAGE_STATES).toContain("unknown");
    // the sentence a person reads survives the fold
    expect(entry.message).toBe("the org's administrator paused this account");
    expect(entry.retryable).toBeUndefined();
  });

  it("unknown fields ride through at every level (the tolerant reader)", () => {
    const batch = AgentAccountUsageBatch.parse({
      entries: [
        {
          provider: "codex",
          label: "Codex",
          state: "available",
          metrics: [
            {
              id: "weekly",
              label: "7D",
              kind: "quarter", // a kind this build has no word for
              usedPercent: 3,
              tokensRemaining: 1_200, // a field this build has no word for
            },
          ],
          fetchedAt: "2026-09-13T12:00:00.000Z",
          seat: "enterprise",
        },
      ],
      generatedAt: "2026-09-13T12:00:00.000Z",
      pollIntervalMs: 60_000,
    });
    expect(batch.entries[0]).toMatchObject({ seat: "enterprise" });
    expect(batch.entries[0]?.metrics[0]).toMatchObject({ kind: "quarter", tokensRemaining: 1_200 });
    expect(batch).toMatchObject({ pollIntervalMs: 60_000 });
  });

  it("a row without its identity or its stamp is refused", () => {
    expect(
      AgentAccountUsageEntry.safeParse({
        label: "Claude",
        state: "available",
        metrics: [],
        fetchedAt: "2026-09-13T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      AgentAccountUsageEntry.safeParse({
        provider: "claude",
        label: "Claude",
        state: "available",
        metrics: [],
      }).success,
    ).toBe(false);
  });
});
