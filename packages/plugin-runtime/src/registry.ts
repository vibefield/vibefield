import type { PluginManifestV1, SafePreview } from "@vibefield/contracts";
import { validatePluginManifest } from "@vibefield/contracts";

// PluginRegistry (design-03 §4.2, P0 subset): the shell's authoritative map of
// installed plugins. P0 = built-ins registered at startup; the SAME registry
// later backs dynamic install/enable (D22). `widgetModule` is deliberately
// opaque here — the engine host (app side) knows the canvas engine's widget
// type; the runtime package stays engine-agnostic so headless/test hosts can
// use the registry without pulling ICE.
//
// C1c: the legacy authored shape and its adapter are RETIRED — contracts'
// PluginManifestV1 is the ONLY manifest. Widget ownership is an EXACT type map
// (§6.2): dotted ids make string-splitting a defect class, so
// `hasWidget`/`ownerOf` never derive an owner from the type string.

export interface RegisteredPlugin<W = unknown> {
  /** the validated canonical manifest (contracts PluginManifestV1) */
  v1: PluginManifestV1;
  /** the plugin's canvas widget definitions, keyed by declared widget type */
  widgets: Map<string, W>;
}

/** SafePreview → the CSS background string legacy consumers (tray silhouettes,
 * folder minis) paint with. Asset previews have no CSS form yet — undefined. */
export function safePreviewToCss(preview: SafePreview | undefined): string | undefined {
  if (preview === undefined || preview.kind === "asset") return undefined;
  return preview.value;
}

export class PluginRegistry<W = unknown> {
  private plugins = new Map<string, RegisteredPlugin<W>>();
  /** widget type → owning plugin id — the §6.2 exact map; never split a type string */
  private typeOwner = new Map<string, string>();

  /** C1a — canonical-manifest registration (§12.2): the caller already built
   * the widget implementations FROM this manifest's data; here the manifest is
   * validated and the same declared⇄provided/collision laws hold. */
  registerV1(v1: PluginManifestV1, widgets: Record<string, W>): void {
    const result = validatePluginManifest(v1);
    if (!result.ok) throw new Error(`plugin manifest invalid: ${result.issues.join(" · ")}`);
    if (this.plugins.has(v1.id)) throw new Error(`plugin already registered: ${v1.id}`);
    const declared = new Set((v1.contributes?.widgets ?? []).map((w) => w.type));
    const provided = new Set(Object.keys(widgets));
    for (const t of declared) {
      if (!provided.has(t))
        throw new Error(`plugin ${v1.id} declares ${t} but provides no implementation`);
      const owner = this.typeOwner.get(t);
      if (owner !== undefined)
        throw new Error(`widget type ${t} is already owned by plugin ${owner}`);
    }
    for (const t of provided) {
      if (!declared.has(t)) throw new Error(`plugin ${v1.id} provides undeclared widget ${t}`);
    }
    this.plugins.set(v1.id, { v1: result.manifest, widgets: new Map(Object.entries(widgets)) });
    for (const t of declared) this.typeOwner.set(t, v1.id);
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
