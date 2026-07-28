import assert from "node:assert/strict";
import test from "node:test";
import { createRestartCoordinator } from "../src/restart-coordinator.mjs";

test("coalesces reasons and waits for build/workflow readiness", async () => {
  let ready = false;
  const runs = [];
  const coordinator = createRestartCoordinator({
    canRestart: () => ready,
    restart: async (reasons) => runs.push(reasons),
    onError: (error) => {
      throw error;
    },
    debounceMs: 10,
  });

  coordinator.request("fieldd");
  coordinator.request("electron-main");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(runs, []);

  ready = true;
  coordinator.wake();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(runs, [["electron-main", "fieldd"]]);
  coordinator.close();
});
