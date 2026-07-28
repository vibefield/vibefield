import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createElectronStack } from "../src/electron-stack.mjs";

function setup() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1234, exitCode: null, signalCode: null });
  const updates = [];
  const products = [];
  const exits = [];
  let spawnArgs = null;
  let terminateArgs = null;
  const stack = createElectronStack({
    paths: {
      repoRoot: "/repo",
      dataRoot: "/repo/.vibefield/dev/data",
      electronUserData: "/repo/.vibefield/dev/user-data",
      desktopRoot: "/repo/apps/desktop",
      logRoot: "/repo/.vibefield/dev/logs",
    },
    viteUrl: "http://127.0.0.1:5174/",
    lock: {
      async update(value) {
        updates.push(value);
      },
    },
    log: { info() {}, warn() {}, error() {} },
    onUnexpectedExit(value) {
      exits.push(value);
    },
    electronExecutable: "/electron",
    spawnProcess(...args) {
      spawnArgs = args;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
    async readProduct() {
      return { pid: 2222, nativePid: 3333, buildId: "dev-daemon-current" };
    },
    async stopProduct(product, buildId) {
      products.push({ product, buildId });
    },
    async terminate(...args) {
      terminateArgs = args;
      child.exitCode = 0;
      child.emit("exit", 0, null);
      return { forced: false };
    },
  });
  return {
    child,
    updates,
    products,
    exits,
    getSpawnArgs: () => spawnArgs,
    getTerminateArgs: () => terminateArgs,
    stack,
  };
}

const runtime = {
  buildId: "dev-current",
  daemonBuildId: "dev-daemon-current",
  appRoot: "/repo/.vibefield/dev/runtime/dev-current/app",
  fielddOutput: "/repo/.vibefield/dev/runtime/dev-current/fieldd/bin.cjs",
  nativeOutput: "/repo/.vibefield/dev/runtime/dev-current/native/field-native",
};

test("starts Electron directly with isolated state and the daemon build identity", async () => {
  const fixture = setup();
  await fixture.stack.start(runtime);

  const [command, args, options] = fixture.getSpawnArgs();
  assert.equal(command, "/electron");
  assert.deepEqual(args, [
    "--user-data-dir=/repo/.vibefield/dev/user-data",
    "/repo/.vibefield/dev/runtime/dev-current/app",
    "--dev",
  ]);
  // The adoption gate compares against product.json, which records the
  // DAEMON plane — the combined snapshot id must not cross this boundary.
  assert.equal(options.env.VIBEFIELD_DEV_BUILD_ID, "dev-daemon-current");
  assert.equal(options.env.VIBEFIELD_DEV_REPO_ROOT, "/repo");
  assert.equal(options.env.FIELDD_BIN, runtime.fielddOutput);
  assert.equal(options.env.FIELDD_NATIVE_BIN, runtime.nativeOutput);
  assert.equal(options.env.FIELDD_CONTROL_PORT, "0");
  assert.equal(options.env.FIELDD_DATA_PORT, "0");
  assert.equal(options.env.VITE_DEV_SERVER_URL, "http://127.0.0.1:5174/");
  assert.deepEqual(fixture.updates, [{ electronPid: 1234, buildId: "dev-current" }]);
});

test("a shell-only stop leaves the daemon pair for the next shell to adopt", async () => {
  const fixture = setup();
  await fixture.stack.start(runtime);
  await fixture.stack.stop({ stopDaemons: false });

  assert.equal(fixture.stack.running, false);
  assert.deepEqual(fixture.exits, []);
  assert.deepEqual(fixture.products, []);
  assert.deepEqual(fixture.getTerminateArgs()[1], {
    graceMs: 10_000,
    killWaitMs: 2_000,
  });
  assert.deepEqual(fixture.updates.at(-1), { electronPid: null });
});

test("a daemon-plane stop verifies the pair against the daemon identity before reaping", async () => {
  const fixture = setup();
  await fixture.stack.start(runtime);
  await fixture.stack.stop({ stopDaemons: true });

  assert.deepEqual(fixture.products, [
    {
      product: { pid: 2222, nativePid: 3333, buildId: "dev-daemon-current" },
      buildId: "dev-daemon-current",
    },
  ]);
});

test("stop with daemons reaps the pair even when Electron already exited", async () => {
  const fixture = setup();
  await fixture.stack.start(runtime);
  fixture.child.exitCode = 1;
  fixture.child.emit("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.stack.stop({ stopDaemons: true });

  assert.deepEqual(fixture.products, [
    {
      product: { pid: 2222, nativePid: 3333, buildId: "dev-daemon-current" },
      buildId: "dev-daemon-current",
    },
  ]);
});

test("an unexpected exit leaves the daemons running and requests recovery", async () => {
  const fixture = setup();
  await fixture.stack.start(runtime);
  fixture.child.exitCode = 1;
  fixture.child.emit("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));

  // Recovery restarts Electron against the same daemon identity, so the new
  // shell adopts the running pair instead of respawning it.
  assert.deepEqual(fixture.products, []);
  assert.deepEqual(fixture.updates.at(-1), { electronPid: null });
  assert.deepEqual(fixture.exits, [{ code: 1, signal: null }]);
});
