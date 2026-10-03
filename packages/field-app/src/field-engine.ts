import {
  type CanvasEngine,
  type CanvasEngineOpts,
  compileEngineCatalog,
  createCanvasEngine,
  type DocSession,
  type Entity,
  PrefabId,
  type WidgetType,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
} from "@vibecook/ice";
import { DESK_ENGINE, DESK_OBJECTS } from "@vibecook/ice/desk/objects";
import type {
  ObjectContribution,
  PluginManifestV1,
  PluginRecord,
  WidgetContribution,
} from "@vibefield/contracts";
import { setPreviewBackground } from "@vibefield/design-kit";
import { PluginRegistry, safePreviewToCss } from "@vibefield/plugin-runtime";
import type { ObjectBinding } from "@vibefield/plugin-sdk";
import { getRendererLogger } from "./logging";
import {
  buildFacelessObjectType,
  buildObjectType,
  buildWidgetType,
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
import { registerBuiltInTerminalWidgets, TERMINAL_BUILT_IN_WIDGETS } from "./terminal/widget";

// The field's engine + seed, React-free (Track D3/D4): FieldView renders it,
// the headless contract tests (drop-consume) drive it. B3 split the two —
// `createFieldEngine` is DOC-LESS (no create, no seed); the caller decides
// open-vs-seed AFTER asking fieldd for the board (registry-open law: never
// blind-seed). `seedField` is the first-run payload — and the persistence
// tests' named census.

/** Build every declared prefab from DECLARATION data (§12.2). DK-2 (desk/landing, ICE 0.14.0):
 * a `widgets` row compiles FACELESS — it binds to nothing the desk draws (its React binding is
 * gone; `contributes.widgets` is refused with a dated sentence at DK-8) — and an `objects` row
 * compiles through `defineObject` with the kind its module exports. An object whose kind cannot
 * be bound (no export, not a desk kind, a refused binding) still registers FACELESS so its
 * document's data survives (ICE's missing face draws it from 0.15.0), and the host says why. */
function buildWidgets(
  title: string,
  pluginId: string,
  contributions: readonly WidgetContribution[],
  objects: readonly ObjectContribution[],
  activation: ActivatedRenderer,
  objectBindings: ReadonlyMap<string, ObjectBinding> = new Map(),
): Record<string, WidgetType> {
  const owner = { pluginId, pluginTitle: title };
  const built: Record<string, WidgetType> = {};
  for (const w of contributions) built[w.type] = buildWidgetType(w, owner, activation.behaviors);
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
    buildWidgets(
      manifest.title,
      manifest.id,
      manifest.contributes?.widgets ?? [],
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
    buildWidgets(
      record.title,
      record.id,
      record.contributions.widgets,
      record.contributions.objects ?? [],
      activation,
      objectBindings,
    ),
  );
}

/** THE DEV-ONLY BUNDLED SET (P8-D2). Until P8b-3 these four rode the app bundle
 * as static imports and WERE the plugin system; now they are the fallback for a
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
  const [browser, note, fieldTools, widgetlab] = await Promise.all([
    import("@vibefield/plugin-browser"),
    import("@vibefield/plugin-note"),
    import("@vibefield/plugin-field-tools"),
    import("@vibefield/plugin-widgetlab"),
  ]);
  devBundled = [
    { manifest: browser.browserManifest, mod: browser.browserRenderer },
    { manifest: note.noteManifest, mod: note.noteRenderer },
    { manifest: fieldTools.fieldToolsManifest, mod: fieldTools.fieldToolsRenderer },
    { manifest: widgetlab.widgetlabManifest, mod: widgetlab.widgetlabRenderer },
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
 * TP-S2b-widget: the HOST'S OWN built-ins register FIRST — before any plugin,
 * staged or bundled. Order is the point: the registry's collision law is
 * first-writer-wins-and-the-second-throws, so registering the built-ins ahead
 * of everything makes a plugin that claims `vibefield.terminal.mirror` fail
 * loudly at registration instead of quietly outranking the host. */
export function buildRegistry(
  prepared: PreparedRendererPlugins = EMPTY_PREPARED,
): PluginRegistry<WidgetType> {
  const registry = new PluginRegistry<WidgetType>();
  const log = getRendererLogger().child({ component: "plugin.host" });
  // DK-2: the built-in's registration is GUARDED (r1 §0.2) — it ran outside every try, so one
  // refused definition threw out of `buildRegistry` and took the workspace's session memo down
  // with it. A built-in that cannot register now says which type, and the field opens without it.
  try {
    registerBuiltInTerminalWidgets(registry);
  } catch (error) {
    const types = TERMINAL_BUILT_IN_WIDGETS.map((w) => w.type).join(", ");
    log.error(
      "renderer.plugins.builtin_registration_failed",
      `The built-in widget type ${types} could not be registered`,
      error,
      { type: types },
    );
  }
  for (const staged of prepared.staged) {
    if (staged.activation.state !== "active") {
      log.error(
        "renderer.plugins.activation_failed",
        "A staged renderer plugin failed activation",
        staged.activation.error,
        { pluginId: staged.record.id },
      );
    }
    // §11.4: ordinary failed plugins register face-only widgets. A behavior
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
  // Spine wiring: declared SafePreview data → design-kit's silhouette registry
  // (folder minis + tray fallbacks read previewBackground — one source, P-3).
  for (const plugin of registry.all()) {
    for (const w of plugin.widgetContributions) {
      const css = safePreviewToCss(w.preview);
      if (css !== undefined) setPreviewBackground(w.type, css);
    }
  }
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
 * importing four plugin packages it will not use. */
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

// === the demo scene — widgetlab App.tsx coordinates verbatim ===
// (debug-resizable is the one widgetlab row not ported — a dev widget, cut.)

const GX = 50;
const GY = 50;
const PITCH = 174;
const G3X = GX + PITCH * 2 + 19 + 329 + 19; // 765
const G6X = G3X + PITCH * 2 + 40 + 329 + 30; // 1512

/** type id → [x, y, w, h, props?] in v1 spawn (zIndex) order. */
const SCENE: Array<[string, number, number, number, number, Record<string, unknown>?]> = [
  [
    "vibefield.note",
    GX,
    GY - 240,
    420,
    190,
    {
      text: "Welcome to your field.\n\nDrag to move · scroll to pan · ⌘/ctrl+wheel to zoom · B opens the widget tray · select cards and press C to wrap them in a comment · double-click a folder to enter it.",
    },
  ],
  ["vibefield.widgetlab.clock", GX, GY, 155, 155],
  ["vibefield.widgetlab.battery", GX + PITCH, GY, 155, 155],
  [
    "vibefield.widgetlab.calendar",
    GX,
    GY + PITCH,
    155,
    155,
    { dateIso: "", nextEvent: "Design review", nextEventTime: "3:30 PM" },
  ],
  [
    "vibefield.widgetlab.weather",
    GX,
    GY + PITCH * 2,
    329,
    155,
    { location: "Cupertino", temp: 72, high: 78, low: 60, condition: "sunny" },
  ],
  ["vibefield.widgetlab.stocks", GX, GY + PITCH * 3, 329, 155],
  ["vibefield.widgetlab.fitness", GX, GY + PITCH * 4, 329, 345],
  ["vibefield.widgetlab.photos", GX + PITCH * 2 + 19, GY, 329, 535],
  ["vibefield.widgetlab.sphere", G3X, GY, 155, 155],
  ["vibefield.widgetlab.crystal", G3X + PITCH, GY, 155, 155],
  ["vibefield.widgetlab.torus-knot", G3X, GY + PITCH, 329, 155],
  ["vibefield.widgetlab.cube", G3X, GY + PITCH * 2, 329, 155],
  ["vibefield.widgetlab.gold-knot", G3X, GY + PITCH * 3, 329, 345],
  [
    "vibefield.field-tools.folder",
    G3X + PITCH * 2 + 40,
    GY + 220,
    329,
    345,
    { title: "Widgets", accent: "#6366F1" },
  ],
  [
    "vibefield.field-tools.folder",
    G3X + PITCH * 2 + 40,
    GY + 220 + 345 + 19,
    329,
    345,
    { title: "Saved", accent: "#EC4899" },
  ],
  ["vibefield.widgetlab.todo", G6X, GY, 329, 345],
  ["vibefield.widgetlab.shapes", G6X, GY + 345 + 19, 329, 345],
  ["vibefield.widgetlab.orbit-cube", G6X, GY + (345 + 19) * 2, 329, 155],
];

/**
 * Seed one wire between two node widgets — nodeboard's `seedWire` verbatim on
 * a doc session (design-001 §5.3: a `Wire`-tagged entity carrying
 * `WirePorts{from,to}` + the endpoint relations; geometry never stores a port
 * entity).
 */
function seedWire(
  session: DocSession,
  from: Entity,
  fromPort: string,
  to: Entity,
  toPort: string,
): void {
  session.store.transaction(
    (tx) => {
      const wire = tx.spawn({
        components: [
          [PrefabId, { id: "wire" }],
          [WirePorts, { from: fromPort, to: toPort }],
        ],
        tags: [Wire],
      });
      tx.setRelation(wire, WireFrom, from);
      tx.setRelation(wire, WireTo, to);
    },
    { undoable: false }, // seeds — the user's first ⌘Z stays clean (moodboard rule)
  );
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
    // replace VibeField's 0.25–3 clamp and CardShell's 1.05 lift mirror — both
    // were DOM-card tunings. VibeField keeps its snap threshold.
    settings: { ...DESK_ENGINE.settings, snap: { enabled: true, thresholdPx: 5 } },
  });
  return ce;
}

/** The tools legal on the canvas in view (the desk's are `desk.select` and `pan`). */
function legalTool(ce: CanvasEngine, id: string): boolean {
  return ce.canvas.tools().some((tool) => tool.id === id);
}

/** `ops.setTool` for callers that name a tool the canvas may not allow (DK-D29: the
 * Select/Pan/Wire switcher and `c`→connect retire; ICE THROWS for a tool illegal in
 * the current canvas type). An illegal id is REFUSED — logged once per id, `false`
 * returned — never a throw out of the renderer. */
const refusedTools = new Set<string>();
export function setFieldTool(ce: CanvasEngine, id: string): boolean {
  if (legalTool(ce, id)) {
    ce.ops.setTool(id);
    return true;
  }
  if (!refusedTools.has(id)) {
    refusedTools.add(id);
    getRendererLogger()
      .child({ component: "canvas.tools" })
      .warn("renderer.canvas.tool_refused", "A tool not legal on the desk was refused", {
        tool: id,
        legal: ce.canvas.tools().map((tool) => tool.id),
      });
  }
  return false;
}

function pluginIdForBehavior(behaviorId: string): string | undefined {
  const separator = behaviorId.indexOf(":");
  return separator > 0 ? behaviorId.slice(0, separator) : undefined;
}

/** The first-run board (widgetlab demo scene). Requires a live doc session.
 * Seeds only REGISTERED types the root canvas PLACES: with a plugin disabled at
 * first boot, its demo widgets are skipped rather than thrown on (the scene
 * degrades honestly). DK-2: the desk's root places what provides `desk.object`,
 * which no VibeField widget does — so on the desk this scene seeds nothing until
 * DK-5 rewrites it with desk objects. */
export function seedField(
  ce: CanvasEngine,
  session: DocSession,
  registry: PluginRegistry<WidgetType>,
): void {
  const placeable = ce.catalog.placementFor(ce.catalog.rootCanvas.id);
  const registered = new Set(
    [...registry.allWidgets().keys()].filter((type) => placeable.has(type)),
  );
  for (const [type, x, y, w, h, props] of SCENE) {
    if (!registered.has(type)) continue;
    ce.ops.spawnWidget(type, {
      x,
      y,
      w,
      h,
      undoable: false, // seeds — the user's first ⌘Z stays clean (moodboard rule)
      ...(props !== undefined ? { props } : {}),
    });
  }
  // Node trio (widgetlab 2026-07-16): a wire-able signal → filter → scope
  // chain in its own column right of the todo column. Hover a node to
  // materialize its port dots, drag dot-to-dot to connect (ports accept
  // "signal"; the dashed preview goes solid on a compatible target).
  const NX = G6X + 329 + 39; // 1880 — the next column in the v1 grid rhythm
  if (["signal", "filter", "scope"].every((n) => registered.has(`vibefield.widgetlab.${n}`))) {
    const signal = ce.ops.spawnWidget("vibefield.widgetlab.signal", {
      x: NX,
      y: 50,
      w: 170,
      h: 96,
      undoable: false,
    });
    const filter = ce.ops.spawnWidget("vibefield.widgetlab.filter", {
      x: NX + 240,
      y: 170,
      w: 170,
      h: 96,
      undoable: false,
    });
    const scope = ce.ops.spawnWidget("vibefield.widgetlab.scope", {
      x: NX + 480,
      y: 62,
      w: 170,
      h: 96,
      undoable: false,
    });
    seedWire(session, signal, "out", filter, "in");
    seedWire(session, filter, "out", scope, "in-a");
  }
  ce.world.sync(); // project the seeds before the first frame
}
