import {
  type PluginRegistry,
  safePreviewToCss,
  WIDGET_CATEGORIES,
  type WidgetCategory,
} from "@vibefield/plugin-runtime";

// The P-3 seam (thinking-widgetlab-port): the tray reads the PluginRegistry,
// never ICE's module-global catalog — labels, categories, and preview
// silhouettes are manifest DATA, so the sheet needs zero per-widget code
// knowledge. Pure derivation; unit-tested without ICE. The category union has
// ONE source (contracts' WIDGET_CATEGORIES); the tray only adds "All".
// C1c: reads the canonical V1 contributes directly (SafePreview → CSS).

export const CATEGORIES = ["All", ...WIDGET_CATEGORIES] as const;
export type TrayCategory = (typeof CATEGORIES)[number];

/** What a tray tile needs: the live widget def joined with its manifest row. */
export interface CatalogEntry<W> {
  type: string;
  title: string;
  category: WidgetCategory;
  /** CSS background for the silhouette fallback (manifest SafePreview) */
  preview?: string;
  def: W;
}

interface DefLike {
  surface?: "dom" | "gl";
}

export function buildCatalog<W extends DefLike>(
  registry: PluginRegistry<W>,
  /** P3c — plugins the fieldd registry reports disabled: registered (schemas
   * stay live for existing boards) but never offered for NEW spawns. */
  disabledPlugins?: ReadonlySet<string>,
): CatalogEntry<W>[] {
  const out: CatalogEntry<W>[] = [];
  for (const plugin of registry.all()) {
    if (disabledPlugins?.has(plugin.v1.id)) continue;
    for (const w of plugin.v1.contributes?.widgets ?? []) {
      const def = plugin.widgets.get(w.type);
      if (def === undefined) continue; // registerV1 guarantees the pair; belt and braces
      const preview = safePreviewToCss(w.preview);
      out.push({
        type: w.type,
        title: w.title,
        category: w.category ?? (def.surface === "gl" ? "3D" : "Cards"),
        ...(preview !== undefined ? { preview } : {}),
        def,
      });
    }
  }
  return out;
}
