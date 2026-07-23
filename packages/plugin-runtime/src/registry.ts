import type { PluginManifestV1 } from "@vibefield/contracts";
import { adaptLegacyManifest } from "./adapter";
import type { PluginManifest } from "./manifest";
import { validateManifest } from "./manifest";

// PluginRegistry (design-03 §4.2, P0 subset): the shell's authoritative map of
// installed plugins. P0 = built-ins registered at startup; the SAME registry
// later backs dynamic install/enable (D22). `widgetModule` is deliberately
// opaque here — the engine host (app side) knows the canvas engine's widget
// type; the runtime package stays engine-agnostic so headless/test hosts can
// use the registry without pulling ICE.
//
// Slice P0 (plugin spec §21.1): every registration also adapts to a validated
// PluginManifestV1 (the walking bridge — see adapter.ts), and widget ownership
// is an EXACT type map (§6.2): dotted ids make string-splitting a defect class,
// so `hasWidget`/`ownerOf` never derive an owner from the type string.

export interface RegisteredPlugin<W = unknown> {
  manifest: PluginManifest;
  /** the adapted, validated V1 projection (shape-level truth until P1's canonical manifests) */
  v1: PluginManifestV1;
  /** facts the adapter defaulted/dropped — P1's canonical manifest worklist */
  adaptWarnings: string[];
  /** the plugin's canvas widget definitions, keyed by declared widget type */
  widgets: Map<string, W>;
}

export class PluginRegistry<W = unknown> {
  private plugins = new Map<string, RegisteredPlugin<W>>();
  /** widget type → owning plugin id — the §6.2 exact map; never split a type string */
  private typeOwner = new Map<string, string>();

  register(manifest: PluginManifest, widgets: Record<string, W>): void {
    validateManifest(manifest);
    if (this.plugins.has(manifest.id)) throw new Error(`plugin already registered: ${manifest.id}`);
    const declared = new Set(manifest.widgets.map((w) => w.type));
    const provided = new Set(Object.keys(widgets));
    for (const t of declared) {
      if (!provided.has(t))
        throw new Error(`plugin ${manifest.id} declares ${t} but provides no implementation`);
      const owner = this.typeOwner.get(t);
      if (owner !== undefined)
        throw new Error(`widget type ${t} is already owned by plugin ${owner}`);
    }
    for (const t of provided) {
      if (!declared.has(t))
        throw new Error(`plugin ${manifest.id} provides undeclared widget ${t}`);
    }
    const { v1, warnings } = adaptLegacyManifest(manifest);
    this.plugins.set(manifest.id, {
      manifest,
      v1,
      adaptWarnings: warnings,
      widgets: new Map(Object.entries(widgets)),
    });
    for (const t of declared) this.typeOwner.set(t, manifest.id);
  }

  plugin(id: string): RegisteredPlugin<W> | undefined {
    return this.plugins.get(id);
  }

  all(): RegisteredPlugin<W>[] {
    return [...this.plugins.values()];
  }

  /** Every widget implementation across plugins (collision-checked at register time). */
  allWidgets(): Map<string, W> {
    const out = new Map<string, W>();
    for (const p of this.plugins.values()) {
      for (const [t, w] of p.widgets) out.set(t, w);
    }
    return out;
  }

  /** For missing-plugin placeholders: is this widget type served by anyone? */
  hasWidget(type: string): boolean {
    return this.typeOwner.has(type);
  }

  /** The exact-map owner lookup (§6.2) — undefined for unserved types. */
  ownerOf(type: string): string | undefined {
    return this.typeOwner.get(type);
  }
}
