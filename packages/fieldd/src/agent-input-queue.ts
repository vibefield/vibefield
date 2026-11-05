import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  AGENT_INPUT_QUEUE_FORMAT,
  AgentInputQueueFile,
  type AgentInputSender,
  type AgentQueuedInput,
  NEEDS_JOINED_ITEMS_MAX,
  type NeedsItemId,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RecordSigner, type SetAsideWhy, setAsideFile } from "./signed-record";

// CP-L5 (ruled 2026-10-29) and CP-2's marks (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31 03:49:24Z).
// Every session has ONE input queue in fieldd. A spark's agent_send, its spawn's tasks and fieldd's own wakes join it,
// and fieldd delivers the head when the session is idle: its turn has ended and nothing waits on the person.
// - The text lands marked by its source (CP2-D1): a spark's words under "<name> (your spark) on your behalf:", a wake
//   as "VibeField: …". No wording is a boundary; the boundaries are the door, the holds and the record.
//   IOS-12a (PC-D3 A): the person's own words to a spark (`compose.sparks.say`) land UNMARKED, as yours, and carry
//   the say's request id, so a retried say finds the input it already queued (`findRequest`).
// - A receipt decides the head (puppeteer's submitPrompt). Confirmed, it is done. Rejected (a dialog is open, another
//   injection runs, or the person's keystrokes came between), it waits for the next idle. Uncertain (no echo within
//   the adapter's bound), it is never sent again and its sender is told (CP2-D2).
// - The queue is kept across a fieldd restart (CP2-D3): each session's queue is one file under the inputs directory,
//   0600 in a 0700 directory, rewritten whole on every change.
// - The head is stamped before it is pasted (item 158, TH-Q32 (a)): `sending` is kept, and only then delivered. A
//   stamp the disk does not take holds the delivery for the next idle, said once. A restart that finds a stamped head
//   broke into its delivery: it is never sent again, and nothing behind it moves until its run's first monitor row,
//   where it is said uncertain (`restarted`) with the run known, or the settle reconcile, for a run that never came
//   back. A run that ends while its head is in flight leaves that head to its receipt, so it is said once.
// - A wake's line carries the needs-you items whose facts it holds (CO-Q9 (b)), so the needs queue hears what became
//   of them: wakes that wait join, their items with them, up to NEEDS_JOINED_ITEMS_MAX; a stamped head joins none.
// - Each file is signed (CP-3, LEANS P3) by the one record signer under a key of the queue's own
//   (LAYOUT.AGENT_INPUTS_KEY_FILE), with its run inside the signature. A file is a control input: what it holds is
//   pasted into a session at its idle, marked as a spark's words or as VibeField's. So restore sets aside, and never
//   delivers, a file that is unsigned (CP-2's bare array among them), does not verify, does not parse, names another
//   run, or is exposed to other users. That holds against an edit. It is no wall against an agent that reads the key,
//   which is 0600 to the same uid (EL7), nor against one that puts back a file fieldd itself once wrote for that run.
// - CP2-D7 (wait for his quiet) needs a fact the floor does not give fieldd yet: when his last keystroke in the pane
//   was. Until it does, the terminal service's ordering against accepted human input is the guard (the mark's B).

/** Who an input is from: a spark, by id and by the name its words are marked with; fieldd's own wake; or you. */
export type InputSender = AgentInputSender;

/** One input that waits, as it is kept (contracts' `AgentQueuedInput`). */
export type QueuedInput = AgentQueuedInput;

/** What became of an input: delivered, waiting for the next idle, uncertain (never resent), or dropped with its
 * session. */
export type DeliveryOutcome = "delivered" | "waiting" | "uncertain" | "dropped";

/** The reason an uncertain outcome carries when a fieldd restart broke into the delivery (item 158). */
export const RESTARTED = "restarted";

/** A delivery's receipt, in puppeteer's words. */
export interface DeliveryReceipt {
  readonly status: "confirmed" | "rejected" | "uncertain";
  readonly reason?: string | undefined;
}

export interface InputQueueOptions {
  /** where each session's queue is kept (LAYOUT.AGENT_INPUTS_DIR) */
  readonly dir: string;
  /** the secret each kept queue is signed with (LAYOUT.AGENT_INPUTS_KEY_FILE) */
  readonly keyPath: string;
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
  /** item 172 — the record file's read, a seam for a disk that does not answer (tests) */
  readonly readFile?: ((path: string) => string) | undefined;
}

/** The text an input lands as (CP2-D1): a spark's and fieldd's marked, yours as you wrote it (IOS-12a). */
export const markedText = (input: QueuedInput): string =>
  input.from.kind === "spark"
    ? `${input.from.name} (your spark) on your behalf:\n${input.text}`
    : input.from.kind === "you"
      ? input.text
      : `VibeField: ${input.text}`;

/** A file name a run id can be kept under; ids are fieldd's own, and anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A joined line's items: the union, in the order they came. */
const joined = (
  items: readonly NeedsItemId[] | undefined,
  item: NeedsItemId | undefined,
): NeedsItemId[] | undefined =>
  item === undefined || items?.includes(item) ? items && [...items] : [...(items ?? []), item];

export class AgentInputQueues {
  readonly #queues = new Map<string, QueuedInput[]>();
  /** runs with a delivery in flight */
  readonly #busy = new Set<string>();
  /** heads whose stamp the disk did not take, said once each */
  readonly #unstamped = new Set<string>();
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #signer: RecordSigner;

  constructor(private readonly opts: InputQueueOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
    this.#signer = new RecordSigner({
      keyPath: opts.keyPath,
      logger: this.#logger,
      readFile: opts.readFile,
    });
  }

  /** Read every kept queue back at boot (CP2-D3): only what fieldd signed for that run (LEANS P3). A stamped head stays
   * where it is, said at its run's first monitor row (item 158). Returns how many inputs wait, the stamped never
   * among them. */
  restore(): number {
    if (!existsSync(this.opts.dir)) return 0;
    let waiting = 0;
    for (const file of readdirSync(this.opts.dir)) {
      if (!file.endsWith(".json")) continue;
      const runtimeRunId = file.slice(0, -".json".length);
      const kept = this.#read(file, runtimeRunId);
      if (kept === undefined) continue;
      this.#queues.set(runtimeRunId, kept);
      waiting += kept.filter((input) => input.sending === undefined).length;
    }
    return waiting;
  }

  /** Queue an input for a run; its id, and its place, 1 being next. A say's request id (IOS-12a) is kept with it. */
  enqueue(
    runtimeRunId: string,
    text: string,
    from: InputSender,
    requestId?: string,
  ): { id: string; position: number } {
    const queued = this.#push(runtimeRunId, {
      text,
      from,
      ...(requestId !== undefined ? { requestId } : {}),
    });
    void this.#deliver(runtimeRunId);
    return queued;
  }

  /** IOS-12a — the input a say's request id queued, while it still waits: its run, the input and its place. Kept
   * inputs carry their request id across a restart, so a retried say finds them there too; `restarted` says the
   * restart broke into its delivery (item 158: stamped, and not in flight), so it is never sent again. */
  findRequest(
    requestId: string,
  ):
    | { runtimeRunId: string; input: QueuedInput; position: number; restarted: boolean }
    | undefined {
    for (const [runtimeRunId, queue] of this.#queues) {
      const at = queue.findIndex((input) => input.requestId === requestId);
      if (at < 0) continue;
      const input = queue[at]!;
      const restarted = input.sending !== undefined && !this.#busy.has(runtimeRunId);
      return { runtimeRunId, input, position: at + 1, restarted };
    }
    return undefined;
  }

  /** fieldd's own wake for a run (CP-D4): facts only, and wakes that wait join into one line. `item` is the needs-you
   * item whose fact it is (item 158, CO-Q9 (b)): a joined line carries their union, NEEDS_JOINED_ITEMS_MAX at most, and
   * a wake past that starts a line of its own. A head in flight, or one a restart broke into, joins nothing. True when
   * the fact is queued (item 172: false while the queues cannot be read, so nothing is told that no queue holds). */
  wake(runtimeRunId: string, fact: string, item?: NeedsItemId): boolean {
    const queue = this.#queueOf(runtimeRunId);
    const last = queue.at(-1);
    const items = joined(last?.items, item);
    if (
      last !== undefined &&
      last.from.kind === "fieldd" &&
      last.sending === undefined &&
      !this.#busy.has(runtimeRunId) &&
      (items?.length ?? 0) <= NEEDS_JOINED_ITEMS_MAX
    ) {
      queue[queue.length - 1] = {
        ...last,
        text: `${last.text} · ${fact}`,
        ...(items !== undefined ? { items } : {}),
      };
      this.#keep(runtimeRunId);
    } else
      this.#push(runtimeRunId, {
        text: fact,
        from: { kind: "fieldd" },
        ...(item !== undefined ? { items: [item] } : {}),
      });
    void this.#deliver(runtimeRunId);
    return true;
  }

  /** The inputs that wait for a run, oldest first. */
  pending(runtimeRunId: string): readonly QueuedInput[] {
    return this.#queues.get(runtimeRunId) ?? [];
  }

  /** The run's monitor row changed. A head a restart broke into is said first, idle or not, now that its run is known
   * (item 158), and never sent; then the head is delivered if the run is idle. */
  async poke(runtimeRunId: string): Promise<void> {
    const queue = this.#queues.get(runtimeRunId);
    const head = queue?.[0];
    if (queue !== undefined && head?.sending !== undefined && !this.#busy.has(runtimeRunId)) {
      // stamped and not in flight: read back at restore
      queue.shift();
      this.#keep(runtimeRunId);
      this.#restarted(runtimeRunId, head);
    }
    return this.#deliver(runtimeRunId);
  }

  /** Deliver the head if the run is idle. One input per idle moment, because a delivered input starts a turn; the next
   * waits for that turn's end. Nothing moves behind a head a restart broke into until its run's monitor row says it. */
  async #deliver(runtimeRunId: string): Promise<void> {
    const queue = this.#queues.get(runtimeRunId);
    if (queue === undefined || queue.length === 0 || this.#busy.has(runtimeRunId)) return;
    const head = queue[0]!;
    if (head.sending !== undefined || !this.opts.isIdle(runtimeRunId)) return;
    // stamped before it is pasted (TH-Q32 (a)): a restart that finds the stamp never sends it again
    queue[0] = { ...head, sending: this.#now().toISOString() };
    if (!this.#stamp(runtimeRunId, head)) {
      queue[0] = head;
      return;
    }
    this.#busy.add(runtimeRunId);
    let receipt: DeliveryReceipt;
    try {
      receipt = await this.opts.deliver(runtimeRunId, markedText(head));
    } catch (err) {
      receipt = { status: "rejected", reason: (err as Error).message };
    } finally {
      this.#busy.delete(runtimeRunId);
    }
    // the run ended meanwhile (D2): forget left this head to its receipt, and keeps nothing
    const forgotten = this.#queues.get(runtimeRunId) !== queue;
    if (receipt.status === "rejected") {
      if (forgotten) {
        this.opts.onOutcome?.(runtimeRunId, head, "dropped", receipt.reason);
        return;
      }
      queue[0] = head;
      this.#keep(runtimeRunId);
      this.opts.onOutcome?.(runtimeRunId, head, "waiting", receipt.reason);
      return;
    }
    queue.shift();
    if (!forgotten) this.#keep(runtimeRunId);
    this.opts.onOutcome?.(
      runtimeRunId,
      head,
      receipt.status === "confirmed" ? "delivered" : "uncertain",
      receipt.reason,
    );
  }

  /** A run ended: what waited for it is dropped, each sender told, and its kept file goes. A head in flight is its
   * receipt's to tell (D2); a head a restart broke into is uncertain, never dropped. */
  forget(runtimeRunId: string): void {
    const queue = this.#queues.get(runtimeRunId) ?? [];
    this.#queues.delete(runtimeRunId);
    this.#keep(runtimeRunId);
    const inFlight = this.#busy.has(runtimeRunId) ? queue[0] : undefined;
    for (const input of queue) {
      if (input === inFlight) continue;
      if (input.sending !== undefined) this.#restarted(runtimeRunId, input);
      else this.opts.onOutcome?.(runtimeRunId, input, "dropped");
    }
  }

  /** Once this boot's re-attach has settled (item 158, D3): a kept queue whose run the fold no longer holds ended while
   * fieldd was down, and no exit event will say so. It is forgotten: a head a restart broke into is uncertain
   * (`restarted`), and the rest are dropped. */
  reconcile(holds: (runtimeRunId: string) => boolean): void {
    for (const [runtimeRunId, queue] of [...this.#queues]) {
      if (queue.length === 0 || holds(runtimeRunId)) continue;
      this.#logger.info(
        "fieldd.inputs.reconciled",
        "A kept input queue's session ended while fieldd was down; what waited is dropped",
        { runtimeRunId, inputs: queue.length },
      );
      this.forget(runtimeRunId);
    }
  }

  #queueOf(runtimeRunId: string): QueuedInput[] {
    let queue = this.#queues.get(runtimeRunId);
    if (queue === undefined) {
      queue = [];
      this.#queues.set(runtimeRunId, queue);
    }
    return queue;
  }

  /** A new input at the queue's tail, kept; its id, and its place, 1 being next. */
  #push(
    runtimeRunId: string,
    input: Pick<QueuedInput, "text" | "from" | "items" | "requestId">,
  ): { id: string; position: number } {
    const queue = this.#queueOf(runtimeRunId);
    const id = randomBytes(6).toString("hex");
    queue.push({ id, ...input, at: this.#now().toISOString() });
    this.#keep(runtimeRunId);
    return { id, position: queue.length };
  }

  /** A head a restart broke into: said uncertain, once, and never sent again (TH-Q32 (a)). */
  #restarted(runtimeRunId: string, input: QueuedInput): void {
    const { sending: _sending, ...said } = input;
    this.#logger.warn(
      "fieldd.inputs.restarted",
      "A restart broke into a delivery; it is not sent again, and its sender is told it is uncertain",
      { runtimeRunId, sending: input.sending },
    );
    this.opts.onOutcome?.(runtimeRunId, said, "uncertain", RESTARTED);
  }

  /** A kept file's inputs, when fieldd signed them for this run; otherwise the file is set aside. */
  #read(file: string, runtimeRunId: string): QueuedInput[] | undefined {
    const path = join(this.opts.dir, file);
    const read = this.#signer.read(path);
    if ("why" in read) return this.#setAside(path, runtimeRunId, read.why);
    if (!("body" in read)) return undefined;
    const kept = AgentInputQueueFile.safeParse(read.body);
    if (!kept.success) return this.#setAside(path, runtimeRunId, "unreadable");
    // signed for another run: a file copied into this run's name
    if (kept.data.run !== runtimeRunId) return this.#setAside(path, runtimeRunId, "forged");
    return kept.data.inputs;
  }

  /** A kept file fieldd will not deliver: set aside for a human (signed-record.ts), never delivered. */
  #setAside(path: string, runtimeRunId: string, why: SetAsideWhy): undefined {
    const aside = setAsideFile(path, why);
    this.#logger.warn(
      "fieldd.inputs.set_aside",
      `A kept input queue is ${why}; set aside, never delivered`,
      { runtimeRunId, file: basename(path), why, aside: basename(aside) },
    );
    return undefined;
  }

  /** Keep the stamped head before it is pasted (Q2 (a)): true when the disk took it. One it did not take holds the
   * delivery for the next idle, and is said once. */
  #stamp(runtimeRunId: string, head: QueuedInput): boolean {
    try {
      this.#write(runtimeRunId);
      this.#unstamped.delete(head.id);
      return true;
    } catch (err) {
      if (!this.#unstamped.has(head.id)) {
        this.#unstamped.add(head.id);
        this.#logger.warn(
          "fieldd.inputs.unstamped",
          "A delivery could not be stamped before it began; it waits for the next idle",
          { runtimeRunId, reason: (err as Error).message },
        );
      }
      return false;
    }
  }

  /** Keep a run's queue, or say it could not be. */
  #keep(runtimeRunId: string): void {
    if (!SAFE_ID.test(runtimeRunId)) return;
    try {
      this.#write(runtimeRunId);
    } catch (err) {
      this.#logger.warn("fieldd.inputs.unkept", "An input queue could not be kept", {
        runtimeRunId,
        reason: (err as Error).message,
      });
    }
  }

  /** Write a run's queue whole and signed (or remove its file when empty): written beside, then renamed, 0600 in
   * 0700. A queue that cannot be signed is not kept, so no file waits that restore would refuse. Throws when the disk
   * does not take it, or the run's id is no file name. */
  #write(runtimeRunId: string): void {
    if (!SAFE_ID.test(runtimeRunId)) throw new Error("the run's id is no file name");
    const file = join(this.opts.dir, `${runtimeRunId}.json`);
    const queue = this.#queues.get(runtimeRunId);
    if (queue === undefined || queue.length === 0) {
      rmSync(file, { force: true });
      return;
    }
    const unsigned: AgentInputQueueFile = {
      format: AGENT_INPUT_QUEUE_FORMAT,
      run: runtimeRunId,
      inputs: queue,
    };
    const signature = this.#signer.sign(unsigned);
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.dir, 0o700);
    const part = `${file}.part`;
    writeFileSync(part, JSON.stringify({ ...unsigned, signature }), { mode: 0o600 });
    renameSync(part, file);
  }
}
