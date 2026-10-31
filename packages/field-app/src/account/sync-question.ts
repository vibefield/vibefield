import type { DocRegistryEntry } from "@vibefield/contracts";
import {
  type SetupLedger,
  SYNC_QUESTION_MOMENT,
  setupMomentState,
} from "@vibefield/contracts/setup";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { getRendererLogger } from "../logging";
import { retireSetupMoment, useSetupLedger } from "../setup/ledger";
import { type SyncPosture, type SyncPostureControl, useSyncPosture } from "./posture";

// TS-6 (track TS, TS-D13 = A; DESIGN.md §8 "The sync question") — the sync
// question, asked once at the first new field after connecting. fieldd owes it
// the moment a link lands, having kept every field with no answer of its own on
// this Mac (fieldd's `sync-question.ts`); the head asks it before New field
// makes the field, and its answer retires it.

/** The question is due: a link landed and nothing has answered it yet. */
export function syncQuestionOwed(ledger: SetupLedger | null): boolean {
  return ledger !== null && setupMomentState(ledger, SYNC_QUESTION_MOMENT) === "owed";
}

/** The fields the question lists: the ones staying on this Mac (a link kept the
 * ones made before it), which the person may add. */
export function earlierFields(docs: readonly DocRegistryEntry[]): DocRegistryEntry[] {
  return docs.filter((doc) => doc.syncIntent === "local" && doc.system !== true);
}

/** The head's door to the question; absent where the head has no daemon (its
 * catalog plates, its own tests), and then New field never asks. */
export interface SyncQuestionDoor {
  owed: boolean;
  posture: SyncPostureControl;
  /** The posture chosen, then the question retired. Resolves false when the
   * posture did not land (its words are `posture.writeError`): the question
   * stays, and no field is made. A refused retire is the ledger's loss, never
   * the person's: the question may be asked once more. */
  answer(posture: SyncPosture): Promise<boolean>;
}

export function useSyncQuestion(): SyncQuestionDoor {
  const client = useFielddClient();
  const ledger = useSetupLedger();
  const posture = useSyncPosture();
  return {
    owed: syncQuestionOwed(ledger),
    posture,
    answer: async (value) => {
      if (!(await posture.set(value))) return false;
      await retireSetupMoment(client, SYNC_QUESTION_MOMENT).catch((error: unknown) =>
        getRendererLogger()
          .child({ component: "sync-question" })
          .error(
            "renderer.sync_question.retire_failed",
            "The sync question was not retired",
            error,
          ),
      );
      return true;
    },
  };
}
