import { defineConfig } from "vitest/config";

// Item 345, the seam slice (2026-11-12): this package ran on vitest's defaults until client.test.ts's in-process fieldd
// needed the run's own socket alias parent. The config adds that and nothing else: the defaults stand.
export default defineConfig({
  test: {
    globalSetup: ["./test/alias-parent-global.ts"],
    setupFiles: ["./test/alias-parent-env.ts"],
  },
});
