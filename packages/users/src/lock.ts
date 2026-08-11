import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import { UsersError } from "./errors";

// The §3.3 users.json lock: root-scoped, path-derived, process-agnostic.
// O_EXCL create carrying {pid, role, startedAt}; an unreadable FRESH lock is
// live (another process can observe the file between create and the identity
// write — the segment-writer lesson), only an artifact older than 30s is
// reclaimable; a live pid is NEVER broken by force (pid reuse makes blind
// kills wrong — the dev-lock lesson). Mint additionally publishes users.json
// itself with "wx", so even a broken lock cannot double-mint (belt, §3.3.5).

export type UsersLockRole = "mint" | "mutate" | "migrate" | "attach";

export interface UsersLockDeps {
  /** poll interval + stale window are fixed law; the deadline is role-derived
   * unless a caller narrows it (lastAttached's best-effort 200ms). */
  deadlineMs?: number;
  pidAlive?: (pid: number) => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** TEST ONLY: bypass the lock file entirely — exists to prove the "wx"
   * publish keeps mint exclusive even under a broken lock. */
  unsafeSkipLock?: boolean;
}

const STALE_UNREADABLE_MS = 30_000;
const NORMAL_DEADLINE_MS = 1_500;
const MIGRATE_WAIT_DEADLINE_MS = 60_000;
const POLL_MS = 50;

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Canonicalize BEFORE deriving any path — a symlinked root must contend on
 * the same lock, not win with a second path (§3.3.1). Creates the root. */
export function canonicalRoot(root: string): string {
  try {
    mkdirSync(root, { recursive: true });
    return realpathSync(root);
  } catch (error) {
    throw new UsersError("users-unwritable", `the VibeField root is unusable: ${root}`, error);
  }
}

export function usersLockPath(rootReal: string): string {
  return join(rootReal, ...LAYOUT.USERS_LOCK);
}

export async function acquireUsersLock(
  rootReal: string,
  role: UsersLockRole,
  deps: UsersLockDeps = {},
): Promise<() => void> {
  if (deps.unsafeSkipLock === true) return () => {};
  const lockPath = usersLockPath(rootReal);
  const now = deps.now ?? Date.now;
  const pidAlive = deps.pidAlive ?? defaultPidAlive;
  const sleep = deps.sleep ?? defaultSleep;
  const started = now();
  let deadline = deps.deadlineMs ?? NORMAL_DEADLINE_MS;
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, role, startedAt: now() }), {
        flag: "wx",
        mode: 0o600,
      });
      return () => {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          /* release is best-effort; a stale lock self-heals via the pid rule */
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw new UsersError("users-unwritable", `cannot create ${lockPath}`, error);
      }
      let incumbent: { pid?: number; role?: string } | null = null;
      try {
        incumbent = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number; role?: string };
      } catch {
        incumbent = null;
      }
      let mtimeMs: number;
      try {
        mtimeMs = statSync(lockPath).mtimeMs;
      } catch {
        continue; // vanished between create-fail and inspect — retry now
      }
      const stale =
        incumbent !== null && Number.isInteger(incumbent.pid)
          ? !pidAlive(incumbent.pid as number)
          : now() - mtimeMs > STALE_UNREADABLE_MS;
      if (stale) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          /* raced another reclaimer — the retry sorts it out */
        }
        continue;
      }
      if (incumbent?.role === "migrate") {
        deadline = Math.max(deadline, MIGRATE_WAIT_DEADLINE_MS);
      }
      if (now() - started >= deadline) {
        throw new UsersError(
          "users-locked",
          `another VibeField process is using this data folder` +
            `${incumbent?.pid !== undefined ? ` (pid ${incumbent.pid}` : " (unknown owner"}` +
            `${incumbent?.role !== undefined ? `, ${incumbent.role}` : ""}). ` +
            "Quit it and try again.",
        );
      }
      await sleep(POLL_MS);
    }
  }
}

export async function withUsersLock<T>(
  rootReal: string,
  role: UsersLockRole,
  deps: UsersLockDeps,
  fn: () => Promise<T> | T,
): Promise<T> {
  const release = await acquireUsersLock(rootReal, role, deps);
  try {
    return await fn();
  } finally {
    release();
  }
}
