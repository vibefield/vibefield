import assert from "node:assert/strict";
import test from "node:test";
import { buildChildEnv } from "../src/env.mjs";

test("win32 removes the variable whatever the inherited spelling was", () => {
  // The failure this exists to stop: a case-variant survives the delete, the
  // Electron we launch sees ELECTRON_RUN_AS_NODE, and the desktop shell comes
  // up as plain Node.
  assert.deepEqual(
    buildChildEnv(
      { Path: "C:\\bin", Electron_Run_As_Node: "1" },
      { unset: ["ELECTRON_RUN_AS_NODE"] },
      "win32",
    ),
    { Path: "C:\\bin" },
  );
});

test("elsewhere the environment is case-sensitive and stays untouched", () => {
  assert.deepEqual(
    buildChildEnv(
      { PATH: "/bin", Electron_Run_As_Node: "1" },
      { unset: ["ELECTRON_RUN_AS_NODE"] },
      "linux",
    ),
    { PATH: "/bin", Electron_Run_As_Node: "1" },
  );
  assert.deepEqual(
    buildChildEnv(
      { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" },
      { unset: ["ELECTRON_RUN_AS_NODE"] },
      "darwin",
    ),
    { PATH: "/bin" },
  );
});

test("an override replaces a variant spelling with the casing we intended", () => {
  assert.deepEqual(buildChildEnv({ Nx_Daemon: "false" }, { set: { NX_DAEMON: "true" } }, "win32"), {
    NX_DAEMON: "true",
  });
  assert.deepEqual(buildChildEnv({ Nx_Daemon: "false" }, { set: { NX_DAEMON: "true" } }, "linux"), {
    Nx_Daemon: "false",
    NX_DAEMON: "true",
  });
});

test("the base environment is never mutated", () => {
  const base = { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" };
  buildChildEnv(base, { set: { A: "1" }, unset: ["ELECTRON_RUN_AS_NODE"] }, "win32");
  assert.deepEqual(base, { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" });
});
