import assert from "node:assert/strict";
import test from "node:test";
import { createTypecheckScheduler } from "../src/typecheck-scheduler.mjs";

test("does not report an in-flight typecheck cancellation after shutdown", async () => {
  let rejectRun;
  const failures = [];
  const scheduler = createTypecheckScheduler({
    runFull: () =>
      new Promise((_resolve, reject) => {
        rejectRun = reject;
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
  await new Promise((resolve) => setImmediate(resolve));
  scheduler.close();
  rejectRun(new Error("signal SIGTERM"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(failures, []);
});
