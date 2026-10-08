import { AgentListResult } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { timelineAfternoon } from "../src/design-system/godview-timeline-fixtures";

// TL — the catalog's afternoon is real-shaped: the fold's rows parse as
// fieldd's own, each run is alive in its current state since a moment after
// its birth and before now (runtime only, MV-6: no record of what it did
// before), and the same afternoon is dealt every time.
describe("TL — the catalog's afternoon", () => {
  const NOW = Date.parse("2026-10-02T16:00:00.000Z");

  it("parses as the fold would send it", () => {
    const { rows } = timelineAfternoon(NOW);
    expect(AgentListResult.safeParse({ sessions: rows }).success).toBe(true);
  });

  it("holds live runs, each in its current state since after its birth, dealt the same every time", () => {
    const { rows } = timelineAfternoon(NOW);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const born = Date.parse(row.createdAt);
      const since = Date.parse(row.monitor?.statusSince ?? "");
      expect(row.monitor?.alive).toBe(true);
      expect(row.monitor?.status).toBe(row.status);
      expect(since).toBeGreaterThan(born);
      expect(since).toBeLessThan(NOW);
    }
    expect(timelineAfternoon(NOW)).toEqual(timelineAfternoon(NOW));
  });
});
