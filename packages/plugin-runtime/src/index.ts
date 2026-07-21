// @vibefield/plugin-runtime — the plugin model's renderer-side core
// (design-03 §4, P0 subset: manifests, registry, renderer context).

export { createRendererContext, type PluginRendererContext } from "./context";
export {
  type PluginManifest,
  validateManifest,
  WIDGET_CATEGORIES,
  type WidgetCategory,
  type WidgetDecl,
} from "./manifest";
export { PluginRegistry, type RegisteredPlugin } from "./registry";
