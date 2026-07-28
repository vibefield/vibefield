import assert from "node:assert/strict";
import test from "node:test";
import { NX_CHANGE_MARKER, parseNxChangeLine } from "../src/nx-events.mjs";

test("extracts a change event even when Nx prefixes callback output", () => {
  const payload = Buffer.from(
    JSON.stringify({ project: "@vibefield/contracts", files: ["packages/contracts/src/shell.ts"] }),
  ).toString("base64url");
  assert.deepEqual(parseNxChangeLine(`[watch] ${NX_CHANGE_MARKER}${payload}`), {
    project: "@vibefield/contracts",
    files: ["packages/contracts/src/shell.ts"],
  });
  assert.equal(parseNxChangeLine("ordinary nx output"), null);
  assert.equal(parseNxChangeLine(`${NX_CHANGE_MARKER}not-base64`), null);
});
