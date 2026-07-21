import { type CanvasEngine, createCanvasEngine, type WidgetType } from "@vibecook/ice";
import { fieldToolsManifest, fieldToolsWidgets } from "@vibefield/plugin-field-tools";
import { noteManifest, noteWidgets } from "@vibefield/plugin-note";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import { widgetlabManifest, widgetlabWidgets } from "@vibefield/plugin-widgetlab";
import { setPreviewBackground } from "@vibefield/shell-ui";

// The field's engine + seed, React-free (Track D3): FieldView renders it, the
// headless contract tests (drop-consume) drive it. P0: one in-memory doc per
// app run (DocumentService persistence lands in B3).

export function buildRegistry(): PluginRegistry<WidgetType> {
  const registry = new PluginRegistry<WidgetType>();
  registry.register(noteManifest, noteWidgets);
  registry.register(fieldToolsManifest, fieldToolsWidgets);
  registry.register(widgetlabManifest, widgetlabWidgets);
  // Spine wiring: manifest `preview` data → shell-ui's silhouette registry
  // (folder minis + tray fallbacks read previewBackground — one source, P-3).
  for (const plugin of registry.all()) {
    for (const decl of plugin.manifest.widgets) {
      if (decl.preview !== undefined) setPreviewBackground(decl.type, decl.preview);
    }
  }
  return registry;
}

// === the demo scene — widgetlab App.tsx coordinates verbatim (DOM subset) ===
// The GL column (G3X..) and the node trio arrive with D4; the folders keep
// their exact widgetlab positions so the drop-consume test coordinates hold.

const GX = 50;
const GY = 50;
const PITCH = 174;
const G3X = GX + PITCH * 2 + 19 + 329 + 19; // 765
const G6X = G3X + PITCH * 2 + 40 + 329 + 30; // 1512

/** type id → [x, y, w, h, props?] in v1 spawn (zIndex) order. */
const SCENE: Array<[string, number, number, number, number, Record<string, unknown>?]> = [
  [
    "note.card",
    GX,
    GY - 240,
    420,
    190,
    {
      text: "Welcome to your field.\n\nDrag to move · scroll to pan · ⌘/ctrl+wheel to zoom · B opens the widget tray · select cards and press C to wrap them in a comment · double-click a folder to enter it.",
    },
  ],
  ["widgetlab.clock", GX, GY, 155, 155],
  ["widgetlab.battery", GX + PITCH, GY, 155, 155],
  [
    "widgetlab.calendar",
    GX,
    GY + PITCH,
    155,
    155,
    { dateIso: "", nextEvent: "Design review", nextEventTime: "3:30 PM" },
  ],
  [
    "widgetlab.weather",
    GX,
    GY + PITCH * 2,
    329,
    155,
    { location: "Cupertino", temp: 72, high: 78, low: 60, condition: "sunny" },
  ],
  ["widgetlab.stocks", GX, GY + PITCH * 3, 329, 155],
  ["widgetlab.fitness", GX, GY + PITCH * 4, 329, 345],
  ["widgetlab.photos", GX + PITCH * 2 + 19, GY, 329, 535],
  [
    "field.folder",
    G3X + PITCH * 2 + 40,
    GY + 220,
    329,
    345,
    { title: "Widgets", accent: "#6366F1" },
  ],
  [
    "field.folder",
    G3X + PITCH * 2 + 40,
    GY + 220 + 345 + 19,
    329,
    345,
    { title: "Saved", accent: "#EC4899" },
  ],
  ["widgetlab.todo", G6X, GY, 329, 345],
];

export function createFieldEngine(registry: PluginRegistry<WidgetType>): CanvasEngine {
  const ce = createCanvasEngine({
    widgets: [...registry.allWidgets().values()],
    settings: {
      zoom: { min: 0.25, max: 3 },
      snap: { enabled: true, thresholdPx: 5 },
      // chrome.liftScale mirrors CardShell's lift transform (1.05) so the
      // multi-select union box keeps wrapping a lifted member (widgetlab law).
      chrome: { liftScale: 1.05 },
    },
  });
  ce.docs.create(); // a doc is mandatory before any spawn/edit
  for (const [type, x, y, w, h, props] of SCENE) {
    ce.ops.spawnWidget(type, {
      x,
      y,
      w,
      h,
      undoable: false, // seeds — the user's first ⌘Z stays clean (moodboard rule)
      ...(props !== undefined ? { props } : {}),
    });
  }
  ce.world.sync(); // project the seeds before the first frame
  return ce;
}
