/**
 * TH-1 — the flow, as data (`chat/transcript-items.ts`; DESIGN.md §8 "Chat's thread", §9 "Chat's words"): the spark's
 * record as the reader holds it, in; the flow's rows out. Each line kind reads from the contracts' own fixtures (EL9,
 * the window's side), and every word the flow says is DESIGN.md's.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFieldRow, NeedsItem, SparkSummary } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type SparkEntry, sparkEntriesOf } from "../src/chat/spark-status";
import { helloWords } from "../src/chat/thread-items";
import {
  actWords,
  chipWordsOf,
  dayWords,
  FLOW_WORDS,
  type FlowItem,
  receiptOf,
  TOOL_WORDS,
  toolWords,
  transcriptItemsOf,
} from "../src/chat/transcript-items";
import { type TranscriptReading, transcriptReadingOf } from "../src/chat/transcript-port";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(here, "../../contracts/fixtures", `${name}.json`), "utf8"));

const AT = "2026-11-04T23:00:00.000Z";
const NOW = Date.parse("2026-11-04T23:30:00.000Z");

function spark(over: Partial<SparkSummary> = {}): SparkSummary {
  return {
    id: "sp-9q2wloft1",
    name: "Vela",
    face: { seed: 4242 },
    agent: "claude",
    profiles: ["this-mac"],
    thinksUnder: "this-mac",
    folder: "/f/vela",
    createdAt: "2026-11-02T09:00:00.000Z",
    updatedAt: AT,
    turnedAt: "2026-11-02T09:05:00.000Z",
    session: { runtimeRunId: "run-01JC4MA2K3", terminalSessionId: "pty-1", live: true },
    ...over,
  };
}

function row(over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  return {
    runtimeRunId: "run-01JC4MA2K3",
    spark: "sp-9q2wloft1",
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
    turnedAt: "2026-11-02T09:05:00.000Z",
    ...over,
  };
}

const entryOf = (
  over: {
    spark?: Partial<SparkSummary>;
    row?: Partial<AgentFieldRow> | null;
    items?: NeedsItem[];
  } = {},
): SparkEntry => {
  const entries = sparkEntriesOf(
    [spark(over.spark)],
    over.row === null ? [] : [row(over.row ?? {})],
    { items: over.items ?? [] },
  );
  const entry = entries[0];
  if (entry === undefined) throw new Error("no entry");
  return entry;
};

const RUN = "run-01JC4MA2K3";
const FIRST = {
  runtimeRunId: "run-01JC2Z9X0A",
  startedAt: "2026-11-02T09:00:00.000Z",
  fresh: true,
};
const LATEST = { runtimeRunId: RUN, startedAt: "2026-11-04T23:10:40.002Z", fresh: false };

/** The contracts' line fixtures, one run, in their seq order. */
function linesOf(...names: string[]): Map<string, readonly unknown[]> {
  return new Map([[RUN, names.map((name) => fixture(`spark-transcript-line.${name}`))]]);
}

const itemsOf = (
  reading: TranscriptReading,
  entry = entryOf(),
  extra = {},
): readonly FlowItem[] => {
  const flow = transcriptItemsOf({ entry, reading, now: NOW, locale: "en-US", ...extra });
  if (flow.state !== "ready") throw new Error(flow.state);
  return flow.items;
};
const kinds = (items: readonly FlowItem[]) => items.map((item) => item.kind);

describe("the record, drawn (TH0-Q1 = O1)", () => {
  it("draws your words with their chips, a turn's tools as one line, Vela's reply and VibeField's notify", () => {
    const reading = transcriptReadingOf(
      [FIRST, LATEST],
      linesOf("run", "you", "turn", "outcome", "tool", "tool-ours", "reply", "act"),
    );
    const items = itemsOf(reading);
    expect(kinds(items)).toEqual(["day", "you", "tools", "reply", "act"]);
    const you = items[1];
    if (you?.kind !== "you") throw new Error("no bubble");
    expect(you.chips).toEqual([{ start: 5, length: 46, kind: "session" }]);
    // delivered, under the last bubble
    expect(you.receipt).toEqual({ words: "Delivered" });
    const tools = items[2];
    // VibeField's own served call leaves the count; its kind in VibeField's words, never a tool's name
    expect(tools?.kind === "tools" && [tools.words, tools.rows]).toEqual([
      "Used 1 tool",
      [{ words: "Ran a command", detail: "pnpm --filter @vibefield/field-app test chat-composer" }],
    ]);
    expect(items[4]).toMatchObject({ kind: "act", words: "Vela told you: the build is green" });
    // Vela's face leads once per run of its rows
    expect(
      items.filter((item) => "lead" in item).map((item) => "lead" in item && item.lead),
    ).toEqual([true, false, false]);
  });

  it("draws a reply again where it stood when the agent rewrites it, and its words whole", () => {
    const reply = fixture("spark-transcript-line.reply");
    const long = "x".repeat(40_000);
    const reading = transcriptReadingOf(
      [LATEST],
      new Map([
        [RUN, [reply, { ...reply, seq: 8, text: long }, fixture("spark-transcript-line.gap")]],
      ]),
    );
    const items = itemsOf(reading, entryOf({ spark: { turnedAt: null }, row: { turnedAt: null } }));
    expect(kinds(items)).toEqual(["day", "reply", "honest"]);
    expect(items[1]?.kind === "reply" && items[1].text.length).toBe(40_000);
    expect(items[2]).toMatchObject({ which: "gap", words: FLOW_WORDS.gap("Vela") });
  });

  it("draws words typed into the terminal as yours, with no receipt", () => {
    const reading = transcriptReadingOf([FIRST, LATEST], linesOf("run", "you-terminal"));
    const [, typed] = itemsOf(reading);
    expect(typed).toMatchObject({
      kind: "you",
      text: "/compact and then keep going",
      receipt: null,
    });
  });

  it("skips a kind this build does not know, and a line it already holds", () => {
    const reading = transcriptReadingOf(
      [FIRST, LATEST],
      linesOf("run", "reply", "reply", "unknown-kind"),
    );
    expect(kinds(itemsOf(reading))).toEqual(["day", "reply"]);
  });
});

describe("every run, one conversation (TH-Q14 (b), TH0-Q6 (c))", () => {
  // midday starts, so each conversation's date is the same in every zone the suite runs in
  const earlier = { runtimeRunId: "run-a", startedAt: "2026-11-02T09:00:00.000Z", fresh: true };
  const latest = { runtimeRunId: RUN, startedAt: "2026-11-04T12:00:00.000Z", fresh: true };
  const resumed = { runtimeRunId: "run-c", startedAt: "2026-11-04T12:20:00.000Z", fresh: false };
  const say = (seq: number, text: string, at: string) => ({
    v: 1,
    seq,
    mac: "0".repeat(64),
    kind: "reply",
    at,
    messageId: `m-${text}`,
    text,
  });
  const reading = transcriptReadingOf(
    [earlier, latest, resumed],
    new Map([
      ["run-a", [say(1, "before", "2026-11-02T09:01:00.000Z")]],
      [RUN, [say(1, "latest", "2026-11-04T12:01:00.000Z")]],
      ["run-c", [say(1, "resumed", "2026-11-04T12:21:00.000Z")]],
    ]),
  );

  it("joins a conversation's resumed runs, and folds the earlier ones behind one row", () => {
    const items = itemsOf(reading);
    expect(items[0]).toEqual({ kind: "earlier", key: "earlier", count: 1 });
    expect(
      items.filter((item) => item.kind === "reply").map((item) => "text" in item && item.text),
    ).toEqual(["latest", "resumed"]);
  });

  it("opens each conversation with its own line once the earlier ones are asked for", () => {
    const items = itemsOf(reading, entryOf(), { earlier: true });
    const lines = items
      .filter((item) => item.kind === "day")
      .map((item) => "words" in item && item.words);
    expect(lines).toEqual([FLOW_WORDS.conversation("Nov 2"), FLOW_WORDS.conversation("Nov 4")]);
    expect(items.some((item) => item.kind === "earlier")).toBe(false);
    expect(items.filter((item) => item.kind === "reply").length).toBe(3);
  });
});

describe("the hello, the first row (TH-Q36 (a), CO-Q2 (b))", () => {
  const fresh = entryOf({ spark: { turnedAt: null }, row: { turnedAt: null } });
  const empty = transcriptReadingOf([LATEST], linesOf("run"));

  it("offers the starters filled from this Mac, held wordless while they are read (ES-4; §9, the hello, as amended)", () => {
    const filled = [
      { glyph: "agents", words: "Spawn 4 Claude Code agents to research a topic each" },
      { glyph: "panes", words: "Keep track of my agents in billing-api" },
      { glyph: "duplicate", words: "Have Claude Code review codex·3's work until it's clean" },
    ] as const;
    const read = itemsOf(empty, fresh, { starters: { state: "read", starters: filled } });
    expect(read[0]).toMatchObject({ kind: "hello", starters: filled, held: false });
    const held = itemsOf(empty, fresh, { starters: { state: "reading", starters: filled } });
    expect(held[0]).toMatchObject({ kind: "hello", held: true });
  });

  it("stands while the spark is new and its conversation holds no words, a card at the foot or not", () => {
    const items = itemsOf(empty, fresh);
    expect(items[0]).toMatchObject({ kind: "hello", words: helloWords("Vela") });
    const asked = entryOf({
      spark: { turnedAt: null },
      row: { turnedAt: null },
      items: [
        {
          id: "ny-q1",
          kind: "question",
          state: "open",
          from: { name: "Vela", spark: "sp-9q2wloft1" },
          spark: "sp-9q2wloft1",
          asked: AT,
          words: "Push it?",
          choices: ["Yes", "Not now"],
        },
      ],
    });
    expect(itemsOf(empty, asked)[0]?.kind).toBe("hello");
  });

  it("leaves at the first send, and never stands over a conversation or a spark that worked", () => {
    const pending = [{ requestId: "say-0000001", text: "hi", chips: [], at: AT }];
    expect(kinds(itemsOf(empty, fresh, { pending }))).not.toContain("hello");
    expect(
      kinds(itemsOf(transcriptReadingOf([LATEST], linesOf("run", "reply")), fresh)),
    ).not.toContain("hello");
    expect(kinds(itemsOf(empty))).not.toContain("hello");
  });
});

describe('your bubble\'s receipt (TH-Q4 (a); §9 "Chat on the phone")', () => {
  it("says each state in the phone's words, read with the spark as it stands", () => {
    const idle = entryOf();
    const busy = entryOf({ row: { status: "working" } });
    const asks = entryOf({
      row: { status: "blocked", blockers: [{ id: "q", kind: "question", since: AT }] },
    });
    expect(receiptOf(undefined, idle, true)).toBeNull();
    expect(receiptOf("waking", idle, true)).toEqual({ words: "Waking Vela…" });
    expect(receiptOf("queued", idle, true)).toEqual({ words: "Queued" });
    expect(receiptOf("waiting", busy, true)).toEqual({
      words: "Queued · Vela is busy; it lands when it's done",
    });
    expect(receiptOf("queued", asks, true)).toEqual({
      words: "Queued · it lands after you answer Vela",
    });
    expect(receiptOf("delivered", idle, true)).toEqual({ words: "Delivered" });
    expect(receiptOf("delivered", idle, false)).toBeNull();
    expect(receiptOf("dropped", idle, false)).toEqual({
      words: "Not delivered: Vela's session ended",
    });
    expect(receiptOf("uncertain", idle, false)).toEqual({
      words: "Vela may not have it: look in its pane",
      tone: "attention",
    });
    expect(receiptOf("migrated", idle, true)).toBeNull();
  });

  it("reads the record's latest outcome over the state the words were queued with, and a pending send's own", () => {
    const reading = transcriptReadingOf([LATEST], linesOf("run", "you", "outcome-uncertain"));
    const pending = [
      {
        requestId: "say-01JC4N0B6WQZ",
        text: "already in the record",
        chips: [],
        at: AT,
        state: "queued",
      },
      {
        requestId: "say-next000001",
        text: "and then",
        chips: [],
        at: "2026-11-04T23:29:00.000Z",
        state: "waking",
      },
    ];
    const bubbles = itemsOf(reading, entryOf(), { pending }).filter((item) => item.kind === "you");
    expect(bubbles.map((item) => item.kind === "you" && item.receipt)).toEqual([
      { words: "Vela may not have it: look in its pane", tone: "attention" },
      { words: "Waking Vela…" },
    ]);
  });
});

describe("the honest lines (TH0-Q7 (a))", () => {
  it("says the record began after the spark worked, and lines it could not check, once at the top", () => {
    const reading = transcriptReadingOf([LATEST], linesOf("run", "reply"), { dropped: 2 });
    const items = itemsOf(reading);
    expect(items.slice(0, 2)).toEqual([
      { kind: "honest", key: "dropped", which: "dropped", words: FLOW_WORDS.dropped },
      { kind: "honest", key: "before", which: "before", words: FLOW_WORDS.before("Vela") },
    ]);
  });
});

describe("Thinking… (TH-Q2 (a))", () => {
  it("stands at the foot while Vela's own run works, with no text", () => {
    const reading = transcriptReadingOf([FIRST], new Map([[FIRST.runtimeRunId, []]]));
    const items = itemsOf(reading, entryOf({ row: { status: "working" } }));
    expect(items[items.length - 1]).toEqual({ kind: "thinking", key: "thinking", lead: true });
    expect(kinds(itemsOf(reading))).not.toContain("thinking");
  });
});

describe('the words (§9 "Chat\'s words")', () => {
  it("names a tool by its kind, never its own name, and a kind this build does not know as a tool", () => {
    expect(Object.keys(TOOL_WORDS)).toEqual([
      "command",
      "web-search",
      "file-read",
      "file-edit",
      "browser",
      "mcp",
      "other",
    ]);
    expect(toolWords("telepathy")).toBe("Used a tool");
    expect(FLOW_WORDS.tools(1)).toBe("Used 1 tool");
  });

  it("draws a session chip by its words, never the run id it carries", () => {
    const you = fixture("spark-transcript-line.you") as { text: string; chips: never[] };
    expect(chipWordsOf(you.text, you.chips[0] as never)).toBe("Claude Code in vibe-field");
    expect(chipWordsOf("Claude Code at Opus", { start: 0, length: 11, kind: "agent" })).toBe(
      "Claude Code",
    );
  });

  it("says days as the window's clock does", () => {
    expect(dayWords(NOW - 60_000, NOW, "en-US")).toBe("Today");
    expect(dayWords(NOW - 24 * 3_600_000, NOW, "en-US")).toBe("Yesterday");
    expect(dayWords(Date.parse("2026-11-02T12:00:00.000Z"), NOW, "en-US")).toBe("Mon, Nov 2");
  });

  it("says only the words the canon records", () => {
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    for (const text of [
      FLOW_WORDS.reading("Vela"),
      FLOW_WORDS.unreadable("Vela", "…"),
      FLOW_WORDS.earlier(3),
      FLOW_WORDS.conversation("Nov 3"),
      FLOW_WORDS.thinking,
      FLOW_WORDS.tools(3),
      FLOW_WORDS.tools(1),
      FLOW_WORDS.before("Vela"),
      FLOW_WORDS.gap("Vela"),
      FLOW_WORDS.dropped,
      ...Object.values(TOOL_WORDS),
      actWords("wake", "‹what it told›", "Vela"),
      actWords("answer", "Yes", "Vela"),
      actWords("notify", "the build is green", "Vela"),
      ...["waking", "queued", "delivered", "dropped", "uncertain"].map(
        (state) => receiptOf(state, entryOf(), true)?.words ?? "",
      ),
      receiptOf("queued", entryOf({ row: { status: "working" } }), true)?.words ?? "",
      receiptOf(
        "queued",
        entryOf({
          row: { status: "blocked", blockers: [{ id: "q", kind: "question", since: AT }] },
        }),
        true,
      )?.words ?? "",
      "Today",
      "Yesterday",
      "Mon, Nov 2",
    ]) {
      expect(design, text).toContain(text);
    }
  });
});

describe("a crew's act line (SP-1e2's renderer half; SPE-Q39 (a))", () => {
  it("draws it once, where it first stood, in its latest words, naming its crew; another act keeps its own row", () => {
    const crewAct = fixture("spark-transcript-line.act-crew");
    const at = (minute: number) => `2026-11-04T23:${minute}:00.000Z`;
    const reading = transcriptReadingOf(
      [FIRST, LATEST],
      new Map([
        [
          RUN,
          [
            fixture("spark-transcript-line.run"),
            { ...crewAct, seq: 2, at: at(11), text: "Started 1 agent" },
            { ...fixture("spark-transcript-line.reply"), seq: 3, at: at(12) },
            { ...crewAct, seq: 4, at: at(13), text: "Started 4 agents · Opus 5.5 · high" },
            { ...fixture("spark-transcript-line.act"), seq: 5, at: at(14) },
          ],
        ],
      ]),
    );
    const items = itemsOf(reading);
    expect(kinds(items)).toEqual(["day", "act", "reply", "act"]);
    expect(items[1]).toMatchObject({
      kind: "act",
      key: "act:crew:cr-4f1c2a9e0b7d3c61",
      what: "crew",
      crew: "cr-4f1c2a9e0b7d3c61",
      words: "Started 4 agents · Opus 5.5 · high",
    });
    expect(items[3]).toMatchObject({ kind: "act", what: "notify" });
    expect(items[3]).not.toHaveProperty("crew");
  });
});
