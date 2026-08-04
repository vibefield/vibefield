import { defineConfig } from "vitest/config";

// fieldd's suites are the heaviest in the graph: they spawn real daemons
// (cargo-built field-native children, WS servers, worker threads) beside
// vitest's own worker processes. On CI's starved cores that contention trips
// vitest's internal worker RPC ("Timeout calling onTaskUpdate") — every test
// green, exit code red (two runs proved it: 376/376 passing, 2 unhandled
// infra errors). CI runs the files serially; local keeps full parallelism.
export default defineConfig({
  test: {
    fileParallelism: !process.env["CI"],
  },
});
