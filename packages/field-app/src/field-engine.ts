import {
  type CanvasEngine,
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
import type { PluginManifestV1, PluginRecord, WidgetContribution } from "@vibefield/contracts";
import { setPreviewBackground } from "@vibefield/design-kit";
import { PluginRegistry, safePreviewToCss } from "@vibefield/plugin-runtime";
import type { WidgetBinding } from "@vibefield/plugin-sdk";
import { getRendererLogger } from "./logging";
import { buildWidgetType } from "./plugin-host/build-widget";
import { failedFaceComponent } from "./plugin-host/faces";
import type { RendererPluginController } from "./plugin-host/renderer-controller";
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

/** Build every declared prefab from DECLARATION data with its code-side binding (§12.2). Every
 * owned component is wrapped in the face policy (live disabled-placeholder + §11.4 boundary).
 * Staged targets receive a stable controller facade so ICE's build-once catalog can follow later
 * authority generations; legacy/uncontrolled missing bindings receive an honest failed face. */
function buildWidgets(
  title: string,
  pluginId: string,
  contributions: readonly WidgetContribution[],
  activation: ActivatedRenderer,
  controller?: RendererPluginController,
): Record<string, WidgetType> {
  const owner = { pluginId, pluginTitle: title };
  const activationError =
    activation.state === "active" ? null : (activation.error ?? activation.state);
  return Object.fromEntries(
    contributions.map((w) => {
      const bound =
        controller !== undefined
          ? controller.widgetBinding(w.type, w.surface)
          : activationError === null
            ? activation.bindings.get(w.type)
            : undefined;
      const binding =
        bound ??
        ({
          component: failedFaceComponent(
            title,
            activationError ?? `no binding registered for ${w.type}`,
            w.surface,
          ),
        } satisfies WidgetBinding);
      return [w.type, buildWidgetType(w, binding, owner)];
    }),
  );
}

/** The canonical path (§12.2), now DEV-ONLY: manifest + implementations as one
 * unit, validated by the registry's manifest door. */
function registerCanonical(
  registry: PluginRegistry<WidgetType>,
  manifest: PluginManifestV1,
  activation: ActivatedRenderer,
): void {
  registry.registerV1(
    manifest,
    buildWidgets(manifest.title, manifest.id, manifest.contributes?.widgets ?? [], activation),
  );
}

/** THE STAGED PATH (P8b-3): the same laws sourced from fieldd's sanitized
 * record — the only description of a staged plugin this process has. */
function registerStaged(
  registry: PluginRegistry<WidgetType>,
  record: PluginRecord,
  activation: ActivatedRenderer,
  controller?: RendererPluginController,
): void {
  registry.registerRecord(
    record,
    buildWidgets(record.title, record.id, record.contributions.widgets, activation, controller),
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
 * silent second loader would hide exactly the failure this rung must surface. */
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
    // §11.4: a failed plugin registers face-only widgets — its boards render
    // honest failed faces; peers and the canvas are untouched.
    registerStaged(registry, staged.record, staged.activation, staged.controller);
  }
  if (prepared.staged.length === 0) {
    // `devBundled` is the fallback's fallback, for a caller with no prepared set
    // at all — the headless suites, which have no daemon and no boot phase, and
    // whose setup file loads it once. It is null in every production build,
    // where the loader above is compiled away entirely.
    const bundled = prepared.bundled.length > 0 ? prepared.bundled : (devBundled ?? []);
    for (const { manifest, mod } of bundled) {
      const activation = activateRenderer(manifest, mod);
      if (activation.state !== "active") {
        log.error(
          "renderer.plugins.activation_failed",
          "A bundled renderer plugin failed activation",
          activation.error,
          { pluginId: manifest.id },
        );
      }
      registerCanonical(registry, manifest, activation);
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
  return { ...prepared, bundled: await loadDevBundledPlugins() };
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

export function createFieldEngine(
  registry: PluginRegistry<WidgetType>,
  /** P3c — envelope-derived ghost stubs for the pending doc (absent plugins) */
  ghosts: readonly WidgetType[] = [],
): CanvasEngine {
  return createCanvasEngine({
    widgets: [...registry.allWidgets().values(), ...ghosts],
    settings: {
      zoom: { min: 0.25, max: 3 },
      snap: { enabled: true, thresholdPx: 5 },
      // chrome.liftScale mirrors CardShell's lift transform (1.05) so the
      // multi-select union box keeps wrapping a lifted member (widgetlab law).
      chrome: { liftScale: 1.05 },
    },
  });
}

/** The first-run board (widgetlab demo scene). Requires a live doc session.
 * Seeds only REGISTERED types: with a plugin disabled at first boot, its demo
 * widgets are skipped rather than thrown on (the scene degrades honestly). */
export function seedField(
  ce: CanvasEngine,
  session: DocSession,
  registry: PluginRegistry<WidgetType>,
): void {
  const registered = new Set(registry.allWidgets().keys());
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
