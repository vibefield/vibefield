import type { Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import { FlowStepEvents, type FlowStepTurnEnd } from "../src/flow-step-events";
import type { RunEntered } from "../src/run-entry";
import { fakeAgent } from "./flow-step-agent";

// CP-4a2b (§13a slice 4; CP4-S2, CP4-Q17 as re-ruled) — a flow step's turn end, read from puppeteer's provider-neutral
// events in fieldd (flow-step-events.ts): `turn:completed`'s `lastAssistantMessage`, else the turn's last final message
// that is not `displayOnly`, the run's own and live alone, each turn's end told once. The run is a fake Agent: its
// `.on` surface, as spark-transcripts.test.ts fakes it (flow-step-agent.ts).

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

  it("SE8 (slices 7–9 review F3; DD1): the same end told again, nothing of the run's own heard since, is told once whatever its id, unless both carry ids that differ; a failure after a completion, the next turn, or an end after the run's own words is told", () => {
    /** One run's events, from a fresh listener: each end it told, as its outcome, its turn and its text. */
    const leg = (...events: readonly (readonly [string, Record<string, unknown>])[]) => {
      const { heard, emit } = entered();
      for (const [type, event] of events) emit(type, event);
      return heard.map((end) => [end.outcome, end.turn, end.text]);
    };
    const missed = { lastAssistantMessage: "no json here" };
    // 1: an end with an id, then the same end with none
    expect(
      leg(
        ["turn:started", { turnId: "t1" }],
        ["turn:completed", { turnId: "t1", ...missed }],
        ["turn:completed", missed],
      ),
    ).toEqual([["completed", "t1", "no json here"]]);
    // 2: the mirror, an end with no id and then the same end with one
    expect(
      leg(
        ["turn:started", {}],
        ["turn:completed", missed],
        ["turn:completed", { turnId: "t1", ...missed }],
      ),
    ).toEqual([["completed", undefined, "no json here"]]);
    // 3: the declared gap: an own message between the two, even one only shown, makes the second an end
    expect(
      leg(
        ["turn:started", {}],
        ["turn:completed", missed],
        ["conversation:assistant-message", said("shown", { turnId: undefined, displayOnly: true })],
        ["turn:completed", missed],
      ),
    ).toEqual([
      ["completed", undefined, "no json here"],
      ["completed", undefined, "no json here"],
    ]);
    // 4: a failure after a completion, nothing between: another outcome is another end, and it is heard
    expect(leg(["turn:started", {}], ["turn:completed", missed], ["turn:failed", {}])).toEqual([
      ["completed", undefined, "no json here"],
      ["failed", undefined, undefined],
    ]);
    // 5: the same end said by two sources, the second without its text
    expect(
      leg(
        ["turn:started", {}],
        ["turn:completed", { lastAssistantMessage: "X" }],
        ["turn:completed", {}],
      ),
    ).toEqual([["completed", undefined, "X"]]);
    // the repair's turn, heard starting, is its own end; so is one after the run's own words
    expect(
      leg(
        ["turn:started", {}],
        ["turn:completed", missed],
        ["turn:completed", missed],
        ["turn:started", {}],
        ["turn:completed", { lastAssistantMessage: "the repaired answer" }],
        ["conversation:assistant-message", said("and once more", { turnId: undefined })],
        ["turn:failed", {}],
      ),
    ).toEqual([
      ["completed", undefined, "no json here"],
      ["completed", undefined, "the repaired answer"],
      ["failed", undefined, undefined],
    ]);
    // distinct ids are distinct turns (CL-H6), though nothing was heard between them
    const ids = leg(["turn:completed", { turnId: "t1" }], ["turn:completed", { turnId: "t2" }]);
    expect(ids).toEqual([
      ["completed", "t1", undefined],
      ["completed", "t2", undefined],
    ]);
    // FF1 (1i review): a refused duplicate that says its id adds it to the turns told, so a late copy of it, after the
    // next turn started, is refused on the id road
    expect(
      leg(
        ["turn:started", {}],
        ["turn:completed", missed],
        ["turn:completed", { turnId: "t1", ...missed }],
        ["turn:started", { turnId: "t2" }],
        ["turn:completed", { turnId: "t1", ...missed }],
      ),
    ).toEqual([["completed", undefined, "no json here"]]);
  });
});

// CP-4a2b (§13a slice 9b; ruled 2026-11-06) — a step handed a live session by `in:` (D9). That session is no flow's run
// (your own, here), so nothing listens to it until the runs hand it: from the hand, its turn ends are told as the
// step's `{run, call}` by the same road, from the first turn:started the listener HEARS after the hand (a turn heard
// starting before the hand is never the step's; one whose turn:started arrives late is, review F2, until slice 15 arms
// at the paste), each turn's end once (CL-H6), until the runs let it go or the session ends.

/** A handed step: call 2 of a run. */
const STEP = { run: "fr-h4nd3d00", call: 2 } as const;
const YOURS = "run-yours-1";

/** A listener, and your own session entered with no flow's origin, as an `in:` finds it. */
function yours(logger?: Logger) {
  const events = new FlowStepEvents(logger);
  const heard: FlowStepTurnEnd[] = [];
  events.onTurnEnd((end) => heard.push(end));
  const run = fakeAgent();
  events.entered({ agent: run.agent, runtimeRunId: YOURS, begun: "spawn", origin: { by: "you" } });
  return { events, heard, ...run };
}

/** A logger that keeps each warning's event. */
function warnings(events: string[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event) => void events.push(event),
    error: () => undefined,
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  return logger;
}

describe("CP-4a2b — a session an `in:` hands a step (§13a slice 9b)", () => {
  it("SH1: a session handed a step is listened to from the hand, and its next turn's end is told as that step's, by the same road", () => {
    const { events, heard, emit, held } = yours();
    expect(held()).toBe(0);
    emit("turn:started", { turnId: "t0" });
    emit("turn:completed", { turnId: "t0", lastAssistantMessage: "before the hand" });
    events.hand(YOURS, STEP);
    expect(held()).toBeGreaterThan(0);
    emit("turn:started", { turnId: "t1" });
    emit("conversation:assistant-message", said("Looked at it."));
    emit("conversation:assistant-message", said("shown on screen", { displayOnly: true }));
    emit("turn:completed", { turnId: "t1" });
    expect(heard).toEqual([
      {
        run: STEP.run,
        call: STEP.call,
        runtimeRunId: YOURS,
        turn: "t1",
        outcome: "completed",
        text: "Looked at it.",
      },
    ]);
  });

  it("SH2: a turn heard starting before the hand is never the step's, with turn ids and with none; the next turn heard starting is", () => {
    const withIds = yours();
    withIds.emit("turn:started", { turnId: "t0" });
    withIds.emit("conversation:assistant-message", said("your own words", { turnId: "t0" }));
    withIds.events.hand(YOURS, STEP);
    withIds.emit("turn:completed", { turnId: "t0", lastAssistantMessage: "your own turn's end" });
    expect(withIds.heard).toEqual([]);
    withIds.emit("turn:started", { turnId: "t1" });
    withIds.emit("turn:completed", { turnId: "t1", lastAssistantMessage: "the step's end" });
    expect(withIds.heard.map((end) => [end.turn, end.text])).toEqual([["t1", "the step's end"]]);
    // a provider that says no turn ids: the turn heard starting before the hand fails, and is still not the step's
    const bare = yours();
    bare.emit("turn:started", {});
    bare.emit("conversation:assistant-message", said("in flight", { turnId: undefined }));
    bare.events.hand(YOURS, STEP);
    bare.emit("turn:failed", {});
    expect(bare.heard).toEqual([]);
    bare.emit("turn:started", {});
    bare.emit("conversation:assistant-message", said("the step's words", { turnId: undefined }));
    bare.emit("turn:completed", {});
    expect(bare.heard).toEqual([
      {
        run: STEP.run,
        call: STEP.call,
        runtimeRunId: YOURS,
        outcome: "completed",
        text: "the step's words",
      },
    ]);
  });

  it("SH3: let go, a handed session is told nothing more: at the runs' word (the answer, a failed turn, the run's end), and at the session's own end", () => {
    const { events, heard, emit, held } = yours();
    const off = events.hand(YOURS, STEP);
    expect(off).toBeDefined();
    emit("turn:started", { turnId: "t1" });
    emit("turn:failed", { turnId: "t1", error: "the provider stopped" });
    off?.();
    expect(held()).toBe(0);
    emit("turn:started", { turnId: "t2" });
    emit("turn:completed", { turnId: "t2", lastAssistantMessage: "your next turn" });
    expect(heard.map((end) => [end.turn, end.outcome])).toEqual([["t1", "failed"]]);
    // handed again, then the session ends: its hands go with it
    events.hand(YOURS, { ...STEP, call: 3 });
    expect(held()).toBeGreaterThan(0);
    events.forget(YOURS);
    expect(held()).toBe(0);
    emit("turn:started", { turnId: "t3" });
    emit("turn:completed", { turnId: "t3", lastAssistantMessage: "after its end" });
    expect(heard).toHaveLength(1);
  });

  it("SH4: a handed turn's end heard twice is told once, a step handed twice is listened to once (CL-H6), and a session that is another step of the same run (A3) is told as each", () => {
    const { events, heard, emit, held } = yours();
    events.hand(YOURS, STEP);
    const once = held();
    events.hand(YOURS, STEP);
    expect(held()).toBe(once);
    emit("turn:started", { turnId: "t1" });
    emit("turn:completed", { turnId: "t1", lastAssistantMessage: "done" });
    emit("turn:completed", { turnId: "t1", lastAssistantMessage: "done, said late" });
    expect(heard.map((end) => [end.call, end.turn, end.text])).toEqual([[STEP.call, "t1", "done"]]);
    // A3: an in: naming a step of this run: the session is the run's call 1, and is handed call 2
    const step = entered({ by: "flow", run: STEP.run, call: 1 });
    step.events.hand(RUN, STEP);
    step.emit("turn:started", { turnId: "t5" });
    step.emit("turn:completed", { turnId: "t5", lastAssistantMessage: "the follow-up" });
    expect(step.heard.map((end) => [end.call, end.turn])).toEqual([
      [1, "t5"],
      [STEP.call, "t5"],
    ]);
  });

  it("SH5 (review F3): a session this fieldd never heard enter is not heard: the hand answers none, holds nothing, and says so once", () => {
    const logged: string[] = [];
    const events = new FlowStepEvents(warnings(logged));
    expect(events.hand("run-never", STEP)).toBeUndefined();
    expect(logged).toEqual(["fieldd.flows.step_hand_unheard"]);
    // a session heard enter, then ended, is not heard either
    const { events: heard, held } = yours();
    heard.forget(YOURS);
    expect(heard.hand(YOURS, STEP)).toBeUndefined();
    expect(held()).toBe(0);
  });

  it("RH1 (slice 14, Q18 (a); D869): a re-hand `inTurn` hears the turn begun before it: that turn's end is the step's, with turn ids and with none, and SH2's hand without it still hears none", () => {
    // red-a: `hand` takes no third argument, so a turn begun before the hand is never the step's (SH2's rule)
    // Kills: `inTurn` unread (the turn in flight dropped, so a boot's re-hand waits on R45's ask)
    /** `hand`, with slice 14's third argument (Q18 (a)): red-a's signature has none, so it is reached through a cast */
    const handInTurn = (events: FlowStepEvents, runtimeRunId: string) =>
      (
        events as unknown as {
          hand(
            id: string,
            step: { readonly run: string; readonly call: number },
            opts: { readonly inTurn: true },
          ): (() => void) | undefined;
        }
      ).hand(runtimeRunId, STEP, { inTurn: true });
    const withIds = yours();
    withIds.emit("turn:started", { turnId: "t0" });
    withIds.emit(
      "conversation:assistant-message",
      said("in flight at the restart", { turnId: "t0" }),
    );
    handInTurn(withIds.events, YOURS);
    withIds.emit("turn:completed", { turnId: "t0", lastAssistantMessage: "the step's answer" });
    const bare = yours();
    bare.emit("turn:started", {});
    handInTurn(bare.events, YOURS);
    bare.emit("conversation:assistant-message", said("the step's words", { turnId: undefined }));
    bare.emit("turn:completed", {});
    expect({
      withIds: withIds.heard.map((end) => [end.call, end.turn, end.text]),
      bare: bare.heard.map((end) => [end.call, end.outcome, end.text]),
    }).toEqual({
      withIds: [[STEP.call, "t0", "the step's answer"]],
      bare: [[STEP.call, "completed", "the step's words"]],
    });
  });

  it("R46d, the listener's half (slice 14, Q8 (a), Q17; D930): a flow's step entered with `begun: \"resume\"` tells `onResumed` its run, call and new session; a spawn, a re-attach, an adoption, and a resume with no flow origin tell nothing", () => {
    // red-b: FlowStepEvents has no `onResumed`, reached through a cast, so nothing is told
    // Kills: `entered` not telling `onResumed` (every resumed step waits on a dead session); told for any `begun`; told
    // for a resume whose origin is no flow's
    const events = new FlowStepEvents();
    const told: unknown[] = [];
    (
      events as unknown as { onResumed?(listener: (step: unknown) => void): () => void }
    ).onResumed?.((step) => told.push(step));
    const enter = (runtimeRunId: string, begun: RunEntered["begun"], origin?: typeof FLOW) =>
      events.entered({
        agent: fakeAgent().agent,
        runtimeRunId,
        begun,
        ...(origin !== undefined ? { origin } : {}),
      });
    enter("run-spawned", "spawn", FLOW);
    enter("run-reattached", "reattach", FLOW);
    enter("run-adopted", "adopt", FLOW);
    enter("run-yours-resumed", "resume");
    enter("run-resumed", "resume", FLOW);
    expect(told).toEqual([{ run: FLOW.run, call: FLOW.call, runtimeRunId: "run-resumed" }]);
  });
});
