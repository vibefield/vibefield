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
