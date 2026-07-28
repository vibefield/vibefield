import assert from "node:assert/strict";
import test from "node:test";
import { handoffDesktopRuntime } from "../src/runtime-handoff.mjs";

test("leaves the current desktop running when no coherent candidate can be staged", async () => {
  const calls = [];
  const result = await handoffDesktopRuntime({
    electron: {
      running: true,
      async stop() {
        calls.push("stop");
      },
      async start() {
        calls.push("start");
      },
    },
    currentBuildId: "dev-current",
    prepareRuntime: async () => null,
    isShuttingDown: () => false,
  });

  assert.deepEqual(result, { status: "deferred" });
  assert.deepEqual(calls, []);
});

test("starts the verified snapshot even if another build begins during shutdown", async () => {
  let buildReady = true;
  const calls = [];
  const runtime = {
    buildId: "dev-next",
    appRoot: "/snapshot/app",
    fielddOutput: "/snapshot/fieldd/bin.cjs",
    nativeOutput: "/snapshot/native/field-native",
  };
  const result = await handoffDesktopRuntime({
    electron: {
      running: true,
      async stop() {
        calls.push("stop");
        buildReady = false;
      },
      async start(value) {
        calls.push(["start", value, buildReady]);
        return 4321;
      },
    },
    currentBuildId: "dev-current",
    prepareRuntime: async () => runtime,
    isShuttingDown: () => false,
  });

  assert.equal(result.status, "restarted");
  assert.equal(result.pid, 4321);
  assert.equal(result.runtime, runtime);
  assert.deepEqual(calls, ["stop", ["start", runtime, false]]);
});
