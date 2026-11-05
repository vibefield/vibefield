#!/usr/bin/env node
// CP-4a2a (4A2-Q1 (a)) — a run's flow host's bundle, `dist/flows-host.cjs`.
//
// ONE definition of the build, imported by everything that makes it: fieldd's own `pnpm build` (this file run as a
// script), the dev runner's watch (tooling/dev-runner/src/esbuild-watches.mjs) and the tests that start a real host
// (test/flows-host-bundle.ts), as the transcript worker's is (transcript-host-build.mjs). The child holds `ses` and
// its own files alone (wall R32's host clause holds its imports); this build FAILS if anything of VibeField's, acorn
// or mille's reached the bundle by any road, so a file the child imports can never carry them in.
import { join, resolve } from "node:path";

export const FIELDD_ROOT = resolve(import.meta.dirname, "..");
export const FLOWS_HOST_ENTRY = join(FIELDD_ROOT, "src", "flows", "host", "entry.ts");
export const FLOWS_HOST_OUTFILE = join(FIELDD_ROOT, "dist", "flows-host.cjs");

/** The plugin that fails a build that would carry more than the sandbox into the child. */
export function sandboxOnlyPlugin() {
  return {
    name: "vibefield-flows-host-sandbox-only",
    setup(build) {
      build.onResolve({ filter: /^(?:@vibefield\/|@vibecook\/|acorn(?:\/|$))/ }, (args) => ({
        errors: [
          {
            text: `flows-host build: ${args.path} reached the flow host from ${args.importer}; the child holds ses and its own files alone (R32)`,
          },
        ],
      }));
    },
  };
}

/** The esbuild options, as data plus the plugin. */
export function flowsHostBuildOptions({
  fielddRoot = FIELDD_ROOT,
  outfile = FLOWS_HOST_OUTFILE,
} = {}) {
  return {
    absWorkingDir: fielddRoot,
    entryPoints: [join(fielddRoot, "src", "flows", "host", "entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
    plugins: [sandboxOnlyPlugin()],
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const { build } = await import("esbuild");
  await build(flowsHostBuildOptions());
  console.log("built dist/flows-host.cjs");
}
