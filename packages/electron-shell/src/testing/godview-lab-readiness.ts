// Whole-window measurements include the real terminal deck. A monitor can
// mount while its terminal cell is unavailable, so monitor readiness alone
// cannot establish that two arms do the same work (build-mv M137).

/** The bounded subset of GODVIEW_DECK used by the lab. */
export interface LabDeckState {
  active: boolean;
  panes: number;
  sessions: number;
  poolPhase: string;
  rosterState: string;
  rendererBackend: string;
  error?: string;
}

export function labDeckReady(state: LabDeckState | null): boolean {
  return (
    state !== null &&
    state.active === true &&
    Number.isInteger(state.panes) &&
    state.panes > 0 &&
    Number.isInteger(state.sessions) &&
    state.sessions > 0 &&
    state.poolPhase === "open" &&
    state.rosterState === "observed" &&
    state.rendererBackend === "webgpu" &&
    state.error === undefined
  );
}

/** A fresh perf/capture process owns one workspace with its initial shell.
 * Record only comparable facts, without session ids or transport details. */
export function singlePaneLabDeck(state: LabDeckState | null): LabDeckState {
  if (!labDeckReady(state) || state?.panes !== 1 || state.sessions !== 1) {
    throw new Error(`The lab requires one healthy terminal pane: ${JSON.stringify(state)}`);
  }
  return {
    active: state.active,
    panes: state.panes,
    sessions: state.sessions,
    poolPhase: state.poolPhase,
    rosterState: state.rosterState,
    rendererBackend: state.rendererBackend,
  };
}

/** Comparable row counts from GODVIEW_MONITOR; no identities or agent data. */
export interface LabMonitorState {
  viewId: string;
  agents: number;
  localAgents: number;
  terminals: number;
  remoteSessions: number;
  remoteHosts: number;
  shownAgents: number;
}

/** Read after the measured interval (or immediately before a capture).
 * A healthy physical deck alone cannot prove equal replay inputs: the old
 * fold monitor used to count its shell while the offline model did not. */
export function labMonitorMembership(
  state: Partial<LabMonitorState> | null,
  view: string,
): LabMonitorState {
  if (
    typeof view !== "string" ||
    view.length === 0 ||
    state === null ||
    state.viewId !== view ||
    ![
      state.agents,
      state.localAgents,
      state.terminals,
      state.remoteSessions,
      state.remoteHosts,
      state.shownAgents,
    ].every((value) => Number.isSafeInteger(value) && (value ?? -1) >= 0) ||
    (state.agents ?? 0) === 0 ||
    state.agents !==
      (state.localAgents ?? 0) + (state.terminals ?? 0) + (state.remoteSessions ?? 0) ||
    (state.shownAgents ?? 0) > (state.agents ?? 0) ||
    (state.remoteHosts ?? 0) > (state.remoteSessions ?? 0)
  ) {
    throw new Error(`Missing or invalid ${view} monitor membership: ${JSON.stringify(state)}`);
  }
  // The checks above require every count. Copy only the bounded proof fields.
  return {
    viewId: state.viewId,
    agents: state.agents,
    localAgents: state.localAgents,
    terminals: state.terminals,
    remoteSessions: state.remoteSessions,
    remoteHosts: state.remoteHosts,
    shownAgents: state.shownAgents,
  } as LabMonitorState;
}
