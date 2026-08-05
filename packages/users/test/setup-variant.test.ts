import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalRoot, ensureUsersRoot, mutateUsersFile, readUsersFile } from "../src";

// UA-3w — the two durable facts the Setup Assistant reads before it decides
// anything: whether this user has been through setup at all, and whether their
// field arrived by migration rather than by being new.

const noSleep = { sleep: (_ms: number) => Promise.resolve() };

function freshRoot(): string {
  return canonicalRoot(mkdtempSync(join(tmpdir(), "vf-setup-variant-")));
}

/** The cheapest possible flat-v1 tree: one region present is enough for
 * detection to call the root legacy. */
function legacyRoot(): string {
  const root = freshRoot();
  mkdirSync(join(root, "docs", "doc-1"), { recursive: true });
  return root;
}

describe("the minted record's setup facts (§6)", () => {
  it("mints `onboarded: false` by default — a new user meets the wizard", async () => {
    const ensured = await ensureUsersRoot(freshRoot(), { name: "james", ...noSleep });
    expect(ensured.created).toBe(true);
    expect(ensured.user.onboarded).toBe(false);
    expect(ensured.user.setupVariant).toBeUndefined();
  });

  it("honors mintOnboarded so a test harness never meets a wizard it cannot answer", async () => {
    const ensured = await ensureUsersRoot(freshRoot(), {
      name: "james",
      mintOnboarded: true,
      ...noSleep,
    });
    expect(ensured.created).toBe(true);
    expect(ensured.user.onboarded).toBe(true);
  });

  it("marks the migrated user so the wizard asks its short variant", async () => {
    const root = legacyRoot();
    const ensured = await ensureUsersRoot(root, { name: "james", ...noSleep });
    expect(ensured.migrated).toBe(true);
    expect(ensured.user.setupVariant).toBe("migrated");
    // A moved field is not a finished setup — the user still gets asked.
    expect(ensured.user.onboarded).toBe(false);
    // And it is on DISK, not just in the returned object.
    expect(readUsersFile(root)?.users[0]?.setupVariant).toBe("migrated");
  });

  it("carries mintOnboarded through the migration path too", async () => {
    const ensured = await ensureUsersRoot(legacyRoot(), { mintOnboarded: true, ...noSleep });
    expect(ensured.migrated).toBe(true);
    expect(ensured.user.onboarded).toBe(true);
    expect(ensured.user.setupVariant).toBe("migrated");
  });

  it("survives a read-modify-write — the marker is not a field a writer may drop (UA-D10)", async () => {
    const root = legacyRoot();
    await ensureUsersRoot(root, { name: "james", ...noSleep });
    // The Account page's write path, doing something else entirely.
    await mutateUsersFile(root, {}, (file) => {
      const record = file.users[0];
      if (record !== undefined) record.onboarded = true;
    });
    const after = readUsersFile(root)?.users[0];
    expect(after?.onboarded).toBe(true);
    expect(after?.setupVariant).toBe("migrated");
  });
});
