import type { AgentVisualStatus } from "@vibefield/puppeteer-views";
import type { AgentSessionSummary } from "./facet-types";
import { folderName } from "./folder-name";

export type { AgentVisualStatus } from "@vibefield/puppeteer-views";
export { classifyTerminalStatus } from "@vibefield/puppeteer-views";

/**
 * What a session is doing, derived ONLY from the fold's row — fieldd's one
 * derived `status` (AR-D4: derived once, in fieldd, from puppeteer's reduced
 * monitor projection) — never from terminal text (the reference's ADR-003/-005,
 * and our own grain: EL2 keeps meaning on control surfaces and bytes on data
 * planes, so a monitor that read a screen to decide what an agent was doing
 * would be reading the wrong plane). How a status is then DRAWN is each view's
 * own business. The word is Core's since AR-5 (`idle` · `working` · `blocked`);
 * GT-3m's `waiting` was the same state under a local name, retired with the
 * views port.
 *
 * The fold's four words onto the views' three: `unknown` — no monitor evidence
 * yet — reads as working, as a session that has not spoken did in the
 * reference. A run puppeteer reports as not alive is dropped: an exited agent
 * is not a row.
 */
export function classifyAgentStatus(summary: AgentSessionSummary): AgentVisualStatus | undefined {
  // The drop comes FIRST, and the order is the whole rule: "this run is not
  // alive" is a fact about the run, while every branch below is a reading of
  // what it is doing. Asked second, the pending branch answered for a row whose
  // mirror said the run was gone, and the stage drew a dead agent as a live
  // idle one — the loudest kind of dishonesty this classifier can commit.
  if (summary.monitor?.alive === false) return undefined;
  // AR-4 — a PENDING row: a live PTY nothing observes, waiting to be resumed
  // at its next idle. Idle is the honest word for it — no evidence says
  // otherwise, and "working" would be a claim the fold did not make.
  if (summary.continuation?.pending !== undefined) return "idle";
  switch (summary.status) {
    case "blocked":
      return "blocked";
    case "idle":
      return "idle";
    default:
      return "working";
  }
}

/** The path the project is named from, before folding. Exported since GT-6:
 * the pane frame names its badge from the same chain, so a pane and its bubble
 * say the same word about the same agent. */
export function projectPath(summary: AgentSessionSummary): string {
  return (
    summary.monitor?.environment?.cwd ||
    summary.workspace?.sourcePath ||
    summary.workspace?.root ||
    ""
  );
}

/** The project a row belongs to: the agent's current directory when the
 * monitor observed one, else the workspace's, folded to its last component;
 * the provider's label when nothing names a directory. */
export function projectLabel(summary: AgentSessionSummary): string {
  return folderName(projectPath(summary), summary.label);
}

/**
 * The key a project's colour is dealt by (record §02, D3): the workspace's
 * root when there is one — a worktree or a copy is the same project as the
 * repository it was cut from, and `root` is where puppeteer names that — else
 * the observed directory, else nothing (no project: the row wears the ramp).
 */
export function projectKey(summary: AgentSessionSummary): string | undefined {
  const key =
    summary.workspace?.root || summary.workspace?.sourcePath || summary.monitor?.environment?.cwd;
  return key ? key : undefined;
}

/** The provider's own label, as the adapter authored it. Kept as a function so
 * a call site reads the same as it did with the closed union — and so a row
 * with an empty label (a tolerant-reader case) still says its id. */
export function providerLabel(summary: Pick<AgentSessionSummary, "kind" | "label">): string {
  return summary.label.trim() === "" ? summary.kind : summary.label;
}
