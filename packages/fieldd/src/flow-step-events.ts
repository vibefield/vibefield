import type { RunEntered } from "./run-entry";

// CP-4a2b (§13a slice 4; CP4-S2, CP4-Q17 as re-ruled) — a flow step's turn end, read in fieldd from puppeteer's
// provider-neutral events, never from a transcript, a vendor's file, rosetta or History (AR-L1). The runs
// (flows/runs.ts) hear it through this interface, so `flows/` imports no puppeteer (R29/R31). It hears a run as it
// enters the agent runtime (`onRunEntered`), and listens only to a run a flow started: `origin {by: "flow", run, call}`.
//
// SKELETON (the red commit): it hears nothing yet.

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

/** The step listener: one per fieldd, told every run as it enters, and telling the runs each step's turn end. */
export class FlowStepEvents {
  readonly #listeners = new Set<(end: FlowStepTurnEnd) => void>();

  /** Hear each step's turn end. */
  onTurnEnd(listener: (end: FlowStepTurnEnd) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A run entered the agent runtime: a flow's step is listened to from here. */
  entered(_run: RunEntered): void {}

  /** A run ended: its listeners go. */
  forget(_runtimeRunId: string): void {}
}
