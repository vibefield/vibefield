// Scaffolds are made on disk, because a directory is what this command's whole
// contract is about. Every helper here hands back an absolute path under the
// OS temp dir, so a test that writes into the wrong place fails loudly instead
// of quietly editing the repository.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A temp directory that exists and is empty. */
export function freshDir(prefix = "vf-create-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
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
