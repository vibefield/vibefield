// IL-D4, IL-D5 (a) (`draft/thinking-inventory-latency.md`) — the floor every
// inventory-age row stands on: the contracts' EL9 fixtures (two class cells,
// one row in each, cell 2 named stale by a judging floor) and the routes that
// name those two cells, keyed and serving their doors. Test-only; shared by
// terminal-inventory-age.test.ts and agent-inventory-age.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TerminalRouteSnapshot } from "@vibefield/contracts";

const FIXTURES = join(import.meta.dirname, "../../contracts/fixtures");

/** A contracts fixture, parsed fresh at every read. */
export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
}

export const BOOT = "b1c2d3e4-5f60-7a8b-9c0d-e1f203a4b5c6";
export const CELL_1 = { cellInstanceId: 1, cellBootId: "01JCELLBOOT0000000000000001" };
export const CELL_2 = { cellInstanceId: 2, cellBootId: "01JCELLBOOT0000000000000002" };
/** the fixtures' rows: one in each cell — a shell on cell 1 (interactive), an
 * agent on cell 2 (agent) */
export const ZSH = "5e1a7c3d-9b2f-4e6a-8c0d-1f2e3a4b5c6d";
export const CLAUDE = "0d9f1c2b-3a4e-5d6c-7b8a-9e0f1a2b3c4d";
/** observed-state.stale-cell.json's `since` for cell 2 */
export const CELL_2_SINCE = 1792433071000;

/** observed-state.stale-cell.json's two rows from a judging floor with every
 * cell fresh: the floor's bound, and no `staleCells`. */
export function freshFloor(): Record<string, unknown> {
  const state = fixture("observed-state.stale-cell.json");
  return Object.fromEntries(Object.entries(state).filter(([key]) => key !== "staleCells"));
}

/** The same two rows from a judging floor that names `cells` stale, each
 * since `since`. */
export function floorStale(
  cells: ReadonlyArray<typeof CELL_1>,
  since: number = CELL_2_SINCE,
): Record<string, unknown> {
  return { ...freshFloor(), staleCells: cells.map((cell) => ({ ...cell, since })) };
}

/** The fixtures' two cells as the floor's routes name them: each keyed and
 * serving its doors, so a door that mints for a listed session mints. A mint
 * dials nothing, so the sockets are paper: a dial of one fails at once. */
export function fixtureRoutes(): TerminalRouteSnapshot {
  const row = (
    cell: typeof CELL_1,
    workloadClass: "interactive" | "agent",
    grantKey: string,
    port: number,
  ) => ({
    ...cell,
    pid: 4000 + cell.cellInstanceId,
    endpoints: {
      controlSocket: `/mock/native/run/termctl.${cell.cellInstanceId}.sock`,
      frameSocket: `/mock/native/run/termframe.${cell.cellInstanceId}.sock`,
      authToken: `cell-${cell.cellInstanceId}-token`,
    },
    tokenGeneration: 1,
    workloadClass,
    role: "class" as const,
    grantKey,
    grantKeyGeneration: 1,
    doors: {
      controlUrl: `ws://127.0.0.1:${port}/control`,
      framesUrl: `ws://127.0.0.1:${port}/frames`,
    },
  });
  return {
    revision: 3,
    cells: [
      row(CELL_1, "interactive", "5e".repeat(32), 49171),
      row(CELL_2, "agent", "a1".repeat(32), 49172),
    ],
  };
}
