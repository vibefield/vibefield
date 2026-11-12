import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SUN_PATH_MAX_BYTES, socketPathBytes, worstUnixEndpoint } from "@vibefield/contracts";
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
import { removeWhenTestEnds, tempDir } from "./temp-dir";

// UA-5 — createUser: mint user N under the §3.3 lock. The allocator only
// climbs, extras ride the passthrough (the wizard's setupVariant is a UI
// concern the store stays agnostic to), and the UA-D9 budget refuses BEFORE
// any directory exists, naming the socket and leaving users.json untouched.
// UA-7: the mint writes no face and no colour (W6). Pane 2 writes the face.

const mkRoot = (): string => tempDir("vf-create-");

describe("UA-5 — createUser", () => {
  it("allocates the next fuid, persists extras, creates the root", async () => {
    const root = mkRoot();
    mintLockedUsersFile(root);
    const { user } = await createUser(
      root,
      {},
      { name: "Work", extras: { setupVariant: "second-user" } },
    );

    expect(user.fuid).toBe(2);
    expect(user.name).toBe("Work");
    expect(user.resident).toBe(true);
    expect(user.onboarded).toBe(false);
    expect(existsSync(userRootFor(root, user))).toBe(true);

    const onDisk = readUsersFile(root);
    expect(onDisk?.nextFuid).toBe(3);
    expect(onDisk?.users).toHaveLength(2);
    const written = JSON.parse(readFileSync(usersFilePath(root), "utf8"));
    expect(written.users[1].setupVariant).toBe("second-user");
  });

  it("mints no face and no colour, so the wizard's pane 2 still has its question (W6)", async () => {
    const root = mkRoot();
    mintLockedUsersFile(root);
    const { user } = await createUser(root, {}, { name: "Work" });

    expect(user.face).toBeUndefined();
    expect(user.color).toBeUndefined();
    const written = JSON.parse(readFileSync(usersFilePath(root), "utf8"));
    expect(Object.keys(written.users[1])).not.toContain("face");
    expect(Object.keys(written.users[1])).not.toContain("color");
  });

  it("never reuses a fuid across sequential creates", async () => {
    const root = mkRoot();
    mintLockedUsersFile(root);
    const a = await createUser(root, {});
    const b = await createUser(root, {});
    expect([a.user.fuid, b.user.fuid]).toEqual([2, 3]);
    expect(a.user.userId).not.toBe(b.user.userId);
  });

  // WIN-D1 — win32 endpoints are named pipes, not socket paths, so there is no
  // sun_path budget to blow and no refusal for createUser to raise. The byte
  // math itself stays witnessed on both platforms by the test right below.
  // Item 345 (2026-11-12): this row once REFUSED the 70-byte root, naming termframe.sock. Falsified: the cells bind
  // `termframe.<N>.sock`, and the law now carries any root over the line through `/tmp/vf-<uid>/<scope>`.
  it.skipIf(process.platform === "win32")(
    "a root whose new user's real worst overflows CREATES the user: its sockets ride the alias (item 345)",
    async () => {
      // /users/2 + the worst real file puts this 70-byte root's worst real path at 115 bytes, over the line.
      const root = `/tmp/${"x".repeat(65)}`;
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      removeWhenTestEnds(root);
      mintLockedUsersFile(root);
      const { user } = await createUser(root, {});
      expect(user.fuid).toBe(2);
      expect(existsSync(join(root, "users", "2"))).toBe(true);
      const userRoot = userRootFor(root, user);
      const uid = process.getuid?.() ?? 0;
      const worst = socketPathBytes(worstUnixEndpoint(uid, userRoot));
      expect(worst).toBeLessThanOrEqual(SUN_PATH_MAX_BYTES);
    },
  );

  it("the budget is a unix law — win32 endpoints are pipes, not paths (WIN-D1)", () => {
    // the same 70-byte root: pure byte math, no fs. It passes on darwin now (the alias), and refuses only when the
    // alias home itself is over budget (the parent seam), naming the longest cell file.
    const root = `/tmp/${"x".repeat(65)}`;
    expect(() => assertUserRootBudget(root, 2, "win32")).not.toThrow();
    expect(() => assertUserRootBudget(root, 2, "darwin")).not.toThrow();
    let caught: unknown = null;
    try {
      assertUserRootBudget(root, 2, "darwin", { aliasParent: `/tmp/${"p".repeat(80)}` });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UsersError);
    expect((caught as UsersError).kind).toBe("user-root-too-long");
    expect((caught as UsersError).message).toContain("termframe.4294967295.sock");
  });
});
