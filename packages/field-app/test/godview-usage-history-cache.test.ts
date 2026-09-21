import type { UsageLedgerRecord, UsageRunRecord } from "@vibecook/puppeteer-views";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUsageHistoryCache } from "../src/godview/monitor/usage-history-cache";

// THE BURN LEDGER'S CACHE (D7, AR-5): where the UI's usage ledgers sleep
// between sessions, so a resumed conversation opens with the total and the
// burn it had. Renderer-local and bounded, because it is CACHE — losing a
// record costs a resumed bubble its first ten minutes of history and nothing
// else. Everything here is therefore about degrading quietly: a garbage
// partition, a blocked one and an empty save all have to leave the live
// ledgers alone rather than reach a component that was drawing a bubble.
//
// AR-5-1 moved the record to independently observed USD RUNS, which gave this
// cache a second obligation: `exportUsage` hands it only the LIVE run, so the
// merge is per run and a correction wins by revision, and a version 1
// document — token series, not dollars — is never read back at all.

const KEY = "vf-test-usage-history";

function run(runId: string, overrides: Partial<UsageRunRecord> = {}): UsageRunRecord {
  return {
    runId,
    costUsd: 1.5,
    coverage: "complete",
    buckets: [{ at: "2026-09-13T09:59:30.000Z", costUsd: 1.5 }],
    ...overrides,
  };
}

function record(
  providerId: string,
  nativeSessionId: string,
  overrides: Partial<UsageLedgerRecord> = {},
): UsageLedgerRecord {
  return {
    currency: "USD",
    providerId,
    nativeSessionId,
    savedAt: "2026-09-13T10:00:00.000Z",
    runs: [run("run-1")],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.removeItem(KEY);
});

afterEach(() => {
  localStorage.removeItem(KEY);
});

describe("the usage history cache", () => {
  it("round-trips a ledger, keyed by the provider AND its native session", async () => {
    // The key is the identity a resume continues — the native session — and it
    // is qualified by the provider, because two adapters may hand out the same
    // opaque id and one conversation's burn must never be shown for another's.
    const cache = createUsageHistoryCache(KEY);
    const codex = record("codex", "session-1");
    const claude = record("claude", "session-1", {
      runs: [run("run-2", { costUsd: 0.05, buckets: [] })],
    });
    await cache.save([codex, claude]);
    await expect(
      cache.load({ providerId: "codex", nativeSessionId: "session-1" }),
    ).resolves.toEqual(codex);
    await expect(
      cache.load({ providerId: "claude", nativeSessionId: "session-1" }),
    ).resolves.toEqual(claude);
  });

  it("answers null for a conversation it never saved", async () => {
    const cache = createUsageHistoryCache(KEY);
    await expect(
      cache.load({ providerId: "codex", nativeSessionId: "unknown" }),
    ).resolves.toBeNull();
    await cache.save([record("codex", "session-1")]);
    await expect(cache.load({ providerId: "codex", nativeSessionId: "other" })).resolves.toBeNull();
  });

  it("merges a later save over the same conversation and leaves the others alone", async () => {
    const cache = createUsageHistoryCache(KEY);
    await cache.save([record("codex", "a"), record("codex", "b")]);
    const moved = record("codex", "a", {
      savedAt: "2026-09-13T11:00:00.000Z",
      runs: [run("run-1", { costUsd: 9 })],
    });
    await cache.save([moved]);
    await expect(cache.load({ providerId: "codex", nativeSessionId: "a" })).resolves.toEqual(moved);
    await expect(cache.load({ providerId: "codex", nativeSessionId: "b" })).resolves.toEqual(
      record("codex", "b"),
    );
  });

  it("keeps every earlier run — the live export is one run, not the whole history", async () => {
    // `exportUsage` emits the conversation's LIVE run alone, so a save that
    // replaced the record would discard the spend of every run before it and a
    // resumed bubble would open holding only its latest leg.
    const cache = createUsageHistoryCache(KEY);
    await cache.save([record("codex", "a", { runs: [run("run-1", { costUsd: 2 })] })]);
    await cache.save([
      record("codex", "a", {
        savedAt: "2026-09-13T11:00:00.000Z",
        runs: [run("run-2", { costUsd: 3 })],
      }),
    ]);
    const stored = await cache.load({ providerId: "codex", nativeSessionId: "a" });
    expect(stored?.runs.map((entry) => entry.runId)).toEqual(["run-1", "run-2"]);
    expect(stored?.runs.map((entry) => entry.costUsd)).toEqual([2, 3]);
    expect(stored?.savedAt).toBe("2026-09-13T11:00:00.000Z");
  });

  it("a correction stands: a delayed snapshot of the same run never undoes it", async () => {
    // Two Godview windows share this partition. The one holding the older
    // revision may save last, and its stale number must not win.
    const cache = createUsageHistoryCache(KEY);
    await cache.save([
      record("codex", "a", {
        savedAt: "2026-09-13T11:00:00.000Z",
        runs: [run("run-1", { revision: 7, costUsd: 9 })],
      }),
    ]);
    await cache.save([
      record("codex", "a", {
        savedAt: "2026-09-13T12:00:00.000Z",
        runs: [run("run-1", { revision: 3, costUsd: 1 })],
      }),
    ]);
    await expect(cache.load({ providerId: "codex", nativeSessionId: "a" })).resolves.toMatchObject({
      savedAt: "2026-09-13T12:00:00.000Z",
      runs: [run("run-1", { revision: 7, costUsd: 9 })],
    });
    // …while the same run at a LATER revision is exactly what may replace it.
    await cache.save([
      record("codex", "a", {
        savedAt: "2026-09-13T13:00:00.000Z",
        runs: [run("run-1", { revision: 8, costUsd: 4 })],
      }),
    ]);
    await expect(cache.load({ providerId: "codex", nativeSessionId: "a" })).resolves.toMatchObject({
      runs: [run("run-1", { revision: 8, costUsd: 4 })],
    });
  });

  it("bounds one conversation's runs as well, and the oldest fall off", async () => {
    // A conversation resumed forever accumulates runs, and the only failure
    // mode of a full partition here is a silent throw.
    const cache = createUsageHistoryCache(KEY);
    for (let index = 0; index < 55; index += 1) {
      await cache.save([
        record("codex", "a", {
          savedAt: new Date(Date.parse("2026-09-13T10:00:00.000Z") + index * 60_000).toISOString(),
          runs: [run(`run-${index}`)],
        }),
      ]);
    }
    const stored = await cache.load({ providerId: "codex", nativeSessionId: "a" });
    expect(stored?.runs).toHaveLength(50);
    expect(stored?.runs.at(0)?.runId).toBe("run-5");
    expect(stored?.runs.at(-1)?.runId).toBe("run-54");
  });

  it("saving nothing is harmless: the cache it already holds is untouched", async () => {
    // The hook saves on a timer whether or not anything is live. An empty save
    // that wrote would erase every resumable conversation's history on the
    // first tick after the last agent exited.
    const cache = createUsageHistoryCache(KEY);
    await cache.save([record("codex", "a")]);
    const before = localStorage.getItem(KEY);
    await cache.save([]);
    expect(localStorage.getItem(KEY)).toBe(before);
    await expect(cache.load({ providerId: "codex", nativeSessionId: "a" })).resolves.toEqual(
      record("codex", "a"),
    );
    // …and with nothing stored at all it writes nothing rather than an empty file
    localStorage.removeItem(KEY);
    await cache.save([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("reads garbage as an empty cache, and the next save replaces it", async () => {
    const cache = createUsageHistoryCache(KEY);
    for (const bad of [
      "not json at all",
      "null",
      // A version 1 document is the TOKEN ledger AR-5-1 replaced. Reading one
      // back would open a resumed bubble showing token counts as dollars.
      '{"version":1,"records":[{"providerId":"codex","nativeSessionId":"a",' +
        '"savedAt":"2026-09-13T10:00:00.000Z","boundary":100,' +
        '"total":{"held":1000,"snapshots":[0,1000]}}]}',
      '{"version":3,"records":[]}',
      '{"version":2,"records":"nope"}',
      "[]",
    ]) {
      localStorage.setItem(KEY, bad);
      await expect(cache.load({ providerId: "codex", nativeSessionId: "a" })).resolves.toBeNull();
    }
    // The bad value is not appended to — the save starts from the empty read.
    await cache.save([record("codex", "a")]);
    await expect(cache.load({ providerId: "codex", nativeSessionId: "a" })).resolves.toEqual(
      record("codex", "a"),
    );
  });

  it("is BOUNDED, and the oldest saves are the ones that fall off", async () => {
    // A user's whole past must not accumulate in a storage partition. The
    // order is by save time, so the conversation touched most recently is the
    // one a resume is most likely to want back.
    const cache = createUsageHistoryCache(KEY);
    const many = Array.from({ length: 205 }, (_, index) =>
      record("codex", `session-${index}`, {
        savedAt: new Date(Date.parse("2026-09-13T00:00:00.000Z") + index * 60_000).toISOString(),
      }),
    );
    await cache.save(many);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
      records: UsageLedgerRecord[];
    };
    expect(stored.records).toHaveLength(200);
    await expect(
      cache.load({ providerId: "codex", nativeSessionId: "session-0" }),
    ).resolves.toBeNull();
    await expect(
      cache.load({ providerId: "codex", nativeSessionId: "session-4" }),
    ).resolves.toBeNull();
    await expect(
      cache.load({ providerId: "codex", nativeSessionId: "session-5" }),
    ).resolves.not.toBeNull();
    await expect(
      cache.load({ providerId: "codex", nativeSessionId: "session-204" }),
    ).resolves.not.toBeNull();
  });

  it("survives a partition that refuses to answer", async () => {
    // A private window or a blocked partition: the live ledgers are unaffected,
    // which means neither call may reject into the hook that made it.
    const broken: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => {
        throw new Error("partition is blocked");
      },
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("partition is blocked");
      },
    };
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: broken, configurable: true });
    try {
      const cache = createUsageHistoryCache(KEY);
      await expect(cache.load({ providerId: "codex", nativeSessionId: "a" })).resolves.toBeNull();
      await expect(cache.save([record("codex", "a")])).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: real, configurable: true });
    }
  });
});
