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

/** Which of the lab's readiness conditions a deck state does not meet, each
 * with what was read. `labDeckReady` is exactly "none of them". */
export function labDeckMissing(state: LabDeckState | null): string[] {
  if (state === null) return ["a GODVIEW_DECK marker (none was read)"];
  const read = (value: unknown): string =>
    typeof value === "string" ? JSON.stringify(value) : String(value);
  const missing: string[] = [];
  if (state.active !== true) missing.push(`an active deck (active ${read(state.active)})`);
  if (!(Number.isInteger(state.panes) && state.panes > 0)) {
    missing.push(`a pane (panes ${read(state.panes)})`);
  }
  if (!(Number.isInteger(state.sessions) && state.sessions > 0)) {
    missing.push(`a session (sessions ${read(state.sessions)})`);
  }
  if (state.poolPhase !== "open") missing.push(`an open pool (poolPhase ${read(state.poolPhase)})`);
  if (state.rosterState !== "observed") {
    missing.push(`an observed roster (rosterState ${read(state.rosterState)})`);
  }
  if (state.rendererBackend !== "webgpu") {
    missing.push(`a WebGPU terminal renderer (rendererBackend ${read(state.rendererBackend)})`);
  }
  if (state.error !== undefined) missing.push(`no deck error (error ${read(state.error)})`);
  return missing;
}

export function labDeckReady(state: LabDeckState | null): boolean {
  return labDeckMissing(state).length === 0;
}

/** A deck state for an error's text: the readiness facts first (they survive
 * the bound), the marker's other fields after them, as JSON of at most `limit`
 * characters. A marker never read says so. */
export function labDeckSeen(state: LabDeckState | null, limit = 600): string {
  if (state === null) return "no GODVIEW_DECK marker";
  const { active, panes, sessions, poolPhase, rosterState, rendererBackend, error, ...rest } =
    state;
  const text = JSON.stringify({
    active,
    panes,
    sessions,
    poolPhase,
    rosterState,
    rendererBackend,
    ...(error !== undefined ? { error } : {}),
    ...rest,
  });
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

/** What a wait for the deck that timed out says it saw: the last state read,
 * and which readiness conditions that state still lacked. */
export function labDeckTimeout(state: LabDeckState | null): string {
  const missing = labDeckMissing(state);
  return `the deck last said ${labDeckSeen(state)}; still missing: ${
    missing.length > 0 ? missing.join(", ") : "nothing (ready as the wait ended)"
  }`;
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
