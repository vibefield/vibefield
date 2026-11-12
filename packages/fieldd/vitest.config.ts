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
//
// The budgets (debts lane, 2026-10-12): vitest's defaults (5 s a test, 10 s a
// hook) are not a product budget, and a loaded host stalls these fsync-heavy
// files past them — one gate run failed four files at once (audit-service,
// project-library, workspace-engine, audit-retention), each normally under
// 0.6 s. 30 s is the ceiling a stall gets; a row whose product has a real
// bound asserts that bound in its own words, never through this number.
//
// Item 317 (2026-11-11): HISTFILE=/dev/null in every worker's process.env (vitest sets it
// before a file's tests run; the global setup, which only builds, does not get it). These
// suites birth real `/bin/sh` panes on real PTYs through floors that inherit this process's
// environment (`...process.env` at each spawn), under the runner's own HOME. macOS's sh is
// bash, and an interactive bash that took a line saves its history when its PTY goes: 14 of
// run 294's 16 rewrites of the runner's ~/.bash_history in one `pnpm verify` came from these
// suites (vf-m2; the other two from field-native's tp_activation, which sets its own). The
// variable rides the same inherit road HOME does (kill-matrix row 6 reads it in a real pane).
// A floor on a throwaway HOME drops it (`personEnvironment`), and its shells keep their
// history inside the box.
export default defineConfig({
  test: {
    fileParallelism: !process.env["CI"] && process.platform !== "win32",
    globalSetup: ["./test/global-setup.ts"],
    // Item 345: the run's own socket alias parent in every worker's environment (test/alias-parent-env.ts)
    setupFiles: ["./test/alias-parent-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { HISTFILE: "/dev/null" },
  },
});
