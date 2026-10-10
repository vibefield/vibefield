// THE BROWSER PANE IN THE HOST (PT-1, PORTALS) — VibeField's first portal, a PLUGIN's kind (`plugins/browser-pane`,
// through `@vibefield/plugin-sdk/desk`), compiled by the host exactly as the comment pad is: the host reads the export
// its manifest row names (`objectBindingsFrom`), compiles the row's durable half with it through `defineObject`
// (`buildRegistry`), and the desk's catalog finds the kind by its OBJECT, places it on the desk (never in a mini mat —
// it has no chip yet), hangs it on a SHELF under the new `portals` category, and carries its DECLARED halves — the DOM
// half that lends its head's raster, the opening (ICE's pick-up, its held tools the browser's acts since PT-3), its
// DRIVER (PT-3: the hand on the editor), and its MENU: the device switch. Then the switch's whole road on a REAL engine and
// document: Size, Position and the `device` prop re-cut in ONE transaction — and one undo step takes all three back. And
// (PT-3 ruling 9) a page's own navigation, written into its url never as an undo step, survives the undo of the desk's
// edits to the pane: the url is a cell of its own.
import {
  defineQuery,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
  setWidgetProps,
} from "@vibecook/ice";
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

  it("carries its DECLARED halves: a DOM half that lends its head, its driver (the hand — PT-3), its opening, its menu", () => {
    const widget = withPane().allWidgets().get(BROWSER_PANE_TYPE);
    expect(typeof hostOf(widget)?.lend).toBe("function");
    // PT-3: the hand on the desk's one editor — core's drag still carries it
    expect(typeof driversOf(widget)).toBe("function");
    // ICE's pick-up (ruling 2): it opens, its held tools the browser's acts (PT-3), the chords the lease runs bound to them
    expect(widget?.openable).toBe(true);
    expect(widget?.heldTools.map((t) => [t.id, t.kind, t.keys ?? []])).toEqual([
      ["back", "action", ["mod+["]],
      ["forward", "action", ["mod+]"]],
      ["reload", "action", ["mod+r"]],
      ["address", "action", ["mod+l"]],
      ["device", "action", []],
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

  it("a page's own NAVIGATION — the hand's url write, never an undo step — survives the undo of the desk's edits to the pane (its finish, a device switch): the url is a cell of its own (PT-3 ruling 9)", () => {
    const registry = withPane();
    const widget = registry.allWidgets().get(BROWSER_PANE_TYPE);
    if (widget === undefined) throw new Error("the pane is not registered");
    const ce = createFieldEngine(registry);
    ce.docs.create();
    const PAGE = "http://127.0.0.1:4321/page";
    const NEXT = "http://127.0.0.1:4321/next";
    const PEER = "http://127.0.0.1:4321/peer";
    ce.ops.spawnWidget(BROWSER_PANE_TYPE, { x: 0, y: 0, ...pane.PANE_SIZE, props: { url: PAGE } });
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
    const props = (): Record<string, unknown> =>
      Object.assign({}, ...widget.groups.map((g) => ce.world.get(e, g.component) ?? {}));
    const store = ce.docs.current()?.store;
    if (store === undefined) throw new Error("no document");
    // the hand on this engine — its desk state says where the page went of its own (the hand writes it)
    let went = new Map<number, string>();
    const hand = pane.createPaneHand({
      world: ce.world,
      docs: ce.docs,
      local: { addressed: () => went },
      hand: () => undefined,
      isKind: () => true,
    } as never);
    const navigate = (url: string) => {
      went = new Map([[e as number, url]]);
      hand.follow?.(0);
      ce.world.sync();
    };
    expect(props()).toMatchObject({ url: PAGE, finish: "low-iron", device: "laptop" });

    // a desk edit (the finish), then the page goes of its own: ⌘Z takes the finish back — never the page's address
    setWidgetProps(store, ce.world, e, { finish: "float" });
    ce.world.sync();
    navigate(NEXT);
    expect(props()).toMatchObject({ url: NEXT, finish: "float" });
    expect(ce.docs.undo()).toBe(true);
    ce.world.sync();
    expect(props()).toMatchObject({ url: NEXT, finish: "low-iron" });

    // a device switch (one transaction, one undo step), then the page goes of its own again: its undo leaves the url too
    ce.ops.setSelection([e]);
    expect(ce.ops.runMenuAction(pane.deviceActId("phone"))).toBe(true);
    ce.world.sync();
    navigate(PEER);
    expect(props()).toMatchObject({ url: PEER, device: "phone" });
    expect(ce.docs.undo()).toBe(true);
    ce.world.sync();
    expect(props()).toMatchObject({ url: PEER, device: "laptop" });
    // the navigations were never undo steps: nothing left but the spawn's own
    expect(hand.stats().urls).toBe(2);
    ce.dispose();
  });
});
