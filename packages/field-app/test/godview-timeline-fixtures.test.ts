import { AgentListResult, AgentRunHistory } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { timelineAfternoon } from "../src/design-system/godview-timeline-fixtures";

// TL — the catalog's afternoon is real-shaped: the fold's rows and the ledger's
// runs parse as fieldd's own, each run's changes run forward in time and end in
// the state its row says, and the same afternoon is dealt every time.
describe("TL — the catalog's afternoon", () => {
  const NOW = Date.parse("2026-10-02T16:00:00.000Z");

  it("parses as the fold and the ledger would send it", () => {
    const { rows, runs } = timelineAfternoon(NOW);
    expect(AgentListResult.safeParse({ sessions: rows }).success).toBe(true);
    for (const run of runs) expect(AgentRunHistory.safeParse(run).success).toBe(true);
  });

  it("runs forward in time, ends in each row's state, and ends one run", () => {
    const { rows, runs } = timelineAfternoon(NOW);
    runs.forEach((run, i) => {
      const at = run.changes.map((change) => Date.parse(change.at));
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(run.changes.at(-1)?.status).toBe(rows[i]?.status);
    });
    expect(runs.filter((run) => run.exitedAt !== undefined)).toHaveLength(1);
    expect(timelineAfternoon(NOW)).toEqual(timelineAfternoon(NOW));
  });
});
