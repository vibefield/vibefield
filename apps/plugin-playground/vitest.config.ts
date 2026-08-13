import { defineConfig } from "vitest/config";

// The runner owns its own DOM (it installs happy-dom globals itself, because the
// bin must work outside vitest), so these tests run in plain NODE — anything
// else would hand the code under test an environment its real callers never
// have. Timeouts are generous: each case boots a Vite module runner and mounts
// real widgets.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
