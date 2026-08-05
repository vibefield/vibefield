import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRoot, ensureUsersRoot, mutateUsersFile, readUsersFile } from "@vibefield/users";
import { describe, expect, it, vi } from "vitest";
import { backfillMigratedSetupVariant } from "../src/main/setup-variant";

// UA-3w — main's one-time repair for roots that migrated BEFORE the marker
// existed. It reads only facts already on disk, writes at most one field, and
// swallows everything: it decides the wording of a wizard, and nothing about
// starting the app may hang off it.

const noSleep = { sleep: (_ms: number) => Promise.resolve() };

function freshRoot(): string {
  return canonicalRoot(mkdtempSync(join(tmpdir(), "vf-backfill-")));
}

function legacyRoot(): string {
  const root = freshRoot();
  mkdirSync(join(root, "docs", "doc-1"), { recursive: true });
  return root;
}

/** A root that migrated before this slice: the stamp says flat-v1, but the
 * record carries no marker. */
async function preSliceMigratedRoot(): Promise<{ root: string; userId: string }> {
  const root = legacyRoot();
  const ensured = await ensureUsersRoot(root, { name: "james", ...noSleep });
  await mutateUsersFile(root, {}, (file) => {
    for (const user of file.users) delete (user as { setupVariant?: unknown }).setupVariant;
  });
  return { root, userId: ensured.user.userId };
}

describe("migrated setup-variant backfill", () => {
  it("stamps a root that migrated before the marker existed", async () => {
    const { root, userId } = await preSliceMigratedRoot();
    expect(readUsersFile(root)?.users[0]?.setupVariant).toBeUndefined();

    const events: string[] = [];
    expect(
      await backfillMigratedSetupVariant(root, userId, { onEvent: (e) => events.push(e) }),
    ).toBe(true);
    expect(readUsersFile(root)?.users[0]?.setupVariant).toBe("migrated");
    expect(events).toContain("desktop.users.setup_variant_backfilled");
  });

  it("is idempotent — a second pass writes nothing", async () => {
    const { root, userId } = await preSliceMigratedRoot();
    expect(await backfillMigratedSetupVariant(root, userId)).toBe(true);
    expect(await backfillMigratedSetupVariant(root, userId)).toBe(false);
  });

  it("leaves a freshly minted root alone — it did not come from anywhere", async () => {
    const root = freshRoot();
    const ensured = await ensureUsersRoot(root, { name: "james", ...noSleep });
    expect(await backfillMigratedSetupVariant(root, ensured.user.userId)).toBe(false);
    expect(readUsersFile(root)?.users[0]?.setupVariant).toBeUndefined();
  });

  it("leaves a user who already finished setup alone", async () => {
    const { root, userId } = await preSliceMigratedRoot();
    await mutateUsersFile(root, {}, (file) => {
      const record = file.users.find((user) => user.userId === userId);
      if (record !== undefined) record.onboarded = true;
    });
    expect(await backfillMigratedSetupVariant(root, userId)).toBe(false);
    expect(readUsersFile(root)?.users[0]?.setupVariant).toBeUndefined();
  });

  it("does not overwrite a variant word this build has never heard of", async () => {
    const { root, userId } = await preSliceMigratedRoot();
    await mutateUsersFile(root, {}, (file) => {
      const record = file.users.find((user) => user.userId === userId);
      if (record !== undefined) record.setupVariant = "restored-from-backup";
    });
    expect(await backfillMigratedSetupVariant(root, userId)).toBe(false);
    expect(readUsersFile(root)?.users[0]?.setupVariant).toBe("restored-from-backup");
  });

  it("reports rather than throws when the root cannot be read at all", async () => {
    const onEvent = vi.fn();
    const missing = join(freshRoot(), "not-a-root");
    await expect(backfillMigratedSetupVariant(missing, "whoever", { onEvent })).resolves.toBe(
      false,
    );
  });
});
