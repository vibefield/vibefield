import { type CanvasEngine, defineTickSystem, Viewport } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { type DeskLightValues, deskLightValues } from "@vibefield/contracts";
import { getRendererLogger } from "../../logging";
import { deskPlate } from "./desk-assets";
import { deskScale, glyphFeed } from "./desk-glyphs";
import { DESK_GRID, DESK_WIND_IDLE_MS } from "./desk-layer";
import { deskLightLook, deskLightRefusal } from "./desk-light";

// WHAT A MOUNTED DESK IS FED once its mat is here (DK-3; ICE's app does the same in its `onReady`):
// - THE LIGHT (item 583; DESIGN.md §2.1, §8 "Settings → Canvas"): the person's rows as the mat's gobo and the wind's
//   policy, and the chosen plant's plate into slot `c` — one plate, from its own lazy module (no `fetch`, ruling 8).
//   The desk follows the rows live (`setLight`): a plant changed loads its plate, anything else is config alone.
// - the rulers' glyph atlas, re-rendered by a tick gated on the viewport's ratio moving (another display, the
//   browser's zoom) so nothing runs while it stands.
// The submit instrument is asked for at the same moment, so `submits()` counts from the mat's arrival. One feed per
// mount; `dispose` undoes it.

export interface DeskFeed {
  /** The chosen plant's plate is on the mat. A desk in open light (no plant) owes none. */
  platesSet(): boolean;
  /** The light the desk wears now (Settings → Canvas, a row in hand included). */
  setLight(light: DeskLightValues): void;
  dispose(): void;
}

/** Said once per page: why its desks are under the cone, when ICE refused the soft light's text. */
let refusalSaid = false;

/**
 * `light` is what the desk wears from its first fed frame: the person's rows, or `null` while they are not known yet
 * (the desk then stands in open light, with no plant, until `setLight`: never one plant and then another). Absent,
 * every row is at its rest (the catalog's specimen).
 */
export function feedDesk(
  handle: DeskLayerHandle,
  engine: CanvasEngine,
  light: DeskLightValues | null = deskLightValues(undefined),
): DeskFeed {
  const log = getRendererLogger().child({ component: "canvas.desk" });
  let ended = false;
  let stopGlyphs: (() => void) | null = null;
  let worn = light;
  /** The look last handed to the mat, by its text: a light that says the same again configures nothing. */
  let configured = "";
  /** The plant whose plate is on the mat (`none`: no plate is owed), and the one on its way. */
  let onMat: DeskLightValues["plant"] | null = null;
  let loading: DeskLightValues["plant"] | null = null;
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
  const dress = (): void => {
    if (ended || worn === null || !handle.available()) return;
    const look = deskLightLook(worn);
    const text = JSON.stringify(look);
    if (text !== configured) {
      configured = text;
      handle.configureMat({ gobo: look.gobo });
      handle.setAmbient(look.ambient, DESK_WIND_IDLE_MS);
    }
    const plant = worn.plant;
    if (plant === "none") {
      onMat = "none";
      return;
    }
    if (plant === onMat || plant === loading) return;
    loading = plant;
    void deskPlate(plant).then(
      (bytes) => {
        if (loading === plant) loading = null;
        // the person chose another plant meanwhile: this plate is not the one to wear
        if (ended || !handle.available() || worn?.plant !== plant) {
          dress();
          return;
        }
        handle.setPlate("c", bytes);
        onMat = plant;
      },
      (error: unknown) => {
        if (loading === plant) loading = null;
        log.error("renderer.desk.plates_failed", "The desk's gobo plate did not load", error);
      },
    );
  };
  const feed = (): void => {
    if (ended || !handle.available()) return;
    if (stopGlyphs === null) {
      handle.submits();
      refreshGlyphs();
      stopGlyphs = engine.engine.addSystems(
        "simulate",
        defineTickSystem(refreshGlyphs, {
          name: "vibefield.desk.glyphs",
          runIf: () => !glyphsSaid && glyphs.stale(),
        }),
      );
      const refusal = deskLightRefusal();
      if (refusal !== null && !refusalSaid) {
        refusalSaid = true;
        log.warn(
          "renderer.desk.light_text_refused",
          "The desk is drawn under the cone: the soft light's text was refused",
          { reason: refusal.slice(0, 512) },
        );
      }
    }
    dress();
  };
  const offStatus = handle.onStatus(feed);
  feed();
  return {
    platesSet: () => worn !== null && onMat === worn.plant,
    setLight(next) {
      worn = next;
      dress();
    },
    dispose() {
      ended = true;
      offStatus();
      stopGlyphs?.();
    },
  };
}
