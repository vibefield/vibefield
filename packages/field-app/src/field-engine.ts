import {
  type CanvasEngine,
  type CanvasEngineOpts,
  compileEngineCatalog,
  createCanvasEngine,
  type DocSession,
  type WidgetType,
} from "@vibecook/ice";
import type { BlobStore } from "@vibecook/ice/desk/kit";
import { DESK_ENGINE, DESK_OBJECTS } from "@vibecook/ice/desk/objects";
import type { ObjectContribution, PluginManifestV1, PluginRecord } from "@vibefield/contracts";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import type { ObjectBinding } from "@vibefield/plugin-sdk";
import { deskBlobs } from "./field/desk/desk-blobs";
import { type SeedOptions, seedDesk } from "./field/desk/desk-seed";
import { getRendererLogger } from "./logging";
import {
  buildFacelessObjectType,
  buildObjectType,
  objectBindingsFrom,
} from "./plugin-host/build-widget";
import { RendererWindowController } from "./plugin-host/renderer-controller";
import { type ActivatedRenderer, activateRenderer } from "./plugin-host/renderer-harness";
import {
  type BundledRendererPlugin,
  EMPTY_PREPARED,
  type PreparedRendererPlugins,
  prepareRendererPlugins,
  type StagedLoaderDeps,
} from "./plugin-host/staged-loader";

// The field's engine + seed, React-free (Track D3/D4): FieldView renders it,
// the headless contract tests (drop-consume) drive it. B3 split the two —
// `createFieldEngine` is DOC-LESS (no create, no seed); the caller decides
// open-vs-seed AFTER asking fieldd for the board (registry-open law: never
// blind-seed). `seedField` is the first-run payload — and the persistence
// tests' named census.

/** Build every declared prefab from DECLARATION data (§12.2): an `objects` row compiles through
 * `defineObject` with the kind its module exports (DK-2, desk/landing, ICE 0.14.0). An object
 * whose kind cannot be bound (no export, not a desk kind, a refused binding) still registers
 * FACELESS so its document's data survives (ICE's missing face draws it from 0.15.0), and the host
 * says why. DK-8: the `widgets` rows this built faceless RETIRED with `contributes.widgets` — the
 * manifest refuses the contribution by name, pointing at `objects`. */
function buildPrefabs(
  title: string,
  pluginId: string,
  objects: readonly ObjectContribution[],
  activation: ActivatedRenderer,
  objectBindings: ReadonlyMap<string, ObjectBinding> = new Map(),
): Record<string, WidgetType> {
  const owner = { pluginId, pluginTitle: title };
  const built: Record<string, WidgetType> = {};
  for (const o of objects) {
    const binding = objectBindings.get(o.type);
    try {
      if (binding === undefined)
        throw new Error(`object ${o.type}: the module exports no \`${o.binding.kind}\``);
      built[o.type] = buildObjectType(o, binding, owner, activation.behaviors);
    } catch (error) {
      getRendererLogger()
        .child({ component: "plugin.host" })
        .error(
          "renderer.plugins.object_kind_unbound",
          "An object type registered faceless: its kind could not be bound",
          error,
          { pluginId, type: o.type },
        );
      built[o.type] = buildFacelessObjectType(o, owner, activation.behaviors);
    }
  }
  return built;
}

/** The canonical path (§12.2), now DEV-ONLY: manifest + implementations as one
 * unit, validated by the registry's manifest door. */
function registerCanonical(
  registry: PluginRegistry<WidgetType>,
  manifest: PluginManifestV1,
  activation: ActivatedRenderer,
  objectBindings?: ReadonlyMap<string, ObjectBinding>,
): void {
  registry.registerV1(
    manifest,
    buildPrefabs(
      manifest.title,
      manifest.id,
      manifest.contributes?.objects ?? [],
      activation,
      objectBindings,
    ),
  );
}

/** THE STAGED PATH (P8b-3): the same laws sourced from fieldd's sanitized
 * record — the only description of a staged plugin this process has. */
function registerStaged(
  registry: PluginRegistry<WidgetType>,
  record: PluginRecord,
  activation: ActivatedRenderer,
  objectBindings?: ReadonlyMap<string, ObjectBinding>,
): void {
  registry.registerRecord(
    record,
    buildPrefabs(
      record.title,
      record.id,
      record.contributions.objects ?? [],
      activation,
      objectBindings,
    ),
  );
}

/** THE DEV-ONLY BUNDLED SET (P8-D2) — since DK-8 the PRODUCT's plugins: the browser's
 * Artifacts panel and VibeField's comment pad (the note, field-tools and widgetlab
 * retired with their widgets), and since PT-1 the browser PANE (PORTALS' first kind). Until P8b-3 the bundled set rode the app bundle
 * as static imports and WAS the plugin system; now it is the fallback for a
 * dev run whose artifacts are not built yet, and production ships none of them
 * — the branch folds to `false` at build time, so the dynamic imports below are
 * eliminated with it and no plugin source reaches a production chunk.
 *
 * Dynamic rather than static-imported-and-branched on purpose: a static import
 * keeps the module in the graph for its side effects no matter how dead the
 * branch that uses it, which is exactly the double-loading this rung exists to
 * end. Memoized because the dev fallback can be asked for more than once. */
let devBundled: readonly BundledRendererPlugin[] | null = null;

export async function loadDevBundledPlugins(): Promise<readonly BundledRendererPlugin[]> {
  if (!import.meta.env.DEV) return [];
  if (devBundled !== null) return devBundled;
  const [browser, commentPad, browserPane] = await Promise.all([
    import("@vibefield/plugin-browser"),
    import("@vibefield/plugin-comment-pad"),
    import("@vibefield/plugin-browser-pane"),
  ]);
  devBundled = [
    { manifest: browser.browserManifest, mod: browser.browserRenderer },
    // DK-8 (DK-D14): VibeField's own object kind — its code half read off the package's namespace by its row's
    // binding name, exactly as the staged loader reads a built module's (`objectBindingsFrom`)
    {
      manifest: commentPad.commentPadManifest,
      mod: commentPad.commentPadRenderer,
      objectBindings: objectBindingsFrom(
        commentPad,
        commentPad.commentPadManifest.contributes?.objects ?? [],
      ),
    },
    // PT-1 (PORTALS): the browser pane — its code half read off the package's namespace the same way
    {
      manifest: browserPane.browserPaneManifest,
      mod: browserPane.browserPaneRenderer,
      objectBindings: objectBindingsFrom(
        browserPane,
        browserPane.browserPaneManifest.contributes?.objects ?? [],
      ),
    },
  ];
  return devBundled;
}

/** The registry the canvas is built from. SYNCHRONOUS by construction — one
 * engine generation per memo — so everything that needed awaiting has already
 * happened in the boot phase and arrives here as `prepared`.
 *
 * Staged plugins first, always. The bundled list is consulted only when the
 * staged set is empty, and it is only ever non-empty in a dev build. A
 * production renderer with nothing staged registers NOTHING and says so once:
 * an empty field is the honest face of a daemon that approved no modules, and a
 * silent second loader would hide exactly the failure this rung must surface.
 *
 * DK-5 (DK-D19): the host registers NO built-in types of its own. Its one, the
 * terminal mirror (`vibefield.terminal.mirror`, TP-S2b-widget), retired with
 * `terminal/widget/*` — the deck owns terminals, and a session tag returns under
 * PORTALS. A board that still names the type reads it as any absent type: a
 * faceless ghost stub, its data kept. */
export function buildRegistry(
  prepared: PreparedRendererPlugins = EMPTY_PREPARED,
): PluginRegistry<WidgetType> {
  const registry = new PluginRegistry<WidgetType>();
  const log = getRendererLogger().child({ component: "plugin.host" });
  for (const staged of prepared.staged) {
    if (staged.activation.state !== "active") {
      log.error(
        "renderer.plugins.activation_failed",
        "A staged renderer plugin failed activation",
        staged.activation.error,
        { pluginId: staged.record.id },
      );
    }
    // §11.4: ordinary failed plugins still register their prefabs. A behavior
    // plugin whose sealed code identities are unavailable cannot be defined
    // honestly; isolate that plugin and leave its document data untouched.
    try {
      registerStaged(registry, staged.record, staged.activation, staged.objectBindings);
    } catch (error) {
      log.error(
        "renderer.plugins.registration_failed",
        "A staged plugin could not be registered",
        error,
        { pluginId: staged.record.id },
      );
    }
  }
  if (prepared.staged.length === 0) {
    // `devBundled` is the fallback's fallback, for a caller with no prepared set
    // at all — the headless suites, which have no daemon and no boot phase, and
    // whose setup file loads it once. It is null in every production build,
    // where the loader above is compiled away entirely.
    const bundled = prepared.bundled.length > 0 ? prepared.bundled : (devBundled ?? []);
    for (const { manifest, mod, activation: preparedActivation, objectBindings } of bundled) {
      const activation = preparedActivation ?? activateRenderer(manifest, mod);
      if (activation.state !== "active") {
        log.error(
          "renderer.plugins.activation_failed",
          "A bundled renderer plugin failed activation",
          activation.error,
          { pluginId: manifest.id },
        );
      }
      try {
        registerCanonical(registry, manifest, activation, objectBindings);
      } catch (error) {
        log.error(
          "renderer.plugins.registration_failed",
          "A bundled plugin could not be registered",
          error,
          { pluginId: manifest.id },
        );
      }
    }
    if (bundled.length === 0) {
      log.warn(
        "renderer.plugins.none_staged",
        "No plugin modules were staged; the field opened with no plugins registered",
        { generation: prepared.generation },
      );
    }
  }
  // DK-8: the SafePreview → silhouette wiring (folder minis + tray fallbacks read
  // `previewBackground`) RETIRED with the widget rows that declared a `preview`;
  // DK-13 deleted the registry and its readers with the Objects sheet. An object's
  // specimen is its kind's own drawing on the pegboard.
  return registry;
}

/** The dev/test one-liner: load the bundled fallback and build from it. The
 * headless suites use this — they have no daemon to approve modules, and what
 * they exercise (the engine, seeding, persistence) is the same either way. */
export async function buildDevRegistry(): Promise<PluginRegistry<WidgetType>> {
  return buildRegistry({ generation: -1, staged: [], bundled: await loadDevBundledPlugins() });
}

/** THE BOOT ENTRY: ask the authority, and fall back to the dev-bundled set only
 * when it approved nothing. The fallback is loaded AFTER the staged answer
 * rather than beside it, so a dev run with real artifacts never pays for
 * importing plugin packages it will not use. */
export async function prepareFieldPlugins(
  deps: StagedLoaderDeps,
): Promise<PreparedRendererPlugins> {
  const prepared = await prepareRendererPlugins(deps);
  if (prepared.staged.length > 0) return prepared;
  const bundled = await loadDevBundledPlugins();
  if (bundled.length === 0) return { ...prepared, bundled };
  const runtime = prepared.runtime ?? new RendererWindowController(deps.windowId);
  const log = getRendererLogger().child({ component: "plugin.host" });
  const activated = bundled.map(({ manifest, mod, objectBindings }) => {
    const activation = activateRenderer(manifest, mod);
    try {
      runtime.publishBundled(manifest, activation);
    } catch (error) {
      log.error(
        "renderer.plugins.bundled_behavior_publication_failed",
        "A dev-bundled plugin could not publish its behavior bindings",
        error,
        { pluginId: manifest.id },
      );
    }
    return {
      manifest,
      mod,
      activation,
      ...(objectBindings === undefined ? {} : { objectBindings }),
    };
  });
  return { ...prepared, bundled: activated, runtime };
}

// DK-2 (desk/landing, ICE 0.14.0): ICE's measurement pipeline is GONE —
// `createMeasureQueue`, `MeasuredSize` and `CanvasEngineOpts.measureQueue` left with
// the DOM faces they measured; every effective size is `Size`. The side table that
// paired the queue with the canvas prop went with it.

/** THE DESK (DK-2, ruled DK-D11/D29): VibeField's engine is ICE's desk preset —
 * `desk.desk` the root canvas type, its tools (`desk.select` in hand, `pan`), the
 * scale-free zoom, the plain wheel zooming about the pointer, the zoom-through —
 * with the desk's six reference kinds FIRST and VibeField's own types after them.
 * The engine is CREATED here; nothing mounts it until DK-3's `<Desk>`. */
function fieldEngineOpts(
  registry: PluginRegistry<WidgetType>,
  ghosts: readonly WidgetType[],
): CanvasEngineOpts {
  return {
    ...DESK_ENGINE,
    widgets: [...DESK_OBJECTS, ...registry.allWidgets().values(), ...ghosts],
  };
}

/** The engine's full PACK SCOPE for this registry — every pack/version it can
 * interpret at open: the registry's types, the desk's kinds and their DATA prefabs
 * (`desk.stroke`, `desk.event`, `desk.pin`), `wire`, the canvas packs. The ghost-stub
 * filter reads it (r2 R4): nothing the engine already defines is ever stubbed. */
export function fieldPackScope(registry: PluginRegistry<WidgetType>): ReadonlySet<string> {
  return new Set(Object.keys(compileEngineCatalog(fieldEngineOpts(registry, [])).localPacks()));
}

export function createFieldEngine(
  registry: PluginRegistry<WidgetType>,
  /** P3c — envelope-derived ghost stubs for the pending doc (absent plugins) */
  ghosts: readonly WidgetType[] = [],
): CanvasEngine {
  const ce = createCanvasEngine({
    ...fieldEngineOpts(registry, ghosts),
    // ICE keeps generic guest diagnostics and behavior-specific provenance as complementary
    // routes. Preserve both; the renderer logger owns transport, bounds, and redaction.
    onGuestFault(id, error) {
      getRendererLogger()
        .child({ component: "canvas.guest" })
        .error("renderer.canvas.guest_fault", "A canvas guest faulted", error, { guestId: id });
    },
    onGuestNotice(message) {
      getRendererLogger()
        .child({ component: "canvas.guest" })
        .warn("renderer.canvas.guest_notice", message);
    },
    onBehaviorFault(behavior, hook, entity, error) {
      getRendererLogger()
        .child({
          component: "plugin.behavior",
          ...(pluginIdForBehavior(behavior) === undefined
            ? {}
            : { pluginId: pluginIdForBehavior(behavior) }),
        })
        .error("renderer.plugin.behavior_fault", "A plugin behavior hook faulted", error, {
          behaviorId: behavior,
          hook,
          ...(entity === undefined ? {} : { entity: String(entity) }),
        });
    },
    onBehaviorLog(behavior, message, rest) {
      getRendererLogger()
        .child({
          component: "plugin.behavior",
          ...(pluginIdForBehavior(behavior) === undefined
            ? {}
            : { pluginId: pluginIdForBehavior(behavior) }),
        })
        .info("renderer.plugin.behavior_log", message, {
          behaviorId: behavior,
          arguments: [...rest],
        });
    },
    // The desk preset's settings (its scale-free zoom, wheel and zoom-through)
    // replace VibeField's 0.25–3 clamp and the DOM card's 1.05 lift mirror —
    // both were DOM-card tunings. VibeField keeps its snap threshold.
    settings: { ...DESK_ENGINE.settings, snap: { enabled: true, thresholdPx: 5 } },
  });
  return ce;
}

function pluginIdForBehavior(behaviorId: string): string | undefined {
  const separator = behaviorId.indexOf(":");
  return separator > 0 ? behaviorId.slice(0, separator) : undefined;
}

/** THE FIRST-RUN BOARD (DK-3's six; DK-8 the product's composition) — ICE's six reference kinds and the
 * comment pad, the print through the byte store, the example clock only where the run asks for the
 * examples (field/desk/desk-seed.ts). Requires a live doc session. The composition lands before this
 * returns; the promise resolves once the print is laid. */
export function seedField(
  ce: CanvasEngine,
  session: DocSession,
  blobs: BlobStore = deskBlobs(),
  now?: Date,
  opts?: SeedOptions,
): Promise<void> {
  return seedDesk(ce, session, blobs, now, opts);
}
