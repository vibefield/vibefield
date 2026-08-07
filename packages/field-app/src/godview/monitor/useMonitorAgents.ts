import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assembleMonitorAgents, type MonitorRemoteRecord } from "./agents";
import { MOCK_TICK_MS, mockFieldAt } from "./mock-agent-field";
import type { MonitorPalette } from "./monitor-palette";
import { type RemoteSessionDoor, remoteRowId } from "./remote-door";
import { useRemoteSessionField } from "./remote-session-field";
import type { MonitorActions, MonitorAgent } from "./types";

/**
 * THE SEAM. The single subscription to everything a monitor view renders, and
 * the only module in this subsystem that knows where agents come from.
 *
 * It is now a COMPOSITION (GT-D17). Two sources answer here and are merged into
 * one `MonitorAgent[]`:
 *
 *   · `MockAgentField` — invented, labeled, and structurally unable to mount
 *     anything. AR replaces exactly this one module and deletes its label.
 *   · `RemoteSessionField` — REAL sessions on real peers, read from the mesh
 *     through the deck's own control connection, and mountable for real.
 *
 * The honesty split lives with the split sources: a mock row acknowledges and
 * mounts nothing, a remote row attaches the active pane, and neither is allowed
 * to look like the other (the stage's labels, and the views' own treatment).
 *
 * In the reference app this hook subscribes to the chopsticks runtime over
 * Electron IPC (`onAgentSession` / `onAgentState` / `onAgentRemoved` /
 * `onWorkspaceFinal`, reconciled against a `listAgentSessions` snapshot). The
 * mock still stands in for that half; the remote half is already the real
 * thing. That is GT-D13's claim, unchanged: the views cannot tell.
 *
 * PF6: the intervals are created on mount and cleared on unmount, and the stage
 * that owns this hook is mounted ONLY while the overlay is open. A closed
 * Godview therefore holds no monitor timer at all — not a paused one, and no
 * poll against the mesh either.
 */

export interface UseMonitorAgentsOptions {
  /** §2.6's accents, live from the tokens. The projection needs them to assign
   * each session its stable relationship color. */
  palette: MonitorPalette;
  /** The deck's two verbs (GT-D17). Null before a deck exists — this host has
   * no terminal bridge, or the overlay has not built one yet — and the remote
   * half of the field is then empty, honestly and without placeholders. */
  door?: RemoteSessionDoor | null;
  /** The sessions the deck's panes are showing, and the one the user is in.
   * Facts, published by the deck; the monitor reads them and drives nothing. */
  panes?: MonitorPaneFacts;
}

export interface MonitorPaneFacts {
  sessionIds: readonly string[];
  activeSessionId?: string;
}

export interface MonitorAgentsResult {
  agents: readonly MonitorAgent[];
  actions: MonitorActions;
  /** How many rows each source contributed, so the stage can scope its claims
   * to the right ones (GT-D17) rather than labeling the whole field. */
  sources: MonitorSourceCounts;
  /** What the mock has acknowledged, for the stage to say out loud. Cleared by
   * the stage; carried here because the actions are what produce it. */
  acknowledgement: MonitorAcknowledgement | null;
  clearAcknowledgement(): void;
}

export interface MonitorSourceCounts {
  mock: number;
  remote: number;
  /** Online peers behind the remote rows. */
  hosts: number;
  /** The remote field's honest state — `unavailable` carries the floor's own
   * reason, which is the ordinary answer from a floor serving no mesh. */
  remoteState: "no-door" | "serving" | "unavailable";
  remoteReason?: string;
}

export interface MonitorAcknowledgement {
  /** Bumped per event so a repeat of the same gesture still reads as one. */
  nonce: number;
  message: string;
}

/** Where a remote row landed, remembered from the attach that put it there. */
interface RemoteLink {
  localSessionId: string;
  color: string;
}

const NO_PANES: MonitorPaneFacts = { sessionIds: [] };

export function useMonitorAgents({
  palette,
  door = null,
  panes = NO_PANES,
}: UseMonitorAgentsOptions): MonitorAgentsResult {
  const [tick, setTick] = useState(0);
  /** Which row the user last pointed at. It is REAL state and it is honest:
   * "selected" here means selected in the preview, and the mock says so. */
  const [selectedId, setSelectedId] = useState<string>();
  const [acknowledgement, setAcknowledgement] = useState<MonitorAcknowledgement | null>(null);
  /** Row id → the replica it was attached as. Kept per ROW rather than per
   * session because the row is what survives a refresh of the mesh. */
  const [links, setLinks] = useState<ReadonlyMap<string, RemoteLink>>(() => new Map());

  useEffect(() => {
    const timer = window.setInterval(() => setTick((current) => current + 1), MOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = useMemo(() => mockFieldAt(tick), [tick]);
  const remoteField = useRemoteSessionField({ door });

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

  /** The deck publishes a fresh array whenever anything about its panes moves,
   * and the projection below must not recompute on identity alone. The joined
   * string is the dependency and the set is derived FROM it, so the memo cannot
   * drift from what it depends on; NUL separates because no session id has one. */
  const paneSessionKey = panes.sessionIds.join("\0");
  const paneSessionIds = useMemo(
    () => new Set(paneSessionKey === "" ? [] : paneSessionKey.split("\0")),
    [paneSessionKey],
  );

  /** A pane link is only true while a pane is actually showing the replica: the
   * user can close that pane, and a bubble still drawn as linked would be the
   * monitor remembering an event instead of reporting a state. */
  const remotes = useMemo<readonly MonitorRemoteRecord[]>(
    () =>
      remoteField.rows.map((row) => {
        const link = links.get(remoteRowId(row.host.deviceId, row.session.sessionId));
        if (link === undefined || !paneSessionIds.has(link.localSessionId)) return { row };
        return { row, localSessionId: link.localSessionId, paneColor: link.color };
      }),
    [remoteField.rows, links, paneSessionIds],
  );

  const settled = stableSnapshot.current;
  const agents = useMemo(
    () =>
      assembleMonitorAgents({
        agents: settled.agents,
        terminals: settled.terminals,
        remotes,
        accents: palette.accents,
        ...(panes.activeSessionId !== undefined ? { activeSessionId: panes.activeSessionId } : {}),
        ...(selectedId !== undefined ? { previewSelectedId: selectedId } : {}),
      }),
    [palette.accents, selectedId, settled, remotes, panes.activeSessionId],
  );

  const announce = useCallback((message: string): void => {
    setAcknowledgement((current) => ({ nonce: (current?.nonce ?? 0) + 1, message }));
  }, []);

  /**
   * THE DOOR, opened (GT-D17). A remote row's select is the reference app's
   * `MonitorActions.select` contract finally meaning what it always said:
   * "Mount this session in the active pane".
   *
   * The mechanics are the deck's, not this hook's — `door.attach` is where the
   * runtime and the workspace live, and the one thing that crosses back is an
   * outcome. Every outcome is said out loud, including the two that are not
   * failures: a deck with no panes has nowhere to put a session, and a peer
   * that refuses mirror-write has still handed over a session worth watching.
   */
  const attachRemote = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      const remote = agent.remote;
      if (remote === undefined) return;
      if (door === null) {
        // The one outcome that used to be silent, and the only path where
        // clicking a row did nothing without saying so. A door is null when no
        // deck exists yet — the overlay is still coming up, or this host has no
        // terminal bridge at all — and a row the mesh put on the stage is worth
        // an answer either way.
        announce(`${remote.deviceName} cannot be attached yet — the deck has no connection`);
        return;
      }
      if (!remote.attachable) {
        announce(`${remote.deviceName} is not sharing ${agent.project} for attachment`);
        return;
      }
      const outcome = await door.attach({
        deviceId: remote.deviceId,
        deviceName: remote.deviceName,
        remoteSessionId: remote.remoteSessionId,
        color: agent.color,
      });
      if (outcome.state === "no-pane") {
        announce("no pane to attach to — open one in the deck first");
        return;
      }
      if (outcome.state === "failed") {
        announce(`${remote.deviceName} could not be attached — ${outcome.reason}`);
        return;
      }
      setLinks((current) => {
        const next = new Map(current);
        next.set(agent.id, { localSessionId: outcome.sessionId, color: agent.color });
        return next;
      });
      // Mirror-write, honest and in the same breath as the success: the pane is
      // real either way, and which of the two it is decides whether typing into
      // it does anything. The pane carries the library's own "View only" face;
      // this is the monitor saying the same thing where the gesture happened.
      announce(
        outcome.readWrite
          ? `${agent.project} attached from ${remote.deviceName}`
          : `${agent.project} attached from ${remote.deviceName} — view only, the peer refuses writes`,
      );
    },
    [announce, door],
  );

  // MOCK ACTIONS (GT-D13), unchanged: they acknowledge VISIBLY and mount
  // NOTHING. No session is created, no pane is touched, and the deck beside
  // this stage never hears about the gesture — a preview that could spawn a
  // real shell would be a preview in name only.
  //
  // AR wires the local half the same way GT-4 just wired the remote one: this
  // source is replaced, and `select` keeps its meaning.
  const select = useCallback(
    (agent: MonitorAgent): void => {
      if (agent.remote !== undefined) {
        void attachRemote(agent);
        return;
      }
      setSelectedId(agent.id);
      announce(`${agent.project} selected — preview only, nothing was mounted`);
    },
    [announce, attachRemote],
  );

  const createAt = useCallback((): void => {
    announce("create is not wired in the preview — the real one arrives with AR");
  }, [announce]);

  const clearAcknowledgement = useCallback(() => setAcknowledgement(null), []);
  const actions = useMemo<MonitorActions>(() => ({ select, createAt }), [createAt, select]);
  const sources = useMemo<MonitorSourceCounts>(
    () => ({
      // Counted off the ASSEMBLED rows rather than the mock's records: the
      // projection drops an exited agent, and a label claiming nine invented
      // rows over eight drawn ones would be its own small dishonesty.
      mock: agents.filter((agent) => agent.remote === undefined).length,
      remote: remotes.length,
      hosts: remoteField.hosts,
      remoteState: remoteField.state,
      ...(remoteField.reason !== undefined ? { remoteReason: remoteField.reason } : {}),
    }),
    [agents, remotes, remoteField],
  );

  return { agents, actions, sources, acknowledgement, clearAcknowledgement };
}
