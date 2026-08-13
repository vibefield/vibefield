#!/usr/bin/env node
// `vibefield-plugin` — the authoring kit's front door (plugin-architecture spec
// §5.4 item 2). Every command answers in two registers from ONE verdict object
// (P8-D8): a human line, and `--json` NDJSON for the agent that will read it.
//
// Plain .mjs importing the TS module directly, the same mechanism as
// plugin-build's bin: Node strips types, and the workspace exports source
// rather than dist, so there is no build-the-builder step between an edit and a
// plugin check.

import { registerHooks } from "node:module";

// Dev-source resolution, the same law and the same shape as plugin-build's bin:
// workspace packages export .ts sources with EXTENSIONLESS relative imports
// (tsc and vite resolve them; Node's type stripping erases types but never
// resolves paths). Retry `<specifier>.ts` for relative misses outside
// node_modules — one answer to this problem in the repo, not two.
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

const { runCli } = await import("../src/cli.ts");

process.exitCode = await runCli(process.argv.slice(2));
