import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  pruneRuntimeSnapshots,
  RuntimeSnapshotChangedError,
  stageRuntimeSnapshot,
} from "../src/runtime-snapshot.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vf-runtime-snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const runtimeRoot = join(root, "runtime");
  await mkdir(source, { recursive: true });
  const paths = {
    runtimeRoot,
    mainOutput: join(source, "main.cjs"),
    preloadOutput: join(source, "preload.cjs"),
    fielddOutput: join(source, "fieldd.cjs"),
    serviceHarnessOutput: join(source, "service-harness.mjs"),
    fielddWasm: join(source, "loro.wasm"),
    nativeOutput: join(source, "field-native"),
  };
  await Promise.all([
    writeFile(paths.mainOutput, "main-one"),
    writeFile(paths.preloadOutput, "preload-one"),
    writeFile(paths.fielddOutput, "fieldd-one"),
    writeFile(paths.serviceHarnessOutput, "harness-one"),
    writeFile(paths.fielddWasm, "wasm-one"),
    writeFile(paths.nativeOutput, "native-one"),
  ]);
  await chmod(paths.nativeOutput, 0o751);
  return { root, paths };
}

const DAEMON_ID = "dev-aaaaaaaaaaaaaaaaaaaaaaaa";

test("publishes one immutable, executable runtime generation", async (t) => {
  const { paths } = await fixture(t);
  const runtime = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-111111111111111111111111",
    daemonBuildId: DAEMON_ID,
  });

  assert.equal(runtime.daemonBuildId, DAEMON_ID);
  assert.equal(await readFile(join(runtime.appRoot, "main", "index.cjs"), "utf8"), "main-one");
  assert.equal(
    await readFile(join(runtime.appRoot, "preload", "index.cjs"), "utf8"),
    "preload-one",
  );
  assert.equal(await readFile(runtime.fielddOutput, "utf8"), "fieldd-one");
  assert.equal(
    await readFile(join(runtime.root, "fieldd", "service-harness.mjs"), "utf8"),
    "harness-one",
  );
  assert.equal(
    await readFile(join(runtime.root, "fieldd", "loro_wasm_bg.wasm"), "utf8"),
    "wasm-one",
  );
  assert.equal(await readFile(runtime.nativeOutput, "utf8"), "native-one");

  await writeFile(paths.mainOutput, "main-two");
  assert.equal(await readFile(join(runtime.appRoot, "main", "index.cjs"), "utf8"), "main-one");
});

test("reuses an existing snapshot and preserves its recorded daemon identity", async (t) => {
  const { paths } = await fixture(t);
  const buildId = "dev-555555555555555555555555";
  const first = await stageRuntimeSnapshot({ paths, buildId, daemonBuildId: DAEMON_ID });
  const second = await stageRuntimeSnapshot({ paths, buildId, daemonBuildId: DAEMON_ID });
  assert.equal(second.root, first.root);
  assert.equal(second.daemonBuildId, DAEMON_ID);
});

test("does not publish a mixed snapshot when outputs change during staging", async (t) => {
  const { paths } = await fixture(t);
  const buildId = "dev-222222222222222222222222";
  await assert.rejects(
    stageRuntimeSnapshot({
      paths,
      buildId,
      daemonBuildId: DAEMON_ID,
      validate: async () => false,
    }),
    RuntimeSnapshotChangedError,
  );
  await assert.rejects(access(join(paths.runtimeRoot, buildId)), { code: "ENOENT" });
});

test("reclaims a destination occupied by an unreadable older-version snapshot", async (t) => {
  const { paths } = await fixture(t);
  const buildId = "dev-666666666666666666666666";
  const destination = join(paths.runtimeRoot, buildId);
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(destination, "runtime.json"),
    `${JSON.stringify({ version: 1, buildId, nativeName: "field-native" })}\n`,
  );

  const runtime = await stageRuntimeSnapshot({ paths, buildId, daemonBuildId: DAEMON_ID });
  assert.equal(runtime.root, destination);
  assert.equal(runtime.daemonBuildId, DAEMON_ID);
  assert.equal(await readFile(runtime.fielddOutput, "utf8"), "fieldd-one");
});

test("prunes only completed build snapshots outside the keep set", async (t) => {
  const { paths } = await fixture(t);
  const keep = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-333333333333333333333333",
    daemonBuildId: DAEMON_ID,
  });
  const remove = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-444444444444444444444444",
    daemonBuildId: DAEMON_ID,
  });
  const unrelated = join(paths.runtimeRoot, "manual-notes");
  await mkdir(unrelated);

  await pruneRuntimeSnapshots(paths.runtimeRoot, new Set([keep.buildId]));

  await access(keep.root);
  await access(unrelated);
  await assert.rejects(access(remove.root), { code: "ENOENT" });
});
