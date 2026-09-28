// AR-7b: the runner builds fieldd's third bundle, the agent shim. The gateway
// offers a launcher only with `agent-shim.cjs` beside the daemon's bundle, so
// without this definition nothing typed in a pane under `pnpm dev` is managed.
// The witness reads fieldd's build script, which is why this target's Nx inputs
// name packages/fieldd/package.json (project.json).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { context } from "esbuild";
import { computeBuildId } from "../src/build-id.mjs";
import { esbuildDefinitions, esbuildOptions } from "../src/esbuild-watches.mjs";
import { workspacePaths } from "../src/paths.mjs";
import { pnpmCommand, runCommand } from "../src/processes.mjs";
import { daemonPlaneInputs, shellPlaneInputs } from "../src/runtime-planes.mjs";

const FIELDD_ROOT = dirname(dirname(workspacePaths.fielddEntry));

/** The step of fieldd's build script that writes the shim, as argv. */
async function fielddShimStep() {
  const manifest = JSON.parse(await readFile(join(FIELDD_ROOT, "package.json"), "utf8"));
  const step = manifest.scripts.build
    .split(" && ")
    .find((candidate) => candidate.includes("--outfile=dist/agent-shim.cjs"));
  assert.ok(step, "fieldd's build script has no step that writes dist/agent-shim.cjs");
  return step.split(" ");
}

function shimDefinition(paths = workspacePaths) {
  return esbuildDefinitions(paths).find((definition) => definition.name === "fieldd-agent-shim");
}

test("the runner builds the agent shim from fieldd's own entry, to fieldd's own outfile", async () => {
  const shim = shimDefinition();
  assert.ok(shim, "no fieldd-agent-shim definition: under pnpm dev the gateway offers no launcher");
  const step = await fielddShimStep();
  // The kit's package export resolved from fieldd's package root, as the build
  // step resolves it — never a path into the sibling — so the kit is the one in
  // fieldd's dependency graph.
  assert.equal(shim.entry, step[1]);
  assert.equal(shim.cwd, FIELDD_ROOT);
  // The file fieldd's build writes, beside the daemon's bundle.
  const outfile = step.find((arg) => arg.startsWith("--outfile=")).slice("--outfile=".length);
  assert.equal(shim.outfile, join(FIELDD_ROOT, outfile));
  assert.equal(shim.outfile, workspacePaths.agentShimOutput);
  assert.equal(dirname(shim.outfile), dirname(workspacePaths.fielddOutput));
});

test("a rebuilt shim moves the daemon identity, so the pair restarts as for bin.cjs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vf-dev-shim-"));
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
    nativeOutput: join(root, "field-native"),
  };
  const daemonIdentity = () => computeBuildId(root, daemonPlaneInputs(paths, []));

  await writeFile(paths.agentShimOutput, "shim-one");
  const before = await daemonIdentity();
  await writeFile(paths.agentShimOutput, "shim-two");
  assert.notEqual(await daemonIdentity(), before);
  // Never the shell's plane: a shell-only restart adopts the running pair, which
  // keeps the shim it published.
  assert.equal(shellPlaneInputs(paths).includes(paths.agentShimOutput), false);
});

test("the runner's shim is byte-identical to the one fieldd's own build makes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vf-dev-shim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runnerOutput = join(root, "runner", "agent-shim.cjs");
  const fielddOutput = join(root, "fieldd", "agent-shim.cjs");

  // The runner's definition, through the options its watch builds with.
  const runner = await context(
    esbuildOptions(shimDefinition({ ...workspacePaths, agentShimOutput: runnerOutput })),
  );
  try {
    await runner.rebuild();
  } finally {
    await runner.dispose();
  }

  // fieldd's build step verbatim but for where it writes, run from fieldd's
  // package root with fieldd's esbuild, as `pnpm run build` runs it.
  const step = (await fielddShimStep()).map((arg) =>
    arg.startsWith("--outfile=") ? `--outfile=${fielddOutput}` : arg,
  );
  let stderr = "";
  await runCommand({
    command: pnpmCommand,
    args: ["exec", ...step],
    cwd: FIELDD_ROOT,
    label: "fieldd's shim build step",
    stdio: ["ignore", "ignore", "pipe"],
    onSpawn: (child) => {
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    },
  }).catch((error) => assert.fail(`${error.message}\n${stderr}`));

  const [ours, theirs] = await Promise.all([readFile(runnerOutput), readFile(fielddOutput)]);
  assert.ok(ours.length > 0, "the runner's build wrote an empty shim");
  assert.ok(
    ours.equals(theirs),
    `the runner's shim (${ours.length} bytes) differs from fieldd's build (${theirs.length} bytes)`,
  );
});
