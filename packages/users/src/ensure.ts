import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT, type UserRecord, type UsersFile } from "@vibefield/contracts";
import { UsersError } from "./errors";
import { canonicalRoot, withUsersLock } from "./lock";
import { type MigrateOptions, migrateFlatV1, v1TopEntries } from "./migrate";
import {
  activeUser,
  mintLockedUsersFile,
  readLayoutStamp,
  readUsersFile,
  userRootFor,
  writeLayoutStamp,
} from "./users-file";

export type LayoutState = "fresh" | "v2" | "legacy";

/** What kind of root is this? `legacy` covers both a pristine flat-v1 tree and
 * a crashed half-migration (users/ present, stamp absent) — the migration is
 * re-runnable from either. */
export function detectLayoutState(rootReal: string): LayoutState {
  if (readLayoutStamp(rootReal) !== null) return "v2";
  const v1Present = v1TopEntries().some((entry) => existsSync(join(rootReal, entry)));
  const usersDirPresent = existsSync(join(rootReal, ...LAYOUT.USERS_DIR));
  const usersFilePresent = existsSync(join(rootReal, ...LAYOUT.USERS_FILE));
  if (v1Present || usersDirPresent || usersFilePresent) return "legacy";
  return "fresh";
}

export interface EnsureOptions extends MigrateOptions {
  /** False in smoke-like modes with an INJECTED root: "don't write someone
   * else's users.json" (§3.3). Fresh/legacy roots then refuse typed. */
  allowMint?: boolean;
}

export interface EnsuredRoot {
  /** The canonicalized VibeField root (`users.json` lives here). */
  rootReal: string;
  /** The attached user's data root — what fieldd/field-native receive. */
  userRoot: string;
  user: UserRecord;
  usersFile: UsersFile;
  stateBefore: LayoutState;
  migrated: boolean;
  created: boolean;
}

/** The one door (spec §3–§4): canonicalize → detect → migrate-or-mint under
 * the lock → resolve the attached user → return the user root. Idempotent;
 * a v2 root takes the read-only path. */
export async function ensureUsersRoot(
  root: string,
  opts: EnsureOptions = {},
): Promise<EnsuredRoot> {
  const rootReal = canonicalRoot(root);
  const stateBefore = detectLayoutState(rootReal);
  const allowMint = opts.allowMint ?? true;
  let migrated = false;
  let created = false;
  if (stateBefore === "legacy") {
    if (!allowMint) {
      throw new UsersError(
        "users-mint-refused",
        `this run may not migrate or mint into an injected root (${rootReal})`,
      );
    }
    migrated = (await migrateFlatV1(rootReal, opts)).migrated;
  } else if (stateBefore === "fresh") {
    if (!allowMint) {
      throw new UsersError(
        "users-mint-refused",
        `this run may not mint a user into an injected root (${rootReal})`,
      );
    }
    created = await withUsersLock(rootReal, "mint", opts, () => {
      const minted = mintLockedUsersFile(rootReal, {
        ...(opts.now !== undefined ? { now: opts.now } : {}),
        ...(opts.name !== undefined ? { name: opts.name } : {}),
      });
      writeLayoutStamp(rootReal, "fresh", opts.now ?? Date.now);
      return minted.created;
    });
  }
  const usersFile = readUsersFile(rootReal);
  if (usersFile === null) {
    throw new UsersError("users-corrupt", "users.json is absent on a v2 root");
  }
  const user = activeUser(usersFile);
  const userRoot = userRootFor(rootReal, user);
  mkdirSync(userRoot, { recursive: true });
  return { rootReal, userRoot, user, usersFile, stateBefore, migrated, created };
}
