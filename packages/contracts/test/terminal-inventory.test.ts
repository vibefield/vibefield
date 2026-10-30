import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ErrorData, UnavailableDetails } from "../src/errors";
import {
  NATIVE_SUPERVISION,
  NativeUnavailableDetails,
  ObservedStaleCell,
  ObservedState,
} from "../src/mgmt";
import { TERMINAL_INVENTORY } from "../src/registries";
import {
  TERMINAL_INVENTORY_REFUSALS,
  TerminalInventoryStaleDetails,
  TerminalListResult,
  TerminalObservation,
} from "../src/terminal";

// IL-D1…IL-D6 (`draft/thinking-inventory-latency.md`, ruled 2026-10-19) — how old the floor's
// terminal inventory may be, and what it says when it is older. The floor judges each cell's age
// from its last applied reconcile and publishes the cells past the bound on the observed stream;
// fieldd composes that with its own half (the stream stopped reaching it) onto `terminal.list`,
// and the doors that act on the inventory refuse UNAVAILABLE {terminal, inventory_stale}. These
// rows pin the numbers and the shapes; fixtures.test.ts parses every fixture by its prefix, and
// fixture_parity.rs reads the floor's half in Rust.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describe("TERMINAL_INVENTORY — the bound's numbers (IL-D1's first values)", () => {
  const t = TERMINAL_INVENTORY;

  it("pins the ruled values: a re-ruling moves them here, with a dated note at source", () => {
    expect(t.BACKSTOP_MS).toBe(5_000);
    expect(t.STALE_MS).toBe(10_000);
    expect(t.SLOW_RECONCILE_MS).toBe(1_000);
    expect(t.SAMPLE_MS).toBe(1_000);
  });

  it("leaves a healthy cell inside the bound, with room for a slow reconcile to land", () => {
    // a healthy cell's inventory peaks near the backstop plus one round trip
    expect(t.STALE_MS).toBeGreaterThan(t.BACKSTOP_MS);
    // a reconcile logged slow can still land before the cell reads stale
    expect(t.STALE_MS - t.BACKSTOP_MS).toBeGreaterThan(t.SLOW_RECONCILE_MS);
    expect(t.SLOW_RECONCILE_MS).toBeLessThan(t.BACKSTOP_MS);
  });

  it("judges often enough to resolve the bound", () => {
    expect(t.SAMPLE_MS).toBeGreaterThan(0);
    expect(t.SAMPLE_MS).toBeLessThan(t.STALE_MS);
  });

  it("lets fieldd's own half see a stopped tick before its copy reaches the bound", () => {
    // fieldd counts its copy stale once the stream has not reached it for STALE_MS, and a tick
    // older than TICK_STALE_MS is no tick: the second must be the shorter
    expect(NATIVE_SUPERVISION.TICK_STALE_MS).toBeLessThan(t.STALE_MS);
  });
});

describe("the floor's carrier — ObservedState.inventoryBoundMs and staleCells (IL-D4)", () => {
  it("lets a judging floor say every cell is fresh with the bound alone", () => {
    const fresh = ObservedState.parse(fixture("observed-state.fresh.json"));
    expect(fresh.inventoryBoundMs).toBe(TERMINAL_INVENTORY.STALE_MS);
    expect(fresh.staleCells).toBeUndefined();
  });

  it("names a stale cell by the inventory's own tag, with the instant it went quiet", () => {
    const stale = ObservedState.parse(fixture("observed-state.stale-cell.json"));
    expect(stale.inventoryBoundMs).toBe(TERMINAL_INVENTORY.STALE_MS);
    expect(stale.staleCells).toHaveLength(1);
    const [cell] = stale.staleCells ?? [];
    // the entry joins onto the rows: the stale cell's own rows are still published
    const rows = stale.terminals.filter((row) => row.cell?.cellBootId === cell?.cellBootId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cell?.cellInstanceId).toBe(cell?.cellInstanceId);
    expect(Number.isSafeInteger(cell?.since)).toBe(true);
  });

  it("keeps an older floor's observation parsing, its silence an absence and never a reading", () => {
    const older = ObservedState.parse(fixture("observed-state.valid.json"));
    expect(older.inventoryBoundMs).toBeUndefined();
    expect(older.staleCells).toBeUndefined();
  });

  it("refuses a bound or an entry that is not a whole, non-negative number", () => {
    const base = ObservedState.parse(fixture("observed-state.fresh.json"));
    for (const inventoryBoundMs of [-1, 1.5, "10000"])
      expect(
        ObservedState.safeParse({ ...base, inventoryBoundMs }).success,
        String(inventoryBoundMs),
      ).toBe(false);

    const entry = { cellInstanceId: 2, cellBootId: "01JCELLBOOT0000000000000002", since: 1 };
    expect(ObservedStaleCell.parse(entry)).toEqual(entry);
    expect(ObservedStaleCell.safeParse({ ...entry, cellBootId: "" }).success).toBe(false);
    expect(ObservedStaleCell.safeParse({ ...entry, since: -1 }).success).toBe(false);
    expect(ObservedStaleCell.safeParse({ ...entry, since: 1.5 }).success).toBe(false);
    expect(ObservedStaleCell.safeParse({ ...entry, cellInstanceId: 2.5 }).success).toBe(false);
    const { since: _since, ...withoutSince } = entry;
    expect(ObservedStaleCell.safeParse(withoutSince).success).toBe(false);
  });
});

describe("a husk on the list — ObservedTerminal.exited (item 97)", () => {
  it("says a listed pane's process has ended, on that row alone, and stays absent on a live one", () => {
    const husk = ObservedState.parse(fixture("observed-state.exited-husk.json"));
    const [live, ended] = husk.terminals;
    expect(live?.exited).toBeUndefined();
    expect(ended?.exited).toBe(true);
    // the husk stays listed: its pane is kept (`keep-until-explicit-close`), so leaving the list
    // is not how its end is told
    expect(ended?.persistence).toBe("keep-until-explicit-close");
  });

  it("keeps every older floor's row parsing, its silence never a word that the process lives", () => {
    for (const name of ["observed-state.valid.json", "observed-state.fresh.json"])
      for (const row of ObservedState.parse(fixture(name)).terminals)
        expect(row.exited, name).toBeUndefined();
  });

  it("refuses an exit fact that is not a boolean", () => {
    const base = ObservedState.parse(fixture("observed-state.exited-husk.json"));
    const [, ended] = base.terminals;
    for (const exited of ["true", 1, null])
      expect(
        ObservedState.safeParse({ ...base, terminals: [{ ...ended, exited }] }).success,
        String(exited),
      ).toBe(false);
  });
});

describe("fieldd's composed view — TerminalObservation.boundMs and staleCells (IL-D4, IL-D5 (a))", () => {
  it("answers every row with its age: one stale cell never hides another cell's rows", () => {
    const list = TerminalListResult.parse(fixture("terminal-list.stale-cell.json"));
    const stale = new Set(list.observation?.staleCells?.map((cell) => cell.cellBootId));
    expect(list.observation?.boundMs).toBe(TERMINAL_INVENTORY.STALE_MS);
    expect(stale.size).toBe(1);
    expect(list.terminals.filter((row) => stale.has(row.cell?.cellBootId ?? ""))).toHaveLength(1);
    expect(list.terminals.filter((row) => !stale.has(row.cell?.cellBootId ?? ""))).toHaveLength(1);
  });

  it("marks every cell stale from the last delivery once the stream stops reaching fieldd", () => {
    const list = TerminalListResult.parse(fixture("terminal-list.link-silent.json"));
    const staleCells = list.observation?.staleCells ?? [];
    const cells = new Set(list.terminals.map((row) => row.cell?.cellBootId));
    expect(new Set(staleCells.map((cell) => cell.cellBootId))).toEqual(cells);
    expect(new Set(staleCells.map((cell) => cell.since)).size).toBe(1);
  });

  it("keeps an observation from a fieldd or floor that predates the bound parsing, age unknown", () => {
    const older = TerminalObservation.parse({ bootId: "b1c2d3e4", generation: 7 });
    expect(older.boundMs).toBeUndefined();
    expect(older.staleCells).toBeUndefined();
  });
});

describe("the acting doors' refusal — UNAVAILABLE {terminal, inventory_stale} (IL-D2 (a))", () => {
  it("is the terminal's, retryable, and names the stale cells", () => {
    const refusal = ErrorData.parse(fixture("error-data.terminal-inventory-stale.json"));
    expect(refusal).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    const details = TerminalInventoryStaleDetails.parse(refusal.details);
    expect(details.service).toBe(TERMINAL_INVENTORY_REFUSALS.SERVICE);
    expect(details.state).toBe(TERMINAL_INVENTORY_REFUSALS.STATE_INVENTORY_STALE);
    // the same entries `staleCells` carries
    for (const cell of details.cells) expect(ObservedStaleCell.parse(cell)).toEqual(cell);
  });

  it("names at least one cell: a refusal for no stale cell is no refusal", () => {
    const refusal = ErrorData.parse(fixture("error-data.terminal-inventory-stale.json"));
    const details = UnavailableDetails.parse(refusal.details);
    expect(TerminalInventoryStaleDetails.safeParse({ ...details, cells: [] }).success).toBe(false);
    const { cells: _cells, ...withoutCells } = details as Record<string, unknown>;
    expect(TerminalInventoryStaleDetails.safeParse(withoutCells).success).toBe(false);
  });

  it("stays apart from the unresponsive refusals, which answer instead where they hold", () => {
    const stale = ErrorData.parse(fixture("error-data.terminal-inventory-stale.json")).details;
    // WG-D4's floor held unresponsive, and a cell that did not answer fieldd
    for (const name of [
      "error-data.native-unresponsive.json",
      "error-data.terminal-unresponsive.json",
    ]) {
      const other = ErrorData.parse(fixture(name)).details;
      expect(TerminalInventoryStaleDetails.safeParse(other).success, name).toBe(false);
    }
    expect(NativeUnavailableDetails.safeParse(stale).success).toBe(false);
  });

  it("shares its service with the inventory's other honest state, spelled as fieldd spells it", () => {
    expect(TERMINAL_INVENTORY_REFUSALS).toEqual({
      SERVICE: "terminal",
      STATE_UNOBSERVED: "unobserved",
      STATE_INVENTORY_STALE: "inventory_stale",
    });
  });
});
