import { type ReactElement, useCallback, useEffect, useMemo, useRef } from "react";
import { emitGodviewMonitorMarker } from "../development-console";
import type { GodviewTheme } from "./GodviewTuningPanel";
import type { AgentVisualStatus } from "./monitor/agent-status";
import { monitorAgentCounts, nextMonitorAgentForStatus } from "./monitor/agents";
import { MONITOR_CHROME_ATTRIBUTE, MONITOR_STAGE_CLASS } from "./monitor/chrome";
import { useMonitorPalette } from "./monitor/monitor-palette";
import type { MonitorParameters } from "./monitor/parameters";
import { MONITOR_VIEWS } from "./monitor/registry";
import type { RemoteSessionDoor } from "./monitor/remote-door";
import type { AgentMonitorView } from "./monitor/types";
import {
  type MonitorPaneFacts,
  type MonitorSourceCounts,
  useMonitorAgents,
} from "./monitor/useMonitorAgents";
import { currentSwarmPhysicsMode } from "./views/swarm/swarm-physics-driver";

export const MOCK_LABEL = "preview — mock agents";
const ACKNOWLEDGEMENT_MS = 2_600;

/**
 * THE HONESTY SPLIT, in words (GT-D17).
 *
 * With only the mock field on the stage, the label claims the stage — which was
 * true at GT-3m and is the sentence the smoke has asserted since. The moment a
 * real remote session stands beside those invented agents, the same sentence
 * becomes a lie about the real one, so the claim NARROWS to a count: these N
 * are the invented ones. A real session must never sit under a label calling it
 * invented, and an invented agent must never look real.
 */
export function mockClaim(sources: MonitorSourceCounts): string {
  return sources.remote === 0 ? MOCK_LABEL : `preview — ${sources.mock} mock agents`;
}

/** The other half of the split: the real rows, counted with their peers. No
 * chip at all when there are none — DESIGN.md's sync law, that quiet is the
 * honesty when there are no facts, rather than a vacuous "no peers". */
export function remoteClaim(sources: MonitorSourceCounts): string | null {
  if (sources.remote === 0) return null;
  const sessions = `${sources.remote} remote session${sources.remote === 1 ? "" : "s"}`;
  return `${sessions} · ${sources.hosts} peer${sources.hosts === 1 ? "" : "s"}`;
}

export interface GodviewMonitorProps {
  view: AgentMonitorView;
  parameters: MonitorParameters;
  theme?: GodviewTheme;
  notice?: string | null;
  tuningOpen?: boolean;
  /** The deck's two verbs (GT-D17), or null while there is no deck. The stage
   * passes it to the source and never calls it — a view is still a pure
   * function of its props, and this component is not a view. */
  door?: RemoteSessionDoor | null;
  /** The deck's pane facts, read-only. */
  panes?: MonitorPaneFacts;
  onSelectView?: (viewId: string) => void;
  onToggleTuning?: () => void;
  onThemeChange?: (theme: GodviewTheme) => void;
}

export function GodviewMonitor({
  view,
  parameters,
  theme = "light",
  notice = null,
  tuningOpen = false,
  door = null,
  panes,
  onSelectView,
  onToggleTuning,
  onThemeChange,
}: GodviewMonitorProps): ReactElement {
  const palette = useMonitorPalette();
  const { agents, actions, sources, acknowledgement, clearAcknowledgement } = useMonitorAgents({
    palette,
    door,
    ...(panes ? { panes } : {}),
  });
  const stageRef = useRef<HTMLElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => monitorAgentCounts(agents), [agents]);

  // The source chrome is a top-left strip. Flow views clear its HEIGHT while
  // the physics view reads the element itself as an obstacle.
  useEffect(() => {
    const stage = stageRef.current;
    const chrome = chromeRef.current;
    if (!stage || !chrome || typeof ResizeObserver === "undefined") return;
    const publish = (): void =>
      stage.style.setProperty(
        "--vf-monitor-chrome-height",
        `${Math.round(chrome.getBoundingClientRect().height)}px`,
      );
    const observer = new ResizeObserver(publish);
    observer.observe(chrome);
    publish();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (acknowledgement === null) return;
    const timer = window.setTimeout(clearAcknowledgement, ACKNOWLEDGEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [acknowledgement, clearAcknowledgement]);

  useEffect(() => {
    // Read rather than passed down: the swarm chooses its physics home in its
    // own mount effect, and React runs a child's effects BEFORE its parent's —
    // so by the time this line is written the choice has already been made.
    emitGodviewMonitorMarker({
      viewId: view.id,
      agents: agents.length,
      agentBacked: agents.filter((agent) => agent.agent !== undefined).length,
      mockLabel: mockClaim(sources),
      mockAgents: sources.mock,
      remoteSessions: sources.remote,
      remoteHosts: sources.hosts,
      remoteState: sources.remoteState,
      ...(sources.remoteReason !== undefined ? { remoteReason: sources.remoteReason } : {}),
      swarmPhysics: currentSwarmPhysicsMode(),
    });
  }, [agents, view.id, sources]);

  const selectNextStatus = useCallback(
    (status: AgentVisualStatus): void => {
      const currentSessionId = agents.find((agent) => agent.active)?.session?.id;
      const next = nextMonitorAgentForStatus(agents, status, currentSessionId);
      if (next) actions.select(next);
    },
    [actions, agents],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      const status = ({ Digit1: "waiting", Digit2: "working", Digit3: "idle" } as const)[
        event.code as "Digit1" | "Digit2" | "Digit3"
      ];
      if (!status) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectNextStatus(status);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [selectNextStatus]);

  const MonitorView = view.Component;

  return (
    <>
      <header className="vf-godview-header">
        <div className="vf-godview-header-status" aria-live="polite">
          {notice ?? ""}
        </div>
        <div className="vf-godview-title">
          <span>GODVIEW</span>
          <small>AGENT TOPOLOGY</small>
        </div>
        <div className="vf-godview-header-actions">
          <select
            className="vf-godview-view-switch"
            aria-label="Monitor view"
            value={view.id}
            onChange={(event) => onSelectView?.(event.currentTarget.value)}
          >
            {MONITOR_VIEWS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
          <nav className="vf-godview-status-controls" aria-label="Agent status shortcuts">
            <button type="button" onClick={() => selectNextStatus("waiting")}>
              WAIT {counts.waiting}
              <kbd>⌘1</kbd>
            </button>
            <button type="button" onClick={() => selectNextStatus("working")}>
              WORK {counts.working}
              <kbd>⌘2</kbd>
            </button>
            <button type="button" onClick={() => selectNextStatus("idle")}>
              IDLE {counts.idle}
              <kbd>⌘3</kbd>
            </button>
          </nav>
          <button
            className={`vf-godview-tweak-toggle${tuningOpen ? " is-open" : ""}`}
            type="button"
            aria-controls="vf-godview-tweak-panel"
            aria-expanded={tuningOpen}
            onClick={onToggleTuning}
          >
            TUNE
          </button>
          <button
            className="vf-godview-theme-switch"
            type="button"
            role="switch"
            aria-checked={theme === "dark"}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            onClick={() => onThemeChange?.(theme === "light" ? "dark" : "light")}
          >
            <span aria-hidden="true">☼</span>
            <span className="vf-godview-theme-switch-track" aria-hidden="true">
              <i />
            </span>
            <span aria-hidden="true">◐</span>
          </button>
        </div>
      </header>

      <section
        ref={stageRef}
        className={MONITOR_STAGE_CLASS}
        aria-label={
          sources.remote === 0
            ? "Agent monitor — mock preview"
            : "Agent monitor — mock preview and remote sessions"
        }
      >
        <MonitorView agents={agents} parameters={parameters} actions={actions} palette={palette} />
        <div ref={chromeRef} className="vf-monitor-chrome" {...{ [MONITOR_CHROME_ATTRIBUTE]: "" }}>
          <span className="vf-monitor-mock-chip">{mockClaim(sources)}</span>
          {remoteClaim(sources) !== null ? (
            <span className="vf-monitor-remote-chip">{remoteClaim(sources)}</span>
          ) : null}
          <span className="vf-monitor-ack" aria-live="polite">
            {acknowledgement?.message ?? ""}
          </span>
        </div>
      </section>
    </>
  );
}
