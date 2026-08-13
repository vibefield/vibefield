#!/usr/bin/env node
// `plugin-playground` — the headless widget-state VERDICT runner (plugin
// architecture spec §5.4 item 5, §24.2 "every widget state render fixture").
//
// Usage: plugin-playground <pluginDir> [--json] [--state <type>:<name>]
// Exit codes are LAW (P8-D8): 0 every state passed · 1 at least one refusal ·
// 2 the harness itself failed. Nothing here prompts.
//
// Plain .mjs importing the TS bootstrap directly, the same shape and the same
// reason as plugin-build's bin: Node strips types, the workspace exports .ts
// sources, and there is no build-the-builder step between an edit and a run.
import { registerHooks } from "node:module";

// Dev-source resolution — the repo's ONE answer to extensionless relative
// imports under Node's strip-only type removal (plugin-build/bin verbatim).
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

const { boot } = await import("../src/boot.ts");

// `boot` owns the exit code, including the harness-error 2 — a throw that
// escapes here would exit 1 and lie about which kind of failure happened.
process.exit(await boot(process.argv.slice(2)));
