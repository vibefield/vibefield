import { randomBytes } from "node:crypto";
import {
  OBJECT_LIMITS,
  OBJECT_ROOM,
  ObjectIntent,
  type ObjectIntentAnswer,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";

// OB-3b (CP-D13; thinking-objects-at-work.md §5.5) — fieldd asks the one window holding a board to read or change an
// object, and waits for its answer: only the window knows a board's meaning and whether the person's hand is on an
// object. The window subscribes per board (a shell provider cannot serve this: it lands in main, which has no desk). A
// board nobody is holding answers UNAVAILABLE {service: "desk", state: "no-window"} at once, and a subscription that
// closes rejects what was pending on it the same way: honest, never a queue that acts later.

export const noWindow = (): RpcCallError =>
  new RpcCallError(
    "UNAVAILABLE",
    "That desk is not open in a VibeField window, so nothing was done. Ask the user to open it.",
    true,
    { service: "desk", state: "no-window" },
  );

const noAnswer = (): RpcCallError =>
  new RpcCallError(
    "UNAVAILABLE",
    "The window did not answer in time, so VibeField cannot tell whether this happened. Look before you try again.",
    true,
    { service: "desk", state: "no-answer" },
  );

/** One thing asked, by its op and its fields; the table gives it its id. */
export type IntentAsk = { readonly op: ObjectIntent["op"] } & Readonly<Record<string, unknown>>;

/** What a window answered, its refusals already thrown. */
export interface IntentAnswered {
  readonly value: unknown;
  readonly inverse?: unknown;
  readonly changed?: string;
}

interface Subscription {
  readonly docId: string;
  readonly tokenId: string;
  readonly send: (intent: ObjectIntent) => void;
}

interface Pending {
  readonly subscription: Subscription;
  readonly resolve: (answered: IntentAnswered) => void;
  readonly reject: (err: RpcCallError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface DeskIntentsOptions {
  /** how long a window has to answer (tests) */
  readonly answerMs?: number;
  /** a new intent's id (tests) */
  readonly mintId?: () => string;
  readonly now?: () => number;
}

export class DeskIntents {
  /** in subscription order: the last is the most recently subscribed desk */
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #pending = new Map<string, Pending>();
  readonly #answerMs: number;
  readonly #mintId: () => string;
  readonly #now: () => number;

  constructor(opts: DeskIntentsOptions = {}) {
    this.#answerMs = opts.answerMs ?? OBJECT_LIMITS.INTENT_ANSWER_MS;
    this.#mintId = opts.mintId ?? (() => `in-${randomBytes(8).toString("hex")}`);
    this.#now = opts.now ?? Date.now;
  }

  /** The board `canvas_place` and `canvas_list` mean: the most recently subscribed one. */
  defaultDoc(): string | undefined {
    return [...this.#subscriptions.keys()].at(-1);
  }

  /** Whether a window holds this board now. */
  holds(docId: string): boolean {
    return this.#subscriptions.has(docId);
  }

  /** A window takes a board's intents. A second subscription to a board replaces the first, whose pending intents are
   * refused: it will never answer them. Disposing is idempotent, and an old subscription's cannot touch its successor. */
  subscribe(docId: string, tokenId: string, send: (intent: ObjectIntent) => void): () => void {
    const previous = this.#subscriptions.get(docId);
    if (previous !== undefined) this.#close(previous);
    const subscription: Subscription = { docId, tokenId, send };
    this.#subscriptions.set(docId, subscription);
    return () => {
      if (this.#subscriptions.get(docId) === subscription) this.#close(subscription);
    };
  }

  /** Ask the window holding `docId`. Rejects as UNAVAILABLE when none is, or none answers; rejects with the window's own
   * fact when it refuses. */
  ask(docId: string, ask: IntentAsk): Promise<IntentAnswered> {
    const subscription = this.#subscriptions.get(docId);
    if (subscription === undefined) return Promise.reject(noWindow());
    if (
      [...this.#pending.values()].filter((p) => p.subscription === subscription).length >=
      OBJECT_ROOM.PENDING_INTENTS
    )
      return Promise.reject(
        new RpcCallError(
          "PRECONDITION_FAILED",
          "Too many desk calls are waiting on this window; try again in a moment.",
          true,
          { fact: "limit" },
        ),
      );
    const intent = ObjectIntent.parse({
      ...ask,
      intent: this.#mintId(),
      expiresAt: this.#now() + this.#answerMs,
    });
    return new Promise<IntentAnswered>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.delete(intent.intent)) reject(noAnswer());
      }, this.#answerMs);
      timer.unref?.();
      this.#pending.set(intent.intent, { subscription, resolve, reject, timer });
      try {
        subscription.send(intent);
      } catch {
        // the window's socket is gone: its close will follow, but this intent never left
        if (this.#settle(intent.intent)) reject(noWindow());
      }
    });
  }

  /** The window's answer. An answer that matches no pending intent, or comes from any other window than the one asked
   * (a late answer after a deadline, a stale reload), is not taken. */
  answer(answer: ObjectIntentAnswer, tokenId: string): { taken: boolean } {
    const pending = this.#pending.get(answer.intent);
    if (pending === undefined || pending.subscription.tokenId !== tokenId) return { taken: false };
    this.#settle(answer.intent);
    if (answer.ok) {
      pending.resolve({
        value: answer.value,
        ...(answer.inverse !== undefined ? { inverse: answer.inverse } : {}),
        ...(answer.changed !== undefined ? { changed: answer.changed } : {}),
      });
    } else {
      pending.reject(
        new RpcCallError("PRECONDITION_FAILED", answer.text, answer.fact === "held", {
          fact: answer.fact,
        }),
      );
    }
    return { taken: true };
  }

  #close(subscription: Subscription): void {
    this.#subscriptions.delete(subscription.docId);
    for (const [id, pending] of [...this.#pending]) {
      if (pending.subscription !== subscription) continue;
      this.#settle(id);
      pending.reject(noWindow());
    }
  }

  #settle(id: string): boolean {
    const pending = this.#pending.get(id);
    if (pending === undefined) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    return true;
  }
}
