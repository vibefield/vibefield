import type { Scope } from "@vibefield/contracts";

// Plugin manifest (design-03 §4, P0 subset): what a plugin declares about
// itself. P0 plugins are built-in (statically imported by the shell); the
// manifest shape is the contract that later dynamic loading (D22) reuses
// unchanged. A plugin's widget types are namespaced "<pluginId>.<name>" —
// the registry enforces it (A4: names are governed, not squatted).

export interface WidgetDecl {
  /** namespaced widget type, e.g. "note.card" */
  type: string;
  title: string;
  /** spawn-time footprint in canvas units */
  defaultSize: { w: number; h: number };
  /** shown in spawn UIs; keep it one line */
  description?: string;
}

export interface PluginManifest {
  /** ^[a-z][a-z0-9-]*$ — doubles as the widget-type namespace */
  id: string;
  version: string;
  title: string;
  widgets: WidgetDecl[];
  /** capabilities this plugin's contexts are granted (P0: recorded, enforced at the fabric) */
  scopes: Scope[];
}

const ID_RE = /^[a-z][a-z0-9-]*$/;

export function validateManifest(m: PluginManifest): void {
  if (!ID_RE.test(m.id)) throw new Error(`plugin id must match ${ID_RE}: ${m.id}`);
  for (const w of m.widgets) {
    if (!w.type.startsWith(`${m.id}.`))
      throw new Error(`widget type ${w.type} must live in the plugin's namespace ${m.id}.*`);
    if (w.defaultSize.w <= 0 || w.defaultSize.h <= 0)
      throw new Error(`widget ${w.type} has a non-positive defaultSize`);
  }
}
