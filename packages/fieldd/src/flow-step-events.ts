import { createNoopLogger, type Logger } from "@vibefield/logging";
import { ownLive, type RunEntered } from "./run-entry";

// CP-4a2b (§13a slice 4; CP4-S2, CP4-Q17 as re-ruled) — a flow step's turn end, read in fieldd from puppeteer's
// provider-neutral events, never from a transcript, a vendor's file, rosetta or History (AR-L1). The runs
// (flows/runs.ts) hear it through this interface, so `flows/` imports no puppeteer (R29/R31). It hears a run as it
// enters the agent runtime (`onRunEntered`), and listens only to a run a flow started: `origin {by: "flow", run, call}`.
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

/** The step listener: one per fieldd, told every run as it enters, and telling the runs each step's turn end. */
export class FlowStepEvents {
  readonly #listeners = new Set<(end: FlowStepTurnEnd) => void>();
  /** each step's run listened to, by its runtime run: how to stop listening */
  readonly #runs = new Map<string, readonly (() => void)[]>();

  constructor(readonly logger: Logger = createNoopLogger()) {}

  /** Hear each step's turn end. */
  onTurnEnd(listener: (end: FlowStepTurnEnd) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A run entered the agent runtime: a flow's step is listened to from here, once in this fieldd's life. */
  entered(entered: RunEntered): void {
    const { agent, runtimeRunId, origin } = entered;
    if (origin?.by !== "flow" || typeof origin.run !== "string" || typeof origin.call !== "number")
      return;
    if (this.#runs.has(runtimeRunId)) return;
    const step = { run: origin.run, call: origin.call, runtimeRunId };
    /** the turn's last final message, not displayOnly, so far */
    let last: string | undefined;
    /** the turns already told */
    const told = new Set<string>();
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
      if (turn !== undefined && told.has(turn)) return false;
      if (turn !== undefined) told.add(turn);
      return true;
    };
    this.#runs.set(runtimeRunId, [
      agent.on("turn:started", (envelope) => {
        if (ownLive(envelope)) last = undefined;
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
    ]);
  }

  /** A run ended: its listeners go. */
  forget(runtimeRunId: string): void {
    for (const off of this.#runs.get(runtimeRunId) ?? []) off();
    this.#runs.delete(runtimeRunId);
  }
}
