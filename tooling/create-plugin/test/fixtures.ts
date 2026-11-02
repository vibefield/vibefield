// Scaffolds are made on disk, because a directory is what this command's whole
// contract is about. Every helper here hands back an absolute path under the
// OS temp dir, so a test that writes into the wrong place fails loudly instead
// of quietly editing the repository. Each one is removed when the test that made it finishes, pass or fail (item 153:
// before, every run left ~70 behind).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";

/** A temp directory that exists and is empty, removed when the running test finishes. Only callable inside a test:
 * onTestFinished throws anywhere else, so a directory made at describe scope fails loudly instead of leaking. */
export function freshDir(prefix = "vf-create-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

/** A path inside a fresh temp directory that does NOT exist yet — the shape a
 * scaffold target normally has. */
export function unusedPath(name = "plugin"): string {
  return join(freshDir(), name);
}

/** Write a file, creating its parents. Returns the path. */
export function writeAt(root: string, relative: string, contents: string): string {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  return absolute;
}

export const VALID = {
  id: "vendor.demo",
  title: "Demo",
} as const;
