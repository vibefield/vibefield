import { AGENT_WAKE, type AgentSessionOrigin } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AgentInputQueues } from "../src/agent-input-queue";
import { AgentWaker, isIdleRow, sparkOfOrigin, stateOf } from "../src/agent-waker";

// CP-2 — the waker (CP-D4, CP2-D6 A; `draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31): it reads the monitor
// rows fieldd already hears, wakes a spark for the runs it started and the ones it watches, says the run's state and
// never its words, and holds the wakes of a spark with no live session until one opens.

const row = (status: string, ...kinds: string[]) => ({
  status,
  blockers: kinds.map((kind) => ({ kind })),
});

function harness(
  live: Record<string, string> = { "sp-vela": "run-vela" },
  /** each run's origin (R35b): spawnerOf then reads it through sparkOfOrigin, as daemon.ts's does from slice 15 */
  origins?: Readonly<Record<string, AgentSessionOrigin>>,
  /** Spark QA F10 — how long an ask stands before it is told; these rows tell it at once unless one asks */
  askStandsMs = 0,
) {
  const woken: { run: string; fact: string }[] = [];
  const queues = {
    wake: (run: string, fact: string) => woken.push({ run, fact }),
  } as unknown as AgentInputQueues;
  const spawned: Record<string, string> = { "run-ada": "sp-vela" };
  // SP-1e4 (S4) — the runs whose current turn the person's Pause ended, as the runtime's own record says it
  const paused = new Set<string>();
  const options = {
    queues,
    spawnerOf: (run: string) =>
      origins !== undefined ? sparkOfOrigin(origins[run]) : spawned[run],
    sparkSession: (spark: string) => live[spark],
    label: (run: string) => ({ "run-ada": "Ada", "run-ben": "Ben" })[run] ?? run,
    pausedTurn: (run: string) => paused.has(run),
    askStandsMs,
  };
  const waker = new AgentWaker(options);
  return { waker, woken, live, paused };
}

describe("the waker (CP-D4, CP2-D6)", () => {
  it("reads idle, working, asking and failed from the monitor row alone", () => {
    expect(stateOf(row("working"))).toBe("working");
    expect(stateOf(row("idle"))).toBe("idle");
    expect(stateOf(row("blocked", "permission"))).toBe("asking");
    expect(stateOf(row("blocked", "question"))).toBe("asking");
    expect(stateOf(row("blocked", "failure"))).toBe("failed");
    expect(isIdleRow(row("idle"))).toBe(true);
    expect(isIdleRow(row("idle", "permission"))).toBe(false);
    expect(isIdleRow(undefined)).toBe(false);
  });

  it("wakes the spark that started a run when it finishes, asks or fails, and once more when it ends", () => {
    const h = harness();
    h.waker.onMonitor("run-ada", row("working"));
    h.waker.onMonitor("run-ada", row("idle"));
    h.waker.onMonitor("run-ada", row("working"));
    h.waker.onMonitor("run-ada", row("blocked", "permission"));
    h.waker.onMonitor("run-ada", row("blocked", "failure"));
    h.waker.onEnded("run-ada");
    expect(h.woken).toEqual([
      { run: "run-vela", fact: "Ada finished" },
      { run: "run-vela", fact: "Ada is asking you" },
      { run: "run-vela", fact: "Ada failed" },
      { run: "run-vela", fact: "Ada ended" },
    ]);
  });

  it("SP-1e4 · says a turn the person paused was paused, never that it finished (S4)", () => {
    const h = harness({ "sp-vela": "run-vela", "sp-orin": "run-orin" });
    h.waker.watch("sp-orin", "run-ben", true);
    h.waker.onMonitor("run-ada", row("working"));
    h.waker.onMonitor("run-ben", row("working"));
    h.paused.add("run-ada");
    h.paused.add("run-ben");
    h.waker.onMonitor("run-ada", row("idle"));
    h.waker.onMonitor("run-ben", row("idle"));
    // the next turn lets the Pause go: its end is a finish again
    h.paused.clear();
    h.waker.onMonitor("run-ada", row("working"));
    h.waker.onMonitor("run-ada", row("idle"));
    expect(h.woken).toEqual([
      { run: "run-vela", fact: "Ada was paused by the user" },
      { run: "run-orin", fact: "Ben was paused by the user" },
      { run: "run-vela", fact: "Ada finished" },
    ]);
  });

  it("SP-1e4 · a paused run that asks or fails says so, and its end is still an end", () => {
    const h = harness();
    h.waker.onMonitor("run-ada", row("working"));
    h.paused.add("run-ada");
    h.waker.onMonitor("run-ada", row("blocked", "permission"));
    h.waker.onMonitor("run-ada", row("blocked", "failure"));
    h.waker.onEnded("run-ada");
    expect(h.woken).toEqual([
      { run: "run-vela", fact: "Ada is asking you" },
      { run: "run-vela", fact: "Ada failed" },
      { run: "run-vela", fact: "Ada ended" },
    ]);
  });

  it("wakes a watcher of a run it did not start, until it stops watching", () => {
    const h = harness({ "sp-vela": "run-vela", "sp-orin": "run-orin" });
    h.waker.watch("sp-orin", "run-ben", true);
    h.waker.onMonitor("run-ben", row("working"));
    h.waker.onMonitor("run-ben", row("idle"));
    h.waker.watch("sp-orin", "run-ben", false);
    h.waker.onMonitor("run-ben", row("working"));
    h.waker.onMonitor("run-ben", row("idle"));
    expect(h.woken).toEqual([{ run: "run-orin", fact: "Ben finished" }]);
  });

  it("holds the wakes of a spark with no live session, and lands them when its session opens", () => {
    const h = harness({});
    h.waker.onMonitor("run-ada", row("working"));
    h.waker.onMonitor("run-ada", row("idle"));
    expect(h.woken).toEqual([]);
    h.waker.onSparkLive("sp-vela", "run-vela-2");
    expect(h.woken).toEqual([{ run: "run-vela-2", fact: "Ada finished" }]);
  });

  it("tells a sender its words were uncertain, never resending them (CP2-D2)", () => {
    const h = harness();
    h.waker.uncertain("sp-vela", "run-ada");
    expect(h.woken).toEqual([
      {
        run: "run-vela",
        fact: "your words to Ada are uncertain: no echo came; read the session to see",
      },
    ]);
  });

  it("W1 · tells a sender its words a restart broke into, by the run's label, never its id (item 158, TH-Q32 (a))", () => {
    const h = harness();
    h.waker.restarted("sp-vela", "run-ada");
    // the input queue marks it "VibeField: …" (DESIGN.md §9)
    expect(h.woken).toEqual([
      {
        run: "run-vela",
        fact: "VibeField restarted while your words to Ada were being sent, and cannot tell whether they arrived (read the session to see); they will not be sent again",
      },
    ]);
  });
});

// CP-4a2b (§13a slice 11b; Q10, Q11; the slice 11 rulings, ruled 2026-11-06) — a flow run's spark. A run's
// spawner is the spark its origin says started it, by `agent_spawn` alone (`sparkOfOrigin`, R35b): a flow's step is
// the flow's, so its state change wakes no spark as its spawner, and a spark that watches it is woken as any watcher
// (T5). The run a spark started tells it its facts through `flowFact`, in the runs' words: these rows hand it opaque
// ones, and read where they land, never their words.

/** A flow run's id, as a step's origin names it (steps.ts). */
const FLOW_RUN = "fr-0123456789abcdef";

describe("a flow run's spark: its step wakes no spark as its spawner, and its facts land in its spark's session (§13a slice 11b)", () => {
  it("R35b (D6, Q11, E5; slice 11b): a run's spawner is the spark its origin names by agent_spawn alone: never a step's, though its origin names the spark whose run made it, nor a spark's own session's", () => {
    expect({
      // a spark's own session: yours, its spark beside the origin, never in it (daemon.ts's own-session spawn)
      you: sparkOfOrigin({ by: "you" }),
      step: sparkOfOrigin({ by: "flow", run: FLOW_RUN, call: 1 }),
      // E5's shape, a step of a spark's own run: the leg that "origin.spark, whatever its `by`" reddens
      sparksStep: sparkOfOrigin({ by: "flow", run: FLOW_RUN, call: 1, spark: "sp-vela" }),
      spawn: sparkOfOrigin({ by: "spark", spark: "sp-vela" }),
      // a record from before CO names no origin
      none: sparkOfOrigin(undefined),
    }).toStrictEqual({
      you: undefined,
      step: undefined,
      sparksStep: undefined,
      spawn: "sp-vela",
      none: undefined,
    });
  });

  it("R35b (D6, Q11, T5; slice 11b): with spawnerOf read through sparkOfOrigin, a step's working → idle wakes no spark as its spawner, a step a spark watches wakes that watcher, and a spark's own agent wakes it", () => {
    const h = harness(
      { "sp-vela": "run-vela", "sp-orin": "run-orin" },
      {
        "run-step1": { by: "flow", run: FLOW_RUN, call: 1, spark: "sp-vela" },
        "run-step2": { by: "flow", run: FLOW_RUN, call: 2, spark: "sp-vela" },
        "run-ada": { by: "spark", spark: "sp-vela" },
      },
    );
    // a step no spark watches
    h.waker.onMonitor("run-step1", row("working"));
    h.waker.onMonitor("run-step1", row("idle"));
    // a step Orin watches (agent_watch)
    h.waker.watch("sp-orin", "run-step2", true);
    h.waker.onMonitor("run-step2", row("working"));
    h.waker.onMonitor("run-step2", row("idle"));
    // a positive control, a third leg beyond Q11's two: Vela's own agent_spawn wakes Vela, so the steps above wake no
    // spawner because sparkOfOrigin finds none, never because this waker wakes no one
    h.waker.onMonitor("run-ada", row("working"));
    h.waker.onMonitor("run-ada", row("idle"));
    expect(h.woken.map(({ run }) => run)).toEqual(["run-orin", "run-vela"]);
  });

  // R35w (ruled 2026-11-06): the waker's own leg of Q10, not R35's fact-is-its-words, and the one row that holds
  // Q10's green to `flowFact` being the waker's #wake: flows-runs' rows tell a recording fake
  it("R35w (Q10, the waker's leg; slice 11b): a run's fact lands in its spark's live session as the runs worded it, or is held until that spark's session opens", () => {
    const h = harness({ "sp-vela": "run-vela" });
    h.waker.flowFact("sp-vela", "fact-1");
    // Wren has no live session: its fact waits for one
    h.waker.flowFact("sp-wren", "fact-2");
    h.waker.onSparkLive("sp-wren", "run-wren");
    expect(h.woken).toEqual([
      { run: "run-vela", fact: "fact-1" },
      { run: "run-wren", fact: "fact-2" },
    ]);
  });

  // Spark QA F10 (2026-11-25) — found in real use: Grok approves its own tools, so each one raised an ask and
  // answered it within milliseconds, and the spark was told "is asking you" with nothing ever pending
  describe("an ask is told once it stands (Spark QA F10)", () => {
    const standing = () => harness(undefined, undefined, AGENT_WAKE.ASK_STANDS_MS);

    it("an ask the agent answered itself is never told, and the turn's end is still told as finished", () => {
      vi.useFakeTimers();
      try {
        const h = standing();
        h.waker.onMonitor("run-ada", row("working"));
        h.waker.onMonitor("run-ada", row("working", "permission"));
        vi.advanceTimersByTime(100);
        h.waker.onMonitor("run-ada", row("working"));
        vi.advanceTimersByTime(60_000);
        expect(h.woken).toEqual([]);
        // the flash, then the end with no row between: read from the state before the ask
        h.waker.onMonitor("run-ada", row("blocked", "permission"));
        h.waker.onMonitor("run-ada", row("idle"));
        vi.advanceTimersByTime(60_000);
        expect(h.woken).toEqual([{ run: "run-vela", fact: "Ada finished" }]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("an ask that stands is told once, however many rows it comes in", () => {
      vi.useFakeTimers();
      try {
        const h = standing();
        h.waker.onMonitor("run-ada", row("working"));
        h.waker.onMonitor("run-ada", row("blocked", "permission"));
        vi.advanceTimersByTime(AGENT_WAKE.ASK_STANDS_MS - 1);
        h.waker.onMonitor("run-ada", row("blocked", "permission"));
        expect(h.woken).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(h.woken).toEqual([{ run: "run-vela", fact: "Ada is asking you" }]);
        h.waker.onMonitor("run-ada", row("blocked", "permission"));
        vi.advanceTimersByTime(60_000);
        expect(h.woken).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a failure is told at once, an ask's wait or none; an ended run's ask is never told", () => {
      vi.useFakeTimers();
      try {
        const h = standing();
        h.waker.onMonitor("run-ada", row("working"));
        h.waker.onMonitor("run-ada", row("blocked", "permission"));
        h.waker.onMonitor("run-ada", row("blocked", "failure"));
        expect(h.woken).toEqual([{ run: "run-vela", fact: "Ada failed" }]);
        h.waker.onMonitor("run-ada", row("working"));
        h.waker.onMonitor("run-ada", row("blocked", "permission"));
        h.waker.onEnded("run-ada");
        vi.advanceTimersByTime(60_000);
        expect(h.woken.map((w) => w.fact)).toEqual(["Ada failed", "Ada ended"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a run whose first row asks tells nobody, as every first row", () => {
      vi.useFakeTimers();
      try {
        const h = standing();
        h.waker.onMonitor("run-ada", row("blocked", "permission"));
        vi.advanceTimersByTime(60_000);
        expect(h.woken).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
