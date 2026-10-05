// THE BAR'S COUNTERS (DK-11's exit: "no per-frame render of the bar — the bar's placements ≤ the anchor's
// publishes"): every publish the bar heard from the desk's selection door, every placement it wrote (an imperative
// write of its place — never a React render), and every render of its view. Read by `window.__vfDesk.bar()`;
// renderer-wide, so a smoke reads its rows' deltas.

export interface BarStats {
  /** Each anchor the bar read: every publish it heard from the desk's selection door, and the one it reads as it
   * mounts (a selection already on the desk when the bar arrives). */
  publishes: number;
  /** Each time the bar wrote its place (imperatively, no render). */
  placements: number;
  /** Each time the bar's view rendered (a content change: the selection, its acts, its words). */
  renders: number;
}

export const barStats: BarStats = { publishes: 0, placements: 0, renders: 0 };

export function readBarStats(): BarStats {
  return { ...barStats };
}

/** Test seam. */
export function resetBarStatsForTest(): void {
  barStats.publishes = 0;
  barStats.placements = 0;
  barStats.renders = 0;
}
