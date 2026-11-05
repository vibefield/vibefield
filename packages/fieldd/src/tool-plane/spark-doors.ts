import type {
  CallerContext,
  ComposeDesktop,
  ComposeDesktopState,
  ComposeSayState,
  SparkId,
} from "@vibefield/contracts";
import type { DeliveryOutcome, QueuedInput } from "../agent-input-queue";
import { RpcCallError } from "../native-link";
import { isSelfTailnetPrincipal } from "../terminal-grants";

// IOS-12a (PC-D7 A, PC-L2; the design page Chat in a Pocket, ruled 2026-11-04) — who the spark doors and the
// needs-you queue's doors answer, and how the home answers for every desktop.
//
// The doors are `sparks.use`, which the window's token and the phone's preset hold, and a self peer DAEMON only by
// PEER_FIELDD_SCOPES' derivation. A daemon reaches them two ways, and each is narrowed here (DS-L4, DS-L7):
// - as the CARRIER of a forwarded act (the home forwarding a phone's `open`, `say` or `needs.answer` to the desktop
//   the spark lives on): the call arrives as `peer-fieldd` with `forward.onBehalfOf` naming the person's screen.
// - for its OWN rows: the home merging the list asks each peer as itself (IndexMesh.ask, no envelope), and a
//   federated subscription's shared upstream is the home's own read (product-api.ts). A peer is never answered the
//   aggregate: a daemon never aggregates another's aggregate.
// The person's own screens are the window (`local-token` from a renderer), the shell, and a phone that is this
// person's (`tailnet`, its login matched: `isSelfTailnetPrincipal`). A plugin, an agent, a guest, a debug client with
// a copied token and a tailnet login this desktop has not matched are refused.

/** What a reader is answered: the home's merge of every self desktop, or this desktop's own rows. */
export type SparkReader = "home" | "own";

/** The client kinds that are a person's screen, as a forwarding daemon names its caller (`OnBehalfOf.clientKind`).
 * Restrict-only: the owner records `onBehalfOf` and never trusts it to widen anything. */
const PERSON_SCREENS: ReadonlySet<string> = new Set(["renderer", "shell-main", "ios"]);

function isPersonsScreen(ctx: CallerContext): boolean {
  const principal = ctx.principal;
  if (principal.kind === "shell-main") return true;
  if (principal.kind === "local-token") return ctx.clientKind === "renderer";
  return isSelfTailnetPrincipal(principal);
}

function refusal(ctx: CallerContext, method: string, why: string): RpcCallError {
  return new RpcCallError("FORBIDDEN_SCOPE", why, false, {
    method,
    principal: ctx.principal.kind,
  });
}

/** A read (`compose.sparks.list`, `needs.list`, `needs.subscribe`): the person's screens get the home's answer; a peer
 * daemon gets this desktop's own rows (DS-L4). */
export function admitSparkReader(ctx: CallerContext, method: string): SparkReader {
  if (isPersonsScreen(ctx)) return "home";
  if (ctx.principal.kind === "peer-fieldd") return "own";
  throw refusal(
    ctx,
    method,
    "the sparks and the needs-you queue answer the person's own windows and devices only — never a plugin, an agent or a guest",
  );
}

/** An act (`compose.sparks.open`, `.say`, `.hatch`, `needs.answer`): the person's screens, here; a peer daemon only
 * as the carrier of a forwarded act, which names the person's screen behind it (DS-L7). */
export function admitSparkActor(ctx: CallerContext, method: string): void {
  if (isPersonsScreen(ctx)) return;
  if (ctx.principal.kind === "peer-fieldd") {
    const behalf = ctx.onBehalfOf;
    if (behalf !== undefined && PERSON_SCREENS.has(behalf.clientKind)) return;
    throw refusal(
      ctx,
      method,
      "a peer daemon carries a person's act on a spark, never its own: this call names no window or phone behind it",
    );
  }
  throw refusal(
    ctx,
    method,
    "a spark's acts are the person's, from their own windows and devices — never a plugin's, an agent's or a guest's",
  );
}

/** How the home asks its self peers (IndexMesh's rules: an asleep or incompatible desktop is not asked, a silent one
 * times out at the search budget). */
export interface DesktopAsk {
  /** this desktop's id */
  readonly self: string;
  /** every self peer the home knows (IndexMesh.peerDevices) */
  peers(): readonly string[];
  ask(
    device: string,
    method: string,
    params: unknown,
  ): Promise<
    | { answered: true; value: unknown }
    | { answered: false; source: { device: string; state: string } }
  >;
}

/** A desktop that did not answer, in the doors' words (COMPOSE_DESKTOP_STATES): the search's `building` and any
 * refusal read as `unreachable`, since the home cannot say more. */
function desktopStateOf(state: string): ComposeDesktopState {
  return state === "asleep" || state === "timeout" || state === "incompatible"
    ? state
    : "unreachable";
}

/** IOS-12a (PC-L2) — the home's merge: its own rows, then each self peer's own rows (asked as the home, so each peer
 * answers its own, DS-L4), every row stamped with the desktop the home asked, and `desktops` saying how each one
 * answered. A peer's answer this build cannot read is that desktop `incompatible`; a row of it that does not read is
 * passed over (the tolerant reader), never the desktop's other rows. */
export async function mergeAtHome<Row extends { device?: string | undefined }>(opts: {
  own: readonly Row[];
  method: string;
  ask: DesktopAsk;
  /** the rows of a peer's answer, each read on its own; undefined: the answer has no list to read */
  rows: (value: unknown) => readonly (Row | undefined)[] | undefined;
}): Promise<{ rows: Row[]; desktops: ComposeDesktop[] }> {
  const { own, method, ask } = opts;
  const rows: Row[] = own.map((row) => ({ ...row, device: ask.self }));
  const desktops: ComposeDesktop[] = [{ device: ask.self, state: "answered" }];
  const peers = ask.peers().filter((device) => device !== ask.self);
  const answers = await Promise.all(
    peers.map(async (device) => ({ device, answer: await ask.ask(device, method, {}) })),
  );
  for (const { device, answer } of answers) {
    if (!answer.answered) {
      desktops.push({ device, state: desktopStateOf(answer.source.state) });
      continue;
    }
    const theirs = opts.rows(answer.value);
    if (theirs === undefined) {
      desktops.push({ device, state: "incompatible" });
      continue;
    }
    for (const row of theirs) if (row !== undefined) rows.push({ ...row, device });
    desktops.push({ device, state: "answered" });
  }
  return { rows, desktops };
}

/** What one say asked, kept to answer its request id again (a retry, or a reader asking for its receipt). */
interface SayEntry {
  readonly spark: SparkId;
  readonly runtimeRunId: string;
  readonly inputId: string;
  /** the last word of the queue about it: `waiting` while a delivery was turned away, else how it ended */
  outcome?: DeliveryOutcome | undefined;
}

/** The receipts this desktop keeps of its says, newest last: enough for any send a phone still shows as pending. */
export const SAY_RECEIPTS_KEPT = 512;

/** IOS-12a (PC-D3 A) — the says this desktop queued, by request id, and what became of each: a retried say over a
 * dropped leg answers the first one's receipt instead of queueing the words twice. Kept in memory, the newest
 * SAY_RECEIPTS_KEPT. Across a fieldd restart (item 158) a say still waiting is found in the queue itself (its kept
 * input carries the request id), and one the restart broke into answers `uncertain` there; whatever the queue says of
 * a kept say after the restart is kept by that request id. One delivered before the restart left the queue and is not
 * remembered, so its retry would queue its words again (item 169). */
export class SayReceipts {
  readonly #byRequest = new Map<string, SayEntry>();
  readonly #byInput = new Map<string, string>();
  /** item 158 — how a say this boot never queued ended, by the request id its kept input carried (a restart's) */
  readonly #restored = new Map<string, DeliveryOutcome>();

  constructor(
    private readonly queue: {
      pending(runtimeRunId: string): readonly QueuedInput[];
      findRequest(requestId: string):
        | {
            runtimeRunId: string;
            input: QueuedInput;
            position: number;
            /** the head a restart broke into (item 158): never sent again */
            restarted?: boolean;
          }
        | undefined;
    },
  ) {}

  /** A say just queued. */
  queued(requestId: string, spark: SparkId, runtimeRunId: string, inputId: string): void {
    this.#byRequest.delete(requestId);
    this.#byRequest.set(requestId, { spark, runtimeRunId, inputId });
    this.#byInput.set(inputId, requestId);
    while (this.#byRequest.size > SAY_RECEIPTS_KEPT) {
      const oldest = this.#byRequest.keys().next().value as string;
      const entry = this.#byRequest.get(oldest);
      this.#byRequest.delete(oldest);
      if (entry !== undefined) this.#byInput.delete(entry.inputId);
    }
  }

  /** The queue's word about one of the person's inputs (the queues' `onOutcome`). */
  heard(input: QueuedInput, outcome: DeliveryOutcome): void {
    if (input.from.kind !== "you") return;
    const requestId = this.#byInput.get(input.id) ?? input.requestId;
    const entry = requestId !== undefined ? this.#byRequest.get(requestId) : undefined;
    if (entry !== undefined && entry.inputId === input.id) {
      entry.outcome = outcome;
      return;
    }
    // a say a restart kept (item 158): by its own request id, once it has ended; while it waits, the queue holds it
    if (input.requestId === undefined || outcome === "waiting") return;
    this.#restored.delete(input.requestId);
    this.#restored.set(input.requestId, outcome);
    while (this.#restored.size > SAY_RECEIPTS_KEPT)
      this.#restored.delete(this.#restored.keys().next().value as string);
  }

  /** The receipt a request id has here, for this spark; undefined: this desktop never queued it (or forgot it). A
   * request id another spark's say used is refused: a caller mints one per send. */
  receipt(
    spark: SparkId,
    requestId: string,
  ): { state: ComposeSayState; position?: number | undefined } | undefined {
    const entry = this.#byRequest.get(requestId);
    if (entry === undefined) {
      // kept across a restart: how it ended since, or, while it is in the queue still, waiting there with its request
      // id, unless the restart broke into its delivery (item 158), which is never sent again
      const ended = this.#restored.get(requestId);
      if (ended !== undefined) return { state: ended };
      const found = this.queue.findRequest(requestId);
      if (found === undefined) return undefined;
      if (found.restarted === true) return { state: "uncertain" };
      return { state: "queued", position: found.position };
    }
    if (entry.spark !== spark)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "this request id is another spark's send: mint one per send",
        false,
      );
    if (entry.outcome !== undefined && entry.outcome !== "waiting") return { state: entry.outcome };
    const pending = this.queue.pending(entry.runtimeRunId);
    const at = pending.findIndex((input) => input.id === entry.inputId);
    if (at < 0) return { state: "dropped" };
    return { state: entry.outcome === "waiting" ? "waiting" : "queued", position: at + 1 };
  }
}
