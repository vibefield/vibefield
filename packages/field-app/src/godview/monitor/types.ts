import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { ComponentType } from "react";
import type { AgentVisualStatus } from "./agent-status";
import type { AgentSessionSummary, AgentTier, ContextWindowRuntimeState } from "./facet-types";
import type { MonitorPalette } from "./monitor-palette";
import type { MonitorParameterGroup, MonitorParameters } from "./parameters";

/** The agent half of a monitored session; absent while a terminal holds no
 * agent. Since AR-3 it is a projection of the fold's row — the few facts a
 * view names, plus the row itself for a view that wants the rest. */
export interface MonitorAgentFacet {
  /** puppeteer's provider id, open (AR-L1) */
  kind: string;
  /** the adapter's own label for the provider */
  provider: string;
  tier: AgentTier;
  runtimeRunId: string;
  profileId?: string;
  model?: string;
  branch?: string;
  contextWindow?: ContextWindowRuntimeState;
  /** The fold's row, verbatim, for a view that wants blockers, usage or the
   * monitor projection. */
  summary: AgentSessionSummary;
}

/** Colors of the panes showing a session — the deck↔monitor link. Absent until
 * something mounts the session. GT-3m ported it unfed (the mock mounted
 * nothing); GT-4 populated it for the first time, from the panes a remote
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
  /**
   * The row's identity to a view — what a bubble, a physics body and the
   * preview highlight are keyed by, so view-local placement survives a change
   * in what the row is DOING.
   *
   * A managed row's is its run (`runtimeRunId`, see `managedRowId`), which
   * outlives the PTY under it and the fieldd epoch it was born in; a terminal's
   * is its floor session id; a peer's is the device-qualified remote id.
   *
   * It is not a join key. The pane link is `session?.id` — or, for a row whose
   * PTY the deck holds no summary of, the fold's own `terminal.runtimeSessionId`.
   */
  id: string;
  /**
   * The LOCAL floor session this row stands for — absent for a peer's session,
   * which has none here until it is attached (GT-D17), and for a managed row
   * whose PTY the deck does not hold a summary of.
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
   * and for a local one since AR-3. The view calls the same verb either way;
   * which it was is the source's business, not the view's. */
  select(agent: MonitorAgent): void;
  /** Spawn an agent (the chrome's chosen provider) into the active pane;
   * spatial views pass where the gesture happened. */
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
 * reference's ADR-003), and what made GT-D13's swap a one-module change: at
 * GT-3m every view here was fed by a mock field and could not tell; since AR-3
 * it is fed by fieldd's fold, and still cannot.
 */
export interface AgentMonitorView {
  readonly id: string;
  readonly label: string;
  readonly parameterGroups: readonly MonitorParameterGroup[];
  readonly Component: ComponentType<AgentMonitorProps>;
}
