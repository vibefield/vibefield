import assert from "node:assert/strict";
import test from "node:test";
import { nxWatcherEnvironment } from "../src/nx-watcher.mjs";

test("opts the long-lived watcher back into the required Nx daemon", () => {
  assert.deepEqual(
    nxWatcherEnvironment({
      NX_DAEMON: "false",
      NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "true",
      KEEP: "value",
    }),
    {
      NX_DAEMON: "true",
      NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "false",
      KEEP: "value",
    },
  );
});
