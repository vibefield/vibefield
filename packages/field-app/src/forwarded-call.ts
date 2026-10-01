import { forwardReceiptOf } from "@vibefield/fieldd-client";

// DS-D15's client half, the window's side (DS wave 2, 2026-10-01): "a window
// echoes the key from an outcome-unknown".
//
// fieldd-client keys every keyed forward — a mutation routed by `device` to
// another desktop — with ONE idempotency key per logical call, and when such a
// call may have reached its owner without an answer reaching the window (the
// owner's answer lost on the peer link, or the window's own socket cut after
// the request left) it fails `UNAVAILABLE {state: "outcome-unknown"}` naming
// that key (`error.forward.idempotencyKey`). The act may or may not have
// happened, and guessing either way is the bug: retried with a fresh key it
// applies twice; reported as failed it lies. A window that wants the act done
// asks again with the SAME key, and the owner answers from its receipt — the
// answer it already gave, or the act applied now — never twice.
//
// A call that is not keyed (served on this desktop, or a read) never fails
// this way, so `requestResolvingOutcome` is exactly one request for it.

/** The client half the helper rides (`FielddClient.request`). */
export interface KeyedCallClient {
  request(
    method: string,
    params: Record<string, unknown>,
    opts?: { idempotencyKey?: string | undefined },
  ): Promise<unknown>;
}

/** The key an outcome-unknown names; undefined for every other failure (the
 * call's own answer, which a retry must not paper over). */
export function outcomeUnknownKey(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  const { details, forward } = cause as {
    details?: { state?: unknown } | undefined;
    forward?: { idempotencyKey?: unknown } | undefined;
  };
  if (details?.state !== "outcome-unknown") return undefined;
  return typeof forward?.idempotencyKey === "string" ? forward.idempotencyKey : undefined;
}

/** What the retry's answer may be in place of the call's own: the owner's
 * receipt, when the original applied with an answer too large to journal. */
export type AnswerGone = "throw" | "ask-anew";

/**
 * One logical call: asked once and, when its outcome is unknown, ONCE more
 * with the same key — that retry resolves it. A second unknown is thrown as it
 * came (the caller says so; it never guesses). When the retry is answered with
 * the owner's receipt in place of the result (applied, the answer gone):
 * `throw` for an act that must not run twice (a birth — the caller finds what
 * it made another way), `ask-anew` for one whose repeat is harmless (a ticket:
 * a NEW logical call, a fresh key, a fresh ticket; the lost one expires).
 */
export async function requestResolvingOutcome(
  client: KeyedCallClient,
  method: string,
  params: Record<string, unknown>,
  answerGone: AnswerGone = "throw",
): Promise<unknown> {
  let key: string | undefined;
  try {
    return await client.request(method, params);
  } catch (cause) {
    key = outcomeUnknownKey(cause);
    if (key === undefined) throw cause;
  }
  const answer = await client.request(method, params, { idempotencyKey: key });
  if (forwardReceiptOf(answer, key) === undefined) return answer;
  if (answerGone === "ask-anew") return await client.request(method, params);
  throw new AnswerLostError(method, key);
}

/** The act applied on its owner and its answer did not survive (a receipt in
 * its place): never "failed", never retried — the caller reads the state. */
export class AnswerLostError extends Error {
  readonly method: string;
  readonly idempotencyKey: string;

  constructor(method: string, idempotencyKey: string) {
    super(`${method} applied, and its answer was lost`);
    this.name = "AnswerLostError";
    this.method = method;
    this.idempotencyKey = idempotencyKey;
  }
}
