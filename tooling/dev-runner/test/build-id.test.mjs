import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeBuildId } from "../src/build-id.mjs";

test("build identity is stable across input order and changes with bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vf-dev-hash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = join(root, "a");
  const b = join(root, "b");
  await writeFile(a, "one");
  await writeFile(b, "two");

  const first = await computeBuildId(root, [a, b]);
  assert.equal(await computeBuildId(root, [b, a, a]), first);
  assert.match(first, /^dev-[a-f0-9]{24}$/);

  await writeFile(b, "changed");
  assert.notEqual(await computeBuildId(root, [a, b]), first);
});
