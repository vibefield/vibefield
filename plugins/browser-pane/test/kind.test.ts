// THE PANE'S KIND, judged by the SDK's KIND-CONFORMANCE HARNESS (`@vibefield/plugin-sdk/testing` — the one `pnpm
// playground` and `vibefield-plugin check` run, no GPU and no DOM) WITH THE PRODUCT'S PALETTE (DK-8 §5a): its
// declaration, its program on a recording device (four pipelines over one module — the pane and its light, each lit from
// elsewhere too — and a page's mip pipeline, every bind group filling its layout), every playground state in every mode
// it declares (idle, selected, held, open — it opens: ICE's pick-up) at every zoom, its dispose. Then what the harness
// cannot know: its slab is what is picked (never a part at rest), its marks go round the slab as its eye sees it, a held
// pane is higher and bigger, its rung is its head's band, its page is the sample's still or the dark film, its head is
// the service's raster or the committed one its key names, its opening is the page and the head, read by its address.
import {
  DEFAULT_GRID,
  defineObject,
  type Entity,
  isObjectKind,
  kindPalette,
  lampOf,
  type ObjectContext,
  objectKindOf,
} from "@vibefield/plugin-sdk/desk";
import { type KindReport, productPalette, runKindConformance } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import states from "../playground/states";
import {
  bandFor,
  browserPane,
  browserPaneKind,
  browserPaneManifest,
  cutOf,
  deviceById,
  faceOfPage,
  HEAD_RASTER,
  type HeadBitmap,
  type HeadRaster,
  PANE_SIZE,
  PANE_TOOLS,
  type PaneGeometry,
  type PaneInstance,
  type PaneLookValues,
  PROMPT,
  pagePlan,
  paneLook,
  pointAt,
  rungFor,
  SAMPLE_URL,
  schemeOf,
  seen,
  shapeOf,
  silhouetteOf,
  stillSplit,
} from "../src";
import { createPaneLocal } from "../src/local";

const row = browserPaneManifest.contributes?.objects?.[0];
const refusals = (r: KindReport) =>
  r.verdicts.filter((v) => v.status === "refused").map((v) => v.code);
const fixtures = (states as Record<string, Record<string, Record<string, unknown>>>)[
  "vibefield.browser-pane"
];

describe("the browser pane's kind, judged by the kind-conformance harness WITH the product's palette", () => {
  it("passes: its declaration, its program, every playground state in every mode and zoom, its dispose", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const r = await runKindConformance({
      binding: browserPane,
      row,
      at: "/contributes/objects/0",
      states: fixtures,
      palette: productPalette,
    });
    expect(refusals(r)).toEqual([]);
    // it OPENS (ICE's pick-up), and goes into no mini mat (it provides no CONTAINABLE: no chip yet)
    expect(r.plan.modes).toEqual(["idle", "selected", "held", "open"]);
    expect(r.plan.fixtures).toEqual(["default", "smoke", "bronze", "blank", "live"]);
    expect(r.states).toBe(5 * (4 * r.plan.zooms.length + 1));
    // its declaration, its program (READ: the not-compiled note), each fixture driven, its dispose
    expect(r.verdicts.map((v) => v.code)).toEqual([
      "ok",
      "ok",
      "object-wgsl-not-compiled",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    // the program: the pane and its light, and their lit-from-elsewhere twins (a page's mip pipeline is made with its first page)
    const program = r.verdicts.find((v) => v.subject === "program" && v.code === "ok");
    expect(program?.detail).toContain("vertex vs + fragment fs + fragment fs_light");
    expect(program?.detail).toMatch(/4 pipeline\(s\)/);
  });

  it("passes under the harness's two-role default too: the pane reads the host's selection alone, every other colour its own", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const r = await runKindConformance({ binding: browserPane, row, states: fixtures });
    expect(refusals(r)).toEqual([]);
  });

  it("the host's compile takes it: a desk kind named by its type, things, its opening, its menu", () => {
    const kind = browserPane.kind;
    expect(isObjectKind(kind)).toBe(true);
    expect(kind.name).toBe(row?.type);
    expect(kind.stratum).toBe("things");
    expect(kind.open?.pose).toBe("camera");
    const type = defineObject({
      type: "test.browser-pane-compile",
      kind: browserPaneKind(),
      size: PANE_SIZE,
      ...(browserPane.menu !== undefined ? { menu: browserPane.menu } : {}),
    });
    expect(objectKindOf(type)?.name).toBe("vibefield.browser-pane");
    expect(type.openable).toBe(true);
    expect(type.heldTools.map((t) => t.id)).toEqual([
      "back",
      "forward",
      "reload",
      "address",
      "device",
    ]);
    expect(type.menu.map((a) => a.label)).toEqual(["Laptop", "Desktop", "iPad", "iPhone"]);
  });
});

const lamp = lampOf(DEFAULT_GRID.mat.plane);
const look = paneLook(productPalette.light);
const theme = { name: "light" } as ObjectContext["theme"];
const ctxOf = (props: Record<string, unknown>, extra: Partial<ObjectContext> = {}): ObjectContext =>
  ({
    entity: 1 as Entity,
    rect: { cx: 100, cy: 80, w: PANE_SIZE.w, h: PANE_SIZE.h },
    props,
    flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
    look,
    theme,
    lamp,
    view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 },
    grid: DEFAULT_GRID,
    dt: 0,
    ...extra,
  }) as ObjectContext;

describe("the browser pane's world half", () => {
  const k = browserPaneKind();

  it("is PICKED BY ITS SLAB as drawn — `content` everywhere on it at rest (a drag on its head moves it), past its silhouette nothing", () => {
    const G = k.resolve(ctxOf({})) as PaneGeometry;
    const S = G.shape;
    expect(k.hit(G, 100, 80)).toBe("content");
    // the head (the address capsule), the page, the clear border: the pane itself, never a part at rest
    expect(k.hit(G, 100, 80 - S.half[1] + 12)).toBe("content");
    expect(k.hit(G, 100 + S.half[0] - 4, 80)).toBe("content");
    const s = silhouetteOf(G);
    expect(k.hit(G, s.cx + s.hx + 0.5, s.cy)).toBeNull();
    expect(k.hit(G, s.cx, s.cy - s.hy - 0.5)).toBeNull();
  });

  it("its marks go round the silhouette its own eye sees — a hair past its rect — and a HELD pane is higher and bigger", () => {
    const G = k.resolve(ctxOf({})) as PaneGeometry;
    const frame = k.frame?.(G);
    expect(frame?.cx).toBe(100);
    expect(frame?.cy).toBe(80);
    expect(frame?.angle).toBe(0);
    expect(frame?.hx).toBeGreaterThan(PANE_SIZE.w / 2);
    expect(frame?.hx).toBeLessThan(PANE_SIZE.w / 2 + 4); // the eye's parallax at rest: ~1 %
    const held = k.resolve(
      ctxOf({}, { flux: { lift: 1, hover: 1, ring: 0, fade: 1 } }),
    ) as PaneGeometry;
    expect(held.centre[2]).toBeGreaterThan(G.centre[2]);
    expect(k.frame?.(held).hx ?? 0).toBeGreaterThan(frame?.hx ?? 0);
  });

  it("is cut by its device: a phone's cut reads a phone's viewport, and a laptop's size switched to the phone's density reads that", () => {
    const phone = deviceById("phone");
    if (phone === undefined) throw new Error("phone");
    const cut = cutOf(phone);
    const G = k.resolve(
      ctxOf({ device: "phone" }, { rect: { cx: 0, cy: 0, w: cut.w, h: cut.h } }),
    ) as PaneGeometry;
    expect(G.shape.viewport).toEqual([402, 874]);
    const wide = k.resolve(ctxOf({ device: "phone" })) as PaneGeometry;
    expect(wide.shape.viewport[0]).toBeGreaterThan(1500);
    // an unknown device is the laptop
    expect((k.resolve(ctxOf({ device: "toaster" })) as PaneGeometry).shape.viewport).toEqual([
      1280, 800,
    ]);
  });

  it("its PAGE is the sample's still in the page's scheme — the desk's by default — or nothing for an address it cannot show yet", () => {
    const G = k.resolve(ctxOf({})) as PaneGeometry;
    const R = k.record(G, ctxOf({})) as PaneInstance;
    expect(R.page?.viewport).toEqual([1280, 800]);
    expect(R.page?.scheme).toBe("light");
    expect([R.page?.width, R.page?.height]).toEqual([1280, 800]);
    expect(schemeOf({}, "dark")).toBe("dark");
    expect(schemeOf({ scheme: "light" }, "dark")).toBe("light");
    expect(schemeOf({ scheme: "dark" }, "light")).toBe("dark");
    const night = k.record(
      G,
      ctxOf({}, { theme: { name: "dark" } as ObjectContext["theme"] }),
    ) as PaneInstance;
    expect(night.page?.scheme).toBe("dark");
    expect(night.page?.key).not.toBe(R.page?.key);
    const blank = k.record(G, ctxOf({ url: "https://example.com/" })) as PaneInstance;
    expect(blank.page).toBeNull();
    expect(pagePlan(SAMPLE_URL, G.shape, "light")?.key).toBe(R.page?.key);
  });

  it("its HEAD is the lent service's raster, keyed by what it says and its band — or, none lent, the committed raster its key names", () => {
    const G = k.resolve(ctxOf({})) as PaneGeometry;
    // no service (a Node still): the default pane's committed head
    const bare = k.record(G, ctxOf({})) as PaneInstance;
    expect(bare.head.bitmap).toBeUndefined();
    expect(bare.head.still).toBe(bare.head.key);
    expect(bare.head.split).toEqual(stillSplit(bare.head.key));
    // an address nothing committed says: no engraving rather than another's words
    const other = k.record(G, ctxOf({ url: "https://example.com/" })) as PaneInstance;
    expect(other.head.still).toBeUndefined();
    expect(other.head.split).toBeUndefined();
    // a service lent: its raster, drawn once per key — the same key (a pan, a zoom within the rung) draws nothing new
    const asked: string[] = [];
    const raster: HeadRaster = {
      raster(_S, st, tpu) {
        asked.push(`${st.display}|${st.viewport.join("x")}|${tpu}`);
        const bm: HeadBitmap = {
          bytes: new Uint8Array(8 * 6 * 4),
          width: 8,
          height: 6,
          h: 2,
          at: 4,
        };
        return bm;
      },
    };
    const local = createPaneLocal({
      pass: () => undefined,
      use: <T>(key: { name: string }) =>
        key.name === HEAD_RASTER.name ? (raster as T) : undefined,
    });
    const lent = k.record(G, ctxOf({}, { local })) as PaneInstance;
    expect(lent.head.bitmap?.width).toBe(8);
    expect(lent.head.split).toEqual({ height: 6, h: 2, at: 4 });
    k.record(
      G,
      ctxOf(
        {},
        { local, view: { camX: 900, camY: -300, zoom: 0.8, width: 1200, height: 800, dpr: 2 } },
      ),
    );
    expect(asked).toEqual(["lumen.example|1280x800|2"]);
    // a zoom past the rung draws the head again, at the next band
    k.record(
      G,
      ctxOf({}, { local, view: { camX: 0, camY: 0, zoom: 2, width: 1200, height: 800, dpr: 2 } }),
    );
    expect(asked).toEqual(["lumen.example|1280x800|2", "lumen.example|1280x800|4"]);
    // the local's witness says what the head says now (the smoke reads it through the desk door): its readout follows the size
    expect(local.said(1 as Entity)?.viewport).toEqual([1280, 800]);
    const wider = { cx: 100, cy: 80, w: PANE_SIZE.w + 52.494, h: PANE_SIZE.h };
    k.record(k.resolve(ctxOf({}, { rect: wider })), ctxOf({}, { local, rect: wider }));
    expect(local.said(1 as Entity)?.viewport).toEqual([1380, 800]);
    local.forget?.(1 as Entity);
    expect(local.said(1 as Entity)).toBeUndefined();
  });

  it("its RUNG is its head's band: the record is remade at a half-octave of the screen's density, never within one", () => {
    const rung = (zoom: number, dpr = 2) =>
      k.rung?.({
        entity: 1 as Entity,
        rect: ctxOf({}).rect,
        props: {},
        zoom,
        dpr,
        local: undefined,
        px: 0,
      });
    expect(rung(1)).toBe(2); // 2 texels a world unit at zoom 1, dpr 2
    expect(rung(0.75)).toBe(rung(0.9));
    expect(rung(1.5)).toBe(4); // 3 → the band 2√2… 4: the next half-octave up
    expect(rung(0.01)).toBe(rungFor(0.02));
    expect(bandFor(0.02)).toBe(0.5); // the coarsest band
    expect(rung(40)).toBe(6); // the finest band, 8
  });

  it("OPENS as ICE's pick-up: its extent is the page and the head, its word the address as printed, its tools the browser's acts (PT-3)", () => {
    const open = k.open;
    if (open === undefined) throw new Error("the pane does not open");
    const rect = { cx: 100, cy: 80, w: PANE_SIZE.w, h: PANE_SIZE.h };
    const S = shapeOf(rect);
    const e = open.extent({ rect, props: {} });
    expect(e.w).toBeCloseTo(2 * S.page[2], 9);
    expect(e.h).toBeCloseTo(S.page[1] + S.page[3] + S.half[1], 9);
    expect(e.cx).toBe(100);
    // the extent's top is the pane's top: the head is read too
    expect(e.cy - e.h / 2).toBeCloseTo(80 - S.half[1], 9);
    const word = (props: Record<string, unknown>) =>
      typeof open.readout === "function"
        ? open.readout({
            world: undefined as never,
            entity: 1 as Entity,
            props: () => props,
            local: undefined,
          })
        : open.readout;
    expect(word({})).toBe("lumen.example");
    expect(word({ url: "about:blank" })).toBe(PROMPT);
    // PT-3 works them: each an ACTION with its op; the browser's chords on back, forward, reload and the address, none on the device
    for (const t of PANE_TOOLS) {
      expect(t.kind, t.id).toBe("action");
      expect(typeof t.run, t.id).toBe("function");
    }
    expect(Object.fromEntries(PANE_TOOLS.map((t) => [t.id, t.keys ?? []]))).toEqual({
      back: ["mod+["],
      forward: ["mod+]"],
      reload: ["mod+r"],
      address: ["mod+l"],
      device: [],
    });
  });

  it("dresses its glass from its props (an unknown finish is low-iron), its loading line the host's selection", () => {
    const L = k.theme?.(kindPalette(productPalette.light), "light") as PaneLookValues;
    const smoke = k.record(
      k.resolve(ctxOf({})),
      ctxOf({ finish: "smoke" }, { look: L }),
    ) as PaneInstance;
    expect(smoke.finish).toEqual(L.finishes.smoke);
    const odd = k.record(
      k.resolve(ctxOf({})),
      ctxOf({ finish: "stained" }, { look: L }),
    ) as PaneInstance;
    expect(odd.finish).toEqual(L.finishes["low-iron"]);
    expect(smoke.loading).toBe(-1);
    expect(L.progress).toEqual(look.progress);
  });
});

describe("PT-3 — the pane in use (its kind)", () => {
  const k = browserPaneKind();
  const HELD = { e: 1, open: true, grow: 1, snap: true } as unknown as NonNullable<
    ObjectContext["held"]
  >;

  it("at rest every point of it is the pane; IN HAND its page and its head's controls are named parts (ruling 2)", () => {
    const rest = k.resolve(ctxOf({})) as PaneGeometry;
    const held = k.resolve(ctxOf({}, { held: HELD })) as PaneGeometry;
    const mid = (G: PaneGeometry) => seen(G.eye, pointAt(G, ...faceOfPage(G.shape, 640, 400)));
    expect(k.hit(rest, ...mid(rest))).toBe("content");
    expect(k.hit(held, ...mid(held))).toBe("page");
    // nothing past its silhouette, held or not
    expect(k.hit(held, 100 + held.shape.half[0] + 40, 80)).toBeNull();
  });

  it("its opening takes the WHEEL (the page's) and leaves ESC the desk's; its CURSOR is the page's over the page and a lit control's over the head", () => {
    const open = k.open;
    if (open === undefined) throw new Error("the pane does not open");
    expect(open.wheel).toBe("kind");
    expect(open.escape).toBe("desk");
    const local = {
      page: () => ({
        key: "k",
        state: { is: "live" },
        info: { cursor: "text", back: true, forward: false },
      }),
    };
    const cursor = (part: string) => open.cursor?.({ entity: 1 as Entity, part, local });
    expect(cursor("page")).toBe("text");
    expect(cursor("back")).toBe("pointer");
    // nowhere to go forward: the desk's own cursor
    expect(cursor("forward")).toBeUndefined();
    expect(cursor("reload")).toBe("pointer");
    expect(cursor("address")).toBe("pointer");
    expect(cursor("content")).toBeUndefined();
    // no page: no cursor of its own
    expect(open.cursor?.({ entity: 1 as Entity, part: "page", local: undefined })).toBeUndefined();
  });
});
