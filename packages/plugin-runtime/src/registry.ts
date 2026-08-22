import type {
  BehaviorContribution,
  PluginManifestV1,
  PluginRecord,
  SafePreview,
  WidgetContribution,
} from "@vibefield/contracts";
import {
  isDistributablePluginId,
  isOwnedName,
  isWellFormedPluginId,
  validatePluginManifest,
} from "@vibefield/contracts";

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
//
// TP-S2b-widget adds the THIRD authority for the same reason there are two:
// `registerBuiltIn` is the HOST registering its OWN contributions — widget
// types whose code ships inside the app bundle, not behind the plugin door
// (TPv3 §17 mark 21 (a), RATIFIED 2026-08-22). Neither existing door tells that
// truth. `registerV1` validates a manifest whose §7.1 invariant is "widgets
// require entries.renderer", so a built-in would have to NAME a renderer
// artifact that does not exist; `registerRecord` would claim fieldd staged and
// approved a module it has never seen. The third door states what is actually
// the case — no manifest artifact, no entries, no activation, because the code
// IS here — and then obeys the identical `bind()` laws, so a built-in can no
// more collide with a plugin's widget type than two plugins can with each
// other. What it must never become is a back door for plugin code: the
// contributions passed here are authored in the app's own source tree.

export interface RegisteredPlugin<W = unknown> {
  /** The plugin's identity and its DECLARED widget rows, from whichever
   * authority registered it — consumers read these rather than reaching into
   * one authority's shape (the tray and the preview wiring are the same code
   * for a built-in and a staged plugin). */
  id: string;
  title: string;
  version: string;
  widgetContributions: readonly WidgetContribution[];
  /** Data-only declarations, paired with renderer bindings by the document
   * behavior host in canonical plugin/declaration order. */
  behaviorContributions: readonly BehaviorContribution[];
  /** the validated canonical manifest — present iff registered by `registerV1` */
  v1?: PluginManifestV1;
  /** the sanitized registry record — present iff registered by `registerRecord` */
  record?: PluginRecord;
  /** the HOST's own contributions — true iff registered by `registerBuiltIn`.
   * There is no manifest and no record behind these rows on purpose: nothing
   * staged them, nothing can disable them, and nothing can update them apart
   * from shipping a new app. Consumers that ask "did a plugin bring this?"
   * read this flag rather than inferring from two absent fields. */
  builtIn?: true;
  /** the plugin's canvas widget definitions, keyed by declared widget type */
  widgets: Map<string, W>;
}

/** Who a built-in row belongs to. An id and a title, because the tray and the
 * previews need a name — and nothing else, because there is nothing else: a
 * built-in has no version to update to that is not the app's own. */
export interface BuiltInContributor {
  id: string;
  title: string;
  /** the APP's version — stated so the row is not versionless, never a
   * separately-released number */
  version: string;
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
        behaviorContributions: result.manifest.contributes?.behaviors ?? [],
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
        behaviorContributions: record.contributions.behaviors,
        record,
      },
      widgets,
    );
  }

  /** TP-S2b-widget — BUILT-IN registration (TPv3 §17 mark 21 (a)): widget types
   * the host contributes from its own source tree, outside the plugin door.
   *
   * The widget-type ids are still held to the DISTRIBUTABLE shape and to the
   * owned-name rule the manifest validator applies to plugins (`<id>` itself or
   * `<id>.<segment>`), because those two rules are what make the type map a map
   * — a built-in that claimed `vibefield.note` would silently outrank the note
   * plugin, and the collision check below would only catch it if the plugin had
   * registered first. Everything past that is `bind()`, unchanged. */
  registerBuiltIn(
    contributor: BuiltInContributor,
    contributions: readonly WidgetContribution[],
    widgets: Record<string, W>,
  ): void {
    if (!isDistributablePluginId(contributor.id))
      throw new Error(`built-in invalid: ${contributor.id} is not a distributable plugin id`);
    for (const w of contributions) {
      if (!isOwnedName(contributor.id, w.type, true))
        throw new Error(`built-in ${contributor.id} may not contribute widget type ${w.type}`);
    }
    this.bind(
      {
        id: contributor.id,
        title: contributor.title,
        version: contributor.version,
        widgetContributions: contributions,
        behaviorContributions: [],
        builtIn: true,
      },
      widgets,
    );
  }

  /** The registration laws all three authorities obey: one row per id, every
   * declared type implemented, every implementation declared, and no type owned
   * twice. Written once so the doors cannot drift apart. */
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
