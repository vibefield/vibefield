import type { RunEnteredAgent } from "../src/run-entry";

// CP-4a2b (§13a slice 4; the slices 7–9 review's F3) — a run as puppeteer's Agent hands it, faked: its `.on` surface,
// as spark-transcripts.test.ts fakes it. The ONE fake shared by the step listener's rows (flow-step-events.test.ts) and
// the runs' rows whose turn ends go through that listener (flows-runs.test.ts R19). Import-light: no `afterEach`.

/** A run as puppeteer's Agent hands it: its `.on` surface, and how many listeners it holds. */
export function fakeAgent() {
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
