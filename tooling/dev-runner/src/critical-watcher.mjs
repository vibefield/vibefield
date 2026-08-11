import { watch } from "node:fs";
import { join } from "node:path";
import { shouldIgnoreWatchPath } from "./critical-changes.mjs";
import { log as defaultLog } from "./log.mjs";
import { toRepoRelative } from "./paths.mjs";

const REARM_DELAY_MS = 1_000;
/** Total re-arms per root per session, not a per-flap budget: a root that keeps
 * failing is degraded, and saying so once beats retrying it forever. */
const MAX_WATCH_FAILURES = 5;

export function watchCriticalRoots(
  roots,
  onChange,
  { log = defaultLog, watchPath = watch, rearmMs = REARM_DELAY_MS } = {},
) {
  const watchers = new Set();
  const pending = new Map();
  const rearms = new Set();
  const failures = new Map();
  let closed = false;

  function handleEvent(root, filename) {
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
  }

  function attach(root, recursive) {
    const watcher = watchPath(root, { recursive }, (_event, filename) =>
      handleEvent(root, filename),
    );
    watchers.add(watcher);
    // Windows raises EPERM when a watched directory is renamed or deleted, and
    // an FSWatcher error nobody handles is an uncaughtException — which the CLI
    // turns into a full dev-loop shutdown. Re-arm the same root instead.
    watcher.on("error", (error) => {
      watchers.delete(watcher);
      watcher.close();
      degrade(root, recursive, error);
    });
  }

  function degrade(root, recursive, error) {
    if (closed) return;
    const count = (failures.get(root) ?? 0) + 1;
    failures.set(root, count);
    if (count >= MAX_WATCH_FAILURES) {
      log.warn(`watch degraded for ${root}; changes there need a manual restart to be picked up`);
      return;
    }
    log.warn(`watching ${root} failed (${messageOf(error)}); re-arming`);
    const timer = setTimeout(() => {
      rearms.delete(timer);
      if (closed) return;
      try {
        attach(root, recursive);
      } catch (retryError) {
        degrade(root, recursive, retryError);
      }
    }, rearmMs);
    rearms.add(timer);
  }

  for (const input of roots) {
    const root = typeof input === "string" ? input : input.path;
    const recursive = typeof input === "string" ? true : input.recursive;
    // A critical root missing at startup stays fatal: the caller cannot
    // regenerate what it was never able to observe, and refusing beats
    // starting a dev loop that silently ignores contract edits.
    attach(root, recursive);
  }

  return () => {
    closed = true;
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const timer of rearms) clearTimeout(timer);
    rearms.clear();
    for (const watcher of watchers) watcher.close();
    watchers.clear();
  };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
