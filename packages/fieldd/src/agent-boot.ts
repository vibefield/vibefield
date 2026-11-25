import { AGENT_START } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// Spark QA F12 (2026-11-25) — a run that was just spawned or resumed does not take input yet.
//
// What real use found: a spark's `agent_spawn` queued its task, the run's first monitor row already read `idle`, and
// the input queue pasted the task about 10 ms after the terminal was spawned, into a TUI that had not started. Claude
// Code and Codex kept the words as an UNSENT DRAFT (the paste arrived, its Enter did not submit), the receipt came
// back `uncertain`, and the next send was appended to that draft, so two prompts went as one.
//
// So the queue's idle has a second fact beside the monitor's: the run takes input. A born run takes none until its
// agent has SAID it started (puppeteer's `session:started` or `session:ready`, which move the session's lifecycle off
// `preparing` and `starting`) and a settle has passed since, because one adapter says so before its TUI is up (Codex
// owns its thread first and spawns the TUI after). A turn that begins ends the wait at once: the pane is plainly
// taking input. A run that never says it started takes input after a bound, said once in the log, so an adapter with
// no start line never holds a queue for good.
//
// OWED, upstream (the bound is a stand-in for a fact nobody gives fieldd yet): the terminal engine knows whether the
// pane's program has turned bracketed paste on, which is the moment its editor is live; a paste refused until then
// would make both numbers here unnecessary. And a run that stands at its agent's own start question (a folder's trust)
// is held here only until SAID_WITHIN_MS; the person is not yet told it waits on them.

interface Boot {
  /** the agent has said it started; the settle runs from then */
  said: boolean;
  timer: NodeJS.Timeout | undefined;
}

export interface RunBootsOptions {
  /** a run left its wait: whoever delivers at idle looks again (the input queue's poke) */
  onTakesInput(runtimeRunId: string): void;
  readonly settleMs?: number | undefined;
  readonly saidWithinMs?: number | undefined;
  readonly logger?: Logger | undefined;
}

export class RunBoots {
  readonly #boots = new Map<string, Boot>();
  readonly #settleMs: number;
  readonly #saidWithinMs: number;
  readonly #logger: Logger;

  constructor(private readonly opts: RunBootsOptions) {
    this.#settleMs = opts.settleMs ?? AGENT_START.SETTLE_MS;
    this.#saidWithinMs = opts.saidWithinMs ?? AGENT_START.SAID_WITHIN_MS;
    this.#logger = opts.logger ?? createNoopLogger();
  }

  /** A run was spawned or resumed. `said`: its agent had already said it started when the run entered. A run that
   * was alive before this fieldd (re-attached, adopted) is never told here: it takes input as it always did. */
  born(runtimeRunId: string, said: boolean): void {
    this.forget(runtimeRunId);
    const boot: Boot = { said: false, timer: undefined };
    this.#boots.set(runtimeRunId, boot);
    if (said) {
      this.#settle(runtimeRunId, boot);
      return;
    }
    boot.timer = this.#after(this.#saidWithinMs, () => {
      if (this.#boots.get(runtimeRunId) !== boot) return;
      this.#logger.info(
        "fieldd.agents.start_unsaid",
        "A run did not say it started; it takes input from here",
        { runtimeRunId, afterMs: this.#saidWithinMs },
      );
      this.#done(runtimeRunId);
    });
  }

  /** The agent said it started: the settle runs from here, once. */
  said(runtimeRunId: string): void {
    const boot = this.#boots.get(runtimeRunId);
    if (boot === undefined || boot.said) return;
    this.#settle(runtimeRunId, boot);
  }

  /** A turn began in the run: it is taking input. */
  turned(runtimeRunId: string): void {
    if (this.#boots.has(runtimeRunId)) this.#done(runtimeRunId);
  }

  /** Whether the run takes input: every run does, but one that is still starting. */
  takesInput(runtimeRunId: string): boolean {
    return !this.#boots.has(runtimeRunId);
  }

  /** The run ended, or was replaced: nothing waits on it. */
  forget(runtimeRunId: string): void {
    const boot = this.#boots.get(runtimeRunId);
    if (boot === undefined) return;
    if (boot.timer !== undefined) clearTimeout(boot.timer);
    this.#boots.delete(runtimeRunId);
  }

  dispose(): void {
    for (const id of [...this.#boots.keys()]) this.forget(id);
  }

  #settle(runtimeRunId: string, boot: Boot): void {
    boot.said = true;
    if (boot.timer !== undefined) clearTimeout(boot.timer);
    boot.timer = this.#after(this.#settleMs, () => {
      if (this.#boots.get(runtimeRunId) === boot) this.#done(runtimeRunId);
    });
  }

  #done(runtimeRunId: string): void {
    this.forget(runtimeRunId);
    this.opts.onTakesInput(runtimeRunId);
  }

  /** A bound of zero is no wait at all: its end is now, with no turn of the loop between. */
  #after(ms: number, then: () => void): NodeJS.Timeout | undefined {
    if (ms <= 0) {
      then();
      return undefined;
    }
    const timer = setTimeout(then, ms);
    timer.unref?.();
    return timer;
  }
}
