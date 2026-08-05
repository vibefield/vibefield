// @vibefield/users — the user directory above the per-user roots (UA-1).
// Owns: the §3.3 users.json lock, mint-if-absent, read-modify-write with
// unknown-key preservation, the flat-v1 → users-v2 migration, and the one
// ensure door both supervisors use (Electron main; fieldd's standalone entry).
// Depends on contracts only — a supervisor-package home would have made
// fieldd ⇄ fieldd-supervisor circular.

export { detectLayoutState, type EnsuredRoot, type EnsureOptions, ensureUsersRoot } from "./ensure";
export { UsersError, type UsersErrorKind } from "./errors";
export {
  acquireUsersLock,
  canonicalRoot,
  type UsersLockDeps,
  type UsersLockRole,
  usersLockPath,
  withUsersLock,
} from "./lock";
export { type MigrateOptions, migrateFlatV1, v1TopEntries } from "./migrate";
export { ulid } from "./ulid";
export {
  activeUser,
  defaultUserName,
  layoutStampPath,
  mintLockedUsersFile,
  mutateUsersFile,
  publishUsersFile,
  readLayoutStamp,
  readUsersFile,
  setLastAttached,
  userRootFor,
  usersFilePath,
  writeLayoutStamp,
} from "./users-file";
