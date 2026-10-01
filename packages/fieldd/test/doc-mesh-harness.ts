// The in-process mesh router the doc-sync convergence suites share (extracted
// from doc-sync-convergence.test.ts for DS-5, 2026-09-30 — unchanged in what it
// does, plus two knobs: DocSyncService options per device, and the DS-5
// frame reader so VERSION and CHUNK records cross it).
//
// It plays the part field-native plays: an inbound lane id minted on the far
// side (the 2^32 split), an announcement on the control plane, and a byte plane
// that preserves record boundaries. It does NOT prove the wire — that is
// field-native's quic_lane_transport.rs, at its own seam.
import { decodeDocSyncFrame, MESHDATA_INBOUND_LANE_ID_BASE } from "@vibefield/contracts";
import { DocumentService } from "../src/doc-service";
import {
  type DocSyncOptions,
  DocSyncService,
  type LaneBytes,
  type LaneControl,
  type LaneInfo,
} from "../src/doc-sync";

/** One device's end of the plane. */
export class Device {
  readonly docs: DocumentService;
  readonly sync: DocSyncService;
  readonly bytes: RoutedBytes;
  readonly control: RoutedControl;

  constructor(
    readonly name: string,
    mesh: Mesh,
    dataDir: string,
    /** DS-5 — extra DocSyncService options (the chunking knobs). */
    syncOptions: Partial<DocSyncOptions> = {},
  ) {
    this.bytes = new RoutedBytes(name, mesh);
    this.control = new RoutedControl(name, mesh);
    let sync: DocSyncService | undefined;
    this.docs = new DocumentService({ dataDir, onCommit: (c) => sync?.onCommit(c) });
    let nextLaneId = 1;
    sync = new DocSyncService({
      docs: this.docs,
      control: this.control,
      bytes: this.bytes,
      allocateLaneId: () => nextLaneId++,
      peers: async () => mesh.peersOf(name),
      ...syncOptions,
    });
    this.sync = sync;
  }
}

/** The part field-native plays: lane ids minted on the receiving side out of
 * the reserved half, an announcement on the control plane, and a byte plane
 * that preserves record boundaries. */
export class Mesh {
  readonly devices = new Map<string, Device>();
  /** Every record that crossed, so a test can ask what the protocol COST. */
  readonly carried: { from: string; kind: number; bytes: number }[] = [];
  /** sender's laneId → receiver's inbound laneId */
  readonly #routes = new Map<string, number>();
  /** The lane TABLE, which lives in field-native and outlives fieldd — so a
   * restarted fieldd re-reads it from the subscribe snapshot rather than
   * losing every lane a peer opened while it was away (the two-plane law). */
  readonly inbound = new Map<string, LaneInfo[]>();
  #nextInbound = MESHDATA_INBOUND_LANE_ID_BASE;

  peersOf(name: string): { id: string; online: boolean }[] {
    // Everyone this router knows is reachable — liveness honesty is the
    // service test's subject; convergence assumes a healthy mesh.
    return [...this.devices.keys()].filter((n) => n !== name).map((id) => ({ id, online: true }));
  }

  open(from: string, to: string, laneId: number, docId: string | undefined): void {
    const target = this.devices.get(to);
    if (target === undefined) throw new Error(`no such peer: ${to}`);
    const inboundId = this.#nextInbound++;
    this.#routes.set(`${from}:${laneId}`, inboundId);
    const lane: LaneInfo = {
      laneId: inboundId,
      peer: from,
      protocol: "doc-sync",
      ...(docId !== undefined ? { docId } : {}),
      inbound: true,
    };
    this.inbound.set(to, [...(this.inbound.get(to) ?? []), lane]);
    target.control.announce({ kind: "peerOpened", ...lane });
  }

  carry(from: string, to: string, laneId: number, payload: Uint8Array): void {
    const inboundId = this.#routes.get(`${from}:${laneId}`);
    const target = this.devices.get(to);
    if (inboundId === undefined || target === undefined) return;
    const record = decodeDocSyncFrame(payload); // DS-5: every kind, VERSION and CHUNK included
    this.carried.push({ from, kind: record.kind, bytes: payload.byteLength });
    // A copy, because the far side is a different device: sharing a buffer
    // across the seam would let one device's storage alias another's.
    target.bytes.deliver(inboundId, payload.slice());
  }
}

export class RoutedControl implements LaneControl {
  #emit: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;
  /** laneId → peer, so the byte plane knows where a send is bound. */
  readonly routes = new Map<number, string>();

  constructor(
    private readonly self: string,
    private readonly mesh: Mesh,
  ) {}

  async open(req: {
    laneId: number;
    class: "reliable";
    peer: string;
    protocol: "doc-sync";
    docId?: string;
  }): Promise<void> {
    this.routes.set(req.laneId, req.peer);
    this.mesh.open(this.self, req.peer, req.laneId, req.docId);
  }
  async close(laneId: number): Promise<void> {
    this.routes.delete(laneId);
  }
  async subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[] }> {
    this.#emit = onEvent;
    return { lanes: this.mesh.inbound.get(this.self) ?? [] };
  }
  announce(payload: unknown): void {
    this.#emit?.(payload, "delta");
  }
}

export class RoutedBytes implements LaneBytes {
  readonly #handlers = new Map<number, (payload: Uint8Array) => void>();
  /** Bytes that arrived on a lane before its consumer attached `onLane`. The
   * real meshdata plane buffers these in the socket/pipe — dropping them made
   * convergence order-dependent: under concurrent opens (both devices editing
   * at once) a byte could land before the receiver subscribed and vanish, which
   * mac's scheduling happened to avoid and Windows' did not. Buffering is truer
   * to the wire AND makes the test deterministic on any timing. */
  readonly #pending = new Map<number, Uint8Array[]>();

  constructor(
    private readonly self: string,
    private readonly mesh: Mesh,
  ) {}

  send(laneId: number, payload: Uint8Array): boolean {
    const device = this.mesh.devices.get(this.self);
    const peer = device?.control.routes.get(laneId);
    if (peer !== undefined) this.mesh.carry(this.self, peer, laneId, payload);
    return true;
  }
  onLane(laneId: number, handler: (payload: Uint8Array) => void): void {
    this.#handlers.set(laneId, handler);
    const queued = this.#pending.get(laneId);
    if (queued !== undefined) {
      this.#pending.delete(laneId);
      for (const payload of queued) handler(payload);
    }
  }
  offLane(laneId: number): void {
    this.#handlers.delete(laneId);
  }
  deliver(laneId: number, payload: Uint8Array): void {
    const handler = this.#handlers.get(laneId);
    if (handler !== undefined) {
      handler(payload);
      return;
    }
    const queued = this.#pending.get(laneId);
    if (queued === undefined) this.#pending.set(laneId, [payload]);
    else queued.push(payload);
  }
}
