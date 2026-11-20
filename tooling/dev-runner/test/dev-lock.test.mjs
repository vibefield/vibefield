import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireDevLock, DevLockError } from "../src/dev-lock.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vf-dev-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    lockDir: join(root, "state", "runner.lock"),
    dataRoot: join(root, "data"),
  };
}

test("owns, updates, and releases an exact development lock", async (t) => {
  const paths = await fixture(t);
  const lock = await acquireDevLock({
    ...paths,
    repoRoot: paths.root,
    runnerPid: 101,
    pidAlive: () => false,
  });
  await lock.update({ electronPid: 202, buildId: "dev-test" });

  const owner = JSON.parse(await readFile(join(paths.lockDir, "owner.json"), "utf8"));
  assert.equal(owner.runnerPid, 101);
  assert.equal(owner.electronPid, 202);
  assert.equal(owner.buildId, "dev-test");

  await lock.release();
  await assert.rejects(readFile(join(paths.lockDir, "owner.json")), { code: "ENOENT" });
});

test("refuses a second live runner and safely reclaims a dead owner", async (t) => {
  const paths = await fixture(t);
  const first = await acquireDevLock({
    ...paths,
    repoRoot: paths.root,
    runnerPid: 101,
    pidAlive: () => false,
  });

  await assert.rejects(
    acquireDevLock({
      ...paths,
      repoRoot: paths.root,
      runnerPid: 202,
      pidAlive: (pid) => pid === 101,
    }),
    DevLockError,
  );

  const replacement = await acquireDevLock({
    ...paths,
    repoRoot: paths.root,
    runnerPid: 202,
    pidAlive: () => false,
  });
  assert.equal(replacement.record.runnerPid, 202);
  await first.release(); // no-op: it no longer owns the record
  await replacement.release();
});

test("refuses a live daemon even when no runner lock survived", async (t) => {
  const paths = await fixture(t);
  const runDir = join(paths.dataRoot, "fieldd", "run");
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "product.json"),
    JSON.stringify({ pid: 303, nativePid: null, buildId: "dev-old" }),
  );

  await assert.rejects(
    acquireDevLock({
      ...paths,
      repoRoot: paths.root,
      runnerPid: 404,
      pidAlive: (pid) => pid === 303,
    }),
    /live daemon pid 303/,
  );
});

test("the remedy names a command the user's shell actually has", async (t) => {
  const paths = await fixture(t);
  const runDir = join(paths.dataRoot, "fieldd", "run");
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "product.json"),
    JSON.stringify({ pid: 303, nativePid: 304, buildId: "dev-old" }),
  );

  await assert.rejects(
    acquireDevLock({
      ...paths,
      repoRoot: paths.root,
      runnerPid: 404,
      pidAlive: () => true,
      platform: "win32",
    }),
    /stop them with: taskkill \/PID 303 \/PID 304 \/F$/,
  );
});

// Item 621 (2026-11-20) — a remedy says what its stop costs before it: the pids are read from a
// record that a daemon which died without its stop leaves behind, so one may since be another
// program's, and stopping a floor ends the terminal sessions it keeps (a floor outlives its
// fieldd).
async function recordNaming(paths, product) {
  const runDir = join(paths.dataRoot, "fieldd", "run");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "product.json"), JSON.stringify({ buildId: "dev-old", ...product }));
}

test("item 621 — the remedy warns of stale pids and of a floor's sessions", async (t) => {
  const paths = await fixture(t);
  await recordNaming(paths, { pid: 303, nativePid: 304 });

  await assert.rejects(
    acquireDevLock({
      ...paths,
      repoRoot: paths.root,
      runnerPid: 404,
      pidAlive: (pid) => pid === 304,
    }),
    (error) => {
      assert.ok(error instanceof DevLockError);
      assert.match(
        error.message,
        /still has live daemon pid 304 — a previous dev session exited uncleanly; /,
      );
      assert.match(
        error.message,
        /the pids are read from fieldd's product record, which a daemon that died /,
      );
      assert.match(
        error.message,
        /so one may now belong to another program: confirm each is VibeField's /,
      );
      assert.match(
        error.message,
        /stopping field-native ends every terminal session on it; stop them with: kill 304$/,
      );
      return true;
    },
  );
});

test("item 621 — a stale runner's lock says the same before its remedy", async (t) => {
  const paths = await fixture(t);
  await mkdir(paths.lockDir, { recursive: true });
  await writeFile(
    join(paths.lockDir, "owner.json"),
    JSON.stringify({
      version: 1,
      repoRoot: paths.root,
      runnerPid: 101,
      electronPid: null,
      buildId: "dev-stale",
      startedAt: 1,
    }),
  );
  await recordNaming(paths, { pid: 303, nativePid: 304 });

  await assert.rejects(
    acquireDevLock({
      ...paths,
      repoRoot: paths.root,
      runnerPid: 404,
      pidAlive: (pid) => pid === 304,
    }),
    (error) => {
      assert.ok(error instanceof DevLockError);
      assert.match(
        error.message,
        /\(field-native pid 304\) — the previous runner is gone; the pids are read /,
      );
      assert.match(
        error.message,
        /confirm each is VibeField's before you stop it; stopping field-native ends /,
      );
      assert.match(error.message, /every terminal session on it; stop the daemons with: kill 304$/);
      return true;
    },
  );
});

test("item 621 — a record whose floor is gone warns of stale pids, not of sessions", async (t) => {
  const paths = await fixture(t);
  await recordNaming(paths, { pid: 303, nativePid: 304 });

  await assert.rejects(
    acquireDevLock({
      ...paths,
      repoRoot: paths.root,
      runnerPid: 404,
      pidAlive: (pid) => pid === 303,
    }),
    (error) => {
      assert.match(error.message, /the pids are read from fieldd's product record/);
      assert.doesNotMatch(error.message, /terminal session/);
      assert.match(error.message, /before you stop it; stop them with: kill 303$/);
      return true;
    },
  );
});

test("removes exact dead daemon run files before taking ownership", async (t) => {
  const paths = await fixture(t);
  const runDir = join(paths.dataRoot, "fieldd", "run");
  const productPath = join(runDir, "product.json");
  const tokenPath = join(runDir, "shell.token");
  await mkdir(runDir, { recursive: true });
  await writeFile(productPath, JSON.stringify({ pid: 303, nativePid: 304, buildId: "dev-old" }));
  await writeFile(tokenPath, "stale-secret");

  const lock = await acquireDevLock({
    ...paths,
    repoRoot: paths.root,
    runnerPid: 404,
    pidAlive: () => false,
  });

  await assert.rejects(readFile(productPath), { code: "ENOENT" });
  await assert.rejects(readFile(tokenPath), { code: "ENOENT" });
  await lock.release();
});

test("elects exactly one owner when two runners reclaim the same stale lock", async (t) => {
  const paths = await fixture(t);
  const pidAlive = (pid) => pid === 201 || pid === 202;

  for (let iteration = 0; iteration < 50; iteration += 1) {
    await mkdir(paths.lockDir, { recursive: true });
    await writeFile(
      join(paths.lockDir, "owner.json"),
      JSON.stringify({
        version: 1,
        repoRoot: paths.root,
        runnerPid: 101,
        electronPid: null,
        buildId: "dev-stale",
        startedAt: 1,
      }),
    );

    const results = await Promise.allSettled([
      acquireDevLock({
        ...paths,
        repoRoot: paths.root,
        runnerPid: 201,
        pidAlive,
      }),
      acquireDevLock({
        ...paths,
        repoRoot: paths.root,
        runnerPid: 202,
        pidAlive,
      }),
    ]);
    const acquired = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    assert.equal(acquired.length, 1, `iteration ${iteration} acquired ${acquired.length} locks`);
    assert.equal(refused.length, 1);
    assert.ok(refused[0].reason instanceof DevLockError);
    await acquired[0].value.release();
  }
});
