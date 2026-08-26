import assert from "node:assert/strict";
import test from "node:test";
import { commandEndpointFor } from "../src/paths.mjs";

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
