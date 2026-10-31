import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// CP-L5 (ruled 2026-10-29) and CP-2's marks (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31 03:49:24Z).
// Every session has ONE input queue in fieldd. A spark's agent_send, its spawn's tasks and fieldd's own wakes join it,
// and fieldd delivers the head when the session is idle: its turn has ended and nothing waits on the person.
// - The text lands marked by its source (CP2-D1): a spark's words under "<name> (your spark) on your behalf:", a wake
//   as "VibeField: …". No wording is a boundary; the boundaries are the door, the holds and the record.
// - A receipt decides the head (puppeteer's submitPrompt). Confirmed, it is done. Rejected (a dialog is open, another
//   injection runs, or the person's keystrokes came between), it waits for the next idle. Uncertain (no echo within
//   the adapter's bound), it is never sent again and its sender is told (CP2-D2).
// - The queue is kept across a fieldd restart (CP2-D3): each session's queue is one file under the inputs directory,
//   0600 in a 0700 directory, rewritten whole on every change.
// - CP2-D7 (wait for his quiet) needs a fact the floor does not give fieldd yet: when his last keystroke in the pane
//   was. Until it does, the terminal service's ordering against accepted human input is the guard (the mark's B).

/** Who an input is from: a spark, by id and by the name its words are marked with; or fieldd's own wake. */
export type InputSender =
  | { readonly kind: "spark"; readonly spark: string; readonly name: string }
  | { readonly kind: "fieldd" };

export interface QueuedInput {
  readonly id: string;
  readonly text: string;
  readonly from: InputSender;
  readonly at: string;
}

/** What became of an input: delivered, waiting for the next idle, uncertain (never resent), or dropped with its
 * session. */
export type DeliveryOutcome = "delivered" | "waiting" | "uncertain" | "dropped";

/** A delivery's receipt, in puppeteer's words. */
export interface DeliveryReceipt {
  readonly status: "confirmed" | "rejected" | "uncertain";
  readonly reason?: string | undefined;
}

export interface InputQueueOptions {
  /** where each session's queue is kept (LAYOUT.AGENT_INPUTS_DIR) */
  readonly dir: string;
  /** paste-and-submit one input into a run (AgentRuntimeService.submit) */
  deliver(runtimeRunId: string, text: string): Promise<DeliveryReceipt>;
  /** the run's turn has ended and nothing waits on the person (the monitor's idle, with no blocker) */
  isIdle(runtimeRunId: string): boolean;
  onOutcome?(
    runtimeRunId: string,
    input: QueuedInput,
    outcome: DeliveryOutcome,
    reason?: string,
  ): void;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

/** The text an input lands as (CP2-D1). */
export const markedText = (input: QueuedInput): string =>
  input.from.kind === "spark"
    ? `${input.from.name} (your spark) on your behalf:\n${input.text}`
    : `VibeField: ${input.text}`;

/** A file name a run id can be kept under; ids are fieldd's own, and anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class AgentInputQueues {
  readonly #queues = new Map<string, QueuedInput[]>();
  /** runs with a delivery in flight */
  readonly #busy = new Set<string>();
  readonly #logger: Logger;
  readonly #now: () => Date;

  constructor(private readonly opts: InputQueueOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
  }

  /** Read every kept queue back at boot (CP2-D3). Returns how many inputs wait. */
  restore(): number {
    if (!existsSync(this.opts.dir)) return 0;
    let waiting = 0;
    for (const file of readdirSync(this.opts.dir)) {
      if (!file.endsWith(".json")) continue;
      const runtimeRunId = file.slice(0, -".json".length);
      try {
        const kept = JSON.parse(readFileSync(join(this.opts.dir, file), "utf8")) as QueuedInput[];
        if (!Array.isArray(kept) || kept.length === 0) continue;
        this.#queues.set(runtimeRunId, kept);
        waiting += kept.length;
      } catch (err) {
        this.#logger.warn("fieldd.inputs.unreadable", "A kept input queue could not be read", {
          runtimeRunId,
          reason: (err as Error).message,
        });
      }
    }
    return waiting;
  }

  /** Queue an input for a run; its place, 1 being next. */
  enqueue(runtimeRunId: string, text: string, from: InputSender): { position: number } {
    const queue = this.#queueOf(runtimeRunId);
    queue.push({ id: randomBytes(6).toString("hex"), text, from, at: this.#now().toISOString() });
    this.#keep(runtimeRunId);
    void this.poke(runtimeRunId);
    return { position: queue.length };
  }

  /** fieldd's own wake for a run (CP-D4): facts only, and wakes that wait join into one line. */
  wake(runtimeRunId: string, fact: string): void {
    const queue = this.#queueOf(runtimeRunId);
    const last = queue.at(-1);
    if (last !== undefined && last.from.kind === "fieldd" && !this.#busy.has(runtimeRunId)) {
      queue[queue.length - 1] = { ...last, text: `${last.text} · ${fact}` };
      this.#keep(runtimeRunId);
    } else this.enqueue(runtimeRunId, fact, { kind: "fieldd" });
    void this.poke(runtimeRunId);
  }

  /** The inputs that wait for a run, oldest first. */
  pending(runtimeRunId: string): readonly QueuedInput[] {
    return this.#queues.get(runtimeRunId) ?? [];
  }

  /** The run may be idle (its monitor state changed): deliver the head if it is. One input per idle moment, because
   * a delivered input starts a turn; the next waits for that turn's end. */
  async poke(runtimeRunId: string): Promise<void> {
    const queue = this.#queues.get(runtimeRunId);
    if (queue === undefined || queue.length === 0 || this.#busy.has(runtimeRunId)) return;
    if (!this.opts.isIdle(runtimeRunId)) return;
    const head = queue[0]!;
    this.#busy.add(runtimeRunId);
    let receipt: DeliveryReceipt;
    try {
      receipt = await this.opts.deliver(runtimeRunId, markedText(head));
    } catch (err) {
      receipt = { status: "rejected", reason: (err as Error).message };
    } finally {
      this.#busy.delete(runtimeRunId);
    }
    if (receipt.status === "rejected") {
      this.opts.onOutcome?.(runtimeRunId, head, "waiting", receipt.reason);
      return;
    }
    queue.shift();
    this.#keep(runtimeRunId);
    this.opts.onOutcome?.(
      runtimeRunId,
      head,
      receipt.status === "confirmed" ? "delivered" : "uncertain",
      receipt.reason,
    );
  }

  /** A run ended: what waited for it is dropped, each sender told, and its kept file goes. */
  forget(runtimeRunId: string): void {
    const queue = this.#queues.get(runtimeRunId) ?? [];
    this.#queues.delete(runtimeRunId);
    this.#keep(runtimeRunId);
    for (const input of queue) this.opts.onOutcome?.(runtimeRunId, input, "dropped");
  }

  #queueOf(runtimeRunId: string): QueuedInput[] {
    let queue = this.#queues.get(runtimeRunId);
    if (queue === undefined) {
      queue = [];
      this.#queues.set(runtimeRunId, queue);
    }
    return queue;
  }

  /** Write a run's queue whole (or remove its file when empty): written beside, then renamed, 0600 in 0700. */
  #keep(runtimeRunId: string): void {
    if (!SAFE_ID.test(runtimeRunId)) return;
    const file = join(this.opts.dir, `${runtimeRunId}.json`);
    const queue = this.#queues.get(runtimeRunId);
    try {
      if (queue === undefined || queue.length === 0) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
      chmodSync(this.opts.dir, 0o700);
      const part = `${file}.part`;
      writeFileSync(part, JSON.stringify(queue), { mode: 0o600 });
      renameSync(part, file);
    } catch (err) {
      this.#logger.warn("fieldd.inputs.unkept", "An input queue could not be kept", {
        runtimeRunId,
        reason: (err as Error).message,
      });
    }
  }
}
