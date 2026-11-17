// Item 476 (2026-11-16) — how a refusal for room is read, and the cadence it is
// asked again on. Since item 476 fieldd admits a subscription by its key, so a
// person reaches this refusal only through a fault (a key held past its
// holders): the honest answer is to ask again by itself, never to say fieldd's
// words. The shared feed (feeds.ts) asks on these steps, and the package root
// re-exports them (client.ts) so a window's other re-asks keep the same ones.
//
// React-free and import-free on purpose: the root entry runs in the renderer,
// in plugin workers and in Electron main.

/** A re-ask's steps: the first wait, what each later wait is multiplied by, and
 * the wait no step passes. */
export interface ReaskBackoff {
  readonly firstMs: number;
  readonly factor: number;
  readonly ceilingMs: number;
}

/** The cadence a refusal for room is asked again on (item 476). */
export const REASK_BACKOFF = { firstMs: 1_000, factor: 2, ceilingMs: 30_000 } as const;

/** The wait before ask number `step` (0 is the first re-ask): 1 s, 2, 4, 8, 16,
 * then 30 s for good. */
export function reaskDelayMs(step: number, backoff: ReaskBackoff = REASK_BACKOFF): number {
  // a step below 0 or not finite reads as the first, and no step passes the
  // ceiling however far the count runs (a factor raised past a number's range
  // is Infinity, which the ceiling still answers)
  const steps = Number.isFinite(step) && step > 0 ? step : 0;
  return Math.min(backoff.firstMs * backoff.factor ** steps, backoff.ceilingMs);
}

/** The daemon refused a subscribe for want of ROOM: the connection holds its
 * budget (product-api's `subscriptionBudgetRefusal`). Read by shape, since a
 * refusal may come from a stand-in client as much as from this one.
 * *Corrected 2026-11-16 (item 476): there is no budget since item 476. The
 * door's function is `subscriptionAdmissionRefusal`, and room runs out when the
 * connection holds a key at its holders, or a `bounded` method at its bound.
 * The refusal's shape is the same (`RESOURCE_EXHAUSTED`, with
 * `resource: "subscriptions"` and `limit` the bound that refused), so this
 * reads it as before and no behaviour moves.* */
export function refusedForRoom(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { kind, details } = error as { kind?: unknown; details?: unknown };
  if (kind !== "RESOURCE_EXHAUSTED" || details === null || typeof details !== "object") {
    return false;
  }
  return (details as { resource?: unknown }).resource === "subscriptions";
}
