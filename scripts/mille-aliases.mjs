// FS-1b: rosetta's own link cannot choose a third engine for our renderer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readLock, siblingDir } from "./siblings.mjs";
export function milleAliases(root) {
  const entry = readLock(root)?.siblings?.mille;
  if (!entry) return [];
  return Object.entries(entry.packages)
    .flatMap(([name, folder]) => {
      const dir = join(siblingDir(root, entry), folder);
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return Object.entries(manifest.exports).map(([key, value]) => ({
        find: name + (key === "." ? "" : key.slice(1)),
        replacement: join(dir, typeof value === "string" ? value : (value.import ?? value.default)),
      }));
    })
    .sort((a, b) => b.find.length - a.find.length);
}
