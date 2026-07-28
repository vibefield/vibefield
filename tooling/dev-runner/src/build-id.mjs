import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

export async function computeBuildId(repoRoot, files) {
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const label = relative(repoRoot, file).split("\\").join("/");
    hash.update(`${label}\0`);
    try {
      hash.update(await readFile(file));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return `dev-${hash.digest("hex").slice(0, 24)}`;
}
