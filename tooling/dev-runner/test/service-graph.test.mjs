import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveServiceModules } from "../src/service-graph.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vf-service-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("resolves the entry's relative import closure and leaves bare imports external", async (t) => {
  const root = await fixture(t);
  const pluginRoot = join(root, "plugins", "demo");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    join(pluginRoot, "service.js"),
    'import { store } from "./store.js";\nimport "./nested";\nimport "@vibefield/plugin-sdk";\nexport default store;\n',
  );
  await writeFile(join(pluginRoot, "store.js"), "export const store = new Map();\n");
  // Extensionless relative import — the worker harness resolves these, so
  // the graph resolver must too.
  await writeFile(join(pluginRoot, "nested.js"), "export const nested = 1;\n");

  const modules = await resolveServiceModules(root, join(pluginRoot, "service.js"));
  assert.deepEqual(modules, [
    "plugins/demo/nested.js",
    "plugins/demo/service.js",
    "plugins/demo/store.js",
  ]);
});

test("returns null when the entry cannot be resolved so the caller can fall back", async (t) => {
  const root = await fixture(t);
  const pluginRoot = join(root, "plugins", "broken");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(pluginRoot, "service.js"), 'import "./missing.js";\n');

  assert.equal(await resolveServiceModules(root, join(pluginRoot, "service.js")), null);
  assert.equal(await resolveServiceModules(root, join(pluginRoot, "absent-entry.js")), null);
});
