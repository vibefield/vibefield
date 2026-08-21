import { defineConfig } from "vitest/config";

// The microbench. Serial by construction: the whole point is a number, and a
// number measured while three other vitest workers compete for the same cores
// is a number about the scheduler. `fileParallelism: false` plus a single fork
// is the closest a vitest-hosted bench gets to a quiet arm on a loaded host —
// the rest is the bench's own discipline (warm-up, repeated runs, medians).
export default defineConfig({
  test: {
    include: ["bench/**/*.bench.test.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
