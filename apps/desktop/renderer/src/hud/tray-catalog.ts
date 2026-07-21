import {
  type PluginRegistry,
  WIDGET_CATEGORIES,
  type WidgetCategory,
} from "@vibefield/plugin-runtime";

// The P-3 seam (thinking-widgetlab-port): the tray reads the PluginRegistry,
// never ICE's module-global catalog — labels, categories, and preview
// silhouettes are manifest DATA, so the sheet needs zero per-widget code
// knowledge. Pure derivation; unit-tested without ICE. The category union has
// ONE source (plugin-runtime's WIDGET_CATEGORIES); the tray only adds "All".

export const CATEGORIES = ["All", ...WIDGET_CATEGORIES] as const;
export type TrayCategory = (typeof CATEGORIES)[number];

/** What a tray tile needs: the live widget def joined with its manifest row. */
export interface CatalogEntry<W> {
  type: string;
  title: string;
  category: WidgetCategory;
  /** CSS background for the silhouette fallback (manifest `preview`) */
  preview?: string;
  def: W;
}

interface DefLike {
  surface?: "dom" | "gl";
}

export function buildCatalog<W extends DefLike>(registry: PluginRegistry<W>): CatalogEntry<W>[] {
  const out: CatalogEntry<W>[] = [];
  for (const plugin of registry.all()) {
    for (const decl of plugin.manifest.widgets) {
      const def = plugin.widgets.get(decl.type);
      if (def === undefined) continue; // register() guarantees the pair; belt and braces
      out.push({
        type: decl.type,
        title: decl.title,
        category: decl.category ?? (def.surface === "gl" ? "3D" : "Cards"),
        ...(decl.preview !== undefined ? { preview: decl.preview } : {}),
        def,
      });
    }
  }
  return out;
}
