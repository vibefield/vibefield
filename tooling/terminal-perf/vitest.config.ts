import { defineConfig } from "vitest/config";

// The DEFAULT suite: unit rows only — the container round-trip, the byte-trace
// port's pinned digests, the replica apply's correctness. Fast, hermetic, and
// part of `pnpm test`.
//
// The two heavy jobs are deliberately NOT here and each has its own config:
//   * `vitest.bench.config.ts`   — the worker replay microbench over the corpus
//     (per PR; needs the fixtures, wants a long timeout, prints numbers)
//   * `vitest.capture.config.ts` — the real-cell capture (spawns the daemon
//     pair and writes fixtures; run deliberately, never on a gate)
// A benchmark that runs inside the normal suite is a benchmark whose numbers are
// measured under vitest's own file parallelism, which is exactly the load the
// loaded-host rule says to control rather than inherit.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
