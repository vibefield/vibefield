import type { WidgetType } from "@vibecook/ice";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { buildWidgetType } from "../../plugin-host/build-widget";
import { TERMINAL_BUILT_IN, TERMINAL_BUILT_IN_WIDGETS } from "./manifest";

// THE BUILT-IN DOOR (TP-S2b-widget; TPv3 §17 mark 21 = (a), RATIFIED
// 2026-08-22). One function, called by `buildRegistry` before any plugin is
// registered, so a plugin that tried to claim `vibefield.terminal.mirror` meets
// the registry's own collision law rather than silently winning.
//
// The prefab is built by the SAME `buildWidgetType` every plugin row goes
// through — the contract vocabulary, the prop constructors, the durable
// `${type}:props` component, ICE's build-once catalog and its duplicate-type
// throw are all shared. What differs is only what actually differs: no manifest
// artifact, no renderer entry, no activation.
//
// DK-2 (desk/landing, ICE 0.14.0): the built-in registers FACELESS, as every
// widget row does — ICE refuses a React `component`/`preview` at definition, and
// the mirror face (`TerminalMirrorWidgetMount`, `TerminalMirrorTile`) has no DOM
// under the camera to mount in. The face files stay until the retire table's
// `terminal/widget/*` row (DK-17); the deck owns terminals (DK-D19), and the
// canvas half returns under PORTALS. `buildRegistry` guards this registration.

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
    widgets[contribution.type] = buildWidgetType(contribution);
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
