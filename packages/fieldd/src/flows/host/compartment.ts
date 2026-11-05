import "ses";

// CP-4a2a (CP-D8) — the one compartment a run's script is evaluated in, after `lockdown()` (main.ts): its globals are
// the flow API alone (`agent`, `ask`, `log`, `phase`) beside JavaScript's own intrinsics, which lockdown froze and SES
// tamed for every compartment (no clock: `Date.now()` and `new Date()` throw; no randomness: `Math.random()` throws).
// No `require`, `process`, `fetch`, timer or console reaches it, and SES refuses a dynamic `import()` in its source
// before it runs (SES_IMPORT_REJECTED). The script reaches the world only through the API's calls, each a message on
// the host's pipe.

/** The flow API, as the host hands it to the compartment (hardened there). */
export interface FlowApi {
  readonly agent: (prompt: unknown, options?: unknown) => Promise<unknown>;
  readonly ask: (question: unknown, choices?: unknown) => Promise<unknown>;
  readonly log: (text: unknown) => void;
  readonly phase: (name: unknown, fn: unknown) => unknown;
}

/** Evaluate the rewritten script (module-script.ts) in a compartment of its own: the default export, as the
 * script's promise gives it. Throws as the script throws, and as SES refuses it. */
export function evaluateFlow(script: string, api: FlowApi): Promise<unknown> {
  const globals = harden({ agent: api.agent, ask: api.ask, log: api.log, phase: api.phase });
  const compartment = new Compartment(globals, {}, { name: "flow" });
  return Promise.resolve(compartment.evaluate(script));
}
