// CP-4a2a (CP-D8) — the one compartment a run's script is evaluated in, after `lockdown()`: its globals are the flow
// API alone (`agent`, `ask`, `log`, `phase`) beside JavaScript's own, tamed intrinsics.
//
// SKELETON (the red, commit 5): it evaluates nothing.

/** The flow API, as the host hands it to the compartment. */
export interface FlowApi {
  readonly agent: (prompt: unknown, options?: unknown) => Promise<unknown>;
  readonly ask: (question: unknown, choices?: unknown) => Promise<unknown>;
  readonly log: (text: unknown) => void;
  readonly phase: (name: unknown, fn: unknown) => unknown;
}

/** Evaluate the rewritten script in a compartment of its own: the default export, as the script's promise gives it. */
export function evaluateFlow(_script: string, _api: FlowApi): Promise<unknown> {
  return Promise.resolve(undefined);
}
