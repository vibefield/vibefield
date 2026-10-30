import { type SetupLedger, setupMomentState, setupStepState } from "@vibefield/contracts/setup";
import type { HistoryAgentRow } from "./history-consent";
import { agentPastMoment } from "./ledger";
import type { HistoryCensus } from "./use-history-census";

// A new agent with a past (track AO, AO-6b; AO-D15, ruled (a) by James
// 2026-10-27; DESIGN.md §8 "The moments"): an agent whose history is on this
// Mac, that History's own question never asked about, is offered once at
// History's head. Pure: which one, if any.

/** The one agent History's head offers. Only once History's question has been
 * answered (until then Finish setting up lists it) and while something is
 * brought in (with nothing, the room shows History's pane itself, which lists
 * every agent): the first in the catalog's order whose past is not brought in
 * and whose moment was never retired — by Not now, by bringing it in, or by
 * History's pane having asked — nor answered in this window (`answered`, so
 * the row leaves before the ledger says so, and for good if its write fails). */
export function newAgentWithAPast(
  census: HistoryCensus,
  ledger: SetupLedger | null,
  answered: ReadonlySet<string> = new Set(),
): HistoryAgentRow | null {
  if (ledger === null || census.kind !== "found" || census.consented.length === 0) return null;
  if (setupStepState(ledger, "history") !== "answered") return null;
  return (
    census.rows.find(
      (row) =>
        !row.consented &&
        row.agent !== null &&
        !answered.has(row.agent) &&
        setupMomentState(ledger, agentPastMoment(row.agent)) !== "retired",
    ) ?? null
  );
}
