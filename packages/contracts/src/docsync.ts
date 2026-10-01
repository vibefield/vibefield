import { z } from "zod";
import { LANE_MAX_FRAME_BYTES } from "./doclane";
import { MESHDATA_HEADER_BYTES, MESHDATA_MAX_FRAME_BYTES } from "./meshdata";

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
   * knows everything needed to compute it.
   *
   * CORRECTED 2026-09-30 (DS-5, DS-D18 RULED (a)): "impossible here" was true of
   * an opaque daemon and stopped being true when fieldd became a Loro-level
   * host. HAVE stays for peers that predate DS-5; two DS-5 peers speak VERSION. */
  HAVE: 3,
  /** DS-5 — what this device's Loro host holds, as Loro's own ENCODED version
   * vector (`VersionVector.encode()`). The receiver answers with exactly what
   * the sender lacks — `export({mode: "update", from})`, preceded by the
   * checkpoint envelope when the sender holds none — as ordinary SNAPSHOT and
   * UPDATE records. Sent BEFORE the HAVE on lane establishment, so a DS-5
   * receiver knows to ignore the HAVE that follows it. */
  VERSION: 4,
  /** DS-5 — one slice of a record too large for a MeshData frame (8 MiB):
   * the slices are the ENCODED inner record, reassembled whole and then read
   * like any other record. Chunks ride their own lane (design-02 §3.3's "own
   * lane per snapshot"), so a bootstrap never queues live edits behind it. */
  CHUNK: 5,
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
     * (doc existence does NOT replicate yet — the honest unknown-doc case).
     * *Corrected 2026-10-01 (DS-5c):* existence replicates since DS-5, through
     * the library system document (DS-D6) — null is the window between a
     * peer's greeting and the library row landing, not a standing state. */
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

// ---- DS-5 — the Loro-level host's kinds (DS-D18, thinking-desktop-sync-plane §5.1) ----
//
// ADDITIVE, and old peers stay whole. The two new kinds carry metas WITHOUT the
// legacy `engineSchema`/`savedAt` — neither means anything for a version vector
// or a slice — so a pre-DS-5 `decodeDocSyncRecord` refuses them by its own meta
// law, logs `record_undecodable`, and keeps the lane: the degradation it was
// written for ("a peer running a newer build should degrade, not disconnect").
// A DS-5 reader goes through `decodeDocSyncFrame`, which reads ANY kind and
// leaves the meta to the kind's own schema — so a kind newer still is ignored,
// never fatal. `test/docsync-frames.test.ts` holds both halves to fixtures.

/** The Loro binary-encoding family this tree speaks (loro-crdt 1.x, EL8's one
 * resolution). DS-L9 / risk 4: skew is honest — a peer declaring another family
 * is not merged with, it is refused and reported. */
export const DOC_SYNC_LORO_ENCODING = 1;

/** The most one lane send may carry: a MeshData frame minus its own header. */
export const DOC_SYNC_MAX_RECORD_BYTES = MESHDATA_MAX_FRAME_BYTES - MESHDATA_HEADER_BYTES;

/** One CHUNK's slice of the inner record. 1 MiB keeps a paced sender well under
 * MeshLaneLink's 4 MiB send watermark and the receiver's orphan buffer. */
export const DOC_SYNC_CHUNK_BYTES = 1024 * 1024;

/** The largest record a receiver reassembles — the renderer's own lane ceiling,
 * because a document no window could be handed is not worth holding in memory. */
export const DOC_SYNC_MAX_TRANSFER_BYTES = LANE_MAX_FRAME_BYTES;

export const DocSyncVersionMeta = z
  .object({
    /** The compaction epoch the version belongs to (S4): versions from two
     * epochs are two lineages, and neither side answers across the fence. */
    baseEpoch: z.number().int().nonnegative(),
    /** Does the sender hold a base a renderer can open? A canvas holder without
     * a checkpoint is bootstrapped with the checkpoint envelope first; a raw Loro
     * system document has no checkpoint species and always says true. */
    hasCheckpoint: z.boolean(),
    /** `DOC_SYNC_LORO_ENCODING` of the sender (DS-L9). */
    loro: z.number().int().positive(),
  })
  .passthrough();
export type DocSyncVersionMeta = z.infer<typeof DocSyncVersionMeta>;

export const DocSyncChunkMeta = z
  .object({
    /** Sender-minted transfer id; unique per sender for the transfer's life. */
    transfer: z.string().min(1).max(64),
    index: z.number().int().nonnegative(),
    count: z.number().int().positive(),
    /** Length of the WHOLE encoded inner record — the reassembly's bound. */
    byteLength: z.number().int().positive(),
  })
  .passthrough();
export type DocSyncChunkMeta = z.infer<typeof DocSyncChunkMeta>;

/** Any record, read without judging its kind: the DS-5 reader's entry point. */
export interface DocSyncFrame {
  kind: number;
  /** The meta as JSON — each kind parses it with its own schema. */
  meta: Record<string, unknown>;
  payload: Uint8Array;
}

function encodeFrame(kind: number, meta: object, payload: Uint8Array): Uint8Array {
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

/** A VERSION record: the encoded version vector is the whole payload. */
export function encodeDocSyncVersion(meta: DocSyncVersionMeta, version: Uint8Array): Uint8Array {
  return encodeFrame(DOC_SYNC_RECORD.VERSION, DocSyncVersionMeta.parse(meta), version);
}

/** Split one ENCODED record into CHUNK records. A record that already fits is
 * the caller's to send whole — chunking is for what a frame cannot carry. */
export function chunkDocSyncRecord(
  record: Uint8Array,
  transfer: string,
  chunkBytes: number = DOC_SYNC_CHUNK_BYTES,
): Uint8Array[] {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error(`doc-sync chunk size must be a positive integer: ${chunkBytes}`);
  }
  if (record.byteLength === 0) throw new Error("doc-sync: nothing to chunk");
  const count = Math.ceil(record.byteLength / chunkBytes);
  const out: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const slice = record.subarray(
      index * chunkBytes,
      Math.min(record.byteLength, (index + 1) * chunkBytes),
    );
    out.push(
      encodeFrame(
        DOC_SYNC_RECORD.CHUNK,
        { transfer, index, count, byteLength: record.byteLength },
        slice,
      ),
    );
  }
  return out;
}

/** Tolerant reader for every kind, known or not. It refuses only structural
 * garbage — a short header, a meta that runs past the record, meta that is not
 * a JSON object — and never judges a kind it does not know. */
export function decodeDocSyncFrame(data: Uint8Array): DocSyncFrame {
  if (data.byteLength < DOC_SYNC_HEADER_BYTES) {
    throw new Error(`doc-sync record shorter than header: ${data.byteLength} bytes`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const metaLen = view.getUint32(1);
  const metaEnd = DOC_SYNC_HEADER_BYTES + metaLen;
  if (metaEnd > data.byteLength) {
    throw new Error(`doc-sync meta declares ${metaLen} bytes, past the record`);
  }
  const meta: unknown = JSON.parse(
    new TextDecoder().decode(data.subarray(DOC_SYNC_HEADER_BYTES, metaEnd)),
  );
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("doc-sync meta is not a JSON object");
  }
  return {
    kind: view.getUint8(0),
    meta: meta as Record<string, unknown>,
    // COPY — the same watermark reason as decodeDocSyncRecord.
    payload: data.slice(metaEnd),
  };
}
