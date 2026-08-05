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
  return byStatus !== 0 ? byStatus : left.createdAtMs - right.createdAtMs;
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
        <span className="vf-monitor-list-count">{ordered.length} SESSIONS</span>
        <button
          type="button"
          className="vf-monitor-list-new"
          onClick={() => void actions.createAt()}
        >
          ＋ TERMINAL
        </button>
      </div>
      {ordered.length === 0 ? (
        <div className="vf-monitor-empty">
          <span>NO ACTIVE AGENTS</span>
          <small>Launch Claude, Codex, or Grok from a terminal pane.</small>
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
            const remote = agent.remote;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className={`vf-monitor-list-row is-${agent.status}${agent.active ? " is-active" : ""}${
                    agent.attachment ? " is-linked" : ""
                  }${remote ? " is-remote" : ""}`}
                  style={rowStyle}
                  aria-current={agent.active ? "true" : undefined}
                  // The status belongs to the ROW's name, not to the dot: a
                  // labelled dot reads out as a bare "waiting" with nothing
                  // attached, while the row is the thing being described.
                  //
                  // A remote row names its peer FIRST (GT-D17): the machine is
                  // the fact that changes what the row means, and a screen
                  // reader must not have to reach the end of the line to learn
                  // that this session is not on this computer.
                  aria-label={`${remote ? `on ${remote.deviceName}, ` : ""}${agent.project}, ${
                    facet ? (facet.model ?? facet.provider) : remote ? "remote session" : "terminal"
                  }, ${agent.status}${remote && !remote.readWrite ? ", view only" : ""}: ${agent.detail}`}
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
                    ) : remote ? (
                      // THE HOST CHIP (GT-D17). It stands where the model name
                      // stands, because it answers the same question — what is
                      // this session — and it is the one word that must not be
                      // read as "another terminal of mine".
                      <span className="vf-monitor-list-host">
                        {remote.deviceName}
                        {remote.readWrite ? null : (
                          <em title="the peer refuses mirror-write">view only</em>
                        )}
                      </span>
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
