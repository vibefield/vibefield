import type {
  CSSProperties,
  MouseEventHandler,
  PointerEventHandler,
  ReactElement,
  Ref,
} from "react";
import { AgentIcon } from "../../monitor/AgentIcon";
import type { AgentVisualStatus } from "../../monitor/agent-status";
import { remoteWriteLabel, remoteWriteTitle } from "../../monitor/remote-write";
import type { MonitorAgent } from "../../monitor/types";

interface IgnitionParticleStyle extends CSSProperties {
  "--ignition-angle": string;
  "--ignition-delay": string;
  "--ignition-distance": string;
  "--ignition-duration": string;
  "--ignition-size": string;
}

function particleNoise(index: number, channel: number): number {
  const value = Math.sin((index + 1) * 12.9898 + (channel + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const IGNITION_PARTICLES: readonly IgnitionParticleStyle[] = Array.from(
  { length: 24 },
  (_, index) => ({
    "--ignition-angle": `${(particleNoise(index, 0) * 360).toFixed(2)}deg`,
    "--ignition-delay": `${(-particleNoise(index, 1) * 2.2).toFixed(2)}s`,
    "--ignition-distance": `${(24 + particleNoise(index, 2) * 34).toFixed(2)}px`,
    "--ignition-duration": `${(1.05 + particleNoise(index, 3) * 1.35).toFixed(2)}s`,
    "--ignition-size": `${(2 + particleNoise(index, 4) * 1.5).toFixed(2)}px`,
  }),
);

const SPAWN_DURATION_MS = 720;

/** Replay the circle's production arrival transition. The caller owns the
 * reduced-motion decision because the swarm already samples it for physics and
 * the catalog has an explicit motion switch. */
export function animateAgentBubbleSpawn(element: HTMLButtonElement, reducedMotion = false): void {
  if (typeof element.animate !== "function" || reducedMotion) return;

  const animation = element.animate(
    [
      { transform: "scale(0)", opacity: 0, offset: 0, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      {
        transform: "scale(1.2)",
        opacity: 1,
        offset: 0.52,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      { transform: "scale(0.96)", opacity: 1, offset: 0.72, easing: "ease-out" },
      { transform: "scale(1.035)", opacity: 1, offset: 0.88, easing: "ease-in-out" },
      { transform: "scale(1)", opacity: 1, offset: 1 },
    ],
    { duration: SPAWN_DURATION_MS, fill: "both" },
  );

  void animation.finished.then(
    () => animation.cancel(),
    () => undefined,
  );
}

export type AgentBubbleSource = "agent" | "remote" | "terminal";
export type AgentBubbleVisualState = AgentVisualStatus | "ignited";

/**
 * The complete, controller-free reading of one swarm circle.
 *
 * Runtime status and drawn state are deliberately both present. A ready agent
 * has runtime status `idle`, but the swarm draws it with the `working` body so
 * the smallest circle remains reserved for an unclaimed terminal. A working
 * agent uses that same body with the ignition layer added. Keeping this mapping
 * named prevents physics, DOM classes, accessibility copy, and the catalog from
 * quietly developing four different interpretations of the same row.
 */
export interface AgentBubblePresentation {
  source: AgentBubbleSource;
  visualState: AgentBubbleVisualState;
  appearance: AgentVisualStatus;
  contextLabel: string;
  contextPercent?: number;
  accent: string;
  className: string;
  positionerClassName: string;
  ariaLabel: string;
  title: string;
}

export function agentBubblePresentation(agent: MonitorAgent): AgentBubblePresentation {
  const source: AgentBubbleSource = agent.agent ? "agent" : agent.remote ? "remote" : "terminal";
  const visualState: AgentBubbleVisualState = agent.agent
    ? agent.status === "idle"
      ? "working"
      : agent.status === "working"
        ? "ignited"
        : "waiting"
    : agent.status;
  const appearance: AgentVisualStatus = visualState === "ignited" ? "working" : visualState;
  const contextPercent = agent.agent?.contextWindow
    ? Math.floor(agent.agent.contextWindow.usedPercent)
    : undefined;
  const contextLabel =
    contextPercent === undefined ? "CTX:--%" : `CTX:${contextPercent.toString().padStart(2, "0")}%`;
  const linkedColor = agent.attachment?.primary;
  const className = [
    "vf-monitor-bubble",
    `is-${appearance}`,
    visualState === "ignited" ? "is-ignited" : "",
    source === "terminal" ? "is-unassigned" : "",
    linkedColor ? "is-linked" : "",
    agent.active ? "is-active" : "",
    source === "remote" ? "is-remote" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const ariaLabel = agent.remote
    ? `on ${agent.remote.deviceName}, ${agent.project}, remote session, ${agent.status}, ${remoteWriteLabel(
        agent.remote,
      )}`
    : agent.agent
      ? `${agent.project}, ${agent.agent.model ?? agent.agent.provider}, ${agent.status}: ${
          agent.detail
        }, ${contextLabel}`
      : `${agent.project}, unassigned terminal, ${agent.status}`;

  return {
    source,
    visualState,
    appearance,
    contextLabel,
    ...(contextPercent === undefined ? {} : { contextPercent }),
    accent: linkedColor ?? agent.color,
    className,
    positionerClassName: `vf-monitor-bubble-positioner is-${appearance}`,
    ariaLabel,
    title: agent.agent
      ? `${agent.project} · ${agent.agent.model ?? agent.agent.provider} · ${agent.detail}`
      : agent.detail,
  };
}

export interface AgentBubbleViewProps {
  agent: MonitorAgent;
  positionerRef?: Ref<HTMLDivElement>;
  buttonRef?: Ref<HTMLButtonElement>;
  /** Physics owns this geometry in the swarm; deterministic catalog fixtures
   * use the same seam to place the production circle without starting an engine. */
  positionerStyle?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onPointerMove?: PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: PointerEventHandler<HTMLButtonElement>;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

/** Exact DOM for one Godview swarm circle. Physics and pointer orchestration
 * stay in `AgentSwarm`; this view owns state projection, anatomy, and a11y. */
export function AgentBubbleView({
  agent,
  positionerRef,
  buttonRef,
  positionerStyle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
}: AgentBubbleViewProps): ReactElement {
  const presentation = agentBubblePresentation(agent);
  const facet = agent.agent;
  const contextWindow = facet?.contextWindow;
  const ignited = presentation.visualState === "ignited";

  return (
    <div
      ref={positionerRef}
      className={presentation.positionerClassName}
      style={positionerStyle}
      data-agent-bubble-source={presentation.source}
      data-agent-bubble-status={agent.status}
      data-agent-bubble-visual={presentation.visualState}
    >
      <button
        ref={buttonRef}
        type="button"
        className={presentation.className}
        style={{ "--agent-color": presentation.accent } as CSSProperties}
        aria-current={agent.active ? "true" : undefined}
        aria-label={presentation.ariaLabel}
        title={presentation.title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
      >
        {contextWindow ? (
          <span
            className="vf-monitor-bubble-context-fill"
            style={{ height: `${contextWindow.usedPercent}%` }}
            aria-hidden="true"
          />
        ) : null}
        {ignited ? (
          <span className="vf-monitor-bubble-ignition" aria-hidden="true">
            <i className="vf-monitor-bubble-core-glow" />
            <span className="vf-monitor-bubble-particles">
              {IGNITION_PARTICLES.map((particleStyle, index) => (
                <i
                  className="vf-monitor-bubble-particle"
                  // The particle set is a fixed, index-addressed constant. It
                  // never reorders, so the index is the identity.
                  key={index}
                  style={particleStyle}
                />
              ))}
            </span>
          </span>
        ) : null}
        {agent.attachment?.mirrors.length ? (
          <span className="vf-monitor-bubble-mirrors" aria-hidden="true">
            {agent.attachment.mirrors.map((color, index) => (
              <i
                key={`${color}-${index}`}
                style={{ inset: `${4 + index * 3}px`, borderColor: color }}
              />
            ))}
          </span>
        ) : null}
        {facet ? (
          <span className="vf-monitor-bubble-glyph" aria-hidden="true">
            <AgentIcon agent={facet.kind} />
          </span>
        ) : null}
        <span className="vf-monitor-bubble-copy">
          {facet?.branch ? <span className="vf-monitor-bubble-branch">{facet.branch}</span> : null}
          {agent.remote ? (
            <span className="vf-monitor-bubble-host">{agent.remote.deviceName}</span>
          ) : null}
          <strong>{agent.project}</strong>
          {facet ? (
            <span className="vf-monitor-bubble-provider">{facet.model ?? facet.provider}</span>
          ) : null}
          {agent.remote ? (
            <span className="vf-monitor-bubble-provider" title={remoteWriteTitle(agent.remote)}>
              {remoteWriteLabel(agent.remote)}
            </span>
          ) : null}
        </span>
        {facet ? (
          <span className="vf-monitor-bubble-context">{presentation.contextLabel}</span>
        ) : null}
      </button>
    </div>
  );
}
