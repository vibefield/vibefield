// SP-D13 (a), James, 2026-10-03 — the phone may search and list its own
// history, BOUNDED. `index.search` is in the tailnet preset since that ruling;
// what keeps a radio's answers small is the rule below, applied at the four
// history doors in daemon.ts (`index.search` — both arms —, `index.sessions`'
// listing, `index.projects`, `index.recent`) before a question reaches the
// index service. The service stays free of principal knowledge: it sees a
// limit, never who asked for it.
import { INDEX_TAILNET_LIMITS, type Principal } from "@vibefield/contracts";

/**
 * The limit a history door asks its service for, given who is asking.
 *
 * A caller that crossed the tailnet as a person's own device — the `tailnet`
 * principal, which is the phone — gets `min(requested ?? fallback,
 * INDEX_TAILNET_LIMITS.MAX_ROWS)`, where `fallback` is the door's own default
 * (what its service uses when nothing is asked). The service then stops at
 * that number and says so the way it always has: a search sets `clipped`, a
 * listing hands back its `cursor`. A `tailnet-guest` is bounded the same way;
 * none reaches these doors today (its preset is empty and no index door is
 * `guestOk`), and a history door that ever admitted one must not hand it a
 * window's limit.
 *
 * Every other caller's ask passes through untouched, a missing one included,
 * so its service applies its own default exactly as before: a window, the
 * shell, a plugin, an MCP agent — and, deliberately, the self peer DAEMON
 * (`peer-fieldd`). A peer asks on behalf of a window on another desktop and
 * carries that window's limits; bounding it would cut a window's answer at a
 * phone's page.
 */
export function tailnetRowLimit(
  principal: Principal,
  requested: number | undefined,
  fallback: number,
): number | undefined {
  if (principal.kind !== "tailnet" && principal.kind !== "tailnet-guest") return requested;
  return Math.min(requested ?? fallback, INDEX_TAILNET_LIMITS.MAX_ROWS);
}
