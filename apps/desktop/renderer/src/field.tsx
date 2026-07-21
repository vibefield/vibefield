import { type CanvasEngine, createCanvasEngine } from "@vibecook/ice";
import { ground } from "@vibecook/ice/ground";
import { InfiniteCanvas } from "@vibecook/ice/react";
import { noteManifest, noteWidgets } from "@vibefield/plugin-note";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import { type ReactElement, useEffect, useMemo, useRef } from "react";

// The Field (B2 + Track D1): plugins' widgets → one canvas engine →
// InfiniteCanvas over the widgetlab ground (dot grid + snap guides, themed via
// --vf-canvas-* from shell-ui tokens). P0: one in-memory doc per app run
// (DocumentService persistence lands in B3).

function buildRegistry(): PluginRegistry<{ type: string }> {
  const registry = new PluginRegistry<{ type: string }>();
  registry.register(noteManifest, noteWidgets);
  return registry;
}

function createFieldEngine(registry: PluginRegistry<{ type: string }>): CanvasEngine {
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
      text: "Welcome to your field.\n\nDouble-click to edit · drag to move · scroll to pan · ⌘/ctrl+wheel to zoom.",
    },
    undoable: false,
  });
  ce.ops.spawnWidget("note.card", {
    x: 40,
    y: -60,
    w: 240,
    h: 150,
    props: { text: "Spawn more with + Note.", color: "#cfe8d6" },
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
  const spawnCount = useRef(0);

  useEffect(() => {
    // after mount commit — the smoke's pass condition covers InfiniteCanvas itself
    console.log(
      `CANVAS_READY {"widgetTypes":${registry.allWidgets().size},"plugins":${registry.all().length}}`,
    );
  }, [registry]);

  const spawnNote = (): void => {
    const n = spawnCount.current++;
    ce.ops.spawnWidget("note.card", {
      x: -120 + (n % 4) * 56,
      y: -80 + n * 44,
      props: {},
    });
  };

  return (
    <div className="field-wrap" style={{ background: "var(--vf-canvas-bg)" }}>
      <InfiniteCanvas engine={ce} className="field-canvas" ground={groundFactory} />
      <div className="field-toolbar">
        <button type="button" onClick={spawnNote}>
          + Note
        </button>
      </div>
    </div>
  );
}
