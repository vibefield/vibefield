import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(t, entry, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-census-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value);
  };
  write("pnpm-workspace.yaml", 'packages:\n  - "plugins/*"\n');
  write("scripts/package-census.mjs", "");
  copyFileSync(
    join(import.meta.dirname, "package-census.mjs"),
    join(root, "scripts/package-census.mjs"),
  );
  write(
    "plugins/built/package.json",
    JSON.stringify({ name: "built", scripts: { build: "builder" } }),
  );
  write("plugins/built/dist/main.js", "export {};\n");
  write(
    "plugins/plain/package.json",
    JSON.stringify({ name: "plain", scripts: { build: "plugin-build" } }),
  );
  write("plugins/plain/vibefield.plugin.json", JSON.stringify({ entries: { service: entry } }));
  for (const [name, value] of Object.entries(files)) write(`plugins/plain/${name}`, value);
  const result = spawnSync(
    process.execPath,
    ["scripts/package-census.mjs", "--update", "--assert", "--strict"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return { result, root };
}

test("a handwritten service is inventoried with its manifest without needing dist", (t) => {
  const { result, root } = fixture(t, "./service.mjs", { "service.mjs": "export {};\n" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(root, "apps/desktop/packaging/package-manifest.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(manifest.packages["plugins/plain"].files).sort(), [
    "service.mjs",
    "vibefield.plugin.json",
  ]);
});

test("missing generated entries and missing handwritten entries still fail the census", (t) => {
  for (const entry of ["./dist/service.mjs", "./service.mjs", "../outside.mjs"]) {
    const { result } = fixture(t, entry);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /declared a build but produced no output/u);
  }
});

test("handwritten entry points still pass through the never-ship checks", (t) => {
  const { result } = fixture(t, "./service.test.mjs", { "service.test.mjs": "export {};\n" });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /test-material/u);
});
