import { type CSSProperties, type ReactElement, useMemo } from "react";
import { AgentIcon } from "../../monitor/AgentIcon";
import type { AgentVisualStatus } from "../../monitor/agent-status";
import type { AgentMonitorProps, MonitorAgent } from "../../monitor/types";
import { normalizeListParameters } from "./list-parameters";

/**
 * The deliberately boring view, and the reason it exists: a non-spatial reading
 * of the same `MonitorAgent[]` the swarm renders. It ignores `spawnHint`, takes
 * no position when it opens a terminal, and orders by attention rather than by
 * launch time — proof that presentation choices belong to the view.
 */
const STATUS_ORDER: Record<AgentVisualStatus, number> = { waiting: 0, working: 1, idle: 2 };

function compareAgents(left: MonitorAgent, right: MonitorAgent): number {
  // Agents outrank unclaimed terminals, then the ones asking for something.
  if (Boolean(left.agent) !== Boolean(right.agent)) return left.agent ? -1 : 1;
  const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  return byStatus !== 0 ? byStatus : left.session.createdAtMs - right.session.createdAtMs;
}

export function AgentList({
  agents,
  parameters,
  actions,
  palette,
}: AgentMonitorProps): ReactElement {
  const { rowHeight, projectWidth } = normalizeListParameters(parameters);
  const ordered = useMemo(() => [...agents].sort(compareAgents), [agents]);
  const style = {
    "--vf-monitor-row-height": `${rowHeight}px`,
    "--vf-monitor-project-width": `${projectWidth}px`,
    "--vf-monitor-working": palette.status.working,
    "--vf-monitor-waiting": palette.status.waiting,
    "--vf-monitor-idle": palette.status.idle,
  } as CSSProperties;

  return (
    <section className="vf-monitor-list" style={style} aria-label="Running agent list">
      <div className="vf-monitor-list-toolbar">
        <span className="vf-monitor-list-count">
          {ordered.length} session{ordered.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="vf-monitor-list-new"
          onClick={() => void actions.createAt()}
        >
          New terminal
        </button>
      </div>
      {ordered.length === 0 ? (
        <div className="vf-monitor-empty">
          <span>No agents</span>
          <small>The mock field is empty — nothing is running here.</small>
        </div>
      ) : (
        <ul className="vf-monitor-list-rows">
          {ordered.map((agent) => {
            const facet = agent.agent;
            const contextPercent = facet?.contextWindow
              ? Math.floor(facet.contextWindow.usedPercent)
              : undefined;
            const rowStyle = {
              "--agent-color": agent.attachment?.primary ?? agent.color,
            } as CSSProperties;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className={`vf-monitor-list-row is-${agent.status}${agent.active ? " is-active" : ""}${
                    agent.attachment ? " is-linked" : ""
                  }`}
                  style={rowStyle}
                  aria-current={agent.active ? "true" : undefined}
                  // The status belongs to the ROW's name, not to the dot: a
                  // labelled dot reads out as a bare "waiting" with nothing
                  // attached, while the row is the thing being described.
                  aria-label={`${agent.project}, ${facet ? (facet.model ?? facet.provider) : "terminal"}, ${agent.status}: ${agent.detail}`}
                  onClick={() => actions.select(agent)}
                >
                  <span className="vf-monitor-list-status" aria-hidden="true" />
                  <span className="vf-monitor-list-project">
                    <strong>{agent.project}</strong>
                    {facet?.branch ? <small>{facet.branch}</small> : null}
                  </span>
                  <span className="vf-monitor-list-agent">
                    {facet ? (
                      <>
                        <i aria-hidden="true">
                          <AgentIcon agent={facet.kind} />
                        </i>
                        {facet.model ?? facet.provider}
                      </>
                    ) : (
                      <span className="vf-monitor-list-terminal">terminal</span>
                    )}
                  </span>
                  <span className="vf-monitor-list-detail">{agent.detail}</span>
                  <span className="vf-monitor-list-context">
                    {contextPercent === undefined ? "—" : `${contextPercent}%`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
