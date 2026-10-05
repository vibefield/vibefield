import type { PluginRegistry } from "@vibefield/plugin-runtime";

// The P-3 seam (thinking-widgetlab-port): the old tray's SHEET (Objects, behind the line)
// reads the PluginRegistry, never ICE's module-global catalog. Its tiles were the plugins'
// WIDGET rows — title, category, SafePreview silhouette — and DK-8 RETIRED
// `contributes.widgets`: no plugin declares one, so the sheet lists none. An OBJECT hangs on
// the desk's pegboard, drawn by its own kind; the pegboard behind the line's ⊕ replaces this
// sheet, its tray state and this module at DK-13 (the plan's R21), and nothing here re-aims
// the sheet at objects ahead of it.

/** The sheet's shelves — the widget era's four (contracts' `WIDGET_CATEGORIES` until DK-8),
 * kept sheet-local until DK-13 deletes the sheet; the tray adds "All". */
export const SHELVES = ["Cards", "3D", "Nodes", "Tools"] as const;
export type Shelf = (typeof SHELVES)[number];
export const CATEGORIES = ["All", ...SHELVES] as const;
export type TrayCategory = (typeof CATEGORIES)[number];

/** What a tray tile needs: the live prefab joined with its manifest row. */
export interface CatalogEntry<W> {
  type: string;
  title: string;
  category: Shelf;
  /** CSS background for the silhouette fallback */
  preview?: string;
  def: W;
}

/** The sheet's tiles: NONE since DK-8 — the widget rows it joined are refused by the
 * manifest, and the registry's rows are objects, which hang on the pegboard (DK-13). */
export function buildCatalog<W>(
  _registry: PluginRegistry<W>,
  /** P3c — plugins the fieldd registry reports disabled (kept for the sheet's call) */
  _disabledPlugins?: ReadonlySet<string>,
): CatalogEntry<W>[] {
  return [];
}
