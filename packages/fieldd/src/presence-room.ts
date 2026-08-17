import { MESHDATA_LOSSY_MAX_LOGICAL_BYTES } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { DocumentPresenceRoomHandle, DocumentPresenceRooms } from "./doc-lane";
import type { LaneInfo, SyncPeer } from "./doc-sync";

/** Lifecycle plane for document-scoped lossy presence lanes. */
export interface PresenceLaneControl {
  open(req: {
    laneId: number;
    class: "lossy";
    peer: string;
    protocol: "presence";
    docId: string;
  }): Promise<void>;
  close(laneId: number): Promise<void>;
  subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[] }>;
}

/** Byte plane. `flush` is the ordered bridge fence before management close. */
export interface PresenceLaneBytes {
  send(laneId: number, payload: Uint8Array): boolean;
  flush(laneId: number): Promise<void>;
  onLane(laneId: number, handler: (payload: Uint8Array) => void): void;
  offLane(laneId: number): void;
}

export interface PresenceRoomRouterOptions {
  control: PresenceLaneControl;
  bytes: PresenceLaneBytes;
  peers: () => Promise<SyncPeer[]>;
  allocateLaneId: () => number;
  logger?: Logger;
  maxLogicalBytes?: number;
}

interface OutboundLane {
  laneId: number;
  peer: string;
}

interface InboundLane {
  laneId: number;
  peer: string;
  room: Room;
}

interface Room {
  readonly docId: string;
  readonly generation: number;
  readonly sink: (payload: Uint8Array) => void;
  readonly outbound: Map<string, OutboundLane>;
  readonly inbound: Map<string, InboundLane>;
  latest: Uint8Array | null;
  revision: number;
  deliveredRevision: number;
  pump: Promise<void> | null;
  closeTask: Promise<void> | null;
  closing: boolean;
}

/**
 * One bounded local presence room per authenticated document connection.
 *
 * The router never parses ICE bytes and never persists them. A burst replaces
 * one retained `latest` snapshot; one serial pump owns all asynchronous lane
 * opens, which prevents N publishes from creating N lanes. Every inverse is
 * identity-bound to a concrete Room/Lane record so a late close cannot erase a
 * successor generation.
 */
export class PresenceRoomRouter implements DocumentPresenceRooms {
  readonly #control: PresenceLaneControl;
  readonly #bytes: PresenceLaneBytes;
  readonly #peers: () => Promise<SyncPeer[]>;
  readonly #allocateLaneId: () => number;
  readonly #logger: Logger;
  readonly #maxLogicalBytes: number;
  readonly #rooms = new Map<string, Room>();
  readonly #outboundByLane = new Map<number, { room: Room; lane: OutboundLane }>();
  readonly #inboundByLane = new Map<number, InboundLane>();
  #generation = 0;
  #started = false;

  constructor(opts: PresenceRoomRouterOptions) {
    this.#control = opts.control;
    this.#bytes = opts.bytes;
    this.#peers = opts.peers;
    this.#allocateLaneId = opts.allocateLaneId;
    this.#maxLogicalBytes = opts.maxLogicalBytes ?? MESHDATA_LOSSY_MAX_LOGICAL_BYTES;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "presence.room" });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const { lanes } = await this.#control.subscribe((payload, kind) => {
      if (this.#started) this.#onLaneEvent(payload, kind);
    });
    for (const lane of lanes ?? []) this.#claim(lane);
  }

  attach(docId: string, sink: (payload: Uint8Array) => void): DocumentPresenceRoomHandle {
    if (!this.#started) throw new Error("presence room router is not started");
    const previous = this.#rooms.get(docId);
    const room: Room = {
      docId,
      generation: ++this.#generation,
      sink,
      outbound: new Map(),
      inbound: new Map(),
      latest: null,
      revision: 0,
      deliveredRevision: 0,
      pump: null,
      closeTask: null,
      closing: false,
    };
    this.#rooms.set(docId, room);
    if (previous !== undefined) void this.#closeRoom(previous);

    let closed = false;
    return {
      publish: (payload) => {
        if (closed || !this.#isCurrent(room)) return;
        this.#publish(room, payload);
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await this.#closeRoom(room);
      },
    };
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    await Promise.all([...this.#rooms.values()].map((room) => this.#closeRoom(room)));
    for (const lane of this.#inboundByLane.values()) this.#bytes.offLane(lane.laneId);
    this.#rooms.clear();
    this.#outboundByLane.clear();
    this.#inboundByLane.clear();
  }

  /** A count-only diagnostic used by lifecycle tests and health inspection. */
  state(): { rooms: number; outbound: number; inbound: number; retainedBytes: number } {
    let retainedBytes = 0;
    for (const room of this.#rooms.values()) retainedBytes += room.latest?.byteLength ?? 0;
    return {
      rooms: this.#rooms.size,
      outbound: this.#outboundByLane.size,
      inbound: this.#inboundByLane.size,
      retainedBytes,
    };
  }

  #isCurrent(room: Room): boolean {
    return !room.closing && this.#rooms.get(room.docId) === room;
  }

  #publish(room: Room, payload: Uint8Array): void {
    if (payload.byteLength > this.#maxLogicalBytes) {
      this.#logger.warn(
        "fieldd.presence.snapshot_oversize",
        "A presence snapshot exceeded the bounded room budget and was dropped",
        { docId: room.docId, bytes: payload.byteLength, cap: this.#maxLogicalBytes },
      );
      return;
    }
    room.latest = payload.slice();
    room.revision += 1;
    this.#schedule(room);
  }

  #schedule(room: Room): void {
    if (room.pump !== null || !this.#isCurrent(room)) return;
    room.pump = this.#pump(room)
      .catch((error) => {
        this.#logger.warn(
          "fieldd.presence.room_pump_failed",
          "A document presence fanout pass failed",
          { docId: room.docId, error: String(error) },
        );
      })
      .finally(() => {
        room.pump = null;
        if (this.#isCurrent(room) && room.revision > room.deliveredRevision) {
          this.#schedule(room);
        }
      });
  }

  async #pump(room: Room): Promise<void> {
    while (this.#isCurrent(room) && room.latest !== null) {
      let peers: SyncPeer[];
      try {
        peers = await this.#peers();
      } catch (error) {
        this.#logger.info(
          "fieldd.presence.peers_unavailable",
          "Presence fanout could not read the current peer roster",
          { docId: room.docId, error: String(error) },
        );
        room.deliveredRevision = room.revision;
        return;
      }
      if (!this.#isCurrent(room)) return;
      const online = new Set(peers.filter((peer) => peer.online).map((peer) => peer.id));
      for (const [peer, lane] of [...room.outbound]) {
        if (!online.has(peer)) void this.#retireOutbound(room, lane, false);
      }
      for (const peer of online) await this.#ensureOutbound(room, peer);
      if (!this.#isCurrent(room) || room.latest === null) return;

      // Read AFTER all slow opens: every publish during the waits has replaced
      // the one retained snapshot, so only the newest one is sent.
      const payload = room.latest;
      const revision = room.revision;
      for (const lane of [...room.outbound.values()]) {
        try {
          this.#bytes.send(lane.laneId, payload);
        } catch (error) {
          this.#logger.info(
            "fieldd.presence.send_failed",
            "A lossy presence lane refused its latest snapshot",
            { docId: room.docId, peer: lane.peer, laneId: lane.laneId, error: String(error) },
          );
          void this.#retireOutbound(room, lane, false);
        }
      }
      room.deliveredRevision = revision;
      if (room.revision === revision) return;
    }
  }

  async #ensureOutbound(room: Room, peer: string): Promise<void> {
    if (!this.#isCurrent(room) || room.outbound.has(peer)) return;
    let laneId: number;
    try {
      laneId = this.#allocateLaneId();
      await this.#control.open({
        laneId,
        class: "lossy",
        peer,
        protocol: "presence",
        docId: room.docId,
      });
    } catch (error) {
      this.#logger.info(
        "fieldd.presence.lane_open_failed",
        "No presence lane was available for a peer",
        { docId: room.docId, peer, error: String(error) },
      );
      return;
    }
    if (!this.#isCurrent(room) || room.outbound.has(peer)) {
      await this.#control.close(laneId).catch(() => undefined);
      return;
    }
    const lane = { laneId, peer };
    room.outbound.set(peer, lane);
    this.#outboundByLane.set(laneId, { room, lane });
  }

  async #retireOutbound(room: Room, lane: OutboundLane, graceful: boolean): Promise<void> {
    if (room.outbound.get(lane.peer) === lane) room.outbound.delete(lane.peer);
    const reverse = this.#outboundByLane.get(lane.laneId);
    if (reverse?.room === room && reverse.lane === lane) this.#outboundByLane.delete(lane.laneId);
    if (graceful) {
      await this.#bytes.flush(lane.laneId).catch((error) => {
        this.#logger.info(
          "fieldd.presence.barrier_failed",
          "Presence close is falling back to peer TTL after its byte-plane fence failed",
          { docId: room.docId, peer: lane.peer, laneId: lane.laneId, error: String(error) },
        );
      });
    }
    await this.#control.close(lane.laneId).catch((error) => {
      this.#logger.info(
        "fieldd.presence.lane_close_failed",
        "A presence lane close was not acknowledged",
        { docId: room.docId, peer: lane.peer, laneId: lane.laneId, error: String(error) },
      );
    });
  }

  #closeRoom(room: Room): Promise<void> {
    room.closeTask ??= this.#doCloseRoom(room);
    return room.closeTask;
  }

  async #doCloseRoom(room: Room): Promise<void> {
    // On the ordinary authenticated-socket close, let the last ICE leave
    // snapshot finish its already-scheduled fanout BEFORE making the room
    // ineligible. This is the handoff the byte-plane barrier then fences.
    if (this.#rooms.get(room.docId) === room) {
      if (room.latest !== null && room.revision > room.deliveredRevision) this.#schedule(room);
      await room.pump;
    }
    room.closing = true;
    if (this.#rooms.get(room.docId) === room) this.#rooms.delete(room.docId);
    await room.pump;
    await Promise.all(
      [...room.outbound.values()].map((lane) => this.#retireOutbound(room, lane, true)),
    );
    await Promise.all(
      [...room.inbound.values()].map(async (lane) => {
        this.#forgetInbound(lane);
        await this.#control.close(lane.laneId).catch(() => undefined);
      }),
    );
    room.latest = null;
  }

  #onLaneEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (kind === "snapshot") {
      const lanes = (payload as { lanes?: LaneInfo[] } | undefined)?.lanes ?? [];
      const live = new Set(lanes.map((lane) => lane.laneId));
      for (const laneId of [...this.#inboundByLane.keys()]) {
        if (!live.has(laneId)) this.#forgetLane(laneId);
      }
      for (const laneId of [...this.#outboundByLane.keys()]) {
        if (!live.has(laneId)) this.#forgetLane(laneId);
      }
      for (const lane of lanes) this.#claim(lane);
      return;
    }
    const event = payload as (LaneInfo & { kind?: string }) | undefined;
    if (event?.kind === "peerOpened") this.#claim(event);
    else if (event?.kind === "closed") this.#forgetLane(event.laneId);
  }

  #claim(lane: LaneInfo): void {
    if (lane.inbound !== true || lane.protocol !== "presence" || lane.class !== "lossy") return;
    if (lane.docId === undefined) {
      void this.#control.close(lane.laneId).catch(() => undefined);
      return;
    }
    const room = this.#rooms.get(lane.docId);
    if (room === undefined || room.closing) {
      void this.#control.close(lane.laneId).catch(() => undefined);
      return;
    }
    const existing = room.inbound.get(lane.peer);
    if (existing?.laneId === lane.laneId) return;
    if (existing !== undefined) {
      this.#forgetInbound(existing);
      void this.#control.close(existing.laneId).catch(() => undefined);
    }
    const record: InboundLane = { laneId: lane.laneId, peer: lane.peer, room };
    room.inbound.set(lane.peer, record);
    this.#inboundByLane.set(lane.laneId, record);
    this.#bytes.onLane(lane.laneId, (payload) => {
      if (this.#inboundByLane.get(lane.laneId) !== record || !this.#isCurrent(room)) return;
      if (payload.byteLength > this.#maxLogicalBytes) return;
      try {
        room.sink(payload.slice());
      } catch (error) {
        this.#logger.warn(
          "fieldd.presence.local_sink_failed",
          "A renderer refused an inbound presence snapshot",
          { docId: room.docId, peer: lane.peer, laneId: lane.laneId, error: String(error) },
        );
      }
    });
  }

  #forgetLane(laneId: number): void {
    const inbound = this.#inboundByLane.get(laneId);
    if (inbound !== undefined) this.#forgetInbound(inbound);
    const outbound = this.#outboundByLane.get(laneId);
    if (outbound !== undefined) {
      if (outbound.room.outbound.get(outbound.lane.peer) === outbound.lane) {
        outbound.room.outbound.delete(outbound.lane.peer);
      }
      this.#outboundByLane.delete(laneId);
    }
  }

  #forgetInbound(lane: InboundLane): void {
    if (this.#inboundByLane.get(lane.laneId) !== lane) return;
    this.#inboundByLane.delete(lane.laneId);
    if (lane.room.inbound.get(lane.peer) === lane) lane.room.inbound.delete(lane.peer);
    this.#bytes.offLane(lane.laneId);
  }
}
