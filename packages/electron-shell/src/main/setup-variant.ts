import { mutateUsersFile, readLayoutStamp, readUsersFile } from "@vibefield/users";

// UA-3w — the migration backfill.
//
// A root that moved from flat-v1 gets `setupVariant: "migrated"` at mint time,
// which is what tells the Setup Assistant to ask its two-decision welcome-back
// variant instead of greeting an existing field like a new install. Roots that
// migrated BEFORE this slice existed carry no such marker — so main derives it
// once, from facts already on disk: the layout stamp says where the tree came
// from, and `onboarded: false` says setup has not happened yet.
//
// Deliberately best-effort. It runs on the boot path, it is a nicety about
// wording, and users.json is behind a lock another process may hold: a failure
// here logs and the wizard shows its full walk. Nothing about starting the app
// may depend on it.

export interface SetupVariantBackfillDeps {
  /** Best-effort by contract — main hands its users logger. */
  onEvent?: (event: string, message: string, attrs?: Record<string, unknown>) => void;
}

/** Returns true when a marker was written. Idempotent: a record that already
 * has any `setupVariant` is left exactly as it is, including one this build has
 * never heard of (tolerant reader — a newer writer's word is not ours to
 * correct). */
export async function backfillMigratedSetupVariant(
  rootReal: string,
  userId: string,
  deps: SetupVariantBackfillDeps = {},
): Promise<boolean> {
  try {
    if (readLayoutStamp(rootReal)?.previous !== "flat-v1") return false;
    const file = readUsersFile(rootReal);
    const record = file?.users.find((user) => user.userId === userId);
    if (record === undefined) return false;
    if (record.onboarded !== false) return false; // already through setup
    if (record.setupVariant !== undefined) return false;

    await mutateUsersFile(rootReal, {}, (current) => {
      const target = current.users.find((user) => user.userId === userId);
      // Re-checked under the lock: another hand may have stamped it between
      // the read above and this mutation.
      if (target === undefined || target.onboarded !== false) return;
      if (target.setupVariant !== undefined) return;
      target.setupVariant = "migrated";
    });
    deps.onEvent?.(
      "desktop.users.setup_variant_backfilled",
      "A pre-UA-3w migrated user was marked for the short setup variant",
      { userId },
    );
    return true;
  } catch (error) {
    deps.onEvent?.(
      "desktop.users.setup_variant_backfill_skipped",
      "The migrated-user marker could not be written; setup will ask its full walk",
      { userId, error: error instanceof Error ? error.message : String(error) },
    );
    return false;
  }
}
