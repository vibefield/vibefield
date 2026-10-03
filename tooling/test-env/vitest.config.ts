import { defineConfig } from "vitest/config";

// The shared test environment's own suite: the happy-dom shim's forced-GC witness,
// run ONCE here for every suite that loads the shim (docs/UI_SYSTEM.md, "Test
// environments"). It runs under the same happy-dom, through the same setup file.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./src/happy-dom-setup.ts"],
  },
});
