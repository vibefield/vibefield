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
  type FlowBoundedAnswer,
  type FlowCallHandler,
  type FlowHostAnswer,
  type FlowHostCall,
} from "./supervisor";

// CP-4a2a (CP-D9; CP4-S15) — replay: a run's calls answered from its journal by their key and `#n`. A host started
// again runs the script from the top; each call the journal already answered is answered from it again and never
// handed on, and each new call is journaled BEFORE it is handed on, so a restart finds it.
// - A call's key is what it is and every argument the script passed it (`flowCallKey`); `#n` counts the calls with that
//   key in this host's life, so a loop that asks the same thing twice asks it as #1 and #2. Steps that finished out of
//   order (a `Promise.all`) replay the same: each call finds its own answer by its key and n, never by its place.
// - A call journaled and never answered (the host left mid-call) is handed on again under its own number: what its
//   step then is (resumed, or lost to a Quit, CP4-Q11 (a)) is the runs' to say (CP-4a2b), by `call`.
// - CP-4a2b slice 10b (D21, D22, D7). The answers are released to the script in JOURNAL order, in ONE queue: an answer
//   is held until every call line before it has been made again in this host's life, and an answer the runs hand on
//   after the host started (`answered`) waits behind every one still held. So a race replayed takes the answer its
//   first life took. The RUNS are the one writer of an answer line (D22): `flowAnswerLine` is the one road from an
//   answer to its line and to what the script hears, a cut text marked `cut` for its worker's FLOW_CUT_MARK; this
//   replay journals call and log lines alone, and hears an answer only through `answered`, never through what the
//   runs' `call` returns. A new call is held, never journaled, while calls the journal holds are not made again (D7);
//   `stuck` says so, for the runs to set the run aside at D1's park.
// - A log line the journal holds is not said again; the next is journaled, then heard.
// - A journal that does not take a call line (the disk refused it) hands nothing on: the script's call is refused.
// - `call` never throws at fieldd's pipe (bth's review P1/P3): arguments nested past FLOW_LIMITS.ARGS_DEPTH_MAX, or
//   that no canonical JSON keys, are refused to the script, and so is a call its journal did not take. An answer
//   nested past it is refused and journaled as that refusal (`flowAnswerLine`), so the journal's read (journal.ts)
//   never meets a line it would set aside.

/** A call's replay key: SHA-256 over the canonical JSON of what it is and the arguments the script passed it. */
export function flowCallKey(what: string, args: readonly unknown[]): FlowCallKey {
  return createHash("sha256").update(canonicalJson({ what, args })).digest("hex");
}

export interface FlowReplayOptions {
  /** the run's journal as it stood when this host started (FlowRecords.readRun's `kept` lines) */
  readonly prior: readonly FlowJournalKnownLine[];
  /** append a line to the run's journal: throws when the disk does not take it (nothing is then handed on). A call's
   * line comes with the call's own arguments, which the runs read its `in:` from (F9) */
  readonly append: (entry: FlowJournalEntry, args?: readonly unknown[]) => void;
  /** what does a new call: the runs (CP-4a2b); a scripted one in the tests */
  readonly inner: FlowCallStarter;
}

/** What starts a run's calls past its journal (D22): the runs; a scripted one in the tests. A call's answer reaches
 * its replay through `FlowReplay.answered`, never through what `call` returns. A starter that throws as it is called
 * has failed: the script's call is refused in fieldd's words (supervisor.ts). Its `log` hears each new log line. */
export interface FlowCallStarter {
  call(call: FlowHostCall & { readonly call: number }): void;
  log(text: string): void;
}

/** The words a script hears when its run's journal did not take a call or its answer. */
export const JOURNAL_REFUSED = "VibeField could not keep this step in the run's journal.";

/** A value as JSON carries it: undefined (and a function) is null, in a list and alone. Throws on what JSON cannot
 * carry (a bigint, a cycle). */
const asCarried = (value: unknown): unknown => {
  const text = JSON.stringify(value);
  return text === undefined ? null : (JSON.parse(text) as unknown);
};

/** D7 (slice 10b) — why a quiet host can't go on, as its replay reads it at D1's park:
 * - `new`: a new call held, while calls the journal holds are not made again (§9: "…its script asked for something
 *   it never asked before.");
 * - `unmatched`: calls the journal holds not made again, an answer behind them held, and nothing new asked (§9,
 *   Proposed: "…its script didn't ask what it asked before."). */
export type FlowReplayStuck = "new" | "unmatched";

/** An answer as the runs journal it (D22): its journal line, and what the script hears (a cut text marked `cut`). */
export interface FlowAnswerLine {
  readonly entry: Extract<FlowJournalEntry, { readonly kind: "answer" }>;
  readonly heard: FlowHostAnswer;
}

/** D11, D22 — the one road from a call's answer to its journal line and to what its script hears: JSON's own value
 * (an undefined in a list is null), refused when it nests past ARGS_DEPTH_MAX or is not plain JSON, then bounded by
 * the one cutter (`boundedAnswer`: a text past RESULT_MAX_BYTES cut and marked `cut`). Pure: no I/O, no clock. */
export function flowAnswerLine(call: number, what: string, said: FlowHostAnswer): FlowAnswerLine {
  let answer: FlowBoundedAnswer;
  try {
    // an answer of nothing is kept, and replayed, as null: the journal's answer is a value or a refusal
    const carried = said.ok ? asCarried(said.value) : undefined;
    answer =
      said.ok && !nestsWithin(carried, FLOW_LIMITS.ARGS_DEPTH_MAX)
        ? {
            ok: false,
            refused: `VibeField can't hand this ${what}'s answer on: it nests deeper than ${FLOW_LIMITS.ARGS_DEPTH_MAX}`,
          }
        : boundedAnswer(said.ok ? { ok: true, value: carried } : said);
  } catch {
    answer = {
      ok: false,
      refused: `VibeField can't hand this ${what}'s answer on: it is not plain JSON`,
    };
  }
  if (!answer.ok)
    return {
      entry: { kind: "answer", call, refused: answer.refused },
      heard: { ok: false, refused: answer.refused },
    };
  const cut = answer.cut === true ? { cut: true as const } : {};
  return {
    entry: { kind: "answer", call, value: answer.value, ...cut },
    heard: { ok: true, value: answer.value, ...cut },
  };
}

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

/** A script's call waiting for what its replay releases. */
interface Waiter {
  readonly resolve: (answer: FlowHostAnswer) => void;
  readonly reject: (error: unknown) => void;
}

/** A line of D21's one queue: a call the journal holds, or an answer, in journal order; an answer the runs hand on
 * after the host started joins it at its end. */
type Queued =
  | { readonly kind: "call"; readonly call: number }
  | { readonly kind: "answer"; readonly call: number; readonly answer: FlowHostAnswer };

/** D7 — a new call made while calls the journal holds are not made again: held, never journaled while it is. */
interface Held {
  readonly what: string;
  readonly args: readonly unknown[];
  readonly key: FlowCallKey;
  readonly n: number;
  readonly waiter: Waiter;
}

/** The handler a run's host is given: its journal's answers in journal order, the runs for what is new. */
export class FlowReplay implements FlowCallHandler {
  readonly #opts: FlowReplayOptions;
  /** the journal's calls by `<key>#<n>`, to their numbers */
  readonly #journaled = new Map<string, number>();
  /** D21's one queue, and how much of it is released */
  readonly #queue: Queued[] = [];
  #released = 0;
  /** the calls whose answer is in the queue: the journal's, and each the runs handed on since (D22) */
  readonly #answered = new Set<number>();
  /** the journal's calls this host's script has not made again */
  readonly #unmade = new Set<number>();
  /** the script's calls waiting for their answer, by number */
  readonly #waiting = new Map<number, Waiter>();
  /** D7: the new calls held, in the order the script made them */
  readonly #held: Held[] = [];
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
        this.#unmade.add(line.call);
        this.#queue.push({ kind: "call", call: line.call });
        last = Math.max(last, line.call);
      } else if (line.kind === "answer") {
        this.#answered.add(line.call);
        this.#queue.push({
          kind: "answer",
          call: line.call,
          answer:
            line.refused !== undefined
              ? { ok: false, refused: line.refused }
              : {
                  ok: true,
                  value: line.value,
                  ...(line.cut === true ? { cut: true as const } : {}),
                },
        });
      } else if (line.kind === "log") logs += 1;
    }
    this.#priorLogs = logs;
    this.#nextCall = last + 1;
  }

  call(call: FlowHostCall): Promise<FlowHostAnswer> {
    if (!call.args.every((arg) => nestsWithin(arg, FLOW_LIMITS.ARGS_DEPTH_MAX)))
      return Promise.resolve({
        ok: false,
        refused: `VibeField can't send this ${call.what}: its arguments nest deeper than ${FLOW_LIMITS.ARGS_DEPTH_MAX}`,
      });
    let key: FlowCallKey;
    try {
      key = flowCallKey(call.what, call.args);
    } catch {
      return Promise.resolve({
        ok: false,
        refused: `VibeField can't send this ${call.what}: its arguments are not plain JSON`,
      });
    }
    const n = (this.#seen.get(key) ?? 0) + 1;
    this.#seen.set(key, n);
    const journaled = this.#journaled.get(`${key}#${n}`);
    return new Promise<FlowHostAnswer>((resolve, reject) => {
      // D21 (R28): a waiter settles a microtask after it is released, in the order released, so the script hears its
      // answers in journal order. `#release` can run in this executor, before its caller holds the promise: settled
      // there, this call's answer would be heard only once that caller attaches (the supervisor's `then`, the runs'
      // `return await`, each as `call` returns), after a later answer the same release gave a call made earlier
      const waiter: Waiter = {
        resolve: (answer) => queueMicrotask(() => resolve(answer)),
        reject: (error) => queueMicrotask(() => reject(error)),
      };
      if (journaled === undefined)
        this.#held.push({ what: call.what, args: call.args, key, n, waiter });
      else {
        // XX2: the waiter is set before the hand-on, so an answer the runs hand on at once (`answered`, re-entrant)
        // finds it; a call the queue answers is never handed on again (D22)
        this.#waiting.set(journaled, waiter);
        this.#unmade.delete(journaled);
        if (!this.#answered.has(journaled))
          this.#handOn({ what: call.what, args: call.args, call: journaled });
      }
      this.#release();
    });
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

  /** D22, D21 — a call's answer as the runs journaled it, handed to this host's replay: queued at the end of D21's one
   * queue, behind every answer still held, and released in journal order. Safe to call from within the runs' `call`
   * (XX2). An answer this replay already holds is nothing (at most once). */
  answered(call: number, answer: FlowHostAnswer): void {
    if (this.#answered.has(call)) return;
    this.#answered.add(call);
    this.#queue.push({ kind: "answer", call, answer });
    this.#release();
  }

  /** D7 — what keeps this replay's quiet host from going on, read at D1's park: a new call held (`new`), or calls the
   * journal holds that its script has not made again (`unmatched`: no answer behind them is released); none when it
   * only waits. */
  stuck(): FlowReplayStuck | undefined {
    if (this.#held.length > 0) return "new";
    return this.#unmade.size > 0 ? "unmatched" : undefined;
  }

  /** D21 — the queue released as far as it goes: up to a call line not yet made again, each answer to its waiter. Once
   * every call the journal holds is made again, D7's held calls go on (`#unhold`). */
  #release(): void {
    while (this.#released < this.#queue.length) {
      const line = this.#queue[this.#released] as Queued;
      if (line.kind === "call") {
        if (this.#unmade.has(line.call)) break;
      } else {
        const waiter = this.#waiting.get(line.call);
        this.#waiting.delete(line.call);
        waiter?.resolve(line.answer);
      }
      this.#released += 1;
    }
    if (this.#unmade.size === 0) this.#unhold();
  }

  /** D7 — the held new calls, in the order they were made, each journaled BEFORE it is handed on (its waiter set
   * first, XX2); one its journal does not take is refused to the script, and nothing is handed on. */
  #unhold(): void {
    for (let held = this.#held.shift(); held !== undefined; held = this.#held.shift()) {
      const number = this.#nextCall++;
      try {
        this.#opts.append(
          {
            kind: "call",
            call: number,
            what: held.what,
            key: held.key,
            n: held.n,
            ...cardOf(held.args),
          },
          held.args,
        );
      } catch {
        held.waiter.resolve({ ok: false, refused: JOURNAL_REFUSED });
        continue;
      }
      this.#waiting.set(number, held.waiter);
      this.#handOn({ what: held.what, args: held.args, call: number });
    }
  }

  /** A call handed to the runs (D22): they journal its answer and hand it back through `answered`. A starter that
   * throws as it is called refuses the script's call, in fieldd's words, through the supervisor. */
  #handOn(call: FlowHostCall & { readonly call: number }): void {
    try {
      this.#opts.inner.call(call);
    } catch (error) {
      const waiter = this.#waiting.get(call.call);
      this.#waiting.delete(call.call);
      waiter?.reject(error);
    }
  }
}
