import { PluginRegistrySnapshot } from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useSyncExternalStore } from "react";

// PLUG-P2 — the fieldd registry snapshot, renderer-side (board-status pattern:
// a module-level store so the session hook and the Settings section read it
// without prop threading). FED by usePluginRegistryFeed (mounted once in
// FieldView, inside FielddProvider); READ at engine creation and in panels.
//
// null = no snapshot yet (booting, or the daemon is away). The honest degraded
// default is "every statically bundled plugin registers" — the shell ships
// that code either way; the registry REFINES the set, it does not gate boot
// (two-plane law: the canvas never waits on fieldd).

let current: PluginRegistrySnapshot | null = null;
const listeners = new Set<() => void>();

export function setPluginRegistrySnapshot(raw: unknown): void {
  const parsed = PluginRegistrySnapshot.safeParse(raw);
  if (!parsed.success) {
    // tolerant reader: refuse junk, keep the last good snapshot
    console.warn(`[plugins] unreadable registry snapshot: ${parsed.error.issues[0]?.message}`);
    return;
  }
  current = parsed.data;
  for (const fn of listeners) fn();
}

export function getPluginRegistrySnapshot(): PluginRegistrySnapshot | null {
  return current;
}

export function subscribePluginRegistry(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Mount once inside FielddProvider: streams plugins.subscribe into the store.
 * Reconnect replays with a fresh snapshot (client P5 law), so the store heals. */
export function usePluginRegistryFeed(): void {
  const sub = useSubscription("plugins.subscribe", {});
  useEffect(() => {
    if (sub.status === "live" && sub.data !== null) setPluginRegistrySnapshot(sub.data);
  }, [sub.status, sub.data]);
}

export function usePluginRegistrySnapshot(): PluginRegistrySnapshot | null {
  return useSyncExternalStore(subscribePluginRegistry, getPluginRegistrySnapshot);
}
