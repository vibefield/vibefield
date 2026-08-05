import { type ReactElement, useCallback, useEffect, useMemo, useRef } from "react";
import { emitGodviewMonitorMarker } from "../development-console";
import type { GodviewTheme } from "./GodviewTuningPanel";
import type { AgentVisualStatus } from "./monitor/agent-status";
import { monitorAgentCounts, nextMonitorAgentForStatus } from "./monitor/agents";
import { MONITOR_CHROME_ATTRIBUTE, MONITOR_STAGE_CLASS } from "./monitor/chrome";
import { useMonitorPalette } from "./monitor/monitor-palette";
import type { MonitorParameters } from "./monitor/parameters";
import { MONITOR_VIEWS } from "./monitor/registry";
import type { AgentMonitorView } from "./monitor/types";
import { useMonitorAgents } from "./monitor/useMonitorAgents";
import { currentSwarmPhysicsMode } from "./views/swarm/swarm-physics-driver";

export const MOCK_LABEL = "preview — mock agents";
const ACKNOWLEDGEMENT_MS = 2_600;

export interface GodviewMonitorProps {
  view: AgentMonitorView;
  parameters: MonitorParameters;
  theme?: GodviewTheme;
  notice?: string | null;
  tuningOpen?: boolean;
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
  onSelectView,
  onToggleTuning,
  onThemeChange,
}: GodviewMonitorProps): ReactElement {
  const palette = useMonitorPalette();
  const { agents, actions, acknowledgement, clearAcknowledgement } = useMonitorAgents({ palette });
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
      mockLabel: MOCK_LABEL,
      swarmPhysics: currentSwarmPhysicsMode(),
    });
  }, [agents, view.id]);

  const selectNextStatus = useCallback(
    (status: AgentVisualStatus): void => {
      const currentSessionId = agents.find((agent) => agent.active)?.session.id;
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
        aria-label="Agent monitor — mock preview"
      >
        <MonitorView agents={agents} parameters={parameters} actions={actions} palette={palette} />
        <div ref={chromeRef} className="vf-monitor-chrome" {...{ [MONITOR_CHROME_ATTRIBUTE]: "" }}>
          <span className="vf-monitor-mock-chip">{MOCK_LABEL}</span>
          <span className="vf-monitor-ack" aria-live="polite">
            {acknowledgement?.message ?? ""}
          </span>
        </div>
      </section>
    </>
  );
}
