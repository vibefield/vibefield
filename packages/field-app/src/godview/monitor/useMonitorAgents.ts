import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assembleMonitorAgents } from "./agents";
import { MOCK_TICK_MS, mockFieldAt } from "./mock-agent-field";
import type { MonitorPalette } from "./monitor-palette";
import type { MonitorActions, MonitorAgent } from "./types";

/**
 * THE SEAM. The single subscription to everything a monitor view renders, and
 * the only module in this subsystem that knows where agents come from.
 *
 * In the reference app this hook subscribes to the chopsticks runtime over
 * Electron IPC (`onAgentSession` / `onAgentState` / `onAgentRemoved` /
 * `onWorkspaceFinal`, reconciled against a `listAgentSessions` snapshot). Here
 * it drives `MockAgentField` instead — same hook, same output, one source
 * swapped. That is GT-D13's whole claim, and it is why it lives beside the view
 * contract rather than inside any one view: a second view is a consumer of this
 * hook and never a consumer of the swarm.
 *
 * PF6: the interval is created on mount and cleared on unmount, and the stage
 * that owns this hook is mounted ONLY while the overlay is open. A closed
 * Godview therefore holds no monitor timer at all — not a paused one.
 */

export interface UseMonitorAgentsOptions {
  /** §2.6's accents, live from the tokens. The projection needs them to assign
   * each session its stable relationship color. */
  palette: MonitorPalette;
}

export interface MonitorAgentsResult {
  agents: readonly MonitorAgent[];
  actions: MonitorActions;
  /** What the mock has acknowledged, for the stage to say out loud. Cleared by
   * the stage; carried here because the actions are what produce it. */
  acknowledgement: MonitorAcknowledgement | null;
  clearAcknowledgement(): void;
}

export interface MonitorAcknowledgement {
  /** Bumped per event so a repeat of the same gesture still reads as one. */
  nonce: number;
  message: string;
}

export function useMonitorAgents({ palette }: UseMonitorAgentsOptions): MonitorAgentsResult {
  const [tick, setTick] = useState(0);
  /** Which row the user last pointed at. It is REAL state and it is honest:
   * "selected" here means selected in the preview, and the mock says so. */
  const [selectedId, setSelectedId] = useState<string>();
  const [acknowledgement, setAcknowledgement] = useState<MonitorAcknowledgement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((current) => current + 1), MOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = useMemo(() => mockFieldAt(tick), [tick]);

  /** GT-3p: the tick's own damage gate.
   *
   * `mockFieldAt` is pure, so a tick that changed nothing anybody renders still
   * produces a NEW object every 1.5s — and a new object re-runs the projection
   * and re-renders every view beneath it. Most ticks move one agent's context
   * percentage by a fraction and nothing else; the swarm cannot show that, and
   * the stage chrome has nothing to do with it at all.
   *
   * The comparison is over the projection's INPUTS as JSON. That is honest
   * about what it can catch — it is a structural equality, not a semantic one —
   * and it is cheap at this size (nine records, twice a second). Holding the
   * previous snapshot in a ref and returning it unchanged means the `useMemo`
   * below sees the same reference and does not recompute, which is the entire
   * saving: React's own bailout does the rest. */
  const stableSnapshot = useRef(snapshot);
  const stableKey = useRef("");
  const key = JSON.stringify(snapshot);
  if (key !== stableKey.current) {
    stableKey.current = key;
    stableSnapshot.current = snapshot;
  }

  const settled = stableSnapshot.current;
  const agents = useMemo(
    () =>
      assembleMonitorAgents({
        agents: settled.agents,
        terminals: settled.terminals,
        accents: palette.accents,
        ...(selectedId !== undefined ? { activeSessionId: selectedId } : {}),
      }),
    [palette.accents, selectedId, settled],
  );

  // MOCK ACTIONS (GT-D13): they acknowledge VISIBLY and mount NOTHING. No
  // session is created, no pane is touched, and the deck beside this stage never
  // hears about either gesture — a preview that could spawn a real shell would
  // be a preview in name only.
  //
  // AR wires the real pair: `select` becomes `workspace.mountSession(...)` and
  // `createAt` becomes `workspace.createSessionInActivePane()` followed by the
  // new terminal joining the source's records — both through the workspace's own
  // doors, because GT-D10 says the deck has exactly one session authority and
  // the monitor is not it.
  const select = useCallback((agent: MonitorAgent): void => {
    setSelectedId(agent.session.id);
    setAcknowledgement((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      message: `${agent.project} selected — preview only, nothing was mounted`,
    }));
  }, []);

  const createAt = useCallback((): void => {
    setAcknowledgement((current) => ({
      nonce: (current?.nonce ?? 0) + 1,
      message: "create is not wired in the preview — the real one arrives with AR",
    }));
  }, []);

  const clearAcknowledgement = useCallback(() => setAcknowledgement(null), []);
  const actions = useMemo<MonitorActions>(() => ({ select, createAt }), [createAt, select]);

  return { agents, actions, acknowledgement, clearAcknowledgement };
}
