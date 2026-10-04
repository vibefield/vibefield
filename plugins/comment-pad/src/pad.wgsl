// THE COMMENT PAD as a material — a PURE module: the record `Pad`, the view block `MatUniforms` and the textures
// arrive as parameters; it names no colour (the paper's, the accent's and the pen's are the record's, from the
// look). A block of writing paper under a gummed binding strip: its top sheet ruled in the accent's tint at the
// hand's baselines, a margin rule, the writing laid from the ink layers, the caret while the desk's editor is
// on it; the lower sheets' edges along its foot; its shadow cast along the lamp's slope by its height; lit by
// the mat's own light (the kit's `light` piece: the gobo's dapple, the day's chain, the night's).
// Composed after the kit's view · portal · sdf · light pieces (shaders.ts); y runs down the screen.

fn pad_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }

fn pad_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage: 1 well inside (d < 0), 0 well outside.
fn pad_blur(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * pad_erf(d / max(sigma * 1.4142136, 1.0e-4)); }

fn pad_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }

// A line's coverage at signed distance d from its centre line, half width hw; px = units per device px.
fn pad_line(d: f32, hw: f32, px: f32) -> f32 { return clamp(0.5 - (abs(d) - hw) / px, 0.0, 1.0); }

// A world point raised h off the desk, in the projector's frame (mat.wgsl desk_of with a height).
fn pad_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}

// The day's chain, the night, or a cross-fade of the two (the mat's own colour law on an object's albedo).
fn pad_colour(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, albedo, gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// One pad at world point p: premultiplied colour. px = world units per device px; frag = the framebuffer pixel;
// lit = the slot is lit from elsewhere (a mini mat's inside) — a pipeline constant, never a uniform flag.
fn shade_pad(P: Pad, u: MatUniforms, p: vec2f, px: f32, frag: vec2f,
             ink_tex: texture_2d_array<f32>, ink_samp: sampler,
             gobo_tex: texture_2d<f32>, gobo_samp: sampler, noise_tex: texture_2d<f32>, noise_samp: sampler, lit: bool) -> vec4f {
  let q = p - P.centre;
  let s = max(P.scale, 1.0e-4);
  let hb = P.shadow.w + P.lift;                   // the block's top off the desk
  let step = P.dims.z * s;                        // a lower sheet's edge, world units
  let n = P.sheet.w;                              // the lower sheets that show
  // the whole block: the top sheet and the sheets under it, each a step further down
  let down = 0.5 * n * step;
  let blockHalf = vec2f(P.half.x, P.half.y + down);
  let dBlock = sdf_round_box(q - vec2f(0.0, down), blockHalf, P.radius);
  // its shadow on the desk: the block's silhouette cast along the lamp's ground slope, blurred by its height
  let ds = sdf_round_box(q - vec2f(0.0, down) - P.slope * hb, blockHalf, P.radius);
  let sh = pad_blur(ds, P.shadow.x + P.shadow.z * hb) * P.shadow.y * (1.0 - pad_cov(dBlock, px));
  var acc = vec4f(0.0, 0.0, 0.0, sh);
  if (dBlock > px) { return acc * P.alpha; }
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  // the lamp's dapple where its light meets the block: under the slot's own lamp the desk point, else the host desk's lamp
  var gobo = sample_gobo(u, gobo_tex, gobo_samp, pad_desk_at(u, p, hb), bn.z);
  if (lit) { gobo = lit_gobo(u, gobo_tex, gobo_samp, p, hb, pad_desk_at(u, p, hb), bn.z); }
  // the lower sheets, deepest first: each an edge of the block's paper, a shade darker the further down
  for (var k = i32(n); k >= 1; k = k - 1) {
    let dk = sdf_round_box(q - vec2f(0.0, f32(k) * step), P.half, P.radius);
    let ck = pad_cov(dk, px);
    if (ck > 0.0) {
      let col = pad_colour(u, P.sheet.xyz * (1.0 - 0.06 * f32(k)), gobo, bn.y);
      acc = pad_over(vec4f(col * ck, ck), acc);
    }
  }
  // the top sheet
  let d0 = sdf_round_box(q, P.half, P.radius);
  let c0 = pad_cov(d0, px);
  if (c0 <= 0.0) { return acc * P.alpha; }
  let pl = q / s + 0.5 * P.dims.xy;              // pad units from the sheet's top-left
  let pu = px / s;                                // pad units per device px
  var albedo = P.paper.xyz + vec3f((bn.x - 0.5) * 2.0 * P.paper.w);
  // the ruled lines in the accent's tint, at the hand's baselines across the writing box, and the margin rule
  let pitch = max(P.rules.y, 1.0e-3);
  if (pl.y > P.accent.w && pl.y < P.rules.z + 0.5 * pitch) {
    let near = P.rules.x + round((pl.y - P.rules.x) / pitch) * pitch;
    if (near >= P.rules.x - 0.01 && near <= P.rules.z + 0.01) {
      albedo = mix(albedo, P.accent.xyz, pad_line(pl.y - near, P.rules.w, pu) * P.marks.x);
    }
    albedo = mix(albedo, P.accent.xyz, pad_line(pl.x - P.marks.y, P.rules.w, pu) * P.marks.z);
  }
  // the writing: the ink's coverage from its layer, in the pen's colour
  if (P.ink.w > 0.5) {
    let texel = (pl - P.raster.zw) * P.raster.y;
    if (texel.x >= 0.0 && texel.y >= 0.0 && texel.x < P.rasterSize.x && texel.y < P.rasterSize.y) {
      let a = textureSampleLevel(ink_tex, ink_samp, texel / P.rasterSize.zw, i32(P.raster.x), 0.0).r;
      albedo = mix(albedo, P.ink.xyz, a);
    }
  }
  // the caret, while the desk's editor is on the pad (the editor's own is invisible): a bar in the pen's colour
  if (P.caret.w > 0.5) {
    let cx = abs(pl.x - P.caret.x) - 0.5 * P.marks.w;
    let cy = max(P.caret.y - pl.y, pl.y - (P.caret.y + P.caret.z));
    albedo = mix(albedo, P.ink.xyz, pad_cov(max(cx, cy), pu));
  }
  // the gummed binding across the top: the accent, a little brighter toward its top edge, and its crease below
  if (pl.y < P.accent.w) {
    let t = clamp(pl.y / max(P.accent.w, 1.0e-3), 0.0, 1.0);
    albedo = P.accent.xyz * (0.9 + 0.1 * (1.0 - t));
  }
  albedo = mix(albedo, albedo * 0.8, pad_line(pl.y - P.accent.w, 0.4, pu));
  let colour = pad_colour(u, clamp(albedo, vec3f(0.0), vec3f(1.0)), gobo, bn.y);
  acc = pad_over(vec4f(colour * c0, c0), acc);
  return acc * P.alpha;
}
