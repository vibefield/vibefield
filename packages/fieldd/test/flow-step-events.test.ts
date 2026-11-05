import { describe, expect, it } from "vitest";
import { FlowStepEvents, type FlowStepTurnEnd } from "../src/flow-step-events";
import type { RunEntered, RunEnteredAgent } from "../src/run-entry";

// CP-4a2b (§13a slice 4; CP4-S2, CP4-Q17 as re-ruled) — a flow step's turn end, read from puppeteer's provider-neutral
// events in fieldd (flow-step-events.ts): `turn:completed`'s `lastAssistantMessage`, else the turn's last final message
// that is not `displayOnly`, the run's own and live alone, each turn's end told once. The run is a fake Agent: its
// `.on` surface, as spark-transcripts.test.ts fakes it.

/** A run as puppeteer's Agent hands it: its `.on` surface, and how many listeners it holds. */
function fakeAgent() {
  const listeners = new Map<string, Set<(envelope: unknown) => void>>();
  let sequence = 0;
  const agent = {
    on: (selector: string, listener: (envelope: unknown) => void) => {
      const set = listeners.get(selector) ?? new Set();
      set.add(listener);
      listeners.set(selector, set);
      return () => set.delete(listener);
    },
    monitor: {},
  } as unknown as RunEnteredAgent;
  const emit = (
    type: string,
    event: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) => {
    const env = {
      type,
      category: type.split(":")[0],
      sequence: ++sequence,
      sessionId: "pty-step",
      timestamp: "2026-11-05T22:00:00.000Z",
      monotonicTime: sequence,
      source: "hook",
      confidence: "high",
      event: { type, ...event },
      ...envelope,
    };
    for (const selector of ["*", `${type.split(":")[0]}:*`, type])
      for (const listener of listeners.get(selector) ?? []) listener(env);
  };
  const held = () => [...listeners.values()].reduce((count, set) => count + set.size, 0);
  return { agent, emit, held };
}

/** A flow run's step, as the runs start it (CP-D15). */
const FLOW = { by: "flow", run: "fr-s2a4b6c8", call: 3 } as const;
const RUN = "run-step-1";

/** A listener, and one run entered with `origin` (`null`: a run whose record names none). */
function entered(origin: RunEntered["origin"] | null = FLOW) {
  const events = new FlowStepEvents();
  const heard: FlowStepTurnEnd[] = [];
  events.onTurnEnd((end) => heard.push(end));
  const run = fakeAgent();
  events.entered({
    agent: run.agent,
    runtimeRunId: RUN,
    begun: "spawn",
    ...(origin !== null && origin !== undefined ? { origin } : {}),
  });
  return { events, heard, ...run };
}

const said = (text: string, over: Record<string, unknown> = {}) => ({
  messageId: `m-${text}`,
  turnId: "t1",
  text,
  ...over,
});

describe("CP-4a2b — a flow step's turn end (CP4-S2)", () => {
  it("SE1: `turn:completed`'s `lastAssistantMessage` is the result, over any message the turn said", () => {
    const { heard, emit } = entered();
    emit("turn:started", { turnId: "t1" });
    emit("conversation:assistant-message", said("a draft along the way"));
    emit("turn:completed", { turnId: "t1", lastAssistantMessage: "The branch is clean." });
    expect(heard).toEqual([
      {
        run: FLOW.run,
        call: FLOW.call,
        runtimeRunId: RUN,
        turn: "t1",
        outcome: "completed",
        text: "The branch is clean.",
      },
    ]);
  });

  it("SE2: else the turn's last message that is final and not `displayOnly`; an earlier turn's never carries", () => {
    const { heard, emit } = entered();
    emit("turn:started", { turnId: "t0" });
    emit("conversation:assistant-message", said("the first turn's words", { turnId: "t0" }));
    emit("turn:completed", { turnId: "t0" });
    emit("turn:started", { turnId: "t1" });
    emit("conversation:assistant-message", said("first"));
    emit("conversation:assistant-message", said("second", { final: true }));
    emit("conversation:assistant-message", said("shown on screen", { displayOnly: true }));
    emit("conversation:assistant-message", said("still thinking", { final: false }));
    emit("turn:completed", { turnId: "t1" });
    expect(heard.map((end) => [end.turn, end.text])).toEqual([
      ["t0", "the first turn's words"],
      ["t1", "second"],
    ]);
  });

  it("SE3: only the run's own conversation, live: a subagent's words and turn end, and a replay, are never heard", () => {
    const { heard, emit } = entered();
    emit("turn:started", { turnId: "t1" });
    emit("conversation:assistant-message", said("the step's own words"));
    emit("conversation:assistant-message", said("a subagent's words"), { agentId: "sub-1" });
    emit("conversation:assistant-message", said("words from history"), { replay: true });
    emit(
      "turn:completed",
      { turnId: "t1", lastAssistantMessage: "a subagent's end" },
      {
        agentId: "sub-1",
      },
    );
    emit(
      "turn:completed",
      { turnId: "t0", lastAssistantMessage: "a replayed end" },
      {
        replay: true,
      },
    );
    expect(heard).toEqual([]);
    emit("turn:completed", { turnId: "t1" });
    expect(heard.map((end) => end.text)).toEqual(["the step's own words"]);
  });

  it("SE4: `turn:failed` is told as a failed turn, with no result", () => {
    const { heard, emit } = entered();
    emit("turn:started", { turnId: "t1" });
    emit("conversation:assistant-message", said("half an answer"));
    emit("turn:failed", { turnId: "t1", error: "the provider stopped" });
    expect(heard).toEqual([
      { run: FLOW.run, call: FLOW.call, runtimeRunId: RUN, turn: "t1", outcome: "failed" },
    ]);
  });

  it("SE5: a run that is not a flow's holds no listener of this one; a step's run let go holds none either", () => {
    for (const origin of [null, { by: "you" }, { by: "spark", spark: "sp-7k2m9q4x" }]) {
      const { heard, emit, held } = entered(origin);
      expect(held(), JSON.stringify(origin)).toBe(0);
      emit("turn:completed", { turnId: "t1", lastAssistantMessage: "not a step's" });
      expect(heard).toEqual([]);
    }
    const step = entered();
    expect(step.held()).toBeGreaterThan(0);
    step.events.forget(RUN);
    expect(step.held()).toBe(0);
  });

  it("SE6: a turn that said nothing is told with no text: no `lastAssistantMessage`, and only blank or displayOnly words", () => {
    const { heard, emit } = entered();
    emit("turn:started", { turnId: "t1" });
    emit("conversation:assistant-message", said("   "));
    emit("conversation:assistant-message", said("shown on screen", { displayOnly: true }));
    emit("turn:completed", { turnId: "t1", lastAssistantMessage: "  " });
    expect(heard).toEqual([
      { run: FLOW.run, call: FLOW.call, runtimeRunId: RUN, turn: "t1", outcome: "completed" },
    ]);
    expect(heard[0]).not.toHaveProperty("text");
  });

  it("SE7: a turn's end heard twice is told once: the same turn's end again, and the run entered twice (CL-H6)", () => {
    const { events, heard, emit, agent } = entered();
    // a re-attach in this fieldd's life tells the run again: it is listened to once
    events.entered({ agent, runtimeRunId: RUN, begun: "reattach", origin: FLOW });
    emit("turn:started", { turnId: "t1" });
    emit("turn:completed", { turnId: "t1", lastAssistantMessage: "done" });
    emit("turn:completed", { turnId: "t1", lastAssistantMessage: "done, said late" });
    expect(heard.map((end) => [end.turn, end.text])).toEqual([["t1", "done"]]);
  });
});
