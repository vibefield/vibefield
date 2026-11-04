/**
 * SP-1d — a thread's mark (`chat/thread-marks.ts`; DESIGN.md §8 "Chat's list", Needs you, as amended 2026-10-31).
 * Pure: the window's readings of its sparks in, and which thread is on screen; each thread's dot out — a needs-you dot
 * that lasts until its thread is opened, even after the need ends, and unread (the same dot in `--vf-cyan`) when the
 * spark's own turn ends while its thread is not on screen. The feed that holds the one ledger is drawn by
 * `view-frame.test.tsx` (Chat's cell) and `chat-view.test.tsx` (the rows, and Chat opening a thread).
 */
import type { AgentFieldRow, SparkSummary } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type SparkEntry, sparkEntriesOf } from "../src/chat/spark-status";
import {
  cellMarkOf,
  lastingMarkOf,
  NO_LATCHES,
  THREAD_MARK_WORDS,
  ThreadLedger,
  threadMarkOf,
  threadMarksOf,
} from "../src/chat/thread-marks";

const AT = "2026-10-31T05:00:00.000Z";

function spark(id: string, name: string): SparkSummary {
  return {
    id,
    name,
    face: { seed: name.length },
    agent: "claude",
    profiles: ["this-mac"],
    thinksUnder: "this-mac",
    folder: `/f/${name}`,
    createdAt: AT,
    updatedAt: AT,
    session: { runtimeRunId: `run-${name}`, live: true },
  };
}

const VELA = spark("sp-vela0001", "Vela");
const LYRA = spark("sp-lyra0001", "Lyra");

type Doing = "idle" | "working" | "asking";

/** A spark's own run, as the board says it: idle, at work, or asking you a question. */
function own(name: string, id: string, doing: Doing): AgentFieldRow {
  return {
    runtimeRunId: `run-${name}`,
    revision: 1,
    kind: "claude",
    label: "Claude Code",
    tier: "managed",
    device: "dev-1",
    status: doing === "asking" ? "blocked" : doing,
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: doing === "asking" ? [{ id: "q-1", kind: "question", since: AT }] : [],
    spark: id,
  };
}

/** One reading of the window's feed: what Vela and Lyra are doing. */
function reading(vela: Doing, lyra: Doing = "idle"): SparkEntry[] {
  return sparkEntriesOf([VELA, LYRA], [own("Vela", VELA.id, vela), own("Lyra", LYRA.id, lyra)]);
}

/** The ledger's marks on a reading, by name. */
function marks(ledger: ThreadLedger, entries: readonly SparkEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, mark] of threadMarksOf(entries, ledger)) {
    out[entries.find((entry) => entry.spark.id === id)?.spark.name ?? id] = mark;
  }
  return out;
}

describe("a thread's mark (DESIGN.md §8 \"Chat's list\", Needs you)", () => {
  it("says in words only what a dot adds to the row's status word: a need that has ended, or unread", () => {
    const vela = (doing: Doing): SparkEntry => {
      const entry = reading(doing).find((each) => each.spark.id === VELA.id);
      if (entry === undefined) throw new Error("no Vela on the reading");
      return entry;
    };
    // a need standing now is its word's own (Asking you); answered since, the dot's need is said
    expect(lastingMarkOf(vela("asking"), "needs")).toBeNull();
    expect(lastingMarkOf(vela("idle"), "needs")).toBe(THREAD_MARK_WORDS.needs);
    expect(lastingMarkOf(vela("idle"), "unread")).toBe(THREAD_MARK_WORDS.unread);
    expect(lastingMarkOf(vela("idle"), null)).toBeNull();
    expect(THREAD_MARK_WORDS).toEqual({ needs: "needed you", unread: "unread" });
  });

  it("keeps a need's dot after the need ends, until the thread is on screen", () => {
    const ledger = new ThreadLedger();
    ledger.read(reading("idle"));
    ledger.read(reading("asking"));
    expect(marks(ledger, reading("asking"))).toEqual({ Vela: "needs" });
    // answered elsewhere (its pane in Godview): the word says the status as it is, and the dot stays
    const answered = reading("idle");
    ledger.read(answered);
    expect(marks(ledger, answered)).toEqual({ Vela: "needs" });
    // opening it reads it
    ledger.show(VELA.id, answered);
    expect(marks(ledger, answered)).toEqual({});
    // and closing it again leaves nothing behind
    ledger.show(null, answered);
    expect(marks(ledger, answered)).toEqual({});
  });

  it("marks a thread unread when its spark's own turn ends off screen, and only opening it reads it", () => {
    const ledger = new ThreadLedger();
    ledger.read(reading("idle"));
    ledger.read(reading("working"));
    // a turn under way is not yet news
    expect(marks(ledger, reading("working"))).toEqual({});
    ledger.read(reading("idle"));
    expect(marks(ledger, reading("idle"))).toEqual({ Vela: "unread" });
    // another turn, another end: still the one mark, read by one opening
    ledger.read(reading("working"));
    ledger.read(reading("idle"));
    expect(marks(ledger, reading("idle"))).toEqual({ Vela: "unread" });
    // opening another thread reads only that one
    ledger.show(LYRA.id, reading("idle"));
    expect(marks(ledger, reading("idle"))).toEqual({ Vela: "unread" });
    ledger.show(VELA.id, reading("idle"));
    expect(marks(ledger, reading("idle"))).toEqual({});
  });

  it("marks nothing unread on the window's first reading: a turn it never saw end is no news", () => {
    const ledger = new ThreadLedger();
    ledger.read(reading("idle", "idle"));
    expect(marks(ledger, reading("idle", "idle"))).toEqual({});
    // a turn under way at the first reading, seen to end later, is news
    const fresh = new ThreadLedger();
    fresh.read(reading("working"));
    fresh.read(reading("idle"));
    expect(marks(fresh, reading("idle"))).toEqual({ Vela: "unread" });
  });

  it("keeps a need found on the first reading as any need: its dot stood, so it lasts until the thread is opened", () => {
    const ledger = new ThreadLedger();
    ledger.read(reading("asking"));
    ledger.read(reading("idle"));
    expect(marks(ledger, reading("idle"))).toEqual({ Vela: "needs" });
  });

  it("latches nothing while the thread is on screen: a need and a turn's end there leave no mark once they pass", () => {
    const ledger = new ThreadLedger();
    ledger.show(VELA.id, []);
    ledger.read(reading("working"));
    ledger.read(reading("asking"));
    // the row's dot stands while the need does, on screen or not
    expect(marks(ledger, reading("asking"))).toEqual({ Vela: "needs" });
    ledger.read(reading("working"));
    ledger.read(reading("idle"));
    expect(marks(ledger, reading("idle"))).toEqual({});
  });

  it("keeps the need's dot of a thread that leaves the screen while it needs you", () => {
    const ledger = new ThreadLedger();
    ledger.show(VELA.id, []);
    ledger.read(reading("asking"));
    // the window goes to another view, Vela still asking: her need is now unseen
    ledger.show(null, reading("asking"));
    ledger.read(reading("idle"));
    expect(marks(ledger, reading("idle"))).toEqual({ Vela: "needs" });
  });

  it("lets a needs-you dot outrank unread, on a row and on Chat's cell", () => {
    const ledger = new ThreadLedger();
    ledger.read(reading("working", "working"));
    ledger.read(reading("idle", "idle"));
    expect(cellMarkOf(threadMarksOf(reading("idle", "idle"), ledger))).toBe("unread");
    // Vela's next turn ends in a question: her one dot is the orange one, and so is the cell's
    ledger.read(reading("working", "idle"));
    ledger.read(reading("asking", "idle"));
    expect(marks(ledger, reading("asking", "idle"))).toEqual({ Vela: "needs", Lyra: "unread" });
    expect(cellMarkOf(threadMarksOf(reading("asking", "idle"), ledger))).toBe("needs");
    // opening Vela's thread reads both her marks; Lyra's cyan is the cell's again
    ledger.show(VELA.id, reading("asking", "idle"));
    ledger.show(null, reading("idle", "idle"));
    expect(cellMarkOf(threadMarksOf(reading("idle", "idle"), ledger))).toBe("unread");
    expect(cellMarkOf(new Map())).toBeNull();
  });

  it("drops a spark's marks when the list no longer holds it", () => {
    const ledger = new ThreadLedger();
    ledger.read(reading("working"));
    ledger.read(reading("asking"));
    const gone = sparkEntriesOf([LYRA], [own("Lyra", LYRA.id, "idle")]);
    ledger.read(gone);
    expect(ledger.needs.has(VELA.id)).toBe(false);
    expect(ledger.unread.has(VELA.id)).toBe(false);
  });

  it("reads a reading alone, with no window behind it, as its needs and nothing unread", () => {
    const entries = reading("asking", "idle");
    const markOf = (spark: SparkSummary): string | null | undefined => {
      const entry = entries.find((each) => each.spark.id === spark.id);
      return entry && threadMarkOf(entry, NO_LATCHES);
    };
    expect(markOf(VELA)).toBe("needs");
    expect(markOf(LYRA)).toBeNull();
  });
});
