// THE PARITY WITNESS, headless (DK-6; ICE design-016 K-L2): ICE's desk clock — a PLUGIN's kind
// (`examples/plugins/desk-clock`, through `@vibefield/plugin-sdk/desk` alone) — compiled by VibeField's
// host exactly as ICE compiles a built-in: the host reads the plugin's export by its manifest row's name
// (`objectBindingsFrom`), compiles the row's durable half with it through `defineObject`
// (`buildRegistry`), and the desk's catalog finds the kind by its OBJECT, places it, hangs it, opens it
// and menus it — the rows ICE's own clock test holds its compiled object to. And the first-run seed
// lays it beside the six while its plugin is on — the census the canvas smoke reads — never while off.
import { defineQuery, Not, Position, PrefabId, Size, Specimen } from "@vibecook/ice";
import { CONTAINABLE, DESK_OBJECT, objectKindOf } from "@vibecook/ice/desk";
import * as deskClock from "@vibefield/plugin-example-desk-clock";
import { describe, expect, it } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskCensus } from "../src/field/desk/desk-door";
import { SEED_CLOCK, SEED_TYPES } from "../src/field/desk/desk-seed";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

const { CLOCK_SECONDS_ACT, CLOCK_TYPE, deskClockManifest } = deskClock;
const rows = deskClockManifest.contributes?.objects ?? [];

/** The registry a dev run builds with the clock's plugin ON: the host's own reading of its module. */
const withClock = () =>
  buildRegistry({
    generation: -1,
    staged: [],
    bundled: [
      {
        manifest: deskClockManifest,
        mod: deskClock.deskClockRenderer,
        objectBindings: objectBindingsFrom(deskClock, rows),
      },
    ],
  });

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

describe("the host compiles the example plugin's clock as ICE compiles a built-in (K-L2)", () => {
  it("reads the export the row names, and the desk finds the kind by its OBJECT", () => {
    expect(SEED_CLOCK.type).toBe(CLOCK_TYPE); // the seed names the plugin's type, never imports it
    const clock = withClock().allWidgets().get(CLOCK_TYPE);
    expect(objectKindOf(clock)).toBe(deskClock.clock.kind);
    expect(clock?.stratum).toBe("things");
    expect(clock?.defaultSize).toEqual({ w: 150, h: 150 });
  });

  it("hangs it on the pegboard by its entry, lays it on the desk and lets it into a mini mat by what it provides", () => {
    const clock = withClock().allWidgets().get(CLOCK_TYPE);
    expect(clock?.tray).toMatchObject({
      label: "Clock",
      category: "things",
      hang: { accessory: "hook" },
    });
    expect(clock?.provides).toEqual(expect.arrayContaining([CLOCK_TYPE, DESK_OBJECT, CONTAINABLE]));
    const ce = createFieldEngine(withClock());
    expect(ce.catalog.placementFor(ce.catalog.rootCanvas.id).has(CLOCK_TYPE)).toBe(true);
    ce.dispose();
  });

  it("its menu act and its held tools are the binding's, each with its own glyph; it opens", () => {
    const clock = withClock().allWidgets().get(CLOCK_TYPE);
    expect(clock?.menu.map((a) => a.id)).toEqual([CLOCK_SECONDS_ACT]);
    expect(clock?.menu[0]?.glyph).toEqual({ path: deskClock.SECONDS_GLYPH });
    expect(clock?.openable).toBe(true);
    expect(clock?.heldTools.map((t) => t.id)).toEqual([
      "seconds",
      "ring24",
      "zone-back",
      "zone-ahead",
      "dial",
    ]);
  });
});

describe("the first-run seed lays the clock while its plugin is on", () => {
  it("beside the six, at the showcase's centre, a minute clock — the census the smoke reads", async () => {
    const ce = createFieldEngine(withClock());
    const session = ce.docs.create();
    await seedField(ce, session, createDeskBlobStore());
    expect(deskCensus(ce)).toEqual({
      ...Object.fromEntries(SEED_TYPES.map((type) => [type, 1])),
      [CLOCK_TYPE]: 1,
    });
    let found: { x: number; y: number; w: number; h: number; props: unknown } | undefined;
    const group = ce.catalog.widget(CLOCK_TYPE)?.groups.find((g) => g.name === "props");
    ce.world.query(objectsQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        if (ce.world.get(e, PrefabId)?.id !== CLOCK_TYPE) continue;
        const at = ce.world.get(e, Position);
        const size = ce.world.get(e, Size);
        found = {
          x: at?.x ?? Number.NaN,
          y: at?.y ?? Number.NaN,
          w: size?.w ?? Number.NaN,
          h: size?.h ?? Number.NaN,
          props: group === undefined ? undefined : ce.world.get(e, group.component),
        };
      }
    });
    expect(found).toMatchObject({ x: 520 - 75, y: 380 - 75, w: 150, h: 150 });
    expect(found?.props).toMatchObject({ seconds: false, style: "classic", zone: "local" });
    ce.dispose();
  });

  it("…and with its plugin off the first board is the six, the clock passed by", async () => {
    const ce = createFieldEngine(buildRegistry({ generation: -1, staged: [], bundled: [] }));
    const session = ce.docs.create();
    await seedField(ce, session, createDeskBlobStore());
    expect(deskCensus(ce)).toEqual(Object.fromEntries(SEED_TYPES.map((type) => [type, 1])));
    ce.dispose();
  });
});
