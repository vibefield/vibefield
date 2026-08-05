import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalRoot,
  detectLayoutState,
  ensureUsersRoot,
  migrateFlatV1,
  readLayoutStamp,
  readUsersFile,
  usersLockPath,
} from "../src";

const noSleep = { sleep: (_ms: number) => Promise.resolve() };

/** A representative flat-v1 tree: one file per §4.9 region + a stranger. */
function seedLegacy(root: string): Map<string, string> {
  const files = new Map<string, string>([
    ["docs/doc-1/snapshot.ice1", "ICE1-bytes"],
    ["registries/field.docs.v1.json", `{"docs":[]}`],
    ["fieldd/device-id", "local-abc"],
    ["fieldd/run/product.json", JSON.stringify({ port: 1, pid: 999_999_998, nativePid: null })],
    ["fieldd/settings/doc.loro", "loro-bytes"],
    ["native/pairing", "secret-hex"],
    ["native/mesh/keys.bin", "node-key"],
    ["audit/grants.2026-08.b1.jsonl", `{"a":1}\n`],
    ["artifacts/previews/x/preview.jpg", "jpeg"],
    ["plugins/installed/note/manifest.json", "{}"],
    ["crash/active-run.json", "{}"],
    ["exports/.staging/tmp1", "staged"],
  ]);
  for (const [rel, content] of files) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  writeFileSync(join(root, "stranger.txt"), "not ours"); // unknown: stays at root
  return files;
}

function inventory(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    out.set(relative(dir, abs), readFileSync(abs, "utf8"));
  }
  return out;
}

describe("flat-v1 → users-v2 migration (§4)", () => {
  it("moves the nine regions byte-identically, strangers stay, stamp lands last", async () => {
    const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-migrate-")));
    const seeded = seedLegacy(root);
    expect(detectLayoutState(root)).toBe("legacy");
    const ensured = await ensureUsersRoot(root, { name: "james", ...noSleep });
    expect(ensured.migrated).toBe(true);
    expect(ensured.user.fuid).toBe(1);
    const moved = inventory(ensured.userRoot);
    for (const [rel, content] of seeded) {
      expect(moved.get(rel), rel).toBe(content);
    }
    expect(readFileSync(join(root, "stranger.txt"), "utf8")).toBe("not ours");
    expect(readLayoutStamp(root)?.previous).toBe("flat-v1");
    expect(detectLayoutState(root)).toBe("v2");
  });

  it("is idempotent: a second run migrates nothing and keeps identity", async () => {
    const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-migrate-idem-")));
    seedLegacy(root);
    const first = await ensureUsersRoot(root, { ...noSleep });
    const second = await ensureUsersRoot(root, { ...noSleep });
    expect(second.migrated).toBe(false);
    expect(second.created).toBe(false);
    expect(second.user.userId).toBe(first.user.userId);
  });

  it("fresh install mints (previous: fresh) with no moves", async () => {
    const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-fresh-")));
    expect(detectLayoutState(root)).toBe("fresh");
    const ensured = await ensureUsersRoot(root, { name: "new", ...noSleep });
    expect(ensured.created).toBe(true);
    expect(ensured.migrated).toBe(false);
    expect(readLayoutStamp(root)?.previous).toBe("fresh");
  });

  it("a kill between two moves re-runs to convergence", async () => {
    const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-migrate-kill-")));
    const seeded = seedLegacy(root);
    let moves = 0;
    await expect(
      migrateFlatV1(root, {
        ...noSleep,
        onEntryMoved: () => {
          moves++;
          if (moves === 2) throw new Error("simulated crash between two moves");
        },
      }),
    ).rejects.toThrow("simulated crash");
    // half-moved: users.json exists, stamp absent — still detected as needing work
    expect(readLayoutStamp(root)).toBeNull();
    expect(detectLayoutState(root)).toBe("legacy");
    const ensured = await ensureUsersRoot(root, { ...noSleep });
    expect(ensured.migrated).toBe(true);
    const moved = inventory(ensured.userRoot);
    for (const [rel, content] of seeded) {
      expect(moved.get(rel), rel).toBe(content);
    }
  });

  it("migration-vs-mint race: the waiter refuses typed, then converges", async () => {
    const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-migrate-race-")));
    seedLegacy(root);
    // a live "migration" holds the lock
    writeFileSync(usersLockPath(root), JSON.stringify({ pid: process.pid, role: "migrate" }));
    let waited = 0;
    const started = Date.now();
    await expect(
      ensureUsersRoot(root, {
        pidAlive: () => true,
        now: () => started + waited,
        sleep: (_ms) => {
          waited += 20_000;
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ kind: "users-locked" });
    rmSync(usersLockPath(root)); // the migration "finishes" (releases)
    const ensured = await ensureUsersRoot(root, { ...noSleep });
    expect(ensured.migrated).toBe(true);
    expect(readUsersFile(root)?.users).toHaveLength(1);
  });

  it("smoke-injected roots refuse to mint or migrate (typed)", async () => {
    const fresh = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-nomint-")));
    await expect(ensureUsersRoot(fresh, { allowMint: false })).rejects.toMatchObject({
      kind: "users-mint-refused",
    });
    const legacy = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-nomigrate-")));
    seedLegacy(legacy);
    await expect(ensureUsersRoot(legacy, { allowMint: false })).rejects.toMatchObject({
      kind: "users-mint-refused",
    });
  });

  it("an entry present on BOTH sides refuses typed — the migration never guesses", async () => {
    const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-bothsides-")));
    seedLegacy(root);
    mkdirSync(join(root, "users", "1", "docs"), { recursive: true });
    writeFileSync(join(root, "users", "1", "docs", "impostor"), "who put this here");
    await expect(migrateFlatV1(root, { ...noSleep })).rejects.toMatchObject({
      kind: "users-migration-failed",
    });
  });
});
