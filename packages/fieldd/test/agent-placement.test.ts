import { describe, expect, it } from "vitest";
import { cellAdmits } from "../src/agent-placement";

// Item 121 (James A, 2026-10-31) — AR-4b's cell rule as both doors read it: the agent cell admits by construction;
// any other cell only on the record's own signed placement, naming this terminal on exactly that cell.

const PTY = "sess-01J8Z3KA";
const INTERACTIVE = {
  cellInstanceId: 1,
  cellBootId: "01JCELLBOOT0000000000000001",
  workloadClass: "interactive" as const,
};
const AGENT = {
  cellInstanceId: 2,
  cellBootId: "01JCELLBOOT0000000000000002",
  workloadClass: "agent" as const,
};
const PLACED = {
  terminalSessionId: PTY,
  placement: { cellBootId: INTERACTIVE.cellBootId, workloadClass: "interactive" as const },
};

describe("item 121 — the cell rule (`cellAdmits`)", () => {
  it("admits a PTY on the agent cell, as AR-4b always did, whatever the record says of a cell", () => {
    for (const record of [{ terminalSessionId: PTY }, PLACED]) {
      for (const verified of [true, false]) {
        expect(cellAdmits({ record, verified, terminalId: PTY, row: { cell: AGENT } })).toEqual({
          admits: true,
          by: "agent-cell",
        });
      }
    }
  });

  it("admits a PTY off the agent cell on a verified placement naming this terminal on exactly its cell", () => {
    expect(
      cellAdmits({ record: PLACED, verified: true, terminalId: PTY, row: { cell: INTERACTIVE } }),
    ).toEqual({ admits: true, by: "placement" });
  });

  it("refuses a record whose signature does not verify, before it reads the placement", () => {
    expect(
      cellAdmits({ record: PLACED, verified: false, terminalId: PTY, row: { cell: INTERACTIVE } }),
    ).toEqual({ admits: false, why: "unverified" });
  });

  it("refuses a PTY off the agent cell with no placement: a shell of the person's, and every record before item 121", () => {
    expect(
      cellAdmits({
        record: { terminalSessionId: PTY },
        verified: true,
        terminalId: PTY,
        row: { cell: INTERACTIVE },
      }),
    ).toEqual({ admits: false, why: "no-placement" });
  });

  it("refuses a placement on a record that names another terminal", () => {
    expect(
      cellAdmits({
        record: PLACED,
        verified: true,
        terminalId: "sess-other",
        row: { cell: INTERACTIVE },
      }),
    ).toEqual({ admits: false, why: "other-terminal" });
    expect(
      cellAdmits({
        record: { placement: PLACED.placement },
        verified: true,
        terminalId: PTY,
        row: { cell: INTERACTIVE },
      }),
    ).toEqual({ admits: false, why: "other-terminal" });
  });

  it("refuses a placement naming another cell, another class, or a row the inventory has not tagged", () => {
    const cases = [
      { cell: { ...INTERACTIVE, cellBootId: "01JCELLBOOT0000000000000009" } },
      { cell: { cellInstanceId: 1, cellBootId: INTERACTIVE.cellBootId } },
      {},
    ];
    for (const row of cases) {
      expect(
        cellAdmits({ record: PLACED, verified: true, terminalId: PTY, row }),
        JSON.stringify(row),
      ).toEqual({ admits: false, why: "other-cell" });
    }
    // the agent cell's own boot id, with the class the PTY is not on
    expect(
      cellAdmits({
        record: {
          ...PLACED,
          placement: { cellBootId: AGENT.cellBootId, workloadClass: "interactive" },
        },
        verified: true,
        terminalId: PTY,
        row: { cell: INTERACTIVE },
      }),
    ).toEqual({ admits: false, why: "other-cell" });
  });
});
