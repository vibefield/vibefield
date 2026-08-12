import { defineConfig } from "vitest/config";

// fieldd's suites are the heaviest in the graph: they spawn real daemons
// (cargo-built field-native children, WS servers, worker threads) beside
// vitest's own worker processes. On CI's starved cores that contention trips
// vitest's internal worker RPC ("Timeout calling onTaskUpdate") — every test
// green, exit code red (two runs proved it: 376/376 passing, 2 unhandled
// infra errors). CI runs the files serially; local keeps full parallelism.
//
// The native binary those suites spawn is built ONCE here rather than in five
// competing `beforeAll` hooks — see test/global-setup.ts for what the queue
// used to cost.
//
// WIN-10, MEASURED on WORKSTATION4090 (32 threads, 96 GB — not a starved box):
// win32 joins CI for the same reason and needs no separate argument. A Windows
// process spawn costs orders more than a POSIX fork, these suites spawn REAL
// field-native children by the dozen, and Defender scans each one; the result
// is the identical contention. Parallel, the full fieldd suite failed ONE
// real-daemon e2e row per two-to-three runs — a different row each time, every
// one green in isolation. Serial: 3/3 clean, 472 passed.
//
// The flake is NOT new — it was measured at the pre-WIN-10 commit too (1 red in
// 3 runs), so this is a gate that was never trustworthy here rather than a
// regression being papered over. The cost is honest: ~15s → ~115s for this one
// project. A gate that fails two runs in five teaches people to re-run until
// green, which is precisely how a real failure gets waved through.
export default defineConfig({
  test: {
    fileParallelism: !process.env["CI"] && process.platform !== "win32",
    globalSetup: ["./test/global-setup.ts"],
  },
});
