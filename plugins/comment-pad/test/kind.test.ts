// THE PAD'S KIND, judged by the SDK's KIND-CONFORMANCE HARNESS (`@vibefield/plugin-sdk/testing` — the one `pnpm
// playground` and `vibefield-plugin check` run, no GPU and no DOM) WITH THE PRODUCT'S PALETTE (DK-7's note, ruled
// at DK-8 §5a): the pad's ink is the HOST's — the palette's `pens` — so it is driven under the roles the product
// mounts its desk with (`productPalette`), and refused under the harness's two-role default rather than falling back
// to an ink of its own. Then what the harness cannot know: its block is what is picked, its marks go round the block,
// its chip greeks its writing, a held pad is bigger and higher, its rung is its ink's band.
import {
  DEFAULT_GRID,
  type Entity,
  lampOf,
  type ObjectContext,
  PAPER_FINISH,
  rgb,
} from "@vibefield/plugin-sdk/desk";
import { type KindReport, productPalette, runKindConformance } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import states from "../playground/states";
import {
  accentOf,
  COMMENT_PAD_PALETTE,
  commentPad,
  commentPadKind,
  commentPadManifest,
  type PadGeometry,
  type PadInstance,
  type PadLook,
  type PadWriting,
  padLook,
  writingBox,
} from "../src";

const row = commentPadManifest.contributes?.objects?.[0];
const refusals = (r: KindReport) =>
  r.verdicts.filter((v) => v.status === "refused").map((v) => v.code);
const fixtures = (states as Record<string, Record<string, Record<string, unknown>>>)[
  "vibefield.comment-pad"
];

describe("the comment pad's kind, judged by the kind-conformance harness WITH the product's palette (§5a)", () => {
  it("passes: its declaration, its program, every playground state in every mode and zoom, its dispose", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const r = await runKindConformance({
      binding: commentPad,
      row,
      at: "/contributes/objects/0",
      states: fixtures,
      palette: productPalette,
    });
    expect(refusals(r)).toEqual([]);
    // CONTAINABLE: the contained mode is driven too; it never opens (no held tools — a pad is written in place)
    expect(r.plan.modes).toEqual(["idle", "selected", "held", "contained"]);
    expect(r.plan.fixtures).toEqual(["default", "written", "long", "pink"]);
    expect(r.states).toBe(4 * (4 * r.plan.zooms.length + 1));
    // its declaration, its program (READ: the not-compiled note), each fixture driven, its dispose
    expect(r.verdicts.map((v) => v.code)).toEqual([
      "ok",
      "ok",
      "object-wgsl-not-compiled",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
  });

  it("is REFUSED under the harness's two-role default — its ink is read from the host's palette, never a fallback of its own", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const r = await runKindConformance({ binding: commentPad, row, states: fixtures });
    // every fixture, at its first state: the record cannot write in a pen the host never named
    expect(refusals(r)).toEqual(Array(4).fill("state-spawn-failed"));
    expect(r.verdicts.find((v) => v.code === "state-spawn-failed")?.detail).toContain(
      "the palette names no `pens`",
    );
  });
});

const lamp = lampOf(DEFAULT_GRID.mat.plane);
const look = padLook(productPalette.light);
const ctxOf = (props: Record<string, unknown>, extra: Partial<ObjectContext> = {}): ObjectContext =>
  ({
    entity: 1 as Entity,
    rect: { cx: 100, cy: 80, w: 220, h: 280 },
    props,
    flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
    look,
    theme: {} as never,
    lamp,
    view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 },
    grid: DEFAULT_GRID,
    dt: 0,
    ...extra,
  }) as ObjectContext;

describe("the comment pad's world half", () => {
  const k = commentPadKind();

  it("is PICKED BY ITS BLOCK: the sheet and the sheets' edges under it are the pad, past its corner is not", () => {
    const G = k.resolve(ctxOf({})) as PadGeometry;
    expect(k.hit(G, 100, 80)).toBe("content");
    expect(k.hit(G, 100 + 109, 80 - 139)).toBe("content"); // inside the top-left of the sheet
    expect(k.hit(G, 100, 80 + 140 + 3)).toBe("content"); // the lower sheets' edges, under the rect
    expect(k.hit(G, 100 + 111, 80)).toBeNull();
    expect(k.hit(G, 100 + 109.6, 80 - 139.6)).toBeNull(); // the die-cut corner
  });

  it("its marks go round the block as drawn, and a HELD pad is bigger and higher", () => {
    const G = k.resolve(ctxOf({})) as PadGeometry;
    const frame = k.frame?.(G);
    expect(frame).toMatchObject({ cx: 100, hx: 110, angle: 0 });
    expect(frame?.hy).toBeCloseTo(140 + (3 * 1.5) / 2, 9);
    const held = k.resolve(
      ctxOf({}, { flux: { lift: 1, hover: 1, ring: 0, fade: 1 } }),
    ) as PadGeometry;
    expect(held.half[0]).toBeGreaterThan(G.half[0]);
    expect(held.lift).toBeGreaterThan(0);
    expect(G.lift).toBe(0);
  });

  it("dresses itself from its props: the accent its binding and rules wear (an unknown one is indigo), the host's pen", () => {
    const R = k.record(
      k.resolve(ctxOf({ accent: "amber", pen: "red" })),
      ctxOf({ accent: "amber", pen: "red" }),
    ) as PadInstance;
    expect(R.accent).toEqual(rgb(COMMENT_PAD_PALETTE.accents.amber.css));
    const pens = (productPalette.light as unknown as { pens: Record<string, { css: string }> })
      .pens;
    expect(R.ink).toEqual(rgb(pens.red?.css ?? ""));
    expect(accentOf({ accent: "plaid" })).toBe("indigo");
    // no writing on this desk (no local): the rules stand where the hand would lay its baselines, no ink, no caret
    expect(R.raster).toBeUndefined();
    expect(R.caret).toBeUndefined();
    expect(R.rules.pitch).toBeGreaterThan(0);
  });

  it("its RUNG is its ink's band — the record is remade at a power of two of the screen's density, never within one", () => {
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
    expect(rung(1)).toBe(1); // 2 texels a pad unit at zoom 1, dpr 2
    expect(rung(0.6)).toBe(rung(0.9));
    expect(rung(1.5)).toBe(2);
    expect(rung(0.01)).toBe(-1); // the coarsest rung
    expect(rung(40)).toBe(2); // the densest
  });

  it("inside a mini mat its CHIP is a sheet of its paper with its writing greeked in its pen, at the writing box's lines", () => {
    const G = k.resolve(ctxOf({ pen: "felt" })) as PadGeometry;
    const local = {
      layoutOf: () => ({
        lines: [
          { start: 0, end: 4, y: 20, width: 60 },
          { start: 5, end: 5, y: 44, width: 0 },
        ],
      }),
    } as unknown as PadWriting;
    const chip = k.chip?.(G, ctxOf({ pen: "felt" }, { local }));
    const box = writingBox(220, 280);
    expect(chip).toMatchObject({
      finish: PAPER_FINISH,
      cx: 100,
      cy: 80,
      hx: 110,
      hy: 140,
      angle: 0,
      colour: (look as PadLook).paper,
    });
    // the empty line greeks nothing; the written one at the box's left edge and its baseline
    expect(chip?.writing).toEqual({
      ink: look.pens.felt,
      x0: box.x,
      em: 17,
      lines: [{ y: box.y + 20, width: 60 }],
    });
    // a pad never laid out yet greeks no lines
    expect(k.chip?.(G, ctxOf({}))?.writing).toBeUndefined();
  });
});
