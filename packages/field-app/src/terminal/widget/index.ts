import type { WidgetType } from "@vibecook/ice";
import type { WidgetComponentProps } from "@vibecook/ice/react";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import type { ComponentType } from "react";
import { buildWidgetType } from "../../plugin-host/build-widget";
import { withBuiltInFace } from "../../plugin-host/faces";
import { TERMINAL_BUILT_IN, TERMINAL_BUILT_IN_WIDGETS, TERMINAL_MIRROR_TYPE } from "./manifest";
import { TerminalMirrorTile, TerminalMirrorWidgetMount } from "./mount";

// THE BUILT-IN DOOR (TP-S2b-widget; TPv3 §17 mark 21 = (a), RATIFIED
// 2026-08-22). One function, called by `buildRegistry` before any plugin is
// registered, so a plugin that tried to claim `vibefield.terminal.mirror` meets
// the registry's own collision law rather than silently winning.
//
// The prefab is built by the SAME `buildWidgetType` every plugin row goes
// through — the contract vocabulary, the prop constructors, the durable
// `${type}:props` component, ICE's build-once catalog and its duplicate-type
// throw are all shared. What differs is only what actually differs: no manifest
// artifact, no renderer entry, no activation, and the face policy is the §11.4
// boundary WITHOUT the disable swap a built-in cannot mean (`withBuiltInFace`).
//
// NOTHING TERMINAL IS IMPORTED HERE. The component arrives through `mount.tsx`'s
// lazy boundary and the tile is a static picture, so building the registry costs
// no pool, no runtime and no ghosttea — see the FINDING in `mount.tsx` for what
// the eager version broke.

/** The component bindings, keyed by declared type — the built-in's answer to a
 * plugin's `ctx.widgets.register` map, except that these components are app
 * source and the map is written here rather than published by an activation.
 * Typed as the ENGINE'S widget component contract, so a component with the
 * wrong props is a compile error here rather than an attested cast later. */
const BUILT_IN_COMPONENTS: Record<string, ComponentType<WidgetComponentProps>> = {
  [TERMINAL_MIRROR_TYPE]: TerminalMirrorWidgetMount,
};

/** Tray/silhouette previews, keyed by declared type. Declaring one is what stops
 * ICE's preview sandbox from mounting the REAL component for a tile (see
 * `mount.tsx`) — for this widget that would be a terminal door opened by
 * hovering the tray. */
const BUILT_IN_PREVIEWS: Record<string, ComponentType> = {
  [TERMINAL_MIRROR_TYPE]: TerminalMirrorTile,
};

/**
 * Register the terminal's built-in widget types into the window's registry.
 *
 * Idempotent across engine generations by construction: `buildWidgetType`
 * caches per type (ICE's catalog is process-global and throws on a duplicate
 * define), and `PluginRegistry` is fresh per generation, so this may be — and
 * is — called once per `buildRegistry`.
 */
export function registerBuiltInTerminalWidgets(registry: PluginRegistry<WidgetType>): void {
  const widgets: Record<string, WidgetType> = {};
  for (const contribution of TERMINAL_BUILT_IN_WIDGETS) {
    const component = BUILT_IN_COMPONENTS[contribution.type];
    if (component === undefined) {
      // A declared type with no implementation is a build-time mistake, and the
      // registry would throw on it anyway one line later. Throwing HERE names
      // the actual cause instead of "declares X but provides no implementation".
      throw new Error(`built-in widget ${contribution.type} has no component binding`);
    }
    const preview = BUILT_IN_PREVIEWS[contribution.type];
    widgets[contribution.type] = buildWidgetType(contribution, {
      component: withBuiltInFace({
        type: contribution.type,
        surface: contribution.surface,
        component,
      }),
      ...(preview === undefined ? {} : { preview }),
    });
  }
  registry.registerBuiltIn(TERMINAL_BUILT_IN, TERMINAL_BUILT_IN_WIDGETS, widgets);
}

export {
  TERMINAL_BUILT_IN,
  TERMINAL_BUILT_IN_WIDGETS,
  TERMINAL_MIRROR_CONTRIBUTION,
  TERMINAL_MIRROR_TYPE,
} from "./manifest";
export { TerminalMirrorTile, TerminalMirrorWidgetMount } from "./mount";
export { SessionPickerView, type SessionPickerViewProps } from "./SessionPickerView";
