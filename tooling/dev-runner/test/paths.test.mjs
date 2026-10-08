import assert from "node:assert/strict";
import test from "node:test";
import { commandEndpointFor, devRootFor } from "../src/paths.mjs";

test("uses a repository-local Unix socket on POSIX hosts", () => {
  assert.equal(
    commandEndpointFor("/repo", "/repo/.vibefield/dev", "darwin"),
    "/repo/.vibefield/dev/runner.sock",
  );
  assert.equal(
    commandEndpointFor("/repo", "/repo/.vibefield/dev", "linux"),
    "/repo/.vibefield/dev/runner.sock",
  );
});

test("derives a stable repository-scoped Windows named pipe", () => {
  const first = commandEndpointFor("C:\\src\\vibe-field", "unused", "win32");
  const repeated = commandEndpointFor("C:\\src\\vibe-field", "elsewhere", "win32");
  const other = commandEndpointFor("C:\\src\\other", "unused", "win32");
  const prefix = String.raw`\\.\pipe\vibefield-dev-`;

  assert.equal(first.startsWith(prefix), true);
  assert.match(first.slice(prefix.length), /^[a-f0-9]{20}$/);
  assert.equal(repeated, first);
  assert.notEqual(other, first);
});

test("DK-18: keeps its state in the checkout unless VIBEFIELD_DEV_ROOT moves it whole", () => {
  assert.equal(devRootFor("/repo", {}), "/repo/.vibefield/dev");
  assert.equal(devRootFor("/repo", { VIBEFIELD_DEV_ROOT: "" }), "/repo/.vibefield/dev");
  assert.equal(devRootFor("/repo", { VIBEFIELD_DEV_ROOT: "/tmp/vf-studio-x" }), "/tmp/vf-studio-x");
});
