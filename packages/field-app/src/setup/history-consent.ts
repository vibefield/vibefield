import type { IndexDiscovery } from "@vibefield/contracts/agent-index";

// History's consent, as every door that asks it shares it (track AO, AO-3;
// DESIGN.md §8 "The Setup Assistant's agent chapter" — History, "Finish setting
// up", "Settings → History", History's consent slot). Pure: the rows the pane
// lists, what Bring in history sends, and the two sentences under the rows.

/** One agent whose history is on this Mac, as the pane lists it. */
export interface HistoryAgentRow {
  /** the wire kind — what `index.enroll` names */
  readonly kind: string;
  /** the catalog id, for its mark; null when no catalog row maps the kind */
  readonly agent: string | null;
  /** the catalog's label, or the kind when no row maps it */
  readonly label: string;
  /** where it lives, in the layout's `~` form */
  readonly root: string;
  readonly bytes: number;
  readonly newestModifiedMs: number;
  /** its history is already brought in */
  readonly consented: boolean;
}

/** The census's rows worth asking about: an agent with history on this Mac,
 * installed or not (History reads folders, not apps). An agent no catalog row
 * maps is never selectable, so it is not listed. Catalog order first. */
export function historyAgentRows(
  discoveries: readonly IndexDiscovery[],
  labels: ReadonlyMap<string, string>,
): readonly HistoryAgentRow[] {
  const order = [...labels.keys()];
  return discoveries
    .filter((row) => row.files > 0 && row.agent !== undefined && labels.has(row.agent))
    .map((row) => ({
      kind: row.kind,
      agent: row.agent ?? null,
      label: (row.agent !== undefined ? labels.get(row.agent) : undefined) ?? row.kind,
      root: row.dataRoot,
      bytes: row.bytes,
      newestModifiedMs: row.newestModifiedMs,
      consented: row.consented,
    }))
    .sort((a, b) => order.indexOf(a.agent ?? "") - order.indexOf(b.agent ?? ""));
}

/** Measured on James's M1 Max (2026-10-25): 13.3 GB listed in 4.1 s, read in 61 s
 * and searchable in 69 s on a quiet Mac — about 5.2 s a gigabyte to searchable. */
const SECONDS_PER_GB = 69 / 13.3;

/** The first reading's time, said once and honestly: a quiet Mac's minutes,
 * and that a busy one takes longer. Never a countdown. */
export function firstReadingSentence(bytes: number): string {
  const minutes = Math.round(((bytes / 1e9) * SECONDS_PER_GB) / 60);
  return minutes <= 1
    ? "About a minute on a quiet Mac, one time only. History fills in while you work."
    : `About ${minutes} minutes on a quiet Mac, longer while it is busy. History fills in while you work.`;
}
