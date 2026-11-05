import { createHash } from "node:crypto";
import {
  canonicalJson,
  FLOW_LABEL_MAX,
  FLOW_LIMITS,
  type FlowCallKey,
  type FlowJournalKnownLine,
} from "@vibefield/contracts";
import type { FlowJournalEntry } from "./journal";
import { nestsWithin } from "./protocol";
import {
  boundedAnswer,
  type FlowCallHandler,
  type FlowHostAnswer,
  type FlowHostCall,
} from "./supervisor";

// CP-4a2a (CP-D9; CP4-S15) — replay: a run's calls answered from its journal by their key and `#n`. A host started
// again runs the script from the top; each call the journal already answered is answered from it again and never
// handed on, and each new call is journaled BEFORE it is handed on, then its answer, so a restart finds both.
// - A call's key is what it is and every argument the script passed it (`flowCallKey`); `#n` counts the calls with that
//   key in this host's life, so a loop that asks the same thing twice asks it as #1 and #2. Steps that finished out of
//   order (a `Promise.all`) replay the same: each call finds its own answer by its key and n, never by its place.
// - A call journaled and never answered (the host left mid-call) is handed on again under its own number: what its
//   step then is (resumed, or lost to a Quit, CP4-Q11 (a)) is the runs' to say (CP-4a2b), by `call`.
// - The answer journaled is the one the pipe carries: JSON's own value (an undefined in a list is null, as the pipe
//   says it), then `boundedAnswer` (a text past RESULT_MAX_BYTES cut and marked). The script hears what is journaled.
// - A log line the journal holds is not said again; the next is journaled, then heard.
// - A journal that does not take a line (the disk refused it) hands nothing on: the call is refused to the script.
// - `call` never throws at fieldd's pipe (bth's review P1/P3): arguments nested past FLOW_LIMITS.ARGS_DEPTH_MAX, or
//   that no canonical JSON keys, are refused to the script, and so is a call or an answer its journal did not take.

/** A call's replay key: SHA-256 over the canonical JSON of what it is and the arguments the script passed it. */
export function flowCallKey(what: string, args: readonly unknown[]): FlowCallKey {
  return createHash("sha256").update(canonicalJson({ what, args })).digest("hex");
}

export interface FlowReplayOptions {
  /** the run's journal as it stood when this host started (FlowRecords.readRun's `kept` lines) */
  readonly prior: readonly FlowJournalKnownLine[];
  /** append a line to the run's journal: throws when the disk does not take it (nothing is then handed on) */
  readonly append: (entry: FlowJournalEntry) => void;
  /** what does a new call: the runs (CP-4a2b); a scripted one in the tests */
  readonly inner: FlowCallHandler;
}

/** The words a script hears when its run's journal did not take a call or its answer. */
const JOURNAL_REFUSED = "VibeField could not keep this step in the run's journal.";

/** A value as JSON carries it: undefined (and a function) is null, in a list and alone. Throws on what JSON cannot
 * carry (a bigint, a cycle). */
const asCarried = (value: unknown): unknown => {
  const text = JSON.stringify(value);
  return text === undefined ? null : (JSON.parse(text) as unknown);
};

/** The label, agent and phase a card shows, where the script's options name them plainly. */
function cardOf(args: readonly unknown[]): { label?: string; agent?: string; phase?: string } {
  const options = args[1];
  if (typeof options !== "object" || options === null || Array.isArray(options)) return {};
  const said = options as Record<string, unknown>;
  const plain = (value: unknown, max: number): string | undefined =>
    typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
  const label = plain(said["label"], FLOW_LABEL_MAX);
  const agent = plain(said["agent"], 64);
  const phase = plain(said["phase"], FLOW_LABEL_MAX);
  return {
    ...(label !== undefined ? { label } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(phase !== undefined ? { phase } : {}),
  };
}

/** The handler a run's host is given: its journal's answers first, the inner handler for what is new. */
export class FlowReplay implements FlowCallHandler {
  readonly #opts: FlowReplayOptions;
  /** the journal's calls by `<key>#<n>`, to their numbers */
  readonly #journaled = new Map<string, number>();
  /** the journal's answers by their call's number */
  readonly #answers = new Map<number, FlowHostAnswer>();
  /** the calls with each key this host has made */
  readonly #seen = new Map<string, number>();
  readonly #priorLogs: number;
  #logs = 0;
  #nextCall: number;

  constructor(opts: FlowReplayOptions) {
    this.#opts = opts;
    let last = 0;
    let logs = 0;
    for (const line of opts.prior) {
      if (line.kind === "call") {
        this.#journaled.set(`${line.key}#${line.n}`, line.call);
        last = Math.max(last, line.call);
      } else if (line.kind === "answer") {
        this.#answers.set(
          line.call,
          line.refused !== undefined
            ? { ok: false, refused: line.refused }
            : { ok: true, value: line.value },
        );
      } else if (line.kind === "log") logs += 1;
    }
    this.#priorLogs = logs;
    this.#nextCall = last + 1;
  }

  async call(call: FlowHostCall): Promise<FlowHostAnswer> {
    if (!call.args.every((arg) => nestsWithin(arg, FLOW_LIMITS.ARGS_DEPTH_MAX)))
      return {
        ok: false,
        refused: `VibeField can't send this ${call.what}: its arguments nest deeper than ${FLOW_LIMITS.ARGS_DEPTH_MAX}`,
      };
    let key: FlowCallKey;
    try {
      key = flowCallKey(call.what, call.args);
    } catch {
      return {
        ok: false,
        refused: `VibeField can't send this ${call.what}: its arguments are not plain JSON`,
      };
    }
    const n = (this.#seen.get(key) ?? 0) + 1;
    this.#seen.set(key, n);
    const journaled = this.#journaled.get(`${key}#${n}`);
    if (journaled !== undefined) {
      const answered = this.#answers.get(journaled);
      if (answered !== undefined) return answered;
      return this.#handOn({ what: call.what, args: call.args, call: journaled });
    }
    const number = this.#nextCall++;
    try {
      this.#opts.append({
        kind: "call",
        call: number,
        what: call.what,
        key,
        n,
        ...cardOf(call.args),
      });
    } catch {
      return { ok: false, refused: JOURNAL_REFUSED };
    }
    return this.#handOn({ what: call.what, args: call.args, call: number });
  }

  log(text: string): void {
    this.#logs += 1;
    if (this.#logs <= this.#priorLogs || text.length === 0) return;
    try {
      this.#opts.append({ kind: "log", text });
    } catch {
      // a log line the journal cannot keep is not said either: the run's record is the journal's
      return;
    }
    this.#opts.inner.log(text);
  }

  async #handOn(call: FlowHostCall & { readonly call: number }): Promise<FlowHostAnswer> {
    const said = await this.#opts.inner.call(call);
    let answer: ReturnType<typeof boundedAnswer>;
    try {
      // an answer of nothing is kept, and replayed, as null: the journal's answer is a value or a refusal
      answer = boundedAnswer(said.ok ? { ok: true, value: asCarried(said.value) } : said);
    } catch {
      answer = {
        ok: false,
        refused: `VibeField can't hand this ${call.what}'s answer on: it is not plain JSON`,
      };
    }
    try {
      this.#opts.append(
        answer.ok
          ? {
              kind: "answer",
              call: call.call,
              value: answer.value,
              ...(answer.cut === true ? { cut: true as const } : {}),
            }
          : { kind: "answer", call: call.call, refused: answer.refused },
      );
    } catch {
      // the step's answer is not kept, so the script does not hear it: a restart asks the step again
      return { ok: false, refused: JOURNAL_REFUSED };
    }
    return answer.ok ? { ok: true, value: answer.value } : answer;
  }
}
