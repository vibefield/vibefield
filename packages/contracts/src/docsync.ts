import { z } from "zod";

// The doc-sync lane's payload shape (C6-3f, design-02 §3.5 + D5).
//
// A doc-sync lane is already scoped to ONE document — `MeshLaneOpenRequest`
// carries `docId` — so a record on it never names its doc. What it must say is
// which KIND of bytes these are and which compaction epoch they belong to;
// everything else is opaque, and stays opaque, because fieldd does not decode a
// document (B3 shape A).
//
// NO LENGTH PREFIX, deliberately: the MeshData frame beneath this already
// preserves record boundaries, so one lane payload IS one doc-sync record. A
// second length prefix would be a second way to disagree about where a record
// ends — see the C6-3d finding where exactly that class of mistake cost a day.

/** What a record carries. Kinds are open — a tolerant reader ignores one it
 * does not know rather than tearing the lane (P3). */
export const DOC_SYNC_RECORD = {
  /** A whole ICE1 checkpoint. Bootstrap only: fieldd cannot MERGE two
   * checkpoints (it cannot read them), so a receiver that already holds content
   * declines this rather than replacing what it has. */
  SNAPSHOT: 1,
  /** One opaque Loro update record, re-framed by the receiver onto its own
   * journal head. Measured (C6-3f probe): re-framing converges, and a record
   * whose causal dependencies have not arrived is held pending, not lost. */
  UPDATE: 2,
  /** What this device already holds, so the peer sends only what it lacks
   * (C6-3h). The alternative every CRDT reaches for is a version-vector
   * exchange — exact, and impossible here: computing a version vector means
   * DECODING the document, and fieldd does not. Hashing bytes does not.
   *
   * Both sides send one on lane establishment and each pushes the difference;
   * there is deliberately no WANT reply, because the receiver of a HAVE already
   * knows everything needed to compute it. */
  HAVE: 3,
} as const;

/** u8 kind + u32 metaLen. */
export const DOC_SYNC_HEADER_BYTES = 5;

export const DocSyncMeta = z
  .object({
    /** The compaction epoch these bytes belong to. A record from a different
     * epoch is not stale — it is UNAPPLIABLE, and the receiver must re-bootstrap
     * rather than append across the boundary (the S4 law). */
    baseEpoch: z.number().int().nonnegative(),
    engineSchema: z.number().int().nullable(),
    savedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type DocSyncMeta = z.infer<typeof DocSyncMeta>;

export interface DocSyncRecord {
  kind: number;
  meta: DocSyncMeta;
  payload: Uint8Array;
}

/** A HAVE's payload: what this device holds, by CONTENT id.
 *
 * `hasCheckpoint` is a boolean and not a hash, deliberately. Two devices can
 * hold different checkpoint BYTES representing the same logical state — one
 * compacted, one bootstrapped, one simply saved at a different moment — so
 * hashes would never match and the sender would ship its checkpoint on every
 * exchange forever, only for the receiver to decline it as would-clobber. What
 * the sender actually needs to know is whether the peer has *a* checkpoint. */
export const DocSyncDigest = z
  .object({
    hasCheckpoint: z.boolean(),
    /** Content ids of the journal records held, in stored order. */
    records: z.array(z.string()),
  })
  .passthrough();
export type DocSyncDigest = z.infer<typeof DocSyncDigest>;

// ---- sync state (C6-4) ----
//
// What the renderer is told about a doc's standing with its peers. This is a
// FOLD of facts fieldd actually holds (EL5) — attempt outcomes, digest diffs,
// decline reasons — never a claim it cannot check. There are no delivery
// receipts in the protocol, so the strongest good state is "in step": nothing
// known un-synced. It is deliberately NOT named "converged" — convergence is a
// property of the CRDT the daemon never decodes, and a state named for it
// would promise more than the daemon can see.

/** Doc-level fold, one honest word. Severity order, worst first:
 * `epoch-stale` (a compaction boundary parts us from a peer — re-bootstrap) ·
 * `peer-declined` (we refused a peer's records; devices may differ) ·
 * `pending` (a peer's digest names records we do not yet hold — the doc is not
 * complete, however settled it looks) · `peer-offline` (a peer we have traffic
 * for is unreachable; detection may lag by MINUTES — F-C6-22 — so timestamps,
 * not this word, carry the freshness truth) · `syncing` (records in flight) ·
 * `in-step` (nothing known un-synced).
 *
 * There is no `solo`: a doc with no sync facts gets NO status, and the absence
 * is the statement — with no peers there is nothing sync can honestly say. */
export const DocSyncDocState = z.enum([
  "in-step",
  "syncing",
  "pending",
  "peer-offline",
  "peer-declined",
  "epoch-stale",
]);
export type DocSyncDocState = z.infer<typeof DocSyncDocState>;

/** Per-peer facts under the fold. `lastExchangeAt` is the honesty mechanism:
 * a state row always says WHEN it last knew, never implying now. */
export const DocSyncPeerStatus = z
  .object({
    /** The peer's device id (D30 — one keyspace with the roster). */
    peer: z.string(),
    /** Our last attempt reached it (lane open/send ok, no unreachable close). */
    reachable: z.boolean(),
    /** epoch ms of the last successful send to or receive from this peer for
     * this doc; null before the first exchange. */
    lastExchangeAt: z.number().int().nullable(),
  })
  .passthrough();
export type DocSyncPeerStatus = z.infer<typeof DocSyncPeerStatus>;

export const DocSyncStatus = z
  .object({
    docId: z.string(),
    /** Registry name; null when a peer syncs a doc this device does not have
     * (doc existence does NOT replicate yet — the honest unknown-doc case). */
    name: z.string().nullable(),
    state: DocSyncDocState,
    /** Records a peer's digest names that we do not hold yet (§8: the
     * distinction between "settled" and "complete"). */
    pendingRecords: z.number().int().nonnegative(),
    peers: z.array(DocSyncPeerStatus),
    /** Verbatim decline reason behind a peer-declined/epoch-stale state —
     * provenance, logged words, never prose invented for the wire. */
    reason: z.string().nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export type DocSyncStatus = z.infer<typeof DocSyncStatus>;

/** The `doc.sync.subscribe` payload — snapshot and every delta alike carry the
 * whole current list (the device.subscribe roster pattern), so the renderer
 * never patches. Empty is MEANINGFUL: sync has nothing to say (no peers, mesh
 * off), and the quiet UI is the honest rendering — not an error. */
export const DocSyncStatusList = z.array(DocSyncStatus);
export type DocSyncStatusList = z.infer<typeof DocSyncStatusList>;

/** A HAVE carries no document bytes, so its meta's content fields are unused.
 * `baseEpoch` is not: a digest from another epoch describes a different
 * lineage, and answering it would ship records across a compaction boundary. */
export function encodeDocSyncHave(baseEpoch: number, digest: DocSyncDigest): Uint8Array {
  return encodeDocSyncRecord(
    DOC_SYNC_RECORD.HAVE,
    { baseEpoch, engineSchema: null, savedAt: 0 },
    new TextEncoder().encode(JSON.stringify(digest)),
  );
}

export function decodeDocSyncDigest(payload: Uint8Array): DocSyncDigest {
  return DocSyncDigest.parse(JSON.parse(new TextDecoder().decode(payload)));
}

export function encodeDocSyncRecord(
  kind: number,
  meta: DocSyncMeta,
  payload: Uint8Array,
): Uint8Array {
  if (!Number.isInteger(kind) || kind < 0 || kind > 255) {
    throw new Error(`doc-sync kind out of u8 range: ${kind}`);
  }
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(DOC_SYNC_HEADER_BYTES + metaBytes.byteLength + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, kind);
  view.setUint32(1, metaBytes.byteLength);
  out.set(metaBytes, DOC_SYNC_HEADER_BYTES);
  out.set(payload, DOC_SYNC_HEADER_BYTES + metaBytes.byteLength);
  return out;
}

export function decodeDocSyncRecord(data: Uint8Array): DocSyncRecord {
  if (data.byteLength < DOC_SYNC_HEADER_BYTES) {
    throw new Error(`doc-sync record shorter than header: ${data.byteLength} bytes`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const metaLen = view.getUint32(1);
  const metaEnd = DOC_SYNC_HEADER_BYTES + metaLen;
  // Refuse on the declared length BEFORE slicing, the way the MeshData reader
  // does: a peer must not be able to make us read past what it actually sent.
  if (metaEnd > data.byteLength) {
    throw new Error(`doc-sync meta declares ${metaLen} bytes, past the record`);
  }
  const meta = DocSyncMeta.parse(
    JSON.parse(new TextDecoder().decode(data.subarray(DOC_SYNC_HEADER_BYTES, metaEnd))),
  );
  return {
    kind: view.getUint8(0),
    meta,
    // COPY, not a view. The caller parks these in a journal write; a view would
    // retain the whole lane read for the life of the record (the C6-3e
    // watermark finding, one layer up).
    payload: data.slice(metaEnd),
  };
}
