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
      dataRoot: "/repo/.vibefield/dev/data",
      electronUserData: "/repo/.vibefield/dev/user-data",
      desktopRoot: "/repo/apps/desktop",
      fielddOutput: "/repo/packages/fieldd/dist/bin.cjs",
      nativeOutput: "/repo/target/debug/field-native",
      logRoot: "/repo/.vibefield/dev/logs",
    },
    viteUrl: "http://127.0.0.1:5174/",
    lock: {
      async update(value) {
        updates.push(value);
      },
    },
    log: { warn() {}, error() {} },
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
      return { pid: 2222, nativePid: 3333, buildId: "dev-current" };
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

test("starts Electron directly with isolated state and the current build identity", async () => {
  const fixture = setup();
  await fixture.stack.start("dev-current");

  const [command, args, options] = fixture.getSpawnArgs();
  assert.equal(command, "/electron");
  assert.deepEqual(args, [
    "--user-data-dir=/repo/.vibefield/dev/user-data",
    "/repo/apps/desktop",
    "--dev",
  ]);
  assert.equal(options.env.VIBEFIELD_DEV_BUILD_ID, "dev-current");
  assert.equal(options.env.FIELDD_CONTROL_PORT, "0");
  assert.equal(options.env.FIELDD_DATA_PORT, "0");
  assert.equal(options.env.VITE_DEV_SERVER_URL, "http://127.0.0.1:5174/");
  assert.deepEqual(fixture.updates, [{ electronPid: 1234, buildId: "dev-current" }]);
});

test("a managed stop suppresses crash recovery and cleans the captured owned product", async () => {
  const fixture = setup();
  await fixture.stack.start("dev-current");
  await fixture.stack.stop();

  assert.equal(fixture.stack.running, false);
  assert.deepEqual(fixture.exits, []);
  assert.deepEqual(fixture.products, [
    {
      product: { pid: 2222, nativePid: 3333, buildId: "dev-current" },
      buildId: "dev-current",
    },
  ]);
  assert.deepEqual(fixture.getTerminateArgs()[1], {
    graceMs: 10_000,
    killWaitMs: 2_000,
  });
  assert.deepEqual(fixture.updates.at(-1), { electronPid: null });
});

test("an unexpected exit cleans children before requesting recovery", async () => {
  const fixture = setup();
  await fixture.stack.start("dev-current");
  fixture.child.exitCode = 1;
  fixture.child.emit("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.products, [
    {
      product: { pid: 2222, nativePid: 3333, buildId: "dev-current" },
      buildId: "dev-current",
    },
  ]);
  assert.deepEqual(fixture.updates.at(-1), { electronPid: null });
  assert.deepEqual(fixture.exits, [{ code: 1, signal: null }]);
});
