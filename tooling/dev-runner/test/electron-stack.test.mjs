import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createElectronStack,
  createRosettadBinResolver,
  createSidecarPathResolver,
} from "../src/electron-stack.mjs";

function setup({
  studioOpen = true,
  studioPhysical = false,
  rosettadBin = null,
  resolveRosettadBin = () => rosettadBin,
  sidecarPath = null,
  resolveSidecarPath = () => ({ path: sidecarPath }),
} = {}) {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1234, exitCode: null, signalCode: null, connected: true });
  const updates = [];
  const products = [];
  const exits = [];
  const commands = [];
  const said = [];
  const warnings = [];
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
    log: {
      info(line) {
        said.push(line);
      },
      warn(message) {
        warnings.push(message);
      },
      error() {},
    },
    onUnexpectedExit(value) {
      exits.push(value);
    },
    electronExecutable: "/electron",
    // AR-0: the sibling lock's rosettad, resolved outside the unit (the
    // default reads siblings.lock.json and asks cargo — not a unit's business)
    resolveRosettadBin,
    // the truffle bump: the dev floor's sidecar, resolved outside the unit too
    // (the default reads siblings.lock.json and the vendored package)
    resolveSidecarPath,
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
    said,
    warnings,
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
  cellOutput: "/repo/.vibefield/dev/runtime/dev-current/native/field-terminal-host",
  freewayOutput: "/repo/.vibefield/dev/runtime/dev-current/native/field-freeway-host",
};

test("hands fieldd the built rosettad when the sibling lock resolves one (AR-0)", async () => {
  const fixture = setup({ rosettadBin: "/ssd/rust-target/rosetta/release/rosettad" });
  await fixture.stack.start(runtime);
  const [, , options] = fixture.getSpawnArgs();
  assert.equal(options.env.FIELDD_ROSETTAD_BIN, "/ssd/rust-target/rosetta/release/rosettad");
});

/** Run `body` with FIELDD_ROSETTAD_BIN exported in THIS process, as a lane's
 * gate command exports it, and restore whatever the launching shell had. */
async function withExportedRosettadBin(value, body) {
  const had = Object.hasOwn(process.env, "FIELDD_ROSETTAD_BIN");
  const previous = process.env.FIELDD_ROSETTAD_BIN;
  process.env.FIELDD_ROSETTAD_BIN = value;
  try {
    await body();
  } finally {
    if (had) process.env.FIELDD_ROSETTAD_BIN = previous;
    else delete process.env.FIELDD_ROSETTAD_BIN;
  }
}

test("strips an inherited FIELDD_ROSETTAD_BIN when the resolver names none (c5804e6a)", async () => {
  // The row below the start test asserts absence too, but only a shell that
  // exports the variable can tell the strip from its absence — this one does.
  await withExportedRosettadBin("/stale/lane/rosettad", async () => {
    const fixture = setup({ rosettadBin: null });
    await fixture.stack.start(runtime);
    const [, , options] = fixture.getSpawnArgs();
    assert.equal("FIELDD_ROSETTAD_BIN" in options.env, false);
  });
});

test("the resolver's rosettad replaces an inherited one, never rides beside it", async () => {
  await withExportedRosettadBin("/stale/lane/rosettad", async () => {
    const fixture = setup({ rosettadBin: "/ssd/rust-target/rosetta/release/rosettad" });
    await fixture.stack.start(runtime);
    const [, , options] = fixture.getSpawnArgs();
    assert.equal(options.env.FIELDD_ROSETTAD_BIN, "/ssd/rust-target/rosetta/release/rosettad");
  });
});

test("a resolver answering none, then a build, is honoured at the next launch (AC-7)", async () => {
  const answers = [null, "/ssd/rust-target/rosetta/release/rosettad"];
  const fixture = setup({ resolveRosettadBin: () => answers.shift() ?? null });
  await fixture.stack.start(runtime);
  assert.equal("FIELDD_ROSETTAD_BIN" in fixture.getSpawnArgs()[2].env, false);
  await fixture.stack.stop({ stopDaemons: false });
  await fixture.stack.start(runtime);
  assert.equal(
    fixture.getSpawnArgs()[2].env.FIELDD_ROSETTAD_BIN,
    "/ssd/rust-target/rosetta/release/rosettad",
  );
});

test("the default resolver memoizes only the shell's explicit choice, never a missing build", () => {
  const lookups = [null, "/ssd/built/rosettad"];
  let asked = 0;
  const lookup = () => {
    asked += 1;
    return lookups.shift() ?? null;
  };
  const unset = createRosettadBinResolver({ env: {}, lookup });
  assert.equal(unset(), null);
  assert.equal(unset(), "/ssd/built/rosettad");
  assert.equal(asked, 2);

  const explicit = createRosettadBinResolver({
    env: { FIELDD_ROSETTAD_BIN: "/shell/rosettad" },
    lookup: () => assert.fail("the lock is not asked when the shell names a rosettad"),
  });
  assert.equal(explicit(), "/shell/rosettad");
  assert.equal(explicit(), "/shell/rosettad");

  const empty = createRosettadBinResolver({ env: { FIELDD_ROSETTAD_BIN: "" }, lookup: () => null });
  assert.equal(empty(), null, "an empty variable is no choice");
});

/** Run `body` with `name` set to `value` in THIS process (absent for
 * undefined), and restore whatever the launching shell had: a developer's
 * `.env` may export FIELD_NATIVE_SIDECAR_PATH, which `buildChildEnv` passes on. */
async function withVariable(name, value, body) {
  const had = Object.hasOwn(process.env, name);
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    await body();
  } finally {
    if (had) process.env[name] = previous;
    else delete process.env[name];
  }
}

test("the floor runs the cell beside it: an exported FIELD_NATIVE_CELL_BIN never reaches fieldd (TC-S2)", async () => {
  // James's `.env` pins the variable to a cargo target, outside the snapshot:
  // the start-up reaper then convicted the floor's live cells as socket
  // squatters, and a cargo build swapped the cell under a running floor. The
  // runner's own cell is staged beside the floor, which finds it as its sibling.
  await withVariable("FIELD_NATIVE_FREEWAY_BIN", undefined, () =>
    withVariable("FIELD_NATIVE_CELL_BIN", "/ssd/rust/lane/debug/field-terminal-host", async () => {
      const fixture = setup();
      await fixture.stack.start(runtime);
      const [, , options] = fixture.getSpawnArgs();
      assert.equal("FIELD_NATIVE_CELL_BIN" in options.env, false);
      assert.equal(options.env.FIELDD_NATIVE_BIN, runtime.nativeOutput);
      assert.deepEqual(fixture.said, [
        "daemon plane dev-daemon-current: the floor's cell is /repo/.vibefield/dev/runtime/dev-current/native/field-terminal-host and its freeway host is /repo/.vibefield/dev/runtime/dev-current/native/field-freeway-host (FIELD_NATIVE_CELL_BIN=/ssd/rust/lane/debug/field-terminal-host from the environment ignored)",
      ]);
    }),
  );
});

test("the floor runs the freeway host beside it: an exported FIELD_NATIVE_FREEWAY_BIN never reaches fieldd either (F1)", async () => {
  // The freeway host is the floor's other child found as its sibling, behind
  // the same kind of seam: the variable is dropped and named, as the cell's is.
  await withVariable("FIELD_NATIVE_CELL_BIN", "/ssd/rust/lane/debug/field-terminal-host", () =>
    withVariable(
      "FIELD_NATIVE_FREEWAY_BIN",
      "/ssd/rust/lane/debug/field-freeway-host",
      async () => {
        const fixture = setup();
        await fixture.stack.start(runtime);
        const [, , options] = fixture.getSpawnArgs();
        assert.equal("FIELD_NATIVE_CELL_BIN" in options.env, false);
        assert.equal("FIELD_NATIVE_FREEWAY_BIN" in options.env, false);
        assert.deepEqual(fixture.said, [
          "daemon plane dev-daemon-current: the floor's cell is /repo/.vibefield/dev/runtime/dev-current/native/field-terminal-host and its freeway host is /repo/.vibefield/dev/runtime/dev-current/native/field-freeway-host (FIELD_NATIVE_CELL_BIN=/ssd/rust/lane/debug/field-terminal-host, FIELD_NATIVE_FREEWAY_BIN=/ssd/rust/lane/debug/field-freeway-host from the environment ignored)",
        ]);
      },
    ),
  );
});

test("the cell and the freeway host are named once per daemon identity, never at a shell-only restart", async () => {
  await withVariable("FIELD_NATIVE_FREEWAY_BIN", undefined, () =>
    withVariable("FIELD_NATIVE_CELL_BIN", undefined, async () => {
      const fixture = setup();
      await fixture.stack.start(runtime);
      await fixture.stack.stop({ stopDaemons: false });
      // A shell-only edit: the new shell adopts the pair, whose cell and host are unchanged.
      await fixture.stack.start({ ...runtime, buildId: "dev-shell-edit" });
      await fixture.stack.stop({ stopDaemons: true });
      await fixture.stack.start({
        ...runtime,
        buildId: "dev-next",
        daemonBuildId: "dev-daemon-next",
        cellOutput: "/repo/.vibefield/dev/runtime/dev-next/native/field-terminal-host",
        freewayOutput: "/repo/.vibefield/dev/runtime/dev-next/native/field-freeway-host",
      });

      assert.deepEqual(fixture.said, [
        "daemon plane dev-daemon-current: the floor's cell is /repo/.vibefield/dev/runtime/dev-current/native/field-terminal-host and its freeway host is /repo/.vibefield/dev/runtime/dev-current/native/field-freeway-host",
        "daemon plane dev-daemon-next: the floor's cell is /repo/.vibefield/dev/runtime/dev-next/native/field-terminal-host and its freeway host is /repo/.vibefield/dev/runtime/dev-next/native/field-freeway-host",
      ]);
    }),
  );
});

const VENDORED =
  "/repo/apps/desktop/node_modules/@vibecook/truffle-sidecar-darwin-arm64/bin/sidecar-slim";

test("hands the floor the lock's sidecar as FIELD_NATIVE_SIDECAR_PATH (the truffle bump)", async () => {
  const fixture = setup({ sidecarPath: VENDORED });
  await fixture.stack.start(runtime);
  const [, , options] = fixture.getSpawnArgs();
  assert.equal(options.env.FIELD_NATIVE_SIDECAR_PATH, VENDORED);
  assert.deepEqual(fixture.warnings, []);
});

test("sets no FIELD_NATIVE_SIDECAR_PATH when nothing names a file, so the floor searches", async () => {
  await withVariable("FIELD_NATIVE_SIDECAR_PATH", undefined, async () => {
    const fixture = setup({ sidecarPath: null });
    await fixture.stack.start(runtime);
    const [, , options] = fixture.getSpawnArgs();
    // never an empty string or a path to nothing: the floor treats the variable
    // as authoritative and would report Degraded instead of searching
    assert.equal("FIELD_NATIVE_SIDECAR_PATH" in options.env, false);
  });
});

test("strips an inherited EMPTY sidecar variable when the resolver names none (the rosettad pattern)", async () => {
  // The row above removes the variable, so it cannot tell the strip from its
  // absence; this one exports it, as a shell with `FIELD_NATIVE_SIDECAR_PATH=`
  // in its .env does. The resolver reads an empty value as no choice, but the
  // floor reads it as an authoritative override naming nothing (`var_os` gives
  // Some("")), and would report the mesh Degraded instead of searching.
  await withVariable("FIELD_NATIVE_SIDECAR_PATH", "", async () => {
    await withVariable("TRUFFLE_SIDECAR_PATH", "", async () => {
      const fixture = setup({ sidecarPath: null });
      await fixture.stack.start(runtime);
      const [, , options] = fixture.getSpawnArgs();
      assert.equal("FIELD_NATIVE_SIDECAR_PATH" in options.env, false);
      assert.equal("TRUFFLE_SIDECAR_PATH" in options.env, false);
    });
  });
});

test("a resolver warning reaches the runner's log at launch", async () => {
  const fixture = setup({
    resolveSidecarPath: () => ({
      path: "/repo/.vibefield/sidecar/sidecar-slim-0.7.14-ws-target-path",
      warning: "FIELD_NATIVE_SIDECAR_PATH names the override, not the lock's sidecar",
    }),
  });
  await fixture.stack.start(runtime);
  assert.equal(
    fixture.getSpawnArgs()[2].env.FIELD_NATIVE_SIDECAR_PATH,
    "/repo/.vibefield/sidecar/sidecar-slim-0.7.14-ws-target-path",
  );
  assert.equal(fixture.warnings.length, 1);
  assert.match(fixture.warnings[0], /^\[sidecar\] .*not the lock's sidecar/);
});

test("the sidecar resolver: the lock's pin, unless the shell names one, and then it says so", () => {
  let asked = 0;
  const pin = () => {
    asked += 1;
    return { source: "npm", path: VENDORED };
  };
  // no explicit choice: the pin, asked afresh every launch
  const unset = createSidecarPathResolver({ env: {}, lookup: pin });
  assert.deepEqual(unset(), { path: VENDORED });
  assert.deepEqual(unset(), { path: VENDORED });
  assert.equal(asked, 2);

  // the shell's choice wins, exactly as field-native ranks it, and a foreign one warns
  const override = "/repo/.vibefield/sidecar/sidecar-slim-0.7.14-ws-target-path";
  const foreign = createSidecarPathResolver({
    env: { FIELD_NATIVE_SIDECAR_PATH: override },
    lookup: pin,
  })();
  assert.equal(foreign.path, override);
  assert.match(
    foreign.warning,
    /names .*sidecar-slim-0\.7\.14-ws-target-path, not the lock's sidecar/,
  );
  assert.match(foreign.warning, /truffle-sidecar-darwin-arm64/);

  // naming the pin itself is no warning
  assert.deepEqual(
    createSidecarPathResolver({ env: { FIELD_NATIVE_SIDECAR_PATH: VENDORED }, lookup: pin })(),
    { path: VENDORED },
  );
  // truffle's own name counts as a choice, below field-native's, and its
  // warning names the variable that made the choice
  const truffleChoice = createSidecarPathResolver({
    env: { TRUFFLE_SIDECAR_PATH: "/t/sidecar" },
    lookup: pin,
  })();
  assert.equal(truffleChoice.path, "/t/sidecar");
  assert.match(truffleChoice.warning, /^TRUFFLE_SIDECAR_PATH names \/t\/sidecar, not the lock's/);
  assert.equal(
    createSidecarPathResolver({
      env: { FIELD_NATIVE_SIDECAR_PATH: "/f/sidecar", TRUFFLE_SIDECAR_PATH: "/t/sidecar" },
      lookup: pin,
    })().path,
    "/f/sidecar",
  );
  // an empty variable is no choice
  assert.deepEqual(
    createSidecarPathResolver({ env: { FIELD_NATIVE_SIDECAR_PATH: "" }, lookup: pin })(),
    { path: VENDORED },
  );
  // nothing on disk: nothing set; a foreign choice still says what the pin is
  const none = () => ({ source: "npm", path: null });
  assert.deepEqual(createSidecarPathResolver({ env: {}, lookup: none })(), { path: null });
  const foreignNone = createSidecarPathResolver({
    env: { FIELD_NATIVE_SIDECAR_PATH: override },
    lookup: none,
  })();
  assert.equal(foreignNone.path, override);
  assert.match(foreignNone.warning, /\(npm, not on disk\)/);
  // a window whose sidecar is not built: nothing set, and the reason is said
  const unbuilt = () => ({ source: "window", path: null, reason: "run `pnpm siblings:build`" });
  assert.deepEqual(createSidecarPathResolver({ env: {}, lookup: unbuilt })(), {
    path: null,
    warning: "run `pnpm siblings:build`",
  });
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
