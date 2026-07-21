import type { PluginManifest } from "./manifest";
import { validateManifest } from "./manifest";

// PluginRegistry (design-03 §4.2, P0 subset): the shell's authoritative map of
// installed plugins. P0 = built-ins registered at startup; the SAME registry
// later backs dynamic install/enable (D22). `widgetModule` is deliberately
// opaque here — the engine host (app side) knows the canvas engine's widget
// type; the runtime package stays engine-agnostic so headless/test hosts can
// use the registry without pulling ICE.

export interface RegisteredPlugin<W = unknown> {
  manifest: PluginManifest;
  /** the plugin's canvas widget definitions, keyed by declared widget type */
  widgets: Map<string, W>;
}

export class PluginRegistry<W = unknown> {
  private plugins = new Map<string, RegisteredPlugin<W>>();

  register(manifest: PluginManifest, widgets: Record<string, W>): void {
    validateManifest(manifest);
    if (this.plugins.has(manifest.id)) throw new Error(`plugin already registered: ${manifest.id}`);
    const declared = new Set(manifest.widgets.map((w) => w.type));
    const provided = new Set(Object.keys(widgets));
    for (const t of declared) {
      if (!provided.has(t))
        throw new Error(`plugin ${manifest.id} declares ${t} but provides no implementation`);
    }
    for (const t of provided) {
      if (!declared.has(t))
        throw new Error(`plugin ${manifest.id} provides undeclared widget ${t}`);
    }
    this.plugins.set(manifest.id, { manifest, widgets: new Map(Object.entries(widgets)) });
  }

  plugin(id: string): RegisteredPlugin<W> | undefined {
    return this.plugins.get(id);
  }

  all(): RegisteredPlugin<W>[] {
    return [...this.plugins.values()];
  }

  /** Every widget implementation across plugins (collision-checked at register time by namespacing). */
  allWidgets(): Map<string, W> {
    const out = new Map<string, W>();
    for (const p of this.plugins.values()) {
      for (const [t, w] of p.widgets) out.set(t, w);
    }
    return out;
  }

  /** For missing-plugin placeholders: is this widget type served by anyone? */
  hasWidget(type: string): boolean {
    const pluginId = type.split(".")[0] ?? "";
    return this.plugins.get(pluginId)?.widgets.has(type) ?? false;
  }
}
