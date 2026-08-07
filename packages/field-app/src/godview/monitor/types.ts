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
 * something mounts the session. GT-3m ported it unfed (the mock mounts
 * nothing); GT-4 populates it for the first time, from the panes a remote
 * attach actually landed in. */
export interface PaneAttachment {
  primary: string;
  mirrors: readonly string[];
}

/**
 * The peer half of a monitored session (GT-D17): present exactly when the
 * session lives on another device on the mesh.
 *
 * Remote-ness is a FACET for the same reason agent-ness is: a view reads
 * `remote?.deviceName` rather than re-deriving which kind of thing it holds,
 * and every field here is one the peer itself reported.
 */
export interface MonitorRemoteFacet {
  deviceId: string;
  deviceName: string;
  /** The id ON THE PEER. It is not an id in this device's floor inventory, and
   * nothing local may be looked up with it. */
  remoteSessionId: string;
  /** Whether the peer is sharing this session for attachment at all. */
  attachable: boolean;
  /**
   * Mirror-write (GT-D7) as the peer ADVERTISES it — a property of the HOST,
   * not an answer about this viewer.
   *
   * Upstream computes one boolean per host, `allow_tailnet_write ||
   * capability.is_some()`, meaning "write is possible here"; WHO gets it is
   * decided at ATTACH by `access_for`, against the capability the viewer
   * presents. So `false` is universal — nobody types into this peer's sessions
   * — while `true` says only that someone can, which may not be us.
   *
   * Named `hostWritable` because it was named `readWrite` and read as a
   * per-viewer fact: every row on a capability-configured peer drew as writable
   * to a viewer who held no capability and would be read-only one click later
   * (the GT code review's finding 2b). Nothing pre-attach may claim a power it
   * cannot know; the post-attach announce carries the per-viewer truth, and the
   * pane wears the library's own "View only" face.
   */
  hostWritable: boolean;
  /**
   * The peer's own label for its working directory — a LABEL, deliberately not
   * a `cwd`. The GT-3 finding is the whole reason this field is named
   * differently: a pane's cwd is an OSC 7 URL carrying a HOST, and a peer's
   * path used as a local one is a real mistake waiting for a spawn. Nothing
   * resolves this string; it is shown.
   */
  cwdLabel: string | null;
  /** The LOCAL replica's session id, once this row has been attached to a pane.
   * Absent means this peer's session is not showing anywhere here. */
  localSessionId?: string;
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
  /**
   * The LOCAL floor session this row stands for — absent for a peer's session,
   * which has none here until it is attached (GT-D17).
   *
   * Optional rather than synthesized, and that is the honest half: a
   * `SessionSummary` has an executable, a handle, a pid and a persistence
   * class, and a peer reports none of them. Filling those in to keep the field
   * required would put invented facts inside the one shape every view trusts.
   * A remote row carries `remote` instead, whose every field the peer said.
   */
  session?: SessionSummary;
  /** When this session lives on another device. Mutually exclusive with `agent`
   * today: the peer reports terminal facts, not agent semantics (AR's story). */
  remote?: MonitorRemoteFacet;
  /** When this row was born, from whichever half of it knows. */
  createdAtMs: number;
  status: AgentVisualStatus;
  project: string;
  detail: string;
  /** A §2.6 organizational accent, already resolved from the live tokens. */
  color: string;
  /** Mounted in the pane the user is working in. */
  active: boolean;
  attachment?: PaneAttachment;
  /** A LOCAL path. Never set from a peer — see `MonitorRemoteFacet.cwdLabel`. */
  cwd?: string;
  /** Where the user asked for it, for views that place new arrivals spatially. */
  spawnHint?: { x: number; y: number };
  agent?: MonitorAgentFacet;
}

export interface MonitorActions {
  /** Mount this session in the active pane — REAL for a remote row since GT-4,
   * still an acknowledgement for a mock one until AR. The view calls the same
   * verb either way; which it was is the source's business, not the view's. */
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
