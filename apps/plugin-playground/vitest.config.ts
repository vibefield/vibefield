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
    // DK-11: the stills draw on Dawn — `pnpm still` (vitest.still.config.ts), never `test`: CI's hosts carry no GPU the
    // goldens were blessed on, and a golden is Dawn's bytes on the host that blessed it
    exclude: ["test/**/*.dawn.test.ts", "**/node_modules/**"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
