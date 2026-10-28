import type { MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";

// A FAILED BODY STAYS UNTIL YOU HAVE SEEN ITS PANE (Q06, Ruled B, James,
// 2026-10-27). A crashed run's row is dead (`alive: false`) and carries the
// runtime's failure as its wait (puppeteer keeps it until acknowledged, M3).
// The window used to hide every dead row and every row whose pane exited, so
// the body vanished at the crash and only its pane's red face said it. Now
// such a row stays drawn, blocked with the failure mark.
//
// The leave is not the window's: what has been seen is what a screen REPORTS
// shown (`agent.reportShown`: the focused pane's row while the terminals are
// up, and the row the person pointed at, Q04, unless that row has failed:
// a failure is seen only in its pane, `windowShown`), and fieldd acknowledges a
// failure a screen shows (`agent-monitor.ts`, `acknowledgeSeen`). puppeteer
// then removes the run and its row leaves the model, for every window at once,
// and a reload or a reopened Godview does not bring it back. The pane frame's
// resume verb is untouched by that: it reads the fold's own row
// (`pane-frame-facts.ts`), which an acknowledgement does not remove.

/** Whether a row is a crashed agent's: dead, its wait the runtime's failure.
 * The wait's kind is the runtime's own word for the blocker. */
export function isFailedRow(row: MonitorAgentRow | undefined): boolean {
  return row !== undefined && row.kind === "agent" && !row.alive && row.wait?.kind === "failure";
}

/** Whether the window draws a dead row: an agent's failure, on a row this
 * desktop has a pane join for — its pane, the one thing that can be seen. A
 * failure with no pane here has nothing to look at, and stays hidden as every
 * dead row was. */
export function keepsFailure(
  row: MonitorAgentRow,
  sessionByRow: ReadonlyMap<string, string>,
): boolean {
  return isFailedRow(row) && sessionByRow.has(row.id);
}
