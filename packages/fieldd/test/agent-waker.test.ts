import { describe, expect, it } from "vitest";
import type { AgentInputQueues } from "../src/agent-input-queue";
import { AgentWaker, isIdleRow, stateOf } from "../src/agent-waker";

// CP-2 — the waker (CP-D4, CP2-D6 A; `draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31): it reads the monitor
// rows fieldd already hears, wakes a spark for the runs it started and the ones it watches, says the run's state and
// never its words, and holds the wakes of a spark with no live session until one opens.

const row = (status: string, ...kinds: string[]) => ({
  status,
  blockers: kinds.map((kind) => ({ kind })),
});

function harness(live: Record<string, string> = { "sp-vela": "run-vela" }) {
  const woken: { run: string; fact: string }[] = [];
  const queues = {
    wake: (run: string, fact: string) => woken.push({ run, fact }),
  } as unknown as AgentInputQueues;
  const spawned: Record<string, string> = { "run-ada": "sp-vela" };
  const waker = new AgentWaker({
    queues,
    spawnerOf: (run) => spawned[run],
    sparkSession: (spark) => live[spark],
    label: (run) => ({ "run-ada": "Ada", "run-ben": "Ben" })[run] ?? run,
  });
  return { waker, woken, live };
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
});
