import { ground } from "@vibecook/ice/ground";
import { InfiniteCanvas } from "@vibecook/ice/react";
import { spawnCommentAroundSelection } from "@vibefield/plugin-field-tools";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { buildRegistry, createFieldEngine } from "./field-engine";
import { NavigationBreadcrumbs } from "./hud/NavigationBreadcrumbs";
import { WidgetTray } from "./hud/WidgetTray";
import { ZoomPill } from "./hud/ZoomPill";

// The Field (B2 + Track D1–D3): plugins' widgets → one canvas engine →
// InfiniteCanvas over the widgetlab ground (dot grid + snap guides, themed via
// --vf-canvas-*), the morphing island (WidgetTray) as the spawn door, and the
// widgetlab demo scene as the boot board (field-engine.ts).

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

  // C wraps the selection in a comment (widgetlab UE-Blueprint gesture).
  // Capture phase + spawn-only interception: with nothing selected the press
  // falls through to the engine keymap (C = the Wire tool) — the widgetlab
  // C/connect collision resolved by "selection decides".
  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== "c" && e.key !== "C") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (spawnCommentAroundSelection(ce)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
