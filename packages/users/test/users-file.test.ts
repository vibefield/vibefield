import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsersFile } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  canonicalRoot,
  mintLockedUsersFile,
  mutateUsersFile,
  readUsersFile,
  setLastAttached,
  ulid,
  usersFilePath,
} from "../src";

const root = () => canonicalRoot(mkdtempSync(join(tmpdir(), "vf-users-file-")));
const noSleep = { sleep: (_ms: number) => Promise.resolve() };

describe("ulid", () => {
  it("mints 26 Crockford chars with a time-ordered prefix", () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(a).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });
});

describe("mint + mutate (§3.3 publish modes)", () => {
  it("mint creates exactly one user with fuid 1, and its user root", () => {
    const r = root();
    const { file, created } = mintLockedUsersFile(r, { name: "test" });
    expect(created).toBe(true);
    expect(file.users).toHaveLength(1);
    expect(file.users[0]?.fuid).toBe(1);
    expect(file.nextFuid).toBe(2);
    expect(file.lastAttached).toBe(file.users[0]?.userId);
  });

  it('the "wx" belt keeps mint exclusive even with a BROKEN lock', () => {
    const r = root();
    let lost = 0;
    // no lock at all — two direct minters; the second must adopt, never retry
    const first = mintLockedUsersFile(r, { onMintLost: () => lost++ });
    const second = mintLockedUsersFile(r, { onMintLost: () => lost++ });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.file.users[0]?.userId).toBe(first.file.users[0]?.userId);
    expect(readUsersFile(r)?.users).toHaveLength(1);
  });

  it("corrupt users.json is a typed state, never a silent re-mint", () => {
    const r = root();
    writeFileSync(usersFilePath(r), "{ not json");
    expect(() => mintLockedUsersFile(r)).toThrowError(
      expect.objectContaining({ kind: "users-corrupt" }),
    );
  });

  it("eight concurrent mutators lose no updates", async () => {
    const r = root();
    mintLockedUsersFile(r, { name: "base" });
    await Promise.all(
      Array.from({ length: 8 }, (_v, i) =>
        mutateUsersFile(r, {}, (file) => {
          (file as Record<string, unknown>)[`edit${i}`] = i;
        }),
      ),
    );
    const final = readUsersFile(r) as unknown as Record<string, unknown>;
    for (let i = 0; i < 8; i++) expect(final[`edit${i}`]).toBe(i);
  });

  // 500 × (fsync file + fsync dir) is real disk work — budget accordingly.
  it("a 500-mutation storm never exposes a torn read", { timeout: 30_000 }, async () => {
    const r = root();
    mintLockedUsersFile(r, { name: "base" });
    let torn = 0;
    let reads = 0;
    let done = false;
    const reader = (async () => {
      while (!done) {
        try {
          UsersFile.parse(JSON.parse(readFileSync(usersFilePath(r), "utf8")));
          reads++;
        } catch {
          torn++;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    for (let i = 0; i < 500; i++) {
      await mutateUsersFile(r, noSleep, (file) => {
        const user = file.users[0];
        if (user !== undefined) user.name = `name-${i}`;
      });
    }
    done = true;
    await reader;
    expect(torn).toBe(0);
    expect(reads).toBeGreaterThan(0);
    expect(readUsersFile(r)?.users[0]?.name).toBe("name-499");
  });

  it("unknown keys survive the read-modify-write round trip (UA-D10)", async () => {
    const r = root();
    mintLockedUsersFile(r, { name: "base" });
    const seeded = JSON.parse(readFileSync(usersFilePath(r), "utf8"));
    seeded.futureTopLevel = { keep: true };
    seeded.users[0].futureUserField = "kept";
    writeFileSync(usersFilePath(r), JSON.stringify(seeded));
    await mutateUsersFile(r, {}, (file) => {
      const user = file.users[0];
      if (user !== undefined) user.name = "renamed";
    });
    const republished = JSON.parse(readFileSync(usersFilePath(r), "utf8"));
    expect(republished.futureTopLevel).toEqual({ keep: true });
    expect(republished.users[0].futureUserField).toBe("kept");
    expect(republished.users[0].name).toBe("renamed");
  });

  it("lastAttached is best-effort: a held lock skips, never throws", async () => {
    const r = root();
    mintLockedUsersFile(r, { name: "base" });
    writeFileSync(join(r, "users.json.lock"), JSON.stringify({ pid: process.pid, role: "mutate" }));
    let skipped = 0;
    await setLastAttached(r, "someone", { pidAlive: () => true, ...noSleep }, () => skipped++);
    expect(skipped).toBe(1);
  });
});
