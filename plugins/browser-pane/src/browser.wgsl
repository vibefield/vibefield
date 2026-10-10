// THE BROWSER PANE (BROWSER.md; the prototype's shaders/browser/browser.wgsl, moved) — a PANE of glass lying on the desk
// under the mat's one lamp, its page lit inside it. A PURE module: the record `Pane`, the pass's knobs `PaneUniforms`, the
// slot's view block `MatUniforms` and the textures arrive as parameters; it names no colour — every surface's is a
// record's or a knob's, and every light goes through the desk's chain (the kit's `light` piece: `mat_albedo`,
// `sample_gobo`, `mat_colour`, `shade_mat`, `night_mat`, `desk_of`, `lit_desk`, `lit_gobo`).
//
// The pane is a SLAB, seen from ITS OWN EYE (the photo's local eye — `P.eye`, over the pane's centre; PT-1 ruling 3):
// each fragment's desk point is a ray from that eye, taken into the pane's own frame (lifted, never turned) and traced:
// the flat top face; the ARRIS — the polished edge rolling into the side, a quarter ellipse bisected over its fall; the
// WALL below it, which an eye sees on the side facing it (from the pane's own eye, none). What the ray misses is the
// desk: there the pane's shadow falls.
//
// The top face is three surfaces under one sheet of glass. The PAGE: an opaque film just under the face, its light its
// own (added after the chain: by day the page's byte is the drawn byte, under a faint veil of sky; by night bright to the
// adapted eye), read at the level its texels meet the screen's pixels at (the slot's zoom — the record stays
// camera-free). The HEAD: clear glass ENGRAVED — frosted wherever the head's raster says (the controls, the address
// field with its address cut back out to clear), the favicon printed over it. The BORDER: clear glass — Fresnel's share
// of the sky through the palm, and the rest the MAT UNDER IT, found by Snell's law: the ray bent into the slab, out of
// its foot and on to the desk, where the mat's own maths is evaluated at the point it lands on, darkened by the pane's
// own shadow there, tinted by the path through the glass. At the arris the bend is strong and the lattice's lines swim;
// past the critical angle the ray is turned back into the slab and the edge shows the light the glass carries.
//
// The SHADOW is the glass's: the page film's is the desk's penumbra law, cast from its height; the glass itself lets the
// light through but for its faces' loss, turns it away where a ray crosses a polished wall (a dark line along the cast
// outline), and gathers it at the arris into a bright CAUSTIC just inside (the light program). By NIGHT the page glows
// as the phone's screen does — the eye's glare round it, its light spilled on the mat (the light program) — and the slab
// CARRIES its light: every polished edge and the frost let it out, as an edge-lit panel's do, and the edges throw a thin
// halo on the mat hugging the outline.
//
// `lit` — the slot is lit from ELSEWHERE (a mini mat's inside, a flight's departed desk): every dapple is the gobo where
// the light camera sees the point (`lit_desk`, `lit_gobo`), not where the slot's own camera does. A pipeline constant in
// the entry, handed down as a parameter, never a uniform flag.

const BW_RIM_STEPS = 10;   // = law.ts RIM_STEPS

fn bw_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }
fn bw_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage of a shape: its shadow, its glare.
fn bw_blur(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * bw_erf(d / max(sigma * 1.4142136, 1.0e-4)); }
fn bw_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }
fn bw_encode(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return mix(x * 12.92, 1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), x));
}
// A world point raised `h` off the desk, in the projector's frame (the note's `paper_desk_at`).
fn bw_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}
fn bw_local(P: Pane, v: vec3f) -> vec3f { return vec3f(dot(v, P.ex.xyz), dot(v, P.ey.xyz), dot(v, P.n.xyz)); }
fn bw_world(P: Pane, v: vec3f) -> vec3f { return P.ex.xyz * v.x + P.ey.xyz * v.y + P.n.xyz * v.z; }

// ---- the shapes (law.ts mirrors every one)

fn bw_outline(P: Pane, q: vec2f) -> f32 { return sdf_round_box(q, vec2f(P.ex.w, P.ey.w), P.shape.x); }
fn bw_page(P: Pane, q: vec2f) -> f32 { return sdf_round_box(q - P.page.xy, P.page.zw, P.shape.y); }
// The arris at a depth d inside the outline: its height below the face's plane and its slope along the depth.
fn bw_rim(P: Pane, d: f32) -> vec2f {
  let rw = P.shape.z;
  let rd = P.shape.w;
  if (d >= rw) { return vec2f(0.0); }
  let t = clamp(1.0 - d / rw, 0.0, 1.0);
  let tc = min(t, 0.9995);
  return vec2f(-rd * (1.0 - sqrt(max(1.0 - t * t, 0.0))), rd * tc / (rw * sqrt(1.0 - tc * tc)));
}
// The outline's outward normal — the rounded box's, exact.
fn bw_grad(P: Pane, q: vec2f) -> vec2f {
  let h = vec2f(P.ex.w, P.ey.w) - vec2f(P.shape.x);
  let a = abs(q) - h;
  let s = select(vec2f(-1.0), vec2f(1.0), q >= vec2f(0.0));
  if (a.x > 0.0 && a.y > 0.0) { return normalize(a) * s; }
  if (a.x > a.y) { return vec2f(s.x, 0.0); }
  return vec2f(0.0, s.y);
}

// ---- the ray (law.ts `castPane`)

struct BwHit { part: i32, q: vec2f, w: f32 }   // part: −1 the desk · 0 the face · 1 the arris · 2 the wall
fn bw_at(o: vec3f, d: vec3f, w: f32) -> vec2f { return o.xy + d.xy * ((w - o.z) / d.z); }

fn bw_trace(P: Pane, o: vec3f, d: vec3f) -> BwHit {
  var h: BwHit;
  h.part = -1;
  if (d.z > -1.0e-6) { return h; }
  let q0 = bw_at(o, d, 0.0);
  if (-bw_outline(P, q0) >= P.shape.z) { h.part = 0; h.q = q0; h.w = 0.0; return h; }
  let drop = P.shape.w;
  if (-bw_outline(P, bw_at(o, d, -drop)) >= 0.0) {
    var hi = 0.0;
    var lo = -drop;
    for (var i = 0; i < BW_RIM_STEPS; i++) {
      let mid = 0.5 * (hi + lo);
      let dm = -bw_outline(P, bw_at(o, d, mid));
      if (dm < 0.0 || mid > bw_rim(P, dm).x) { hi = mid; } else { lo = mid; }
    }
    h.q = bw_at(o, d, lo);
    h.w = lo;
    h.part = 1;
    return h;
  }
  let wTop = -drop;
  let wBot = -P.n.w;
  let da = bw_outline(P, bw_at(o, d, wTop));
  let db = bw_outline(P, bw_at(o, d, wBot));
  if (db <= 0.0 && da > 0.0) {
    h.part = 2;
    h.w = mix(wTop, wBot, da / (da - db));
    h.q = bw_at(o, d, h.w);
  }
  return h;
}

// How far inside the silhouette the ray passes (law.ts `silhouetteDepth`): the arris's foot on the far side, the wall's foot on the near side.
fn bw_sil(P: Pane, o: vec3f, d: vec3f) -> f32 {
  if (d.z > -1.0e-6) { return -1.0e9; }
  return max(-bw_outline(P, bw_at(o, d, -P.shape.w)), -bw_outline(P, bw_at(o, d, -P.n.w)));
}

// ---- the lamp's dapple, one tap (what a mirrored ray sees of the leaves, what the caustic is let through by)

fn bw_gobo_tap(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, desk: vec3f) -> f32 {
  if (u.gobo.x <= 0.0) { return 1.0; }
  let clip = u.goboMatrix * vec4f(desk, 1.0);
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(0.5 + 0.5 * ndc.x, 0.5 - 0.5 * ndc.y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  return mix(1.0, textureSampleLevel(tex, samp, uv, 0.0).r, u.gobo.x);
}

// One tap of the dapple at a world point on the desk — under the slot's own lamp, or (`lit`) where the light camera
// sees the point, cross-faded to the second while a flight hands one lamp to the other (the kit's `lit_gobo`, one tap).
fn bw_tap_at(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, p: vec2f, lit: bool) -> f32 {
  if (!lit) { return bw_gobo_tap(u, tex, samp, desk_of(u, p)); }
  var g = 0.0;
  if (all(u.light.xyz == u.cam.xyz)) { g = bw_gobo_tap(u, tex, samp, desk_of(u, p)); }
  else { g = bw_gobo_tap(u, tex, samp, lit_desk(u, u.light, p, 0.0)); }
  if (u.light.w > 0.0) { g = mix(g, bw_gobo_tap(u, tex, samp, lit_desk(u, u.light2, p, 0.0)), u.light.w); }
  return g;
}

// The dapple on a point raised `h` (the pane's own surface): the kit's blurred gobo, under whichever lamp the slot is lit by.
fn bw_gobo_on(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, p: vec2f, h: f32, n: f32, lit: bool) -> f32 {
  let own = bw_desk_at(u, p, h);
  if (lit) { return lit_gobo(u, tex, samp, p, h, own, n); }
  return sample_gobo(u, tex, samp, own, n);
}

// ---- the shadow on the mat at a desk point: x = its darkness (the alpha of the cast colour over the mat), y = the caustic's light

fn bw_shadow(P: Pane, k: PaneUniforms, s: vec2f) -> vec2f {
  let a = vec3f(-P.slope.xy, 1.0);   // toward the lamp: one unit up per unit of the ray's parameter
  let o = bw_local(P, vec3f(s, 0.0) - P.centre.xyz);
  let d = bw_local(P, a);
  if (d.z < 1.0e-4) { return vec2f(0.0); }
  let tTop = -o.z / d.z;               // the ray's parameter IS its height over the desk
  let tBot = (-P.n.w - o.z) / d.z;
  let pTop = (o + d * tTop).xy;
  let pBot = (o + d * max(tBot, 0.0)).xy;
  let sTop = k.shadow.x + k.shadow.y * max(tTop, 0.0);
  let sBot = k.shadow.x + k.shadow.y * max(tBot, 0.0);
  // the page: an opaque film under the top face
  let film = bw_blur(bw_page(P, pTop), sTop) * P.light.w;
  // the glass: its faces' loss where the ray crosses both faces; turned away where it crosses a wall
  let top = bw_blur(bw_outline(P, pTop), sTop);
  let bot = bw_blur(bw_outline(P, pBot), sBot);
  var glass = min(top, bot) * k.shadow.z + abs(top - bot) * k.shadow.w;
  // the contact: the foot's edge on the mat — a thin dark line along the outline, gone as it rises
  let con = bw_blur(abs(bw_outline(P, pBot)) - 0.3 * k.optics.y, k.shadow2.w) * k.shadow2.z * exp(-max(tBot, 0.0) / max(k.optics.z, 1.0e-3));
  glass = max(glass, con);
  let dark = 1.0 - (1.0 - film) * (1.0 - glass);
  // the caustic: the arris rolls the light it gathers into a line just inside the outline's cast; the page shades it
  let dc = bw_outline(P, pTop) + 1.6 * k.shadow2.y;
  let caustic = exp(-dc * dc / (2.0 * k.shadow2.y * k.shadow2.y)) * k.shadow2.x * (1.0 - film);
  return vec2f(dark, caustic);
}

// ---- the light on the pane (the phone's: one sky, one chain)

// The desk's chain on an sRGB albedo: the reference's grade by day, the eye's by night.
fn bw_chain(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, albedo, gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// The lamp on a face (the kit's one physics): its fill, the lambert normalised so a flat face reads 1, capped.
fn bw_lambert(n: vec3f, L: vec3f, k: PaneUniforms) -> f32 {
  let d = max(dot(n, L), 0.0) / max(L.z, 0.05);
  return k.lamp.x + (1.0 - k.lamp.x) * min(d, k.lamp.y);
}

// What a mirror at `pw` sees along R (linear light) — the phone's `ph_env`: up, the sky through the palm (the canopy the
// ray meets over the desk, read off the plate that shades the desk); at a slant, the room; downward, the mat as the lamp
// lights it; and the bright window round the lamp.
fn bw_env(u: MatUniforms, k: PaneUniforms, P: Pane, R: vec3f, pw: vec3f, sharp: f32, gobo_here: f32, tex: texture_2d<f32>, samp: sampler, lit: bool) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  let sky = mix(srgb_to_linear(k.sky.rgb), srgb_to_linear(k.nightSky.rgb), night);
  let leaves = mix(srgb_to_linear(k.leaves.rgb), srgb_to_linear(k.nightLeaves.rgb), night);
  let room = srgb_to_linear(k.room.rgb) * mix(1.0, 0.03, night);
  if (R.z < -0.02) {
    return srgb_to_linear(bw_chain(u, u.ground.rgb, gobo_here, 0.5)) * 0.9;
  }
  let hc = k.glass.w;
  let X = pw.xy + R.xy * ((hc - pw.z) / max(R.z, 0.12));
  let open = mix(0.62, bw_tap_at(u, tex, samp, X + P.slope.xy * hc, lit), sharp);
  let up = mix(leaves, sky, open);
  let lobe = pow(max(dot(R, P.light.xyz), 0.0), mix(3.0, 28.0, sharp)) * k.env.x * gobo_here * mix(1.0, k.env.y, night);
  return mix(room, up, smoothstep(0.02, 0.7, R.z)) + sky * lobe;
}

// The lamp's colour as a glint: the Sun's white by day; by night the Moon's, dimmer, taken toward the rods' blue.
fn bw_glint_colour(u: MatUniforms) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  return mix(vec3f(1.0), mix(u.moon.xyz, u.rod.xyz, 0.5) * 0.28, night);
}

fn bw_fresnel(f0: f32, c: f32) -> f32 { return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }

// ---- what is under the glass

// The mat at a world point W as the mat pass draws it there (a display value): the lattice at W's phase, the grain, the
// gobo at W, the chain — recomputed where the glass shows it moved.
fn bw_mat(u: MatUniforms, W: vec2f, px: f32, frag: vec2f, bn: vec3f, tex: texture_2d<f32>, samp: sampler, lines: f32, lit: bool) -> vec3f {
  var albedo = srgb_to_linear(u.ground.rgb);
  if (lines > 0.0) { albedo = mat_albedo(u, u.phase.xy + (W - u.cam.xy), px, frag, bn, 0.0); }
  let gobo = bw_gobo_on(u, tex, samp, W, 0.0, bn.z, lit);
  return mat_colour(u, albedo, gobo, bn.y);
}

// The glass's transmittance over a path of `len` world units (linear): its edge colour, which is the colour of the path it
// is measured over, taken to the path's power.
fn bw_tint(P: Pane, len: f32) -> vec3f {
  return pow(max(srgb_to_linear(P.tint.rgb), vec3f(1.0e-4)), vec3f(len / max(P.tint.w, 1.0e-3)));
}

// The desk as the glass shows it: the refracted ray `A` leaving the foot at `pe`, on to the mat; the mat there under the
// pane's own shadow and its caustic; in linear light. `lines` 0 diffuses the lattice away (the frost).
fn bw_seen(P: Pane, u: MatUniforms, k: PaneUniforms, pe: vec3f, A: vec3f, px: f32, frag: vec2f, bn: vec3f,
           tex: texture_2d<f32>, samp: sampler, lines: f32, lit: bool) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  let W = pe.xy + A.xy * (max(pe.z, 0.0) / max(-A.z, 1.0e-3));
  var c = bw_mat(u, W, px, frag, bn, tex, samp, lines, lit);
  let sh = bw_shadow(P, k, W);
  // in the order the desk lays them: the caustic's light on the mat (where the leaves let the lamp through), then the shadow over it
  c = c * (1.0 + sh.y * bw_tap_at(u, tex, samp, W, lit) * (1.0 - 0.8 * night));
  let ink = mix(k.shade.rgb, bw_encode(u.eigengrau.xyz), night);
  c = mix(c, ink, sh.x);
  return srgb_to_linear(c);
}

// ---- the page

fn bw_page_uv(P: Pane, q: vec2f) -> vec2f { return (q - P.page.xy) / P.page.zw * 0.5 + 0.5; }
// The level the page's texture is read at here: its texels over the device pixels the page spans on this slot's
// screen (both axes, the coarser), never past its last level — the slot's zoom, so the record never needs the camera.
fn bw_page_lod(P: Pane, u: MatUniforms) -> f32 {
  let device = 2.0 * P.page.zw * mat_zoom(u) * mat_dpr(u);
  let ratio = max(P.screen.x / max(device.x, 1.0e-3), P.screen.y / max(device.y, 1.0e-3));
  return clamp(log2(max(ratio, 1.0e-6)), 0.0, P.screen.z);
}
// The page's light at a point of the face (linear), at the level the frame is read at.
fn bw_screen(P: Pane, q: vec2f, lod: f32, tex: texture_2d<f32>, samp: sampler) -> vec3f {
  if (P.screen.w <= 0.0) { return vec3f(0.0); }
  return textureSampleLevel(tex, samp, bw_page_uv(P, q), lod).rgb * (P.screen.w * P.screen2.y);
}
// The page's colour near a point: the frame read coarse at the page's nearest point — what its glow is tinted by.
fn bw_glow_colour(P: Pane, q: vec2f, tex: texture_2d<f32>, samp: sampler) -> vec3f {
  if (P.screen.w <= 0.0) { return vec3f(0.0); }
  let qc = P.page.xy + clamp(q - P.page.xy, -P.page.zw, P.page.zw);
  return textureSampleLevel(tex, samp, bw_page_uv(P, qc), min(P.screen2.z, P.screen.z)).rgb * (P.screen.w * P.screen2.y);
}

// ---- the head: clear glass, ENGRAVED — frosted wherever the raster's engraving says (the controls, the address field
// with its address cut back out to clear), the favicon printed in colour over it

fn bw_head(P: Pane, u: MatUniforms, k: PaneUniforms, q: vec2f, n: vec3f, V: vec3f, pw: vec3f, px: f32, frag: vec2f, gobo: f32, bn: vec3f,
           gobo_tex: texture_2d<f32>, gobo_samp: sampler, ink_tex: texture_2d<f32>, ink_samp: sampler, glowc: vec3f, clear: vec3f, lit: bool) -> vec3f {
  if (P.ink.x < 0.5) { return clear; }
  let night = clamp(u.night.x, 0.0, 1.0);
  let L = P.light.xyz;
  // the raster: its upper rows the engraving's coverage, its lower rows the colour print (head.ts `engraveSplit`)
  let top = -P.ey.w;
  let uvx = (q.x + P.ex.w) / (2.0 * P.ex.w);
  let fy = clamp((q.y - top) / max(P.band.x - top, 1.0e-3), 0.0, 1.0);
  let E = textureSampleLevel(ink_tex, ink_samp, vec2f(uvx, fy * P.ink.y), 0.0).a;
  let print = textureSampleLevel(ink_tex, ink_samp, vec2f(uvx, P.ink.z + fy * P.ink.y), 0.0);
  var col = clear;
  if (E > 0.0) {
    // a control under the pointer (in use): its engraving catches a little more light
    var wash = 0.0;
    if (P.hover.w > 0.0) {
      wash = (1.0 - smoothstep(P.hover.z * 0.55, P.hover.z, length(q - P.hover.xy))) * min(P.hover.w, 1.0) * select(0.35, 0.7, P.hover.w > 1.0);
    }
    // the frost: what the rough face scatters of the light on it (the dapple crosses it), the desk under it diffused through it
    let pe = pw - P.n.xyz * P.n.w;
    let under = bw_seen(P, u, k, pe, -P.n.xyz, px, frag, bn, gobo_tex, gobo_samp, 0.0, lit) * bw_tint(P, P.n.w * 1.6);
    let litFrost = srgb_to_linear(bw_chain(u, clamp(k.frostTint.rgb * bw_lambert(n, L, k) * (1.0 + wash), vec3f(0.0), vec3f(1.0)), gobo, bn.y));
    let grit = 1.0 + (bn.x - 0.5) * 2.0 * k.frost2.x;
    var frost = litFrost * k.frost.x * grit + under * k.frost.y;
    frost = frost + k.frost.z * bw_env(u, k, P, reflect(-V, n), pw, 0.0, gobo, gobo_tex, gobo_samp, lit);
    // by night the page's light, carried in the slab, comes out of every engraved mark (a display leaks a little even
    // behind a dark page — the floor)
    frost = frost + max(glowc, vec3f(k.glow3.z)) * (k.glow2.w * night * (1.0 + wash));
    col = mix(clear, frost, E);
  }
  // the favicon, printed in colour on the capsule, lit like any print on the desk — and by night lit from behind by the
  // engraving's glow, which it filters as stained glass does
  if (print.a > 0.0) {
    let albedo = clamp(print.rgb / print.a, vec3f(0.0), vec3f(1.0));
    var inkLit = srgb_to_linear(bw_chain(u, clamp(albedo * bw_lambert(n, L, k), vec3f(0.0), vec3f(1.0)), gobo, bn.y));
    inkLit = inkLit + srgb_to_linear(albedo) * max(glowc, vec3f(k.glow3.z)) * (k.glow2.w * night * 1.6);
    col = mix(col, inkLit, print.a * k.frost.w);
  }
  return col;
}

// ---- one pane at a desk point `s`: premultiplied colour. `px` is world units per DEVICE px at the desk; `frag` the framebuffer pixel.
fn shade_pane(P: Pane, u: MatUniforms, k: PaneUniforms, s: vec2f, px: f32, frag: vec2f,
              gobo_tex: texture_2d<f32>, gobo_samp: sampler, noise_tex: texture_2d<f32>, noise_samp: sampler,
              page_tex: texture_2d<f32>, page_samp: sampler, ink_tex: texture_2d<f32>, ink_samp: sampler, lit: bool) -> vec4f {
  let night = clamp(u.night.x, 0.0, 1.0);
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  let E = P.eye.xyz;
  let o = bw_local(P, E - P.centre.xyz);
  let d = bw_local(P, vec3f(s, 0.0) - E);
  // a device pixel at the face's height (the eye magnifies what is high)
  let pxg = px * max(E.z - P.centre.z, 1.0) / E.z;
  // the face's plane under the ray, and how far outside the outline that is: most of a quad is the desk, and a ray more
  // than the slab's own parallax outside meets nothing — the trace is skipped there, exactly
  let q0 = bw_at(o, d, 0.0);
  let dOut = bw_outline(P, q0);
  var hit: BwHit;
  hit.part = -1;
  var cov = 0.0;
  if (dOut <= length(d.xy) * P.n.w / max(-d.z, 1.0e-4) + 2.0 * pxg) {
    hit = bw_trace(P, o, d);
    cov = bw_cov(-bw_sil(P, o, d), pxg);
  }
  var acc = vec4f(0.0);

  // THE SHADOW, where the pane does not cover the desk — within its cast's reach
  if (cov < 1.0) {
    let top = P.centre.z;
    if (dOut <= length(P.slope.xy) * top + 3.0 * (k.shadow.x + k.shadow.y * top) + 2.0 * pxg) {
      let sh = bw_shadow(P, k, s).x * (1.0 - cov);
      let ink = mix(k.shade.rgb, bw_encode(u.eigengrau.xyz), night);
      acc = vec4f(ink * sh, sh);
    }
  }

  // the glare the eye sees round a bright page by night
  var glare = vec3f(0.0);
  if (night > 0.0 && P.screen.w > 0.0 && dOut < 3.0 * k.glow.w) {
    let c = bw_glow_colour(P, q0, page_tex, page_samp);
    let dp = bw_page(P, q0);
    let halo = k.glow.x * bw_blur(dp, k.glow.z) + k.glow.y * bw_blur(dp, k.glow.w);
    glare = c * (halo * mix(1.0, 0.1, bw_cov(dp, pxg)) * night);
  }

  // THE PANE
  if (hit.part >= 0 && cov > 0.0) {
    let q = hit.q;
    let pw = P.centre.xyz + bw_world(P, vec3f(q, hit.w));
    let depth = -bw_outline(P, q);
    var nl = vec3f(0.0, 0.0, 1.0);
    if (hit.part == 2) { nl = vec3f(bw_grad(P, q), 0.0); }
    else if (hit.part == 1 || depth < P.shape.z) { nl = normalize(vec3f(bw_grad(P, q) * bw_rim(P, max(depth, 0.0)).y, 1.0)); }
    let n = normalize(bw_world(P, nl));
    let V = normalize(E - pw);
    let L = P.light.xyz;
    let gobo = bw_gobo_on(u, gobo_tex, gobo_samp, pw.xy, pw.z, bn.z, lit);
    let glowc = bw_glow_colour(P, q, page_tex, page_samp);
    let ndv = max(dot(n, V), 0.0);
    let F = bw_fresnel(k.glass.x, ndv);
    let R = reflect(-V, n);
    let mirror = bw_env(u, k, P, R, pw, 1.0, gobo, gobo_tex, gobo_samp, lit);
    let H = normalize(L + V);
    let glint = bw_glint_colour(u) * (pow(max(dot(n, H), 0.0), k.glass.z) * k.glass.y * gobo);
    var lin = vec3f(0.0);
    let dPage = bw_page(P, q);
    // the flat face: how much of this pixel is page, and how much head (they share an edge: the page's top is the head's foot)
    var inPage = 0.0;
    var inBand = 0.0;
    if (hit.part == 0 && depth >= P.shape.z) {
      inBand = bw_cov(q.y - P.band.x, pxg);
      if (q.y > P.band.x - pxg) { inPage = min(bw_cov(dPage, pxg), 1.0 - inBand); }
    }
    let wClear = select(0.0, 1.0 - inPage - inBand, hit.part < 2);
    if (wClear > 0.0 || inBand > 0.0) {
      // THE CLEAR BORDER and THE ARRIS: Fresnel's share of the sky, and the desk under the glass by Snell's law — into the
      // slab, out of its foot (a face parallel to the top gives the ray back its own direction; after the arris it may turn
      // past the critical angle and stay in: then the edge shows the light the slab carries)
      let T1 = refract(-V, n, 1.0 / k.optics.x);
      let down = max(-dot(T1, P.n.xyz), 1.0e-3);
      let path = (P.n.w + dot(pw - P.centre.xyz, P.n.xyz)) / down;
      let pe = pw + T1 * path;
      let A = refract(T1, P.n.xyz, k.optics.x);
      var through: vec3f;
      if (dot(A, A) < 0.25) {
        // held in the slab: what the glass carries — the day's light, dappled, in its own colour; by night the page's
        let pipe = srgb_to_linear(bw_chain(u, clamp(P.tint.rgb * bw_lambert(vec3f(0.0, 0.0, 1.0), L, k), vec3f(0.0), vec3f(1.0)), gobo, bn.y));
        through = pipe * 0.8 + glowc * (k.glow2.z * night);
      } else {
        through = bw_seen(P, u, k, pe, A, pxg, frag, bn, gobo_tex, gobo_samp, 1.0, lit) * bw_tint(P, path);
      }
      // the sky's share over the clear glass, held to the guardrail's veil on the flat face (the mat under glass keeps its
      // colour); the arris, turned toward the room, mirrors at its own grazing Fresnel
      let veil = mix(k.frost2.z, 1.0, smoothstep(P.shape.z, 0.0, depth));
      var clear = through * (1.0 - F) + F * veil * mirror + glint;
      // by night the slab's light lets itself out where the face rolls away: the arris glows, and the clear border faintly near the page
      if (night > 0.0 && P.screen.w > 0.0) {
        let e = 1.0 - smoothstep(0.0, P.shape.z * 1.4, depth);
        let near = exp(-max(dPage, 0.0) / (3.0 * k.optics.y)) * 0.1;
        clear = clear + glowc * ((k.glow2.z * e + near) * night);
      }
      lin = lin + clear * wClear;
      if (inBand > 0.0) {
        // THE HEAD: the same clear glass, engraved — the controls, the address field, the favicon's print
        lin = lin + bw_head(P, u, k, q, n, V, pw, pxg, frag, gobo, bn, gobo_tex, gobo_samp, ink_tex, ink_samp, glowc, clear, lit) * inBand;
      }
    }
    if (inPage > 0.0) {
      // THE PAGE: an opaque film under the glass — its panel lit through the chain (a black page in the sun shows the
      // dapple, faintly), its light its own; by day the byte, by night bright to the adapted eye
      var em = bw_screen(P, q, bw_page_lod(P, u), page_tex, page_samp);
      // loading: a line of light along the page's head, as far as the load has come
      if (P.screen2.w >= 0.0) {
        let head = P.page.y - P.page.w;
        let x = (q.x - (P.page.x - P.page.z)) / (2.0 * P.page.z);
        let line = bw_cov(q.y - (head + k.progress.w), pxg) * step(head, q.y) * step(x, P.screen2.w);
        em = mix(em, srgb_to_linear(k.progress.rgb), line);
      }
      let panel = srgb_to_linear(k.panelOff.rgb) * (0.5 + 0.5 * gobo);
      let off = srgb_to_linear(bw_chain(u, clamp(k.panelOff.rgb * bw_lambert(n, L, k), vec3f(0.0), vec3f(1.0)), gobo, bn.y));
      // a NOTICE (PT-5a — a failed page's words) is the FILM with the words' light on it, never a lit page
      var page = select(off, mix(panel, u.eigengrau.xyz, night), P.screen.w > 0.0 && P.screen2.x <= 0.0);
      page = page + vec3f(k.glass2.y * gobo * (1.0 - night));
      page = page + em * mix(k.glass2.w, k.glass2.z, night);
      page = page + F * k.glass2.x * mirror + glint;
      lin = lin + page * inPage;
    }
    if (hit.part == 2) {
      // THE WALL: the polished side — a steep Fresnel mirror at a grazing look, and the light the slab carries let out
      let pipe = srgb_to_linear(bw_chain(u, clamp(P.tint.rgb * bw_lambert(vec3f(0.0, 0.0, 1.0), L, k), vec3f(0.0), vec3f(1.0)), gobo, bn.y));
      let fall = clamp((-hit.w) / max(P.n.w, 1.0e-3), 0.0, 1.0);
      lin = pipe * (0.75 - 0.25 * fall) * (1.0 - F) + F * mirror + glowc * (k.glow2.z * night * (1.1 - 0.4 * fall));
    }
    lin = lin + glare;
    acc = bw_over(vec4f(bw_encode(lin) * cov, cov), acc);
  }
  // the glare over the desk beyond the pane
  acc = vec4f(acc.rgb + bw_encode(glare) * (1.0 - cov), acc.a);
  return acc * P.centre.w;
}

// ---- the LIGHT the pane throws on the mat round it (a lighting program: the pass multiplies what is there by 1 + this):
// by day the arris's caustic; by night the page's pool and the edges' thin halo.
fn light_pane(P: Pane, u: MatUniforms, k: PaneUniforms, s: vec2f, gobo_tex: texture_2d<f32>, gobo_samp: sampler,
              page_tex: texture_2d<f32>, page_samp: sampler, lit: bool) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  let q = bw_local(P, vec3f(s, 0.0) - P.centre.xyz).xy;
  let dOut = bw_outline(P, q);
  // under the pane the desk is hidden — by its face, or on the side facing the eye by its wall — and the pane shows what
  // is there itself (`bw_seen`): nothing to light
  if (dOut < -k.optics.y) { return vec3f(0.0); }
  var light = vec3f(0.0);
  // the caustic, where the lamp is not shaded by the leaves (a still of one tap: the dapple's own blur is the mat's)
  let reach = length(P.slope.xy) * P.centre.z + 4.0 * k.shadow2.y + 3.0 * k.shadow.x;
  if (dOut < reach) {
    let g = bw_tap_at(u, gobo_tex, gobo_samp, s, lit);
    light = light + vec3f(bw_shadow(P, k, s).y * g * (1.0 - 0.8 * night));
  }
  if (night > 0.0 && P.screen.w > 0.0) {
    let c = bw_glow_colour(P, q, page_tex, page_samp);
    let pool = bw_blur(bw_page(P, q), k.glow2.y) * k.glow2.x;
    let halo = exp(-max(dOut, 0.0) / max(k.glow3.y, 1.0e-3)) * step(0.0, dOut) * k.glow3.x;
    light = light + c * ((pool + halo) * night);
  }
  return light * P.centre.w;
}
