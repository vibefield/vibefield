/**
 * SP-1b, CP-3 — Chat's reading of a spark (`chat/spark-status.ts`; DESIGN.md §8 "Chat's list", the status as SP-1b
 * reads it, as amended at CP-3; CH-D1, CH-D3, CH-D4, CP3-D7, CP3-D8). Pure: the sparks fieldd keeps, the field board's
 * rows and the needs-you queue's items in, the words and the facts out — each status the board or the queue can
 * certify, the first that holds, and never one they cannot.
 */
import type { AgentFieldRow, NeedsItem, SparkSummary } from "@vibefield/contracts";
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

/** One of the needs-you queue's open items for Vela, as needs.subscribe says it (fieldd's own words). */
function item(over: Partial<NeedsItem> & Pick<NeedsItem, "id" | "kind">): NeedsItem {
  return {
    state: "open",
    from: { name: "Vela", session: "run-vela", spark: "sp-vela0001" },
    spark: "sp-vela0001",
    asked: AT,
    ...over,
  };
}

const QUESTION = item({
  id: "ny-question01",
  kind: "question",
  words: "Push the fix?",
  choices: ["Push", "Not now"],
});
const HELD_SEND = item({
  id: "ny-heldsend01",
  kind: "held-send",
  words: "run the tests",
  choices: ["Allow", "Not now"],
  to: { session: "run-his", name: "claude·2" },
});
const HELD_SPAWN = item({
  id: "ny-heldspawn1",
  kind: "held-spawn",
  choices: ["Allow one more", "Not now"],
  live: 8,
});
/** An agent Vela started asks, in its own pane: listed with where to answer it. */
const agentAsk = (ask: string, session = "run-a"): NeedsItem =>
  item({
    id: `ny-ask${ask.slice(0, 6)}${session.slice(-1)}`,
    kind: "agent-ask",
    ask,
    from: { name: "claude·2", session },
  });
const ASLEEP = spark({ session: { runtimeRunId: "run-vela", live: false } });

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

describe("the needs-you queue's items (CP-3; DESIGN.md §8 \"Chat's list\", the status as amended)", () => {
  it("says a spark with an open question is Asking you, even asleep (CP3-D7: an answer wakes it)", () => {
    expect(sparkStatusOf(ASLEEP, null, [], [QUESTION])).toBe("asking");
    expect(sparkStatusOf(spark(), row({ alive: false }), [], [QUESTION])).toBe("asking");
    // nor is a spark with something waiting on you Hello
    const { session: _none, ...hatched } = spark();
    expect(sparkStatusOf(hatched, null, [], [QUESTION])).toBe("asking");
    // awake and idle, the item outranks Ready, and an agent it started at work
    expect(sparkStatusOf(spark(), row(), [agent({ status: "working" })], [QUESTION])).toBe(
      "asking",
    );
    const [entry] = sparkEntriesOf([ASLEEP], [], { items: [QUESTION] });
    expect(entry?.needsYou).toBe(true);
    expect(entry?.items).toEqual([QUESTION]);
  });

  it("says a held send, a held spawn or an agent's permission is Needs your OK, and an agent's question Asking you", () => {
    expect(sparkStatusOf(spark(), row(), [], [HELD_SEND])).toBe("approval");
    expect(sparkStatusOf(spark(), row(), [], [HELD_SPAWN])).toBe("approval");
    expect(sparkStatusOf(spark(), row(), [], [agentAsk("permission")])).toBe("approval");
    expect(sparkStatusOf(spark(), row(), [], [agentAsk("question")])).toBe("asking");
    // the oldest first: fieldd lists them oldest asked first
    expect(sparkStatusOf(spark(), row(), [], [HELD_SEND, QUESTION])).toBe("approval");
  });

  it("still says its own run's blocker first, while its session runs", () => {
    const asks = row({ status: "blocked", blockers: [blocker("permission")] });
    expect(sparkStatusOf(spark(), asks, [], [QUESTION])).toBe("approval");
    // a run that has stopped waits on no one: the item's word
    expect(sparkStatusOf(spark(), { ...asks, alive: false }, [], [HELD_SEND])).toBe("approval");
    expect(sparkStatusOf(spark(), { ...asks, alive: false }, [], [QUESTION])).toBe("asking");
  });

  it("says an item of a kind it never heard of still needs you, in the safe word", () => {
    const gate = item({ id: "ny-gate000001", kind: "gate", state: "waiting", choices: ["Push"] });
    expect(sparkStatusOf(spark(), row(), [], [gate])).toBe("approval");
    expect(sparkEntriesOf([spark()], [row()], { items: [gate] })[0]?.needsYou).toBe(true);
  });

  it("reads the asks of its own run once, as its row's blocker; an agent it started asking is its item", () => {
    const own = agentAsk("question", "run-vela");
    const theirs = agentAsk("permission");
    const asks = row({ status: "blocked", blockers: [{ id: "q-1", kind: "question", since: AT }] });
    const [entry] = sparkEntriesOf([spark()], [asks], { items: [own, theirs] });
    expect(entry?.items).toEqual([theirs]);
    expect(entry?.status).toBe("asking");
    // before the board is read, the record names its own run: its ask is still not an item
    const [unread] = sparkEntriesOf([spark()], [], { items: [own] });
    expect(unread?.items).toEqual([]);
    expect(unread?.needsYou).toBe(false);
    // a question the spark itself asked (ask_user) is from its own run too, and is its item
    expect(sparkEntriesOf([spark()], [row()], { items: [QUESTION] })[0]?.items).toEqual([QUESTION]);
  });

  it("takes only its own: an item for another spark, or for no spark (a person's own run asking), is not its", () => {
    const lyras = item({ id: "ny-lyra000001", kind: "question", spark: "sp-lyra0001" });
    const { spark: _none, ...nobodys } = agentAsk("permission", "run-his");
    const [entry] = sparkEntriesOf([spark()], [row()], { items: [lyras, nobodys] });
    expect(entry?.items).toEqual([]);
    expect(entry?.status).toBe("ready");
  });

  it("keys each need once for the views track's note: its own run's blockers while it runs, then its items", () => {
    const asks = row({ status: "blocked", blockers: [{ id: "q-1", kind: "question", since: AT }] });
    const keys = (rows: AgentFieldRow[], items: NeedsItem[] = []) =>
      sparkEntriesOf([spark()], rows, { items })[0]?.needs;
    expect(keys([row()])).toEqual([]);
    expect(keys([asks], [QUESTION, HELD_SEND])).toEqual([
      "run-vela:q-1",
      "ny-question01",
      "ny-heldsend01",
    ]);
    // blocked with no blocker named is one need of its run
    expect(keys([row({ status: "blocked" })])).toEqual(["run-vela:blocked"]);
    // a run that has stopped waits on no one
    expect(keys([{ ...asks, alive: false }], [QUESTION])).toEqual(["ny-question01"]);
  });
});

describe("what a spark's session is doing, read from the session, never from its word (CP-3; critique 7)", () => {
  it("reads awake from its session: its own run alive on the board, else its record", () => {
    const awake = (record: SparkSummary, rows: AgentFieldRow[], items: NeedsItem[] = []) =>
      sparkEntriesOf([record], rows, { items })[0]?.awake;
    expect(awake(spark(), [row()])).toBe(true);
    expect(awake(spark(), [])).toBe(true);
    expect(awake(spark(), [row({ alive: false })])).toBe(false);
    expect(awake(ASLEEP, [])).toBe(false);
    // an item's word stands over Asleep; the spark still sleeps
    const [entry] = sparkEntriesOf([ASLEEP], [], { items: [QUESTION] });
    expect(entry?.status).toBe("asking");
    expect(entry?.awake).toBe(false);
  });

  it("says it waits on you in its pane (what stops Send) only for its own run's blocker while it runs — never for an item", () => {
    const blocked = (rows: AgentFieldRow[], items: NeedsItem[] = []) =>
      sparkEntriesOf([spark()], rows, { items })[0]?.blocked;
    expect(blocked([row({ status: "blocked", blockers: [blocker("permission")] })])).toBe(true);
    expect(blocked([row({ status: "blocked" })])).toBe(true);
    expect(
      blocked([row({ alive: false, status: "blocked", blockers: [blocker("question")] })]),
    ).toBe(false);
    const [card] = sparkEntriesOf([spark()], [row()], { items: [QUESTION] });
    expect(card?.needsYou).toBe(true);
    expect(card?.blocked).toBe(false);
  });

  it("hears a spark only from its own run's row: on the board, alive, watched, saying how it stands", () => {
    const heard = (record: SparkSummary, rows: AgentFieldRow[], items: NeedsItem[] = []) =>
      sparkEntriesOf([record], rows, { items })[0]?.heard;
    expect(heard(spark(), [row()])).toBe(true);
    expect(heard(spark(), [row({ status: "working" })])).toBe(true);
    expect(heard(spark(), [row({ status: "blocked", blockers: [blocker("question")] })])).toBe(
      true,
    );
    // not heard from yet: Hello's last rule
    expect(heard(spark(), [row({ status: "unknown" })])).toBe(false);
    expect(heard(spark(), [])).toBe(false);
    // a run fieldd is waiting to resume says nothing yet
    expect(heard(spark(), [row({ status: "unknown", pending: "resume-when-idle" })])).toBe(false);
    expect(heard(spark(), [row({ pending: "resume-when-idle" })])).toBe(false);
    // an agent it started at work is not its own run heard (Running is not heard)
    expect(heard(spark(), [row({ status: "unknown" }), agent({ status: "working" })])).toBe(false);
  });

  it("does not hear a sleeping spark with an item until its run is: its word is Asking you before the wake and after it", () => {
    const record = { ...ASLEEP };
    expect(sparkEntriesOf([record], [row({ alive: false })], { items: [QUESTION] })[0]?.heard).toBe(
      false,
    );
    // woken: fieldd names the new run, which the board has not shown yet
    const woken = spark({ session: { runtimeRunId: "run-vela2", live: true } });
    const [waking] = sparkEntriesOf([woken], [row({ alive: false })], { items: [QUESTION] });
    expect(waking?.status).toBe("asking");
    expect(waking?.heard).toBe(false);
    const [up] = sparkEntriesOf(
      [woken],
      [row({ alive: false }), row({ runtimeRunId: "run-vela2" })],
      {
        items: [QUESTION],
      },
    );
    expect(up?.status).toBe("asking");
    expect(up?.heard).toBe(true);
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

  it("says a turn was seen while the spark is at work or waits on you, its run spent tokens, or the window saw one", () => {
    const seen = (rows: AgentFieldRow[], turnsSeen?: ReadonlySet<string>) =>
      sparkEntriesOf([spark()], rows, { turnsSeen })[0]?.turnSeen;
    expect(seen([row()])).toBe(false);
    expect(seen([row({ usage: { cumulativeTokens: 0 } })])).toBe(false);
    expect(seen([row({ status: "working" })])).toBe(true);
    expect(seen([row(), agent({ status: "working" })])).toBe(true);
    expect(seen([row({ status: "blocked", blockers: [blocker("question")] })])).toBe(true);
    expect(seen([row({ usage: { cumulativeTokens: 18_400 } })])).toBe(true);
    // the same idle run with nothing counted (fieldd re-attached it), after the window saw a turn
    expect(seen([row()], new Set(["sp-vela0001"]))).toBe(true);
    expect(seen([row()], new Set(["sp-lyra0001"]))).toBe(false);
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
