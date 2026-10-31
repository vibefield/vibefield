/**
 * SP-1b — Chat's reading of a spark (`chat/spark-status.ts`; DESIGN.md §8 "Chat's list", the status as SP-1b reads
 * it; CH-D1, CH-D3, CH-D4). Pure: the sparks fieldd keeps and the field board's rows in, the words out — each status
 * the board can certify, the first that holds, and never one it cannot.
 */
import type { AgentFieldRow, SparkSummary } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  activityWords,
  agentRunsOf,
  ownRunOf,
  sparkEntriesOf,
  sparkStatusOf,
} from "../src/chat/spark-status";

const AT = "2026-10-31T05:00:00.000Z";

function spark(over: Partial<SparkSummary> = {}): SparkSummary {
  return {
    id: "sp-vela0001",
    name: "Vela",
    face: { seed: 7 },
    agent: "claude",
    profiles: ["this-mac"],
    thinksUnder: "this-mac",
    folder: "/f/vela",
    createdAt: AT,
    updatedAt: AT,
    session: { runtimeRunId: "run-vela", live: true },
    ...over,
  };
}

function row(over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  return {
    runtimeRunId: "run-vela",
    revision: 1,
    kind: "claude",
    label: "Claude Code",
    tier: "managed",
    device: "dev-1",
    status: "idle",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    spark: "sp-vela0001",
    ...over,
  };
}

/** An agent the spark started: not its own session, so no `spark` — its `origin` names it. */
function agent(over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  const { spark: _own, ...base } = row({ runtimeRunId: "run-a" });
  return { ...base, origin: { by: "spark", spark: "sp-vela0001" }, ...over };
}

const blocker = (kind: string) => ({ id: `b-${kind}`, kind, since: AT });

describe("the status, the first that holds (DESIGN.md §8)", () => {
  it("is Hello before its first session, and Asleep while its session is not running", () => {
    const { session: _none, ...hatched } = spark();
    expect(sparkStatusOf(hatched, null, [])).toBe("hello");
    expect(
      sparkStatusOf(spark({ session: { runtimeRunId: "run-9", live: false } }), null, []),
    ).toBe("sleeping");
    // the board outranks a stale record: a row that says its run ended is Asleep
    expect(sparkStatusOf(spark(), row({ alive: false }), [])).toBe("sleeping");
  });

  it("reads its own row's blocker: a permission Needs your OK, a question Asking you, anything else Stuck", () => {
    expect(
      sparkStatusOf(spark(), row({ status: "blocked", blockers: [blocker("permission")] }), []),
    ).toBe("approval");
    expect(
      sparkStatusOf(spark(), row({ status: "blocked", blockers: [blocker("question")] }), []),
    ).toBe("asking");
    expect(
      sparkStatusOf(spark(), row({ status: "blocked", blockers: [blocker("failure")] }), []),
    ).toBe("stuck");
    // a kind this build never heard of, or blocked with no blocker named: Stuck, never a guessed ask
    expect(
      sparkStatusOf(spark(), row({ status: "blocked", blockers: [blocker("quota")] }), []),
    ).toBe("stuck");
    expect(sparkStatusOf(spark(), row({ status: "blocked" }), [])).toBe("stuck");
  });

  it("is Running while an agent it started is at work (CH-D3), and its need still outranks that", () => {
    const working = agent({ status: "working" });
    expect(sparkStatusOf(spark(), row(), [working])).toBe("running");
    expect(sparkStatusOf(spark(), row(), [{ ...working, alive: false }])).toBe("ready");
    expect(
      sparkStatusOf(spark(), row({ status: "blocked", blockers: [blocker("question")] }), [
        working,
      ]),
    ).toBe("asking");
  });

  it("is Thinking while its own run works, Ready while it idles, and Hello before its run is heard from", () => {
    expect(sparkStatusOf(spark(), row({ status: "working" }), [])).toBe("thinking");
    expect(sparkStatusOf(spark(), row(), [])).toBe("ready");
    expect(sparkStatusOf(spark(), row({ status: "unknown" }), [])).toBe("hello");
    expect(sparkStatusOf(spark(), null, [])).toBe("hello");
  });
});

describe("whose runs are a spark's (`spark`, `origin`)", () => {
  it("finds its own session by the row's spark, the one its record names first", () => {
    const old = row({
      runtimeRunId: "run-old",
      alive: false,
      createdAt: "2026-10-30T00:00:00.000Z",
    });
    const named = row();
    expect(ownRunOf(spark(), [old, named])?.runtimeRunId).toBe("run-vela");
    // no run named: a live one, else the newest
    const record = spark({ session: { runtimeRunId: "run-gone", live: true } });
    expect(ownRunOf(record, [old, row({ runtimeRunId: "run-new" })])?.runtimeRunId).toBe("run-new");
    expect(ownRunOf(record, [old])?.runtimeRunId).toBe("run-old");
    expect(ownRunOf(record, [row({ spark: "sp-lyra0001" })])).toBeNull();
  });

  it("finds the agents it started by their origin, and no one else's", () => {
    const mine = agent();
    const theirs = agent({ runtimeRunId: "run-b", origin: { by: "spark", spark: "sp-lyra0001" } });
    const yours = agent({ runtimeRunId: "run-c", origin: { by: "you" } });
    expect(agentRunsOf("sp-vela0001", [mine, theirs, yours]).map((r) => r.runtimeRunId)).toEqual([
      "run-a",
    ]);
  });

  it("reads a row from before SP-1b — no spark, no origin — as no spark's: the tolerant reader", () => {
    const { spark: _spark, ...before } = row();
    expect(ownRunOf(spark(), [before])).toBeNull();
    expect(agentRunsOf("sp-vela0001", [before])).toEqual([]);
    // the spark still has its words, from its record
    expect(sparkEntriesOf([spark()], [before])[0]?.status).toBe("hello");
  });
});

describe("the list (CH-D1)", () => {
  it("is newest activity first — its own run's, its agents', or its record's — a tie by name", () => {
    const vela = spark();
    const lyra = spark({
      id: "sp-lyra0001",
      name: "Lyra",
      session: { runtimeRunId: "run-lyra", live: true },
    });
    const juno = spark({ id: "sp-juno0001", name: "Juno", updatedAt: "2026-10-31T04:00:00.000Z" });
    const rows = [
      row({ lastActivityAt: "2026-10-31T05:10:00.000Z" }),
      row({
        runtimeRunId: "run-lyra",
        spark: "sp-lyra0001",
        lastActivityAt: "2026-10-31T05:01:00.000Z",
      }),
      // Lyra's agent worked last, so Lyra is newest
      agent({
        runtimeRunId: "run-l1",
        origin: { by: "spark", spark: "sp-lyra0001" },
        status: "working",
        lastActivityAt: "2026-10-31T05:20:00.000Z",
      }),
    ];
    const entries = sparkEntriesOf([juno, vela, lyra], rows);
    expect(entries.map((entry) => `${entry.spark.name} ${entry.status}`)).toEqual([
      "Lyra running",
      "Vela ready",
      "Juno hello",
    ]);
    expect(entries.map((entry) => entry.needsYou)).toEqual([false, false, false]);
  });

  it("marks the needs-you three (S-4) — Asking you, Needs your OK, Stuck — and only them", () => {
    const entries = sparkEntriesOf(
      [spark()],
      [row({ status: "blocked", blockers: [blocker("permission")] })],
    );
    expect(entries[0]?.needsYou).toBe(true);
    expect(sparkEntriesOf([spark()], [row({ status: "working" })])[0]?.needsYou).toBe(false);
  });
});

describe("a row's time (DESIGN.md §8: now, 9:41 AM, Tue, a date)", () => {
  const now = new Date(2026, 9, 31, 9, 41).getTime();
  it("says now, a time today by the window's clock, a weekday this week, else the date", () => {
    expect(activityWords(now - 20_000, now, "en-US")).toBe("now");
    // ICU puts a narrow no-break space before the day period
    expect(activityWords(new Date(2026, 9, 31, 8, 5).getTime(), now, "en-US")).toMatch(
      /^8:05\sAM$/u,
    );
    expect(activityWords(new Date(2026, 9, 28, 17, 0).getTime(), now, "en-US")).toBe("Wed");
    expect(activityWords(new Date(2026, 9, 12, 12, 0).getTime(), now, "en-US")).toBe("Oct 12");
  });
});
