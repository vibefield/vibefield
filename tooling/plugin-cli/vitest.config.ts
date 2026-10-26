import { defineConfig } from "vitest/config";

// The kit's suites spawn the kit itself: `bin/vibefield-plugin.mjs` as a child process, cold, running the kit's
// TypeScript sources under Node's own type stripping, with nothing installed (DK-10, test/outside-workspace.test.ts).
// Each spawn pays the whole module graph's cold load, and a row may spawn it more than once by design. This package
// had no config, so every such row ran under vitest's default 5 s, a budget nobody chose and no product bound.
//
// Measured 2026-10-26 (tooling, VF-PM 02:28Z) on the DK-10 emit-manifest row, which spawns the kit twice (emit-manifest,
// then check):
//   - this Mac, quiet (1-min load 8): the bare kit load is 254 ms, and the row's two spawns 515 ms;
//   - the same at 16× contention on 10 cores: 1,813 ms, worst 2,102 ms; linear in the contention;
//   - CI's macOS runner (verify on a673d7ae0, run 40254963333): the row 5,025 ms against the 5 s default (red), and
//     the file 20.2 s.
// So the row sat ON the default, a lottery red on any slow runner. This is fieldd's policy and its reason
// (packages/fieldd/vitest.config.ts): vitest's defaults (5 s a test, 10 s a hook) are not a product budget; 30 s is
// the ceiling a stall gets; a row whose product has a real bound asserts that bound in its own words, never through
// this number.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
