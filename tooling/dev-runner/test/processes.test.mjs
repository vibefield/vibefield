import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { buildCmdShellCommand, isPidAlive, launchSpec, terminateChild } from "../src/processes.mjs";

function killRejecting(code) {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

function fakeChild() {
  const signals = [];
  const child = new EventEmitter();
  Object.assign(child, {
    exitCode: null,
    signalCode: null,
    kill(signal) {
      signals.push(signal);
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit", 0, null));
    },
  });
  return { child, signals };
}

test("a process we may not query is alive, not dead", () => {
  // EACCES is libuv's mapping of the Windows ERROR_ACCESS_DENIED that a live
  // daemon answers with. Reading it as dead makes clearDeadDevProductFiles
  // delete product.json and shell.token under a running pair.
  assert.equal(isPidAlive(4321, killRejecting("EACCES")), true);
  assert.equal(isPidAlive(4321, killRejecting("EPERM")), true);
  assert.equal(isPidAlive(4321, killRejecting("ESRCH")), false);
  assert.equal(
    isPidAlive(0, () => {}),
    false,
  );
});

test("a batch command rides cmd.exe with every token quoted", () => {
  assert.deepEqual(buildCmdShellCommand("pnpm.cmd", ["nx", "watch"]), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", '"pnpm.cmd ^"nx^" ^"watch^""'],
  });
});

test("quoting survives spaces, embedded quotes, and trailing backslashes", () => {
  // Each expectation is what cmd hands CreateProcess AFTER caret processing:
  // `"--files=a b"`, `"say \"hi\""`, and `"C:\Program Files\x\\"` — the doubled
  // backslash is what stops the closing quote from being escaped away.
  assert.equal(
    buildCmdShellCommand("pnpm.cmd", ["--files=a b"]).args[3],
    '"pnpm.cmd ^"--files=a^ b^""',
  );
  assert.equal(
    buildCmdShellCommand("pnpm.cmd", ['say "hi"']).args[3],
    '"pnpm.cmd ^"say^ \\^"hi\\^"^""',
  );
  assert.equal(
    buildCmdShellCommand("pnpm.cmd", ["C:\\Program Files\\x\\"]).args[3],
    '"pnpm.cmd ^"C:\\Program^ Files\\x\\\\^""',
  );
});

test("only win32 non-images are relaunched through the shell", () => {
  assert.deepEqual(launchSpec("pnpm", ["gen"], "darwin"), {
    command: "pnpm",
    args: ["gen"],
    windowsVerbatimArguments: false,
  });
  // cargo.exe and electron.exe are real images: CreateProcess takes them
  // directly, and wrapping them would only add an escaping layer to get wrong.
  assert.deepEqual(launchSpec("cargo.exe", ["build"], "win32"), {
    command: "cargo.exe",
    args: ["build"],
    windowsVerbatimArguments: false,
  });
  const wrapped = launchSpec("pnpm.cmd", ["gen"], "win32");
  assert.equal(wrapped.command, "cmd.exe");
  assert.equal(wrapped.windowsVerbatimArguments, true);
});

test("a win32 stop admits it was forced; the unix ladder still reports grace", async () => {
  const forced = fakeChild();
  assert.deepEqual(await terminateChild(forced.child, { platform: "win32" }), { forced: true });
  assert.deepEqual(forced.signals, [undefined]);

  const graceful = fakeChild();
  assert.deepEqual(await terminateChild(graceful.child, { platform: "darwin" }), { forced: false });
  assert.deepEqual(graceful.signals, ["SIGTERM"]);
});
