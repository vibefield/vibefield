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

// This row is the regression pin for a win32-only production defect found
// 2026-08-11: the externalize-bare-imports filter (`/^[^./]/` — "neither
// relative nor absolute") also matches a DRIVE LETTER, so on Windows it
// externalized the entry point, esbuild refused the build, and the resolver's
// catch reported null. Every plugin service then degraded to entry-file-only
// watching, silently — and the sibling row below ("returns null when the entry
// cannot be resolved") kept passing for the wrong reason the whole time. It
// runs on both platforms deliberately: the fix is platform-independent, and a
// skip here is what let the defect hide.
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
