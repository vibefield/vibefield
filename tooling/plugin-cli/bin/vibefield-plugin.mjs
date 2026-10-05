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

// THE IMPORT MAP, in Node (DK-10 — the ten-minute bar's first wall). A plugin's built module and its manifest source
// name the host's singletons bare (`@vibefield/plugin-sdk`, its `/desk` door) — the renderer binds them with its import
// map (§11.6), fieldd's service worker with a resolve hook. A plugin authored OUTSIDE a workspace has no node_modules,
// so `check`'s activation row could not import it at all and judged none of its object rows. Here a bare specifier the
// host binds (and `@vibefield/contracts`, whose values a manifest may import) resolves, when the plugin's own
// resolution finds nothing, to THIS kit's copy — what the host would hand the plugin. A plugin with an install keeps
// its own; nothing else is rerouted.
const { HOST_SINGLETON_MODULE_SPECIFIERS } = await import("@vibefield/contracts");
const BOUND_BY_THE_HOST = new Set([...HOST_SINGLETON_MODULE_SPECIFIERS, "@vibefield/contracts"]);
// the kit's own copies: the CLI's package (the SDK, contracts), then the SDK's (react and ICE are ITS dependencies)
const KIT_PARENTS = [import.meta.url, import.meta.resolve("@vibefield/plugin-sdk")];
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!BOUND_BY_THE_HOST.has(specifier)) throw error;
      for (const parentURL of KIT_PARENTS) {
        if (parentURL === context.parentURL) continue;
        try {
          return nextResolve(specifier, { ...context, parentURL });
        } catch {
          // the next copy
        }
      }
      throw error;
    }
  },
});

const { runCli } = await import("../src/cli.ts");

process.exitCode = await runCli(process.argv.slice(2));
