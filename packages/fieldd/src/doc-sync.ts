import { randomUUID } from "node:crypto";
import {
  chunkDocSyncRecord,
  DOC_SYNC_CHUNK_BYTES,
  DOC_SYNC_LORO_ENCODING,
  DOC_SYNC_MAX_RECORD_BYTES,
  DOC_SYNC_MAX_TRANSFER_BYTES,
  DOC_SYNC_RECORD,
  DocSyncChunkMeta,
  type DocSyncDocState,
  type DocSyncFrame,
  type DocSyncIntent,
  DocSyncMeta,
  type DocSyncStatus,
  DocSyncVersionMeta,
  decodeDocSyncDigest,
  decodeDocSyncFrame,
  encodeDocSyncHave,
  encodeDocSyncRecord,
  encodeDocSyncVersion,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { VersionVector } from "loro-crdt";
import { contentIdOf, type DocCommit, type DocumentService } from "./doc-service";
import { covers, decodeVersion } from "./loro-host";

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
//   · on lane establishment BOTH sides send a HAVE — what they hold, by
//     content id — and each pushes only what the other lacks. There is no WANT
//     reply: the receiver of a HAVE already knows everything needed to compute
//     the difference, so asking would be a round trip for information it has;
//   · thereafter, each local commit is broadcast to that doc's open lanes;
//   · a record that came FROM a peer is never re-broadcast. Two devices echoing
//     each other converges instantly and then never stops, which on a graph
//     looks exactly like a busy network rather than like a bug.
//
// STATE (C6-4): per-doc sync standing is DERIVED from tracked facts — digest
// diffs, attempt outcomes, decline reasons — never set imperatively. F-C6-16
// was one path clearing a state another path had just set; a derivation has no
// such paths. The fold is what `doc.sync.subscribe` publishes, and it claims
// only what fieldd can check: there are no delivery receipts in this protocol,
// so the best good state is "in step" (nothing known un-synced), never
// "converged".
//
// DS-5 (DS-D18 RULED (a), 2026-09-30) — VERSION beside HAVE. A lane now opens
// with a VERSION (the host's encoded version vector) and THEN the legacy HAVE.
// A DS-5 peer answers the VERSION with exactly what the sender lacks — the
// checkpoint envelope first if it holds none, then one Loro update — and
// ignores the HAVE behind it; a pre-DS-5 peer refuses the VERSION's meta, logs,
// and answers the HAVE as it always did. After that a DS-5 peer is sent each
// local commit as a Loro update (a checkpoint's DELTA, not the checkpoint), and
// a record too large for a MeshData frame crosses as CHUNKs on a lane of its
// own. Docs in opaque custody (a checkpoint the ICE1 frame rule cannot lift)
// have no version to state and keep the whole C6 protocol unchanged.

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
  /** DS-5 — bytes queued toward the bridge, for pacing a chunked transfer
   * (MeshLaneLink's outbound watermark reading). Absent: no pacing. */
  readonly bufferedBytes?: number;
  /** DS-5 — a barrier: resolves once earlier sends on the lane entered the
   * transport, so the transfer lane is closed behind its last chunk. */
  flush?(laneId: number): Promise<void>;
}

export interface LaneInfo {
  laneId: number;
  peer: string;
  protocol: string;
  class?: string;
  docId?: string;
  inbound?: boolean;
}

/** A peer as the mesh sees it right now. `online` is WireGuard transport truth
 * (5s keep-alive) — far fresher than a QUIC dial timeout, which is what makes
 * it worth carrying here (F-C6-22: a dead lane can take MINUTES to say so). */
export interface SyncPeer {
  id: string;
  online: boolean;
}

/** DS-5 (DS-D7; UA-P-D5: "a phone never receives a document") — the DOC peer
 * set: self peers whose roster row says `docHost`. A phone is a self peer and
 * publishes no device slice — it runs no fieldd and binds no doc-sync door —
 * so it has no row and leaves the closure HERE, instead of being dialed on
 * every commit and folding each doc to `peer-offline` (§1.2). A desktop whose
 * slice has not arrived yet is out until it does; the roster change that
 * brings it re-runs eager replication. */
export function docHostPeers(
  roster: ReadonlyArray<{
    self: boolean;
    tailscaleId?: string | undefined;
    /** Absent reads as "did not say", which for a promise to host is a no. */
    capabilities?: { docHost: boolean } | undefined;
  }>,
  selfPeers: readonly SyncPeer[],
): SyncPeer[] {
  const hosts = new Set<string>();
  for (const row of roster) {
    if (!row.self && row.tailscaleId !== undefined && row.capabilities?.docHost === true) {
      hosts.add(row.tailscaleId);
    }
  }
  return selfPeers.filter((peer) => hosts.has(peer.id));
}

/** The roster view the daemon wires in post-construction (DeviceService is
 * built later — the attachPeerLink precedent). `on` returns a detach. */
export interface SyncLiveness {
  list(): SyncPeer[];
  on(cb: () => void): () => void;
}

export interface DocSyncOptions {
  docs: DocumentService;
  control: LaneControl;
  bytes: LaneBytes;
  /** Peers to sync toward — `PeerInfo.id`, the same string `lane.open` takes:
   * the Tailscale stable node id. NOT the roster's ULID deviceId — truffle's
   * contract says the two keyspaces never collide (T1 §6; an earlier version
   * of this comment asserted the opposite and the liveness fold was inert for
   * it). `SyncLiveness` rows must arrive in this same keyspace. */
  peers: () => Promise<SyncPeer[]>;
  /** Shared daemon-owned allocator. Doc sync and presence must never mint the
   * same outbound id into field-native's one lane table. */
  allocateLaneId: () => number;
  /** UA-D7 — this doc's settled answer to "may you leave the device?", per-doc
   * intent already folded with the user's posture (the daemon owns that fold;
   * see `resolveSyncIntent`). SYNCHRONOUS on purpose: it is consulted from
   * `onCommit` and from `statuses()`, neither of which may await, and the
   * answer is registry-and-preference state fieldd already holds in memory.
   * Absent means the pre-UA-6 world — everything syncs. */
  resolveIntent?: (docId: string) => DocSyncIntent;
  /** UA-P-0f (D5) — "documents sync only among VibeField DESKTOPS that share
   * the same tailscale login identity. A phone never receives a document."
   *
   * The INBOUND half of that, in the same dial keyspace `peers` uses: is this
   * `PeerInfo.id` one of this account's? The outbound half needs no gate here —
   * `peers` itself is the self-peer set — but an inbound lane arrives without
   * ever consulting that list, so it is asked here. Absent means the pre-UA-P
   * world and admits everyone, which is why the daemon always passes it. */
  isSelfPeer?: (peer: string) => boolean;
  logger?: Logger;
  /** injectable clock — the state tests drive it directly */
  now?: () => number;
  /** DS-5 — the largest record sent whole (default: a MeshData frame minus its
   * header). Tests lower it to drive chunking without 8 MiB documents. */
  maxRecordBytes?: number;
  /** DS-5 — CHUNK slice size (default 1 MiB). */
  chunkBytes?: number;
  /** DS-5 — how long a half-received transfer is kept (default 60 s). */
  transferTtlMs?: number;
}

/** DS-5 — a CHUNKed record being put back together. */
interface Reassembly {
  count: number;
  byteLength: number;
  parts: (Uint8Array | undefined)[];
  received: number;
  size: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Transfers in flight per peer before the oldest is dropped. */
const MAX_TRANSFERS_PER_PEER = 4;
/** The most slices one transfer may declare: the reassembly bound at 1 KiB a
 * slice. A declared count sizes the parts table, so it is bounded on its own,
 * not only through the byte length. */
const MAX_CHUNKS_PER_TRANSFER = Math.ceil(DOC_SYNC_MAX_TRANSFER_BYTES / 1024);
/** A chunked send waits while more than this many bytes are queued. */
const PACE_WATERMARK_CHUNKS = 2;
const PACE_DEADLINE_MS = 30_000;

/** What one peer's standing with one doc rests on. */
interface PeerSyncFacts {
  /** Our last attempt reached it — a send landed, a record arrived, or the
   * roster says online. False from a failed open, an unreachable close, or the
   * roster saying offline. */
  reachable: boolean;
  lastExchangeAt: number | null;
}

/** Everything a doc's published state derives from. */
interface DocSyncFacts {
  /** Content ids a peer's digest names that we do not hold (§8: the record
   * that would otherwise be invisible — Loro holds an update whose causal
   * dependencies are missing as pending, showing nothing, and EL5 forbids
   * calling that converged). Drains as records arrive. */
  expected: Set<string>;
  /** A checkpoint is owed to us — the peer has one, we have none. */
  expectCheckpoint: boolean;
  /** DS-5 — peers whose VERSION names ops our host does not hold yet: the
   * version-exchange form of `expected`. Drains as their answer lands. */
  awaiting: Map<string, VersionVector>;
  /** DS-5 — the host holds a peer's record as PENDING (its causal base has not
   * arrived). Not complete, however settled it looks; cleared by the next
   * applied record. */
  pendingBase: boolean;
  peers: Map<string, PeerSyncFacts>;
  /** We declined a peer's record and the difference is standing (unknown-doc /
   * unknown-kind / local-only). Cleared by the next applied record. */
  declined: boolean;
  /** A compaction boundary parts us from a peer (S4). Cleared by re-bootstrap
   * — concretely, the next applied record. */
  epochStale: boolean;
  /** Verbatim decline reason behind either flag — provenance, never prose. */
  reason: string | null;
  updatedAt: number;
}

export class DocSyncService {
  readonly #docs: DocumentService;
  readonly #control: LaneControl;
  readonly #bytes: LaneBytes;
  readonly #peers: () => Promise<SyncPeer[]>;
  readonly #resolveIntent: (docId: string) => DocSyncIntent;
  readonly #isSelfPeer: ((peer: string) => boolean) | undefined;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #allocateLaneId: () => number;

  /** docId → peer → laneId, for lanes WE opened. */
  readonly #outbound = new Map<string, Map<string, number>>();
  /** laneId → docId, for lanes a peer opened toward us. */
  readonly #inbound = new Map<number, string>();
  /** Per-doc serialisation: opening a lane is async and a commit is not, so
   * without this a burst of saves races several opens for one peer. */
  readonly #work = new Map<string, Promise<void>>();
  /** The C6-4 fact base — docs appear here when sync first touches them, and
   * a doc with no entry has NO status: with nothing attempted and nothing
   * heard, silence is the only claim fieldd can stand behind. */
  readonly #facts = new Map<string, DocSyncFacts>();
  readonly #listeners = new Set<(statuses: DocSyncStatus[]) => void>();
  #lastSig = "";
  #liveness: SyncLiveness | null = null;
  #livenessOff: (() => void) | null = null;
  /** DS-5 — `${docId}\u0000${peer}` pairs that spoke VERSION: their HAVE is
   * ignored and their commits go out as Loro updates. */
  readonly #versionPeers = new Set<string>();
  /** DS-5 — `${peer}\u0000${transfer}` → a chunked record being reassembled. */
  readonly #transfers = new Map<string, Reassembly>();
  readonly #maxRecordBytes: number;
  readonly #chunkBytes: number;
  readonly #transferTtlMs: number;
  /** Transfer ids are unique per sender for the transfer's life; a per-boot
   * prefix keeps a restarted fieldd from reusing one a peer still holds. */
  readonly #transferPrefix = randomUUID().slice(0, 8);
  #nextTransfer = 0;

  #started = false;

  constructor(opts: DocSyncOptions) {
    this.#docs = opts.docs;
    this.#control = opts.control;
    this.#bytes = opts.bytes;
    this.#peers = opts.peers;
    this.#allocateLaneId = opts.allocateLaneId;
    this.#resolveIntent = opts.resolveIntent ?? (() => "sync");
    this.#isSelfPeer = opts.isSelfPeer;
    this.#now = opts.now ?? Date.now;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "doc.sync" });
    this.#maxRecordBytes = opts.maxRecordBytes ?? DOC_SYNC_MAX_RECORD_BYTES;
    this.#chunkBytes = opts.chunkBytes ?? DOC_SYNC_CHUNK_BYTES;
    this.#transferTtlMs = opts.transferTtlMs ?? 60_000;
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
    this.replicate();
  }

  /** DS-5 (DS-D7) — EAGER replication: every syncable document (each held
   * canvas that resolves to `sync`, and every system document) toward every
   * awake doc peer, NOW — not on its next commit, which may never come for a
   * canvas nobody is editing. An open lane is left alone; a new one greets, and
   * the version exchange does the rest in one round. Idempotent by the lane
   * table, so every roster change and every adoption may call it.
   *
   * `regreet` sends a VERSION down a lane that is ALREADY open: a lane a peer
   * opened while this device did not yet know the doc greeted nothing (there
   * was no version to state), so an adoption must speak up on it. */
  replicate(docIds?: readonly string[], opts: { regreet?: boolean } = {}): void {
    void this.#replicateNow(docIds, opts.regreet === true).catch((error) => {
      this.#logger.warn("fieldd.doc_sync.replicate_failed", "Eager replication did not run", {
        error: String(error),
      });
    });
  }

  async #replicateNow(docIds: readonly string[] | undefined, regreet: boolean): Promise<void> {
    if (!this.#started) return;
    const peers = (await this.#peers()).filter((peer) => peer.online);
    if (peers.length === 0) return;
    const ids = docIds ?? [
      ...this.#docs.list().map((entry) => entry.docId),
      ...this.#docs.systemDocIds(),
    ];
    for (const docId of ids) {
      if (this.#isLocal(docId)) continue;
      for (const { id: peer } of peers) {
        if (!regreet && this.#outbound.get(docId)?.has(peer) === true) continue;
        this.#enqueue(docId, async () => {
          const lane = await this.#ensureLane(docId, peer);
          if (regreet && lane !== null && !lane.created)
            await this.#greet(docId, lane.laneId, peer);
        });
      }
    }
  }

  /** DocumentService's commit hook. Sync is a CONSUMER of durability: this
   * never throws into the write path, because a sync fault must not be able to
   * turn a committed revision into a failed one. */
  onCommit(commit: DocCommit): void {
    if (commit.origin === "peer") return; // never echo a peer's own record back
    // UA-D7 gate (c) — the fan-out. #ensureLane below would refuse every peer
    // anyway; returning here means a local doc's saves never even queue work,
    // so it never flickers through `syncing` on its way to being ignored.
    if (this.#isLocal(commit.docId)) return;
    this.#enqueue(commit.docId, () => this.#broadcast(commit));
  }

  /** UA-D7 — is this doc staying home? One reader, so the three gates cannot
   * drift apart, and a resolver that throws is never allowed to take a commit
   * or a status fold down with it: an unanswerable question means the standing
   * behavior, which is sync. */
  #isLocal(docId: string): boolean {
    try {
      return this.#resolveIntent(docId) === "local";
    } catch (error) {
      this.#logger.warn(
        "fieldd.doc_sync.intent_unreadable",
        "A doc's sync intent could not be read; treating it as syncing",
        { docId, error: String(error) },
      );
      return false;
    }
  }

  /** The published fold — one status per doc sync has facts for.
   *
   * A local-intent doc is OMITTED, not reported quiet. It cannot reach any of
   * these states — the gates see to that — so publishing one would leave a
   * gated doc reading `pending` forever, which is the exact dishonesty EL5
   * forbids. The pill says "local" from the registry instead; that is the
   * honest sentence, and it does not come from the sync stream. */
  statuses(): DocSyncStatus[] {
    const names = new Map(this.#docs.list().map((entry) => [entry.docId, entry.name]));
    const out: DocSyncStatus[] = [];
    for (const [docId, facts] of this.#facts) {
      if (this.#isLocal(docId)) continue;
      // DS-5 — system documents (settings, library) sync with the canvases and
      // are not canvases: the renderer's sync rows and pill dots key canvases.
      if (this.#docs.isSystemDoc(docId)) continue;
      out.push({
        docId,
        // null is the honest unknown-doc face: a peer syncs a doc this device
        // does not have (doc EXISTENCE does not replicate yet).
        name: names.get(docId) ?? null,
        state: this.#docState(docId, facts),
        pendingRecords:
          facts.expected.size +
          facts.awaiting.size +
          (facts.expectCheckpoint ? 1 : 0) +
          (facts.pendingBase ? 1 : 0),
        peers: [...facts.peers].map(([peer, p]) => ({
          peer,
          reachable: p.reachable,
          lastExchangeAt: p.lastExchangeAt,
        })),
        reason: facts.reason,
        updatedAt: facts.updatedAt,
      });
    }
    return out;
  }

  /** Status-change feed for `doc.sync.subscribe`. Returns a detach. */
  onStatusChanged(fn: (statuses: DocSyncStatus[]) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Fold roster liveness in (C6-4). Offline flips reachability promptly —
   * the transport keep-alive knows in seconds what the lane's own death takes
   * minutes to admit (F-C6-22) — and a peer RETURNING re-greets every doc that
   * was waiting on it, which is what turns "open the laptop" into "the docs
   * catch up" instead of "until the next local edit, nothing". */
  attachLiveness(liveness: SyncLiveness): void {
    this.#livenessOff?.();
    this.#liveness = liveness;
    this.#livenessOff = liveness.on(() => this.#onLivenessChanged());
    // DS-5 (DS-D7) — the roster may already be whole by the time it is
    // attached; replicate now rather than wait for its next real change.
    this.replicate();
  }

  /** Lanes are field-native's to reap when fieldd goes away; this only drops
   * our routing so a restarted service does not deliver into dead handlers. */
  stop(): void {
    for (const laneId of this.#inbound.keys()) this.#bytes.offLane(laneId);
    this.#inbound.clear();
    this.#outbound.clear();
    this.#facts.clear();
    this.#listeners.clear();
    this.#livenessOff?.();
    this.#livenessOff = null;
    this.#liveness = null;
    this.#versionPeers.clear();
    for (const transfer of this.#transfers.values()) clearTimeout(transfer.timer);
    this.#transfers.clear();
    this.#started = false;
  }

  // ---- state derivation (C6-4) ----

  /** Severity fold, worst first. Facts, not events: no path can clear a state
   * another path set, because no path sets one. */
  #docState(docId: string, facts: DocSyncFacts): DocSyncDocState {
    if (facts.epochStale) return "epoch-stale";
    if (facts.declined) return "peer-declined";
    if (
      facts.expected.size > 0 ||
      facts.expectCheckpoint ||
      facts.awaiting.size > 0 ||
      facts.pendingBase
    ) {
      return "pending";
    }
    for (const peer of facts.peers.values()) {
      if (!peer.reachable) return "peer-offline";
    }
    if (this.#work.has(docId)) return "syncing";
    return "in-step";
  }

  #factsFor(docId: string): DocSyncFacts {
    let facts = this.#facts.get(docId);
    if (facts === undefined) {
      facts = {
        expected: new Set(),
        expectCheckpoint: false,
        awaiting: new Map(),
        pendingBase: false,
        peers: new Map(),
        declined: false,
        epochStale: false,
        reason: null,
        updatedAt: this.#now(),
      };
      this.#facts.set(docId, facts);
    }
    return facts;
  }

  #peerFor(facts: DocSyncFacts, peer: string): PeerSyncFacts {
    let p = facts.peers.get(peer);
    if (p === undefined) {
      p = { reachable: true, lastExchangeAt: null };
      facts.peers.set(peer, p);
    }
    return p;
  }

  /** An exchange with a peer succeeded — the only way `lastExchangeAt` moves.
   * The timestamp is the F-C6-22 honesty mechanism: a row says WHEN it last
   * knew, and never implies now. */
  #exchanged(facts: DocSyncFacts, peer: string): void {
    const p = this.#peerFor(facts, peer);
    p.reachable = true;
    p.lastExchangeAt = this.#now();
  }

  /** UA-D7 — record the refusal in the same fact base every other decline uses.
   * `local-only` joins `unknown-doc` and `unknown-kind` in the standing-decline
   * vocabulary, so it needs no new state: the existing derivation reads
   * `declined` as `peer-declined`, with the reason carried verbatim.
   *
   * Nothing is published WHILE the doc is local — `statuses()` omits it — and
   * that is the point of recording it anyway. Flip the doc back to syncing and
   * the standing decline is what shows, saying "a peer's records were refused
   * while this stayed home; the two devices may differ" until an applied record
   * clears it. Fieldd cannot tell the peer (a lane is one-directional and gate
   * (a) forbids opening the return lane), so this is the honest half it CAN
   * say — see the deviation recorded with the slice. */
  #declineLocalOnly(docId: string, peer: string): void {
    const facts = this.#factsFor(docId);
    this.#peerFor(facts, peer);
    facts.declined = true;
    facts.reason = "local-only";
    this.#touch(facts);
  }

  #touch(facts: DocSyncFacts): void {
    facts.updatedAt = this.#now();
    this.#emit();
  }

  /** Emit on REAL changes only: the signature covers everything but the
   * timestamps, which move on every touch and would otherwise make every
   * record a notification. Timestamps still ride out fresh whenever a real
   * change emits. */
  #emit(): void {
    const statuses = this.statuses();
    const sig = JSON.stringify(
      statuses.map((s) => [
        s.docId,
        s.name,
        s.state,
        s.pendingRecords,
        s.reason,
        s.peers.map((p) => [p.peer, p.reachable]),
      ]),
    );
    if (sig === this.#lastSig) return;
    this.#lastSig = sig;
    for (const fn of this.#listeners) {
      try {
        fn(statuses);
      } catch (error) {
        // a listener's failure is its own (the announce() law, one layer up)
        this.#logger.warn("fieldd.doc_sync.listener_failed", "A status listener threw", {
          error: String(error),
        });
      }
    }
  }

  #onLivenessChanged(): void {
    if (this.#liveness === null) return;
    // DS-5 (DS-D7) — a desktop that woke (or whose slice just arrived) gets
    // every syncable document, whether or not anything was waiting on it.
    this.replicate();
    const online = new Map(this.#liveness.list().map((p) => [p.id, p.online]));
    for (const [docId, facts] of this.#facts) {
      for (const [peer, pf] of facts.peers) {
        const isOnline = online.get(peer);
        if (isOnline === false && pf.reachable) {
          pf.reachable = false;
          this.#touch(facts);
        } else if (isOnline === true && !pf.reachable) {
          // The peer is back. Re-greet rather than wait for the next local
          // commit: the digest exchange pushes both differences, so this is
          // the whole catch-up. Same repair as would-clobber (C6-3h), same
          // termination argument.
          this.#enqueue(docId, async () => {
            const lane = await this.#ensureLane(docId, peer);
            if (lane !== null && !lane.created) await this.#greet(docId, lane.laneId, peer);
          });
        }
      }
    }
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
    if (event.kind === "closed") {
      // Before the routing is dropped: an unreachable close is a per-peer fact
      // (minutes late, F-C6-22 — but late truth is still truth, and the roster
      // fold usually got there first).
      if (event.reason === "peer-unreachable") {
        for (const [docId, byPeer] of this.#outbound) {
          for (const [peer, id] of byPeer) {
            if (id !== event.laneId) continue;
            const facts = this.#factsFor(docId);
            this.#peerFor(facts, peer).reachable = false;
            this.#touch(facts);
          }
        }
      }
      this.#forget(event.laneId);
    }
  }

  #claim(lane: LaneInfo): void {
    if (lane.inbound !== true || lane.protocol !== "doc-sync") return;
    // UA-P-0f (D5) — THE ACCOUNT GATE, first, because it is the widest refusal
    // and the one that does not depend on what the lane says about itself.
    // `lane.peer` is the tailnet's own answer for the address that dialled us
    // (`resolve_peer_by_ip` — the WhoIs node id, or an honest `unknown:<ip>`
    // when the control plane will not name it), which is the same keyspace the
    // self-peer set is keyed by. So this is a set membership test on a fact,
    // not a comparison against a claim.
    //
    // FAILS CLOSED, deliberately: a peer this device has not yet seen in its
    // registry refresh is refused and re-admitted on the next one. Documents
    // are the thing D5 is about, and a beat of "not yet" is cheaper than a beat
    // of "anyone".
    if (this.#isSelfPeer !== undefined && !this.#isSelfPeer(lane.peer)) {
      // Left UNCLAIMED, the same shape of "no" as the two refusals below: no
      // handler registers, no return lane opens, and whatever the peer already
      // sent ages out of MeshLaneLink's bounded orphan buffer rather than
      // landing. The lane is closed so the peer is not left holding a stream
      // that will never answer.
      this.#logger.warn(
        "fieldd.doc_sync.lane_refused_foreign_account",
        "A peer outside this account opened a doc-sync lane",
        {
          laneId: lane.laneId,
          peer: lane.peer,
          ...(lane.docId !== undefined ? { docId: lane.docId } : {}),
        },
      );
      void this.#control.close(lane.laneId).catch(() => undefined);
      return;
    }
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
    // UA-D7 gate (b) — the inbound door, beside the doc-less refusal because it
    // is the same shape of "no": the lane is left UNCLAIMED, so no handler
    // registers, no return lane opens, and whatever the peer already sent ages
    // out of MeshLaneLink's bounded orphan buffer rather than landing.
    if (this.#isLocal(docId)) {
      this.#declineLocalOnly(docId, lane.peer);
      this.#logger.info(
        "fieldd.doc_sync.lane_refused_local",
        "A peer opened a lane for a document that is staying on this device",
        { laneId: lane.laneId, docId, peer: lane.peer },
      );
      return;
    }
    this.#inbound.set(lane.laneId, docId);
    // Registering the handler REPLAYS anything that arrived before the
    // announcement — the ordering hazard MeshLaneLink's orphan buffer exists
    // for, and the reason the first record of every inbound lane is not the
    // one that goes missing.
    // THROUGH THE QUEUE, not straight into #receive. Records arrive back to
    // back — a bootstrap checkpoint and the updates that follow it land in one
    // burst — and applying a journal record is read-modify-write. Processing
    // them concurrently means an update reads the journal before the checkpoint
    // it depends on has finished landing, and gets declined for a state that
    // was about to be true. Arrival order is the only order there is.
    this.#bytes.onLane(lane.laneId, (record) =>
      this.#enqueue(docId, () => this.#receive(docId, record, lane.peer)),
    );
    this.#logger.info("fieldd.doc_sync.lane_claimed", "An inbound doc-sync lane was claimed", {
      laneId: lane.laneId,
      docId,
      peer: lane.peer,
    });
    // A lane is one-directional, so hearing from a peer is not the same as
    // being able to answer. Opening the return lane here is also what fixes a
    // one-way bootstrap: without it, a device that holds content and never
    // edits again would never tell anyone, because lanes only used to open on
    // commit.
    this.#enqueue(docId, async () => {
      await this.#ensureLane(docId, lane.peer);
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
    // UA-D7 gate (b), the residual half: intent can flip while a lane is
    // already claimed and its handler already registered. Refusing here — ahead
    // of the decode, so a HAVE gets the same answer as a record — is what makes
    // "keep this local" take effect on the doc rather than on the next lane.
    if (this.#isLocal(docId)) {
      this.#declineLocalOnly(docId, peer);
      this.#logger.info(
        "fieldd.doc_sync.record_refused_local",
        "A peer's record was refused: the document is staying on this device",
        { docId, peer },
      );
      return;
    }
    let frame: DocSyncFrame;
    try {
      frame = decodeDocSyncFrame(record);
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
    switch (frame.kind) {
      case DOC_SYNC_RECORD.HAVE:
        this.#onHave(docId, peer, frame);
        return;
      case DOC_SYNC_RECORD.VERSION:
        await this.#onVersion(docId, peer, frame);
        return;
      case DOC_SYNC_RECORD.CHUNK:
        await this.#onChunk(docId, peer, frame);
        return;
      case DOC_SYNC_RECORD.SNAPSHOT:
      case DOC_SYNC_RECORD.UPDATE:
        await this.#onContent(docId, peer, frame);
        return;
      default:
        // CORRECTED 2026-09-30 (DS-5): a kind this fieldd does not know used to
        // reach applyRemoteRecord and stand as a `peer-declined` decline. It is
        // a NEWER peer's addition — DS-L9, "additions are tolerated" — so it is
        // ignored and logged, and the doc's standing does not move.
        this.#logger.debug(
          "fieldd.doc_sync.kind_ignored",
          "A peer's record of a kind this fieldd does not know was ignored",
          { docId, peer, kind: frame.kind },
        );
    }
  }

  /** A legacy HAVE. Ignored from a peer that already stated a VERSION for this
   * doc — the VERSION's answer was exact, and answering the HAVE too would
   * send the same content twice. */
  #onHave(docId: string, peer: string, frame: DocSyncFrame): void {
    if (this.#versionPeers.has(pairKey(docId, peer))) return;
    const meta = DocSyncMeta.safeParse(frame.meta);
    if (!meta.success) {
      this.#logger.warn("fieldd.doc_sync.have_undecodable", "A peer's HAVE could not be read", {
        docId,
        peer,
        error: meta.error.message,
      });
      return;
    }
    this.#enqueue(docId, () => this.#answerHave(docId, peer, meta.data.baseEpoch, frame.payload));
  }

  /** DS-5 — a peer stated its host's version vector. Answer with exactly what
   * it lacks, and note what IT holds that we do not (the doc is `pending` until
   * that lands). Handled inline, not queued behind itself: the HAVE the peer
   * sent after it must find the pair already marked. */
  async #onVersion(docId: string, peer: string, frame: DocSyncFrame): Promise<void> {
    const parsed = DocSyncVersionMeta.safeParse(frame.meta);
    if (!parsed.success) {
      this.#logger.warn(
        "fieldd.doc_sync.version_undecodable",
        "A peer's VERSION could not be read",
        { docId, peer, error: parsed.error.message },
      );
      return;
    }
    const meta = parsed.data;
    const facts = this.#factsFor(docId);
    this.#exchanged(facts, peer);
    if (meta.loro !== DOC_SYNC_LORO_ENCODING) {
      // DS-L9 / risk 4 — skew is honest: another Loro encoding family is not
      // merged with. Refused, and shown as the decline it is.
      facts.declined = true;
      facts.reason = "loro-encoding";
      this.#touch(facts);
      this.#logger.warn(
        "fieldd.doc_sync.loro_encoding_refused",
        "A peer speaks another Loro encoding; its document is not merged",
        { docId, peer, theirs: meta.loro, ours: DOC_SYNC_LORO_ENCODING },
      );
      return;
    }
    const theirs = decodeVersion(frame.payload);
    if (theirs === null) {
      this.#logger.warn(
        "fieldd.doc_sync.version_undecodable",
        "A peer's version vector could not be decoded",
        { docId, peer },
      );
      return;
    }
    const ours = await this.#docs.hostVersion(docId);
    // Opaque custody (or a doc unknown here): no version to answer by. The pair
    // stays unmarked, so the HAVE behind this VERSION is answered as ever.
    if (ours === null) return;
    this.#versionPeers.add(pairKey(docId, peer));
    if (ours.baseEpoch !== meta.baseEpoch) {
      facts.epochStale = true;
      facts.reason = "epoch-mismatch";
      this.#touch(facts);
      return; // never answer across a compaction boundary (S4)
    }
    const oursVersion = decodeVersion(ours.version);
    if (oursVersion !== null && !covers(oursVersion, theirs)) facts.awaiting.set(peer, theirs);
    else facts.awaiting.delete(peer);
    if (meta.hasCheckpoint && !ours.hasCheckpoint) facts.expectCheckpoint = true;
    this.#touch(facts);
    const answer = await this.#docs.hostAnswer(docId, {
      version: frame.payload,
      hasCheckpoint: meta.hasCheckpoint,
      baseEpoch: meta.baseEpoch,
    });
    if (answer === null || (answer.snapshot === null && answer.update === null)) return;
    const lane = await this.#ensureLane(docId, peer);
    if (lane === null) return;
    if (answer.snapshot !== null) {
      await this.#write(
        lane.laneId,
        docId,
        peer,
        DOC_SYNC_RECORD.SNAPSHOT,
        answer.meta,
        answer.snapshot,
      );
    }
    if (answer.update !== null) {
      await this.#write(
        lane.laneId,
        docId,
        peer,
        DOC_SYNC_RECORD.UPDATE,
        answer.meta,
        answer.update,
      );
    }
    this.#logger.info("fieldd.doc_sync.answered_version", "Sent a peer what its version lacked", {
      docId,
      peer,
      checkpoint: answer.snapshot !== null,
      updateBytes: answer.update?.byteLength ?? 0,
    });
  }

  /** DS-5 — one slice of a record too large for a frame. Reassembled whole
   * (bounded: the renderer's own ceiling, four transfers per peer, a TTL) and
   * then read like any record that arrived in one piece. */
  async #onChunk(docId: string, peer: string, frame: DocSyncFrame): Promise<void> {
    const parsed = DocSyncChunkMeta.safeParse(frame.meta);
    if (!parsed.success) {
      this.#logger.warn("fieldd.doc_sync.chunk_undecodable", "A peer's CHUNK could not be read", {
        docId,
        peer,
        error: parsed.error.message,
      });
      return;
    }
    const { transfer, index, count, byteLength } = parsed.data;
    const key = `${peer}\u0000${transfer}`;
    const refuse = (why: string): void => {
      const held = this.#transfers.get(key);
      if (held !== undefined) clearTimeout(held.timer);
      this.#transfers.delete(key);
      this.#logger.warn("fieldd.doc_sync.chunk_refused", "A chunked transfer was dropped", {
        docId,
        peer,
        transfer,
        reason: why,
      });
    };
    if (
      byteLength > DOC_SYNC_MAX_TRANSFER_BYTES ||
      count > MAX_CHUNKS_PER_TRANSFER ||
      index >= count ||
      count > byteLength
    ) {
      refuse("out-of-bounds");
      return;
    }
    let held = this.#transfers.get(key);
    if (held === undefined) {
      const mine = [...this.#transfers.keys()].filter((k) => k.startsWith(`${peer}\u0000`));
      if (mine.length >= MAX_TRANSFERS_PER_PEER && mine[0] !== undefined) {
        const oldest = this.#transfers.get(mine[0]);
        if (oldest !== undefined) clearTimeout(oldest.timer);
        this.#transfers.delete(mine[0]);
      }
      const timer = setTimeout(() => refuse("expired"), this.#transferTtlMs);
      timer.unref?.();
      held = { count, byteLength, parts: new Array(count), received: 0, size: 0, timer };
      this.#transfers.set(key, held);
    }
    if (held.count !== count || held.byteLength !== byteLength) {
      refuse("inconsistent");
      return;
    }
    if (held.parts[index] !== undefined) return; // a redelivered slice
    held.size += frame.payload.byteLength;
    if (held.size > byteLength) {
      refuse("overrun");
      return;
    }
    held.parts[index] = frame.payload;
    held.received += 1;
    if (held.received < count) return;
    clearTimeout(held.timer);
    this.#transfers.delete(key);
    if (held.size !== byteLength) {
      refuse("short");
      return;
    }
    const whole = new Uint8Array(byteLength);
    let at = 0;
    for (const part of held.parts) {
      if (part === undefined) return;
      whole.set(part, at);
      at += part.byteLength;
    }
    if (whole[0] === DOC_SYNC_RECORD.CHUNK) {
      refuse("nested");
      return;
    }
    await this.#receive(docId, whole, peer);
  }

  /** A SNAPSHOT or an UPDATE — content, from either protocol. */
  async #onContent(docId: string, peer: string, frame: DocSyncFrame): Promise<void> {
    const parsedMeta = DocSyncMeta.safeParse(frame.meta);
    if (!parsedMeta.success) {
      this.#logger.warn("fieldd.doc_sync.record_undecodable", "A peer's record could not be read", {
        docId,
        peer,
        error: parsedMeta.error.message,
      });
      return;
    }
    const decoded = { kind: frame.kind, meta: parsedMeta.data, payload: frame.payload };
    const facts = this.#factsFor(docId);
    this.#exchanged(facts, peer);
    // The same identity the digest speaks — an arriving record retires its own
    // entry from `expected`, applied or already held.
    const incoming = contentIdOf(decoded.payload);
    try {
      const outcome = await this.#docs.applyRemoteRecord(docId, decoded);
      if (outcome.applied) {
        facts.expected.delete(incoming);
        if (decoded.kind === DOC_SYNC_RECORD.SNAPSHOT) facts.expectCheckpoint = false;
        // An applied record IS the repair the standing states wait for: a
        // decline difference resolved, a re-bootstrap landed.
        facts.declined = false;
        facts.epochStale = false;
        facts.reason = null;
        facts.pendingBase = outcome.pending === true;
        await this.#settleAwaiting(docId, facts);
        this.#touch(facts);
        return;
      }
      // Already held is the protocol WORKING, not a problem: content identity
      // is what makes redelivery free, and a redelivery is what a reconnect or
      // a crossed HAVE looks like from here.
      if (outcome.reason === "already-held") {
        facts.expected.delete(incoming);
        await this.#settleAwaiting(docId, facts);
        this.#touch(facts);
        return;
      }
      // DS-5 — held by the host as pending: its causal base has not arrived.
      // Incomplete, not declined; the peer's next answer brings the base.
      if (outcome.reason === "pending") {
        facts.pendingBase = true;
        this.#touch(facts);
        return;
      }
      // "would-clobber" means we are not ready for this record — no checkpoint
      // yet, so there is nothing to append to. That happens whenever a peer
      // broadcasts an update before our bootstrap has landed, which the HAVE
      // exchange makes ORDINARY: the greeting and the broadcast are independent
      // and race freely.
      //
      // Re-greeting is the whole repair. It tells the peer what we hold, and
      // the peer answers with everything we lack — checkpoint first. Self-
      // healing rather than a retry queue, and it terminates, because a peer
      // never sends a checkpoint to someone whose digest says it has one.
      if (outcome.reason === "would-clobber") {
        if (decoded.kind === DOC_SYNC_RECORD.UPDATE) {
          // An update with no checkpoint underneath: the doc is INCOMPLETE,
          // not merely busy, and the state must say so until bootstrap lands.
          facts.expectCheckpoint = true;
        }
        this.#touch(facts);
        this.#enqueue(docId, async () => {
          const lane = await this.#ensureLane(docId, peer);
          if (lane !== null && !lane.created) await this.#greet(docId, lane.laneId, peer);
        });
        return;
      }
      // Any other decline is sync STATE, not an error — exactly what EL5 says
      // must not be silent.
      if (outcome.reason === "epoch-mismatch") {
        facts.epochStale = true;
      } else {
        facts.declined = true; // unknown-doc | unknown-kind | undecodable (local-only lands via #declineLocalOnly)
      }
      facts.reason = outcome.reason;
      this.#touch(facts);
      this.#logger.warn("fieldd.doc_sync.record_declined", "A peer's record was not applied", {
        docId,
        peer,
        reason: outcome.reason,
      });
    } catch (error) {
      this.#logger.error("fieldd.doc_sync.apply_failed", "Applying a peer's record failed", error);
    }
  }

  /** DS-5 — retire every `awaiting` version our host now covers. */
  async #settleAwaiting(docId: string, facts: DocSyncFacts): Promise<void> {
    if (facts.awaiting.size === 0) return;
    for (const [peer, version] of [...facts.awaiting]) {
      if (await this.#docs.hostCovers(docId, version.encode())) facts.awaiting.delete(peer);
    }
  }

  /** A peer told us what it holds; send what it lacks and nothing else.
   *
   * No HAVE goes back. The peer sends its own on its own return lane when it
   * establishes one, so both directions get covered without either side
   * answering a digest with a digest — which is how two devices would end up
   * trading greetings forever. */
  async #answerHave(
    docId: string,
    peer: string,
    baseEpoch: number,
    payload: Uint8Array,
  ): Promise<void> {
    let digest: ReturnType<typeof decodeDocSyncDigest>;
    try {
      digest = decodeDocSyncDigest(payload);
    } catch (error) {
      this.#logger.warn("fieldd.doc_sync.have_undecodable", "A peer's HAVE could not be read", {
        docId,
        peer,
        error: String(error),
      });
      return;
    }
    const facts = this.#factsFor(docId);
    this.#exchanged(facts, peer);
    // The digest cuts both ways: what WE lack of THEIRS is the doc's `pending`
    // truth (§8 — records en route are invisible until they land, and a doc
    // waiting on them must not read as in step). Unknown here (null digest of
    // our own) stays untracked — the arriving records will say unknown-doc.
    const ours = await this.#docs.syncDigest(docId);
    if (ours !== null && ours.baseEpoch !== baseEpoch) {
      // A digest from another epoch describes a different lineage: the pair is
      // parted by a compaction (S4) until one side re-bootstraps.
      facts.epochStale = true;
      facts.reason = "epoch-mismatch";
      this.#touch(facts);
      return; // recordsMissing would refuse the same fence — never ship across it
    }
    if (ours !== null) {
      const held = new Set(ours.records);
      for (const id of digest.records) {
        if (!held.has(id)) facts.expected.add(id);
      }
      if (digest.hasCheckpoint && !ours.hasCheckpoint) facts.expectCheckpoint = true;
      this.#touch(facts);
    }
    const missing = await this.#docs.recordsMissing(docId, {
      baseEpoch,
      hasCheckpoint: digest.hasCheckpoint,
      records: digest.records,
    });
    // Null means either nothing to offer or a digest from another epoch — in
    // which case pushing would carry records across a compaction boundary, and
    // the peer has to re-bootstrap rather than be handed them.
    if (missing === null) return;
    const lane = await this.#ensureLane(docId, peer);
    if (lane === null) return;
    if (missing.checkpoint !== null) {
      await this.#write(
        lane.laneId,
        docId,
        peer,
        DOC_SYNC_RECORD.SNAPSHOT,
        missing.meta,
        missing.checkpoint,
      );
    }
    for (const update of missing.updates) {
      await this.#write(lane.laneId, docId, peer, DOC_SYNC_RECORD.UPDATE, missing.meta, update);
    }
    if (missing.checkpoint !== null || missing.updates.length > 0) {
      this.#logger.info("fieldd.doc_sync.answered_have", "Sent a peer the records it lacked", {
        docId,
        peer,
        checkpoint: missing.checkpoint !== null,
        updates: missing.updates.length,
      });
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
    // In-flight work is itself a fact (`syncing` derives from it) — emit on
    // both edges.
    this.#emit();
    void next.finally(() => {
      if (this.#work.get(docId) === next) this.#work.delete(docId);
      this.#emit();
    });
  }

  async #broadcast(commit: DocCommit): Promise<void> {
    const peers = await this.#peers();
    if (peers.length === 0) return;
    const facts = this.#factsFor(commit.docId);
    for (const { id: peer, online } of peers) {
      if (!online) {
        // The roster already knows what a QUIC dial would spend a deadline
        // discovering (F-C6-22). Record the miss — the doc is NOT in step with
        // this peer — and let the peer-returns re-greet be the catch-up path.
        this.#peerFor(facts, peer).reachable = false;
        this.#touch(facts);
        continue;
      }
      const lane = await this.#ensureLane(commit.docId, peer);
      // A lane we just created has already sent its HAVE, and the peer's answer
      // will carry this commit along with anything else it lacks. Sending it
      // again here would be a duplicate — free, since the protocol is
      // idempotent, but noise on the wire for no gain.
      if (lane === null || lane.created) continue;
      if (this.#versionPeers.has(pairKey(commit.docId, peer))) {
        // DS-5 — a peer that speaks VERSION gets Loro updates only: an update
        // commit as it is, a checkpoint as the DELTA it added to the host (an
        // edit ICE folded into a checkpoint reaches a desktop holding content
        // this way — §1.2 defect 1). A checkpoint that added nothing sends
        // nothing.
        const bytes = commit.kind === "checkpoint" ? commit.delta : commit.payload;
        if (bytes !== undefined) {
          await this.#write(
            lane.laneId,
            commit.docId,
            peer,
            DOC_SYNC_RECORD.UPDATE,
            {
              baseEpoch: commit.baseEpoch,
              engineSchema: commit.meta.engineSchema,
              savedAt: commit.meta.savedAt,
            },
            bytes,
          );
        }
        continue;
      }
      // A SYSTEM document travels only to a peer that spoke VERSION for it: a
      // pre-DS-5 desktop knows no such document and would stand a phantom
      // `unknown-doc` decline in its sync rows for every settings edit here.
      if (this.#docs.isSystemDoc(commit.docId)) continue;
      await this.#send(
        lane.laneId,
        peer,
        commit.kind === "checkpoint" ? "snapshot" : "update",
        commit,
      );
    }
    // No settling line here, deliberately: the old shape set "syncing" then
    // put "idle" back, and F-C6-16 was the receive path's state vanishing
    // under it. Derived state has nothing to settle — the facts already say
    // whatever is true.
  }

  /** Get-or-open the lane toward a peer for a doc. A NEWLY created one greets
   * with a HAVE; an existing one is left alone, or two devices would trade
   * digests forever. */
  async #ensureLane(
    docId: string,
    peer: string,
  ): Promise<{ laneId: number; created: boolean } | null> {
    // UA-D7 gate (a) — the outbound choke point. Every path that would put a
    // byte on the wire for this doc (commit fan-out, HAVE answers, the return
    // lane a claim opens, the peer-returns re-greet) comes through here, so one
    // refusal starves all of them and no caller has to remember the rule.
    if (this.#isLocal(docId)) return null;
    const existing = this.#outbound.get(docId)?.get(peer);
    if (existing !== undefined) return { laneId: existing, created: false };
    const laneId = await this.#openLane(docId, peer);
    if (laneId === null) return null;
    await this.#greet(docId, laneId, peer);
    return { laneId, created: true };
  }

  /** Tell the peer what we hold. It answers with what we lack — and separately
   * sends its own HAVE on its own return lane, which is how we learn what IT
   * lacks. Symmetric, two messages, no request/response pairing. */
  async #greet(docId: string, laneId: number, peer: string): Promise<void> {
    const version = await this.#docs.hostVersion(docId);
    const digest = await this.#docs.syncDigest(docId);
    if (version === null && digest === null) return;
    try {
      // DS-5 — VERSION FIRST. A DS-5 receiver that reads it marks the pair and
      // ignores the HAVE behind it; a pre-DS-5 receiver refuses the VERSION's
      // meta, logs it, and answers the HAVE exactly as it always has.
      if (version !== null) {
        this.#bytes.send(
          laneId,
          encodeDocSyncVersion(
            {
              baseEpoch: version.baseEpoch,
              hasCheckpoint: version.hasCheckpoint,
              loro: DOC_SYNC_LORO_ENCODING,
            },
            version.version,
          ),
        );
      }
      if (digest !== null) {
        this.#bytes.send(
          laneId,
          encodeDocSyncHave(digest.baseEpoch, {
            hasCheckpoint: digest.hasCheckpoint,
            records: digest.records,
          }),
        );
      }
      const facts = this.#factsFor(docId);
      this.#exchanged(facts, peer);
      this.#touch(facts);
    } catch (error) {
      this.#logger.warn("fieldd.doc_sync.greet_failed", "A doc-sync HAVE could not be sent", {
        laneId,
        error: String(error),
      });
      this.#forget(laneId);
    }
  }

  async #openLane(docId: string, peer: string): Promise<number | null> {
    const laneId = this.#allocateLaneId();
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
      // Ordinary, and still a FACT: the doc did not reach this peer, and idle
      // silence here was exactly the "reads in-step while nothing was sent"
      // dishonesty C6-4 exists to close.
      const facts = this.#factsFor(docId);
      this.#peerFor(facts, peer).reachable = false;
      this.#touch(facts);
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

  #send(laneId: number, peer: string, as: "snapshot" | "update", commit: DocCommit): Promise<void> {
    return this.#write(
      laneId,
      commit.docId,
      peer,
      as === "snapshot" ? DOC_SYNC_RECORD.SNAPSHOT : DOC_SYNC_RECORD.UPDATE,
      {
        baseEpoch: commit.baseEpoch,
        engineSchema: commit.meta.engineSchema,
        savedAt: commit.meta.savedAt,
      },
      commit.payload,
    );
  }

  async #write(
    laneId: number,
    docId: string,
    peer: string,
    kind: number,
    meta: { baseEpoch: number; engineSchema: number | null; savedAt: number },
    payload: Uint8Array,
  ): Promise<void> {
    const record = encodeDocSyncRecord(kind, meta, payload);
    if (record.byteLength > this.#maxRecordBytes) {
      await this.#sendChunked(docId, peer, record);
      return;
    }
    try {
      this.#bytes.send(laneId, record);
      const facts = this.#factsFor(docId);
      this.#exchanged(facts, peer);
      this.#touch(facts);
    } catch (error) {
      // A wedged lane (the watermark refusing to queue more) or a lane that
      // died under us. Reported, never thrown into a caller's write path.
      this.#logger.warn("fieldd.doc_sync.send_failed", "A doc-sync record could not be sent", {
        laneId,
        error: String(error),
      });
      const facts = this.#factsFor(docId);
      this.#peerFor(facts, peer).reachable = false;
      this.#touch(facts);
      this.#forget(laneId);
    }
  }

  /** DS-5 (§1.2 defect 3) — a record past the frame budget crosses as CHUNKs
   * on a lane of its OWN (design-02 §3.3, "own lane per snapshot"), so a
   * bootstrap never queues a live edit behind it. Paced against the byte
   * socket's watermark; a lost slice abandons the transfer on the far side
   * (TTL), and the next version exchange asks again — lossy is detectable,
   * never silent. */
  async #sendChunked(docId: string, peer: string, record: Uint8Array): Promise<void> {
    const facts = this.#factsFor(docId);
    if (record.byteLength > DOC_SYNC_MAX_TRANSFER_BYTES) {
      facts.declined = true;
      facts.reason = "transfer-too-large";
      this.#touch(facts);
      this.#logger.error(
        "fieldd.doc_sync.transfer_too_large",
        "A record exceeds the largest transfer a peer reassembles",
        undefined,
        { docId, peer, bytes: record.byteLength, ceiling: DOC_SYNC_MAX_TRANSFER_BYTES },
      );
      return;
    }
    const transfer = `${this.#transferPrefix}-${++this.#nextTransfer}`;
    const laneId = this.#allocateLaneId();
    try {
      await this.#control.open({ laneId, class: "reliable", peer, protocol: "doc-sync", docId });
    } catch (error) {
      this.#logger.info("fieldd.doc_sync.transfer_lane_failed", "No transfer lane to a peer", {
        docId,
        peer,
        error: String(error),
      });
      this.#peerFor(facts, peer).reachable = false;
      this.#touch(facts);
      return;
    }
    try {
      const chunks = chunkDocSyncRecord(record, transfer, this.#chunkBytes);
      for (const chunk of chunks) {
        await this.#paced();
        this.#bytes.send(laneId, chunk);
      }
      await this.#bytes.flush?.(laneId);
      this.#exchanged(facts, peer);
      this.#touch(facts);
      this.#logger.info("fieldd.doc_sync.transfer_sent", "A chunked record was sent", {
        docId,
        peer,
        transfer,
        chunks: chunks.length,
        bytes: record.byteLength,
      });
    } catch (error) {
      this.#logger.warn("fieldd.doc_sync.transfer_failed", "A chunked transfer did not complete", {
        docId,
        peer,
        transfer,
        error: String(error),
      });
      this.#peerFor(facts, peer).reachable = false;
      this.#touch(facts);
    } finally {
      void this.#control.close(laneId).catch(() => undefined);
    }
  }

  /** Wait while the byte socket holds more than two slices — MeshLaneLink
   * THROWS past its 4 MiB watermark rather than queue. */
  async #paced(): Promise<void> {
    const deadline = this.#now() + PACE_DEADLINE_MS;
    while ((this.#bytes.bufferedBytes ?? 0) > PACE_WATERMARK_CHUNKS * this.#chunkBytes) {
      if (this.#now() > deadline) throw new Error("the byte socket did not drain");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** The (doc, peer) pair key the version-speaker set uses. */
function pairKey(docId: string, peer: string): string {
  return `${docId}\u0000${peer}`;
}
