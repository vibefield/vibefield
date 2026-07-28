import assert from "node:assert/strict";
import test from "node:test";
import { createChangeBuffer } from "../src/change-buffer.mjs";

test("drains every unique startup change and then delivers live changes directly", () => {
  const changes = createChangeBuffer();
  const delivered = [];

  changes.push("packages/contracts/src/mgmt.ts");
  changes.push("packages/contracts/src/mgmt.ts");
  changes.push("packages/field-native/src/lib.rs");
  assert.equal(changes.size, 2);

  changes.attach((file) => delivered.push(file));
  changes.push("examples/plugins/kv-service/service.js");

  assert.deepEqual(delivered, [
    "packages/contracts/src/mgmt.ts",
    "packages/field-native/src/lib.rs",
    "examples/plugins/kv-service/service.js",
  ]);
  assert.equal(changes.size, 0);
});
