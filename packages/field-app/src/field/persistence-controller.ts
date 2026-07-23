import { type CanvasEngine, ENGINE_SCHEMA_VERSION } from "@vibecook/ice";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { setBoardStatus } from "../board-status";
import type { DocManager, DocSessionPending } from "../doc-manager";
import { captureDocThumbnailScene } from "../doc-thumbnail-scene";

// PersistenceController (§5.4.3): binds committed ICE document changes to the
// current doc lane and coordinates durable flush on close. Extracted VERBATIM
// from FieldView's attach effect by 3b — same autosave wiring, same lease,
// same board-status rows; the session's layout cleanup still runs this
// controller's cleanup BEFORE ce.docs.close() (unregister → stop → close).
// Autosave starts DIRTY (ice law): a seeded first-run board reaches fieldd
// after the first debounce, no user edit required.

export function bindPersistence(opts: {
  ce: CanvasEngine;
  manager: DocManager;
  pending: DocSessionPending;
  lane: DocLaneClient;
}): () => void {
  const { ce, manager, pending, lane } = opts;
  const persist = async (kind: "checkpoint" | "update", bytes: Uint8Array): Promise<void> => {
    const savedAt = Date.now();
    // Capture only durable structural state, synchronously, while this
    // engine is still alive. Rendering/encoding happens later in a worker.
    const thumbnailScene = captureDocThumbnailScene(ce);
    setBoardStatus({ state: "saving", lastSavedAt: lane.lastPutAt });
    const receipt = await (kind === "checkpoint"
      ? lane.put(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt })
      : lane.putUpdate(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt }));
    manager.thumbnailCheckpoint(pending.docId, receipt.revisionId, thumbnailScene);
    setBoardStatus({ state: "live", lastSavedAt: lane.lastPutAt });
  };
  const autosave = ce.docs.autosave({
    put: (bytes) => persist("checkpoint", bytes),
    append: (bytes) => persist("update", bytes),
  });
  const unregister = manager.registerPersistence(pending.generation, {
    flush: () => autosave.flush(),
    close: () => autosave.close(),
  });
  return () => {
    unregister();
    autosave.stop();
  };
}
