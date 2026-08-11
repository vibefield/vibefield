import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** The §4.3 ladder's fixture: a legacy tree whose run file names LIVE pids.
 * seedLegacy's own product.json names a pid nobody owns, which is why the
 * ladder below it had never once executed. */
function seedLegacyWithLivePair(root: string, pids: number[]): void {
  seedLegacy(root);
  writeFileSync(
    join(root, "fieldd", "run", "product.json"),
    JSON.stringify({ port: 1, pid: pids[0], nativePid: pids[1] }),
  );
}

/** A scripted legacy pair. `honors` is the set of signals that actually end it;
 * everything the ladder sends is recorded in order. No real process is ever
 * signalled — the point is which signals the ladder DECIDES to send. */
function fakePair(pids: number[], honors: NodeJS.Signals[]) {
  const alive = new Set(pids);
  const sent: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  return {
    sent,
    killPid: (pid: number, signal: NodeJS.Signals) => {
      sent.push({ pid, signal });
      if (honors.includes(signal)) alive.delete(pid);
    },
    pidAlive: (pid: number) => alive.has(pid),
  };
}

/** The ladder's 5s TERM wait and 2s KILL wait read the REAL clock —
 * stopLegacyPair, unlike the lock, takes no `now` — so the clock is stubbed
 * here and the injected `sleep` is what advances it. The ladder then runs its
 * true iteration count in no wall-clock time, and `elapsedMs` is how a test
 * says "the KILL came after the wait" rather than assuming it. */
function stubbedClock(): { sleep: (ms: number) => Promise<void>; elapsedMs: () => number } {
  const start = Date.now();
  let now = start;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
    elapsedMs: () => now - start,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  // §4.3 — the stop ladder that runs BEFORE the first rename: TERM the legacy
  // pair, wait 5s, KILL what ignored it, wait 2s, and refuse rather than move a
  // tree out from under a process that is still writing to it. Untested on any
  // platform until now (the plan's §4.3 gap): seedLegacy's product.json names a
  // pid nobody owns, so every existing test takes the empty-`live` short circuit
  // and the whole ladder was dead code under the suite.
  describe("the legacy-pair stop ladder (§4.3)", () => {
    it("SIGTERM honored: the pair is stopped and no SIGKILL follows", async () => {
      const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-migrate-term-")));
      seedLegacyWithLivePair(root, [4242, 4243]);
      const pair = fakePair([4242, 4243], ["SIGTERM"]);
      const clock = stubbedClock();
      const events: string[] = [];

      const result = await migrateFlatV1(root, {
        killPid: pair.killPid,
        pidAlive: pair.pidAlive,
        sleep: clock.sleep,
        onEvent: (event) => events.push(event),
      });

      expect(result.migrated).toBe(true);
      expect(pair.sent).toEqual([
        { pid: 4242, signal: "SIGTERM" }, // fieldd
        { pid: 4243, signal: "SIGTERM" }, // field-native
      ]);
      expect(events).toContain("users.migrate.stopping_legacy_pair");
      // it stopped waiting the moment they were gone, not at the 5s deadline
      expect(clock.elapsedMs()).toBeLessThan(5_000);
    });

    it("SIGTERM ignored: SIGKILL follows, but only after the 5s wait", async () => {
      const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-migrate-kill-ladder-")));
      seedLegacyWithLivePair(root, [4242, 4243]);
      const pair = fakePair([4242, 4243], ["SIGKILL"]);
      const clock = stubbedClock();

      const result = await migrateFlatV1(root, {
        killPid: pair.killPid,
        pidAlive: pair.pidAlive,
        sleep: clock.sleep,
      });

      expect(result.migrated).toBe(true);
      expect(pair.sent).toEqual([
        { pid: 4242, signal: "SIGTERM" },
        { pid: 4243, signal: "SIGTERM" },
        { pid: 4242, signal: "SIGKILL" },
        { pid: 4243, signal: "SIGKILL" },
      ]);
      // the grace period is real: KILL is not the ladder's opening move
      expect(clock.elapsedMs()).toBeGreaterThanOrEqual(5_000);
    });

    it("both ignored: it refuses typed, names the pids, and moves nothing", async () => {
      const root = canonicalRoot(mkdtempSync(join(tmpdir(), "vf-migrate-unkillable-")));
      seedLegacyWithLivePair(root, [4242, 4243]);
      const pair = fakePair([4242, 4243], []); // a pair that outlives both signals
      const clock = stubbedClock();

      const refusal = await migrateFlatV1(root, {
        killPid: pair.killPid,
        pidAlive: pair.pidAlive,
        sleep: clock.sleep,
      }).then(
        () => null,
        (error: Error & { kind?: string }) => error,
      );

      expect(refusal).not.toBeNull();
      expect(refusal?.kind).toBe("users-migration-failed");
      expect(refusal?.message).toContain("live pid 4242, 4243");
      expect(pair.sent.map((s) => s.signal)).toEqual(["SIGTERM", "SIGTERM", "SIGKILL", "SIGKILL"]);
      expect(clock.elapsedMs()).toBeGreaterThanOrEqual(7_000); // 5s TERM + 2s KILL
      // and the tree is untouched: no stamp, no mint, still detected as legacy
      expect(readLayoutStamp(root)).toBeNull();
      expect(detectLayoutState(root)).toBe("legacy");
      expect(readFileSync(join(root, "docs", "doc-1", "snapshot.ice1"), "utf8")).toBe("ICE1-bytes");
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
