import {
  DRIVE_LIMITS,
  MeshLaneClosed,
  MeshLaneOpenRequest,
  MeshLanePeerOpened,
  RPC_ERROR_CODES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { LaneInfo } from "../doc-sync";
import { DEFAULT_SEND_MAX_BUFFERED_BYTES } from "../mesh-lane";
import { RpcCallError } from "../native-link";

// DR-3b (W3, VF-RELAY) — the drive's lane relay: mille-drive's sync records between two desktops of the account, on a
// `drive` meshdata lane (contracts mgmt.ts `MeshLaneProtocol`; DR-D7 (a)). OPAQUE: fieldd reads no record (DR-L4
// narrows EL2 to an object's bytes, which never come here), so a record is bytes in and the same bytes out.
//
//  - One RELIABLE lane per peer and direction, with no docId (an account has one drive): each direction is one
//    ordered stream. Every lane id is drawn from the boot's ONE allocator (lane-id.ts:3-10; daemon.ts:1563),
//    injected and never minted here, so the drive's ids never collide with doc-sync's or presence's (the W3
//    critic's finding 7; the floor refuses a duplicate lane id PRECONDITION_FAILED).
//  - Inbound only from this account's peers (`isSelfPeer`, UA-P-0f): a foreign or lossy `drive` lane is closed, the
//    shape of "no" doc-sync gives (doc-sync.ts:835-852). Another protocol's lane is its own service's.
//  - A record is at most DRIVE_LIMITS.LANE_RECORD_BYTES: a larger one is refused outbound and dropped inbound with a
//    warn, because mille-drive bounds an inbound frame only at its own update bound.
//  - Each peer's records wait in one queue that paces under MeshLaneLink's send watermark (mesh-lane.ts:66-69), as
//    doc-sync's sends do (doc-sync.ts:1775-1784). Past the queue's bound a record is dropped with a warn;
//    mille-drive's next Hello recovers what a drop loses.
//
// No mille import (R24): the port is VibeField's own (service.ts), and the files worker adapts it at DR-2.

/** Lane LIFECYCLE for the drive's lanes, over the mgmt channel: its own, with `drive` admitted, because doc-sync's
 * `LaneControl` pins `doc-sync` (doc-sync.ts:92-104) and the daemon's closure `doc-sync | presence`
 * (daemon.ts:1564-1583). */
export interface DriveLaneControl {
  open(req: { laneId: number; class: "reliable"; peer: string; protocol: "drive" }): Promise<void>;
  close(laneId: number): Promise<void>;
  /** Snapshot-then-delta over `native.mesh.lane.subscribe`. `dispose` lets NativeLink's entry go, so a reconnect no
   * longer replays it; it tells the floor nothing (native-link.ts `removeSubscription`). */
  subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[]; dispose: () => void }>;
}

/** The byte plane, as MeshLaneLink offers it (mesh-lane.ts:175, :231, :244, :254). One `send` is one record. */
export interface DriveLaneBytes {
  send(laneId: number, payload: Uint8Array): boolean;
  onLane(laneId: number, handler: (payload: Uint8Array) => void): void;
  offLane(laneId: number): void;
  /** bytes queued toward the bridge: the watermark's live reading. Absent: no pacing. */
  readonly bufferedBytes?: number;
}

export interface DriveLaneRelayOptions {
  control: DriveLaneControl;
  bytes: DriveLaneBytes;
  /** The boot's one `OutboundLaneIdAllocator.allocate` (lane-id.ts), shared with every other lane fieldd opens. */
  allocateLaneId: () => number;
  /** Is this `PeerInfo.id` one of this account's (DeviceService's self-peer set)? Asked of every inbound lane. */
  isSelfPeer: (peer: string) => boolean;
  logger?: Logger;
  /** The send watermark (default MeshLaneLink's, DEFAULT_SEND_MAX_BUFFERED_BYTES). */
  sendWatermarkBytes?: number;
  /** The most bytes one peer's queue holds before a record is dropped (default the same 4 MiB: the same amount of
   * unmoved data is the same amount of trouble, mesh-lane.ts:66-68). */
  maxQueuedBytes?: number;
}

/** One record waiting for its peer's lane. */
interface Queued {
  readonly record: Uint8Array;
  readonly done: (sent: boolean) => void;
  readonly fail: (error: unknown) => void;
}

/** One peer's outbound lane and its queue. */
interface PeerLane {
  readonly peer: string;
  laneId: number | null;
  readonly queue: Queued[];
  queuedBytes: number;
  pumping: boolean;
}

/** How long a send waits for the socket to drain before its peer's queue is dropped, and how often it looks. */
const PACE_DEADLINE_MS = 30_000;
const PACE_POLL_MS = 10;

export class DriveLaneRelay {
  readonly #opts: DriveLaneRelayOptions;
  readonly #log: Logger;
  readonly #watermark: number;
  readonly #maxQueued: number;
  /** peer → its outbound lane */
  readonly #outbound = new Map<string, PeerLane>();
  /** outbound laneId → peer */
  readonly #outboundIds = new Map<number, string>();
  /** inbound laneId → peer */
  readonly #inbound = new Map<number, string>();
  /** the peers a drive lane is open with, either way */
  readonly #up = new Set<string>();
  readonly #frameListeners = new Set<(peer: string, record: Uint8Array) => void>();
  readonly #peerListeners = new Set<(peer: string, up: boolean) => void>();
  /** lets the lane table's subscription go: set while one stands */
  #release: (() => void) | null = null;
  /** the subscribe in flight: one at a time, and answered it replaces `#release`'s entry and lets that one go
   * (`#arm`), so one entry stands once it ends */
  #arming: Promise<void> | null = null;
  #stopped = false;

  constructor(opts: DriveLaneRelayOptions) {
    this.#opts = opts;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "drive.lanes" });
    this.#watermark = opts.sendWatermarkBytes ?? DEFAULT_SEND_MAX_BUFFERED_BYTES;
    this.#maxQueued = opts.maxQueuedBytes ?? DEFAULT_SEND_MAX_BUFFERED_BYTES;
  }

  /** Subscribe to lane lifecycle and claim the `drive` lanes already open: field-native outlives fieldd, so a lane a
   * peer opened before this boot is the normal case. */
  start(): Promise<void> {
    return this.#subscribe(false);
  }

  /** The node came up (MeshClient's "node-up", `DriveService.nodeUp`): a `start` the floor refused is armed now, so a
   * link that never reconnects still hears the lane table. The table is the floor's bridge's, not the node's
   * (field-native `mgmt/mesh.rs`: `lane.subscribe` is answered ahead of the node gate), so a stream that stands is
   * kept and one in flight is shared. Never throws: a subscribe refused here is logged, and the next node-up or
   * reconnect asks again. */
  async nodeUp(): Promise<void> {
    await this.#subscribe(false).catch((error: unknown) => this.#unheard(error));
  }

  /** The mgmt link reconnected (NativeLink's "connected"): the lane table is subscribed anew. NativeLink's replay may
   * have been refused or read TIMEOUT (native-link.ts `replaySubscriptions`), which leaves its entry with no route and
   * this side untold: no lane opens or closes here until the next reconnect. So, once a subscribe in flight has ended,
   * ONE subscribe is made on the new connection, as `DrivePulls.connected` does, and its snapshot re-derives every
   * lane (`#resync`). The stream that stood is let go only once that one is answered (`#arm`), so a subscribe refused
   * here leaves the lane table heard as it was, the live table when the replay ran. A `start` the floor refused is
   * armed the same way. The cost: a stream let go keeps its forwarder writing to the connection until it closes, every
   * lane event of every protocol on the floor's one bridge (field-native `mgmt/mesh.rs`, `spawn_lane_forwarder`), and
   * fieldd drops those lines. At most one stays per answered re-subscribe, because `native.mesh.lane.subscribe` adds
   * one per call. Never throws: a subscribe refused here is logged, and the next reconnect asks again. */
  async connected(): Promise<void> {
    await this.#arming?.catch(() => undefined);
    await this.#subscribe(true).catch((error: unknown) => this.#unheard(error));
  }

  /** Send one opaque record to `peer`. Resolves `true` once it is on the byte plane, `false` when it was dropped (its
   * peer's queue past its bound, a socket that did not drain, or the relay stopped). Rejects a record over
   * DRIVE_LIMITS.LANE_RECORD_BYTES, and with the floor's refusal when the lane cannot open. */
  send(peer: string, record: Uint8Array): Promise<boolean> {
    if (record.byteLength > DRIVE_LIMITS.LANE_RECORD_BYTES) {
      const message = `a drive record is at most ${DRIVE_LIMITS.LANE_RECORD_BYTES} bytes`;
      const refusal = new RpcCallError(
        "PRECONDITION_FAILED",
        message,
        false,
        undefined,
        RPC_ERROR_CODES.PRECONDITION_FAILED,
      );
      return Promise.reject(refusal);
    }
    if (this.#stopped) return Promise.resolve(false);
    const lane = this.#laneFor(peer);
    if (lane.queuedBytes + record.byteLength > this.#maxQueued) {
      this.#log.warn("fieldd.drive.lane_queue_full", "A drive record was dropped: queue full", {
        peer,
        queuedBytes: lane.queuedBytes,
        droppedBytes: record.byteLength,
      });
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve, reject) => {
      lane.queue.push({ record, done: resolve, fail: reject });
      lane.queuedBytes += record.byteLength;
      void this.#pump(lane);
    });
  }

  /** Every record a peer sent, in its order. Returns a detach. */
  onFrame(listener: (peer: string, record: Uint8Array) => void): () => void {
    this.#frameListeners.add(listener);
    return () => {
      this.#frameListeners.delete(listener);
    };
  }

  /** A peer's first drive lane opened (`up`), or its last one closed. Returns a detach. */
  onPeer(listener: (peer: string, up: boolean) => void): () => void {
    this.#peerListeners.add(listener);
    return () => {
      this.#peerListeners.delete(listener);
    };
  }

  /** Close this relay's own lanes, let the lane table's subscription go and drop its routing; an inbound lane is
   * field-native's to reap. A record still queued is dropped. */
  async dispose(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#release?.();
    this.#release = null;
    for (const laneId of this.#inbound.keys()) this.#opts.bytes.offLane(laneId);
    this.#inbound.clear();
    const closing: Promise<void>[] = [];
    for (const lane of this.#outbound.values()) {
      this.#drop(lane);
      if (lane.laneId !== null) {
        closing.push(this.#opts.control.close(lane.laneId).catch(() => undefined));
      }
      lane.laneId = null;
    }
    this.#outbound.clear();
    this.#outboundIds.clear();
    this.#up.clear();
    this.#frameListeners.clear();
    this.#peerListeners.clear();
    await Promise.all(closing);
  }

  /** One subscribe at a time, shared by a caller while it is in flight. While a stream stands, only a renewal makes
   * one (`connected`), and a `start` returns at once. */
  #subscribe(renew: boolean): Promise<void> {
    if (this.#stopped || (this.#release !== null && !renew)) return Promise.resolve();
    if (this.#arming === null) {
      this.#arming = this.#arm().finally(() => {
        this.#arming = null;
      });
    }
    return this.#arming;
  }

  /** The subscribe itself. Answered, the new stream replaces the one that stood, which is let go only then; refused,
   * that one stays and still hears. A relay disposed during its flight lets the answer go and claims nothing, as
   * `dispose` let the one that stood go. */
  async #arm(): Promise<void> {
    const { lanes, dispose } = await this.#opts.control.subscribe((payload, kind) =>
      this.#onLaneEvent(payload, kind),
    );
    if (this.#stopped) {
      dispose();
      return;
    }
    this.#release?.();
    this.#release = dispose;
    this.#resync(lanes ?? []);
  }

  #unheard(error: unknown): void {
    this.#log.warn("fieldd.drive.lanes_unheard", "The drive's lane table was not heard", {
      error: String(error),
    });
  }

  #laneFor(peer: string): PeerLane {
    let lane = this.#outbound.get(peer);
    if (lane === undefined) {
      lane = { peer, laneId: null, queue: [], queuedBytes: 0, pumping: false };
      this.#outbound.set(peer, lane);
    }
    return lane;
  }

  /** One pump per peer: open the lane once, then send in order, each under the watermark. */
  async #pump(lane: PeerLane): Promise<void> {
    if (lane.pumping) return;
    lane.pumping = true;
    try {
      while (lane.queue.length > 0 && !this.#stopped) {
        if (lane.laneId === null && !(await this.#open(lane))) return;
        const head = lane.queue[0];
        if (head === undefined) return;
        if (!(await this.#roomFor(head.record.byteLength))) {
          if (this.#stopped) return;
          this.#log.warn("fieldd.drive.lane_not_draining", "The byte socket did not drain", {
            peer: lane.peer,
            droppedRecords: lane.queue.length,
          });
          this.#drop(lane);
          return;
        }
        const laneId = lane.laneId;
        // the lane closed while this send waited: the next turn opens another
        if (laneId === null) continue;
        lane.queue.shift();
        lane.queuedBytes -= head.record.byteLength;
        try {
          this.#opts.bytes.send(laneId, head.record);
          head.done(true);
        } catch (error) {
          this.#log.warn("fieldd.drive.lane_send_failed", "A drive record could not be sent", {
            peer: lane.peer,
            error: String(error),
          });
          head.done(false);
        }
      }
    } finally {
      lane.pumping = false;
    }
  }

  /** Open a lane to `lane`'s peer. False when no id could be drawn (the allocator's space is spent, lane-id.ts:20-24)
   * or the floor refused: every record queued for it is refused with that error, never left pending. */
  async #open(lane: PeerLane): Promise<boolean> {
    let laneId: number;
    try {
      laneId = this.#opts.allocateLaneId();
      await this.#opts.control.open({
        laneId,
        class: "reliable",
        peer: lane.peer,
        protocol: "drive",
      });
    } catch (error) {
      for (const queued of lane.queue.splice(0)) queued.fail(error);
      lane.queuedBytes = 0;
      return false;
    }
    if (this.#stopped) {
      void this.#opts.control.close(laneId).catch(() => undefined);
      return false;
    }
    lane.laneId = laneId;
    this.#outboundIds.set(laneId, lane.peer);
    this.#noteUp(lane.peer);
    return true;
  }

  async #roomFor(bytes: number): Promise<boolean> {
    const deadline = Date.now() + PACE_DEADLINE_MS;
    for (;;) {
      if (this.#stopped) return false;
      const queued = this.#opts.bytes.bufferedBytes ?? 0;
      if (queued === 0 || queued + bytes <= this.#watermark) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, PACE_POLL_MS));
    }
  }

  #drop(lane: PeerLane): void {
    for (const queued of lane.queue.splice(0)) queued.done(false);
    lane.queuedBytes = 0;
  }

  #onLaneEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (this.#stopped) return;
    if (kind === "snapshot") {
      const lanes = (payload as { lanes?: unknown } | undefined)?.lanes;
      this.#resync(Array.isArray(lanes) ? lanes : []);
      return;
    }
    const event = (payload as { kind?: unknown } | undefined)?.kind;
    if (event === "peerOpened") {
      const opened = MeshLanePeerOpened.safeParse(payload);
      if (opened.success) this.#claim(opened.data);
      return;
    }
    if (event === "closed") {
      const closed = MeshLaneClosed.safeParse(payload);
      if (closed.success) this.#forget(closed.data.laneId);
    }
  }

  /** The lane table is the truth (P5): an outbound lane it no longer lists is gone, and the inbound lanes are
   * re-derived from it rather than patched, as doc-sync's are (doc-sync.ts `#onLaneEvent`). A floor's inbound ids
   * restart at its boot (field-native `mesh_bridge.rs`), so a listed id may name another peer's lane, and every row
   * meets the account gate again. A peer goes down only after every row is claimed, so one still listed never flaps. */
  #resync(rows: readonly unknown[]): void {
    const outbound = new Set<number>();
    const inbound: MeshLanePeerOpened[] = [];
    for (const row of rows) {
      const opened = MeshLanePeerOpened.safeParse(row);
      if (opened.success) {
        inbound.push(opened.data);
        continue;
      }
      const lane = MeshLaneOpenRequest.safeParse(row);
      if (lane.success) outbound.add(lane.data.laneId);
    }
    const heard = new Set(this.#inbound.values());
    for (const laneId of this.#inbound.keys()) this.#opts.bytes.offLane(laneId);
    this.#inbound.clear();
    for (const lane of inbound) this.#claim(lane);
    for (const laneId of [...this.#outboundIds.keys()]) {
      if (!outbound.has(laneId)) this.#forget(laneId);
    }
    for (const peer of heard) this.#noteMaybeDown(peer);
  }

  #claim(lane: MeshLanePeerOpened): void {
    if (lane.protocol !== "drive" || this.#inbound.has(lane.laneId)) return;
    // UA-P-0f — the account gate, first: a lane names the peer the tailnet says dialled, never a claim
    if (!this.#opts.isSelfPeer(lane.peer)) {
      this.#refuse(lane, "fieldd.drive.lane_refused_foreign_account");
      return;
    }
    // a lossy lane drops and reorders, and mille-drive's records are one ordered stream
    if (lane.class !== "reliable") {
      this.#refuse(lane, "fieldd.drive.lane_refused_lossy");
      return;
    }
    this.#inbound.set(lane.laneId, lane.peer);
    this.#opts.bytes.onLane(lane.laneId, (record) => this.#receive(lane.peer, record));
    this.#noteUp(lane.peer);
  }

  #refuse(lane: MeshLanePeerOpened, event: string): void {
    this.#log.warn(event, "A drive lane was refused", { laneId: lane.laneId, peer: lane.peer });
    void this.#opts.control.close(lane.laneId).catch(() => undefined);
  }

  #receive(peer: string, record: Uint8Array): void {
    if (record.byteLength > DRIVE_LIMITS.LANE_RECORD_BYTES) {
      this.#log.warn("fieldd.drive.lane_record_dropped", "An inbound drive record was too large", {
        peer,
        bytes: record.byteLength,
      });
      return;
    }
    for (const listener of [...this.#frameListeners]) {
      try {
        listener(peer, record);
      } catch (error) {
        this.#log.warn("fieldd.drive.frame_listener_failed", "A drive record's reader threw", {
          peer,
          error: String(error),
        });
      }
    }
  }

  #forget(laneId: number): void {
    const inbound = this.#inbound.get(laneId);
    if (inbound !== undefined) {
      this.#inbound.delete(laneId);
      this.#opts.bytes.offLane(laneId);
      this.#noteMaybeDown(inbound);
      return;
    }
    const peer = this.#outboundIds.get(laneId);
    if (peer === undefined) return;
    this.#outboundIds.delete(laneId);
    const lane = this.#outbound.get(peer);
    if (lane !== undefined && lane.laneId === laneId) lane.laneId = null;
    this.#noteMaybeDown(peer);
  }

  #noteUp(peer: string): void {
    if (this.#up.has(peer)) return;
    this.#up.add(peer);
    this.#emitPeer(peer, true);
  }

  #noteMaybeDown(peer: string): void {
    if (!this.#up.has(peer)) return;
    const outbound = this.#outbound.get(peer)?.laneId;
    if (outbound !== undefined && outbound !== null) return;
    for (const other of this.#inbound.values()) if (other === peer) return;
    this.#up.delete(peer);
    this.#emitPeer(peer, false);
  }

  /** Each listener hears it, one that throws included: a throw here would stop `#resync` claiming the lanes after it,
   * or leave a queued record unsettled (`#open`). */
  #emitPeer(peer: string, up: boolean): void {
    for (const listener of [...this.#peerListeners]) {
      try {
        listener(peer, up);
      } catch (error) {
        this.#log.warn("fieldd.drive.peer_listener_failed", "A drive peer's listener threw", {
          peer,
          up,
          error: String(error),
        });
      }
    }
  }
}
