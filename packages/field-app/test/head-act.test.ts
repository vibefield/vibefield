/**
 * TH-2 — the head's act (`chat/head-act.ts`; DESIGN.md §8 "Chat's thread", the head's act; §9 "A Stop's words"; TH-Q3
 * (b), TH-Q28 (b)): one place at the head's end, Jump to awake, Wake asleep, none before the spark started; Pause
 * current turn before it while the spark's own run works, through `agent.pause`, sent once and never escalated; and
 * what the status's place says of it, a refused Pause or a cancellation fieldd could not confirm. No End run. The
 * drawing and the press are `chat-view.test.tsx`'s; fieldd's stop is `agent-runtime.test.ts`'s there.
 */
import type { AgentFieldRow, AgentInterruptResult, SparkSummary } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  headActOf,
  NO_PAUSE,
  type PauseAct,
  pauseTurn,
  pauseWords,
  STILL_RUNNING,
  turnOf,
} from "../src/chat/head-act";
import { type SparkEntry, sparkEntriesOf } from "../src/chat/spark-status";
import { interruptRefusal } from "../src/interrupt-refusal";

const AT = "2026-11-05T03:00:00.000Z";
const TURN = "2026-11-05T03:01:00.000Z";

const VELA: SparkSummary = {
  id: "sp-vela0001",
  name: "Vela",
  face: { seed: 3908 },
  agent: "claude",
  profiles: ["this-mac"],
  thinksUnder: "this-mac",
  folder: "/f/Vela",
  createdAt: AT,
  updatedAt: AT,
  session: { runtimeRunId: "run-Vela", terminalSessionId: "pty-Vela", live: true },
};

function own(over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  return {
    runtimeRunId: "run-Vela",
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
    spark: VELA.id,
    terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
    ...over,
  };
}
const WORKS = own({ status: "working", statusSince: TURN });

function entryOf(rows: readonly AgentFieldRow[], spark: SparkSummary = VELA): SparkEntry {
  const entry = sparkEntriesOf([spark], rows, { items: [] })[0];
  if (entry === undefined) throw new Error("no entry");
  return entry;
}

describe("the head's one place (TH-2; TH-Q28 (b))", () => {
  it("holds Jump to awake, Wake asleep, and nothing before the spark started", () => {
    expect(headActOf(entryOf([own()])).main).toBe("jump");
    expect(
      headActOf(entryOf([], { ...VELA, session: { runtimeRunId: "run-Vela", live: false } })).main,
    ).toBe("wake");
    const { session: _never, ...notStarted } = VELA;
    expect(headActOf(entryOf([], notStarted)).main).toBeNull();
  });
});

describe("Pause current turn (TH-2; TH-Q3 (b))", () => {
  it("stands while the spark's own run works, and only then", () => {
    expect(turnOf(entryOf([WORKS]))).toBe(TURN);
    expect(headActOf(entryOf([WORKS])).pause).toBe("ready");
    expect(headActOf(entryOf([own()])).pause).toBeNull();
    expect(headActOf(entryOf([own({ status: "blocked" })])).pause).toBeNull();
    expect(turnOf(entryOf([own()]))).toBeNull();
    // a run that has gone, whatever its last word said
    expect(headActOf(entryOf([{ ...WORKS, alive: false }])).pause).toBeNull();
  });

  it("says it is pausing from the press until fieldd answers, and while fieldd holds the stop as sent", () => {
    expect(headActOf(entryOf([WORKS]), { state: "busy", turn: TURN }).pause).toBe("pausing");
    // accepted, before the board says so: still pausing, for that turn alone
    expect(headActOf(entryOf([WORKS]), { state: "sent", turn: TURN }).pause).toBe("pausing");
    const next = { ...WORKS, statusSince: "2026-11-05T03:02:00.000Z" };
    expect(headActOf(entryOf([next]), { state: "sent", turn: TURN }).pause).toBe("ready");
    // fieldd's own hold, read from the board (the row's `stop`), whoever pressed
    expect(headActOf(entryOf([{ ...WORKS, stop: { sentAt: TURN, stage: "sent" } }])).pause).toBe(
      "pausing",
    );
    // heard: the turn stopped (its row leaves working at once, but a heard stop alone holds nothing)
    expect(
      headActOf(entryOf([{ ...WORKS, stop: { sentAt: TURN, stage: "heard", heardBy: "status" } }]))
        .pause,
    ).toBe("ready");
  });

  it("says a cancellation fieldd could not confirm in the status's place, and holds Pause: no second send, no End run", () => {
    const unheard = {
      ...WORKS,
      stop: { sentAt: TURN, stage: "sent", unheardAt: "2026-11-05T03:01:03.000Z" },
    };
    const head = headActOf(entryOf([unheard]), { state: "sent", turn: TURN });
    expect(head).toEqual({ main: "jump", pause: "held", says: STILL_RUNNING });
    expect(STILL_RUNNING).toBe("Still running · the cancellation was not confirmed");
    expect(JSON.stringify(head)).not.toContain("End run");
  });

  it("says a refused Pause in fieldd's words while that turn works, and lets it be pressed again", () => {
    const refused: PauseAct = { state: "refused", turn: TURN, reason: "no-terminal-host" };
    expect(headActOf(entryOf([WORKS]), refused)).toEqual({
      main: "jump",
      pause: "ready",
      says: "Couldn't pause Vela's turn: no-terminal-host",
    });
    expect(pauseWords("Vela", "no-terminal-host")).toBe(
      "Couldn't pause Vela's turn: no-terminal-host",
    );
    // the next turn, or no turn, says the status word again
    const next = { ...WORKS, statusSince: "2026-11-05T03:02:00.000Z" };
    expect(headActOf(entryOf([next]), refused).says).toBeNull();
    expect(headActOf(entryOf([own()]), refused).says).toBeNull();
    expect(headActOf(entryOf([WORKS]), NO_PAUSE).says).toBeNull();
  });
});

describe("the press: agent.pause, once (TH-2; the evidence: accepted is delivered, never obeyed)", () => {
  it("asks for the run's own turn cancellation and reads fieldd's answer", async () => {
    const asked: string[] = [];
    const answering = (answer: AgentInterruptResult) => async (runtimeRunId: string) => {
      asked.push(runtimeRunId);
      return answer;
    };
    await expect(pauseTurn(answering({ accepted: true }), "run-Vela")).resolves.toEqual({
      state: "sent",
    });
    expect(asked).toEqual(["run-Vela"]);
    // the floor's own word, never a sentence composed here
    await expect(
      pauseTurn(answering({ accepted: false, reason: "not-working" }), "run-Vela"),
    ).resolves.toEqual({ state: "refused", reason: "not-working" });
  });

  it("says a refusal fieldd threw by its own word for the state, and a daemon it could not reach by its error", async () => {
    const throwing = (cause: unknown) => async () => {
      throw cause;
    };
    const ended = Object.assign(new Error("the session is not running under this daemon"), {
      kind: "PRECONDITION_FAILED",
      details: { runtimeRunId: "run-Vela", state: "not-alive" },
    });
    await expect(pauseTurn(throwing(ended), "run-Vela")).resolves.toEqual({
      state: "refused",
      reason: "not-alive",
    });
    const unknown = Object.assign(new Error("no managed session run-Vela"), { kind: "NOT_FOUND" });
    await expect(pauseTurn(throwing(unknown), "run-Vela")).resolves.toEqual({
      state: "refused",
      reason: "NOT_FOUND",
    });
    await expect(
      pauseTurn(throwing(new Error("fieldd is not answering")), "run-Vela"),
    ).resolves.toEqual({ state: "refused", reason: "fieldd is not answering" });
  });
});

describe("a refusal fieldd threw, read structurally (shared with Godview's pause verb; GT-6 review)", () => {
  it("names the state for PRECONDITION_FAILED and NOT_FOUND, and nothing for any other failure", () => {
    expect(interruptRefusal({ kind: "PRECONDITION_FAILED", details: { state: "not-alive" } })).toBe(
      "not-alive",
    );
    expect(interruptRefusal({ kind: "PRECONDITION_FAILED" })).toBe("PRECONDITION_FAILED");
    expect(interruptRefusal({ kind: "NOT_FOUND", details: { state: "" } })).toBe("NOT_FOUND");
    expect(interruptRefusal({ kind: "UNAVAILABLE" })).toBeUndefined();
    expect(interruptRefusal(new Error("socket closed"))).toBeUndefined();
    expect(interruptRefusal(null)).toBeUndefined();
  });
});
