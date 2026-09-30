import type { RemoteHostSummary, SharedSessionSummary } from "@vibecook/ghosttea-protocol";
import type { AccountUsagePort, HistoryPort } from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import type { AgentSessionSummary } from "./facet-types";

export type MonitorFeedState =
  | { state: "no-door" | "loading" | "ready" }
  | { state: "unavailable"; reason: string };

/** The shared column stays presentation-only; the host reports transport and
 * parse failures beside it, without inventing an empty usage batch. */
export interface MonitorUsagePort extends AccountUsagePort {
  subscribeState?(listener: (state: MonitorFeedState) => void): () => void;
}

/**
 * THE DOOR (GT-D17, widened at AR-3). The whole of what the monitor may reach
 * outside itself.
 *
 * GT-D13 says a view is a pure function of `{agents, parameters, actions}` and
 * never touches the runtime, the workspace, fieldd, or a terminal. GT-D17 then
 * asked the monitor to do two things that live entirely on the other side of
 * that line: list the mesh's sessions, and mount one in the active pane. AR-3
 * adds fieldd's fold, empty-terminal creation and local-session attachment.
 * This interface is how all of it happens without moving the line — it is
 * BUILT in `GodviewDeck`, where the runtime, the workspace and the fieldd
 * client are already in scope, and only the verbs travel. The views still see
 * actions; the source still sees promises.
 *
 * Verbs and no nouns is the point. Nothing here hands out a runtime, a
 * workspace context, a session object, or a client — so no view can grow a
 * second session authority (GT-D10) by reaching one field further than it
 * should. Widening this file is deliberate each time, and reviewed as such:
 * AR-3 is the second widening, and it is the one GT-D17 named as coming. The
 * spawn bloom (SB-3) is the third: `createTerminal` takes the Agent Profile a
 * shell is born under — a set id, a noun of fieldd's, never a binding.
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
  /** Create an empty shell through the workspace's normal birth path — under
   * an Agent Profile when the request names one (SB-3). A refusal is an
   * outcome (`failed`, in fieldd's own words), never a throw. */
  createTerminal(request?: TerminalBirthRequest): Promise<LocalMountOutcome>;
  /** AR-3 — mount a LOCAL floor session (a managed agent's PTY, an unclaimed
   * terminal) in the ACTIVE pane. AR-4 — with `replacing`, in the pane that
   * is showing the PTY the session took the place of. */
  mountLocal(sessionId: string, options?: LocalMountOptions): Promise<LocalMountOutcome>;
  /** AR-5 — the transcript history the find sheet asks (`index.status` /
   * `index.sessions` / `index.search`), adapted to the views' port. The views
   * never dial rosettad (AR-D14): the daemon's origin stays in fieldd. */
  history: HistoryPort;
  /** AR-5 — the account-usage readings the usage column draws
   * (`agents.usage` + its subscription), adapted to the views' port. */
  usage: MonitorUsagePort;
  /** AR-S5 — the Agent Profiles the bar's tabs are made of
   * (`agents.profileSets.subscribe`), held only while the stage is open
   * (PF6). Optional, and deliberately: a door without it draws no tabs,
   * which is also what the bar should draw when there is no feed to read. */
  profiles?: ProfileSetsPort;
}

/** AR-S5 — the Agent Profiles as whole snapshots at fieldd's tick. Returns the
 * dispose; a frame the reader cannot parse is dropped, and the tabs keep the
 * last one they drew. */
export interface ProfileSetsPort {
  subscribe(listener: (sets: readonly AgentProfileSet[]) => void): () => void;
}

/** SB-3 — what a new terminal is born under. */
export interface TerminalBirthRequest {
  /** An Agent Profile SET id (`"native"` is This Mac, still a bound birth):
   * fieldd binds the shell to it (SB-2). Absent: an unbound shell, as before. */
  profileSet?: string;
}

/** AR-4 — a mount that takes a PTY's place: the run was resumed into a new
 * PTY (the fold's row names the old one under `terminal.replaced`), and the
 * pane that holds the old one is handed the new one rather than the active
 * pane. Ignored when no pane shows `replacing`. */
export interface LocalMountOptions {
  replacing?: string;
  /** With `replacing`: the ONE pane to land in (QL — the launcher's own pane,
   * where a mirrored shell shows in several); refused if that pane no longer
   * shows the replaced terminal. Without it, the first pane showing it. */
  paneId?: string;
}

/** The name GT-4 gave the two-verb door; kept for the call sites that only
 * ever asked it about the mesh. */
export type RemoteSessionDoor = MonitorDoor;

export interface LocalFieldListener {
  onFrame(rows: readonly AgentSessionSummary[]): void;
  onError(reason: string): void;
}

export type LocalMountOutcome =
  | {
      state: "mounted";
      sessionId: string;
      /** A birth's Agent Profile, as fieldd applied it (SB-3) — present only
       * when the shell was born bound. Asked for and absent: the daemon could
       * not bind it (older than SB-2), and the shell is unbound. */
      profileSet?: string;
    }
  | { state: "no-pane" }
  | { state: "failed"; reason: string };

export interface RemoteAttachRequest {
  deviceId: string;
  /** Carried because upstream's `openRemoteSession` takes it for the pane's own
   * banner — the peer's NAME, not its id, is what a person recognizes. */
  deviceName: string;
  /** The session's id ON THE PEER. It is not an id in this device's floor. */
  remoteSessionId: string;
}

/**
 * What an attach actually did, in the vocabulary the stage says out loud.
 *
 * `no-pane` is a real outcome and not an error: a deck with every pane closed
 * has nowhere to put a session, and the honest answer is to say so rather than
 * to open a pane the user did not ask for (GT-D10 — the workspace owns births).
 * `view-only` is likewise not a failure: it is the peer's own write verdict
 * arriving as a fact (`session.readWrite`, the mesh runtime's flag), and the
 * session IS attached. This line named "the mirror-write law" until TM-3 deleted
 * VibeField's mirror-write capability (2026-09-14); no renderer code ever
 * supplied that key, so the outcome is unchanged and only the name was wrong.
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
