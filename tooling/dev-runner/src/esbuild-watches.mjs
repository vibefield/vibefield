import { dirname, join } from "node:path";
import { context, formatMessages } from "esbuild";
import { runCommand } from "./processes.mjs";

export async function startEsbuildWatches({ paths, log, onArtifactChange }) {
  const states = new Map();
  const contexts = [];
  let active = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const definitions = [
    {
      name: "electron-main",
      entry: paths.mainEntry,
      outfile: paths.mainOutput,
      cwd: dirname(dirname(dirname(paths.mainEntry))),
      format: "cjs",
      external: ["electron", "../testing/smoke.cjs"],
    },
    {
      name: "electron-preload",
      entry: paths.preloadEntry,
      outfile: paths.preloadOutput,
      cwd: dirname(dirname(dirname(paths.preloadEntry))),
      format: "cjs",
      external: ["electron"],
    },
    {
      // GT-2b: the terminal bridge is a PRODUCTION artifact the shell forks at
      // runtime (utilityProcess), so a dev shell without it has a deck whose
      // ports never arrive. ESM on purpose — the `.mjs` name is load-bearing
      // (the package build script is the mirrored shape).
      name: "electron-bridge-entry",
      entry: paths.bridgeEntry,
      outfile: paths.bridgeOutput,
      cwd: dirname(dirname(dirname(paths.bridgeEntry))),
      format: "esm",
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
  ];

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
      const buildContext = await context({
        absWorkingDir: definition.cwd,
        entryPoints: [definition.entry],
        outfile: definition.outfile,
        bundle: true,
        platform: "node",
        format: definition.format,
        external: definition.external,
        define: definition.define,
        logLevel: "silent",
        plugins: [plugin],
      });
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
