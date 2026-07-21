// @vibefield/plugin-runtime — the plugin model's renderer-side core
// (design-03 §4, P0 subset: manifests, registry, renderer context).
export { validateManifest, type PluginManifest, type WidgetDecl } from "./manifest";
export { PluginRegistry, type RegisteredPlugin } from "./registry";
export { createRendererContext, type PluginRendererContext } from "./context";
