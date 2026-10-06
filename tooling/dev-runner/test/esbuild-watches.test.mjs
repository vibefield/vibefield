// AR-7b: the runner builds fieldd's third bundle, the agent shim. The gateway
// offers a launcher only with `agent-shim.cjs` beside the daemon's bundle, so
// without this definition nothing typed in a pane under `pnpm dev` is managed.
// These rows read fieldd's build script, which is why this target's Nx inputs
// name packages/fieldd/package.json (project.json).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
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
  const shim = esbuildDefinitions(paths).find(
    (definition) => definition.name === "fieldd-agent-shim",
  );
  assert.ok(shim, "no fieldd-agent-shim definition: under pnpm dev the gateway offers no launcher");
  return shim;
}

/** Every option of one watch that shapes its output, spelled as the esbuild CLI spells it. */
function asCliArguments(options) {
  return [
    ...options.entryPoints,
    ...(options.bundle ? ["--bundle"] : []),
    `--platform=${options.platform}`,
    `--format=${options.format}`,
    ...(options.target === undefined ? [] : [`--target=${options.target}`]),
    ...(options.external ?? []).map((name) => `--external:${name}`),
    ...Object.entries(options.define ?? {}).map(([name, value]) => `--define:${name}=${value}`),
    `--outfile=${relative(options.absWorkingDir, options.outfile).split(sep).join("/")}`,
  ];
}

test("the runner builds the agent shim as fieldd's build step does, beside the daemon's bundle", async () => {
  const options = esbuildOptions(shimDefinition());
  const [command, ...step] = await fielddShimStep();
  // Flag for flag, both ways: the byte witness below cannot see a flag that
  // leaves today's bytes alone (a target the kit's syntax does not need yet).
  assert.equal(command, "esbuild");
  assert.deepEqual(asCliArguments(options).sort(), step.sort());
  // The kit's package export, resolved from fieldd's package root as the step
  // resolves it — never a path into the sibling — so the kit is the one in
  // fieldd's dependency graph.
  assert.equal(options.absWorkingDir, FIELDD_ROOT);
  assert.equal(options.outfile, workspacePaths.agentShimOutput);
  assert.equal(dirname(options.outfile), dirname(workspacePaths.fielddOutput));
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
    filesHostOutput: join(root, "files-host.cjs"),
    milleNativeOutput: join(root, "mille.test-triple.node"),
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

// FS-1a (L1) — the files worker's bundle. Its build is fieldd's own module
// (packages/fieldd/scripts/files-host-build.mjs): the plugin that loads mille's
// native engine by an explicit path cannot be spelled as CLI flags, so the
// runner imports the definition instead of restating it.
function filesHostDefinition(paths = workspacePaths) {
  const definition = esbuildDefinitions(paths).find(
    (candidate) => candidate.name === "fieldd-files-host",
  );
  assert.ok(
    definition,
    "no fieldd-files-host definition: under pnpm dev fieldd has no files worker",
  );
  return definition;
}

test("the runner builds the files worker beside the daemon's bundle, with fieldd's own options", async () => {
  const definition = filesHostDefinition();
  const options = await definition.options();
  assert.equal(options.outfile, workspacePaths.filesHostOutput);
  assert.equal(dirname(options.outfile), dirname(workspacePaths.fielddOutput));
  assert.equal(options.absWorkingDir, FIELDD_ROOT);
  assert.ok(
    options.plugins.some((plugin) => plugin.name === "vibefield-mille-native"),
    "the files worker's build lost the plugin that loads mille's engine by its explicit path",
  );
  assert.equal(dirname(workspacePaths.milleNativeOutput), dirname(workspacePaths.fielddOutput));
});

test("the runner's files worker is byte-identical to the one fieldd's own build makes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vf-dev-files-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runnerOutput = join(root, "runner", "files-host.cjs");
  const fielddOutput = join(root, "fieldd", "files-host.cjs");
  const runner = await context(
    await filesHostDefinition({ ...workspacePaths, filesHostOutput: runnerOutput }).options(),
  );
  try {
    await runner.rebuild();
  } finally {
    await runner.dispose();
  }
  const own = await import(join(FIELDD_ROOT, "scripts", "files-host-build.mjs"));
  const fieldd = await context(own.filesHostBuildOptions({ outfile: fielddOutput }));
  try {
    await fieldd.rebuild();
  } finally {
    await fieldd.dispose();
  }
  const [ours, theirs] = await Promise.all([readFile(runnerOutput), readFile(fielddOutput)]);
  assert.ok(ours.length > 0, "the runner's build wrote an empty worker");
  assert.ok(ours.equals(theirs), "the runner's files worker differs from fieldd's build");
});

test("a rebuilt files worker moves the daemon identity, never the shell's", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vf-dev-files-host-"));
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
  };
  const daemonIdentity = () => computeBuildId(root, daemonPlaneInputs(paths, []));
  await writeFile(paths.filesHostOutput, "worker-one");
  const before = await daemonIdentity();
  await writeFile(paths.filesHostOutput, "worker-two");
  assert.notEqual(await daemonIdentity(), before);
  const afterWorker = await daemonIdentity();
  await writeFile(paths.milleNativeOutput, "engine-two");
  assert.notEqual(await daemonIdentity(), afterWorker);
  for (const file of [paths.filesHostOutput, paths.milleNativeOutput])
    assert.equal(shellPlaneInputs(paths).includes(file), false);
});
