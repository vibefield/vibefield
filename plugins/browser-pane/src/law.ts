// The BROWSER PANE's law — pure: no GPU (BROWSER.md; the prototype's draft/ground src/browser/browser.ts, moved). A
// browser on the desk is a PANE: a slab of glass cut to its page's size, lying on the mat, the page lit inside it — the
// material book's glass, "a window onto something live" (thinking-the-desk §6). Round the page a border of clear glass
// shows the mat through the slab, bent where the polished edge rolls into the side; across the top the HEAD, where the
// chrome is engraved; at night the page's light, caught in the slab, leaks out of every polished edge and every
// engraved mark, as an edge-lit sign's does. Drawn at its true size among the desk's objects (the note's scale: 200 =
// 3″), its page at its device's density — so a laptop's page is 26 cm across, a phone's the phone's own display.
//
// What moved from the prototype, and what it became here (PT-1's rulings):
//  - THE CUT: `Size` is the truth (ruling 5) — `shapeOf` takes the object's size and its device; the viewport is derived
//    (devices.ts `viewportOf`), whole CSS px, never under 320 × 240.
//  - THE EYE: the photo's LOCAL eye (ruling 3) — an eye over the pane's own centre, as high as the desk eye stands over a
//    view that frames the pane, never the view's: the record is camera-free and the desk reuses it across a pan (ICE
//    design-015 §2 law 5). What is lost is said in the landing note: a pane off to the side no longer shows its polished
//    wall toward the view's centre — from its own eye no wall is ever seen.
//  - THE HAND: core's drag (ruling 4) — the pane rises by the desk's flux (`lift` while it is carried, `hover` under the
//    pointer) and is never tipped: the prototype's one hand (the photo's body) tipped it toward the fingers and pinned the
//    grab point under the finger as the eye saw it; core's drag carries the rect.
//  - THE LIGHT: the desk's one lamp arrives per object (`ctx.lamp`), and the one physics is the kit's (`PHYSICS`: the
//    penumbra at contact, the slope's cap, the lamp's fill on a face).
// `resolvePane` turns a rect, its flux and the lamp into the GEOMETRY the pass draws; `castPane` is the CPU mirror of
// browser.wgsl's ray — the same outline, the same rim, the same wall — so what is picked is what is drawn. World units are
// the desk's: CSS px at zoom 1. Axes: x right, y down the screen, z up off the mat; a pane's own frame: u right, v down,
// w up from the top face (the glass is w ∈ [−thick, 0]).

import {
  DEFAULT_GRID,
  type DeskEye,
  type Lamp,
  lampOf,
  type ObjectFlux,
  type ObjectRect,
  PHYSICS,
} from "@vibefield/plugin-sdk/desk";
import { DEFAULT_DEVICE, type Device, MIN_VIEWPORT, MM, PANE_MM, viewportOf } from "./devices";
import { retryAt } from "./notice";

export { MM };

/** The desk's ONE light as a law's default (the kit's `lampOf` over the desk's own plane); a drawn pane reads `ctx.lamp`. */
export const LAMP: Lamp = lampOf(DEFAULT_GRID.mat.plane);

type Widen<T> = T extends number
  ? number
  : T extends string
    ? string
    : T extends readonly (infer E)[]
      ? readonly Widen<E>[]
      : { -readonly [K in keyof T]: Widen<T[K]> };

const BROWSER_SPEC = {
  /**
   * The EYE. `k` and `min` are the desk eye's (the kit's `eyeOf`: over the view's centre, `k` view-diagonals up, never
   * nearer than `min` — the phone's and the prototype's); the pane's demand and its page's level are read under it
   * (`pageDemand`, `pageLod`). The LOCAL eye a pane is drawn and picked from stands over its own centre as high as the desk
   * eye stands over a view that frames it — a view `frame` times the pane's own diagonal (the pane ≈ 60 % of it) — so a
   * laptop's pane is seen from ≈ 1640 up, as the prototype saw one at zoom 1 in its 1200 × 800 view (1658).
   */
  eye: { k: 1.15, min: 1250, frame: 1.7 },
  /**
   * The LIFT — the desk's flux, a slab's numbers (the prototype's hand: it rose 22 in the hand, a hair under the pointer):
   * how high a carried pane rides, world units, and how far a hovered one rises.
   */
  lift: { height: 22, hover: 1.0 },
  /** The pane, in millimetres (devices.ts `PANE_MM`): the slab, the border, the head, the corner, the arris. */
  pane: PANE_MM,
  /**
   * The glass: its index (float glass, 1.52); Fresnel's reflectance head on (4 %); the lamp's glint (strength,
   * shininess — sharp: polished glass); the canopy the flat glass mirrors, this high over the desk (world); the veil over
   * the page (how much of the sky the glass shows over a lit page — the phone's 0.28, a hair less: a page is read) and
   * over the clear border (the mat under glass keeps its colour — the same guardrail: the physics' full sky washes a dark
   * mat grey); the WINDOW round the lamp a rim turned toward it mirrors.
   */
  glass: {
    ior: 1.52,
    f0: 0.04,
    glint: 2.4,
    shininess: 1500,
    canopy: 240,
    veil: 0.24,
    clear: 0.45,
    window: 3.2,
    windowNight: 0.05,
  },
  /**
   * The FROST of an engraving (the laser's mark in the head's clear glass, BROWSER.md §4): the share of the light on it the
   * rough face scatters back (an engraved mark reads pale — frosty white), the share of what is under the glass it lets
   * through (diffused), its faint sheen, the printed favicon's opacity, and its GRIT (the fine sparkle of a blasted face,
   * ± this share of its light).
   */
  frost: { albedo: 0.72, transmit: 0.28, sheen: 0.05, ink: 0.95, grit: 0.05 },
  /**
   * The shadow, the desk's one law: the PAGE is an opaque film under the top face — its shadow is the desk's penumbra (σ
   * at contact — the kit's — and σ per unit of height: the print's 0.36, a slab rides high), cast from its height along
   * the lamp's slope, capped as the kit caps it; the GLASS lets the light through but for its faces' Fresnel and its
   * body's absorption (`glass`), except where a ray crosses a polished wall — light in at a grazing angle is turned away
   * (`edge`, a dark line along the outline's cast) — and just inside it the rolled arris focuses what it gathers into a
   * bright line (`caustic`, its width in mm). The contact line where the slab's foot meets the mat.
   */
  shadow: {
    sigma0: PHYSICS.shadow.sigma,
    perUnit: 0.36,
    alpha: 0.5,
    alphaHeld: 0.44,
    slopeMax: PHYSICS.shadow.slopeMax,
    glass: 0.07,
    edge: 0.3,
    caustic: 0.16,
    causticWidth: 0.8,
    contact: { alpha: 0.42, sigma: 0.9, reach: 2.5 },
  },
  /**
   * The page's panel: the share of the light on an unlit panel it scatters (a black page in the sun still shows the
   * dapple, faintly), its level by night (bright to the eye adapted to the Moon — the phone's), by day (the byte is the
   * drawn byte). PT-5b — a PHOTOGRAPH of the page (its last still, the host's — never passed off as the page) is a step
   * dimmer: `still` of its light (a white page's byte 255 reads 217), in both schemes and by day and by night; under a
   * failure's words dimmer still (`stillUnder`: 255 reads 111 — the words' light is added over it and must read).
   */
  display: { scatter: 0.006, night: 0.8, day: 1, still: 0.7, stillUnder: 0.16 },
  /**
   * The GLOW by night: the eye's veiling glare round a bright page (its shape blurred at two widths, mm, with their
   * weights — the phone's law); the page's light on the mat round the pane (a pool this wide, mm, at this strength); the
   * EDGE LIGHT — the page's light caught in the slab and let out at every polished edge (their strength) and out of every
   * ENGRAVED mark (its share: an edge-lit sign's marks are its brightest part) — with the LEAK a display's light shows
   * there even behind a dark page; and the thin halo the edges throw on the mat hugging the outline (strength, width mm).
   */
  glow: {
    bloom: [0.05, 0.035],
    sigma: [4, 18],
    spill: 0.5,
    spillSigma: 26,
    edge: 0.75,
    frost: 0.9,
    leak: 0.035,
    halo: 0.35,
    haloSigma: 2.2,
  },
  /**
   * The stream's policy (BROWSER.md §5; the phone's §6) — PT-2's, carried unchanged: the engine renders the page at its
   * device's pixel ratio, always; a pane asks for the capture at the halving of that native size that covers its page's
   * device pixels on screen (never more than `rungs` halvings down), at a rate by its size on screen, 0 off screen (the
   * last frame holds); in use, the native capture at full rate.
   */
  // far 15, not the prototype's 12: LSF delivers in buckets (0/2/5/10/15/30/60) and 12 is none of them (PT-2 ruling 5)
  stream: { texelsPerPx: 1, rungs: 3, fps: { focused: 60, near: 30, far: 15 }, nearPx: 320 },
  /** The lamp on a face — the kit's one physics (`PHYSICS.light`): the fill a face turned away keeps, how far past flat one turned toward it brightens. */
  lamp: PHYSICS.light,
  /** Resizing: how far from the outline (CSS px on screen) a press takes an edge, and the smallest page (CSS px). */
  resize: { band: 9, min: MIN_VIEWPORT },
} as const;

/** The law with its literals widened — what a host tunes. */
export type BrowserLaw = Widen<typeof BROWSER_SPEC>;
/** The pane's numbers. Never written — a host tunes its own copy (`structuredClone(BROWSER)`). */
export const BROWSER: BrowserLaw = BROWSER_SPEC as unknown as BrowserLaw;

// ---------------------------------------------------------------- the shape, in world units

/** What the pass and the hit-test need of a pane, in world units (its own frame: origin at the top face's centre, v down the page). */
export interface PaneShape {
  /** The page's CSS size (derived from the size: whole px, never under the smallest) and the device it is cut for. */
  readonly viewport: readonly [number, number];
  readonly device: Device;
  /** World units per CSS px of the page — the device's density. */
  readonly scale: number;
  /** The outline's half extents, the slab's thickness, the outline's corner. */
  readonly half: readonly [number, number];
  readonly thick: number;
  readonly corner: number;
  /** The arris: its width inward from the outline and its fall. */
  readonly rim: readonly [number, number];
  /** The page: its centre (u, v) and half extents; its corner. */
  readonly page: readonly [number, number, number, number];
  readonly pageCorner: number;
  /** The engraved head: from the outline's top (v = −half[1]) down to this v (the page's top edge). */
  readonly band: number;
  /** The clear border's width. */
  readonly border: number;
}

/**
 * A pane cut to its SIZE (world units — the object's `Size`, the truth) at a device's density: the outline IS the size,
 * the page is what lies inside the border and under the head, and the viewport is that page over the density (whole CSS
 * px, never under the smallest — devices.ts `viewportOf`).
 */
export function shapeOf(
  size: { readonly w: number; readonly h: number },
  device: Device = DEFAULT_DEVICE,
  law: BrowserLaw = BROWSER,
): PaneShape {
  const P = law.pane;
  const scale = device.density * MM;
  const border = P.border * MM;
  const band = P.band * MM;
  const half: [number, number] = [size.w / 2, size.h / 2];
  const pw = Math.max(size.w - 2 * border, 1e-3);
  const ph = Math.max(size.h - border - band, 1e-3);
  const pcy = -half[1] + band + ph / 2;
  const corner = Math.min(P.corner * MM, half[0], half[1]);
  return {
    viewport: viewportOf(size, device),
    device,
    scale,
    half,
    thick: P.thick * MM,
    corner,
    rim: [(P.rim[0] ?? 1) * MM, (P.rim[1] ?? 1) * MM],
    page: [0, pcy, pw / 2, ph / 2],
    pageCorner: Math.max(corner - border, 0),
    band: -half[1] + band,
    border,
  };
}

// ---------------------------------------------------------------- the distances (browser.wgsl mirrors every one)

export function sdRoundBox(x: number, y: number, hx: number, hy: number, r: number): number {
  const rr = Math.min(Math.max(r, 0), hx, hy);
  const ax = Math.abs(x) - hx + rr;
  const ay = Math.abs(y) - hy + rr;
  return Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - rr;
}
/** The pane's outline at a local point. */
export const sdPane = (S: PaneShape, u: number, v: number): number =>
  sdRoundBox(u, v, S.half[0], S.half[1], S.corner);
/** The page's lit area. */
export const sdPage = (S: PaneShape, u: number, v: number): number =>
  sdRoundBox(u - S.page[0], v - S.page[1], S.page[2], S.page[3], S.pageCorner);

/**
 * The top face's height below its plane at a depth `d` inside the outline (0 at the outline): flat past the arris; over
 * it a quarter ellipse — the polished edge rolling into the wall. Returns the height (≤ 0) and its slope along the depth
 * (≥ 0; vertical at the outline).
 */
export function rimAt(S: PaneShape, d: number): readonly [number, number] {
  const [rw, rd] = S.rim;
  if (d >= rw) return [0, 0];
  const t = Math.min(Math.max(1 - d / rw, 0), 1);
  const tc = Math.min(t, 0.9995);
  return [-rd * (1 - Math.sqrt(1 - t * t)), (rd * tc) / (rw * Math.sqrt(1 - tc * tc))];
}

// ---------------------------------------------------------------- the eye and the pose → the geometry

export type Vec3 = readonly [number, number, number];

/** An eye as the pane is seen from it: its foot on the desk (world) and its height — the kit's `DeskEye` without a screen. */
export type PaneEye = Pick<DeskEye, "ex" | "ey" | "h">;

/** How high the pane's LOCAL eye stands over its centre (world units): the desk eye's height over a view that frames it. */
export function eyeHeight(
  size: { readonly w: number; readonly h: number },
  law: BrowserLaw = BROWSER,
): number {
  return Math.max(law.eye.min, law.eye.k * law.eye.frame * Math.hypot(size.w, size.h));
}

export interface PaneGeometry {
  readonly shape: PaneShape;
  /** The top face's centre in 3D (world; z its height), the pane's own axes (unit) and normal. */
  readonly centre: Vec3;
  readonly ex: Vec3;
  readonly ey: Vec3;
  readonly n: Vec3;
  /** The local eye the pane is drawn and picked from: over its centre (world, z its height). */
  readonly eye: PaneEye;
  /** The foot's height: the contact lets go as it rises. */
  readonly bottom: number;
  /** Toward the lamp (unit), the shadow's ground offset per unit of height, its alpha. */
  readonly light: Vec3;
  readonly slope: readonly [number, number];
  readonly shadowAlpha: number;
  /** Its presence: 1 whole, falling to 0 as a delete's ghost fades. */
  readonly alpha: number;
  /** PT-3 — drawn IN HAND: its page and its head's controls are named parts (`heldPartAt`); at rest every point is the pane. */
  readonly held?: boolean;
  /** PT-5a — its page FAILED: the page's area is the film with a notice on it (notice.ts) — in hand its "Try again" capsule
   * is a part where there is something to try (`retry`), and the rest of the film is the pane's own glass. */
  readonly notice?: { readonly retry: boolean };
  /** The world rect the pass's quad covers: the pane as the eye sees it, its shadow, and its glow's reach. */
  readonly bounds: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

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

/** A world point (z up) as an eye sees it on the desk plane. */
export function seen(eye: PaneEye, P: Vec3): [number, number] {
  const k = eye.h / Math.max(eye.h - P[2], 1e-3);
  return [eye.ex + (P[0] - eye.ex) * k, eye.ey + (P[1] - eye.ey) * k];
}

/** The pane's own frame (u right, v down its page, w up from the top face) → a world point. */
export function pointAt(
  G: Pick<PaneGeometry, "centre" | "ex" | "ey" | "n">,
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

/** How high a pane rides off the mat for its flux: `lift` (carried) up to the lift's height, `hover` a hair. */
export const heightOf = (
  flux: Pick<ObjectFlux, "lift" | "hover">,
  law: BrowserLaw = BROWSER,
): number => law.lift.height * flux.lift + law.lift.hover * flux.hover * (1 - flux.lift);

/** The pose → what the pass draws and the hit-test reads. `glow` = how far the glow reaches round the pane this frame (world; 0 = none). */
export function resolvePane(
  rect: ObjectRect,
  flux: Pick<ObjectFlux, "lift" | "hover" | "fade">,
  S: PaneShape,
  lamp: Lamp = LAMP,
  law: BrowserLaw = BROWSER,
  glow = 0,
  held = false,
  notice?: { readonly retry: boolean },
): PaneGeometry {
  // square to the mat and never tipped: core's drag carries the rect, and nothing on this desk turns by itself
  const h = heightOf(flux, law);
  const aloft = Math.min(Math.max(h / Math.max(law.lift.height * 0.5, 1e-3), 0), 1);
  const n: Vec3 = [0, 0, 1];
  const ex: Vec3 = [1, 0, 0];
  const ey: Vec3 = [0, 1, 0];
  const centre: Vec3 = [rect.cx, rect.cy, h + S.thick];
  const eye: PaneEye = { ex: rect.cx, ey: rect.cy, h: eyeHeight(rect, law) };
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
    ...(notice === undefined ? {} : { notice: { retry: notice.retry } }),
  };
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    for (const w of [0, -S.thick]) {
      const P = pointAt(G0, u * S.half[0], v * S.half[1], w);
      add(...seen(eye, P));
      add(P[0] + slope[0] * P[2], P[1] + slope[1] * P[2]);
    }
  }
  const pad = 3 * (law.shadow.sigma0 + law.shadow.perUnit * (centre[2] + 4)) + 6 + glow;
  return { ...G0, bounds: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } };
}

// ---------------------------------------------------------------- the ray (browser.wgsl `bw_trace`, mirrored)

export type PanePart = "face" | "rim" | "wall";
export interface PaneHit {
  readonly part: PanePart;
  /** The hit in the pane's frame: u, v on the top face's plane, w below it (≤ 0). */
  readonly u: number;
  readonly v: number;
  readonly w: number;
}

/** The steps the arris's bisection takes: its fall over 2¹⁰. */
export const RIM_STEPS = 10;

/**
 * The eye's ray through a desk point, into the pane: the top face (flat past the arris); the arris — bisected over its
 * fall (a straight ray crosses a convex rim at most twice and starts above it); or the polished wall below it, which the
 * eye sees on the side facing it. null = the desk. The eye is the pane's own (`G.eye`) unless one is given.
 */
export function castPane(
  G: PaneGeometry,
  wx: number,
  wy: number,
  eye: PaneEye = G.eye,
): PaneHit | null {
  const S = G.shape;
  const O: Vec3 = [eye.ex - G.centre[0], eye.ey - G.centre[1], eye.h - G.centre[2]];
  const D: Vec3 = [wx - eye.ex, wy - eye.ey, -eye.h];
  const o = [dot3(O, G.ex), dot3(O, G.ey), dot3(O, G.n)] as const;
  const d = [dot3(D, G.ex), dot3(D, G.ey), dot3(D, G.n)] as const;
  if (d[2] > -1e-6) return null;
  const at = (w: number) => {
    const t = (w - o[2]) / d[2];
    return [o[0] + d[0] * t, o[1] + d[1] * t] as const;
  };
  const depthAt = (w: number) => {
    const [u, v] = at(w);
    return -sdPane(S, u, v);
  };
  const [u0, v0] = at(0);
  if (-sdPane(S, u0, v0) >= S.rim[0]) return { part: "face", u: u0, v: v0, w: 0 };
  const drop = S.rim[1];
  if (depthAt(-drop) >= 0) {
    let hi = 0;
    let lo = -drop;
    for (let i = 0; i < RIM_STEPS; i++) {
      const mid = (hi + lo) / 2;
      const dm = depthAt(mid);
      if (dm < 0 || mid > (rimAt(S, dm)[0] as number)) hi = mid;
      else lo = mid;
    }
    const [u, v] = at(lo);
    return { part: "rim", u, v, w: lo };
  }
  const wTop = -drop;
  const wBot = -S.thick;
  const da = -depthAt(wTop);
  const db = -depthAt(wBot);
  if (db <= 0 && da > 0) {
    const f = da / (da - db);
    const w = wTop + (wBot - wTop) * f;
    const [u, v] = at(w);
    return { part: "wall", u, v, w };
  }
  return null;
}

/** Where the eye's ray through a desk point crosses the top face's plane, in the pane's frame — a pointer that slides off the page keeps a point. */
export function facePoint(
  G: PaneGeometry,
  wx: number,
  wy: number,
  eye: PaneEye = G.eye,
): readonly [number, number] {
  const O: Vec3 = [eye.ex - G.centre[0], eye.ey - G.centre[1], eye.h - G.centre[2]];
  const D: Vec3 = [wx - eye.ex, wy - eye.ey, -eye.h];
  const oz = dot3(O, G.n);
  const dz = dot3(D, G.n);
  const t = Math.abs(dz) > 1e-9 ? -oz / dz : 0;
  return [dot3(O, G.ex) + dot3(D, G.ex) * t, dot3(O, G.ey) + dot3(D, G.ey) * t];
}

/**
 * How far inside the silhouette a desk point's ray passes (positive inside): the outline at the arris's foot on the far
 * side, the foot of the wall on the near side. The 1-px coverage of the pane's edge.
 */
export function silhouetteDepth(
  G: PaneGeometry,
  wx: number,
  wy: number,
  eye: PaneEye = G.eye,
): number {
  const S = G.shape;
  const O: Vec3 = [eye.ex - G.centre[0], eye.ey - G.centre[1], eye.h - G.centre[2]];
  const D: Vec3 = [wx - eye.ex, wy - eye.ey, -eye.h];
  const o = [dot3(O, G.ex), dot3(O, G.ey), dot3(O, G.n)] as const;
  const d = [dot3(D, G.ex), dot3(D, G.ey), dot3(D, G.n)] as const;
  if (d[2] > -1e-6) return -1e9;
  const depthAt = (w: number) => {
    const t = (w - o[2]) / d[2];
    return -sdPane(S, o[0] + d[0] * t, o[1] + d[1] * t);
  };
  return Math.max(depthAt(-S.rim[1]), depthAt(-S.thick));
}

/**
 * The silhouette as the pane's own eye sees it — the outline at the arris's foot, magnified about the eye's foot (the
 * centre) by its height there: centre, half extents and corner, world units. What the desk's marks go round.
 */
export function silhouetteOf(G: PaneGeometry): {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly r: number;
} {
  const S = G.shape;
  const z = G.centre[2] - S.rim[1];
  const k = G.eye.h / Math.max(G.eye.h - z, 1e-3);
  return { cx: G.eye.ex, cy: G.eye.ey, hx: S.half[0] * k, hy: S.half[1] * k, r: S.corner * k };
}

// ---------------------------------------------------------------- the head: the engraved chrome and where its controls are

export type Control = "back" | "forward" | "reload" | "address" | "size";

/** The head's engraved controls, in the pane's frame (world units): each a centre and half extents. */
export interface BandLayout {
  /** The head's vertical centre and the glyphs' height (a control's hit box is `glyph` tall and wide). */
  readonly cy: number;
  readonly glyph: number;
  /** Absent on a narrow pane (a phone's): the address takes the head alone. */
  readonly back: readonly [number, number] | null;
  readonly forward: readonly [number, number] | null;
  readonly reload: readonly [number, number] | null;
  /** The address field: a capsule of frost — centre and half extents. */
  readonly address: readonly [number, number, number, number];
  /** The size readout's right edge (it is set flush right), or null. */
  readonly size: number | null;
  readonly compact: boolean;
}

/** Where the head's controls are on a pane (the head's raster draws them there; the hit test reads them back). */
export function bandLayout(S: PaneShape): BandLayout {
  const top = -S.half[1];
  const bottom = S.band;
  // the head's engraving sits a hair below its middle — the head's arris takes the top millimetre
  const cy = top + (bottom - top) * 0.54;
  const glyph = 4.2 * MM;
  const inner = S.half[0] - S.border - 0.6 * MM;
  const compact = S.half[0] * 2 < 120 * MM;
  const capH = 3.1 * MM;
  if (compact)
    return {
      cy,
      glyph,
      back: null,
      forward: null,
      reload: null,
      address: [0, cy, Math.max(inner, 8), capH],
      size: null,
      compact,
    };
  const back: [number, number] = [-inner + glyph * 0.5, cy];
  const forward: [number, number] = [back[0] + glyph * 1.35, cy];
  const capW = Math.min(Math.max(S.half[0] * 0.5, 40 * MM), 84 * MM);
  const reload: [number, number] = [capW - glyph * 0.62, cy];
  return { cy, glyph, back, forward, reload, address: [0, cy, capW, capH], size: inner, compact };
}

/** Which engraved control is at a head point (local u, v), if any. */
export function controlAt(S: PaneShape, u: number, v: number): Control | null {
  const L = bandLayout(S);
  const near = (c: readonly [number, number] | null) =>
    !!c && Math.abs(u - c[0]) <= L.glyph * 0.62 && Math.abs(v - c[1]) <= L.glyph * 0.62;
  if (near(L.reload)) return "reload";
  if (near(L.back)) return "back";
  if (near(L.forward)) return "forward";
  const [ax, ay, ahx, ahy] = L.address;
  if (Math.abs(u - ax) <= ahx && Math.abs(v - ay) <= ahy * 1.35) return "address";
  if (
    L.size !== null &&
    u > L.address[0] + L.address[2] + L.glyph &&
    u <= L.size &&
    Math.abs(v - L.cy) <= L.glyph * 0.6
  )
    return "size";
  return null;
}

// ---------------------------------------------------------------- what is under a point

/** A face point (the pane's frame) → the page's CSS px, and back. */
export function pagePoint(S: PaneShape, u: number, v: number): readonly [number, number] {
  const [cx, cy, hx, hy] = S.page;
  return [((u - cx + hx) / (2 * hx)) * S.viewport[0], ((v - cy + hy) / (2 * hy)) * S.viewport[1]];
}
export function faceOfPage(S: PaneShape, x: number, y: number): readonly [number, number] {
  const [cx, cy, hx, hy] = S.page;
  return [cx - hx + (x / S.viewport[0]) * 2 * hx, cy - hy + (y / S.viewport[1]) * 2 * hy];
}

/** What is under a desk point: the PAGE (with its CSS point), an engraved CONTROL in the head, the GLASS, or nothing. */
export type PanePick =
  | { readonly part: "page"; readonly point: readonly [number, number] }
  | { readonly part: "band"; readonly control: Control | null }
  | { readonly part: "glass" }
  | null;
export function pickPane(G: PaneGeometry, wx: number, wy: number, eye: PaneEye = G.eye): PanePick {
  const hit = castPane(G, wx, wy, eye);
  if (!hit) return null;
  const S = G.shape;
  if (hit.part === "face" && sdPage(S, hit.u, hit.v) < 0)
    return { part: "page", point: pagePoint(S, hit.u, hit.v) };
  if (hit.part === "face" && hit.v < S.band && sdPane(S, hit.u, hit.v) < -S.rim[0])
    return { part: "band", control: controlAt(S, hit.u, hit.v) };
  return { part: "glass" };
}

// ---------------------------------------------------------------- in hand (PT-3)

/** The pane's OPEN extent (`open.extent`): the page and the head, in its own desk units, centred as its rect is — the hand's
 * points are measured from its centre. */
export function openExtent(
  rect: Pick<ObjectRect, "cx" | "cy">,
  S: PaneShape,
): { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number } {
  const top = -S.half[1];
  const foot = S.page[1] + S.page[3];
  return { cx: rect.cx, cy: rect.cy + (top + foot) / 2, w: 2 * S.page[2], h: foot - top };
}

/** A pane's NAMED PARTS in hand (PT-3 ruling 2): its page, and its head's engraved controls (the size readout is not one) —
 * and (PT-5a) a failed page's "Try again" capsule (`retry`). */
export type HeldPart = "page" | "back" | "forward" | "reload" | "address" | "retry";
export const HELD_CONTROLS: readonly HeldPart[] = ["back", "forward", "reload", "address", "retry"];

/**
 * What the hand points at on a pane IN HAND (ruling 2): its PAGE (presses there are the kind's — a double-click selects a word,
 * never puts the pane down), an engraved CONTROL of its head, the rest of the glass (`content` — the object's, a drag carries
 * it), or nothing past its silhouette. As the pane's own eye draws it (`pickPane`): what is pressed is what is seen.
 * PT-5a — a FAILED page has no page to press: its film is the pane's own glass (`content`), but for the notice's capsule
 * (`retry`) where there is something to try.
 */
export function heldPartAt(G: PaneGeometry, wx: number, wy: number): HeldPart | "content" | null {
  const pick = pickPane(G, wx, wy);
  if (pick === null) return null;
  if (pick.part === "page") {
    if (G.notice === undefined) return "page";
    return G.notice.retry && retryAt(G.shape.viewport, pick.point[0], pick.point[1])
      ? "retry"
      : "content";
  }
  if (pick.part === "band" && pick.control !== null && pick.control !== "size") return pick.control;
  return "content";
}

/**
 * A point of the hand (`HeldEvent` — the open extent's units, centred) → the page's CSS px: through the pane's own eye onto its
 * face's plane, so a press dragged off the page keeps a point (ruling 3; the face scales it to the displayed frame).
 */
export function heldPagePoint(
  G: PaneGeometry,
  ext: { readonly cx: number; readonly cy: number },
  x: number,
  y: number,
): readonly [number, number] {
  const [u, v] = facePoint(G, ext.cx + x, ext.cy + y);
  return pagePoint(G.shape, u, v);
}

/**
 * What the finger moved ON THE SCREEN as the page's CSS px (ruling 4; BROWSER.md §6): a wheel's CSS px of the hand over the
 * hand's zoom (CSS px a desk unit) are desk units, and those over the page's density (desk units a CSS px — `S.scale`) are
 * the page's px — so the page scrolls by what the finger moved, whatever the zoom.
 */
export const wheelToPage = (d: number, zoom: number, S: PaneShape): number =>
  d / (Math.max(zoom, 1e-9) * S.scale);

/**
 * Which edge of a pane a desk point is on, for a resize: the outline as the eye sees it at the top face, within `band`
 * CSS px either side at `zoom`. Returns the directions it moves (−1, 0, +1 per axis) or null.
 */
export function edgeAt(
  G: PaneGeometry,
  wx: number,
  wy: number,
  bandCss: number,
  zoom: number,
  eye: PaneEye = G.eye,
): readonly [number, number] | null {
  const S = G.shape;
  const [u, v] = facePoint(G, wx, wy, eye);
  const band = bandCss / Math.max(zoom, 1e-9);
  const d = sdPane(S, u, v);
  if (Math.abs(d) > band) return null;
  const nearX = Math.abs(Math.abs(u) - S.half[0]) <= band + S.corner * 0.35;
  const nearY = Math.abs(Math.abs(v) - S.half[1]) <= band + S.corner * 0.35;
  const sx = nearX ? Math.sign(u) : 0;
  const sy = nearY ? Math.sign(v) : 0;
  return sx === 0 && sy === 0 ? null : [sx, sy];
}

/** The page's rect on screen (CSS px) under the DESK eye (the kit's `eyeOf` — the camera's): its four corners as it sees them. */
export function pageOnScreen(
  G: PaneGeometry,
  eye: DeskEye,
): { x0: number; y0: number; x1: number; y1: number } {
  const S = G.shape;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const [wx, wy] = seen(eye, pointAt(G, S.page[0] + a * S.page[2], S.page[1] + b * S.page[3]));
    const sx = eye.vw / 2 + (wx - eye.ex) * eye.zoom;
    const sy = eye.vh / 2 + (wy - eye.ey) * eye.zoom;
    x0 = Math.min(x0, sx);
    y0 = Math.min(y0, sy);
    x1 = Math.max(x1, sx);
    y1 = Math.max(y1, sy);
  }
  return { x0, y0, x1, y1 };
}

/** The mip level the page's texture is read at: texels per device pixel across the page, as the desk eye sees it. */
export function pageLod(G: PaneGeometry, eye: DeskEye, texWidth: number, dpr: number): number {
  const r = pageOnScreen(G, eye);
  const px = Math.max((r.x1 - r.x0) * dpr, 1);
  return Math.max(Math.log2(texWidth / px), 0);
}

// ---------------------------------------------------------------- the stream's demand (PT-2's)

/** What the page's stream should send: the capture's size — a halving of the native capture — and the rate. */
export interface PageDemand {
  /** The capture's size, px. */
  readonly width: number;
  readonly height: number;
  /** Frames per second; 0 = hold the last frame. */
  readonly fps: number;
  readonly visible: boolean;
}

/** The native capture: the page at its device's pixel ratio. */
export const nativeOf = (S: PaneShape): readonly [number, number] => [
  Math.round(S.viewport[0] * S.device.dpr),
  Math.round(S.viewport[1] * S.device.dpr),
];

/**
 * The phone's policy (PHONE.md §6), for a page: `held` is the width the stream sends now — a rung is kept while it still
 * covers the page's device pixels and is no more than 2.3× them, so a wobbling zoom does not make the capture flip sizes
 * every frame.
 */
export function pageDemand(
  G: PaneGeometry,
  eye: DeskEye,
  dpr: number,
  focused: boolean,
  law: BrowserLaw = BROWSER,
  held?: number,
): PageDemand {
  const [nw, nh] = nativeOf(G.shape);
  const r = pageOnScreen(G, eye);
  const visible = r.x1 > 0 && r.y1 > 0 && r.x0 < eye.vw && r.y0 < eye.vh;
  const devPx = Math.max(Math.abs(r.x1 - r.x0), 1) * dpr * law.stream.texelsPerPx;
  const fps = !visible
    ? 0
    : focused
      ? law.stream.fps.focused
      : devPx >= law.stream.nearPx
        ? law.stream.fps.near
        : law.stream.fps.far;
  if (focused && visible) return { width: nw, height: nh, fps, visible };
  const rungs = Array.from({ length: law.stream.rungs + 1 }, (_, k) => Math.round(nw / 2 ** k));
  if (
    held !== undefined &&
    rungs.includes(held) &&
    held >= Math.min(devPx, nw) &&
    held <= devPx * 2.3
  ) {
    const k = rungs.indexOf(held);
    return { width: held, height: Math.round(nh / 2 ** k), fps, visible };
  }
  let k = 0;
  while (k < law.stream.rungs && nw / 2 ** (k + 1) >= devPx) k++;
  return { width: Math.round(nw / 2 ** k), height: Math.round(nh / 2 ** k), fps, visible };
}

// ---------------------------------------------------------------- the live page's demand, over the SIGHT (PT-2)

/**
 * The PAGE's rect on its desk — what the pass tells the SIGHT for every record it prepared (PT-2; PT-5a): a pane is PREPARED
 * while within its reach of the view — its shadow, its glow — and its page is SEEN only where it is drawn, so a pane panned
 * just off the view pauses its page. The sight judges that itself since ICE `0.16.0-portals.4` (I50: `saw` believes only a
 * face that meets the slot's box); the pane's own clip (`pageOnBox`) is gone. The rect is the page's centre and the half
 * extents that cover it along the pane's axes (the eye's parallax, a hair, left out).
 */
export function pageRect(G: PaneGeometry): {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
} {
  const S = G.shape;
  return {
    cx: G.centre[0] + G.ex[0] * S.page[0] + G.ey[0] * S.page[1],
    cy: G.centre[1] + G.ex[1] * S.page[0] + G.ey[1] * S.page[1],
    w: 2 * (Math.abs(G.ex[0]) * S.page[2] + Math.abs(G.ey[0]) * S.page[3]),
    h: 2 * (Math.abs(G.ex[1]) * S.page[2] + Math.abs(G.ey[1]) * S.page[3]),
  };
}

/** What the desk says it drew of a face last frame (ICE's `Seen`, design-019 §3.4): drawn, its largest device px, held. */
export interface PaneSeen {
  readonly seen: boolean;
  readonly px: readonly [number, number];
  readonly held: boolean;
}

/** What the pane asks of its page's source (ICE's `LiveDemand`, design-019 §4) — the host maps it to its producer. */
export interface PaneLiveDemand {
  readonly mode: "live" | "paused";
  readonly fps: number;
  readonly raster: readonly [number, number];
  readonly viewport?: readonly [number, number];
  readonly interactive: boolean;
}

/**
 * THE PANE'S DEMAND LAW over its SIGHT (PT-2 ruling 5 — the prototype's `pageDemand` above, re-based on what the desk says it
 * drew of the page, `px` the page's device px): UNSEEN — off screen, culled, behind the hand — paused; HELD — the native capture
 * at 60, interactive; at rest the halving of native that covers the page's device px (at most `rungs` halvings; a rung `held`
 * is kept while it still covers the page and is no more than 2.3× it, so a wobbling zoom never flips the raster), 30 fps while
 * the page is ≥ 320 device px wide and 15 below. The viewport is always the pane's own (its Size at its device's density) — a
 * paused page keeps its layout, so waking it never reflows it.
 */
export function paneDemand(
  s: PaneSeen,
  S: PaneShape,
  held?: number,
  law: BrowserLaw = BROWSER,
): PaneLiveDemand {
  const viewport = S.viewport;
  if (!s.seen) return { mode: "paused", fps: 0, raster: [0, 0], viewport, interactive: false };
  const [nw, nh] = nativeOf(S);
  if (s.held)
    return {
      mode: "live",
      fps: law.stream.fps.focused,
      raster: [nw, nh],
      viewport,
      interactive: true,
    };
  const devPx = Math.max(s.px[0], 1) * law.stream.texelsPerPx;
  const fps = devPx >= law.stream.nearPx ? law.stream.fps.near : law.stream.fps.far;
  const rungs = Array.from({ length: law.stream.rungs + 1 }, (_, k) => Math.round(nw / 2 ** k));
  const at = (k: number): PaneLiveDemand => ({
    mode: "live",
    fps,
    raster: [Math.round(nw / 2 ** k), Math.round(nh / 2 ** k)],
    viewport,
    interactive: false,
  });
  if (
    held !== undefined &&
    rungs.includes(held) &&
    held >= Math.min(devPx, nw) &&
    held <= devPx * 2.3
  )
    return at(rungs.indexOf(held));
  let k = 0;
  while (k < law.stream.rungs && nw / 2 ** (k + 1) >= devPx) k++;
  return at(k);
}

/** Two demands that ask the same — the law speaks change-only. */
export const sameDemand = (a: PaneLiveDemand | undefined, b: PaneLiveDemand): boolean =>
  a !== undefined &&
  a.mode === b.mode &&
  a.fps === b.fps &&
  a.interactive === b.interactive &&
  a.raster[0] === b.raster[0] &&
  a.raster[1] === b.raster[1] &&
  a.viewport?.[0] === b.viewport?.[0] &&
  a.viewport?.[1] === b.viewport?.[1];

// ---------------------------------------------------------------- resizing: the viewport a dragged edge asks for

/**
 * A pane's viewport after its edge is dragged by (dx, dy) world units in the directions `dir`: the page grows by what the
 * outline grows (the border and the head stay), in whole CSS px, never under `min` — what `viewportOf` derives from the
 * size core's handles write.
 */
export function resized(
  S: PaneShape,
  dir: readonly [number, number],
  dx: number,
  dy: number,
  law: BrowserLaw = BROWSER,
): readonly [number, number] {
  const w = Math.max(Math.round(S.viewport[0] + (dir[0] * dx) / S.scale), law.resize.min[0] ?? 320);
  const h = Math.max(Math.round(S.viewport[1] + (dir[1] * dy) / S.scale), law.resize.min[1] ?? 240);
  return [dir[0] === 0 ? S.viewport[0] : w, dir[1] === 0 ? S.viewport[1] : h];
}

// ---------------------------------------------------------------- how far it draws past its rect

/** How far the glow reaches round a pane (world): the spill's pool, three σ. */
export const glowReach = (law: BrowserLaw = BROWSER): number => 3 * law.glow.spillSigma * MM;

/**
 * How far a pane's drawing reaches PAST its rect, world units — the kind's `reach`: its shadow at full lift (cast along
 * the lamp's capped slope from the top face's height and blurred there, the quad's own pad), PLUS the night's glow round
 * it (the spill's pool), PLUS the lift's growth under its own eye (bounded by the top face's height: the eye stands at
 * least 1.9 pane diagonals up, so a corner moves out by under a quarter of that height).
 */
export function paneReach(law: BrowserLaw = BROWSER): number {
  const top = law.pane.thick * MM + law.lift.height;
  const shadow =
    law.shadow.slopeMax * top + 3 * (law.shadow.sigma0 + law.shadow.perUnit * (top + 4)) + 6;
  return shadow + glowReach(law) + top;
}
