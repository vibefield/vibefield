// THE PHONE (PHONE.md; the prototype's shaders/phone/phone.wgsl, moved onto the kit) — an iPhone lying face up on the desk
// under the mat's one lamp, its screen a Simulator's. A PURE module: the record `Phone`, the pass's knobs `PhoneUniforms`,
// the slot's view block `MatUniforms` and the textures arrive as parameters; it names no colour — every surface's is a
// record's or a knob's, and every light goes through the desk's chain (the kit's `light` piece: `shade_mat`, `night_mat`,
// `sample_gobo`, `lit_gobo`, `desk_of`, `lit_desk`, `mat_zoom`, `mat_dpr`).
//
// The phone is a SLAB, seen from ITS OWN EYE (`P.eye` — over the phone's centre, the browser pane's PT-1 ruling 3): each
// fragment's desk point is a ray from that eye, taken into the phone's own frame (pitched on its camera, lifted, never
// turned) and traced: the flat glass; the rim, a quarter ellipse bisected over its fall (a flat side's is a hair, a round
// one's the whole curve of the 2.5D glass into the band); the side wall below it; a side button's top. What the ray misses is
// the desk: there the slab's shadow falls, swept down its height like the whiteboard's.
//
// The GLASS is two things: what lies under it — the display's light, the border's ink, the sensor housing, the home button —
// lit by the lamp through the desk's chain, and a MIRROR over it: Fresnel's share of the sky through the palm's leaves (the
// canopy the reflected ray meets, read off the very plate that shades the desk), the room at a slant, the lamp's glint. The
// BAND is metal: its finish's colour is its reflectance. The SCREEN is emissive: its light is added after the chain, so by day
// a byte is the drawn byte (under the glass's veil), and by night it stays bright to an eye adapted to the Moon and GLOWS —
// the eye's glare round it, its light caught by the glass's edge, and (the light program) its colour cast on the mat.
//
// THE HONEST FACE (the PT-S design §3): a still of the screen is drawn dimmer (its brightness, the record's), its MARK over it
// (the rest mark's two bars, the boot mark's ring — the words' ink), and a face's WORDS are their own texture's light added
// over the display — over the dark panel, or the still dimmed under them.
//
// `lit` — the slot is lit from ELSEWHERE (a mini mat's inside, a flight's departed desk): every dapple is the gobo where the
// light camera sees the point (`lit_desk`, `lit_gobo`). A pipeline constant in the entry, handed down, never a uniform flag.
//
// Every number of the record is continuous — a notch, an island, a home button, a round side, a steel band are sizes and
// weights, never switches — so a phone MORPHING into another model (PHONE.md §13) is this same program over a record that
// eases from one model's to the other's.

const RIM_STEPS = 10;       // = law.ts RIM_STEPS
const HOUSING_FADE = 1.5;   // = law.ts HOUSING_FADE

fn ph_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }
fn ph_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage of a shape: its shadow, its glare.
fn ph_blur(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * ph_erf(d / max(sigma * 1.4142136, 1.0e-4)); }
fn ph_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }
fn ph_encode(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return mix(x * 12.92, 1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), x));
}
// A world point raised `h` off the desk, in the projector's frame (the note's `paper_desk_at`).
fn ph_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}

// ---- the shapes (law.ts mirrors every one)

// A rounded rect with Apple's continuous corners: each a superellipse in its a × a box; the box's distance outside the corner
// boxes, the gradient-corrected Lp norm inside one.
fn ph_squircle(p: vec2f, half: vec2f, a: f32, n: f32) -> f32 {
  let aa = min(a, min(half.x, half.y));
  let q = abs(p) - (half - vec2f(aa));
  if (q.x <= 0.0 || q.y <= 0.0) { return max(q.x, q.y) - aa; }
  let k = pow(pow(q.x, n) + pow(q.y, n), 1.0 / n);
  if (k < 1.0e-6) { return -aa; }
  let g = pow(q / k, vec2f(n - 1.0));
  return (k - aa) / length(g);
}
fn ph_body(P: Phone, q: vec2f) -> f32 { return ph_squircle(q, vec2f(P.ex.w, P.ey.w), P.corner.x, P.corner.y); }
// The notch: a box hung from the display's top edge; the island's pill below it.
fn ph_notch(P: Phone, q: vec2f) -> f32 { return ph_squircle(q + vec2f(0.0, P.display.y), P.notch.xy, P.notch.z, P.notch.w); }
fn ph_pill(P: Phone, q: vec2f) -> f32 { return sdf_round_box(q - vec2f(0.0, -P.display.y + P.pill.z + P.pill.y), P.pill.xy, P.pill.y); }
// THE SENSOR HOUSING: the notch's field and the pill's, blended by how far it is an island — between the two the notch
// narrows, lets go of the top edge and rounds into the pill; going, it sinks under the glass.
fn ph_housing(P: Phone, q: vec2f) -> f32 {
  if (P.housing.y <= 0.0) { return 1.0e9; }
  var d: f32;
  if (P.housing.x <= 0.0) { d = ph_notch(P, q); }
  else if (P.housing.x >= 1.0) { d = ph_pill(P, q); }
  else { d = mix(ph_notch(P, q), ph_pill(P, q), P.housing.x); }
  return d + (1.0 - P.housing.y) * HOUSING_FADE;
}
// The display's lit area: its rect (Apple's corners; square on an LCD, whose extent is 0) less the housing, the ears rounded.
fn ph_display(P: Phone, q: vec2f) -> f32 {
  let rect = ph_squircle(q, P.display.xy, P.corner.z, P.corner.w);
  if (P.housing.y <= 0.0) { return rect; }
  return op_isect_round(rect, -ph_housing(P, q), P.housing.z);
}
// The rim at a depth d inside the outline: its height below the glass's plane and its slope along the depth — a quarter
// ellipse, a 45° facet (the chamfer), or between.
fn ph_rim(P: Phone, d: f32) -> vec2f {
  let rw = P.display.z;
  let rd = P.display.w;
  if (d >= rw) { return vec2f(0.0); }
  let t = clamp(1.0 - d / rw, 0.0, 1.0);
  // the ellipse's height exact to the outline, its slope held finite where it stands vertical
  let tc = min(t, 0.9995);
  let ellipse = vec2f(-rd * (1.0 - sqrt(max(1.0 - t * t, 0.0))), rd * tc / (rw * sqrt(1.0 - tc * tc)));
  return mix(ellipse, vec2f(-rd * t, rd / rw), P.edge.x);
}
// The wall's foot: from the rim's foot down its share of the rest of the depth (none on a round side).
fn ph_wall_foot(P: Phone) -> f32 { return mix(-P.display.w, -P.n.w, P.edge.z); }
// The outline's outward normal, by central differences.
fn ph_grad(P: Phone, q: vec2f) -> vec2f {
  let e = 0.2;
  let g = vec2f(ph_body(P, q + vec2f(e, 0.0)) - ph_body(P, q - vec2f(e, 0.0)), ph_body(P, q + vec2f(0.0, e)) - ph_body(P, q - vec2f(0.0, e)));
  let l = length(g);
  return select(vec2f(0.0, -1.0), g / l, l > 1.0e-6);
}
// The side buttons, proud of the band (law.ts `sdButtons`).
fn ph_buttons(P: Phone, k: PhoneUniforms, q: vec2f) -> f32 {
  var d = 1.0e9;
  for (var i = 0u; i < 4u; i++) {
    let b = P.buttons[i];
    if (b.w <= 0.0) { continue; }
    let proud = k.glow2.w * b.w;
    let x = b.x * (P.ex.w + proud * 0.5 - 0.3);
    d = min(d, sdf_round_box(q - vec2f(x, b.y), vec2f(proud * 0.5 + 0.3, b.z), proud * 0.5));
  }
  return d;
}
fn ph_button_top(P: Phone, k: PhoneUniforms) -> f32 { return -P.n.w * 0.5 + k.shadow.w * 0.5; }

// ---- the ray (law.ts `castPhone`)

struct PhHit { part: i32, q: vec2f, w: f32 }   // part: −1 the desk · 0 glass · 1 the rim's metal · 2 the wall · 3 a button
fn ph_at(o: vec3f, d: vec3f, w: f32) -> vec2f { return o.xy + d.xy * ((w - o.z) / d.z); }

fn ph_trace(P: Phone, k: PhoneUniforms, o: vec3f, d: vec3f) -> PhHit {
  var h: PhHit;
  h.part = -1;
  if (d.z > -1.0e-6) { return h; }
  let q0 = ph_at(o, d, 0.0);
  if (-ph_body(P, q0) >= P.display.z) { h.part = 0; h.q = q0; h.w = 0.0; return h; }
  let drop = P.display.w;
  if (-ph_body(P, ph_at(o, d, -drop)) >= 0.0) {
    var hi = 0.0;
    var lo = -drop;
    for (var i = 0; i < RIM_STEPS; i++) {
      let mid = 0.5 * (hi + lo);
      let dm = -ph_body(P, ph_at(o, d, mid));
      if (dm < 0.0 || mid > ph_rim(P, dm).x) { hi = mid; } else { lo = mid; }
    }
    h.q = ph_at(o, d, lo);
    h.w = lo;
    h.part = select(1, 0, -ph_body(P, h.q) >= P.edge.y);
    return h;
  }
  let wTop = -drop;
  let wBot = ph_wall_foot(P);
  if (wBot < wTop - 1.0e-4) {
    let da = ph_body(P, ph_at(o, d, wTop));
    let db = ph_body(P, ph_at(o, d, wBot));
    if (db <= 0.0 && da > 0.0) {
      h.part = 2;
      h.w = mix(wTop, wBot, da / (da - db));
      h.q = ph_at(o, d, h.w);
    }
  }
  let bw = ph_button_top(P, k);
  if (h.part < 0 || h.w < bw) {
    let qb = ph_at(o, d, bw);
    if (ph_buttons(P, k, qb) <= 0.0) { h.part = 3; h.q = qb; h.w = bw; }
  }
  return h;
}

// How far inside the silhouette the ray passes (law.ts `silhouetteDepth`): the rim's foot on the far side, the base on the near side of a walled phone.
fn ph_sil(P: Phone, o: vec3f, d: vec3f) -> f32 {
  if (d.z > -1.0e-6) { return -1.0e9; }
  let a = -ph_body(P, ph_at(o, d, -P.display.w));
  if (P.edge.z <= 0.0) { return a; }
  return max(a, -ph_body(P, ph_at(o, d, ph_wall_foot(P))));
}

// ---- the shadow: the slab's footprint cast along the lamp's ray from every height it spans

fn ph_shadow(P: Phone, k: PhoneUniforms, s: vec2f) -> f32 {
  let a = vec3f(-P.slope.xy, 1.0);   // toward the lamp: one unit up per unit of the ray's parameter
  let O = vec3f(s, 0.0) - P.centre.xyz;
  let o = vec3f(dot(O, P.ex.xyz), dot(O, P.ey.xyz), dot(O, P.n.xyz));
  let d = vec3f(dot(a, P.ex.xyz), dot(a, P.ey.xyz), dot(a, P.n.xyz));
  if (d.z < 1.0e-4) { return 0.0; }
  let tTop = -o.z / d.z;                // the ray's parameter IS its height over the desk
  let tBot = (-P.n.w - o.z) / d.z;
  let steps = max(i32(k.shadow.z), 2);
  var sh = 0.0;
  for (var i = 0; i < steps; i++) {
    let t = mix(tBot, tTop, f32(i) / f32(steps - 1));
    if (t <= 0.0) { continue; }
    let p = o + d * t;
    sh = max(sh, ph_blur(ph_body(P, p.xy), k.shadow.x + k.shadow.y * t));
  }
  sh = sh * P.light.w;
  // the contact at the base, where it lies on the mat (not where it stands on its camera)
  let pb = o + d * max(tBot, 0.0);
  let con = ph_blur(ph_body(P, pb.xy), k.contact.y) * k.contact.x * exp(-max(tBot, 0.0) / max(k.contact.z, 1.0e-3));
  return max(sh, con);
}

// ---- the lamp's dapple

// The gobo with one tap — what a mirrored ray sees of the leaves (the dapple's own blur is the desk's, not a mirror's).
fn ph_gobo_tap(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, desk: vec3f) -> f32 {
  if (u.gobo.x <= 0.0) { return 1.0; }
  let clip = u.goboMatrix * vec4f(desk, 1.0);
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(0.5 + 0.5 * ndc.x, 0.5 - 0.5 * ndc.y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  return mix(1.0, textureSampleLevel(tex, samp, uv, 0.0).r, u.gobo.x);
}

// One tap of the dapple at a world point on the desk — under the slot's own lamp, or (`lit`) where the light camera sees the
// point, cross-faded to the second while a flight hands one lamp to the other (the kit's `lit_gobo`, one tap; the pane's).
fn ph_tap_at(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, p: vec2f, lit: bool) -> f32 {
  if (!lit) { return ph_gobo_tap(u, tex, samp, desk_of(u, p)); }
  var g = 0.0;
  if (all(u.light.xyz == u.cam.xyz)) { g = ph_gobo_tap(u, tex, samp, desk_of(u, p)); }
  else { g = ph_gobo_tap(u, tex, samp, lit_desk(u, u.light, p, 0.0)); }
  if (u.light.w > 0.0) { g = mix(g, ph_gobo_tap(u, tex, samp, lit_desk(u, u.light2, p, 0.0)), u.light.w); }
  return g;
}

// The dapple on a point raised `h` (the phone's own surface): the kit's blurred gobo, under whichever lamp the slot is lit by.
fn ph_gobo_on(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, p: vec2f, h: f32, n: f32, lit: bool) -> f32 {
  let own = ph_desk_at(u, p, h);
  if (lit) { return lit_gobo(u, tex, samp, p, h, own, n); }
  return sample_gobo(u, tex, samp, own, n);
}

// ---- the light on the phone

// The desk's chain on an sRGB albedo (the whiteboard's `bd_colour`): the reference's grade by day, the eye's by night.
fn ph_chain(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, albedo, gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// The lamp on a face (the kit's one physics): its fill, the lambert normalised so a flat face reads 1, capped.
fn ph_lambert(n: vec3f, L: vec3f, k: PhoneUniforms) -> f32 {
  let d = max(dot(n, L), 0.0) / max(L.z, 0.05);
  return k.lamp.x + (1.0 - k.lamp.x) * min(d, k.lamp.y);
}

// What a mirror at `pw` sees along R (linear light): up, the sky through the palm — the canopy the ray meets `glass.w` over
// the desk, read off the plate that shades the desk at the point that canopy point shades; at a slant, the room; downward,
// the mat itself as the lamp lights it. `sharp` 0 blurs the leaves into their average (a rough metal sees no leaf).
fn ph_env(u: MatUniforms, k: PhoneUniforms, P: Phone, R: vec3f, pw: vec3f, sharp: f32, gobo_here: f32, tex: texture_2d<f32>, samp: sampler, lit: bool) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  let sky = mix(srgb_to_linear(k.sky.rgb), srgb_to_linear(k.nightSky.rgb), night);
  let leaves = mix(srgb_to_linear(k.leaves.rgb), srgb_to_linear(k.nightLeaves.rgb), night);
  let room = srgb_to_linear(k.room.rgb) * mix(1.0, 0.03, night);
  if (R.z < -0.02) {
    // the mat under the phone's side, as lit here
    return srgb_to_linear(ph_chain(u, u.ground.rgb, gobo_here, 0.5)) * 0.9;
  }
  let hc = k.glass.w;
  let X = pw.xy + R.xy * ((hc - pw.z) / max(R.z, 0.12));
  let open = mix(0.62, ph_tap_at(u, tex, samp, X + P.slope.xy * hc, lit), sharp);
  let up = mix(leaves, sky, open);
  // the bright sky round the lamp — the window a rim turned a third of the way toward it mirrors as a line of light;
  // blocked where the leaves shade this point, the Moon's much dimmer by night
  let lobe = pow(max(dot(R, P.light.xyz), 0.0), mix(3.0, 28.0, sharp)) * k.env.x * gobo_here * mix(1.0, k.env.y, night);
  return mix(room, up, smoothstep(0.02, 0.7, R.z)) + sky * lobe;
}

// The lamp's colour as a glint: the Sun's white by day; by night the Moon's, dimmer, taken toward the rods' blue.
fn ph_glint_colour(u: MatUniforms, k: PhoneUniforms) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  return mix(vec3f(1.0), mix(u.moon.xyz, u.rod.xyz, 0.5) * k.glass2.z * 0.35, night);
}

// The band's metal at a point: its dyed or bare diffuse through the chain, and its mirror — the finish's colour as reflectance.
fn ph_metal(P: Phone, u: MatUniforms, k: PhoneUniforms, n: vec3f, V: vec3f, pw: vec3f, gobo: f32, noise: f32, tex: texture_2d<f32>, samp: sampler, lit: bool) -> vec3f {
  let m = k.alu * P.metals.x + k.steel * P.metals.y + k.ti * P.metals.z;
  let rough = mix(m.y, 0.04, P.edge.w);
  let L = P.light.xyz;
  let albedo = P.band.rgb;
  var lin = srgb_to_linear(ph_chain(u, clamp(albedo * ph_lambert(n, L, k), vec3f(0.0), vec3f(1.0)), gobo, noise)) * m.x;
  // reflectance: a bare metal's colour; anodised aluminium's dye lets half of it through
  let F0 = mix(srgb_to_linear(albedo), mix(vec3f(0.04), srgb_to_linear(albedo), 0.5), P.metals.x * (1.0 - P.edge.w));
  let ndv = max(dot(n, V), 0.0);
  let Fr = F0 + (vec3f(1.0) - F0) * pow(1.0 - ndv, 5.0);
  let R = reflect(-V, n);
  lin = lin + Fr * ph_env(u, k, P, R, pw, 1.0 - rough, gobo, tex, samp, lit) * (1.0 - 0.5 * m.x);
  let H = normalize(L + V);
  // roughness → shininess on a perceptual scale: a mirror ~2000, polished steel ~500, titanium ~120, satin aluminium ~55
  let shin = exp2(mix(11.0, 3.0, sqrt(rough)));
  lin = lin + F0 * ph_glint_colour(u, k) * (pow(max(dot(n, H), 0.0), shin) * m.z * gobo * mix(1.0, 0.3, rough));
  return lin;
}

// ---- the screen

// The display's uv (the glass's frame, portrait) → where it reads in a frame turned `quarter` quarter turns (law.ts `frameUv`).
fn ph_frame_uv(uv: vec2f, quarter: f32) -> vec2f {
  let r = i32(quarter + 0.5) % 4;
  if (r == 1) { return vec2f(uv.y, 1.0 - uv.x); }
  if (r == 2) { return vec2f(1.0 - uv.x, 1.0 - uv.y); }
  if (r == 3) { return vec2f(1.0 - uv.y, uv.x); }
  return uv;
}
// Where a point of the glass reads in the frame: the display's uv, cropped to fill it when the frame's picture has another
// aspect (mid-morph, a stream of another device — never stretched), turned by the frame's rotation.
fn ph_uv(P: Phone, q: vec2f) -> vec2f { return ph_frame_uv(0.5 + q / P.display.xy * 0.5 * P.crop.xy, P.screen2.y); }
// The level the frame is read at here: its texels across the display over the device px the display spans on this slot's
// screen (the coarser axis), never past its last level — the slot's zoom, so the record never needs the camera (law.ts
// `screenLod`, the same law through the desk eye).
fn ph_screen_lod(P: Phone, u: MatUniforms) -> f32 {
  let device = 2.0 * P.display.xy * mat_zoom(u) * mat_dpr(u);
  let turned = (i32(P.screen2.y + 0.5) % 2) == 1;
  let texels = select(P.screen.xy, P.screen.yx, turned) * P.crop.xy;
  let ratio = max(texels.x / max(device.x, 1.0e-3), texels.y / max(device.y, 1.0e-3));
  return clamp(log2(max(ratio, 1.0e-6)), 0.0, P.screen.z);
}
// The display's light at a point of the glass (linear), at the level the frame is read at — a still's dimmer (its brightness).
fn ph_screen(P: Phone, u: MatUniforms, q: vec2f, tex: texture_2d<f32>, samp: sampler) -> vec3f {
  if (P.screen.w <= 0.0) { return vec3f(0.0); }
  return textureSampleLevel(tex, samp, ph_uv(P, q), ph_screen_lod(P, u)).rgb * (P.screen.w * P.screen2.z);
}
// The screen's colour near a point: the frame read coarse at the display's nearest point — what its glow is tinted by.
fn ph_glow_colour(P: Phone, q: vec2f, tex: texture_2d<f32>, samp: sampler) -> vec3f {
  if (P.screen.w <= 0.0) { return vec3f(0.0); }
  let qc = clamp(q, -P.display.xy, P.display.xy);
  return textureSampleLevel(tex, samp, ph_uv(P, qc), min(P.screen2.w, P.screen.z)).rgb * (P.screen.w * P.screen2.z);
}

// ---- the honest face: its words (their own texture) and its marks (the words' ink), light added over the display

// The level a face's words are read at: their texels over the device px their block spans on this slot's screen.
fn ph_notice_lod(P: Phone, u: MatUniforms) -> f32 {
  let device = 2.0 * P.notice.zw * mat_zoom(u) * mat_dpr(u);
  let ratio = max(P.notice2.x / max(device.x, 1.0e-3), P.notice2.y / max(device.y, 1.0e-3));
  return clamp(log2(max(ratio, 1.0e-6)), 0.0, P.notice2.z);
}
// The rest mark (two bars, the pane's) or the boot mark (a ring open at its top), at the display's centre: its coverage.
fn ph_mark(P: Phone, k: PhoneUniforms, q: vec2f, px: f32) -> f32 {
  let mark = i32(P.face.x + 0.5);
  if (mark == 1) {
    let half = vec2f(0.5 * k.marks.x, 0.5 * k.marks.y);
    let c = 0.5 * k.marks.z;
    let d = min(sdf_round_box(q - vec2f(-c, 0.0), half, half.x), sdf_round_box(q - vec2f(c, 0.0), half, half.x));
    return ph_cov(d, px);
  }
  if (mark == 2) {
    let thick = k.marks2.x;
    let r = 0.5 * (k.marks.w - thick);
    let gap = k.marks2.y;
    // the angle from the top of the ring (v runs down the screen: the top is −v)
    let a = atan2(q.x, -q.y);
    var d = abs(length(q) - r) - 0.5 * thick;
    if (abs(a) < 0.5 * gap) {
      // in the gap: the distance to the nearer of the arc's two round ends
      let s = select(-1.0, 1.0, q.x >= 0.0);
      let e = r * vec2f(s * sin(0.5 * gap), -cos(0.5 * gap));
      d = length(q - e) - 0.5 * thick;
    }
    return ph_cov(d, px);
  }
  return 0.0;
}
// What the face adds over the display at a point (linear light): its words' light, its mark's.
fn ph_face(P: Phone, u: MatUniforms, k: PhoneUniforms, q: vec2f, px: f32, notice_tex: texture_2d<f32>, samp: sampler) -> vec3f {
  var light = vec3f(0.0);
  if (P.notice2.w > 0.0) {
    let nuv = (q - P.notice.xy) / P.notice.zw * 0.5 + 0.5;
    if (nuv.x >= 0.0 && nuv.x <= 1.0 && nuv.y >= 0.0 && nuv.y <= 1.0) {
      light = light + textureSampleLevel(notice_tex, samp, nuv, ph_notice_lod(P, u)).rgb;
    }
  }
  let m = ph_mark(P, k, q, px);
  if (m > 0.0) { light = light + srgb_to_linear(k.words.rgb) * (m * k.words.w); }
  return light;
}

// A lens seen through the glass: coated glass in a thin ring, as much of it as is there (`a`).
fn ph_lens(k: PhoneUniforms, q: vec2f, c: vec2f, r: f32, px: f32, under: vec3f, a: f32) -> vec3f {
  let d = length(q - c) - r;
  let ring = ph_cov(abs(d + r * 0.18) - r * 0.18, px);
  let col = mix(under, k.lens.rgb, ph_cov(d, px) * a);
  return mix(col, k.lensRing.rgb, ring * 0.8 * a);
}

// ---- the glass: what lies under it, lit; its screen's light and its face; its mirror
fn ph_glass(P: Phone, u: MatUniforms, k: PhoneUniforms, q: vec2f, n: vec3f, V: vec3f, pw: vec3f, px: f32, gobo: f32, bn: vec3f,
            gobo_tex: texture_2d<f32>, gobo_samp: sampler, scr: texture_2d<f32>, scr_samp: sampler, notice_tex: texture_2d<f32>, lit: bool) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  let L = P.light.xyz;
  var albedo = P.front.rgb;
  var emission = vec3f(0.0);
  // the display: an OLED's black (an LCD's grey-blue) under the glass, its light, and the face over it
  let dd = ph_display(P, q);
  let inDisp = ph_cov(dd, px);
  if (inDisp > 0.0) {
    albedo = mix(albedo, mix(k.oled.rgb, k.lcd.rgb, P.front.w), inDisp);
    emission = (ph_screen(P, u, q, scr, scr_samp) + ph_face(P, u, k, q, px, notice_tex, scr_samp)) * inDisp;
  }
  // the sensor housing, cut from the display: a notch hanging into it (the bezel's own black ink, the earpiece's mesh on
  // the X → 12), the island (black glass over the camera and the Face ID window, a hair lighter than a black pixel, which
  // is how you find it on a dark screen in the sun) — or, mid-morph, between; the camera in it
  let mm = k.lamp.z;
  if (P.housing.y > 0.0) {
    let c = ph_cov(ph_housing(P, q), px) * (1.0 - inDisp);
    if (c > 0.0) {
      let top = -P.display.y;
      var h = mix(albedo, mix(k.oled.rgb, k.housing.rgb, 0.5), P.housing.x);
      if (P.pill.w > 0.0) { h = mix(h, k.mesh.rgb, ph_cov(sdf_round_box(q - vec2f(0.0, top + 1.2 * mm), vec2f(4.8 * mm, 0.42 * mm), 0.42 * mm), px) * P.pill.w); }
      h = ph_lens(k, q, vec2f(P.lens.x, top + P.lens.y), P.lens.z, px, h, 1.0);
      albedo = mix(albedo, h, c);
    }
  }
  // the home-button face: the button (a sapphire dish in a ring of the band's metal), the earpiece and the camera — on the
  // border only, never over the display growing into it mid-morph; as it goes, the button closes into its centre
  let cp = P.classic.z;
  if (cp > 0.0) {
    let a = cp * (1.0 - inDisp);
    let hc = vec2f(0.0, P.classic.x);
    let hb = length(q - hc) - P.classic.y;
    let rw = 0.22 * mm * cp;
    let ring = ph_cov(abs(hb + rw) - rw, px);
    // the dish: shaded across it as a concave face is, lighter on the side away from the lamp
    let dish = ph_cov(hb + 2.0 * rw, px);
    let across = dot((q - hc) / max(P.classic.y, 1.0e-3), normalize(L.xy));
    albedo = mix(albedo, clamp(albedo * (1.0 - 0.14 * across), vec3f(0.0), vec3f(1.0)), dish * a);
    albedo = mix(albedo, P.band.rgb, ring * a);
    albedo = mix(albedo, k.mesh.rgb, ph_cov(sdf_round_box(q - vec2f(0.0, P.classic.w), vec2f(5.1 * mm, 0.65 * mm), 0.65 * mm), px) * a);
    albedo = ph_lens(k, q, P.classic2.xy, 1.15 * mm, px, albedo, a);
  }
  // the ink and the panel under the glass, lit through the chain (the dapple shows on a white front, faintly on a black
  // screen) — but deep inside a lit display the panel's own diffuse is a thousandth of the light on it, below a byte under
  // any light: there it is the off panel's reflectance by day, the dark's own grey by night, no chain
  var lin: vec3f;
  if (inDisp >= 1.0 && P.screen.w > 0.0) {
    lin = mix(srgb_to_linear(albedo) * (0.5 + 0.5 * gobo), u.eigengrau.xyz, night);
  } else {
    lin = srgb_to_linear(ph_chain(u, clamp(albedo * ph_lambert(n, L, k), vec3f(0.0), vec3f(1.0)), gobo, bn.y));
  }
  lin = lin + vec3f(k.glass2.y * gobo * (1.0 - night) * inDisp);
  // the screen's own light — by day the byte, by night the adapted eye's bright screen
  lin = lin + emission * mix(k.glass2.w, k.glass2.z, night);
  // the mirror over it all
  let ndv = max(dot(n, V), 0.0);
  let F = k.glass.x + (1.0 - k.glass.x) * pow(1.0 - ndv, 5.0);
  let R = reflect(-V, n);
  lin = lin + F * k.glass2.x * ph_env(u, k, P, R, pw, 1.0, gobo, gobo_tex, gobo_samp, lit);
  let H = normalize(L + V);
  lin = lin + ph_glint_colour(u, k) * (pow(max(dot(n, H), 0.0), k.glass.z) * k.glass.y * gobo);
  return lin;
}

// ---- one phone at a desk point `s`: premultiplied colour. `px` is world units per DEVICE px at the desk; `frag` the framebuffer pixel.
fn shade_phone(P: Phone, u: MatUniforms, k: PhoneUniforms, s: vec2f, px: f32, frag: vec2f,
               gobo_tex: texture_2d<f32>, gobo_samp: sampler, noise_tex: texture_2d<f32>, noise_samp: sampler,
               scr: texture_2d<f32>, scr_samp: sampler, notice_tex: texture_2d<f32>, lit: bool) -> vec4f {
  let night = clamp(u.night.x, 0.0, 1.0);
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  let E = P.eye.xyz;
  let O = E - P.centre.xyz;
  let D = vec3f(s, 0.0) - E;
  let o = vec3f(dot(O, P.ex.xyz), dot(O, P.ey.xyz), dot(O, P.n.xyz));
  let d = vec3f(dot(D, P.ex.xyz), dot(D, P.ey.xyz), dot(D, P.n.xyz));
  // a device pixel at the glass's height (the eye magnifies what is high)
  let pxg = px * max(E.z - P.centre.z, 1.0) / E.z;
  // the glass's plane under the ray, and how far outside the outline that is: most of a quad is the desk, and a ray more than
  // the slab's own parallax (its depth, seen from the eye) plus a button's proud outside meets nothing — the trace and the
  // silhouette are skipped there, exactly
  let q0 = ph_at(o, d, 0.0);
  let dOut = ph_body(P, q0);
  var hit: PhHit;
  hit.part = -1;
  var cov = 0.0;
  if (dOut <= length(d.xy) * P.n.w / max(-d.z, 1.0e-4) + k.glow2.w + 2.0 * pxg) {
    hit = ph_trace(P, k, o, d);
    cov = ph_cov(-ph_sil(P, o, d), pxg);
    if (hit.part == 3) { cov = 1.0; }
  }
  var acc = vec4f(0.0);

  // THE SHADOW, where the phone does not cover the desk — and only within its cast's reach: the slab's top cast along the
  // lamp's slope, three of its widest σ past that
  if (cov < 1.0) {
    let top = P.centre.z + P.n.w;
    if (dOut <= length(P.slope.xy) * top + 3.0 * (k.shadow.x + k.shadow.y * top) + 2.0 * pxg) {
      let sh = ph_shadow(P, k, s) * (1.0 - cov);
      let ink = mix(k.shade.rgb, ph_encode(u.eigengrau.xyz), night);
      acc = vec4f(ink * sh, sh);
    }
  }

  var glow = vec3f(0.0);
  if (night > 0.0 && P.screen.w > 0.0 && dOut < 3.0 * k.glow.w) {
    // the display's shape blurred at two widths — a halo round it; over the display itself only a faint veil, since the eye
    // looking at a screen sees its picture, not the glare the picture throws
    let c = ph_glow_colour(P, q0, scr, scr_samp);
    let dd = ph_display(P, q0);
    let halo = k.glow.x * ph_blur(dd, k.glow.z) + k.glow.y * ph_blur(dd, k.glow.w);
    glow = c * (halo * mix(1.0, 0.1, ph_cov(dd, pxg)) * night);
  }

  // THE PHONE
  if (hit.part >= 0 && cov > 0.0) {
    let q = hit.q;
    let pw = P.centre.xyz + P.ex.xyz * q.x + P.ey.xyz * q.y + P.n.xyz * hit.w;
    let depth = -ph_body(P, q);
    var nl = vec3f(0.0, 0.0, 1.0);
    if (hit.part == 2) { nl = vec3f(ph_grad(P, q), 0.0); }
    else if (hit.part < 2 && depth < P.display.z) { nl = normalize(vec3f(ph_grad(P, q) * ph_rim(P, max(depth, 0.0)).y, 1.0)); }
    let n = normalize(P.ex.xyz * nl.x + P.ey.xyz * nl.y + P.n.xyz * nl.z);
    let V = normalize(E - pw);
    // the dapple here: the mat's soft gobo — or, deep in a lit display (where it only tints the panel's faint scatter and
    // no glint can land on flat glass), one tap
    var gobo: f32;
    if (hit.part == 0 && P.screen.w > 0.0 && depth > P.display.z && ph_display(P, q) < -pxg) { gobo = ph_tap_at(u, gobo_tex, gobo_samp, pw.xy, lit); }
    else { gobo = ph_gobo_on(u, gobo_tex, gobo_samp, pw.xy, pw.z, bn.z, lit); }
    var lin: vec3f;
    if (hit.part == 0) {
      lin = ph_glass(P, u, k, q, n, V, pw, pxg, gobo, bn, gobo_tex, gobo_samp, scr, scr_samp, notice_tex, lit);
      // the glass's edge, catching the display's light by night
      if (night > 0.0 && P.screen.w > 0.0) {
        let e = 1.0 - smoothstep(0.0, P.display.z * 0.9 + 0.8 * k.lamp.z, depth - P.edge.y);
        lin = lin + ph_glow_colour(P, q, scr, scr_samp) * (k.glow2.z * e * night);
      }
    } else {
      lin = ph_metal(P, u, k, n, V, pw, gobo, bn.y, gobo_tex, gobo_samp, lit);
      // the earpiece's slit in the top of the frame (the 13's notch onward, the island's phones)
      if (hit.part == 1 && P.housing.w > 0.0) {
        let slit = ph_cov(sdf_round_box(q - vec2f(0.0, -P.ey.w + P.edge.y * 0.55), vec2f(5.0 * k.lamp.z, 0.13 * k.lamp.z), 0.13 * k.lamp.z), pxg) * P.housing.w;
        lin = lin * (1.0 - 0.85 * slit);
      }
    }
    lin = lin + glow;
    acc = ph_over(vec4f(ph_encode(lin) * cov, cov), acc);
  }
  // the glare the eye sees round a bright screen, over the desk beyond the phone
  acc = vec4f(acc.rgb + ph_encode(glow) * (1.0 - cov), acc.a);
  return acc * P.centre.w;
}

// ---- the spill: the screen's light on the mat round the phone (a lighting program: the pass multiplies what is there by 1 + this)
fn spill_phone(P: Phone, u: MatUniforms, k: PhoneUniforms, s: vec2f, scr: texture_2d<f32>, scr_samp: sampler) -> vec3f {
  let night = clamp(u.night.x, 0.0, 1.0);
  if (night <= 0.0 || P.screen.w <= 0.0) { return vec3f(0.0); }
  let O = vec3f(s, 0.0) - P.centre.xyz;
  let q = vec2f(dot(O, P.ex.xyz), dot(O, P.ey.xyz));
  return ph_glow_colour(P, q, scr, scr_samp) * (ph_blur(ph_body(P, q), k.glow2.y) * k.glow2.x * night * P.centre.w);
}
