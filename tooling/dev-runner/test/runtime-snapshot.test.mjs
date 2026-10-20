import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { snapshotsInUse } from "../src/orphan-reaper.mjs";
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
    cellOutput: join(source, "field-terminal-host"),
    freewayOutput: join(source, "field-freeway-host"),
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
    writeFile(paths.cellOutput, "cell-one"),
    writeFile(paths.freewayOutput, "freeway-one"),
  ]);
  await chmod(paths.nativeOutput, 0o751);
  await chmod(paths.cellOutput, 0o750);
  await chmod(paths.freewayOutput, 0o710);
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

test("stages the floor's cell beside the floor, with the cell's own mode (TC-S2)", async (t) => {
  // The floor finds `field-terminal-host` as a SIBLING of its own executable
  // (field-native `config.rs` `cell_binary()`), as packaging stages it. A
  // floor staged alone has no cell, and its terminals only came from
  // FIELD_NATIVE_CELL_BIN pointing outside the snapshot.
  const { paths } = await fixture(t);
  const runtime = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-eeeeeeeeeeeeeeeeeeeeeeee",
    daemonBuildId: DAEMON_ID,
  });

  assert.equal(dirname(runtime.cellOutput), dirname(runtime.nativeOutput));
  assert.deepEqual((await readdir(join(runtime.root, "native"))).sort(), [
    "field-freeway-host",
    "field-native",
    "field-terminal-host",
  ]);
  assert.equal(await readFile(runtime.cellOutput, "utf8"), "cell-one");
  if (process.platform !== "win32") {
    assert.equal((await stat(runtime.cellOutput)).mode & 0o777, 0o750);
  }

  await writeFile(paths.cellOutput, "cell-two");
  assert.equal(await readFile(runtime.cellOutput, "utf8"), "cell-one");
});

test("stages the floor's freeway host beside the floor, with the host's own mode (F1)", async (t) => {
  // The floor finds `field-freeway-host` as a SIBLING of its own executable
  // (field-native `config.rs` `freeway_binary()`), as it finds its cell. A
  // floor staged without it says "the freeway host is not installed beside this
  // floor" and runs no freeway.
  const { paths } = await fixture(t);
  const runtime = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-cccccccccccccccccccccccc",
    daemonBuildId: DAEMON_ID,
  });

  assert.equal(dirname(runtime.freewayOutput), dirname(runtime.nativeOutput));
  assert.equal(await readFile(runtime.freewayOutput, "utf8"), "freeway-one");
  if (process.platform !== "win32") {
    assert.equal((await stat(runtime.freewayOutput)).mode & 0o777, 0o710);
  }
  const record = JSON.parse(await readFile(join(runtime.root, "runtime.json"), "utf8"));
  assert.equal(record.freewayName, "field-freeway-host");

  await writeFile(paths.freewayOutput, "freeway-two");
  assert.equal(await readFile(runtime.freewayOutput, "utf8"), "freeway-one");
});

test("reclaims a snapshot staged before the freeway host joined it rather than reusing it", async (t) => {
  // Version 6 is the layout with the floor and its cell: served again, its
  // floor would have no freeway host to start.
  const { paths } = await fixture(t);
  const buildId = "dev-dddddddddddddddddddddddd";
  const destination = join(paths.runtimeRoot, buildId);
  await mkdir(join(destination, "native"), { recursive: true });
  await writeFile(join(destination, "native", "field-native"), "native-old");
  await writeFile(join(destination, "native", "field-terminal-host"), "cell-old");
  await writeFile(
    join(destination, "runtime.json"),
    `${JSON.stringify({
      version: 6,
      buildId,
      daemonBuildId: DAEMON_ID,
      nativeName: "field-native",
      cellName: "field-terminal-host",
    })}\n`,
  );

  const runtime = await stageRuntimeSnapshot({ paths, buildId, daemonBuildId: DAEMON_ID });
  assert.equal(runtime.root, destination);
  assert.equal(await readFile(runtime.cellOutput, "utf8"), "cell-one");
  assert.equal(await readFile(runtime.freewayOutput, "utf8"), "freeway-one");
});

test("reclaims a snapshot staged before the cell joined it rather than reusing it", async (t) => {
  // Version 5 is the layout with the floor alone: served again, it would hand
  // the floor no cell to spawn its terminals from.
  const { paths } = await fixture(t);
  const buildId = "dev-ffffffffffffffffffffffff";
  const destination = join(paths.runtimeRoot, buildId);
  await mkdir(join(destination, "native"), { recursive: true });
  await writeFile(join(destination, "native", "field-native"), "native-old");
  await writeFile(
    join(destination, "runtime.json"),
    `${JSON.stringify({ version: 5, buildId, daemonBuildId: DAEMON_ID, nativeName: "field-native" })}\n`,
  );

  const runtime = await stageRuntimeSnapshot({ paths, buildId, daemonBuildId: DAEMON_ID });
  assert.equal(runtime.root, destination);
  assert.equal(await readFile(runtime.nativeOutput, "utf8"), "native-one");
  assert.equal(await readFile(runtime.cellOutput, "utf8"), "cell-one");
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

test("keeps the snapshot an adopted pair still executes from", async (t) => {
  // A shell-only restart stages a new snapshot and adopts the running pair,
  // which goes on executing out of the old one. Pruned by the current id
  // alone, the directory went from under it: fieldd's workers and the floor's
  // respawn are all spawned from there, long after the prune.
  const { paths } = await fixture(t);
  const adopted = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-999999999999999999999999",
    daemonBuildId: DAEMON_ID,
  });
  const current = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-cccccccccccccccccccccccc",
    daemonBuildId: DAEMON_ID,
  });
  const abandoned = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-dddddddddddddddddddddddd",
    daemonBuildId: DAEMON_ID,
  });
  const running = [{ pid: 4242, exePath: adopted.nativeOutput }];

  await pruneRuntimeSnapshots(
    paths.runtimeRoot,
    new Set([current.buildId, ...snapshotsInUse(running, paths.runtimeRoot)]),
  );

  await access(adopted.nativeOutput);
  await access(join(adopted.root, "fieldd", "agent-shim.cjs"));
  await access(current.root);
  await assert.rejects(access(abandoned.root), { code: "ENOENT" });
});
