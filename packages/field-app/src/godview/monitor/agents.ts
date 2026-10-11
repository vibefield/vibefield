// MV-3b — what is left of the seam's ASSEMBLY. Until MV-3 this module built
// every monitor row from the fold's rows, the deck's panes, the floor's roster
// and the mesh board (`assembleMonitorAgents`): the run's id, its project and
// colour, its status and detail line, recency, the pane join, the usage
// ledger's history, the visual-id carry-forward. The backend beside the runtime
// computes all of that once now (`@vibecook/puppeteer-monitor`, hosted by
// fieldd — MV-D22), and the window's replica applies it. The views read the
// model directly. The retired MV-3 differential established parity before the
// old assembly and its oracle went away in MV-8. (The counters' counts,
// `monitorAgentCounts`, stood here until the instrument bar that drew them
// left VibeField — GV-D1; the counters themselves were removed at FC-D18.)

/**
 * A LIVE PTY ON THE FLOOR THAT NO PANE IS SHOWING (GT-6b), as the deck reads it
 * off `terminal.roster` (TP-D4): id, class and a title, with no placement and,
 * deliberately, no cwd and no activity. The deck publishes these on its pane
 * facts; the window reads them for the ORDER the floor's terminals are drawn in
 * (the backend lists the floor's PTYs itself), and the perf lab's corpora
 * carry them as the deck's facts.
 */
export interface MonitorFloorRecord {
  sessionId: string;
  /** The floor's own word for what the PTY is for (`interactive` · `agent`). */
  workloadClass: "agent" | "interactive";
  /** The floor's title for the session, when it has one. */
  title?: string;
  /** SB-3 — the Agent Profile its shell was born under, in fieldd's words. */
  profileSet?: string;
  /** SB-3 — where a create in flight asked for it, when this row is its first
   * appearance (a new shell can reach the stage through the roster first). */
  spawnHint?: { x: number; y: number };
}
