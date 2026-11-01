import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentMonitorMirror,
  AgentSessionRecord,
  type AgentSessionSummary,
} from "@vibefield/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  mirrorShowsTurn,
  SessionRecordStore,
  type SummarizeInput,
  summarizeExitedRecord,
  summarizeManaged,
  summarizePending,
} from "../src/agent-sessions";

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

describe("TU-1 — a record saying whether its run has worked (Q6)", () => {
  const AT = "2026-11-01T08:40:12.000Z";

  it("reads back null and a time, each verified; an older fieldd keeps the key through its passthrough; a record without it verifies as before; a flip the key did not sign is set aside", () => {
    const records = store();
    records.write({ ...record("run-new", FIRST!, "2026-11-01T08:39:50.000Z"), turnedAt: null });
    records.write({ ...record("run-turned", FIRST!, "2026-11-01T08:39:51.000Z"), turnedAt: AT });
    records.write(record("run-older", FIRST!, "2026-10-01T00:00:00.000Z"));
    expect(records.read("run-new")).toHaveProperty("turnedAt", null);
    expect(records.read("run-turned")?.turnedAt).toBe(AT);
    expect(records.read("run-older")).not.toHaveProperty("turnedAt");

    // canonical JSON keeps `null`, so the never-worked record is signed as it reads
    const raw = JSON.parse(readFileSync(records.path("run-new"), "utf8")) as AgentSessionRecord;
    const older = AgentSessionRecord.omit({ turnedAt: true }).parse(raw);
    expect(older).toHaveProperty("turnedAt", null);
    expect(records.verifies(older as AgentSessionRecord)).toBe(true);

    // EL7: the signature covers it — a record that says it worked when fieldd never wrote so is forged
    expect(records.verifies({ ...raw, turnedAt: AT })).toBe(false);
    writeFileSync(records.path("run-new"), JSON.stringify({ ...raw, turnedAt: AT }), {
      mode: 0o600,
    });
    expect(records.read("run-new")).toBeUndefined();
  });

  it("is carried by each summary as the record or the fold holds it: a time, null, or nothing — and the summary golden's keys are what they produce (EL9)", () => {
    const golden = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "contracts",
          "fixtures",
          "agent-session-summary.turned.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const goldenKeys = Object.keys(golden);
    const info = {
      nativeSession: { id: "native-21", basis: "observed" },
      provider: { id: "claude", label: "Claude Code" },
      runtimeRunId: "run-21",
      runtimeEpoch: 2,
      profileId: "claude:work-1c7e",
      profileSetId: "work-7f3a",
      terminalSessionId: "sess-01JB9T4K",
      continuation: { providerId: "claude", nativeSessionId: "native-21" },
      workspace: { mode: "direct", root: "/w", sourcePath: "/w" },
    } as unknown as SummarizeInput["info"];
    const managed = (turnedAt: string | null | undefined): AgentSessionSummary =>
      summarizeManaged({
        info,
        monitor: undefined,
        observationLevel: "native-hooks",
        device: "dev-3c4d",
        terminal: undefined,
        hosted: true,
        record: { persisted: true, resumable: true, reattached: true },
        createdAt: "2026-11-01T08:39:50.000Z",
        stateChangedAt: "2026-11-01T09:02:30.000Z",
        lastActivityAt: "2026-11-01T08:41:05.000Z",
        title: "Vela",
        spawnedBy: "app",
        origin: { by: "you" },
        spark: "sp-7k2m9q4x",
        turnedAt,
      });
    const kept = (turnedAt: string | null | undefined): AgentSessionRecord => ({
      ...record("run-21", "claude", "2026-11-01T08:39:50.000Z"),
      profileId: "claude:work-1c7e",
      profileSet: "work-7f3a",
      terminalSessionId: "sess-01JB9T4K",
      title: "Vela",
      origin: { by: "you" },
      spark: "sp-7k2m9q4x",
      ...(turnedAt !== undefined ? { turnedAt } : {}),
    });
    const pending = (turnedAt: string | null | undefined) =>
      summarizePending({
        record: kept(turnedAt),
        label: "Claude Code",
        device: "dev-3c4d",
        terminal: undefined,
        reason: "the adapter could not attach",
        since: "2026-11-01T09:02:30.000Z",
      });
    const exited = (turnedAt: string | null | undefined) =>
      summarizeExitedRecord({
        record: kept(turnedAt),
        label: "Claude Code",
        device: "dev-3c4d",
        terminalSessionId: "sess-01JB9T4K",
        terminal: undefined,
        since: "2026-11-01T09:02:30.000Z",
      });
    for (const summarize of [managed, pending, exited]) {
      // the golden's state, and the two beside it
      expect(summarize(AT).turnedAt).toBe(AT);
      expect(summarize(null)).toHaveProperty("turnedAt", null);
      expect(summarize(undefined)).not.toHaveProperty("turnedAt");
      expect(Object.keys(summarize(AT)).filter((key) => !goldenKeys.includes(key))).toEqual([]);
    }
    expect(golden["turnedAt"]).toBe(AT);
  });
});

describe("TU-1 (Q2, D2) — what counts as a turn", () => {
  const mirror = (over: Partial<AgentMonitorMirror>): AgentMonitorMirror => ({
    schemaVersion: 1,
    runtimeEpoch: 1,
    revision: 1,
    runtimeRunId: "run-1",
    status: "idle",
    statusSince: "2026-11-01T08:40:00.000Z",
    blockers: [],
    alive: true,
    ...over,
  });
  const span = (kind: string) => ({ kind, line: kind, since: "2026-11-01T08:40:00.000Z" });

  it.each([
    ["at work in a tool", mirror({ status: "working", activity: span("tool") }), true],
    [
      "puppeteer's launch span, which is no work",
      mirror({ status: "working", activity: span("starting") }),
      false,
    ],
    ["at work with no activity named", mirror({ status: "working" }), true],
    [
      "an ask alone: blocked, no tokens, no answer",
      mirror({
        status: "blocked",
        blockers: [{ id: "perm-1", kind: "permission", since: "2026-11-01T08:40:00.000Z" }],
      }),
      false,
    ],
    ["idle with a token spent", mirror({ usage: { cumulativeTokens: 1 } }), true],
    ["idle with no token spent", mirror({ usage: { cumulativeTokens: 0 } }), false],
    ["idle with an answer written", mirror({ lastAssistantMessage: { text: "done" } }), true],
    ["a status this contract does not know", mirror({ status: "paused" }), false],
    ["idle and nothing else", mirror({}), false],
  ])("%s", (_name, state, turned) => {
    expect(mirrorShowsTurn(state)).toBe(turned);
  });

  it("is no turn with no mirror", () => {
    expect(mirrorShowsTurn(undefined)).toBe(false);
  });
});

describe("AR-4b — the signing key (EL7)", () => {
  it("sets aside a key other users could read and makes another in the same call, so what it signed reads as untrusted", () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-records-"));
    dirs.push(dir);
    const opts = {
      dir: join(dir, "sessions"),
      keyPath: join(dir, "sessions.key"),
      now: () => new Date("2026-10-31T12:00:00.000Z"),
    };
    new SessionRecordStore(opts).write(record("run-1", FIRST!, "2026-10-31T11:00:00.000Z"));
    const exposedKey = readFileSync(opts.keyPath, "utf8");
    chmodSync(opts.keyPath, 0o644);
    const after = new SessionRecordStore(opts);
    // the first call that needs the key finds it exposed: it is set aside and replaced there, never a throw
    expect(after.read("run-1")).toBeUndefined();
    expect(readFileSync(opts.keyPath, "utf8")).not.toBe(exposedKey);
    expect(statSync(opts.keyPath).mode & 0o777).toBe(0o600);
    expect(
      readdirSync(dir).filter((name) => name.startsWith("sessions.key.exposed-")),
    ).toHaveLength(1);
    after.write(record("run-2", FIRST!, "2026-10-31T12:00:00.000Z"));
    expect(new SessionRecordStore(opts).read("run-2")?.runtimeRunId).toBe("run-2");
  });
});
