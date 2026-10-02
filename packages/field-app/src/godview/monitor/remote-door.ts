import type { AccountUsagePort, HistoryPort } from "@vibecook/puppeteer-views";
import type {
  AgentMeshFrame,
  AgentMeshOpen,
  AgentProfileSet,
  AgentRunHistory,
  DeviceInfo,
} from "@vibefield/contracts";
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
 * shell is born under — a set id, a noun of fieldd's, never a binding. DS-3 is
 * the fourth: the mesh board replaced GT-D17's host poll (`listHosts`, retired
 * 2026-09-30 — under the routed runtime it threw on every ask), and the roster
 * came in beside it, so a row can say which desktop it lives on.
 */
export interface MonitorDoor {
  /**
   * DS-3 — THE MESH BOARD (`agent.subscribe {projection: "desk", scope:
   * "mesh"}`, DS-D4): every self desktop's agents through this window's ONE
   * door, multiplexed by its own fieldd (DS-L4 — the window merges nothing).
   * `onOpen` receives every WHOLE board — the open answer, and the client's
   * own re-snapshot after a reconnect — and the reader REPLACES what it held;
   * `onFrame` every per-device frame (a delta, a device's reset, a device's
   * state); `onError` why the board could not be opened, why the client's
   * replay of it was refused, or that a frame could not be read — said with
   * whether asking again may be answered (`MeshBoardFailure`, S4 2026-10-01).
   * Returns the dispose.
   */
  observeMesh(listener: MeshBoardListener): () => void;
  /** DS-3 — the roster (`device.subscribe`): names and platforms, so a row
   * can say which desktop it lives on. Optional, and deliberately: a door
   * without it names each desktop by its id and draws no OS. */
  devices?: DevicesPort;
  /** Open the peer's session and mount it in the ACTIVE pane. Unreachable
   * from the mesh board's rows until DS-4 lands the terminal path across
   * desktops (every remote row says `attachable: false` until then); the
   * verb stays for that slice to rewire. */
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
  /** TL (TL-D8) — fieldd's status ledger (`agent.history`): what each run did
   * over the last day, for the timeline. Optional: a door without it (or a
   * fieldd that predates the door) leaves the timeline drawing what this
   * window watched. */
  statusHistory?: StatusHistoryPort;
}

/** TL — one ask of `agent.history`, read run by run: a run that does not parse
 * is dropped and the rest stand. Absent ids ask for every run in the horizon. */
export interface StatusHistoryPort {
  load(runtimeRunIds?: readonly string[]): Promise<readonly AgentRunHistory[]>;
}

/** AR-S5 — the Agent Profiles as whole snapshots at fieldd's tick. Returns the
 * dispose; a frame the reader cannot parse is dropped, and the tabs keep the
 * last one they drew. */
export interface ProfileSetsPort {
  subscribe(listener: (sets: readonly AgentProfileSet[]) => void): () => void;
}

/** DS-3 — the mesh board's listener (`MonitorDoor.observeMesh`). */
export interface MeshBoardListener {
  onOpen(open: AgentMeshOpen): void;
  onFrame(frame: AgentMeshFrame): void;
  onError(failure: MeshBoardFailure): void;
}

/** S4 (2026-10-01) — why the mesh board could not be read, structured: the
 * reader decides from what fieldd SAID, never from its words. */
export interface MeshBoardFailure {
  /** fieldd's own words, or the door's for a board or frame it could not read */
  reason: string;
  /** asking again may be answered: fieldd's refusal said so (the board not
   * ready yet), or the ask was never answered (the socket dropped while it was
   * in flight). The reader keeps the honest `unavailable` and asks again on
   * its backoff. False for a refusal no second ask can change. */
  retryable: boolean;
  /** the board was standing and one of its FRAMES could not be read: the
   * reader's copy cannot follow it — a gap, which re-opens */
  frame?: true;
}

/** DS-3 — the roster as whole lists, the door's own parse applied. Returns
 * the dispose; an unreadable list is dropped and the last one stands. */
export interface DevicesPort {
  subscribe(listener: (devices: readonly DeviceInfo[]) => void): () => void;
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

/**
 * A monitor row id for another desktop's run, keyed `{device, runtimeRunId}`
 * as the mesh board keys it (DS-L2: a row's key says who owns it).
 *
 * Prefixed and device-qualified because the monitor's ids are a flat namespace
 * shared with local rows: two desktops can each have a run with one id, and
 * one of them can collide with ours. The prefix also makes a remote id
 * recognizable in a marker line, which is how the smoke tells the two apart.
 */
export function remoteRowId(deviceId: string, runtimeRunId: string): string {
  return `remote:${deviceId}:${runtimeRunId}`;
}

// RETIRED 2026-09-30 (DS-3): `RemoteHostIdentity`, `RemoteSessionRow` and
// `remoteSessionRows` — GT-D17's mesh half, which flattened ghosttea's
// `runtime.listRemoteHosts()` into rows every two seconds. Under the routed
// runtime that ask THREW ("Remote-host discovery is not part of the routed
// host contract"), so the half had been dark since TP-S3e; the mesh board
// (`mesh-field.ts`) is what a desktop reads another desktop's agents from now.
