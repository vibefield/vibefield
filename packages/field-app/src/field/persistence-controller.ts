import { type CanvasEngine, ENGINE_SCHEMA_VERSION } from "@vibecook/ice";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { setBoardStatus } from "../board-status";
import type { DocManager, DocSessionPending } from "../doc-manager";

// PersistenceController (§5.4.3): binds committed ICE document changes to the
// current doc lane and coordinates durable flush on close. Extracted VERBATIM
// from FieldView's attach effect by 3b — same autosave wiring, same lease,
// same board-status rows; the session's layout cleanup still runs this
// controller's cleanup BEFORE ce.docs.close() (unregister → stop → close).
// Autosave starts DIRTY (ice law): a seeded first-run board reaches fieldd
// after the first debounce, no user edit required.
//
// DS-5 (§1.2 defect 2) — LIVE UPDATES. A peer desktop's edit, merged by
// fieldd's Loro-level host, arrives on this lane as a push and is applied to
// the open session. fieldd exports each push from what it can PROVE this
// window holds, so it applies with nothing pending; the autosave then
// re-journals it (ICE journals applied remote updates), which fieldd absorbs
// and takes as the next proof. A push the store refuses (strata quarantines a
// store on a pending import) leaves the board quarantined, never diverged.
//
// DK-4 (DK-D27): an acknowledged save — a local edit or a peer's, re-journaled —
// owes the board a STILL, which its desk takes once at its next rest
// (field/desk/desk-stills.ts); the 2D silhouette captured here per save retired.

export function bindPersistence(opts: {
  ce: CanvasEngine;
  manager: DocManager;
  pending: DocSessionPending;
  lane: DocLaneClient;
}): () => void {
  const { ce, manager, pending, lane } = opts;
  const persist = async (kind: "checkpoint" | "update", bytes: Uint8Array): Promise<void> => {
    const savedAt = Date.now();
    setBoardStatus({ state: "saving", lastSavedAt: lane.lastPutAt });
    await (kind === "checkpoint"
      ? lane.put(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt })
      : lane.putUpdate(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt }));
    manager.stillOwed(pending.docId);
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
  const offPush = lane.onPush((update) => {
    const session = ce.docs.current();
    if (session === undefined) return;
    try {
      session.applyRemote(update);
    } catch (error) {
      setBoardStatus({
        state: "quarantined",
        detail: `a live update was refused: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
  return () => {
    offPush();
    unregister();
    autosave.stop();
  };
}
