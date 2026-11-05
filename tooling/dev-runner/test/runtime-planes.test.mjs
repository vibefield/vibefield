import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeBuildId } from "../src/build-id.mjs";
import { daemonPlaneInputs, shellPlaneInputs } from "../src/runtime-planes.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vf-dev-cell-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = {
    repoRoot: root,
    mainOutput: join(root, "main.cjs"),
    soundWorkerOutput: join(root, "sound-worker.cjs"),
    preloadOutput: join(root, "preload.cjs"),
    studioPreloadOutput: join(root, "studio.cjs"),
    fielddOutput: join(root, "bin.cjs"),
    serviceHarnessOutput: join(root, "service-harness.mjs"),
    fielddWasm: join(root, "loro_wasm_bg.wasm"),
    agentShimOutput: join(root, "agent-shim.cjs"),
    filesHostOutput: join(root, "files-host.cjs"),
    milleNativeOutput: join(root, "mille.test-triple.node"),
    nativeOutput: join(root, "field-native"),
    cellOutput: join(root, "field-terminal-host"),
    freewayOutput: join(root, "field-freeway-host"),
  };
  return { paths, daemonIdentity: () => computeBuildId(root, daemonPlaneInputs(paths, [])) };
}

test("a rebuilt cell moves the daemon identity, so the pair restarts as for the floor (TC-S2)", async (t) => {
  // The floor spawns its cell beside itself for every terminal, and a
  // shell-only restart adopts the running pair: a cell only the shell's
  // identity covered would reach no floor at all, or land under an old one.
  const { paths, daemonIdentity } = await fixture(t);

  await writeFile(paths.cellOutput, "cell-one");
  const before = await daemonIdentity();
  await writeFile(paths.cellOutput, "cell-two");
  assert.notEqual(await daemonIdentity(), before);
  assert.equal(shellPlaneInputs(paths).includes(paths.cellOutput), false);
});

test("a rebuilt freeway host moves the daemon identity, as the cell does (F1)", async (t) => {
  // The floor starts its freeway host beside itself and restarts it from there:
  // a host only the shell's identity covered would never reach the floor that
  // runs it.
  const { paths, daemonIdentity } = await fixture(t);

  await writeFile(paths.freewayOutput, "freeway-one");
  const before = await daemonIdentity();
  await writeFile(paths.freewayOutput, "freeway-two");
  assert.notEqual(await daemonIdentity(), before);
  assert.equal(shellPlaneInputs(paths).includes(paths.freewayOutput), false);
});

test("a rebuilt sound worker restarts the shell and never the pair (SD-2)", async (t) => {
  // Main starts the sound renders' thread from beside its own bundle: it is the shell's, and a shell-only restart
  // adopts the running pair.
  const { paths, daemonIdentity } = await fixture(t);
  const shellIdentity = () => computeBuildId(paths.repoRoot, shellPlaneInputs(paths));
  for (const file of [paths.mainOutput, paths.preloadOutput, paths.studioPreloadOutput]) {
    await writeFile(file, "shell");
  }
  await writeFile(paths.soundWorkerOutput, "worker-one");
  const [shellBefore, daemonBefore] = [await shellIdentity(), await daemonIdentity()];
  await writeFile(paths.soundWorkerOutput, "worker-two");
  assert.notEqual(await shellIdentity(), shellBefore);
  assert.equal(await daemonIdentity(), daemonBefore);
});
