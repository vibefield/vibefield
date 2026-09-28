import { dirname, join } from "node:path";
import { context, formatMessages } from "esbuild";
import { runCommand } from "./processes.mjs";

/** The watched bundles, as data: a test builds one exactly as the watch below does. */
export function esbuildDefinitions(paths) {
  return [
    {
      name: "electron-main",
      entry: paths.studioMainEntry,
      outfile: paths.mainOutput,
      cwd: dirname(dirname(dirname(paths.studioMainEntry))),
      format: "cjs",
      external: ["electron", "../testing/smoke.cjs"],
    },
    {
      name: "electron-preload",
      entry: paths.studioProductPreloadEntry,
      outfile: paths.preloadOutput,
      cwd: dirname(dirname(dirname(paths.studioProductPreloadEntry))),
      format: "cjs",
      external: ["electron"],
    },
    {
      name: "electron-studio-preload",
      entry: paths.studioPreloadEntry,
      outfile: paths.studioPreloadOutput,
      cwd: dirname(dirname(dirname(paths.studioPreloadEntry))),
      format: "cjs",
      external: ["electron"],
    },
    {
      name: "fieldd",
      entry: paths.fielddEntry,
      outfile: paths.fielddOutput,
      cwd: dirname(dirname(paths.fielddEntry)),
      format: "cjs",
      external: ["bufferutil", "utf-8-validate"],
      // bin.ts always injects the real bundled harness path. The source-only
      // fallback uses import.meta.url for tests, which CJS cannot represent.
      define: { "import.meta.url": "undefined" },
      afterBuild: () =>
        runCommand({
          command: process.execPath,
          args: [join(dirname(dirname(paths.fielddEntry)), "scripts", "stage-runtime-assets.mjs")],
          cwd: dirname(dirname(paths.fielddEntry)),
          label: "fieldd runtime asset staging",
        }),
    },
    {
      name: "fieldd-service-harness",
      entry: paths.serviceHarnessEntry,
      outfile: paths.serviceHarnessOutput,
      cwd: dirname(dirname(paths.serviceHarnessEntry)),
      format: "esm",
      external: ["bufferutil", "loro-crdt", "utf-8-validate"],
    },
    {
      // AR-7b: fieldd's build makes a third bundle, the kit's spawn-through
      // shim, and the gateway offers a launcher only with `agent-shim.cjs`
      // beside the daemon's bundle. Without this build the gateway offered
      // none under `pnpm dev`, and an agent typed in a pane ran unmanaged (the
      // V2 lane report, draft/ar7-briefs/reports/v2-gateway-report.md, WHAT IS
      // NOT BUILT 2). The options are that build step's, and the entry is the
      // kit's package export resolved from fieldd's package root as the step
      // resolves it, so the pinned kit is the one in fieldd's dependency graph;
      // test/esbuild-watches.test.mjs compares the two flag for flag and builds
      // both to compare the bytes. The kit's sources reach this build through
      // esbuild's own input tracking, as they reach bin.cjs.
      name: "fieldd-agent-shim",
      entry: "@vibecook/puppeteer-runtime/spawn-through/shim",
      outfile: paths.agentShimOutput,
      cwd: dirname(dirname(paths.fielddEntry)),
      format: "cjs",
      target: "node22",
    },
  ];
}

/** What one definition asks esbuild for; the watch adds only its lifecycle plugin. */
export function esbuildOptions(definition) {
  return {
    absWorkingDir: definition.cwd,
    entryPoints: [definition.entry],
    outfile: definition.outfile,
    bundle: true,
    platform: "node",
    format: definition.format,
    target: definition.target,
    external: definition.external,
    define: definition.define,
    logLevel: "silent",
  };
}

export async function startEsbuildWatches({ paths, log, onArtifactChange }) {
  const states = new Map();
  const contexts = [];
  let active = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const definitions = esbuildDefinitions(paths);

  for (const definition of definitions) states.set(definition.name, "building");

  const allReady = () => [...states.values()].every((state) => state === "ready");
  const noteReady = () => {
    if (allReady()) resolveReady();
  };

  try {
    for (const definition of definitions) {
      let builtOnce = false;
      const plugin = {
        name: `vibefield-dev-${definition.name}`,
        setup(build) {
          build.onStart(() => {
            states.set(definition.name, "building");
          });
          build.onEnd(async (result) => {
            await printMessages(result.warnings, "warning");
            if (result.errors.length > 0) {
              states.set(definition.name, "failed");
              await printMessages(result.errors, "error");
              log.warn(`${definition.name} did not rebuild; the running app is unchanged`);
              return;
            }
            try {
              await definition.afterBuild?.();
            } catch (error) {
              states.set(definition.name, "failed");
              log.error(`${definition.name} post-build failed: ${messageOf(error)}`);
              return;
            }
            const wasBuilt = builtOnce;
            builtOnce = true;
            states.set(definition.name, "ready");
            noteReady();
            if (active && wasBuilt) onArtifactChange(definition.name);
          });
        },
      };
      const buildContext = await context({ ...esbuildOptions(definition), plugins: [plugin] });
      contexts.push(buildContext);
      await buildContext.watch();
    }
  } catch (error) {
    await Promise.allSettled(contexts.map((buildContext) => buildContext.dispose()));
    throw error;
  }

  return {
    ready,
    allReady,
    activate() {
      active = true;
    },
    async close() {
      active = false;
      await Promise.allSettled(contexts.map((buildContext) => buildContext.dispose()));
    },
  };
}

async function printMessages(messages, kind) {
  if (messages.length === 0) return;
  const formatted = await formatMessages(messages, {
    kind,
    color: Boolean(process.stderr.isTTY),
  });
  process.stderr.write(formatted.join(""));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
