// WP12d (L3b-ii, `build-wp12-updater.md` §12 B5; the PM's ruling 2026-10-15 16:03Z) — root-key rotation, persisted
// so a same-uid writer cannot forge it (EL7). TD's rule (`trust-and-distribution.md` §1, "Rotation"): a new root
// document is signed by an OLD root key and a new one; a client holding the old set accepts it and adopts the new
// set. Before L3b-ii the adopted set lived only for one check, so the SECOND rotation was refused.
//
// What is persisted is the DOCUMENTS with their detached signatures, never bare keys. At every load the chain is
// re-verified from the app's EMBEDDED root keys, each document by the set before it, by the same rule the update chain
// applies (one of the trusted keys signs; as many of them as the document's own threshold): a planted or corrupt entry
// verifies against nothing and is dropped from the break on, loudly. The newest document that verifies anchors the
// next check.
//
// Honest limit (named, not built; James's hand-off item 7): a client offline across TWO rotations sees only the newest
// document, signed by a set it never adopted — it needs the previous documents shipped in each release, or a reinstall.

import { verifyTrustRoot } from "@vibefield/trust";

/** One adopted trust-root, as persisted: its canonical text and its detached signature. */
export interface AdoptedRoot {
  readonly version: number;
  readonly doc: string;
  readonly sig: string;
}

/** The root keys the next check trusts, and the version of the document that named them (null = the embedded set). */
export interface RootAnchor {
  readonly keys: readonly string[];
  readonly version: number | null;
}

/** At most this many adopted documents are kept: the chain must stay whole from the embedded keys, so a full store
 * adopts no more (said), rather than dropping the oldest link. Root rotations are years apart. */
export const MAX_ADOPTED_ROOTS = 16;

/** The stored chain re-verified from the embedded keys: the anchor it reaches, the entries kept, and how many were
 * dropped (from the first that does not verify by the set before it). */
export function anchorFrom(
  embedded: readonly string[],
  stored: readonly AdoptedRoot[],
): { anchor: RootAnchor; kept: AdoptedRoot[]; dropped: number } {
  let anchor: RootAnchor = { keys: embedded, version: null };
  const ordered = [...stored].sort((a, b) => a.version - b.version);
  const kept: AdoptedRoot[] = [];
  for (const entry of ordered) {
    const verdict = verifyTrustRoot(Buffer.from(entry.doc, "utf8"), entry.sig, {
      keys: anchor.keys,
      threshold: 1,
    });
    const valid =
      verdict.ok &&
      verdict.doc.version === entry.version &&
      (anchor.version === null || entry.version > anchor.version) &&
      verdict.signers.length >= verdict.doc.root.threshold;
    if (!valid) break;
    kept.push(entry);
    anchor = { keys: verdict.doc.root.keys, version: verdict.doc.version };
  }
  return { anchor, kept, dropped: ordered.length - kept.length };
}

/** Whether an accepted trust-root names a root set other than the anchor's (a rotation worth persisting). */
export function rotates(anchor: RootAnchor, rootKeys: readonly string[]): boolean {
  if (rootKeys.length !== anchor.keys.length) return true;
  const held = new Set(anchor.keys);
  return rootKeys.some((key) => !held.has(key));
}
