import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_CATALOG, type AgentSessionRecord } from "@vibefield/contracts";
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
