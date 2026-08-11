import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import {
  LAYOUT,
  LAYOUT_VERSION,
  LayoutStamp,
  USERS_FILE_VERSION,
  type UserRecord,
  UsersFile,
} from "@vibefield/contracts";
import { UsersError } from "./errors";
import { type UsersLockDeps, withUsersLock } from "./lock";
import { ulid } from "./ulid";

export function usersFilePath(rootReal: string): string {
  return join(rootReal, ...LAYOUT.USERS_FILE);
}

export function layoutStampPath(rootReal: string): string {
  return join(rootReal, ...LAYOUT.LAYOUT_STAMP);
}

export function userRootFor(rootReal: string, record: Pick<UserRecord, "fuid">): string {
  return join(rootReal, ...LAYOUT.USERS_DIR, String(record.fuid));
}

export function defaultUserName(): string {
  try {
    const name = userInfo().username;
    return name.length > 0 ? name : "me";
  } catch {
    return "me";
  }
}

/** Tolerant-typed read: absent → null; unreadable/invalid → `users-corrupt`
 * (a typed state, never a silent re-mint over someone's identity). */
export function readUsersFile(rootReal: string): UsersFile | null {
  let raw: string;
  try {
    raw = readFileSync(usersFilePath(rootReal), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new UsersError("users-unwritable", "users.json exists but cannot be read", error);
  }
  try {
    return UsersFile.parse(JSON.parse(raw));
  } catch (error) {
    throw new UsersError(
      "users-corrupt",
      `users.json is present but unusable (${usersFilePath(rootReal)}) — repair or move it ` +
        "aside; VibeField never re-mints over an existing identity",
      error,
    );
  }
}

/** The active record: `lastAttached` when it resolves, else the first user. */
export function activeUser(file: UsersFile): UserRecord {
  const match = file.users.find((u) => u.userId === file.lastAttached) ?? file.users[0];
  if (match === undefined) {
    throw new UsersError("users-corrupt", "users.json holds no users at all");
  }
  return match;
}

/** Mutation publish: tmp + fsync(file) + rename + fsync(dir) — bare tmp+rename
 * survives a crash but not a power loss, and this file is the root identity
 * the tailscale link points at (§3.3.5). */
export function publishUsersFile(rootReal: string, file: UsersFile): void {
  const target = usersFilePath(rootReal);
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const payload = `${JSON.stringify(UsersFile.parse(file), null, 2)}\n`;
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeFileSync(fd, payload);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
    try {
      const dirFd = openSync(dirname(target), "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      /* some filesystems refuse directory fsync — the rename already landed */
    }
  } catch (error) {
    throw new UsersError("users-unwritable", `cannot publish ${target}`, error);
  }
}

export interface MintOptions {
  now?: () => number;
  name?: string;
  /** The minted record's `onboarded` (UA-3w). False is the product default —
   * a fresh user meets the §6 Setup Assistant. Test-harness supervisors mint
   * true so a smoke never opens a wizard it cannot answer. */
  onboarded?: boolean;
  /** A PASSTHROUGH marker (UA-3w), deliberately outside `UserRecord`'s schema:
   * the wizard reads it to pick its short migration variant, and no wire shape
   * depends on it. Only the flat-v1 migration sets it. */
  setupVariant?: "migrated";
  /** Fired when another writer minted first — not a failure (`mint_lost`). */
  onMintLost?: () => void;
}

/** Mint-if-absent. Caller holds the lock (or is deliberately proving the belt:
 * users.json itself publishes with "wx", so EEXIST means someone minted despite
 * everything — drop your ULID, re-read, ADOPT the winner, never retry (§3.3.5). */
export function mintLockedUsersFile(
  rootReal: string,
  opts: MintOptions = {},
): { file: UsersFile; created: boolean } {
  const existing = readUsersFile(rootReal);
  if (existing !== null) return { file: existing, created: false };
  const now = opts.now ?? Date.now;
  const at = now();
  const first: UserRecord = {
    userId: ulid(at),
    fuid: 1,
    name: opts.name ?? defaultUserName(),
    resident: true,
    onboarded: opts.onboarded ?? false,
    createdAt: new Date(at).toISOString(),
    ...(opts.setupVariant !== undefined ? { setupVariant: opts.setupVariant } : {}),
  };
  const file: UsersFile = {
    version: USERS_FILE_VERSION,
    nextFuid: 2,
    lastAttached: first.userId,
    users: [first],
  };
  try {
    writeFileSync(usersFilePath(rootReal), `${JSON.stringify(file, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new UsersError("users-unwritable", "cannot mint users.json", error);
    }
    opts.onMintLost?.();
    const winner = readUsersFile(rootReal);
    if (winner === null) {
      throw new UsersError("users-corrupt", "users.json vanished between mint races");
    }
    mkdirSync(userRootFor(rootReal, activeUser(winner)), { recursive: true });
    return { file: winner, created: false };
  }
  mkdirSync(userRootFor(rootReal, first), { recursive: true });
  return { file, created: true };
}

/** Write the layout stamp (the migration/mint commit marker) — "wx"; EEXIST
 * validates the incumbent rather than overwriting anyone's marker. */
export function writeLayoutStamp(
  rootReal: string,
  previous: "flat-v1" | "fresh",
  now: () => number = Date.now,
): void {
  const stamp = {
    layoutVersion: LAYOUT_VERSION,
    migratedAt: new Date(now()).toISOString(),
    previous,
  };
  try {
    writeFileSync(layoutStampPath(rootReal), `${JSON.stringify(stamp, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new UsersError("users-unwritable", "cannot write layout.json", error);
    }
    readLayoutStamp(rootReal); // validates; corrupt throws typed
  }
}

export function readLayoutStamp(rootReal: string): LayoutStamp | null {
  let raw: string;
  try {
    raw = readFileSync(layoutStampPath(rootReal), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new UsersError("users-unwritable", "layout.json exists but cannot be read", error);
  }
  try {
    return LayoutStamp.parse(JSON.parse(raw));
  } catch (error) {
    throw new UsersError("users-corrupt", "layout.json is present but unusable", error);
  }
}

/** Read-modify-write under the lock, preserving unknown keys (UA-D10). */
export async function mutateUsersFile(
  rootReal: string,
  deps: UsersLockDeps,
  fn: (file: UsersFile) => void,
): Promise<UsersFile> {
  return withUsersLock(rootReal, "mutate", deps, () => {
    const file = readUsersFile(rootReal);
    if (file === null) {
      throw new UsersError("users-corrupt", "users.json is absent — nothing to mutate");
    }
    fn(file);
    publishUsersFile(rootReal, file);
    return file;
  });
}

// UA-D9's mint-time assertion for CREATED users (UA-5): walk every
// socket-bearing LAYOUT row under the root the new fuid would own. The
// supervisor's spawn guard would catch the overflow later; a create refuses
// BEFORE any directory exists, naming the socket. 103 = macOS sun_path − NUL.
const SUN_PATH_MAX_BYTES = 103;

export function assertUserRootBudget(
  rootReal: string,
  fuid: number,
  platform = process.platform,
): void {
  // WIN-D1: named pipes carry no sun_path budget — the guard is a unix law
  // (see fieldd-supervisor/src/paths.ts, the spawn-time twin of this check).
  if (platform === "win32") return;
  const userRoot = join(rootReal, ...LAYOUT.USERS_DIR, String(fuid));
  for (const segments of Object.values(LAYOUT)) {
    const last = segments[segments.length - 1];
    if (typeof last !== "string" || !last.endsWith(".sock")) continue;
    const sock = join(userRoot, ...segments);
    const bytes = Buffer.byteLength(sock, "utf8");
    if (bytes > SUN_PATH_MAX_BYTES) {
      throw new UsersError(
        "user-root-too-long",
        `users/${fuid} makes ${last} ${bytes} bytes (> ${SUN_PATH_MAX_BYTES}, the OS sun_path limit): ${sock}`,
      );
    }
  }
}

export interface CreateUserOptions {
  name?: string;
  color?: string;
  now?: () => number;
  /** extra passthrough fields minted onto the record (e.g. the wizard's
   * `setupVariant: "second-user"` — a UI concern the store stays agnostic to) */
  extras?: Record<string, unknown>;
}

/** UA-5 — mint user N under the §3.3 lock. `nextFuid` allocates and never
 * reuses; `onboarded` starts false so the reloaded window runs the §6.2
 * wizard variant; the user root directory is created after publish (the
 * mintLockedUsersFile ordering). */
export async function createUser(
  rootReal: string,
  deps: UsersLockDeps,
  opts: CreateUserOptions = {},
): Promise<{ file: UsersFile; user: UserRecord }> {
  let user: UserRecord | null = null;
  const file = await mutateUsersFile(rootReal, deps, (f) => {
    assertUserRootBudget(rootReal, f.nextFuid);
    const at = (opts.now ?? Date.now)();
    const record: UserRecord = {
      userId: ulid(at),
      fuid: f.nextFuid,
      name: opts.name ?? defaultUserName(),
      ...(opts.color !== undefined ? { color: opts.color } : {}),
      resident: true,
      onboarded: false,
      createdAt: new Date(at).toISOString(),
      ...(opts.extras ?? {}),
    };
    f.nextFuid += 1;
    f.users.push(record);
    user = record;
  });
  if (user === null) throw new UsersError("users-corrupt", "create mutation did not run");
  mkdirSync(userRootFor(rootReal, user), { recursive: true });
  return { file, user };
}

/** `lastAttached` is a hint for next boot: best-effort, bounded to 200ms,
 * never blocking or interrupting a switch (§3.3 exception). */
export async function setLastAttached(
  rootReal: string,
  userId: string,
  deps: UsersLockDeps = {},
  onSkip?: (error: UsersError) => void,
): Promise<void> {
  try {
    await mutateUsersFile(rootReal, { ...deps, deadlineMs: deps.deadlineMs ?? 200 }, (file) => {
      file.lastAttached = userId;
    });
  } catch (error) {
    if (error instanceof UsersError) {
      onSkip?.(error);
      return;
    }
    throw error;
  }
}
