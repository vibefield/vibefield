import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearDeadDevProductFiles, readDevProduct } from "../src/product.mjs";

async function fixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), "vf-dev-product-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const runDir = join(dataRoot, "fieldd", "run");
  await mkdir(runDir, { recursive: true });
  return { dataRoot, runDir };
}

test("clears only the exact verified dead product and token", async (t) => {
  const { dataRoot, runDir } = await fixture(t);
  const record = { pid: 101, nativePid: 102, buildId: "dev-current" };
  await writeFile(join(runDir, "product.json"), JSON.stringify(record));
  await writeFile(join(runDir, "shell.token"), "secret");
  await writeFile(join(runDir, "keep.txt"), "unrelated");

  const product = await readDevProduct(dataRoot);
  assert.deepEqual(product, record);
  assert.equal(await clearDeadDevProductFiles(dataRoot, product, () => false), true);

  await assert.rejects(readFile(join(runDir, "product.json")), { code: "ENOENT" });
  await assert.rejects(readFile(join(runDir, "shell.token")), { code: "ENOENT" });
  assert.equal(await readFile(join(runDir, "keep.txt"), "utf8"), "unrelated");
});

test("does not clear run files after ownership changes", async (t) => {
  const { dataRoot, runDir } = await fixture(t);
  const old = { pid: 101, nativePid: 102, buildId: "dev-old" };
  const current = { pid: 201, nativePid: 202, buildId: "dev-current" };
  await writeFile(join(runDir, "product.json"), JSON.stringify(current));
  await writeFile(join(runDir, "shell.token"), "current-secret");

  assert.equal(await clearDeadDevProductFiles(dataRoot, old, () => false), false);
  assert.deepEqual(await readDevProduct(dataRoot), current);
  assert.equal(await readFile(join(runDir, "shell.token"), "utf8"), "current-secret");
});
