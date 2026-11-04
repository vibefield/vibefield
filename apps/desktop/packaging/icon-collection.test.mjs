import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadIconCollection } from "./icon-collection.mjs";

const source = fileURLToPath(new URL("./icon-source", import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vibefield-reviewed-icons-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(source, root, { recursive: true });
  return root;
}

test("native renditions are bound to the installed v2 artwork source", async () => {
  const collection = await loadIconCollection(source);
  const native = JSON.parse(
    await readFile(new URL("./icons/apple-renditions.json", import.meta.url), "utf8"),
  );
  assert.equal(native.sourceSha256, collection.appleSourceSha256);
  assert.equal(collection.recipe.params.livLineGlow, 0.43);
  assert.equal(collection.recipe.params.livHairline, 1.5);
});

test("changing a reviewed pixel file fails before packaging", async (t) => {
  const root = await fixture(t);
  const path = join(root, "windows/vibefield.ico");
  const bytes = await readFile(path);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(path, bytes);
  await assert.rejects(
    loadIconCollection(root),
    /Reviewed icon source changed: windows\/vibefield.ico/,
  );
});

test("a manifest cannot add or redirect source paths", async (t) => {
  const root = await fixture(t);
  const path = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.files[0].path = "../outside.png";
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(loadIconCollection(root), /does not match.*asset contract/);
});

test("unlisted source files cannot silently enter the reviewed collection", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "old-icon.png"), "stale");
  await assert.rejects(loadIconCollection(root), /Unexpected files/);
});
