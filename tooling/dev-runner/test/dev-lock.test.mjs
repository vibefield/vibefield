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
