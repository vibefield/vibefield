import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    studioPreloadOutput: join(source, "studio-preload.cjs"),
    fielddOutput: join(source, "fieldd.cjs"),
    serviceHarnessOutput: join(source, "service-harness.mjs"),
    fielddWasm: join(source, "loro.wasm"),
    agentShimOutput: join(source, "agent-shim.cjs"),
    filesHostOutput: join(source, "files-host.cjs"),
    milleNativeOutput: join(source, "mille.test-triple.node"),
    nativeOutput: join(source, "field-native"),
  };
  await Promise.all([
    writeFile(paths.mainOutput, "main-one"),
    writeFile(paths.preloadOutput, "preload-one"),
    writeFile(paths.studioPreloadOutput, "studio-preload-one"),
    writeFile(paths.fielddOutput, "fieldd-one"),
    writeFile(paths.serviceHarnessOutput, "harness-one"),
    writeFile(paths.fielddWasm, "wasm-one"),
    writeFile(paths.agentShimOutput, "shim-one"),
    writeFile(paths.filesHostOutput, "files-host-one"),
    writeFile(paths.milleNativeOutput, "mille-one"),
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
  assert.equal(
    await readFile(join(runtime.appRoot, "preload", "studio.cjs"), "utf8"),
    "studio-preload-one",
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
  assert.equal(await readFile(join(runtime.root, "fieldd", "agent-shim.cjs"), "utf8"), "shim-one");
  // FS-1a — the files worker and mille's engine ride beside bin.cjs
  assert.equal(
    await readFile(join(runtime.root, "fieldd", "files-host.cjs"), "utf8"),
    "files-host-one",
  );
  assert.equal(
    await readFile(join(runtime.root, "fieldd", "mille.test-triple.node"), "utf8"),
    "mille-one",
  );
  assert.equal(await readFile(runtime.nativeOutput, "utf8"), "native-one");

  await writeFile(paths.mainOutput, "main-two");
  assert.equal(await readFile(join(runtime.appRoot, "main", "index.cjs"), "utf8"), "main-one");
});

test("hands the daemon fieldd's six files, the agent shim and the files worker beside bin.cjs", async (t) => {
  // The gateway looks for `agent-shim.cjs` beside the daemon's own bundle and
  // offers no launcher without it (AR-7b), so a shim left in dist/ reaches no
  // one: the daemon runs from this directory.
  const { paths } = await fixture(t);
  const runtime = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-777777777777777777777777",
    daemonBuildId: DAEMON_ID,
  });

  assert.equal(dirname(runtime.fielddOutput), join(runtime.root, "fieldd"));
  assert.deepEqual((await readdir(join(runtime.root, "fieldd"))).sort(), [
    "agent-shim.cjs",
    "bin.cjs",
    "files-host.cjs",
    "loro_wasm_bg.wasm",
    "mille.test-triple.node",
    "service-harness.mjs",
  ]);
});

test("reclaims a snapshot staged before the shim joined it rather than reusing it", async (t) => {
  // Version 3 is the layout without `agent-shim.cjs`: served again, it would
  // hand the daemon no shim and the gateway would offer no launcher.
  const { paths } = await fixture(t);
  const buildId = "dev-888888888888888888888888";
  const destination = join(paths.runtimeRoot, buildId);
  await mkdir(join(destination, "fieldd"), { recursive: true });
  await writeFile(join(destination, "fieldd", "bin.cjs"), "fieldd-old");
  await writeFile(
    join(destination, "runtime.json"),
    `${JSON.stringify({ version: 3, buildId, daemonBuildId: DAEMON_ID, nativeName: "field-native" })}\n`,
  );

  const runtime = await stageRuntimeSnapshot({ paths, buildId, daemonBuildId: DAEMON_ID });
  assert.equal(runtime.root, destination);
  assert.equal(await readFile(runtime.fielddOutput, "utf8"), "fieldd-one");
  assert.equal(await readFile(join(runtime.root, "fieldd", "agent-shim.cjs"), "utf8"), "shim-one");
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
