import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { smokeGodviewArgv } from "../../../scripts/godview-lab-arms.mjs";

// Item 610 (2026-11-19): the Godview smoke's Electron arguments (scripts/smoke-godview.mjs). The
// mock keychain is handed on when asked, and the list is the smoke's own when it is not.

const ROOT = join(import.meta.dirname, "..", "..", "..");
const TAIL = [
  "--user-data-dir=/p",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];

test("absent: the list the smoke has always started Electron with", () => {
  assert.deepEqual(smokeGodviewArgv([], "/p"), [".", "--smoke-godview", ...TAIL]);
});

test("a mode: after the mode flag, nothing else moved", () => {
  assert.deepEqual(smokeGodviewArgv(["--terminal-direct-proof"], "/p"), [
    ".",
    "--smoke-godview",
    "--terminal-direct-proof",
    ...TAIL,
  ]);
});

test("asked: the mock keychain in the same place, alone or after a mode, in order", () => {
  assert.deepEqual(smokeGodviewArgv(["--use-mock-keychain"], "/p"), [
    ".",
    "--smoke-godview",
    "--use-mock-keychain",
    ...TAIL,
  ]);
  assert.deepEqual(smokeGodviewArgv(["--terminal-direct-proof", "--use-mock-keychain"], "/p"), [
    ".",
    "--smoke-godview",
    "--terminal-direct-proof",
    "--use-mock-keychain",
    ...TAIL,
  ]);
});

test("the guard admits the mock keychain and refuses any other argument, before Electron", () => {
  const launcher = join(ROOT, "scripts", "smoke-godview.mjs");
  const run = spawnSync(process.execPath, [launcher, "--use-mock-keychain", "--nope"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /\[--use-mock-keychain\]/);
  assert.match(run.stderr, /\(unknown: --nope\)/);
});
