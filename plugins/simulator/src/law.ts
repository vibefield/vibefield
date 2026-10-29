// THE PHONE'S LAW — pure: no GPU (PHONE.md; the prototype's draft/ground src/phone/phone.ts, moved). An iPhone lying face up
// on the desk: a slab of glass and metal with a live screen, drawn at its true size among the desk's objects (the note's
// scale: a 17 Pro is 189 × 394), seen from an eye above it — a point h up lands at E + (p − E)·H/(H − h) — so a lifted
// phone grows toward you. It is not flat even at rest: it lies on its camera, its top end lifted a few millimetres off the
// mat, pitched about its bottom edge (`rest`).
//
// What moved from the prototype, and what it became here (the browser pane's PT-1 rulings, which a plugin kind on this
// desk keeps):
//  - THE EYE: the LOCAL eye (the pane's ruling 3) — over the phone's own centre, as high as the desk eye stands over a view
//    that frames it, never the view's: the record is camera-free and the desk reuses it across a pan (ICE design-015 §2
//    law 5). What is lost: a phone off to the side no longer shows the band on its side facing the view's centre.
//  - THE HAND: core's drag (the pane's ruling 4) — the phone rises by the desk's flux (`lift` while carried, `hover` under
//    the pointer, both on the builder's springs — the one physics), and is never tipped toward the fingers nor turned:
//    the prototype's own hand (the photo's body) pinned the grab point under the finger as the eye saw it.
//  - THE RECT IS ITS ANCHOR: the phone is its MODEL's size, centred on its rect (the type's size is the default model's
//    body); `reach` holds the largest model's overhang, so a 17 Pro Max drawn on a 17 Pro's rect is never culled short.
//  - THE LIGHT: the desk's one lamp arrives per object (`ctx.lamp`); the kit's `PHYSICS` gives the penumbra at contact,
//    the slope's cap and the lamp's fill on a face.
//  - THE DEMAND: re-based on the SIGHT (ICE design-019 §3.4 — what the desk says it drew of the display), as the pane's
//    is; the prototype's eye-based form stays beside it (`screenDemand`), the same law.
// `resolvePhone` turns a rect, its flux, a shape and the lamp into the GEOMETRY the pass draws; `castPhone` is the CPU
// mirror of phone.wgsl's ray — the same superellipse corners, the same rim, the same wall — so what is picked is what is
// drawn. World units are the desk's: CSS px at zoom 1. Axes: x right, y down the screen, z up off the mat.
//
// A model's SHAPE is continuous in every number: what a model has or has not — a notch, an island, a home button, a round
// side, a steel band — is a size or a weight, never a switch. So any shape blends into any other (`mixShape`, PHONE.md
// §13): a phone becoming another model MORPHS, and the notch pinches off the display's top edge into the island.

import {
  DEFAULT_GRID,
  type DeskEye,
  type Lamp,
  lampOf,
  type ObjectFlux,
  type ObjectRect,
  PHYSICS,
} from "@vibefield/plugin-sdk/desk";
import { PHONES } from "./catalog.gen";
import { DEFAULT_MODEL } from "./ids";
import type { Corner, Cutout, PhoneModel } from "./model";

/**
 * World units per millimetre — THE DESK'S ONE SCALE for the phone (the PT-S design §6 Q-1, ruled 2026-10-18: the note's and
 * the print's scale; a 200-unit note is a 3″ (76.2 mm) square, so 2.6247 units a millimetre and a 17 Pro is 189 × 394).
 * One named constant: a change of the desk's scale is this line.
 */
export const MM = 200 / 76.2;

/** The desk's ONE light as a law's default (the kit's `lampOf` over the desk's own plane); a drawn phone reads `ctx.lamp`. */
export const LAMP: Lamp = lampOf(DEFAULT_GRID.mat.plane);

type Widen<T> = T extends number
  ? number
  : T extends boolean
    ? boolean
    : T extends string
      ? string
      : T extends readonly (infer E)[]
        ? readonly Widen<E>[]
        : { -readonly [K in keyof T]: Widen<T[K]> };

const PHONE_SPEC = {
  /**
   * The EYE. `k` and `min` are the desk eye's (the kit's `eyeOf`: over the view's centre, `k` view-diagonals up, never
   * nearer than `min` — PHONE.md's). The LOCAL eye a phone is drawn and picked from stands over its own centre as high as
   * the desk eye stands over a view that frames it — `frame` times the phone's own diagonal (the pane's 1.7) — so a phone
   * is seen from the floor, 1250 up, as the prototype saw one at zoom 1.
   */
  eye: { k: 1.15, min: 1250, frame: 1.7 },
  /** The LIFT — the desk's flux, a phone's numbers (PHONE.md §7: it rises 26 in the hand, 1.2 under the pointer). */
  lift: { height: 26, hover: 1.2 },
  /** How far the phone rests on its camera: 1 = lying as a real one does (its top lifted by the bump), 0 = flat (PHONE.md Q-3). */
  rest: 1,
  /**
   * The shadow: the desk's one law (the kit's penumbra at contact and its slope's cap; the print's growth per unit of height,
   * 0.36), swept down the slab's height in `steps` like the whiteboard's, with the slab's contact term at its base; the cast
   * colour by day (the palette's `cast`), Eigengrau by night.
   */
  shadow: {
    sigma0: PHYSICS.shadow.sigma,
    perUnit: 0.36,
    alpha: 0.55,
    alphaHeld: 0.5,
    slopeMax: PHYSICS.shadow.slopeMax,
    steps: 6,
    contact: { alpha: 0.45, sigma: 1.3, reach: 2.5 },
  },
  /**
   * The cover glass (DESIGN.md §5.1, the phone's recipes): Fresnel's reflectance head on (glass, 4 %); the lamp's glint
   * (strength, shininess — sharp: it is glass); the canopy the flat glass mirrors, this high over the desk (world); the
   * veil — how much of the sky the glass shows (0.28 of the physics: the desk keeps its screens legible, guardrail 3); the
   * WINDOW — the bright sky round the lamp, this many times the sky (by night this share of it).
   */
  glass: {
    f0: 0.04,
    glint: 2.6,
    shininess: 1400,
    canopy: 240,
    veil: 0.28,
    window: 3.2,
    windowNight: 0.05,
  },
  /** The band's three metals (DESIGN.md §5.1): the diffuse share, the roughness (0 a mirror, 1 matte), the glint's strength. */
  metal: {
    aluminium: { diffuse: 0.6, rough: 0.36, glint: 1.8 },
    steel: { diffuse: 0.12, rough: 0.07, glint: 2.6 },
    titanium: { diffuse: 0.34, rough: 0.24, glint: 2.0 },
  },
  /**
   * The screen's light (DESIGN.md §5.1): the share of the light on the panel it scatters (0.6 %: a black screen in the sun
   * shows the dapple, faintly), its level by night (bright to the eye adapted to the Moon) and by day — and the two dims a
   * STILL of it takes (the pane's, James's): a photograph of the screen 0.7, under a face's words 0.16.
   */
  display: { scatter: 0.006, night: 0.8, day: 1, still: 0.7, stillUnder: 0.16 },
  /**
   * The GLOW by night (PHONE.md §5; DESIGN.md §5.1; James's Q-4): the eye's veiling glare round a bright screen — the
   * display's own shape blurred at two widths (mm), each with its weight — the light it spills on the desk round the phone
   * (a pool this wide, mm, at this strength), and the glass's edge catching the display's light.
   */
  glow: { bloom: [0.06, 0.04], sigma: [3.5, 16], spill: 0.55, spillSigma: 24, edge: 0.45 },
  /**
   * The stream's policy (PHONE.md §6): in use, the native framebuffer at full rate; at rest the halving of native that covers
   * the display's device px (never more than `rungs` halvings down) at 30 while it is ≥ `nearPx` device px wide and 12 below;
   * unseen 0, the last frame held. A rung is held through a wobbling zoom.
   */
  stream: { texelsPerPx: 1, rungs: 3, fps: { focused: 60, near: 30, far: 12 }, nearPx: 240 },
  /** The side buttons stand this far proud of the band and are this tall (mm). */
  button: { proud: 0.55, height: 2 },
  /** The lamp on a face — the kit's one physics (`PHYSICS.light`): the fill a face turned away keeps, how far past flat one turned toward it brightens. */
  lamp: PHYSICS.light,
  /**
   * The marks a still carries (DESIGN.md §5.1, mm): the rest mark's two bars (width, height, centre to centre) and the boot mark's
   * ring (across, thick, the gap at its top in degrees), drawn in the words' ink at `alpha`.
   */
  marks: { bar: [1.4, 6, 2.4], ring: [7, 1.4, 60], alpha: 0.9 },
  /**
   * THE MORPH (PHONE.md §13): a phone becoming another model, every number of its shape eased from one to the other over
   * `ms`. Staged, in five overlapping tracks — each a window of the morph's time, smootherstepped — so the middle reads as a
   * change and not a hybrid: its size first; the screen growing into its border or shrinking out of it (the home button
   * closing with it); its corners and its side's profile; the sensor housing (a notch pinching off the top edge into the
   * island); last its material, the band's metal and the finish's colours.
   */
  morph: {
    ms: 720,
    staged: true,
    tracks: {
      size: { from: 0, to: 0.5 },
      bezels: { from: 0.15, to: 0.65 },
      form: { from: 0.3, to: 0.8 },
      housing: { from: 0.4, to: 0.95 },
      material: { from: 0.55, to: 1 },
    },
  },
} as const;

/** The law with its literals widened — what a host tunes. */
export type PhoneLaw = Widen<typeof PHONE_SPEC>;
/** The phone's numbers. Never written — a host tunes its own copy (`structuredClone(PHONE)`). */
export const PHONE: PhoneLaw = PHONE_SPEC;

// ---------------------------------------------------------------- the catalog

export const phoneById = (id: string): PhoneModel | undefined => PHONES.find((m) => m.id === id);
export const phoneByName = (name: string): PhoneModel | undefined =>
  PHONES.find((m) => m.name === name);

/** The newest Pro — what a phone is when nothing says otherwise (ids.ts `DEFAULT_MODEL`; law.test.ts holds it in the catalog). */
function defaultPhone(): PhoneModel {
  const found = phoneById(DEFAULT_MODEL) ?? PHONES[PHONES.length - 1];
  if (found === undefined)
    throw new Error("simulator: an empty catalog — re-run scripts/make-catalog.ts");
  return found;
}
export const DEFAULT_PHONE: PhoneModel = defaultPhone();

/** The model a `model` prop names — or the default, for an id this build's catalog does not hold (a newer Xcode's). */
export const modelOf = (id: string): PhoneModel => phoneById(id) ?? DEFAULT_PHONE;

/** The finish a phone wears: the one its prop names when it is its model's own launch colour, else its model's first. */
export const finishOf = (m: PhoneModel, name: string): string =>
  m.finishes.includes(name) ? name : (m.finishes[0] ?? name);

// ---------------------------------------------------------------- the shape, in world units

/** A superellipse corner in world units: where the curve starts along each edge, and its exponent. */
export interface WCorner {
  readonly extent: number;
  readonly n: number;
}
const wc = (c: Corner): WCorner => ({ extent: c.extent * MM, n: c.n });

/**
 * THE SENSOR HOUSING — a notch, an island, or on the way from one to the other: ONE shape, the notch's field and the pill's
 * blended (`island`: 0 the notch … 1 the island), so a notch becoming an island narrows, lets go of the display's top edge
 * and rounds into the pill (PHONE.md §13). A housing that is not there (the home-button phones) has `presence` 0; one
 * arriving grows from nothing.
 */
export interface Housing {
  readonly island: number;
  readonly presence: number;
  /** The ears: how round the display's corners are where the housing meets its top edge (0 on an island). */
  readonly ear: number;
  /** The notch: a box hung from the display's top edge — its half width, its depth, its bottom corners. */
  readonly notch: {
    readonly half: number;
    readonly depth: number;
    readonly corner: WCorner;
  } | null;
  /** The island's pill: half width, half height, its top below the display's top edge. */
  readonly pill: { readonly hw: number; readonly hh: number; readonly top: number } | null;
  /** The front camera under it: x, its centre's depth below the display's top edge, its radius. */
  readonly lens: readonly [number, number, number];
  /** The earpiece's mesh in the notch (X → 12); its slit in the frame above the glass (13 onward, the islands). */
  readonly earpiece: number;
  readonly slit: number;
}

/** The home-button phones' face (presence 0 on the rest): the button's centre from the bottom edge and its radius; the top bezel's camera — its x, and how far below the earpiece's line. */
export interface Classic {
  readonly presence: number;
  readonly home: readonly [number, number];
  readonly camera: readonly [number, number];
}

/** A side button: its side (−1 left, 1 right), its centre from the body's top edge, half its length, how far it stands proud (0 flush: gone). */
export interface ShapeButton {
  readonly name: string;
  readonly side: number;
  readonly fromTop: number;
  readonly half: number;
  readonly presence: number;
}

/**
 * What the pass and the hit-test draw of a phone, in world units (the body's local frame: origin at its centre, y down the
 * screen) — CONTINUOUS in every number, so any shape blends into any other (`mixShape`). A catalog model's is
 * `shapeOf(model)`; mid-morph a phone's is a blend of two.
 */
export interface PhoneShape {
  /** The catalog model this shape is — mid-morph, the one it is nearer. */
  readonly model: PhoneModel;
  /** The body's half extents and its depth. */
  readonly half: readonly [number, number];
  readonly thick: number;
  readonly corner: WCorner;
  /**
   * The side: the rim's width and fall, how much of it is metal; how far its curve is a 45° facet (0 a quarter ellipse … 1
   * the first SE's chamfer); the wall below it (0 a round side, whose lower half tucks under … 1 a flat wall down to the base).
   */
  readonly rim: readonly [number, number];
  readonly metal: number;
  readonly chamfer: number;
  readonly wall: number;
  /** The band's metal as weights of aluminium, steel and titanium (they sum to 1). */
  readonly metals: readonly [number, number, number];
  /** The display (centred in the body), its corner (extent 0 = a rectangular LCD's square one), how much of an LCD its panel is (0 OLED … 1). */
  readonly display: readonly [number, number];
  readonly displayCorner: WCorner;
  readonly lcd: number;
  /** The screen iOS lays out: its size in points (portrait), and millimetres a point. */
  readonly points: readonly [number, number];
  readonly ptmm: number;
  readonly housing: Housing;
  readonly classic: Classic;
  /** The camera bump: its height and the local y it bears at. */
  readonly bump: readonly [number, number];
  readonly buttons: readonly ShapeButton[];
}

/** An LCD: every home-button phone, and the Xʀ and the 11 (Liquid Retina behind rounded corners); the rest are OLED. */
export const lcdOf = (m: Pick<PhoneModel, "name" | "screen">): boolean =>
  !m.screen.corner || m.name === "iPhone Xʀ" || m.name === "iPhone 11";

const SHAPES = new WeakMap<PhoneModel, PhoneShape>();

/** A catalog model's shape (made once a model). */
export function shapeOf(m: PhoneModel): PhoneShape {
  const known = SHAPES.get(m);
  if (known) return known;
  const [w, h, d] = m.body.mm;
  const half: [number, number] = [(w / 2) * MM, (h / 2) * MM];
  const c: Cutout = m.cutout;
  // the notch's camera: right of centre on the X → 12, left on the 13 → 17e's smaller notch; their earpiece left the notch for the frame
  const early = m.year <= 2020;
  const housing: Housing = {
    island: c.kind === "island" ? 1 : 0,
    presence: c.kind === "none" ? 0 : 1,
    ear: c.kind === "notch" ? c.ear * MM : 0,
    notch:
      c.kind === "notch" ? { half: c.half * MM, depth: c.depth * MM, corner: wc(c.corner) } : null,
    pill:
      c.kind === "island"
        ? { hw: (c.width / 2) * MM, hh: (c.height / 2) * MM, top: c.top * MM }
        : null,
    lens:
      c.kind === "notch"
        ? [(early ? 1 : -1) * (c.half - 4.6) * MM, c.depth * 0.5 * MM, 1.2 * MM]
        : c.kind === "island"
          ? [
              (c.width / 2 - c.height / 2) * MM,
              (c.top + c.height / 2) * MM,
              (c.height / 2) * 0.42 * MM,
            ]
          : [0, 0, 0],
    earpiece: c.kind === "notch" && early ? 1 : 0,
    slit: c.kind === "island" || (c.kind === "notch" && !early) ? 1 : 0,
  };
  // the home-button phones' top bezel: the earpiece in its middle, the camera left of it (above it on the first SE)
  const classic: Classic = m.home
    ? {
        presence: 1,
        home: [m.home.fromBottom * MM, (m.home.diameter / 2) * MM],
        camera: m.name.includes("SE (1st") ? [0, -4.2 * MM] : [-10.4 * MM, 0],
      }
    : { presence: 0, home: [0, 0], camera: [0, 0] };
  const shape: PhoneShape = {
    model: m,
    half,
    thick: d * MM,
    corner: wc(m.body.corner),
    rim: [m.body.rim[0] * MM, m.body.rim[1] * MM],
    metal: m.body.metal * MM,
    chamfer: m.body.edge === "chamfer" ? 1 : 0,
    wall: m.body.edge === "round" ? 0 : 1,
    metals:
      m.body.band === "aluminium" ? [1, 0, 0] : m.body.band === "steel" ? [0, 1, 0] : [0, 0, 1],
    display: [(m.screen.mm[0] / 2) * MM, (m.screen.mm[1] / 2) * MM],
    displayCorner: m.screen.corner ? wc(m.screen.corner) : { extent: 0, n: 2 },
    lcd: lcdOf(m) ? 1 : 0,
    points: [m.screen.px[0] / m.screen.scale, m.screen.px[1] / m.screen.scale],
    ptmm: (m.screen.scale * 25.4) / m.screen.dpi,
    housing,
    classic,
    bump: [m.body.bump[0] * MM, -half[1] + m.body.bump[1] * MM],
    buttons: m.buttons.map((b) => ({
      name: b.name,
      side: b.side === "left" ? -1 : 1,
      fromTop: (b.top + b.length / 2) * MM,
      half: (b.length / 2) * MM,
      presence: 1,
    })),
  };
  SHAPES.set(m, shape);
  return shape;
}

// ---------------------------------------------------------------- the distances (phone.wgsl mirrors every one)

/**
 * A rounded rect with CONTINUOUS corners — Apple's: each corner a superellipse ((a−x)/a)ⁿ + ((a−y)/a)ⁿ = 1 in its a × a
 * box (scripts/make-catalog.ts fits a and n to the Simulator's masks, within a quarter of a device pixel). Outside the
 * corner boxes the distance is the box's, exact; inside one it is the Lp norm corrected by its gradient — a Euclidean
 * distance to first order at the curve.
 */
export function sdSquircle(
  x: number,
  y: number,
  hx: number,
  hy: number,
  a: number,
  n: number,
): number {
  const aa = Math.min(a, hx, hy);
  const qx = Math.abs(x) - (hx - aa);
  const qy = Math.abs(y) - (hy - aa);
  if (qx <= 0 || qy <= 0) return Math.max(qx, qy) - aa;
  const k = (qx ** n + qy ** n) ** (1 / n);
  if (k < 1e-9) return -aa;
  const gx = (qx / k) ** (n - 1);
  const gy = (qy / k) ** (n - 1);
  return (k - aa) / Math.hypot(gx, gy);
}

export function sdRoundBox(x: number, y: number, hx: number, hy: number, r: number): number {
  const rr = Math.min(Math.max(r, 0), hx, hy);
  const ax = Math.abs(x) - hx + rr;
  const ay = Math.abs(y) - hy + rr;
  return Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - rr;
}

/** primitives.wgsl `op_isect_round` (the kit's `sdf` piece): an intersection whose convex corners are rounded by r. */
const isectRound = (a: number, b: number, r: number): number =>
  Math.min(-r, Math.max(a, b)) + Math.hypot(Math.max(r + a, 0), Math.max(r + b, 0));

/** The body's outline at a local point. */
export const sdBody = (S: PhoneShape, u: number, v: number): number =>
  sdSquircle(u, v, S.half[0], S.half[1], S.corner.extent, S.corner.n);

/** The notch: a box hung from the display's top edge, its bottom corners Apple's curve. */
function sdNotch(S: PhoneShape, u: number, v: number): number {
  const n = S.housing.notch;
  return n ? sdSquircle(u, v + S.display[1], n.half, n.depth, n.corner.extent, n.corner.n) : 1e9;
}

/** The Dynamic Island's pill of black glass, under the display's top edge. */
function sdPill(S: PhoneShape, u: number, v: number): number {
  const p = S.housing.pill;
  return p ? sdRoundBox(u, v - (-S.display[1] + p.top + p.hh), p.hw, p.hh, p.hh) : 1e9;
}

/** A housing on its way out sinks this far (world) under the glass as its presence goes — at 0 nothing of it is left, not even a pixel (phone.wgsl `HOUSING_FADE`). */
export const HOUSING_FADE = 1.5;

/**
 * THE SENSOR HOUSING: the notch's field and the pill's, blended by how far it is an island. Between the two a blend of two
 * distances is not a distance — it bounds one — but it is continuous in every number, which is all a morph asks, and it
 * is exact at both ends.
 */
export function sdHousing(S: PhoneShape, u: number, v: number): number {
  const H = S.housing;
  if (H.presence <= 0) return 1e9;
  const d =
    H.island <= 0
      ? sdNotch(S, u, v)
      : H.island >= 1
        ? sdPill(S, u, v)
        : sdNotch(S, u, v) * (1 - H.island) + sdPill(S, u, v) * H.island;
  return d + (1 - H.presence) * HOUSING_FADE;
}

/** The lit area of the display: its rect with Apple's corners (square on an LCD), less the sensor housing, the ears rounded where they meet. */
export function sdDisplay(S: PhoneShape, u: number, v: number): number {
  const [hx, hy] = S.display;
  const rect = sdSquircle(u, v, hx, hy, S.displayCorner.extent, S.displayCorner.n);
  if (S.housing.presence <= 0) return rect;
  return isectRound(rect, -sdHousing(S, u, v), S.housing.ear);
}

/**
 * The top surface's height below the glass's plane at a depth `d` inside the outline (0 at the outline): flat past the
 * rim; over the rim a quarter ellipse (round, flat, contour sides), a 45° facet (the chamfer) or between. Returns the
 * height (≤ 0) and its slope along the depth (≥ 0).
 */
export function rimAt(S: PhoneShape, d: number): readonly [number, number] {
  const [rw, rd] = S.rim;
  if (d >= rw) return [0, 0];
  const t = Math.min(Math.max(1 - d / rw, 0), 1);
  // the ellipse's height exact to the outline, its slope held finite where it stands vertical
  const tc = Math.min(t, 0.9995);
  const c = S.chamfer;
  return [
    -rd * (1 - Math.sqrt(1 - t * t)) * (1 - c) + -rd * t * c,
    ((rd * tc) / (rw * Math.sqrt(1 - tc * tc))) * (1 - c) + (rd / rw) * c,
  ];
}

/** The side's wall foot: the wall runs from the rim's foot down its share of the rest of the depth (none on a round side). */
export const wallFoot = (S: PhoneShape): number => -S.rim[1] * (1 - S.wall) - S.thick * S.wall;

// ---------------------------------------------------------------- the eye and the pose → the geometry

export type Vec3 = readonly [number, number, number];

/** An eye as the phone is seen from it: its foot on the desk (world) and its height — the kit's `DeskEye` without a screen. */
export type PhoneEye = Pick<DeskEye, "ex" | "ey" | "h">;

/** How high the phone's LOCAL eye stands over its centre (world units): the desk eye's height over a view that frames it. */
export function eyeHeight(S: Pick<PhoneShape, "half">, law: PhoneLaw = PHONE): number {
  return Math.max(law.eye.min, law.eye.k * law.eye.frame * 2 * Math.hypot(S.half[0], S.half[1]));
}

export interface PhoneGeometry {
  readonly shape: PhoneShape;
  /** The glass's centre in 3D (world; z its height), the phone's own axes (unit) and normal. */
  readonly centre: Vec3;
  readonly ex: Vec3;
  readonly ey: Vec3;
  readonly n: Vec3;
  /** The local eye the phone is drawn and picked from: over its rect's centre (world, z its height). */
  readonly eye: PhoneEye;
  /** The lowest point's height: the contact shadow lets go as it rises. */
  readonly bottom: number;
  /** Toward the lamp (unit), the shadow's ground offset per unit of height, its alpha. */
  readonly light: Vec3;
  readonly slope: readonly [number, number];
  readonly shadowAlpha: number;
  /** Its presence: 1 whole, falling to 0 as a delete's ghost fades. */
  readonly alpha: number;
  /** Drawn IN HAND (used — the open binding): its act's capsule is a part there (`heldPartAt`); at rest every point is the phone. */
  readonly held?: boolean;
  /** The world rect the pass's quad covers: the phone as the eye sees it, its shadow, and its glow's reach. */
  readonly bounds: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The unit direction toward the lamp from a point (x right, y down, z up). */
export function lightAt(x: number, y: number, z: number, lamp: Lamp = LAMP): Vec3 {
  return norm3([lamp.x - x, lamp.y - y, lamp.h - z]);
}

/** A cast shadow's offset on the mat per unit of height, away from the lamp, capped. */
export function shadowSlope(
  x: number,
  y: number,
  lamp: Lamp,
  max: number,
): readonly [number, number] {
  const h = Math.max(lamp.h, 1e-6);
  let sx = -(lamp.x - x) / h;
  let sy = -(lamp.y - y) / h;
  const m = Math.hypot(sx, sy);
  if (m > max) {
    sx *= max / m;
    sy *= max / m;
  }
  return [sx, sy];
}

/** The rest pitch: resting on its camera, the phone's bottom face climbs this much per unit toward its top (local −y). */
export const restPitch = (S: PhoneShape, law: PhoneLaw = PHONE): number =>
  (law.rest * S.bump[0]) / Math.max(S.half[1] - S.bump[1], 1);

/** A world point (z up) as an eye sees it on the desk plane. */
export function seen(eye: PhoneEye, P: Vec3): [number, number] {
  const k = eye.h / Math.max(eye.h - P[2], 1e-3);
  return [eye.ex + (P[0] - eye.ex) * k, eye.ey + (P[1] - eye.ey) * k];
}

/** The phone's own frame (u right, v down its screen, w up from the glass's plane) → a world point. */
export function pointAt(
  G: Pick<PhoneGeometry, "centre" | "ex" | "ey" | "n">,
  u: number,
  v: number,
  w = 0,
): Vec3 {
  return [
    G.centre[0] + G.ex[0] * u + G.ey[0] * v + G.n[0] * w,
    G.centre[1] + G.ex[1] * u + G.ey[1] * v + G.n[1] * w,
    G.centre[2] + G.ex[2] * u + G.ey[2] * v + G.n[2] * w,
  ];
}

/** How high a phone rides off the mat for its flux: `lift` (carried) up to the lift's height, `hover` a hair. */
export const heightOf = (flux: Pick<ObjectFlux, "lift" | "hover">, law: PhoneLaw = PHONE): number =>
  law.lift.height * flux.lift + law.lift.hover * flux.hover * (1 - flux.lift);

/**
 * The pose → what the pass draws and the hit-test reads. Its rect's centre is the phone's; its height is the flux's;
 * resting, it is pitched on its camera about its bottom edge, the pitch letting go as it is lifted off the mat. `glow` =
 * how far the glow reaches round the phone this frame (world; 0 = none).
 */
export function resolvePhone(
  rect: Pick<ObjectRect, "cx" | "cy">,
  flux: Pick<ObjectFlux, "lift" | "hover" | "fade">,
  S: PhoneShape,
  lamp: Lamp = LAMP,
  law: PhoneLaw = PHONE,
  glow = 0,
  held = false,
): PhoneGeometry {
  const h = heightOf(flux, law);
  const aloft = Math.min(Math.max(h / Math.max(law.lift.height * 0.5, 1e-3), 0), 1);
  const pitch = restPitch(S, law) * (1 - aloft);
  // the slope along the phone's own −y (square to the mat: it is never turned)
  const n = norm3([0, pitch, 1]);
  const ex = norm3([1, 0, 0]);
  const ey = cross3(n, ex);
  // the bottom face's centre: resting, the bottom edge is on the mat and the centre is half the pitch's climb up
  const bottomC = h + pitch * S.half[1];
  const centre: Vec3 = [
    rect.cx + n[0] * S.thick,
    rect.cy + n[1] * S.thick,
    bottomC + n[2] * S.thick,
  ];
  const eye: PhoneEye = { ex: rect.cx, ey: rect.cy, h: eyeHeight(S, law) };
  const slope = shadowSlope(centre[0], centre[1], lamp, law.shadow.slopeMax);
  const G0 = {
    shape: S,
    centre,
    ex,
    ey,
    n,
    eye,
    bottom: Math.max(h, 0),
    light: lightAt(centre[0], centre[1], centre[2], lamp),
    slope,
    shadowAlpha: law.shadow.alpha + (law.shadow.alphaHeld - law.shadow.alpha) * aloft,
    alpha: flux.fade,
    ...(held ? { held: true } : {}),
  };
  // bounds: the glass's and the base's corners as seen, their casts, the blur and the glow round them
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const add = (x: number, y: number): void => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const proud = law.button.proud * MM;
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    for (const w of [0, -S.thick]) {
      const P = pointAt(G0, u * (S.half[0] + proud), v * S.half[1], w);
      add(...seen(eye, P));
      add(P[0] + slope[0] * P[2], P[1] + slope[1] * P[2]);
    }
  }
  const pad = 3 * (law.shadow.sigma0 + law.shadow.perUnit * (centre[2] + 4)) + 6 + glow;
  return { ...G0, bounds: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } };
}

// ---------------------------------------------------------------- the ray (phone.wgsl `ph_trace`, mirrored)

export type PhonePart = "glass" | "rim" | "wall" | "button";
export interface PhoneHit {
  readonly part: PhonePart;
  /** The hit in the phone's frame: u, v on the glass's plane, w below it (≤ 0). */
  readonly u: number;
  readonly v: number;
  readonly w: number;
}

/** The steps the rim's bisection takes: its fall over 2¹⁰ — a hundredth of a world unit on the deepest rim. */
export const RIM_STEPS = 10;

/**
 * The eye's ray through a desk point, into the phone: the glass (flat past the rim); the rim — bisected over its fall, since
 * a straight ray crosses a convex rim at most twice and starts above it; the side wall below the rim (not on a round
 * phone: its lower half tucks under); or a side button's top, whichever the ray meets first. null = the desk. The eye is the
 * phone's own (`G.eye`) unless one is given.
 */
export function castPhone(
  G: PhoneGeometry,
  wx: number,
  wy: number,
  law: PhoneLaw = PHONE,
  eye: PhoneEye = G.eye,
): PhoneHit | null {
  const S = G.shape;
  const O: Vec3 = [eye.ex - G.centre[0], eye.ey - G.centre[1], eye.h - G.centre[2]];
  const D: Vec3 = [wx - eye.ex, wy - eye.ey, -eye.h];
  const o = [dot3(O, G.ex), dot3(O, G.ey), dot3(O, G.n)] as const;
  const d = [dot3(D, G.ex), dot3(D, G.ey), dot3(D, G.n)] as const;
  if (d[2] > -1e-6) return null;
  const at = (w: number): readonly [number, number] => {
    const t = (w - o[2]) / d[2];
    return [o[0] + d[0] * t, o[1] + d[1] * t];
  };
  const depthAt = (w: number): number => {
    const [u, v] = at(w);
    return -sdBody(S, u, v);
  };
  // the glass's plane
  const [u0, v0] = at(0);
  if (-sdBody(S, u0, v0) >= S.rim[0]) return { part: "glass", u: u0, v: v0, w: 0 };
  // the rim: the first height where the ray is at or under its surface
  const drop = S.rim[1];
  if (depthAt(-drop) >= 0) {
    let hi = 0;
    let lo = -drop;
    for (let i = 0; i < RIM_STEPS; i++) {
      const mid = (hi + lo) / 2;
      const dm = depthAt(mid);
      if (dm < 0 || mid > rimAt(S, dm)[0]) hi = mid;
      else lo = mid;
    }
    const [u, v] = at(lo);
    return { part: -sdBody(S, u, v) >= S.metal ? "glass" : "rim", u, v, w: lo };
  }
  // below the rim: the wall (flat, contour, chamfer sides) from the rim's foot toward the base; a button's top
  let hit: PhoneHit | null = null;
  const wTop = -drop;
  const wBot = wallFoot(S);
  if (wBot < wTop - 1e-6) {
    const da = -depthAt(wTop);
    const db = -depthAt(wBot);
    if (db <= 0 && da > 0) {
      const f = da / (da - db);
      const w = wTop + (wBot - wTop) * f;
      const [u, v] = at(w);
      hit = { part: "wall", u, v, w };
    }
  }
  const bw = buttonTop(S, law);
  if (!hit || hit.w < bw) {
    const [ub, vb] = at(bw);
    if (sdButtons(S, ub, vb, law) <= 0) hit = { part: "button", u: ub, v: vb, w: bw };
  }
  return hit;
}

/** Where the eye's ray through a desk point crosses the glass's plane, in the phone's frame — a pointer that slides off the screen keeps a point. */
export function glassPoint(
  G: PhoneGeometry,
  wx: number,
  wy: number,
  eye: PhoneEye = G.eye,
): readonly [number, number] {
  const O: Vec3 = [eye.ex - G.centre[0], eye.ey - G.centre[1], eye.h - G.centre[2]];
  const D: Vec3 = [wx - eye.ex, wy - eye.ey, -eye.h];
  const oz = dot3(O, G.n);
  const dz = dot3(D, G.n);
  const t = Math.abs(dz) > 1e-9 ? -oz / dz : 0;
  return [dot3(O, G.ex) + dot3(D, G.ex) * t, dot3(O, G.ey) + dot3(D, G.ey) * t];
}

/** The side buttons' top face, below the glass's plane: they sit at the band's middle. */
export const buttonTop = (S: PhoneShape, law: PhoneLaw = PHONE): number =>
  -S.thick * 0.5 + (law.button.height * MM) / 2;

/**
 * How far inside the silhouette a desk point's ray passes (positive inside): the outline where the silhouette is made —
 * the rim's foot (a round side's equator) on the far side, the base on the near side of a walled one. The 1-px coverage of
 * the phone's edge is read off this.
 */
export function silhouetteDepth(
  G: PhoneGeometry,
  wx: number,
  wy: number,
  eye: PhoneEye = G.eye,
): number {
  const S = G.shape;
  const O: Vec3 = [eye.ex - G.centre[0], eye.ey - G.centre[1], eye.h - G.centre[2]];
  const D: Vec3 = [wx - eye.ex, wy - eye.ey, -eye.h];
  const o = [dot3(O, G.ex), dot3(O, G.ey), dot3(O, G.n)] as const;
  const d = [dot3(D, G.ex), dot3(D, G.ey), dot3(D, G.n)] as const;
  if (d[2] > -1e-6) return -1e9;
  const depthAt = (w: number): number => {
    const t = (w - o[2]) / d[2];
    return -sdBody(S, o[0] + d[0] * t, o[1] + d[1] * t);
  };
  return S.wall <= 0 ? depthAt(-S.rim[1]) : Math.max(depthAt(-S.rim[1]), depthAt(wallFoot(S)));
}

/** The side buttons, proud of the band: each a rounded bar just outside the outline (the chrome's placements), standing out as far as it is there. */
export function sdButtons(S: PhoneShape, u: number, v: number, law: PhoneLaw = PHONE): number {
  let d = 1e9;
  for (const b of S.buttons) {
    if (b.presence <= 0) continue;
    const proud = law.button.proud * MM * b.presence;
    const x = b.side * (S.half[0] + proud * 0.5 - 0.3);
    d = Math.min(
      d,
      sdRoundBox(u - x, v - (-S.half[1] + b.fromTop), proud * 0.5 + 0.3, b.half, proud * 0.5),
    );
  }
  return d;
}

/**
 * The silhouette as the phone's own eye sees it — the outline at the rim's foot, magnified about the eye's foot (the rect's
 * centre) by its height there: centre, half extents and corner, world units. What the desk's marks go round.
 */
export function silhouetteOf(G: PhoneGeometry): {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly r: number;
} {
  const S = G.shape;
  const z = G.centre[2] - S.rim[1];
  const k = G.eye.h / Math.max(G.eye.h - z, 1e-3);
  const [cx, cy] = seen(G.eye, [G.centre[0], G.centre[1], z]);
  const r45 = S.corner.extent * ((1 - 2 ** (-1 / S.corner.n)) / (1 - Math.SQRT1_2));
  return { cx, cy, hx: S.half[0] * k, hy: S.half[1] * k, r: r45 * k };
}

// ---------------------------------------------------------------- the screen: device points, its rect, the texture's level

/** A point on the glass (u, v) → the device's point (portrait: x right, y down, in iOS points — mid-morph, the in-between screen's). */
export function devicePoint(S: PhoneShape, u: number, v: number): readonly [number, number] {
  const [hx, hy] = S.display;
  return [((u + hx) / (2 * hx)) * S.points[0], ((v + hy) / (2 * hy)) * S.points[1]];
}
/** A device point → the glass (u, v). */
export function glassOf(S: PhoneShape, xPt: number, yPt: number): readonly [number, number] {
  const [hx, hy] = S.display;
  return [(xPt / S.points[0]) * 2 * hx - hx, (yPt / S.points[1]) * 2 * hy - hy];
}

/** What is under a desk point: the SCREEN (with the device point there), the phone's BODY, or nothing. The sensor housing is the body's. */
export type PhonePick =
  | { readonly part: "screen"; readonly point: readonly [number, number] }
  | { readonly part: "body" }
  | null;
export function pickPhone(
  G: PhoneGeometry,
  wx: number,
  wy: number,
  law: PhoneLaw = PHONE,
  eye: PhoneEye = G.eye,
): PhonePick {
  const hit = castPhone(G, wx, wy, law, eye);
  if (!hit) return null;
  if (hit.part === "glass" && sdDisplay(G.shape, hit.u, hit.v) < 0)
    return { part: "screen", point: devicePoint(G.shape, hit.u, hit.v) };
  return { part: "body" };
}

/** The display's rect on screen (CSS px) under the DESK eye (the kit's `eyeOf` — the camera's): its four corners as it sees them. */
export function displayOnScreen(
  G: PhoneGeometry,
  eye: DeskEye,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const [wx, wy] = seen(eye, pointAt(G, u * G.shape.display[0], v * G.shape.display[1]));
    const sx = eye.vw / 2 + (wx - eye.ex) * eye.zoom;
    const sy = eye.vh / 2 + (wy - eye.ey) * eye.zoom;
    x0 = Math.min(x0, sx);
    y0 = Math.min(y0, sy);
    x1 = Math.max(x1, sx);
    y1 = Math.max(y1, sy);
  }
  return { x0, y0, x1, y1 };
}

/**
 * The mip level the display's texture is read at: texels per device pixel across the display, as the eye sees it. (The
 * pass reads the same from the slot's zoom — phone.wgsl `ph_screen_lod` — so the record stays camera-free.)
 */
export function screenLod(G: PhoneGeometry, eye: DeskEye, texWidth: number, dpr: number): number {
  const r = displayOnScreen(G, eye);
  const px = Math.max(
    (Math.hypot(r.x1 - r.x0, r.y1 - r.y0) /
      Math.hypot(2 * G.shape.display[0], 2 * G.shape.display[1])) *
      2 *
      G.shape.display[0] *
      dpr,
    1,
  );
  return Math.max(Math.log2(texWidth / px), 0);
}

/** The display's rect on its desk — what the pass tells the SIGHT (axis-aligned: a phone is never turned; its pitch, a hair, left out). */
export function displayRect(G: PhoneGeometry): {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
} {
  const S = G.shape;
  return { cx: G.centre[0], cy: G.centre[1], w: 2 * S.display[0], h: 2 * S.display[1] };
}

/** A frame's rotation against the device (quarter turns, clockwise) → where the glass's uv reads in the frame. */
export function frameUv(u: number, v: number, quarter: number): readonly [number, number] {
  switch (((quarter % 4) + 4) % 4) {
    case 1:
      return [v, 1 - u];
    case 2:
      return [1 - u, 1 - v];
    case 3:
      return [1 - v, u];
    default:
      return [u, v];
  }
}

// ---------------------------------------------------------------- the stream's demand (PHONE.md §6)

/** What the stream should send (the prototype's form, through the desk eye): the size — a halving of the native framebuffer — and the rate. */
export interface ScreenDemand {
  /** The frame's size, px, portrait. */
  readonly width: number;
  readonly height: number;
  /** Frames per second; 0 = hold the last frame. */
  readonly fps: number;
  readonly visible: boolean;
}

/**
 * The rung a stream sends at for `devPx` device px of display, of a native framebuffer `native` wide and high: the halving
 * that covers it (at most `rungs` halvings down) — or `held`, the width it sends now, while that still covers the display
 * and is no more than 2.3× it (the note's raster band): a zoom that wobbles across a rung flips no sizes.
 */
function rungOf(
  native: readonly [number, number],
  devPx: number,
  law: PhoneLaw,
  held: number | undefined,
): readonly [number, number] {
  const [nw, nh] = native;
  const rungs = Array.from({ length: law.stream.rungs + 1 }, (_, k) => Math.round(nw / 2 ** k));
  if (
    held !== undefined &&
    rungs.includes(held) &&
    held >= Math.min(devPx, nw) &&
    held <= devPx * 2.3
  ) {
    const k = rungs.indexOf(held);
    return [held, Math.round(nh / 2 ** k)];
  }
  let k = 0;
  while (k < law.stream.rungs && nw / 2 ** (k + 1) >= devPx) k++;
  return [Math.round(nw / 2 ** k), Math.round(nh / 2 ** k)];
}

/** The rate for a display `devPx` device px wide at rest: near or far. */
const restFps = (devPx: number, law: PhoneLaw): number =>
  devPx >= law.stream.nearPx ? law.stream.fps.near : law.stream.fps.far;

/** The prototype's demand through the DESK eye (PHONE.md §6): in use the native framebuffer at 60, else its rung and rate; 0 off screen. */
export function screenDemand(
  G: PhoneGeometry,
  eye: DeskEye,
  dpr: number,
  focused: boolean,
  law: PhoneLaw = PHONE,
  held?: number,
): ScreenDemand {
  const native = G.shape.model.screen.px;
  const r = displayOnScreen(G, eye);
  const visible = r.x1 > 0 && r.y1 > 0 && r.x0 < eye.vw && r.y0 < eye.vh;
  const devPx = Math.max(Math.abs(r.x1 - r.x0), 1) * dpr * law.stream.texelsPerPx;
  const fps = !visible ? 0 : focused ? law.stream.fps.focused : restFps(devPx, law);
  // in use, the Simulator's own pixels: the native framebuffer, whatever the zoom (its "pixel accurate")
  if (focused && visible) return { width: native[0], height: native[1], fps, visible };
  const [width, height] = rungOf(native, devPx, law, held);
  return { width, height, fps, visible };
}

/** What the desk says it drew of a face last frame (ICE's `Seen`, design-019 §3.4): drawn, its largest device px, held. */
export interface PhoneSeen {
  readonly seen: boolean;
  readonly px: readonly [number, number];
  readonly held: boolean;
}

/** What the phone asks of its screen's source (ICE's `LiveDemand`, design-019 §4) — the host maps it to its producer. */
export interface PhoneLiveDemand {
  readonly mode: "live" | "paused";
  readonly fps: number;
  readonly raster: readonly [number, number];
  readonly interactive: boolean;
}

/**
 * THE PHONE'S DEMAND LAW over its SIGHT (PHONE.md §6, re-based on what the desk says it drew of the display — `px` its
 * device px; the pane's PT-2 ruling 5's form): UNSEEN — off screen, culled, behind the hand — paused (the last frame holds);
 * HELD (in use) the native framebuffer at 60, interactive; at rest the halving of native that covers the display (a rung
 * `held` kept through a wobble), 30 while it is ≥ 240 device px wide and 12 below. No viewport: a Simulator lays out at its
 * own device's size, never the desk's.
 */
export function phoneDemand(
  s: PhoneSeen,
  native: readonly [number, number],
  held?: number,
  law: PhoneLaw = PHONE,
): PhoneLiveDemand {
  if (!s.seen) return { mode: "paused", fps: 0, raster: [0, 0], interactive: false };
  if (s.held)
    return {
      mode: "live",
      fps: law.stream.fps.focused,
      raster: [native[0], native[1]],
      interactive: true,
    };
  const devPx = Math.max(s.px[0], 1) * law.stream.texelsPerPx;
  return {
    mode: "live",
    fps: restFps(devPx, law),
    raster: rungOf(native, devPx, law, held),
    interactive: false,
  };
}

/** Two demands that ask the same — the law speaks change-only. */
export const sameDemand = (a: PhoneLiveDemand | undefined, b: PhoneLiveDemand): boolean =>
  a !== undefined &&
  a.mode === b.mode &&
  a.fps === b.fps &&
  a.interactive === b.interactive &&
  a.raster[0] === b.raster[0] &&
  a.raster[1] === b.raster[1];

// ---------------------------------------------------------------- in hand: the opening, its parts

/** The phone's OPEN extent (`open.extent`): its body, in its own desk units, centred as its rect is — what the reading size fits. */
export function openExtent(
  rect: Pick<ObjectRect, "cx" | "cy">,
  S: Pick<PhoneShape, "half">,
): { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number } {
  return { cx: rect.cx, cy: rect.cy, w: 2 * S.half[0], h: 2 * S.half[1] };
}

// ---------------------------------------------------------------- how far it draws past its rect

/** How far the glow reaches round a phone (world): the spill's pool, three σ. */
export const glowReach = (law: PhoneLaw = PHONE): number => 3 * law.glow.spillSigma * MM;

/** How far the largest model in the catalog overhangs a rect of the default model's size, per side (world). */
export function overhang(
  models: readonly PhoneModel[] = PHONES,
  at: PhoneModel = DEFAULT_PHONE,
): number {
  let out = 0;
  for (const m of models)
    out = Math.max(
      out,
      ((m.body.mm[0] - at.body.mm[0]) / 2) * MM,
      ((m.body.mm[1] - at.body.mm[1]) / 2) * MM,
    );
  return out;
}

/**
 * How far a phone's drawing reaches PAST its rect, world units — the kind's `reach`: the largest model's overhang over the
 * rect (the rect is the default model's body; the phone is its own model's), its buttons proud, its shadow at full lift
 * (cast along the lamp's capped slope from the glass's height and blurred there, the quad's own pad), the night's glow
 * round it (the spill's pool), and the lift's growth under its own eye (bounded by the glass's height).
 */
export function phoneReach(law: PhoneLaw = PHONE): number {
  const deepest = Math.max(...PHONES.map((m) => m.body.mm[2])) * MM;
  const top = deepest + law.lift.height + Math.max(...PHONES.map((m) => m.body.bump[0])) * MM;
  const shadow =
    law.shadow.slopeMax * top + 3 * (law.shadow.sigma0 + law.shadow.perUnit * (top + 4)) + 6;
  return overhang() + law.button.proud * MM + shadow + glowReach(law) + top;
}

// ---------------------------------------------------------------- THE MORPH (PHONE.md §13): any shape into any other

/** How far a morph has gone (0…1): its time, and each of its five tracks. */
export interface Tracks {
  readonly t: number;
  readonly size: number;
  readonly bezels: number;
  readonly form: number;
  readonly housing: number;
  readonly material: number;
}

const smoother = (x: number): number => {
  const c = Math.min(Math.max(x, 0), 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/**
 * A morph's tracks at its time t (0…1). Staged, each track moves in its own window of the time, smootherstepped
 * (`PHONE.morph.tracks`) — the size, the screen into its border, the corners and the side, the housing, the material;
 * unstaged, every track is t itself.
 */
export function morphTracks(t: number, staged = true, law: PhoneLaw = PHONE): Tracks {
  if (!staged) return { t, size: t, bezels: t, form: t, housing: t, material: t };
  const W = law.morph.tracks;
  const at = (w: { readonly from: number; readonly to: number }): number =>
    smoother((t - w.from) / Math.max(w.to - w.from, 1e-6));
  return {
    t,
    size: at(W.size),
    bezels: at(W.bezels),
    form: at(W.form),
    housing: at(W.housing),
    material: at(W.material),
  };
}

/** a → b at t; a number the two share stays itself, bit for bit. */
const mix = (a: number, b: number, t: number): number => (a === b ? a : a * (1 - t) + b * t);
const mix2 = (
  a: readonly [number, number],
  b: readonly [number, number],
  t: number,
): [number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
const mix3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mixCorner = (a: WCorner, b: WCorner, t: number): WCorner => ({
  extent: mix(a.extent, b.extent, t),
  n: mix(a.n, b.n, t),
});

type Notch = NonNullable<Housing["notch"]>;
type Pill = NonNullable<Housing["pill"]>;
/**
 * A housing at no size: a point at the middle of the display's top edge, which it grows out of and retracts into. On the
 * edge, a point sunk under the glass cuts nothing from the display — inside it, it would dent the display's field to the
 * last instant and let go of it at once.
 */
const noNotch = (n: Notch): Notch => ({ half: 0, depth: 0, corner: { extent: 0, n: n.corner.n } });
const noPill = (_p: Pill): Pill => ({ hw: 0, hh: 0, top: 0 });

/**
 * The housing between two. What one side lacks it borrows from the other: a housing that is not there takes the other's at
 * no size (it grows from nothing, or shrinks into nothing), and a notch-or-island that is there takes the other's
 * alternative WHOLE — its weight is nought at its own end — so between a notch and an island the morph is the blend of the
 * two fields: the notch narrows, lets go of the display's top edge and rounds into the pill.
 */
function mixHousing(A: Housing, B: Housing, t: number): Housing {
  if (A.presence <= 0 && B.presence <= 0) return t < 0.5 ? A : B;
  const a = A.presence > 0;
  const b = B.presence > 0;
  const nA = A.notch ?? (B.notch && (a ? B.notch : noNotch(B.notch)));
  const nB = B.notch ?? (A.notch && (b ? A.notch : noNotch(A.notch)));
  const pA = A.pill ?? (B.pill && (a ? B.pill : noPill(B.pill)));
  const pB = B.pill ?? (A.pill && (b ? A.pill : noPill(A.pill)));
  return {
    island: mix(a ? A.island : B.island, b ? B.island : A.island, t),
    presence: mix(A.presence, B.presence, t),
    ear: mix(A.ear, B.ear, t),
    notch:
      nA && nB
        ? {
            half: mix(nA.half, nB.half, t),
            depth: mix(nA.depth, nB.depth, t),
            corner: mixCorner(nA.corner, nB.corner, t),
          }
        : null,
    pill:
      pA && pB
        ? { hw: mix(pA.hw, pB.hw, t), hh: mix(pA.hh, pB.hh, t), top: mix(pA.top, pB.top, t) }
        : null,
    lens: mix3(a ? A.lens : B.lens, b ? B.lens : A.lens, t),
    earpiece: mix(A.earpiece, B.earpiece, t),
    slit: mix(A.slit, B.slit, t),
  };
}

/** The home-button face between two: one not there borrows the other's place, and its button closes into its centre (the pass draws its radius × presence). */
function mixClassic(A: Classic, B: Classic, t: number): Classic {
  const a = A.presence > 0 ? A : B;
  const b = B.presence > 0 ? B : A;
  return {
    presence: mix(A.presence, B.presence, t),
    home: mix2(a.home, b.home, t),
    camera: mix2(a.camera, b.camera, t),
  };
}

/** The side buttons between two: matched along each side in order; one without a partner shrinks flush into the band (or grows out of it). */
function mixButtons(
  A: readonly ShapeButton[],
  B: readonly ShapeButton[],
  s: number,
  t: number,
): ShapeButton[] {
  const out: ShapeButton[] = [];
  for (const side of [-1, 1]) {
    const as = A.filter((x) => x.side === side).sort((x, y) => x.fromTop - y.fromTop);
    const bs = B.filter((x) => x.side === side).sort((x, y) => x.fromTop - y.fromTop);
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      const x = as[i];
      const y = bs[i];
      if (x && y)
        out.push({
          name: t < 0.5 ? x.name : y.name,
          side,
          fromTop: mix(x.fromTop, y.fromTop, s),
          half: mix(x.half, y.half, s),
          presence: mix(x.presence, y.presence, s),
        });
      else if (x) out.push({ ...x, half: x.half * (1 - s), presence: x.presence * (1 - s) });
      else if (y) out.push({ ...y, half: y.half * s, presence: y.presence * s });
    }
  }
  return out;
}

/**
 * THE MORPH: shape A becoming shape B, each part at its track's progress. Every number is eased — nothing switches — so the
 * drawing, the shadow, the glow and the hit-test move together and never pop. At 0 it is A and at 1 it is B, exactly (the
 * objects themselves). The screen's points follow the display at the eased millimetres a point, so the in-between screen
 * iOS would lay out has the very aspect of the in-between display.
 */
export function mixShape(A: PhoneShape, B: PhoneShape, k: Tracks): PhoneShape {
  if (k.t <= 0) return A;
  if (k.t >= 1) return B;
  const display = mix2(A.display, B.display, k.bezels);
  const ptmm = mix(A.ptmm, B.ptmm, k.bezels);
  return {
    model: k.t < 0.5 ? A.model : B.model,
    half: mix2(A.half, B.half, k.size),
    thick: mix(A.thick, B.thick, k.size),
    corner: mixCorner(A.corner, B.corner, k.form),
    rim: mix2(A.rim, B.rim, k.form),
    metal: mix(A.metal, B.metal, k.form),
    chamfer: mix(A.chamfer, B.chamfer, k.form),
    wall: mix(A.wall, B.wall, k.form),
    metals: mix3(A.metals, B.metals, k.material),
    display,
    displayCorner: mixCorner(A.displayCorner, B.displayCorner, k.bezels),
    lcd: mix(A.lcd, B.lcd, k.bezels),
    points: [(2 * display[0]) / MM / ptmm, (2 * display[1]) / MM / ptmm],
    ptmm,
    housing: mixHousing(A.housing, B.housing, k.housing),
    classic: mixClassic(A.classic, B.classic, k.bezels),
    bump: mix2(A.bump, B.bump, k.size),
    buttons: mixButtons(A.buttons, B.buttons, k.size, k.t),
  };
}

/**
 * Where `x` models along the history is (0 the first, `models.length − 1` the newest): between two, their morph at the fraction,
 * UNSTAGED (every track is the fraction — the prototype's scrubber, where the hand is the clock). The desk has no scrubber: this
 * is the morph's witness over the whole catalog (PHONE.md §13 — at each whole step the very model, between two their blend).
 */
export function historyShape(
  x: number,
  models: readonly PhoneModel[] = PHONES,
): { shape: PhoneShape; from: PhoneModel; to: PhoneModel; f: number } {
  const c = Math.min(Math.max(x, 0), models.length - 1);
  const i = Math.max(Math.min(Math.floor(c), models.length - 2), 0);
  const f = c - i;
  const from = models[i] ?? DEFAULT_PHONE;
  const to = models[i + 1] ?? from;
  return { shape: mixShape(shapeOf(from), shapeOf(to), morphTracks(f, false)), from, to, f };
}

// ---------------------------------------------------------------- the family photo

/**
 * Every model laid out at its true size, oldest first, in rows `across` wide, `gap` apart (world) — the lineup (PHONE.md's family
 * photo). The desk lays no lineup out (each phone is an object a person places): this is the catalog's witness that every body
 * is its own size and none overlaps another laid beside it.
 */
export function lineup(
  models: readonly PhoneModel[],
  x0: number,
  y0: number,
  across = 11,
  gap = 36,
): { model: PhoneModel; x: number; y: number }[] {
  const out: { model: PhoneModel; x: number; y: number }[] = [];
  let y = y0;
  let rowH = 0;
  let x = x0;
  models.forEach((m, i) => {
    if (i > 0 && i % across === 0) {
      y += rowH + gap * 1.6;
      rowH = 0;
      x = x0;
    }
    const w = m.body.mm[0] * MM;
    const h = m.body.mm[1] * MM;
    out.push({ model: m, x: x + w / 2, y: y + h / 2 });
    x += w + gap;
    rowH = Math.max(rowH, h);
  });
  return out;
}
