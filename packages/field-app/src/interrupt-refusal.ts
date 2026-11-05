/**
 * A refusal fieldd expressed by THROWING, told apart from a daemon that could
 * not be answered at all (GT-6 review).
 *
 * `agent.interrupt` and `agent.pause` refuse a run that has ended or one they
 * do not know with an `RpcCallError` rather than with `{accepted: false}` — the
 * union's second arm is reserved for the floor's own refusal — and the renderer
 * sees that as a rejected promise carrying `kind` and `details`. Read
 * structurally rather than with `instanceof`: a caller holds its client through
 * a door, and a wrapper that re-threw a plain object would still be telling the
 * truth about a state. Returns fieldd's own word for the state, so a log or a
 * line says `not-alive` rather than a sentence the window invented.
 *
 * Godview's pause verb (`godview/GodviewDeck.tsx`) and Chat's head's Pause
 * (`chat/head-act.ts`, TH-2) read it; it was Godview's own until TH-2.
 */
export function interruptRefusal(cause: unknown): string | undefined {
  const error = cause as { kind?: unknown; details?: { state?: unknown } } | null;
  const kind = error?.kind;
  if (kind !== "PRECONDITION_FAILED" && kind !== "NOT_FOUND") return undefined;
  const state = error?.details?.state;
  return typeof state === "string" && state !== "" ? state : kind;
}
