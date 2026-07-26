import {
  DOC_SYNC_RECORD,
  decodeDocSyncRecord,
  encodeDocSyncRecord,
  MESHDATA_INBOUND_LANE_ID_BASE,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { DocCommit, DocumentService } from "./doc-service";

// DocSyncService (C6-3g) — the thing that makes an edit on one device appear on
// another. It is WIRING, deliberately: every hard question was settled below it
// (does a re-framed record converge? does the epoch fence hold?) or beside it
// (does a lane carry bytes across a real tailnet?). What is left is routing.
//
// Its dependencies are two narrow interfaces rather than NativeLink and
// MeshLaneLink directly, because the interesting behaviour here — who gets
// told what, and what must never be echoed — is provable against fakes on
// every commit, while the transports underneath need a tailnet.
//
// SHAPE:
//   · lane per (doc, peer), opened lazily — the first time we have something
//     for that peer, not eagerly for every doc × peer pair at boot;
//   · on lane open, the whole current state goes out (checkpoint + journal),
//     because we cannot know what the peer already has. Correct, and honestly
//     wasteful — see the finding in thinking-c6 §8;
//   · thereafter, each local commit is broadcast to that doc's open lanes;
//   · a record that came FROM a peer is never re-broadcast. Two devices echoing
//     each other converges instantly and then never stops, which on a graph
//     looks exactly like a busy network rather than like a bug.

/** Lane LIFECYCLE, over the mgmt channel. Bytes never come through here (D5). */
export interface LaneControl {
  open(req: {
    laneId: number;
    class: "reliable";
    peer: string;
    protocol: "doc-sync";
    docId?: string;
  }): Promise<void>;
  close(laneId: number): Promise<void>;
  /** Snapshot-then-delta over `native.mesh.lane.subscribe`. */
  subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[] }>;
}

/** The byte plane. One `send` is one record — boundaries are preserved beneath. */
export interface LaneBytes {
  send(laneId: number, payload: Uint8Array): boolean;
  onLane(laneId: number, handler: (payload: Uint8Array) => void): void;
  offLane(laneId: number): void;
}

export interface LaneInfo {
  laneId: number;
  peer: string;
  protocol: string;
  docId?: string;
  inbound?: boolean;
}

export interface DocSyncOptions {
  docs: DocumentService;
  control: LaneControl;
  bytes: LaneBytes;
  /** Peers to sync toward — `PeerInfo.id`, the same string `lane.open` takes. */
  peers: () => Promise<string[]>;
  logger?: Logger;
}

/** Why a doc is or is not in step with its peers. `pending` is the one that
 * would otherwise be invisible: a record whose causal dependencies have not
 * arrived applies to nothing and shows nothing, and EL5 forbids calling that
 * converged. C6-4 renders these. */
export type DocSyncState = "idle" | "syncing" | "peer-declined" | "epoch-stale";

export class DocSyncService {
  readonly #docs: DocumentService;
  readonly #control: LaneControl;
  readonly #bytes: LaneBytes;
  readonly #peers: () => Promise<string[]>;
  readonly #logger: Logger;

  /** docId → peer → laneId, for lanes WE opened. */
  readonly #outbound = new Map<string, Map<string, number>>();
  /** laneId → docId, for lanes a peer opened toward us. */
  readonly #inbound = new Map<number, string>();
  /** Per-doc serialisation: opening a lane is async and a commit is not, so
   * without this a burst of saves races several opens for one peer. */
  readonly #work = new Map<string, Promise<void>>();
  readonly #state = new Map<string, DocSyncState>();

  #nextLaneId = 1;
  #started = false;

  constructor(opts: DocSyncOptions) {
    this.#docs = opts.docs;
    this.#control = opts.control;
    this.#bytes = opts.bytes;
    this.#peers = opts.peers;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "doc.sync" });
  }

  /** Subscribe to lane lifecycle and claim whatever is already open.
   *
   * Claiming from the SNAPSHOT matters as much as from the deltas: fieldd can
   * restart while field-native keeps running (the two-plane law), so lanes a
   * peer opened before we existed are the normal case, not a corner one. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const { lanes } = await this.#control.subscribe((payload, kind) =>
      this.#onLaneEvent(payload, kind),
    );
    for (const lane of lanes ?? []) this.#claim(lane);
  }

  /** DocumentService's commit hook. Sync is a CONSUMER of durability: this
   * never throws into the write path, because a sync fault must not be able to
   * turn a committed revision into a failed one. */
  onCommit(commit: DocCommit): void {
    if (commit.origin === "peer") return; // never echo a peer's own record back
    this.#enqueue(commit.docId, () => this.#broadcast(commit));
  }

  syncState(docId: string): DocSyncState {
    return this.#state.get(docId) ?? "idle";
  }

  /** Lanes are field-native's to reap when fieldd goes away; this only drops
   * our routing so a restarted service does not deliver into dead handlers. */
  stop(): void {
    for (const laneId of this.#inbound.keys()) this.#bytes.offLane(laneId);
    this.#inbound.clear();
    this.#outbound.clear();
    this.#started = false;
  }

  // ---- inbound ----

  #onLaneEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (kind === "snapshot") {
      // A re-snapshot means we may have missed events entirely (a broadcast
      // lag, or a reconnect). Re-derive rather than patch: the lane table is
      // the truth and these events are only how it is learned promptly.
      for (const laneId of this.#inbound.keys()) this.#bytes.offLane(laneId);
      this.#inbound.clear();
      const lanes = (payload as { lanes?: LaneInfo[] } | undefined)?.lanes ?? [];
      for (const lane of lanes) this.#claim(lane);
      return;
    }
    const event = payload as (LaneInfo & { kind?: string; reason?: string }) | undefined;
    if (event === undefined) return;
    if (event.kind === "peerOpened") {
      this.#claim(event);
      return;
    }
    if (event.kind === "closed") this.#forget(event.laneId);
  }

  #claim(lane: LaneInfo): void {
    if (lane.inbound !== true || lane.protocol !== "doc-sync") return;
    const docId = lane.docId;
    if (docId === undefined) {
      // A doc-sync lane that names no doc has nowhere to deliver. Refusing it
      // beats guessing, and it is the peer's bug to fix.
      this.#logger.warn(
        "fieldd.doc_sync.lane_without_doc",
        "A peer opened a doc-sync lane that named no document",
        { laneId: lane.laneId, peer: lane.peer },
      );
      return;
    }
    this.#inbound.set(lane.laneId, docId);
    // Registering the handler REPLAYS anything that arrived before the
    // announcement — the ordering hazard MeshLaneLink's orphan buffer exists
    // for, and the reason the first record of every inbound lane is not the
    // one that goes missing.
    this.#bytes.onLane(lane.laneId, (record) => void this.#receive(docId, record, lane.peer));
    this.#logger.info("fieldd.doc_sync.lane_claimed", "An inbound doc-sync lane was claimed", {
      laneId: lane.laneId,
      docId,
      peer: lane.peer,
    });
  }

  #forget(laneId: number): void {
    if (this.#inbound.delete(laneId)) this.#bytes.offLane(laneId);
    for (const [docId, byPeer] of this.#outbound) {
      for (const [peer, id] of byPeer) {
        if (id !== laneId) continue;
        byPeer.delete(peer);
        if (byPeer.size === 0) this.#outbound.delete(docId);
      }
    }
  }

  async #receive(docId: string, record: Uint8Array, peer: string): Promise<void> {
    let decoded: ReturnType<typeof decodeDocSyncRecord>;
    try {
      decoded = decodeDocSyncRecord(record);
    } catch (error) {
      // One malformed record is one record. The lane survives — a peer running
      // a newer build should degrade, not disconnect.
      this.#logger.warn("fieldd.doc_sync.record_undecodable", "A peer's record could not be read", {
        docId,
        peer,
        error: String(error),
      });
      return;
    }
    try {
      const outcome = await this.#docs.applyRemoteRecord(docId, decoded);
      if (outcome.applied) {
        this.#state.set(docId, "idle");
        return;
      }
      // A decline is sync STATE, not an error — it is exactly what EL5 says
      // must not be silent.
      this.#state.set(docId, outcome.reason === "epoch-mismatch" ? "epoch-stale" : "peer-declined");
      this.#logger.warn("fieldd.doc_sync.record_declined", "A peer's record was not applied", {
        docId,
        peer,
        reason: outcome.reason,
      });
    } catch (error) {
      this.#logger.error("fieldd.doc_sync.apply_failed", "Applying a peer's record failed", error);
    }
  }

  // ---- outbound ----

  #enqueue(docId: string, job: () => Promise<void>): void {
    const prior = this.#work.get(docId) ?? Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(job)
      .catch((error) => {
        this.#logger.error(
          "fieldd.doc_sync.broadcast_failed",
          "A doc-sync broadcast failed",
          error,
        );
      });
    this.#work.set(docId, next);
    void next.finally(() => {
      if (this.#work.get(docId) === next) this.#work.delete(docId);
    });
  }

  async #broadcast(commit: DocCommit): Promise<void> {
    const peers = await this.#peers();
    if (peers.length === 0) return;
    this.#state.set(commit.docId, "syncing");
    for (const peer of peers) {
      const existing = this.#outbound.get(commit.docId)?.get(peer);
      if (existing !== undefined) {
        this.#send(existing, commit.kind === "checkpoint" ? "snapshot" : "update", commit);
        continue;
      }
      // A NEW lane has to carry the whole state, not just this commit: the peer
      // may have none of the history this record depends on, and a record whose
      // dependencies never arrive is held pending forever — present in the
      // journal, absent from the document, and invisible either way.
      const laneId = await this.#openLane(commit.docId, peer);
      if (laneId !== null) await this.#sendFullState(commit.docId, laneId);
    }
    // Return to idle ONLY if nothing reported a problem while this was in
    // flight. Sending is not evidence that receiving went well, and clearing a
    // peer-declined or epoch-stale state because our own outbound half finished
    // is precisely the silent-divergence EL5 forbids — the doc would read
    // "in step" while holding records it cannot apply.
    if (this.#state.get(commit.docId) === "syncing") this.#state.set(commit.docId, "idle");
  }

  async #openLane(docId: string, peer: string): Promise<number | null> {
    const laneId = this.#mintLaneId();
    try {
      await this.#control.open({ laneId, class: "reliable", peer, protocol: "doc-sync", docId });
    } catch (error) {
      // Mesh down, peer unreachable, node not up — all ordinary. The next
      // commit retries; nothing is queued waiting for this peer, because a
      // queue that outlives the reason for it is how memory disappears.
      this.#logger.info("fieldd.doc_sync.lane_open_failed", "No doc-sync lane to a peer", {
        docId,
        peer,
        error: String(error),
      });
      return null;
    }
    let byPeer = this.#outbound.get(docId);
    if (byPeer === undefined) {
      byPeer = new Map();
      this.#outbound.set(docId, byPeer);
    }
    byPeer.set(peer, laneId);
    return laneId;
  }

  /** fieldd's half of the id space, and it must stay there — field-native
   * refuses an id from the inbound half at the door. */
  #mintLaneId(): number {
    if (this.#nextLaneId >= MESHDATA_INBOUND_LANE_ID_BASE) this.#nextLaneId = 1;
    return this.#nextLaneId++;
  }

  async #sendFullState(docId: string, laneId: number): Promise<void> {
    const stored = await this.#docs.readDoc(docId);
    if (stored === null) return;
    const meta = {
      baseEpoch: stored.meta.baseEpoch,
      engineSchema: stored.meta.engineSchema,
      savedAt: stored.meta.savedAt,
    };
    // Checkpoint FIRST, then the journal in order. The peer declines the
    // checkpoint if it already has content, and re-frames the updates either
    // way — so this is safe to send blind, which is what lets the sender avoid
    // asking "what do you have?" over a round trip it would only get wrong.
    this.#write(laneId, DOC_SYNC_RECORD.SNAPSHOT, meta, stored.bytes);
    for (const update of stored.updates) {
      this.#write(laneId, DOC_SYNC_RECORD.UPDATE, meta, update);
    }
  }

  #send(laneId: number, as: "snapshot" | "update", commit: DocCommit): void {
    this.#write(
      laneId,
      as === "snapshot" ? DOC_SYNC_RECORD.SNAPSHOT : DOC_SYNC_RECORD.UPDATE,
      {
        baseEpoch: commit.baseEpoch,
        engineSchema: commit.meta.engineSchema,
        savedAt: commit.meta.savedAt,
      },
      commit.payload,
    );
  }

  #write(
    laneId: number,
    kind: number,
    meta: { baseEpoch: number; engineSchema: number | null; savedAt: number },
    payload: Uint8Array,
  ): void {
    try {
      this.#bytes.send(laneId, encodeDocSyncRecord(kind, meta, payload));
    } catch (error) {
      // A wedged lane (the watermark refusing to queue more) or a lane that
      // died under us. Reported, never thrown into a caller's write path.
      this.#logger.warn("fieldd.doc_sync.send_failed", "A doc-sync record could not be sent", {
        laneId,
        error: String(error),
      });
      this.#forget(laneId);
    }
  }
}
