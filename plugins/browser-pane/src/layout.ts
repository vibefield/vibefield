// The pane pass's GPU records, declared once (the prototype's src/browser/layout.ts, moved). `Pane` is one pane as drawn
// — `resolvePane`'s pose in 3D, its local eye, its shape in world units, its glass, its page's and its head's state, the
// lamp as it falls on it. `PaneUniforms` is the pass's knobs: the shadow's law, the glass and its frost, the glow, the
// panel's off colour, the cast colour and the environment the glass mirrors (the phone's — one sky over one desk). The
// camera, the light, the gobo, the night and the portal chain arrive in the slot's view block (`MatUniforms`), which the
// pass binds and never writes.
//
// What moved since the prototype: the EYE is the pane's own (`Pane.eye` — the photo's local eye, PT-1 ruling 3), no
// longer the knobs' one desk eye; the page's mip LEVEL is the shader's, from the slot's zoom (the record is camera-free:
// the desk reuses it across a pan and a zoom within the head's rung); the selection RING is gone (ICE D4a: the desk's
// marks draw the selection — a kind draws none of its own).

import {
  defineStruct,
  type Entity,
  type LiveFace,
  type LiveTexture,
  type RGB,
  type Sight,
} from "@vibefield/plugin-sdk/desk";
import { BROWSER, type BrowserLaw, bandLayout, MM, type PaneGeometry } from "./law";

export const Pane = defineStruct("Pane", [
  ["centre", "vec4f"], // the top face's centre xyz (world, z = its height), presence
  ["ex", "vec4f"], // the pane's x axis (unit, 3D), the outline's half width
  ["ey", "vec4f"], // its y axis (down its page), the outline's half height
  ["n", "vec4f"], // its normal, the slab's thickness
  ["eye", "vec4f"], // the pane's own eye: its foot x, y (world), its height; unused
  ["shape", "vec4f"], // the outline's corner, the page's corner, the arris's width, its fall
  ["page", "vec4f"], // the page: centre u, v, half extents
  ["band", "vec4f"], // the head's foot (v), the clear border's width, the head's glyph size, compact (0/1)
  ["cap", "vec4f"], // the address capsule: centre u, v, half extents
  ["tint", "vec4f"], // the glass's edge colour (sRGB — what a long path through it shows), the path it is measured over (world)
  ["screen", "vec4f"], // the page's texture: texels wide, high; its last level; on (0…1: a page in hand)
  ["screen2", "vec4f"], // unused; brightness; the glow's level; loading (0…1, < 0 = not loading)
  ["ink", "vec4f"], // the head's raster: on (0/1), the engraving's share of its rows, where the print's rows start (both 0…1), unused
  ["hover", "vec4f"], // a control under the pointer (in use — PT-3): its centre u, v, radius, presence (pressed > 1)
  ["light", "vec4f"], // toward the lamp (unit), the page's shadow alpha
  ["slope", "vec4f"], // the shadow's ground offset per unit of height xy, the foot's height, unused
  ["bounds", "vec4f"], // the quad: x0 y0 x1 y1 (world)
] as const);

export const PaneUniforms = defineStruct("PaneUniforms", [
  ["shade", "vec4f"], // the shadow's colour by day (sRGB — the mat's cast); unused
  ["shadow", "vec4f"], // σ at contact, σ per unit of height, the glass's own share, a wall's
  ["shadow2", "vec4f"], // the caustic's strength, its width (world), the contact's alpha, its σ
  ["glass", "vec4f"], // Fresnel head on, the glint's strength, its shininess, the canopy's height (world)
  ["glass2", "vec4f"], // the veil over a lit page, the panel's scatter, the page's level by night, by day
  ["optics", "vec4f"], // the index, world units per mm, the contact's reach (world), unused
  ["frost", "vec4f"], // albedo, the share let through, sheen, the ink's opacity
  ["frost2", "vec4f"], // the frost's grit, unused, the veil over the clear border, unused
  ["glow", "vec4f"], // the bloom's two weights, its two σ (world)
  ["glow2", "vec4f"], // the spill's strength, its σ (world), the edges' light, the frost's
  ["glow3", "vec4f"], // the halo's strength, its σ (world), the leak (the light an engraving shows behind a dark page), unused
  ["panelOff", "vec4f"], // a page's panel with nothing on it (sRGB)
  ["frostTint", "vec4f"], // sandblasted glass (sRGB)
  ["progress", "vec4f"], // the loading line (sRGB), its width (world)
  ["sky", "vec4f"], // the day's sky, mirrored
  ["leaves", "vec4f"], // the leaves against it
  ["room", "vec4f"], // the room's dim side
  ["nightSky", "vec4f"], // the Moon's sky
  ["nightLeaves", "vec4f"], // the canopy by night
  ["lamp", "vec4f"], // the lamp on a face: its fill, its cap; unused ×2
  ["env", "vec4f"], // the window round the lamp: its brightness (× the sky), its share by night; unused ×2
] as const);

/** The most panes one slot's pass draws (the record store grows to it). */
export const MAX_PANES = 256;

/** A glass's finish, parsed (theme.ts): the colour a long path through it shows, and that path (mm). */
export interface PaneFinish {
  readonly edge: RGB;
  readonly path: number;
}

/** The pane's colours as the knobs take them (theme.ts `paneLook`). */
export interface PaneLookValues {
  /** The colour a shadow casts on the mat by day — the desk's, read off the palette's `cast` role (ICE I46). */
  readonly cast: RGB;
  readonly panelOff: RGB;
  readonly frost: RGB;
  readonly progress: RGB;
  readonly sky: RGB;
  readonly leaves: RGB;
  readonly room: RGB;
  readonly nightSky: RGB;
  readonly nightLeaves: RGB;
  readonly finishes: Readonly<Record<string, PaneFinish>>;
}

/** What the page shows: a still the plugin draws (PT-1) or a live page's texture (PT-2), its key and its texture's size — or nothing (the dark film). */
export interface PagePlan {
  /** Changes whenever the page's texels would: the generator's inputs. */
  readonly key: string;
  /** The page's CSS viewport and scheme, as the generator lays it. */
  readonly viewport: readonly [number, number];
  readonly scheme: "light" | "dark";
  /** The texture's texels (`pageTexels` — a CSS px a texel, under the cap). */
  readonly width: number;
  readonly height: number;
}

/** A head raster's bitmap: its engraving (alpha) and print (premultiplied RGBA) halves, rows top-down (head.ts `engraveSplit`). */
export interface HeadBitmap {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  /** The engraving's rows [0, h); the print's from `at`. */
  readonly h: number;
  readonly at: number;
}

/** What the head says, and the raster that says it: the lent service's (the product's), or none — the pass lays its committed one. */
export interface HeadPlan {
  /** What the raster depends on (head.ts `headKey`) — a new key is a new raster. */
  readonly key: string;
  /** The service's raster, or undefined: the pass draws the committed raster when it is the one this key names, else no engraving. */
  readonly bitmap?: HeadBitmap | undefined;
  /** The committed raster this key names (still.ts), when there is one and no service raster. */
  readonly still?: string | undefined;
  /** The split the shader reads: the raster's height and its halves' rows. */
  readonly split?: { readonly height: number; readonly h: number; readonly at: number } | undefined;
}

/** One pane for the pass: its geometry, its glass, its page and its head, the knobs' look. */
export interface PaneInstance {
  readonly geometry: PaneGeometry;
  readonly finish: PaneFinish;
  readonly look: PaneLookValues;
  /** The page shown (null: none — the dark film), its brightness, loading (< 0 = not). */
  readonly page: PagePlan | null;
  readonly brightness: number;
  readonly loading: number;
  readonly head: HeadPlan;
  /** A control under the pointer (in use — PT-3): its centre (the pane's frame), radius, presence. */
  readonly hover?:
    | { readonly u: number; readonly v: number; readonly r: number; readonly presence: number }
    | undefined;
  /**
   * PT-2 — the pane's LIVE page: its face (stable for the pane's life: the pass reads its texture at each prepare, so a frame
   * that lands redraws without a new record) and the sight the pass tells what it drew. Absent: the sample's still or the film.
   */
  readonly live?:
    | { readonly e: Entity; readonly face: LiveFace; readonly sight: Sight }
    | undefined;
}

/** A live page's plan: the face's texture as it stands — its size is what the shader's level reads (a new size remakes the record). */
export function livePlan(
  t: Pick<LiveTexture, "width" | "height" | "epoch">,
  viewport: readonly [number, number],
  scheme: "light" | "dark",
): PagePlan {
  return {
    key: `live|${t.epoch}|${t.width}x${t.height}`,
    viewport,
    scheme,
    width: t.width,
    height: t.height,
  };
}

/** The levels of a texture `w × h` texels: its chain down to one texel. */
export const levelsOf = (w: number, h: number): number =>
  Math.floor(Math.log2(Math.max(w, h, 1))) + 1;

/**
 * The level the glow's colour is read at: the page some 24 texels across — coarse enough to be the colour of a region,
 * fine enough that one bright button does not tint a whole edge of the pane.
 */
export const glowLevel = (width: number): number => Math.max(Math.log2(Math.max(width, 1) / 24), 0);

export function paneValues(p: PaneInstance) {
  const G = p.geometry;
  const S = G.shape;
  const L = bandLayout(S);
  const h = p.hover;
  const page = p.page;
  const split = p.head.split;
  const inked = split !== undefined && (p.head.bitmap !== undefined || p.head.still !== undefined);
  return {
    centre: [G.centre[0], G.centre[1], G.centre[2], G.alpha],
    ex: [G.ex[0], G.ex[1], G.ex[2], S.half[0]],
    ey: [G.ey[0], G.ey[1], G.ey[2], S.half[1]],
    n: [G.n[0], G.n[1], G.n[2], S.thick],
    eye: [G.eye.ex, G.eye.ey, G.eye.h, 0],
    shape: [S.corner, S.pageCorner, S.rim[0], S.rim[1]],
    page: [S.page[0], S.page[1], S.page[2], S.page[3]],
    band: [S.band, S.border, L.glyph, L.compact ? 1 : 0],
    cap: [L.address[0], L.address[1], L.address[2], L.address[3]],
    tint: [p.finish.edge[0], p.finish.edge[1], p.finish.edge[2], p.finish.path * MM],
    screen:
      page === null
        ? [1, 1, 0, 0]
        : [page.width, page.height, levelsOf(page.width, page.height) - 1, 1],
    screen2: [0, p.brightness, glowLevel(page?.width ?? 1), p.loading],
    ink: inked ? [1, split.h / split.height, split.at / split.height, 0] : [0, 0, 0, 0],
    hover: h ? [h.u, h.v, h.r, h.presence] : [0, 0, 1, 0],
    light: [G.light[0], G.light[1], G.light[2], G.shadowAlpha],
    slope: [G.slope[0], G.slope[1], G.bottom, 0],
    bounds: [G.bounds.x0, G.bounds.y0, G.bounds.x1, G.bounds.y1],
  };
}

export function paneUniformValues(look: PaneLookValues, law: BrowserLaw = BROWSER) {
  const v = (c: RGB, w = 0) => [c[0], c[1], c[2], w];
  const sh = law.shadow;
  const g = law.glass;
  const gl = law.glow;
  const fr = law.frost;
  return {
    shade: v(look.cast),
    shadow: [sh.sigma0, sh.perUnit, sh.glass, sh.edge],
    shadow2: [sh.caustic, sh.causticWidth * MM, sh.contact.alpha, sh.contact.sigma],
    glass: [g.f0, g.glint, g.shininess, g.canopy],
    glass2: [g.veil, law.display.scatter, law.display.night, law.display.day],
    optics: [g.ior, MM, sh.contact.reach, 0],
    frost: [fr.albedo, fr.transmit, fr.sheen, fr.ink],
    frost2: [fr.grit, 0, g.clear, 0],
    glow: [gl.bloom[0] ?? 0, gl.bloom[1] ?? 0, (gl.sigma[0] ?? 1) * MM, (gl.sigma[1] ?? 1) * MM],
    glow2: [gl.spill, gl.spillSigma * MM, gl.edge, gl.frost],
    glow3: [gl.halo, gl.haloSigma * MM, gl.leak, 0],
    panelOff: v(look.panelOff),
    frostTint: v(look.frost),
    progress: v(look.progress, 0.55 * MM),
    sky: v(look.sky),
    leaves: v(look.leaves),
    room: v(look.room),
    nightSky: v(look.nightSky),
    nightLeaves: v(look.nightLeaves),
    lamp: [law.lamp.ambient, law.lamp.cap, 0, 0],
    env: [g.window, g.windowNight, 0, 0],
  };
}
