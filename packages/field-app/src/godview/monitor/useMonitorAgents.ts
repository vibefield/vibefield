import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assembleMonitorAgents,
  type MonitorManagedRecord,
  type MonitorRemoteRecord,
  type MonitorTerminalRecord,
} from "./agents";
import type { AgentProviderSummary } from "./facet-types";
import { type LocalFieldState, useLocalAgentField } from "./local-agent-field";
import type { MonitorPalette } from "./monitor-palette";
import { type MonitorDoor, remoteRowId } from "./remote-door";
import { useRemoteSessionField } from "./remote-session-field";
import type { MonitorActions, MonitorAgent } from "./types";

/**
 * THE SEAM. The single subscription to everything a monitor view renders, and
 * the only module in this subsystem that knows where agents come from.
 *
 * It is a COMPOSITION (GT-D17), and since AR-3 both halves are real:
 *
 *   · `LocalAgentField` — fieldd's fold (`agent.subscribe`): every managed
 *     session on this device, one row per run, with puppeteer's monitor
 *     projection riding verbatim. It replaced `MockAgentField`, and the
 *     label that said the rows were invented went with it.
 *   · `RemoteSessionField` — REAL sessions on real peers, read from the mesh
 *     through the deck's own control connection, and mountable for real.
 *
 * Beside them, the deck's own panes: a pane no agent has claimed is an
 * unclaimed terminal row, the deck's fact and the deck's summary.
 *
 * Every verb goes through the DOOR the deck built (`MonitorDoor`): a local
 * row's select mounts its PTY in the active pane, a remote row's select
 * attaches the peer's session there, and create spawns the chrome's chosen
 * provider into it. The views still see actions; the source sees promises.
 *
 * PF6: the subscription and the poll are opened on mount and closed on
 * unmount, and the stage that owns this hook is mounted ONLY while the overlay
 * is open. A closed Godview therefore holds no monitor subscription at all.
 */

export interface UseMonitorAgentsOptions {
  /** §2.6's accents, live from the tokens. The projection needs them to assign
   * each session its stable relationship color. */
  palette: MonitorPalette;
  /** The deck's verbs (GT-D17, AR-3). Null before a deck exists — this host has
   * no terminal bridge, or the overlay has not built one yet — and both halves
   * of the field are then empty, honestly and without placeholders. */
  door?: MonitorDoor | null;
  /** The sessions the deck's panes are showing, and the one the user is in.
   * Facts, published by the deck; the monitor reads them and drives nothing. */
  panes?: MonitorPaneFacts;
}

export interface MonitorPaneFacts {
  sessionIds: readonly string[];
  activeSessionId?: string;
  /** The floor summaries of those panes' sessions (ghosttea's, as the deck
   * holds them): what makes an unclaimed pane a terminal row, and what lets
   * a managed row carry its PTY's summary. */
  sessions?: readonly SessionSummary[];
}

export interface MonitorAgentsResult {
  agents: readonly MonitorAgent[];
  actions: MonitorActions;
  /** How many rows each source contributed, so the stage can scope its claims
   * to the right ones (GT-D17) rather than labeling the whole field. */
  sources: MonitorSourceCounts;
  /** What the chrome can spawn as, and which of them is chosen. */
  providers: readonly AgentProviderSummary[];
  selectedProviderId: string | null;
  selectProvider(id: string): void;
  /** Spawn the chosen provider into the active pane — the chrome's own verb;
   * `createAt` is the same act from a view's gesture. */
  spawn(): Promise<void>;
  /** What the last verb answered, for the stage to say out loud. Cleared by
   * the stage; carried here because the actions are what produce it. */
  acknowledgement: MonitorAcknowledgement | null;
  clearAcknowledgement(): void;
}

export interface MonitorSourceCounts {
  /** Managed sessions the fold contributed. */
  local: number;
  /** The deck's panes no agent has claimed. */
  terminals: number;
  remote: number;
  /** Online peers behind the remote rows. */
  hosts: number;
  /** The local field's honest state — `unavailable` carries fieldd's own reason. */
  localState: LocalFieldState;
  localReason?: string;
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
  /** Which row the user last pointed at — a preview highlight for a row no
   * pane is showing yet. Cleared when the row lands in a pane. */
  const [selectedId, setSelectedId] = useState<string>();
  const [acknowledgement, setAcknowledgement] = useState<MonitorAcknowledgement | null>(null);
  /** Row id → the replica it was attached as. Kept per ROW rather than per
   * session because the row is what survives a refresh of the mesh. */
  const [links, setLinks] = useState<ReadonlyMap<string, RemoteLink>>(() => new Map());
  const [providers, setProviders] = useState<readonly AgentProviderSummary[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const localField = useLocalAgentField({ door });
  const remoteField = useRemoteSessionField({ door });

  // What one can spawn as, asked once per door. A door that cannot answer
  // leaves the list empty and the spawn control says so; nothing is invented.
  useEffect(() => {
    if (door === null) {
      setProviders([]);
      return;
    }
    let alive = true;
    void door
      .providers()
      .then((list) => {
        if (!alive) return;
        setProviders(list);
        setSelectedProviderId((current) => {
          if (current !== null && list.some((p) => p.id === current)) return current;
          return list.find((p) => p.available)?.id ?? list[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (alive) setProviders([]);
      });
    return () => {
      alive = false;
    };
  }, [door]);

  /** GT-3p's damage gate, kept: the projection's INPUTS as JSON. A frame
   * that changed nothing anybody renders still arrives as a new object; the
   * comparison holds the previous rows and returns them unchanged so the memo
   * below sees the same reference. Cheap at this size. */
  const stableRows = useRef(localField.rows);
  const stableKey = useRef("");
  const key = JSON.stringify(localField.rows);
  if (key !== stableKey.current) {
    stableKey.current = key;
    stableRows.current = localField.rows;
  }
  const localRows = stableRows.current;

  /** The deck publishes a fresh array whenever anything about its panes moves,
   * and the projection below must not recompute on identity alone. The joined
   * string is the dependency and the set is derived FROM it, so the memo cannot
   * drift from what it depends on; NUL separates because no session id has one. */
  const paneSessionKey = panes.sessionIds.join("\0");
  const paneSessionIds = useMemo(
    () => new Set(paneSessionKey === "" ? [] : paneSessionKey.split("\0")),
    [paneSessionKey],
  );
  const paneSessions = panes.sessions;
  const paneSummaryKey = JSON.stringify(
    (paneSessions ?? []).map((s) => [s.id, s.exited, s.cwd, s.title, s.activity?.kind]),
  );
  const sessions = useMemo(() => {
    const map = new Map<string, SessionSummary>();
    for (const session of paneSessions ?? []) map.set(session.id, session);
    return map;
    // keyed by the facts a row draws, not by array identity (the deck
    // republishes at ghosttea's cadence)
    // biome-ignore lint/correctness/useExhaustiveDependencies: paneSummaryKey stands in for paneSessions
  }, [paneSummaryKey]);

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

  const managed = useMemo<readonly MonitorManagedRecord[]>(
    () => localRows.map((summary) => ({ summary })),
    [localRows],
  );
  /** The deck's panes, as terminal rows: the projection drops the ones a
   * managed row claims. A pane whose session exited stays out (a dead pane is
   * the deck's face to draw, not a row). */
  const terminals = useMemo<readonly MonitorTerminalRecord[]>(
    () =>
      [...sessions.values()].filter((session) => !session.exited).map((session) => ({ session })),
    [sessions],
  );

  const agents = useMemo(
    () =>
      assembleMonitorAgents({
        managed,
        terminals,
        remotes,
        accents: palette.accents,
        sessions,
        ...(panes.activeSessionId !== undefined ? { activeSessionId: panes.activeSessionId } : {}),
        ...(selectedId !== undefined ? { previewSelectedId: selectedId } : {}),
      }),
    [palette.accents, selectedId, managed, terminals, remotes, sessions, panes.activeSessionId],
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

  /**
   * A LOCAL row's select (AR-3): a managed agent's PTY, or an unclaimed
   * terminal, mounted in the pane the user is in. A row already showing there
   * is acknowledged rather than re-mounted; a row whose PTY the fold no longer
   * names (hosted: none) has nothing to mount and says so.
   */
  const mountLocal = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      const sessionId = agent.session?.id ?? agent.agent?.summary.terminal?.runtimeSessionId;
      if (sessionId === undefined) {
        announce(`${agent.project} has no terminal here to mount`);
        return;
      }
      if (agent.active && panes.activeSessionId === sessionId) {
        announce(`${agent.project} is in the active pane`);
        return;
      }
      if (door === null) {
        announce(`${agent.project} cannot be mounted yet — the deck has no connection`);
        return;
      }
      const outcome = await door.mountLocal(sessionId);
      if (outcome.state === "no-pane") {
        announce("no pane to mount into — open one in the deck first");
        return;
      }
      if (outcome.state === "failed") {
        announce(`${agent.project} could not be mounted — ${outcome.reason}`);
        return;
      }
      setSelectedId(undefined);
      announce(`${agent.project} mounted in the active pane`);
    },
    [announce, door, panes.activeSessionId],
  );

  const select = useCallback(
    (agent: MonitorAgent): void => {
      if (agent.remote !== undefined) {
        void attachRemote(agent);
        return;
      }
      setSelectedId(agent.id);
      void mountLocal(agent);
    },
    [attachRemote, mountLocal],
  );

  /** The birth (AR-3): the chrome's chosen provider, into the active pane. */
  const spawn = useCallback(async (): Promise<void> => {
    if (door === null) {
      announce("no agent can be spawned yet — the deck has no connection");
      return;
    }
    const provider = providers.find((p) => p.id === selectedProviderId);
    if (provider === undefined) {
      announce("no agent provider is available on this device");
      return;
    }
    if (!provider.available) {
      announce(`${provider.label} is not installed on this device`);
      return;
    }
    const outcome = await door.spawn({ provider: provider.id });
    if (outcome.state === "no-pane") {
      announce("no pane to spawn into — open one in the deck first");
      return;
    }
    if (outcome.state === "failed") {
      announce(`${provider.label} could not be spawned — ${outcome.reason}`);
      return;
    }
    announce(`${outcome.label} spawned in the active pane`);
  }, [announce, door, providers, selectedProviderId]);

  const createAt = useCallback((): Promise<void> => spawn(), [spawn]);

  const clearAcknowledgement = useCallback(() => setAcknowledgement(null), []);
  const selectProvider = useCallback((id: string) => setSelectedProviderId(id), []);
  const actions = useMemo<MonitorActions>(() => ({ select, createAt }), [createAt, select]);
  const sources = useMemo<MonitorSourceCounts>(
    () => ({
      // Counted off the ASSEMBLED rows rather than the field's records: the
      // projection drops an exited run, and a claim of N agents over N-1 drawn
      // ones would be its own small dishonesty.
      local: agents.filter((agent) => agent.agent !== undefined).length,
      terminals: agents.filter((agent) => agent.agent === undefined && agent.remote === undefined)
        .length,
      remote: remotes.length,
      hosts: remoteField.hosts,
      localState: localField.state,
      ...(localField.reason !== undefined ? { localReason: localField.reason } : {}),
      remoteState: remoteField.state,
      ...(remoteField.reason !== undefined ? { remoteReason: remoteField.reason } : {}),
    }),
    [agents, remotes, remoteField, localField],
  );

  return {
    agents,
    actions,
    sources,
    providers,
    selectedProviderId,
    selectProvider,
    spawn,
    acknowledgement,
    clearAcknowledgement,
  };
}
