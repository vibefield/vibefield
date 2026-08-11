import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UsersError } from "../src/errors";
import {
  assertUserRootBudget,
  createUser,
  mintLockedUsersFile,
  readUsersFile,
  userRootFor,
  usersFilePath,
} from "../src/users-file";

// UA-5 — createUser: mint user N under the §3.3 lock. The allocator only
// climbs, extras ride the passthrough (the wizard's setupVariant is a UI
// concern the store stays agnostic to), and the UA-D9 budget refuses BEFORE
// any directory exists, naming the socket and leaving users.json untouched.

const mkRoot = (): string => mkdtempSync(join(tmpdir(), "vf-create-"));

describe("UA-5 — createUser", () => {
  it("allocates the next fuid, persists extras, creates the root", async () => {
    const root = mkRoot();
    mintLockedUsersFile(root);
    const { user } = await createUser(
      root,
      {},
      { name: "Work", color: "accent-5", extras: { setupVariant: "second-user" } },
    );

    expect(user.fuid).toBe(2);
    expect(user.name).toBe("Work");
    expect(user.color).toBe("accent-5");
    expect(user.resident).toBe(true);
    expect(user.onboarded).toBe(false);
    expect(existsSync(userRootFor(root, user))).toBe(true);

    const onDisk = readUsersFile(root);
    expect(onDisk?.nextFuid).toBe(3);
    expect(onDisk?.users).toHaveLength(2);
    const written = JSON.parse(readFileSync(usersFilePath(root), "utf8"));
    expect(written.users[1].setupVariant).toBe("second-user");
  });

  it("never reuses a fuid across sequential creates", async () => {
    const root = mkRoot();
    mintLockedUsersFile(root);
    const a = await createUser(root, {});
    const b = await createUser(root, {});
    expect([a.user.fuid, b.user.fuid]).toEqual([2, 3]);
    expect(a.user.userId).not.toBe(b.user.userId);
  });

  it("refuses a root the new fuid would push past sun_path, leaving the file untouched", async () => {
    // suffix /users/2/native/run/termframe.sock = 34 bytes; an exactly-70-byte
    // root puts ONLY the longest socket at 104 — one past the 103 ceiling —
    // so the refusal must name termframe.sock (meshdata sits at 103, inside)
    const root = `/tmp/${"x".repeat(65)}`;
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    mintLockedUsersFile(root);
    const before = readFileSync(usersFilePath(root), "utf8");

    let caught: unknown = null;
    try {
      await createUser(root, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UsersError);
    expect((caught as UsersError).kind).toBe("user-root-too-long");
    expect((caught as UsersError).message).toContain("termframe.sock");
    expect(readFileSync(usersFilePath(root), "utf8")).toBe(before);
    expect(existsSync(join(root, "users", "2"))).toBe(false);
  });

  it("the budget is a unix law — win32 endpoints are pipes, not paths (WIN-D1)", () => {
    // same 70-byte root that just refused on darwin: pure byte math, no fs
    const root = `/tmp/${"x".repeat(65)}`;
    expect(() => assertUserRootBudget(root, 2, "win32")).not.toThrow();
    expect(() => assertUserRootBudget(root, 2, "darwin")).toThrow(UsersError);
  });
});
