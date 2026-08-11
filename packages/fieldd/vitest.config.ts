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
export default defineConfig({
  test: {
    fileParallelism: !process.env["CI"],
    globalSetup: ["./test/global-setup.ts"],
  },
});
