import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { ComponentType } from "react";
import type { AgentVisualStatus } from "./agent-status";
import type {
  AgentKind,
  AgentSessionInfo,
  AgentStateMessage,
  ContextWindowRuntimeState,
} from "./facet-types";
import type { MonitorPalette } from "./monitor-palette";
import type { MonitorParameterGroup, MonitorParameters } from "./parameters";

/** The agent half of a monitored session; absent while a terminal holds no agent. */
export interface MonitorAgentFacet {
  kind: AgentKind;
  provider: string;
  model?: string;
  branch?: string;
  contextWindow?: ContextWindowRuntimeState;
  /** The underlying projections, for a view that wants tools, permissions, or diagnostics. */
  info: AgentSessionInfo;
  state?: AgentStateMessage;
}

/** Colors of the panes showing a session — the deck↔monitor link. Absent until
 * something mounts the session, which at GT-3m is never: the mock mounts
 * nothing, so this rides the port unset and lights up with AR. */
export interface PaneAttachment {
  primary: string;
  mirrors: readonly string[];
}

/**
 * One monitored session in the only shape a view ever sees.
 *
 * Agent-ness is a facet rather than a separate variant, so a view reads
 * `agent?.model` instead of re-deriving which kind of thing it is holding.
 */
export interface MonitorAgent {
  /** Stable when a terminal is promoted to an agent, so view-local placement survives it. */
  id: string;
  session: SessionSummary;
  status: AgentVisualStatus;
  project: string;
  detail: string;
  /** A §2.6 organizational accent, already resolved from the live tokens. */
  color: string;
  /** Mounted in the pane the user is working in. */
  active: boolean;
  attachment?: PaneAttachment;
  cwd?: string;
  /** Where the user asked for it, for views that place new arrivals spatially. */
  spawnHint?: { x: number; y: number };
  agent?: MonitorAgentFacet;
}

export interface MonitorActions {
  /** Mount this session in the active pane. */
  select(agent: MonitorAgent): void;
  /** Open a terminal; spatial views pass where the gesture happened. */
  createAt(position?: { x: number; y: number }): void | Promise<void>;
}

export interface AgentMonitorProps {
  agents: readonly MonitorAgent[];
  parameters: MonitorParameters;
  actions: MonitorActions;
  /** The live tokens (`monitor-palette.ts`). Passed rather than read because two
   * of the three views paint into a canvas, which cannot inherit a custom
   * property — and a view that resolved its own would be a second reader of the
   * design system with its own idea of when to re-read it. */
  palette: MonitorPalette;
}

/**
 * A way of looking at the running agents. Adding one is a file plus a line in
 * the registry.
 *
 * A view is a PURE FUNCTION of these props. It never reaches the runtime, the
 * workspace, fieldd, or a terminal — which is what keeps it structurally unable
 * to break the invariant that semantics never come from terminal text (the
 * reference's ADR-003), and what makes GT-D13's swap a one-module change: at
 * GT-3m every view here is fed by `MockAgentField` and cannot tell.
 */
export interface AgentMonitorView {
  readonly id: string;
  readonly label: string;
  readonly parameterGroups: readonly MonitorParameterGroup[];
  readonly Component: ComponentType<AgentMonitorProps>;
}
