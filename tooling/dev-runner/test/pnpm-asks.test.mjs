// Item 554 (2026-11-20): pnpm asks a person before it installs, or takes a version younger than its release-age
// window, and stops wherever no one can answer. On 2026-11-18 a check started through pnpm found the tree out of step
// with its lock, installed online by itself, and wrote four release-age exclusions nobody had reviewed. pnpm's own
// writer rewrites pnpm-workspace.yaml when it adds an exclusion, so these rows hold that the file keeps both settings.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WORKSPACE = join(import.meta.dirname, "..", "..", "..", "pnpm-workspace.yaml");
const lines = readFileSync(WORKSPACE, "utf8").split("\n");

function topLevel(key) {
  return lines.filter((line) => line.startsWith(`${key}:`));
}

test("a script on a tree out of step with its lock asks first, and stops where no one can answer", () => {
  assert.deepEqual(topLevel("verifyDepsBeforeRun"), ["verifyDepsBeforeRun: prompt"]);
});

test("a version younger than the release-age window is taken only from the list or at a person's yes", () => {
  assert.deepEqual(topLevel("minimumReleaseAgeStrict"), ["minimumReleaseAgeStrict: true"]);
});
