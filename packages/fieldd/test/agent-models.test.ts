import type { AgentModelDiscoveryResult } from "@vibecook/puppeteer-core";
import type { DiscoverAgentModelsOptions } from "@vibecook/puppeteer-runtime";
import { describe, expect, it } from "vitest";
import {
  AgentModelCatalogs,
  MODEL_CATALOG_FRESH_MS,
  MODEL_DISCOVERY_TIMEOUT_MS,
} from "../src/agent-models";

// PJ-6 — the held pickers (agent-models.ts): a menu opens on what fieldd last
// read for that agent and Agent Profile, at once, and a read runs behind it
// when that is old; a failed read is held as its failure, beside the last
// catalog a read did find. The reads are scripted here, each one settled by
// the test, so "at once" and "behind it" are orders, never timings.

const catalog = (observedAt: string, models: string[]): AgentModelDiscoveryResult => ({
  status: "available",
  catalog: {
    provider: "scripted",
    cwd: "/repo",
    observedAt,
    source: { kind: "native-protocol", freshness: "live" },
    completeness: "complete",
    customModels: false,
    models: models.map((id) => ({ id, label: id.toUpperCase(), controls: [] })),
  },
});
const signedOut: AgentModelDiscoveryResult = {
  status: "auth-required",
  provider: "scripted",
  code: "auth-required",
  message: "Sign in to discover models.",
};

/** A discover whose every read waits for the test to answer it. */
function scripted() {
  const asks: Array<{
    options: DiscoverAgentModelsOptions;
    answer: (result: AgentModelDiscoveryResult) => void;
    fail: (error: Error) => void;
  }> = [];
  const discover = (options: DiscoverAgentModelsOptions) =>
    new Promise<AgentModelDiscoveryResult>((resolve, reject) => {
      asks.push({ options, answer: resolve, fail: reject });
    });
  return { asks, discover };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the held pickers (PJ-6)", () => {
  it("the first ask waits for a read, bounded by puppeteer's own deadline; asks while it runs join it", async () => {
    const { asks, discover } = scripted();
    const catalogs = new AgentModelCatalogs({ discover, now: () => 1_000 });
    const one = catalogs.read({ provider: "scripted", profileSet: "work", cwd: "/repo" });
    const two = catalogs.read({ provider: "scripted", profileSet: "work", cwd: "/repo" });
    await settle();
    expect(asks).toHaveLength(1);
    expect(asks[0]?.options).toEqual({
      agent: "scripted",
      cwd: "/repo",
      profileSet: "work",
      timeoutMs: MODEL_DISCOVERY_TIMEOUT_MS,
    });
    asks[0]?.answer(catalog("2026-10-12T10:00:00.000Z", ["a", "b"]));
    for (const answer of [await one, await two]) {
      expect(answer).toMatchObject({ provider: "scripted", profileSet: "work", refreshing: false });
      expect(answer.catalog?.models.map((model) => model.id)).toEqual(["a", "b"]);
      expect(answer.failure).toBeUndefined();
    }
  });

  it("a held catalog answers at once: no read while it is young, a read BEHIND the answer once it is old", async () => {
    const { asks, discover } = scripted();
    let now = 1_000;
    const catalogs = new AgentModelCatalogs({ discover, now: () => now });
    const first = catalogs.read({ provider: "scripted", cwd: "/repo" });
    await settle();
    asks[0]?.answer(catalog("2026-10-12T10:00:00.000Z", ["a"]));
    await first;

    now += MODEL_CATALOG_FRESH_MS - 1;
    const young = await catalogs.read({ provider: "scripted", cwd: "/repo" });
    expect(young.refreshing).toBe(false);
    expect(asks).toHaveLength(1);

    now += 1;
    const old = await catalogs.read({ provider: "scripted", cwd: "/repo" });
    // answered from what was held, the read running behind it
    expect(old.catalog?.models.map((model) => model.id)).toEqual(["a"]);
    expect(old.refreshing).toBe(true);
    expect(asks).toHaveLength(2);
    asks[1]?.answer(catalog("2026-10-12T10:01:00.000Z", ["a", "c"]));
    await settle();
    const newer = await catalogs.read({ provider: "scripted", cwd: "/repo" });
    expect(newer.catalog?.models.map((model) => model.id)).toEqual(["a", "c"]);
    expect(newer.refreshing).toBe(false);
  });

  it("a failed read is held as its failure — never an empty list — beside the last catalog a read found, and read again at every ask; `refresh` waits", async () => {
    const { asks, discover } = scripted();
    let now = 1_000;
    const catalogs = new AgentModelCatalogs({ discover, now: () => now });
    const first = catalogs.read({ provider: "scripted", cwd: "/repo" });
    await settle();
    asks[0]?.answer(signedOut);
    const failed = await first;
    expect(failed.catalog).toBeUndefined();
    expect(failed.failure).toEqual({
      status: "auth-required",
      code: "auth-required",
      message: "Sign in to discover models.",
      at: new Date(1_000).toISOString(),
    });

    // the failure is answered at once, and read again behind it (a sign-in
    // may have happened since), however young
    now += 1;
    const again = await catalogs.read({ provider: "scripted", cwd: "/repo" });
    expect(again.failure?.code).toBe("auth-required");
    expect(again.refreshing).toBe(true);
    asks[1]?.answer(catalog("2026-10-12T10:00:00.000Z", ["a"]));
    await settle();
    const found = await catalogs.read({ provider: "scripted", cwd: "/repo" });
    expect(found.failure).toBeUndefined();
    expect(found.catalog?.models.map((model) => model.id)).toEqual(["a"]);

    // a later failure stands beside the catalog it could not replace
    const refreshed = catalogs.read({ provider: "scripted", cwd: "/repo", refresh: true });
    await settle();
    asks[2]?.answer({
      status: "unavailable",
      provider: "scripted",
      code: "timeout",
      message: "Model discovery timed out.",
    });
    const beside = await refreshed;
    expect(beside.catalog?.models.map((model) => model.id)).toEqual(["a"]);
    expect(beside.failure?.code).toBe("timeout");
    expect(beside.refreshing).toBe(false);
  });

  it("holds each agent and Agent Profile apart (the default profile is its own), and a read that throws reaches the waiting ask", async () => {
    const { asks, discover } = scripted();
    const catalogs = new AgentModelCatalogs({ discover, now: () => 1_000 });
    const work = catalogs.read({ provider: "scripted", profileSet: "work", cwd: "/repo" });
    const plain = catalogs.read({ provider: "scripted", cwd: "/repo" });
    await settle();
    expect(asks.map((ask) => ask.options.profileSet)).toEqual(["work", undefined]);
    asks[0]?.answer(catalog("2026-10-12T10:00:00.000Z", ["w"]));
    asks[1]?.fail(new Error("agent runtime is disposed"));
    expect((await work).catalog?.models.map((model) => model.id)).toEqual(["w"]);
    await expect(plain).rejects.toThrow("agent runtime is disposed");
    // the throw held nothing: the next ask reads again
    const retry = catalogs.read({ provider: "scripted", cwd: "/repo" });
    await settle();
    expect(asks).toHaveLength(3);
    asks[2]?.answer(catalog("2026-10-12T10:00:01.000Z", ["d"]));
    expect((await retry).catalog?.models.map((model) => model.id)).toEqual(["d"]);
  });
});
