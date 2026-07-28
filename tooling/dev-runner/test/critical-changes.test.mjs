import assert from "node:assert/strict";
import test from "node:test";
import { classifyCriticalChange, shouldIgnoreWatchPath } from "../src/critical-changes.mjs";

const plugins = [
  {
    name: "@vibefield/plugin-example-kv",
    root: "examples/plugins/kv-service",
    manifestFile: "examples/plugins/kv-service/vibefield.plugin.json",
    serviceEntry: "examples/plugins/kv-service/service.js",
    serviceModules: [
      "examples/plugins/kv-service/service.js",
      "examples/plugins/kv-service/store.js",
      // A relative import may legally escape the plugin directory; it is
      // runtime input all the same.
      "examples/plugins/shared/format.js",
    ],
  },
];

test("classifies only changes that require generated output or a process restart", () => {
  assert.deepEqual(classifyCriticalChange("packages/contracts/src/shell.ts", plugins), {
    kind: "contracts",
  });
  assert.deepEqual(classifyCriticalChange("packages/field-native/src/main.rs", plugins), {
    kind: "native",
  });
  assert.equal(classifyCriticalChange("packages/field-native/src/contracts.rs", plugins), null);
  assert.deepEqual(classifyCriticalChange("examples/plugins/kv-service/src/manifest.ts", plugins), {
    kind: "manifest",
    project: "@vibefield/plugin-example-kv",
  });
  assert.deepEqual(classifyCriticalChange("examples/plugins/kv-service/service.js", plugins), {
    kind: "plugin-runtime",
    project: "@vibefield/plugin-example-kv",
  });
  assert.equal(classifyCriticalChange("examples/plugins/kv-service/src/index.ts", plugins), null);
});

test("every module in a service's import closure is restart-triggering", () => {
  assert.deepEqual(classifyCriticalChange("examples/plugins/kv-service/store.js", plugins), {
    kind: "plugin-runtime",
    project: "@vibefield/plugin-example-kv",
  });
  assert.deepEqual(classifyCriticalChange("examples/plugins/shared/format.js", plugins), {
    kind: "plugin-runtime",
    project: "@vibefield/plugin-example-kv",
  });
  // A descriptor without the resolved closure (resolution failed) still
  // covers its entry file.
  const fallback = [
    {
      name: "@vibefield/plugin-note",
      root: "plugins/note",
      manifestFile: "plugins/note/vibefield.plugin.json",
      serviceEntry: "plugins/note/service.js",
    },
  ];
  assert.deepEqual(classifyCriticalChange("plugins/note/service.js", fallback), {
    kind: "plugin-runtime",
    project: "@vibefield/plugin-note",
  });
});

test("watch filtering excludes generated and dependency trees", () => {
  assert.equal(shouldIgnoreWatchPath("plugins/note/dist/renderer.js"), true);
  assert.equal(shouldIgnoreWatchPath("packages/contracts/node_modules/zod/index.js"), true);
  assert.equal(shouldIgnoreWatchPath("packages/contracts/src/shell.ts"), false);
});
