// @vibefield/plugin-runtime — the plugin model's renderer-side core
// (design-03 §4: canonical manifests, registry, renderer context). C1c: the
// legacy authored shape and its adapter are RETIRED — contracts'
// PluginManifestV1 is the only manifest; the category vocabulary re-exports
// from its contracts home (PA-3).
export { WIDGET_CATEGORIES, type WidgetCategory } from "@vibefield/contracts";
export { createRendererContext, type PluginRendererContext } from "./context";
export { PluginRegistry, type RegisteredPlugin, safePreviewToCss } from "./registry";
