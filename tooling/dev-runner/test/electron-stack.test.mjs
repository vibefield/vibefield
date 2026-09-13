import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createElectronStack } from "../src/electron-stack.mjs";

function setup({ studioOpen = true, studioPhysical = false, rosettadBin = null } = {}) {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1234, exitCode: null, signalCode: null, connected: true });
  const updates = [];
  const products = [];
  const exits = [];
  const commands = [];
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
    studioOpen,
    studioPhysical,
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
    // AR-0: the sibling lock's rosettad, resolved outside the unit (the
    // default reads siblings.lock.json and asks cargo — not a unit's business)
    resolveRosettadBin: () => rosettadBin,
    spawnProcess(...args) {
      spawnArgs = args;
      child.send = (message, callback) => {
        commands.push(message);
        callback(null);
        queueMicrotask(() =>
          child.emit("message", {
            version: 1,
            type: "vibefield.dev-command-result",
            requestId: message.requestId,
            ok: true,
            result: { state: "delivered" },
          }),
        );
      };
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
    commands,
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

test("hands fieldd the built rosettad when the sibling lock resolves one (AR-0)", async () => {
  const fixture = setup({ rosettadBin: "/ssd/rust-target/rosetta/release/rosettad" });
  await fixture.stack.start(runtime);
  const [, , options] = fixture.getSpawnArgs();
  assert.equal(options.env.FIELDD_ROSETTAD_BIN, "/ssd/rust-target/rosetta/release/rosettad");
});

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
  // AR-0: no built rosettad ⇒ the variable is ABSENT (fieldd's honest
  // "unconfigured"), never an empty string or a path to nothing
  assert.equal("FIELDD_ROSETTAD_BIN" in options.env, false);
  assert.equal(options.env.VITE_DEV_SERVER_URL, "http://127.0.0.1:5174/");
  assert.equal(options.env.VIBEFIELD_STUDIO_OPEN, "1");
  assert.equal(options.env.VIBEFIELD_STUDIO_PHYSICAL, "0");
  assert.deepEqual(options.stdio, ["inherit", "inherit", "inherit", "ipc"]);
  assert.deepEqual(fixture.updates, [{ electronPid: 1234, buildId: "dev-current" }]);
});

test("marks only the opt-in Studio physical Electron composition", async () => {
  const fixture = setup({ studioPhysical: true });
  await fixture.stack.start(runtime);

  assert.equal(fixture.getSpawnArgs()[2].env.VIBEFIELD_STUDIO_PHYSICAL, "1");
});

test("queues Studio intent before Electron starts and delivers commands over child IPC", async () => {
  const fixture = setup({ studioOpen: false });
  assert.deepEqual(await fixture.stack.command({ type: "studio.open", section: "design" }), {
    state: "queued",
    studioRequested: true,
  });
  await fixture.stack.start(runtime);
  assert.equal(fixture.getSpawnArgs()[2].env.VIBEFIELD_STUDIO_OPEN, "1");

  assert.deepEqual(await fixture.stack.command({ type: "studio.close" }), {
    state: "delivered",
  });
  assert.deepEqual(fixture.commands.at(-1), {
    version: 1,
    type: "vibefield.dev-command",
    requestId: "runner-1",
    command: { type: "studio.close" },
  });
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
