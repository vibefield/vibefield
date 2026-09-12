import type { RemoteHostSummary, SharedSessionSummary } from "@vibecook/ghosttea-protocol";
import type { AgentProviderSummary, AgentSessionSummary } from "./facet-types";

/**
 * THE DOOR (GT-D17, widened at AR-3). The whole of what the monitor may reach
 * outside itself.
 *
 * GT-D13 says a view is a pure function of `{agents, parameters, actions}` and
 * never touches the runtime, the workspace, fieldd, or a terminal. GT-D17 then
 * asked the monitor to do two things that live entirely on the other side of
 * that line: list the mesh's sessions, and mount one in the active pane. AR-3
 * asks four more of the same shape — read fieldd's fold, list what one can
 * spawn as, spawn an agent into the active pane, mount a local session there.
 * This interface is how all of it happens without moving the line — it is
 * BUILT in `GodviewDeck`, where the runtime, the workspace and the fieldd
 * client are already in scope, and only the verbs travel. The views still see
 * actions; the source still sees promises.
 *
 * Verbs and no nouns is the point. Nothing here hands out a runtime, a
 * workspace context, a session object, or a client — so no view can grow a
 * second session authority (GT-D10) by reaching one field further than it
 * should. Widening this file is deliberate each time, and reviewed as such:
 * AR-3 is the second widening, and it is the one GT-D17 named as coming.
 */
export interface MonitorDoor {
  /** The mesh as the floor currently sees it. Rejects when the floor cannot be
   * asked at all — which the field renders as UNAVAILABLE, never as emptiness. */
  listHosts(): Promise<readonly RemoteHostSummary[]>;
  /** Open the peer's session and mount it in the ACTIVE pane. */
  attach(request: RemoteAttachRequest): Promise<RemoteAttachOutcome>;
  /**
   * AR-3 — fieldd's fold (`agent.subscribe`): a snapshot, then full frames.
   * Returns the dispose. `onFrame` receives every frame the daemon sends
   * (state transfer, never edges); `onError` the reason the subscription could
   * not be opened or was lost — the field renders that as UNAVAILABLE.
   */
  observe(listener: LocalFieldListener): () => void;
  /** AR-3 — what one can spawn as on this device (`agent.providers`). */
  providers(): Promise<readonly AgentProviderSummary[]>;
  /** AR-3 — spawn an agent in a PTY on the floor and mount it in the ACTIVE
   * pane (`agent.spawn`, then the create ticket the answer carries). */
  spawn(request: LocalSpawnRequest): Promise<LocalSpawnOutcome>;
  /** AR-3 — mount a LOCAL floor session (a managed agent's PTY, an unclaimed
   * terminal) in the ACTIVE pane. */
  mountLocal(sessionId: string): Promise<LocalMountOutcome>;
}

/** The name GT-4 gave the two-verb door; kept for the call sites that only
 * ever asked it about the mesh. */
export type RemoteSessionDoor = MonitorDoor;

export interface LocalFieldListener {
  onFrame(rows: readonly AgentSessionSummary[]): void;
  onError(reason: string): void;
}

export interface LocalSpawnRequest {
  /** puppeteer's provider id, from the chrome's own list */
  provider: string;
  /** a persona (`agents.profiles.*`); absent = the provider's native default */
  profileId?: string;
}

/**
 * What a spawn actually did, in the vocabulary the stage says out loud.
 *
 * `no-pane` is a real outcome and not an error: the agent is born INTO the pane
 * the user is in (GT-D17's law for attach, kept for births), so a deck with
 * every pane closed has nowhere to put one and is told so before anything is
 * spawned. `failed` carries fieldd's own words — a floor with no agent cell, a
 * provider with no install, the session cap.
 */
export type LocalSpawnOutcome =
  | { state: "spawned"; sessionId: string; runtimeRunId: string; label: string }
  | { state: "no-pane" }
  | { state: "failed"; reason: string };

export type LocalMountOutcome =
  | { state: "mounted"; sessionId: string }
  | { state: "no-pane" }
  | { state: "failed"; reason: string };

export interface RemoteAttachRequest {
  deviceId: string;
  /** Carried because upstream's `openRemoteSession` takes it for the pane's own
   * banner — the peer's NAME, not its id, is what a person recognizes. */
  deviceName: string;
  /** The session's id ON THE PEER. It is not an id in this device's floor. */
  remoteSessionId: string;
  /** The row's §2.6 accent, so the pane it lands in wears the bubble's color —
   * the deck↔monitor link the reference app draws and GT-3m ported unfed. */
  color: string;
}

/**
 * What an attach actually did, in the vocabulary the stage says out loud.
 *
 * `no-pane` is a real outcome and not an error: a deck with every pane closed
 * has nowhere to put a session, and the honest answer is to say so rather than
 * to open a pane the user did not ask for (GT-D10 — the workspace owns births).
 * `view-only` is likewise not a failure: it is the mirror-write law arriving as
 * a fact, and the session IS attached.
 */
export type RemoteAttachOutcome =
  | { state: "attached"; sessionId: string; readWrite: boolean }
  | { state: "no-pane" }
  | { state: "failed"; reason: string };

/** A peer's identity, carried beside every session it owns. */
export interface RemoteHostIdentity {
  deviceId: string;
  deviceName: string;
}

/** One attachable thing on the mesh: the peer, and the peer's own summary of
 * the session. The two travel together because a session id is only unique
 * WITHIN a peer — a row that lost its host would be a session nobody owns. */
export interface RemoteSessionRow {
  host: RemoteHostIdentity;
  session: SharedSessionSummary;
}

/**
 * A monitor row id for a peer's session.
 *
 * Prefixed and device-qualified because the monitor's ids are a flat namespace
 * shared with local sessions: two peers can each have a session `1`, and one of
 * them can collide with ours. The prefix also makes a remote id recognizable in
 * a marker line, which is how the smoke tells the two apart.
 */
export function remoteRowId(deviceId: string, sessionId: string): string {
  return `remote:${deviceId}:${sessionId}`;
}

/**
 * The mesh's hosts, flattened into rows.
 *
 * ONLINE hosts only: an offline peer's session list is a claim about a machine
 * we currently cannot reach, and a bubble the user cannot open is a control
 * that does nothing. Sessions that have STOPPED running are dropped for the
 * same reason. `attachable: false` is kept and shown, because that one IS a
 * fact about a live session the peer is deliberately not sharing — the row
 * says so and refuses honestly rather than vanishing.
 */
export function remoteSessionRows(
  hosts: readonly RemoteHostSummary[],
): readonly RemoteSessionRow[] {
  return hosts
    .filter((host) => host.online)
    .flatMap((host) =>
      host.sessions
        .filter((session) => session.running)
        .map((session) => ({
          host: { deviceId: host.deviceId, deviceName: host.deviceName },
          session,
        })),
    );
}
