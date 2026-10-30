import { dealFace, effectiveFaces, USER_ME, type UserMeResult } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { readUsersFile } from "@vibefield/users";
import { RpcCallError } from "./native-link";

// IOS-8f (AP-D3's end state; `thinking-ios-account.md` §3) — `user.me`: who this desktop's person is, from the
// daemon's OWN user row, as its windows show it. Electron main reads the same file the same way (`rosterFor`:
// `readUsersFile` + `effectiveFaces`), so the phone's corner wears the face the Me menu wears. The read is made at
// each ask: the roster is the supervisor's to write, and a face changed in Settings is the next answer.
//
// Where there is no row to read — an embedded daemon's injected root (no `users/` above it), a missing
// `users.json`, an unreadable one, a user the file does not list — the answer is the deal the phone makes itself
// (`dealFace(userId, [])`, held to `face-deal.vector.json`) with no name, so a reader keeps the login rather than
// draw a guessed one. A daemon that serves no user id has no person: an honest UNAVAILABLE, never a face for nobody.

export function userMe(opts: {
  userId: string | undefined;
  /** the VibeField root above this user's root, or undefined when there is none */
  root: string | undefined;
  logger?: Logger;
}): UserMeResult {
  const { userId, root } = opts;
  const logger = opts.logger ?? createNoopLogger();
  if (userId === undefined || userId === "") {
    throw new RpcCallError("UNAVAILABLE", "this daemon serves no user", false, {
      service: USER_ME.SERVICE,
      state: USER_ME.STATE_NO_USER,
    });
  }
  const dealt = (): UserMeResult => ({
    userId,
    face: { emoji: dealFace(userId, []), frame: "sticker" },
    dealt: true,
  });
  if (root === undefined) return dealt();
  let users: ReturnType<typeof readUsersFile>;
  try {
    users = readUsersFile(root);
  } catch (error) {
    logger.warn(
      "fieldd.user_me.users_file_unreadable",
      "users.json could not be read; user.me answers the deal",
      {
        error: String(error),
      },
    );
    return dealt();
  }
  const row = users?.users.find((user) => user.userId === userId);
  const shown = users === null ? undefined : effectiveFaces(users.users).get(userId);
  if (row === undefined || shown === undefined) return dealt();
  // A copy, as Electron main's `applyOwedFace` makes: `FaceLike` is an interface, and the wire's passthrough shape
  // wants the index signature only an object literal carries.
  return { userId, name: row.name, face: { ...shown.face }, dealt: shown.dealt };
}
