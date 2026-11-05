// AC-3 — the catalog a test composes beside its scripted provider: THE table
// plus one row for `scripted`, so the catalog's rules (only a visible row is
// offered; a claim is what the row says) are exercised without a vendor
// literal in any assertion. Test-only; the gate's R23 never reads it.
import { AGENT_CATALOG, type AgentCatalogEntry } from "@vibefield/contracts";

export const SCRIPTED_ROW: AgentCatalogEntry = {
  id: "scripted",
  label: "Scripted",
  status: "preview",
  seams: { puppeteer: { provider: "scripted" }, rosetta: null },
  layoutRoot: null,
  offers: {
    spawn: true,
    resume: true,
    reattach: true,
    history: false,
    usage: true,
    distribution: true,
    personas: true,
    // the scripted provider composes no launch port, so no native grammar (AR-7a)
    invoke: false,
    // CP-5a — the spark tests' agent: it declares the whole briefing on a terminal where a test composes it, and this
    // table is the test seam's, never R23's, so its claim stands on a preview row (THE table claims it on a supported
    // row alone, CP5-Q9)
    spark: true,
  },
  admitted: "2026-09-22",
  decision: "test fixture — the scripted adapter beside the real rows",
  surfaces: { desktop: true, phone: true },
};

/** THE table plus the scripted row (the default for a daemon test that composes it). */
export const SCRIPTED_CATALOG: readonly AgentCatalogEntry[] = [...AGENT_CATALOG, SCRIPTED_ROW];

/** THE table with one row's fields overridden — a declined or deprecated
 * claude, a row without personas — for the refusal tests. */
export function catalogWith(
  id: string,
  patch: Partial<Omit<AgentCatalogEntry, "id">>,
): readonly AgentCatalogEntry[] {
  return SCRIPTED_CATALOG.map((row) =>
    row.id === id
      ? ({ ...row, ...patch, offers: { ...row.offers, ...patch.offers } } as AgentCatalogEntry)
      : row,
  );
}
