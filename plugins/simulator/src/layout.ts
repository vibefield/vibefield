// The phone pass's GPU records, declared once (the prototype's src/phone/layout.ts, moved). `Phone` is one phone as drawn —
// `resolvePhone`'s pose in 3D, its local eye, its model's shape in world units, its finish, its screen's state and its
// honest face, the lamp as it falls on it. `PhoneUniforms` is the pass's knobs: the shadow's law, the glass, the three
// metals, the glow, the inks and the environment the glass mirrors, the words' ink and the marks. The camera, the light, the
// gobo, the night and the portal chain arrive in the slot's view block (`MatUniforms`), which the pass binds and never
// writes.
//
// What moved since the prototype: the EYE is the phone's own (`Phone.eye` — the local eye, the pane's PT-1 ruling 3), no
// longer the knobs' one desk eye; the screen's mip LEVEL is the shader's, from the slot's zoom (the record is camera-free);
// the selection RING is gone (ICE D4a: the desk's marks draw the selection); the finger's touch disc is gone (v1 is
// view-only); and the screen carries its HONEST FACE — a still's dim, its mark, and its words (their own texture).

import {
  defineStruct,
  type Entity,
  type LiveFace,
  type LiveTexture,
  type RGB,
  type Sight,
} from "@vibefield/plugin-sdk/desk";
import { MM, PHONE, type PhoneGeometry, type PhoneLaw } from "./law";

export const MAX_BUTTONS = 4;

export const Phone = defineStruct("Phone", [
  ["centre", "vec4f"], // the glass's centre xyz (world, z = its height), presence
  ["ex", "vec4f"], // the phone's x axis (unit, 3D), the body's half width
  ["ey", "vec4f"], // its y axis (down its screen), the body's half height
  ["n", "vec4f"], // its normal, the body's depth
  ["eye", "vec4f"], // the phone's own eye: its foot x, y (world), its height; unused
  ["corner", "vec4f"], // the body's corner: extent, exponent; the display's: extent, exponent (extent 0 = a rectangular LCD's square corner)
  ["display", "vec4f"], // the display's half extents xy; the rim's width, its fall
  ["edge", "vec4f"], // the side: its curve's facet (0 a quarter ellipse … 1 a 45° chamfer), the rim's metal width, the wall below the rim (0 a round side … 1 a flat wall to the base), the finish's polish
  ["metals", "vec4f"], // the band's metal as weights: aluminium, steel, titanium; unused
  ["housing", "vec4f"], // the sensor housing: a notch (0) … an island (1), its presence, the ears where it meets the display's top edge, the frame's earpiece slit (presence)
  ["notch", "vec4f"], // the notch: half width, depth, its corners' extent, exponent
  ["pill", "vec4f"], // the island's pill: half width, half height, its top below the display's top edge; the earpiece's mesh in a notch (presence)
  ["lens", "vec4f"], // the front camera: x, its centre's depth below the display's top edge, radius; unused
  ["classic", "vec4f"], // the home-button face: the button's centre y, its radius (× presence), presence, the top bezel's earpiece y
  ["classic2", "vec4f"], // the top bezel's camera: x, y; unused ×2
  ["band", "vec4f"], // the finish's band (sRGB), a white front (0…1)
  ["front", "vec4f"], // the front's ink (sRGB), how much of an LCD the panel is (0…1)
  ["screen", "vec4f"], // the frame's texels wide, high; its last level; on (0/1: a frame to show)
  ["screen2", "vec4f"], // unused; the frame's rotation (quarter turns); its brightness (1 live — 0.7 a still — 0.16 a still under words); the glow's level
  ["crop", "vec4f"], // the frame's uv scale onto the display: a frame of another aspect fills it, cropped, never stretched; unused ×2
  ["face", "vec4f"], // the honest face's mark (0 none · 1 the rest mark · 2 the boot mark); unused ×3
  ["notice", "vec4f"], // the face's words: their block's centre u, v and half extents (the phone's frame)
  ["notice2", "vec4f"], // their texture: texels wide, high; its last level; on (0/1)
  ["light", "vec4f"], // toward the lamp (unit), the shadow's alpha
  ["slope", "vec4f"], // the shadow's ground offset per unit of height xy, the base's height, unused
  ["buttons", `array<vec4f, ${MAX_BUTTONS}>`], // per side button: side (±1), its centre's y, half its length, presence (how far it stands proud)
  ["bounds", "vec4f"], // the quad: x0 y0 x1 y1 (world)
] as const);

export const PhoneUniforms = defineStruct("PhoneUniforms", [
  ["shade", "vec4f"], // the shadow's colour by day (sRGB — the mat's cast); unused
  ["shadow", "vec4f"], // σ at contact, σ per unit of height, the sweep's steps, the side buttons' height (world)
  ["contact", "vec4f"], // alpha, σ, the height it is gone by, unused
  ["glass", "vec4f"], // Fresnel head on, the glint's strength, its shininess, the canopy's height (world)
  ["glass2", "vec4f"], // the veil (how much sky the glass shows), the panel's scatter, the display's level by night, by day
  ["alu", "vec4f"], // aluminium: diffuse, roughness, glint, unused
  ["steel", "vec4f"], // steel: the same
  ["ti", "vec4f"], // titanium: the same
  ["glow", "vec4f"], // the bloom's two weights, its two σ (world)
  ["glow2", "vec4f"], // the spill's strength, its σ (world), the edge's glow, the button's proud (world)
  ["oled", "vec4f"], // an OLED panel, off (sRGB)
  ["lcd", "vec4f"], // an LCD panel, off
  ["housing", "vec4f"], // the sensor housing's glass
  ["lens", "vec4f"], // a lens's coated glass
  ["lensRing", "vec4f"], // a lens's ring
  ["mesh", "vec4f"], // an earpiece's mesh
  ["sky", "vec4f"], // the day's sky, mirrored
  ["leaves", "vec4f"], // the leaves against it
  ["room", "vec4f"], // the room's dim side
  ["nightSky", "vec4f"], // the Moon's sky
  ["nightLeaves", "vec4f"], // the canopy by night
  ["lamp", "vec4f"], // the lamp on a face: its fill, its cap; world units per mm; unused
  ["env", "vec4f"], // the window round the lamp: its brightness (× the sky), its share by night; unused ×2
  ["words", "vec4f"], // the words' and the marks' ink (sRGB), the marks' alpha
  ["marks", "vec4f"], // the rest mark's bar: width, height, the bars' gap; the boot mark's ring: across (world)
  ["marks2", "vec4f"], // the boot mark's ring: thickness (world), its gap at the top (radians); unused ×2
] as const);

/** The most phones one slot's pass draws (the record store grows to it). */
export const MAX_PHONES = 128;

/** A finish's colours as the pass takes them (theme.ts `phoneFinish`; mid-morph, `mixFinish`). */
export interface FinishValues {
  readonly band: RGB;
  readonly front: RGB;
  /** A white front, 0…1 (mid-morph, between). */
  readonly white: number;
  readonly polish: number;
}

/** Two finishes blended — the morph's material track — in sRGB, as a crossfade reads. */
export function mixFinish(a: FinishValues, b: FinishValues, t: number): FinishValues {
  const c = (x: RGB, y: RGB): RGB => [
    x[0] + (y[0] - x[0]) * t,
    x[1] + (y[1] - x[1]) * t,
    x[2] + (y[2] - x[2]) * t,
  ];
  return {
    band: c(a.band, b.band),
    front: c(a.front, b.front),
    white: a.white + (b.white - a.white) * t,
    polish: a.polish + (b.polish - a.polish) * t,
  };
}

/** The phone's colours as the knobs and the record take them (theme.ts `phoneLook`). */
export interface PhoneLookValues {
  /** The colour a shadow casts on the mat by day — the desk's, read off the palette's `cast` role (ICE I46). */
  readonly cast: RGB;
  readonly oledOff: RGB;
  readonly lcdOff: RGB;
  readonly housing: RGB;
  readonly lens: RGB;
  readonly lensRing: RGB;
  readonly mesh: RGB;
  readonly sky: RGB;
  readonly leaves: RGB;
  readonly room: RGB;
  readonly nightSky: RGB;
  readonly nightLeaves: RGB;
  /** The words a face says and the marks a still carries. */
  readonly words: RGB;
  /** Each finish, by name: its band, its front's ink (black or white), its polish. */
  readonly finishes: Readonly<Record<string, FinishValues>>;
}

/** What the screen shows: a frame to read (its texels, its levels), how bright, turned how far, and the aspect it was laid out at. */
export interface ScreenPlan {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  /** 1: a frame to show; 0: the panel, off. */
  readonly on: number;
  /** 1 live; `display.still` a still; `display.stillUnder` a still under words. */
  readonly brightness: number;
  /** The frame's rotation against the device, quarter turns clockwise. */
  readonly rotation: number;
  /** The aspect (portrait width ÷ height) the frame's picture was laid out at, when it is not the display's own (mid-morph; a stream of another device): the display crops it to fill. */
  readonly aspect?: number;
}

/** The screen off: nothing to read. */
export const SCREEN_OFF: ScreenPlan = {
  width: 1,
  height: 1,
  levels: 1,
  on: 0,
  brightness: 1,
  rotation: 0,
};

/** The marks a still may carry (DESIGN.md §5.1): none, the rest mark, the boot mark — their codes in the record. */
export const MARKS = { none: 0, rest: 1, boot: 2 } as const;
export type MarkName = keyof typeof MARKS;

/**
 * A face's WORDS (notice.ts, drawn by the lent raster — notice-canvas.ts): the words' light over black, of their BLOCK
 * alone, and where that block lies on the display (device points: centre x, y and half extents). The pass lays them as the
 * phone's notice texture and the shader adds their light over what the screen shows there.
 */
export interface NoticePlan {
  /** What the raster depends on (notice.ts `noticeKey`) — a new key is a new raster. */
  readonly key: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
  /** The screen's size in points, and the block of it the texels cover (points: centre x, y, half extents). */
  readonly points: readonly [number, number];
  readonly block: readonly [number, number, number, number];
}

/** One phone for the pass: its geometry, its finish and look, its screen and its face — and its live face, if it has one. */
export interface PhoneInstance {
  readonly geometry: PhoneGeometry;
  readonly finish: FinishValues;
  readonly look: PhoneLookValues;
  readonly screen: ScreenPlan;
  /** The mark a still carries. */
  readonly mark: MarkName;
  /** The face's words over the screen, or none. */
  readonly notice?: NoticePlan | undefined;
  /**
   * The phone's LIVE face: its face (stable for the phone's life: the pass reads its texture at each prepare, so a frame
   * that lands redraws without a new record) and the sight the pass tells what it drew. Absent: no face (unbound, a
   * specimen, no `LIVE` lent) — the screen shows what `screen` says.
   */
  readonly live?:
    | { readonly e: Entity; readonly face: LiveFace; readonly sight: Sight }
    | undefined;
}

/** The frame's uv scale onto the display: a picture of aspect `af` covers a display of aspect `ad`, the overflow cropped evenly. */
export const cropOf = (ad: number, af: number): readonly [number, number] =>
  ad > af ? [1, af / ad] : [ad / af, 1];

/** The levels of a texture `w × h` texels: its chain down to one texel. */
export const levelsOf = (w: number, h: number): number =>
  Math.floor(Math.log2(Math.max(w, h, 1))) + 1;

/** The level the glow's colour is read at: the frame some 8 texels across (PHONE.md §5 — the screen's colour near each edge). */
export const glowLevel = (width: number): number => Math.max(Math.log2(Math.max(width, 1) / 8), 0);

/** A live face's screen as its texture stands: its size and levels (a new size remakes the record — the shader's level reads it). */
export function liveScreen(
  t: Pick<LiveTexture, "width" | "height">,
  brightness: number,
  aspect: number | undefined,
): ScreenPlan {
  return {
    width: t.width,
    height: t.height,
    levels: levelsOf(t.width, t.height),
    on: 1,
    brightness,
    rotation: 0,
    ...(aspect === undefined ? {} : { aspect }),
  };
}

export function phoneValues(p: PhoneInstance) {
  const G = p.geometry;
  const S = G.shape;
  const H = S.housing;
  const C = S.classic;
  const notch = H.notch;
  const pill = H.pill;
  // the home-button face's top bezel: the earpiece at 0.52 of it from the top, the camera by it
  const earY = -S.half[1] + (S.half[1] - S.display[1]) * 0.52;
  const buttons: number[] = [];
  for (let i = 0; i < MAX_BUTTONS; i++) {
    const b = S.buttons[i];
    buttons.push(...(b ? [b.side, -S.half[1] + b.fromTop, b.half, b.presence] : [0, 0, 0, 0]));
  }
  const ad = S.display[0] / S.display[1];
  const crop = cropOf(ad, p.screen.aspect ?? ad);
  return {
    centre: [G.centre[0], G.centre[1], G.centre[2], G.alpha],
    ex: [G.ex[0], G.ex[1], G.ex[2], S.half[0]],
    ey: [G.ey[0], G.ey[1], G.ey[2], S.half[1]],
    n: [G.n[0], G.n[1], G.n[2], S.thick],
    eye: [G.eye.ex, G.eye.ey, G.eye.h, 0],
    corner: [S.corner.extent, S.corner.n, S.displayCorner.extent, S.displayCorner.n],
    display: [S.display[0], S.display[1], S.rim[0], S.rim[1]],
    edge: [S.chamfer, S.metal, S.wall, p.finish.polish],
    metals: [S.metals[0], S.metals[1], S.metals[2], 0],
    housing: [H.island, H.presence, H.ear, H.slit],
    notch: notch ? [notch.half, notch.depth, notch.corner.extent, notch.corner.n] : [0, 0, 0, 2],
    pill: pill ? [pill.hw, pill.hh, pill.top, H.earpiece] : [0, 0, 0, H.earpiece],
    lens: [H.lens[0], H.lens[1], H.lens[2], 0],
    classic: [S.half[1] - C.home[0], C.home[1] * C.presence, C.presence, earY],
    classic2: [C.camera[0], earY + C.camera[1], 0, 0],
    band: [p.finish.band[0], p.finish.band[1], p.finish.band[2], p.finish.white],
    front: [p.finish.front[0], p.finish.front[1], p.finish.front[2], S.lcd],
    screen: [p.screen.width, p.screen.height, p.screen.levels - 1, p.screen.on],
    screen2: [0, p.screen.rotation, p.screen.brightness, glowLevel(p.screen.width)],
    crop: [crop[0], crop[1], 0, 0],
    face: [MARKS[p.mark], 0, 0, 0],
    ...noticeValues(p),
    light: [G.light[0], G.light[1], G.light[2], G.shadowAlpha],
    slope: [G.slope[0], G.slope[1], G.bottom, 0],
    buttons,
    bounds: [G.bounds.x0, G.bounds.y0, G.bounds.x1, G.bounds.y1],
  };
}

/** Where a face's words lie in the phone's frame (the screen's points → their place on the display), and their texture's shape. */
function noticeValues(p: PhoneInstance): { notice: number[]; notice2: number[] } {
  const n = p.notice;
  if (n === undefined) return { notice: [0, 0, 1, 1], notice2: [1, 1, 0, 0] };
  const [hx, hy] = p.geometry.shape.display;
  const [W, H] = n.points;
  const [cx, cy, bx, by] = n.block;
  return {
    notice: [
      (cx / W - 0.5) * 2 * hx,
      (cy / H - 0.5) * 2 * hy,
      (bx / W) * 2 * hx,
      (by / H) * 2 * hy,
    ],
    notice2: [n.width, n.height, levelsOf(n.width, n.height) - 1, 1],
  };
}

export function phoneUniformValues(look: PhoneLookValues, law: PhoneLaw = PHONE) {
  const v = (c: RGB, w = 0): number[] => [c[0], c[1], c[2], w];
  const sh = law.shadow;
  const g = law.glass;
  const M = law.metal;
  const gl = law.glow;
  const mk = law.marks;
  return {
    shade: v(look.cast),
    shadow: [sh.sigma0, sh.perUnit, sh.steps, law.button.height * MM],
    contact: [sh.contact.alpha, sh.contact.sigma, sh.contact.reach, 0],
    glass: [g.f0, g.glint, g.shininess, g.canopy],
    glass2: [g.veil, law.display.scatter, law.display.night, law.display.day],
    alu: [M.aluminium.diffuse, M.aluminium.rough, M.aluminium.glint, 0],
    steel: [M.steel.diffuse, M.steel.rough, M.steel.glint, 0],
    ti: [M.titanium.diffuse, M.titanium.rough, M.titanium.glint, 0],
    glow: [gl.bloom[0] ?? 0, gl.bloom[1] ?? 0, (gl.sigma[0] ?? 1) * MM, (gl.sigma[1] ?? 1) * MM],
    glow2: [gl.spill, gl.spillSigma * MM, gl.edge, law.button.proud * MM],
    oled: v(look.oledOff),
    lcd: v(look.lcdOff),
    housing: v(look.housing),
    lens: v(look.lens),
    lensRing: v(look.lensRing),
    mesh: v(look.mesh),
    sky: v(look.sky),
    leaves: v(look.leaves),
    room: v(look.room),
    nightSky: v(look.nightSky),
    nightLeaves: v(look.nightLeaves),
    lamp: [law.lamp.ambient, law.lamp.cap, MM, 0],
    env: [g.window, g.windowNight, 0, 0],
    words: v(look.words, mk.alpha),
    marks: [
      (mk.bar[0] ?? 0) * MM,
      (mk.bar[1] ?? 0) * MM,
      (mk.bar[2] ?? 0) * MM,
      (mk.ring[0] ?? 0) * MM,
    ],
    marks2: [(mk.ring[1] ?? 0) * MM, ((mk.ring[2] ?? 0) * Math.PI) / 180, 0, 0],
  };
}
