// THE LOOK DOOR ON A REAL ENGINE (look-at-object.ts; OB-D16, and the EL8 to ICE 0.21.0 of 2026-11-25): `lookAtObject` is
// the installed ICE's `ops.lookAt` (petition I58) at its defaults. Here, on a real field engine and document: a look at
// a pane far off the view flies the camera until the pane's centre is the view's centre, keeps the zoom the person is
// at (the pane reads and fits there), and makes the pane the selection alone; a look at an object that is gone answers
// false and moves nothing. The flight's own law (its first tick held, what it yields to, a look into a mini mat) is
// ICE's to hold (`core/test/look-at.test.ts`); this file holds that the door reaches it.
import {
  Camera,
  defineQuery,
  type Entity,
  Not,
  Position,
  PrefabId,
  Selected,
  Size,
  Specimen,
  Viewport,
} from "@vibecook/ice";
import * as pane from "@vibefield/plugin-browser-pane";
import { describe, expect, it } from "vitest";
import type { MountedDesk } from "../src/field/desk/desk-door";
import { lookAtObject } from "../src/field/desk/look-at-object";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);
const selectedQ = defineQuery([Selected]);
const VIEW = { w: 1200, h: 800, dpr: 2 };

function board() {
  const registry = buildRegistry({
    generation: -1,
    staged: [],
    bundled: [
      {
        manifest: pane.browserPaneManifest,
        mod: pane.browserPaneRenderer,
        objectBindings: objectBindingsFrom(
          pane,
          pane.browserPaneManifest.contributes?.objects ?? [],
        ),
      },
    ],
  });
  const ce = createFieldEngine(registry);
  ce.docs.create();
  ce.world.setResource(Viewport, VIEW);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  let now = 1000;
  const step = (frames: number): void => {
    for (let i = 0; i < frames; i++) {
      now += 16;
      ce.step(now);
    }
  };
  const entities = (query: typeof objectsQ | typeof selectedQ): Entity[] => {
    const out: Entity[] = [];
    ce.world.query(query).each((batch) => {
      for (const row of batch) out.push(batch.entity(row));
    });
    return out;
  };
  const camera = () => {
    const c = ce.world.getResource(Camera);
    if (c === undefined) throw new Error("no camera");
    return { x: c.x, y: c.y, zoom: c.zoom };
  };
  const desk = { engine: ce } as unknown as MountedDesk;
  return {
    ce,
    desk,
    step,
    camera,
    objects: () => entities(objectsQ),
    selected: () => entities(selectedQ),
  };
}

describe("the look door on a real engine (ICE's ops.lookAt)", () => {
  it("flies the camera to a far pane, centred at the zoom the person is at, and selects it alone", () => {
    const { ce, desk, step, camera, objects, selected } = board();
    // a pane far to the right and below: its rect (4000, 3000) 400 × 200, its centre (4200, 3100)
    ce.ops.spawnWidget(pane.BROWSER_PANE_TYPE, { x: 4000, y: 3000, w: 400, h: 200, props: {} });
    ce.world.sync();
    step(2);
    const [far] = objects();
    if (far === undefined) throw new Error("no pane");
    ce.ops.clearSelection();
    step(1);
    expect(selected()).toEqual([]);
    expect(camera()).toEqual({ x: 0, y: 0, zoom: 1 });

    expect(lookAtObject(desk, far)).toBe(true);
    // 600 frames of 16 ms: far past any flight (ICE's own rows land within a second)
    step(600);

    const c = camera();
    // the zoom the person is at is kept: the pane reads at 100% and fits the view with its pad
    expect(c.zoom).toBe(1);
    // the view's centre in the world is the camera's corner plus half the view over the zoom
    expect(c.x + VIEW.w / (2 * c.zoom)).toBeCloseTo(4200, 6);
    expect(c.y + VIEW.h / (2 * c.zoom)).toBeCloseTo(3100, 6);
    expect(selected()).toEqual([far]);
    ce.dispose();
  });

  it("answers false for an object that is gone, and moves nothing", () => {
    const { ce, desk, step, camera, objects, selected } = board();
    ce.ops.spawnWidget(pane.BROWSER_PANE_TYPE, { x: 4000, y: 3000, w: 400, h: 200, props: {} });
    ce.world.sync();
    step(2);
    const [gone] = objects();
    if (gone === undefined) throw new Error("no pane");
    ce.ops.setSelection([gone]);
    ce.ops.deleteSelection();
    ce.world.sync();
    step(2);
    expect(objects()).toEqual([]);

    expect(lookAtObject(desk, gone)).toBe(false);
    step(30);
    expect(camera()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(selected()).toEqual([]);
    ce.dispose();
  });
});
