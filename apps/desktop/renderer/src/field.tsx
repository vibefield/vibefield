import { type CanvasEngine, createCanvasEngine, type WidgetType } from "@vibecook/ice";
import { ground } from "@vibecook/ice/ground";
import { InfiniteCanvas } from "@vibecook/ice/react";
import { noteManifest, noteWidgets } from "@vibefield/plugin-note";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { NavigationBreadcrumbs } from "./hud/NavigationBreadcrumbs";
import { WidgetTray } from "./hud/WidgetTray";
import { ZoomPill } from "./hud/ZoomPill";

// The Field (B2 + Track D1/D2): plugins' widgets → one canvas engine →
// InfiniteCanvas over the widgetlab ground (dot grid + snap guides, themed via
// --vf-canvas-*), with the morphing island (WidgetTray) as the spawn door —
// the old "+ Note" toolbar retired with it. P0: one in-memory doc per app run
// (DocumentService persistence lands in B3).

function buildRegistry(): PluginRegistry<WidgetType> {
  const registry = new PluginRegistry<WidgetType>();
  registry.register(noteManifest, noteWidgets);
  return registry;
}

function createFieldEngine(registry: PluginRegistry<WidgetType>): CanvasEngine {
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
  ce.ops.spawnWidget("note.card", {
    x: -300,
    y: -140,
    w: 280,
    h: 190,
    props: {
      text: "Welcome to your field.\n\nDouble-click to edit · drag to move · scroll to pan · ⌘/ctrl+wheel to zoom · B opens the tray.",
    },
    undoable: false,
  });
  ce.ops.spawnWidget("note.card", {
    x: 40,
    y: -60,
    w: 240,
    h: 150,
    props: { text: "Drag widgets out of the tray below.", color: "#cfe8d6" },
    undoable: false,
  });
  ce.world.sync(); // project the seeds before the first frame
  return ce;
}

export function FieldView(): ReactElement {
  const registry = useMemo(buildRegistry, []);
  const ce = useMemo(() => createFieldEngine(registry), [registry]);
  // The P0 ground layer (grid + snap guides, one WebGPU canvas) — factory per
  // window, themed by the --vf-canvas-* vars on this subtree (widgetlab wiring).
  const groundFactory = useMemo(() => ground(), []);
  const [trayOpen, setTrayOpen] = useState(false);

  useEffect(() => {
    // after mount commit — the smoke's pass condition covers InfiniteCanvas itself
    console.log(
      `CANVAS_READY {"widgetTypes":${registry.allWidgets().size},"plugins":${registry.all().length}}`,
    );
  }, [registry]);

  // Natural boot framing (widgetlab, 2026-07-18: "zoom to fit, but with an
  // upper and bottom cap"): frame the seeds once the viewport is measured and
  // membership has stamped the first tick — frameContent returns false until
  // both exist, so poll briefly and stop on success.
  useEffect(() => {
    if (ce.ops.frameContent()) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (ce.ops.frameContent() || tries > 40) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [ce]);

  return (
    <div className="field-wrap" style={{ background: "var(--vf-canvas-bg)" }}>
      {/* The recede (reference design): the canvas eases to 0.98 while the
          sheet is up. Only the wrapper transforms — the tray handoff
          ratio-corrects, so the transient scale never skews engine picks. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: trayOpen ? "scale(0.98)" : "scale(1)",
          transition: "transform 600ms var(--vf-ease-island)",
        }}
      >
        <InfiniteCanvas engine={ce} className="field-canvas" ground={groundFactory} />
      </div>
      {/* Chrome overlays sit OUTSIDE the recede wrapper — they never scale. */}
      <NavigationBreadcrumbs engine={ce} />
      <ZoomPill ce={ce} />
      <WidgetTray ce={ce} registry={registry} open={trayOpen} onOpenChange={setTrayOpen} />
    </div>
  );
}
