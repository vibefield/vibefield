import assert from "node:assert/strict";
import test from "node:test";
import { nxWatchEventArgv, nxWatcherEnvironment } from "../src/nx-watcher.mjs";

test("the event command Nx re-executes through a shell arrives quoted on win32", () => {
  // `C:\Program Files\nodejs\node.exe` unquoted does not fail loudly — the
  // event command dies and change events simply never arrive.
  assert.deepEqual(
    nxWatchEventArgv("C:\\repo\\event.mjs", "C:\\Program Files\\nodejs\\node.exe", "win32"),
    ['"C:\\Program Files\\nodejs\\node.exe"', '"C:\\repo\\event.mjs"'],
  );
  assert.deepEqual(nxWatchEventArgv("/repo/event.mjs", "/usr/bin/node", "darwin"), [
    "/usr/bin/node",
    "/repo/event.mjs",
  ]);
});

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
