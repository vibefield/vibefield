import { Camera, type CanvasEngine, type Entity, trayTakeProps, Viewport } from "@vibecook/ice";
import { screenToWorld } from "@vibecook/ice/kernel";

// INSERTING BY KEYBOARD (DK-13; DESIGN.md §8 "The pegboard", R14): ⏎ on a specimen lays its object at the VIEW'S
// CENTRE. ICE has no door that lays the board's focused specimen (the tray's take is a pointer's — `TrayPress` → the
// insert ghost's drag, `ops.insertByDrag`), so this is the nearest honest thing, built from the engine's own doors —
// and named as an ask (I37): the object made as a take makes it (the widget's defaults, its tray entry's `take` folded
// in — `trayTakeProps`), at its own size, centred on the view's centre in the frame the desk shows, by ONE
// `ops.spawnWidget` (one transaction: one undo step), then selected — as a take released on the desk is.

/** Lay one `type` at the view's centre — returns the new object, or null when its type carries no tray entry, the
 * desk has no view yet, or the frame refuses it (the placement's word: nothing is made). */
export function layAtViewCentre(engine: CanvasEngine, type: string): Entity | null {
  const widget = engine.catalog.widget(type);
  const entry = widget?.tray;
  const camera = engine.world.getResource(Camera);
  const view = engine.world.getResource(Viewport);
  if (widget === undefined || entry === undefined || camera === undefined || view === undefined)
    return null;
  if (!(view.w > 0) || !(view.h > 0)) return null;
  const centre = screenToWorld(view.w / 2, view.h / 2, camera);
  const { w, h } = widget.defaultSize;
  const props = trayTakeProps(entry);
  let made: Entity;
  try {
    made = engine.ops.spawnWidget(type, {
      x: centre.x - w / 2,
      y: centre.y - h / 2,
      w,
      h,
      ...(props === undefined ? {} : { props: { ...props } }),
    });
  } catch {
    return null;
  }
  engine.ops.setSelection([made]);
  return made;
}
