import { listMonitorView } from "../views/list/index";
import { rainMonitorView } from "../views/rain/index";
import { swarmMonitorView } from "../views/swarm/index";
import type { AgentMonitorView } from "./types";

/**
 * Every way of looking at the running agents. A new view is one directory under
 * `views/` and one entry here.
 */
export const MONITOR_VIEWS: readonly AgentMonitorView[] = [
  swarmMonitorView,
  listMonitorView,
  rainMonitorView,
];

export const DEFAULT_MONITOR_VIEW_ID = swarmMonitorView.id;

/** Falls back to the default, so a stored id from a removed view cannot strand
 * the stage. The tolerant-reader rule applied to a persisted preference: an
 * unreadable choice is a choice we no longer support, not a reason to draw
 * nothing. */
export function monitorViewFor(id: string | null | undefined): AgentMonitorView {
  return MONITOR_VIEWS.find((view) => view.id === id) ?? (MONITOR_VIEWS[0] as AgentMonitorView);
}
