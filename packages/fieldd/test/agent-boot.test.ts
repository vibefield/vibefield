import { AGENT_START } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunBoots } from "../src/agent-boot";

// Spark QA F12 (2026-11-25) — a born run takes no input until its agent has said it started and the settle has
// passed. Found in real use: a spawn's task was pasted 10 ms after the terminal was spawned and stayed a draft.

describe("a born run's wait before it takes input (Spark QA F12)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const boots = (over: { settleMs?: number; saidWithinMs?: number } = {}) => {
    const took: string[] = [];
    const logged: string[] = [];
    const logger = new Proxy({} as never, {
      get: (_t, level: string) =>
        level === "child"
          ? () => logger
          : (event: string) => {
              logged.push(`${level}:${event}`);
            },
    });
    return {
      took,
      logged,
      b: new RunBoots({ onTakesInput: (id) => took.push(id), logger, ...over }),
    };
  };

  it("a run nobody was told of takes input: a re-attached or adopted run never waits", () => {
    const { b } = boots();
    expect(b.takesInput("run-a")).toBe(true);
  });

  it("a born run takes none until it says it started and the settle passes, and the queue is told once", () => {
    const { b, took } = boots();
    b.born("run-a", false);
    expect(b.takesInput("run-a")).toBe(false);
    vi.advanceTimersByTime(1_000);
    b.said("run-a");
    expect(b.takesInput("run-a")).toBe(false);
    vi.advanceTimersByTime(AGENT_START.SETTLE_MS - 1);
    expect(b.takesInput("run-a")).toBe(false);
    expect(took).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(b.takesInput("run-a")).toBe(true);
    expect(took).toEqual(["run-a"]);
    vi.advanceTimersByTime(60_000);
    expect(took).toEqual(["run-a"]);
  });

  it("the settle runs from the FIRST start line: a second one does not push it out", () => {
    const { b, took } = boots({ settleMs: 1_000 });
    b.born("run-a", false);
    b.said("run-a");
    vi.advanceTimersByTime(900);
    b.said("run-a");
    vi.advanceTimersByTime(100);
    expect(took).toEqual(["run-a"]);
  });

  it("a run that had said it started when it entered waits the settle alone", () => {
    const { b, took } = boots({ settleMs: 500 });
    b.born("run-a", true);
    expect(b.takesInput("run-a")).toBe(false);
    vi.advanceTimersByTime(500);
    expect(took).toEqual(["run-a"]);
  });

  it("a turn that begins ends the wait at once: the pane is taking input", () => {
    const { b, took } = boots();
    b.born("run-a", false);
    b.turned("run-a");
    expect(b.takesInput("run-a")).toBe(true);
    expect(took).toEqual(["run-a"]);
    // and a turn in a run that does not wait tells nobody
    b.turned("run-a");
    expect(took).toEqual(["run-a"]);
  });

  it("a run that never says it started takes input after the bound, said once in the log", () => {
    const { b, took, logged } = boots();
    b.born("run-a", false);
    vi.advanceTimersByTime(AGENT_START.SAID_WITHIN_MS - 1);
    expect(b.takesInput("run-a")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(b.takesInput("run-a")).toBe(true);
    expect(took).toEqual(["run-a"]);
    expect(logged).toEqual(["info:fieldd.agents.start_unsaid"]);
  });

  it("a run that ended while it waited tells nobody", () => {
    const { b, took } = boots();
    b.born("run-a", false);
    b.said("run-a");
    b.forget("run-a");
    vi.advanceTimersByTime(60_000);
    expect(took).toEqual([]);
    expect(b.takesInput("run-a")).toBe(true);
  });

  it("a bound of zero is no wait at all (the scripted agent's rows)", () => {
    const { b, took } = boots({ settleMs: 0, saidWithinMs: 0 });
    b.born("run-a", false);
    expect(b.takesInput("run-a")).toBe(true);
    expect(took).toEqual(["run-a"]);
    b.born("run-b", true);
    expect(b.takesInput("run-b")).toBe(true);
  });

  it("each run waits by itself", () => {
    const { b, took } = boots({ settleMs: 100 });
    b.born("run-a", false);
    b.born("run-b", false);
    b.said("run-b");
    vi.advanceTimersByTime(100);
    expect(took).toEqual(["run-b"]);
    expect(b.takesInput("run-a")).toBe(false);
  });
});
