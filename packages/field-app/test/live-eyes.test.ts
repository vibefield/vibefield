// PT-5b (ruling 3) — THE CAP'S EYES (surfaces/live/live-eyes.ts), on a REAL engine and document: how far a pane lies from the
// view's centre (the camera is the view's top-left corner in the world; the centre is half a viewport on, over the zoom),
// and whether the document still holds the object behind a face's key — `false` once it is deleted (its still is forgotten
// when its page's grace lapses), back to `true` at the undo, `undefined` with no document to say.
import {
  Camera,
  defineQuery,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
  Viewport,
} from "@vibecook/ice";
import * as pane from "@vibefield/plugin-browser-pane";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";
import { createLiveEyes } from "../src/surfaces/live/live-eyes";

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

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
  const spawn = (x: number, y: number): void => {
    ce.ops.spawnWidget(pane.BROWSER_PANE_TYPE, { x, y, w: 400, h: 200, props: {} });
  };
  /** The panes on the board, by their x: each one's entity and durable key. */
  const panes = () => {
    const out: { x: number; entity: number; key: string }[] = [];
    ce.world.query(objectsQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        const key = ce.docs.current()?.store.keyOf(e) as string | undefined;
        if (key !== undefined)
          out.push({ x: ce.world.get(e, Position)?.x ?? 0, entity: e as number, key });
      }
    });
    return out.sort((a, b) => a.x - b.x);
  };
  return { ce, spawn, panes, eyes: createLiveEyes(ce) };
}

describe("PT-5b — the cap's eyes", () => {
  it("FAR: from the pane's centre to the view's — the view's centre is the camera plus half the viewport over the zoom", () => {
    const { ce, spawn, panes, eyes } = board();
    spawn(0, 0);
    spawn(1000, 0);
    ce.world.sync();
    const [near, far] = panes();
    if (near === undefined || far === undefined) throw new Error("no panes");
    // a 1200 × 800 view at zoom 1 with its corner at the origin: its centre is (600, 400)
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 2 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    // the panes' centres: (200, 100) and (1200, 100)
    expect(eyes.far(near.key)).toBeCloseTo(Math.hypot(400, 300), 6);
    expect(eyes.far(far.key)).toBeCloseTo(Math.hypot(600, 300), 6);
    // zoomed in ×2 the view is half as wide in the world: its centre (300, 200)
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 2, gesturing: false });
    expect(eyes.far(near.key)).toBeCloseTo(Math.hypot(100, 100), 6);
    // panned to the far pane: it is the nearer now
    ce.world.setResource(Camera, { x: 900, y: -100, zoom: 2, gesturing: false });
    expect(eyes.far(far.key)).toBeCloseTo(0, 6);
    expect(eyes.far(far.key)).toBeLessThan(eyes.far(near.key));
    // a key the document does not hold lies nowhere
    expect(eyes.far("no-such-key")).toBe(Number.POSITIVE_INFINITY);
    ce.dispose();
  });

  it("EXISTS: true while the document holds the object; false once it is deleted; true again at the undo; undefined with no document open", () => {
    const { ce, spawn, panes, eyes } = board();
    spawn(0, 0);
    ce.world.sync();
    const [only] = panes();
    if (only === undefined) throw new Error("no pane");
    expect(eyes.exists(only.key)).toBe(true);
    expect(eyes.exists("no-such-key")).toBe(false);
    ce.ops.setSelection([only.entity as never]);
    ce.ops.deleteSelection();
    ce.world.sync();
    expect(eyes.exists(only.key)).toBe(false);
    expect(ce.docs.undo()).toBe(true);
    ce.world.sync();
    expect(eyes.exists(only.key)).toBe(true);
    ce.docs.close();
    expect(eyes.exists(only.key)).toBeUndefined();
    expect(eyes.far(only.key)).toBe(Number.POSITIVE_INFINITY);
    ce.dispose();
  });
});
