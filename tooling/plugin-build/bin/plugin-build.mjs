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

const { buildPlugin, PluginBuildError } = await import("../src/build.ts");

const target = process.argv[2] ?? process.cwd();

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
