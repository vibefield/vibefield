import type {
  PluginManifestV1,
  PluginRecord,
  SafePreview,
  WidgetContribution,
} from "@vibefield/contracts";
import { isWellFormedPluginId, validatePluginManifest } from "@vibefield/contracts";

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
//
// P8b-3 adds the SECOND registration authority, and it is a second one rather
// than a cast because `registerV1` validates: it re-parses its argument through
// `validatePluginManifest` and throws on a miss. A staged plugin has no manifest
// in the renderer — fieldd holds it and publishes the SANITIZED record (§9.4),
// which carries identity and the full widget/command/surface declarations but
// no `engines` and no `entries`. Passing a record through registerV1 would mean
// inventing those two sections to satisfy a parse, so `registerRecord` is the
// parallel door: same exact-map ownership law, different authority, and neither
// path can be reached by lying about which one you are.

export interface RegisteredPlugin<W = unknown> {
  /** The plugin's identity and its DECLARED widget rows, from whichever
   * authority registered it — consumers read these rather than reaching into
   * one authority's shape (the tray and the preview wiring are the same code
   * for a built-in and a staged plugin). */
  id: string;
  title: string;
  version: string;
  widgetContributions: readonly WidgetContribution[];
  /** the validated canonical manifest — present iff registered by `registerV1` */
  v1?: PluginManifestV1;
  /** the sanitized registry record — present iff registered by `registerRecord` */
  record?: PluginRecord;
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
    const contributions = result.manifest.contributes?.widgets ?? [];
    this.bind(
      {
        id: result.manifest.id,
        title: result.manifest.title,
        version: result.manifest.version,
        widgetContributions: contributions,
        v1: result.manifest,
      },
      widgets,
    );
  }

  /** P8b-3 — staged registration (§9.4 + §12.2): the same laws, sourced from
   * the sanitized registry record fieldd published rather than from a manifest
   * this process never sees. The record is the authority the RENDERER is given;
   * fieldd validated the manifest behind it before the record existed, which is
   * why the check here is well-formedness plus the ownership laws rather than a
   * second manifest parse it has no manifest to run. */
  registerRecord(record: PluginRecord, widgets: Record<string, W>): void {
    if (!isWellFormedPluginId(record.id))
      throw new Error(`plugin record invalid: ${record.id} is not a well-formed plugin id`);
    this.bind(
      {
        id: record.id,
        title: record.title,
        version: record.version,
        widgetContributions: record.contributions.widgets,
        record,
      },
      widgets,
    );
  }

  /** The registration laws both authorities obey: one row per id, every
   * declared type implemented, every implementation declared, and no type owned
   * twice. Written once so the two doors cannot drift apart. */
  private bind(identity: Omit<RegisteredPlugin<W>, "widgets">, widgets: Record<string, W>): void {
    if (this.plugins.has(identity.id)) throw new Error(`plugin already registered: ${identity.id}`);
    const declared = new Set(identity.widgetContributions.map((w) => w.type));
    const provided = new Set(Object.keys(widgets));
    for (const t of declared) {
      if (!provided.has(t))
        throw new Error(`plugin ${identity.id} declares ${t} but provides no implementation`);
      const owner = this.typeOwner.get(t);
      if (owner !== undefined)
        throw new Error(`widget type ${t} is already owned by plugin ${owner}`);
    }
    for (const t of provided) {
      if (!declared.has(t))
        throw new Error(`plugin ${identity.id} provides undeclared widget ${t}`);
    }
    this.plugins.set(identity.id, { ...identity, widgets: new Map(Object.entries(widgets)) });
    for (const t of declared) this.typeOwner.set(t, identity.id);
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
