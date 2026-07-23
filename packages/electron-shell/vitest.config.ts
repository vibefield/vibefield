import { defineConfig } from "vitest/config";

// Vitest must NOT inherit vite.config.ts: its `root` points at the renderer
// host (src/renderer-host), which hid this package's test/ entirely — `vitest
// run` said "No test files found" from slice 3a until the 2026-07-23 review
// caught it. A dedicated vitest config wins over vite.config.ts and pins test
// discovery to the package root.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
