const CLOCK_TAU: f32 = 6.2831853;

fn clock_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }

fn clock_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage: 1 well inside (d < 0), 0 well outside.
fn clock_blur(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * clock_erf(d / max(sigma * 1.4142136, 1.0e-4)); }

fn clock_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }

// A direction on the dial, clockwise from twelve.
fn clock_dir(a: f32) -> vec2f { return vec2f(sin(a), -cos(a)); }

// A point in the frame of a mark at centre c whose UP is `up` (unit): x along the clockwise tangent, y along up.
fn clock_frame(p: vec2f, c: vec2f, up: vec2f) -> vec2f {
  let d = p - c;
  return vec2f(dot(d, vec2f(-up.y, up.x)), dot(d, up));
}

// A world point raised h off the desk, in the projector's frame (mat.wgsl desk_of with a height).
fn clock_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}

// The bezel's height at radius r (world units): up from the dial's rim to the crown at 40 %, down the outer shoulder.
fn clock_bezel(r: f32, F: f32, R: f32, hc: f32, hf: f32) -> f32 {
  let t = clamp((r - F) / max(R - F, 1.0e-4), 0.0, 1.0);
  let down = smoothstep(0.4, 1.0, t);
  return mix(hf, hc, smoothstep(0.0, 0.4, t)) - 0.55 * (hc - hf) * down * down;
}

// ---- the hands (face units): a tapered bar from its tail through the arbor to its tip.
// h = (length, tail, width at the tail, width at the tip), half widths.
fn clock_hand(x: vec2f, a: f32, h: vec4f) -> f32 {
  let d = clock_dir(a);
  let A = -d * h.y;
  let pa = x - A;
  let ba = d * (h.x + h.y);
  let t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t) - mix(h.z, h.w, t);
}
const CLOCK_HOUR = vec4f(0.50, 0.12, 0.052, 0.030);
const CLOCK_MINUTE = vec4f(0.78, 0.14, 0.038, 0.018);
const CLOCK_SECOND = vec4f(0.86, 0.22, 0.009, 0.009);

// The seconds hand, and on the station dial its disc near the tip.
fn clock_second(x: vec2f, a: f32, style: u32) -> f32 {
  let s = clock_hand(x, a, CLOCK_SECOND);
  if (style != 1u) { return s; }
  return min(s, length(x - clock_dir(a) * 0.62) - 0.075);
}

// ---- the numerals: Roman (I V X, thick and thin strokes) and a stroke font of digits for the 24-hour ring.
// A Roman numeral's letters, left to right, a nibble each (1 I · 2 V · 3 X), for XII, I, II … XI (IIII, as clocks write four).
const CLOCK_ROMAN = array<u32, 12>(0x113u, 0x1u, 0x11u, 0x111u, 0x1111u, 0x2u, 0x12u, 0x112u, 0x1112u, 0x31u, 0x3u, 0x13u);
fn clock_letter_w(l: u32) -> f32 { if (l == 1u) { return 0.2; } return 0.56; }

// The numeral for hour k (0 = XII) at p — numeral-height units, y up, centred.
fn clock_roman(p: vec2f, k: u32) -> f32 {
  let code = CLOCK_ROMAN[k];
  var n = 0u;
  var w = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let l = (code >> (4u * i)) & 15u;
    if (l == 0u) { break; }
    w += clock_letter_w(l);
    n += 1u;
  }
  w += 0.1 * f32(max(n, 1u) - 1u);
  var x = -0.5 * w;
  var d = 1.0e9;
  for (var i = 0u; i < n; i++) {
    let l = (code >> (4u * i)) & 15u;
    let lw = clock_letter_w(l);
    let q = p - vec2f(x + 0.5 * lw, 0.0);
    if (l == 1u) {
      d = min(d, sdf_segment(q, vec2f(0.0, -0.5), vec2f(0.0, 0.5)) - 0.075);
    } else if (l == 2u) {
      d = min(d, min(sdf_segment(q, vec2f(-0.28, 0.5), vec2f(0.0, -0.5)) - 0.075, sdf_segment(q, vec2f(0.28, 0.5), vec2f(0.0, -0.5)) - 0.035));
    } else {
      d = min(d, min(sdf_segment(q, vec2f(-0.28, 0.5), vec2f(0.28, -0.5)) - 0.075, sdf_segment(q, vec2f(0.28, 0.5), vec2f(-0.28, -0.5)) - 0.035));
    }
    x += lw + 0.1;
  }
  return d;
}

// A digit's strokes (a · b · c · d · e · f · g, one bit each) for 0 … 9.
const CLOCK_SEGMENTS = array<u32, 10>(63u, 6u, 91u, 79u, 102u, 109u, 125u, 7u, 127u, 111u);
// Digit n at p — digit-height units, y up, centred.
fn clock_digit(p: vec2f, n: u32) -> f32 {
  let m = CLOCK_SEGMENTS[n];
  let w = 0.25;
  let h = 0.5;
  var d = 1.0e9;
  if ((m & 1u) != 0u) { d = min(d, sdf_segment(p, vec2f(-w, h), vec2f(w, h))); }
  if ((m & 2u) != 0u) { d = min(d, sdf_segment(p, vec2f(w, h), vec2f(w, 0.0))); }
  if ((m & 4u) != 0u) { d = min(d, sdf_segment(p, vec2f(w, 0.0), vec2f(w, -h))); }
  if ((m & 8u) != 0u) { d = min(d, sdf_segment(p, vec2f(-w, -h), vec2f(w, -h))); }
  if ((m & 16u) != 0u) { d = min(d, sdf_segment(p, vec2f(-w, 0.0), vec2f(-w, -h))); }
  if ((m & 32u) != 0u) { d = min(d, sdf_segment(p, vec2f(-w, h), vec2f(-w, 0.0))); }
  if ((m & 64u) != 0u) { d = min(d, sdf_segment(p, vec2f(-w, 0.0), vec2f(w, 0.0))); }
  return d - 0.07;
}
// A number of one or two digits, centred.
fn clock_number(p: vec2f, v: u32) -> f32 {
  if (v < 10u) { return clock_digit(p, v); }
  return min(clock_digit(p + vec2f(0.36, 0.0), v / 10u), clock_digit(p - vec2f(0.36, 0.0), v % 10u));
}

// THE DIAL'S PRINTING at face point x (face units): (ink, lume) coverage. fpx = a device px in face units.
fn clock_print(x: vec2f, style: u32, ring24: bool, fpx: f32) -> vec2f {
  let r = length(x);
  var a = atan2(x.x, -x.y);
  if (a < 0.0) { a += CLOCK_TAU; }
  var ink = 0.0;
  var lume = 0.0;
  // the minute track: the nearest tick (a fifth of them are the hours')
  let mi = round(a / (CLOCK_TAU / 60.0));
  let md = clock_dir(mi * CLOCK_TAU / 60.0);
  let hour = (u32(mi) % 5u) == 0u;
  if (style == 1u) {
    // the station dial: black bars at the hours, strokes at the minutes (the railway's)
    let t = select(vec3f(0.89, 0.97, 0.009), vec3f(0.72, 0.97, 0.034), hour);
    ink = max(ink, clock_cov(sdf_segment(x, md * t.x, md * t.y) - t.z, fpx));
  } else if (style == 2u) {
    // graphite: lume at the hours — bars at the quarters, dots between — and fine strokes at the minutes
    if (hour) {
      let quarter = (u32(mi) % 15u) == 0u;
      let dl = select(length(x - md * 0.88) - 0.038, sdf_segment(x, md * 0.8, md * 0.95) - 0.032, quarter);
      lume = max(lume, clock_cov(dl, fpx));
    } else {
      ink = max(ink, clock_cov(sdf_segment(x, md * 0.92, md * 0.97) - 0.006, fpx));
    }
  } else {
    // classic: the chapter ring between two rules, a stroke at each minute, a longer at each hour, the Roman numerals inside
    let t = select(vec3f(0.9, 0.97, 0.006), vec3f(0.87, 0.97, 0.013), hour);
    ink = max(ink, clock_cov(sdf_segment(x, md * t.x, md * t.y) - t.z, fpx));
    ink = max(ink, clock_cov(abs(r - 0.97) - 0.004, fpx));
    ink = max(ink, clock_cov(abs(r - 0.855) - 0.004, fpx));
    let k = u32(round(a / (CLOCK_TAU / 12.0))) % 12u;
    let up = clock_dir(f32(k) * CLOCK_TAU / 12.0);
    let H = 0.135;
    let p = clock_frame(x, up * 0.735, up) / H;
    if (abs(p.x) < 2.0 && abs(p.y) < 1.0) { ink = max(ink, clock_cov(clock_roman(p, k) * H, fpx)); }
  }
  if (ring24) {
    // the 24-hour ring: 13 … 24 upright inside the hours, in the dial's ink
    let k = u32(round(a / (CLOCK_TAU / 12.0))) % 12u;
    let c = clock_dir(f32(k) * CLOCK_TAU / 12.0) * select(0.6, 0.54, style == 0u);
    let H = 0.075;
    let p = vec2f(x.x - c.x, c.y - x.y) / H;
    if (abs(p.x) < 1.2 && abs(p.y) < 0.8) { ink = max(ink, 0.85 * clock_cov(clock_number(p, 12u + select(k, 12u, k == 0u)) * H, fpx)); }
  }
  return vec2f(ink, lume);
}

// docs:begin colour
// The colour on screen of a lit albedo: the mat's day chain, the night's, or between (a clock is lit as the mat is).
fn clock_colour(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, albedo, gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}
// docs:end colour

// A hand's lit colour at x: its two facets turned from the lamp or toward it (a ridge along the hand).
fn clock_facet(x: vec2f, a: f32, L: vec3f, albedo: vec3f) -> vec3f {
  let d = clock_dir(a);
  let side = vec2f(-d.y, d.x);
  let n = normalize(vec3f(side * sign(dot(x, side)) * 0.45, 1.0));
  return albedo * (0.35 + 0.65 * pow(saturate(dot(n, L)) / max(L.z, 1.0e-3), 1.0 / 2.2));
}

// One clock at world point p: premultiplied colour. px = world units per device px; frag = the framebuffer pixel; lit = the slot
// is lit from elsewhere (a mini mat's inside) — a pipeline constant, never a uniform flag.
fn shade_clock(C: Clock, u: MatUniforms, p: vec2f, px: f32, frag: vec2f,
               gobo_tex: texture_2d<f32>, gobo_samp: sampler, noise_tex: texture_2d<f32>, noise_samp: sampler, lit: bool) -> vec4f {
  let q = p - C.centre;
  let R = C.radius;
  let rr = length(q);
  let d = rr - R;
  let hc = C.heights.x + C.lift;
  let hf = C.heights.y + C.lift;
  // the case's shadow on the desk, outside the case: its silhouette cast along the lamp's ground slope, blurred by its height
  let ds = length(q - C.slope * hc) - R;
  let sh = clock_blur(ds, C.shadow.x + C.shadow.z * hc) * C.shadow.y * (1.0 - clock_cov(d, px));
  var acc = vec4f(0.0, 0.0, 0.0, sh);
  if (d > px) { return acc * C.alpha; }
  let cov = clock_cov(d, px);
  let L = C.lamp.xyz;
  let Hv = normalize(L + vec3f(0.0, 0.0, 1.0));
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  let F = R * C.dims.x;
  let x = q / F;
  let fpx = px / F;
  let style = u32(C.dial.x + 0.5);
  var lit_albedo = vec3f(0.0);
  var h = hf;
  var lume = 0.0;
  var glass = 0.0;
  if (rr > F) {
    // THE CASE: a rounded bezel in metal — the lamp's diffuse on its profile, a highlight where it turns the lamp to the eye
    let e = max(px, 0.05);
    let dh = (clock_bezel(rr + e, F, R, hc, hf) - clock_bezel(rr - e, F, R, hc, hf)) / (2.0 * e);
    h = clock_bezel(rr, F, R, hc, hf);
    let n = normalize(vec3f(-(q / max(rr, 1.0e-4)) * dh * C.dims.y, 1.0));
    let diffuse = saturate(dot(n, L)) / max(L.z, 1.0e-3);
    let spec = pow(saturate(dot(n, Hv)), 28.0) * C.caseColour.w;
    let grain = (value_noise(q * 1.7) - 0.5) * 0.03 + (bn.x - 0.5) * 0.02;
    let albedo = clamp(C.caseColour.xyz + vec3f(grain), vec3f(0.0), vec3f(1.0));
    // the room's share: metal turned from the lamp still mirrors the room (never black), the lamp's light over it
    lit_albedo = albedo * (0.3 + 0.7 * pow(max(diffuse, 0.0), 1.0 / 2.2)) + mix(vec3f(1.0), albedo, 0.35) * spec;
  } else {
    // THE DIAL: the enamel with its grain, the printing, the lume's paint; the bezel's wall and the hands shade it
    let grain = ((value_noise(x * 40.0) - 0.5) + (bn.x - 0.5) * 0.5) * C.dialColour.w;
    let print = clock_print(x, style, C.dial.y > 0.5, fpx);
    var albedo = mix(C.dialColour.xyz + vec3f(grain), C.ink.xyz, print.x);
    albedo = mix(albedo, C.lume.xyz, print.y);
    lume = print.y;
    let wall = clock_blur(length(q - C.slope * (hc - hf)) - F, C.shadow.x + C.shadow.z * (hc - hf));
    var shade = mix(1.0 - 0.8 * C.shadow.y, 1.0, wall);
    // each hand's shadow on the dial: the hand where the lamp's ray from this point meets its height
    let hs = vec3f(C.heights.z, C.heights.w, C.dims.z) - C.heights.y;
    let sHour = clock_hand((q - C.slope * hs.x) / F, C.hands.x, CLOCK_HOUR) * F;
    let sMin = clock_hand((q - C.slope * hs.y) / F, C.hands.y, CLOCK_MINUTE) * F;
    shade *= 1.0 - 0.55 * C.shadow.y * clock_blur(sHour, C.shadow.x + C.shadow.z * hs.x);
    shade *= 1.0 - 0.55 * C.shadow.y * clock_blur(sMin, C.shadow.x + C.shadow.z * hs.y);
    if (C.hands.w > 0.5) {
      let sSec = clock_second((q - C.slope * hs.z) / F, C.hands.z, style) * F;
      shade *= 1.0 - 0.45 * C.shadow.y * clock_blur(sSec, C.shadow.x + C.shadow.z * hs.z);
    }
    lit_albedo = albedo * shade;
    // THE HANDS over the dial, the hour's under the minute's under the seconds', the arbor's cap over all
    let cHour = clock_cov(clock_hand(x, C.hands.x, CLOCK_HOUR) * F, px);
    lit_albedo = mix(lit_albedo, clock_facet(x, C.hands.x, L, C.handColour.xyz), cHour);
    let cMin = clock_cov(clock_hand(x, C.hands.y, CLOCK_MINUTE) * F, px);
    lit_albedo = mix(lit_albedo, clock_facet(x, C.hands.y, L, C.handColour.xyz), cMin);
    var capColour = C.handColour.xyz;
    if (C.hands.w > 0.5) {
      let cSec = clock_cov(clock_second(x, C.hands.z, style) * F, px);
      lit_albedo = mix(lit_albedo, C.secondColour.xyz, cSec);
      capColour = C.secondColour.xyz;
    }
    let cCap = clock_cov((length(x) - 0.045) * F, px);
    lit_albedo = mix(lit_albedo, capColour * (0.92 + 0.16 * saturate(dot(normalize(vec3f(x * 12.0, 1.0)), Hv))), cCap);
    lume *= 1.0 - max(cHour, cMin);
    // the glass: a dome over the dial — its glint where it turns the lamp to the eye (the desk's lamp is low: a shallow dome would
    // turn it past the rim), a sheen about it
    let nd = normalize(vec3f(x * 1.1, 1.0));
    let g = saturate(dot(nd, Hv));
    glass = pow(g, 90.0) * 0.5 + pow(g, 10.0) * 0.045;
  }
  // the lamp's dapple where the light meets this point: under the slot's own lamp the desk point, else the lamp of the host's desk
  var gobo = sample_gobo(u, gobo_tex, gobo_samp, clock_desk_at(u, p, h), bn.z);
  if (lit) { gobo = lit_gobo(u, gobo_tex, gobo_samp, p, h, clock_desk_at(u, p, h), bn.z); }
  var colour = clock_colour(u, clamp(lit_albedo, vec3f(0.0), vec3f(1.0)), gobo, bn.y);
  // the lume glows by night (emitted, never lit); the glint is the Sun's by day, the Moon's — dimmer, cooler — by night, shaded
  // under the leaves as the mat's own light is (mat.wgsl shade_mat's grade: the gobo's floor and its mix)
  colour += C.lume.xyz * lume * C.lume.w * u.night.x;
  let seen = mix(1.0, u.gobo.w + (1.0 - u.gobo.w) * gobo, u.gobo.z);
  colour += mix(vec3f(1.0), vec3f(0.72, 0.8, 1.0), u.night.x) * glass * (1.0 - 0.7 * u.night.x) * seen;
  acc = clock_over(vec4f(clamp(colour, vec3f(0.0), vec3f(1.0)) * cov, cov), acc);
  return acc * C.alpha;
}
