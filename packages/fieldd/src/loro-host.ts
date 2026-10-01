import { decodeImportBlobMeta, LoroDoc, VersionVector } from "loro-crdt";

// LoroHost (DS-5, DS-D18 RULED (a); thinking-desktop-sync-plane §5.1) — fieldd
// as a Loro-level host: ONE LoroDoc per synced document — the settings
// document, the library and every sync-intent canvas — merging by version
// vector and NEVER interpreting. This file links `loro-crdt` (EL8: the tree's
// one resolution, already linked for settings) and nothing of ICE or strata;
// `test/loro-host.test.ts` greps the whole of `src/` to keep it that way. What
// B3 shape A protected still holds: fieldd knows no document schema, so an
// engine upgrade cannot break it — it only ever asks Loro "what do you hold"
// and "what does this peer lack".
//
// Why a host at all (the spike, test/probes/ice1-envelope): an opaque daemon
// can FERRY a checkpoint and cannot MERGE one, so a checkpoint whose edits live
// in no journal record never reached a desktop that already held content
// (§1.2 defect 1). A host imports it and keeps both sides' work.

/** What one import did to a hosted document. */
export interface HostImport {
  /** The oplog grew — something new was merged. */
  changed: boolean;
  /** Loro holds some of the bytes as PENDING: their causal base has not
   * arrived. Not an error and not lost — they apply when the base lands — but
   * not persisted either, because a record that cannot apply would quarantine
   * a renderer replaying it (strata's PendingImportError is permanent). */
  pending: boolean;
  /** The version before the import: `exportSince(before)` is exactly what the
   * import added, pending ops that it resolved included. */
  before: VersionVector;
}

/** The kind of Loro blob a byte string is, or null when it is not one. Cheap:
 * reads the blob's header, applies nothing. */
export function loroBlobMode(
  bytes: Uint8Array,
): "snapshot" | "shallow-snapshot" | "update" | "outdated-snapshot" | "outdated-update" | null {
  try {
    return decodeImportBlobMeta(bytes, false).mode;
  } catch {
    return null;
  }
}

/** The version a snapshot brings, read from its header (every peer in a full
 * snapshot is complete from counter 0, so the partial end IS its version).
 * Null for anything that is not a snapshot.
 *
 * DS-5d — a SHALLOW snapshot too: its partial end is the whole version as well
 * (measured on loro-crdt 1.13.8 — a peer whose every op lies below the root is
 * still named, at its full counter). A compacted canvas's base is one, and so
 * is every checkpoint ICE writes once its doc was opened from one. */
export function snapshotVersion(payload: Uint8Array): VersionVector | null {
  try {
    const meta = decodeImportBlobMeta(payload, false);
    return meta.mode === "snapshot" || meta.mode === "shallow-snapshot"
      ? meta.partialEndVersionVector
      : null;
  } catch {
    return null;
  }
}

/** DS-5d — is this payload one a host can be built from: a full snapshot, or
 * the shallow one a compaction (or a window opened on its base) writes? */
export function isSnapshotPayload(payload: Uint8Array): boolean {
  const mode = loroBlobMode(payload);
  return mode === "snapshot" || mode === "shallow-snapshot";
}

/** Does this update blob carry any change at all? `export({mode: "update",
 * from})` at the current version still yields a few header bytes. */
export function updateCarriesChanges(bytes: Uint8Array): boolean {
  try {
    return decodeImportBlobMeta(bytes, false).changeNum > 0;
  } catch {
    return false;
  }
}

/** A peer's encoded version vector, or null when the bytes are not one. */
export function decodeVersion(bytes: Uint8Array): VersionVector | null {
  try {
    return VersionVector.decode(bytes);
  } catch {
    return null;
  }
}

export const EMPTY_VERSION = (): VersionVector => new VersionVector(null);

/** base64 of the encoded version — the holders slice's `headVersion`. */
export function versionToBase64(version: VersionVector): string {
  return Buffer.from(version.encode()).toString("base64");
}

/** DS-5d — the inverse: a slice's `headVersion`/`ackVersion` back to a version,
 * or null when the string is not one (a value the watermark cannot read is a
 * holder that acknowledges nothing). */
export function versionFromBase64(text: string): VersionVector | null {
  if (text.length === 0) return null;
  return decodeVersion(new Uint8Array(Buffer.from(text, "base64")));
}

/** The per-peer maximum of two versions. A valid LOWER BOUND of what a holder
 * has when each input is: Loro applies one peer's ops in counter order, so
 * holding (peer, n) means holding every earlier op of that peer. */
export function mergeVersions(a: VersionVector, b: VersionVector): VersionVector {
  const out = new Map(a.toJSON());
  for (const [peer, counter] of b.toJSON()) {
    if ((out.get(peer) ?? 0) < counter) out.set(peer, counter);
  }
  return VersionVector.parseJSON(out);
}

/** DS-5d — the per-peer MINIMUM of two versions: what both hold (a peer one of
 * them never heard from is held by neither). The compaction watermark is this
 * meet over every known holder's acknowledgement. */
export function meetVersions(a: VersionVector, b: VersionVector): VersionVector {
  const theirs = new Map(b.toJSON());
  const out = new Map<`${number}`, number>();
  for (const [peer, counter] of a.toJSON()) {
    const both = Math.min(counter, theirs.get(peer) ?? 0);
    if (both > 0) out.set(peer, both);
  }
  return VersionVector.parseJSON(out);
}

/** The version a blob PROVES its sender holds: a snapshot's own version
 * (DS-5d: a shallow one's too), or an update's end — the most a sender could
 * have exported it from. Null for bytes that are neither. */
export function provenVersion(bytes: Uint8Array): VersionVector | null {
  try {
    const meta = decodeImportBlobMeta(bytes, false);
    if (meta.mode === "snapshot" || meta.mode === "shallow-snapshot" || meta.mode === "update") {
      return meta.partialEndVersionVector;
    }
    return null;
  } catch {
    return null;
  }
}

/** DS-5d — one holder of a canvas, as the compaction watermark reads it. */
export interface HolderAck {
  /** Its roster deviceId (the holders slice's owner key). */
  device: string;
  /** The version it acknowledges (DocHolding.ackVersion, else headVersion);
   * null when it states none it can be held to (opaque custody, a value that
   * does not decode). */
  ack: VersionVector | null;
  /** When it was last heard, ms since epoch — NOW while its slice is live. */
  seenAt: number;
}

export type Watermark =
  | {
      ok: true;
      /** The meet: no known holder lacks anything at or below it. */
      version: VersionVector;
      /** The holders it waited for, sorted. */
      counted: string[];
      /** Holders unseen past the horizon — not waited for (DS-D17), sorted. */
      retired: string[];
    }
  | {
      ok: false;
      /** `unacknowledged`: a known holder states no version it can be held
       * to — nothing is trimmed under an unknown. `ahead-of-here`: a holder
       * acknowledges ops this desktop does not hold; they may be concurrent
       * with anything this desktop would fold into its base, so it waits until
       * they arrive. */
      reason: "unacknowledged" | "ahead-of-here";
      device: string;
      retired: string[];
    };

/** DS-5d (design-06 §4) — THE WATERMARK: the meet of this desktop's own version
 * and every known holder's acknowledgement; a holder unseen for more than
 * `retirementMs` (DOC_HOST.RETIREMENT_MS, DS-D17) is not waited for. A trim at
 * or below it cuts under nothing any holder still has to send: each holder's
 * next op descends from what it acknowledged. */
export function watermark(
  own: VersionVector,
  holders: readonly HolderAck[],
  now: number,
  retirementMs: number,
): Watermark {
  let version = own;
  const counted: string[] = [];
  const retired: string[] = [];
  for (const holder of [...holders].sort((a, b) => a.device.localeCompare(b.device))) {
    if (now - holder.seenAt > retirementMs) {
      retired.push(holder.device);
      continue;
    }
    // The empty version acknowledges nothing (an open window its desktop
    // cannot vouch for): the same unknown as no version at all.
    if (holder.ack === null || holder.ack.length() === 0) {
      return { ok: false, reason: "unacknowledged", device: holder.device, retired };
    }
    if (!covers(own, holder.ack)) {
      return { ok: false, reason: "ahead-of-here", device: holder.device, retired };
    }
    version = meetVersions(version, holder.ack);
    counted.push(holder.device);
  }
  return { ok: true, version, counted, retired };
}

/** Does `ours` hold everything `theirs` names? (Equal or strictly ahead.) */
export function covers(ours: VersionVector, theirs: VersionVector): boolean {
  const order = ours.compare(theirs);
  return order === 0 || order === 1;
}

/** One document the host merges. The LoroDoc is exposed for the two system
 * documents whose owners commit to it directly (settings, library); a canvas's
 * doc is only ever imported into and exported from. */
export class HostedDoc {
  readonly doc: LoroDoc;
  /** DS-5c — ops this doc holds PENDING (their causal base has not arrived):
   * per peer, the counter its pending span ends at (exclusive, the version
   * vector's own unit). The one thing a host holds that disk never does —
   * nothing pending is persisted — so a doc holding any is never evicted. */
  readonly #pending = new Map<`${number}`, number>();

  constructor(
    readonly docId: string,
    doc?: LoroDoc,
  ) {
    this.doc = doc ?? new LoroDoc();
  }

  /** DS-5c — does this doc hold ops whose base has not arrived? */
  hasPending(): boolean {
    return this.#pending.size > 0;
  }

  version(): VersionVector {
    return this.doc.oplogVersion();
  }

  encodedVersion(): Uint8Array {
    return this.doc.oplogVersion().encode();
  }

  isEmpty(): boolean {
    return this.doc.oplogVersion().length() === 0;
  }

  /** Merge bytes of any Loro species. THROWS on bytes Loro cannot decode —
   * the caller decides whether that is a peer's fault or a storage fault. */
  import(bytes: Uint8Array): HostImport {
    const before = this.doc.oplogVersion();
    const status = this.doc.import(bytes);
    for (const [peer, span] of status.pending ?? []) {
      this.#pending.set(peer, Math.max(this.#pending.get(peer) ?? 0, span.end));
    }
    // Every import may resolve what an earlier one left pending (the base it
    // waited for); the version says which spans are whole now.
    if (this.#pending.size > 0) {
      const version = this.doc.oplogVersion();
      for (const [peer, end] of this.#pending) {
        if ((version.get(peer) ?? 0) >= end) this.#pending.delete(peer);
      }
    }
    return {
      changed: this.doc.oplogVersion().compare(before) !== 0,
      pending: status.pending !== null,
      before,
    };
  }

  /** Exactly what a holder at `from` lacks. */
  exportSince(from: VersionVector): Uint8Array {
    return this.doc.export({ mode: "update", from });
  }

  /** Does this doc hold anything `theirs` does not? */
  isAheadOf(theirs: VersionVector): boolean {
    return !covers(theirs, this.doc.oplogVersion());
  }

  /** Does this doc hold everything `theirs` names? */
  holdsAll(theirs: VersionVector): boolean {
    return covers(this.doc.oplogVersion(), theirs);
  }

  // ---- DS-5d — compaction ----

  /** Was this doc loaded from a shallow snapshot (a compacted base)? */
  isShallow(): boolean {
    return this.doc.isShallow();
  }

  /** The version its history starts AT — its root, inclusive: everything at
   * or below it lives in the state alone. Empty for a doc with whole history. */
  rootVersion(): VersionVector {
    if (!this.doc.isShallow()) return EMPTY_VERSION();
    return this.doc.frontiersToVV(this.doc.shallowSinceFrontiers());
  }

  /** Can a holder at `theirs` be answered with a delta? Loro answers an export
   * "from" below a shallow doc's root FROM THE ROOT (measured), so a holder
   * that lacks the root would be sent ops whose base it can never get — a
   * window would be quarantined, a host would hold them pending for good. */
  canAnswer(theirs: VersionVector): boolean {
    return covers(theirs, this.rootVersion());
  }

  /** A shallow snapshot at `at` — the base of the next epoch — TRIAL-LOADED
   * into a fresh doc before anyone may keep it. The trial is the point: when
   * this doc holds an op concurrent with `at` (an op not in `at` whose base
   * does not include all of it), loro-crdt 1.13.8 exports a base that no doc
   * can import ("You cannot switch a document to a version before the shallow
   * history's start version"). A base the trial loads, at exactly this doc's
   * version, is the one returned — with the doc it loaded into, which IS the
   * compacted host. Nothing here touches this doc. */
  compactTo(
    at: VersionVector,
  ):
    | { ok: true; bytes: Uint8Array; doc: LoroDoc }
    | { ok: false; reason: "not-held" | "unloadable" | "lost-ops"; detail?: string } {
    if (!covers(this.doc.oplogVersion(), at)) return { ok: false, reason: "not-held" };
    let bytes: Uint8Array;
    try {
      bytes = this.doc.export({ mode: "shallow-snapshot", frontiers: this.doc.vvToFrontiers(at) });
    } catch (error) {
      return { ok: false, reason: "unloadable", detail: String(error) };
    }
    const trial = new LoroDoc();
    try {
      trial.import(bytes);
    } catch (error) {
      return { ok: false, reason: "unloadable", detail: String(error) };
    }
    if (trial.oplogVersion().compare(this.doc.oplogVersion()) !== 0) {
      return { ok: false, reason: "lost-ops" };
    }
    return { ok: true, bytes, doc: trial };
  }
}

/** DS-5d — S4, THE RE-BOOTSTRAP's carry. `payload` is a fresh holder's base
 * (a full or shallow snapshot, at a newer epoch); `old` is what this desktop
 * held at its older one. The new host is the base plus every op of `old` the
 * base can take — the RESIDUAL, one update from the base's version. An op
 * whose own base lies below the new root cannot be taken: it was made
 * concurrent with history the base folded, and design-06 §4 names it the
 * known loss (the watermark exists so that a holder it waited for has none).
 * What it cannot take is salvaged per peer, so one such op does not cost the
 * rest. Every trial runs in a THROWAWAY doc, because on loro-crdt 1.13.8 such
 * an import panics the doc it runs in; the doc returned is rebuilt clean from
 * exactly base + residual — what will be persisted. */
export function rebaseOnto(
  payload: Uint8Array,
  old: HostedDoc | null,
):
  | { ok: true; doc: LoroDoc; residual: Uint8Array | null; lostOps: number; lostPeers: string[] }
  | { ok: false } {
  const load = (extra: readonly Uint8Array[]): LoroDoc | null => {
    const doc = new LoroDoc();
    try {
      doc.import(payload);
      for (const bytes of extra) doc.import(bytes);
      return doc;
    } catch {
      return null; // a refusal, or a panic that leaves `doc` dead: either way, not this one
    }
  };
  const exported = (make: () => Uint8Array): Uint8Array | null => {
    try {
      return make();
    } catch {
      return null;
    }
  };
  const base = load([]);
  if (base === null) return { ok: false };
  const baseVersion = base.oplogVersion();
  if (old === null || !old.isAheadOf(baseVersion)) {
    return { ok: true, doc: base, residual: null, lostOps: 0, lostPeers: [] };
  }
  let kept: Uint8Array[] = [];
  const whole = exported(() => old.exportSince(baseVersion));
  let carried = whole === null ? null : load([whole]);
  if (carried !== null && whole !== null) {
    kept = [whole];
  } else {
    for (const [peer, end] of old.version().toJSON()) {
      const start = baseVersion.get(peer) ?? 0;
      if (end <= start) continue;
      const span = exported(() =>
        old.doc.export({
          mode: "updates-in-range",
          spans: [{ id: { peer, counter: start }, len: end - start }],
        }),
      );
      if (span !== null && load([...kept, span]) !== null) kept.push(span);
    }
    carried = load(kept);
    if (carried === null) {
      kept = [];
      carried = base;
    }
  }
  const residual = covers(baseVersion, carried.oplogVersion())
    ? null
    : carried.export({ mode: "update", from: baseVersion });
  // What `old` held that the carry did not land — ops that never applied
  // (pending on a lost base included) are the loss, counted per peer.
  const landed = carried.oplogVersion();
  let lostOps = 0;
  const lostPeers: string[] = [];
  for (const [peer, end] of old.version().toJSON()) {
    const have = landed.get(peer) ?? 0;
    if (have < end) {
      lostOps += end - have;
      lostPeers.push(String(peer));
    }
  }
  const clean = load(residual === null ? [] : [residual]);
  if (clean === null) return { ok: true, doc: base, residual: null, lostOps, lostPeers };
  return { ok: true, doc: clean, residual, lostOps, lostPeers: lostPeers.sort() };
}

/** DS-5d — did this throw come from a PANIC inside loro-crdt's wasm (a trap,
 * `RuntimeError: unreachable`) rather than one of Loro's own refusals? Measured
 * on 1.13.8: importing into a shallow doc an op whose base lies below its root
 * panics in several shapes, and the doc it panicked in holds its lock for good
 * — every later call on it throws. Other docs stay usable. */
export function isLoroPanic(error: unknown): boolean {
  return error instanceof Error && error.name === "RuntimeError";
}

/** The host: the hosted documents by id. Deliberately thin — persistence is
 * the owning service's (DocumentService for canvases, each system document's
 * own service), and routing is DocSyncService's. What lives here is the one
 * question every one of them asks: which LoroDoc is this document? */
export class LoroHost {
  readonly #docs = new Map<string, HostedDoc>();

  get(docId: string): HostedDoc | undefined {
    return this.#docs.get(docId);
  }

  set(hosted: HostedDoc): HostedDoc {
    this.#docs.set(hosted.docId, hosted);
    return hosted;
  }

  delete(docId: string): void {
    this.#docs.delete(docId);
  }

  ids(): string[] {
    return [...this.#docs.keys()];
  }
}
