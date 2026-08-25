import { mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireUsersLock, canonicalRoot, UsersError, usersLockPath, withUsersLock } from "../src";

const root = () => canonicalRoot(mkdtempSync(join(tmpdir(), "vf-users-lock-")));
const noSleep = (_ms: number) => Promise.resolve();

describe("the users.json lock (§3.3)", () => {
  it("stale (dead pid) is reclaimed silently", async () => {
    const r = root();
    writeFileSync(usersLockPath(r), JSON.stringify({ pid: 999_999_999, role: "mutate" }));
    const release = await acquireUsersLock(r, "mutate", {
      pidAlive: () => false,
      sleep: noSleep,
    });
    release();
  });

  it("live pid is refused typed after the deadline, and the lock survives", async () => {
    const r = root();
    writeFileSync(usersLockPath(r), JSON.stringify({ pid: process.pid, role: "mutate" }));
    await expect(
      acquireUsersLock(r, "mutate", { pidAlive: () => true, sleep: noSleep, deadlineMs: 120 }),
    ).rejects.toMatchObject({ kind: "users-locked" });
    // never broken by force: the incumbent's lock is still there
    const again = acquireUsersLock(r, "mutate", {
      pidAlive: () => true,
      sleep: noSleep,
      deadlineMs: 60,
    });
    await expect(again).rejects.toMatchObject({ kind: "users-locked" });
  });

  it("an unreadable FRESH lock is live; only >30s old is reclaimable", async () => {
    const r = root();
    writeFileSync(usersLockPath(r), ""); // zero-byte: created, identity not yet written
    await expect(
      acquireUsersLock(r, "mutate", { sleep: noSleep, deadlineMs: 100 }),
    ).rejects.toMatchObject({ kind: "users-locked" });
    // age it past the window — now it is an artifact, not a peer
    const old = (Date.now() - 31_000) / 1000;
    utimesSync(usersLockPath(r), old, old);
    const release = await acquireUsersLock(r, "mutate", { sleep: noSleep });
    release();
  });

  it("a migrate incumbent stretches the waiter's deadline", async () => {
    const r = root();
    writeFileSync(usersLockPath(r), JSON.stringify({ pid: process.pid, role: "migrate" }));
    let waited = 0;
    const started = Date.now();
    await expect(
      acquireUsersLock(r, "mutate", {
        pidAlive: () => true,
        now: () => started + waited,
        sleep: (_ms) => {
          waited += 10_000; // simulated clock: past 1.5s instantly, under 60s for a while
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ kind: "users-locked" });
    expect(waited).toBeGreaterThanOrEqual(60_000); // it honored the migrate window
  });

  // This row used to be skipped on win32 for SeCreateSymbolicLinkPrivilege,
  // which is the wrong reason: that privilege gates FILE symlinks. A DIRECTORY
  // junction needs no privilege at all, `lstat` reports it as a symbolic link,
  // and `realpathSync` resolves through it — so a junction is both plantable by
  // an ordinary account and the live win32 form of exactly this attack (two
  // paths to one root, one of them not contending on the lock). The skip was
  // withholding coverage of a vector that exists, not documenting one that does
  // not; the fixture only ever needed the right link TYPE.
  it("a symlinked root contends on the SAME lock (canonicalization)", async () => {
    const real = root();
    const linkParent = mkdtempSync(join(tmpdir(), "vf-users-link-"));
    const link = join(linkParent, "alias");
    symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
    const viaLink = canonicalRoot(link);
    expect(viaLink).toBe(realpathSync(real));
    const release = await acquireUsersLock(real, "mutate", { sleep: noSleep });
    await expect(
      acquireUsersLock(viaLink, "mutate", {
        pidAlive: () => true,
        sleep: noSleep,
        deadlineMs: 80,
      }),
    ).rejects.toMatchObject({ kind: "users-locked" });
    release();
  });

  it("withUsersLock releases on throw", async () => {
    const r = root();
    await expect(
      withUsersLock(r, "mutate", { sleep: noSleep }, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const release = await acquireUsersLock(r, "mutate", { sleep: noSleep, deadlineMs: 80 });
    release();
  });

  it("refusal is a UsersError with the incumbent pid in the message", async () => {
    const r = root();
    writeFileSync(usersLockPath(r), JSON.stringify({ pid: 4821, role: "mutate" }));
    try {
      await acquireUsersLock(r, "mutate", { pidAlive: () => true, sleep: noSleep, deadlineMs: 60 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UsersError);
      expect((error as Error).message).toContain("4821");
    }
  });
});
