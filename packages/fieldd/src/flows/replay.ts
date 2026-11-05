import type { FlowCallKey, FlowJournalKnownLine } from "@vibefield/contracts";
import type { FlowJournalEntry } from "./journal";
import type { FlowCallHandler, FlowHostAnswer, FlowHostCall } from "./supervisor";

// CP-4a2a (CP-D9; CP4-S15) — replay: a run's calls answered from its journal by their key and `#n`. A host started
// again runs the script from the top; each call the journal already answered is answered from it again and never
// handed on, and each new call is journaled BEFORE it is handed on, then its answer, so a restart finds both.
//
// SKELETON (the red, commit 8): every call is handed on, nothing is journaled.

/** A call's replay key: SHA-256 over the canonical JSON of what it is and the arguments the script passed it. */
export function flowCallKey(_what: string, _args: readonly unknown[]): FlowCallKey {
  return "0".repeat(64);
}

export interface FlowReplayOptions {
  /** the run's journal as it stood when this host started (FlowRecords.readRun's `kept` lines) */
  readonly prior: readonly FlowJournalKnownLine[];
  /** append a line to the run's journal: throws when the disk does not take it (nothing is then handed on) */
  readonly append: (entry: FlowJournalEntry) => void;
  /** what does a new call: the runs (CP-4a2b); a scripted one in the tests */
  readonly inner: FlowCallHandler;
}

/** The handler a run's host is given: its journal's answers first, the inner handler for what is new. */
export class FlowReplay implements FlowCallHandler {
  readonly #opts: FlowReplayOptions;

  constructor(opts: FlowReplayOptions) {
    this.#opts = opts;
  }

  call(call: FlowHostCall): Promise<FlowHostAnswer> {
    return this.#opts.inner.call(call);
  }

  log(text: string): void {
    this.#opts.inner.log(text);
  }
}
