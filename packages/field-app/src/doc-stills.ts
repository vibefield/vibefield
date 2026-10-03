import { type DeskBlobStore, deskBlobs } from "./field/desk/desk-blobs";
import { getRendererLogger } from "./logging";

// THE EXPLORER'S STILLS, kept (DK-4; DK-D27 — "the explorer shows the desk"): a document's picture is
// a STILL of its desk through ICE's capture door (field/desk/desk-stills.ts takes it — at the board's
// close and once on the desk's idle after an edit settles), its PNG bytes kept on the renderer's byte
// store's KEYED shelf under the document id (DK-3's OPFS store; one picture per board, replaced in
// place), and the explorer's tile reads it as a `blob:` URL — this page's own object URL, which the
// packaged CSP's `img-src` admits for exactly that (main/security-policy.ts). A board never captured
// has no URL here, and its tile shows the explorer's placeholder face. Per device, never synced:
// another desktop's explorer shows its own stills of the board. The 2D silhouette scene and its worker
// (and their IndexedDB cache) retired with this.

/** The shelf's key for a document's still. */
export const stillKey = (docId: string): string => `still-${docId}`;

export class DocStillShelf {
  private readonly urls = new Map<string, string>();
  private readonly hydrated = new Set<string>();

  constructor(
    private readonly publish: (docId: string, url: string) => void,
    private readonly store: () => DeskBlobStore = deskBlobs,
    /** A board's still taken away (`forget`): the explorer's tile goes back to the placeholder. */
    private readonly withdraw: (docId: string) => void = () => {},
  ) {}

  /** Publish the stills this device keeps for `docIds` — each document's once per page. */
  async hydrate(docIds: readonly string[]): Promise<void> {
    const wanted = docIds.filter((docId) => docId.length > 0 && !this.hydrated.has(docId));
    for (const docId of wanted) this.hydrated.add(docId);
    await Promise.all(
      wanted.map(async (docId) => {
        const kept = await this.store().kept(stillKey(docId));
        // a still kept meanwhile by this page is newer than the one the shelf read
        if (kept !== undefined && !this.urls.has(docId)) this.publishBytes(docId, kept.bytes);
      }),
    );
  }

  /** A new still of `docId`: kept on the shelf in place of the last, and published at once. */
  async keep(docId: string, png: Uint8Array<ArrayBuffer>): Promise<void> {
    if (docId.length === 0) return;
    this.hydrated.add(docId);
    this.publishBytes(docId, png);
    try {
      await this.store().keep(stillKey(docId), png, "image/png");
    } catch (error) {
      getRendererLogger()
        .child({ component: "docs.stills", docId })
        .warn("renderer.docs.still_keep_failed", "A board's still was not kept", {
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }

  /** A board DELETED (DK-5; DK-4's open item): its still leaves the explorer and the shelf — the
   * page's URL let go and withdrawn, the kept bytes removed — and is never read back. */
  async forget(docId: string): Promise<void> {
    if (docId.length === 0) return;
    this.hydrated.add(docId);
    const url = this.urls.get(docId);
    if (url !== undefined) {
      this.urls.delete(docId);
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
      this.withdraw(docId);
    }
    await this.store().forget(stillKey(docId));
  }

  private publishBytes(docId: string, bytes: Uint8Array<ArrayBuffer>): void {
    if (typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const prior = this.urls.get(docId);
    if (prior !== undefined && typeof URL.revokeObjectURL === "function")
      URL.revokeObjectURL(prior);
    this.urls.set(docId, next);
    this.publish(docId, next);
  }
}
