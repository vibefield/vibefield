import { z } from "zod";
import { ErrorKind } from "./errors";

// DocumentService wire shapes (design-01 §5.1/§6.3, B3 P0 subset: create/list/open;
// subscribeRegistry/close/delete/compact/export/import are deferred and undeclared).
// fieldd stores the doc payload as an OPAQUE ICE1 envelope — none of these shapes
// carries doc bytes (EL2: bytes ride the :9411 lane, never JSON-RPC).

/** UA-D7 — where a doc is willing to go. `local` keeps it on the device that
 * holds it: no lane opens for it, no peer's record lands in it, and it leaves
 * the sync fold entirely rather than standing at a state it can never reach. */
export const DocSyncIntent = z.enum(["sync", "local"]);
export type DocSyncIntent = z.infer<typeof DocSyncIntent>;

/** Registry entry in `field.docs.v1`. P0 is local-single-holder: no holders[] yet;
 * baseEpoch stays 0 until compaction lands (no cross-base exchange law).
 * *Corrected 2026-10-01 (DS-5d):* compaction landed — the host bumps baseEpoch
 * when it trims a canvas's history, and a holder at an older epoch
 * re-bootstraps (S4); the holders are the `field.docs.v1` store slice. */
export const DocRegistryEntry = z
  .object({
    docId: z.string().uuid(),
    name: z.string(),
    /** epoch ms of the last accepted PUT (or creation). */
    updatedAt: z.number().int(),
    /** bumped only by doc.compact (deferred) — 0 throughout B3.
     * *Corrected 2026-10-01 (DS-5d):* bumped by the host's compaction (a Loro
     * shallow snapshot at the watermark) and taken from a fresher holder by a
     * re-bootstrap; there is still no `doc.compact` method. */
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
    /** UA-D7 — this doc's own answer to "may you leave this device?". ABSENT
     * is the ordinary case and defers to the user's `mesh.syncPosture`, so a
     * registry written before UA-6 keeps behaving exactly as it did (the entry
     * is `.passthrough()`, so an older reader tolerates it in the other
     * direction). Intent is per DEVICE until doc existence replicates — the
     * named C6-4 debt — and nothing here pretends otherwise.
     * *Corrected 2026-10-01 (DS-5 landed):* existence AND intent replicate now
     * through the library system document (DS-D6), so this field is the
     * device's copy of a converging value, not the only one. */
    syncIntent: DocSyncIntent.optional(),
    /** DS-5 — epoch ms the canvas was created (the library's `createdAt`).
     * Absent on entries written before the library existed. */
    createdAt: z.number().int().optional(),
  })
  .passthrough();
export type DocRegistryEntry = z.infer<typeof DocRegistryEntry>;

// ---- DS-5 — the library and the holders (DS-D6, thinking-desktop-sync-plane §5.2) ----

/** One canvas as the LIBRARY knows it — a user-scope SYSTEM document that every
 * linked desktop holds and merges (per-field last-writer-wins), so a canvas
 * created on one desktop exists on the others, a rename made offline
 * converges, and `syncIntent` converges with it (UA-D7's named follow-up). */
export const DocLibraryEntry = z
  .object({
    docId: z.string().uuid(),
    name: z.string(),
    createdAt: z.number().int(),
    /** epoch ms of the delete; a tombstoned canvas is gone from every list. */
    tombstone: z.number().int().optional(),
    syncIntent: DocSyncIntent.optional(),
    /** DS-5c (DS-D7) — where a `local` canvas LIVES: the roster deviceId of the
     * desktop whose person kept it home. Every other desktop lists it there and
     * refuses to open it — a copy one of them still holds included. Absent
     * while the canvas syncs, and on rows written before DS-5c (then a held
     * copy stays openable where it is held, as before). */
    home: z.string().optional(),
    engineSchema: z.number().int().nullable(),
    baseEpoch: z.number().int().nonnegative(),
  })
  .passthrough();
export type DocLibraryEntry = z.infer<typeof DocLibraryEntry>;

/** One held document, in a device's holders slice. */
export const DocHolding = z
  .object({
    docId: z.string().uuid(),
    baseEpoch: z.number().int().nonnegative(),
    /** base64 of the host's encoded Loro version vector — what this holder has
     * (the compaction watermark's input, DS §5.3). Absent while the document is
     * held in opaque custody (an envelope the fixed rule cannot lift). */
    headVersion: z.string().optional(),
    /** DS-5d — base64 of the version this holder ACKNOWLEDGES: the one below
     * which it will never again produce an op. Its head while no window has
     * the canvas open; with one open, the meet of the head and what this
     * desktop can prove the window holds (a window's next edit descends from
     * what it holds, so nothing it writes can be concurrent with ops below
     * that). The compaction watermark is the meet of every known holder's
     * acknowledgement, so a trim never cuts under an edit still on its way.
     * The EMPTY version (`"AA=="`, Loro's encoding of a version naming no
     * peer) acknowledges nothing — an open window this desktop cannot vouch
     * for — and holds every trim; so does a value that does not decode.
     * Absent on a holder before DS-5d: its `headVersion` stands in. */
    ackVersion: z.string().optional(),
    /** This holder knows of nothing it lacks from any peer it has heard from. */
    fresh: z.boolean(),
    heldSince: z.number().int(),
  })
  .passthrough();
export type DocHolding = z.infer<typeof DocHolding>;

/** `field.docs.v1` — DEVICE-OWNED (DS-L2): who holds what is a fact, and it
 * expires with its publisher. CHANGED 2026-09-30 (DS-5): this store name was
 * the local registry's file name and never a published slice; the file keeps
 * the name on disk, and the store carries this shape. */
export const DocHoldersSlice = z
  .object({
    deviceId: z.string(),
    docs: z.array(DocHolding),
  })
  .passthrough();
export type DocHoldersSlice = z.infer<typeof DocHoldersSlice>;

/** A canvas the library lists that THIS device does not hold — a `local`
 * canvas living on another desktop (DS-D7): listed, not openable here.
 * DS-5c: or holds only a copy of — a canvas it adopted while it synced, kept
 * home since by another desktop; `doc.open` answers it `UNAVAILABLE
 * {service: "docs", state: "held-elsewhere", device}` either way. */
export const DocElsewhere = z
  .object({
    docId: z.string().uuid(),
    name: z.string(),
    /** deviceIds whose holders slice names it; empty when no holder is heard. */
    homes: z.array(z.string()),
  })
  .passthrough();
export type DocElsewhere = z.infer<typeof DocElsewhere>;

export const DocCreateParams = z.object({ name: z.string().min(1) }).passthrough();
export type DocCreateParams = z.infer<typeof DocCreateParams>;

export const DocListResult = z
  .object({
    docs: z.array(DocRegistryEntry),
    /** DS-5 — library canvases held on another desktop only. Additive: a
     * reader that does not know the field keeps its `docs` list unchanged. */
    elsewhere: z.array(DocElsewhere).optional(),
  })
  .passthrough();
export type DocListResult = z.infer<typeof DocListResult>;

export const DocOpenParams = z.object({ docId: z.string().uuid() }).passthrough();
export type DocOpenParams = z.infer<typeof DocOpenParams>;

/** DK-9 (DK-5 input (2)) — `doc.holders`: who holds a board LIVE now — the OTHER desktops with it open
 * in a window (the board's presence room on this device's fieldd: each peer whose lane reaches it). A
 * pack the board lacks is stamped only while none does (the enable's stamp waits). */
export const DocHoldersParams = z.object({ docId: z.string().uuid() }).passthrough();
export type DocHoldersParams = z.infer<typeof DocHoldersParams>;
export const DocHoldersResult = z
  .object({
    docId: z.string().uuid(),
    /** the peers (other desktops) with the board open now; empty when none is known */
    live: z.array(z.string()),
  })
  .passthrough();
export type DocHoldersResult = z.infer<typeof DocHoldersResult>;

/** doc.rename params — a label-only edit (the service updates name, never updatedAt). */
export const DocRenameParams = z
  .object({ docId: z.string().uuid(), name: z.string().min(1) })
  .passthrough();
export type DocRenameParams = z.infer<typeof DocRenameParams>;

/** doc.delete params (DS-5) — a TOMBSTONE in the library: the canvas leaves
 * every desktop's list and its lanes stop. The bytes stay on disk; deleting is
 * an act, and undoing one is not a settings undo (D29′ must never resurrect it). */
export const DocDeleteParams = z.object({ docId: z.string().uuid() }).passthrough();
export type DocDeleteParams = z.infer<typeof DocDeleteParams>;

/** doc.setSyncIntent params (UA-D7) — a posture edit, not a content one: the
 * service updates syncIntent and leaves updatedAt alone, exactly as rename does. */
export const DocSetSyncIntentParams = z
  .object({ docId: z.string().uuid(), intent: DocSyncIntent })
  .passthrough();
export type DocSetSyncIntentParams = z.infer<typeof DocSetSyncIntentParams>;

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

/** What a lane client may declare it can take unasked (DS-5). */
export const DOC_LANE_ACCEPTS = {
  /** `LANE_FRAME.DOC_PUSH` — live updates the host merged from a peer. */
  PUSH: "push",
} as const;

/** First frame on a lane socket. Anything else (or an invalid ticket) drops the socket. */
export const LaneHello = z
  .object({
    ticket: z.string(),
    /** DS-5 — frame capabilities the client handles unasked. Absent means none:
     * a pre-DS-5 client is never pushed to. */
    accepts: z.array(z.string()).optional(),
    /** DS-5 — this is the SAME window re-attaching after a drop (it already
     * holds what this device served it); absent or false is a new window. */
    resume: z.boolean().optional(),
  })
  .passthrough();
export type LaneHello = z.infer<typeof LaneHello>;

export const LaneHelloOk = z
  .object({
    docId: z.string().uuid(),
    hasDoc: z.boolean(),
    meta: DocMeta.optional(),
    /** DS-5 — true when fieldd will push this window live updates. */
    pushes: z.boolean().optional(),
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
     * shown to be building on the current one.
     * *Corrected 2026-10-01 (DS-5d):* docs leave epoch 0 now (the host
     * compacts them) and the renderer still declares nothing, so fieldd says
     * it for the window: an undeclared update from the window that READ the
     * doc is taken as composed against the epoch that read served — it cannot
     * have read another. One that read nothing in the daemon's life is
     * refused once the doc has been compacted, as this rule always said. */
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
