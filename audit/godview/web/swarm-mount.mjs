import { SWARM_RUNTIME_ENTRIES } from "../rendering/inputs.mjs";

const byState = new Map(SWARM_RUNTIME_ENTRIES.map((entry) => [entry.stateId, entry]));

const UNMOUNTABLE = {
  "state.terminal_opening":
    "opening is not an AgentView field. MonitorViewHost cannot mount it. This is not a WebGPU result and not a painted body.",
  "state.attachable":
    "None of the five views read attachable, so there is no row to give AgentSwarm. This is not a WebGPU result and not a painted body.",
};

/**
 * Runtime mount for one swarm card. The 67 environment gaps stay the capture
 * host's unpainted record. This does not mark the cell rendered.
 *
 * GV6's scrollable list should call this per card and keep the returned
 * fixture on `data-swarm-mount`. Do not set iframe `src` in the markup.
 * `bindSwarmMounts` loads a card only while it is near the viewport and
 * clears it on the way out, so a long list does not keep a GPU context per card.
 */
export function swarmRuntimeMount(cell) {
  if (cell?.selection?.viewId !== "view.swarm") return null;
  if (cell?.paint?.disposition !== "environment-gap") return null;
  const stateId = cell.selection.stateId;
  const entry = byState.get(stateId);
  if (!entry) {
    return {
      attempt: false,
      fixtureId: null,
      historicalGaps: 67,
      reason:
        UNMOUNTABLE[stateId] ??
        "No pinned row exists for this swarm cell, so the page does not invent a body.",
    };
  }
  return {
    attempt: true,
    fixtureId: entry.fixtureId,
    historicalGaps: 67,
    reason:
      "Pinned AgentSwarm from Puppeteer source 748d015. This browser asks for a WebGPU adapter when the card is in view. The 67 environment gaps stay the capture host's unpainted record, not a result for this browser.",
  };
}
