import {
  effectiveFaces,
  faceProblem,
  normalizeFaceEmoji,
  type UserFace,
  type UserRecord,
  type UsersFile,
  type UsersUpdateParams,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { mutateUsersFile, readUsersFile, type UsersLockDeps } from "@vibefield/users";

// UA-3/UA-7 — main's two writes to a user's profile in `users.json`. Main is the
// file's only desktop writer (UA-D10). The face policy is NOT restated here: the
// deck, the refusal list, the deal and "already worn" live in contracts
// (`user-face.ts`), which the renderer reads too, so main and the page cannot
// disagree about a face.
//
// The two appliers are pure. Each mutates the parsed file it is handed, which is
// the `mutateUsersFile` callback's shape, so the rules are judged INSIDE the §3.3
// lock against the roster as it is now, not as some earlier read saw it. The one
// async door, `dealOwedFace`, is best-effort by contract and never throws.

/** The `users:update` applier. It answers with the updated record, or throws a
 * sentence the page shows as written (`faceProblem`'s words, never a code). A
 * refusal applies NOTHING, not even a name sent in the same update: every rule is
 * judged before the record is touched, and a throw inside `mutateUsersFile`
 * publishes nothing. Unknown fields are ignored, never refused (the tolerant
 * reader). That includes the retired `color`, which an older page may still
 * send and which is no longer written. */
export function applyProfileUpdate(
  file: UsersFile,
  userId: string,
  params: UsersUpdateParams,
): UserRecord {
  const record = file.users.find((user) => user.userId === userId);
  if (record === undefined) throw new Error("the attached user vanished from users.json");
  let face: UserFace | undefined;
  if (params.face !== undefined) {
    // Stored the way it renders (`normalizeFaceEmoji`), and merged over the
    // stored face, so a key a newer build keeps there survives this build's
    // write (UA-D10: a version-skewed writer drops no newer field).
    face = { ...record.face, ...params.face, emoji: normalizeFaceEmoji(params.face.emoji) };
    const problem = faceProblem(face, userId, file.users);
    if (problem !== null) throw new Error(problem);
  }
  if (params.name !== undefined) record.name = params.name;
  if (face !== undefined) {
    record.face = face;
    // Spec §3.1: the first profile write that sets a face drops the legacy
    // accent. Only a FACE write drops it. W6 reads `color` as "pane 2 was
    // answered once" while `face` is absent, so dropping it on a name-only write
    // would send a face-less user who is still in setup back to Welcome.
    delete record.color;
  }
  if (params.resident !== undefined) record.resident = params.resident;
  if (params.onboarded !== undefined) record.onboarded = params.onboarded;
  return record;
}

/** EVERY onboarded face-less user's owed face, dealt in one pass against the
 * faces the machine shows BEFORE any is written — so nobody's face moves when
 * the deal lands, and no set-up user is left face-less for a later release to
 * drift (a user who frees a face moves the deal of every face-less user whose
 * deck walk passes it). After this, only users still in setup are dealt on the
 * fly, and theirs are proposals until pane 2 writes one. Returns what it wrote,
 * by user id. Like the single-user rule below, it leaves a legacy `color`
 * where it is: this is main's repair, not the user's own face write. */
export function applyOwedFaces(file: UsersFile): Map<string, UserFace> {
  const shown = effectiveFaces(file.users);
  const written = new Map<string, UserFace>();
  for (const record of file.users) {
    if (!record.onboarded || record.face !== undefined) continue;
    const face = shown.get(record.userId);
    if (face === undefined) continue;
    // A copy: the record owns its face, and the policy's answer is only structural.
    const copy: UserFace = { ...face.face };
    record.face = copy;
    written.set(record.userId, copy);
  }
  return written;
}

/** UA-D17, W6 as amended: the silent deal for ONE user — the rule
 * `applyOwedFaces` applies to every owed user at an attach, kept whole for the
 * tests that pin its property. A user who finished setup before
 * faces existed (onboarded, no face) is given the face the machine already
 * SHOWS for them, so a pre-v0.3 user is never sent back into the wizard for one.
 * It never deals for a user still in setup: pane 2 owns that write, and W6
 * reads an absent face as "pane 2 not yet passed". Returns the face written, or
 * null when none was owed.
 *
 * Writing a user's effective face moves nobody else's deal. The faces dealt
 * before it in `effectiveFaces`' pass never wanted it, and the ones after it
 * already held it. So the write redraws nothing, which is what makes it safe to
 * leave unawaited. It leaves a legacy `color` where it is: this is main's repair,
 * not the user's profile write. */
export function applyOwedFace(file: UsersFile, userId: string): UserFace | null {
  const record = file.users.find((user) => user.userId === userId);
  if (record === undefined || !record.onboarded || record.face !== undefined) return null;
  const shown = effectiveFaces(file.users).get(userId);
  if (shown === undefined) return null;
  // A copy: the record owns its face, and the policy's answer is only structural.
  const face: UserFace = { ...shown.face };
  record.face = face;
  return face;
}

export interface OwedFaceDeps {
  /** Best-effort by contract: main hands the logger its attach path uses. */
  readonly logger?: Pick<Logger, "info" | "warn">;
  /** Tests only: the §3.3 lock's clock and deadline. */
  readonly lock?: UsersLockDeps;
}

/** The silent deal at an attach (boot or switch). It deals EVERY face owed on
 * the machine (`applyOwedFaces`), not only the attaching user's, and answers
 * with the face written for `userId`, if one was. Best-effort like the
 * `lastAttached` hint: a failure logs a warn and resolves null. It never throws,
 * because nothing about attaching a user may hang off it. It reads first and
 * takes the lock only when a face is actually owed, so the common attach (every
 * user has a face) costs one file read and no lock round-trip. */
export async function dealOwedFace(
  rootReal: string,
  userId: string,
  deps: OwedFaceDeps = {},
): Promise<UserFace | null> {
  try {
    const owed = (readUsersFile(rootReal)?.users ?? []).some(
      (user) => user.onboarded && user.face === undefined,
    );
    if (!owed) return null;
    let written = new Map<string, UserFace>();
    await mutateUsersFile(rootReal, deps.lock ?? {}, (file) => {
      // Re-judged under the lock: pane 2 or the Account page may have written a
      // face between the read above and this mutation, and theirs wins.
      written = applyOwedFaces(file);
    });
    for (const dealtUserId of written.keys()) {
      deps.logger?.info(
        "desktop.users.face_dealt",
        "A user from before faces was given the face the machine shows for them",
        { userId: dealtUserId },
      );
    }
    return written.get(userId) ?? null;
  } catch (error) {
    deps.logger?.warn(
      "desktop.users.face_deal_skipped",
      "The silent face deal could not be written (best-effort, never blocking)",
      { userId, error: String(error) },
    );
    return null;
  }
}
