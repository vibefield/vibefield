#!/usr/bin/env node
// `create-plugin` — the authoring kit's scaffolder (plugin-architecture spec
// §5.4 item 3). One command, zero prompts, and the same verdict contract the
// rest of the kit answers in (P8-D8): a human line, and `--json` NDJSON for the
// agent that will read it.
//
// Plain .mjs importing the TS module directly, the same mechanism as
// plugin-cli's and plugin-build's bins: Node strips types, and the workspace
// exports source rather than dist, so there is no build-the-scaffolder step
// between an edit and a scaffold.

import { registerHooks } from "node:module";

// Dev-source resolution, the same law and the same shape as the sibling bins:
// workspace packages export .ts sources with EXTENSIONLESS relative imports
// (tsc and vite resolve them; Node's type stripping erases types but never
// resolves paths). Retry `<specifier>.ts` for relative misses outside
// node_modules — one answer to this problem in the repo, not three.
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
