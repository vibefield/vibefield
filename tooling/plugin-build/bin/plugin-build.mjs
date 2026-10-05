#!/usr/bin/env node
// `plugin-build` — the whole build script a plugin's package.json needs
// (plugin-architecture spec §5.4 item 1). Run from the plugin's own directory;
// pass a path to build a different one.
//
// Plain .mjs importing the TS module directly: Node 26 strips types, and the
// workspace exports source rather than dist, so there is no build-the-builder
// step standing between an edit and a plugin build.

import { registerHooks } from "node:module";

// Dev-source resolution, the same law and the same shape as fieldd's service
// worker harness: workspace packages export .ts sources with EXTENSIONLESS
// relative imports (tsc and vite resolve them; Node's type stripping erases
// types but never resolves paths). Retry `<specifier>.ts` for relative misses
// outside node_modules — one answer to this problem in the repo, not two.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

// DK-10: every agent of the ten-minute bar asked `plugin-build --help` first, and the bin built a plugin at
// `./--help` ("no vibefield.plugin.json in …/--help"). An option is never a directory.
const USAGE = `plugin-build [<plugin dir>]        (default: the current directory)

Builds the plugin its vibefield.plugin.json describes: the renderer bundle (./dist/renderer.js — each
.wgsl file inlined as its text, the host's singletons left as bare imports its import map binds), the
service bundle when the manifest has one, then the artifact checks. It READS the manifest and never
writes it: emit that from src/manifest.ts first — \`vibefield-plugin emit-manifest <dir>\` (or
\`pnpm gen:manifest\` in a workspace with an install).

exit 0  built            exit 1  refused — the stage that refused, and why`;

const arg = process.argv[2];
if (arg === "--help" || arg === "-h") {
  console.log(USAGE);
  process.exit(0);
}
if (arg?.startsWith("-")) {
  console.error(`plugin-build: unknown option ${arg}\n\n${USAGE}`);
  process.exit(1);
}

const { buildPlugin, PluginBuildError } = await import("../src/build.ts");

const target = arg ?? process.cwd();

try {
  const report = await buildPlugin({ root: target });
  for (const stage of report.stages) console.log(`  ${stage.stage.padEnd(16)} ${stage.detail}`);
  console.log(`plugin-build: ${report.pluginId} OK`);
} catch (error) {
  if (error instanceof PluginBuildError) {
    // The stage is part of the message because a build failure is read by
    // someone who did not run it (CI, an agent) as often as by whoever did.
    console.error(`plugin-build FAILED at ${error.stage}:\n  ${error.message}`);
  } else {
    console.error(`plugin-build FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  }
  process.exit(1);
}
