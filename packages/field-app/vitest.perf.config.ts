import { defineConfig } from "vitest/config";

// THE MV-0 INSTRUMENTS' RUNNER (`perf/**`), outside `pnpm test` and `pnpm verify`
// on purpose: the oracle replays whole corpora through today's seam and the
// seam-cost bench times it, both of which are minutes, not milliseconds, and
// neither asserts a budget nobody has agreed to. Serial by construction, like
// `tooling/terminal-perf/vitest.bench.config.ts`: a number measured beside
// three other vitest workers is a number about the scheduler.
//
//   pnpm --filter @vibefield/field-app perf:godview:corpora   write the fixtures
//   (the oracle and the seam-cost bench ran the PRE-MV seam, which MV-3b
//   deleted: regenerate at the pre-MV ref, M24; the recorded oracle is the
//   differential's ground truth)
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "happy-dom",
    environmentOptions: { happyDOM: { url: "http://localhost:3000/" } },
    include: ["perf/**/*.perf.ts", "perf/**/*.perf.tsx"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 1_800_000,
    hookTimeout: 300_000,
    server: { deps: { inline: ["@vibecook/ghosttea-react"] } },
  },
});
