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
