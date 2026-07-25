import { z } from "zod";
import { ErrorKind } from "./errors";

// DocumentService wire shapes (design-01 §5.1/§6.3, B3 P0 subset: create/list/open;
// subscribeRegistry/close/delete/compact/export/import are deferred and undeclared).
// fieldd stores the doc payload as an OPAQUE ICE1 envelope — none of these shapes
// carries doc bytes (EL2: bytes ride the :9411 lane, never JSON-RPC).

/** Registry entry in `field.docs.v1`. P0 is local-single-holder: no holders[] yet;
 * baseEpoch stays 0 until compaction lands (no cross-base exchange law). */
export const DocRegistryEntry = z
  .object({
    docId: z.string().uuid(),
    name: z.string(),
    /** epoch ms of the last accepted PUT (or creation). */
    updatedAt: z.number().int(),
    /** bumped only by doc.compact (deferred) — 0 throughout B3. */
    baseEpoch: z.number().int(),
    /** from the last PUT's meta; null until the first PUT lands (fieldd never decodes the envelope). */
    engineSchema: z.number().int().nullable(),
    /** at-rest envelope size; 0 until the first PUT. */
    sizeBytes: z.number().int(),
    /** tombstone (doc.delete is deferred; the field is contract-stable now). */
    deletedAt: z.number().int().optional(),
    /** P7/D29 — system docs (the settings doc) are hidden from every doc
     * picker and never enter last-open/most-recent launch decisions. */
    system: z.boolean().optional(),
  })
  .passthrough();
export type DocRegistryEntry = z.infer<typeof DocRegistryEntry>;

export const DocCreateParams = z.object({ name: z.string().min(1) }).passthrough();
export type DocCreateParams = z.infer<typeof DocCreateParams>;

export const DocListResult = z.object({ docs: z.array(DocRegistryEntry) }).passthrough();
export type DocListResult = z.infer<typeof DocListResult>;

export const DocOpenParams = z.object({ docId: z.string().uuid() }).passthrough();
export type DocOpenParams = z.infer<typeof DocOpenParams>;

/** doc.rename params — a label-only edit (the service updates name, never updatedAt). */
export const DocRenameParams = z
  .object({ docId: z.string().uuid(), name: z.string().min(1) })
  .passthrough();
export type DocRenameParams = z.infer<typeof DocRenameParams>;

/** doc.open result — the lane wiring info. The ticket is one-shot and short-TTL;
 * laneUrl carries the ACTUAL bound data port (tests bind port 0 — never hardcode). */
export const DocOpenResult = z
  .object({
    docId: z.string().uuid(),
    laneUrl: z.string(),
    ticket: z.string(),
    /** false on a never-written board — the caller seeds instead of GETting. */
    hasDoc: z.boolean(),
  })
  .passthrough();
export type DocOpenResult = z.infer<typeof DocOpenResult>;

/** Sidecar meta persisted next to the envelope (docs/{docId}/meta.json). */
export const DocMeta = z
  .object({
    engineSchema: z.number().int().nullable(),
    /** epoch ms stamped by the writer (the renderer's autosave savedAt). */
    savedAt: z.number().int(),
    byteLength: z.number().int(),
    baseEpoch: z.number().int(),
    /** Exact durable revision acknowledged by fieldd; absent on legacy snapshots. */
    revisionId: z.string().uuid().optional(),
    /** Opaque incremental records following the checkpoint on GET. */
    journalEntries: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type DocMeta = z.infer<typeof DocMeta>;

// ---- :9411 lane control payloads (JSON bodies of control frames; see doclane.ts) ----

/** First frame on a lane socket. Anything else (or an invalid ticket) drops the socket. */
export const LaneHello = z.object({ ticket: z.string() }).passthrough();
export type LaneHello = z.infer<typeof LaneHello>;

export const LaneHelloOk = z
  .object({
    docId: z.string().uuid(),
    hasDoc: z.boolean(),
    meta: DocMeta.optional(),
  })
  .passthrough();
export type LaneHelloOk = z.infer<typeof LaneHelloOk>;

/** Announces the PUT payload that follows. byteLength is the integrity gate —
 * a mismatched PUT is rejected whole (no partial file ever lands). */
export const LanePutMeta = z
  .object({
    revisionId: z.string().uuid(),
    kind: z.enum(["checkpoint", "update"]).optional(),
    /** The revision this update was composed against.
     *
     * NOT ENFORCED as of C6-3f, and the change is deliberate rather than a
     * lapse. Requiring it to equal the current head encodes "nobody else
     * appended since you read" — an optimistic-concurrency (If-Match) rule that
     * is correct only for a store that cannot merge. This one does not need to:
     * a doc is replayed as `checkpoint + every update`, and the ordering probe
     * measured that replay converging whatever the order. Cross-device sync
     * makes another writer appending the NORMAL case, so enforcing head
     * equality would fail the renderer's every save while a peer is editing.
     *
     * It is still carried, and still worth carrying: it is what the reused-id
     * idempotent-retry path compares, and it makes a journal chain readable
     * when something does go wrong. The fence that survives is `baseEpoch`. */
    baseRevisionId: z.string().uuid().optional(),
    /** The compaction epoch this update was composed against (the S4 fence).
     *
     * Optional only because `doc.compact` does not exist yet, so no doc has
     * ever left epoch 0. On a doc that HAS been compacted its absence is
     * refused — a client that cannot say which epoch it built on cannot be
     * shown to be building on the current one. */
    baseEpoch: z.number().int().nonnegative().optional(),
    engineSchema: z.number().int().nonnegative().nullable(),
    savedAt: z.number().int().nonnegative(),
    byteLength: z.number().int().nonnegative(),
  })
  .passthrough();
export type LanePutMeta = z.infer<typeof LanePutMeta>;

export const LanePutOk = z
  .object({ revisionId: z.string().uuid(), byteLength: z.number().int().nonnegative() })
  .passthrough();
export type LanePutOk = z.infer<typeof LanePutOk>;

export const LaneErr = z.object({ kind: ErrorKind, message: z.string() }).passthrough();
export type LaneErr = z.infer<typeof LaneErr>;
