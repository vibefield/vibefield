import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import { durableRename } from "@vibefield/logging";
import { UsersError } from "./errors";
import { type UsersLockDeps, withUsersLock } from "./lock";
import {
  activeUser,
  createPrivateUserDir,
  mintLockedUsersFile,
  readLayoutStamp,
  userRootFor,
  writeLayoutStamp,
} from "./users-file";

// flat-v1 → users-v2 (spec §4): supervisor-run, under the §3.3 lock with
// role "migrate" (waiters stretch their deadline to 60s), pair stopped, moves
// by rename, users.json then layout.json LAST as the commit marker. Re-runnable
// from any crash point: each entry is either moved or not, and detection
// re-fires until the stamp exists.

const NON_V1_TOPS = new Set<string>([
  LAYOUT.USERS_DIR[0],
  LAYOUT.USERS_FILE[0],
  LAYOUT.USERS_LOCK[0],
  LAYOUT.LAYOUT_STAMP[0],
]);

/** The migration's manifest IS the layout registry: the distinct first
 * segments, minus the four root-level entries that never re-root. */
export function v1TopEntries(): string[] {
  const tops = new Set<string>();
  for (const segments of Object.values(LAYOUT)) {
    const first = segments[0];
    if (first !== undefined && !NON_V1_TOPS.has(first)) tops.add(first);
  }
  return [...tops].sort();
}

export interface MigrateOptions extends UsersLockDeps {
  now?: () => number;
  name?: string;
  /** UA-3w — what a MINTED record's `onboarded` starts as. Absent means false:
   * a new user meets the §6 Setup Assistant. Only test-harness supervisors set
   * it true, and only for roots they own. Inherited by `EnsureOptions`, so the
   * mint and migrate paths honor one flag. */
  mintOnboarded?: boolean;
  onEvent?: (event: string, attrs?: Record<string, string | number>) => void;
  /** TEST ONLY: observe each landed move; throwing simulates a crash between
   * two entries — the kill-matrix convergence fixture. */
  onEntryMoved?: (entry: string) => void;
  killPid?: (pid: number, signal: NodeJS.Signals) => void;
  pidAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Stop a LIVE legacy pair before moving the tree out from under it. The
 * legacy pair's run files sit at the root itself (root == pair root in v1),
 * so LAYOUT.PRODUCT_JSON relative to the root finds them. */
async function stopLegacyPair(rootReal: string, opts: MigrateOptions): Promise<void> {
  const productPath = join(rootReal, ...LAYOUT.PRODUCT_JSON);
  let pids: number[] = [];
  try {
    const parsed = JSON.parse(readFileSync(productPath, "utf8")) as {
      pid?: unknown;
      nativePid?: unknown;
    };
    pids = [parsed.pid, parsed.nativePid].filter(
      (pid): pid is number => Number.isInteger(pid) && (pid as number) > 0,
    );
  } catch {
    return; // no run files, or unreadable — nothing to stop
  }
  const pidAlive =
    opts.pidAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    });
  const killPid =
    opts.killPid ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const live = pids.filter((pid) => pidAlive(pid));
  if (live.length === 0) return;
  opts.onEvent?.("users.migrate.stopping_legacy_pair", { pids: live.join(",") });
  for (const pid of live) {
    try {
      killPid(pid, "SIGTERM");
    } catch {
      /* exited between the liveness check and the signal */
    }
  }
  const deadlineAt = Date.now() + 5_000;
  let remaining = live;
  while (remaining.length > 0 && Date.now() < deadlineAt) {
    await sleep(100);
    remaining = remaining.filter((pid) => pidAlive(pid));
  }
  for (const pid of remaining) {
    try {
      killPid(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  const killDeadline = Date.now() + 2_000;
  while (remaining.length > 0 && Date.now() < killDeadline) {
    await sleep(100);
    remaining = remaining.filter((pid) => pidAlive(pid));
  }
  if (remaining.length > 0) {
    throw new UsersError(
      "users-migration-failed",
      `refusing to move the tree out from under live pid ${remaining.join(", ")} — stop it ` +
        "and relaunch VibeField",
    );
  }
}

export async function migrateFlatV1(
  rootReal: string,
  opts: MigrateOptions = {},
): Promise<{ migrated: boolean }> {
  return withUsersLock(rootReal, "migrate", opts, async () => {
    if (readLayoutStamp(rootReal) !== null) return { migrated: false }; // finished by another hand
    await stopLegacyPair(rootReal, opts);
    // The migrated user is not a fresh one: their field already exists, it
    // just moved under a user. UA-3w's wizard reads `setupVariant` and asks
    // its two-decision variant instead of the full first-run walk.
    const { file } = mintLockedUsersFile(rootReal, {
      ...(opts.now !== undefined ? { now: opts.now } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.mintOnboarded !== undefined ? { onboarded: opts.mintOnboarded } : {}),
      setupVariant: "migrated",
    });
    const target = userRootFor(rootReal, activeUser(file));
    await createPrivateUserDir(target);
    for (const entry of v1TopEntries()) {
      const source = join(rootReal, entry);
      if (!existsSync(source)) continue;
      const destination = join(target, entry);
      if (existsSync(destination)) {
        throw new UsersError(
          "users-migration-failed",
          `"${entry}" exists at the root AND under ${target} — merge or remove one by hand; ` +
            "the migration never guesses which is truth",
        );
      }
      // WIN-D4 — the moves are whole REGIONS (docs/, native/, fieldd/run/), and
      // on win32 a rename fails with EPERM/EACCES/EBUSY while any handle is open
      // anywhere in the destination path. A scanner touching one file would
      // otherwise abort the migration mid-tree; it is re-runnable, but a bounded
      // retry converges now instead of asking the user to relaunch.
      await durableRename(source, destination);
      opts.onEvent?.("users.migrate.entry_moved", { entry });
      opts.onEntryMoved?.(entry);
    }
    writeLayoutStamp(rootReal, "flat-v1", opts.now ?? Date.now);
    opts.onEvent?.("users.migrate.completed", { userRoot: target });
    return { migrated: true };
  });
}
