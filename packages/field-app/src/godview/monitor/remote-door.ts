import type { RemoteHostSummary, SharedSessionSummary } from "@vibecook/ghosttea-protocol";

/**
 * THE DOOR (GT-D17). The whole of what the monitor may reach outside itself.
 *
 * GT-D13 says a view is a pure function of `{agents, parameters, actions}` and
 * never touches the runtime, the workspace, or a terminal. GT-D17 then asks the
 * monitor to do two things that live entirely on the other side of that line:
 * list the mesh's sessions, and mount one in the active pane. This interface is
 * how both happen without moving the line — it is BUILT in `GodviewDeck`, where
 * the runtime and the workspace are already in scope, and only the two verbs
 * travel. The views still see actions; the source still sees a promise.
 *
 * Two verbs and no nouns is the point. Nothing here hands out a runtime, a
 * workspace context, a session object, or a client — so no view can grow a
 * second session authority (GT-D10) by reaching one field further than it
 * should. If a third verb is ever needed it is a deliberate widening of this
 * file, which is exactly the review this deserves.
 */
export interface RemoteSessionDoor {
  /** The mesh as the floor currently sees it. Rejects when the floor cannot be
   * asked at all — which the field renders as UNAVAILABLE, never as emptiness. */
  listHosts(): Promise<readonly RemoteHostSummary[]>;
  /** Open the peer's session and mount it in the ACTIVE pane. */
  attach(request: RemoteAttachRequest): Promise<RemoteAttachOutcome>;
}

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
