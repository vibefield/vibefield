import "ses";

// CP-4a2a (CP-D8) — the one compartment a run's script is evaluated in, after `lockdown()` (main.ts): its globals are
// the flow API alone (`agent`, `ask`, `log`, `phase`), and three names pinned undefined (CP-4a2b, below), beside
// JavaScript's own intrinsics, which lockdown froze and SES tamed for every compartment (no clock: `Date.now()` and
// `new Date()` throw; no randomness: `Math.random()` throws).
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

// CP-4a2b (Q-B4 (a), narrowed by VF-PM 2026-11-05 16:24Z; the finding accepted 16:36Z) — three names are pinned
// `undefined` as the compartment's own globals, on top of the host's memory cap, never instead of it:
// - WebAssembly, a compiler and engine surface no flow needs, whose `Memory` is a fast road to memory off V8's heap;
// - SharedArrayBuffer and Atomics, shared memory and a wait no flow needs (a worker parked in `Atomics.wait` misses
//   its pings and ends `unanswered` either way).
// SES 2.3.0 already omits all three from every compartment; the pin is ours so a ses bump cannot re-admit them
// (flows-sandbox.test.ts's H2c rows). Not pinned, on purpose: the typed arrays, ArrayBuffer, DataView and
// TextEncoder, whose one harm is memory, which the host's cap holds and its memory rows prove end to end (H25, H27,
// H28); and Compartment, since SES leaves `eval` and `Function` in every compartment, confined, so a nested one opens
// no road to dynamic code and holds no power (H2b-7).
const PINNED_UNDEFINED = {
  WebAssembly: undefined,
  SharedArrayBuffer: undefined,
  Atomics: undefined,
};

/** Evaluate the rewritten script (module-script.ts) in a compartment of its own: the default export, as the
 * script's promise gives it. Throws as the script throws, and as SES refuses it. */
export function evaluateFlow(script: string, api: FlowApi): Promise<unknown> {
  const globals = harden({
    ...PINNED_UNDEFINED,
    agent: api.agent,
    ask: api.ask,
    log: api.log,
    phase: api.phase,
  });
  const compartment = new Compartment(globals, {}, { name: "flow" });
  return Promise.resolve(compartment.evaluate(script));
}
