import { type CanvasEngine, defineTickSystem, Viewport } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { getRendererLogger } from "../../logging";
import { deskPlates } from "./desk-assets";
import { deskScale, glyphFeed } from "./desk-glyphs";
import { DESK_GRID } from "./desk-layer";

// WHAT A MOUNTED DESK IS FED once its mat is here (DK-3; ICE's app does the same in its `onReady`):
// the generated gobo plates into slots `c` and `b` (a lazy module — no `fetch`, ruling 8), and the
// rulers' glyph atlas, re-rendered by a tick gated on the viewport's ratio moving (another display,
// the browser's zoom) so nothing runs while it stands. The submit instrument is asked for at the same
// moment, so `submits()` counts from the mat's arrival. One feed per mount; `dispose` undoes it.

export interface DeskFeed {
  /** Both plates are on the mat. */
  platesSet(): boolean;
  dispose(): void;
}

export function feedDesk(handle: DeskLayerHandle, engine: CanvasEngine): DeskFeed {
  const log = getRendererLogger().child({ component: "canvas.desk" });
  let ended = false;
  let platesSet = false;
  let stopGlyphs: (() => void) | null = null;
  const glyphs = glyphFeed({
    ready: () => handle.available(),
    scale: () => deskScale(engine.world.getResource(Viewport)?.dpr ?? 1),
    size: () => DESK_GRID.mat.ruler.text.size,
    upload: (atlas) => handle.setGlyphs(atlas.bytes, atlas.meta),
  });
  // An atlas that cannot be rendered (no 2D context) leaves the rulers unlabelled — said once,
  // never thrown into the status listeners or the tick it rides.
  let glyphsSaid = false;
  const refreshGlyphs = (): void => {
    try {
      glyphs.refresh();
    } catch (error) {
      if (glyphsSaid) return;
      glyphsSaid = true;
      log.warn("renderer.desk.glyphs_failed", "The rulers' labels could not be rendered", {
        error: String(error),
      });
    }
  };
  const feed = (): void => {
    if (ended || stopGlyphs !== null || !handle.available()) return;
    handle.submits();
    refreshGlyphs();
    stopGlyphs = engine.engine.addSystems(
      "simulate",
      defineTickSystem(refreshGlyphs, {
        name: "vibefield.desk.glyphs",
        runIf: () => !glyphsSaid && glyphs.stale(),
      }),
    );
    void deskPlates().then(
      (plates) => {
        if (ended || !handle.available()) return;
        handle.setPlate("c", plates.c);
        handle.setPlate("b", plates.b);
        platesSet = true;
      },
      (error: unknown) =>
        log.error("renderer.desk.plates_failed", "The desk's gobo plates did not load", error),
    );
  };
  const offStatus = handle.onStatus(feed);
  feed();
  return {
    platesSet: () => platesSet,
    dispose() {
      ended = true;
      offStatus();
      stopGlyphs?.();
    },
  };
}
