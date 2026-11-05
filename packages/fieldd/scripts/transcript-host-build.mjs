#!/usr/bin/env node
// TH-1 (TH0-Q5 (b)) — the transcript worker's bundle, `dist/transcript-host.cjs`.
//
// ONE definition of the build, imported by everything that makes it: fieldd's own `pnpm build` (this file run as a
// script), the dev runner's watch (tooling/dev-runner/src/esbuild-watches.mjs) and the tests that start a real worker
// (test/transcript-host-bundle.ts), as the files worker's is (files-host-build.mjs). The worker is mille-free: no
// engine is staged beside it, and the build FAILS if anything of mille's reached the bundle (wall R24 names the files
// worker alone).
import { join, resolve } from "node:path";

export const FIELDD_ROOT = resolve(import.meta.dirname, "..");
export const TRANSCRIPT_HOST_ENTRY = join(FIELDD_ROOT, "src", "transcripts", "host", "entry.ts");
export const TRANSCRIPT_HOST_OUTFILE = join(FIELDD_ROOT, "dist", "transcript-host.cjs");

/** The plugin that fails a build that would carry mille's engine into the worker. */
export function noMillePlugin() {
  return {
    name: "vibefield-transcript-host-no-mille",
    setup(build) {
      build.onResolve({ filter: /^@vibecook\/mille(?:\/|$)/ }, (args) => ({
        errors: [
          {
            text: `transcript-host build: ${args.path} reached the transcript worker from ${args.importer}; it is mille-free (R24)`,
          },
        ],
      }));
    },
  };
}

/** The esbuild options, as data plus the plugin. */
export function transcriptHostBuildOptions({
  fielddRoot = FIELDD_ROOT,
  outfile = TRANSCRIPT_HOST_OUTFILE,
} = {}) {
  return {
    absWorkingDir: fielddRoot,
    entryPoints: [join(fielddRoot, "src", "transcripts", "host", "entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
    plugins: [noMillePlugin()],
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const { build } = await import("esbuild");
  await build(transcriptHostBuildOptions());
  console.log("built dist/transcript-host.cjs");
}
