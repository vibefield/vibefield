/**
 * SP-1d — THE THREAD'S ITEMS, as data (DESIGN.md §8 "Chat's thread": the thread's items, the hello and three
 * starters; NS-D4 A; critique finding 17, LEANS "a NEW spark"): whether a spark is new, the hello's words and its
 * starters, and what stands in the thread's foot (the needs-you card, `needs-card.test.tsx`). The hello is the flow's
 * first row (`transcript-items.test.ts`); the drawing and the controller are `chat-thread-items.test.tsx`'s.
 * *TH-1, the pane leaves Chat:* quiet (`threadQuiet`) and the hello over the pane (`threadItemsOf`) were read here;
 * they retired with the pane.
 */

import { AGENT_CATALOG, type AgentFieldRow, type SparkSummary } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { sparkEntriesOf } from "../src/chat/spark-status";
import { helloWords, STARTERS, sparkIsNew } from "../src/chat/thread-items";
import { transcriptItemsOf } from "../src/chat/transcript-items";
import { transcriptReadingOf } from "../src/chat/transcript-port";

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
    // just hatched: fieldd has not seen it work
    turnedAt: null,
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

/** Vela as Chat reads her, over her own run's row (or none). */
function entryOf(record: SparkSummary = spark(), own: AgentFieldRow | null = row()) {
  const entry = sparkEntriesOf([record], own === null ? [] : [own])[0];
  if (entry === undefined) throw new Error("no entry");
  return entry;
}

const { session: _none, ...NEVER_STARTED } = spark();

/** When fieldd first saw Vela work, as her record and her run's row say it (TU-1). */
const TURNED = "2026-10-31T05:00:40.000Z";
const hoursLater = (hours: number) => new Date(Date.parse(AT) + hours * 3_600_000).toISOString();

describe("a new spark: it has never worked (NS-D4; TU-1, Q1)", () => {
  it("is new while fieldd says it has never worked: its record null, its own run's row no turn", () => {
    expect(entryOf().status).toBe("ready");
    expect(sparkIsNew(entryOf())).toBe(true);
    expect(sparkIsNew(entryOf(spark(), row({ turnedAt: null })))).toBe(true);
    // just hatched, its run not heard from yet: Hello
    expect(sparkIsNew(entryOf(spark(), row({ status: "unknown" })))).toBe(true);
    // asleep before it ever worked, its run on the board: still new, so a message to it is its first
    const asleep = entryOf(spark(), row({ alive: false }));
    expect(asleep.status).toBe("sleeping");
    expect(sparkIsNew(asleep)).toBe(true);
  });

  it("is new when it has never started at all, whatever its record says", () => {
    expect(sparkIsNew(entryOf(NEVER_STARTED, null))).toBe(true);
    const { turnedAt: _absent, ...older } = NEVER_STARTED;
    expect(sparkIsNew(entryOf(older, null))).toBe(true);
  });

  it("W1: is not new in a window opened after a re-attach: its record and its run say it has worked, though nothing is counted", () => {
    // the hatch run, re-attached after a restart: born at the spark's minute, its tokens gone (a re-attach counts
    // nothing), the window new — fieldd's record keeps the turn
    const entry = entryOf(spark({ turnedAt: TURNED }), row({ turnedAt: TURNED }));
    expect(entry.run?.createdAt).toBe(AT);
    expect(entry.run?.usage).toBeUndefined();
    expect(sparkIsNew(entry)).toBe(false);
  });

  it("W2: is not new in a run born in the hatch run's place within the minute, once the spark has worked", () => {
    const fresh = row({
      runtimeRunId: "run-Vela2",
      createdAt: "2026-10-31T05:00:30.000Z",
      turnedAt: null,
    });
    const record = spark({
      turnedAt: TURNED,
      session: { runtimeRunId: "run-Vela2", terminalSessionId: "pty-Vela2", live: true },
    });
    expect(sparkIsNew(entryOf(record, fresh))).toBe(false);
  });

  it("W3: is new when woken hours later, if it was asleep before it ever worked", () => {
    const woken = spark({
      updatedAt: hoursLater(3),
      session: { runtimeRunId: "run-Vela2", terminalSessionId: "pty-Vela2", live: true },
    });
    const resumed = row({ runtimeRunId: "run-Vela2", createdAt: hoursLater(3), turnedAt: null });
    expect(sparkIsNew(entryOf(woken, resumed))).toBe(true);
    // woken after it had worked, its resumed run carrying the conversation's time: no hello
    const worked = { ...woken, turnedAt: TURNED };
    expect(sparkIsNew(entryOf(worked, { ...resumed, turnedAt: TURNED }))).toBe(false);
  });

  it("is never new once its own run's row says a first turn, before the list is read again", () => {
    expect(sparkIsNew(entryOf(spark(), row({ turnedAt: TURNED })))).toBe(false);
  });

  it("W4: a spark from before fieldd kept the fact (its record says neither) is never said to be new", () => {
    const { turnedAt: _absent, ...older } = spark();
    expect(sparkIsNew(entryOf(older))).toBe(false);
    expect(sparkIsNew(entryOf(older, null))).toBe(false);
  });

  it("W5: is still new while its own agent asks before it has worked: an ask is no turn (Q2), and the hello stands", () => {
    const asks = entryOf(
      spark(),
      row({ status: "blocked", blockers: [{ id: "q-1", kind: "question", since: AT }] }),
    );
    expect(asks.status).toBe("asking");
    expect(asks.blocked).toBe(true);
    expect(sparkIsNew(asks)).toBe(true);
    // James's Q2 A, as TH-1 draws it: the hello stands first in the flow, the ask's card at the foot (CO-Q2 (b))
    const flow = transcriptItemsOf({
      entry: asks,
      reading: transcriptReadingOf([], new Map()),
      now: Date.parse(AT),
    });
    expect(flow.state === "ready" ? flow.items[0]?.kind : null).toBe("hello");
  });

  it("W6: is never new while fieldd waits to resume its run, whatever its record says: nothing watches it (D10)", () => {
    expect(sparkIsNew(entryOf(spark(), row({ pending: "resume-when-idle" })))).toBe(false);
    expect(
      sparkIsNew(entryOf(spark({ turnedAt: TURNED }), row({ pending: "resume-when-idle" }))),
    ).toBe(false);
  });

  it("W7: is new asleep before it ever worked, though the board shows none of its runs", () => {
    const asleep = spark({ session: { runtimeRunId: "run-Vela", live: false } });
    expect(sparkIsNew(entryOf(asleep, null))).toBe(true);
    // one that has worked, or one whose record says neither, is not
    expect(sparkIsNew(entryOf({ ...asleep, turnedAt: TURNED }, null))).toBe(false);
    const { turnedAt: _absent, ...older } = asleep;
    expect(sparkIsNew(entryOf(older, null))).toBe(false);
  });

  it("W8: is not new while awake with its run not on the board yet: nothing says fieldd watches its run (D10)", () => {
    // its record says awake and never worked, but the board does not show its run: just after a hatch, before the
    // board's first snapshot, or a run fieldd waits to resume while the board is refused — the run may be one fieldd
    // does not drive, so the hello does not stand
    const awake = entryOf(spark(), null);
    expect(awake.awake).toBe(true);
    expect(sparkIsNew(awake)).toBe(false);
    const flow = transcriptItemsOf({
      entry: awake,
      reading: transcriptReadingOf([], new Map()),
      now: Date.parse(AT),
    });
    expect(flow.state === "ready" ? flow.items.map((item) => item.kind) : null).not.toContain(
      "hello",
    );
    // the board shows its run: new again
    expect(sparkIsNew(entryOf(spark(), row()))).toBe(true);
  });

  // G4's window half (Q4, a named guard; plans/tu1-plan.md §3.6): it asserts the gap, so it passes by design, and its
  // TU1_G4 line is its reading. fieldd's half (fieldd/test/agent-session.test.ts) reads the spark, the record and the
  // row null after a re-attach; a turn the person took while fieldd was down, ended before it attached, is unseen.
  it("G4's window half: a spark whose facts read null after a re-attach is new, and its hello stands (the named gap)", () => {
    const reattached = entryOf(spark(), row({ turnedAt: null, lastActivityAt: hoursLater(1) }));
    // the flow's hello (TH-1): the record holds none of your words or the spark's yet
    const flow = transcriptItemsOf({
      entry: reattached,
      reading: transcriptReadingOf([], new Map()),
      now: Date.parse(AT),
    });
    const hello = (flow.state === "ready" ? flow.items : [])
      .map((item) => item.kind)
      .filter((kind) => kind === "hello");
    console.log(`TU1_G4 ${JSON.stringify({ case: "window", new: sparkIsNew(reattached), hello })}`);
    expect(sparkIsNew(reattached)).toBe(true);
    expect(hello).toEqual(["hello"]);
  });
});

describe("the hello's words and its starters (DESIGN.md §8 \"Chat's thread\", the hello)", () => {
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
