// THE PANE'S LAW (BROWSER.md; the prototype's test/browser.test.ts, its 18 units ported — the photo body traded for the
// desk's flux, the phone catalog for its one number, the lab's bridge names for the sample's): a pane is cut to its page
// at its device's density, the ray the hit-test casts is the one the shader draws — from the pane's OWN eye — the head's
// controls are where the engraving puts them, a dragged edge asks for a whole viewport, and the stream is asked for what
// the desk needs. And PT-1's own: `Size` is the truth and the viewport its derivation; the local eye's stand; the marks'
// silhouette. No GPU.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eyeOf } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  BROWSER,
  BROWSER_PANE_PALETTE,
  bandLayout,
  castPane,
  controlAt,
  cutOf,
  DEVICES,
  deviceById,
  displayOf,
  edgeAt,
  eyeHeight,
  faceOfPage,
  facePoint,
  glowLevel,
  glowReach,
  heldPagePoint,
  heldPartAt,
  IPHONE_17_PRO_DISPLAY_MM,
  MM,
  nativeOf,
  openExtent,
  PANE_FINISHES,
  PANE_MIN_SIZE,
  PANE_SIZE,
  Pane,
  PaneUniforms,
  pageDemand,
  pageOnBox,
  pagePoint,
  paneDemand,
  paneFinish,
  paneLook,
  paneReach,
  paneValues,
  pickPane,
  pointAt,
  resized,
  resolveAddress,
  resolvePane,
  rimAt,
  SAMPLE_URL,
  sameDemand,
  sdPage,
  sdPane,
  seen,
  shapeOf,
  silhouetteDepth,
  silhouetteOf,
  sizeOf,
  viewportOf,
  wheelToPage,
} from "../src";
import { LAMP } from "../src/law";

const here = resolve(import.meta.dirname, "..");
const device = (id: string) => {
  const d = deviceById(id);
  if (!d) throw new Error(id);
  return d;
};
/** The desk eye over a 1200 × 800 view centred on (x, y) — the prototype's harness's view. */
const view = (x: number, y: number, zoom = 1) =>
  eyeOf({ x: x - 600 / zoom, y: y - 400 / zoom, zoom }, { width: 1200, height: 800 }, BROWSER.eye);
const REST = { lift: 0, hover: 0, fade: 1 } as const;
/** A pane of `id`'s own cut, centred at (x, y), lifted by `lift` (0 … 1 of the carry). */
const pane = (id: string, x = 0, y = 0, lift = 0) => {
  const d = device(id);
  const size = sizeOf([d.width, d.height], d);
  const S = shapeOf(size, d);
  const rect = { cx: x, cy: y, w: size.w, h: size.h };
  return { S, rect, G: resolvePane(rect, { ...REST, lift }, S, LAMP) };
};

describe("the pane — cut to its page, at its device's density", () => {
  it("a laptop's page is 1280 × 800 CSS px at 0.2 mm each: a 256 × 160 mm page in a pane with a clear border and an engraved head", () => {
    const { S } = pane("laptop");
    expect(S.viewport).toEqual([1280, 800]);
    expect(S.page[2] * 2).toBeCloseTo(256 * MM, 6);
    expect(S.page[3] * 2).toBeCloseTo(160 * MM, 6);
    // the border round the sides and foot, the head above the page
    expect(S.half[0] - S.page[2]).toBeCloseTo(BROWSER.pane.border * MM, 6);
    expect(S.half[1] - (S.page[1] + S.page[3])).toBeCloseTo(BROWSER.pane.border * MM, 6);
    expect(S.band - -S.half[1]).toBeCloseTo(BROWSER.pane.band * MM, 6);
    expect(S.page[1] - S.page[3]).toBeCloseTo(S.band, 6);
    // concentric corners: the page's is the outline's less the border
    expect(S.pageCorner).toBeCloseTo(S.corner - S.border, 6);
    expect(S.thick).toBeCloseTo(BROWSER.pane.thick * MM, 6);
  });

  it("a phone's pane carries the iPhone 17 Pro's own display width — 66.59 mm — so it is a phone's size beside the phone", () => {
    const { S } = pane("phone");
    expect(S.page[2] * 2).toBeCloseTo(IPHONE_17_PRO_DISPLAY_MM * MM, 3);
    expect(S.viewport).toEqual([402, 874]);
  });

  it("every device keeps its page inside the outline, and the head's controls inside the head", () => {
    for (const d of DEVICES) {
      const S = shapeOf(sizeOf([d.width, d.height], d), d);
      for (const [u, v] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const)
        expect(sdPane(S, S.page[0] + u * S.page[2], S.page[1] + v * S.page[3])).toBeLessThan(0);
      const L = bandLayout(S);
      for (const c of [L.back, L.forward, L.reload])
        if (c) {
          expect(c[1]).toBeGreaterThan(-S.half[1]);
          expect(c[1]).toBeLessThan(S.band);
        }
      expect(L.address[1] - L.address[3]).toBeGreaterThan(-S.half[1]);
      expect(L.address[1] + L.address[3]).toBeLessThan(S.band);
      expect(L.compact).toBe(d.id === "phone");
    }
  });

  it("the arris falls monotone from the face to its full fall at the outline, vertical there", () => {
    const { S } = pane("laptop");
    let last = 1;
    for (let d = S.rim[0]; d >= 0; d -= S.rim[0] / 50) {
      const [h] = rimAt(S, d);
      expect(h).toBeLessThanOrEqual(last + 1e-9);
      last = h;
    }
    expect(rimAt(S, 0)[0]).toBeCloseTo(-S.rim[1], 6);
    expect(rimAt(S, S.rim[0])[0]).toBe(0);
    expect(rimAt(S, 0.001)[1]).toBeGreaterThan(10);
  });
});

describe("Size is the truth (PT-1 ruling 5): the viewport is derived from it", () => {
  it("each device's own cut gives back its viewport; a size between whole pixels rounds; nothing is cut under 320 × 240", () => {
    for (const d of DEVICES) {
      expect(viewportOf(sizeOf([d.width, d.height], d), d)).toEqual([d.width, d.height]);
      // the document's cut — to the hundredth — reads the same viewport
      expect(viewportOf(cutOf(d), d)).toEqual([d.width, d.height]);
    }
    const laptop = device("laptop");
    const s = sizeOf([1000.4, 700.6], laptop);
    expect(viewportOf(s, laptop)).toEqual([1000, 701]);
    expect(viewportOf({ w: 10, h: 10 }, laptop)).toEqual([320, 240]);
    expect(viewportOf(PANE_SIZE, laptop)).toEqual([1280, 800]);
  });

  it("the resize floor is the smallest viewport at the finest density (a phone's); a coarser device floors its viewport there", () => {
    expect(viewportOf(PANE_MIN_SIZE, device("phone"))).toEqual([320, 240]);
    // a laptop's pane at the floor is under its own 320 px: the viewport holds at 320 × 240
    expect(viewportOf(PANE_MIN_SIZE, device("laptop"))).toEqual([320, 240]);
    // and the floor lies under every device's own cut
    for (const d of DEVICES) {
      const c = cutOf(d);
      expect(c.w).toBeGreaterThan(PANE_MIN_SIZE.w);
      expect(c.h).toBeGreaterThan(PANE_MIN_SIZE.h);
    }
  });

  it("the prototype's `resized` and the size core's handles write agree: an edge dragged by d asks what the grown size cuts", () => {
    for (const id of ["laptop", "phone", "tablet"]) {
      const d = device(id);
      const size = sizeOf([d.width, d.height], d);
      const S = shapeOf(size, d);
      for (const [dir, dx, dy] of [
        [[1, 0], 100, 0],
        [[0, 1], 0, 37.3],
        [[1, 1], 61.7, -25],
        [[-1, 0], 44, 0],
      ] as const) {
        const grown = { w: size.w + dir[0] * dx, h: size.h + dir[1] * dy };
        expect(resized(S, dir, dx, dy), `${id} ${dir}`).toEqual(viewportOf(grown, d));
      }
    }
  });
});

describe("the ray — what you touch is what is drawn, from the pane's own eye", () => {
  it("finds the very face point drawn at a desk point, on resting, hovered, lifted and off-centre panes (< 1e-6)", () => {
    for (const [x, y, lift] of [
      [0, 0, 0],
      [420, -260, 0],
      [-300, 200, 1],
      [900, 500, 0.4],
    ] as const) {
      const { S, G } = pane("laptop", x, y, lift);
      for (const [u, v] of [
        [0, 0],
        [S.half[0] * 0.8, -S.half[1] * 0.7],
        [-S.half[0] * 0.5, S.half[1] * 0.9],
        [S.page[0], S.band - 3],
      ] as const) {
        const [wx, wy] = seen(G.eye, pointAt(G, u, v));
        const hit = castPane(G, wx, wy);
        expect(hit?.part).toBe("face");
        expect(hit?.u).toBeCloseTo(u, 6);
        expect(hit?.v).toBeCloseTo(v, 6);
        const [fu, fv] = facePoint(G, wx, wy);
        expect(fu).toBeCloseTo(u, 6);
        expect(fv).toBeCloseTo(v, 6);
        // …and from a desk eye standing elsewhere (the prototype's view): the law answers any eye alike
        const e = view(0, 0);
        const [dx, dy] = seen(e, pointAt(G, u, v));
        const far = castPane(G, dx, dy, e);
        expect(far?.u).toBeCloseTo(u, 6);
        expect(far?.v).toBeCloseTo(v, 6);
      }
    }
  });

  it("meets the arris at the outline and the wall below it on the side facing an eye — never on the far side", () => {
    const { S, G } = pane("laptop", 700, 0);
    const e = view(0, 0);
    // under a desk eye to its left the pane's left side faces the view's centre: its wall is seen there
    const near = seen(e, pointAt(G, -S.half[0], 0, -S.thick * 0.6));
    expect(castPane(G, near[0], near[1], e)?.part).toBe("wall");
    // its right side faces away: a point just outside the face's outline there is the desk
    const far = seen(e, pointAt(G, S.half[0] + 0.5, 0));
    expect(castPane(G, far[0], far[1], e)).toBeNull();
    // the silhouette's depth is positive inside, negative outside
    expect(silhouetteDepth(G, near[0], near[1], e)).toBeGreaterThan(0);
    expect(silhouetteDepth(G, far[0] + 5, far[1], e)).toBeLessThan(0);
  });

  it("from its OWN eye — over its centre — no wall is ever seen (the desk eye's look a pane off to the side loses)", () => {
    const { S, G } = pane("laptop", 700, 0);
    const parts = new Set<string>();
    for (let t = -1.04; t <= 1.04; t += 0.005)
      for (const [x, y] of [
        [t * S.half[0], 0],
        [0, t * S.half[1]],
        [t * S.half[0], t * S.half[1]],
      ] as const) {
        const hit = castPane(G, G.centre[0] + x, G.centre[1] + y);
        if (hit !== null) parts.add(hit.part);
      }
    expect([...parts].sort()).toEqual(["face", "rim"]);
  });

  it("a point on the page is the page's CSS px; the head's controls are named; the border is glass; beyond it, nothing", () => {
    const { S, G } = pane("laptop");
    const at = (u: number, v: number) => seen(G.eye, pointAt(G, u, v));
    const mid = at(...faceOfPage(S, 640, 400));
    const p = pickPane(G, mid[0], mid[1]);
    expect(p?.part).toBe("page");
    if (p?.part === "page") {
      expect(p.point[0]).toBeCloseTo(640, 6);
      expect(p.point[1]).toBeCloseTo(400, 6);
    }
    const L = bandLayout(S);
    for (const [name, c] of [
      ["back", L.back],
      ["forward", L.forward],
      ["reload", L.reload],
      ["address", [L.address[0] - L.address[2] * 0.5, L.address[1]]],
    ] as const) {
      const w = at(c?.[0] ?? 0, c?.[1] ?? 0);
      const k = pickPane(G, w[0], w[1]);
      expect(k?.part).toBe("band");
      if (k?.part === "band") expect(k.control).toBe(name);
    }
    const border = at(S.half[0] - S.border * 0.5, 0);
    expect(pickPane(G, border[0], border[1])?.part).toBe("glass");
    const out = at(S.half[0] + 20, 0);
    expect(pickPane(G, out[0], out[1])).toBeNull();
    // the page's px round trip
    const [u, v] = faceOfPage(S, 123.5, 456.25);
    const [x, y] = pagePoint(S, u, v);
    expect(x).toBeCloseTo(123.5, 9);
    expect(y).toBeCloseTo(456.25, 9);
    expect(sdPage(S, u, v)).toBeLessThan(0);
  });

  it("controlAt names the size readout right of the capsule, and nothing between the controls", () => {
    const { S } = pane("desktop");
    const L = bandLayout(S);
    expect(controlAt(S, (L.size ?? 0) - 10 * MM, L.cy)).toBe("size");
    expect(
      controlAt(S, ((L.forward?.[0] ?? 0) + (L.address[0] - L.address[2])) / 2, L.cy),
    ).toBeNull();
  });
});

describe("the eye and the marks", () => {
  it("the pane's own eye stands over its centre as high as the desk eye over a view that frames it — never nearer than the desk eye's floor", () => {
    const { G, rect } = pane("laptop", 320, -140);
    expect([G.eye.ex, G.eye.ey]).toEqual([320, -140]);
    // a laptop's pane is seen from ≈ 1640 up — the prototype saw one from 1658 at zoom 1 in its 1200 × 800 view
    expect(G.eye.h).toBeCloseTo(BROWSER.eye.k * BROWSER.eye.frame * Math.hypot(rect.w, rect.h), 9);
    expect(G.eye.h).toBeGreaterThan(1600);
    expect(G.eye.h).toBeLessThan(1700);
    // a phone's pane is small: the floor
    expect(eyeHeight(cutOf(device("phone")))).toBe(BROWSER.eye.min);
  });

  it("the marks' silhouette is the outline at the arris's foot as the eye sees it: hit answers inside it, never outside", () => {
    for (const lift of [0, 1]) {
      const { G } = pane("laptop", 200, 90, lift);
      const s = silhouetteOf(G);
      expect(s.hx).toBeGreaterThan(G.shape.half[0]);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        const inside = castPane(G, s.cx + dx * (s.hx - 0.05), s.cy + dy * (s.hy - 0.05));
        const outside = castPane(G, s.cx + dx * (s.hx + 0.05), s.cy + dy * (s.hy + 0.05));
        expect(inside, `${lift} ${dx},${dy}`).not.toBeNull();
        expect(outside, `${lift} ${dx},${dy}`).toBeNull();
      }
    }
  });
});

describe("the lift — the desk's flux, never the prototype's hand", () => {
  it("carried it rides 22 up and reads bigger from its own eye, hovered a hair; set down it lies flat on the mat; never turned", () => {
    const rest = pane("laptop", 0, 0, 0).G;
    const held = pane("laptop", 0, 0, 1).G;
    const d = device("laptop");
    const S = shapeOf(sizeOf([d.width, d.height], d), d);
    const hovered = resolvePane(
      { cx: 0, cy: 0, w: S.half[0] * 2, h: S.half[1] * 2 },
      { lift: 0, hover: 1, fade: 1 },
      S,
      LAMP,
    );
    expect(rest.centre[2]).toBeCloseTo(S.thick, 9);
    expect(rest.bottom).toBe(0);
    expect(hovered.centre[2]).toBeCloseTo(S.thick + BROWSER.lift.hover, 9);
    expect(held.centre[2]).toBeCloseTo(S.thick + BROWSER.lift.height, 9);
    expect(silhouetteOf(held).hx).toBeGreaterThan(silhouetteOf(rest).hx);
    // square to the mat always: no tip toward fingers it does not know, no turn
    for (const G of [rest, hovered, held]) {
      expect(G.n).toEqual([0, 0, 1]);
      expect(G.ex).toEqual([1, 0, 0]);
      expect(G.ey).toEqual([0, 1, 0]);
    }
    // a held pane's shadow lifts with it
    expect(held.shadowAlpha).toBeCloseTo(BROWSER.shadow.alphaHeld, 9);
    expect(rest.shadowAlpha).toBeCloseTo(BROWSER.shadow.alpha, 9);
  });

  it("the quad holds the pane as the eye sees it, its shadow, and its glow — and the kind's reach covers the most of it", () => {
    const d = device("laptop");
    const S = shapeOf(sizeOf([d.width, d.height], d), d);
    const rect = { cx: 300, cy: 200, w: S.half[0] * 2, h: S.half[1] * 2 };
    const G = resolvePane(rect, { lift: 1, hover: 1, fade: 1 }, S, LAMP, BROWSER, glowReach());
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const [x, y] = seen(G.eye, pointAt(G, u * S.half[0], v * S.half[1]));
      expect(x).toBeGreaterThan(G.bounds.x0);
      expect(x).toBeLessThan(G.bounds.x1);
      expect(y).toBeGreaterThan(G.bounds.y0);
      expect(y).toBeLessThan(G.bounds.y1);
    }
    expect(G.bounds.x1 - G.bounds.x0).toBeGreaterThan(S.half[0] * 2 + 2 * glowReach());
    // the reach — the desk's cull margin — holds the whole quad past the rect, for a held pane anywhere on the desk
    for (const [cx, cy] of [
      [0, 0],
      [3000, -2000],
      [-4000, 3500],
    ] as const) {
      const H = resolvePane(
        { ...rect, cx, cy },
        { lift: 1, hover: 1, fade: 1 },
        S,
        LAMP,
        BROWSER,
        glowReach(),
      );
      const past = Math.max(
        cx - rect.w / 2 - H.bounds.x0,
        H.bounds.x1 - (cx + rect.w / 2),
        cy - rect.h / 2 - H.bounds.y0,
        H.bounds.y1 - (cy + rect.h / 2),
      );
      expect(past, `${cx},${cy}`).toBeLessThanOrEqual(paneReach());
    }
    expect(paneReach()).toBeGreaterThan(glowReach());
  });
});

describe("resizing and the stream", () => {
  it("a dragged edge asks for a whole viewport: the page grows by what the outline grows, never under the smallest", () => {
    const { S } = pane("phone");
    expect(resized(S, [1, 0], 100 * S.scale, 999)).toEqual([502, 874]);
    expect(resized(S, [0, 1], 999, -50.4 * S.scale)).toEqual([402, 824]);
    expect(resized(S, [-1, -1], 30 * S.scale, 20 * S.scale)).toEqual([372, 854]);
    expect(resized(S, [1, 1], -5000, -5000)).toEqual([
      BROWSER.resize.min[0],
      BROWSER.resize.min[1],
    ]);
  });

  it("a selected pane's outline is a handle: an edge moves one axis, a corner both, the middle nothing", () => {
    const { S, G } = pane("laptop");
    const at = (u: number, v: number) => seen(G.eye, pointAt(G, u, v));
    const right = at(S.half[0], 0);
    const corner = at(S.half[0], S.half[1]);
    const middle = at(0, 0);
    expect(edgeAt(G, right[0], right[1], 9, 1)).toEqual([1, 0]);
    expect(edgeAt(G, corner[0] - 1, corner[1] - 1, 9, 1)).toEqual([1, 1]);
    expect(edgeAt(G, middle[0], middle[1], 9, 1)).toBeNull();
  });

  it("the demand: at rest a halving of the native capture that covers the page's pixels at 30 or 12 fps; in use the native at 60; off screen 0; a rung held through a wobble", () => {
    const { S, G } = pane("laptop");
    const [nw, nh] = nativeOf(S);
    expect([nw, nh]).toEqual([2560, 1600]);
    const d1 = pageDemand(G, view(0, 0, 1), 2, false);
    expect(d1.width).toBe(2560);
    expect(d1.fps).toBe(30); // ~1344 device px wide at zoom 1: the native rung covers it, the half does not
    const d03 = pageDemand(G, view(0, 0, 0.3), 2, false);
    expect(d03.width).toBe(640);
    expect(d03.height).toBe(400);
    expect(d03.fps).toBe(30);
    const d01 = pageDemand(G, view(0, 0, 0.1), 2, false);
    expect(d01.width).toBe(320);
    expect(d01.fps).toBe(15); // the prototype's 12 is no LSF bucket (PT-2 ruling 5)
    const use = pageDemand(G, view(0, 0, 1), 2, true);
    expect([use.width, use.height, use.fps]).toEqual([2560, 1600, 60]);
    expect(pageDemand(G, view(5000, 0, 1), 2, false).fps).toBe(0);
    // held: the half rung stays while it still covers the page and is under 2.3× it
    expect(pageDemand(G, view(0, 0, 0.45), 2, false, BROWSER, 1280).width).toBe(1280);
    expect(glowLevel(2560)).toBeCloseTo(Math.log2(2560 / 24), 9);
  });
});

describe("the live page SEEN where it is drawn — its page on the slot's box (PT-2)", () => {
  it("is seen while any of its page meets the box, and not once it lies past it — whatever its reach still prepares", () => {
    const { G, rect } = pane("laptop", 400, 300);
    const S = G.shape;
    // the page's world rect, as the pane lies flat
    const px0 = rect.cx + S.page[0] - S.page[2];
    const px1 = rect.cx + S.page[0] + S.page[2];
    const view = (camX: number, camY: number, zoom = 1) => ({
      camX,
      camY,
      zoom,
      width: 1200,
      height: 800,
    });
    // the view over the pane: seen
    expect(pageOnBox(G, view(rect.cx - 600, rect.cy - 400))).toBe(true);
    // the page's right edge just past the view's left: unseen (a shadow and a glow still reach in — the pass prepares it)
    expect(pageOnBox(G, view(px1 + 1, rect.cy - 400))).toBe(false);
    expect(pageOnBox(G, view(px1 - 1, rect.cy - 400))).toBe(true);
    // at a zoom of 2 the view spans 600 world units: its left edge at the view's right edge is past it, a unit in is seen
    expect(pageOnBox(G, view(px0 - 600 + 1, rect.cy - 200, 2))).toBe(true);
    expect(pageOnBox(G, view(px0 - 600, rect.cy - 200, 2))).toBe(false);
    // a slot's own box (a mini mat's face): the page must meet THAT, not the attachment
    expect(
      pageOnBox(G, { ...view(rect.cx - 600, rect.cy - 400), box: { x: 0, y: 0, w: 10, h: 10 } }),
    ).toBe(false);
  });
});

describe("the live page's demand over the SIGHT (PT-2 ruling 5)", () => {
  const laptop = () => pane("laptop").S;
  const phone = () => pane("phone").S;
  const at = (px: number, held = false) => ({
    seen: true,
    px: [px, Math.round(px * 0.625)] as const,
    held,
  });

  it("unseen — off screen, culled, behind the hand — is paused, its layout kept", () => {
    const d = paneDemand({ seen: false, px: [0, 0], held: false }, laptop());
    expect(d).toEqual({
      mode: "paused",
      fps: 0,
      raster: [0, 0],
      viewport: [1280, 800],
      interactive: false,
    });
  });

  it("held is the native capture at 60, interactive", () => {
    expect(paneDemand(at(900, true), laptop())).toEqual({
      mode: "live",
      fps: 60,
      raster: [2560, 1600],
      viewport: [1280, 800],
      interactive: true,
    });
    // a phone's native is its own 3× capture
    expect(paneDemand(at(300, true), phone()).raster).toEqual([1206, 2622]);
  });

  it("at rest: the halving of native that covers the page's device px — at most three — 30 fps from 320 device px, 15 under", () => {
    const S = laptop();
    expect(paneDemand(at(2560), S)).toMatchObject({ mode: "live", fps: 30, raster: [2560, 1600] });
    expect(paneDemand(at(1500), S).raster).toEqual([2560, 1600]); // 1280 does not cover 1500
    expect(paneDemand(at(1280), S).raster).toEqual([1280, 800]);
    expect(paneDemand(at(700), S).raster).toEqual([1280, 800]);
    expect(paneDemand(at(640), S).raster).toEqual([640, 400]);
    expect(paneDemand(at(330), S)).toMatchObject({ fps: 30, raster: [640, 400] });
    expect(paneDemand(at(300), S)).toMatchObject({ fps: 15, raster: [320, 200] });
    // never past three halvings, however small
    expect(paneDemand(at(40), S)).toMatchObject({
      fps: 15,
      raster: [320, 200],
      interactive: false,
    });
    for (const px of [2560, 1000, 300, 40])
      expect(paneDemand(at(px), S).viewport).toEqual([1280, 800]);
  });

  it("holds a rung through a wobble: kept while it still covers the page and is under 2.3× it", () => {
    const S = laptop();
    // zooming out from 1280 → 1100 px: 1280 still covers and is under 2.3×, so it stays (fresh, 1280 too)
    expect(paneDemand(at(1100), S, 1280).raster).toEqual([1280, 800]);
    // at 600 px a fresh ask is 640, but the held 1280 is under 2.3 × 600 = 1380: it stays
    expect(paneDemand(at(600), S, 1280).raster).toEqual([1280, 800]);
    // at 500 px the held 1280 is past 2.3 × 500 = 1150: it drops to the rung that covers
    expect(paneDemand(at(500), S, 1280).raster).toEqual([640, 400]);
    // a held rung that no longer covers the page is dropped
    expect(paneDemand(at(900), S, 640).raster).toEqual([1280, 800]);
  });

  it("speaks change-only: the same ask is the same demand", () => {
    const S = laptop();
    expect(sameDemand(paneDemand(at(700), S), paneDemand(at(800), S))).toBe(true);
    expect(sameDemand(paneDemand(at(700), S), paneDemand(at(600), S))).toBe(false);
    expect(sameDemand(undefined, paneDemand(at(700), S))).toBe(false);
    // a new viewport is a new demand (a resize, a device switch)
    // a new viewport alone is a new demand — the same raster, rate and rung
    const d = paneDemand(at(700), S);
    expect(sameDemand(d, { ...d, viewport: [1300, 800] })).toBe(false);
    expect(sameDemand(d, { ...d, raster: [d.raster[0], d.raster[1]] })).toBe(true);
    const wider = shapeOf({ w: 800, h: 461.94 }, device("laptop"));
    expect(sameDemand(paneDemand(at(700), S), paneDemand(at(700), wider))).toBe(false);
  });
});

describe("the records and the shader", () => {
  it("every Pane and PaneUniforms field the shader names exists in its record", () => {
    const wgsl =
      readFileSync(resolve(here, "src/browser.wgsl"), "utf8") +
      readFileSync(resolve(here, "src/browser-pass.wgsl"), "utf8");
    const fields = (def: { wgsl: string }) =>
      new Set([...def.wgsl.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]));
    const P = fields(Pane);
    const K = fields(PaneUniforms);
    for (const m of wgsl.matchAll(/\bP\.(\w+)/g))
      expect(P.has(m[1] as string), `P.${m[1]}`).toBe(true);
    for (const m of wgsl.matchAll(/\bk\.(\w+)/g))
      expect(K.has(m[1] as string), `k.${m[1]}`).toBe(true);
  });

  it("a pane's record carries its geometry, its own eye, its glass, its page and its head's raster split by name", () => {
    const { S, G } = pane("laptop");
    const look = paneLook({
      canvasBg: { token: "t", css: "#fafafa" },
      select: { token: "t", css: "#4a90d9" },
    });
    const v = paneValues({
      geometry: G,
      finish: paneFinish(look, "float"),
      look,
      page: { key: "k", viewport: [1280, 800], scheme: "light", width: 1280, height: 800 },
      brightness: 1,
      loading: -1,
      head: { key: "h", still: "h", split: { height: 202, h: 100, at: 102 } },
    });
    expect(v.ex[3]).toBeCloseTo(S.half[0], 9);
    expect(v.n[3]).toBeCloseTo(S.thick, 9);
    expect(v.eye).toEqual([G.eye.ex, G.eye.ey, G.eye.h, 0]);
    expect(v.ink).toEqual([1, 100 / 202, 102 / 202, 0]);
    expect(v.tint[3]).toBeCloseTo(100 * MM, 9);
    expect(v.screen).toEqual([1280, 800, 10, 1]);
    expect(v.screen2[3]).toBe(-1);
    // no page: the dark film (no texels read); no raster: no engraving
    const blank = paneValues({
      geometry: G,
      finish: paneFinish(look, "low-iron"),
      look,
      page: null,
      brightness: 1,
      loading: -1,
      head: { key: "h" },
    });
    expect(blank.screen[3]).toBe(0);
    expect(blank.ink[0]).toBe(0);
  });

  it("every glass has a finish in the theme, each an edge colour over a path", () => {
    expect([...PANE_FINISHES]).toEqual(["low-iron", "float", "smoke", "bronze"]);
    const look = paneLook({
      canvasBg: { token: "t", css: "#fafafa" },
      select: { token: "t", css: "#4a90d9" },
    });
    for (const n of PANE_FINISHES) {
      const f = paneFinish(look, n);
      expect(f.edge.every((c) => c >= 0 && c <= 1)).toBe(true);
      expect(f.path).toBe(BROWSER_PANE_PALETTE.finishes[n].path);
    }
    // an unknown glass is the default's
    expect(paneFinish(look, "stained")).toEqual(paneFinish(look, "low-iron"));
  });
});

describe("the address", () => {
  it("prints the sample by its host, a site by its host without its www., a blank page as nothing", () => {
    expect(displayOf(SAMPLE_URL)).toBe("lumen.example");
    expect(displayOf("https://www.example.com/a/b?c")).toBe("example.com");
    expect(displayOf("about:blank")).toBe("");
    expect(displayOf("file:///Users/me/notes/plan.html")).toBe("plan.html");
  });

  it("opens what is typed: a URL, a host — anything else is searched; nothing typed opens the sample", () => {
    expect(resolveAddress("https://example.com/x")).toBe("https://example.com/x");
    expect(resolveAddress("example.com")).toBe("https://example.com");
    expect(resolveAddress("localhost:3000/app")).toBe("http://localhost:3000/app");
    expect(resolveAddress("glass on a cutting mat")).toBe(
      "https://duckduckgo.com/?q=glass%20on%20a%20cutting%20mat",
    );
    expect(resolveAddress("")).toBe(SAMPLE_URL);
  });
});

describe("PT-3 — the pane in hand: its named parts, its page's points, the finger's travel", () => {
  it("IN HAND names its PAGE and its head's CONTROLS (the size readout is the pane's own) — the rest of its glass is `content`, past it nothing", () => {
    const d = device("laptop");
    const size = sizeOf([d.width, d.height], d);
    const S = shapeOf(size, d);
    const rect = { cx: 40, cy: -30, w: size.w, h: size.h };
    const G = resolvePane(rect, REST, S, LAMP, BROWSER, 0, true);
    expect(G.held).toBe(true);
    expect(resolvePane(rect, REST, S, LAMP).held).toBeUndefined();
    const at = (u: number, v: number) => seen(G.eye, pointAt(G, u, v));
    const mid = at(...faceOfPage(S, 640, 400));
    expect(heldPartAt(G, mid[0], mid[1])).toBe("page");
    const L = bandLayout(S);
    for (const [name, c] of [
      ["back", L.back],
      ["forward", L.forward],
      ["reload", L.reload],
      ["address", [L.address[0] - L.address[2] * 0.5, L.address[1]]],
    ] as const) {
      const w = at(c?.[0] ?? 0, c?.[1] ?? 0);
      expect(heldPartAt(G, w[0], w[1]), name).toBe(name);
    }
    const border = at(S.half[0] - S.border * 0.5, 0);
    expect(heldPartAt(G, border[0], border[1])).toBe("content");
    if (L.size !== null) {
      const readout = at(L.size - L.glyph * 0.5, L.cy);
      expect(heldPartAt(G, readout[0], readout[1])).toBe("content");
    }
    const out = at(S.half[0] + 20, 0);
    expect(heldPartAt(G, out[0], out[1])).toBeNull();
  });

  it("a point of the hand is the page's CSS px through the pane's own eye — and past the page's edge it keeps going", () => {
    const { S, rect, G } = pane("laptop", 100, 50);
    const ext = openExtent(rect, S);
    expect(ext.w).toBeCloseTo(2 * S.page[2], 9);
    expect(ext.cy - ext.h / 2).toBeCloseTo(rect.cy - S.half[1], 9);
    const hand = (u: number, v: number) => {
      const w = seen(G.eye, pointAt(G, u, v));
      return [w[0] - ext.cx, w[1] - ext.cy] as const;
    };
    for (const [x, y] of [
      [640, 400],
      [0, 0],
      [1279, 799],
      [123.5, 456.25],
    ] as const) {
      const [px, py] = heldPagePoint(G, ext, ...hand(...faceOfPage(S, x, y)));
      expect(px).toBeCloseTo(x, 6);
      expect(py).toBeCloseTo(y, 6);
    }
    const [past] = heldPagePoint(G, ext, ...hand(S.half[0] + 10, S.page[1]));
    expect(past).toBeGreaterThan(S.viewport[0]);
  });

  it("the page scrolls by what the finger moved ON THE SCREEN, whatever the zoom (BROWSER.md §6)", () => {
    const { S } = pane("laptop");
    for (const zoom of [0.25, 1, 2.5]) {
      // one page px is zoom × S.scale screen px: 120 screen px are that many fewer page px
      expect(wheelToPage(120, zoom, S)).toBeCloseTo(120 / (zoom * S.scale), 9);
      expect(wheelToPage(-120, zoom, S)).toBeCloseTo(-120 / (zoom * S.scale), 9);
    }
    expect(wheelToPage(0, 1, S)).toBe(0);
  });
});
