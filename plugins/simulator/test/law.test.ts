// THE PHONE'S LAW (PHONE.md; the prototype's test/phone.test.ts — its 28, ported to the kind's terms): the catalog is Apple's,
// the shapes are the Simulator's, the pose rests on the camera and rises by the desk's flux, the ray the hit-test casts is the
// one the shader draws, and the stream is asked for what the desk needs. No GPU.
//
// What changed from the prototype's 28, and why (the PT-S1 hand-back lists them too):
//  - "holds the point you picked up under your finger" (the photo's body, pinned under the finger) is now "rises by the
//    desk's flux, square to the mat" — core's drag carries a plugin kind (the browser pane's PT-1 ruling 4);
//  - the ray's and the side's tests take their eye EXPLICITLY (an off-centre desk eye): a phone is drawn from its own eye
//    (the pane's ruling 3), and the ray must find the drawn point from any eye; tilt is gone (a phone is never turned);
//  - "lays every model out with no two touching" and "walks the history in order" stand over the law's `lineup` and
//    `historyShape`, ported as witnesses (the desk lays no lineup out and has no scrubber): the catalog's true sizes, and the
//    morph's continuity over the whole history;
//  - added: the one scale constant, an unknown model drawn as the default, a finish kept to its model's own, the demand over
//    the SIGHT agreeing with the desk eye's, the reach holding the largest model's overhang.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cssColor,
  eyeOf,
  FLUX_REST,
  kindPalette,
  type ObjectFlux,
} from "@vibefield/plugin-sdk/desk";
import { productPalette } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  castPhone,
  cropOf,
  DEFAULT_MODEL,
  DEFAULT_PHONE,
  devicePoint,
  finishOf,
  frameUv,
  glassOf,
  glassPoint,
  HOUSING_FADE,
  historyShape,
  lineup,
  MM,
  mixFinish,
  mixShape,
  modelOf,
  morphTracks,
  overhang,
  PHONE,
  PHONES,
  Phone,
  type PhoneShape,
  PhoneUniforms,
  phoneById,
  phoneByName,
  phoneDemand,
  phoneLook,
  phoneReach,
  phoneValues,
  pickPhone,
  pointAt,
  RIM_STEPS,
  resolvePhone,
  restPitch,
  rimAt,
  SCREEN_OFF,
  SIMULATOR_FINISHES,
  screenDemand,
  screenLod,
  sdBody,
  sdButtons,
  sdDisplay,
  sdHousing,
  sdSquircle,
  seen,
  shapeOf,
  silhouetteDepth,
  silhouetteOf,
} from "../src";

const PKG = resolve(import.meta.dirname, "..");
const TYPES = "/Library/Developer/CoreSimulator/Profiles/DeviceTypes";
const XCODE_VERSION = "/Applications/Xcode.app/Contents/version.plist";
/** This host's Xcode build (its version.plist's), or undefined: no Xcode.app. */
const HOST_XCODE = existsSync(XCODE_VERSION)
  ? /<key>ProductBuildVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(
      readFileSync(XCODE_VERSION, "utf8"),
    )?.[1]
  : undefined;
/** The Xcode build the committed catalog was made from — the one its generated header names (make-catalog.ts). */
const CATALOG_XCODE = /from Xcode [\d.]+ \(([^)]+)\)'s Simulator data/.exec(
  readFileSync(resolve(PKG, "src/catalog.gen.ts"), "utf8"),
)?.[1];
const model = (name: string) => {
  const m = phoneByName(name);
  if (!m) throw new Error(name);
  return m;
};
/** The desk eye over a view centred on (x, y) at `zoom` (a 1200 × 800 view, PHONE.md's). */
const view = (x: number, y: number, zoom = 1) =>
  eyeOf({ x: x - 600 / zoom, y: y - 400 / zoom, zoom }, { width: 1200, height: 800 }, PHONE.eye);
/** A flux lifting the phone to `h` world units (the hover off). */
const lifted = (h: number): ObjectFlux => ({
  lift: h / PHONE.lift.height,
  hover: 0,
  ring: 0,
  fade: 1,
});
const rest = (name: string, cx = 0, cy = 0) => ({ S: shapeOf(model(name)), rect: { cx, cy } });

describe("the catalog — every iPhone the Simulator knows, in Apple's numbers", () => {
  it("holds 42 models, oldest first, each named once, each with its launch finishes in the theme", () => {
    expect(PHONES).toHaveLength(42);
    expect(new Set(PHONES.map((m) => m.id)).size).toBe(42);
    for (let i = 1; i < PHONES.length; i++)
      expect(PHONES[i]?.year ?? 0).toBeGreaterThanOrEqual(PHONES[i - 1]?.year ?? 0);
    for (const m of PHONES) {
      expect(m.finishes.length).toBeGreaterThan(0);
      for (const f of m.finishes) expect(SIMULATOR_FINISHES[f], `${m.name} · ${f}`).toBeDefined();
    }
    expect(DEFAULT_PHONE.name).toBe("iPhone 17 Pro");
    expect(DEFAULT_PHONE.id).toBe(DEFAULT_MODEL);
    // the catalog names the Xcode build it was made from: the row below compares only on that build
    expect(CATALOG_XCODE).toMatch(/^\w+$/);
  });

  // The exact comparison holds only on the Xcode build the catalog was made from: another build's Simulator knows other
  // iPhones (Xcode 27.1 adds the 18 Pro, the 18 Pro Max and the Duo) — that host regenerates the catalog, and its difference
  // is the host's, not a fault (the same rule as the stills' golden and the committed words, both this Mac's).
  it.skipIf(!existsSync(TYPES) || HOST_XCODE !== CATALOG_XCODE)(
    `is every iPhone device type installed on this Mac (the catalog's Xcode ${CATALOG_XCODE}, this host's ${HOST_XCODE ?? "none"})`,
    () => {
      const installed = readdirSync(TYPES)
        .filter((d) => d.startsWith("iPhone") && d.endsWith(".simdevicetype"))
        .map((d) => d.replace(/\.simdevicetype$/, ""))
        .sort();
      expect(PHONES.map((m) => m.name).sort()).toEqual(installed);
    },
  );

  it("keeps each framebuffer's own geometry: the active area is its pixels at its panel's density", () => {
    for (const m of PHONES) {
      expect(m.screen.mm[0]).toBeCloseTo((m.screen.px[0] / m.screen.dpi) * 25.4, 2);
      expect(m.screen.mm[1]).toBeCloseTo((m.screen.px[1] / m.screen.dpi) * 25.4, 2);
      // the body holds the panel with a border on every side
      expect(m.body.bezel[0]).toBeGreaterThan(1.5);
      expect(m.body.bezel[1]).toBeGreaterThan(1.5);
    }
    const p = model("iPhone 17 Pro");
    expect(p.screen.px).toEqual([1206, 2622]);
    expect(p.screen.scale).toBe(3);
    expect(p.screen.dpi).toBe(460);
    expect(p.body.mm).toEqual([71.9, 150, 8.75]);
  });

  it("gives every Face ID display Apple's continuous corner, fitted as a superellipse — and the home-button phones a square LCD and a button", () => {
    for (const m of PHONES) {
      if (m.home) {
        expect(m.screen.corner, m.name).toBeNull();
        expect(m.cutout.kind).toBe("none");
        expect(m.home.diameter).toBeGreaterThan(9.5);
        expect(m.home.diameter).toBeLessThan(12);
        expect(m.body.bezel[1]).toBeGreaterThan(15); // the tall top and bottom bezels
        continue;
      }
      const c = m.screen.corner;
      expect(c, m.name).not.toBeNull();
      if (!c) continue;
      expect(c.r45).toBeGreaterThan(6);
      expect(c.r45).toBeLessThan(11.5);
      expect(c.n).toBeGreaterThan(2.3);
      expect(c.n).toBeLessThan(2.85);
      // a continuous corner starts further along the edge than a circle of its 45° radius would
      expect(c.extent / c.r45).toBeGreaterThan(1.15);
      expect(c.extent / c.r45).toBeLessThan(1.35);
      // the body's corner is concentric: the display's grown by the border
      expect(m.body.corner.r45).toBeGreaterThan(c.r45);
    }
    // the corners grew: the X's 39 pt, the 17 Pro's 62
    const pt = (name: string) => {
      const m = model(name);
      return (m.screen.corner?.r45 ?? 0) / ((m.screen.scale * 25.4) / m.screen.dpi);
    };
    expect(pt("iPhone X")).toBeCloseTo(39.3, 0);
    expect(pt("iPhone 17 Pro")).toBeCloseTo(62.1, 0);
  });

  it("cuts the display round a notch on X → 14 and the e's, and puts the island on the 14 Pro onward, as measured from real frames", () => {
    const kind = (name: string) => model(name).cutout.kind;
    for (const n of [
      "iPhone X",
      "iPhone Xʀ",
      "iPhone 11",
      "iPhone 12 mini",
      "iPhone 13",
      "iPhone 14",
      "iPhone 16e",
      "iPhone 17e",
    ])
      expect(kind(n), n).toBe("notch");
    for (const n of [
      "iPhone 14 Pro",
      "iPhone 15",
      "iPhone 16 Pro Max",
      "iPhone 17",
      "iPhone 17 Pro",
      "iPhone Air",
    ])
      expect(kind(n), n).toBe("island");
    // the 13's notch is a fifth narrower than the 12's
    const half = (name: string) => {
      const c = model(name).cutout;
      return c.kind === "notch" ? c.half : 0;
    };
    expect(half("iPhone 13") / half("iPhone 12")).toBeCloseTo(0.78, 1);
    // the island, in points: 125.33 × 36.67 at 14 on the 17 Pro, 20 on the Air, 11.33 on the 15 Pro
    const isl = (name: string) => {
      const m = model(name);
      const c = m.cutout;
      const p = (m.screen.scale * 25.4) / m.screen.dpi;
      return c.kind === "island" ? [c.width / p, c.height / p, c.top / p] : [];
    };
    expect(isl("iPhone 17 Pro").map((v) => Math.round(v * 100) / 100)).toEqual([125.33, 36.67, 14]);
    expect(isl("iPhone Air")[2]).toBeCloseTo(20, 2);
    expect(isl("iPhone 15 Pro")[2]).toBeCloseTo(11.33, 2);
    expect(model("iPhone 17e").assumed).toBe(true);
  });

  it("paints a white front only on the silver, gold and rose home-button phones (and the 7's red) — every finish a colour", () => {
    for (const m of PHONES)
      for (const f of m.finishes)
        if (SIMULATOR_FINISHES[f]?.front === "white")
          expect(m.home, `${m.name} · ${f}`).not.toBeNull();
    for (const f of Object.values(SIMULATOR_FINISHES))
      expect(() => cssColor(f.css, { strict: true })).not.toThrow();
    const look = phoneLook(kindPalette(productPalette.light));
    expect(look.finishes["silver-8"]?.white).toBe(1);
    expect(look.finishes["cosmic-orange"]?.white).toBe(0);
  });

  it("lays every model out with no two touching — each at its true size: the Pro Max a third longer than the first SE", () => {
    const spots = lineup(PHONES, 0, 0, 11, 40);
    expect(spots).toHaveLength(42);
    const box = (s: (typeof spots)[number]) => ({
      x0: s.x - (s.model.body.mm[0] * MM) / 2,
      x1: s.x + (s.model.body.mm[0] * MM) / 2,
      y0: s.y - (s.model.body.mm[1] * MM) / 2,
      y1: s.y + (s.model.body.mm[1] * MM) / 2,
    });
    const boxes = spots.map(box);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const c = boxes[j];
        if (a === undefined || c === undefined) throw new Error("a spot went missing");
        expect(
          a.x1 <= c.x0 || c.x1 <= a.x0 || a.y1 <= c.y0 || c.y1 <= a.y0,
          `${spots[i]?.model.name} · ${spots[j]?.model.name}`,
        ).toBe(true);
      }
    // oldest first, as the catalog keeps them
    expect(spots.map((s) => s.model)).toEqual([...PHONES]);
    expect(sdBody(shapeOf(model("iPhone 17 Pro Max")), 0, 0)).toBeLessThan(
      sdBody(shapeOf(model("iPhone SE (1st generation)")), 0, 0),
    );
    expect(
      model("iPhone 17 Pro Max").body.mm[1] / model("iPhone SE (1st generation)").body.mm[1],
    ).toBeCloseTo(1.32, 2);
  });

  it("draws at ONE scale (the PT-S design §6 Q-1): the note's 2.6247 units a millimetre — a 17 Pro is 189 × 394", () => {
    expect(MM).toBeCloseTo(2.6247, 4);
    const S = shapeOf(DEFAULT_PHONE);
    expect(Math.round(2 * S.half[0])).toBe(189);
    expect(Math.round(2 * S.half[1])).toBe(394);
  });

  it("draws an id this build's catalog lacks as the default, and keeps a finish to its model's own launch colours", () => {
    expect(modelOf("com.apple.CoreSimulator.SimDeviceType.iPhone-99")).toBe(DEFAULT_PHONE);
    expect(modelOf(model("iPhone 8").id)).toBe(model("iPhone 8"));
    expect(phoneById("not a device")).toBeUndefined();
    expect(finishOf(model("iPhone 8"), "silver-8")).toBe("silver-8");
    expect(finishOf(model("iPhone 8"), "cosmic-orange")).toBe("space-gray-8");
    expect(finishOf(model("iPhone 8"), "")).toBe("space-gray-8");
  });
});

describe("the shapes — what the shader and the hit-test both draw", () => {
  it("draws Apple's corner: the curve through its 45° point, straight edges exact, a distance that moves at one unit per unit", () => {
    const [hx, hy, a, n] = [30, 60, 13.158, 2.67];
    expect(sdSquircle(hx, 0, hx, hy, a, n)).toBeCloseTo(0, 9);
    expect(sdSquircle(0, -hy, hx, hy, a, n)).toBeCloseTo(0, 9);
    expect(sdSquircle(0, 0, hx, hy, a, n)).toBeLessThan(0);
    expect(sdSquircle(hx + 5, 0, hx, hy, a, n)).toBeCloseTo(5, 9);
    // on the diagonal the curve sits a(1 − 2^(−1/n)) in from the corner
    const t = a * (1 - 2 ** (-1 / n));
    expect(sdSquircle(hx - t, hy - t, hx, hy, a, n)).toBeCloseTo(0, 6);
    // near the outline the field is a distance: its gradient is 1 within a few per cent
    for (const [x, y] of [
      [hx - 2, hy - 2],
      [hx - 4, hy - 1],
      [hx - 1, hy - 5],
      [hx, hy - 20],
    ] as const) {
      const e = 1e-4;
      const g =
        Math.hypot(
          sdSquircle(x + e, y, hx, hy, a, n) - sdSquircle(x - e, y, hx, hy, a, n),
          sdSquircle(x, y + e, hx, hy, a, n) - sdSquircle(x, y - e, hx, hy, a, n),
        ) /
        (2 * e);
      expect(g).toBeGreaterThan(0.97);
      expect(g).toBeLessThan(1.06);
    }
  });

  it("cuts the sensor housing out of the lit display: the notch from its top edge, the island's pill below it — and nothing on a home-button phone", () => {
    const x = shapeOf(model("iPhone X"));
    expect(sdDisplay(x, 0, -x.display[1] + 1)).toBeGreaterThan(0); // the notch's middle is not display
    expect(sdDisplay(x, x.display[0] * 0.8, -x.display[1] + 3)).toBeLessThan(0); // the ears are
    const p = shapeOf(model("iPhone 17 Pro"));
    const pill = p.housing.pill;
    expect(pill).not.toBeNull();
    const y = -p.display[1] + (pill?.top ?? 0) + (pill?.hh ?? 0);
    expect(sdHousing(p, 0, y)).toBeLessThan(0);
    expect(sdDisplay(p, 0, y)).toBeGreaterThan(0); // the island is the body's glass, not lit display
    expect(sdDisplay(p, 0, -p.display[1] + 1)).toBeLessThan(0); // above it, the display runs to its top edge
    const eight = shapeOf(model("iPhone 8"));
    for (const [u, v] of [
      [0, -eight.display[1] + 0.5],
      [0, 0],
      [eight.display[0] * 0.9, -eight.display[1] * 0.9],
    ] as const)
      expect(sdHousing(eight, u, v)).toBeGreaterThan(1e8);
  });

  it("falls the rim from the glass to the outline: flat past it, its full fall at the outline, never rising outward", () => {
    for (const name of [
      "iPhone 8",
      "iPhone 12 Pro",
      "iPhone 17 Pro",
      "iPhone SE (1st generation)",
    ]) {
      const S = shapeOf(model(name));
      expect(rimAt(S, S.rim[0] + 1)).toEqual([0, 0]);
      expect(rimAt(S, 0)[0]).toBeCloseTo(-S.rim[1], 2);
      let prev = Number.NEGATIVE_INFINITY;
      for (let d = 0; d <= S.rim[0]; d += S.rim[0] / 50) {
        const [w, slope] = rimAt(S, d);
        expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(slope).toBeGreaterThanOrEqual(0);
        prev = w;
      }
    }
  });

  it("names in the shader only the records' own fields, and bisects the rim and fades the housing as the law does", () => {
    const wgsl =
      readFileSync(resolve(PKG, "src/phone.wgsl"), "utf8") +
      readFileSync(resolve(PKG, "src/phone-pass.wgsl"), "utf8");
    const fields = (def: { readonly wgsl: string }) =>
      new Set([...def.wgsl.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]));
    const P = fields(Phone);
    const K = fields(PhoneUniforms);
    for (const m of wgsl.matchAll(/\bP\.(\w+)/g))
      expect(P.has(m[1] as string), `P.${m[1]}`).toBe(true);
    for (const m of wgsl.matchAll(/\bk\.(\w+)/g))
      expect(K.has(m[1] as string), `k.${m[1]}`).toBe(true);
    expect(Number(/const RIM_STEPS = (\d+)/.exec(wgsl)?.[1])).toBe(RIM_STEPS);
    expect(Number(/const HOUSING_FADE = ([\d.]+)/.exec(wgsl)?.[1])).toBe(HOUSING_FADE);
  });
});

describe("the pose — resting on its camera, carried by core's drag on the desk's springs", () => {
  it("rests on the camera: its top lifted by the bump, pitched about its bottom edge — and lies flat when told to", () => {
    const { S, rect } = rest("iPhone 17 Pro");
    const G = resolvePhone(rect, FLUX_REST, S);
    const pitch = restPitch(S);
    expect(pitch).toBeGreaterThan(0.01);
    expect(pitch).toBeLessThan(0.04);
    expect(G.ey[2]).toBeLessThan(0); // down the screen is downhill
    expect(G.centre[2]).toBeCloseTo(S.thick + pitch * S.half[1], 1); // the glass's centre, half the climb up
    // the bottom edge is on the mat; the top edge is up by about the bump
    const bottom = pointAt(G, 0, S.half[1], -S.thick);
    const top = pointAt(G, 0, -S.half[1], -S.thick);
    expect(bottom[2]).toBeCloseTo(0, 1);
    expect(top[2]).toBeGreaterThan(S.bump[0]);
    expect(top[2]).toBeLessThan(S.bump[0] * 1.4);
    const flat = resolvePhone(rect, FLUX_REST, S, undefined, { ...PHONE, rest: 0 });
    for (const [i, v] of flat.n.entries()) expect(v).toBeCloseTo([0, 0, 1][i] ?? 0, 12);
    expect(flat.centre[2]).toBeCloseTo(S.thick, 9);
  });

  it("rises by the desk's flux to its lift's height — the pitch let go, square to the mat, over its rect — and a hair under the pointer", () => {
    const { S } = rest("iPhone 8");
    const rect = { cx: 300, cy: 200 };
    const G = resolvePhone(rect, { lift: 1, hover: 0, fade: 1 }, S);
    expect(G.centre[2]).toBeCloseTo(PHONE.lift.height + S.thick, 9);
    for (const [i, v] of G.n.entries()) expect(v).toBeCloseTo([0, 0, 1][i] ?? 0, 12);
    for (const [i, v] of G.ex.entries()) expect(v).toBeCloseTo([1, 0, 0][i] ?? 0, 12);
    expect(G.centre[0]).toBeCloseTo(rect.cx, 9);
    expect(G.centre[1]).toBeCloseTo(rect.cy, 9);
    // a lifted phone grows toward the eye over it
    expect(silhouetteOf(G).hx).toBeGreaterThan(silhouetteOf(resolvePhone(rect, FLUX_REST, S)).hx);
    const hover = resolvePhone(rect, { lift: 0, hover: 1, fade: 1 }, S, undefined, {
      ...PHONE,
      rest: 0,
    });
    expect(hover.centre[2]).toBeCloseTo(PHONE.lift.hover + S.thick, 9);
  });

  it("measures a quad that holds the phone as seen, its shadow and its glow", () => {
    const { S } = rest("iPhone 17 Pro Max");
    const G = resolvePhone({ cx: 500, cy: -300 }, lifted(20), S, undefined, PHONE, 150);
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const [x, y] = seen(G.eye, pointAt(G, u * S.half[0], v * S.half[1]));
      expect(x).toBeGreaterThan(G.bounds.x0 + 150);
      expect(x).toBeLessThan(G.bounds.x1 - 150);
      expect(y).toBeGreaterThan(G.bounds.y0 + 150);
      expect(y).toBeLessThan(G.bounds.y1 - 150);
    }
  });

  it("reaches past its rect by its shadow, its glow and the largest model's overhang — the cull never cuts a Pro Max on a 17 Pro's rect", () => {
    expect(overhang()).toBeCloseTo(((163.4 - 150) / 2) * MM, 6);
    const G = resolvePhone(
      { cx: 0, cy: 0 },
      { lift: 1, hover: 0, fade: 1 },
      shapeOf(model("iPhone 17 Pro Max")),
      undefined,
      PHONE,
      0,
    );
    const half = shapeOf(DEFAULT_PHONE).half;
    const reach = phoneReach();
    expect(G.bounds.x1).toBeLessThan(half[0] + reach);
    expect(G.bounds.y1).toBeLessThan(half[1] + reach);
    expect(-G.bounds.x0).toBeLessThan(half[0] + reach);
    expect(-G.bounds.y0).toBeLessThan(half[1] + reach);
  });
});

describe("the ray — what you touch is what is drawn", () => {
  it("finds the very point of the glass an eye sees at a desk point: resting, lifted, from an eye off to the side", () => {
    for (const [name, cx, cy, h] of [
      ["iPhone 17 Pro", 0, 0, 0],
      ["iPhone 8", 420, -260, 0],
      ["iPhone 13 mini", -380, 300, 22],
      ["iPhone Air", 900, 700, 5],
    ] as const) {
      const S = shapeOf(model(name));
      const G = resolvePhone({ cx, cy }, lifted(h), S);
      for (const e of [view(100, 50), G.eye]) {
        for (const [u, v] of [
          [0, 0],
          [S.display[0] * 0.7, -S.display[1] * 0.8],
          [-S.display[0] * 0.9, S.display[1] * 0.5],
        ] as const) {
          const [dx, dy] = seen(e, pointAt(G, u, v));
          const hit = castPhone(G, dx, dy, PHONE, e);
          expect(hit?.part, name).toBe("glass");
          expect(Math.hypot((hit?.u ?? 1e9) - u, (hit?.v ?? 1e9) - v), name).toBeLessThan(1e-6);
          const [gu, gv] = glassPoint(G, dx, dy, e);
          expect(Math.hypot(gu - u, gv - v)).toBeLessThan(1e-6);
        }
        expect(castPhone(G, cx + S.half[0] * 3, cy + S.half[1] * 3, PHONE, e)).toBeNull();
      }
    }
  });

  it("maps the glass to the device's points and back — a tap on the screen's middle is the screen's middle", () => {
    const { S, rect } = rest("iPhone 17 Pro");
    const G = resolvePhone(rect, FLUX_REST, S);
    const [cx, cy] = seen(G.eye, pointAt(G, 0, 0));
    const pick = pickPhone(G, cx, cy);
    expect(pick?.part).toBe("screen");
    if (pick?.part === "screen") {
      expect(pick.point[0]).toBeCloseTo(201, 6);
      expect(pick.point[1]).toBeCloseTo(437, 6);
    }
    for (const [x, y] of [
      [0, 0],
      [402, 874],
      [37.5, 812],
    ] as const) {
      const [u, v] = glassOf(S, x, y);
      const [x2, y2] = devicePoint(S, u, v);
      expect(x2).toBeCloseTo(x, 9);
      expect(y2).toBeCloseTo(y, 9);
    }
    // the island is not the screen: a tap on it is the body's
    const pill = S.housing.pill;
    const [ix, iy] = seen(G.eye, pointAt(G, 0, -S.display[1] + (pill?.top ?? 0) + (pill?.hh ?? 0)));
    expect(pickPhone(G, ix, iy)?.part).toBe("body");
  });

  it("sees the side that faces an eye: a flat phone's wall on the near side, a round phone's never", () => {
    for (const [name, wall] of [
      ["iPhone 12", true],
      ["iPhone 8", false],
    ] as const) {
      const S = shapeOf(model(name));
      const e = view(0, 0);
      const G = resolvePhone({ cx: 900, cy: 0 }, FLUX_REST, S, undefined, { ...PHONE, rest: 0 });
      // just inside the base's outline on the side facing the eye (the phone's left, toward the view's centre)
      const hit = castPhone(G, 900 - S.half[0] + 0.3, 0, PHONE, e);
      if (wall) expect(hit?.part, name).toBe("wall");
      else expect(hit === null || hit.part !== "wall", name).toBe(true);
      expect(silhouetteDepth(G, 900, 0, e)).toBeGreaterThan(0);
      expect(silhouetteDepth(G, 900 + S.half[0] * 2, 0, e)).toBeLessThan(0);
    }
  });
});

describe("the stream — asked for what the desk needs, no more", () => {
  const { S, rect } = rest("iPhone 17 Pro");
  const G = resolvePhone(rect, FLUX_REST, S);

  it("asks for the halving that covers the display's pixels, at a rate by its place — and the native size at full rate in use", () => {
    const at = (zoom: number, focused = false, x = 0) =>
      screenDemand(G, view(x, 0, zoom), 2, focused);
    const z1 = at(1);
    expect(z1.width).toBe(603);
    expect(z1.height).toBe(1311);
    expect(z1.fps).toBe(30);
    const far = at(0.3);
    expect(far.width).toBe(Math.round(1206 / 8));
    expect(far.fps).toBe(12);
    const inUse = at(2.2, true);
    expect(inUse.width).toBe(1206);
    expect(inUse.fps).toBe(60);
    // in use it is the native framebuffer at any zoom, even where a halving would cover the display
    expect(at(1.2, true).width).toBe(1206);
    const away = at(1, false, 5000);
    expect(away.visible).toBe(false);
    expect(away.fps).toBe(0);
  });

  it("keeps the rung it sends while it still covers the display and is not 2.3× more — a wobbling zoom flips no sizes", () => {
    const at = (zoom: number, held?: number) =>
      screenDemand(G, view(0, 0, zoom), 2, false, PHONE, held).width;
    // just past the rung boundary the fresh answer halves; the held one stays
    const z = 0.8;
    expect(at(z)).toBe(302);
    expect(at(z, 603)).toBe(603);
    // but not once the display has shrunk to under 1/2.3 of it, nor when the held rung no longer covers it
    expect(at(0.35, 603)).toBe(at(0.35));
    expect(at(1.9, 603)).toBe(1206);
  });

  it("asks the same over the SIGHT as through the desk eye: paused unseen, native at 60 in hand, the rung and rate at rest", () => {
    const native = S.model.screen.px;
    expect(phoneDemand({ seen: false, px: [0, 0], held: false }, native)).toEqual({
      mode: "paused",
      fps: 0,
      raster: [0, 0],
      interactive: false,
    });
    expect(phoneDemand({ seen: true, px: [400, 870], held: true }, native)).toEqual({
      mode: "live",
      fps: 60,
      raster: [1206, 2622],
      interactive: true,
    });
    for (const zoom of [0.3, 0.8, 1, 1.9]) {
      const e = view(0, 0, zoom);
      const eyeAsk = screenDemand(G, e, 2, false);
      const px = Math.round(2 * S.display[0] * zoom * 2);
      const sightAsk = phoneDemand(
        { seen: true, px: [px, Math.round(px * 2.17)], held: false },
        native,
      );
      expect(sightAsk.mode).toBe("live");
      expect(sightAsk.fps).toBe(eyeAsk.fps);
      // (the sight measures the display flat; the eye magnifies it a hair: the same rung)
      expect(sightAsk.raster[0]).toBe(eyeAsk.width);
      // and a rung held through the wobble, as the eye's is
      expect(
        phoneDemand({ seen: true, px: [px, px * 2], held: false }, native, 603).raster[0],
      ).toBe(screenDemand(G, e, 2, false, PHONE, 603).width);
    }
  });

  it("reads the frame at the level its pixels need: none magnified, more the smaller it is", () => {
    const lodAt = (zoom: number) => screenLod(G, view(0, 0, zoom), 1206, 2);
    expect(lodAt(4)).toBe(0);
    expect(lodAt(1)).toBeGreaterThan(1);
    expect(lodAt(1)).toBeLessThan(2);
    expect(lodAt(0.25)).toBeGreaterThan(lodAt(1) + 1.9);
  });

  it("turns a landscape frame onto the portrait glass by quarter turns that undo each other", () => {
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0.25, 0.75],
    ] as const) {
      for (let q = 0; q < 4; q++) {
        const [a, b] = frameUv(u, v, q);
        const [c, d] = frameUv(a, b, 4 - q === 4 ? 0 : 4 - q);
        expect(c).toBeCloseTo(u, 12);
        expect(d).toBeCloseTo(v, 12);
      }
    }
  });
});

describe("the morph — any model into any other, and nothing pops (PHONE.md §13)", () => {
  const S = (name: string) => shapeOf(model(name));
  /** What the pass draws of a shape, sampled over a grid on its body: the outline, the lit display, the housing, the buttons — each clamped to the band where it can show (a housing's field is read from its fade down, where a going one ends). */
  const drawn = (sh: PhoneShape, hx: number, hy: number): number[] => {
    const out: number[] = [];
    const c = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    for (let i = 0; i <= 12; i++)
      for (let j = 0; j <= 24; j++) {
        const u = (i / 12 - 0.5) * 2.2 * hx;
        const v = (j / 24 - 0.5) * 2.2 * hy;
        out.push(
          c(sdBody(sh, u, v), -10, 10),
          c(sdDisplay(sh, u, v), -10, 10),
          c(sdHousing(sh, u, v), -10, HOUSING_FADE),
          c(sdButtons(sh, u, v), -10, 10),
        );
      }
    // the rim's height (its slope has a crease where a chamfer's facet meets the glass — a moving edge, not a pop)
    for (const d of [0, 0.5, 1, 2, 4, 7]) out.push(rimAt(sh, d)[0]);
    return out;
  };
  const PAIRS: [string, string][] = [
    ...PHONES.slice(1).map((m, i) => [PHONES[i]?.name ?? "", m.name] as [string, string]),
    ["iPhone 8", "iPhone 17 Pro Max"],
    ["iPhone SE (1st generation)", "iPhone Air"],
    ["iPhone X", "iPhone 14 Pro"],
    ["iPhone 17 Pro", "iPhone 6s"],
    ["iPhone 13 mini", "iPhone 16 Pro Max"],
    ["iPhone 11", "iPhone 12 mini"],
    ["iPhone 14 Plus", "iPhone 14 Pro"],
    ["iPhone 15 Pro", "iPhone SE (3rd generation)"],
  ];

  it("is each model at its ends — A at 0 and B at 1, the very objects — and moves every track only in its own window", () => {
    const A = S("iPhone 8");
    const B = S("iPhone X");
    expect(mixShape(A, B, morphTracks(0))).toBe(A);
    expect(mixShape(A, B, morphTracks(1))).toBe(B);
    expect(shapeOf(model("iPhone 8"))).toBe(A); // made once a model
    const W = PHONE.morph.tracks;
    const names = Object.keys(W) as (keyof typeof W)[];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const k = morphTracks(t);
      for (const name of names) {
        const w = W[name];
        if (t <= w.from) expect(k[name], `${name} @ ${t}`).toBe(0);
        if (t >= w.to) expect(k[name], `${name} @ ${t}`).toBe(1);
      }
      if (i > 0) {
        const p = morphTracks((i - 1) / 100);
        for (const name of names) expect(k[name]).toBeGreaterThanOrEqual(p[name]);
      }
    }
  });

  it("never pops: morphing a model into its neighbour, or into one a decade away, moves everything drawn continuously — staged or not", () => {
    const steps = 240;
    let worst = 0;
    let where = "";
    let pops = 0;
    let pop = "";
    let refined = 0;
    for (const [a, b] of PAIRS) {
      const A = S(a);
      const B = S(b);
      const hx = Math.max(A.half[0], B.half[0]);
      const hy = Math.max(A.half[1], B.half[1]);
      for (const staged of [true, false]) {
        const at = (t: number) => drawn(mixShape(A, B, morphTracks(t, staged)), hx, hy);
        let prev = at(0);
        let d1: number[] = [];
        let d2: number[] = [];
        let fine: number[][] | null = null;
        for (let i = 1; i <= steps; i++) {
          const now = at(i / steps);
          const d0 = now.map((v, j) => Math.abs(v - (prev[j] ?? 0)));
          d0.forEach((d, j) => {
            if (d > worst) {
              worst = d;
              where = `${a} → ${b} ${staged ? "staged" : "unstaged"} @ ${i}/${steps}, sample ${j}`;
            }
            // a step much larger than the steps either side of it is a pop — or a smooth dip the samples straddle: refine
            // it 32 times over, and a continuous change spreads across the sub-steps where a jump stays whole in one
            const m = d1[j];
            if (m !== undefined && m > 0.25 && m > 3 * Math.max(d, d2[j] ?? 0)) {
              refined++;
              fine ??= Array.from({ length: 33 }, (_, q) => at((i - 2 + q / 32) / steps));
              let sub = 0;
              for (let q = 1; q <= 32; q++)
                sub = Math.max(sub, Math.abs((fine[q]?.[j] ?? 0) - (fine[q - 1]?.[j] ?? 0)));
              if (sub > 0.5 * m) {
                pops++;
                pop ||= `${a} → ${b} ${staged ? "staged" : "unstaged"} @ ${i - 1}/${steps}, sample ${j}: ${m.toFixed(3)} in one step of 32`;
              }
            }
          });
          d2 = d1;
          d1 = d0;
          prev = now;
          fine = null;
        }
      }
    }
    // the largest honest step: the first SE's screen growing 31 mm into the Air's in half the morph (1.28 a step); a pop is a feature's size
    expect(worst, where).toBeLessThan(2);
    expect(pops, pop).toBe(0);
    expect(refined).toBeLessThan(20); // two dips, the prototype's build
  }, 60_000);

  it("pinches the notch off the display's top edge into the island — once — its ears closing as it goes", () => {
    const A = S("iPhone 14 Plus");
    const B = S("iPhone 14 Pro");
    let attached = 0;
    let detached = 0;
    let flips = 0;
    let last: boolean | null = null;
    let ears = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 400; i++) {
      const sh = mixShape(A, B, morphTracks(i / 400, false));
      // just under the display's top edge, in its middle: housing (the notch's root) or lit display (the island has let go)
      const root = sdDisplay(sh, 0, -sh.display[1] + 0.3) > 0;
      if (last !== null && root !== last) flips++;
      last = root;
      if (root) attached++;
      else detached++;
      // the pill's middle is housing all the way
      const pill = B.housing.pill;
      expect(sdHousing(sh, 0, -sh.display[1] + (pill?.top ?? 0) + (pill?.hh ?? 0))).toBeLessThan(0);
      expect(sh.housing.ear).toBeLessThanOrEqual(ears + 1e-12);
      ears = sh.housing.ear;
    }
    expect(flips).toBe(1);
    expect(attached).toBeGreaterThan(150);
    expect(detached).toBeGreaterThan(60); // it lets go about three quarters of the way
    expect(ears).toBe(0);
  });

  it("grows a housing from nothing and closes the home button into its centre — on the border, the screen growing over where it was", () => {
    const A = S("iPhone 8");
    const B = S("iPhone X");
    const look = phoneLook(kindPalette(productPalette.light));
    let hp = 0;
    let cp = 1;
    for (let i = 0; i <= 200; i++) {
      const sh = mixShape(A, B, morphTracks(i / 200));
      expect(sh.housing.presence).toBeGreaterThanOrEqual(hp);
      expect(sh.classic.presence).toBeLessThanOrEqual(cp);
      hp = sh.housing.presence;
      cp = sh.classic.presence;
      const G = resolvePhone({ cx: 0, cy: 0 }, FLUX_REST, sh);
      const rec = phoneValues({
        geometry: G,
        finish: { band: [0.5, 0.5, 0.5], front: [0, 0, 0], white: 0, polish: 0 },
        look,
        screen: SCREEN_OFF,
        mark: "none",
      });
      // the button's drawn radius is its radius × its presence: it closes to a point as it goes
      expect(rec.classic[1]).toBeCloseTo(sh.classic.home[1] * sh.classic.presence, 12);
    }
    expect(hp).toBe(1);
    expect(cp).toBe(0);
    // before it arrives, no pixel of it: a housing at presence ε is a point sunk HOUSING_FADE under the glass
    const early = mixShape(A, B, morphTracks(0.42));
    expect(early.housing.presence).toBeGreaterThan(0);
    expect(early.housing.presence).toBeLessThan(0.02);
    for (let j = 0; j <= 40; j++)
      expect(sdHousing(early, (j / 40 - 0.5) * 20, -early.display[1] + 0.2)).toBeGreaterThan(
        HOUSING_FADE * 0.95,
      );
  });

  it("keeps the in-between screen iOS would lay out at the display's own aspect — so a tap mid-morph lands on the point drawn under it", () => {
    for (const [a, b] of PAIRS.slice(-8)) {
      for (const t of [0.2, 0.5, 0.77]) {
        const sh = mixShape(S(a), S(b), morphTracks(t));
        expect(sh.points[0] / sh.points[1]).toBeCloseTo(sh.display[0] / sh.display[1], 12);
        expect(devicePoint(sh, 0, 0)[0]).toBeCloseTo(sh.points[0] / 2, 9);
        const G = resolvePhone({ cx: 120, cy: -40 }, lifted(6), sh);
        for (const e of [view(0, 0), G.eye]) {
          for (const [u, v] of [
            [0, 0],
            [sh.display[0] * 0.6, sh.display[1] * 0.7],
            [-sh.display[0] * 0.8, -sh.display[1] * 0.5],
          ] as const) {
            const [dx, dy] = seen(e, pointAt(G, u, v));
            const hit = castPhone(G, dx, dy, PHONE, e);
            expect(hit?.part, `${a} → ${b} @ ${t}`).toBe("glass");
            expect(Math.hypot((hit?.u ?? 1e9) - u, (hit?.v ?? 1e9) - v)).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it("walks the history in order: at each whole step it is that model; between two, their blend", () => {
    PHONES.forEach((m, i) => {
      expect(historyShape(i).shape, m.name).toBe(shapeOf(m));
    });
    const h = historyShape(5.5);
    expect(h.from.name).toBe("iPhone 8");
    expect(h.to.name).toBe("iPhone X");
    expect(h.f).toBeCloseTo(0.5, 12);
    expect(h.shape.half[1]).toBeGreaterThan(S("iPhone 8").half[1]);
    expect(h.shape.half[1]).toBeLessThan(S("iPhone X").half[1]);
    expect(historyShape(-3).shape).toBe(shapeOf(PHONES[0] ?? DEFAULT_PHONE));
    expect(historyShape(99).shape).toBe(shapeOf(PHONES[PHONES.length - 1] ?? DEFAULT_PHONE));
  });

  it("fills the display with a frame of another aspect — cropped evenly, never stretched — and blends two finishes along the material track", () => {
    expect(cropOf(0.46, 0.46)).toEqual([1, 1]);
    for (const [ad, af] of [
      [0.56, 0.46],
      [0.46, 0.56],
      [0.5, 0.461],
    ] as const) {
      const [sx, sy] = cropOf(ad, af);
      expect(Math.max(sx, sy)).toBe(1);
      // the picture's part shown has the display's aspect: nothing is stretched
      expect((sx * af) / sy).toBeCloseTo(ad, 12);
    }
    const a = { band: [1, 0, 0] as const, front: [0, 0, 0] as const, white: 0, polish: 0 };
    const b = { band: [0, 0, 1] as const, front: [1, 1, 1] as const, white: 1, polish: 1 };
    expect(mixFinish(a, b, 0).band).toEqual([1, 0, 0]);
    expect(mixFinish(a, b, 1).front).toEqual([1, 1, 1]);
    expect(mixFinish(a, b, 0.5)).toEqual({
      band: [0.5, 0, 0.5],
      front: [0.5, 0.5, 0.5],
      white: 0.5,
      polish: 0.5,
    });
  });
});
