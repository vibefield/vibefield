// THE LIVE FACE'S GATE (PT-2 ruling 3): the HOST decides whether a face may open a browser page, by the OBJECT — never by what a
// kind writes in its spec. The face's key is the object's durable key (`KindHost.keyOf`), so: the key → its entity in the open
// document (strata's `store.resolve`) → its type → the plugin that contributes the type (the registry's exact owner map) → that
// plugin's EFFECTIVE capabilities (a staged plugin's: fieldd's record; a bundled one's: computed from its manifest exactly as its
// activation is — `computeEffectiveGrants`). A browser page needs `surface.attach` and `surface.browser` — the plugin door's own
// pair (surface-door.tsx), with the same words for a refusal. A type no plugin contributes (the desk's built-ins) opens nothing.

import type { CanvasEngine, WidgetType } from "@vibecook/ice";
import { PrefabId } from "@vibecook/ice";
import { computeEffectiveGrants } from "@vibefield/contracts";
import type { PluginRegistry, RegisteredPlugin } from "@vibefield/plugin-runtime";
import type { LiveGateAnswer } from "./desk-live";

/** What a browser page asks of the plugin whose object opens it. */
export const BROWSER_PAGE_SCOPES = ["surface.attach", "surface.browser"] as const;

/** A registered plugin's effective capabilities — its record's grants (staged), or its manifest's as its activation computes them. */
export function grantsOf(plugin: RegisteredPlugin<WidgetType>): readonly string[] {
  if (plugin.record !== undefined) return plugin.record.grantedCapabilities;
  const v1 = plugin.v1;
  if (v1 === undefined) return [];
  return computeEffectiveGrants({
    requested: v1.capabilities,
    hasRenderer: v1.entries?.renderer !== undefined,
    hasService: v1.entries?.service !== undefined,
    source: "bundled",
  }).granted;
}

export function createLiveGate(deps: {
  readonly engine: CanvasEngine;
  readonly registry: PluginRegistry<WidgetType>;
}): (key: string) => LiveGateAnswer {
  return (key) => {
    const store = deps.engine.docs.current()?.store;
    const entity = store?.resolve(key as never);
    if (entity === undefined || !deps.engine.world.isAlive(entity))
      return { refused: "no object on this board holds this face" };
    const type = deps.engine.world.get(entity, PrefabId)?.id;
    if (typeof type !== "string") return { refused: "the object has no type" };
    const pluginId = deps.registry.ownerOf(type);
    const plugin = pluginId === undefined ? undefined : deps.registry.plugin(pluginId);
    if (plugin === undefined) return { refused: `${type} is no plugin's: it opens no page` };
    const granted = grantsOf(plugin);
    for (const scope of BROWSER_PAGE_SCOPES)
      if (!granted.includes(scope))
        return { refused: `FORBIDDEN_SCOPE: plugin ${plugin.id} is not granted ${scope}` };
    return { type };
  };
}
