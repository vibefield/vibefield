import { watch } from "node:fs";
import { join } from "node:path";
import { shouldIgnoreWatchPath } from "./critical-changes.mjs";
import { toRepoRelative } from "./paths.mjs";

export function watchCriticalRoots(roots, onChange) {
  const watchers = [];
  const pending = new Map();

  for (const input of roots) {
    const root = typeof input === "string" ? input : input.path;
    const recursive = typeof input === "string" ? true : input.recursive;
    const watcher = watch(root, { recursive }, (_event, filename) => {
      if (filename === null) return;
      const absolute = join(root, filename.toString());
      const relative = toRepoRelative(absolute);
      if (shouldIgnoreWatchPath(relative)) return;
      clearTimeout(pending.get(relative));
      pending.set(
        relative,
        setTimeout(() => {
          pending.delete(relative);
          onChange(relative);
        }, 80),
      );
    });
    watchers.push(watcher);
  }

  return () => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const watcher of watchers) watcher.close();
  };
}
