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
