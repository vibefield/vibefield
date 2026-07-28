import assert from "node:assert/strict";
import test from "node:test";
import { handoffDesktopRuntime } from "../src/runtime-handoff.mjs";

const current = { buildId: "dev-current", daemonBuildId: "dev-daemon-current" };

function electronRecorder(calls, { running = true } = {}) {
  return {
    running,
    async stop(options) {
      calls.push(["stop", options]);
    },
    async start(value) {
      calls.push(["start", value]);
      return 4321;
    },
  };
}

test("leaves the current desktop running when no coherent candidate can be staged", async () => {
  const calls = [];
  const result = await handoffDesktopRuntime({
    electron: electronRecorder(calls),
    currentRuntime: current,
    prepareRuntime: async () => null,
    isShuttingDown: () => false,
  });

  assert.deepEqual(result, { status: "deferred" });
  assert.deepEqual(calls, []);
});

test("a shell-only change restarts Electron and hands the daemons to the next shell", async () => {
  const calls = [];
  const runtime = {
    buildId: "dev-next",
    daemonBuildId: "dev-daemon-current",
    appRoot: "/snapshot/app",
  };
  const result = await handoffDesktopRuntime({
    electron: electronRecorder(calls),
    currentRuntime: current,
    prepareRuntime: async () => runtime,
    isShuttingDown: () => false,
  });

  assert.equal(result.status, "restarted");
  assert.equal(result.daemonsChanged, false);
  assert.deepEqual(calls, [
    ["stop", { stopDaemons: false }],
    ["start", runtime],
  ]);
});

test("a daemon-plane change reaps the pair before the new shell starts", async () => {
  const calls = [];
  const runtime = {
    buildId: "dev-next",
    daemonBuildId: "dev-daemon-next",
    appRoot: "/snapshot/app",
  };
  const result = await handoffDesktopRuntime({
    electron: electronRecorder(calls),
    currentRuntime: current,
    prepareRuntime: async () => runtime,
    isShuttingDown: () => false,
  });

  assert.equal(result.status, "restarted");
  assert.equal(result.daemonsChanged, true);
  assert.deepEqual(calls, [
    ["stop", { stopDaemons: true }],
    ["start", runtime],
  ]);
});

test("crash recovery with an unchanged build restarts into adoption, never a reap", async () => {
  const calls = [];
  const result = await handoffDesktopRuntime({
    electron: electronRecorder(calls, { running: false }),
    currentRuntime: current,
    prepareRuntime: async () => ({ ...current, appRoot: "/snapshot/app" }),
    isShuttingDown: () => false,
  });

  assert.equal(result.status, "restarted");
  assert.equal(result.daemonsChanged, false);
  assert.deepEqual(calls[0], ["stop", { stopDaemons: false }]);
});

test("starts the verified snapshot even if another build begins during shutdown", async () => {
  let buildReady = true;
  const calls = [];
  const runtime = {
    buildId: "dev-next",
    daemonBuildId: "dev-daemon-next",
    appRoot: "/snapshot/app",
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
    currentRuntime: current,
    prepareRuntime: async () => runtime,
    isShuttingDown: () => false,
  });

  assert.equal(result.status, "restarted");
  assert.equal(result.pid, 4321);
  assert.equal(result.runtime, runtime);
  assert.deepEqual(calls, ["stop", ["start", runtime, false]]);
});
