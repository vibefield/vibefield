// DS-5 test fixture — a renderer's live document, as fieldd sees one. A plain
// LoroDoc framed by the ICE1 rule the spike proved (test/probes/ice1-envelope):
// fieldd never reads the schema, so any Loro content drives exactly the paths
// ICE's does. Two behaviors are ICE's own and are kept on purpose:
//   · `edit` exports everything since the LAST LOCAL SEND, remote ops included
//     (strata's `exportUpdatesSince(lastSentVersion)`);
//   · `apply` FAILS on a pending import, because strata quarantines a store
//     permanently on one.
import { LoroDoc, type VersionVector } from "loro-crdt";
import type { DocumentService } from "../src/doc-service";
import { liftIce1, wrapIce1 } from "../src/ice1-envelope";

export const HEADER = new TextEncoder().encode(
  JSON.stringify({ engineSchema: 2, prefabVersions: {} }),
);

export class Renderer {
  readonly doc = new LoroDoc();
  #sent: VersionVector;

  constructor(peer: bigint) {
    this.doc.setPeerId(peer);
    this.#sent = this.doc.oplogVersion();
  }

  edit(key: string, value: string): Uint8Array {
    this.doc.getMap("board").set(key, value);
    this.doc.commit();
    const bytes = this.doc.export({ mode: "update", from: this.#sent });
    this.#sent = this.doc.oplogVersion();
    return bytes;
  }

  /** A local edit that is committed and NOT sent — what ICE folds into its
   * next checkpoint when a flush beats the debounce. */
  editUnsent(key: string, value: string): void {
    this.doc.getMap("board").set(key, value);
    this.doc.commit();
    this.#sent = this.doc.oplogVersion();
  }

  checkpoint(): Uint8Array {
    return wrapIce1(HEADER, this.doc.export({ mode: "snapshot" }));
  }

  apply(bytes: Uint8Array): void {
    if (this.doc.import(bytes).pending !== null) throw new Error("quarantined: pending import");
  }

  board(): Record<string, unknown> {
    return this.doc.getMap("board").toJSON() as Record<string, unknown>;
  }
}

/** A device's at-rest doc replayed as its renderer would open it — checkpoint,
 * then every journal record — and refused if a record could not apply. */
export async function replay(docs: DocumentService, docId: string, peer = 999n): Promise<Renderer> {
  const stored = await docs.readDoc(docId);
  if (stored === null) throw new Error("nothing stored");
  const lifted = liftIce1(stored.bytes);
  if (!lifted.ok) throw new Error(`not liftable: ${lifted.reason}`);
  const r = new Renderer(peer);
  r.apply(lifted.payload);
  for (const update of stored.updates) r.apply(update);
  return r;
}
