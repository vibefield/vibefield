import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_CATALOG, AgentSessionRecord } from "@vibefield/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { SessionRecordStore } from "../src/agent-sessions";

// QL — `SessionRecordStore.newestCreatedByProvider`, the column
// `agent.providers` orders the launcher's agents by (`lastLaunchedAt`). It is
// read on every providers call, so it must not list and HMAC-verify every
// record each time: one `list()` seeds it, and the store's own writes and
// removals keep it. What is under test is that it stays TRUE while doing so.

const [FIRST, SECOND] = AGENT_CATALOG.map((row) => row.id);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const store = (): SessionRecordStore => {
  const dir = mkdtempSync(join(tmpdir(), "vf-records-"));
  dirs.push(dir);
  return new SessionRecordStore({
    dir: join(dir, "sessions"),
    keyPath: join(dir, "sessions.key"),
    now: () => new Date("2026-09-28T12:00:00.000Z"),
  });
};

const record = (runtimeRunId: string, provider: string, createdAt: string): AgentSessionRecord => ({
  format: 1,
  runtimeRunId,
  runtimeEpoch: 1,
  provider,
  cwd: "/repo",
  continuation: { providerId: provider, nativeSessionId: `native-${runtimeRunId}` },
  createdAt,
  updatedAt: createdAt,
});

const at = (iso: string): number => Date.parse(iso);

describe("the newest launch per agent, kept in memory", () => {
  it("is seeded by ONE list, however often it is asked, and a write keeps it without another", () => {
    const records = store();
    records.write(record("run-1", FIRST!, "2026-09-01T00:00:00.000Z"));
    records.write(record("run-2", SECOND!, "2026-09-02T00:00:00.000Z"));
    const list = vi.spyOn(records, "list");
    expect(Object.fromEntries(records.newestCreatedByProvider())).toEqual({
      [FIRST!]: at("2026-09-01T00:00:00.000Z"),
      [SECOND!]: at("2026-09-02T00:00:00.000Z"),
    });
    records.newestCreatedByProvider();
    expect(list).toHaveBeenCalledTimes(1);
    // a newer launch, and an OLD record rewritten later (an exit stamp): the
    // newest creation wins, and no record is read to know it
    records.write(record("run-3", FIRST!, "2026-09-10T00:00:00.000Z"));
    records.stampExit("run-1", {
      at: "2026-09-20T00:00:00.000Z",
      reason: "completed",
      exitCode: 0,
      signal: null,
    });
    expect(records.newestCreatedByProvider().get(FIRST!)).toBe(at("2026-09-10T00:00:00.000Z"));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("forgets a removed record: an older one's removal costs nothing, the newest's re-seeds from disk", () => {
    const records = store();
    records.write(record("run-old", FIRST!, "2026-09-01T00:00:00.000Z"));
    records.write(record("run-new", FIRST!, "2026-09-05T00:00:00.000Z"));
    records.write(record("run-other", SECOND!, "2026-09-03T00:00:00.000Z"));
    const list = vi.spyOn(records, "list");
    records.newestCreatedByProvider();
    // the other agent's only record — its newest — goes: re-seeded, and gone
    records.remove("run-other");
    expect(records.newestCreatedByProvider().has(SECOND!)).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
    records.remove("run-old");
    expect(records.newestCreatedByProvider().get(FIRST!)).toBe(at("2026-09-05T00:00:00.000Z"));
    expect(list).toHaveBeenCalledTimes(2);
    records.remove("run-new");
    expect(records.newestCreatedByProvider().has(FIRST!)).toBe(false);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("a records directory that cannot be listed stays unseeded, and the next ask tries again", () => {
    const records = store();
    records.write(record("run-1", FIRST!, "2026-09-01T00:00:00.000Z"));
    const list = vi.spyOn(records, "list").mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    expect(() => records.newestCreatedByProvider()).toThrow("EACCES");
    expect(records.newestCreatedByProvider().get(FIRST!)).toBe(at("2026-09-01T00:00:00.000Z"));
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("PJ-6 (Q4) — a record carrying the launch's model selection", () => {
  it("reads back and verifies; an OLDER fieldd, whose schema never heard of the field, keeps the key through its passthrough and verifies the same bytes", () => {
    const records = store();
    // the selection as puppeteer took it, plus a key a later fieldd might add
    const modelSelection = { modelId: "model-a", controls: { effort: "high" }, later: { kept: 1 } };
    records.write({
      ...record("run-pj6", FIRST!, "2026-10-12T00:00:00.000Z"),
      modelSelection,
    });
    expect(records.read("run-pj6")?.modelSelection).toEqual(modelSelection);

    const raw = JSON.parse(readFileSync(records.path("run-pj6"), "utf8")) as unknown;
    // the record schema as it stood before PJ-6, which the older reader parses with
    const older = AgentSessionRecord.omit({ modelSelection: true }).parse(raw);
    expect(older).toHaveProperty("modelSelection", modelSelection);
    expect(records.verifies(older as AgentSessionRecord)).toBe(true);
    // the passthrough is what holds it: a reader that STRIPPED the unknown key
    // would canonicalise other bytes and set the record aside as forged
    const stripped = AgentSessionRecord.omit({ modelSelection: true }).strip().parse(raw);
    expect(stripped).not.toHaveProperty("modelSelection");
    expect(records.verifies(stripped as AgentSessionRecord)).toBe(false);
    // and a record written before PJ-6 still reads with this build's schema
    records.write(record("run-old", FIRST!, "2026-10-01T00:00:00.000Z"));
    expect(records.read("run-old")).not.toHaveProperty("modelSelection");
  });
});

describe("CP-1c — a record carrying who started the run and the spark it is", () => {
  it("reads back and verifies, an older fieldd keeps both through its passthrough, and a record that claims a spark it was not written with is set aside", () => {
    const records = store();
    const origin = { by: "spark", spark: "sp-7k2m9q4x" };
    records.write({ ...record("run-started", FIRST!, "2026-10-29T12:00:00.000Z"), origin });
    records.write({
      ...record("run-own", FIRST!, "2026-10-29T12:01:00.000Z"),
      spark: "sp-7k2m9q4x",
    });
    expect(records.read("run-started")?.origin).toEqual(origin);
    expect(records.read("run-own")?.spark).toBe("sp-7k2m9q4x");

    const raw = JSON.parse(readFileSync(records.path("run-own"), "utf8")) as AgentSessionRecord;
    const older = AgentSessionRecord.omit({ origin: true, spark: true }).parse(raw);
    expect(older).toHaveProperty("spark", "sp-7k2m9q4x");
    expect(records.verifies(older as AgentSessionRecord)).toBe(true);
    // the signature covers it: an agent that writes `spark` into a run's record to be served a spark's tools is
    // refused, because the record no longer verifies (the door reads a verified record only)
    const plain = JSON.parse(
      readFileSync(records.path("run-started"), "utf8"),
    ) as AgentSessionRecord;
    expect(records.verifies({ ...plain, spark: "sp-7k2m9q4x" })).toBe(false);
  });
});
