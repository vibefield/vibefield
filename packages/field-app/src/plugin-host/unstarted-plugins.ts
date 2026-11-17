import { useSyncExternalStore } from "react";

// THE PLUGINS THAT CANNOT START IN THIS WINDOW (item 476) — window-local, renderer-side
// (plugin-registry-store's pattern: a module-level store, so the loader writes it and the rows read
// it without prop threading).
//
// fieldd's registry record says what is wrong with a plugin on this DESKTOP (`state`, `lastError`).
// It cannot say that one WINDOW could not start it: its update lane would not open, its module
// would not import, or its activation failed (staged-loader.ts). Until item 476 such a plugin read
// as an ordinary installed one while its objects drew as missing. An entry is a plugin id and why;
// a row says only "‹plugin› isn't working right now", and the reason stays in the renderer's log
// (the loader logs each failure where it names it).
//
// WRITTEN by the staged loader (a failure names the plugin, a live staging clears it) and by the
// window's kinds (a plugin turned off, or gone, leaves it: window-kinds.ts). READ by Installed's
// rows and Settings → Plugins, by the kinds planner (a plugin whose lane failed is the retry's,
// never the planner's) and by that retry. "This window" is this realm: the store goes with the
// page, so a replaced renderer starts with none.

/** Why a plugin cannot start in this window. `room`: fieldd refused its lane for want of room, the
 * one failure asking again can cure (window-kinds.ts asks; nothing else is asked again). */
export type UnstartedPlugin =
  | { readonly reason: "lane"; readonly room: boolean }
  | { readonly reason: "import" }
  | { readonly reason: "activation" };

/** The plugins that cannot start in this window, by id. */
export type UnstartedPlugins = ReadonlyMap<string, UnstartedPlugin>;

// Replaced whole at each change, never mutated: `useSyncExternalStore` reads it by identity.
let current: UnstartedPlugins = new Map();
const listeners = new Set<() => void>();

function put(next: UnstartedPlugins): void {
  current = next;
  for (const fn of [...listeners]) fn();
}

function same(a: UnstartedPlugin, b: UnstartedPlugin): boolean {
  if (a.reason !== b.reason) return false;
  return a.reason !== "lane" || b.reason !== "lane" || a.room === b.room;
}

/** Name a plugin that cannot start here. Naming it again for the same reason tells no one. */
export function nameUnstartedPlugin(pluginId: string, why: UnstartedPlugin): void {
  const was = current.get(pluginId);
  if (was !== undefined && same(was, why)) return;
  const next = new Map(current);
  next.set(pluginId, why);
  put(next);
}

/** The plugin started here, was turned off, or is gone: it leaves the set. */
export function clearUnstartedPlugin(pluginId: string): void {
  if (!current.has(pluginId)) return;
  const next = new Map(current);
  next.delete(pluginId);
  put(next);
}

export function getUnstartedPlugins(): UnstartedPlugins {
  return current;
}

export function subscribeUnstartedPlugins(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useUnstartedPlugins(): UnstartedPlugins {
  return useSyncExternalStore(subscribeUnstartedPlugins, getUnstartedPlugins);
}

/** Tests only: a realm's set cannot be emptied any other way (it goes with the page). */
export function resetUnstartedPlugins(): void {
  if (current.size > 0) put(new Map());
}
