// @vitest-environment node
/**
 * THE TWO PORTS (AR-5, D14), as adapters.
 *
 * The find sheet and the usage column are the package's and are tested there.
 * What is VibeField's is the translation between them and fieldd's doors —
 * `historyPortOver` and `usagePortOver` in `src/godview/monitor/doors.ts` — and
 * that is all this file holds. No DOM: an adapter is a function of a door's
 * answer, and giving it a document would only hide which half was under test.
 *
 * The door's answers are the CONTRACT's own fixtures wherever one fits, so a
 * shape that moves in `packages/contracts` fails here rather than drifting
 * silently into a view. Where no fixture carries the case — the states a usage
 * row can be in that the sample batch does not happen to contain — the row is
 * built inline and still parsed by the contract on the way through.
 *
 * The claims are mostly about the honest-states law, in its narrowest form:
 *   · a field the door answers `null` for is ABSENT, never guessed
 *   · a word this build cannot name is absent, never believed
 *   · a refused SEARCH is unanswered, never "no matches"
 *   · a refused SESSIONS lookup PROPAGATES, because the sheet keeps the facts
 *     it last showed and an empty array would erase them
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccountUsageBatch } from "@vibecook/puppeteer-core";
import type {
  AgentMeshFrame,
  AgentMeshOpen,
  AgentProfileSet,
  DeviceInfo,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type DoorClient,
  devicesPortOver,
  historyPortOver,
  meshBoardOver,
  profileSetsPortOver,
  toAccountUsageBatch,
  usagePortOver,
} from "../src/godview/monitor/doors";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/** A door that answers `request` from a table and never opens a subscription. */
function requestingClient(answers: Record<string, unknown | (() => Promise<unknown>)>): {
  client: DoorClient;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async (method: string) => {
    const answer = answers[method];
    if (answer === undefined) throw new Error(`no fixture for ${method}`);
    return typeof answer === "function" ? await (answer as () => Promise<unknown>)() : answer;
  });
  return {
    request,
    client: {
      request: request as unknown as DoorClient["request"],
      subscribe: async () => ({ snapshot: undefined, unsubscribe: () => undefined }),
    },
  };
}

/** The smallest `IndexStatus` the contract accepts, with one field per case. */
function indexStatus(overrides: {
  protocolVersion?: number | null;
  search?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    phase: "live",
    rosettad: {
      phase: "ready",
      detail: null,
      pid: 4321,
      protocolVersion: overrides.protocolVersion === undefined ? 20 : overrides.protocolVersion,
    },
    enrollment: { enabledKinds: [], runtimes: [], retired: [], updatedAt: null },
    runtimes: [],
    ...(overrides.search ? { search: overrides.search } : {}),
  };
}

const SEARCH_HEALTH = {
  reachable: true,
  capabilities: { sessionScope: true, prefix: true },
  canonicalReady: true,
  readiness: "ready",
  progress: { done: 3, total: 4 },
  detail: "catching up on one runtime",
};

describe("the history port over fieldd's index doors", () => {
  it("carries the whole search health through, and stamps when it asked", async () => {
    const { client } = requestingClient({
      "index.status": indexStatus({ search: SEARCH_HEALTH }),
    });
    const status = await historyPortOver(client).status();
    expect(status).toMatchObject({
      reachable: true,
      protocolVersion: 20,
      capabilities: { sessionScope: true, prefix: true },
      canonicalReady: true,
      readiness: "ready",
      progress: { done: 3, total: 4 },
      detail: "catching up on one runtime",
    });
    expect(Number.isNaN(Date.parse(status.checkedAt))).toBe(false);
  });

  it("leaves a protocol the door has not read ABSENT rather than guessing one", async () => {
    // `null` is the door's own word for "not read yet". The sheet's status has
    // no word for that, and a zero would be a version claim nobody made.
    const { client } = requestingClient({
      "index.status": indexStatus({ protocolVersion: null, search: SEARCH_HEALTH }),
    });
    const status = await historyPortOver(client).status();
    expect(status).not.toHaveProperty("protocolVersion");
    expect(status.reachable).toBe(true);
  });

  it("drops a readiness word this build cannot name rather than believing it", async () => {
    // The contract folds an unknown readiness to `unknown`, which is not one of
    // the five the sheet draws. Absent is the honest rendering: a state nobody
    // here can describe must not be shown as one that is described.
    const { client } = requestingClient({
      "index.status": indexStatus({
        search: { ...SEARCH_HEALTH, readiness: "reticulating-splines" },
      }),
    });
    const status = await historyPortOver(client).status();
    expect(status).not.toHaveProperty("readiness");
    expect(status.reachable).toBe(true);
  });

  it("reads an answer with no search projection at all as UNREACHABLE, not as ready", async () => {
    // `search` is optional so a build from before AR-5e still parses; a missing
    // projection is a daemon that cannot answer the sheet, and it says so.
    // the golden carries a search projection since AR-5b; this row is the
    // build from before it, so the block is taken off
    const before = { ...(fixture("index-status.valid.json") as Record<string, unknown>) };
    delete before["search"];
    const { client } = requestingClient({ "index.status": before });
    const status = await historyPortOver(client).status();
    expect(status.reachable).toBe(false);
    expect(status.protocolVersion).toBe(20);
  });

  it("turns a refused status into an unreachable one carrying the refusal's words", async () => {
    const { client } = requestingClient({
      "index.status": async () => {
        throw new Error("UNAVAILABLE: rosettad is still starting");
      },
    });
    const status = await historyPortOver(client).status();
    expect(status.reachable).toBe(false);
    expect(status.detail).toContain("rosettad is still starting");
  });

  it("never asks the door for the facts of NO sessions", async () => {
    // A lookup with an empty selector is a round trip whose answer is known,
    // and the contract's own params refuse an empty list anyway.
    const { client, request } = requestingClient({});
    await expect(historyPortOver(client).facts([])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("maps the door's rows and reads an absent stamp as no stamp", async () => {
    const { client, request } = requestingClient({
      "index.sessions": {
        rows: [
          {
            sessionId: "s0",
            nativeSessionId: "native-s0",
            rootSessionId: "s0",
            title: "Named",
            summary: "a summary",
            cwd: "/project/vibe-field",
            updatedAt: 1_700,
            activity: { firstAt: 1, lastAt: 2 },
            streamState: "indexed",
          },
          {
            sessionId: "s1",
            nativeSessionId: "native-s1",
            rootSessionId: "s0",
            activity: null,
            streamState: "pending",
          },
        ],
      },
    });
    const facts = await historyPortOver(client).facts(["native-s0", "native-s1"]);
    expect(request.mock.calls[0]).toEqual([
      "index.sessions",
      { nativeSessionIds: ["native-s0", "native-s1"] },
    ]);
    expect(facts[0]).toEqual({
      nativeSessionId: "native-s0",
      sessionId: "s0",
      rootSessionId: "s0",
      title: "Named",
      summary: "a summary",
      cwd: "/project/vibe-field",
      updatedAt: 1_700,
      streamState: "indexed",
    });
    // The row the index has never stamped: 0 is "no stamp", and the optional
    // display columns stay off the object rather than arriving as undefined.
    expect(facts[1]).toEqual({
      nativeSessionId: "native-s1",
      sessionId: "s1",
      rootSessionId: "s0",
      updatedAt: 0,
      streamState: "pending",
    });
  });

  it("lets a refused facts lookup REJECT, because an empty answer would erase the sheet", async () => {
    // Deliberate, and the one place this port does not swallow. `index.sessions`
    // refuses UNAVAILABLE while the daemon is not ready; the sheet keeps the
    // facts it last showed on a rejection, and would replace them with nothing
    // if this returned `[]`.
    const { client } = requestingClient({
      "index.sessions": async () => {
        throw new Error("UNAVAILABLE: the index is not ready");
      },
    });
    await expect(historyPortOver(client).facts(["native-s0"])).rejects.toThrow(
      "the index is not ready",
    );
  });

  it("maps the contract's own search answer, hit for hit", async () => {
    const { client, request } = requestingClient({
      "index.search": fixture("index-search-result.valid.json"),
    });
    const response = await historyPortOver(client).search({
      query: "needle",
      nativeSessionIds: [],
    });
    expect(request.mock.calls[0]).toEqual(["index.search", { q: "needle" }]);
    expect(response.answered).toBe(true);
    expect(response.clipped).toBe(false);
    expect(response.status).toMatchObject({
      reachable: true,
      canonicalReady: true,
      readiness: "catching-up",
    });
    expect(response.hits).toEqual([
      {
        sessionId: "s1",
        rootSessionId: "s0",
        nativeSessionId: "native-s0",
        title: "Named",
        timelineId: "t1",
        kind: "user",
        at: 1,
        snippet: "[needle] in a haystack",
      },
    ]);
  });

  it("carries a projection that is still building as UNANSWERED, with its progress", async () => {
    const { client } = requestingClient({
      "index.search": fixture("index-search-result.building.json"),
    });
    const response = await historyPortOver(client).search({
      query: "needle",
      nativeSessionIds: [],
    });
    // Reachable — the daemon answered — but it had no answer, and that is not
    // the same claim as "there are no matches".
    expect(response.status.reachable).toBe(true);
    expect(response.answered).toBe(false);
    expect(response.hits).toEqual([]);
    expect(response.status).toMatchObject({
      readiness: "building",
      canonicalReady: false,
      progress: { done: 1284, total: 5912 },
    });
  });

  it("says a refused search was NOT ANSWERED rather than that there were no matches", async () => {
    const { client } = requestingClient({
      "index.search": async () => {
        throw new Error("FORBIDDEN_SCOPE: index.search");
      },
    });
    const response = await historyPortOver(client).search({
      query: "needle",
      nativeSessionIds: [],
    });
    expect(response.answered).toBe(false);
    expect(response.hits).toEqual([]);
    expect(response.clipped).toBe(false);
    expect(response.status.reachable).toBe(false);
    expect(response.status.detail).toContain("FORBIDDEN_SCOPE");
  });

  it("sends the scope, the limit and the prefix only when the sheet asked for them", async () => {
    const { client, request } = requestingClient({
      "index.search": fixture("index-search-result.valid.json"),
    });
    await historyPortOver(client).search({
      query: "needle",
      nativeSessionIds: ["native-s0"],
      limit: 25,
      prefix: false,
    });
    expect(request.mock.calls[0]?.[1]).toEqual({
      q: "needle",
      nativeSessionIds: ["native-s0"],
      limit: 25,
      prefix: false,
    });
  });

  it("floors a fractional afterMs and never sends a negative one", async () => {
    // The contract's `afterMs` is a non-negative integer of epoch ms. The sheet
    // computes it from a live run's start, so it can arrive fractional or, for
    // a clock that moved, below zero — and either would be refused at the wire.
    const { client, request } = requestingClient({
      "index.search": fixture("index-search-result.valid.json"),
    });
    const port = historyPortOver(client);
    await port.search({ query: "n", nativeSessionIds: [], afterMs: 1_757_000_000_123.9 });
    expect(request.mock.calls[0]?.[1]).toMatchObject({ afterMs: 1_757_000_000_123 });
    await port.search({ query: "n", nativeSessionIds: [], afterMs: -5 });
    expect(request.mock.calls[1]?.[1]).toMatchObject({ afterMs: 0 });
    await port.search({ query: "n", nativeSessionIds: [] });
    expect(request.mock.calls[2]?.[1]).not.toHaveProperty("afterMs");
  });
});

describe("the usage port over fieldd's account-usage door", () => {
  const VALID = fixture("agent-usage.valid.json") as { entries: Record<string, unknown>[] };

  it("rebuilds Core's two-part entry from the door's flattened row", () => {
    const batch = toAccountUsageBatch(VALID);
    expect(batch.refreshedAt).toBe("2026-09-13T12:00:01.000Z");
    expect(batch.entries).toHaveLength(3);

    const [available] = batch.entries;
    expect(available?.provider).toMatchObject({ id: "claude", label: "Claude" });
    expect(available?.profileId).toBe("claude:native-default");
    expect(available?.profileLabel).toBe("Default");
    expect(available?.result.status).toBe("available");
    expect(
      available?.result.status === "available" ? available.result.snapshot : undefined,
    ).toMatchObject({
      provider: "claude",
      fetchedAt: "2026-09-13T12:00:00.000Z",
      scope: "subscription",
      source: { kind: "native-protocol", stability: "experimental" },
      credits: { balance: "$12.40", hasCredits: true },
    });
    // The metrics ride verbatim and IN ORDER — a view renders labels and
    // preserves the adapter's ranking, so a reordering here would be a lie
    // about which meter matters.
    const snapshot =
      available?.result.status === "available" ? available.result.snapshot : undefined;
    expect(snapshot?.metrics.map((metric) => metric.id)).toEqual([
      "five-hour",
      "seven-day",
      "fable",
    ]);
    expect(snapshot?.metrics[1]).toMatchObject({ label: "7D", kind: "window", usedPercent: 103.2 });
    // the part of the plan a meter measures rides with it, whole
    expect(snapshot?.metrics[2]?.group).toEqual({ id: "scope:fable", label: "Fable only" });
    // Above 100 is valid for an exceeded budget and is NOT clamped here.
    expect(snapshot?.metrics[1]?.usedPercent).toBeGreaterThan(100);
  });

  it("says a polling cadence is NOT A READING, in the only way a number can", () => {
    // The flattened row carries no cadence (fieldd owns it) and nothing in the
    // column reads this field. NaN is the honest filler: it cannot be mistaken
    // for a real interval the way 0 or 60_000 could.
    const batch = toAccountUsageBatch(VALID);
    for (const entry of batch.entries) {
      expect(Number.isNaN(entry.provider.refresh.pollIntervalMs)).toBe(true);
    }
  });

  it("turns a quota refusal into an unavailable reading that names the code", () => {
    // `rate-limited` is a STATE in the contract and a `code` on a failure
    // upstream, which is the one deliberate difference between the two shapes.
    const rateLimited = toAccountUsageBatch(VALID).entries[1];
    expect(rateLimited?.result.status).toBe("unavailable");
    const failure = rateLimited?.result.status === "unavailable" ? rateLimited.result : undefined;
    expect(failure).toMatchObject({
      code: "rate-limited",
      provider: "claude",
      retryable: true,
      retryAt: "2026-09-13T12:30:00.000Z",
    });
    expect(failure?.message).toContain("rate limited");
  });

  it("keeps a state that IS a failure status as itself", () => {
    const unauthenticated = toAccountUsageBatch(VALID).entries[2];
    expect(unauthenticated?.result.status).toBe("unauthenticated");
    const unsupported = toAccountUsageBatch({
      generatedAt: "2026-09-13T12:00:02.000Z",
      entries: [
        {
          provider: "grok",
          label: "Grok",
          state: "unsupported",
          metrics: [],
          message: "Grok publishes no account usage",
          fetchedAt: "2026-09-13T12:00:02.000Z",
        },
      ],
    }).entries[0];
    expect(unsupported?.result.status).toBe("unsupported");
    expect(
      unsupported?.result.status === "unsupported" ? unsupported.result.retryable : undefined,
    ).toBe(false);
  });

  it("keeps a RETAINED reading's numbers and reports the refresh that failed beside them", () => {
    // The whole point of `stale`: the metrics are real and older, and the state
    // beside them describes the refresh, not the numbers. Both must survive, or
    // the column either loses a good reading or claims a fresh one.
    const stale = toAccountUsageBatch({
      generatedAt: "2026-09-13T12:00:03.000Z",
      entries: [
        {
          ...(VALID.entries[0] as Record<string, unknown>),
          state: "unavailable",
          stale: true,
          message: "the provider timed out",
          retryable: true,
        },
      ],
    }).entries[0];
    expect(stale?.result.status).toBe("available");
    expect(stale?.stale).toBe(true);
    expect(stale?.refreshFailure).toMatchObject({
      status: "unavailable",
      message: "the provider timed out",
      retryable: true,
    });
    // …and the retained numbers keep their OWN age, not the batch's.
    const snapshot = stale?.result.status === "available" ? stale.result.snapshot : undefined;
    expect(snapshot?.fetchedAt).toBe("2026-09-13T12:00:00.000Z");
    expect(snapshot?.metrics).toHaveLength(3);
  });

  it("keeps a credits-only reading AVAILABLE, credits and all (AR-5b)", () => {
    // An account on credits alone (Codex, Grok) reports available with no
    // percentage meters; the column has its own line for that (NO LIMIT
    // DATA). Gating on the meters drew it as a refusal captioned "available".
    const batch = toAccountUsageBatch({
      generatedAt: "2026-09-13T12:00:00.000Z",
      entries: [
        {
          provider: "codex",
          label: "Codex",
          state: "available",
          metrics: [],
          credits: { balance: "$12.40", hasCredits: true },
          fetchedAt: "2026-09-13T11:59:00.000Z",
          scope: "api",
          source: { kind: "native-protocol", stability: "experimental" },
        },
      ],
    });
    const result = batch.entries[0]?.result;
    expect(result?.status).toBe("available");
    if (result?.status !== "available") throw new Error("not available");
    expect(result.snapshot.metrics).toEqual([]);
    expect(result.snapshot.credits).toEqual({ balance: "$12.40", hasCredits: true });
    expect(result.snapshot.scope).toBe("api");
  });

  it('says an UNKNOWN state as "no reading yet", retryable — never the bare word or a refusal (AR-5b)', () => {
    const batch = toAccountUsageBatch({
      generatedAt: "2026-09-13T12:00:00.000Z",
      entries: [
        {
          provider: "claude",
          label: "Claude",
          state: "unknown",
          metrics: [],
          fetchedAt: "2026-09-13T11:59:00.000Z",
        },
      ],
    });
    const result = batch.entries[0]?.result;
    expect(result?.status).toBe("unavailable");
    if (result?.status !== "unavailable") throw new Error("not unavailable");
    expect(result.message).toBe("no reading yet");
    expect(result.retryable).toBe(true);
    expect("code" in result).toBe(false);
  });

  it("folds a scope word Core does not know to `unknown` rather than a typed lie (AR-5b)", () => {
    const batch = toAccountUsageBatch({
      generatedAt: "2026-09-13T12:00:00.000Z",
      entries: [
        {
          provider: "grok",
          label: "Grok",
          state: "available",
          metrics: [{ id: "m", label: "M", kind: "window", usedPercent: 3 }],
          fetchedAt: "2026-09-13T11:59:00.000Z",
          scope: "enterprise-tenant",
        },
      ],
    });
    const result = batch.entries[0]?.result;
    if (result?.status !== "available") throw new Error("not available");
    expect(result.snapshot.scope).toBe("unknown");
  });

  it("reads an empty batch as an honest empty", () => {
    const batch = toAccountUsageBatch(fixture("agent-usage.empty.json"));
    expect(batch.entries).toEqual([]);
    expect(batch.refreshedAt).toBe("2026-09-13T12:00:00.000Z");
  });

  it("asks the door for a snapshot and lets a refusal reject", async () => {
    const { client, request } = requestingClient({ "agents.usage": VALID });
    await expect(usagePortOver(client).snapshot()).resolves.toMatchObject({
      entries: expect.any(Array),
    });
    expect(request).toHaveBeenCalledWith("agents.usage", {});
    const refusing = requestingClient({
      "agents.usage": async () => {
        throw new Error("FORBIDDEN_SCOPE: agents.usage");
      },
    });
    await expect(usagePortOver(refusing.client).snapshot()).rejects.toThrow("FORBIDDEN_SCOPE");
  });
});

/** A door whose subscription resolves when the test says so, and whose frames
 * the test pushes by hand — which is the only way to see what the port does
 * between the call and the answer. */
function subscribingClient(): {
  client: DoorClient;
  resolve(snapshot: unknown): void;
  reject(reason: Error): void;
  frame(payload: unknown, kind?: "snapshot" | "delta"): void;
  unsubscribes: number;
} {
  let onFrame: ((payload: unknown, kind?: "snapshot" | "delta") => void) | undefined;
  let settle: ((value: { snapshot: unknown; unsubscribe: () => void }) => void) | undefined;
  let fail: ((reason: Error) => void) | undefined;
  const facts = {
    unsubscribes: 0,
    client: {
      request: async () => undefined,
      subscribe: (
        _method: string,
        _params: Record<string, unknown>,
        handler: (payload: unknown, kind?: "snapshot" | "delta") => void,
      ) => {
        onFrame = handler;
        return new Promise<{ snapshot: unknown; unsubscribe: () => void }>((done, no) => {
          settle = done;
          fail = no;
        });
      },
    } as DoorClient,
    resolve: (snapshot: unknown): void => {
      settle?.({
        snapshot,
        unsubscribe: () => {
          facts.unsubscribes += 1;
        },
      });
    },
    reject: (reason: Error): void => fail?.(reason),
    frame: (payload: unknown, kind?: "snapshot" | "delta"): void => onFrame?.(payload, kind),
  };
  return facts;
}

/** Let the port's own `.then` chain run. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe("the usage port's subscription", () => {
  const VALID = fixture("agent-usage.valid.json");
  const EMPTY = fixture("agent-usage.empty.json");

  it("delivers the subscription's own snapshot, then every frame after it", async () => {
    const door = subscribingClient();
    const seen: AccountUsageBatch[] = [];
    const dispose = usagePortOver(door.client).subscribe((batch) => seen.push(batch));

    door.resolve(EMPTY);
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.entries).toEqual([]);

    door.frame(VALID);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.entries).toHaveLength(3);
    dispose();
    expect(door.unsubscribes).toBe(1);
  });

  it("drops a frame this reader cannot parse instead of throwing at the column", () => {
    // The tolerant reader's other half. A frame from a daemon generation this
    // build cannot read must cost the column its next update, never its life —
    // it keeps the last batch it had.
    const door = subscribingClient();
    const seen: AccountUsageBatch[] = [];
    const port = usagePortOver(door.client);
    const states: string[] = [];
    port.subscribeState?.((state) => states.push(state.state));
    port.subscribe((batch) => seen.push(batch));

    expect(() => door.frame({ entries: "not an array" })).not.toThrow();
    expect(() => door.frame(undefined)).not.toThrow();
    expect(seen).toHaveLength(0);
    expect(states.at(-1)).toBe("unavailable");
    // …and the next readable frame still lands.
    door.frame(VALID);
    expect(seen).toHaveLength(1);
    expect(states.at(-1)).toBe("ready");
  });

  it("unsubscribes on arrival when the column left before the door answered, and delivers nothing", async () => {
    // The race a stage that opens and closes quickly actually runs. The door's
    // answer arrives after the disposal, and a port that only remembered the
    // unsubscribe would leak the subscription AND paint a dead column.
    const door = subscribingClient();
    const seen: AccountUsageBatch[] = [];
    const dispose = usagePortOver(door.client).subscribe((batch) => seen.push(batch));

    dispose();
    door.resolve(VALID);
    await settle();

    expect(door.unsubscribes).toBe(1);
    expect(seen).toEqual([]);
    // A frame that raced in behind it is dropped too.
    door.frame(VALID);
    expect(seen).toEqual([]);
  });

  it("survives a door that refuses the subscription outright", async () => {
    const door = subscribingClient();
    const seen: AccountUsageBatch[] = [];
    const dispose = usagePortOver(door.client).subscribe((batch) => seen.push(batch));

    door.reject(new Error("FORBIDDEN_SCOPE: agents.usage.subscribe"));
    await settle();

    expect(seen).toEqual([]);
    // The dispose is still safe to call: there is nothing to unsubscribe.
    expect(() => dispose()).not.toThrow();
    expect(door.unsubscribes).toBe(0);
  });
});

describe("the profiles port over fieldd's profile-sets feed (AR-S5)", () => {
  const FEED = fixture("agents-profile-sets.valid.json");

  it("delivers the snapshot's profiles, then every readable frame, and drops one it cannot read", async () => {
    const door = subscribingClient();
    const seen: (readonly AgentProfileSet[])[] = [];
    const dispose = profileSetsPortOver(door.client).subscribe((sets) => seen.push(sets));
    door.resolve(FEED);
    await settle();
    expect(seen.at(-1)?.map((set) => [set.id, set.kind, set.label])).toEqual([
      ["native", "native", "This Mac"],
      ["work", "managed", "Work"],
    ]);
    door.frame({ sets: "not a list" });
    expect(seen).toHaveLength(1);
    door.frame(FEED);
    expect(seen).toHaveLength(2);
    dispose();
    expect(door.unsubscribes).toBe(1);
  });

  it("unsubscribes on arrival when the stage closed first, and survives a refusal", async () => {
    const late = subscribingClient();
    const seen: (readonly AgentProfileSet[])[] = [];
    profileSetsPortOver(late.client).subscribe((sets) => seen.push(sets))();
    late.resolve(FEED);
    await settle();
    expect(late.unsubscribes).toBe(1);
    expect(seen).toEqual([]);

    const refused = subscribingClient();
    const dispose = profileSetsPortOver(refused.client).subscribe((sets) => seen.push(sets));
    refused.reject(new Error("FORBIDDEN_SCOPE: agents.profileSets.subscribe"));
    await settle();
    expect(seen).toEqual([]);
    expect(() => dispose()).not.toThrow();
  });
});

describe("DS-3 — the mesh board over fieldd's own door", () => {
  const OPEN = fixture("agent-mesh-open.valid.json");
  const FRAMES = fixture("agent-mesh-frames.valid.json") as unknown[];

  function listen() {
    const opens: AgentMeshOpen[] = [];
    const frames: AgentMeshFrame[] = [];
    const errors: string[] = [];
    return {
      opens,
      frames,
      errors,
      listener: {
        onOpen: (open: AgentMeshOpen) => opens.push(open),
        onFrame: (frame: AgentMeshFrame) => frames.push(frame),
        onError: (reason: string) => errors.push(reason),
      },
    };
  }

  it("asks for the desk board at the mesh scope, and reads the open, then every frame", async () => {
    const door = subscribingClient();
    const subscribe = vi.spyOn(door.client, "subscribe");
    const seen = listen();
    const dispose = meshBoardOver(door.client)(seen.listener);
    expect(subscribe.mock.calls[0]?.slice(0, 2)).toEqual([
      "agent.subscribe",
      { projection: "desk", scope: "mesh" },
    ]);
    door.resolve(OPEN);
    await settle();
    expect(seen.opens.map((open) => open.devices.map((entry) => entry.state))).toEqual([
      ["live", "live", "asleep", "stale"],
    ]);
    for (const frame of FRAMES) door.frame(frame, "delta");
    expect(seen.frames).toHaveLength(FRAMES.length);
    // the client's replay after a reconnect is a WHOLE board, and replaces
    door.frame(OPEN, "snapshot");
    expect(seen.opens).toHaveLength(2);
    expect(seen.errors).toEqual([]);
    dispose();
    expect(door.unsubscribes).toBe(1);
  });

  it("an unreadable frame is a reason, never a blank; a refused board says why", async () => {
    const door = subscribingClient();
    const seen = listen();
    meshBoardOver(door.client)(seen.listener);
    door.resolve(OPEN);
    await settle();
    door.frame({ device: "", delta: {} }, "delta");
    expect(seen.errors[0]).toMatch(/^the mesh board sent an unreadable frame/);

    const refused = subscribingClient();
    const told = listen();
    meshBoardOver(refused.client)(told.listener);
    refused.reject(new Error("FORBIDDEN_SCOPE: requires agent.observe"));
    await settle();
    expect(told.errors).toEqual(["FORBIDDEN_SCOPE: requires agent.observe"]);
  });

  it("unsubscribes on arrival when the stage closed first", async () => {
    const late = subscribingClient();
    const seen = listen();
    meshBoardOver(late.client)(seen.listener)();
    late.resolve(OPEN);
    await settle();
    expect(late.unsubscribes).toBe(1);
    expect(seen.opens).toEqual([]);
  });
});

describe("DS-3 — the roster port over device.subscribe", () => {
  it("delivers whole lists and drops one it cannot read", async () => {
    const door = subscribingClient();
    const seen: (readonly DeviceInfo[])[] = [];
    const dispose = devicesPortOver(door.client).subscribe((devices) => seen.push(devices));
    door.resolve([
      {
        deviceId: "dev-a",
        name: "pro",
        platform: "darwin",
        self: true,
        online: true,
        lastSeenAt: 1,
      },
    ]);
    await settle();
    expect(seen.at(-1)?.map((device) => device.name)).toEqual(["pro"]);
    door.frame({ devices: "not a list" });
    expect(seen).toHaveLength(1);
    dispose();
    expect(door.unsubscribes).toBe(1);
  });
});
