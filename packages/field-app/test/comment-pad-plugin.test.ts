// THE COMMENT PAD IN THE HOST (DK-8, DK-D14) — VibeField's own kind, a PLUGIN's (`plugins/comment-pad`, through
// `@vibefield/plugin-sdk/desk` alone), compiled by the host exactly as ICE compiles a built-in: the host reads the
// export its manifest row names (`objectBindingsFrom`), compiles the row's durable half with it through
// `defineObject` (`buildRegistry`), and the desk's catalog finds the kind by its OBJECT, places it, hangs it under
// its own category, and carries its DECLARED halves — its driver and its sheet (the text part the desk lends its
// one editor). Then the whole road a line of text takes, on a REAL engine and document: the sheet the compiled
// object declares, its driver the one it declares, a session drafted and committed as ONE transaction through the
// document's writer's gate — and one undo step takes the line back.
import { defineQuery, Not, Position, PrefabId, Size, Specimen } from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  driversOf,
  type EditorLease,
  hostOf,
  type ObjectDomHost,
  objectKindOf,
} from "@vibecook/ice/desk";
import * as pad from "@vibefield/plugin-comment-pad";
import { describe, expect, it } from "vitest";
import { buildDevRegistry, buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

const { COMMENT_PAD_CATEGORY, COMMENT_PAD_PART, COMMENT_PAD_TYPE, commentPadManifest } = pad;
const rows = commentPadManifest.contributes?.objects ?? [];

/** The registry a dev run builds with the pad's plugin ON: the host's own reading of its module. */
const withPad = () =>
  buildRegistry({
    generation: -1,
    staged: [],
    bundled: [
      {
        manifest: commentPadManifest,
        mod: pad.commentPadRenderer,
        objectBindings: objectBindingsFrom(pad, rows),
      },
    ],
  });

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

describe("the host compiles VibeField's comment pad as ICE compiles a built-in (K-L2)", () => {
  it("reads the export the row names, and the desk finds the kind by its OBJECT", () => {
    const widget = withPad().allWidgets().get(COMMENT_PAD_TYPE);
    expect(objectKindOf(widget)).toBe(pad.commentPad.kind);
    expect(widget?.stratum).toBe("things");
    expect(widget?.defaultSize).toEqual({ w: 220, h: 280 });
  });

  it("hangs it under its OWN category, lays it on the desk and lets it into a mini mat by what it provides", () => {
    const widget = withPad().allWidgets().get(COMMENT_PAD_TYPE);
    expect(widget?.tray).toMatchObject({
      label: "Comment pad",
      category: COMMENT_PAD_CATEGORY,
      hang: { w: 110, h: 140, accessory: "hook" },
    });
    expect(widget?.provides).toEqual([COMMENT_PAD_TYPE, DESK_OBJECT, CONTAINABLE]);
    const ce = createFieldEngine(withPad());
    expect(ce.catalog.placementFor(ce.catalog.rootCanvas.id).has(COMMENT_PAD_TYPE)).toBe(true);
    ce.dispose();
  });

  it("is a PRODUCT plugin: a dev run with no staged artifact registers it from the dev-bundled set, its kind bound", async () => {
    const widget = (await buildDevRegistry()).allWidgets().get(COMMENT_PAD_TYPE);
    expect(objectKindOf(widget)).toBe(pad.commentPad.kind);
  });

  it("compiles its writing as ONE cell (`ink`: the text and its seeds) and carries its DECLARED halves: its driver and its sheet", () => {
    const widget = withPad().allWidgets().get(COMMENT_PAD_TYPE);
    const ink = widget?.groups.find((g) => g.name === "ink");
    expect(Object.keys(ink?.fields ?? {}).sort()).toEqual(["seeds", "text"]);
    expect(driversOf(widget)).toBe(pad.padDriver);
    expect(typeof hostOf(widget)?.text).toBe("function");
    expect(widget?.openable).toBe(false); // a pad is written in place, never picked up to be set
  });

  it("takes a LINE OF TEXT on a real document: its declared sheet leases the editor, the session lands as ONE transaction, and one undo takes it back", () => {
    const registry = withPad();
    const widget = registry.allWidgets().get(COMMENT_PAD_TYPE);
    if (widget === undefined) throw new Error("the pad is not registered");
    const ce = createFieldEngine(registry);
    ce.docs.create();
    ce.ops.spawnWidget(COMMENT_PAD_TYPE, { x: 0, y: 0, w: 220, h: 280, props: {} });
    ce.world.sync();
    let padEntity: number | undefined;
    ce.world.query(objectsQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        if (ce.world.get(e, PrefabId)?.id === COMMENT_PAD_TYPE) padEntity = e as number;
      }
    });
    if (padEntity === undefined) throw new Error("no pad was laid");
    const e = padEntity as never;
    const isPad = (x: unknown) => ce.world.get(x as never, PrefabId)?.id === COMMENT_PAD_TYPE;
    // the desk's road: the driver the object DECLARES, made on the kind host; the sheet its DOM half DECLARES
    const driver = driversOf(widget)?.({
      world: ce.world,
      docs: ce.docs,
      local: undefined,
      look: () => undefined,
      isKind: isPad,
      kind: () => undefined,
      provides: () => undefined,
      geometryOf: () => undefined,
      heldToWorld: () => undefined,
      hand: () => undefined,
      refused: () => {},
      wake: () => {},
    } as never);
    let lent: EditorLease | undefined;
    const editor = {
      element: { selectionStart: 0, value: "" },
      lend: (lease: EditorLease) => {
        lent = lease;
      },
      release: () => {
        const l = lent;
        lent = undefined;
        l?.ended();
      },
      lease: () => lent,
      blur: () => {},
      follow: () => {},
      placement: () => null,
      dispose: () => {},
    };
    const parts = hostOf(widget)?.text?.({
      container: {},
      world: ce.world,
      docs: ce.docs,
      use: () => undefined,
      editor,
      object: widget,
      driver,
      look: () => undefined,
      geometryOf: () => undefined,
      hand: () => undefined,
      heldToWorld: () => undefined,
      wake: () => {},
    } as unknown as ObjectDomHost);
    const sheet = parts?.[0] as pad.PadSheet | undefined;
    expect(sheet?.part).toBe(COMMENT_PAD_PART);
    expect(sheet?.focus(e)).toBe(true);
    const lease = lent;
    if (lease === undefined) throw new Error("the sheet took no lease");
    const inkCell = widget.groups.find((g) => g.name === "ink")?.component;
    if (inkCell === undefined) throw new Error("no ink cell");
    const text = () => (ce.world.get(e, inkCell) as { text: string } | undefined)?.text;
    expect(lease.value()).toBe("");
    for (const typed of ["a", "a l", "a line of text"]) lease.input(typed);
    expect(text()).toBe(""); // the document has not moved — the session's draft is the pad's own
    lease.idle(); // the session's end: ONE transaction
    expect(text()).toBe("a line of text");
    expect(lease.value()).toBe("a line of text");
    expect(ce.docs.undo()).toBe(true); // one undo step takes the whole line back, never a keystroke
    ce.world.sync(); // the undo's batch projected into the world (ICE's own typing rows do the same)
    expect(text()).toBe("");
    ce.dispose();
  });
});
