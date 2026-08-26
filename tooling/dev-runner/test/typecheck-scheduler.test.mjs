import assert from "node:assert/strict";
import test from "node:test";
import { createTypecheckScheduler } from "../src/typecheck-scheduler.mjs";

test("does not report an in-flight typecheck cancellation after shutdown", async () => {
  let rejectRun;
  const failures = [];
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const scheduler = createTypecheckScheduler({
    runFull: () =>
      new Promise((_resolve, reject) => {
        rejectRun = reject;
        markStarted();
      }),
    async runAffected() {},
    onStart() {},
    onSuccess() {},
    onFailure(error) {
      failures.push(error);
    },
    debounceMs: 0,
  });

  scheduler.requestFull();
  await started;
  scheduler.close();
  rejectRun(new Error("signal SIGTERM"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(failures, []);
});
