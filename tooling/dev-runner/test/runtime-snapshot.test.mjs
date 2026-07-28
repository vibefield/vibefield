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

test("publishes one immutable, executable runtime generation", async (t) => {
  const { paths } = await fixture(t);
  const runtime = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-111111111111111111111111",
  });

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

test("does not publish a mixed snapshot when outputs change during staging", async (t) => {
  const { paths } = await fixture(t);
  const buildId = "dev-222222222222222222222222";
  await assert.rejects(
    stageRuntimeSnapshot({
      paths,
      buildId,
      validate: async () => false,
    }),
    RuntimeSnapshotChangedError,
  );
  await assert.rejects(access(join(paths.runtimeRoot, buildId)), { code: "ENOENT" });
});

test("prunes only completed build snapshots outside the keep set", async (t) => {
  const { paths } = await fixture(t);
  const keep = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-333333333333333333333333",
  });
  const remove = await stageRuntimeSnapshot({
    paths,
    buildId: "dev-444444444444444444444444",
  });
  const unrelated = join(paths.runtimeRoot, "manual-notes");
  await mkdir(unrelated);

  await pruneRuntimeSnapshots(paths.runtimeRoot, new Set([keep.buildId]));

  await access(keep.root);
  await access(unrelated);
  await assert.rejects(access(remove.root), { code: "ENOENT" });
});
