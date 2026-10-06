// THE PEGBOARD'S COUNTERS (DK-13 — the bar's rule, DK-11: no render per frame): every anchor publish the pegboard
// heard from the tray door, every placement of its filters and its ring it wrote (imperatively — never a React render),
// every render of its view, and every object it laid by ⏎. Read by `window.__vfDesk.pegboard()`; renderer-wide, so a
// smoke reads its rows' deltas: placements ≤ publishes + the keyboard's own moves, renders a handful.

export interface BoardStats {
  publishes: number;
  placements: number;
  renders: number;
  inserts: number;
}

export const boardStats: BoardStats = { publishes: 0, placements: 0, renders: 0, inserts: 0 };

export function readBoardStats(): BoardStats {
  return { ...boardStats };
}

/** Test seam. */
export function resetBoardStatsForTest(): void {
  boardStats.publishes = 0;
  boardStats.placements = 0;
  boardStats.renders = 0;
  boardStats.inserts = 0;
}
