import {
  AGENT_FIELD,
  AgentFieldDelta,
  type AgentFieldRow,
  AgentFieldSnapshot,
  type AgentMeshDevice,
  type AgentMeshFrame,
  type AgentMeshOpen,
  CONTRACTS_VERSION,
  type DeviceInfo,
  type RowsDeviceState,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";

// DS-3 — THE MESH BOARD (`thinking-desktop-sync-plane.md` §6.2, DS-D4 RULED
// 2026-09-30; design-04 §6 as amended the same day). `agent.subscribe {scope:
// "mesh"}` answers every self desktop's agents through this daemon, so a window
// and a phone hold ONE door and never merge anything themselves (DS-L4).
//
// The daemon MULTIPLEXES, it does not re-fold. Each desktop's board arrives on
// its own upstream — this very door on the peer, `agent.subscribe {projection,
// minIntervalMs, heartbeatMs}` at the peer's own `local` scope — and each of its
// frames is relayed as `{device, delta}` or `{device, snapshot}` VERBATIM: the
// peer's epoch, the peer's revisions, the peer's rows. Nothing is renumbered and
// nothing waits behind a second coalescing stage; the only cadence floor is the
// reader's own, asked of the peer on the reader's behalf.
//
// What this file adds is only what a relay has to hold:
//   · each device's LAST board, so a reader who arrives later is answered in the
//     open without asking the owner again, and so a desktop that falls asleep
//     keeps its board with every reader (DS-L8 — it sends the state change,
//     never an empty board);
//   · each device's STATE, derived here from three facts — the roster's
//     `online`, PeerLink's incompatible pin (and the contracts major the roster
//     says the peer runs), and when the peer's stream was last heard. The
//     upstream asks for a heartbeat (`AGENT_FIELD.MESH_HEARTBEAT_MS`) because a
//     board is silent while nothing moves: without one an idle desktop and a
//     dead stream would look alike. `live` = heard within `MESH_STALE_BEATS`
//     beats · `stale` = online and unheard beyond that · `asleep` = the roster
//     says offline · `incompatible` = the link pin refused, another contracts
//     major, or the peer's door refused the board (a fieldd older than DS-3).
//     DS-2's roster `state` (`awake | restarting | asleep`, lane ds-b) replaces
//     the `online` reading here when both land; the stream-liveness half stays.
//
// Upstreams are the existing federated subscriptions (C6-5, `federated-subs.ts`):
// one per awake desktop per {projection, floor}, reference-counted there AND
// here — a hub per {projection, floor} opens them when its first reader arrives
// and closes them when its last one leaves (PF6), and the manager shares them
// with any window that routed the same question by `device`.
//
// WHICH peers are desktops: the roster lists phones too (a phone is a self node
// with no fieldd behind it) and cannot say so directly — a phone publishes no
// device slice. The board takes DS-D7's own test, `capabilities.docHost`, which
// only a desktop's slice carries; a peer without its slice yet joins the board
// the moment the roster change that brings it lands. Phones get no dials.

const METHOD = "agent.subscribe";

export type BoardProjection = "field" | "desk";

/** The roster as DeviceService serves it (structural: this file never imports
 * the service). */
export interface MeshBoardRoster {
  list(): DeviceInfo[];
  on(event: "changed", listener: () => void): unknown;
  off(event: "changed", listener: () => void): unknown;
}

/** PeerLink's verdict about each link (structural, like the roster). */
export interface MeshBoardLinks {
  linkState(deviceId: string): "connected" | "dialing" | "incompatible" | undefined;
  on(event: "link-changed", listener: () => void): unknown;
  off(event: "link-changed", listener: () => void): unknown;
}

/** The federated subscription manager's attach (C6-5). */
export interface MeshBoardUpstreams {
  attach(
    device: string,
    method: string,
    params: unknown,
    emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

/** This device's own board at one projection and floor, stamped with its
 * chain's epoch; later deltas arrive through the `emit` it was opened with. */
export interface LocalBoard {
  snapshot: { epoch: string; revision: number; rows: AgentFieldRow[] };
  dispose(): void;
}

export interface MeshBoardOptions {
  selfDevice: () => string;
  roster: MeshBoardRoster;
  links: MeshBoardLinks;
  upstreams: MeshBoardUpstreams;
  openLocal: (
    projection: BoardProjection,
    minIntervalMs: number,
    emit: (delta: AgentFieldDelta) => void,
  ) => LocalBoard;
  now?: () => number;
  /** test seams; the registry's values by default */
  heartbeatMs?: number;
  staleBeats?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  logger?: Logger;
}

interface Resolved {
  selfDevice: () => string;
  roster: MeshBoardRoster;
  links: MeshBoardLinks;
  upstreams: MeshBoardUpstreams;
  openLocal: MeshBoardOptions["openLocal"];
  now: () => number;
  heartbeatMs: number;
  staleBeats: number;
  retryMinMs: number;
  retryMaxMs: number;
  logger: Logger;
}

/** A board as the relay holds it: the owner's chain, the owner's rows. */
interface HeldBoard {
  epoch: string;
  revision: number;
  rows: Map<string, AgentFieldRow>;
}

interface Peer {
  device: string;
  /** null until the first reconcile has placed it */
  state: RowsDeviceState | null;
  /** ms — when `state` was established */
  asOf: number;
  board: HeldBoard | null;
  /** ms — the last frame (a heartbeat counts); 0 = never in this hub's life */
  lastHeard: number;
  upstream: { dispose: () => void } | null;
  /** bumped by every attach and detach: a callback from an older one is inert */
  generation: number;
  attaching: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
  /** the roster facts the peer's door REFUSED the board under (an older
   * fieldd, a wall) — `incompatible` until those facts move (a restart, an
   * upgrade), never a dial loop against a door that will keep saying no */
  refusedUnder: string | null;
  inRoster: boolean;
}

const majorOf = (version: string): string => version.split(".")[0] ?? version;
const OUR_MAJOR = majorOf(CONTRACTS_VERSION);

/** The roster facts a refusal is remembered under: a peer that restarts (a new
 * boot) or upgrades is asked again. */
const refusalKey = (row: DeviceInfo): string =>
  [row.bootId ?? "", row.contractsVersion ?? "", row.fielddVersion ?? ""].join("|");

/** DS-D7's desktop test, applied to the board: only a desktop's slice says
 * `docHost`, and a phone publishes none. */
const isDesktopPeer = (row: DeviceInfo, self: string): boolean =>
  !row.self && row.deviceId !== self && row.capabilities?.docHost === true;

const iso = (ms: number): string => new Date(ms).toISOString();

function held(snapshot: { epoch: string; revision: number; rows: AgentFieldRow[] }): HeldBoard {
  return {
    epoch: snapshot.epoch,
    revision: snapshot.revision,
    rows: new Map(snapshot.rows.map((row) => [row.runtimeRunId, row])),
  };
}

function snapshotOf(board: HeldBoard): { epoch: string; revision: number; rows: AgentFieldRow[] } {
  return { epoch: board.epoch, revision: board.revision, rows: [...board.rows.values()] };
}

/** Upserts, then removals, then the owner's revision: the owner's delta
 * applied to the relay's copy, exactly as a reader applies it to its own. */
function apply(board: HeldBoard, delta: AgentFieldDelta): void {
  for (const row of delta.upserts) board.rows.set(row.runtimeRunId, row);
  for (const id of delta.removed) board.rows.delete(id);
  board.revision = delta.revision;
}

/** An empty delta whose `since` is its `revision`: the owner's heartbeat. */
const isHeartbeat = (delta: AgentFieldDelta): boolean =>
  delta.upserts.length === 0 && delta.removed.length === 0 && delta.since === delta.revision;

/** Refusals that are the peer's DOOR speaking — asking again changes nothing
 * until the peer itself changes. Everything else (unreachable, timed out, no
 * endpoint yet) is transport, and is retried. */
const REFUSALS = new Set(["INCOMPATIBLE", "FORBIDDEN_SCOPE", "PRECONDITION_FAILED", "NOT_FOUND"]);

type Member = (frame: AgentMeshFrame) => void;

/** Each desktop's LAST board at one projection, beyond any one hub's life
 * (DS-L8): a reader who arrives after the last one left — Godview reopened
 * while a laptop sleeps — is still answered with that desktop's board, greyed
 * by its state, never with an absence. Held by `MeshBoard`; a hub writes
 * through on every change and seeds a desktop it has not met from here. */
interface KeptBoards {
  get(device: string): HeldBoard | undefined;
  set(device: string, board: HeldBoard): void;
}

const copyOf = (board: HeldBoard): HeldBoard => ({
  epoch: board.epoch,
  revision: board.revision,
  rows: new Map(board.rows),
});

/** One board per {projection, floor}: the readers that asked the same
 * question share its upstreams and its held boards. */
class BoardHub {
  readonly #members = new Set<Member>();
  readonly #peers = new Map<string, Peer>();
  readonly #self: { device: string; asOf: number; board: HeldBoard };
  readonly #local: LocalBoard;
  readonly #sweeper: ReturnType<typeof setInterval>;
  readonly #onRoster = (): void => this.#reconcile();
  #disposed = false;

  constructor(
    private readonly opts: Resolved,
    private readonly projection: BoardProjection,
    private readonly floor: number,
    private readonly kept: KeptBoards,
    private readonly onClosed: () => void,
  ) {
    const device = opts.selfDevice();
    // This desktop's own board, on its own chain; it is always `live` (the
    // daemon answering IS its liveness) and needs no heartbeat.
    this.#local = opts.openLocal(projection, floor, (delta) => this.#onLocal(delta));
    this.#self = { device, asOf: opts.now(), board: held(this.#local.snapshot) };
    opts.roster.on("changed", this.#onRoster);
    opts.links.on("link-changed", this.#onRoster);
    this.#sweeper = setInterval(() => this.#sweep(), opts.heartbeatMs);
    this.#sweeper.unref?.();
    this.#reconcile();
  }

  /** A reader joins: it is answered with every device as the hub holds it,
   * and hears every later frame. */
  join(member: Member): { open: AgentMeshOpen; dispose: () => void } {
    const open = this.#openAnswer();
    this.#members.add(member);
    let left = false;
    return {
      open,
      dispose: () => {
        if (left) return;
        left = true;
        this.#members.delete(member);
        if (this.#members.size === 0) this.dispose();
      },
    };
  }

  /** The last reader left (or the daemon stops): every upstream closes. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearInterval(this.#sweeper);
    this.opts.roster.off("changed", this.#onRoster);
    this.opts.links.off("link-changed", this.#onRoster);
    for (const peer of this.#peers.values()) this.#detach(peer);
    this.#members.clear();
    try {
      this.#local.dispose();
    } finally {
      this.onClosed();
    }
  }

  // ---- the answer and the relay ----

  #openAnswer(): AgentMeshOpen {
    const devices: AgentMeshDevice[] = [
      {
        device: this.#self.device,
        state: "live",
        asOf: iso(this.#self.asOf),
        snapshot: snapshotOf(this.#self.board),
      },
    ];
    for (const peer of this.#peers.values()) {
      if (peer.state === null) continue;
      devices.push({
        device: peer.device,
        state: peer.state,
        asOf: iso(peer.asOf),
        ...(peer.board !== null ? { snapshot: snapshotOf(peer.board) } : {}),
      });
    }
    return { devices };
  }

  #broadcast(frame: AgentMeshFrame): void {
    for (const member of this.#members) {
      try {
        member(frame);
      } catch (error) {
        // a reader's failure is its own — the fan-out completes
        this.opts.logger.warn("fieldd.mesh_board.emit_failed", "A mesh board reader's emit threw", {
          error: String(error),
        });
      }
    }
  }

  #onLocal(delta: AgentFieldDelta): void {
    if (this.#disposed || isHeartbeat(delta)) return;
    const board = this.#self.board;
    apply(board, delta);
    this.#broadcast({ device: this.#self.device, delta: { ...delta, epoch: board.epoch } });
  }

  // ---- the device set ----

  /** Roster or link moved: place every desktop peer, attach the awake ones. */
  #reconcile(): void {
    if (this.#disposed) return;
    const self = this.opts.selfDevice();
    const seen = new Set<string>();
    for (const row of this.opts.roster.list()) {
      if (!isDesktopPeer(row, self)) continue;
      seen.add(row.deviceId);
      let peer = this.#peers.get(row.deviceId);
      if (peer === undefined) {
        // DS-L8 — the last board this daemon held for it, if any: shown with
        // the desktop's state until its own board answers afresh
        const kept = this.kept.get(row.deviceId);
        peer = {
          device: row.deviceId,
          state: null,
          asOf: this.opts.now(),
          board: kept === undefined ? null : copyOf(kept),
          lastHeard: 0,
          upstream: null,
          generation: 0,
          attaching: false,
          retry: null,
          backoffMs: this.opts.retryMinMs,
          refusedUnder: null,
          inRoster: true,
        };
        this.#peers.set(row.deviceId, peer);
      }
      peer.inRoster = true;
      const key = refusalKey(row);
      if (peer.refusedUnder !== null && peer.refusedUnder !== key) {
        peer.refusedUnder = null;
        peer.backoffMs = this.opts.retryMinMs;
      }
      const incompatible =
        this.opts.links.linkState(row.deviceId) === "incompatible" ||
        (row.contractsVersion !== undefined && majorOf(row.contractsVersion) !== OUR_MAJOR) ||
        peer.refusedUnder !== null;
      if (incompatible) {
        // DS-L9 — another major is not asked
        this.#close(peer);
        this.#setState(peer, "incompatible");
        continue;
      }
      if (!row.online) {
        // DS-L8 — asleep is a state: the board stays, the upstream closes
        this.#close(peer);
        const now = this.opts.now();
        const lastSeen = row.lastSeenAt > 0 && row.lastSeenAt <= now ? row.lastSeenAt : now;
        this.#setState(peer, "asleep", lastSeen);
        continue;
      }
      if (peer.upstream === null && !peer.attaching && peer.retry === null) this.#attach(peer);
      this.#setState(peer, this.#heard(peer) ? "live" : "stale");
    }
    // A desktop that left the roster keeps its last board, asleep; the
    // archive (DS-D17's thirty days) is where a board finally goes.
    for (const peer of this.#peers.values()) {
      if (seen.has(peer.device) || !peer.inRoster) continue;
      peer.inRoster = false;
      this.#close(peer);
      this.#setState(peer, "asleep");
    }
  }

  #heard(peer: Peer): boolean {
    return (
      peer.lastHeard > 0 &&
      this.opts.now() - peer.lastHeard <= this.opts.staleBeats * this.opts.heartbeatMs
    );
  }

  /** The clock half of liveness: a live peer that has missed its beats reads
   * stale. Nothing else here moves on a timer. */
  #sweep(): void {
    if (this.#disposed) return;
    for (const peer of this.#peers.values()) {
      if (peer.state === "live" && !this.#heard(peer)) this.#setState(peer, "stale");
    }
  }

  #setState(peer: Peer, state: RowsDeviceState, asOf?: number): void {
    if (peer.state === state) return;
    peer.state = state;
    peer.asOf = asOf ?? this.opts.now();
    this.#broadcast({ device: peer.device, state, asOf: iso(peer.asOf) });
  }

  // ---- upstreams ----

  #attach(peer: Peer): void {
    const generation = ++peer.generation;
    peer.attaching = true;
    const params = {
      projection: this.projection,
      minIntervalMs: this.floor,
      heartbeatMs: this.opts.heartbeatMs,
    };
    this.opts.upstreams
      .attach(peer.device, METHOD, params, (payload, kind) =>
        this.#onUpstream(peer, generation, payload, kind ?? "delta"),
      )
      .then(
        ({ snapshot, dispose }) => {
          if (this.#disposed || generation !== peer.generation) {
            dispose();
            return;
          }
          peer.attaching = false;
          peer.upstream = { dispose };
          peer.backoffMs = this.opts.retryMinMs;
          this.#onUpstream(peer, generation, snapshot, "snapshot");
        },
        (error: unknown) => {
          if (this.#disposed || generation !== peer.generation) return;
          peer.attaching = false;
          this.#failed(peer, error);
        },
      );
  }

  #failed(peer: Peer, error: unknown): void {
    const kind = error instanceof RpcCallError ? error.kind : undefined;
    if (kind !== undefined && REFUSALS.has(kind)) {
      this.#refuse(peer, `${kind}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.opts.logger.info(
      "fieldd.mesh_board.upstream_unavailable",
      "A desktop's board could not be asked; retrying",
      {
        device: peer.device,
        delayMs: peer.backoffMs,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    this.#scheduleRetry(peer);
  }

  /** The peer's door said no, or said something no reader could hold: the
   * board says `incompatible` and asks again only when the peer changes. */
  #refuse(peer: Peer, reason: string): void {
    const row = this.opts.roster.list().find((entry) => entry.deviceId === peer.device);
    peer.refusedUnder = row === undefined ? "" : refusalKey(row);
    this.#close(peer);
    this.opts.logger.warn(
      "fieldd.mesh_board.upstream_refused",
      "A desktop's door refused the mesh board; it reads incompatible until it changes",
      { device: peer.device, reason },
    );
    this.#setState(peer, "incompatible");
  }

  #scheduleRetry(peer: Peer): void {
    if (peer.retry !== null || this.#disposed) return;
    const delay = peer.backoffMs;
    peer.backoffMs = Math.min(peer.backoffMs * 2, this.opts.retryMaxMs);
    peer.retry = setTimeout(() => {
      peer.retry = null;
      this.#reconcile(); // attaches again only if the peer is still an awake desktop
    }, delay);
    peer.retry.unref?.();
  }

  #detach(peer: Peer): void {
    peer.generation += 1;
    peer.attaching = false;
    if (peer.retry !== null) {
      clearTimeout(peer.retry);
      peer.retry = null;
    }
    const upstream = peer.upstream;
    peer.upstream = null;
    upstream?.dispose();
  }

  /** The stream is OVER (asleep, incompatible, gone from the roster): the
   * upstream closes and its liveness is forgotten, so a desktop that comes
   * back reads `stale` until its own board answers — never `live` on the
   * strength of a beat heard before it slept. The board itself is kept. A
   * resync is not this: it re-asks a stream that was just heard. */
  #close(peer: Peer): void {
    this.#detach(peer);
    peer.lastHeard = 0;
  }

  /** A copy that cannot follow the owner's chain is REPLACED, never repaired
   * (DS-L3): the upstream is dropped and asked again, and the owner's fresh
   * snapshot reaches every reader as that device's reset. */
  #resync(peer: Peer, why: string): void {
    this.opts.logger.info(
      "fieldd.mesh_board.resync",
      "A desktop's board left its chain; asking it again",
      { device: peer.device, why },
    );
    this.#detach(peer);
    this.#scheduleRetry(peer);
  }

  #onUpstream(peer: Peer, generation: number, payload: unknown, kind: "snapshot" | "delta"): void {
    if (this.#disposed || generation !== peer.generation) return;
    const now = this.opts.now();
    if (kind === "snapshot") {
      const parsed = AgentFieldSnapshot.safeParse(payload);
      if (!parsed.success) {
        this.#refuse(peer, `an unreadable board: ${parsed.error.issues[0]?.message ?? "invalid"}`);
        return;
      }
      const epoch = parsed.data.epoch;
      if (epoch === undefined) {
        // a board with no chain (a fieldd older than DS-3): nothing a reader
        // could follow, and an epoch invented here would be a renumbering
        this.#refuse(peer, "a board with no epoch");
        return;
      }
      const snapshot = { ...parsed.data, epoch };
      peer.board = held(snapshot);
      this.kept.set(peer.device, peer.board);
      peer.lastHeard = now;
      this.#broadcast({ device: peer.device, snapshot });
      this.#setState(peer, "live");
      return;
    }
    const parsed = AgentFieldDelta.safeParse(payload);
    if (!parsed.success) {
      this.#resync(peer, `an unreadable delta: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      return;
    }
    const delta = parsed.data;
    const board = peer.board;
    if (board === null || delta.epoch !== board.epoch || delta.since !== board.revision) {
      this.#resync(
        peer,
        board === null
          ? "a delta before any board"
          : `held ${board.epoch}@${board.revision}, got ${delta.epoch ?? "no epoch"}@${delta.since}`,
      );
      return;
    }
    peer.lastHeard = now;
    if (!isHeartbeat(delta)) {
      apply(board, delta);
      this.kept.set(peer.device, board);
      this.#broadcast({ device: peer.device, delta: { ...delta, epoch: board.epoch } });
    }
    this.#setState(peer, "live");
  }
}

/**
 * The mesh board's hubs, one per {projection, floor}. A hub exists exactly
 * while it has a reader: the first `open` builds it and opens its upstreams,
 * the last reader's dispose closes them.
 */
export class MeshBoard {
  readonly #opts: Resolved;
  readonly #hubs = new Map<string, BoardHub>();
  /** each desktop's last board, by projection (`KeptBoards`) */
  readonly #kept = new Map<BoardProjection, Map<string, HeldBoard>>();
  #disposed = false;

  constructor(opts: MeshBoardOptions) {
    this.#opts = {
      selfDevice: opts.selfDevice,
      roster: opts.roster,
      links: opts.links,
      upstreams: opts.upstreams,
      openLocal: opts.openLocal,
      now: opts.now ?? Date.now,
      heartbeatMs: opts.heartbeatMs ?? AGENT_FIELD.MESH_HEARTBEAT_MS,
      staleBeats: opts.staleBeats ?? AGENT_FIELD.MESH_STALE_BEATS,
      retryMinMs: opts.retryMinMs ?? 1_000,
      retryMaxMs: opts.retryMaxMs ?? 30_000,
      logger: (opts.logger ?? createNoopLogger()).child({ component: "mesh.board" }),
    };
  }

  /** One reader of the mesh board at a projection and floor. */
  open(
    projection: BoardProjection,
    minIntervalMs: number,
    emit: (frame: AgentMeshFrame) => void,
  ): { open: AgentMeshOpen; dispose: () => void } {
    if (this.#disposed) throw new RpcCallError("UNAVAILABLE", "the mesh board is stopping", true);
    const key = `${projection}|${minIntervalMs}`;
    let hub = this.#hubs.get(key);
    if (hub === undefined) {
      let boards = this.#kept.get(projection);
      if (boards === undefined) {
        boards = new Map();
        this.#kept.set(projection, boards);
      }
      const kept = boards;
      const keeper: KeptBoards = {
        get: (device) => kept.get(device),
        set: (device, board) => {
          kept.set(device, board);
        },
      };
      const created: BoardHub = new BoardHub(this.#opts, projection, minIntervalMs, keeper, () => {
        if (this.#hubs.get(key) === created) this.#hubs.delete(key);
      });
      hub = created;
      this.#hubs.set(key, hub);
    }
    return hub.join(emit);
  }

  /** How many hubs are standing — each one is a set of open upstreams. */
  get size(): number {
    return this.#hubs.size;
  }

  dispose(): void {
    this.#disposed = true;
    for (const hub of [...this.#hubs.values()]) hub.dispose();
    this.#hubs.clear();
  }
}
