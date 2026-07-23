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
import type { PluginManifestV1 } from "@vibefield/contracts";
import { fieldToolsManifest, fieldToolsRenderer } from "@vibefield/plugin-field-tools";
import { noteManifest, noteRenderer } from "@vibefield/plugin-note";
import { PluginRegistry, safePreviewToCss } from "@vibefield/plugin-runtime";
import type { RendererPluginModule, WidgetBinding } from "@vibefield/plugin-sdk";
import { widgetlabManifest, widgetlabRenderer } from "@vibefield/plugin-widgetlab";
import { setPreviewBackground } from "@vibefield/shell-ui";
import { buildWidgetType } from "./plugin-host/build-widget";
import { failedFaceComponent } from "./plugin-host/faces";
import { type ActivatedRenderer, activateRenderer } from "./plugin-host/renderer-harness";

// The field's engine + seed, React-free (Track D3/D4): FieldView renders it,
// the headless contract tests (drop-consume) drive it. B3 split the two —
// `createFieldEngine` is DOC-LESS (no create, no seed); the caller decides
// open-vs-seed AFTER asking fieldd for the board (registry-open law: never
// blind-seed). `seedField` is the first-run payload — and the persistence
// tests' named census.

/** The canonical path (§12.2): build every declared prefab from manifest data
 * with its code-side binding, then register manifest + implementations as one
 * unit. P3c: every owned component is wrapped in the face policy (live
 * disabled-placeholder + the §11.4 boundary), and a declared type the
 * activation did NOT bind gets a failed face instead of failing the plugin —
 * the schema always registers, so boards stay writable and honest. */
function registerCanonical(
  registry: PluginRegistry<WidgetType>,
  manifest: PluginManifestV1,
  activation: ActivatedRenderer,
): void {
  const owner = { pluginId: manifest.id, pluginTitle: manifest.title };
  const activationError = activation.state === "failed" ? (activation.error ?? "failed") : null;
  const widgets = Object.fromEntries(
    (manifest.contributes?.widgets ?? []).map((w) => {
      const bound = activationError === null ? activation.bindings.get(w.type) : undefined;
      const binding =
        bound ??
        ({
          component: failedFaceComponent(
            manifest.title,
            activationError ?? `no binding registered for ${w.type}`,
            w.surface,
          ),
        } satisfies WidgetBinding);
      return [w.type, buildWidgetType(w, binding, owner)];
    }),
  );
  registry.registerV1(manifest, widgets);
}

/** The statically bundled set — the code the shell ships either way. P3a:
 * each entry is a renderer MODULE (§10.1) — bindings come from activation
 * through the harness, not from exports. P3c: EVERY present plugin registers
 * its real schema unconditionally (ICE's catalog is process-permanent — the
 * only way enable/disable can round-trip in one session); what changes with
 * registry state is the FACE (live, faces.tsx) and the tray/seed surfaces.
 * The staged import-map loader (§19.2) later replaces the static list. */
const BUNDLED: Array<[PluginManifestV1, RendererPluginModule]> = [
  [noteManifest, noteRenderer],
  [fieldToolsManifest, fieldToolsRenderer],
  [widgetlabManifest, widgetlabRenderer],
];

export function buildRegistry(): PluginRegistry<WidgetType> {
  const registry = new PluginRegistry<WidgetType>();
  for (const [manifest, mod] of BUNDLED) {
    const activation = activateRenderer(manifest, mod);
    if (activation.state === "failed")
      console.error(`[plugins] ${manifest.id} renderer activation failed: ${activation.error}`);
    // §11.4: a failed plugin registers face-only widgets — its boards render
    // honest failed faces; peers and the canvas are untouched.
    registerCanonical(registry, manifest, activation);
  }
  // Spine wiring: manifest SafePreview data → shell-ui's silhouette registry
  // (folder minis + tray fallbacks read previewBackground — one source, P-3).
  for (const plugin of registry.all()) {
    for (const w of plugin.v1.contributes?.widgets ?? []) {
      const css = safePreviewToCss(w.preview);
      if (css !== undefined) setPreviewBackground(w.type, css);
    }
  }
  return registry;
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
