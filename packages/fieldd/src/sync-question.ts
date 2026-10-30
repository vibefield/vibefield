import { SYNC_QUESTION_MOMENT, setupMomentState } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { DocumentService } from "./doc-service";
import type { SetupLedgerStore } from "./setup-ledger";

// TS-6 (track TS, TS-D13 = A; DESIGN.md §8 "The sync question") — the sync
// question is asked at the first new field after connecting, and the fields
// made before stay on this Mac unless the person adds them. A field with no
// answer of its own follows the user's posture (`resolveSyncIntent`), whose
// default is "automatic", and since TS-6 nothing asks the posture before a link:
// so the moment a link LANDS, before link.json is written and before the floor
// is told, each such field is kept here (`local`, the head's own act) and the
// question is owed. A Mac whose link was captured before TS-6 boots linked and
// never reaches this: it keeps what it syncs (TS-D13, VF-PM 2026-10-29 05:13Z).

export interface OweSyncQuestionDeps {
  ledger: Pick<SetupLedgerStore, "snapshot" | "owe">;
  docs: Pick<DocumentService, "list" | "syncIntentOf" | "setSyncIntent">;
  logger: Logger;
}

/** Keep the fields with no answer of their own on this Mac, and owe the
 * question — unless it was answered (or said), when the posture decides. Owed
 * FIRST: a stop between the two leaves the question owed and no link written,
 * so the next sign-in keeps the rest. A field that cannot be kept is logged and
 * the others still are; the question lists every field either way. Returns how
 * many fields it kept. */
export async function oweSyncQuestion({
  ledger,
  docs,
  logger,
}: OweSyncQuestionDeps): Promise<number> {
  const snapshot = ledger.snapshot();
  const row = snapshot.moments?.[SYNC_QUESTION_MOMENT];
  if (row !== undefined && setupMomentState(snapshot, SYNC_QUESTION_MOMENT) !== "owed") return 0;
  ledger.owe(SYNC_QUESTION_MOMENT);
  let kept = 0;
  for (const entry of docs.list()) {
    // a system document answers "sync" by law; a field's own answer stands
    if (docs.syncIntentOf(entry.docId) !== undefined) continue;
    try {
      await docs.setSyncIntent(entry.docId, "local");
      kept += 1;
    } catch (error) {
      logger.error(
        "fieldd.sync_question.keep_failed",
        "A field made before connecting could not be kept on this Mac",
        error,
        { docId: entry.docId },
      );
    }
  }
  logger.info("fieldd.sync_question.owed", "A link landed: the sync question is owed", { kept });
  return kept;
}
