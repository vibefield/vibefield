import { z } from "zod";

// DS-L3 — the rows protocol (design-06 §5; `thinking-desktop-sync-plane.md`
// §6.1, ruled 2026-09-30). One algebra for every FACT table that crosses
// devices: a catalog that is KEPT when its owner sleeps (sessions, projects,
// artifacts, holders) and a live fold that is held only as its last snapshot
// (the board). It generalizes `agent-field.ts`'s snapshot/delta pair with the
// two things a durable cursor needs — an EPOCH, the source's identity for the
// table (a daemon boot, an index rebuild), and a RESUME answer — so a reader
// that kept its cursor asks for what it missed instead of the whole table.
//
// Rows are keyed `{device, id}` and a daemon never edits another device's row
// (DS-L2): a consumer holds a COPY, stamped with the owner's revision and the
// time it was last heard. Nothing here is a merge.
//
// List, then watch:
//   subscribe {since?: {epoch, revision}, minIntervalMs?}
//     → the OPEN answer is one of
//         {resumed: {epoch, revision}}            the source's journal still covers the cursor; deltas follow
//         {snapshot: {epoch, revision, rows, more?}}  a new epoch, or a cursor older than the journal: the reader REPLACES its copy
//     → later frames: delta {epoch, since, revision, upserts, removed} — only what changed —
//       or snapshot again (a reset, mid-stream: the epoch moved).
//       *2026-10-31 (PG-1d):* or on the SAME epoch at the board's current
//       revision: the field and desk boards re-present on a terminal-gate flip
//       (the reader's own revision when nothing else moved) and repair a lost
//       frame (past it). A reader replaces its copy either way, never compares.
// A reader never acks (SP-L4, the tolerant reader's own rule): a revision gap
// re-subscribes with the last cursor it applied. Drift is caught by the epoch
// in every frame and a periodic digest of row keys — a mismatch is a RESET,
// never a repair. A snapshot larger than `ROWS.SNAPSHOT_PAGE_BYTES` is paged:
// every page but the last carries `more: true`, all pages share one
// `{epoch, revision}`, and the reader applies them as one snapshot.
//
// `revision` is the TABLE's frame counter at its source, never a row's; a row
// may carry its own change stamp (as `AgentFieldRow.revision` does) and a
// reader never compares one row's stamp with another's.

/** The source's identity for a table. Opaque to readers; equality is all. */
export const RowsEpoch = z.string().min(1).max(128);
export type RowsEpoch = z.infer<typeof RowsEpoch>;

/** The table's frame counter within an epoch. Monotonic per epoch. */
export const RowsRevision = z.number().int().nonnegative();
export type RowsRevision = z.infer<typeof RowsRevision>;

/** What a reader keeps between sessions: the last frame it APPLIED. */
export const RowsCursor = z.object({ epoch: RowsEpoch, revision: RowsRevision }).passthrough();
export type RowsCursor = z.infer<typeof RowsCursor>;

/** A subscribe's options, common to every rows table. Tables add their own
 * filters beside these (a `family`, a `devices` set, …). */
export const RowsSubscribeParams = z
  .object({
    /** A kept cursor. Absent: the reader has nothing and wants a snapshot. */
    since: RowsCursor.optional(),
    /** A per-subscriber trailing-edge floor on deltas (the reader's cadence,
     * never the source's). Default `ROWS.MIN_INTERVAL_MS`. */
    minIntervalMs: z.number().int().min(16).max(60_000).optional(),
  })
  .passthrough();
export type RowsSubscribeParams = z.infer<typeof RowsSubscribeParams>;

/** The resume answer: the journal covered the cursor; nothing to replace. */
export const RowsResumed = z.object({ epoch: RowsEpoch, revision: RowsRevision }).passthrough();
export type RowsResumed = z.infer<typeof RowsResumed>;

/** A snapshot (one page of it) of rows of type `row`. */
export function rowsSnapshot<TRow extends z.ZodTypeAny>(row: TRow) {
  return z
    .object({
      epoch: RowsEpoch,
      revision: RowsRevision,
      rows: z.array(row),
      /** Another page with the same `{epoch, revision}` follows. */
      more: z.boolean().optional(),
    })
    .passthrough();
}
export type RowsSnapshot<TRow> = {
  epoch: RowsEpoch;
  revision: RowsRevision;
  rows: TRow[];
  more?: boolean | undefined;
};

/** A delta of rows of type `row`. It applies ON TOP OF `since`: a reader whose
 * copy is at `since` reaches `revision` by applying `upserts` then `removed`;
 * one at any other revision re-subscribes with its own cursor. `removed`
 * carries row KEYS (the table says which field is the key). */
export function rowsDelta<TRow extends z.ZodTypeAny>(row: TRow) {
  return z
    .object({
      epoch: RowsEpoch,
      since: RowsRevision,
      revision: RowsRevision,
      upserts: z.array(row),
      removed: z.array(z.string().min(1)),
    })
    .passthrough();
}
export type RowsDelta<TRow> = {
  epoch: RowsEpoch;
  since: RowsRevision;
  revision: RowsRevision;
  upserts: TRow[];
  removed: string[];
};

/** The OPEN answer of a rows subscription (the subscribe call's result). */
export function rowsOpen<TRow extends z.ZodTypeAny>(row: TRow) {
  return z.union([
    z.object({ resumed: RowsResumed }).passthrough(),
    z.object({ snapshot: rowsSnapshot(row) }).passthrough(),
  ]);
}

/** A later frame of a rows subscription: a delta, or a snapshot that RESETS
 * the reader's copy (the epoch moved, or a page of a paged reset). The door
 * carries which it is as the notification's kind (`.delta` / `.snapshot`);
 * this union is for readers that hold both in one channel. */
export function rowsFrame<TRow extends z.ZodTypeAny>(row: TRow) {
  return z.union([
    z.object({ delta: rowsDelta(row) }).passthrough(),
    z.object({ snapshot: rowsSnapshot(row) }).passthrough(),
  ]);
}

/** Where a table's rows are read from: this daemon's own (`local`), or every
 * self desktop the roster lists, multiplexed by this daemon (`mesh`, DS-L4).
 * A door that takes it defaults to `local` so today's callers never move. */
export const MeshScope = z.enum(["local", "mesh"]);
export type MeshScope = z.infer<typeof MeshScope>;

/** A device's standing in a mesh-scoped read (DS-L8 — asleep is a STATE):
 * `live` its stream is flowing · `stale` it has not answered within its own
 * cadence but its node is on the tailnet · `asleep` its door does not answer
 * · `incompatible` another contracts major; it is not asked (DS-L9). */
export const RowsDeviceState = z.enum(["live", "stale", "asleep", "incompatible"]);
export type RowsDeviceState = z.infer<typeof RowsDeviceState>;

/** One device's entry in a mesh-scoped open: its state, when that was last
 * true, and — when it has answered — its table. A device that has not
 * answered carries no snapshot and is still LISTED (its copy, if the reader
 * persisted one, stays). */
export function meshDeviceEntry<TRow extends z.ZodTypeAny>(row: TRow) {
  return z
    .object({
      device: z.string().min(1),
      state: RowsDeviceState,
      /** ISO-8601 — when `state` was last established. */
      asOf: z.string().min(1),
      snapshot: rowsSnapshot(row).optional(),
    })
    .passthrough();
}

/** The OPEN answer of a mesh-scoped rows subscription: every self device the
 * roster lists, each with its own epoch and revision chain. The daemon
 * MULTIPLEXES, it never re-folds (DS-D4): nothing is renumbered, nothing
 * waits behind a second coalescing stage. */
export function meshRowsOpen<TRow extends z.ZodTypeAny>(row: TRow) {
  return z.object({ devices: z.array(meshDeviceEntry(row)) }).passthrough();
}

/** A later frame of a mesh-scoped subscription: one device's delta, one
 * device's snapshot (that device's reset), or a device's state changing. */
export function meshRowsFrame<TRow extends z.ZodTypeAny>(row: TRow) {
  return z.union([
    z.object({ device: z.string().min(1), delta: rowsDelta(row) }).passthrough(),
    z.object({ device: z.string().min(1), snapshot: rowsSnapshot(row) }).passthrough(),
    z
      .object({ device: z.string().min(1), state: RowsDeviceState, asOf: z.string().min(1) })
      .passthrough(),
  ]);
}

/** A row key digest, exchanged periodically to catch drift without a
 * resend: the source's `{epoch, revision}` and a hash over its sorted keys.
 * A reader whose own digest differs at the same cursor resets. */
export const RowsDigest = z
  .object({
    epoch: RowsEpoch,
    revision: RowsRevision,
    count: z.number().int().nonnegative(),
    /** lowercase hex, `ROWS.DIGEST_ALGORITHM` over the sorted keys joined by "\n" */
    keysHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .passthrough();
export type RowsDigest = z.infer<typeof RowsDigest>;
