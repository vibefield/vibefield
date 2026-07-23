import type { Scope, WidgetCategory } from "@vibefield/contracts";
import { LegacyPluginManifest, WIDGET_CATEGORIES } from "@vibefield/contracts";

// Plugin manifest (design-03 §4, P0 subset): what a plugin declares about
// itself. P0 plugins are built-in (statically imported by the shell). Slice P0
// of the plugin-architecture spec moved schema AUTHORITY to @vibefield/contracts
// (PA-3): the category vocabulary and the legacy zod shape live there; this
// module keeps the authoring-side TS types and the established validate voice.
// The registry additionally adapts every legacy manifest to PluginManifestV1
// (see adapter.ts) — the §21.1 bridge until P1's canonical manifests.

export type { WidgetCategory };
export { WIDGET_CATEGORIES };

export interface WidgetDecl {
  /** namespaced widget type, e.g. "note.card" */
  type: string;
  title: string;
  /** spawn-time footprint in canvas units */
  defaultSize: { w: number; h: number };
  /** shown in spawn UIs; keep it one line */
  description?: string;
  /** tray shelf (P-3, widgetlab port): defaults by surface — gl → "3D", else "Cards" */
  category?: WidgetCategory;
  /**
   * CSS background for tray/folder mini silhouettes when no live preview
   * renders. Legacy-only: V1 manifests carry a schema-sanitized SafePreview
   * (the D22 threat note answered); the adapter maps this best-effort.
   */
  preview?: string;
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
  // The contracts schema is the authority (PA-3); the hand checks above only
  // preserve this module's established error voice for its callers' tests.
  const parsed = LegacyPluginManifest.safeParse(m);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `plugin manifest ${m.id} invalid: ${first?.path.join(".") ?? "<root>"}: ${first?.message}`,
    );
  }
}
