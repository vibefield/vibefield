import assert from "node:assert/strict";
import test from "node:test";
import { createCriticalTaskQueue } from "../src/task-queue.mjs";

test("coalesces contract/native edits into one ordered native rebuild", async () => {
  const calls = [];
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const queue = createCriticalTaskQueue({
    handlers: {
      allManifests: async () => calls.push("all-manifests"),
      manifest: async (project) => calls.push(`manifest:${project}`),
      contracts: async () => calls.push("contracts"),
      native: async () => calls.push("native"),
      pluginRuntime: async () => calls.push("plugin-runtime"),
    },
    onBusyChange() {},
    onSuccess() {
      resolveDone();
    },
    onFailure: (error) => {
      throw error;
    },
    debounceMs: 5,
  });

  queue.enqueue({ kind: "native" });
  queue.enqueue({ kind: "contracts" });
  await done;

  assert.deepEqual(calls, ["contracts", "native"]);
  assert.equal(queue.healthy, true);
  queue.close();
});

test("keeps the last valid runtime on failure and retries on the next relevant edit", async () => {
  let attempts = 0;
  let failures = 0;
  let resolveSuccess;
  const succeeded = new Promise((resolve) => {
    resolveSuccess = resolve;
  });
  const queue = createCriticalTaskQueue({
    handlers: {
      allManifests: async () => {},
      manifest: async () => {},
      contracts: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("invalid contract");
      },
      native: async () => {},
      pluginRuntime: async () => {},
    },
    onBusyChange() {},
    onSuccess() {
      resolveSuccess();
    },
    onFailure() {
      failures += 1;
    },
    debounceMs: 5,
  });

  queue.enqueue({ kind: "contracts" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.healthy, false);
  assert.equal(failures, 1);

  queue.enqueue({ kind: "contracts" });
  await succeeded;
  assert.equal(attempts, 2);
  assert.equal(queue.healthy, true);
  queue.close();
});

test("does not strand a corrective edit saved while the failing build is still running", async () => {
  const calls = [];
  let rejectFirst;
  let resolveSuccess;
  let resolveFirstStarted;
  const firstStarted = new Promise((resolve) => {
    resolveFirstStarted = resolve;
  });
  const firstMayFail = new Promise((_, reject) => {
    rejectFirst = reject;
  });
  const succeeded = new Promise((resolve) => {
    resolveSuccess = resolve;
  });
  let attempts = 0;
  const queue = createCriticalTaskQueue({
    handlers: {
      allManifests: async () => {},
      manifest: async () => {},
      contracts: async () => {
        attempts += 1;
        calls.push(`contracts:${attempts}`);
        if (attempts === 1) {
          resolveFirstStarted();
          await firstMayFail;
        }
      },
      native: async () => calls.push("native"),
      pluginRuntime: async () => {},
    },
    onBusyChange() {},
    onSuccess() {
      resolveSuccess();
    },
    onFailure() {
      calls.push("failure");
    },
    debounceMs: 1,
  });

  queue.enqueue({ kind: "contracts" });
  await firstStarted;
  await new Promise((resolve) => setTimeout(resolve, 10));
  queue.enqueue({ kind: "contracts" });
  rejectFirst(new Error("first source snapshot was invalid"));

  await Promise.race([
    succeeded,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("corrective edit was never processed")), 250),
    ),
  ]);
  assert.deepEqual(calls, ["contracts:1", "failure", "contracts:2", "native"]);
  assert.equal(queue.healthy, true);
  queue.close();
});
