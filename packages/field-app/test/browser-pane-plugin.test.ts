// THE BROWSER PANE IN THE HOST (PT-1, PORTALS) — VibeField's first portal, a PLUGIN's kind (`plugins/browser-pane`,
// through `@vibefield/plugin-sdk/desk`), compiled by the host exactly as the comment pad is: the host reads the export
// its manifest row names (`objectBindingsFrom`), compiles the row's durable half with it through `defineObject`
// (`buildRegistry`), and the desk's catalog finds the kind by its OBJECT, places it on the desk (never in a mini mat —
// it has no chip yet), hangs it on a SHELF under the new `portals` category, and carries its DECLARED halves — the DOM
// half that lends its head's raster, the opening (ICE's pick-up, its held tools declared only), and its MENU: the device
// switch. Then the switch's whole road on a REAL engine and document: Size, Position and the `device` prop re-cut in ONE
// transaction — and one undo step takes all three back.
import { defineQuery, Not, Position, PrefabId, Size, Specimen } from "@vibecook/ice";
import { CONTAINABLE, DESK_OBJECT, driversOf, hostOf, objectKindOf } from "@vibecook/ice/desk";
import * as pane from "@vibefield/plugin-browser-pane";
import { describe, expect, it } from "vitest";
import { buildDevRegistry, buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

const { BROWSER_PANE_CATEGORY, BROWSER_PANE_TYPE, browserPaneManifest } = pane;
const rows = browserPaneManifest.contributes?.objects ?? [];

/** The registry a dev run builds with the pane's plugin ON: the host's own reading of its module. */
const withPane = () =>
  buildRegistry({
    generation: -1,
    staged: [],
    bundled: [
      {
        manifest: browserPaneManifest,
        mod: pane.browserPaneRenderer,
        objectBindings: objectBindingsFrom(pane, rows),
      },
    ],
  });

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

describe("the host compiles VibeField's browser pane as ICE compiles a built-in (K-L2)", () => {
  it("reads the export the row names, and the desk finds the kind by its OBJECT — things, a laptop's page in size, its floor the smallest viewport", () => {
    const widget = withPane().allWidgets().get(BROWSER_PANE_TYPE);
    expect(objectKindOf(widget)).toBe(pane.browserPane.kind);
    expect(widget?.stratum).toBe("things");
    expect(widget?.defaultSize).toEqual(pane.PANE_SIZE);
    expect(widget?.minSize).toEqual(pane.PANE_MIN_SIZE);
  });

  it("hangs it on a SHELF under the new `portals` category and lays it on the desk — never into a mini mat (no chip yet)", () => {
    const widget = withPane().allWidgets().get(BROWSER_PANE_TYPE);
    expect(widget?.tray).toMatchObject({
      label: "Browser",
      category: BROWSER_PANE_CATEGORY,
      hang: { accessory: "shelf" },
      local: true,
    });
    expect(widget?.provides).toEqual([BROWSER_PANE_TYPE, DESK_OBJECT]);
    expect(widget?.provides).not.toContain(CONTAINABLE);
    const ce = createFieldEngine(withPane());
    expect(ce.catalog.placementFor(ce.catalog.rootCanvas.id).has(BROWSER_PANE_TYPE)).toBe(true);
    ce.dispose();
  });

  it("is a PRODUCT plugin: a dev run with no staged artifact registers it from the dev-bundled set, its kind bound", async () => {
    const widget = (await buildDevRegistry()).allWidgets().get(BROWSER_PANE_TYPE);
    expect(objectKindOf(widget)).toBe(pane.browserPane.kind);
  });

  it("carries its DECLARED halves: a DOM half that lends its head (no driver — core's drag carries it), its opening, its menu", () => {
    const widget = withPane().allWidgets().get(BROWSER_PANE_TYPE);
    expect(typeof hostOf(widget)?.lend).toBe("function");
    expect(driversOf(widget)).toBeUndefined();
    // ICE's pick-up (ruling 2): it opens, its held tools declared ONLY (no kind — dim, never run, until PT-3)
    expect(widget?.openable).toBe(true);
    expect(widget?.heldTools.map((t) => [t.id, t.kind])).toEqual([
      ["back", undefined],
      ["forward", undefined],
      ["reload", undefined],
      ["address", undefined],
      ["device", undefined],
    ]);
    // the device switch on the selection menu
    expect(widget?.menu.map((a) => a.label)).toEqual(["Laptop", "Desktop", "iPad", "iPhone"]);
    // its interaction: carried by core's drag, resized by core's handles (they write Size — the viewport follows)
    const ce = createFieldEngine(withPane());
    ce.docs.create();
    const e = ce.ops.spawnWidget(BROWSER_PANE_TYPE, { x: 0, y: 0, ...pane.PANE_SIZE, props: {} });
    ce.world.sync();
    expect(ce.world.isAlive(e)).toBe(true);
    ce.dispose();
  });

  it("SWITCHES DEVICE on a real document: Size, Position and the device re-cut in ONE transaction, the centre kept — one undo takes all three back", () => {
    const registry = withPane();
    const widget = registry.allWidgets().get(BROWSER_PANE_TYPE);
    if (widget === undefined) throw new Error("the pane is not registered");
    const ce = createFieldEngine(registry);
    ce.docs.create();
    const at = { x: 40, y: -20 };
    ce.ops.spawnWidget(BROWSER_PANE_TYPE, { ...at, ...pane.PANE_SIZE, props: {} });
    ce.world.sync();
    let paneEntity: number | undefined;
    ce.world.query(objectsQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        if (ce.world.get(e, PrefabId)?.id === BROWSER_PANE_TYPE) paneEntity = e as number;
      }
    });
    if (paneEntity === undefined) throw new Error("no pane was laid");
    const e = paneEntity as never;
    const cell = widget.groups.find((g) => g.name === "props")?.component;
    if (cell === undefined) throw new Error("no props cell");
    const device = () => (ce.world.get(e, cell) as { device?: string } | undefined)?.device;
    const size = () => ce.world.get(e, Size);
    const pos = () => ce.world.get(e, Position);
    const before = { size: size(), pos: pos(), device: device() };
    expect(before.device).toBe("laptop");
    const centre = { x: at.x + pane.PANE_SIZE.w / 2, y: at.y + pane.PANE_SIZE.h / 2 };

    ce.ops.setSelection([e]);
    expect(ce.ops.runMenuAction(pane.deviceActId("phone"))).toBe(true);
    ce.world.sync();
    const phone = pane.deviceById("phone");
    if (phone === undefined) throw new Error("phone");
    const cut = pane.cutOf(phone);
    expect(device()).toBe("phone");
    expect(size()?.w).toBeCloseTo(cut.w, 3);
    expect(size()?.h).toBeCloseTo(cut.h, 3);
    expect((pos()?.x ?? 0) + (size()?.w ?? 0) / 2).toBeCloseTo(centre.x, 3);
    expect((pos()?.y ?? 0) + (size()?.h ?? 0) / 2).toBeCloseTo(centre.y, 3);
    // the size the document now holds cuts the phone's own viewport at the phone's density
    expect(pane.viewportOf(size() ?? { w: 0, h: 0 }, phone)).toEqual([402, 874]);

    // ONE undo step: all three come back together — never a device without its size
    expect(ce.docs.undo()).toBe(true);
    ce.world.sync();
    expect(device()).toBe("laptop");
    expect(size()?.w).toBeCloseTo(before.size?.w ?? 0, 3);
    expect(size()?.h).toBeCloseTo(before.size?.h ?? 0, 3);
    expect(pos()?.x).toBeCloseTo(before.pos?.x ?? 0, 3);
    expect(pos()?.y).toBeCloseTo(before.pos?.y ?? 0, 3);
    ce.dispose();
  });
});
