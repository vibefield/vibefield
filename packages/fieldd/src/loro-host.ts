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

/** The version a FULL snapshot brings, read from its header (every peer in a
 * full snapshot is complete from counter 0, so the partial end IS its version).
 * Null for anything that is not a full snapshot. */
export function snapshotVersion(payload: Uint8Array): VersionVector | null {
  try {
    const meta = decodeImportBlobMeta(payload, false);
    return meta.mode === "snapshot" ? meta.partialEndVersionVector : null;
  } catch {
    return null;
  }
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

/** The version a blob PROVES its sender holds: a full snapshot's own version,
 * or an update's end — the most a sender could have exported it from. Null
 * for bytes that are neither. */
export function provenVersion(bytes: Uint8Array): VersionVector | null {
  try {
    const meta = decodeImportBlobMeta(bytes, false);
    if (meta.mode === "snapshot" || meta.mode === "update") return meta.partialEndVersionVector;
    return null;
  } catch {
    return null;
  }
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
