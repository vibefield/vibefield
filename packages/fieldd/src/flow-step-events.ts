import { createNoopLogger, type Logger } from "@vibefield/logging";
import { ownLive, type RunEntered, type RunEnteredAgent } from "./run-entry";

// CP-4a2b (§13a slice 4; CP4-S2, CP4-Q17 as re-ruled) — a flow step's turn end, read in fieldd from puppeteer's
// provider-neutral events, never from a transcript, a vendor's file, rosetta or History (AR-L1). The runs
// (flows/runs.ts) hear it through this interface, so `flows/` imports no puppeteer (R29/R31). It hears a run as it
// enters the agent runtime (`onRunEntered`), and listens to a run a flow started: `origin {by: "flow", run, call}`.
// Since slice 9b it keeps every run's handle until its end, listening to none, so a session an `in:` hands a step
// (D9) is listened to as that step's from the hand, until the runs let it go: from the first turn:started this
// listener HEARS after the hand. That is not "a turn that starts after the hand": a turn begun before it whose
// turn:started arrives after it (IPC) reads as the step's, and so do a turn you start before the line's paste and, with
// two hands on one session, the first hand's turn for the second (review F1, F2). Slice 15 arms each hand at its own
// line's paste.
// The road (step0-cp4.md CP4-S2):
// - `turn:completed`'s `lastAssistantMessage`, the provider's own final text when it gives one (Claude's Stop hook);
// - else the turn's last `conversation:assistant-message` that is final (not `final: false`) and not `displayOnly`,
//   as Codex sends it. Neither the monitor's `lastAssistantMessage` (cut at 400 characters) nor a transcript;
// - the run's own conversation, live, alone (`ownLive`): never a subagent's words or end, never a replay;
// - a turn's end is told once by its turn id (CL-H6). A later fieldd hears its runs afresh; the journal keeps one
//   answer for one call whatever it is told (D22).

/** A flow step's turn end, as the runs hear it. */
export interface FlowStepTurnEnd {
  /** the flow run and its call that started the step (its origin, CP-D15) */
  readonly run: string;
  readonly call: number;
  readonly runtimeRunId: string;
  /** puppeteer's turn id, when it said one */
  readonly turn?: string;
  /** `completed`: the turn ended; `failed`: puppeteer said it failed, and it has no result */
  readonly outcome: "completed" | "failed";
  /** a completed turn's result, whole (D11 bounds it): `lastAssistantMessage`, else the turn's last final message
   * that is not `displayOnly`; absent when the turn said none */
  readonly text?: string;
}

/** Words a result may be: some text, never blanks. */
const worded = (text: string | undefined): text is string =>
  typeof text === "string" && text.trim() !== "";

/** A step whose session's events are listened to: its run, its call, and the session it works in. */
interface StepAt {
  readonly run: string;
  readonly call: number;
  readonly runtimeRunId: string;
}

/** The step listener: one per fieldd, told every run as it enters, and telling the runs each step's turn end. */
export class FlowStepEvents {
  readonly #listeners = new Set<(end: FlowStepTurnEnd) => void>();
  /** each step's run listened to, by its runtime run: how to stop listening */
  readonly #runs = new Map<string, readonly (() => void)[]>();
  /** every run's agent as it entered, until its end, listened to by nothing until a hand (9b) */
  readonly #agents = new Map<string, RunEnteredAgent>();
  /** each handed session's steps, by the session and then by `‹run› ‹call›`: how to let each go (9b) */
  readonly #hands = new Map<string, Map<string, () => void>>();

  constructor(readonly logger: Logger = createNoopLogger()) {}

  /** Hear each step's turn end. */
  onTurnEnd(listener: (end: FlowStepTurnEnd) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** CP-4a2b (§13a slice 9b): a session an `in:` hands a flow's step (D9), listened to as that step's until the answer
   * is called or the session ends. The step's turn is the first whose turn:started this listener hears after the hand:
   * a turn whose turn:started was heard before the hand is never the step's, but one begun before the hand whose
   * turn:started arrives after it is (review F2), until slice 15 arms the hand at its line's paste. The same step
   * handed again is listened to once (CL-H6). A session this fieldd never heard enter (or heard end) is not heard: it
   * answers none and holds nothing, and fieldd's warn says why, so the runs refuse the step before its line is queued
   * (review F3). */
  hand(
    runtimeRunId: string,
    step: { readonly run: string; readonly call: number },
  ): (() => void) | undefined {
    const key = `${step.run} ${step.call}`;
    const hands = this.#hands.get(runtimeRunId) ?? new Map<string, () => void>();
    const kept = hands.get(key);
    if (kept !== undefined) return kept;
    const agent = this.#agents.get(runtimeRunId);
    if (agent === undefined) {
      this.logger.warn(
        "fieldd.flows.step_hand_unheard",
        "A flow step was handed a session this fieldd has not heard enter; the step is refused, its line never queued",
        { runtimeRunId, run: step.run, call: step.call },
      );
      return undefined;
    }
    const offs = this.#listen(agent, { run: step.run, call: step.call, runtimeRunId }, true);
    let gone = false;
    const off = () => {
      if (gone) return;
      gone = true;
      for (const each of offs) each();
      hands.delete(key);
      if (hands.size === 0 && this.#hands.get(runtimeRunId) === hands)
        this.#hands.delete(runtimeRunId);
    };
    hands.set(key, off);
    this.#hands.set(runtimeRunId, hands);
    return off;
  }

  /** A run entered the agent runtime: its handle is kept for a hand (9b), and a flow's step is listened to from here,
   * once in this fieldd's life. */
  entered(entered: RunEntered): void {
    const { agent, runtimeRunId, origin } = entered;
    this.#agents.set(runtimeRunId, agent);
    if (origin?.by !== "flow" || typeof origin.run !== "string" || typeof origin.call !== "number")
      return;
    if (this.#runs.has(runtimeRunId)) return;
    this.#runs.set(
      runtimeRunId,
      this.#listen(agent, { run: origin.run, call: origin.call, runtimeRunId }, false),
    );
  }

  /** A run ended: its listeners go, the hands on it among them, and its handle with them. */
  forget(runtimeRunId: string): void {
    for (const off of this.#runs.get(runtimeRunId) ?? []) off();
    this.#runs.delete(runtimeRunId);
    for (const off of [...(this.#hands.get(runtimeRunId)?.values() ?? [])]) off();
    this.#hands.delete(runtimeRunId);
    this.#agents.delete(runtimeRunId);
  }

  /** One step's listening on its session (CP4-S2's road): each turn's end told once (CL-H6). `fromHand`: only a turn
   * whose turn:started was HEARD after the listening began is told (9b), so a turn heard starting before the hand never
   * is; one whose turn:started arrives late is (review F2; slice 15 arms at the paste). */
  #listen(agent: RunEnteredAgent, step: StepAt, fromHand: boolean): (() => void)[] {
    const { runtimeRunId } = step;
    /** the turn's last final message, not displayOnly, so far */
    let last: string | undefined;
    /** the turns already told */
    const told = new Set<string>();
    /** for a hand: the turn that started since it, by its id when it said one; none while none has */
    let started: { readonly turn: string | undefined } | undefined;
    // a listener that throws is said, never thrown into puppeteer's own emitter
    const tell = (end: FlowStepTurnEnd) => {
      for (const listener of this.#listeners) {
        try {
          listener(end);
        } catch (err) {
          this.logger.warn(
            "fieldd.flows.step_listener_failed",
            "A flow step's turn-end listener threw",
            {
              runtimeRunId,
              reason: (err as Error).message,
            },
          );
        }
      }
    };
    const ended = (turn: string | undefined): boolean => {
      if (fromHand) {
        // a turn heard starting before the hand ends with none heard started since, or as another turn than that one
        if (started === undefined) return false;
        if (started.turn !== undefined && turn !== undefined && started.turn !== turn) return false;
        started = undefined;
      }
      if (turn !== undefined && told.has(turn)) return false;
      if (turn !== undefined) told.add(turn);
      return true;
    };
    return [
      agent.on("turn:started", (envelope) => {
        if (!ownLive(envelope)) return;
        last = undefined;
        if (fromHand) started = { turn: envelope.event.turnId ?? envelope.turnId };
      }),
      agent.on("conversation:assistant-message", (envelope) => {
        if (!ownLive(envelope)) return;
        const message = envelope.event;
        if (message.displayOnly === true || message.final === false || !worded(message.text))
          return;
        last = message.text;
      }),
      agent.on("turn:completed", (envelope) => {
        if (!ownLive(envelope)) return;
        const turn = envelope.event.turnId ?? envelope.turnId;
        if (!ended(turn)) return;
        const said = envelope.event.lastAssistantMessage;
        const text = worded(said) ? said : last;
        last = undefined;
        tell({
          ...step,
          ...(turn !== undefined ? { turn } : {}),
          outcome: "completed",
          ...(text !== undefined ? { text } : {}),
        });
      }),
      agent.on("turn:failed", (envelope) => {
        if (!ownLive(envelope)) return;
        const turn = envelope.event.turnId ?? envelope.turnId;
        if (!ended(turn)) return;
        last = undefined;
        tell({ ...step, ...(turn !== undefined ? { turn } : {}), outcome: "failed" });
      }),
    ];
  }
}
