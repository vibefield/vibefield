/**
 * SP-1d — THE THREAD'S ITEMS, as data (DESIGN.md §8 "Chat's thread": the thread's items, the hello and three
 * starters; NS-D4 A; CH-D5 A "Starters show while a thread is quiet"; critique finding 17, LEANS "a NEW spark"). What
 * stands in a thread over its pane is read here, purely: a new spark's hello and its starters while the thread is
 * quiet, and nothing else at SP-1d; since CP-3 the needs-you card in its place (`needs-card.test.tsx`). The drawing and
 * the controller are `chat-thread-items.test.tsx`'s.
 */

import {
  AGENT_CATALOG,
  type AgentFieldRow,
  NeedsItem,
  type SparkSummary,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { sparkEntriesOf } from "../src/chat/spark-status";
import {
  HATCH_RUN_MS,
  helloWords,
  STARTERS,
  sparkIsNew,
  type ThreadItem,
  threadItemsOf,
  threadQuiet,
} from "../src/chat/thread-items";

const AT = "2026-10-31T05:00:00.000Z";
const AGENT = AGENT_CATALOG[0];

function spark(over: Partial<SparkSummary> = {}): SparkSummary {
  return {
    id: "sp-vela0001",
    name: "Vela",
    face: { seed: 7 },
    agent: AGENT.id,
    profiles: ["native"],
    thinksUnder: "native",
    folder: "/f/vela",
    createdAt: AT,
    updatedAt: AT,
    session: { runtimeRunId: "run-Vela", terminalSessionId: "pty-Vela", live: true },
    ...over,
  };
}

function row(over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  return {
    runtimeRunId: "run-Vela",
    revision: 1,
    kind: AGENT.id,
    label: AGENT.label,
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

/** Vela as Chat reads her, over her own run's row (or none), with the sparks the window has seen have a turn. */
function entryOf(
  record: SparkSummary = spark(),
  own: AgentFieldRow | null = row(),
  turnsSeen: ReadonlySet<string> = new Set(),
) {
  const entry = sparkEntriesOf([record], own === null ? [] : [own], { turnsSeen })[0];
  if (entry === undefined) throw new Error("no entry");
  return entry;
}

const { session: _none, ...NEVER_STARTED } = spark();

describe("a new spark: its session has had no turn yet (NS-D4; critique 17)", () => {
  it("is new while its own run has not worked and has spent no tokens", () => {
    expect(entryOf().status).toBe("ready");
    expect(sparkIsNew(entryOf())).toBe(true);
    expect(sparkIsNew(entryOf(spark(), row({ usage: { cumulativeTokens: 0 } })))).toBe(true);
    // just hatched, its run not heard from yet: Hello
    expect(sparkIsNew(entryOf(spark(), row({ status: "unknown" })))).toBe(true);
    // asleep before its first turn: still new, so a message to it is its first
    const asleep = entryOf(spark(), row({ alive: false }));
    expect(asleep.status).toBe("sleeping");
    expect(sparkIsNew(asleep)).toBe(true);
  });

  it("is new when it has never started at all", () => {
    expect(sparkIsNew(entryOf(NEVER_STARTED, null))).toBe(true);
  });

  it("is never new once it has had a turn: tokens spent, at work, or waiting on you", () => {
    // an idle spark with a transcript shows its pane alone
    expect(sparkIsNew(entryOf(spark(), row({ usage: { cumulativeTokens: 18_400 } })))).toBe(false);
    expect(sparkIsNew(entryOf(spark(), row({ status: "working" })))).toBe(false);
    const asks = entryOf(
      spark(),
      row({ status: "blocked", blockers: [{ id: "q-1", kind: "question", since: AT }] }),
    );
    expect(asks.status).toBe("asking");
    expect(sparkIsNew(asks)).toBe(false);
  });

  it("is never new in a run it did not hatch in: a woken spark's run reads its transcript back and counts nothing", () => {
    // Wake resumes into a new run, which the record then names; puppeteer counts no usage read back from the
    // transcript, so the resumed run is idle with nothing spent until its next live turn
    const woken = spark({
      updatedAt: "2026-11-01T09:00:00.000Z",
      session: { runtimeRunId: "run-Vela2", terminalSessionId: "pty-Vela2", live: true },
    });
    const resumed = row({ runtimeRunId: "run-Vela2", createdAt: "2026-11-01T09:00:00.000Z" });
    const entry = entryOf(woken, resumed);
    expect(entry.run?.runtimeRunId).toBe("run-Vela2");
    expect(entry.status).toBe("ready");
    expect(entry.run?.usage).toBeUndefined();
    expect(sparkIsNew(entry)).toBe(false);
    // the run a hatch starts is born within HATCH_RUN_MS of the record, and only that one is its first
    const born = (ms: number) => row({ createdAt: new Date(Date.parse(AT) + ms).toISOString() });
    expect(sparkIsNew(entryOf(spark(), born(HATCH_RUN_MS)))).toBe(true);
    expect(sparkIsNew(entryOf(spark(), born(HATCH_RUN_MS + 1)))).toBe(false);
    expect(sparkIsNew(entryOf(spark(), born(-1)))).toBe(false);
  });

  it("is never new while fieldd waits to resume its run: nothing watches it", () => {
    expect(sparkIsNew(entryOf(spark(), row({ pending: "resume-when-idle" })))).toBe(false);
  });

  it("is never new once the window has seen it have a turn, though the board's count is gone", () => {
    // the same run, its count gone from the board (a transcript read back), and a turn the window's set still holds
    const uncounted = entryOf(spark(), row(), new Set(["sp-vela0001"]));
    expect(uncounted.run?.usage).toBeUndefined();
    expect(uncounted.turnSeen).toBe(true);
    expect(sparkIsNew(uncounted)).toBe(false);
  });

  it("is not said to be new when the board shows none of its runs: nothing certifies it", () => {
    // awake by its record, its run not on the board yet (just after a wake): a spark that has had a turn never says
    // hello, so nothing says it is new
    expect(sparkIsNew(entryOf(spark(), null))).toBe(false);
    expect(
      sparkIsNew(entryOf(spark({ session: { runtimeRunId: "run-Vela", live: false } }), null)),
    ).toBe(false);
  });
});

describe('quiet, and the items it brings (DESIGN.md §8 "Chat\'s thread", when they show)', () => {
  it("is quiet only while the spark is new, its draft is empty and its hello has not left", () => {
    expect(threadQuiet(entryOf(), true, false)).toBe(true);
    expect(threadQuiet(entryOf(), false, false)).toBe(false);
    expect(threadQuiet(entryOf(), true, true)).toBe(false);
    expect(threadQuiet(entryOf(spark(), row({ status: "working" })), true, false)).toBe(false);
  });

  it("is not quiet while something in the queue waits on you in its thread (CP-3: quiet's fifth)", () => {
    // held apart from "new": an item is a turn the window sees, so a spark asking is not new either
    const item = NeedsItem.parse({
      id: "ny-quietfifth01",
      kind: "question",
      state: "open",
      from: { name: "Vela", session: "run-Vela", spark: "sp-vela0001" },
      spark: "sp-vela0001",
      asked: AT,
      words: "Push it?",
      choices: ["Push", "Not now"],
    });
    const waiting = { ...entryOf(), items: [item] };
    expect(sparkIsNew(waiting)).toBe(true);
    expect(threadQuiet(waiting, true, false)).toBe(false);
  });

  it("brings the hello and its three starters while quiet, with the spark's own face as its lead", () => {
    const entry = entryOf();
    const items = threadItemsOf(entry, true, null);
    expect(items).toEqual([
      {
        kind: "hello",
        face: { seed: 7, status: "ready" },
        words: helloWords("Vela"),
        starters: STARTERS,
      },
    ] satisfies ThreadItem[]);
    expect(threadItemsOf(entry, false, null)).toEqual([]);
  });

  it("says the hello and the starters in the page's words, as ruled", () => {
    expect(helloWords("Vela")).toBe(
      "Hi, I'm Vela. I can start agents for you, keep track of the ones you run, and carry work between them. What first?",
    );
    expect(STARTERS.map((starter) => [starter.glyph, starter.words])).toEqual([
      ["agents", "Spawn 4 Grok agents to research a topic each"],
      ["panes", "Keep track of my agents in vibe-field"],
      ["duplicate", "Have Codex review claude·2's work until it's clean"],
    ]);
  });

  it("are words the spark reads, never an agent's id (R23b compares a string literal to the ids exactly)", () => {
    const ids = new Set<string>(AGENT_CATALOG.map((entry) => entry.id));
    for (const starter of STARTERS) expect(ids.has(starter.words), starter.words).toBe(false);
  });
});
